import { cadModifierRequestTimeoutMs } from "@/lib/cadModifierRuntime";
import { collectPrintOverlayMarks, type PrintOverlayCollectRequest, type PrintOverlayMarks } from "@/lib/printOverlayCollect";
import { requestNativeKernelJob, toNativeKernelSolids } from "@/lib/nativeKernelProtocol";
import type { PickTriangle } from "@/lib/meshPickBvh";
import type { WorkplaneShape } from "@/types/sketchforge";

type WorkerRequest = PrintOverlayCollectRequest & { requestId: number };
type WorkerResponse =
  | { requestId: number; type: "result"; value: PrintOverlayMarks }
  | { requestId: number; type: "error"; message: string };

type Pending = {
  resolve: (value: PrintOverlayMarks | null) => void;
};

export type PrintOverlayClientRequest = Omit<PrintOverlayCollectRequest, "triangles"> & {
  triangles?: PickTriangle[];
  collectTriangles?: () => PickTriangle[];
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
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    settle(message.requestId, message.type === "error" ? null : message.value);
  };
  worker.onerror = () => {
    for (const requestId of [...pending.keys()]) settle(requestId, null);
    recycleWorker();
  };
  return worker;
}

function numbersFrom(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === "number") : [];
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
  const triangles = request.triangles?.length
    ? request.triangles
    : (request.collectTriangles?.() ?? []);
  const meshRequest: PrintOverlayCollectRequest = {
    triangles,
    overhang: request.overhang,
    angle: request.angle,
    thinWalls: request.thinWalls,
    smallHoles: request.smallHoles,
    trappedResin: request.trappedResin,
    nozzleMm: request.nozzleMm,
    shapes: request.shapes,
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
        active.postMessage({ ...meshRequest, requestId } satisfies WorkerRequest);
      } catch {
        settle(requestId, null);
        recycleWorker();
      }
    });
  } catch {
    return Promise.resolve(collectPrintOverlayMarks(meshRequest));
  }
}
