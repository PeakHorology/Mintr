import { beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

describe("gridfinity bodies from the brepjs fallback", () => {
  it("builds a bin with lip, magnets, dividers and a scoop", async () => {
    const { buildGridfinityShapeLocal, createGridfinityShape, withGridfinityBinSpec } = await import("@/lib/gridfinityShape");
    const shape = withGridfinityBinSpec(createGridfinityShape("gridfinityBin"), {
      unitsX: 2,
      unitsZ: 1,
      heightUnits: 3,
      magnets: true,
      compartmentsX: 2,
      scoop: "front",
    });
    const built = await buildGridfinityShapeLocal(shape);
    expect(built).not.toBeNull();
    expect(built!.cadBrep?.length).toBeGreaterThan(200);
    // The scoop is a concave quarter-round on the front (+z) wall: its tessellation
    // puts vertices mid-cavity on the +z half only. A mirrored plane mapping would
    // move them to -z, so this pins the brepjs plane orientation.
    const positions = built!.importedMesh!.positions;
    const floorTop = 4.75 + 2.25;
    let front = 0;
    let back = 0;
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const y = positions[i + 1];
      if (y < floorTop + 0.5 || y > floorTop + 8) continue;
      if (positions[i + 2] > 0) front += 1;
      else back += 1;
    }
    expect(front).toBeGreaterThan(8);
    expect(back).toBe(0);
    expect(built!.importedMesh?.triangleCount).toBeGreaterThan(100);
    expect(built!.importedMesh?.baseWidth).toBeCloseTo(83.5);
    expect(built!.gridfinityBuilt).toBe(shape.gridfinityBin && (await import("@/lib/gridfinity")).gridfinityBinKey(shape.gridfinityBin));
  }, 120000);

  it("builds a floored baseplate with screws and a tab", async () => {
    const { buildGridfinityShapeLocal, createGridfinityShape, withGridfinityBaseplateSpec } = await import("@/lib/gridfinityShape");
    const shape = withGridfinityBaseplateSpec(createGridfinityShape("gridfinityBaseplate"), {
      unitsX: 2,
      unitsZ: 1,
      screws: true,
      magnets: true,
      connectors: { right: "tab" },
    });
    const built = await buildGridfinityShapeLocal(shape);
    expect(built).not.toBeNull();
    expect(built!.importedMesh?.baseWidth).toBeCloseTo(88);
    expect(built!.height).toBeCloseTo(7.65);
  }, 120000);

  it("builds an open baseplate with a dovetail and no floor", async () => {
    const { buildGridfinityShapeLocal, createGridfinityShape, withGridfinityBaseplateSpec } = await import("@/lib/gridfinityShape");
    const shape = withGridfinityBaseplateSpec(createGridfinityShape("gridfinityBaseplate"), {
      unitsX: 2,
      unitsZ: 2,
      floorThickness: 0,
      connectors: { right: "dovetail", left: "groove" },
    });
    const built = await buildGridfinityShapeLocal(shape);
    expect(built).not.toBeNull();
    expect(built!.height).toBeCloseTo(4.65);
    expect(built!.importedMesh?.baseWidth).toBeCloseTo(84 + 1.5);
  }, 120000);

  it("rebuilds the exact solid for STEP through buildNativeShapeSolid", async () => {
    const { buildNativeShapeSolid } = await import("@/lib/shapeBrep");
    const { createGridfinityShape } = await import("@/lib/gridfinityShape");
    const { loadBrepWithOcct } = await import("@/lib/brepKernel");
    const brep = await loadBrepWithOcct();
    const result = buildNativeShapeSolid(brep, createGridfinityShape("gridfinityBaseplate"));
    expect("solid" in result).toBe(true);
  }, 120000);
});
