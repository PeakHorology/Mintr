import { describe, expect, it } from "vitest";
import { buildPickBvh, packPickTriangles, raycastPickBvh, triangleCount, type PickTriangle } from "@/lib/meshPickBvh";

function triangle(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): PickTriangle {
  return { ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], cx: c[0], cy: c[1], cz: c[2] };
}

describe("mesh pick index", () => {
  it("hits the near triangle and skips one that only shares the ray on screen", () => {
    const near = triangle([0, 0, 0], [2, 0, 0], [0, 2, 0]);
    const far = triangle([0, 0, 10], [2, 0, 10], [0, 2, 10]);
    const extras = Array.from({ length: 40 }, (_, index) => triangle(
      [20 + index, 0, 0],
      [21 + index, 0, 0],
      [20 + index, 1, 0],
    ));
    const root = buildPickBvh([far, ...extras, near]);
    expect(root).not.toBeNull();
    const hit = raycastPickBvh(root!, { x: 0.4, y: 0.4, z: 5 }, { x: 0, y: 0, z: -1 });
    expect(hit).not.toBeNull();
    expect(hit!.z).toBeCloseTo(0, 4);
    expect(hit!.t).toBeCloseTo(5, 4);
  });

  it("gives the same answer from a flat soup as from objects, on a large mesh", () => {
    const triangles: PickTriangle[] = [];
    // A grid of upward-facing triangles at varying heights, plus a near target.
    for (let gx = 0; gx < 30; gx += 1) {
      for (let gz = 0; gz < 30; gz += 1) {
        const y = ((gx * 7 + gz * 3) % 11) + 1;
        triangles.push(triangle([gx, y, gz], [gx + 1, y, gz], [gx, y, gz + 1]));
      }
    }
    const fromObjects = buildPickBvh(triangles)!;
    const fromSoup = buildPickBvh(packPickTriangles(triangles))!;
    expect(triangleCount(fromSoup.data)).toBe(900);
    for (let probe = 0; probe < 50; probe += 1) {
      const origin = { x: 0.3 + (probe * 0.61) % 29, y: 50, z: 0.3 + (probe * 1.37) % 29 };
      const direction = { x: 0, y: -1, z: 0 };
      const a = raycastPickBvh(fromObjects, origin, direction, true);
      const b = raycastPickBvh(fromSoup, origin, direction, true);
      expect(b?.t).toBe(a?.t);
      expect(b?.y).toBe(a?.y);
    }
  });

  it("rejects a back face unless both sides count", () => {
    const root = buildPickBvh([triangle([0, 0, 0], [0, 2, 0], [2, 0, 0])]);
    const origin = { x: 0.4, y: 0.4, z: 5 };
    const direction = { x: 0, y: 0, z: -1 };
    expect(raycastPickBvh(root!, origin, direction)).toBeNull();
    expect(raycastPickBvh(root!, origin, direction, true)?.z).toBeCloseTo(0, 4);
  });
});
