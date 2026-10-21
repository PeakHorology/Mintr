import { describe, expect, it } from "vitest";
import { appendOverhangBoundaryLines, bedFitForShapes, brandForPreset, brandsForKind, defaultPrinterForKind, kindForPreset, normalizePrinterBed, PRINTER_BRANDS, PRINTER_PRESETS, printersForBrand, triangleNeedsSupport, type PrinterBed } from "@/lib/printerBed";
import type { WorkplaneShape } from "@/types/sketchforge";

const bed: PrinterBed = {
  preset: "ender-3",
  label: "Creality Ender 3",
  width: 100,
  depth: 100,
  height: 50,
  kind: "filament",
  overhangAngle: 45,
  nozzleMm: 0.4,
  showBed: true,
  showStripes: true,
  showThinWalls: false,
  showSmallHoles: false,
  showTrappedResin: false,
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
    expect(normalizePrinterBed({ printerPreset: "ender-3" }).kind).toBe("filament");
    expect(normalizePrinterBed({ printerPreset: "formlabs-form-4" })).toMatchObject({
      preset: "formlabs-form-4",
      label: "Formlabs Form 4",
      kind: "resin",
      width: 200,
      depth: 125,
      height: 210,
    });
    expect(normalizePrinterBed({ printerPreset: "custom", printerKind: "resin" }).kind).toBe("resin");
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

  it("keeps filament and resin machines on separate brand lists", () => {
    expect(kindForPreset("formlabs-form-4")).toBe("resin");
    expect(kindForPreset("ender-3")).toBe("filament");
    expect(brandsForKind("resin")).toContain("Formlabs");
    expect(brandsForKind("resin")).toContain("Anycubic");
    expect(brandsForKind("resin")).not.toContain("Bambu Lab");
    expect(brandsForKind("filament")).not.toContain("Formlabs");
    expect(printersForBrand("Anycubic", "filament").some((preset) => preset.label.startsWith("Photon"))).toBe(false);
    expect(printersForBrand("Anycubic", "resin").map((preset) => preset.label)).toContain("Photon Mono 4");
    expect(printersForBrand("Anycubic", "resin").some((preset) => preset.label.startsWith("Kobra"))).toBe(false);
    expect(printersForBrand("Formlabs", "resin").map((preset) => preset.id)).toContain("formlabs-form-4");
    expect(defaultPrinterForKind("resin").id).toBe("formlabs-form-4");
    expect(defaultPrinterForKind("resin", "Anycubic").id).toBe("anycubic-photon-mono-4");
    expect(defaultPrinterForKind("filament", "Formlabs").id).toBe("ender-3");
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
    expect(triangleNeedsSupport(10, 10, 12, -0.6, 30)).toBe(true);
    expect(triangleNeedsSupport(10, 10, 12, -0.6, 45)).toBe(false);
  });

  it("draws only the outline of an overhang patch, not the interior edges", () => {
    const positions = [
      0, 0, 0, 1, 0, 0, 0, 0, 1,
      1, 0, 0, 1, 0, 1, 0, 0, 1,
    ];
    const lines: number[] = [];
    appendOverhangBoundaryLines(positions, lines);
    expect(lines.length / 6).toBe(4);
    const lifted: number[] = [];
    const normals = [
      0, 1, 0, 0, 1, 0, 0, 1, 0,
      0, 1, 0, 0, 1, 0, 0, 1, 0,
    ];
    appendOverhangBoundaryLines(positions, lifted, 1000, normals, 0.5);
    expect(lifted.length / 6).toBe(4);
    expect(lifted[1]).toBe(0.5);
  });
});
