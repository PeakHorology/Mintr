import { describe, expect, it } from "vitest";
import { sceneShape } from "@/lib/shapeCatalog";
import { defaultSketchPlane, sketchPlaneFromFaceHit } from "@/lib/sketchPlane";
import { sketchCenterSnapPoints } from "@/lib/sketch/shapeCenterSnap";
import { snapSketchPoint } from "@/lib/sketch/snaps";
import type { SketchPlane, WorkplaneShape } from "@/types/sketchforge";

function solid(kind: WorkplaneShape["kind"], patch: Partial<WorkplaneShape> = {}) {
  return sceneShape({ name: kind, kind, color: "#d41721", width: 20, depth: 20, height: 20, ...patch });
}

const emptyProfile = { points: [], segments: [] };

describe("sketch center snap", () => {
  const ground = defaultSketchPlane();

  it("snaps a cube, a cylinder, and a triangle roof on the sheet", () => {
    const points = sketchCenterSnapPoints([
      solid("box"),
      solid("cylinder", { x: 40 }),
      solid("roof", { z: -30 }),
      solid("sphere", { x: 80 }),
    ], ground);
    expect(points).toEqual([
      { x: 0, z: 0 },
      { x: 40, z: 0 },
      { x: 0, z: 30 },
    ]);
  });

  it("does not snap a part the sketch plane misses", () => {
    expect(sketchCenterSnapPoints([solid("box", { elevation: 100 })], ground)).toEqual([]);
  });

  it("snaps the middle of the face being sketched", () => {
    const box = solid("box", { x: 12, z: -4 });
    const top = sketchPlaneFromFaceHit({ x: 12, y: 20, z: -4 }, { x: 0, y: 1, z: 0 }, box.id);
    expect(sketchCenterSnapPoints([box], top)).toEqual([{ x: 0, z: 0 }]);
    const side = sketchPlaneFromFaceHit({ x: 22, y: 10, z: -4 }, { x: 1, y: 0, z: 0 }, box.id);
    expect(sketchCenterSnapPoints([box], side)[0]).toMatchObject({ x: expect.closeTo(0, 5), z: expect.closeTo(0, 5) });
  });

  it("snaps the middle of a cylinder wall", () => {
    const barrel = { ...ground, surface: { kind: "cylinder" } } as SketchPlane;
    expect(sketchCenterSnapPoints([], barrel)).toEqual([{ x: 0, z: 0 }]);
  });

  it("beats the grid when the cursor is near the center", () => {
    const centers = sketchCenterSnapPoints([solid("cylinder")], ground);
    const snap = snapSketchPoint(emptyProfile, {
      cursor: { x: 0.4, z: -0.3 },
      screenUnit: 0.2,
      gridStep: 1,
      centers,
    });
    expect(snap.kind).toBe("center");
    expect(snap.x).toBe(0);
    expect(snap.z).toBe(0);
  });

  it("lines a point up with another point", () => {
    const profile = {
      points: [
        { id: "a", x: 0, z: 0 },
        { id: "b", x: 20, z: 10 },
      ],
      segments: [],
    };
    const level = snapSketchPoint(profile, {
      cursor: { x: 5, z: 10.3 },
      screenUnit: 0.2,
      gridStep: 1,
    });
    expect(level.kind).toBe("horizontal");
    expect(level.z).toBe(10);
    expect(level.alignTo).toEqual([{ x: 20, z: 10 }]);

    const plumb = snapSketchPoint(profile, {
      cursor: { x: 0.2, z: 6 },
      screenUnit: 0.2,
      gridStep: 1,
      excludePointIds: ["b"],
    });
    expect(plumb.kind).toBe("vertical");
    expect(plumb.x).toBe(0);
    expect(plumb.alignTo).toEqual([{ x: 0, z: 0 }]);
  });
});
