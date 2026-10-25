import { cadModifierRequestTimeoutMs } from "@/lib/cadModifierRuntime";
import { booleanAngularDeflection } from "@/lib/displayTessellation";
import { toNativeKernelSolids, type NativeKernelJob, type NativeKernelReply } from "@/lib/nativeKernelProtocol";
import type { OcctBooleanMeshResult, StepExportResult } from "@/lib/stepExport";
import {
  applyNativeSketchSweepMesh,
  serializeSketchSweepJob,
  type SweepShapeResult,
} from "@/lib/sketchSweep";
import { applyNativeSketchExtrudeMesh, serializeSketchExtrudeJob } from "@/lib/sketchExtrusionSolid";
import { applyGridfinityKernelMesh, serializeGridfinityBuildJob } from "@/lib/gridfinityShape";
import type { SketchDoc } from "@/lib/sketch/types";
import type { SketchProfile, WorkplaneShape } from "@/types/sketchforge";

type PeakcadKernelApi = {
  ready?: () => Promise<boolean>;
  request?: (job: NativeKernelJob, timeoutMs: number) => Promise<NativeKernelReply | null>;
};

function desktopKernel(): PeakcadKernelApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { peakcadKernel?: PeakcadKernelApi }).peakcadKernel;
}

export type OcctKernelBooleanRequest = {
  type: "boolean";
  shapes: WorkplaneShape[];
  op: "subtract" | "union" | "intersect";
};

export type OcctKernelExportRequest = {
  type: "exportStep";
  shapes: WorkplaneShape[];
};

export type OcctKernelSketchExtrudeRequest = {
  type: "sketchExtrude";
  shape: WorkplaneShape;
  distance: number;
  cutIntoFace?: boolean;
};

export type OcctKernelSketchSweepRequest = {
  type: "sketchSweep";
  profile: SketchProfile;
  doc: SketchDoc | null | undefined;
  spec: NonNullable<WorkplaneShape["sketchSweep"]>;
  existing?: WorkplaneShape | null;
};

/** Build a Gridfinity bin / baseplate body (mesh + exact B-Rep) from its spec. */
export type OcctKernelGridfinityRequest = {
  type: "gridfinity";
  shape: WorkplaneShape;
};

export type OcctKernelRequest =
  | OcctKernelBooleanRequest
  | OcctKernelExportRequest
  | OcctKernelSketchExtrudeRequest
  | OcctKernelSketchSweepRequest
  | OcctKernelGridfinityRequest;

type Pending = {
  resolve: (value: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type WorkerResponse =
  | { requestId: number; type: "result"; value: unknown }
  | { requestId: number; type: "error"; message: string };

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, Pending>();
let chain: Promise<unknown> = Promise.resolve();
let lastWorkerError: string | null = null;

/**
 * Message from the most recent failed worker request, or null. The worker
 * protocol resolves failures to `null`; callers that need to tell a user *why*
 * (STEP export) read this right after a null result.
 */
export function lastOcctKernelError(): string | null {
  return lastWorkerError;
}

function settle(requestId: number, value: unknown) {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  clearTimeout(entry.timeout);
  entry.resolve(value);
}

function settleAll(value: unknown) {
  for (const requestId of [...pending.keys()]) settle(requestId, value);
}

function recycleWorker() {
  worker?.terminate();
  worker = null;
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/occtKernel.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === "error") {
      lastWorkerError = message.message || "CAD kernel failed";
      settle(message.requestId, null);
      return;
    }
    lastWorkerError = null;
    settle(message.requestId, message.value);
  };
  worker.onerror = (event) => {
    lastWorkerError = (event as ErrorEvent).message || "CAD worker crashed";
    settleAll(null);
    recycleWorker();
  };
  return worker;
}

function nativeJobFor(request: OcctKernelRequest, requestId: number): NativeKernelJob | null {
  if (request.type === "boolean") {
    const solids = toNativeKernelSolids(request.shapes);
    if (!solids) return null;
    return {
      id: requestId,
      type: "boolean",
      op: request.op,
      solids,
      angularDeflection: booleanAngularDeflection(request.shapes),
    };
  }
  if (request.type === "exportStep") {
    const solids = toNativeKernelSolids(request.shapes);
    if (!solids) return null;
    return { id: requestId, type: "exportStep", solids };
  }
  if (request.type === "sketchExtrude") {
    const payload = serializeSketchExtrudeJob(request.shape, request.distance, request.cutIntoFace);
    if (!payload) return null;
    return { id: requestId, ...payload };
  }
  if (request.type === "sketchSweep") {
    const payload = serializeSketchSweepJob(request.profile, request.doc, request.spec);
    if (!payload) return null;
    return { id: requestId, ...payload };
  }
  if (request.type === "gridfinity") {
    const payload = serializeGridfinityBuildJob(request.shape);
    if (!payload) return null;
    return { id: requestId, ...payload };
  }
  return null;
}

