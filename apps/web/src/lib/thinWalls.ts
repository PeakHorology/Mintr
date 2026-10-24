import {
  buildPickBvh,
  raycastPickBvh,
  readPickTriangle,
  scratchPickTriangle,
  triangleCount,
  triangleSoupOf,
  type PickBvh,
  type TriangleSource,
} from "@/lib/meshPickBvh";

export const DEFAULT_NOZZLE_MM = 0.4;
export const MIN_NOZZLE_MM = 0.2;
export const MAX_NOZZLE_MM = 1.2;

export function normalizeNozzleMm(value: unknown, fallback = DEFAULT_NOZZLE_MM) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_NOZZLE_MM, Math.min(MAX_NOZZLE_MM, Math.round(parsed * 100) / 100));
}

/** True when a measured wall or gap is thinner than the nozzle, and not just a surface graze. */
export function triangleIsThin(thickness: number, nozzleMm: number) {
  return thickness > 0.02 && thickness < nozzleMm - 1e-4;
}

/**
 * Local wall thickness: from a point on the outer skin, shoot inward and
 * measure the first hit. `inset` starts the ray just inside so it does not
 * hit the same face.
 */
export function thicknessAlongInwardRay(
  originX: number,
  originY: number,
  originZ: number,
  normalX: number,
  normalY: number,
  normalZ: number,
  bvh: PickBvh,
  nozzleMm: number,
  inset = 0.02,
) {
  const length = Math.hypot(normalX, normalY, normalZ);
  if (length < 1e-8) return null;
  const nx = normalX / length;
  const ny = normalY / length;
  const nz = normalZ / length;
  const hit = raycastPickBvh(
    bvh,
    { x: originX - nx * inset, y: originY - ny * inset, z: originZ - nz * inset },
    { x: -nx, y: -ny, z: -nz },
    true,
    nozzleMm,
  );
  if (!hit) return null;
  return hit.t + inset;
}

/** Gap across a hole or slot: shoot outward along the normal into empty space. */
export function gapAlongOutwardRay(
  originX: number,
  originY: number,
  originZ: number,
  normalX: number,
  normalY: number,
  normalZ: number,
  bvh: PickBvh,
  nozzleMm: number,
  inset = 0.02,
) {
  return thicknessAlongInwardRay(originX, originY, originZ, -normalX, -normalY, -normalZ, bvh, nozzleMm, inset);
}

export function collectThinWallTriangles(
  triangles: TriangleSource,
  nozzleMm: number,
  positions: number[],
  normals: number[],
) {
  collectNarrowTriangles(triangles, nozzleMm, positions, normals, "inward");
}

export function collectSmallHoleTriangles(
  triangles: TriangleSource,
  nozzleMm: number,
  positions: number[],
  normals: number[],
) {
  collectNarrowTriangles(triangles, nozzleMm, positions, normals, "outward");
}

function collectNarrowTriangles(
  source: TriangleSource,
  nozzleMm: number,
  positions: number[],
  normals: number[],
  direction: "inward" | "outward",
) {
  const soup = triangleSoupOf(source);
  const tree = buildPickBvh(soup);
  if (!tree) return;
  const limit = normalizeNozzleMm(nozzleMm);
  const count = triangleCount(soup);
  const tri = scratchPickTriangle();
  for (let index = 0; index < count; index += 1) {
    readPickTriangle(soup, index, tri);
    const nx = (tri.by - tri.ay) * (tri.cz - tri.az) - (tri.bz - tri.az) * (tri.cy - tri.ay);
    const ny = (tri.bz - tri.az) * (tri.cx - tri.ax) - (tri.bx - tri.ax) * (tri.cz - tri.az);
    const nz = (tri.bx - tri.ax) * (tri.cy - tri.ay) - (tri.by - tri.ay) * (tri.cx - tri.ax);
    const area = Math.hypot(nx, ny, nz);
    if (area < 1e-8) continue;
    const cx = (tri.ax + tri.bx + tri.cx) / 3;
    const cy = (tri.ay + tri.by + tri.cy) / 3;
    const cz = (tri.az + tri.bz + tri.cz) / 3;
    const span = direction === "outward"
      ? gapAlongOutwardRay(cx, cy, cz, nx, ny, nz, tree, limit)
      : thicknessAlongInwardRay(cx, cy, cz, nx, ny, nz, tree, limit);
    if (span == null || !triangleIsThin(span, limit)) continue;
    const inv = 1 / area;
    positions.push(tri.ax, tri.ay, tri.az, tri.bx, tri.by, tri.bz, tri.cx, tri.cy, tri.cz);
    normals.push(nx * inv, ny * inv, nz * inv, nx * inv, ny * inv, nz * inv, nx * inv, ny * inv, nz * inv);
  }
}
