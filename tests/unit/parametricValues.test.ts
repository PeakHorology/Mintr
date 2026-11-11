import { describe, expect, it } from "vitest";
import {
  valueRangeProblem,
  valueSliderRange,
  evaluateValueExpression,
  expressionNames,
  isValueExpression,
  renameInExpression,
  resolveValues,
  valueNameProblem,
} from "@/lib/parametricValues";
import { planValues } from "@/components/workplane/valueDrivenPatches";
import { sceneShape } from "@/lib/shapeCatalog";

const scope = new Map([["wall", 2], ["length", 60]]);
const value = (text: string) => {
  const result = evaluateValueExpression(text, scope);
  return result.ok ? result.value : result.error;
};

describe("Value sums", () => {
  it("does arithmetic in the usual order", () => {
    expect(value("1 + 2 * 3")).toBe(7);
    expect(value("(1 + 2) * 3")).toBe(9);
    expect(value("2 ^ 3 ^ 2")).toBe(512);
    expect(value("-wall * 2")).toBe(-4);
    expect(value("length / 2 + wall")).toBe(32);
  });

  it("knows units, functions and pi", () => {
    expect(value("1in")).toBeCloseTo(25.4);
    expect(value("2 cm + 3mm")).toBe(23);
    expect(value("max(wall, 5, 3)")).toBe(5);
    expect(value("round(2.6)")).toBe(3);
    expect(value("sin(30)")).toBeCloseTo(0.5);
    expect(value("atan(1)")).toBeCloseTo(45);
    expect(value("pi")).toBeCloseTo(Math.PI);
  });

  it("explains what is wrong in plain words", () => {
    expect(value("lenght * 2")).toBe("There is no value named “lenght”.");
    expect(value("wall / 0")).toBe("That divides by zero.");
    expect(value("(wall + 1")).toBe("A bracket is not closed.");
    expect(value("wall wall")).toBe("“wall” is in the wrong place.");
    expect(value("wall $ 2")).toBe("“$” cannot be used in a value.");
    expect(value("round(1, 2)")).toBe("round takes 1 number.");
  });

  it("tells a sum from a plain number", () => {
    expect(isValueExpression("20")).toBe(false);
    expect(isValueExpression("20 mm")).toBe(false);
    expect(isValueExpression("60+12.5")).toBe(false);
    expect(isValueExpression("wall*2")).toBe(true);
    expect(isValueExpression("sqrt(2)")).toBe(true);
    expect(expressionNames("max(wall, length) + 2in")).toEqual(["wall", "length"]);
  });

  it("checks names", () => {
    expect(valueNameProblem("wall_2")).toBeNull();
    expect(valueNameProblem("2wall")).not.toBeNull();
    expect(valueNameProblem("max")).not.toBeNull();
    expect(valueNameProblem("in")).not.toBeNull();
  });

  it("renames a value inside sums", () => {
    expect(renameInExpression("wall * 2 + wallpaper", "wall", "side")).toBe("side * 2 + wallpaper");
  });
});

describe("Value lists", () => {
  it("works values out in any order", () => {
    const resolved = resolveValues([
      { name: "inner", expression: "outer - 2 * wall" },
      { name: "outer", expression: "40" },
      { name: "wall", expression: "1.5" },
    ]);
    expect(resolved.own.get("inner")).toBe(37);
    expect(resolved.errors.size).toBe(0);
  });

  it("reports a loop instead of hanging", () => {
    const resolved = resolveValues([
      { name: "a", expression: "b + 1" },
      { name: "b", expression: "a + 1" },
      { name: "c", expression: "5" },
    ]);
    expect(resolved.errors.get("a")).toMatch(/loop/);
    expect(resolved.errors.get("b")).toMatch(/loop/);
    expect(resolved.own.get("c")).toBe(5);
  });

  it("lets a part's own value hide one from the group around it", () => {
    const resolved = resolveValues([{ name: "wall", expression: "3" }], new Map([["wall", 2], ["gap", 1]]));
    expect(resolved.scope.get("wall")).toBe(3);
    expect(resolved.scope.get("gap")).toBe(1);
  });

  it("flags two values with the same name", () => {
    const resolved = resolveValues([{ name: "a", expression: "1" }, { name: "a", expression: "2" }]);
    expect(resolved.own.get("a")).toBe(1);
    expect(resolved.errors.get("a")).toMatch(/two values/);
  });
});

describe("Values driving a part", () => {
  const box = sceneShape({
    name: "Box",
    kind: "box",
    color: "#888888",
    width: 20,
    depth: 20,
    height: 20,
    values: [{ name: "length", expression: "60" }, { name: "wall", expression: "2" }],
    drivenBy: { Width: "length / 2", Height: "wall * 5" },
  });

  it("changes the settings written as sums", () => {
    const plan = planValues(box);
    expect(plan.errors).toEqual([]);
    expect(plan.body.patch.width).toBe(30);
    expect(plan.body.patch.height).toBe(10);
  });

  it("leaves a part alone when its sums already match", () => {
    const settled = { ...box, width: 30, height: 10 };
    expect(planValues(settled).body.patch).toEqual({});
  });

  it("says when a sum names a value that is gone", () => {
    const plan = planValues({ ...box, drivenBy: { Width: "missing * 2" } });
    expect(plan.errors[0]).toMatch(/Width: There is no value named “missing”/);
    expect(plan.body.patch).toEqual({});
  });

  it("drives the parts grouped inside with the group's values", () => {
    const child = sceneShape({ name: "Peg", kind: "cylinder", color: "#888888", width: 5, depth: 5, height: 5, drivenBy: { Height: "wall * 4" } });
    const group = sceneShape({
      name: "Group",
      kind: "mesh",
      color: "#888888",
      width: 20,
      depth: 20,
      height: 20,
      values: [{ name: "wall", expression: "3" }],
      groupedShapes: [child],
    });
    const plan = planValues(group);
    expect(plan.children.get(child.id)?.patch.height).toBe(12);
  });
});

describe("value ranges", () => {
  it("gives a slider with round steps only for a usable range", () => {
    expect(valueSliderRange({ min: 0, max: 50 })).toEqual({ min: 0, max: 50, step: 0.5 });
    expect(valueSliderRange({ min: 2, max: 3 })).toEqual({ min: 2, max: 3, step: 0.01 });
    expect(valueSliderRange({ min: 5 })).toBeNull();
    expect(valueSliderRange({ min: 5, max: 5 })).toBeNull();
  });

  it("says when an answer is outside its range", () => {
    expect(valueRangeProblem({ min: 1, max: 10 }, 12)).toBe("This is above its highest, 10.");
    expect(valueRangeProblem({ min: 1, max: 10 }, 0.5)).toBe("This is below its lowest, 1.");
    expect(valueRangeProblem({ min: 1, max: 10 }, 10)).toBeNull();
    expect(valueRangeProblem({}, 1000)).toBeNull();
  });
});
