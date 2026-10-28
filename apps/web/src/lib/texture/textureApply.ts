import { MeshoptSimplifier } from "meshoptimizer";
import { normalizeSurfaceTexture, SIDE_DIRECTIONS, type SurfaceTexture } from "./surfaceTexture";
import { decodeTextureImage, fuzzyHeight, imageHeight, PATTERN_HEIGHTS, type PatternHeight } from "./texturePatterns";
import {
  flipFlatSlivers,
  flipTowardPattern,
  openEdgeCount,
  faceNormals,
  subdivideToEdgeLength,
  weldTriangles,
  type IndexedMesh,
} from "./textureMesh";
import {
  contactSurface,
  eachFaceStamps,
  smoothFaceMask,
  STAMP_FACING,
  STAMP_REACH,
  stampFrame,
  type ContactSurface,
  type PlacedStamp,
} from "./textureFaces";

export { stampFrame, STAMP_FACING, STAMP_REACH };

/**
 * Builds the textured triangles for a part. The input is the part's own
 * triangles (any winding-consistent closed mesh, +Y up, mm). The result is a
 * new closed mesh; the part itself is not changed.
 *
 * 1. Weld the corners and split long edges until the pattern has enough points.
 * 2. Read the pattern height at every point, wrapped around a round part or
 *    laid from three sides on anything else.
 * 3. Move each point along the surface by that height. Points on a sharp edge
 *    move to where the moved faces meet, so edges stay sharp.
 * 4. Trim back to the triangle budget where the texture is flat.
 */
export type SurfaceTextureOptions = {
  /** Most triangles while building, before trimming. */
  workingTriangles?: number;
  /** Most triangles in the result. */
  maxTriangles?: number;
  /** Other parts' triangles near this one, as flat xyz triples in the same frame. Faces pressed against them stay smooth. */
  contacts?: Float32Array;
  /** The chosen sides' facings in the mesh's frame, when the part is turned. Defaults to the sides unturned. */
  sideDirections?: Vec[];
  /** The part's six side facings in the mesh's frame, when the part is turned. */
  partAxes?: Vec[];
  /** Told how far the build has got, 0 to 1, and what it is doing. */
  onProgress?: (share: number, stage: SurfaceTextureStage) => void;
};

export type SurfaceTextureStage = "prepare" | "grid" | "detail" | "align" | "displace" | "trim";

/** Where each stage starts and ends on the progress bar, by how long it usually takes. */
const STAGE_SPAN: Record<SurfaceTextureStage, [number, number]> = {
  prepare: [0, 0.04],
  grid: [0.04, 0.12],
  detail: [0.12, 0.62],
  align: [0.62, 0.74],
  displace: [0.74, 0.9],
  trim: [0.9, 1],
};

export type SurfaceTextureStats = {
  wrap: "around" | "allRound";
  /** Repeats around a round part, adjusted to a whole number so the pattern has no seam. */
  repeatsAround: number | null;
  /** The pattern size actually used around a round part, in mm. */
  spacingAround: number | null;
  triangles: number;
  /** The detail was lowered to stay within the triangle budget. */
  coarser: boolean;
};

export type SurfaceTextureResult = IndexedMesh & {
  /** Each point where it sat before the texture moved it, so the texture can be shown rising out of the surface. */
  basePositions: Float32Array;
  stats: SurfaceTextureStats;
};

type BuiltMesh = IndexedMesh & { basePositions: Float32Array };

/**
 * How far each detail level goes: the triangle budgets, how finely an edge may split
 * (as a share of the usual), the smallest edge, and when the last few detail passes stop.
 */
const DETAIL_LEVELS = {
  normal: { working: 1_500_000, max: 1_000_000, share: 1, floor: 0.1, tail: 0.004 },
  fine: { working: 3_000_000, max: 2_000_000, share: 1 / 2, floor: 0.07, tail: 0.001 },
  finest: { working: 4_500_000, max: 3_000_000, share: 1 / 4, floor: 0.05, tail: 0.0002 },
} as const;
const BUDGET_SLACK = 1.1;
/** Facings closer than about 2.5° read the pattern the same. */
const SAME_FACING_DOT = 0.999;
const GROUP_DOT = Math.cos((30 * Math.PI) / 180);
const CREASE_DOT = Math.cos((40 * Math.PI) / 180);
const ROUND_SIDE_DOT = Math.cos((25 * Math.PI) / 180);
const ROUND_AREA_SHARE = 0.75;
/** How far, in mm, the texture may stray from the true pattern between two points. */
const DETAIL_TOLERANCE_MM = 0.01;

type Vec = [number, number, number];

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

function bounds(positions: Float32Array) {
  const min: Vec = [Infinity, Infinity, Infinity];
  const max: Vec = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  return { min, max, center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] as Vec };
}

