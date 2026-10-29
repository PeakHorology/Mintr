import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toNativeKernelSolid } from "@/lib/nativeKernelProtocol";
import type { WorkplaneShape } from "@/types/sketchforge";
import { hasNativeKernelExe, spawnNativeKernelClient } from "../helpers/nativeKernelChild";
import { hasWasmKernel, startWasmKernel, type WasmKernelClient } from "../helpers/wasmKernel";

/**
 * The browser build of the engine is the desktop engine's own C++ compiled to WebAssembly.
 * Same code, same OCCT, so the two must give the same answer, not just a close one.
 */

function box(id: string, extra: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id, name: id, kind: "box", color: "#888888", x: 0, z: 0, elevation: 0,
    size: 20, width: 20, depth: 20, height: 20, rotation: 0, locked: false, hidden: false, ...extra,
  };
}

function meshVolume(reply: Record<string, unknown>) {
  const positions = reply.positions as number[];
  const indices = reply.indices as number[];
  let volume = 0;
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const a = indices[index] * 3;
    const b = indices[index + 1] * 3;
    const c = indices[index + 2] * 3;
    volume += (
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])
    ) / 6;
  }
  return volume;
}

const sameVolume = (wasm: number, native: number) => expect(Math.abs(wasm - native) / Math.abs(native), `wasm ${wasm} / desktop ${native}`).toBeLessThan(1e-4);

describe.skipIf(!hasWasmKernel || !hasNativeKernelExe)("browser build of the engine matches the desktop engine", () => {
  const native = spawnNativeKernelClient();
  let wasm: WasmKernelClient;
  let nextId = 1;
  beforeAll(async () => {
    wasm = await startWasmKernel();
  }, 60000);
  afterAll(() => native.close());

  const both = async (job: Record<string, unknown>) => {
    const id = nextId++;
    const full = { id, requestId: id, ...job };
    return [await wasm.request(full), await native.request(full, 60000)] as const;
  };

  it("answers a ping", async () => {
    const [fromWasm] = await both({ type: "ping" });
    expect(fromWasm.ok).toBe(true);
  });

  it("cuts a hole through a box", async () => {
    const solids = [
      toNativeKernelSolid(box("plate", { width: 40, depth: 30, height: 10 })),
      toNativeKernelSolid(box("bore", { kind: "cylinder", width: 10, depth: 10, height: 30, elevation: -10, hole: true })),
    ];
    const [fromWasm, fromNative] = await both({ type: "boolean", op: "subtract", solids });
    expect(fromWasm.ok, String(fromWasm.message)).toBe(true);
    sameVolume(meshVolume(fromWasm), meshVolume(fromNative));
  });

  it("exports STEP", async () => {
    const [fromWasm] = await both({ type: "exportStep", solids: [toNativeKernelSolid(box("step"))] });
    expect(fromWasm.ok, String(fromWasm.message)).toBe(true);
    expect(String(fromWasm.step)).toContain("ISO-10303");
  });

  const PARTS: Record<string, unknown[]> = {
    cube: [{ hole: false, primitive: { kind: "box", width: 20, depth: 20, height: 20 } }],
    "plate with a through hole": [
      { hole: false, primitive: { kind: "box", width: 40, depth: 30, height: 10 } },
      { hole: true, primitive: { kind: "cylinder", radius: 5, height: 20, transform: [1, 0, 0, 0, 0, 1, 0, -5, 0, 0, 1, 0] } },
    ],
    cylinder: [{ hole: false, primitive: { kind: "cylinder", radius: 10, height: 20 } }],
    "oval cone": [{ hole: false, primitive: { kind: "cone", baseRadius: 10, topRadius: 5, height: 16, sectionScale: 0.6 } }],
  };
  const TREATMENTS = [
    { kind: "fillet", amount: 1, filletProfile: "round" },
    { kind: "fillet", amount: 3, filletProfile: "round" },
    { kind: "chamfer", amount: 1.5, filletProfile: "round" },
    { kind: "fillet", amount: 2, filletProfile: "cove" },
  ];
  for (const [name, parts] of Object.entries(PARTS)) {
    for (const treatment of TREATMENTS) {
      it(`${name}: ${treatment.filletProfile === "cove" ? "concave fillet" : treatment.kind} ${treatment.amount} mm on all sharp edges`, async () => {
        const [wasmReady, nativeReady] = await both({ type: "prepare", sharpAngle: 12, parts });
        expect(wasmReady.selectableEdgeIds).toEqual(nativeReady.selectableEdgeIds);
        const [fromWasm, fromNative] = await both({ type: "preview", chamferAngle: 45, ...treatment, edgeIds: nativeReady.selectableEdgeIds });
        expect(fromWasm.ok !== false, String(fromWasm.message)).toBe(fromNative.ok !== false);
        if (fromNative.ok !== false) sameVolume(meshVolume(fromWasm), meshVolume(fromNative));
        await both({ type: "dispose" });
      }, 120000);
    }
  }

  it("concave fillets a moved, turned cube the same way", async () => {
    const parts = [{ hole: false, primitive: { kind: "box", width: 20, depth: 20, height: 20, transform: [0.8660254, 0, 0.5, 30, 0, 1, 0, 10, -0.5, 0, 0.8660254, -20] } }];
    const [wasmReady, nativeReady] = await both({ type: "prepare", sharpAngle: 12, parts });
    expect(wasmReady.selectableEdgeIds).toEqual(nativeReady.selectableEdgeIds);
    const edgeIds = (nativeReady.selectableEdgeIds as number[]).slice(0, 4);
    const [fromWasm, fromNative] = await both({ type: "preview", kind: "fillet", amount: 2, chamferAngle: 45, filletProfile: "cove", edgeIds });
    expect(fromWasm.ok, String(fromWasm.message)).not.toBe(false);
    sameVolume(meshVolume(fromWasm), meshVolume(fromNative));
    await both({ type: "dispose" });
  });
});
