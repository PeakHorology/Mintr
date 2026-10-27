import { describe, expect, it } from "vitest";
import { composeSketchProfile, geometryForSketchPart, offsetRingForCommand, offsetStraightRing, offsetTargetForCommand, offsetTargetHit, onlyClosedStraightRing, resizeSketchOutline, sketchOffsetAt, sketchOutlineSize } from "@/lib/sketchDrawShapes";
import { parseDimensionEntry } from "@/lib/dimensionEntry";
import { uniformScalePatch } from "@/lib/uniformScale";

describe("geometryForSketchPart", () => {
  it("draws a rectangle and a circle the sketch tools would draw", () => {
    const rectangle = geometryForSketchPart({ kind: "rectangle", width: 40, depth: 20 });
    const circle = geometryForSketchPart({ kind: "circle", x: 8, radius: 4 });
    expect(rectangle?.points).toHaveLength(4);
    expect(rectangle?.segments).toHaveLength(4);
    expect(circle?.segments.every((segment) => segment.kind === "bezier")).toBe(true);
    const profile = composeSketchProfile([rectangle!, circle!]);
    expect(profile.points).toHaveLength(8);
    expect(profile.segments).toHaveLength(8);
  });

  it("closes a polyline into a loop", () => {
    const line = geometryForSketchPart({
      kind: "line",
      closed: true,
      points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 10 }],
    });
    expect(line?.segments).toHaveLength(3);
  });

  it("copies a whole closed rectangle when an edge is dragged outward", () => {
    const rectangle = geometryForSketchPart({ kind: "rectangle", width: 40, depth: 20 });
    const profile = composeSketchProfile([rectangle!]);
    const offset = sketchOffsetAt(profile, profile.segments[0].id, { x: 0, z: -20 });
    expect(offset).not.toBe("curve");
    if (!offset || offset === "curve") throw new Error("expected a closed offset");
    expect(offset.closed).toBe(true);
    const xs = offset.preview.map((point) => point.x);
    const zs = offset.preview.map((point) => point.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(60, 3);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(40, 3);
  });

  it("grows or shrinks the only closed outline by a typed distance", () => {
    const rectangle = geometryForSketchPart({ kind: "rectangle", width: 40, depth: 20 });
    const profile = composeSketchProfile([rectangle!]);
    const ring = onlyClosedStraightRing(profile);
    expect(ring).toHaveLength(4);
    const grown = offsetStraightRing(ring!, 5);
    const shrunk = offsetStraightRing(ring!, -2);
    const span = (points: Array<{ x: number; z: number }>) => {
      const xs = points.map((point) => point.x);
      const zs = points.map((point) => point.z);
      return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...zs) - Math.min(...zs) };
    };
    expect(span(grown!.preview)).toEqual({ width: 50, depth: 30 });
    expect(span(shrunk!.preview)).toEqual({ width: 36, depth: 16 });
    const second = geometryForSketchPart({ kind: "rectangle", x: 80, width: 10, depth: 10 });
    const both = composeSketchProfile([rectangle!, second!]);
    expect(onlyClosedStraightRing(both)).toBeNull();
    const chosen = offsetRingForCommand(both, [second!.points.map((point) => point.id)], []);
    expect(chosen).toHaveLength(4);
    expect(Math.max(...chosen!.map((point) => point.x))).toBeGreaterThan(70);
  });

  it("grows a circle into a larger circle and shrinks a rounded rectangle", () => {
    const circle = geometryForSketchPart({ kind: "circle", radius: 10 });
    const profile = composeSketchProfile([circle!]);
    const target = offsetTargetForCommand(profile, [], []);
    expect(target?.closed).toBe(true);
    const grown = offsetTargetHit(profile, target!, 5);
    expect(grown?.geometry.segments.every((segment) => segment.kind === "bezier")).toBe(true);
    for (const point of grown!.geometry.points) {
      expect(Math.hypot(point.x, point.z)).toBeCloseTo(15, 2);
    }
    expect(offsetTargetHit(profile, target!, -9.9)).toBeNull();

    const rounded = geometryForSketchPart({ kind: "roundedRect", width: 40, depth: 20 });
    const roundProfile = composeSketchProfile([rounded!]);
    const roundTarget = offsetTargetForCommand(roundProfile, [], []);
    const roundHit = offsetTargetHit(roundProfile, roundTarget!, 5);
    const xs = roundHit!.preview.map((point) => point.x);
    const zs = roundHit!.preview.map((point) => point.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(50, 1);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(30, 1);
    expect(roundHit!.geometry.segments.some((segment) => segment.kind === "bezier")).toBe(true);

    const arc = geometryForSketchPart({
      kind: "arc",
      start: { x: 10, z: 0 },
      end: { x: 0, z: 10 },
      through: { x: 7.071, z: 7.071 },
    });
    const arcProfile = composeSketchProfile([arc!]);
    const arcTarget = offsetTargetForCommand(arcProfile, [], []);
    const arcHit = offsetTargetHit(arcProfile, arcTarget!, 4);
    for (const point of [arcHit!.geometry.points[0], arcHit!.geometry.points[arcHit!.geometry.points.length - 1]]) {
      expect(Math.hypot(point.x, point.z)).toBeCloseTo(14, 1);
    }
    expect(arcHit!.closed).toBe(false);
  });

  it("copies one line when the sketch is not a closed outline", () => {
    const line = geometryForSketchPart({ kind: "line", points: [{ x: 0, z: 0 }, { x: 20, z: 0 }] });
    const profile = composeSketchProfile([line!]);
    const offset = sketchOffsetAt(profile, profile.segments[0].id, { x: 10, z: 5 });
    expect(offset && offset !== "curve" ? offset.closed : true).toBe(false);
    expect(offset && offset !== "curve" ? offset.geometry.segments : []).toHaveLength(1);
  });
});

