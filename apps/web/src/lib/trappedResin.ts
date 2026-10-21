import type { PickTriangle } from "@/lib/meshPickBvh";

const MAX_AXIS = 40;

/**
 * Mark faces that bound a sealed empty pocket. Flood empty space from
 * outside the part; whatever empty is left cannot drain. An open cup or a
 * through-hole stays clear. Does not add drain holes.
 */
export function collectTrappedCavityTriangles(
  triangles: PickTriangle[],
  positions: number[],
  normals: number[],
) {
  if (triangles.length === 0) return;
  const grid = buildOccupancy(triangles);
  if (!grid) return;
  floodFromOutside(grid);
  // Past the surface splat (reach is 0.87*voxel) so the sample is in the
  // pocket, not in the wall voxel that the face itself painted solid.
  const offset = grid.voxel * 1.2;
  for (const tri of triangles) {
    const nx = (tri.by - tri.ay) * (tri.cz - tri.az) - (tri.bz - tri.az) * (tri.cy - tri.ay);
    const ny = (tri.bz - tri.az) * (tri.cx - tri.ax) - (tri.bx - tri.ax) * (tri.cz - tri.az);
    const nz = (tri.bx - tri.ax) * (tri.cy - tri.ay) - (tri.by - tri.ay) * (tri.cx - tri.ax);
    const area = Math.hypot(nx, ny, nz);
    if (area < 1e-8) continue;
    const inv = 1 / area;
    const cx = (tri.ax + tri.bx + tri.cx) / 3 + nx * inv * offset;
    const cy = (tri.ay + tri.by + tri.cy) / 3 + ny * inv * offset;
    const cz = (tri.az + tri.bz + tri.cz) / 3 + nz * inv * offset;
    if (!isTrappedEmpty(grid, cx, cy, cz)) continue;
    positions.push(tri.ax, tri.ay, tri.az, tri.bx, tri.by, tri.bz, tri.cx, tri.cy, tri.cz);
    normals.push(nx * inv, ny * inv, nz * inv, nx * inv, ny * inv, nz * inv, nx * inv, ny * inv, nz * inv);
  }
}

type Occupancy = {
  nx: number;
  ny: number;
  nz: number;
  voxel: number;
  originX: number;
  originY: number;
  originZ: number;
  /** 0 empty, 1 solid, 2 flooded from outside */
  cells: Uint8Array;
};

function buildOccupancy(triangles: PickTriangle[]): Occupancy | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const tri of triangles) {
    minX = Math.min(minX, tri.ax, tri.bx, tri.cx);
    minY = Math.min(minY, tri.ay, tri.by, tri.cy);
    minZ = Math.min(minZ, tri.az, tri.bz, tri.cz);
    maxX = Math.max(maxX, tri.ax, tri.bx, tri.cx);
    maxY = Math.max(maxY, tri.ay, tri.by, tri.cy);
    maxZ = Math.max(maxZ, tri.az, tri.bz, tri.cz);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const spanZ = maxZ - minZ;
  const span = Math.max(spanX, spanY, spanZ);
  if (!(span > 0.05)) return null;
  const voxel = Math.max(0.5, span / (MAX_AXIS - 4));
  const pad = voxel * 1.5;
  const originX = minX - pad;
  const originY = minY - pad;
  const originZ = minZ - pad;
  const nx = Math.max(4, Math.min(MAX_AXIS, Math.ceil((spanX + pad * 2) / voxel)));
  const ny = Math.max(4, Math.min(MAX_AXIS, Math.ceil((spanY + pad * 2) / voxel)));
  const nz = Math.max(4, Math.min(MAX_AXIS, Math.ceil((spanZ + pad * 2) / voxel)));
  const cells = new Uint8Array(nx * ny * nz);
  const reach = voxel * 0.87;
  for (const tri of triangles) {
    const tMinX = Math.min(tri.ax, tri.bx, tri.cx);
    const tMinY = Math.min(tri.ay, tri.by, tri.cy);
    const tMinZ = Math.min(tri.az, tri.bz, tri.cz);
    const tMaxX = Math.max(tri.ax, tri.bx, tri.cx);
    const tMaxY = Math.max(tri.ay, tri.by, tri.cy);
    const tMaxZ = Math.max(tri.az, tri.bz, tri.cz);
    const x0 = clampIndex(Math.floor((tMinX - originX) / voxel) - 1, nx);
    const y0 = clampIndex(Math.floor((tMinY - originY) / voxel) - 1, ny);
    const z0 = clampIndex(Math.floor((tMinZ - originZ) / voxel) - 1, nz);
    const x1 = clampIndex(Math.ceil((tMaxX - originX) / voxel) + 1, nx);
    const y1 = clampIndex(Math.ceil((tMaxY - originY) / voxel) + 1, ny);
    const z1 = clampIndex(Math.ceil((tMaxZ - originZ) / voxel) + 1, nz);
    for (let z = z0; z <= z1; z += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const px = originX + (x + 0.5) * voxel;
          const py = originY + (y + 0.5) * voxel;
          const pz = originZ + (z + 0.5) * voxel;
          if (pointToTriangleDistance(px, py, pz, tri) > reach) continue;
          cells[x + nx * (y + ny * z)] = 1;
        }
      }
    }
  }
  return { nx, ny, nz, voxel, originX, originY, originZ, cells };
}