/** Round parts (cups, knobs, handles) are mostly side walls that face straight out from a vertical axis. */
function isRoundAroundY(mesh: IndexedMesh, center: Vec, normals: Float32Array, areas: Float32Array): boolean {
  const { positions: p, indices } = mesh;
  let sideArea = 0;
  let radialArea = 0;
  for (let f = 0; f < areas.length; f += 1) {
    const ny = normals[f * 3 + 1];
    if (Math.abs(ny) > 0.5) continue;
    sideArea += areas[f];
    const a = indices[f * 3] * 3;
    const b = indices[f * 3 + 1] * 3;
    const c = indices[f * 3 + 2] * 3;
    const rx = (p[a] + p[b] + p[c]) / 3 - center[0];
    const rz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - center[2];
    const r = Math.hypot(rx, rz);
    if (r <= 0) continue;
    const dot = (normals[f * 3] * rx + normals[f * 3 + 2] * rz) / r;
    if (dot >= ROUND_SIDE_DOT) radialArea += areas[f];
  }
  return sideArea > 0 && radialArea / sideArea >= ROUND_AREA_SHARE;
}

/** Mean distance of the outward side walls from the axis, weighted by area. */
function sideRadius(mesh: IndexedMesh, center: Vec, normals: Float32Array, areas: Float32Array): number {
  const { positions: p, indices } = mesh;
  let total = 0;
  let weighted = 0;
  for (let f = 0; f < areas.length; f += 1) {
    if (Math.abs(normals[f * 3 + 1]) > 0.5) continue;
    const a = indices[f * 3] * 3;
    const b = indices[f * 3 + 1] * 3;
    const c = indices[f * 3 + 2] * 3;
    const rx = (p[a] + p[b] + p[c]) / 3 - center[0];
    const rz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - center[2];
    const r = Math.hypot(rx, rz);
    if (r <= 0 || (normals[f * 3] * rx + normals[f * 3 + 2] * rz) / r < ROUND_SIDE_DOT) continue;
    total += areas[f];
    weighted += areas[f] * r;
  }
  return total > 0 ? weighted / total : 0;
}

function rotated(pattern: PatternHeight, angleDeg: number): PatternHeight {
  if (Math.abs(angleDeg) < 1e-9) return pattern;
  const cos = Math.cos((angleDeg * Math.PI) / 180);
  const sin = Math.sin((angleDeg * Math.PI) / 180);
  return (u, v) => pattern(u * cos - v * sin, u * sin + v * cos);
}

type HeightAt = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

export function heightSampler(
  texture: SurfaceTexture,
  wrap: "around" | "allRound",
  center: Vec,
  repeatsAround: number,
  spacingAround: number,
  eachFace: readonly PlacedStamp[] = [],
): HeightAt {
  const spacing = texture.spacing;
  if (texture.pattern === "image" && texture.placement === "once") return stampsSampler(texture, texture.stamp ? [texture.stamp] : []);
  if (texture.pattern === "image" && texture.placement === "each") return stampsSampler(texture, fittingStamps(texture, eachFace));
  if (texture.pattern === "fuzzy") {
    return (x, y, z) => fuzzyHeight(x / spacing, y / spacing, z / spacing, texture.seed);
  }
  const base = texture.pattern === "image" && texture.image
    ? imageHeight(decodeTextureImage(texture.image))
    : PATTERN_HEIGHTS[texture.pattern === "image" ? "knurl" : texture.pattern];
  const pattern = rotated(base, texture.angle);
  if (wrap === "around") {
    // Around the side the pattern is not turned, so a whole number of repeats meets itself at the seam.
    return (x, y, z, _nx, ny) => {
      const cap = smoothstep(0.55, 0.8, Math.abs(ny));
      let side = 0;
      if (cap < 1) {
        const theta = Math.atan2(z - center[2], x - center[0]);
        // The angle is taken clockwise seen from above, so the pattern runs left to right seen from outside.
        side = base((-theta / (2 * Math.PI)) * repeatsAround, y / spacingAround);
      }
      const top = cap > 0 ? pattern(x / spacing, (ny >= 0 ? -z : z) / spacing) : 0;
      return side * (1 - cap) + top * cap;
    };
  }
  return (x, y, z, nx, ny, nz) => {
    // Three flat projections, blended by how much the surface faces each axis. Each is laid as
    // seen from outside that face, so a picture or text reads the right way round, not mirrored.
    const wx = nx ** 4;
    const wy = ny ** 4;
    const wz = nz ** 4;
    const sum = wx + wy + wz || 1;
    let h = 0;
    if (wx > 1e-4) h += (wx / sum) * pattern((nx >= 0 ? -z : z) / spacing, y / spacing);
    if (wy > 1e-4) h += (wy / sum) * pattern(x / spacing, (ny >= 0 ? -z : z) / spacing);
    if (wz > 1e-4) h += (wz / sum) * pattern((nz >= 0 ? x : -x) / spacing, y / spacing);
    return h;
  };
}

