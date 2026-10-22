import type { PickTriangle } from "@/lib/meshPickBvh";
import { triangleNeedsSupport } from "@/lib/printerBed";
import { collectSmallHoleTriangles, collectThinWallTriangles } from "@/lib/thinWalls";
import { collectTrappedCavityTriangles } from "@/lib/trappedResin";
import type { WorkplaneShape } from "@/types/sketchforge";

export type PrintOverlayCollectRequest = {
  triangles: PickTriangle[];
  overhang: boolean;
  angle: number;
  thinWalls: boolean;
  smallHoles: boolean;
  trappedResin: boolean;
  nozzleMm: number;
  shapes?: WorkplaneShape[];
};

export type PrintOverlayMarks = {
  overhangPositions: number[];
  overhangNormals: number[];
  thinPositions: number[];
  thinNormals: number[];
  holePositions: number[];
  holeNormals: number[];
  trappedPositions: number[];
  trappedNormals: number[];
};

function collectOverhangFromTriangles(triangles: PickTriangle[], angle: number, positions: number[], normals: number[]) {
  for (const tri of triangles) {
    const nx = (tri.by - tri.ay) * (tri.cz - tri.az) - (tri.bz - tri.az) * (tri.cy - tri.ay);
    const ny = (tri.bz - tri.az) * (tri.cx - tri.ax) - (tri.bx - tri.ax) * (tri.cz - tri.az);
    const nz = (tri.bx - tri.ax) * (tri.cy - tri.ay) - (tri.by - tri.ay) * (tri.cx - tri.ax);
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-8) continue;
    const inv = 1 / length;
    const normalY = ny * inv;
    if (!triangleNeedsSupport(tri.ay, tri.by, tri.cy, normalY, angle)) continue;
    positions.push(tri.ax, tri.ay, tri.az, tri.bx, tri.by, tri.bz, tri.cx, tri.cy, tri.cz);
    normals.push(nx * inv, ny * inv, nz * inv, nx * inv, ny * inv, nz * inv, nx * inv, ny * inv, nz * inv);
  }
}

export function collectPrintOverlayMarks(request: PrintOverlayCollectRequest): PrintOverlayMarks {
  const marks: PrintOverlayMarks = {
    overhangPositions: [],
    overhangNormals: [],
    thinPositions: [],
    thinNormals: [],
    holePositions: [],
    holeNormals: [],
    trappedPositions: [],
    trappedNormals: [],
  };
  if (request.triangles.length === 0) return marks;
  if (request.overhang) {
    collectOverhangFromTriangles(request.triangles, request.angle, marks.overhangPositions, marks.overhangNormals);
  }
  if (request.thinWalls) {
    collectThinWallTriangles(request.triangles, request.nozzleMm, marks.thinPositions, marks.thinNormals);
  }
  if (request.smallHoles) {
    collectSmallHoleTriangles(request.triangles, request.nozzleMm, marks.holePositions, marks.holeNormals);
  }
  if (request.trappedResin) {
    collectTrappedCavityTriangles(request.triangles, marks.trappedPositions, marks.trappedNormals);
  }
  return marks;
}
