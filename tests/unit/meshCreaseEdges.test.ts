import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { meshCreaseEdges } from "@/lib/meshCreaseEdges";

/** A closed box from triangles; `split` adds a T-junction on the top: a corner part way along an edge. */
function box(split: boolean) {
  const positions: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  const [x0, x1, y0, y1, z0, z1] = [0, 10, 0, 10, 0, 10];
  // Top, wound to face up; with `split`, one half is two triangles meeting at the middle of the diagonal.
  if (split) {
    const mid = [5, y1, 5];
    positions.push(x0, y1, z0, x0, y1, z1, x1, y1, z1);
    positions.push(x0, y1, z0, ...mid, x1, y1, z0);
    positions.push(...mid, x1, y1, z1, x1, y1, z0);
  } else {
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
  }
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
  return positions;
}

const segments = (lines: Float32Array) => lines.length / 6;

describe("mesh crease edges", () => {
  it("draws a box's 12 edges and nothing across its faces", () => {
    expect(segments(meshCreaseEdges(box(false), null, 20))).toBe(12);
  });

  it("draws no line across a flat face that has a T-junction", () => {
    const positions = box(true);
    // EdgesGeometry draws the T-junction's three edges across the top.
    const three = new THREE.EdgesGeometry(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)), 20);
    expect(three.getAttribute("position").count / 2).toBe(15);
    expect(segments(meshCreaseEdges(positions, null, 20))).toBe(12);
  });

  it("draws no fan across a flat face made of slivers, and keeps its rim", () => {
    // A flat disc of thin wedges from the centre; a fan like the cut face of a Split.
    const sides = 400;
    const positions: number[] = [];
    for (let i = 0; i < sides; i += 1) {
      const a = (i / sides) * Math.PI * 2;
      const b = ((i + 1) / sides) * Math.PI * 2;
      positions.push(0, 0, 0, Math.cos(b) * 10, 0, Math.sin(b) * 10, Math.cos(a) * 10, 0, Math.sin(a) * 10);
    }
    const lines = meshCreaseEdges(positions, null, 20);
    // Only the open rim: one segment per wedge, none from the centre.
    expect(segments(lines)).toBe(sides);
    for (let i = 0; i < lines.length; i += 3) expect(Math.hypot(lines[i], lines[i + 2])).toBeCloseTo(10, 3);
  });
});
