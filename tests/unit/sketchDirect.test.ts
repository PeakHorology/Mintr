import { describe, expect, it } from "vitest";
import {
  chamferCorners,
  filletCorners,
  findSweepInputs,
  resizeSegmentLength,
  setCornerAngle,
  sketchCornerMarks,
  strokeProfile,
} from "@/lib/sketch/directEdit";
import { parseLineEntry, pointAtLengthAngle, snapHeading } from "@/lib/sketch/lineEntry";
import { closedProfilesFromLegacy } from "@/lib/sketch/profiles";
import { buildSweepMesh, sweepMeshOpenEdgeCount } from "@/lib/sketch/sweepMath";
import type { SketchProfile } from "@/types/sketchforge";

function square(): SketchProfile {
  const points = [
    { id: "a", x: 0, z: 0 },
    { id: "b", x: 10, z: 0 },
    { id: "c", x: 10, z: 10 },
    { id: "d", x: 0, z: 10 },
  ];
  const segments = [
    { id: "ab", startId: "a", endId: "b", kind: "line" as const },
    { id: "bc", startId: "b", endId: "c", kind: "line" as const },
    { id: "cd", startId: "c", endId: "d", kind: "line" as const },
    { id: "da", startId: "d", endId: "a", kind: "line" as const },
  ];
  return { points, segments };
}

describe("typed sketch lines", () => {
  it("reads a length, an angle, and a sum", () => {
    expect(parseLineEntry("50")).toEqual({ length: 50, angleDeg: null });
    expect(parseLineEntry("50<30")).toEqual({ length: 50, angleDeg: 30 });
    expect(parseLineEntry("20+30<15-5")).toEqual({ length: 50, angleDeg: 10 });
    expect(parseLineEntry("50<")).toEqual({ length: 50, angleDeg: null });
  });

  it("places 90 degrees up the page and snaps headings to 15 degrees", () => {
    const placed = pointAtLengthAngle({ x: 0, z: 0 }, 10, 90);
    expect(placed.x).toBeCloseTo(0);
    expect(placed.z).toBeCloseTo(-10);
    const snapped = snapHeading({ x: 0, z: 0 }, { x: 10, z: -1 }, 15);
    expect(snapped.z).toBeCloseTo(0);
    expect(snapped.x).toBeCloseTo(Math.hypot(10, 1));
  });
});

describe("sketch numbers and corners", () => {
  it("keeps the start point when a length is typed", () => {
    const profile: SketchProfile = {
      points: [{ id: "a", x: 0, z: 0 }, { id: "b", x: 4, z: 0 }],
      segments: [{ id: "ab", startId: "a", endId: "b", kind: "line" }],
    };
    const next = resizeSegmentLength(profile, "ab", 12, "end");
    const end = next?.points.find((point) => point.id === "b");
    const start = next?.points.find((point) => point.id === "a");
    expect(start).toMatchObject({ x: 0, z: 0 });
    expect(end?.x).toBeCloseTo(12);
  });

  it("turns one line to a typed corner angle", () => {
    const profile: SketchProfile = {
      points: [
        { id: "a", x: 0, z: 0 },
        { id: "b", x: 10, z: 0 },
        { id: "c", x: 10, z: 4 },
      ],
      segments: [
        { id: "ab", startId: "a", endId: "b", kind: "line" },
        { id: "bc", startId: "b", endId: "c", kind: "line" },
      ],
    };
    expect(sketchCornerMarks(profile)[0]?.degrees).toBeCloseTo(90);
    const next = setCornerAngle(profile, "b", 45, 1);
    const angle = sketchCornerMarks(next ?? profile)[0]?.degrees;
    expect(angle).toBeCloseTo(45, 0);
    const end = next?.points.find((point) => point.id === "c");
    expect(Math.hypot((end?.x ?? 0) - 10, (end?.z ?? 0) - 0)).toBeCloseTo(4);
  });

  it("fillets and chamfers several corners", () => {
    const filleted = filletCorners(square(), ["a", "b"], 1);
    expect(filleted?.applied).toBe(2);
    expect(filleted?.profile.segments.some((segment) => segment.kind === "bezier")).toBe(true);
    const chamfered = chamferCorners(square(), ["a", "c"], 1);
    expect(chamfered?.applied).toBe(2);
    expect(chamfered?.profile.points.some((point) => point.id === "a")).toBe(false);
  });
});

describe("construction, stroke, and sweep", () => {
  it("leaves construction lines out of the solid profile", () => {
    const profile = square();
    profile.segments.push({ id: "guide", startId: "a", endId: "c", kind: "line", construction: true });
    const closed = closedProfilesFromLegacy(profile);
    expect(closed).toHaveLength(1);
    expect(closed[0]?.pointIds).not.toContain("guide");
  });

  it("turns a square into a centered frame and an open line into a stripe", () => {
    const frame = strokeProfile(square(), { width: 2, side: "center" });
    const loops = closedProfilesFromLegacy(frame ?? square());
    expect(loops).toHaveLength(1);
    expect(loops[0]?.holePointIdLoops.length).toBe(1);
    expect(loops[0]?.area).toBeGreaterThan(100);

    const stripe = strokeProfile({
      points: [{ id: "a", x: 0, z: 0 }, { id: "b", x: 20, z: 0 }],
      segments: [{ id: "ab", startId: "a", endId: "b", kind: "line" }],
    }, { width: 2, side: "center" });
    expect(closedProfilesFromLegacy(stripe ?? square())).toHaveLength(1);
  });

  it("sweeps a section along a construction path into a closed solid", () => {
    const profile = square();
    profile.points.push({ id: "p0", x: 20, z: 20 }, { id: "p1", x: 40, z: 20 });
    profile.segments.push({ id: "path", startId: "p0", endId: "p1", kind: "line", construction: true });
    const inputs = findSweepInputs(profile);
    expect(inputs?.path).toHaveLength(2);
    expect(inputs?.pathClosed).toBe(false);
    const mesh = buildSweepMesh(inputs!.section, inputs!.path, false, {
      origin: { x: 0, y: 0, z: 0 },
      uAxis: { x: 1, y: 0, z: 0 },
      vAxis: { x: 0, y: 0, z: 1 },
      normal: { x: 0, y: 1, z: 0 },
    });
    expect(mesh).not.toBeNull();
    expect(sweepMeshOpenEdgeCount(mesh!)).toBe(0);
    const ys = mesh!.positions.filter((_, index) => index % 3 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10, 0);
  });
});