function floodFromOutside(grid: Occupancy) {
  const { nx, ny, nz, cells } = grid;
  const queue = new Int32Array(nx * ny * nz);
  let head = 0;
  let tail = 0;
  const tryPush = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    const index = x + nx * (y + ny * z);
    if (cells[index] !== 0) return;
    cells[index] = 2;
    queue[tail] = index;
    tail += 1;
  };
  for (let y = 0; y < ny; y += 1) {
    for (let z = 0; z < nz; z += 1) {
      tryPush(0, y, z);
      tryPush(nx - 1, y, z);
    }
  }
  for (let x = 0; x < nx; x += 1) {
    for (let z = 0; z < nz; z += 1) {
      tryPush(x, 0, z);
      tryPush(x, ny - 1, z);
    }
  }
  for (let x = 0; x < nx; x += 1) {
    for (let y = 0; y < ny; y += 1) {
      tryPush(x, y, 0);
      tryPush(x, y, nz - 1);
    }
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % nx;
    const y = Math.floor(index / nx) % ny;
    const z = Math.floor(index / (nx * ny));
    tryPush(x - 1, y, z);
    tryPush(x + 1, y, z);
    tryPush(x, y - 1, z);
    tryPush(x, y + 1, z);
    tryPush(x, y, z - 1);
    tryPush(x, y, z + 1);
  }
}

function isTrappedEmpty(grid: Occupancy, x: number, y: number, z: number) {
  const ix = Math.floor((x - grid.originX) / grid.voxel);
  const iy = Math.floor((y - grid.originY) / grid.voxel);
  const iz = Math.floor((z - grid.originZ) / grid.voxel);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= grid.nx || iy >= grid.ny || iz >= grid.nz) return false;
  return grid.cells[ix + grid.nx * (iy + grid.ny * iz)] === 0;
}

function clampIndex(value: number, count: number) {
  return Math.max(0, Math.min(count - 1, value));
}

function pointToTriangleDistance(px: number, py: number, pz: number, tri: PickTriangle) {
  const abx = tri.bx - tri.ax;
  const aby = tri.by - tri.ay;
  const abz = tri.bz - tri.az;
  const acx = tri.cx - tri.ax;
  const acy = tri.cy - tri.ay;
  const acz = tri.cz - tri.az;
  const apx = px - tri.ax;
  const apy = py - tri.ay;
  const apz = pz - tri.az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return Math.hypot(apx, apy, apz);
  const bpx = px - tri.bx;
  const bpy = py - tri.by;
  const bpz = pz - tri.bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return Math.hypot(apx - abx * v, apy - aby * v, apz - abz * v);
  }
  const cpx = px - tri.cx;
  const cpy = py - tri.cy;
  const cpz = pz - tri.cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return Math.hypot(apx - acx * w, apy - acy * w, apz - acz * w);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return Math.hypot(bpx + (tri.cx - tri.bx) * w, bpy + (tri.cy - tri.by) * w, bpz + (tri.cz - tri.bz) * w);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return Math.hypot(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w);
}
