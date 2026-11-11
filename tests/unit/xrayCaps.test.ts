import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { sliceOutline } from "../../apps/web/src/lib/xrayCaps";

function totalLength(points: Float32Array) {
  let length = 0;
  for (let i = 0; i + 5 < points.length; i += 6) {
    length += Math.hypot(points[i + 3] - points[i], points[i + 4] - points[i + 1], points[i + 5] - points[i + 2]);
  }
  return length;
}

describe("X-ray section outline", () => {
  it("traces the edge of the cut through a box", () => {
    const box = new THREE.BoxGeometry(20, 10, 6);
    const points = sliceOutline(box, new THREE.Plane(new THREE.Vector3(0, 1, 0), -1));
    expect(points.length % 6).toBe(0);
    expect(totalLength(points)).toBeCloseTo(2 * (20 + 6), 5);
    for (let i = 1; i < points.length; i += 3) expect(points[i]).toBeCloseTo(1, 6);
  });

  it("traces nothing when the plane misses the part", () => {
    const box = new THREE.BoxGeometry(20, 10, 6);
    expect(sliceOutline(box, new THREE.Plane(new THREE.Vector3(0, 1, 0), -50)).length).toBe(0);
  });

  it("lifts the line toward the cut-away side", () => {
    const box = new THREE.BoxGeometry(20, 10, 6);
    const points = sliceOutline(box, new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), 0.01);
    for (let i = 1; i < points.length; i += 3) expect(points[i]).toBeCloseTo(-0.01, 6);
  });

  it("traces both edges of a ring", () => {
    const ring = new THREE.LatheGeometry(
      [new THREE.Vector2(6, -5), new THREE.Vector2(10, -5), new THREE.Vector2(10, 5), new THREE.Vector2(6, 5), new THREE.Vector2(6, -5)],
      64,
    );
    const points = sliceOutline(ring, new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
    const expected = 2 * 64 * (10 + 6) * Math.sin(Math.PI / 64);
    expect(totalLength(points)).toBeCloseTo(expected, 3);
  });
});
