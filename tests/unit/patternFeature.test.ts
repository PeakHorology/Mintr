import { describe, expect, it } from "vitest";
import {
  dissolvePatternFeature,
  patternFeatureLabel,
  syncLinkedPatternShapes,
  rebuildLinearPatternFeature,
  replacePatternFeature,
  tagLinearPatternInstances,
  withAppliedPattern,
} from "@/lib/patternFeature";
import { linearPatternInstances } from "@/lib/linearPattern";
import { cloneShapesForPaste, duplicateShapeWithFreshIds } from "@/lib/shapeClipboard";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(partial: Partial<WorkplaneShape> & Pick<WorkplaneShape, "id" | "x" | "z">): WorkplaneShape {
  return {
    name: "Box",
    kind: "box",
    color: "#fff",
    size: 10,
    width: 10,
    depth: 10,
    height: 10,
    rotation: 0,
    ...partial,
  };
}

describe("applying a new pattern", () => {
  it("keeps every other shape, such as the one the copies turn around", () => {
    const pivot = box({ id: "pivot", x: 0, z: 0 });
    const other = box({ id: "other", x: 40, z: 40 });
    const oldPattern = box({ id: "old", x: -40, z: 0, patternFeature: { id: "feat-old", kind: "linear" } as WorkplaneShape["patternFeature"] });
    const source = box({ id: "src", x: 20, z: 0 });
    const copies = [{ ...source }, box({ id: "src__circular_pattern__1", x: -20, z: 0 })];
    const next = withAppliedPattern([pivot, source, other, oldPattern], new Set(["src"]), copies);
    expect(next.map((shape) => shape.id)).toEqual(["pivot", "other", "old", "src", "src__circular_pattern__1"]);
    // With an id, the old copies of that same pattern make way.
    expect(withAppliedPattern([pivot, oldPattern], new Set<string>(), [], "feat-old").map((shape) => shape.id)).toEqual(["pivot"]);
  });
});

describe("pattern features", () => {
  it("tags the source and copies so count edits can rebuild", () => {
    const source = box({ id: "src", x: 0, z: 0 });
    const params = { countX: 3, countZ: 1, countY: 1, spacingX: 12, spacingZ: 8, spacingY: 12 };
    const tagged = tagLinearPatternInstances(linearPatternInstances([source], params, params), source, params, "feat-1");
    expect(tagged).toHaveLength(3);
    expect(tagged[0].patternFeature).toMatchObject({ role: "source", sourceId: "src", kind: "linear" });
    expect(tagged[1].patternFeature).toMatchObject({ role: "instance", sourceId: "src" });
    expect(patternFeatureLabel(tagged[0].patternFeature!)).toBe("Linear pattern ×3");
  });

  it("rebuilds copies when spacing changes and drops extras when count shrinks", () => {
    const source = box({ id: "src", x: 0, z: 0 });
    const first = rebuildLinearPatternFeature(
      source,
      { countX: 3, countZ: 1, countY: 1, spacingX: 12, spacingZ: 8, spacingY: 12 },
      "feat-1",
    );
    const next = rebuildLinearPatternFeature(
      { ...first[0], x: 5 },
      { countX: 2, countZ: 1, countY: 1, spacingX: 20, spacingZ: 8, spacingY: 12 },
      "feat-1",
    );
    const scene = replacePatternFeature(
      [box({ id: "other", x: -40, z: 0 }), ...first],
      next,
      "feat-1",
    );
    expect(scene.map((shape) => shape.id)).toEqual([
      "other",
      "src",
      next[1].id,
    ]);
    expect(next[1].x).toBe(25);
  });
});

describe("copies of patterned parts never take over the pattern", () => {
  const params = { countX: 3, countZ: 1, spacingX: 20, spacingZ: 20 };
  const linked = () => {
    const source = box({ id: "A", x: 0, z: 0 });
    return [box({ id: "B", x: 80, z: 80 }), ...rebuildLinearPatternFeature(source, params, "feat")];
  };

  it("keeps the original pattern after Duplicate of its original", () => {
    const scene = linked();
    const copy = duplicateShapeWithFreshIds(scene[1], "A-copy");
    expect(copy.patternFeature).toBeUndefined();
    const next = syncLinkedPatternShapes([...scene, copy]);
    expect(next.map((shape) => shape.id)).toEqual(["B", "A", "A__linear_pattern__1_0_0", "A__linear_pattern__2_0_0", "A-copy"]);
  });

  it("keeps a duplicated pattern copy as a plain part", () => {
    const scene = linked();
    const copy = duplicateShapeWithFreshIds(scene[2], "dup");
    expect(syncLinkedPatternShapes([...scene, copy])).toHaveLength(5);
  });

  it("gives parts inside a duplicate their own ids", () => {
    const group = box({ id: "G", x: 0, z: 0, groupedShapes: [box({ id: "host", x: 0, z: 0 }), box({ id: "cut", x: 0, z: 0, hole: true })] });
    const copy = duplicateShapeWithFreshIds(group, "G2");
    const ids = copy.groupedShapes!.map((child) => child.id);
    expect(ids).not.toContain("host");
    expect(ids).not.toContain("cut");
  });

  it("pastes a whole pattern as a new pattern, and a lone copy as a plain part", () => {
    const scene = linked();
    const pasted = cloneShapesForPaste(scene.slice(1));
    const featureIds = new Set(pasted.map((shape) => shape.patternFeature?.id));
    expect(featureIds.size).toBe(1);
    expect(featureIds.has("feat")).toBe(false);
    const source = pasted.find((shape) => shape.patternFeature?.role === "source")!;
    expect(pasted.every((shape) => shape.patternFeature?.sourceId === source.id)).toBe(true);
    const next = syncLinkedPatternShapes([...scene, ...pasted]);
    expect(next.filter((shape) => shape.patternFeature?.id === "feat")).toHaveLength(3);
    expect(next).toHaveLength(7);
    expect(cloneShapesForPaste([scene[2]])[0].patternFeature).toBeUndefined();
  });

  it("frees dissolved copies under new ids, so patterning again cannot clash", () => {
    const dissolved = dissolvePatternFeature(linked(), "feat");
    const again = rebuildLinearPatternFeature(dissolved[1], params, "feat2");
    const ids = [...dissolved.filter((shape) => shape.id !== "A"), ...again].map((shape) => shape.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not pull an original back to a small box when the workplane is big", () => {
    const scene = linked();
    const moved = scene.map((shape) => (shape.id === "A" ? { ...shape, x: 150, elevation: 200 } : shape));
    const next = syncLinkedPatternShapes(moved);
    expect(next.filter((shape) => shape.patternFeature).map((shape) => [shape.x, shape.elevation])).toEqual([[150, 200], [170, 200], [190, 200]]);
  });
});