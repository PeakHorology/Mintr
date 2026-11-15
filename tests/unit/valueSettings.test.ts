import { describe, expect, it } from "vitest";
import { getShapeProperties, type RangePropertyConfig, type ShapeInspectorUpdate } from "@/components/workplane/shapeProperties";
import {
  drivenByWithout,
  drivenSettingsPatch,
  makeValueFromSetting,
  planValues,
  releaseDrivenPatch,
  valueNameForLabel,
  withChangedPart,
  withTypedSetting,
} from "@/components/workplane/valueDrivenPatches";
import { cleanShapePatch } from "@/lib/editorBoolean";
import { valueNameProblem, resolveValues } from "@/lib/parametricValues";
import { PRO_SKETCH_RULES_NOTE, PRO_VALUES_NOTE, shapeCarriesProValues, sketchCarriesProRules, sketchRulesMovedDrawing } from "@/lib/proContent";
import { addConstraints, addLinearDimension, createEmptySketchDoc, solveSketchDoc } from "@/lib/sketch";
import { sceneShape } from "@/lib/shapeCatalog";
import { defaultSketchPlane } from "@/lib/sketchPlane";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

const box = (extra: Partial<WorkplaneShape> = {}): WorkplaneShape =>
  sceneShape({ id: "box", name: "Box", kind: "box", color: "#d41721", width: 20, depth: 30, height: 10, ...extra });

/**
 * A number set in a size box, the way the inspector sets it with Mintr Pro off: the box's own
 * change, plus whatever a plain number lets go of. This is the wiring in ShapeInspector's
 * `releasingUpdate`, without React.
 */
function typeNumberWithoutPro(shape: WorkplaneShape, label: string, value: number): WorkplaneShape {
  let next = shape;
  const update: ShapeInspectorUpdate = (patch) => {
    next = canonicalizeShape({ ...shape, ...cleanShapePatch({ ...patch, ...releaseDrivenPatch(shape, [label]) }) });
  };
  const row = getShapeProperties(shape, update).find((entry): entry is RangePropertyConfig => entry.label === label && (!("type" in entry) || entry.type === "range"));
  row!.onChange(value);
  return next;
}

describe("typing a plain number over a sum", () => {
  const driven = box({ values: [{ name: "wall", expression: "2" }], drivenBy: { Width: "wall * 10", Height: "wall * 5" } });

  it("lets the sum go with Mintr Pro on, and keeps the number", () => {
    const typed = withTypedSetting(driven, "Width", 33);
    expect(typed.width).toBe(33);
    expect(typed.drivenBy).toEqual({ Height: "wall * 5" });
    expect(typed.values).toEqual(driven.values);
    // The values no longer change the size that was typed.
    expect(drivenSettingsPatch(typed, resolveValues(typed.values).scope).patch).toEqual({});
  });

  it("lets the sum go with Mintr Pro off, and keeps the number", () => {
    const typed = typeNumberWithoutPro(driven, "Width", 33);
    expect(typed.width).toBe(33);
    expect(typed.drivenBy).toEqual({ Height: "wall * 5" });
    // Turning Pro on later, or changing a value, does not snap the width back to wall * 10.
    const later = { ...typed, values: [{ name: "wall", expression: "3" }] };
    expect(planValues(later).body.patch).toEqual({ height: 15 });
  });

  it("leaves no empty set of sums behind when the last one is let go", () => {
    const one = box({ drivenBy: { Width: "20" } });
    expect(withTypedSetting(one, "Width", 25).drivenBy).toBeUndefined();
    expect(typeNumberWithoutPro(one, "Width", 25).drivenBy).toBeUndefined();
    expect("drivenBy" in releaseDrivenPatch(one, ["Width"])).toBe(true);
  });

  it("changes nothing extra on a part that has no sums, which is every part made without Pro", () => {
    expect(releaseDrivenPatch(box(), ["Width"])).toEqual({});
    expect(releaseDrivenPatch(box({ drivenBy: { Height: "h" } }), ["Width", "Length"])).toEqual({});
    const typed = typeNumberWithoutPro(box(), "Width", 33);
    expect(typed).toEqual(canonicalizeShape({ ...box(), width: 33, size: typed.size }));
    expect("drivenBy" in typed).toBe(false);
  });

  it("lets go of every size at once when sizes are kept in proportion", () => {
    const all = box({ drivenBy: { Length: "a", Width: "b", Height: "c", Sides: "n" } });
    expect(releaseDrivenPatch(all, ["Length", "Width", "Height"])).toEqual({ drivenBy: { Sides: "n" } });
    expect(drivenByWithout(all.drivenBy, ["Length", "Width", "Height", "Sides"])).toBeUndefined();
  });

  it("works on a setting that is not a size, such as a gear's teeth", () => {
    const gear = sceneShape({ id: "gear", name: "Gear", kind: "gear", color: "#2aa77e", gearSpec: { teeth: 20, module: 2 }, drivenBy: { Teeth: "count" }, values: [{ name: "count", expression: "20" }] });
    const typed = typeNumberWithoutPro(gear, "Teeth", 24);
    expect(typed.gearSpec?.teeth).toBe(24);
    expect(typed.drivenBy).toBeUndefined();
  });

  it("reaches a part inside a nested group", () => {
    const deep = box({ id: "deep", drivenBy: { Width: "wall" } });
    const body = box({ id: "top", groupedShapes: [box({ id: "mid", groupedShapes: [deep] }), box({ id: "other" })] });
    const next = withChangedPart(body, "deep", (part) => withTypedSetting(part, "Width", 12));
    expect(next.groupedShapes![0].groupedShapes![0]).toMatchObject({ width: 12, drivenBy: undefined });
    // Parts that did not change are the very same objects.
    expect(next.groupedShapes![1]).toBe(body.groupedShapes![1]);
    expect(withChangedPart(body, "missing", (part) => ({ ...part, width: 1 }))).toBe(body);
  });
});

