import { describe, expect, it } from "vitest";
import { stepBodySpan, stepDisplayTolerance } from "@/lib/stepMeshTolerance";

describe("step display mesh", () => {
  it("uses a coarser chord on a large body and stays fine on a small one", () => {
    expect(stepDisplayTolerance(20).tolerance).toBeCloseTo(0.05);
    expect(stepDisplayTolerance(400).tolerance).toBeCloseTo(1);
    expect(stepDisplayTolerance(80).tolerance).toBeCloseTo(0.2);
    expect(stepDisplayTolerance(80).angularTolerance).toBeCloseTo(0.35);
  });

  it("measures the longest side of a body", () => {
    expect(stepBodySpan({ xMin: 0, xMax: 10, yMin: 0, yMax: 4, zMin: -2, zMax: 30 })).toBe(32);
  });
});
