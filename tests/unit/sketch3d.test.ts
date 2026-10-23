import { describe, expect, it } from "vitest";
import { closeOpenPathGaps, orderedSketchPaths } from "@/lib/sketch/profiles";
import {
  interpolateSketchCameraPose,
  nearestScreenPoint,
  raySketchUV,
  sketchCameraEase,
  sketchCameraNearlyFramed,
  sketchCameraTweenMs,
  sketchFramingPose,
  sketchViewFacesPlane,
} from "@/lib/sketch/sketch3d";
import { defaultSketchPlane } from "@/lib/sketchPlane";
import type { SketchCylinderSurface, SketchPlane, SketchProfile } from "@/types/sketchforge";

describe("sketchViewFacesPlane", () => {
  it("accepts a face-on view and rejects a side-on view", () => {
    expect(sketchViewFacesPlane({ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(true);
    expect(sketchViewFacesPlane({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(false);
  });
});

describe("raySketchUV", () => {
  it("hits a horizontal sketch plane", () => {
    const plane = defaultSketchPlane();
    plane.origin = { x: 0, y: 5, z: 0 };
    const uv = raySketchUV(plane, { x: 2, y: 12, z: 3 }, { x: 0, y: -1, z: 0 });
    expect(uv).not.toBeNull();
    expect(uv!.x).toBeCloseTo(2, 4);
    expect(uv!.z).toBeCloseTo(-3, 4);
  });

  it("misses a ray that runs away from the plane", () => {
    const plane = defaultSketchPlane();
    expect(raySketchUV(plane, { x: 0, y: 4, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
  });

  it("hits a cylinder barrel and returns unwrap millimetres", () => {
    const surface: SketchCylinderSurface = {
      kind: "cylinder",
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDir: { x: 0, y: 1, z: 0 },
      radial0: { x: 1, y: 0, z: 0 },
      radius: 10,
      height: 20,
      theta0: 0,
    };
    const plane: SketchPlane = {
      origin: { x: 10, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      uAxis: { x: 0, y: 0, z: 1 },
      surface,
    };
    const front = raySketchUV(plane, { x: 30, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
    expect(front).not.toBeNull();
    expect(front!.x).toBeCloseTo(0, 3);
    expect(front!.z).toBeCloseTo(0, 3);

    const side = raySketchUV(plane, { x: 0, y: 4, z: 30 }, { x: 0, y: 0, z: -1 });
    expect(side).not.toBeNull();
    expect(side!.x).toBeCloseTo(10 * Math.PI / 2, 3);
    expect(side!.z).toBeCloseTo(-4, 3);
  });
});

describe("nearestScreenPoint", () => {
  it("picks the dot under the cursor and ignores a farther one", () => {
    const hits = [
      { id: "a", x: 100, y: 100 },
      { id: "b", x: 140, y: 100 },
    ];
    expect(nearestScreenPoint(hits, 108, 104, 18)).toBe("a");
    expect(nearestScreenPoint(hits, 200, 200, 18)).toBeNull();
  });
});

describe("closeOpenPathGaps", () => {
  it("closes a chain whose ends are a fraction of a millimetre apart", () => {
    const profile = {
      points: [
        { id: "a", x: 0, z: 0 },
        { id: "b", x: 10, z: 0 },
        { id: "c", x: 0.4, z: 0.2 },
      ],
      segments: [
        { id: "ab", startId: "a", endId: "b", kind: "line" as const },
        { id: "bc", startId: "b", endId: "c", kind: "line" as const },
      ],
    };
    const closed = closeOpenPathGaps(profile);
    expect(closed.segments).toHaveLength(3);
    expect(orderedSketchPaths(closed).some((path) => path.closed)).toBe(true);
  });

  it("leaves a chain open when the gap is a real opening", () => {
    const profile = {
      points: [
        { id: "a", x: 0, z: 0 },
        { id: "b", x: 10, z: 0 },
        { id: "c", x: 8, z: 6 },
      ],
      segments: [
        { id: "ab", startId: "a", endId: "b", kind: "line" as const },
        { id: "bc", startId: "b", endId: "c", kind: "line" as const },
      ],
    };
    expect(closeOpenPathGaps(profile)).toBe(profile);
  });
});

describe("sketch camera framing", () => {
  const emptyProfile: SketchProfile = { points: [], segments: [] };

  it("looks down a workplane from a slight tilt, not a hard cut", () => {
    const pose = sketchFramingPose({ plane: defaultSketchPlane(), profile: emptyProfile });
    expect(pose.position.y).toBeGreaterThan(pose.target.y + 40);
    expect(Math.abs(pose.position.x - pose.target.x)).toBeLessThan(1);
    expect(pose.position.z).toBeGreaterThan(pose.target.z + 4);
    const viewY = pose.position.y - pose.target.y;
    const viewLen = Math.hypot(pose.position.x - pose.target.x, viewY, pose.position.z - pose.target.z);
    expect(viewY / viewLen).toBeGreaterThan(0.9);
    expect(pose.up).toEqual({ x: 0, y: 1, z: 0 });
  });

  it("looks along a vertical face normal", () => {
    const plane: SketchPlane = {
      origin: { x: 20, y: 10, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      uAxis: { x: 0, y: 0, z: 1 },
    };
    const pose = sketchFramingPose({ plane, profile: emptyProfile });
    expect(pose.position.x).toBeGreaterThan(pose.target.x + 40);
    expect(Math.abs(pose.position.y - pose.target.y)).toBeLessThan(8);
    expect(pose.up).toEqual({ x: 0, y: 1, z: 0 });
  });

  it("eases along the short orbit onto the target pose", () => {
    const from = {
      target: { x: 0, y: 0, z: 0 },
      position: { x: 118, y: 96, z: 118 },
      up: { x: 0, y: 1, z: 0 },
    };
    const to = sketchFramingPose({ plane: defaultSketchPlane(), profile: emptyProfile });
    const mid = interpolateSketchCameraPose(from, to, sketchCameraEase(0.5));
    const start = interpolateSketchCameraPose(from, to, 0);
    const end = interpolateSketchCameraPose(from, to, 1);
    expect(start.position.x).toBeCloseTo(from.position.x, 5);
    expect(end.position.y).toBeCloseTo(to.position.y, 5);
    expect(mid.position.y).toBeGreaterThan(from.position.y);
    expect(mid.position.y).toBeLessThan(to.position.y);
    expect(sketchCameraNearlyFramed(from, to)).toBe(false);
    expect(sketchCameraTweenMs(from, to)).toBeGreaterThanOrEqual(380);
    expect(sketchCameraTweenMs(from, to)).toBeLessThanOrEqual(640);
    expect(sketchCameraNearlyFramed(to, to)).toBe(true);
  });
});
