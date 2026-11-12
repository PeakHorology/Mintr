import { afterAll, describe, expect, it } from "vitest";
import { booleanAngularDeflection } from "@/lib/displayTessellation";
import { displayTriangleTotal } from "@/lib/displayTriangleCount";
import { toNativeKernelSolid } from "@/lib/nativeKernelProtocol";
import type { WorkplaneShape } from "@/types/sketchforge";
import { hasNativeKernelExe, spawnNativeKernelClient } from "../helpers/nativeKernelChild";
import { hasWasmKernel, startWasmKernel, type WasmKernelClient } from "../helpers/wasmKernel";

type Client = { request: (job: Record<string, unknown>) => Promise<Record<string, unknown>> };

function pair(kind: "cylinder" | "torus"): WorkplaneShape[] {
  return [0, 1].map((i) => ({
    id: `${kind}${i}`, name: `${kind}${i}`, kind, color: "#d41721",
    x: i * 10, z: 0, elevation: kind === "torus" && i === 0 ? 6 : 0, rotationX: kind === "torus" && i === 1 ? 90 : 0,
    size: 16, width: 16, depth: 16, height: kind === "torus" ? 4 : 16, rotation: 0, locked: false, hidden: false,
  }));
}

/** A Group of the pair, as the app asks for it; with or without what the parts showed. */
async function group(client: Client, parts: WorkplaneShape[], withShown: boolean) {
  const reply = await client.request({
    id: 1, type: "boolean", op: "union",
    solids: parts.map((part) => toNativeKernelSolid(part)),
    angularDeflection: booleanAngularDeflection(parts),
    ...(withShown ? { shownTriangles: displayTriangleTotal(parts) } : {}),
  });
  expect(reply.ok, String(reply.message)).toBe(true);
  return (reply.positions as number[]).length / 9;
}

// Two linked tori took 35-50 s to Group: at the angle that keeps a round part's side count,
// a surface curved both ways meshed many times finer than it showed on screen. The engine
// now foretells that from two quick coarse meshes and meshes it about as fine as it showed.
describe.skipIf(!hasNativeKernelExe || !hasWasmKernel)("Group meshes a result about as finely as its parts showed", () => {
  const native = spawnNativeKernelClient();
  afterAll(() => native.close());
  let wasm: WasmKernelClient;

  it("keeps a cylinder Group exactly as before, and a torus Group near what the tori showed", async () => {
    wasm ??= await startWasmKernel();
    for (const client of [native, wasm]) {
      const cylinders = pair("cylinder");
      expect(await group(client, cylinders, true)).toBe(await group(client, cylinders, false));
      const tori = pair("torus");
      const shown = displayTriangleTotal(tori);
      const start = performance.now();
      const count = await group(client, tori, true);
      expect(count).toBeLessThan(shown * 1.5);
      expect(count).toBeGreaterThan(shown / 2);
      // It was 35 s and more; give a slow machine room.
      expect(performance.now() - start).toBeLessThan(15_000);
    }
  }, 120_000);
});
