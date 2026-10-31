import { describe, expect, it } from "vitest";
import { buildFaceBody } from "@/lib/faceBody";
import { faceOutlineFromLoop } from "@/lib/faceOutline";
import { smoothFaceLoop } from "@/lib/faceOutlineCurves";
import type { CadPlanarFace } from "@/lib/cadModifierTypes";
import type { SketchPoint, SketchProfile, WorkplaneShape } from "@/types/sketchforge";

type V = { x: number; z: number };
/** The kernel samples face outlines at no more than about 6 degrees a step. */
const STEP = (6 * Math.PI) / 180;

function arc(center: V, radius: number, from: number, to: number, step = STEP): V[] {
  const steps = Math.max(1, Math.ceil(Math.abs(to - from) / step));
  return Array.from({ length: steps }, (_, index) => {
    const angle = from + ((to - from) * index) / steps;
    return { x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius };
  });
}

/** A 10 mm disc with an 8 mm disc cut out of one side, as when one cylinder cuts another. */
function crescent() {
  const outer = { center: { x: 0, z: 0 }, radius: 10 };
  const inner = { center: { x: 6, z: 0 }, radius: 8 };
  // Where the two circles cross: the crescent's tips.
  const x = (outer.radius ** 2 - inner.radius ** 2 + inner.center.x ** 2) / (2 * inner.center.x);
  const z = Math.sqrt(outer.radius ** 2 - x * x);
  const outerTop = Math.atan2(z, x);
  const innerTop = Math.atan2(z, x - inner.center.x);
  // Round the far side of the outer circle, then back along the hollow, counter-clockwise.
  const loop = [
    ...arc(outer.center, outer.radius, outerTop, Math.PI * 2 - outerTop),
    ...arc(inner.center, inner.radius, Math.PI * 2 - innerTop, innerTop),
  ];
  return { loop, outer, inner, tips: [{ x, z }, { x, z: -z }] };
}

function cubic(a: V, b: V, c: V, d: V, t: number): V {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    z: u * u * u * a.z + 3 * u * u * t * b.z + 3 * u * t * t * c.z + t * t * t * d.z,
  };
}

/** Points along every segment of the profile, curves followed through their handles. */
function trace(profile: { points: SketchPoint[]; segments: SketchProfile["segments"] }): V[] {
  const byId = new Map(profile.points.map((point) => [point.id, point]));
  return profile.segments.flatMap((segment) => {
    const start = byId.get(segment.startId)!;
    const end = byId.get(segment.endId)!;
    const c1 = segment.kind === "bezier" ? start.handleOut ?? start : start;
    const c2 = segment.kind === "bezier" ? end.handleIn ?? end : end;
    return [0.25, 0.5, 0.75].map((t) => cubic(start, c1, c2, end, t));
  });
}

let ids = 0;
const makeId = (kind: string, index: number) => `${kind}-${index}-${(ids += 1)}`;

describe("smooth Pad/Pocket outlines", () => {
  it("follows both arcs of a crescent and keeps its tips sharp", () => {
    const { loop, outer, inner, tips } = crescent();
    const smooth = smoothFaceLoop(loop, makeId)!;
    expect(smooth).not.toBeNull();
    expect(smooth.segments.every((segment) => segment.kind === "bezier")).toBe(true);
    for (const tip of tips) {
      const point = smooth.points.find((entry) => Math.hypot(entry.x - tip.x, entry.z - tip.z) < 1e-6)!;
      expect(point.mode).toBe("corner");
    }
    // Every spot along the curves sits on one of the two circles, within a hundredth of a mm.
    for (const at of trace(smooth)) {
      const offOuter = Math.abs(Math.hypot(at.x - outer.center.x, at.z - outer.center.z) - outer.radius);
      const offInner = Math.abs(Math.hypot(at.x - inner.center.x, at.z - inner.center.z) - inner.radius);
      expect(Math.min(offOuter, offInner)).toBeLessThan(0.01);
    }
  });

  it("pads a crescent face with curves, not facets", () => {
    const { loop } = crescent();
    const host: WorkplaneShape = {
      id: "cyl", name: "Cylinder", kind: "cylinder", color: "#c4a574", x: 0, z: 0, elevation: 0,
      size: 20, width: 20, depth: 20, height: 10, rotation: 0, locked: false, hidden: false,
    };
    const face: CadPlanarFace = {
      id: 0,
      origin: { x: 0, y: 10, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      points: loop.flatMap((point) => [point.x, 10, point.z]),
      area: 100,
    };
    const base = { host, face, direction: "out" as const, inset: 0, cornerRadius: 0, depth: 2 };
    const smooth = buildFaceBody({ ...base, smooth: true }).shape!.sketchProfile!;
    expect(smooth.segments.filter((segment) => segment.kind === "bezier").length).toBeGreaterThan(20);
    const faceted = buildFaceBody({ ...base, smooth: false }).shape!.sketchProfile!;
    expect(faceted.segments.every((segment) => segment.kind === "line")).toBe(true);
  });

  it("keeps a rounded rectangle's straight sides straight and tangent to the corners", () => {
    const loop = faceOutlineFromLoop([
      { x: -10, z: -6 }, { x: 10, z: -6 }, { x: 10, z: 6 }, { x: -10, z: 6 },
    ], 0, 3);
    const smooth = smoothFaceLoop(loop, makeId)!;
    const byId = new Map(smooth.points.map((point) => [point.id, point]));
    const lines = smooth.segments.filter((segment) => segment.kind === "line");
    expect(lines).toHaveLength(4);
    expect(smooth.segments.filter((segment) => segment.kind === "bezier").length).toBeGreaterThan(8);
    for (const line of lines) {
      const start = byId.get(line.startId)!;
      const end = byId.get(line.endId)!;
      const along = { x: end.x - start.x, z: end.z - start.z };
      // The curve arriving at the start of the side leaves along the side.
      const handle = start.handleIn!;
      const into = { x: start.x - handle.x, z: start.z - handle.z };
      const cross = along.x * into.z - along.z * into.x;
      expect(Math.abs(cross) / (Math.hypot(along.x, along.z) * Math.hypot(into.x, into.z))).toBeLessThan(1e-6);
    }
  });

  it("leaves squares, hexagons and octagons with sharp corners", () => {
    for (const sides of [4, 6, 8]) {
      const loop = Array.from({ length: sides }, (_, index) => ({
        x: Math.cos((index / sides) * Math.PI * 2) * 10,
        z: Math.sin((index / sides) * Math.PI * 2) * 10,
      }));
      expect(smoothFaceLoop(loop, makeId)).toBeNull();
    }
  });

  it("keeps a large gentle arc instead of flattening it to one straight edge", () => {
    // A 300 mm radius bow across a 40 mm wide face. The kernel samples it at about 0.7 degrees a
    // step, under the 2 degrees the old clean-up dropped as straight, which flattened the whole bow.
    const bow = arc({ x: 0, z: -300 + 10 }, 300, Math.PI / 2 + 0.066, Math.PI / 2 - 0.066, (0.7 * Math.PI) / 180);
    const loop = faceOutlineFromLoop([{ x: -20, z: -10 }, { x: 20, z: -10 }, ...bow.reverse()], 0, 0);
    expect(loop.length).toBeGreaterThan(6);
    const middle = loop.reduce((best, point) => (Math.abs(point.x) < Math.abs(best.x) && point.z > 0 ? point : best), loop[0]);
    expect(middle.z).toBeCloseTo(10, 1);
  });
});
