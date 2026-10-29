import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The Mintr engine built to WebAssembly (npm run build:kernel:wasm): the same C++ as
 * MintrKernel.exe, so the browser and the desktop get one engine. Same request shape as
 * the desktop helper in nativeKernelChild.ts, so a test can run a job through both.
 */
const repoRoot = path.resolve(__dirname, "../..");
export const wasmKernelModule = path.join(repoRoot, "native/mintr-kernel/dist-wasm/MintrKernel.mjs");
export const hasWasmKernel = existsSync(wasmKernelModule);

type MintrKernelModule = {
  ccall: (name: string, returnType: "string", argTypes: ["string"], args: [string]) => string;
};

export type WasmKernelClient = {
  request: (job: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export async function startWasmKernel(): Promise<WasmKernelClient> {
  const { default: createMintrKernel } = await import(pathToFileURL(wasmKernelModule).href) as {
    default: () => Promise<MintrKernelModule>;
  };
  const kernel = await createMintrKernel();
  return {
    async request(job) {
      return JSON.parse(kernel.ccall("mintrHandleJob", "string", ["string"], [JSON.stringify(job)])) as Record<string, unknown>;
    },
  };
}
