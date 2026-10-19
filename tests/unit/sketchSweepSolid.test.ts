import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sweepSpec, planSketchSweep } from "@/lib/sketch/sweepPlan";
import { sketchDocToProfile } from "@/lib/sketch/migrate";
import { sweepSolid } from "@/lib/sketchSweep";
import { createEmptySketchDoc } from "@/lib/sketch/types";
import { defaultSketchPlane } from "@/lib/sketchPlane";
import type { SketchProfile } from "@/types/sketchforge";
import type { Brep } from "@/lib/brepKernel";

let brep: Brep;

beforeAll(async () => {
  const brepjs = await import("brepjs");
  const { OcctKernel } = await import("occt-wasm");
  const wasm = join(dirname(fileURLToPath(import.meta.resolve("occt-wasm"))), "occt-wasm.wasm");
  const kernel = await OcctKernel.init({ wasm });
  brepjs.registerKernel("occt-wasm", brepjs.OcctWasmAdapter.fromKernel(kernel));
  brep = brepjs;
});

function squareOnLine(): { profile: SketchProfile; spec: ReturnType<typeof sweepSpec> } {
  const profile: SketchProfile = {
    points: [
      { id: "a", x: 0, z: 0 },
      { id: "b", x: 10, z: 0 },
      { id: "c", x: 10, z: 10 },
      { id: "d", x: 0, z: 10 },
      { id: "p0", x: 20, z: 20 },
      { id: "p1", x: 40, z: 20 },
    ],
    segments: [
      { id: "ab", startId: "a", endId: "b", kind: "line" },
      { id: "bc", startId: "b", endId: "c", kind: "line" },
      { id: "cd", startId: "c", endId: "d", kind: "line" },
      { id: "da", startId: "d", endId: "a", kind: "line" },
      { id: "path", startId: "p0", endId: "p1", kind: "line" },
    ],
  };
  const plan = planSketchSweep(profile);
  return { profile, spec: sweepSpec(plan.outlines[0]!, plan.paths[0]!) };
}

describe("sweep solid", () => {
  it("pipes a square along a line as a real solid", async () => {
    const { profile, spec } = squareOnLine();
    const built = sweepSolid(brep, profile, null, spec);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const step = brep.exportSTEP(built.solid as never);
    expect(step.ok).toBe(true);
    if (!step.ok) return;
    const text = await step.value.text();
    expect(text).toContain("PLANE");
  });

  it("cuts one hole through the swept outline", async () => {
    const profile: SketchProfile = {
      points: [
        { id: "a", x: 0, z: 0 },
        { id: "b", x: 20, z: 0 },
        { id: "c", x: 20, z: 20 },
        { id: "d", x: 0, z: 20 },
        { id: "e", x: 6, z: 6 },
        { id: "f", x: 14, z: 6 },
        { id: "g", x: 14, z: 14 },
        { id: "h", x: 6, z: 14 },
        { id: "p0", x: 30, z: 0 },
        { id: "p1", x: 50, z: 0 },
      ],
      segments: [
        { id: "ab", startId: "a", endId: "b", kind: "line" },
        { id: "bc", startId: "b", endId: "c", kind: "line" },
        { id: "cd", startId: "c", endId: "d", kind: "line" },
        { id: "da", startId: "d", endId: "a", kind: "line" },
        { id: "ef", startId: "e", endId: "f", kind: "line" },
        { id: "fg", startId: "f", endId: "g", kind: "line" },
        { id: "gh", startId: "g", endId: "h", kind: "line" },
        { id: "he", startId: "h", endId: "e", kind: "line" },
        { id: "path", startId: "p0", endId: "p1", kind: "line" },
      ],
    };
    const plan = planSketchSweep(profile);
    expect(plan.outlines).toHaveLength(1);
    expect(plan.outlines[0]?.holes).toHaveLength(1);
    const built = sweepSolid(brep, profile, null, sweepSpec(plan.outlines[0]!, plan.paths[0]!));
    expect(built.ok).toBe(true);
  });

  it("keeps a circle as a circle", async () => {
    const doc = createEmptySketchDoc(defaultSketchPlane(), "sketch-circle");
    doc.entities = [
      { id: "center", kind: "point", x: 0, z: 0 },
      { id: "ring", kind: "circle", centerId: "center", radius: 5 },
      { id: "p0", kind: "point", x: 20, z: 0 },
      { id: "p1", kind: "point", x: 40, z: 0 },
      { id: "path", kind: "line", startId: "p0", endId: "p1" },
    ];
    const profile = sketchDocToProfile(doc);
    const plan = planSketchSweep(profile, doc);
    expect(plan.outlines[0]?.curve?.kind).toBe("circle");
    const built = sweepSolid(brep, profile, doc, sweepSpec(plan.outlines[0]!, plan.paths[0]!));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const step = brep.exportSTEP(built.solid as never);
    expect(step.ok).toBe(true);
    if (!step.ok) return;
    const text = await step.value.text();
    expect(text).toMatch(/CYLINDRICAL_SURFACE|CIRCLE/);
  });
});