function nativeReplyToResult(request: OcctKernelRequest, reply: NativeKernelReply | null): unknown | null {
  if (!reply || reply.fallback || reply.ok === false) return null;
  if (request.type === "boolean") {
    if (!reply.positions || reply.positions.length < 9 || !reply.brepStep) return null;
    const normals = reply.normals && reply.normals.length === reply.positions.length ? reply.normals : undefined;
    return {
      positions: reply.positions,
      normals,
      brepStep: reply.brepStep,
      quality: reply.quality ?? "exact",
      displayEdges: reply.displayEdges,
    } satisfies OcctBooleanMeshResult;
  }
  if (request.type === "exportStep") {
    if (!reply.step) return null;
    return {
      blob: new Blob([reply.step], { type: "application/step" }),
      exportedCount: reply.exportedCount ?? 0,
      exactCount: reply.exactCount ?? 0,
      facetedCount: reply.facetedCount ?? 0,
      skipped: (reply.skipped ?? []).map((item) => ({
        name: item.name,
        kind: item.kind as WorkplaneShape["kind"],
        reason: item.reason,
      })),
      degraded: (reply.degraded ?? []).map((item) => ({
        name: item.name,
        kind: item.kind as WorkplaneShape["kind"],
        reason: item.reason,
      })),
    } satisfies StepExportResult;
  }
  if (request.type === "sketchExtrude") {
    const cadBrep = reply.cadBrep ?? reply.brep ?? "";
    if (!reply.positions || !reply.indices || !cadBrep) return null;
    return applyNativeSketchExtrudeMesh(request.shape, reply.positions, reply.normals, reply.indices, cadBrep);
  }
  if (request.type === "sketchSweep") {
    const cadBrep = reply.cadBrep ?? reply.brep ?? "";
    if (!reply.positions || !reply.indices || !cadBrep) return null;
    const shape = applyNativeSketchSweepMesh(
      request.profile,
      request.doc,
      request.spec,
      request.existing,
      reply.positions,
      reply.normals,
      reply.indices,
      cadBrep,
    );
    return shape ? ({ ok: true, shape } satisfies SweepShapeResult) : null;
  }
  if (request.type === "gridfinity") {
    const cadBrep = reply.cadBrep ?? reply.brep ?? "";
    const key = serializeGridfinityBuildJob(request.shape)?.key;
    if (!reply.positions || !reply.indices || !cadBrep || !key) return null;
    return applyGridfinityKernelMesh(request.shape, reply.positions, reply.normals, reply.indices, cadBrep, key);
  }
  return null;
}

async function tryNativeKernel(request: OcctKernelRequest, requestId: number): Promise<{ hit: boolean; value: unknown | null }> {
  const api = desktopKernel();
  if (!api?.request) return { hit: false, value: null };
  const job = nativeJobFor(request, requestId);
  if (!job) return { hit: false, value: null };
  try {
    const reply = await api.request(job, cadModifierRequestTimeoutMs());
    return { hit: true, value: nativeReplyToResult(request, reply) };
  } catch {
    return { hit: true, value: null };
  }
}

function postKernelRequest(request: OcctKernelRequest): Promise<unknown> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const job = () => new Promise((resolve) => {
    const active = ensureWorker();
    const requestId = nextRequestId;
    nextRequestId += 1;
    const timeout = setTimeout(() => {
      lastWorkerError = "CAD worker timed out";
      settle(requestId, null);
      recycleWorker();
    }, cadModifierRequestTimeoutMs());
    pending.set(requestId, { resolve, timeout });
    try {
      active.postMessage({ ...request, requestId });
    } catch {
      settle(requestId, null);
      recycleWorker();
    }
  });
  const run = chain.then(job, job);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

export async function runOcctKernelInWorker(request: OcctKernelBooleanRequest): Promise<OcctBooleanMeshResult | null>;
export async function runOcctKernelInWorker(request: OcctKernelExportRequest): Promise<StepExportResult | null>;
export async function runOcctKernelInWorker(request: OcctKernelSketchExtrudeRequest): Promise<WorkplaneShape | null>;
export async function runOcctKernelInWorker(request: OcctKernelSketchSweepRequest): Promise<SweepShapeResult | null>;
export async function runOcctKernelInWorker(request: OcctKernelGridfinityRequest): Promise<WorkplaneShape | null>;
export async function runOcctKernelInWorker(request: OcctKernelRequest): Promise<unknown> {
  const requestId = nextRequestId;
  nextRequestId += 1;
  const native = await tryNativeKernel(request, requestId);
  // A generator body has no mesh to fall back on, so a native miss still tries WASM.
  if (native.hit && (native.value !== null || request.type !== "gridfinity")) return native.value;
  return postKernelRequest(request);
}
