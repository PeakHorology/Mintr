import type { IndexedMesh } from "./textureMesh";

/**
 * Which parts of a body take the texture. The body's triangles are sorted
 * into faces the way a person sees them: each flat face on its own, and each
 * run of curved surface (a cylinder wall, a fillet, a ball) as one face.
 */

type Vec = [number, number, number];

/** A face the person clicked, as a point on it and the way it faces. Same frame as the mesh. */
export type TextureFaceTarget = { point: Vec; normal: Vec };

export type FaceRegions = {
  /** Face number of each triangle. */
  region: Int32Array;
  count: number;
  /** True for a face that is one flat plane. */
  flat: boolean[];
};

const FLAT_DOT = Math.cos((1 * Math.PI) / 180);
const SMOOTH_DOT = Math.cos((30 * Math.PI) / 180);
/** A flat face this many times wider than the curved strips beside it is a real face, not one strip of a curve. */
const FACE_WIDTH_RATIO = 3;
/** A hole's wall faces every way around, so its facings mostly cancel out. */
const HOLE_MEAN_FACING = 0.5;
/** A side is a face that leans more than this from flat. */
const SIDE_NY = Math.cos((40 * Math.PI) / 180);
/** Surfaces this close count as touching, in mm. */
export const CONTACT_MM = 0.05;
const CONTACT_FACING = -0.5;

const EDGE_STRIDE = 2 ** 26;
const edgeKey = (a: number, b: number) => (a < b ? a * EDGE_STRIDE + b : b * EDGE_STRIDE + a);

function find(parent: Int32Array, i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

function join(parent: Int32Array, a: number, b: number) {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
}

/** The pairs of triangles that share each edge. */
function edgeNeighbours(indices: Uint32Array): [number, number][] {
  const first = new Map<number, number>();
  const pairs: [number, number][] = [];
  for (let t = 0; t < indices.length / 3; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const key = edgeKey(indices[t * 3 + k], indices[t * 3 + ((k + 1) % 3)]);
      const other = first.get(key);
      if (other === undefined) first.set(key, t);
      else {
        pairs.push([other, t]);
        first.delete(key);
      }
    }
  }
  return pairs;
}

const dot = (n: Float32Array, a: number, b: number) => n[a * 3] * n[b * 3] + n[a * 3 + 1] * n[b * 3 + 1] + n[a * 3 + 2] * n[b * 3 + 2];

export function faceRegions(mesh: IndexedMesh, normals: Float32Array, areas: Float32Array): FaceRegions {
  const { positions: p, indices } = mesh;
  const triangles = indices.length / 3;
  const pairs = edgeNeighbours(indices);

  // 1. Flat pieces: triangles joined across edges that do not bend.
  const planeOf = new Int32Array(triangles).map((_, i) => i);
  for (const [a, b] of pairs) if (dot(normals, a, b) >= FLAT_DOT) join(planeOf, a, b);
  const planeArea = new Map<number, number>();
  const planeMin = new Map<number, Vec>();
  const planeMax = new Map<number, Vec>();
  for (let t = 0; t < triangles; t += 1) {
    const root = find(planeOf, t);
    planeArea.set(root, (planeArea.get(root) ?? 0) + areas[t]);
    const min = planeMin.get(root) ?? [Infinity, Infinity, Infinity];
    const max = planeMax.get(root) ?? [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k += 1) {
      const v = indices[t * 3 + k] * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], p[v + axis]);
        max[axis] = Math.max(max[axis], p[v + axis]);
      }
    }
    planeMin.set(root, min);
    planeMax.set(root, max);
  }
  // How wide a piece is: a strip of a cylinder is long and thin, a real face is not.
  const width = (root: number) => {
    const min = planeMin.get(root)!;
    const max = planeMax.get(root)!;
    const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
    return (planeArea.get(root) ?? 0) / diagonal;
  };

  // 2. A flat piece is a face of its own unless it is one strip of a curve: then its neighbours
  // across gentle bends are strips about as wide as it is.
  const smoothNeighbours = new Map<number, number[]>();
  for (const [a, b] of pairs) {
    const ra = find(planeOf, a);
    const rb = find(planeOf, b);
    if (ra === rb || dot(normals, a, b) < SMOOTH_DOT) continue;
    (smoothNeighbours.get(ra) ?? smoothNeighbours.set(ra, []).get(ra)!).push(rb);
    (smoothNeighbours.get(rb) ?? smoothNeighbours.set(rb, []).get(rb)!).push(ra);
  }
  const isFace = new Map<number, boolean>();
  planeArea.forEach((_, root) => {
    const around = smoothNeighbours.get(root);
    if (!around?.length) {
      isFace.set(root, true);
      return;
    }
    const widths = around.map(width).sort((x, y) => x - y);
    const median = widths[widths.length >> 1];
    isFace.set(root, width(root) >= FACE_WIDTH_RATIO * median);
  });

  // 3. Curved pieces join their curved neighbours across gentle bends.
  const regionOf = new Int32Array(triangles).map((_, i) => find(planeOf, i));
  for (const [a, b] of pairs) {
    const ra = find(planeOf, a);
    const rb = find(planeOf, b);
    if (ra === rb || isFace.get(ra) || isFace.get(rb) || dot(normals, a, b) < SMOOTH_DOT) continue;
    join(regionOf, a, b);
  }
  const numbers = new Map<number, number>();
  const region = new Int32Array(triangles);
  const flat: boolean[] = [];
  for (let t = 0; t < triangles; t += 1) {
    const root = find(regionOf, t);
    let id = numbers.get(root);
    if (id === undefined) {
      id = numbers.size;
      numbers.set(root, id);
      flat.push(Boolean(isFace.get(find(planeOf, t))));
    }
    region[t] = id;
  }
  return { region, count: numbers.size, flat };
}

