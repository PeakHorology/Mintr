import { describe, expect, it } from "vitest";
import { sketchReferenceNode } from "@/lib/sketchReferenceFootprint";
import type { WorkplaneShape } from "@/types/sketchforge";

function shape(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "shape-1",
    name: "Shape",
    kind: "box",
    color: "#d41721",
    x: 40,
    z: 25,
    elevation: 0,
    size: 20,
    width: 30,
    depth: 10,
    height: 8,
    rotation: 15,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

describe("sketchReferenceNode", () => {
  it("draws a box as its footprint in the solid's color, centered in its own frame", () => {
    const node = sketchReferenceNode(shape());
    expect(node.color).toBe("#d41721");
    expect(node.opacity).toBeGreaterThan(0.5);
    expect(node.fillD).toBe("M -15 -5 L 15 -5 L 15 5 L -15 5 Z");
    expect(node.fillD).not.toContain("40");
  });

  it("rounds a box the way the 3D solid is rounded", () => {
    const node = sketchReferenceNode(shape({ radius: 2 }));
    expect(node.fillD).toContain("A 2 2");
  });

  it("draws a cylinder as an ellipse and a polygon as that many sides", () => {
    const cylinder = sketchReferenceNode(shape({ kind: "cylinder", color: "#d97813", width: 20, depth: 12 }));
    expect(cylinder.color).toBe("#d97813");
    expect(cylinder.fillD).toContain("A 10 6");
    const polygon = sketchReferenceNode(shape({ kind: "polygon", sides: 5, width: 20, depth: 20, color: "#3b82f6" }));
    expect(polygon.fillD?.match(/L /g)).toHaveLength(4);
    expect(polygon.fillD).not.toBe(shape() && sketchReferenceNode(shape({ width: 20, depth: 20 })).fillD);
  });

  it("draws a ring as a loop, not a solid oval", () => {
    const node = sketchReferenceNode(shape({ kind: "tube", width: 20, depth: 20, bevel: 3, color: "#ce7013" }));
    expect(node.evenOdd).toBe(true);
    expect(node.fillD?.match(/A /g)?.length).toBe(4);
  });

  it("draws a gear tooth outline in the gear color", () => {
    const node = sketchReferenceNode(shape({ kind: "gear", color: "#2aa77e", width: 44, depth: 44 }));
    expect(node.color).toBe("#2aa77e");
    expect(node.evenOdd).toBe(true);
    expect((node.fillD?.match(/L /g) ?? []).length).toBeGreaterThan(20);
  });

  it("uses the hole color from the 3D view", () => {
    const node = sketchReferenceNode(shape({ hole: true, color: "#d41721" }));
    expect(node.color).toBe("#d0dae2");
  });

  it("projects an imported solid in its local frame and keeps its color", () => {
    const node = sketchReferenceNode(shape({
      kind: "mesh",
      color: "#3b82f6",
      x: 80,
      importedMesh: {
        positions: [0, 0, 0, 10, 0, 0, 0, 0, 10],
        baseWidth: 10,
        baseDepth: 10,
        baseHeight: 1,
        triangleCount: 1,
        sourceFormat: "json",
      },
      width: 10,
      depth: 10,
      height: 1,
    }));
    expect(node.color).toBe("#3b82f6");
    expect(node.fillD).toContain("M 0 0");
    expect(node.fillD).not.toContain("80");
  });

  it("draws grouped children with their own colors instead of one box", () => {
    const node = sketchReferenceNode(shape({
      id: "group",
      width: 40,
      depth: 20,
      height: 8,
      color: "#111111",
      groupedShapes: [
        shape({ id: "a", kind: "cylinder", x: 8, z: 0, width: 6, depth: 6, color: "#d97813" }),
        shape({ id: "b", kind: "box", x: -8, z: 0, width: 4, depth: 4, color: "#3b82f6" }),
      ],
    }));
    expect(node.fillD).toBeNull();
    expect(node.children).toHaveLength(2);
    expect(node.children.map((child) => child.color).sort()).toEqual(["#3b82f6", "#d97813"]);
    expect(node.children.find((child) => child.color === "#d97813")?.fillD).toContain("A ");
  });
});
