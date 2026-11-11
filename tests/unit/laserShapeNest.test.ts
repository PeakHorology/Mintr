import { createRequire } from "node:module";
import fs from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel, Vec2 } from "manifold-3d";
import { nestOutlines, overlappingGroups, placePoint, turnPoint, type ShapeNestItem } from "@/lib/laser/shapeNest";

let runtime: ManifoldToplevel;

beforeAll(async () => {
  const manifoldMod = await import("manifold-3d");
  const require = createRequire(import.meta.url);
  const wasmBinary = fs.readFileSync(require.resolve("manifold-3d/manifold.wasm"));
  runtime = await (manifoldMod.default as (cfg: { wasmBinary: Uint8Array }) => Promise<ManifoldToplevel>)({ wasmBinary });
  runtime.setup();
});

const rect = (x: number, z: number, w: number, d: number): Vec2[] => [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];
const circle = (cx: number, cz: number, r: number, n = 48): Vec2[] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cz + r * Math.sin((2 * Math.PI * i) / n)] as Vec2);

/** Each item's outline where the nest put it. */
function placed(items: readonly ShapeNestItem[], result: ReturnType<typeof nestOutlines>) {
  return result.placements.map((placement) => {
    const item = items.find((entry) => entry.id === placement.id)!;
    return { placement, loops: item.loops.map((loop) => loop.map((point) => placePoint(point, placement))) };
  });
}

/** Parts on one sheet keep the gap: grown by just under half of it, no two overlap. */
function expectGapKept(items: readonly ShapeNestItem[], result: ReturnType<typeof nestOutlines>, gap: number, bed: { width: number; depth: number }) {
  const parts = placed(items, result);
  for (const part of parts) {
    if (result.tooBig.includes(part.placement.id)) continue;
    const shift = part.placement.sheet * (bed.width + Math.max(20, gap * 4));
    for (const loop of part.loops) {
      for (const [x, z] of loop) {
        expect(x - shift).toBeGreaterThanOrEqual(-bed.width / 2 - 1e-6);
        expect(x - shift).toBeLessThanOrEqual(bed.width / 2 + 1e-6);
        expect(z).toBeGreaterThanOrEqual(-bed.depth / 2 - 1e-6);
        expect(z).toBeLessThanOrEqual(bed.depth / 2 + 1e-6);
      }
    }
  }
  const grown = parts.map((part) => {
    const section = new runtime.CrossSection(part.loops, "EvenOdd");
    const out = section.offset(gap / 2 - 0.01, "Round", 2, 24);
    section.delete();
    return out;
  });
  for (let i = 0; i < grown.length; i += 1) {
    for (let j = i + 1; j < grown.length; j += 1) {
      const both = grown[i].intersect(grown[j]);
      expect(both.area(), `${parts[i].placement.id} and ${parts[j].placement.id}`).toBeLessThan(1e-6);
      both.delete();
    }
  }
  grown.forEach((section) => section.delete());
}

