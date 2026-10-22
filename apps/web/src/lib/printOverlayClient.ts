import { cadModifierRequestTimeoutMs } from "@/lib/cadModifierRuntime";
import { collectPrintOverlayMarks, type PrintOverlayCollectRequest, type PrintOverlayMarks } from "@/lib/printOverlayCollect";
import { requestNativeKernelJob, toNativeKernelSolids } from "@/lib/nativeKernelProtocol";

type WorkerRequest = PrintOverlayCollectRequest & { requestId: number };
type WorkerResponse =
  | { requestId: number; type: "result"; value: PrintOverlayMarks }
  | { requestId: number; type: "error"; message: string };

type Pending = {
  resolve: (value: PrintOverlayMarks | null) => void;
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

async function tryNativePrintOverlay(request: PrintOverlayCollectRequest): Promise<PrintOverlayMarks | null> {
  if (!request.shapes?.length) return null;
  const solids = toNativeKernelSolids(request.shapes.filter((shape) => !shape.hidden && !shape.construction));
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

export async function runPrintOverlayInWorker(request: PrintOverlayCollectRequest): Promise<PrintOverlayMarks | null> {
  const native = await tryNativePrintOverlay(request);
  if (native) return native;
  if (typeof window === "undefined") {
    return collectPrintOverlayMarks(request);
  }
  try {
    const active = ensureWorker();
    const requestId = nextRequestId;
    nextRequestId += 1;
    return new Promise((resolve) => {
      pending.set(requestId, { resolve });
      try {
        active.postMessage({ ...request, requestId } satisfies WorkerRequest);
      } catch {
        settle(requestId, null);
        recycleWorker();
      }
    });
  } catch {
    return Promise.resolve(collectPrintOverlayMarks(request));
  }
}
