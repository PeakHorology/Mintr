import { describe, expect, it } from "vitest";
import { buildPickBvh, type PickTriangle } from "@/lib/meshPickBvh";
import {
  collectSmallHoleTriangles,
  collectThinWallTriangles,
  gapAlongOutwardRay,
  normalizeNozzleMm,
  thicknessAlongInwardRay,
  triangleIsThin,
} from "@/lib/thinWalls";

function tri(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): PickTriangle {
  return { ax, ay, az, bx, by, bz, cx, cy, cz };
}

function slab(thickness: number): PickTriangle[] {
  const t = thickness;
  return [
    tri(t, 0, 0, t, 10, 0, t, 0, 10),
    tri(t, 10, 0, t, 10, 10, t, 0, 10),
    tri(0, 0, 0, 0, 0, 10, 0, 10, 0),
    tri(0, 10, 0, 0, 0, 10, 0, 10, 10),
    tri(0, 10, 0, 0, 10, 10, t, 10, 0),
    tri(t, 10, 0, 0, 10, 10, t, 10, 10),
    tri(0, 0, 0, t, 0, 0, 0, 0, 10),
    tri(t, 0, 0, t, 0, 10, 0, 0, 10),
    tri(0, 0, 10, t, 0, 10, 0, 10, 10),
    tri(t, 0, 10, t, 10, 10, 0, 10, 10),
    tri(0, 0, 0, 0, 10, 0, t, 0, 0),
    tri(t, 0, 0, 0, 10, 0, t, 10, 0),
  ];
}

describe("thin walls", () => {
  it("clamps nozzle size to the printable range", () => {
    expect(normalizeNozzleMm(0.4)).toBe(0.4);
    expect(normalizeNozzleMm(0.05)).toBe(0.2);
    expect(normalizeNozzleMm(3)).toBe(1.2);
    expect(normalizeNozzleMm("0.6")).toBe(0.6);
    expect(normalizeNozzleMm("nope")).toBe(0.4);
  });

  it("marks a wall only when it is thinner than the nozzle", () => {
    expect(triangleIsThin(0.3, 0.4)).toBe(true);
    expect(triangleIsThin(0.5, 0.4)).toBe(false);
    expect(triangleIsThin(0.01, 0.4)).toBe(false);
  });

  it("measures thickness by shooting inward to the opposite face", () => {
    const tree = buildPickBvh(slab(0.3));
    expect(tree).not.toBeNull();
    const thickness = thicknessAlongInwardRay(0.3, 5, 5, 1, 0, 0, tree!, 0.4);
    expect(thickness).toBeCloseTo(0.3, 3);
  });

  it("collects the thin faces of a slab and ignores a thick one", () => {
    const thin: number[] = [];
    const thick: number[] = [];
    collectThinWallTriangles(slab(0.3), 0.4, thin, []);
    collectThinWallTriangles(slab(0.8), 0.4, thick, []);
    expect(thin.length / 9).toBe(4);
    expect(thick.length).toBe(0);
  });
});

function slot(gap: number): PickTriangle[] {
  return [
    tri(0, 0, 0, 0, 10, 0, 0, 0, 10),
    tri(0, 10, 0, 0, 10, 10, 0, 0, 10),
    tri(gap, 0, 0, gap, 0, 10, gap, 10, 0),
    tri(gap, 10, 0, gap, 0, 10, gap, 10, 10),
  ];
}

describe("small holes", () => {
  it("measures a slot by shooting outward across the gap", () => {
    const tree = buildPickBvh(slot(0.3));
    expect(tree).not.toBeNull();
    const gap = gapAlongOutwardRay(0, 5, 5, 1, 0, 0, tree!, 0.4);
    expect(gap).toBeCloseTo(0.3, 3);
  });

  it("marks a slot narrower than the nozzle and ignores a wide one", () => {
    const narrow: number[] = [];
    const wide: number[] = [];
    collectSmallHoleTriangles(slot(0.3), 0.4, narrow, []);
    collectSmallHoleTriangles(slot(0.8), 0.4, wide, []);
    expect(narrow.length / 9).toBe(4);
    expect(wide.length).toBe(0);
  });

  it("does not treat a thin plate as a hole", () => {
    const holes: number[] = [];
    collectSmallHoleTriangles(slab(0.3), 0.4, holes, []);
    expect(holes.length).toBe(0);
  });
});
