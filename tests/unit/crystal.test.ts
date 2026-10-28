import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkInsideCrystal,
  crystalSizeLabel,
  DEFAULT_CRYSTAL,
  fitInsideCrystal,
  forgetCrystalSize,
  loadSavedCrystalSizes,
  normalizeCrystal,
  saveCrystalSize,
  type CrystalBlank,
} from "@/lib/laser/crystal";
import { crystalReach, isCrystalDesign, LASER_MATERIALS, laserDesignLabel, normalizeLaserSettings, sheetThickness } from "@/lib/laserMachine";

type Vec3 = [number, number, number];

/** The corners of a box, as a model's points. */
function cube(minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): Vec3[] {
  const points: Vec3[] = [];
  for (const x of [minX, maxX]) for (const y of [minY, maxY]) for (const z of [minZ, maxZ]) points.push([x, y, z]);
  return points;
}

function moved(points: Vec3[], fit: NonNullable<ReturnType<typeof fitInsideCrystal>>): Vec3[] {
  return points.map(([x, y, z]) => [
    fit.target[0] + (x - fit.middle[0]) * fit.ratio,
    fit.target[1] + (y - fit.middle[1]) * fit.ratio,
    fit.target[2] + (z - fit.middle[2]) * fit.ratio,
  ]);
}

const block: CrystalBlank = { ...DEFAULT_CRYSTAL, shape: "block", width: 50, depth: 50, height: 80, margin: 3 };
const ball: CrystalBlank = { ...DEFAULT_CRYSTAL, shape: "ball", diameter: 80, margin: 3 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("crystal blanks", () => {
  it("keeps sizes and margins in range", () => {
    const blank = normalizeCrystal({ shape: "ball", width: 1, depth: 900, height: "x", diameter: 60, margin: 99 });
    expect(blank).toMatchObject({ shape: "ball", width: 5, depth: 300, height: DEFAULT_CRYSTAL.height, diameter: 60, margin: 20 });
    expect(normalizeCrystal(null)).toEqual(DEFAULT_CRYSTAL);
  });

  it("names sizes plainly", () => {
    expect(crystalSizeLabel(block)).toBe("50 × 50 × 80 mm block");
    expect(crystalSizeLabel(ball)).toBe("80 mm ball");
  });

  it("fits a model inside a block, clear of every surface", () => {
    const model = cube(100, 300, 0, 50, -40, 40);
    const fit = fitInsideCrystal(model, block, null)!;
    const placed = moved(model, fit);
    expect(checkInsideCrystal(placed, block, null).status).toBe("inside");
    // The widest side fills the space: 50 − 2 × 3 = 44 mm.
    const xs = placed.map((point) => point[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(44, 6);
  });

  it("fits a model inside a ball", () => {
    const model = cube(-10, 10, 0, 20, -10, 10);
    const placed = moved(model, fitInsideCrystal(model, ball, null)!);
    expect(checkInsideCrystal(placed, ball, null).status).toBe("inside");
    const furthest = Math.max(...placed.map(([x, y, z]) => Math.hypot(x, y - 40, z)));
    expect(furthest).toBeCloseTo(37, 6);
  });

  it("keeps a model within the F2 Ultra UV's reach", () => {
    const wide: CrystalBlank = { ...block, width: 120, depth: 120 };
    const model = cube(0, 200, 0, 10, 0, 200);
    const placed = moved(model, fitInsideCrystal(model, wide, 70)!);
    expect(Math.max(...placed.map((point) => Math.abs(point[0])))).toBeCloseTo(35, 6);
    expect(checkInsideCrystal(placed, wide, 70).status).toBe("inside");
    expect(checkInsideCrystal(cube(-40, 40, 10, 20, -10, 10), wide, 70)).toMatchObject({ status: "outside", message: expect.stringContaining("70 × 70") });
  });

  it("warns when a model is outside or too close to the surface", () => {
    expect(checkInsideCrystal(cube(-30, 30, 10, 20, -10, 10), block, null).status).toBe("outside");
    expect(checkInsideCrystal(cube(-24, 24, 10, 20, -10, 10), block, null)).toMatchObject({ status: "close", message: expect.stringContaining("3 mm") });
    expect(checkInsideCrystal(cube(-10, 10, 10, 20, -10, 10), block, null).status).toBe("inside");
    expect(checkInsideCrystal(cube(-39, 39, 35, 45, -1, 1), ball, null).status).toBe("close");
  });

  it("saves sizes for every design, without repeats", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    vi.stubGlobal("window", { dispatchEvent: () => true });
    const size = { shape: "block" as const, width: 40, depth: 40, height: 90, diameter: 80 };
    saveCrystalSize(size);
    saveCrystalSize(size);
    saveCrystalSize({ shape: "block", width: 50, depth: 50, height: 80, diameter: 80 });
    expect(loadSavedCrystalSizes()).toHaveLength(1);
    forgetCrystalSize(size);
    expect(loadSavedCrystalSizes()).toEqual([]);
  });
});

describe("crystal designs", () => {
  it("offers K9 crystal on every laser", () => {
    expect(LASER_MATERIALS.some((entry) => entry.id === "k9-crystal")).toBe(true);
    const diode = normalizeLaserSettings({ designKind: "laser", laserPreset: "custom", laserType: "diode", materialPreset: "k9-crystal" });
    expect(isCrystalDesign(diode)).toBe(true);
    expect(crystalReach(diode)).toBeNull();
  });

  it("treats a crystal as a blank, not a sheet", () => {
    const settings = normalizeLaserSettings({ designKind: "laser", laserPreset: "xtool-f2-ultra-uv", materialPreset: "k9-crystal" });
    expect(isCrystalDesign(settings)).toBe(true);
    expect(sheetThickness(settings)).toBeNull();
    expect(crystalReach(settings)).toBe(70);
    expect(laserDesignLabel(settings)).toBe("Laser · 50 × 50 × 80 mm block of K9 crystal");
    const plywood = normalizeLaserSettings({ designKind: "laser", laserPreset: "xtool-f2-ultra-uv", materialPreset: "plywood" });
    expect(sheetThickness(plywood)).toBe(plywood.materialThickness);
  });
});
