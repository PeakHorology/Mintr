/**
 * Lighting for a fillet, chamfer, or any other exact-solid picture.
 *
 * The triangles stay as they are. Corners on one smooth face share a normal
 * that follows the surface, so a highlight slides around a convex round and
 * around a concave groove. A sharp edge keeps two normals, because the faces
 * are not welded together.
 *
 * A mesh that already carries a different normal on each corner of a curved
 * triangle is drawn as-is. Those normals are the real surface, including the
 * inward side of a concave fillet. Flat copies of one facet normal are welded
 * by position and averaged, unless the faces meet past 40°.
 */

const CREASE_DOT = Math.cos((40 * Math.PI) / 180);
const POSITION_SCALE = 10_000;

export function shadeDisplayNormals(
  positions: ArrayLike<number>,
  normals?: ArrayLike<number> | null,
  indices?: ArrayLike<number> | null,
): Float32Array | null {
  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount < 3) return null;
  const indexed = Boolean(indices && indices.length >= 3);
  const triangleCount = indexed ? Math.floor(indices!.length / 3) : Math.floor(vertexCount / 3);
  if (triangleCount < 1) return null;
  const cornerIndex = (triangle: number, slot: number) => (
    indexed ? indices![triangle * 3 + slot] : triangle * 3 + slot
  );

  if (normals && normals.length === positions.length) {
    if (!facetNormalCopies(normals, triangleCount, cornerIndex)) {
      return Float32Array.from(normals);
    }
    return creaseShade(positions, normals, vertexCount);
  }

  // No stored normals. Shared vertices already average inside computeVertexNormals.
  if (indexed && indicesAreShared(indices!, vertexCount)) return null;
  const flat = facetNormals(positions, triangleCount, cornerIndex, vertexCount);
  return flat ? creaseShade(positions, flat, vertexCount) : null;
}

function facetNormalCopies(
  normals: ArrayLike<number>,
  triangleCount: number,
  cornerIndex: (triangle: number, slot: number) => number,
) {
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = cornerIndex(triangle, 0) * 3;
    const b = cornerIndex(triangle, 1) * 3;
    const c = cornerIndex(triangle, 2) * 3;
    if (a < 0 || c + 2 >= normals.length || b + 2 >= normals.length) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      if (Math.abs(normals[a + axis] - normals[b + axis]) > 1e-4) return false;
      if (Math.abs(normals[a + axis] - normals[c + axis]) > 1e-4) return false;
    }
  }
  return true;
}

function indicesAreShared(indices: ArrayLike<number>, vertexCount: number) {
  const seen = new Uint8Array(vertexCount);
  for (let index = 0; index < indices.length; index += 1) {
    const vertex = indices[index];
    if (vertex < 0 || vertex >= vertexCount) continue;
    if (seen[vertex]) return true;
    seen[vertex] = 1;
  }
  return false;
}

function facetNormals(
  positions: ArrayLike<number>,
  triangleCount: number,
  cornerIndex: (triangle: number, slot: number) => number,
  vertexCount: number,
) {
  const out = new Float32Array(vertexCount * 3);
  let written = false;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = cornerIndex(triangle, 0);
    const ib = cornerIndex(triangle, 1);
    const ic = cornerIndex(triangle, 2);
    if (ia < 0 || ib < 0 || ic < 0 || ic >= vertexCount) continue;
    const ax = positions[ia * 3];
    const ay = positions[ia * 3 + 1];
    const az = positions[ia * 3 + 2];
    const bx = positions[ib * 3] - ax;
    const by = positions[ib * 3 + 1] - ay;
    const bz = positions[ib * 3 + 2] - az;
    const cx = positions[ic * 3] - ax;
    const cy = positions[ic * 3 + 1] - ay;
    const cz = positions[ic * 3 + 2] - az;
    let nx = by * cz - bz * cy;
    let ny = bz * cx - bx * cz;
    let nz = bx * cy - by * cx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) continue;
    nx /= length;
    ny /= length;
    nz /= length;
    written = true;
    for (const vertex of [ia, ib, ic]) {
      out[vertex * 3] = nx;
      out[vertex * 3 + 1] = ny;
      out[vertex * 3 + 2] = nz;
    }
  }
  return written ? out : null;
}

