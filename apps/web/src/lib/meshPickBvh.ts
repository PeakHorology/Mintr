export type PickTriangle = {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
};

/**
 * Flat triangle soup: 9 numbers per triangle (ax ay az bx by bz cx cy cz).
 * One buffer instead of one object per triangle, so a dense import can be
 * handed to a worker with a zero-copy transfer and indexed without allocating.
 */
export type TriangleSoup = Float64Array;

export type TriangleSource = PickTriangle[] | TriangleSoup;

export const SOUP_STRIDE = 9;

export function triangleCount(source: TriangleSource) {
  return source instanceof Float64Array ? Math.floor(source.length / SOUP_STRIDE) : source.length;
}

export function packPickTriangles(triangles: PickTriangle[]): TriangleSoup {
  const soup = new Float64Array(triangles.length * SOUP_STRIDE);
  for (let index = 0; index < triangles.length; index += 1) {
    const tri = triangles[index];
    const at = index * SOUP_STRIDE;
    soup[at] = tri.ax; soup[at + 1] = tri.ay; soup[at + 2] = tri.az;
    soup[at + 3] = tri.bx; soup[at + 4] = tri.by; soup[at + 5] = tri.bz;
    soup[at + 6] = tri.cx; soup[at + 7] = tri.cy; soup[at + 8] = tri.cz;
  }
  return soup;
}

export function triangleSoupOf(source: TriangleSource): TriangleSoup {
  return source instanceof Float64Array ? source : packPickTriangles(source);
}

/** Fill `out` with triangle `index` of the soup; reuse one scratch object across a loop. */
export function readPickTriangle(soup: TriangleSoup, index: number, out: PickTriangle): PickTriangle {
  const at = index * SOUP_STRIDE;
  out.ax = soup[at]; out.ay = soup[at + 1]; out.az = soup[at + 2];
  out.bx = soup[at + 3]; out.by = soup[at + 4]; out.bz = soup[at + 5];
  out.cx = soup[at + 6]; out.cy = soup[at + 7]; out.cz = soup[at + 8];
  return out;
}

export function scratchPickTriangle(): PickTriangle {
  return { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, cx: 0, cy: 0, cz: 0 };
}

export type PickHit = {
  t: number;
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
};

type PickBvhNode = {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  /** Leaf: range [start, end) into `order`. */
  start: number;
  end: number;
  left?: PickBvhNode;
  right?: PickBvhNode;
};

export type PickBvh = {
  data: TriangleSoup;
  /** Triangle indices, permuted so each node owns a contiguous range. */
  order: Uint32Array;
  root: PickBvhNode;
};

const LEAF_SIZE = 8;

function boundsOf(data: TriangleSoup, order: Uint32Array, start: number, end: number) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let slot = start; slot < end; slot += 1) {
    const at = order[slot] * SOUP_STRIDE;
    for (let corner = 0; corner < SOUP_STRIDE; corner += 3) {
      const x = data[at + corner];
      const y = data[at + corner + 1];
      const z = data[at + corner + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function splitRange(
  data: TriangleSoup,
  order: Uint32Array,
  centroids: [Float64Array, Float64Array, Float64Array],
  start: number,
  end: number,
): PickBvhNode {
  const bounds = boundsOf(data, order, start, end);
  if (end - start <= LEAF_SIZE) return { ...bounds, start, end };
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const spanZ = bounds.maxZ - bounds.minZ;
  const axis = spanX >= spanY && spanX >= spanZ ? 0 : spanY >= spanZ ? 1 : 2;
  const key = centroids[axis];
  order.subarray(start, end).sort((left, right) => key[left] - key[right]);
  const mid = start + Math.max(1, Math.floor((end - start) / 2));
  return {
    ...bounds,
    start,
    end,
    left: splitRange(data, order, centroids, start, mid),
    right: splitRange(data, order, centroids, mid, end),
  };
}

export function buildPickBvh(source: TriangleSource): PickBvh | null {
  const data = triangleSoupOf(source);
  const count = triangleCount(data);
  if (count === 0) return null;
  const order = new Uint32Array(count);
  const cx = new Float64Array(count);
  const cy = new Float64Array(count);
  const cz = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    order[index] = index;
    const at = index * SOUP_STRIDE;
    cx[index] = (data[at] + data[at + 3] + data[at + 6]) / 3;
    cy[index] = (data[at + 1] + data[at + 4] + data[at + 7]) / 3;
    cz[index] = (data[at + 2] + data[at + 5] + data[at + 8]) / 3;
  }
  return { data, order, root: splitRange(data, order, [cx, cy, cz], 0, count) };
}

function rayHitsBox(
  originX: number, originY: number, originZ: number,
  invX: number, invY: number, invZ: number,
  node: PickBvhNode,
  maxT: number,
) {
  const tx1 = (node.minX - originX) * invX;
  const tx2 = (node.maxX - originX) * invX;
  const ty1 = (node.minY - originY) * invY;
  const ty2 = (node.maxY - originY) * invY;
  const tz1 = (node.minZ - originZ) * invZ;
  const tz2 = (node.maxZ - originZ) * invZ;
  const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2));
  const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));
  return tmax >= Math.max(tmin, 0) && tmin <= maxT;
}

