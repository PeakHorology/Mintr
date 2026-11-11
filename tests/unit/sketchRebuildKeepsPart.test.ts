import { describe, expect, it } from "vitest";
import { placeReplayedShape } from "@/lib/featureReplay";
import { setDrivingDimensionValue } from "@/lib/sketch";
import { rectangleSketchGeometry } from "@/lib/sketchDrawShapes";
import { shapeFromSketchProfile } from "@/lib/sketchProfileShape";
import { rebuildSketchedShape } from "@/lib/sketchRebuild";
import { workplaneShapesEqual } from "@/lib/workplaneShapes";
import { promoteWorkplaneSketchToPrimitive } from "@/lib/sketchPrimitivePromote";
import type { WorkplaneShape } from "@/types/sketchforge";

/** A triangle, so the part stays a sketched mesh rather than becoming a plain box. */
function sketched(): WorkplaneShape {
  const ids = ["a", "b", "c"];
  const at = [[-10, -5], [10, -5], [0, 12]];
  return shapeFromSketchProfile({
    points: ids.map((id, index) => ({ id, x: at[index][0], z: at[index][1], mode: "corner" as const })),
    segments: ids.map((id, index) => ({ id: `s${index}`, startId: id, endId: ids[(index + 1) % 3], kind: "line" as const })),
    images: [],
  }, 5)!;
}

describe("rebuilding a sketched part from its sketch", () => {
  it("keeps it where it is, with its finish, job and values", async () => {
    const part: WorkplaneShape = {
      ...sketched(),
      x: 60,
      z: 24,
      elevation: 4,
      rotation: 30,
      mirrorX: true,
      name: "Mine",
      laserJob: "score",
      values: [{ name: "w", expression: "20" }],
      drivenBy: { Height: "w" },
      surfaceTexture: { id: "t" } as unknown as WorkplaneShape["surfaceTexture"],
    };
    const result = await rebuildSketchedShape(part, part.sketchDoc!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shape).toMatchObject({ elevation: 4, rotation: 30, mirrorX: true, name: "Mine", laserJob: "score" });
    expect(result.shape.x).toBeCloseTo(60);
    expect(result.shape.z).toBeCloseTo(24);
    expect(result.shape.values).toBe(part.values);
    expect(result.shape.drivenBy).toBe(part.drivenBy);
    expect(result.shape.surfaceTexture).toBe(part.surfaceTexture);
  });

  it("moves a part's steps onto its new body", async () => {
    const part: WorkplaneShape = {
      ...sketched(),
      features: [{ id: "f", kind: "fillet", amount: 1 }] as unknown as WorkplaneShape["features"],
      featureBase: { ...sketched(), name: "Old base" },
    };
    const result = await rebuildSketchedShape(part, part.sketchDoc!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shape.features).toBe(part.features);
    expect(result.shape.featureBase?.name).toBe(part.name);
    expect(result.shape.featureBase?.features).toBeUndefined();
  });

  it("carries values through a sketch finish", () => {
    const first = sketched();
    const again = shapeFromSketchProfile(first.sketchProfile!, 5, { ...first, values: [{ name: "w", expression: "2" }], drivenBy: { Width: "w" } })!;
    expect(again.values).toEqual([{ name: "w", expression: "2" }]);
    expect(again.drivenBy).toEqual({ Width: "w" });
  });
});

describe("replaying a part's steps", () => {
  it("keeps its current values, not the ones from when the step was made", () => {
    const rebuilt = { ...sketched(), values: [{ name: "w", expression: "10" }] };
    const live = { ...sketched(), values: [{ name: "w", expression: "99" }], drivenBy: { Width: "w" } };
    const placed = placeReplayedShape(rebuilt, live, null as never);
    expect(placed.values).toBe(live.values);
    expect(placed.drivenBy).toBe(live.drivenBy);
  });
});

describe("sketch shape equality", () => {
  it("sees a change that only touches the sketch's rules", () => {
    const part = sketched();
    expect(workplaneShapesEqual(part, { ...part, sketchDoc: { ...part.sketchDoc! } })).toBe(false);
    expect(typeof setDrivingDimensionValue).toBe("function");
  });
});

describe("promoting a sketch to a plain solid", () => {
  const promoted = (points: { x: number; z: number }[]) => promoteWorkplaneSketchToPrimitive(
    { id: "s", name: "s", kind: "mesh", color: "#000", x: 0, z: 0, size: 60, width: 60, depth: 40, height: 3 } as WorkplaneShape,
    [{ closed: true, points }],
  ).kind;

  it("leaves a rounded rectangle alone instead of making it a cylinder", () => {
    expect(promoted([[-25, -20], [25, -20], [30, -15], [30, 15], [25, 20], [-25, 20], [-30, 15], [-30, -15]].map(([x, z]) => ({ x, z })))).toBe("mesh");
  });

  it("leaves an octagon alone", () => {
    expect(promoted(Array.from({ length: 8 }, (_, index) => ({ x: 20 * Math.cos(index * Math.PI / 4), z: 20 * Math.sin(index * Math.PI / 4) })))).toBe("mesh");
  });

  it("still makes a many-sided circle a cylinder, and a rectangle a box", () => {
    expect(promoted(Array.from({ length: 32 }, (_, index) => ({ x: 20 * Math.cos(index * Math.PI / 16), z: 20 * Math.sin(index * Math.PI / 16) })))).toBe("cylinder");
    expect(rectangleSketchGeometry({ x: 0, z: 0 }, { x: 10, z: 10 })).not.toBeNull();
    expect(promoted([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }])).toBe("box");
  });
});