function creaseShade(positions: ArrayLike<number>, normals: ArrayLike<number>, vertexCount: number) {
  const groups = new Map<string, number[]>();
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const key = `${Math.round(positions[vertex * 3] * POSITION_SCALE)},${Math.round(positions[vertex * 3 + 1] * POSITION_SCALE)},${Math.round(positions[vertex * 3 + 2] * POSITION_SCALE)}`;
    const list = groups.get(key);
    if (list) list.push(vertex);
    else groups.set(key, [vertex]);
  }

  const out = new Float32Array(vertexCount * 3);
  for (const members of groups.values()) {
    const clusters: Array<{ x: number; y: number; z: number; verts: number[] }> = [];
    for (const vertex of members) {
      const x = normals[vertex * 3];
      const y = normals[vertex * 3 + 1];
      const z = normals[vertex * 3 + 2];
      const length = Math.hypot(x, y, z);
      if (length < 1e-8) {
        out[vertex * 3 + 1] = 1;
        continue;
      }
      let placed = false;
      for (const cluster of clusters) {
        const clusterLength = Math.hypot(cluster.x, cluster.y, cluster.z) || 1;
        const dot = (cluster.x * x + cluster.y * y + cluster.z * z) / (clusterLength * length);
        if (dot > CREASE_DOT) {
          cluster.x += x;
          cluster.y += y;
          cluster.z += z;
          cluster.verts.push(vertex);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push({ x, y, z, verts: [vertex] });
    }
    for (const cluster of clusters) {
      const length = Math.hypot(cluster.x, cluster.y, cluster.z) || 1;
      const nx = cluster.x / length;
      const ny = cluster.y / length;
      const nz = cluster.z / length;
      for (const vertex of cluster.verts) {
        out[vertex * 3] = nx;
        out[vertex * 3 + 1] = ny;
        out[vertex * 3 + 2] = nz;
      }
    }
  }
  return out;
}

const ISLAND_DOT = 0.3;
const STORED_DOT = 0.5;

/**
 * Turn fillet lighting outward and give every triangle its own corners.
 *
 * A cove or an inside-corner fillet is often meshed facing into the solid.
 * One point just off each smooth patch tells which side is material. The
 * whole patch flips together, so the highlight still slides. A sharp edge
 * stays on its own patch. A corner whose stored normal belongs to the
 * neighboring face takes this face's normal instead.
 */
export function orientSolidNormals(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  indices: ArrayLike<number> | null | undefined,
  containsPoint: (x: number, y: number, z: number) => boolean,
): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } | null {
  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount < 3 || !normals || normals.length !== positions.length) return null;
  const indexed = Boolean(indices && indices.length >= 3);
  const triangleCount = indexed ? Math.floor(indices!.length / 3) : Math.floor(vertexCount / 3);
  if (triangleCount < 1) return null;
  const cornerIndex = (triangle: number, slot: number) => (
    indexed ? indices![triangle * 3 + slot] : triangle * 3 + slot
  );

  const facets = new Float32Array(triangleCount * 3);
  const live = new Uint8Array(triangleCount);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = cornerIndex(triangle, 0);
    const ib = cornerIndex(triangle, 1);
    const ic = cornerIndex(triangle, 2);
    if (ia < 0 || ib < 0 || ic < 0 || ic >= vertexCount) continue;
    const ax = positions[ia * 3];
    const ay = positions[ia * 3 + 1];
    const az = positions[ia * 3 + 2];
    const bx = positions[ib * 3] - ax;
    const by = positions[ib * 3 + 1] - ay;
    const bz = positions[ib * 3 + 2] - az;
    const cx = positions[ic * 3] - ax;
    const cy = positions[ic * 3 + 1] - ay;
    const cz = positions[ic * 3 + 2] - az;
    let nx = by * cz - bz * cy;
    let ny = bz * cx - bx * cz;
    let nz = bx * cy - by * cx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) continue;
    facets[triangle * 3] = nx / length;
    facets[triangle * 3 + 1] = ny / length;
    facets[triangle * 3 + 2] = nz / length;
    live[triangle] = 1;
  }

  const parent = new Int32Array(triangleCount);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) parent[triangle] = triangle;
  const find = (index: number) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== root) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const pointKey = (vertex: number) => (
    `${Math.round(positions[vertex * 3] * 1000)},${Math.round(positions[vertex * 3 + 1] * 1000)},${Math.round(positions[vertex * 3 + 2] * 1000)}`
  );
  const edgeOwner = new Map<string, number>();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    if (!live[triangle]) continue;
    for (let slot = 0; slot < 3; slot += 1) {
      const first = cornerIndex(triangle, slot);
      const second = cornerIndex(triangle, (slot + 1) % 3);
      const a = pointKey(first);
      const b = pointKey(second);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const other = edgeOwner.get(key);
      if (other === undefined) {
        edgeOwner.set(key, triangle);
        continue;
      }
      const dot = facets[triangle * 3] * facets[other * 3]
        + facets[triangle * 3 + 1] * facets[other * 3 + 1]
        + facets[triangle * 3 + 2] * facets[other * 3 + 2];
      if (dot > ISLAND_DOT) parent[find(triangle)] = find(other);
    }
  }

  const flip = new Uint8Array(triangleCount);
  const seen = new Uint8Array(triangleCount);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    if (!live[triangle]) continue;
    const root = find(triangle);
    if (seen[root]) {
      flip[triangle] = flip[root];
      continue;
    }
    seen[root] = 1;
    const ia = cornerIndex(triangle, 0);
    const ib = cornerIndex(triangle, 1);
    const ic = cornerIndex(triangle, 2);
    const cx = (positions[ia * 3] + positions[ib * 3] + positions[ic * 3]) / 3;
    const cy = (positions[ia * 3 + 1] + positions[ib * 3 + 1] + positions[ic * 3 + 1]) / 3;
    const cz = (positions[ia * 3 + 2] + positions[ib * 3 + 2] + positions[ic * 3 + 2]) / 3;
    const nx = facets[triangle * 3];
    const ny = facets[triangle * 3 + 1];
    const nz = facets[triangle * 3 + 2];
    let ahead = false;
    let behind = false;
    try {
      ahead = containsPoint(cx + nx * 0.02, cy + ny * 0.02, cz + nz * 0.02);
      behind = containsPoint(cx - nx * 0.02, cy - ny * 0.02, cz - nz * 0.02);
    } catch {
      ahead = false;
      behind = false;
    }
    flip[root] = ahead && !behind ? 1 : 0;
    flip[triangle] = flip[root];
  }

  const outPositions = new Float32Array(triangleCount * 9);
  const outNormals = new Float32Array(triangleCount * 9);
  const outIndices = new Uint32Array(triangleCount * 3);
  let written = 0;
  let vertex = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    if (!live[triangle]) continue;
    const sign = flip[triangle] ? -1 : 1;
    const fx = facets[triangle * 3];
    const fy = facets[triangle * 3 + 1];
    const fz = facets[triangle * 3 + 2];
    for (let slot = 0; slot < 3; slot += 1) {
      const index = cornerIndex(triangle, slot);
      outPositions[written * 3] = positions[index * 3];
      outPositions[written * 3 + 1] = positions[index * 3 + 1];
      outPositions[written * 3 + 2] = positions[index * 3 + 2];
      let nx = normals[index * 3];
      let ny = normals[index * 3 + 1];
      let nz = normals[index * 3 + 2];
      const agree = nx * fx + ny * fy + nz * fz;
      if (agree <= STORED_DOT) {
        nx = fx;
        ny = fy;
        nz = fz;
      }
      outNormals[written * 3] = nx * sign;
      outNormals[written * 3 + 1] = ny * sign;
      outNormals[written * 3 + 2] = nz * sign;
      outIndices[written] = vertex;
      written += 1;
      vertex += 1;
    }
  }
  if (written < 3) return null;
  return {
    positions: outPositions.slice(0, written * 3),
    normals: outNormals.slice(0, written * 3),
    indices: outIndices.slice(0, written),
  };
}
