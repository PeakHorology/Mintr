import { describe, expect, it } from "vitest";
import { splitShapeWithPlane } from "@/lib/splitShape";
import { meshForShape } from "@/lib/editorShapeMesh";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(): WorkplaneShape {
  return {
    id: "box",
    name: "Block",
    kind: "box",
    color: "#d97813",
    x: 10,
    z: -4,
    size: 20,
    width: 20,
    depth: 12,
    height: 16,
    elevation: 2,
    rotation: 0,
  };
}

function extreme(shape: WorkplaneShape, axis: 0 | 1 | 2, end: "min" | "max") {
  const mesh = meshForShape(shape);
  let value = end === "min" ? Infinity : -Infinity;
  for (const vertex of mesh.vertices) {
    value = end === "min" ? Math.min(value, vertex[axis]) : Math.max(value, vertex[axis]);
  }
  return value;
}

describe("splitShapeWithPlane", () => {
  it("cuts a box into two solids that meet on the line", () => {
    const parts = splitShapeWithPlane(box(), { axis: "x", offset: 0 });
    expect(parts).toHaveLength(2);
    expect(parts.map((part) => part.name).sort()).toEqual(["Block Left", "Block Right"]);
    const left = parts.find((part) => part.name.endsWith("Left"))!;
    const right = parts.find((part) => part.name.endsWith("Right"))!;
    expect(extreme(left, 0, "max")).toBeLessThanOrEqual(10.05);
    expect(extreme(right, 0, "min")).toBeGreaterThanOrEqual(9.95);
    expect(left.x).toBeLessThan(10);
    expect(right.x).toBeGreaterThan(10);
    expect(left.kind).toBe("mesh");
    expect(right.kind).toBe("mesh");
  });
});
