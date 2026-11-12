import { describe, expect, it } from "vitest";
import { sketchProfileToDoc as sketchDocFromProfile } from "@/lib/sketch/migrate";
import { keepPartAfterSketchFinish } from "@/lib/sketchRebuild";
import { shapeFromSketchProfile } from "@/lib/sketchProfileShape";
import type { SketchProfile, WorkplaneShape } from "@/types/sketchforge";

function triangle(scale = 1): SketchProfile {
  const ids = ["a", "b", "c"];
  const at = [[-10, -5], [10, -5], [0, 12]];
  return {
    points: ids.map((id, i) => ({ id, x: at[i][0] * scale, z: at[i][1] * scale, mode: "corner" as const })),
    segments: ids.map((id, i) => ({ id: `s${i}`, startId: id, endId: ids[(i + 1) % 3], kind: "line" as const })),
    images: [],
  } as SketchProfile;
}

describe("Edit sketch → Finish keeps the part", () => {
  it("keeps where the part was moved and turned, its lock, laser job and steps", () => {
    const drawn = shapeFromSketchProfile(triangle(), 5)!;
    drawn.sketchDoc = sketchDocFromProfile(triangle());
    const existing: WorkplaneShape = {
      ...drawn,
      x: drawn.x + 60,
      elevation: 4,
      rotation: 30,
      laserJob: "score",
      locked: true,
      features: [{ id: "f", kind: "fillet", amount: 1, edges: { rule: "allSharp", sharpAngle: 25 } }] as WorkplaneShape["features"],
      featureBase: { ...drawn },
    };
    // The sketch got bigger: the new part grows in place, where the old one was moved to.
    const rebuilt = shapeFromSketchProfile(triangle(2), 5, existing)!;
    rebuilt.sketchDoc = sketchDocFromProfile(triangle(2));
    const kept = keepPartAfterSketchFinish(rebuilt, existing);
    expect(kept.x).toBeCloseTo(rebuilt.x + 60, 6);
    expect(kept.elevation).toBeCloseTo((rebuilt.elevation ?? 0) + 4, 6);
    expect(kept.rotation).toBe(30);
    expect(kept.laserJob).toBe("score");
    expect(kept.locked).toBe(true);
    expect(kept.features).toHaveLength(1);
    expect(kept.featureBase?.width).toBeCloseTo(rebuilt.width, 6);
  });

  it("takes hole or solid from the new finish", () => {
    const drawn = shapeFromSketchProfile(triangle(), 5)!;
    drawn.sketchDoc = sketchDocFromProfile(triangle());
    const rebuilt = { ...shapeFromSketchProfile(triangle(), 5, drawn)!, hole: true, sketchDoc: drawn.sketchDoc };
    expect(keepPartAfterSketchFinish(rebuilt, drawn).hole).toBe(true);
  });
});
