import { describe, expect, it } from "vitest";
import { cadModifierPrimitiveForAnalyticCone } from "@/lib/cadBakeMetadata";
import { isAnalyticConeSeam, isDegenerateCurve } from "@/lib/cadModifierEdges";
import type { WorkplaneShape } from "@/types/sketchforge";

function cone(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "cone-1",
    name: "Cone",
    kind: "cone",
    color: "#6e2786",
    x: 0,
    z: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    topRadius: 0,
    baseRadius: 10,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

describe("cadModifierPrimitiveForAnalyticCone", () => {
  it("builds an exact cone for a circular pointed cone", () => {
    const primitive = cadModifierPrimitiveForAnalyticCone(cone());
    expect(primitive).toEqual({
      kind: "cone",
      baseRadius: 10,
      topRadius: 0,
      height: 20,
    });
  });

  it("keeps both rings of a truncated cone and follows the footprint", () => {
    const primitive = cadModifierPrimitiveForAnalyticCone(cone({
      width: 40,
      depth: 40,
      size: 40,
      baseRadius: 10,
      topRadius: 4,
      height: 30,
    }));
    expect(primitive).toEqual({
      kind: "cone",
      baseRadius: 20,
      topRadius: 8,
      height: 30,
    });
  });

  it("ignores yaw and keeps a move in the placement", () => {
    const moved = cadModifierPrimitiveForAnalyticCone(cone({ x: 4, z: -3, elevation: 2 }));
    const turned = cadModifierPrimitiveForAnalyticCone(cone({ x: 4, z: -3, elevation: 2, rotation: 30 }));
    expect(moved?.transform).toBeDefined();
    expect(turned?.transform).toEqual(moved?.transform);
  });

  it("scales an elliptical footprint onto the exact cone", () => {
    const primitive = cadModifierPrimitiveForAnalyticCone(cone({ width: 30, depth: 18, size: 30 }));
    expect(primitive).toEqual({
      kind: "cone",
      baseRadius: 15,
      topRadius: 0,
      height: 20,
      sectionScale: 0.6,
    });
    const turned = cadModifierPrimitiveForAnalyticCone(cone({ width: 30, depth: 18, size: 30, rotation: 90 }));
    expect(turned?.sectionScale).toBeCloseTo(0.6);
    expect(turned?.transform).toBeDefined();
  });

  it("leaves grouped and imported cones on the mesh path", () => {
    expect(cadModifierPrimitiveForAnalyticCone(cone({
      groupedShapes: [cone({ id: "child" })],
    }))).toBeNull();
    expect(cadModifierPrimitiveForAnalyticCone(cone({
      importedMesh: {
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        baseWidth: 20,
        baseDepth: 20,
        baseHeight: 20,
        triangleCount: 1,
        sourceFormat: "stl",
      },
    }))).toBeNull();
  });
});

describe("cone edges that are not corners", () => {
  it("skips a collapsed tip and a cone seam", () => {
    expect(isDegenerateCurve(0)).toBe(true);
    expect(isDegenerateCurve(1e-6)).toBe(true);
    expect(isDegenerateCurve(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isDegenerateCurve(Math.PI * 20)).toBe(false);
    expect(isAnalyticConeSeam({ curveType: "line", surfaceTypes: ["cone"] })).toBe(true);
    expect(isAnalyticConeSeam({ curveType: "line", surfaceTypes: ["cone", "cone"] })).toBe(true);
    expect(isAnalyticConeSeam({ curveType: "circle", surfaceTypes: ["cone", "plane"] })).toBe(false);
    expect(isAnalyticConeSeam({ curveType: "line", surfaceTypes: ["cone", "plane"] })).toBe(false);
  });
});