/** A face too small for half the picture gets none, so a logo does not land on a chamfer. */
export function fittingStamps(texture: SurfaceTexture, stamps: readonly PlacedStamp[]): PlacedStamp[] {
  const tall = texture.image ? texture.image.height / texture.image.width : 1;
  return stamps.filter((stamp) => stamp.width >= texture.spacing * 0.5 && stamp.height >= texture.spacing * tall * 0.5);
}

/**
 * Pictures placed on the part: each sits flat on its face, its width the pattern size,
 * and reaches round a gentle curve. Raised, the picture's light parts stand up from the
 * surface; cut in, they sink into it. Everywhere else stays as it is.
 */
function stampsSampler(texture: SurfaceTexture, stamps: readonly { point: readonly number[]; normal: readonly number[] }[]): HeightAt {
  const cut = texture.direction === "in";
  const outside = cut ? 1 : 0;
  if (!texture.image || stamps.length === 0) return () => outside;
  const each = stamps.map((stamp) => stampSampler(texture, stamp));
  if (each.length === 1) return each[0];
  // Where two pictures overlap, the higher one wins when raised, the deeper one when cut in.
  return (x, y, z, nx, ny, nz) => {
    let h = outside;
    for (const sample of each) {
      const value = sample(x, y, z, nx, ny, nz);
      h = cut ? Math.min(h, value) : Math.max(h, value);
    }
    return h;
  };
}

function stampSampler(texture: SurfaceTexture, stamp: { point: readonly number[]; normal: readonly number[] }): HeightAt {
  const cut = texture.direction === "in";
  const outside = cut ? 1 : 0;
  const image = texture.image!;
  const picture = imageHeight(decodeTextureImage(image));
  const { normal: n, right, up } = stampFrame(stamp, texture.angle);
  const [cx, cy, cz] = stamp.point;
  const width = texture.spacing;
  const tall = image.height / image.width;
  const halfPixel = 0.5 / image.width;
  return (x, y, z, nx, ny, nz) => {
    if (nx * n[0] + ny * n[1] + nz * n[2] < STAMP_FACING) return outside;
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    if (Math.abs(dx * n[0] + dy * n[1] + dz * n[2]) > width * STAMP_REACH) return outside;
    const u = (dx * right[0] + dy * right[1] + dz * right[2]) / width + 0.5;
    const v = (dx * up[0] + dy * up[1] + dz * up[2]) / width + tall / 2;
    if (u < 0 || u > 1 || v < 0 || v > tall) return outside;
    // Read inside the picture, never wrapped round to its other side.
    const h = picture(Math.min(1 - halfPixel, Math.max(halfPixel, u)), Math.min(tall * (1 - halfPixel), Math.max(tall * halfPixel, v)));
    return cut ? 1 - h : h;
  };
}

/** Vertex → touching triangles, in compact arrays. */
function vertexFaces(indices: Uint32Array, vertexCount: number) {
  const start = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < indices.length; i += 1) start[indices[i] + 1] += 1;
  for (let v = 0; v < vertexCount; v += 1) start[v + 1] += start[v];
  const fill = start.slice(0, vertexCount);
  const faces = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i += 1) faces[fill[indices[i]]++] = (i / 3) | 0;
  return { start, faces };
}

/**
 * How much texture each point gets, 0 to 1: 0 on and next to smooth faces,
 * rising to 1 over the fade distance measured along the surface.
 */
