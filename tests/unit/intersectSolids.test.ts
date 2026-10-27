import { describe, expect, it } from "vitest";
import { buildIntersectionShapeFromSelection, canIntersectShapes } from "@/lib/editorBoolean";
import { meshForShape } from "@/lib/editorShapeMesh";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(id: string, x: number, options: { z?: number; hole?: boolean } = {}): WorkplaneShape {
  return {
    id,
    name: id,
    kind: "box",
    color: "#d41721",
    x,
    z: options.z ?? 0,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
    hole: options.hole,
  };
}

function bounds(shape: WorkplaneShape) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const vertex of meshForShape(shape).vertices) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  const round = (value: number) => Math.round(value * 100) / 100 + 0;
  return { min: min.map(round), max: max.map(round) };
}

describe("Intersect", () => {
  it("is available for two solids, or a solid and a hole, but not a lone shape or holes only", () => {
    expect(canIntersectShapes([box("a", 0), box("b", 10)])).toBe(true);
    expect(canIntersectShapes([box("a", 0), box("b", 10, { hole: true })])).toBe(true);
    expect(canIntersectShapes([box("a", 0)])).toBe(false);
    expect(canIntersectShapes([box("a", 0, { hole: true }), box("b", 10, { hole: true })])).toBe(false);
  });

  it("keeps the overlap of a solid and a hole", async () => {
    const result = await buildIntersectionShapeFromSelection([box("a", 0), box("b", 10, { hole: true })]);
    expect(result.group).toBeTruthy();
    expect(bounds(result.group!)).toEqual({ min: [0, 0, -10], max: [10, 20, 10] });
    expect(result.group!.csg?.op).toBe("intersect");
  }, 60000);

  it("keeps the overlap of two plain solids and remembers them as solids", async () => {
    const result = await buildIntersectionShapeFromSelection([box("a", 0), box("b", 10)]);
    expect(result.group).toBeTruthy();
    expect(bounds(result.group!)).toEqual({ min: [0, 0, -10], max: [10, 20, 10] });
    expect(result.group!.csg?.op).toBe("intersect");
    expect(result.group!.name).toBe("Intersection");
    expect(result.group!.groupedShapes?.map((child) => Boolean(child.hole))).toEqual([false, false]);
  }, 60000);

  it("keeps only the space all three solids share", async () => {
    const result = await buildIntersectionShapeFromSelection([box("a", 0), box("b", 10), box("c", 5, { z: 10 })]);
    expect(result.group).toBeTruthy();
    expect(bounds(result.group!)).toEqual({ min: [0, 0, 0], max: [10, 20, 10] });
    expect(result.group!.groupedShapes).toHaveLength(3);
  }, 60000);

  it("reports an empty result when the solids do not touch", async () => {
    const result = await buildIntersectionShapeFromSelection([box("a", 0), box("b", 40)]);
    expect(result.group).toBeNull();
    expect(result.empty).toBe(true);
  }, 60000);
});