/**
 * Round holes and bores: a curved face that bends inward and faces every way
 * around. A screw, pin or bearing has to fit, so these stay smooth.
 */
export function holeRegions(mesh: IndexedMesh, normals: Float32Array, areas: Float32Array, regions: FaceRegions): boolean[] {
  const { positions: p, indices } = mesh;
  const bend = new Float64Array(regions.count);
  const facing = new Float64Array(regions.count * 3);
  const area = new Float64Array(regions.count);
  const centre = (t: number, axis: number) => (p[indices[t * 3] * 3 + axis] + p[indices[t * 3 + 1] * 3 + axis] + p[indices[t * 3 + 2] * 3 + axis]) / 3;
  for (let t = 0; t < indices.length / 3; t += 1) {
    const r = regions.region[t];
    area[r] += areas[t];
    for (let axis = 0; axis < 3; axis += 1) facing[r * 3 + axis] += normals[t * 3 + axis] * areas[t];
  }
  // Moving from one triangle to the next, an outward bend turns the facing the way you move; an inward bend turns it back.
  for (const [a, b] of edgeNeighbours(indices)) {
    const r = regions.region[a];
    if (r !== regions.region[b] || regions.flat[r]) continue;
    let along = 0;
    for (let axis = 0; axis < 3; axis += 1) along += (normals[b * 3 + axis] - normals[a * 3 + axis]) * (centre(b, axis) - centre(a, axis));
    bend[r] += along;
  }
  return Array.from({ length: regions.count }, (_, r) => {
    if (regions.flat[r] || area[r] <= 0 || bend[r] >= 0) return false;
    const mean = Math.hypot(facing[r * 3], facing[r * 3 + 1], facing[r * 3 + 2]) / area[r];
    return mean < HOLE_MEAN_FACING;
  });
}