function textureWeights(
  mesh: IndexedMesh,
  normals: Float32Array,
  adjacency: ReturnType<typeof vertexFaces>,
  smoothBottomDeg: number,
  keepEdges: boolean,
  fade: number,
  smoothFaces: Uint8Array,
  contact: ContactSurface | null,
): Float32Array {
  const { positions: p, indices } = mesh;
  const vertexCount = p.length / 3;
  const distance = new Float64Array(vertexCount).fill(Infinity);
  const weights = new Float32Array(vertexCount).fill(1);
  if (smoothBottomDeg <= 0 && !keepEdges && !contact && !smoothFaces.includes(1)) return weights;
  const downLimit = smoothBottomDeg > 0 ? -Math.cos((smoothBottomDeg * Math.PI) / 180) : -2;
  const heap: number[] = [];
  const heapDistance: number[] = [];
  const pushHeap = (vertex: number, d: number) => {
    heap.push(vertex);
    heapDistance.push(d);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapDistance[parent] <= heapDistance[i]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      [heapDistance[parent], heapDistance[i]] = [heapDistance[i], heapDistance[parent]];
      i = parent;
    }
  };
  const popHeap = () => {
    const top = heap[0];
    const topDistance = heapDistance[0];
    const lastVertex = heap.pop()!;
    const lastDistance = heapDistance.pop()!;
    if (heap.length > 0) {
      heap[0] = lastVertex;
      heapDistance[0] = lastDistance;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < heap.length && heapDistance[left] < heapDistance[smallest]) smallest = left;
        if (right < heap.length && heapDistance[right] < heapDistance[smallest]) smallest = right;
        if (smallest === i) break;
        [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
        [heapDistance[smallest], heapDistance[i]] = [heapDistance[i], heapDistance[smallest]];
        i = smallest;
      }
    }
    return [top, topDistance] as const;
  };

  const seed = (v: number) => {
    if (distance[v] === 0) return;
    distance[v] = 0;
    pushHeap(v, 0);
  };
  for (let f = 0; f < indices.length / 3; f += 1) {
    if (normals[f * 3 + 1] > downLimit && !smoothFaces[f]) continue;
    for (let k = 0; k < 3; k += 1) seed(indices[f * 3 + k]);
  }
  if (contact) {
    for (let v = 0; v < vertexCount; v += 1) {
      if (distance[v] === 0) continue;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = adjacency.start[v]; i < adjacency.start[v + 1]; i += 1) {
        const f = adjacency.faces[i];
        nx += normals[f * 3];
        ny += normals[f * 3 + 1];
        nz += normals[f * 3 + 2];
      }
      const length = Math.hypot(nx, ny, nz);
      if (length > 0 && contact.near(p[v * 3], p[v * 3 + 1], p[v * 3 + 2], nx / length, ny / length, nz / length)) seed(v);
    }
  }
  if (keepEdges) {
    // A point on a sharp edge has two touching faces that turn away from each other.
    for (let v = 0; v < vertexCount; v += 1) {
      if (distance[v] === 0) continue;
      const first = adjacency.start[v];
      const last = adjacency.start[v + 1];
      let sharp = false;
      for (let i = first; i < last && !sharp; i += 1) {
        const f = adjacency.faces[i];
        for (let j = i + 1; j < last; j += 1) {
          const g = adjacency.faces[j];
          if (normals[f * 3] * normals[g * 3] + normals[f * 3 + 1] * normals[g * 3 + 1] + normals[f * 3 + 2] * normals[g * 3 + 2] < CREASE_DOT) {
            sharp = true;
            break;
          }
        }
      }
      if (sharp) seed(v);
    }
  }
  const reach = Math.max(fade, 0);
  while (heap.length > 0) {
    const [v, d] = popHeap();
    if (d > distance[v] || d >= reach) continue;
    for (let i = adjacency.start[v]; i < adjacency.start[v + 1]; i += 1) {
      const f = adjacency.faces[i];
      for (let k = 0; k < 3; k += 1) {
        const w = indices[f * 3 + k];
        if (w === v) continue;
        const next = d + Math.hypot(p[w * 3] - p[v * 3], p[w * 3 + 1] - p[v * 3 + 1], p[w * 3 + 2] - p[v * 3 + 2]);
        if (next < distance[w]) {
          distance[w] = next;
          pushHeap(w, next);
        }
      }
    }
  }
  for (let v = 0; v < vertexCount; v += 1) {
    const d = distance[v];
    if (d === 0) weights[v] = 0;
    else if (d < reach) weights[v] = smoothstep(0, reach, d);
  }
  return weights;
}

