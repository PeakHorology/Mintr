import { describe, expect, it } from "vitest";
import { rangeThumbHit } from "@/lib/rangeThumb";

const bar = {
  left: 100,
  top: 40,
  width: 200,
  height: 24,
  min: 0,
  max: 100,
  thumbWidth: 17,
  thumbHeight: 17,
};

describe("rangeThumbHit", () => {
  it("accepts a press on the button and ignores the rest of the bar", () => {
    expect(rangeThumbHit({ ...bar, value: 0, clientX: 108, clientY: 52 })).toBe(true);
    expect(rangeThumbHit({ ...bar, value: 0, clientX: 180, clientY: 52 })).toBe(false);
    expect(rangeThumbHit({ ...bar, value: 50, clientX: 200, clientY: 52 })).toBe(true);
    expect(rangeThumbHit({ ...bar, value: 50, clientX: 140, clientY: 52 })).toBe(false);
    expect(rangeThumbHit({ ...bar, value: 100, clientX: 291, clientY: 52 })).toBe(true);
    expect(rangeThumbHit({ ...bar, value: 100, clientX: 150, clientY: 52 })).toBe(false);
  });

  it("ignores a press above the button", () => {
    expect(rangeThumbHit({ ...bar, value: 50, clientX: 200, clientY: 10 })).toBe(false);
  });
});