function pointTriangleDistanceSq(px: number, py: number, pz: number, t: Float32Array, o: number): number {
  // Closest point on a triangle (Ericson, Real-Time Collision Detection 5.1.5).
  const ax = t[o], ay = t[o + 1], az = t[o + 2];
  const bx = t[o + 3], by = t[o + 4], bz = t[o + 5];
  const cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  const sq = (x: number, y: number, z: number) => x * x + y * y + z * z;
  if (d1 <= 0 && d2 <= 0) return sq(apx, apy, apz);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return sq(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return sq(apx - v * abx, apy - v * aby, apz - v * abz);
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return sq(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return sq(apx - w * acx, apy - w * acy, apz - w * acz);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return sq(bpx - w * (cx - bx), bpy - w * (cy - by), bpz - w * (cz - bz));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return sq(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w);
}

/**
 * Other parts' surfaces near this one, for asking "is this point pressed against
 * another part?". A loose grid keeps each question to a few triangles.
 */
export type ContactSurface = { near: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => boolean };

export function contactSurface(triangles: Float32Array): ContactSurface | null {
  const count = Math.floor(triangles.length / 9);
  if (count === 0) return null;
  const normals = new Float32Array(count * 3);
  let size = 0;
  for (let t = 0; t < count; t += 1) {
    const o = t * 9;
    const ux = triangles[o + 3] - triangles[o], uy = triangles[o + 4] - triangles[o + 1], uz = triangles[o + 5] - triangles[o + 2];
    const vx = triangles[o + 6] - triangles[o], vy = triangles[o + 7] - triangles[o + 1], vz = triangles[o + 8] - triangles[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[t * 3] = nx / length;
    normals[t * 3 + 1] = ny / length;
    normals[t * 3 + 2] = nz / length;
    size += Math.hypot(ux, uy, uz);
  }
  const cell = Math.max(1, (size / count) * 1.5);
  const grid = new Map<string, number[]>();
  for (let t = 0; t < count; t += 1) {
    const o = t * 9;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        lo[axis] = Math.min(lo[axis], triangles[o + k * 3 + axis]);
        hi[axis] = Math.max(hi[axis], triangles[o + k * 3 + axis]);
      }
    }
    const x0 = Math.floor((lo[0] - CONTACT_MM) / cell), x1 = Math.floor((hi[0] + CONTACT_MM) / cell);
    const y0 = Math.floor((lo[1] - CONTACT_MM) / cell), y1 = Math.floor((hi[1] + CONTACT_MM) / cell);
    const z0 = Math.floor((lo[2] - CONTACT_MM) / cell), z1 = Math.floor((hi[2] + CONTACT_MM) / cell);
    // A huge triangle would fill too many cells; it still lands in a capped number of them.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 200_000) continue;
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (let z = z0; z <= z1; z += 1) {
          const key = `${x},${y},${z}`;
          const list = grid.get(key);
          if (list) list.push(t);
          else grid.set(key, [t]);
        }
      }
    }
  }
  const limit = CONTACT_MM * CONTACT_MM;
  return {
    near: (x, y, z, nx, ny, nz) => {
      const list = grid.get(`${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`);
      if (!list) return false;
      for (const t of list) {
        if (normals[t * 3] * nx + normals[t * 3 + 1] * ny + normals[t * 3 + 2] * nz > CONTACT_FACING) continue;
        if (pointTriangleDistanceSq(x, y, z, triangles, t * 9) <= limit) return true;
      }
      return false;
    },
  };
}

export type FaceMaskSettings = {
  faces: "all" | "sides" | "picked";
  picks: readonly TextureFaceTarget[];
  /** With picked faces: whole sides chosen by direction, each a unit facing in the mesh's frame. */
  directions?: readonly Vec[];
  smoothHoles: boolean;
};

/** A surface within 45° of a chosen side's direction belongs to that side. */
const DIRECTION_DOT = Math.SQRT1_2;

const PICK_FACING = 0.5;

/** The face each clicked point lands on: the nearest triangle that faces about the same way. */
export function pickedRegions(mesh: IndexedMesh, normals: Float32Array, regions: FaceRegions, picks: readonly TextureFaceTarget[]): Set<number> {
  const chosen = new Set<number>();
  const { positions: p, indices } = mesh;
  const soup = new Float32Array(9);
  for (const pick of picks) {
    const length = Math.hypot(...pick.normal) || 1;
    const n: Vec = [pick.normal[0] / length, pick.normal[1] / length, pick.normal[2] / length];
    let best = -1;
    let bestDistance = Infinity;
    for (let t = 0; t < indices.length / 3; t += 1) {
      if (normals[t * 3] * n[0] + normals[t * 3 + 1] * n[1] + normals[t * 3 + 2] * n[2] < PICK_FACING) continue;
      for (let k = 0; k < 3; k += 1) {
        const v = indices[t * 3 + k] * 3;
        soup[k * 3] = p[v];
        soup[k * 3 + 1] = p[v + 1];
        soup[k * 3 + 2] = p[v + 2];
      }
      const distance = pointTriangleDistanceSq(pick.point[0], pick.point[1], pick.point[2], soup, 0);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = t;
      }
    }
    if (best >= 0) chosen.add(regions.region[best]);
  }
  return chosen;
}

/**
 * 1 for each triangle that stays smooth: faces left out by the chosen faces,
 * and round holes. The texture eases out next to them.
 */
