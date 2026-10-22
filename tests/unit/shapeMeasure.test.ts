import { describe, expect, it } from "vitest";
import { measureWorkplaneShape } from "@/lib/shapeMeasure";
import type { WorkplaneShape } from "@/types/sketchforge";

function cubeMesh(): WorkplaneShape {
  const positions: number[] = [];
  const faces: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [
    [[0, 0, 0], [10, 0, 0], [10, 10, 0]],
    [[0, 0, 0], [10, 10, 0], [0, 10, 0]],
    [[0, 0, 10], [10, 10, 10], [10, 0, 10]],
    [[0, 0, 10], [0, 10, 10], [10, 10, 10]],
    [[0, 0, 0], [0, 10, 0], [0, 10, 10]],
    [[0, 0, 0], [0, 10, 10], [0, 0, 10]],
    [[10, 0, 0], [10, 0, 10], [10, 10, 10]],
    [[10, 0, 0], [10, 10, 10], [10, 10, 0]],
    [[0, 0, 0], [10, 0, 10], [10, 0, 0]],
    [[0, 0, 0], [0, 0, 10], [10, 0, 10]],
    [[0, 10, 0], [10, 10, 0], [10, 10, 10]],
    [[0, 10, 0], [10, 10, 10], [0, 10, 10]],
  ];
  for (const [a, b, c] of faces) positions.push(...a, ...b, ...c);
  return {
    id: "cube",
    name: "Cube",
    kind: "mesh",
    color: "#d41721",
    x: 0,
    z: 0,
    elevation: 0,
    size: 10,
    width: 10,
    depth: 10,
    height: 10,
    rotation: 0,
    locked: false,
    hidden: false,
    importedMesh: {
      positions,
      baseWidth: 10,
      baseDepth: 10,
      baseHeight: 10,
      triangleCount: 12,
      sourceFormat: "json",
    },
  };
}

describe("shape measure", () => {
  it("falls back to triangle-soup volume and area without a kernel", async () => {
    const measure = await measureWorkplaneShape(cubeMesh());
    expect(measure?.source).toBe("mesh");
    expect(measure?.volume).toBeCloseTo(1000, 0);
    expect(measure?.area).toBeCloseTo(600, 0);
  });
});
