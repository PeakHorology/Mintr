import { describe, expect, it } from "vitest";
import { createBooleanTextGeometry, textLayoutMetrics } from "@/lib/editorShapeMesh";
import { resolveTextFont, textFontOptions } from "@/lib/textFonts";
import type { WorkplaneShape } from "@/types/sketchforge";

const text = (overrides: Partial<WorkplaneShape>): WorkplaneShape => ({
  id: "t", name: "Text", kind: "text", color: "#cf101b", x: 0, z: 0, elevation: 0,
  size: 40, width: 20, depth: 40, height: 5, rotation: 0, text: "I", font: "Sans", ...overrides,
});

/** How far the letter's back (top of the letter, as it reads) sits right of its front. */
function leanOf(shape: WorkplaneShape) {
  const geometry = createBooleanTextGeometry(shape);
  const p = geometry.getAttribute("position");
  let backX = 0, backN = 0, frontX = 0, frontN = 0;
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox!;
  for (let i = 0; i < p.count; i += 1) {
    const z = p.getZ(i);
    if (z < min.z + (max.z - min.z) * 0.1) { backX += p.getX(i); backN += 1; }
    if (z > max.z - (max.z - min.z) * 0.1) { frontX += p.getX(i); frontN += 1; }
  }
  return backX / backN - frontX / frontN;
}

describe("Slant on text", () => {
  it("leans the tops of the letters to the right, and none when it is 0", () => {
    const upright = leanOf(text({}));
    expect(leanOf(text({ textSlant: 0 }))).toBeCloseTo(upright, 6);
    expect(leanOf(text({ textSlant: 15 })) - upright).toBeGreaterThan(1);
  });

  it("measures slanted text as wider, so it still fits its box", () => {
    expect(textLayoutMetrics({ text: "llll", font: "Sans", textSlant: 20 }).laidWidth)
      .toBeGreaterThan(textLayoutMetrics({ text: "llll", font: "Sans" }).laidWidth);
    for (const word of ["HELLO", "llll", "I"]) {
      for (const slant of [0, 10, 20]) {
        const geometry = createBooleanTextGeometry(text({ text: word, textSlant: slant, width: 100, depth: 400 }));
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        expect(box.max.x - box.min.x, `${word} at ${slant}°`).toBeLessThanOrEqual(100.01);
      }
    }
  });

  it("offers the bundled Heavy font, which has letters, numbers and symbols", () => {
    expect(textFontOptions()).toContain("Heavy");
    const glyphs = resolveTextFont("Heavy").data.glyphs as Record<string, unknown>;
    for (const char of "AZaz09&/\"'-") expect(glyphs[char], char).toBeTruthy();
  });
});
