import { describe, expect, it } from "vitest";
import { clipPolylineToSurface, indexMeshSurface, SURFACE_LINE_TOLERANCE } from "@/lib/clipEdgesToMesh";

const square = indexMeshSurface([
  0, 0, 0, 10, 0, 0, 0, 0, 10,
  10, 0, 0, 10, 0, 10, 0, 0, 10,
]);

function extent(points: number[], axis: number) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = axis; index < points.length; index += 3) {
    min = Math.min(min, points[index]);
    max = Math.max(max, points[index]);
  }
  return { min, max };
}

describe("clipPolylineToSurface", () => {
  it("keeps a line that lies on the face", () => {
    const line = [0, 0, 5, 10, 0, 5];
    expect(clipPolylineToSurface(line, square, SURFACE_LINE_TOLERANCE)).toEqual([line]);
  });

  it("drops a line that hangs clear of the face", () => {
    expect(clipPolylineToSurface([0, 2, 5, 10, 2, 5], square, SURFACE_LINE_TOLERANCE)).toEqual([]);
  });

  it("trims the part of an edge that runs off the face, including a corner that sticks past the cut", () => {
    const [kept] = clipPolylineToSurface([-2, 0, 5, 12, 0, 5], square, SURFACE_LINE_TOLERANCE);
    const x = extent(kept, 0);
    expect(x.min).toBeCloseTo(-SURFACE_LINE_TOLERANCE, 1);
    expect(x.max).toBeCloseTo(10 + SURFACE_LINE_TOLERANCE, 1);
    expect(extent(kept, 1).max).toBeCloseTo(0, 5);
  });
});
