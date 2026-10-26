import { describe, expect, it } from "vitest";
import { faceBlindCutDepthMm, faceHoleCutDepthMm, faceHoleOvershootMm, faceSketchHoleCutterMm } from "@/lib/csgTree";

describe("face hole through-all depth", () => {
  it("adds overshoot on both sides of the host thickness", () => {
    const thickness = 20;
    const os = faceHoleOvershootMm(thickness);
    expect(os).toBeGreaterThanOrEqual(0.5);
    expect(faceHoleCutDepthMm(thickness)).toBeCloseTo(thickness + 2 * os, 5);
  });

  it("never returns less than the host thickness", () => {
    expect(faceHoleCutDepthMm(10)).toBeGreaterThan(10);
    expect(faceHoleCutDepthMm(0.1)).toBeGreaterThanOrEqual(0.5);
  });
});

describe("face sketch typed depth", () => {
  it("keeps a shorter typed depth as a blind pocket of that many millimetres", () => {
    const cutter = faceSketchHoleCutterMm(8, 20);
    expect(cutter).toBeCloseTo(faceBlindCutDepthMm(8), 5);
    expect(cutter - faceHoleOvershootMm(cutter)).toBeCloseTo(8, 5);
  });

  it("punches through when the typed depth is the part thickness", () => {
    expect(faceSketchHoleCutterMm(20, 20)).toBeCloseTo(faceHoleCutDepthMm(20), 5);
    expect(faceSketchHoleCutterMm(19.7, 20)).toBeCloseTo(faceHoleCutDepthMm(20), 5);
  });

  it("keeps a deep blind pocket at the typed depth", () => {
    const cutter = faceBlindCutDepthMm(40);
    expect(cutter - faceHoleOvershootMm(cutter)).toBeCloseTo(40, 5);
  });
});