/** Solves (A + εI) x = b for a symmetric 3×3 A. */
function solve3(m: number[], b: Vec): Vec | null {
  const [a, bb, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  return [
    (b[0] * (e * i - f * h) - bb * (b[1] * i - f * b[2]) + c * (b[1] * h - e * b[2])) / det,
    (a * (b[1] * i - f * b[2]) - b[0] * (d * i - f * g) + c * (d * b[2] - b[1] * g)) / det,
    (a * (e * b[2] - b[1] * h) - bb * (d * b[2] - b[1] * g) + b[0] * (d * h - e * g)) / det,
  ];
}

function displace(
  mesh: IndexedMesh,
  texture: SurfaceTexture,
  heightAt: HeightAt,
  bedY: number,
  smoothFaces: Uint8Array,
  contact: ContactSurface | null,
): Float32Array {
  const { positions: p, indices } = mesh;
  const vertexCount = p.length / 3;
  const { normals, areas } = faceNormals(mesh);
  const adjacency = vertexFaces(indices, vertexCount);
  const weights = textureWeights(mesh, normals, adjacency, texture.smoothBottomDeg, texture.keepEdges, texture.fade, smoothFaces, contact);
  const out = new Float32Array(p);
  const moveFor = (h: number) => (texture.direction === "out" ? texture.depth * h : -texture.depth * (1 - h));

  const groupNormals: number[] = [];
  for (let v = 0; v < vertexCount; v += 1) {
    const weight = weights[v];
    if (weight <= 0) continue;
    const x = p[v * 3];
    const y = p[v * 3 + 1];
    const z = p[v * 3 + 2];

    // Group the touching faces by direction; one group is a smooth spot, more is a sharp edge or corner.
    groupNormals.length = 0;
    for (let i = adjacency.start[v]; i < adjacency.start[v + 1]; i += 1) {
      const f = adjacency.faces[i];
      const nx = normals[f * 3];
      const ny = normals[f * 3 + 1];
      const nz = normals[f * 3 + 2];
      const area = areas[f];
      let joined = false;
      for (let g = 0; g < groupNormals.length; g += 3) {
        const gx = groupNormals[g];
        const gy = groupNormals[g + 1];
        const gz = groupNormals[g + 2];
        const length = Math.hypot(gx, gy, gz) || 1;
        if ((gx * nx + gy * ny + gz * nz) / length >= GROUP_DOT) {
          groupNormals[g] += nx * area;
          groupNormals[g + 1] += ny * area;
          groupNormals[g + 2] += nz * area;
          joined = true;
          break;
        }
      }
      if (!joined) groupNormals.push(nx * area, ny * area, nz * area);
    }
    const groups: Vec[] = [];
    for (let g = 0; g < groupNormals.length; g += 3) {
      const length = Math.hypot(groupNormals[g], groupNormals[g + 1], groupNormals[g + 2]);
      if (length > 0) groups.push([groupNormals[g] / length, groupNormals[g + 1] / length, groupNormals[g + 2] / length]);
    }
    if (groups.length === 0) continue;

    let sharp = false;
    for (let a = 0; a < groups.length && !sharp; a += 1) {
      for (let b = a + 1; b < groups.length; b += 1) {
        if (groups[a][0] * groups[b][0] + groups[a][1] * groups[b][1] + groups[a][2] * groups[b][2] < CREASE_DOT) {
          sharp = true;
          break;
        }
      }
    }

    let dx: number;
    let dy: number;
    let dz: number;
    if (!sharp) {
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let g = 0; g < groupNormals.length; g += 3) {
        nx += groupNormals[g];
        ny += groupNormals[g + 1];
        nz += groupNormals[g + 2];
      }
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      const move = moveFor(heightAt(x, y, z, nx, ny, nz)) * weight;
      dx = nx * move;
      dy = ny * move;
      dz = nz * move;
    } else {
      // A sharp edge: each face's own height, and the point goes where the moved faces meet.
      const moves = groups.map((n) => moveFor(heightAt(x, y, z, n[0], n[1], n[2])) * weight);
      const largest = moves.reduce((max, m) => Math.max(max, Math.abs(m)), 0);
      let ax = 0;
      let ay = 0;
      let az = 0;
      groups.forEach((n) => {
        ax += n[0];
        ay += n[1];
        az += n[2];
      });
      const meanLength = Math.hypot(ax, ay, az) || 1;
      const mean = moves.reduce((sum, m) => sum + m, 0) / moves.length;
      const guess: Vec = [(ax / meanLength) * mean, (ay / meanLength) * mean, (az / meanLength) * mean];
      const eps = 0.01;
      const m = [eps, 0, 0, 0, eps, 0, 0, 0, eps];
      const rhs: Vec = [guess[0] * eps, guess[1] * eps, guess[2] * eps];
      groups.forEach((n, index) => {
        for (let r = 0; r < 3; r += 1) {
          for (let c = 0; c < 3; c += 1) m[r * 3 + c] += n[r] * n[c];
          rhs[r] += n[r] * moves[index];
        }
      });
      const solved = solve3(m, rhs) ?? guess;
      const length = Math.hypot(solved[0], solved[1], solved[2]);
      const cap = 2 * largest;
      const scale = length > cap && length > 0 ? cap / length : 1;
      dx = solved[0] * scale;
      dy = solved[1] * scale;
      dz = solved[2] * scale;
    }
    out[v * 3] = x + dx;
    // Nothing goes below the bed.
    out[v * 3 + 1] = Math.max(bedY, y + dy);
    out[v * 3 + 2] = z + dz;
  }
  return out;
}

/**
 * Trimming can fold a thin spot into two triangles lying back to back on the
 * same three points. They enclose nothing, so drop both.
 */
function withoutFlaps(indices: Uint32Array): Uint32Array {
  const seen = new Map<string, number[]>();
  for (let t = 0; t < indices.length; t += 3) {
    const key = [indices[t], indices[t + 1], indices[t + 2]].sort((a, b) => a - b).join(",");
    const list = seen.get(key);
    if (list) list.push(t);
    else seen.set(key, [t]);
  }
  const drop = new Set<number>();
  seen.forEach((list) => {
    if (list.length >= 2) list.forEach((t) => drop.add(t));
  });
  if (drop.size === 0) return indices;
  const kept: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    if (!drop.has(t)) kept.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  return new Uint32Array(kept);
}

/** Drops unused points after trimming, keeping order. */
function compact(mesh: BuiltMesh, indices: Uint32Array): BuiltMesh {
  const { positions, basePositions } = mesh;
  const remap = new Int32Array(positions.length / 3).fill(-1);
  const kept: number[] = [];
  const keptBase: number[] = [];
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i += 1) {
    const v = indices[i];
    if (remap[v] < 0) {
      remap[v] = kept.length / 3;
      kept.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      keptBase.push(basePositions[v * 3], basePositions[v * 3 + 1], basePositions[v * 3 + 2]);
    }
    out[i] = remap[v];
  }
  return { positions: new Float32Array(kept), indices: out, basePositions: new Float32Array(keptBase) };
}

