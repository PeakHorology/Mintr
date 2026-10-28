import { describe, expect, it } from "vitest";
import { nestParts } from "@/lib/laser/nest";

const bed = { width: 300, depth: 200 };

describe("nesting parts on the laser bed", () => {
  it("packs parts on the bed without touching", () => {
    const items = [
      { id: "a", width: 120, depth: 60 },
      { id: "b", width: 60, depth: 120 },
      { id: "c", width: 80, depth: 40 },
      { id: "d", width: 30, depth: 30 },
    ];
    const result = nestParts(items, bed, 3);
    expect(result.sheets).toBe(1);
    expect(result.tooBig).toEqual([]);
    const boxes = result.placements.map((placement) => {
      const item = items.find((entry) => entry.id === placement.id)!;
      const [w, d] = placement.turned ? [item.depth, item.width] : [item.width, item.depth];
      return { ...placement, maxX: placement.minX + w, maxZ: placement.minZ + d };
    });
    for (const box of boxes) {
      expect(box.minX).toBeGreaterThanOrEqual(-150 - 1e-9);
      expect(box.maxX).toBeLessThanOrEqual(150 + 1e-9);
      expect(box.minZ).toBeGreaterThanOrEqual(-100 - 1e-9);
      expect(box.maxZ).toBeLessThanOrEqual(100 + 1e-9);
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const apart = a.maxX + 3 <= b.minX + 1e-9 || b.maxX + 3 <= a.minX + 1e-9 || a.maxZ + 3 <= b.minZ + 1e-9 || b.maxZ + 3 <= a.minZ + 1e-9;
        expect(apart).toBe(true);
      }
    }
    // The upright part is turned to lie along the bed.
    expect(result.placements.find((placement) => placement.id === "b")!.turned).toBe(true);
  });

  it("starts another sheet when the bed is full, and names parts too big for it", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ id: `p${index}`, width: 140, depth: 90 }));
    const result = nestParts([...many, { id: "huge", width: 400, depth: 400 }], bed, 3);
    expect(result.sheets).toBeGreaterThan(1);
    expect(result.tooBig).toEqual(["huge"]);
    const second = result.placements.filter((placement) => placement.sheet === 1);
    expect(second.length).toBeGreaterThan(0);
    expect(Math.min(...second.map((placement) => placement.minX))).toBeGreaterThan(150);
  });
});
