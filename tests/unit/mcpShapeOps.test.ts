import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { linearPatternInstances } from "@/lib/linearPattern";
import {
  changeUnlockedShapes,
  clampShapeSizePatch,
  groupableShapes,
  placeGroupedShape,
  planShapeDelete,
  planShapeVisibility,
} from "@/lib/mcpShapeOps";
import { MIN_SHAPE_DIMENSION } from "@/lib/modelDimension";
import { syncLinkedPatternShapes, tagLinearPatternInstances } from "@/lib/patternFeature";
import { lookupSageGuide } from "@/lib/sageGuides";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(partial: Partial<WorkplaneShape> & Pick<WorkplaneShape, "id">): WorkplaneShape {
  return { name: "Box", kind: "box", color: "#fff", x: 0, z: 0, size: 10, width: 10, depth: 10, height: 10, rotation: 0, ...partial };
}

function patternOfThree() {
  const source = box({ id: "src" });
  const params = { countX: 3, countZ: 1, countY: 1, spacingX: 12, spacingZ: 8, spacingY: 12 };
  return tagLinearPatternInstances(linearPatternInstances([source], params, params), source, params, "feat-1");
}

describe("planShapeDelete", () => {
  it("keeps locked shapes and reports only what was removed", () => {
    const shapes = [box({ id: "a" }), box({ id: "b", locked: true }), box({ id: "c" })];
    const plan = planShapeDelete(shapes, ["a", "b"]);
    expect(plan.removedIds).toEqual(["a"]);
    expect(plan.lockedIds).toEqual(["b"]);
    expect(plan.remaining.map((shape) => shape.id)).toEqual(["b", "c"]);
  });

  it("deleting one pattern copy removes the whole pattern, so sync cannot bring it back", () => {
    const pattern = patternOfThree();
    const other = box({ id: "other", x: 100 });
    const plan = planShapeDelete([...pattern, other], [pattern[1].id]);
    expect(plan.removedIds.sort()).toEqual(pattern.map((shape) => shape.id).sort());
    expect(syncLinkedPatternShapes(plan.remaining).map((shape) => shape.id)).toEqual(["other"]);
  });

  it("removes nothing for unknown ids", () => {
    expect(planShapeDelete([box({ id: "a" })], ["missing"]).removedIds).toEqual([]);
  });
});

describe("planShapeVisibility", () => {
  it("hides only unlocked shapes that were showing, and drops them from the selection", () => {
    const shapes = [box({ id: "a" }), box({ id: "b", locked: true }), box({ id: "c", hidden: true }), box({ id: "d" })];
    const plan = planShapeVisibility(shapes, ["a", "b", "c"], true, ["a", "b", "d"]);
    expect(plan.changedIds).toEqual(["a"]);
    expect(plan.next.find((shape) => shape.id === "b")?.hidden).toBeUndefined();
    expect(plan.nextSelected).toEqual(["b", "d"]);
  });

  it("shows hidden shapes and keeps the selection", () => {
    const shapes = [box({ id: "a", hidden: true }), box({ id: "b" })];
    const plan = planShapeVisibility(shapes, ["a", "b"], false, ["b"]);
    expect(plan.changedIds).toEqual(["a"]);
    expect(plan.nextSelected).toEqual(["b"]);
  });
});

describe("changeUnlockedShapes", () => {
  it("lists only the shapes the change touched", () => {
    const shapes = [box({ id: "a", elevation: 5 }), box({ id: "b" }), box({ id: "c", locked: true, elevation: 5 })];
    const { changedIds, next } = changeUnlockedShapes(shapes, ["a", "b", "c"], (shape) =>
      (shape.elevation ?? 0) === 0 ? null : { ...shape, elevation: 0 });
    expect(changedIds).toEqual(["a"]);
    expect(next.find((shape) => shape.id === "c")?.elevation).toBe(5);
  });
});

describe("groupableShapes", () => {
  it("leaves construction planes out", () => {
    const shapes = [box({ id: "a" }), box({ id: "plane", construction: true } as Partial<WorkplaneShape> & { id: string }), box({ id: "b" })];
    expect(groupableShapes(shapes, ["a", "plane", "b"]).map((shape) => shape.id)).toEqual(["a", "b"]);
  });
});

describe("placeGroupedShape", () => {
  it("keeps left-out and unselected shapes and points hosted sketches at the group", () => {
    const solid = box({ id: "solid" });
    const hole = box({ id: "hole", hole: true });
    const leftOut = box({ id: "far", x: 500 });
    const bystander = box({ id: "bystander" });
    const plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, uAxis: { x: 1, y: 0, z: 0 }, hostShapeId: "solid" };
    const group = box({
      id: "group",
      groupedShapes: [box({ id: "child", sketchPlane: plane } as Partial<WorkplaneShape> & { id: string })],
    });
    const { next, linkedGroup, groupedIds } = placeGroupedShape([solid, hole, leftOut, bystander], [solid, hole, leftOut], group, [leftOut]);
    expect([...groupedIds].sort()).toEqual(["hole", "solid"]);
    expect(next.map((shape) => shape.id)).toEqual(["far", "bystander", "group"]);
    expect(linkedGroup.groupedShapes?.[0].sketchPlane?.hostShapeId).toBe("group");
  });
});

describe("clampShapeSizePatch", () => {
  it("never lets a size go to zero or below", () => {
    expect(clampShapeSizePatch({ width: -5, depth: 0, height: 3, size: -1, x: -4 } as Record<string, number>))
      .toEqual({ width: MIN_SHAPE_DIMENSION, depth: MIN_SHAPE_DIMENSION, height: 3, size: MIN_SHAPE_DIMENSION, x: -4 });
  });
});

describe("guide wording and targets", () => {
  const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

  it("Sage names the Parts tree, not a Model tree", () => {
    expect(read("apps/web/src/lib/sageGuides.ts")).not.toMatch(/model tree/i);
    expect(lookupSageGuide("shrink wrap")?.steps.join(" ")).toContain("Parts tree");
  });

  it("Push Pull's Distance field carries the push-pull-distance cue", () => {
    expect(read("apps/web/src/components/workplane/PushPullPanel.tsx")).toContain('lessonTarget="push-pull-distance"');
  });

  it("Sage hover reaches the Export panel's buttons", () => {
    const sage = read("apps/web/src/components/workplane/Sage.tsx");
    expect(sage).not.toMatch(/closest\([^)]*\.top-action-panel/);
  });
});