describe("Make this a value", () => {
  it("names the size, puts it in the list and makes the box follow it, without changing the part", () => {
    const made = makeValueFromSetting(box(), "box", "Width")!;
    expect(made.name).toBe("width");
    expect(made.body.values).toEqual([{ name: "width", expression: "20" }]);
    expect(made.body.drivenBy).toEqual({ Width: "width" });
    expect(made.body.width).toBe(20);
    const plan = planValues(made.body);
    expect(plan.errors).toEqual([]);
    expect(plan.body.patch).toEqual({});
  });

  it("then resizes the part when the value changes", () => {
    const made = makeValueFromSetting(box(), "box", "Width")!;
    const changed = { ...made.body, values: [{ name: "width", expression: "45" }] };
    expect(planValues(changed).body.patch).toMatchObject({ width: 45 });
  });

  it("writes the number in the workplane's unit, so an inch workplane reads in inches", () => {
    const made = makeValueFromSetting(box({ width: 50.8 }), "box", "Width", 25.4)!;
    expect(made.body.values).toEqual([{ name: "width", expression: "2" }]);
    expect(planValues(made.body, 25.4).body.patch).toEqual({});
    // A count is never scaled.
    const gear = sceneShape({ id: "gear", name: "Gear", kind: "gear", color: "#2aa77e", gearSpec: { teeth: 20, module: 2 } });
    expect(makeValueFromSetting(gear, "gear", "Teeth", 25.4)!.body.values).toEqual([{ name: "teeth", expression: "20" }]);
  });

  it("picks a name that is free and allowed", () => {
    expect(valueNameForLabel("Top radius", new Set())).toBe("top_radius");
    expect(valueNameForLabel("Width", new Set(["width", "width2"]))).toBe("width3");
    // min is one of the words sums already use.
    expect(valueNameForLabel("Min", new Set())).toBe("min_size");
    expect(valueNameForLabel("2nd size", new Set())).toBe("size_2nd_size");
    expect(valueNameForLabel("%", new Set())).toBe("size");
    for (const label of ["Width", "Top radius", "Min", "in", "2nd size", "Fit across (mm)", "A very long setting name that goes on"]) {
      expect(valueNameProblem(valueNameForLabel(label, new Set())), label).toBeNull();
    }
  });

  it("puts the value on the top-level part, for a part grouped inside it", () => {
    const body = box({ id: "top", values: [{ name: "width", expression: "5" }], groupedShapes: [box({ id: "inner", width: 12 })] });
    const made = makeValueFromSetting(body, "inner", "Width")!;
    expect(made.name).toBe("width2");
    expect(made.body.values).toEqual([{ name: "width", expression: "5" }, { name: "width2", expression: "12" }]);
    expect(made.body.groupedShapes![0].drivenBy).toEqual({ Width: "width2" });
    expect(planValues(made.body).errors).toEqual([]);
  });

  it("does nothing for a setting the part does not have", () => {
    expect(makeValueFromSetting(box(), "box", "Teeth")).toBeNull();
    expect(makeValueFromSetting(box(), "nobody", "Width")).toBeNull();
  });
});

