import { describe, expect, it } from "vitest";
import { parseDimensionEntry, parseDimensionEntryWithUnit } from "@/lib/dimensionEntry";
import { evaluateValueExpression, renameInExpression, resolveValues, valueRenameProblem } from "@/lib/parametricValues";
import { drivenLabelIsLength, findGroupedPart, planValues, withPlannedChildPatches } from "@/components/workplane/valueDrivenPatches";
import { sceneShape } from "@/lib/shapeCatalog";

const grey = "#888888";

describe("Typed sizes with a unit", () => {
  it("reads mm, cm, m, in, \" and ft as millimeters, and says a unit was given", () => {
    expect(parseDimensionEntryWithUnit("50mm", 1)).toEqual({ value: 50, unitGiven: true });
    expect(parseDimensionEntryWithUnit("50 MM", 1)).toEqual({ value: 50, unitGiven: true });
    expect(parseDimensionEntryWithUnit("2in", 1)).toEqual({ value: 50.8, unitGiven: true });
    expect(parseDimensionEntryWithUnit("1.5\"", 1)?.value).toBeCloseTo(38.1, 9);
    expect(parseDimensionEntryWithUnit("1cm", 1)).toEqual({ value: 10, unitGiven: true });
    expect(parseDimensionEntryWithUnit("0.2 m", 1)).toEqual({ value: 200, unitGiven: true });
    expect(parseDimensionEntryWithUnit("1ft", 1)?.value).toBeCloseTo(304.8, 9);
    expect(parseDimensionEntryWithUnit("(10+2)mm", 1)).toEqual({ value: 12, unitGiven: true });
  });

  it("leaves plain numbers and percentages in the box's own unit", () => {
    expect(parseDimensionEntryWithUnit("20", 5)).toEqual({ value: 20, unitGiven: false });
    expect(parseDimensionEntryWithUnit("150%", 2)).toEqual({ value: 3, unitGiven: false });
    expect(parseDimensionEntryWithUnit("60+12.5", 0)).toEqual({ value: 72.5, unitGiven: false });
    expect(parseDimensionEntryWithUnit("mm", 1)).toBeNull();
    expect(parseDimensionEntryWithUnit("abc", 1)).toBeNull();
    // The plain parser still gives a number; "50mm" is 50 as before.
    expect(parseDimensionEntry("50mm", 1)).toBe(50);
    expect(parseDimensionEntry("2in", 1)).toBe(50.8);
  });
});

describe("Values follow the workplane unit", () => {
  const box = (drivenBy: Record<string, string>, values = [{ name: "wall", expression: "1" }]) =>
    sceneShape({ name: "Box", kind: "box", color: grey, width: 20, depth: 20, height: 20, values, drivenBy });

  it("works exactly as before on a millimeter workplane", () => {
    expect(planValues(box({ Width: "wall * 30" })).body.patch.width).toBe(30);
    expect(planValues(box({ Width: "wall * 30" }), 1).body.patch.width).toBe(30);
    expect(evaluateValueExpression("2in + 1", new Map())).toEqual({ ok: true, value: 51.8 });
  });

  it("reads plain numbers as inches on an inch workplane", () => {
    const plan = planValues(box({ Width: "wall", Height: "wall * 2" }), 25.4);
    expect(plan.body.patch.width).toBeCloseTo(25.4, 9);
    expect(plan.body.patch.height).toBeCloseTo(50.8, 9);
  });

  it("keeps a value's own unit", () => {
    const plan = planValues(box({ Width: "wall" }, [{ name: "wall", expression: "30mm" }]), 25.4);
    expect(plan.body.patch.width).toBeCloseTo(30, 9);
    expect(resolveValues([{ name: "wall", expression: "1in" }], undefined, 25.4).own.get("wall")).toBeCloseTo(1, 12);
  });

  it("does not scale counts", () => {
    expect(drivenLabelIsLength("Width")).toBe(true);
    expect(drivenLabelIsLength("Teeth")).toBe(false);
    const polygon = sceneShape({ name: "Polygon", kind: "polygon", color: grey, width: 20, depth: 20, height: 10, values: [{ name: "n", expression: "7" }], drivenBy: { Sides: "n" } } as never);
    const plan = planValues(polygon, 25.4);
    expect(plan.errors).toEqual([]);
    expect(plan.body.patch.sides).toBe(7);
  });
});

describe("Renaming values", () => {
  it("refuses a name another value already has", () => {
    expect(valueRenameProblem("b", [{ name: "b", expression: "5" }])).toMatch(/already a value named/);
    expect(valueRenameProblem("c", [{ name: "b", expression: "5" }])).toBeNull();
    expect(valueRenameProblem("wall", [], new Map([["wall", 2]]))).toMatch(/already has a value named/);
    expect(valueRenameProblem("in", [])).toMatch(/already part of/);
  });

  it("does not touch exponents or units glued to numbers", () => {
    expect(renameInExpression("e2 + 1e2", "e2", "x")).toBe("x + 1e2");
    expect(renameInExpression("e + 2e+3 * e", "e", "k")).toBe("k + 2e+3 * k");
    expect(renameInExpression("wall * 2 + wall", "wall", "w")).toBe("w * 2 + w");
  });
});

describe("Parts deep inside groups follow values", () => {
  const peg = sceneShape({ name: "Peg", kind: "cylinder", color: grey, width: 5, depth: 5, height: 5, drivenBy: { Height: "wall * 4" } });
  const inner = sceneShape({ name: "Inner", kind: "mesh", color: grey, width: 10, depth: 10, height: 10, groupedShapes: [peg] });
  const outer = sceneShape({ name: "Outer", kind: "mesh", color: grey, width: 20, depth: 20, height: 20, values: [{ name: "wall", expression: "3" }], groupedShapes: [inner] });

  it("plans a part two groups deep", () => {
    const plan = planValues(outer);
    expect(plan.errors).toEqual([]);
    expect(plan.children.get(peg.id)?.patch.height).toBe(12);
  });

  it("lets an inner group's value hide an outer one", () => {
    const shadowing = { ...inner, values: [{ name: "wall", expression: "5" }] };
    const plan = planValues({ ...outer, groupedShapes: [shadowing] });
    expect(plan.children.get(peg.id)?.patch.height).toBe(20);
  });

  it("puts the change into the nested part", () => {
    const plan = planValues(outer);
    const children = withPlannedChildPatches(outer, plan.children);
    const placed = findGroupedPart({ ...outer, groupedShapes: children }, peg.id);
    expect(placed?.height).toBe(12);
    // A part that does not change is kept as it is.
    const untouched = planValues({ ...outer, values: [{ name: "wall", expression: "1.25" }] });
    expect(withPlannedChildPatches(outer, new Map())[0]).toBe(outer.groupedShapes![0]);
    expect(untouched.children.has(peg.id)).toBe(false);
  });
});
