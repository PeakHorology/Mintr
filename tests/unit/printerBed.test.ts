import { describe, expect, it } from "vitest";
import { bedFitForShapes, brandForPreset, normalizePrinterBed, PRINTER_BRANDS, PRINTER_PRESETS, printersForBrand, triangleNeedsSupport, type PrinterBed } from "@/lib/printerBed";
import type { WorkplaneShape } from "@/types/sketchforge";

const bed: PrinterBed = {
  preset: "ender-3",
  label: "Creality Ender 3",
  width: 100,
  depth: 100,
  height: 50,
  overhangAngle: 45,
  showBed: true,
  showStripes: true,
};

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

describe("printer bed", () => {
  it("keeps a named printer's size and a custom size the user typed", () => {
    expect(normalizePrinterBed({ printerPreset: "prusa-mk4" })).toMatchObject({
      preset: "prusa-mk4",
      label: "Prusa MK4",
      width: 250,
      depth: 210,
      height: 220,
    });
    expect(normalizePrinterBed({ printerPreset: "bambu-h2s" })).toMatchObject({
      width: 340,
      depth: 320,
      height: 340,
    });
    expect(normalizePrinterBed({ printerPreset: "ender-3" }).label).toBe("Creality Ender 3 / V2 / Pro");
    expect(normalizePrinterBed({
      printerPreset: "custom",
      printerWidth: 180,
      printerDepth: 180,
      printerHeight: 200,
      overhangAngle: 50,
      showPrinterBed: false,
      showOverhangStripes: false,
    })).toMatchObject({
      preset: "custom",
      width: 180,
      depth: 180,
      height: 200,
      overhangAngle: 50,
      showBed: false,
      showStripes: false,
    });
    expect(normalizePrinterBed({ printerPreset: "ender-3" }).showStripes).toBe(false);
  });

  it("groups machines by brand and keeps each plate inside the published size", () => {
    expect(PRINTER_BRANDS[0]).toBe("Anycubic");
    expect(PRINTER_BRANDS[PRINTER_BRANDS.length - 1]).toBe("Custom");
    expect(brandForPreset("bambu-a1-mini")).toBe("Bambu Lab");
    expect(brandForPreset("missing")).toBe("Custom");
    expect(printersForBrand("Bambu Lab").map((preset) => preset.label)).toContain("H2S");
    expect(printersForBrand("Creality").some((preset) => preset.id === "ender-3")).toBe(true);
    const ids = PRINTER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const brand of PRINTER_BRANDS) {
      const models = printersForBrand(brand);
      expect(models.length).toBeGreaterThan(0);
      expect(new Set(models.map((preset) => preset.label)).size).toBe(models.length);
    }
  });

  it("warns when a part sticks past the bed or above the printer", () => {
    expect(bedFitForShapes([shape()], bed).message).toBeNull();
    expect(bedFitForShapes([shape({ x: 60 })], bed).message).toBe("Past the 100 × 100 mm bed.");
    expect(bedFitForShapes([shape({ height: 80 })], bed).message).toBe("Taller than 50 mm.");
    expect(bedFitForShapes([shape({ hidden: true, x: 80 })], bed).message).toBeNull();
  });

  it("stripes faces that lean out past the angle, and not the face on the bed", () => {
    expect(triangleNeedsSupport(10, 10, 12, -0.9, 45)).toBe(true);
    expect(triangleNeedsSupport(10, 10, 12, -0.4, 45)).toBe(false);
    expect(triangleNeedsSupport(0.1, 0.1, 0.2, -1, 45)).toBe(false);
  });
});
