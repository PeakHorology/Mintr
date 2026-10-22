import { describe, expect, it } from "vitest";
import {
  curveSidesForShape,
  curvedDisplayTessellation,
  DEFAULT_DISPLAY_QUALITY,
  getActiveDisplayQuality,
  modifierPreviewQualityForDisplay,
  modifierQualityForDisplay,
  resolveHollowCylinderSegments,
  resolveShapeSides,
  resolveShapeSteps,
  setActiveDisplayQuality,
  withDisplayQuality,
  withDisplayQualityAsync,
} from "@/lib/displayTessellation";

describe("display tessellation", () => {
  it("defaults to standard display quality", () => {
    expect(DEFAULT_DISPLAY_QUALITY).toBe("standard");
    expect(modifierQualityForDisplay("smooth")).toBe("ultra");
    expect(modifierQualityForDisplay("standard")).toBe("fine");
    expect(modifierQualityForDisplay("draft")).toBe("draft");
    expect(modifierPreviewQualityForDisplay("draft")).toBe("draft");
    expect(modifierPreviewQualityForDisplay("standard")).toBe("fine");
    expect(modifierPreviewQualityForDisplay("smooth")).toBe("fine");
  });

  it("restores viewport quality after a working tessellation wrap", () => {
    setActiveDisplayQuality("smooth");
    const sides = withDisplayQuality("draft", () => resolveShapeSides("cylinder", undefined));
    expect(sides).toBe(64);
    expect(getActiveDisplayQuality()).toBe("smooth");
  });

  it("restores viewport quality after an async working tessellation wrap", async () => {
    setActiveDisplayQuality("smooth");
    const sides = await withDisplayQualityAsync("draft", async () => resolveShapeSides("cylinder", undefined));
    expect(sides).toBe(64);
    expect(getActiveDisplayQuality()).toBe("smooth");
  });

  it("upgrades legacy cylinder/sphere tessellation with display quality", () => {
    setActiveDisplayQuality("smooth");
    expect(resolveShapeSides("cylinder", 96, "smooth")).toBe(192);
    expect(resolveShapeSteps("sphere", 24, "smooth")).toBe(64);
    expect(resolveHollowCylinderSegments("smooth")).toBe(256);

    setActiveDisplayQuality("draft");
    expect(resolveShapeSides("cylinder", 96, "draft")).toBe(64);
    expect(resolveShapeSteps("sphere", 24, "draft")).toBe(16);
  });

  it("keeps custom low facet counts for intentional polygons", () => {
    expect(resolveShapeSides("cylinder", 12, "smooth")).toBe(12);
    expect(resolveShapeSides("polygon", 6, "smooth")).toBe(6);
  });

  it("matches a fillet mesh to the curve already on screen", () => {
    setActiveDisplayQuality("smooth");
    expect(curveSidesForShape({ kind: "cylinder", sides: 96 })).toBe(192);
    expect(curveSidesForShape({ kind: "cylinder", sides: 12 })).toBe(12);
    expect(curveSidesForShape({ kind: "box" })).toBe(192);
    expect(curveSidesForShape({ kind: "torus", steps: 64 })).toBe(256);
    const smooth = curvedDisplayTessellation(1, 192);
    expect(smooth.angularDeflection).toBeCloseTo((Math.PI * 2) / 192, 8);
    expect(smooth.linearDeflection).toBeGreaterThanOrEqual(0.02);
    expect(smooth.linearDeflection).toBeLessThanOrEqual(0.2);
  });

  it("keeps deliberate facet counts that collide with another kind's default", () => {
    // 144 and 256 are defaults for other kinds, never for a cylinder.
    expect(resolveShapeSides("cylinder", 144, "smooth")).toBe(144);
    expect(resolveShapeSides("cylinder", 256, "smooth")).toBe(256);
    // 20, 32, 40 and 56 belong to halfSphere, not to a sphere.
    for (const steps of [20, 32, 40, 56]) {
      expect(resolveShapeSteps("sphere", steps, "smooth")).toBe(steps);
    }
    // A box set to 20 must not be pulled down to the smooth default of 16.
    expect(resolveShapeSteps("box", 20, "smooth")).toBe(20);
  });

  it("still follows quality for values a lower quality assigned automatically", () => {
    // A draft round roof stores 48; raising quality must upgrade it.
    expect(resolveShapeSides("roundRoof", 48, "smooth")).toBe(128);
    // Same for a draft box (6) and a standard box (12).
    expect(resolveShapeSteps("box", 6, "smooth")).toBe(16);
    expect(resolveShapeSteps("box", 12, "smooth")).toBe(16);
  });
});
