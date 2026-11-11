import { createRequire } from "node:module";
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel, Vec2 } from "manifold-3d";
import { FIT_TEST_KEY_WIDTH, fitTestKerfs, fitTestLabel, fitTestLayout } from "@/lib/laser/fitTest";

let runtime: ManifoldToplevel;

beforeAll(async () => {
  const manifoldMod = await import("manifold-3d");
  const require = createRequire(import.meta.url);
  const wasmBinary = fs.readFileSync(require.resolve("manifold-3d/manifold.wasm"));
  runtime = await (manifoldMod.default as (cfg: { wasmBinary: Uint8Array }) => Promise<ManifoldToplevel>)({ wasmBinary });
  runtime.setup();
});

/**
 * What comes off the laser: the cut file moves the outline out by half the kerf
 * setting, as buildCutLayout does, then the beam burns half the real kerf off it.
 */
function cutOut(outline: readonly [number, number][], setting: number, real: number) {
  const drawn = new runtime.CrossSection([outline.map(([x, z]) => [x, z] as Vec2)], "EvenOdd");
  const path = drawn.offset(setting / 2, "Miter", 2);
  const part = path.offset(-real / 2, "Miter", 2);
  drawn.delete();
  path.delete();
  return part;
}

/** Width of the gap in the comb at x near `middle`, measured along a thin line across the slot halfway down. */
function slotWidth(comb: ReturnType<typeof cutOut>, middle: number, z: number) {
  const probe = runtime.CrossSection.square([12, 0.01]).translate([middle - 6, z]);
  const metal = probe.intersect(comb);
  const width = 12 - metal.area() / 0.01;
  probe.delete();
  metal.delete();
  return width;
}

describe("fit test", () => {
  it("tries eleven kerfs round what each kind of laser burns", () => {
    expect(fitTestKerfs("diode")).toEqual([0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2]);
    expect(fitTestKerfs("co2")[0]).toBe(0.06);
    expect(fitTestKerfs("co2")[10]).toBe(0.36);
    expect(fitTestKerfs("infrared")[10]).toBe(0.1);
    expect(fitTestLabel(0.12)).toBe("12");
    expect(fitTestLabel(0)).toBe("0");
  });

  it("the slot numbered with the real kerf comes out exactly the key's width", () => {
    const setting = 0.08;
    const kerfs = fitTestKerfs("diode");
    const layout = fitTestLayout(kerfs, setting);
    const back = Math.min(...layout.comb.map(([, z]) => z));
    for (const real of [0.04, 0.1, 0.16]) {
      const comb = cutOut(layout.comb, setting, real);
      const key = cutOut(layout.key, setting, real);
      const keyBounds = key.bounds();
      const keyWidth = keyBounds.max[1] - keyBounds.min[1];
      expect(keyWidth).toBeCloseTo(FIT_TEST_KEY_WIDTH + setting - real, 6);
      layout.labels.forEach((label, index) => {
        const width = slotWidth(comb, label.x, back + 3);
        const kerf = kerfs[index];
        if (Math.abs(kerf - real) < 1e-9) expect(width).toBeCloseTo(keyWidth, 4);
        // Slots for a smaller kerf are looser, for a bigger one tighter.
        else if (kerf < real) expect(width).toBeGreaterThan(keyWidth);
        else expect(width).toBeLessThan(keyWidth);
      });
      comb.delete();
      key.delete();
    }
  });

  it("numbers sit in front of their slots, within the comb", () => {
    const layout = fitTestLayout(fitTestKerfs("co2"), 0.15);
    const zs = layout.comb.map(([, z]) => z);
    const front = Math.max(...zs);
    const back = Math.min(...zs);
    for (const label of layout.labels) {
      expect(label.z - label.depth / 2).toBeGreaterThan(back + 6);
      expect(label.z + label.depth / 2).toBeLessThan(front);
    }
    // The key lies clear of the comb.
    expect(Math.min(...layout.key.map(([, z]) => z))).toBeGreaterThan(front);
  });
});
