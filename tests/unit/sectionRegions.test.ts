import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { assignHatchStyles, buildRegions, joinSegments, measureAt, stripThickness } from "../../apps/web/src/lib/sectionRegions";
import { sliceSegments } from "../../apps/web/src/lib/xrayCaps";

/** Cut a mesh across Y = height and give the pieces as flat x, z pairs. */
function flatSlice(geometry: THREE.BufferGeometry, height: number) {
  const points = sliceSegments(geometry, new THREE.Plane(new THREE.Vector3(0, 1, 0), -height));
  const flat: number[] = [];
  for (let i = 0; i < points.length; i += 3) flat.push(points[i], points[i + 2]);
  return flat;
}

function ring(inner: number, outer: number, sides = 64) {
  return new THREE.LatheGeometry(
    [new THREE.Vector2(inner, -5), new THREE.Vector2(outer, -5), new THREE.Vector2(outer, 5), new THREE.Vector2(inner, 5), new THREE.Vector2(inner, -5)],
    sides,
  );
}

describe("X-ray section regions", () => {
  it("joins a box cut into one solid patch", () => {
    const regions = buildRegions(joinSegments(flatSlice(new THREE.BoxGeometry(20, 10, 6), 1)));
    expect(regions).toHaveLength(1);
    expect(regions[0].area).toBeCloseTo(120, 5);
    expect(regions[0].thickness).toBeCloseTo(6, 5);
  });

  it("finds the hole in a ring and its wall thickness", () => {
    const regions = buildRegions(joinSegments(flatSlice(ring(8, 10), 0)));
    expect(regions).toHaveLength(1);
    expect(regions[0].holes).toHaveLength(1);
    // A ring's wall comes out within a few percent.
    expect(regions[0].thickness).toBeGreaterThan(1.9);
    expect(regions[0].thickness).toBeLessThan(2.15);
  });

  it("keeps separate pieces separate", () => {
    const a = new THREE.BoxGeometry(4, 4, 4);
    const b = new THREE.BoxGeometry(4, 4, 4).translate(10, 0, 0);
    const flat = [...flatSlice(a, 0), ...flatSlice(b, 0)];
    expect(buildRegions(joinSegments(flat))).toHaveLength(2);
  });

  it("reads a strip's thickness exactly and a round patch near its width", () => {
    expect(stripThickness(2 * 30, 2 * (2 + 30))).toBeCloseTo(2, 9);
    const r = 5;
    const round = stripThickness(Math.PI * r * r, 2 * Math.PI * r);
    expect(round).toBeGreaterThan(r);
    expect(round).toBeLessThan(2 * r);
  });

  it("measures a wall straight across", () => {
    const regions = buildRegions(joinSegments(flatSlice(ring(8, 10, 128), 0)));
    const wall = measureAt(regions, { x: 8.6, y: 0 });
    expect(wall?.kind).toBe("wall");
    expect(wall!.length).toBeCloseTo(2, 2);
  });

  it("measures the gap between two parts and across a hole", () => {
    const a = new THREE.BoxGeometry(4, 4, 4);
    const b = new THREE.BoxGeometry(4, 4, 4).translate(5, 0, 0);
    const regions = buildRegions(joinSegments([...flatSlice(a, 0), ...flatSlice(b, 0)]));
    const gap = measureAt(regions, { x: 2.3, y: 0.5 });
    expect(gap?.kind).toBe("gap");
    expect(gap!.length).toBeCloseTo(1, 6);

    const hole = measureAt(buildRegions(joinSegments(flatSlice(ring(8, 10, 128), 0))), { x: 0.5, y: 0 });
    expect(hole?.kind).toBe("gap");
    expect(hole!.length).toBeCloseTo(16, 1);
  });

  it("measures nothing out in the open", () => {
    const regions = buildRegions(joinSegments(flatSlice(new THREE.BoxGeometry(4, 4, 4), 0)));
    expect(measureAt(regions, { x: 30, y: 0 })).toBeNull();
  });

  it("gives parts that meet different hatch styles and keeps a style that still works", () => {
    const left = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const touching = { minX: 10, minY: 0, maxX: 20, maxY: 10 };
    const far = { minX: 100, minY: 0, maxX: 110, maxY: 10 };
    expect(assignHatchStyles([left, touching, far], [], 4, 0.5)).toEqual([0, 1, 0]);
    expect(assignHatchStyles([left, touching], [1, 0], 4, 0.5)).toEqual([1, 0]);
    expect(assignHatchStyles([left, touching], [0, 0], 4, 0.5)).toEqual([0, 1]);
  });
});