export function smoothFaceMask(
  mesh: IndexedMesh,
  normals: Float32Array,
  areas: Float32Array,
  settings: FaceMaskSettings,
): Uint8Array {
  const triangles = mesh.indices.length / 3;
  const mask = new Uint8Array(triangles);
  if (settings.faces === "sides") {
    for (let t = 0; t < triangles; t += 1) if (Math.abs(normals[t * 3 + 1]) > SIDE_NY) mask[t] = 1;
  }
  if (settings.faces === "all" && !settings.smoothHoles) return mask;
  const regions = faceRegions(mesh, normals, areas);
  if (settings.faces === "picked") {
    const chosen = pickedRegions(mesh, normals, regions, settings.picks);
    const directions = settings.directions ?? [];
    const onChosenSide = (t: number) => directions.some((d) => normals[t * 3] * d[0] + normals[t * 3 + 1] * d[1] + normals[t * 3 + 2] * d[2] > DIRECTION_DOT);
    for (let t = 0; t < triangles; t += 1) if (!chosen.has(regions.region[t]) && !onChosenSide(t)) mask[t] = 1;
  }
  if (settings.smoothHoles) {
    const holes = holeRegions(mesh, normals, areas, regions);
    for (let t = 0; t < triangles; t += 1) if (holes[regions.region[t]]) mask[t] = 1;
  }
  return mask;
}

/**
 * The directions a picture placed once is laid out in: right and up as you see it
 * looking at the face, turned by the pattern angle. On a top face, up is away from
 * the front of the part; on a bottom face, toward it.
 */
export function stampFrame(stamp: { normal: readonly number[] }, angleDeg: number) {
  const length = Math.hypot(stamp.normal[0], stamp.normal[1], stamp.normal[2]) || 1;
  const n: Vec = [stamp.normal[0] / length, stamp.normal[1] / length, stamp.normal[2] / length];
  let up: Vec = Math.abs(n[1]) > 0.9 ? [0, 0, n[1] > 0 ? -1 : 1] : [0, 1, 0];
  // Lay up flat on the face.
  const along = up[0] * n[0] + up[1] * n[1] + up[2] * n[2];
  up = [up[0] - n[0] * along, up[1] - n[1] * along, up[2] - n[2] * along];
  const upLength = Math.hypot(...up) || 1;
  up = [up[0] / upLength, up[1] / upLength, up[2] / upLength];
  let right: Vec = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  const cos = Math.cos((angleDeg * Math.PI) / 180);
  const sin = Math.sin((angleDeg * Math.PI) / 180);
  const turnedRight: Vec = [right[0] * cos + up[0] * sin, right[1] * cos + up[1] * sin, right[2] * cos + up[2] * sin];
  up = [up[0] * cos - right[0] * sin, up[1] * cos - right[1] * sin, up[2] * cos - right[2] * sin];
  right = turnedRight;
  return { normal: n, right, up };
}

/** How far in front of or behind its face a placed picture still reaches, as a share of its width. */
export const STAMP_REACH = 0.6;
/** A surface turned further than this from the picture's face does not take it. */
export const STAMP_FACING = 0.2;


/** A picture placed on a face: its middle, the way it faces, and how wide and tall the face is there. */
export type PlacedStamp = { point: Vec; normal: Vec; width: number; height: number };

/** Most pictures placed on each face; the largest faces come first. */
export const MAX_EACH_STAMPS = 16;

/**
 * The middle of some triangles as seen looking at them along `normal`, dropped onto
 * their surface. For a flat face that is its centre; for a curved one, the middle of
 * the part facing that way.
 */
export function stampCentre(mesh: IndexedMesh, triangles: readonly number[], normal: readonly number[], angleDeg: number): PlacedStamp | null {
  if (triangles.length === 0) return null;
  const { normal: n, right, up } = stampFrame({ normal }, angleDeg);
  const p = mesh.positions;
  const i = mesh.indices;
  const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const origin = [p[i[triangles[0] * 3] * 3], p[i[triangles[0] * 3] * 3 + 1], p[i[triangles[0] * 3] * 3 + 2]];
  let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity, deepest = -Infinity;
  for (const t of triangles) {
    for (let k = 0; k < 3; k += 1) {
      const v = i[t * 3 + k] * 3;
      const d = [p[v] - origin[0], p[v + 1] - origin[1], p[v + 2] - origin[2]];
      const r = dot(d, right);
      const u = dot(d, up);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      deepest = Math.max(deepest, dot(d, n));
    }
  }
  const dr = (minR + maxR) / 2;
  const du = (minU + maxU) / 2;
  // Start in front of every triangle, then drop onto the nearest one along the facing.
  const target = [0, 1, 2].map((k) => origin[k] + right[k] * dr + up[k] * du + n[k] * deepest);
  let hit: number[] | null = null;
  let hitAlong = Infinity;
  for (const t of triangles) {
    const [a, b, c] = [i[t * 3] * 3, i[t * 3 + 1] * 3, i[t * 3 + 2] * 3];
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const h = [n[1] * e2[2] - n[2] * e2[1], n[2] * e2[0] - n[0] * e2[2], n[0] * e2[1] - n[1] * e2[0]];
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const sv = [target[0] - p[a], target[1] - p[a + 1], target[2] - p[a + 2]];
    const bu = dot(sv, h) / det;
    if (bu < -1e-6 || bu > 1 + 1e-6) continue;
    const q = [sv[1] * e1[2] - sv[2] * e1[1], sv[2] * e1[0] - sv[0] * e1[2], sv[0] * e1[1] - sv[1] * e1[0]];
    const bv = dot(n, q) / det;
    if (bv < -1e-6 || bu + bv > 1 + 1e-6) continue;
    const along = dot(e2, q) / det;
    // The line runs back into the part from in front of it.
    if (Math.abs(along) < hitAlong) {
      hitAlong = Math.abs(along);
      hit = [0, 1, 2].map((k) => target[k] + n[k] * along);
    }
  }
  const point = hit ?? [0, 1, 2].map((k) => target[k] - n[k] * deepest);
  return { point: [point[0], point[1], point[2]], normal: n, width: maxR - minR, height: maxU - minU };
}

