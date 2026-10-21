import { describe, expect, it } from "vitest";
import type { PickTriangle } from "@/lib/meshPickBvh";
import { collectTrappedCavityTriangles } from "@/lib/trappedResin";

function tri(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): PickTriangle {
  return { ax, ay, az, bx, by, bz, cx, cy, cz };
}

function box(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
  invert = false,
): PickTriangle[] {
  const faces: PickTriangle[] = [
    tri(maxX, minY, minZ, maxX, maxY, minZ, maxX, minY, maxZ),
    tri(maxX, maxY, minZ, maxX, maxY, maxZ, maxX, minY, maxZ),
    tri(minX, minY, minZ, minX, minY, maxZ, minX, maxY, minZ),
    tri(minX, maxY, minZ, minX, minY, maxZ, minX, maxY, maxZ),
    tri(minX, maxY, minZ, minX, maxY, maxZ, maxX, maxY, minZ),
    tri(maxX, maxY, minZ, minX, maxY, maxZ, maxX, maxY, maxZ),
    tri(minX, minY, minZ, maxX, minY, minZ, minX, minY, maxZ),
    tri(maxX, minY, minZ, maxX, minY, maxZ, minX, minY, maxZ),
    tri(minX, minY, maxZ, maxX, minY, maxZ, minX, maxY, maxZ),
    tri(maxX, minY, maxZ, maxX, maxY, maxZ, minX, maxY, maxZ),
    tri(minX, minY, minZ, minX, maxY, minZ, maxX, minY, minZ),
    tri(maxX, minY, minZ, minX, maxY, minZ, maxX, maxY, minZ),
  ];
  if (!invert) return faces;
  return faces.map((face) => tri(
    face.ax, face.ay, face.az,
    face.cx, face.cy, face.cz,
    face.bx, face.by, face.bz,
  ));
}

describe("trapped resin", () => {
  it("does not mark a solid box", () => {
    const marked: number[] = [];
    collectTrappedCavityTriangles(box(0, 0, 0, 10, 10, 10), marked, []);
    expect(marked.length).toBe(0);
  });

  it("marks the inner faces of a sealed cavity", () => {
    const marked: number[] = [];
    const hollow = [
      ...box(0, 0, 0, 10, 10, 10),
      ...box(2, 2, 2, 8, 8, 8, true),
    ];
    collectTrappedCavityTriangles(hollow, marked, []);
    expect(marked.length / 9).toBe(12);
    for (let index = 0; index < marked.length; index += 3) {
      expect(marked[index]).toBeGreaterThanOrEqual(2);
      expect(marked[index]).toBeLessThanOrEqual(8);
    }
  });

  it("marks a 20 mm sealed hollow with 2 mm walls", () => {
    const marked: number[] = [];
    const hollow = [
      ...box(-10, 0, -10, 10, 20, 10),
      ...box(-8, 2, -8, 8, 18, 8, true),
    ];
    collectTrappedCavityTriangles(hollow, marked, []);
    expect(marked.length / 9).toBe(12);
    for (let index = 0; index < marked.length; index += 3) {
      expect(Math.abs(marked[index])).toBeLessThanOrEqual(8);
    }
  });

  it("leaves an open cup clear", () => {
    const marked: number[] = [];
    const withoutLid = (_: PickTriangle, index: number) => index < 4 || index > 5;
    const cup = [
      ...box(0, 0, 0, 10, 10, 10).filter(withoutLid),
      ...box(2, 2, 2, 8, 8, 8, true).filter(withoutLid),
    ];
    collectTrappedCavityTriangles(cup, marked, []);
    expect(marked.length).toBe(0);
  });
});
