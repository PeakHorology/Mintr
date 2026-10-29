/// <reference lib="webworker" />
/**
 * The Mintr engine in the browser: MintrKernel.exe's own C++, built to WebAssembly
 * (npm run build:kernel:wasm) and staged into public/mintr-kernel/ by copy-occt-wasm.
 * It takes the same JSON jobs as the desktop engine and gives the same replies, so a
 * fix in native/mintr-kernel reaches both apps.
 *
 * Loaded from public/, never bundled: Emscripten glue does not survive the bundler
 * (see the OCCT note in cadModifier.worker.ts).
 */

const MINTR_KERNEL_URL: string = "/mintr-kernel/MintrKernel.mjs";

type MintrKernelModule = {
  ccall: (name: string, returnType: "string", argTypes: ["string"], args: [string]) => string;
};

export type MintrKernelWorkerRequest = { requestId: number; job: Record<string, unknown> };

export type MintrKernelWorkerResponse =
  | { requestId: number; type: "result"; reply: Record<string, unknown> }
  /** `broken`: the engine itself failed to load or crashed, so this worker is done. */
  | { requestId: number; type: "error"; message: string; broken: boolean };

let modulePromise: Promise<MintrKernelModule> | null = null;
let broken = false;

function engine() {
  modulePromise ??= (async () => {
    const loaded = (await import(/* webpackIgnore: true */ MINTR_KERNEL_URL)) as {
      default: () => Promise<MintrKernelModule>;
    };
    return loaded.default();
  })();
  return modulePromise;
}

function post(message: MintrKernelWorkerResponse) {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<MintrKernelWorkerRequest>) => {
  const { requestId, job } = event.data;
  if (broken) {
    post({ requestId, type: "error", message: "The Mintr engine stopped", broken: true });
    return;
  }
  let kernel: MintrKernelModule;
  try {
    kernel = await engine();
  } catch (error) {
    broken = true;
    post({ requestId, type: "error", message: error instanceof Error ? error.message : String(error), broken: true });
    return;
  }
  try {
    const text = kernel.ccall("mintrHandleJob", "string", ["string"], [JSON.stringify(job)]);
    post({ requestId, type: "result", reply: JSON.parse(text) as Record<string, unknown> });
  } catch (error) {
    // A WebAssembly trap or abort leaves the engine's memory in an unknown state.
    broken = true;
    post({ requestId, type: "error", message: error instanceof Error ? error.message : String(error), broken: true });
  }
};