function intersectTriangle(
  originX: number, originY: number, originZ: number,
  dirX: number, dirY: number, dirZ: number,
  data: TriangleSoup,
  at: number,
  doubleSided: boolean,
  maxT: number,
): PickHit | null {
  const ax = data[at];
  const ay = data[at + 1];
  const az = data[at + 2];
  const edge1x = data[at + 3] - ax;
  const edge1y = data[at + 4] - ay;
  const edge1z = data[at + 5] - az;
  const edge2x = data[at + 6] - ax;
  const edge2y = data[at + 7] - ay;
  const edge2z = data[at + 8] - az;
  const px = dirY * edge2z - dirZ * edge2y;
  const py = dirZ * edge2x - dirX * edge2z;
  const pz = dirX * edge2y - dirY * edge2x;
  const det = edge1x * px + edge1y * py + edge1z * pz;
  if (!doubleSided && det < 1e-8) return null;
  if (doubleSided && Math.abs(det) < 1e-8) return null;
  const invDet = 1 / det;
  const sx = originX - ax;
  const sy = originY - ay;
  const sz = originZ - az;
  const u = (sx * px + sy * py + sz * pz) * invDet;
  if (u < 0 || u > 1) return null;
  const qx = sy * edge1z - sz * edge1y;
  const qy = sz * edge1x - sx * edge1z;
  const qz = sx * edge1y - sy * edge1x;
  const v = (dirX * qx + dirY * qy + dirZ * qz) * invDet;
  if (v < 0 || u + v > 1) return null;
  const t = (edge2x * qx + edge2y * qy + edge2z * qz) * invDet;
  if (t < 1e-6 || t > maxT) return null;
  const nx = edge1y * edge2z - edge1z * edge2y;
  const ny = edge1z * edge2x - edge1x * edge2z;
  const nz = edge1x * edge2y - edge1y * edge2x;
  const length = Math.hypot(nx, ny, nz) || 1;
  return {
    t,
    x: originX + dirX * t,
    y: originY + dirY * t,
    z: originZ + dirZ * t,
    nx: nx / length,
    ny: ny / length,
    nz: nz / length,
  };
}

export function raycastPickBvh(
  root: PickBvh,
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  doubleSided = false,
  maxT = Infinity,
): PickHit | null {
  const invX = 1 / (direction.x === 0 ? 1e-12 : direction.x);
  const invY = 1 / (direction.y === 0 ? 1e-12 : direction.y);
  const invZ = 1 / (direction.z === 0 ? 1e-12 : direction.z);
  const { data, order } = root;
  let best: PickHit | null = null;
  let limit = maxT;
  const visit = (node: PickBvhNode) => {
    if (!rayHitsBox(origin.x, origin.y, origin.z, invX, invY, invZ, node, limit)) return;
    if (!node.left) {
      for (let slot = node.start; slot < node.end; slot += 1) {
        const hit = intersectTriangle(
          origin.x, origin.y, origin.z,
          direction.x, direction.y, direction.z,
          data, order[slot] * SOUP_STRIDE, doubleSided, limit,
        );
        if (!hit) continue;
        best = hit;
        limit = hit.t;
      }
      return;
    }
    visit(node.left);
    if (node.right) visit(node.right);
  };
  visit(root.root);
  return best;
}
