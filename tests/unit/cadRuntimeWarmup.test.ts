import { afterEach, describe, expect, it, vi } from "vitest";

describe("CAD runtime warmup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("skips occt-wasm when MintrKernel is ready", async () => {
    const request = vi.fn(async () => ({ ok: true, native: true }));
    const ready = vi.fn(async () => true);
    vi.stubGlobal("window", { peakcadKernel: { ready, request } });
    vi.doMock("@/lib/brepKernel", () => ({ loadBrepWithOcct: vi.fn(async () => {
      throw new Error("WASM should not load");
    }) }));
    vi.doMock("@/lib/cadModifierPreload", () => ({ preloadCadModifierWorker: vi.fn(async () => {
      throw new Error("fillet worker should not preload");
    }) }));
    const { prepareCadRuntime } = await import("@/lib/cadRuntimeWarmup");
    await expect(prepareCadRuntime()).resolves.toBe("native");
    expect(ready).toHaveBeenCalled();
    expect(request).toHaveBeenCalled();
  });

  it("warms WASM when the desktop sidecar is missing", async () => {
    const loadBrepWithOcct = vi.fn(async () => ({}));
    const preloadCadModifierWorker = vi.fn(async () => undefined);
    vi.stubGlobal("window", {});
    vi.doMock("@/lib/brepKernel", () => ({ loadBrepWithOcct }));
    vi.doMock("@/lib/cadModifierPreload", () => ({ preloadCadModifierWorker }));
    const { prepareCadRuntime } = await import("@/lib/cadRuntimeWarmup");
    await expect(prepareCadRuntime()).resolves.toBe("wasm");
    expect(loadBrepWithOcct).toHaveBeenCalled();
    expect(preloadCadModifierWorker).toHaveBeenCalled();
  });
});
