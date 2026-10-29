import type { NativeKernelJob, NativeKernelReply } from "@/lib/nativeKernelProtocol";
import type { MintrKernelWorkerResponse } from "@/workers/mintrKernel.worker";

/**
 * The desktop engine's C++, run in the browser as WebAssembly. It answers the same
 * `peakcadKernel.request` calls as the desktop app's engine, so callers that already try
 * the desktop engine first get it in the browser too. A null answer means "use the
 * browser code instead": the engine files are missing, it crashed, or it timed out.
 */
export type BrowserKernelApi = {
  request: (job: NativeKernelJob, timeoutMs: number) => Promise<NativeKernelReply | null>;
};

type Pending = {
  resolve: (reply: NativeKernelReply | null) => void;
  timeout: ReturnType<typeof setTimeout>;
};

/** A crash gets a fresh engine this many times; after that the session uses the browser code. */
const MAX_RESTARTS = 2;

let worker: Worker | null = null;
let disabled = false;
let restarts = 0;
/** The engine answered at least once, so a later failure is a crash, not missing files. */
let loadedOnce = false;
let nextRequestId = 1;
const pending = new Map<number, Pending>();

function settle(requestId: number, reply: NativeKernelReply | null) {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  clearTimeout(entry.timeout);
  entry.resolve(reply);
}

function dropWorker(neverAgain: boolean) {
  worker?.terminate();
  worker = null;
  for (const requestId of [...pending.keys()]) settle(requestId, null);
  if (neverAgain) disabled = true;
  else {
    restarts += 1;
    if (restarts > MAX_RESTARTS) disabled = true;
  }
}

function ensureWorker() {
  if (worker) return worker;
  const created = new Worker(new URL("../workers/mintrKernel.worker.ts", import.meta.url), { type: "module" });
  created.onmessage = (event: MessageEvent<MintrKernelWorkerResponse>) => {
    const message = event.data;
    if (message.type === "result") {
      settle(message.requestId, message.reply as NativeKernelReply);
      return;
    }
    settle(message.requestId, null);
    // Never loaded: the files are not there, so stop asking. Crashed after loading: restart.
    if (message.broken) dropWorker(!loadedOnce);
  };
  created.onerror = () => dropWorker(!loadedOnce);
  worker = created;
  return created;
}

export function browserMintrKernel(): BrowserKernelApi | undefined {
  if (disabled || typeof window === "undefined" || typeof Worker === "undefined") return undefined;
  return {
    request(job, timeoutMs) {
      if (disabled) return Promise.resolve(null);
      return new Promise((resolve) => {
        let active: Worker;
        try {
          active = ensureWorker();
        } catch {
          disabled = true;
          resolve(null);
          return;
        }
        const requestId = nextRequestId;
        nextRequestId += 1;
        const timeout = setTimeout(() => {
          // The engine runs a job to the end, so the only way to stop one is a new engine.
          settle(requestId, null);
          if (worker === active) dropWorker(false);
        }, timeoutMs);
        pending.set(requestId, {
          resolve: (reply) => {
            if (reply) loadedOnce = true;
            resolve(reply);
          },
          timeout,
        });
        try {
          active.postMessage({ requestId, job });
        } catch {
          settle(requestId, null);
        }
      });
    },
  };
}
