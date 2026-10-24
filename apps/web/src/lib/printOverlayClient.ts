import { cadModifierRequestTimeoutMs } from "@/lib/cadModifierRuntime";
import { collectPrintOverlayMarks, type PrintOverlayCollectRequest, type PrintOverlayMarks } from "@/lib/printOverlayCollect";
import { requestNativeKernelJob, toNativeKernelSolids } from "@/lib/nativeKernelProtocol";
import { triangleCount, triangleSoupOf, type TriangleSource } from "@/lib/meshPickBvh";
import type { WorkplaneShape } from "@/types/sketchforge";

export type PrintOverlayWorkerRequest = Omit<PrintOverlayCollectRequest, "triangles"> & {
  requestId: number;
  triangles: Float64Array;
};
export type PrintOverlayWorkerResponse =
  | { requestId: number; type: "result"; value: PrintOverlayMarks }
  | { requestId: number; type: "error"; message: string };

type Pending = {
  resolve: (value: PrintOverlayMarks | null) => void;
};

export type PrintOverlayClientRequest = Omit<PrintOverlayCollectRequest, "triangles"> & {
  triangles?: TriangleSource;
  collectTriangles?: () => TriangleSource;
};

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, Pending>();

function settle(requestId: number, value: PrintOverlayMarks | null) {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  entry.resolve(value);
}

function recycleWorker() {
  worker?.terminate();
  worker = null;
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/printOverlay.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<PrintOverlayWorkerResponse>) => {
    const message = event.data;
    settle(message.requestId, message.type === "error" ? null : message.value);
  };
  worker.onerror = () => {
    for (const requestId of [...pending.keys()]) settle(requestId, null);
    recycleWorker();
  };
  return worker;
}

function numbersFrom(value: unknown): Float32Array {
  if (!Array.isArray(value)) return new Float32Array(0);
  const out = new Float32Array(value.length);
  let length = 0;
  for (const entry of value) {
    if (typeof entry === "number") {
      out[length] = entry;
      length += 1;
    }
  }
  return length === out.length ? out : out.subarray(0, length);
}

function visiblePrintShapes(shapes: WorkplaneShape[] | undefined) {
  return (shapes ?? []).filter((shape) => !shape.hidden && !shape.construction && !shape.suppressed && !shape.csg?.suppressed);
}

/** True when every visible body can go to MintrKernel — skip the mesh worker on a native hit. */
export function printOverlayAllCadReady(shapes: WorkplaneShape[] | undefined) {
  const visible = visiblePrintShapes(shapes);
  return visible.length > 0 && toNativeKernelSolids(visible) !== null;
}

async function tryNativePrintOverlay(request: PrintOverlayClientRequest): Promise<PrintOverlayMarks | null> {
  const visible = visiblePrintShapes(request.shapes);
  if (!visible.length) return null;
  const solids = toNativeKernelSolids(visible);
  if (!solids?.length) return null;
  const reply = await requestNativeKernelJob({
    id: Date.now(),
    type: "printOverlay",
    solids,
    overhang: request.overhang,
    angle: request.angle,
    thinWalls: request.thinWalls,
    smallHoles: request.smallHoles,
    trappedResin: request.trappedResin,
    nozzleMm: request.nozzleMm,
  }, cadModifierRequestTimeoutMs());
  if (!reply || reply.ok === false || reply.fallback) return null;
  return {
    overhangPositions: numbersFrom(reply.overhangPositions),
    overhangNormals: numbersFrom(reply.overhangNormals),
    thinPositions: numbersFrom(reply.thinPositions),
    thinNormals: numbersFrom(reply.thinNormals),
    holePositions: numbersFrom(reply.holePositions),
    holeNormals: numbersFrom(reply.holeNormals),
    trappedPositions: numbersFrom(reply.trappedPositions),
    trappedNormals: numbersFrom(reply.trappedNormals),
  };
}

export function collectPrintOverlayMarksSync(request: PrintOverlayCollectRequest): PrintOverlayMarks {
  return collectPrintOverlayMarks(request);
}

export async function runPrintOverlayInWorker(request: PrintOverlayClientRequest): Promise<PrintOverlayMarks | null> {
  const native = await tryNativePrintOverlay(request);
  if (native) return native;
  const provided = request.triangles;
  const source: TriangleSource = provided && triangleCount(provided) > 0
    ? provided
    : (request.collectTriangles?.() ?? new Float64Array(0));
  // One flat buffer, transferred (not cloned) to the worker. Posting an array
  // of per-triangle objects serialised every field on the main thread and
  // stalled the viewport for up to a second on dense imports.
  const triangles = triangleSoupOf(source);
  const meshRequest: PrintOverlayCollectRequest = {
    triangles,
    overhang: request.overhang,
    angle: request.angle,
    thinWalls: request.thinWalls,
    smallHoles: request.smallHoles,
    trappedResin: request.trappedResin,
    nozzleMm: request.nozzleMm,
    // The mesh path only reads triangles; cloning every shape (imported meshes
    // included) into the worker on each overlay refresh was the slowest step.
  };
  if (typeof window === "undefined") {
    return collectPrintOverlayMarks(meshRequest);
  }
  try {
    const active = ensureWorker();
    const requestId = nextRequestId;
    nextRequestId += 1;
    return new Promise((resolve) => {
      pending.set(requestId, { resolve });
      try {
        const message: PrintOverlayWorkerRequest = { ...meshRequest, triangles, requestId };
        // Transfer only a buffer this call produced (collected or packed here);
        // a caller-supplied Float64Array must stay usable, so it is cloned.
        const owned = triangles !== provided
          && triangles.buffer instanceof ArrayBuffer
          && triangles.byteOffset === 0
          && triangles.byteLength === triangles.buffer.byteLength;
        const transfer = owned ? [triangles.buffer] : [];
        active.postMessage(message, transfer);
      } catch {
        settle(requestId, null);
        recycleWorker();
      }
    });
  } catch {
    return Promise.resolve(collectPrintOverlayMarks(meshRequest));
  }
}
