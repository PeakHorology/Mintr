import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/brepKernel", async () => {
  const brep = await import("brepjs");
  const { OcctKernel } = await import("occt-wasm");
  const wasm = join(dirname(fileURLToPath(import.meta.resolve("occt-wasm"))), "occt-wasm.wasm");
  let ready: Promise<typeof brep> | null = null;
  return {
    loadBrepWithOcct: () =>
      (ready ??= (async () => {
        const kernel = await OcctKernel.init({ wasm });
        brep.registerKernel("occt-wasm", brep.OcctWasmAdapter.fromKernel(kernel));
        return brep;
      })()),
  };
});
import { evaluateOcctBooleanOnWorldShapesLocal } from "@/lib/stepExport";
import { toNativeKernelSolids } from "@/lib/nativeKernelProtocol";
import type { WorkplaneShape } from "@/types/sketchforge";
import { hasNativeKernelExe, spawnNativeKernelClient } from "../helpers/nativeKernelChild";

/**
 * Groups handed to the desktop engine must come out where the browser engine
 * puts them: same pose, and a group's holes cut only that group.
 */

function box(id: string, x: number, z: number, extra: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id, name: id, kind: "box", color: "#888888", x, z, elevation: 0,
    size: 10, width: 10, depth: 10, height: 10, rotation: 0, locked: false, hidden: false, ...extra,
  };
}

function group(id: string, children: WorkplaneShape[], pose: Partial<WorkplaneShape>): WorkplaneShape {
  return {
    ...box(id, 0, 0),
    kind: "group" as WorkplaneShape["kind"],
    width: 30, depth: 10, height: 10, size: 20,
    groupedShapes: children, groupedBaseWidth: 30, groupedBaseDepth: 10, groupedBaseHeight: 10,
    ...pose,
  };
}

/** Volume and centre of a closed triangle mesh, indexed or not. */
function massOf(positions: ArrayLike<number>, indices?: ArrayLike<number>) {
  let volume = 0;
  const centre = [0, 0, 0];
  const count = indices ? indices.length : positions.length / 3;
  for (let index = 0; index + 2 < count; index += 3) {
    const corner = (k: number) => (indices ? indices[index + k] : index + k) * 3;
    const [a, b, c] = [corner(0), corner(1), corner(2)];
    const v = (
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])
    ) / 6;
    volume += v;
    for (let axis = 0; axis < 3; axis += 1) centre[axis] += v * (positions[a + axis] + positions[b + axis] + positions[c + axis]) / 4;
  }
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis], positions[index + axis]);
      high[axis] = Math.max(high[axis], positions[index + axis]);
    }
  }
  return { volume: Math.abs(volume), centre: centre.map((value) => value / volume), low, high };
}

const children = () => [box("left", -10, 0), box("right", 10, 0, { height: 6 })];

const gear = (form: "spur" | "ring", extra: object) => box("gear", 3, -2, {
  kind: "gear", width: 40, depth: 40, height: 8,
  gearSpec: { form, teeth: form === "ring" ? 14 : 18, module: 2, pressureAngle: 20, backlash: 0.1, bore: 0, rim: 3, ...extra },
} as Partial<WorkplaneShape>);

const CASES: Record<string, WorkplaneShape[]> = {
  "a round sphere": [box("ball", 2, 3, { kind: "sphere", width: 18, depth: 18, height: 18, elevation: 4 })],
  "a stretched sphere": [box("egg", 0, 0, { kind: "sphere", width: 18, depth: 12, height: 24 })],
  "a half sphere": [box("dome", 0, 0, { kind: "halfSphere", width: 20, depth: 20, height: 10 })],
  "a five-sided pyramid": [box("pyramid", 0, 0, { kind: "pyramid", sides: 5, width: 20, depth: 20, height: 15 })],
  "a spur gear with a bore": [gear("spur", { bore: 8 })],
  "a ring gear": [gear("ring", {})],
  "a turned group": [group("g", children(), { x: 4, z: -3, rotation: 30 })],
  "a tilted group": [group("g", children(), { x: 4, z: -3, elevation: 12, rotationX: 25 })],
  "a group turned about its depth": [group("g", children(), { elevation: 15, rotationZ: 40 })],
  "a mirrored group": [group("g", [box("left", -10, 2), box("right", 10, -2, { height: 6 })], { x: 1, mirrorX: true, rotation: 15 })],
  "a group with a hole next to a box the hole reaches": [
    group("g", [box("plate", 0, 0, { width: 20 }), box("hole", 8, 0, { width: 8, depth: 8, height: 30, hole: true, elevation: -10 })], { width: 20, groupedBaseWidth: 20 }),
    box("beside", 14, 0),
  ],
};

describe.skipIf(!hasNativeKernelExe)("desktop booleans match the browser on groups", () => {
  const native = spawnNativeKernelClient();
  let nextId = 5000;
  afterAll(() => native.close());

  for (const [name, shapes] of Object.entries(CASES)) {
    it(name, async () => {
      const browser = await evaluateOcctBooleanOnWorldShapesLocal(shapes, "union");
      expect(browser).not.toBeNull();
      const solids = toNativeKernelSolids(shapes);
      // A pose the desktop cannot reproduce must go to the browser engine, never come out wrong.
      if (!solids) return;
      const id = nextId++;
      const reply = await native.request({ id, type: "boolean", op: "union", solids }, 60000);
      expect(reply.ok, String(reply.message)).not.toBe(false);
      const fromBrowser = massOf(browser!.positions);
      const fromNative = massOf(reply.positions as number[], reply.indices as number[]);
      // The two engines mesh curved faces a little differently; a true difference in shape is far bigger.
      expect(Math.abs(fromNative.volume - fromBrowser.volume) / fromBrowser.volume).toBeLessThan(0.02);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(fromNative.centre[axis]).toBeCloseTo(fromBrowser.centre[axis], 0);
        expect(fromNative.low[axis]).toBeCloseTo(fromBrowser.low[axis], 0);
        expect(fromNative.high[axis]).toBeCloseTo(fromBrowser.high[axis], 0);
      }
    }, 120000);
  }
});