/** What both the build and the quick preview need: the welded body, which faces stay smooth, and how the pattern is laid on. */
function prepareSurface(
  source: { positions: ArrayLike<number>; indices?: ArrayLike<number> },
  texture: SurfaceTexture,
  options: Pick<SurfaceTextureOptions, "contacts" | "sideDirections" | "partAxes">,
) {
  const contacts = options.contacts;
  const base = weldTriangles(source.positions, source.indices);
  const box = bounds(base.positions);
  const { normals, areas } = faceNormals(base);

  // Faces that stay smooth get no detail of their own: the bottom, faces left out, round holes,
  // and faces pressed flat against another part.
  const directions = options.sideDirections ?? texture.sides.map((side) => SIDE_DIRECTIONS[side]);
  const baseMask = smoothFaceMask(base, normals, areas, { ...texture, directions });
  if (texture.smoothBottomDeg > 0) {
    const downLimit = -Math.cos((texture.smoothBottomDeg * Math.PI) / 180);
    for (let t = 0; t < baseMask.length; t += 1) if (normals[t * 3 + 1] <= downLimit) baseMask[t] = 1;
  }
  const contact = texture.smoothContacts && contacts?.length ? contactSurface(contacts) : null;
  if (contact) {
    const p = base.positions;
    for (let t = 0; t < baseMask.length; t += 1) {
      if (baseMask[t]) continue;
      const n = [normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]] as const;
      const corners = [base.indices[t * 3] * 3, base.indices[t * 3 + 1] * 3, base.indices[t * 3 + 2] * 3];
      const touching = corners.every((v) => contact.near(p[v], p[v + 1], p[v + 2], n[0], n[1], n[2]))
        && contact.near(
          (p[corners[0]] + p[corners[1]] + p[corners[2]]) / 3,
          (p[corners[0] + 1] + p[corners[1] + 1] + p[corners[2] + 1]) / 3,
          (p[corners[0] + 2] + p[corners[1] + 2] + p[corners[2] + 2]) / 3,
          n[0], n[1], n[2],
        );
      if (touching) baseMask[t] = 1;
    }
  }

  let wrap: "around" | "allRound" = texture.wrap === "auto" ? "allRound" : texture.wrap;
  if (texture.wrap === "auto") {
    // Judge on evenly sized triangles: a box's few big side triangles have centres that look round.
    const size = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    const even = subdivideToEdgeLength(base, size / 24, 60_000);
    const evenFaces = faceNormals(even);
    if (isRoundAroundY(even, box.center, evenFaces.normals, evenFaces.areas)) wrap = "around";
  }
  let repeatsAround: number | null = null;
  let spacingAround: number | null = null;
  if (wrap === "around") {
    const radius = sideRadius(base, box.center, normals, areas)
      || Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2]) / 2;
    const circumference = 2 * Math.PI * radius;
    repeatsAround = Math.max(3, Math.round(circumference / texture.spacing));
    spacingAround = circumference / repeatsAround;
  }
  const circumference = repeatsAround && spacingAround ? repeatsAround * spacingAround : null;
  // A picture on each face: worked out once from the body, before any splitting.
  const eachFace = texture.pattern === "image" && texture.placement === "each"
    ? eachFaceStamps(base, normals, areas, {
      faces: texture.faces,
      picks: texture.picks,
      directions,
      axes: options.partAxes ?? Object.values(SIDE_DIRECTIONS),
    })
    : [];
  return { base, box, normals, areas, baseMask, contact, wrap, repeatsAround, spacingAround, circumference, eachFace };
}

/** How the pattern is laid on a part, for drawing it without building it. */
export type SurfaceTextureLayout = {
  wrap: "around" | "allRound";
  center: Vec;
  repeatsAround: number;
  spacingAround: number;
  /** Around a round part, the distance once round its side, in mm. */
  circumference: number | null;
  /** Where a picture goes on each face, when it is placed on each face. */
  eachFace: PlacedStamp[];
};

/**
 * The plain body ready to be shaded with the pattern while the real texture builds:
 * every triangle on its own, with normals that stay sharp at creases, and 1 on
 * the corners of faces that stay smooth.
 */
export type SurfaceTexturePreview = {
  positions: Float32Array;
  normals: Float32Array;
  smooth: Float32Array;
  layout: SurfaceTextureLayout;
};

