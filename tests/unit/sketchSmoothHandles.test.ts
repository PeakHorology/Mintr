import { describe, expect, it } from "vitest";
import {
  settleBezierSegment,
  smoothOneSketchPoint,
  splitSketchSegmentAt,
  withSketchPointMode,
  withSmoothSketchHandles,
} from "@/lib/sketchProfileShape";
import type { SketchProfile, SketchPoint } from "@/types/sketchforge";

function point(id: string, x: number, z: number, extra: Partial<SketchPoint> = {}): SketchPoint {
  return { id, x, z, ...extra };
}

function chain(points: SketchPoint[], kind: "line" | "bezier" | "smooth" = "line"): SketchProfile {
  return {
    points,
    segments: points.slice(1).map((end, index) => ({
      id: `s${index}`,
      startId: points[index].id,
      endId: end.id,
      kind,
    })),
  };
}

function cubicAt(
  p0: { x: number; z: number },
  c1: { x: number; z: number },
  c2: { x: number; z: number },
  p3: { x: number; z: number },
  t: number,
) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    z: u * u * u * p0.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * p3.z,
  };
}

describe("smooth sketch handles", () => {
  it("keeps a short edge from looping when the next edge is much longer", () => {
    // A sixth of the span from the first point to the last put the middle
    // handle eleven millimetres behind the start, so the short curve swung
    // back around itself.
    const smoothed = withSmoothSketchHandles(chain([
      point("a", 0, 0),
      point("b", 5, 0),
      point("c", 100, 0),
    ], "smooth"));
    const middle = smoothed.points.find((entry) => entry.id === "b")!;
    expect(middle.handleIn!.x).toBeGreaterThan(0);
    expect(middle.handleIn!.x).toBeLessThan(5);
    expect(middle.handleOut!.x).toBeGreaterThan(5);
    expect(middle.handleOut!.x).toBeLessThan(100);
    const start = smoothed.points.find((entry) => entry.id === "a")!;
    for (let step = 0; step <= 12; step += 1) {
      const sample = cubicAt(start, start.handleOut ?? start, middle.handleIn ?? middle, middle, step / 12);
      expect(sample.x).toBeGreaterThan(-0.2);
      expect(sample.x).toBeLessThan(5.2);
    }
  });

  it("bows a straight line point so the curve and its handles leave the line", () => {
    const smoothed = smoothOneSketchPoint(chain([
      point("a", 0, 0),
      point("b", 20, 0),
      point("c", 50, 0),
    ]), "b");
    const middle = smoothed.points.find((entry) => entry.id === "b")!;
    expect(Math.abs(middle.handleIn!.z)).toBeGreaterThan(0.5);
    expect(Math.abs(middle.handleOut!.z)).toBeGreaterThan(0.5);
    const kept = withSmoothSketchHandles(chain([
      point("a", 0, 0),
      point("b", 20, 0),
      point("c", 50, 0),
    ], "smooth"));
    expect(Math.abs(kept.points.find((entry) => entry.id === "b")!.handleIn!.z)).toBeLessThan(0.01);
  });

  it("bows an endpoint and leaves a real corner on its through-tangent", () => {
    const end = smoothOneSketchPoint(chain([
      point("a", 0, 0),
      point("b", 20, 0),
    ]), "b").points.find((entry) => entry.id === "b")!;
    expect(Math.abs(end.handleIn!.z)).toBeGreaterThan(0.5);

    const corner = smoothOneSketchPoint(chain([
      point("a", 0, 0),
      point("b", 10, 0),
      point("c", 10, 10),
    ]), "b").points.find((entry) => entry.id === "b")!;
    const dx = corner.handleOut!.x - corner.x;
    const dz = corner.handleOut!.z - corner.z;
    const along = (dx + dz) / Math.hypot(dx, dz) / Math.SQRT2;
    expect(along).toBeGreaterThan(0.98);
  });

  it("curves one clicked point and leaves the next click free to curve another", () => {
    const once = withSketchPointMode(chain([
      point("a", 0, 0),
      point("b", 20, 0),
      point("c", 40, 0),
    ]), "b", "smooth");
    expect(once.segments.every((segment) => segment.kind === "bezier")).toBe(true);
    expect(Math.abs(once.points.find((entry) => entry.id === "b")!.handleIn!.z)).toBeGreaterThan(0.5);
    const twice = withSketchPointMode(once, "c", "smooth");
    expect(twice.points.find((entry) => entry.id === "b")!.mode).toBe("smooth");
    expect(Math.abs(twice.points.find((entry) => entry.id === "c")!.handleIn!.z)).toBeGreaterThan(0.5);
  });

  it("bends the segment from the curved point even when the other end has no handle", () => {
    const smoothed = smoothOneSketchPoint(chain([
      point("a", 0, 0),
      point("b", 30, 0),
    ]), "b");
    const start = smoothed.points.find((entry) => entry.id === "a")!;
    const end = smoothed.points.find((entry) => entry.id === "b")!;
    const mid = cubicAt(start, start.handleOut ?? start, end.handleIn ?? end, end, 0.5);
    expect(Math.abs(mid.z)).toBeGreaterThan(0.4);
  });

  it("smooths one point and leaves the rest of the path alone", () => {
    const profile = chain([
      point("a", 0, 0, { mode: "smooth", handleIn: { x: -2, z: 4 }, handleOut: { x: 2, z: -4 } }),
      point("b", 10, 0),
      point("c", 20, 8, { mode: "split", handleIn: { x: 16, z: 8 }, handleOut: { x: 24, z: 12 } }),
    ]);
    const smoothed = smoothOneSketchPoint(profile, "b");
    const kept = smoothed.points.find((entry) => entry.id === "c")!;
    expect(kept.handleOut).toEqual({ x: 24, z: 12 });
    const middle = smoothed.points.find((entry) => entry.id === "b")!;
    expect(middle.mode).toBe("smooth");
    expect(middle.handleIn).toBeDefined();
    expect(Math.hypot(middle.handleIn!.x - 10, middle.handleIn!.z)).toBeLessThan(10 / 3 + 0.01);
  });
});

