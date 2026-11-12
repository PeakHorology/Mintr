import { afterAll, describe, expect, it } from "vitest";
import { hasNativeKernelExe, spawnNativeKernelClient } from "../helpers/nativeKernelChild";
import { hasWasmKernel, startWasmKernel, type WasmKernelClient } from "../helpers/wasmKernel";

type Client = { request: (job: Record<string, unknown>) => Promise<Record<string, unknown>> };

/** Pull the top of a round part 5 mm and count the triangles in the result. */
async function pullTop(client: Client, matchTriangles?: number) {
  const prepared = await client.request({
    id: 1,
    requestId: 1,
    type: "prepare",
    sharpAngle: 12,
    parts: [{ hole: false, primitive: { kind: "cylinder", radius: 10, height: 20 } }],
  });
  expect(prepared.ok, String(prepared.message)).toBe(true);
  const faces = prepared.planarFaces as Array<{ id: number; normal: { y: number } }>;
  const top = faces.find((face) => face.normal.y > 0.9)!;
  const pulled = await client.request({
    id: 2,
    requestId: 2,
    type: "pushPull",
    faceId: top.id,
    distance: 5,
    quality: "fine",
    ...(matchTriangles === undefined ? {} : { matchTriangles }),
  });
  expect(pulled.ok, String(pulled.message)).toBe(true);
  await client.request({ id: 3, requestId: 3, type: "dispose" });
  return Number(pulled.triangleCount);
}

// A pull moves a flat face; it should not change how finely the part's curves are meshed.
describe.skipIf(!hasNativeKernelExe || !hasWasmKernel)("Push Pull meshes the result as densely as the part was", () => {
  const native = spawnNativeKernelClient();
  afterAll(() => native.close());
  let wasm: WasmKernelClient;

  it("keeps a coarse part coarse and a fine part fine, the same on the desktop and in the browser", async () => {
    wasm ??= await startWasmKernel();
    for (const client of [native, wasm]) {
      const fixed = await pullTop(client);
      const coarse = await pullTop(client, 120);
      const fine = await pullTop(client, fixed * 4);
      expect(coarse).toBeLessThan(fixed);
      expect(coarse).toBeLessThanOrEqual(120 * 1.5 + 64);
      expect(fine).toBeGreaterThan(fixed * 2);
    }
    // One engine: the desktop and the browser give the same mesh.
    expect(await pullTop(wasm, 120)).toBe(await pullTop(native, 120));
  }, 60000);
});
