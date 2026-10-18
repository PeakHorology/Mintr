import { describe, expect, it } from "vitest";
import { closeOpenPathGaps, orderedSketchPaths } from "@/lib/sketch/profiles";
import { nearestScreenPoint, raySketchUV, sketchViewFacesPlane } from "@/lib/sketch/sketch3d";
import { defaultSketchPlane } from "@/lib/sketchPlane";
import type { SketchCylinderSurface, SketchPlane } from "@/types/sketchforge";

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