describe("bezier pen join", () => {
  it("shortens the new segment's handles so they cannot pass the other point", () => {
    const profile = chain([
      point("a", 0, 0, { mode: "smooth", handleOut: { x: 80, z: 0 }, handleIn: { x: -80, z: 0 } }),
      point("b", 10, 0, { mode: "smooth", handleIn: { x: -40, z: 0 }, handleOut: { x: 70, z: 30 } }),
    ], "bezier");
    const settled = settleBezierSegment(profile, "a", "b");
    const start = settled.points.find((entry) => entry.id === "a")!;
    const end = settled.points.find((entry) => entry.id === "b")!;
    expect(Math.hypot(start.handleOut!.x, start.handleOut!.z)).toBeCloseTo(5, 5);
    expect(Math.hypot(end.handleIn!.x - 10, end.handleIn!.z)).toBeCloseTo(5, 5);
    // The outgoing handle is the tangent for the next segment, so it stays.
    expect(end.handleOut).toEqual({ x: 70, z: 30 });
    expect(profile.points.find((entry) => entry.id === "a")!.handleOut).toEqual({ x: 80, z: 0 });
  });
});

describe("insert point on a curve", () => {
  it("splits a cubic without moving the curve", () => {
    const start = point("a", 0, 0, { handleOut: { x: 0, z: 30 } });
    const end = point("b", 40, 0, { handleIn: { x: 40, z: 30 } });
    const profile = chain([start, end], "bezier");
    const mid = cubicAt(start, start.handleOut!, end.handleIn!, end, 0.5);
    const inserted = splitSketchSegmentAt(profile, "s0", mid);
    expect(inserted).not.toBeNull();
    const added = inserted!.profile.points.find((entry) => entry.id === inserted!.pointId)!;
    expect(added.x).toBeCloseTo(mid.x, 1);
    expect(added.z).toBeCloseTo(mid.z, 1);
    expect(added.mode).toBe("split");
    const left = inserted!.profile.segments.find((entry) => entry.endId === added.id)!;
    const right = inserted!.profile.segments.find((entry) => entry.startId === added.id)!;
    const leftStart = inserted!.profile.points.find((entry) => entry.id === left.startId)!;
    const rightEnd = inserted!.profile.points.find((entry) => entry.id === right.endId)!;
    const joined = cubicAt(leftStart, leftStart.handleOut!, added.handleIn!, added, 1);
    expect(joined.x).toBeCloseTo(added.x, 5);
    expect(joined.z).toBeCloseTo(added.z, 5);
    const carried = cubicAt(added, added.handleOut!, rightEnd.handleIn!, rightEnd, 0);
    expect(carried.x).toBeCloseTo(added.x, 5);
    for (let step = 0; step <= 4; step += 1) {
      const t = step / 4;
      const original = cubicAt(start, start.handleOut!, end.handleIn!, end, t * 0.5);
      const piece = cubicAt(leftStart, leftStart.handleOut!, added.handleIn!, added, t);
      expect(piece.x).toBeCloseTo(original.x, 4);
      expect(piece.z).toBeCloseTo(original.z, 4);
    }
  });

  it("puts a point added to a line on the line", () => {
    const profile = chain([point("a", 0, 0), point("b", 20, 0)]);
    const inserted = splitSketchSegmentAt(profile, "s0", { x: 10, z: 4 });
    const added = inserted!.profile.points.find((entry) => entry.id === inserted!.pointId)!;
    expect(added.x).toBeCloseTo(10, 5);
    expect(added.z).toBeCloseTo(0, 5);
    expect(added.mode).toBe("corner");
  });
});