export function surfaceTexturePreview(
  source: { positions: ArrayLike<number>; indices?: ArrayLike<number> },
  settings: Partial<SurfaceTexture>,
  options: Pick<SurfaceTextureOptions, "contacts" | "sideDirections" | "partAxes"> = {},
): SurfaceTexturePreview {
  const texture = normalizeSurfaceTexture(settings);
  const prepared = prepareSurface(source, texture, options);
  const { base, normals, areas, baseMask } = prepared;
  const triangles = base.indices.length / 3;
  const adjacency = vertexFaces(base.indices, base.positions.length / 3);
  const positions = new Float32Array(triangles * 9);
  const cornerNormals = new Float32Array(triangles * 9);
  const smooth = new Float32Array(triangles * 3);
  for (let t = 0; t < triangles; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const v = base.indices[t * 3 + k];
      const o = (t * 3 + k) * 3;
      positions[o] = base.positions[v * 3];
      positions[o + 1] = base.positions[v * 3 + 1];
      positions[o + 2] = base.positions[v * 3 + 2];
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = adjacency.start[v]; i < adjacency.start[v + 1]; i += 1) {
        const f = adjacency.faces[i];
        if (normals[f * 3] * normals[t * 3] + normals[f * 3 + 1] * normals[t * 3 + 1] + normals[f * 3 + 2] * normals[t * 3 + 2] < GROUP_DOT) continue;
        nx += normals[f * 3] * areas[f];
        ny += normals[f * 3 + 1] * areas[f];
        nz += normals[f * 3 + 2] * areas[f];
      }
      const length = Math.hypot(nx, ny, nz) || 1;
      cornerNormals[o] = nx / length;
      cornerNormals[o + 1] = ny / length;
      cornerNormals[o + 2] = nz / length;
      smooth[t * 3 + k] = baseMask[t];
    }
  }
  return {
    positions,
    normals: cornerNormals,
    smooth,
    layout: {
      wrap: prepared.wrap,
      center: prepared.box.center,
      repeatsAround: prepared.repeatsAround ?? 1,
      spacingAround: prepared.spacingAround ?? texture.spacing,
      circumference: prepared.circumference,
      eachFace: prepared.eachFace,
    },
  };
}

