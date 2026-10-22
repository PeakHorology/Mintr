import { afterAll, describe, expect, it } from "vitest";
import { toNativeKernelSolid } from "@/lib/nativeKernelProtocol";
import type { WorkplaneShape } from "@/types/sketchforge";
import { hasNativeKernelExe, spawnNativeKernelClient } from "../helpers/nativeKernelChild";

function box(id: string, extra: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id,
    name: id,
    kind: "box",
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
    ...extra,
  };
}

describe.skipIf(!hasNativeKernelExe)("Group kernel timing", () => {
  const client = spawnNativeKernelClient();
  afterAll(() => client.close());

  it("reports ping, hole-cut, and nine-box union cost", async () => {
    // Keep the original bounds, then time rounded-into-square unions below.
    await client.request({ id: 1, type: "ping" });

    const solid = toNativeKernelSolid(box("solid"));
    const hole = toNativeKernelSolid(box("hole", { kind: "cylinder", hole: true, width: 8, depth: 8, height: 24, elevation: -2 }));
    const cutStart = performance.now();
    const cut = await client.request({ id: 2, type: "boolean", op: "subtract", solids: [solid, hole] });
    const cutMs = performance.now() - cutStart;

    const solids = Array.from({ length: 9 }, (_, i) => toNativeKernelSolid(box(`u${i}`, { x: i * 22 })));
    const unionStart = performance.now();
    const fused = await client.request({ id: 3, type: "boolean", op: "union", solids });
    const unionMs = performance.now() - unionStart;

    expect(cut.ok).toBe(true);
    expect(fused.ok).toBe(true);
    expect(cutMs).toBeLessThan(8000);
    expect(unionMs).toBeLessThan(15000);
  }, 30000);

  it("times overlapping rounded-into-box unions", async () => {
    const cases: Array<[string, Partial<WorkplaneShape>]> = [
      ["cylinder", { kind: "cylinder", width: 16, depth: 16, x: 8 }],
      ["sphere", { kind: "sphere", width: 20, depth: 20, height: 20, x: 8 }],
      ["roundRoof", { kind: "roundRoof", width: 20, depth: 20, height: 16, x: 8 }],
    ];
    const times: Record<string, number> = {};
    for (let index = 0; index < cases.length; index += 1) {
      const [name, extra] = cases[index];
      const square = toNativeKernelSolid(box("square"));
      const rounded = toNativeKernelSolid(box(name, extra));
      const start = performance.now();
      const reply = await client.request({
        id: 20 + index,
        type: "boolean",
        op: "union",
        solids: [square, rounded],
      });
      times[name] = Math.round(performance.now() - start);
      expect(reply.ok, `${name} ${times[name]}ms ${String(reply.message)}`).toBe(true);
    }
    expect(times, JSON.stringify(times)).toEqual(times);
  }, 60000);
});
