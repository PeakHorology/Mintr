import { describe, expect, it } from "vitest";
import { evaluateOcctBooleanOnWorldShapes } from "@/lib/stepExport";
import { runOcctKernelInWorker } from "@/lib/occtKernelClient";
import { withExactSketchExtrusionSolid } from "@/lib/sketchExtrusionSolid";
import type { WorkplaneShape } from "@/types/sketchforge";

const emptySweepSpec = {
  outlineSegmentIds: [],
  holeSegmentIds: [],
  pathSegmentIds: [],
  pathClosed: false,
};

describe("OCCT stays off the window thread", () => {
  it("does not construct a CAD worker without a window", async () => {
    expect(typeof window).toBe("undefined");
    expect(await runOcctKernelInWorker({ type: "boolean", shapes: [], op: "union" })).toBeNull();
    expect(await runOcctKernelInWorker({ type: "exportStep", shapes: [] })).toBeNull();
    expect(await runOcctKernelInWorker({
      type: "sketchSweep",
      profile: { points: [], segments: [] },
      doc: null,
      spec: emptySweepSpec,
    })).toBeNull();
  });

  it("live OCCT boolean does not touch window", async () => {
    expect(typeof window).toBe("undefined");
    expect(await evaluateOcctBooleanOnWorldShapes([], "union")).toBeNull();
  });

  it("exact sketch bake skips OCCT when the solid is not a sketch extrusion", async () => {
    const shape = {
      id: "s",
      name: "s",
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
    } satisfies WorkplaneShape;
    expect(await withExactSketchExtrusionSolid(shape, 10)).toBe(shape);
  });
});
