import { describe, expect, it } from "vitest";
import { cadModifierPrimitiveForAnalyticPolygon } from "@/lib/cadBakeMetadata";
import type { WorkplaneShape } from "@/types/sketchforge";

function polygon(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "poly-1",
    name: "Polygon",
    kind: "polygon",
    color: "#3b82f6",
    x: 0,
    z: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    sides: 6,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

describe("cadModifierPrimitiveForAnalyticPolygon", () => {
  it("builds an exact polygon primitive for CAD-ready polygons", () => {
    const primitive = cadModifierPrimitiveForAnalyticPolygon(polygon());
    expect(primitive).toEqual(expect.objectContaining({
      kind: "polygon",
      sides: 6,
      width: 20,
      depth: 20,
      height: 20,
    }));
  });

  it("keeps yaw so a turned hexagon stays aligned", () => {
    const primitive = cadModifierPrimitiveForAnalyticPolygon(polygon({ rotation: 30, x: 4 }));
    expect(primitive?.kind).toBe("polygon");
    expect(primitive && "transform" in primitive ? primitive.transform : null).toBeTruthy();
  });

  it("rejects grouped, filleted, or mesh-backed polygons", () => {
    expect(cadModifierPrimitiveForAnalyticPolygon(polygon({ groupedShapes: [polygon({ id: "child" })] }))).toBeNull();
    expect(cadModifierPrimitiveForAnalyticPolygon(polygon({ cadBrep: "solid" }))).toBeNull();
    expect(cadModifierPrimitiveForAnalyticPolygon(polygon({
      importedMesh: {
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        baseWidth: 20,
        baseDepth: 20,
        baseHeight: 20,
      },
    }))).toBeNull();
  });
});