describe("selected outline size", () => {
  it("reports length and width the way a solid does, and resizes that outline only", () => {
    const rectangle = geometryForSketchPart({ kind: "rectangle", width: 40, depth: 20 });
    const circle = geometryForSketchPart({ kind: "circle", x: 40, radius: 5 });
    const profile = composeSketchProfile([rectangle!, circle!]);
    const ids = rectangle!.points.map((point) => point.id);
    const size = sketchOutlineSize(profile, ids);
    expect(size).toMatchObject({ width: 40, length: 20 });
    expect(sketchOutlineSize(profile, ids.slice(0, 3))).toBeNull();
    const wider = resizeSketchOutline(profile, ids, { width: 50 });
    const next = sketchOutlineSize(wider!, ids);
    expect(next).toMatchObject({ width: 50, length: 20 });
    const untouched = wider!.points.find((point) => point.id === circle!.points[0].id);
    expect(untouched).toMatchObject({ x: circle!.points[0].x, z: circle!.points[0].z });
  });

  it("grows a circle on one axis and keeps it round when both match", () => {
    const circle = geometryForSketchPart({ kind: "circle", radius: 10 });
    const profile = composeSketchProfile([circle!]);
    const ids = circle!.points.map((point) => point.id);
    expect(sketchOutlineSize(profile, ids)).toMatchObject({ width: 20, length: 20 });
    const grown = resizeSketchOutline(profile, ids, { length: 30, width: 30 });
    for (const point of grown!.points) {
      expect(Math.hypot(point.x, point.z)).toBeCloseTo(15, 2);
    }
    const flat = resizeSketchOutline(profile, ids, { width: 30 });
    const flatSize = sketchOutlineSize(flat!, ids);
    expect(flatSize?.width).toBeCloseTo(30, 2);
    expect(flatSize?.length).toBeCloseTo(20, 2);
  });
});

describe("typed size and uniform scale", () => {
  it("reads a percent and a sum", () => {
    expect(parseDimensionEntry("150%", 20)).toBeCloseTo(30);
    expect(parseDimensionEntry("60+12.5", 20)).toBeCloseTo(72.5);
    expect(parseDimensionEntry("20", 10)).toBe(20);
    expect(parseDimensionEntry("nope", 10)).toBeNull();
  });

  it("scales length, width, and height together and leaves the bottom alone", () => {
    const patch = uniformScalePatch({ kind: "box", width: 40, depth: 20, height: 10, size: 40 }, 1.5);
    expect(patch).toMatchObject({ width: 60, depth: 30, height: 15 });
    expect(patch && "elevation" in patch).toBe(false);
  });
});
