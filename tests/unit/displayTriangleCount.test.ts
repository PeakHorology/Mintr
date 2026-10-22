import { describe, expect, it } from "vitest";
import {
  booleanWorkingQuality,
  displayTriangleCount,
  displayTriangleTotal,
  HEAVY_DISPLAY_TRIANGLES,
  isHeavyBooleanSelection,
  isHeavyDisplayScene,
  LIVE_OCCT_BOOLEAN_OPERANDS,
  shouldSkipLiveOcctBoolean,
} from "@/lib/displayTriangleCount";
import type { WorkplaneShape } from "@/types/sketchforge";

function shape(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "shape-1",
    name: "Shape",
    kind: "box",
    color: "#d41721",
    x: 0,
    z: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

describe("display triangle count", () => {
  it("counts native catalog solids, not only imported meshes", () => {
    const box = shape({ id: "box", kind: "box" });
    const cylinder = shape({ id: "cyl", kind: "cylinder" });
    const sphere = shape({ id: "sph", kind: "sphere" });
    expect(displayTriangleCount(box, "standard")).toBe(12);
    expect(displayTriangleCount(cylinder, "standard")).toBeGreaterThan(500);
    expect(displayTriangleCount(sphere, "standard")).toBeGreaterThan(8_000);
    expect(displayTriangleTotal([box, cylinder, sphere], "draft")).toBeLessThan(
      displayTriangleTotal([box, cylinder, sphere], "smooth"),
    );
  });

  it("uses the evaluated mesh on a grouped body instead of counting children twice", () => {
    const body = shape({
      id: "group",
      kind: "box",
      importedMesh: {
        positions: [0, 0, 0],
        baseWidth: 20,
        baseDepth: 20,
        baseHeight: 20,
        triangleCount: 4_200,
        sourceFormat: "json",
      },
      groupedShapes: [
        shape({ id: "a", kind: "sphere" }),
        shape({ id: "b", kind: "sphere" }),
      ],
    });
    expect(displayTriangleCount(body, "smooth")).toBe(4_200);
  });

  it("skips hidden and construction bodies", () => {
    expect(displayTriangleCount(shape({ hidden: true, kind: "sphere" }), "smooth")).toBe(0);
    expect(displayTriangleCount(shape({ construction: true, kind: "sphere" }), "smooth")).toBe(0);
  });

  it("treats a native Smooth scene as heavy even with no STL import", () => {
    const boxesAndCylinders = [
      ...Array.from({ length: 10 }, (_, i) => shape({ id: `box-${i}`, kind: "box" })),
      ...Array.from({ length: 8 }, (_, i) => shape({ id: `cyl-${i}`, kind: "cylinder" })),
    ];
    expect(displayTriangleTotal(boxesAndCylinders, "smooth")).toBeGreaterThan(5_000);
    expect(displayTriangleTotal(boxesAndCylinders, "standard")).toBeLessThan(
      displayTriangleTotal(boxesAndCylinders, "smooth"),
    );
    const sixSpheres = Array.from({ length: 6 }, (_, i) => shape({ id: `sph-${i}`, kind: "sphere" }));
    expect(isHeavyDisplayScene(sixSpheres, "smooth")).toBe(true);
    expect(isHeavyDisplayScene(sixSpheres, "draft")).toBe(false);
    expect(HEAVY_DISPLAY_TRIANGLES).toBe(80_000);
  });

  it("drops Group tessellation to draft for large multi-body parts", () => {
    const pair = [shape({ id: "a", kind: "cylinder" }), shape({ id: "b", kind: "cylinder" })];
    const many = Array.from({ length: 20 }, (_, i) => shape({ id: `c${i}`, kind: "cylinder" }));
    expect(booleanWorkingQuality(pair, "smooth")).toBe("standard");
    expect(booleanWorkingQuality(many, "smooth")).toBe("draft");
    expect(shouldSkipLiveOcctBoolean(pair)).toBe(false);
    expect(shouldSkipLiveOcctBoolean(
      Array.from({ length: LIVE_OCCT_BOOLEAN_OPERANDS + 1 }, (_, i) => shape({ id: `b${i}` })),
    )).toBe(true);
    expect(isHeavyBooleanSelection(many)).toBe(true);
  });
});