describe("designs that carry Mintr Pro content", () => {
  it("are told apart from designs that never used Pro", () => {
    expect(shapeCarriesProValues(box())).toBe(false);
    expect(shapeCarriesProValues(box({ values: [], drivenBy: {} }))).toBe(false);
    expect(shapeCarriesProValues(box({ groupedShapes: [box({ id: "a" }), box({ id: "b" })] }))).toBe(false);
    expect(shapeCarriesProValues(box({ values: [{ name: "wall", expression: "2" }] }))).toBe(true);
    expect(shapeCarriesProValues(box({ drivenBy: { Width: "20" } }))).toBe(true);
    expect(shapeCarriesProValues(box({ groupedShapes: [box({ id: "a", groupedShapes: [box({ id: "b", drivenBy: { Width: "w" } })] })] }))).toBe(true);
  });

  it("include a sketch size written as a sum, but not a plain sketch size", () => {
    const doc = createEmptySketchDoc(defaultSketchPlane(), "s");
    doc.entities = [
      { kind: "point", id: "a", x: 0, z: 0 },
      { kind: "point", id: "b", x: 10, z: 0 },
      { kind: "line", id: "ab", startId: "a", endId: "b" },
    ];
    expect(shapeCarriesProValues(box({ sketchDoc: doc }))).toBe(false);
    const sized = addLinearDimension(doc, "ab", 10).doc;
    expect(shapeCarriesProValues(box({ sketchDoc: sized }))).toBe(false);
    const summed = { ...sized, dimensions: sized.dimensions.map((dimension) => ({ ...dimension, expression: "wall * 5" })) };
    expect(shapeCarriesProValues(box({ sketchDoc: summed }))).toBe(true);
  });

  it("say so in one short line each, without selling anything", () => {
    for (const note of [PRO_VALUES_NOTE, PRO_SKETCH_RULES_NOTE]) {
      expect(note.length).toBeLessThan(90);
      expect(note).toMatch(/Turn Pro on in Settings/);
      expect(note).not.toMatch(/\b(paid|upgrade|buy|price|premium|unlock|subscri\w*)\b/i);
    }
  });
});

describe("the sketch line for rules from Mintr Pro", () => {
  const drawn = () => {
    const doc = createEmptySketchDoc(defaultSketchPlane(), "s");
    doc.entities = [
      { kind: "point", id: "a", x: 0, z: 0 },
      { kind: "point", id: "b", x: 10, z: 0 },
      { kind: "point", id: "c", x: 10, z: 6 },
      { kind: "line", id: "ab", startId: "a", endId: "b" },
      { kind: "line", id: "bc", startId: "b", endId: "c" },
    ];
    return doc;
  };
  const moved = (doc: ReturnType<typeof drawn>, id: string, z: number) => ({
    ...doc,
    entities: doc.entities.map((entity) => (entity.id === id && entity.kind === "point" ? { ...entity, z } : entity)),
  });

  it("never shows for a sketch drawn without Pro, however it is dragged", () => {
    const doc = drawn();
    expect(sketchCarriesProRules(doc)).toBe(false);
    const dragged = moved(doc, "b", 4);
    expect(sketchRulesMovedDrawing(dragged, solveSketchDoc(dragged, undefined, { holdPointIds: ["b"] }).doc)).toBe(false);
    expect(sketchCarriesProRules(null)).toBe(false);
  });

  it("shows when a rule pulls a dragged sketch back into line", () => {
    const ruled = solveSketchDoc(addConstraints(drawn(), [{ kind: "horizontal", entityIds: ["ab"] }])).doc;
    expect(sketchCarriesProRules(ruled)).toBe(true);
    // Nothing is out of line yet, so nothing moves and nothing is said.
    expect(sketchRulesMovedDrawing(ruled, solveSketchDoc(ruled).doc)).toBe(false);
    const dragged = moved(ruled, "b", 4);
    const solved = solveSketchDoc(dragged, undefined, { holdPointIds: ["b"] }).doc;
    expect(sketchRulesMovedDrawing(dragged, solved)).toBe(true);
  });

  it("does not count a rule that is switched off", () => {
    const off = addConstraints(drawn(), [{ kind: "horizontal", entityIds: ["ab"] }]);
    off.constraints = off.constraints.map((constraint) => ({ ...constraint, suppressed: true }));
    expect(sketchCarriesProRules(off)).toBe(false);
  });
});
