import { applySurfaceTexture, type SurfaceTextureOptions, type SurfaceTextureResult } from "./textureApply";
import type { SurfaceTexture } from "./surfaceTexture";

export type SurfaceTextureWorkerRequest = {
  requestId: number;
  positions: Float32Array;
  indices: Uint32Array;
  texture: Partial<SurfaceTexture>;
  options?: Omit<SurfaceTextureOptions, "onProgress">;
};
export type SurfaceTextureWorkerResponse =
  | { requestId: number; type: "progress"; value: number }
  | { requestId: number; type: "result"; value: SurfaceTextureResult }
  | { requestId: number; type: "error"; message: string };

type Pending = {
  resolve: (value: SurfaceTextureResult) => void;
  reject: (error: Error) => void;
  onProgress?: (share: number) => void;
};

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, Pending>();

function recycleWorker() {
  worker?.terminate();
  worker = null;
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  worker = new Worker(new URL("../../workers/surfaceTexture.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<SurfaceTextureWorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.requestId);
    if (!entry) return;
    if (message.type === "progress") {
      entry.onProgress?.(message.value);
      return;
    }
    pending.delete(message.requestId);
    if (message.type === "error") entry.reject(new Error(message.message));
    else entry.resolve(message.value);
  };
  worker.onerror = () => {
    const waiting = [...pending.values()];
    pending.clear();
    recycleWorker();
    waiting.forEach((entry) => entry.reject(new Error("Surface texture stopped")));
  };
  return worker;
}

/** Builds the textured triangles off the main thread, so the app stays smooth while it works. */
export function textureSurfaceOffThread(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | undefined,
  texture: Partial<SurfaceTexture>,
  options?: SurfaceTextureOptions,
): Promise<SurfaceTextureResult> {
  const target = ensureWorker();
  if (!target) return applySurfaceTexture({ positions, indices }, texture, options);
  const { onProgress, ...rest } = options ?? {};
  const requestId = nextRequestId++;
  const request: SurfaceTextureWorkerRequest = {
    requestId,
    positions: Float32Array.from(positions),
    indices: indices ? Uint32Array.from(indices) : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i),
    texture,
    options: rest,
  };
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject, onProgress: onProgress ? (share) => onProgress(share, "detail") : undefined });
    target.postMessage(request, [request.positions.buffer, request.indices.buffer]);
  });
}