export async function applySurfaceTexture(
  source: { positions: ArrayLike<number>; indices?: ArrayLike<number> },
  settings: Partial<SurfaceTexture>,
  options: SurfaceTextureOptions = {},
): Promise<SurfaceTextureResult> {
  const texture = normalizeSurfaceTexture(settings);
  const level = DETAIL_LEVELS[texture.detail];
  const workingTriangles = options.workingTriangles ?? level.working;
  const maxTriangles = options.maxTriangles ?? level.max;
  // A rebuild runs the stages again; the bar never goes back.
  let shown = 0;
  const progress = (stage: SurfaceTextureStage, within = 0) => {
    const [from, to] = STAGE_SPAN[stage];
    const share = from + (to - from) * Math.min(1, Math.max(0, within));
    if (share <= shown) return;
    shown = share;
    options.onProgress?.(share, stage);
  };
  progress("prepare");
  const { base, box, areas, baseMask, contact, wrap, repeatsAround, spacingAround, eachFace } = prepareSurface(source, texture, options);

  // A coarse even grid, about four points per repeat; edges where the pattern rises or falls
  // then split down to a sixteenth of a repeat. Fuzzy grain changes everywhere, so it starts finer.
  const repeat = Math.min(texture.spacing, spacingAround ?? texture.spacing);
  const perRepeat = texture.pattern === "fuzzy" ? 3 : 4;
  let edge = Math.max(level.floor, repeat / perRepeat);
  const firstEdge = edge;
  const detailShare = (texture.pattern === "fuzzy" ? 1 / 2 : 1 / 4) * level.share;
  // A picture's detail is its pixels: edges may split down to one pixel (finer at the finer
  // levels), so every copy and every letter is traced the same, sharply. It stops at the
  // level's smallest edge.
  const pixelMm = texture.pattern === "image" && texture.image ? texture.spacing / texture.image.width : null;
  const minEdgeFor = (edgeMm: number) => {
    const floor = level.floor * 0.6;
    const usual = edgeMm * detailShare;
    if (pixelMm === null) return Math.max(floor, usual);
    // A coarser rebuild coarsens the pixels with it.
    // Finer levels go below a pixel, which smooths curves and slants between pixels.
    return Math.max(floor, Math.min(usual, pixelMm * level.share * (edgeMm / firstEdge)));
  };
  // Sharp picture edges need every last split, however few: a logo may be a small part of a big part.
  const tailShare = pixelMm === null ? level.tail : 0;
  // Finer levels also follow the pattern more closely between points.
  const detailTolerance = (DETAIL_TOLERANCE_MM * level.share) / texture.depth;
  let coarser = false;
  let area = 0;
  for (let t = 0; t < baseMask.length; t += 1) if (!baseMask[t]) area += areas[t];
  const triangleArea = (edge * edge * Math.sqrt(3)) / 4;
  // Splitting halves edges, so the real count lands between a quarter and the full estimate; plan for the full one.
  if (area / triangleArea > workingTriangles) {
    edge = Math.sqrt((area / workingTriangles) * 4 / Math.sqrt(3));
    coarser = true;
  }
  const heightAt = heightSampler(texture, wrap, box.center, repeatsAround ?? 1, spacingAround ?? texture.spacing, eachFace);
  const build = (edgeMm: number, cap: number) => {
    // A point is read once per facing it is seen with. Most points sit on one smooth face; a point
    // on a sharp edge is read again for each side, so each side gets its own pattern.
    const seenNormal: number[] = [];
    const seenHeight: number[] = [];
    const cachedHeight = (v: number, nx: number, ny: number, nz: number, p: ArrayLike<number>) => {
      const h = seenHeight[v];
      if (h !== undefined && seenNormal[v * 3] * nx + seenNormal[v * 3 + 1] * ny + seenNormal[v * 3 + 2] * nz > SAME_FACING_DOT) return h;
      const next = heightAt(p[v * 3], p[v * 3 + 1], p[v * 3 + 2], nx, ny, nz);
      seenNormal[v * 3] = nx;
      seenNormal[v * 3 + 1] = ny;
      seenNormal[v * 3 + 2] = nz;
      seenHeight[v] = next;
      return next;
    };
    // An even grid first, with flat wedges (a cylinder's cap) evened out by flips…
    progress("grid");
    const even = flipFlatSlivers(subdivideToEdgeLength(base, edgeMm, cap, { frozen: baseMask }));
    progress("detail");
    const evenMask = new Uint8Array(even.parents.length);
    for (let t = 0; t < evenMask.length; t += 1) evenMask[t] = baseMask[even.parents[t]];
    // …then extra points only where the texture rises or falls, so flat parts of the pattern stay light.
    // The height is read the way the move will read it: with the facing of the triangle it sits on.
    const refined = subdivideToEdgeLength(even, edgeMm, cap, {
      minEdge: minEdgeFor(edgeMm),
      frozen: evenMask,
      tailShare,
      // The number of passes is not known ahead; each one does less than the last.
      onPass: (pass) => progress("detail", 1 - 0.8 ** (pass + 1)),
      // Split where a straight edge cannot follow the pattern: on a ridge, in a valley, round a curve.
      // A plain slope needs no more points, however steep.
      split: (a, b, nx, ny, nz, p) => {
        const mid = heightAt(
          (p[a * 3] + p[b * 3]) / 2, (p[a * 3 + 1] + p[b * 3 + 1]) / 2, (p[a * 3 + 2] + p[b * 3 + 2]) / 2,
          nx, ny, nz,
        );
        return Math.abs(mid - (cachedHeight(a, nx, ny, nz, p) + cachedHeight(b, nx, ny, nz, p)) / 2) > detailTolerance;
      },
    });
    if (refined.capped) coarser = true;
    progress("align");
    const fineMask = new Uint8Array(refined.parents.length);
    for (let t = 0; t < fineMask.length; t += 1) fineMask[t] = evenMask[refined.parents[t]];
    // Flips keep each triangle's place in the list, so the mask still lines up after them.
    const aligned = flipTowardPattern(refined, heightAt, 4, fineMask);
    progress("displace");
    return { positions: displace(aligned, texture, heightAt, box.min[1], fineMask, contact), indices: aligned.indices, basePositions: aligned.positions } as BuiltMesh;
  };

  let result = build(edge, workingTriangles);
  progress("trim");
  const triangles = result.indices.length / 3;
  // A little over the budget is not worth a second build.
  if (triangles > maxTriangles * BUDGET_SLACK) {
    // Trim where the texture is flat. A trim can pinch a thin spot shut; try a few nearby budgets, then build coarser.
    await MeshoptSimplifier.ready;
    let trimmed: BuiltMesh | null = null;
    for (const share of [1, 0.96, 0.92, 0.88]) {
      const [simplified] = MeshoptSimplifier.simplify(
        result.indices,
        result.positions,
        3,
        Math.floor(maxTriangles * share) * 3,
        Math.max(0.005, texture.depth * 0.04),
        ["ErrorAbsolute"],
      );
      if (simplified.length < 3) continue;
      const candidate = compact(result, withoutFlaps(simplified));
      if (candidate.indices.length / 3 <= maxTriangles && openEdgeCount(candidate.indices) === 0) {
        trimmed = candidate;
        break;
      }
    }
    if (trimmed) {
      result = trimmed;
    } else {
      // Build again with every edge longer, never stopping part way through, so the detail stays even.
      coarser = true;
      let scale = Math.sqrt(triangles / maxTriangles) * 1.05;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        result = build(edge * scale, workingTriangles);
        const count = result.indices.length / 3;
        if (count <= maxTriangles) break;
        scale *= Math.sqrt(count / maxTriangles) * 1.05;
      }
    }
  }

  progress("trim", 1);
  return {
    ...result,
    stats: {
      wrap,
      repeatsAround,
      spacingAround,
      triangles: result.indices.length / 3,
      coarser,
    },
  };
}
