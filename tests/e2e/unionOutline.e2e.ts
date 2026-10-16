import { beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { WorkplaneShape } from "@/types/sketchforge";

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

beforeAll(async () => {
  const { loadBrepWithOcct } = await import("@/lib/brepKernel");
  await loadBrepWithOcct();
});

function shape(overrides: Partial<WorkplaneShape>): WorkplaneShape {
  return {
    id: Math.random().toString(36).slice(2),
    name: "Shape",
    kind: "box",
    color: "#d97813",
    x: 0,
    z: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    ...overrides,
  };
}

describe("box-cylinder union outline", () => {
  it("drops the circle where it crosses the flat top and keeps the outer rim", async () => {
    const { evaluateOcctBooleanOnWorldShapes } = await import("@/lib/stepExport");
    const { filterCoplanarDisplayEdges } = await import("@/lib/csgTree");
    const box = shape({ kind: "box", name: "Box", x: 8, z: 0, width: 20, depth: 20, height: 20 });
    const cyl = shape({ kind: "cylinder", name: "Cylinder", x: -4, z: -6, width: 20, depth: 20, height: 20 });
    const result = await evaluateOcctBooleanOnWorldShapes([box, cyl], "union");
    expect(result).not.toBeNull();
    if (!result) return;
    const filtered = filterCoplanarDisplayEdges(result.displayEdges ?? [], result.positions);
    const topY = 20;
    const deepInsideBox = (x: number, z: number) => Math.abs(x - 8) < 8.5 && Math.abs(z) < 8.5;
    const onCircle = (x: number, z: number) => Math.abs(Math.hypot(x + 4, z + 6) - 10) < 0.35;
    let interiorSamples = 0;
    let outerRim = false;
    for (const edge of filtered) {
      for (let i = 0; i + 2 < edge.points.length; i += 3) {
        const x = edge.points[i];
        const y = edge.points[i + 1];
        const z = edge.points[i + 2];
        if (Math.abs(y - topY) >= 0.2 || !onCircle(x, z)) continue;
        if (deepInsideBox(x, z)) interiorSamples += 1;
        else outerRim = true;
      }
    }
    expect(interiorSamples).toBe(0);
    expect(outerRim).toBe(true);
    expect(filtered.length).toBeGreaterThan(4);
  });
});
