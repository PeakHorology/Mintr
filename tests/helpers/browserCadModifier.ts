import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { OcctKernel } from "occt-wasm";
import type { CadModifierWorkerRequest, CadModifierWorkerResponse } from "@/lib/cadModifierTypes";

/**
 * The browser engine (cadModifier.worker) driven in Node with the same messages the app
 * sends it, so a test can send one request to both engines and compare the answers.
 */
export async function startBrowserCadModifier() {
  const waiting = new Map<number, (reply: CadModifierWorkerResponse) => void>();
  const scope = globalThis as unknown as { self?: unknown; onmessage?: (event: { data: CadModifierWorkerRequest }) => void };
  scope.self = {
    postMessage(message: CadModifierWorkerResponse) {
      const done = waiting.get(message.requestId);
      if (!done) return;
      waiting.delete(message.requestId);
      done(message);
    },
  };
  const worker = await import("@/workers/cadModifier.worker");
  const occtDir = join(process.cwd(), "node_modules", "occt-wasm", "dist");
  const { OcctKernel } = await import(pathToFileURL(join(occtDir, "index.js")).href);
  const kernel: OcctKernel = await OcctKernel.init({ wasm: join(occtDir, "occt-wasm.wasm") });
  worker.useCadModifierKernelForTests(kernel);
  const onmessage = scope.onmessage;
  if (!onmessage) throw new Error("The CAD modifier worker did not install its message handler");
  return {
    request(message: CadModifierWorkerRequest) {
      return new Promise<CadModifierWorkerResponse>((resolve) => {
        waiting.set(message.requestId, resolve);
        onmessage({ data: message });
      });
    },
  };
}
