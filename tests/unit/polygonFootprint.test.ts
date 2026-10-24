import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { polygonFootprint } from "@/lib/polygonFootprint";

function displayRing(sides: number, width: number, depth: number) {
  const geometry = new THREE.CylinderGeometry(1, 1, 10, sides);
  geometry.scale(width / 2, 1, depth / 2);
  const position = geometry.getAttribute("position");
  const points: Array<[number, number]> = [];
  for (let index = 0; index < position.count; index += 1) {
    if (position.getY(index) > -4) continue;
    const x = position.getX(index);
    const z = position.getZ(index);
    if (Math.hypot(x, z) < 1e-6) continue;
    if (points.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1e-6)) continue;
    points.push([x, z]);
  }
  geometry.dispose();
  return points;
}

function sameVertexSet(actual: Array<{ x: number; z: number }>, expected: Array<[number, number]>) {
  expect(actual).toHaveLength(expected.length);
  for (const point of actual) {
    const hit = expected.some(([x, z]) => Math.hypot(point.x - x, point.z - z) < 1e-6);
    expect(hit).toBe(true);
  }
}

describe("polygonFootprint", () => {
  it("lands on the same vertices as the polygon drawn on screen", () => {
    for (const sides of [3, 5, 6, 8]) {
      sameVertexSet(polygonFootprint(sides, 20, 20), displayRing(sides, 20, 20));
    }
  });

  it("keeps a stretched footprint aligned, not turned a quarter turn", () => {
    const footprint = polygonFootprint(6, 20, 40);
    const displayed = displayRing(6, 20, 40);
    sameVertexSet(footprint, displayed);
    const first = footprint[0];
    expect(Math.abs(first.x)).toBeLessThan(1e-6);
    expect(first.z).toBeCloseTo(20);
  });
});
