import {
  readPickTriangle,
  scratchPickTriangle,
  triangleCount,
  triangleSoupOf,
  type TriangleSoup,
  type TriangleSource,
} from "@/lib/meshPickBvh";
import { triangleNeedsSupport } from "@/lib/printerBed";
import { collectSmallHoleTriangles, collectThinWallTriangles } from "@/lib/thinWalls";
import { collectTrappedCavityTriangles } from "@/lib/trappedResin";
import type { WorkplaneShape } from "@/types/sketchforge";

export type PrintOverlayCollectRequest = {
  /** Flat soup (9 numbers per triangle) or legacy object array. */
  triangles: TriangleSource;
  overhang: boolean;
  angle: number;
  thinWalls: boolean;
  smallHoles: boolean;
  trappedResin: boolean;
  nozzleMm: number;
  shapes?: WorkplaneShape[];
};

/**
 * Marks are typed arrays so the worker can transfer them back without a copy,
 * and the viewport can hand them straight to a Float32BufferAttribute.
 */
export type PrintOverlayMarks = {
  overhangPositions: Float32Array;
  overhangNormals: Float32Array;
  thinPositions: Float32Array;
  thinNormals: Float32Array;
  holePositions: Float32Array;
  holeNormals: Float32Array;
  trappedPositions: Float32Array;
  trappedNormals: Float32Array;
};

/** ArrayBuffers behind every mark, for a postMessage transfer list. */
export function printOverlayMarkBuffers(marks: PrintOverlayMarks): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const value of Object.values(marks)) {
    if (value instanceof Float32Array && value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
  }
  return [...buffers];
}

function collectOverhangFromTriangles(soup: TriangleSoup, angle: number, positions: number[], normals: number[]) {
  const count = triangleCount(soup);
  const tri = scratchPickTriangle();
  for (let index = 0; index < count; index += 1) {
    readPickTriangle(soup, index, tri);
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

// A fresh array each time: the worker transfers these buffers, and a shared
// empty one would be detached after the first reply.
function pack(values: number[]) {
  return Float32Array.from(values);
}

export function collectPrintOverlayMarks(request: PrintOverlayCollectRequest): PrintOverlayMarks {
  const overhangPositions: number[] = [];
  const overhangNormals: number[] = [];
  const thinPositions: number[] = [];
  const thinNormals: number[] = [];
  const holePositions: number[] = [];
  const holeNormals: number[] = [];
  const trappedPositions: number[] = [];
  const trappedNormals: number[] = [];
  const soup = triangleSoupOf(request.triangles);
  if (triangleCount(soup) > 0) {
    if (request.overhang) {
      collectOverhangFromTriangles(soup, request.angle, overhangPositions, overhangNormals);
    }
    if (request.thinWalls) {
      collectThinWallTriangles(soup, request.nozzleMm, thinPositions, thinNormals);
    }
    if (request.smallHoles) {
      collectSmallHoleTriangles(soup, request.nozzleMm, holePositions, holeNormals);
    }
    if (request.trappedResin) {
      collectTrappedCavityTriangles(soup, trappedPositions, trappedNormals);
    }
  }
  return {
    overhangPositions: pack(overhangPositions),
    overhangNormals: pack(overhangNormals),
    thinPositions: pack(thinPositions),
    thinNormals: pack(thinNormals),
    holePositions: pack(holePositions),
    holeNormals: pack(holeNormals),
    trappedPositions: pack(trappedPositions),
    trappedNormals: pack(trappedNormals),
  };
}
