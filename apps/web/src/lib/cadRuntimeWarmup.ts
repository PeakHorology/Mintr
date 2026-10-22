import { loadBrepWithOcct } from "@/lib/brepKernel";
import { preloadCadModifierWorker } from "@/lib/cadModifierPreload";
import { nativeOcctKernelIsReady, warmNativeOcctKernel } from "@/lib/nativeKernelProtocol";

export type CadRuntimeKind = "native" | "wasm";

/**
 * Desktop with MintrKernel skips the 22 MB occt-wasm heap until a job actually
 * falls back. Browser and kernel-less Electron still warm WASM on the start page.
 */
export async function prepareCadRuntime(): Promise<CadRuntimeKind> {
  if (await nativeOcctKernelIsReady()) {
    warmNativeOcctKernel();
    return "native";
  }
  await Promise.all([
    preloadCadModifierWorker(),
    loadBrepWithOcct().catch(() => undefined),
  ]);
  return "wasm";
}