describe("true-shape nesting", () => {
  it("turns points the way adding 90° to a part's turn does", () => {
    const turned = new THREE.Vector3(3, 0, 1).applyEuler(new THREE.Euler(0, Math.PI / 2, 0));
    const [x, z] = turnPoint([3, 1], 1);
    expect(x).toBeCloseTo(turned.x, 9);
    expect(z).toBeCloseTo(turned.z, 9);
    expect(turnPoint(turnPoint([3, 1], 2), 2)).toEqual([3, 1]);
  });

  it("fits two triangles in the space of one box, which box packing cannot", () => {
    const bed = { width: 110, depth: 110 };
    const triangle: Vec2[] = [[0, 0], [100, 0], [0, 100]];
    const items = [
      { id: "a", loops: [triangle] },
      { id: "b", loops: [triangle] },
    ];
    const result = nestOutlines(runtime, items, bed, 2);
    expect(result.sheets).toBe(1);
    expect(result.tooBig).toEqual([]);
    expectGapKept(items, result, 2, bed);
  });

  it("puts a small part inside a big part's hole", () => {
    const bed = { width: 130, depth: 130 };
    const items = [
      { id: "ring", loops: [circle(0, 0, 60), circle(0, 0, 45).reverse()] },
      { id: "disc", loops: [circle(500, 500, 20)] },
    ];
    const result = nestOutlines(runtime, items, bed, 3);
    expect(result.sheets).toBe(1);
    const parts = placed(items, result);
    const centre = (id: string) => {
      const loop = parts.find((part) => part.placement.id === id)!.loops[0];
      return loop.reduce((sum, [x, z]) => [sum[0] + x / loop.length, sum[1] + z / loop.length], [0, 0]);
    };
    const [rx, rz] = centre("ring");
    const [dx, dz] = centre("disc");
    expect(Math.hypot(rx - dx, rz - dz)).toBeLessThan(45 - 20 - 3 + 1e-6);
    expectGapKept(items, result, 3, bed);
  });

  it("keeps the gap asked for between many parts, onto more sheets when needed", () => {
    const bed = { width: 200, depth: 150 };
    const items: ShapeNestItem[] = [];
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 30; i += 1) {
      const shape = i % 3;
      if (shape === 0) items.push({ id: `r${i}`, loops: [rect(random() * 50, random() * 50, 10 + random() * 60, 8 + random() * 40)] });
      else if (shape === 1) items.push({ id: `c${i}`, loops: [circle(random() * 50, random() * 50, 5 + random() * 25)] });
      else items.push({ id: `t${i}`, loops: [[[0, 0], [20 + random() * 60, 0], [random() * 30, 15 + random() * 50]]] });
    }
    const started = performance.now();
    const result = nestOutlines(runtime, items, bed, 1.5);
    const took = performance.now() - started;
    expect(result.placements).toHaveLength(items.length);
    expect(took).toBeLessThan(5000);
    for (let sheet = 0; sheet < result.sheets; sheet += 1) {
      const ids = new Set(result.placements.filter((placement) => placement.sheet === sheet).map((placement) => placement.id));
      const onSheet = items.filter((item) => ids.has(item.id));
      expectGapKept(onSheet, { ...result, placements: result.placements.filter((placement) => ids.has(placement.id)) }, 1.5, bed);
    }
  });

  it("keeps parts that may not turn the way they lie", () => {
    const items = [{ id: "long", loops: [rect(0, 0, 20, 90)], canTurn: false }];
    const result = nestOutlines(runtime, items, { width: 100, depth: 100 }, 2);
    expect(result.placements[0].quarterTurns).toBe(0);
  });

  it("keeps overlapping parts together, such as engraving on a plate", () => {
    const plate = [rect(0, 0, 80, 40), circle(70, 20, 4).reverse()];
    const label = [rect(10, 10, 30, 10)];
    // Over the plate's hole: still the plate's.
    const dot = [circle(70, 20, 2)];
    const apart = [rect(200, 200, 10, 10)];
    const groups = overlappingGroups(runtime, [plate, label, apart]);
    expect(groups.map((group) => group.members.sort())).toEqual([[0, 1], [2]]);
    const area = (loops: Vec2[][]) => {
      const section = new runtime.CrossSection(loops, "EvenOdd");
      const value = section.area();
      section.delete();
      return value;
    };
    expect(area(groups[0].loops)).toBeCloseTo(area(plate), 1);
    // A part touching only inside another's hole does not join it, but one over the hole's edge does.
    expect(overlappingGroups(runtime, [plate, dot])).toHaveLength(2);
    const overEdge = [circle(70, 20, 6)];
    const joined = overlappingGroups(runtime, [plate, overEdge]);
    expect(joined).toHaveLength(1);
    // Its outline fills the hole it covers.
    expect(joined[0].loops).toHaveLength(1);
  });

  it("gives a part too big for the bed a sheet of its own", () => {
    const items = [
      { id: "huge", loops: [rect(0, 0, 300, 300)] },
      { id: "small", loops: [rect(0, 0, 10, 10)] },
    ];
    const result = nestOutlines(runtime, items, { width: 100, depth: 100 }, 2);
    expect(result.tooBig).toEqual(["huge"]);
    const huge = result.placements.find((placement) => placement.id === "huge")!;
    const small = result.placements.find((placement) => placement.id === "small")!;
    expect(small.sheet).not.toBe(huge.sheet);
  });
});