export type EachFaceSettings = {
  faces: "all" | "sides" | "picked";
  picks: readonly TextureFaceTarget[];
  directions: readonly Vec[];
  /** The part's six side facings in the mesh's frame, for splitting a curved face (a cylinder wall) into its sides. */
  axes: readonly Vec[];
};

/**
 * One picture centred on each face the faces setting allows. A flat face gets one at
 * its centre. A curved face gets one on each side it turns toward (a cylinder wall
 * gets front, back, left and right), or toward the way it was clicked.
 */
export function eachFaceStamps(mesh: IndexedMesh, normals: Float32Array, areas: Float32Array, settings: EachFaceSettings): (PlacedStamp & { area: number })[] {
  const regions = faceRegions(mesh, normals, areas);
  const members: number[][] = Array.from({ length: regions.count }, () => []);
  for (let t = 0; t < regions.region.length; t += 1) members[regions.region[t]].push(t);
  const facing = (t: number, d: readonly number[]) => normals[t * 3] * d[0] + normals[t * 3 + 1] * d[1] + normals[t * 3 + 2] * d[2];
  const out: (PlacedStamp & { area: number })[] = [];
  const seen = new Set<string>();
  const add = (region: number, triangles: number[], normal: readonly number[]) => {
    const key = `${region}|${normal.map((x) => x.toFixed(3)).join(",")}`;
    if (seen.has(key) || triangles.length === 0) return;
    seen.add(key);
    const stamp = stampCentre(mesh, triangles, normal, 0);
    if (!stamp) return;
    out.push({ ...stamp, area: triangles.reduce((sum, t) => sum + areas[t], 0) });
  };
  const flatFace = (r: number) => {
    const t = members[r][0];
    add(r, members[r], [normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]]);
  };
  const curvedToward = (r: number, d: readonly number[]) => add(r, members[r].filter((t) => facing(t, d) > DIRECTION_DOT), d);
  const flatNormal = (r: number) => {
    const t = members[r][0];
    return [normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]];
  };
  for (let r = 0; r < regions.count; r += 1) {
    if (settings.faces === "all") {
      if (regions.flat[r]) flatFace(r);
      else settings.axes.forEach((d) => curvedToward(r, d));
    } else if (settings.faces === "sides") {
      if (regions.flat[r]) {
        if (Math.abs(flatNormal(r)[1]) <= SIDE_NY) flatFace(r);
      } else {
        settings.axes.filter((d) => Math.abs(d[1]) < 0.5).forEach((d) => curvedToward(r, d));
      }
    } else {
      for (const d of settings.directions) {
        if (regions.flat[r]) {
          if (flatNormal(r).reduce((sum, x, k) => sum + x * d[k], 0) > DIRECTION_DOT) flatFace(r);
        } else {
          curvedToward(r, d);
        }
      }
    }
  }
  if (settings.faces === "picked") {
    for (const pick of settings.picks) {
      const [r] = pickedRegions(mesh, normals, regions, [pick]);
      if (r === undefined) continue;
      if (regions.flat[r]) flatFace(r);
      else curvedToward(r, pick.normal);
    }
  }
  return out.sort((a, b) => b.area - a.area).slice(0, MAX_EACH_STAMPS);
}
