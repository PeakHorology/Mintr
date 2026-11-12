import { describe, expect, it } from "vitest";
import { shapeFromSketchRevolve, sketchRevolveIssue } from "@/lib/sketchRevolve";
import type { SketchPoint, SketchProfile, SketchSegment } from "@/types/sketchforge";

const P = (id: string, x: number, z: number): SketchPoint => ({ id, x, z });
const S = (id: string, startId: string, endId: string, construction = false): SketchSegment => ({
  id,
  startId,
  endId,
  kind: "line",
  ...(construction ? { construction } : {}),
});

/** Enclosed volume of a triangle soup; positive when the faces point outward. */
function meshVolume(positions: number[]) {
  let six = 0;
  for (let index = 0; index < positions.length; index += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(index, index + 9);
    six += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return six / 6;
}

/** Pappus: revolved volume of a rectangle x0..x1 (radius) by z0..z1 (along). */
function ringVolume(x0: number, x1: number, z0: number, z1: number) {
  return 2 * Math.PI * ((x0 + x1) / 2) * (x1 - x0) * (z1 - z0);
}

/** A 72-gon holds slightly less than the true circle. */
const POLYGON = Math.sin((2 * Math.PI) / 72) / ((2 * Math.PI) / 72);

const AXIS = { start: { x: 0, z: -20 }, end: { x: 0, z: 30 } };

describe("sketch revolve profiles", () => {
  it("revolves a washer section with its hole as a ring with a void", () => {
    const profile: SketchProfile = {
      points: [P("a", 5, 0), P("b", 20, 0), P("c", 20, 10), P("d", 5, 10), P("e", 10, 3), P("f", 15, 3), P("g", 15, 7), P("h", 10, 7)],
      segments: [S("1", "a", "b"), S("2", "b", "c"), S("3", "c", "d"), S("4", "d", "a"), S("5", "e", "f"), S("6", "f", "g"), S("7", "g", "h"), S("8", "h", "e")],
    };
    const shape = shapeFromSketchRevolve(profile, { start: { x: 0, z: 0 }, end: { x: 0, z: 10 } });
    expect(shape).not.toBeNull();
    const positions = shape!.importedMesh!.positions;
    const expected = (ringVolume(5, 20, 0, 10) - ringVolume(10, 15, 3, 7)) * POLYGON;
    expect(meshVolume(positions) / expected).toBeCloseTo(1, 2);
    // Both the outer ring and the void are there: twice the triangles of the outer ring alone.
    const solidOnly = shapeFromSketchRevolve({ points: profile.points, segments: profile.segments.slice(0, 4) }, { start: { x: 0, z: 0 }, end: { x: 0, z: 10 } });
    expect(positions.length).toBe(2 * solidOnly!.importedMesh!.positions.length);
    expect(shape!.width).toBeCloseTo(40, 0);
  });

  it("revolves the real profile, not the construction box around it", () => {
    const profile: SketchProfile = {
      points: [P("a", 2, 0), P("b", 6, 0), P("c", 6, 4), P("d", 2, 4), P("A", 1, -10), P("B", 30, -10), P("C", 30, 20), P("D", 1, 20)],
      segments: [
        S("1", "a", "b"), S("2", "b", "c"), S("3", "c", "d"), S("4", "d", "a"),
        S("5", "A", "B", true), S("6", "B", "C", true), S("7", "C", "D", true), S("8", "D", "A", true),
      ],
    };
    const shape = shapeFromSketchRevolve(profile, AXIS);
    expect(shape).not.toBeNull();
    // The axis lies on the sketch plane along z: diameter 12 across and up, 4 long along it.
    expect(shape!.width).toBeCloseTo(12, 0);
    expect(shape!.height).toBeCloseTo(12, 0);
    expect(shape!.depth).toBeCloseTo(4, 3);
    expect(meshVolume(shape!.importedMesh!.positions) / (ringVolume(2, 6, 0, 4) * POLYGON)).toBeCloseTo(1, 2);
  });

  it("revolves a profile that has an axis line drawn from one of its corners", () => {
    const profile: SketchProfile = {
      points: [P("p1", 0, 0), P("p2", 10, 0), P("p3", 10, 20), P("p4", 0, 20), P("ax", 0, -10)],
      segments: [S("s1", "p1", "p2"), S("s2", "p2", "p3"), S("s3", "p3", "p4"), S("s4", "p4", "p1"), S("axis", "p1", "ax")],
    };
    const axis = { start: { x: 0, z: -10 }, end: { x: 0, z: 20 } };
    expect(sketchRevolveIssue(profile, axis)).toBeNull();
    const shape = shapeFromSketchRevolve(profile, axis);
    expect(shape).not.toBeNull();
    expect(shape!.depth).toBeCloseTo(20, 3);
    expect(shape!.width).toBeCloseTo(20, 0);
    expect(meshVolume(shape!.importedMesh!.positions) / (Math.PI * 100 * 20 * POLYGON)).toBeCloseTo(1, 2);
  });

  it("revolves every separate outline on the same side of the axis", () => {
    const profile: SketchProfile = {
      points: [P("a", 2, 0), P("b", 4, 0), P("c", 4, 5), P("d", 2, 5), P("e", 8, 0), P("f", 10, 0), P("g", 10, 5), P("h", 8, 5)],
      segments: [S("1", "a", "b"), S("2", "b", "c"), S("3", "c", "d"), S("4", "d", "a"), S("5", "e", "f"), S("6", "f", "g"), S("7", "g", "h"), S("8", "h", "e")],
    };
    const shape = shapeFromSketchRevolve(profile, AXIS);
    expect(shape).not.toBeNull();
    const expected = (ringVolume(2, 4, 0, 5) + ringVolume(8, 10, 0, 5)) * POLYGON;
    expect(meshVolume(shape!.importedMesh!.positions) / expected).toBeCloseTo(1, 2);
  });

  it("revolves a rectangle split by a line as one section", () => {
    const profile: SketchProfile = {
      points: [P("TL", 2, 10), P("TM", 6, 10), P("TR", 10, 10), P("BR", 10, 0), P("BM", 6, 0), P("BL", 2, 0)],
      segments: [S("a", "TL", "TM"), S("b", "TM", "TR"), S("c", "TR", "BR"), S("d", "BR", "BM"), S("e", "BM", "BL"), S("f", "BL", "TL"), S("g", "TM", "BM")],
    };
    const shape = shapeFromSketchRevolve(profile, AXIS);
    expect(shape).not.toBeNull();
    expect(meshVolume(shape!.importedMesh!.positions) / (ringVolume(2, 10, 0, 10) * POLYGON)).toBeCloseTo(1, 2);
  });

  it("refuses outlines on both sides of the axis with a plain reason", () => {
    const profile: SketchProfile = {
      points: [P("a", 2, 0), P("b", 4, 0), P("c", 4, 5), P("d", 2, 5), P("e", -4, 0), P("f", -2, 0), P("g", -2, 5), P("h", -4, 5)],
      segments: [S("1", "a", "b"), S("2", "b", "c"), S("3", "c", "d"), S("4", "d", "a"), S("5", "e", "f"), S("6", "f", "g"), S("7", "g", "h"), S("8", "h", "e")],
    };
    expect(shapeFromSketchRevolve(profile, AXIS)).toBeNull();
    expect(sketchRevolveIssue(profile, AXIS)).toMatch(/one side of the axis/);
  });

  it("says when there is no closed profile", () => {
    const profile: SketchProfile = {
      points: [P("a", 2, 0), P("b", 4, 0), P("c", 4, 5)],
      segments: [S("1", "a", "b"), S("2", "b", "c")],
    };
    expect(shapeFromSketchRevolve(profile, AXIS)).toBeNull();
    expect(sketchRevolveIssue(profile, AXIS)).toMatch(/closed profile/);
  });
});
