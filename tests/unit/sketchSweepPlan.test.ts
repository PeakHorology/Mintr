import { describe, expect, it } from "vitest";
import { planSketchSweep, placeSketchSweep, resolveSketchSweep, sweepAnchor, sweepSpec } from "@/lib/sketch/sweepPlan";
import type { SketchProfile } from "@/types/sketchforge";

function square(originX = 0, originZ = 0): SketchProfile {
  const points = [
    { id: "a", x: originX, z: originZ },
    { id: "b", x: originX + 10, z: originZ },
    { id: "c", x: originX + 10, z: originZ + 10 },
    { id: "d", x: originX, z: originZ + 10 },
  ];
  return {
    points,
    segments: [
      { id: "ab", startId: "a", endId: "b", kind: "line" },
      { id: "bc", startId: "b", endId: "c", kind: "line" },
      { id: "cd", startId: "c", endId: "d", kind: "line" },
      { id: "da", startId: "d", endId: "a", kind: "line" },
    ],
  };
}

describe("sweep plan", () => {
  it("uses the one closed outline and the one open path", () => {
    const profile = square();
    profile.points.push({ id: "p0", x: 30, z: 0 }, { id: "p1", x: 50, z: 0 });
    profile.segments.push({ id: "path", startId: "p0", endId: "p1", kind: "line" });
    const plan = planSketchSweep(profile);
    expect(plan.outlines).toHaveLength(1);
    expect(plan.paths).toHaveLength(1);
    expect(plan.paths[0]?.closed).toBe(false);
    const anchor = sweepAnchor(plan.outlines[0]!, plan.paths[0]!);
    expect(anchor.pierced).toBe(false);
    expect(anchor.at).toEqual({ x: 5, z: 5 });
  });

  it("keeps a point that already lies on the path", () => {
    const profile = square();
    profile.points.push({ id: "p0", x: 10, z: 0 }, { id: "p1", x: 30, z: 0 });
    profile.segments.push({ id: "path", startId: "p0", endId: "p1", kind: "line" });
    const plan = planSketchSweep(profile);
    const anchor = sweepAnchor(plan.outlines[0]!, plan.paths[0]!);
    expect(anchor.pierced).toBe(true);
    expect(anchor.at).toEqual({ x: 10, z: 0 });
  });

  it("asks for a click when two outlines are on the sheet", () => {
    const profile = square();
    profile.points.push(
      { id: "e", x: 20, z: 0 },
      { id: "f", x: 28, z: 0 },
      { id: "g", x: 28, z: 8 },
      { id: "h", x: 20, z: 8 },
      { id: "p0", x: 40, z: 0 },
      { id: "p1", x: 60, z: 0 },
    );
    profile.segments.push(
      { id: "ef", startId: "e", endId: "f", kind: "line" },
      { id: "fg", startId: "f", endId: "g", kind: "line" },
      { id: "gh", startId: "g", endId: "h", kind: "line" },
      { id: "he", startId: "h", endId: "e", kind: "line" },
      { id: "path", startId: "p0", endId: "p1", kind: "line" },
    );
    const plan = planSketchSweep(profile);
    expect(plan.outlines).toHaveLength(2);
    expect(plan.paths).toHaveLength(1);
  });

  it("treats an ordinary line as the path", () => {
    const profile = square();
    profile.points.push({ id: "p0", x: 30, z: 4 }, { id: "p1", x: 48, z: 4 });
    profile.segments.push({ id: "path", startId: "p0", endId: "p1", kind: "line", construction: true });
    const plan = planSketchSweep(profile);
    expect(plan.paths[0]?.segmentIds).toEqual(["path"]);
    const placed = placeSketchSweep(plan.outlines[0]!, plan.paths[0]!);
    expect(placed?.outer.edges).toHaveLength(4);
    const start = placed?.outer.edges[0];
    expect(start && "from" in start).toBe(true);
  });

  it("stands the section on the path start", () => {
    const profile = square();
    profile.points.push({ id: "p0", x: 20, z: 20 }, { id: "p1", x: 40, z: 20 });
    profile.segments.push({ id: "path", startId: "p0", endId: "p1", kind: "line" });
    const plan = planSketchSweep(profile);
    const placed = placeSketchSweep(plan.outlines[0]!, plan.paths[0]!);
    expect(placed).not.toBeNull();
    const center = { x: 20, y: 0, z: -20 };
    const corners = placed!.outer.edges.flatMap((edge) => [edge.from, edge.to]);
    const nearest = corners.reduce((best, point) => {
      const distance = Math.hypot(point.x - center.x, point.y - center.y, point.z - center.z);
      return distance < best ? distance : best;
    }, Infinity);
    expect(nearest).toBeGreaterThan(4);
    const ys = corners.map((point) => point.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10, 4);
    const spec = sweepSpec(plan.outlines[0]!, plan.paths[0]!);
    expect(resolveSketchSweep(profile, null, spec)?.path.segmentIds).toEqual(["path"]);
  });
});
