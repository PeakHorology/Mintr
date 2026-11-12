import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGroupedShapeFromSelection, exactBoundsHoldMesh } from "@/lib/editorBoolean";
import { shapeExportQualityHint } from "@/lib/stepQuality";
import type { WorkplaneShape } from "@/types/sketchforge";
import { hasWasmKernel, startWasmKernel } from "../helpers/wasmKernel";

function sphere(i: number): WorkplaneShape {
  // Two rows of overlapping balls at three heights: round faces meeting round faces.
  return {
    id: `s${i}`, name: `Ball ${i}`, kind: "sphere", color: "#d41721",
    x: (i % 7) * 6, z: Math.floor(i / 7) * 6, elevation: (i % 3) * 2,
    size: 10, width: 10, depth: 10, height: 10, rotation: 0, locked: false, hidden: false,
  };
}

describe("exact bounds hold the mesh", () => {
  it("takes bounds the mesh sits just inside, and refuses ones that do not match", () => {
    const exact = [-8, 0, -5, 8, 12, 5];
    expect(exactBoundsHoldMesh(exact, [-7.999, 0, -4.998, 7.999, 11.997, 4.998])).toBe(true);
    // The mesh reaching outside the solid, or far inside it, is not this solid.
    expect(exactBoundsHoldMesh(exact, [-8.2, 0, -5, 8, 12, 5])).toBe(false);
    expect(exactBoundsHoldMesh(exact, [-4, 0, -5, 8, 12, 5])).toBe(false);
    expect(exactBoundsHoldMesh([0, 0, 0], [0, 0, 0, 1, 1, 1])).toBe(false);
  });
});

// Grouping one part at a time onto a Group used to move the Group's solid by the gap between
// its mesh and its true surface on every step. On round parts that added up until the fuse
// came back invalid and the Group quietly turned to mesh (at the 10th ball here).
describe.skipIf(!hasWasmKernel)("Group one part at a time", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stays CAD ready and true to size through 14 balls added one by one", async () => {
    const wasm = await startWasmKernel();
    vi.stubGlobal("window", { peakcadKernel: { request: (job: Record<string, unknown>) => wasm.request(job) } });
    let group = sphere(0);
    for (let i = 1; i < 14; i += 1) {
      const built = await buildGroupedShapeFromSelection([group, sphere(i)]);
      expect(built.group, `ball ${i + 1}`).toBeTruthy();
      group = built.group!;
      expect(shapeExportQualityHint(group), `ball ${i + 1}: ${built.qualityNotice ?? ""}`).toBe("exact");
    }
    // Balls 0-6 across 36 mm plus a radius each side, two rows 6 mm apart, top ball at 4 + 10.
    expect(group.width).toBeCloseTo(46, 6);
    expect(group.depth).toBeCloseTo(16, 6);
    expect(group.height).toBeCloseTo(14, 6);
    expect(group.elevation ?? 0).toBeCloseTo(0, 6);
    expect(group.x).toBeCloseTo(18, 6);
    expect(group.z).toBeCloseTo(3, 6);
    // Still a STEP file from start to end, with the engine's own copy inside a comment.
    const step = group.importedMesh?.brepStep ?? "";
    expect(step.startsWith("ISO-10303-21;")).toBe(true);
    expect(step.trimEnd().endsWith("END-ISO-10303-21;")).toBe(true);
    expect(step).toContain("/* MINTR-BREP 1");
  }, 300_000);
});
