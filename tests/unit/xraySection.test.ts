import { describe, expect, it } from "vitest";
import { xrayAxisBounds, xrayClipping, xrayKeptSide, xraySpanCenter } from "@/lib/xraySection";
import type { WorkplaneShape } from "@/types/sketchforge";

function shape(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "shape-1",
    name: "Shape",
    kind: "box",
    color: "#ffffff",
    x: 0,
    z: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

describe("xrayAxisBounds", () => {
  it("includes visible geometry below the workplane", () => {
    expect(xrayAxisBounds([shape({ elevation: -30, height: 12 })], "y")).toEqual({
      min: -34,
      max: -14,
    });
  });

  it("ignores hidden shapes", () => {
    expect(
      xrayAxisBounds([
        shape({ elevation: 5, height: 40 }),
        shape({ id: "hidden", elevation: -100, height: 300, hidden: true }),
      ], "y"),
    ).toEqual({ min: 1, max: 49 });
  });

  it("swaps width and depth when the shape is turned a quarter turn", () => {
    expect(xrayAxisBounds([shape({ width: 20, depth: 10, height: 20, rotation: 90 })], "x")).toEqual({
      min: -9,
      max: 9,
    });
  });

  it("covers only the selected shape when one is selected", () => {
    const shapes = [
      shape({ id: "near", x: 0, width: 20 }),
      shape({ id: "far", x: 80, width: 20 }),
    ];
    expect(xrayAxisBounds(shapes, "x", ["near"])).toEqual({ min: -14, max: 14 });
    expect(xrayAxisBounds(shapes, "x")).toEqual({ min: -14, max: 94 });
  });
});

describe("xrayClipping", () => {
  it("keeps the lower side by default and the other side when flipped", () => {
    expect(xrayClipping("y", 12, true)).toEqual({ normal: [0, -1, 0], constant: 12 });
    expect(xrayClipping("x", 4, false)).toEqual({ normal: [1, 0, 0], constant: -4 });
    expect(xrayKeptSide("x", true)).toBe("−X stays");
    expect(xrayKeptSide("y", false)).toBe("+Y stays");
    expect(xrayKeptSide("z", true)).toBe("−Z stays");
  });

  it("centers a span", () => {
    expect(xraySpanCenter({ min: -4, max: 20 })).toBe(8);
  });
});
