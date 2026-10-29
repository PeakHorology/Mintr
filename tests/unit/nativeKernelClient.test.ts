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

  it("hands a boolean the desktop engine could not finish to the browser kernel", async () => {
    const request = vi.fn(async () => ({ ok: false, fallback: true, message: "native boolean failed" }));
    const posted: unknown[] = [];
    class WorkerMock {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      postMessage(message: { requestId: number }) {
        posted.push(message);
        queueMicrotask(() => this.onmessage?.({ data: { requestId: message.requestId, type: "result", value: { positions: [1, 2, 3] } } } as MessageEvent));
      }
      terminate() {}
    }
    vi.stubGlobal("window", { peakcadKernel: { request } });
    vi.stubGlobal("Worker", WorkerMock);
    const { runOcctKernelInWorker } = await import("@/lib/occtKernelClient");
    const result = await runOcctKernelInWorker({
      type: "boolean",
      shapes: [box, { ...box, id: "hole", hole: true, kind: "cylinder", width: 8, depth: 8 }],
      op: "subtract",
    });
    expect(request).toHaveBeenCalled();
    expect(posted).toHaveLength(1);
    expect(result).toMatchObject({ positions: [1, 2, 3] });
  });

  it("keeps a desktop refusal meant for the user instead of retrying it", async () => {
    const request = vi.fn(async () => ({ ok: false, fallback: false, message: "No solid geometry to export as STEP" }));
    const WorkerMock = vi.fn();
    vi.stubGlobal("window", { peakcadKernel: { request } });
    vi.stubGlobal("Worker", WorkerMock);
    const { runOcctKernelInWorker, lastOcctKernelError } = await import("@/lib/occtKernelClient");
    const result = await runOcctKernelInWorker({ type: "exportStep", shapes: [box] });
    expect(result).toBeNull();
    expect(WorkerMock).not.toHaveBeenCalled();
    expect(lastOcctKernelError()).toBe("No solid geometry to export as STEP");
  });
});
