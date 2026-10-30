import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: () => false,
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("native kernel test helper without an exe", () => {
  it("does not spawn MintrKernel.exe when the sidecar is missing", async () => {
    // The Windows CI job insists on the exe; this test is about the case where it is missing.
    vi.stubEnv("MINTR_REQUIRE_NATIVE_KERNEL", "");
    const { hasNativeKernelExe, spawnNativeKernelClient } = await import("../helpers/nativeKernelChild");
    expect(hasNativeKernelExe).toBe(false);
    const client = spawnNativeKernelClient();
    expect(spawn).not.toHaveBeenCalled();
    await expect(client.request({ id: 1, type: "ping" })).rejects.toThrow(/not built/);
    client.close();
    vi.unstubAllEnvs();
  });
});
