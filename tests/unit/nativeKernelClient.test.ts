import { afterEach, describe, expect, it, vi } from "vitest";

const box = {
  id: "a",
  name: "a",
  kind: "box" as const,
  color: "#d41721",
  x: 0,
  z: 0,
  elevation: 0,
  size: 20,
  width: 20,
  depth: 20,
  height: 20,
  rotation: 0,
  locked: false,
  hidden: false,
};

describe("native kernel client routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("uses peakcadKernel for a box boolean when the desktop API is present", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      positions: [0, 0, 0, 4, 0, 0, 0, 4, 0],
      brepStep: "ISO-10303-21;",
      quality: "exact",
    }));
    vi.stubGlobal("window", { peakcadKernel: { request } });
    const { runOcctKernelInWorker } = await import("@/lib/occtKernelClient");
    const result = await runOcctKernelInWorker({ type: "boolean", shapes: [box, { ...box, id: "b", x: 10 }], op: "union" });
    expect(request).toHaveBeenCalled();
    expect(result).toMatchObject({ brepStep: "ISO-10303-21;", quality: "exact" });
    expect(result && "positions" in result ? result.positions.length : 0).toBe(9);
  });

  it("does not start the WASM worker after the sidecar already handled a boolean", async () => {
    const request = vi.fn(async () => ({ ok: false, fallback: true, message: "native boolean failed" }));
    const WorkerMock = vi.fn();
    vi.stubGlobal("window", { peakcadKernel: { request } });
    vi.stubGlobal("Worker", WorkerMock);
    const { runOcctKernelInWorker } = await import("@/lib/occtKernelClient");
    const result = await runOcctKernelInWorker({
      type: "boolean",
      shapes: [box, { ...box, id: "hole", hole: true, kind: "cylinder", width: 8, depth: 8 }],
      op: "subtract",
    });
    expect(request).toHaveBeenCalled();
    expect(WorkerMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
