import { describe, expect, it } from "vitest";
import { boxPanels, boxSpecProblem, fingerCount, layOutPanels, placedOutline, type BoxSpec } from "@/lib/laser/boxMaker";

function area(points: readonly [number, number][]) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) sum += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  return Math.abs(sum / 2);
}

const spec: BoxSpec = { width: 120, depth: 80, height: 60, thickness: 3, finger: 10, lid: true };

describe("box maker", () => {
  it("fills the walls of a closed box exactly, with no gap or overlap", () => {
    const panels = boxPanels(spec);
    expect(panels.map((panel) => panel.name)).toEqual(["Bottom", "Lid", "Front", "Back", "Left side", "Right side"]);
    const { width: W, depth: D, height: H, thickness: t } = spec;
    const walls = W * D * H - (W - 2 * t) * (D - 2 * t) * (H - 2 * t);
    const sheet = panels.reduce((sum, panel) => sum + area(panel.outline), 0) * t;
    expect(sheet).toBeCloseTo(walls, 6);
  });

  it("fills the walls of an open box exactly", () => {
    const open = { ...spec, lid: false };
    const panels = boxPanels(open);
    expect(panels).toHaveLength(5);
    const { width: W, depth: D, height: H, thickness: t } = open;
    const walls = W * D * H - (W - 2 * t) * (D - 2 * t) * (H - t);
    expect(panels.reduce((sum, panel) => sum + area(panel.outline), 0) * t).toBeCloseTo(walls, 6);
  });

  it("fits together in 3D: every point of the walls is in exactly one panel", () => {
    for (const lid of [true, false]) {
      const box: BoxSpec = { width: 30, depth: 24, height: 18, thickness: 3, finger: 5, lid };
      const { width: W, depth: D, height: H, thickness: t } = box;
      const panels = new Map(boxPanels(box).map((panel) => [panel.name, panel.outline]));
      const inside = (outline: [number, number][] | undefined, u: number, v: number) => {
        if (!outline) return false;
        let hit = false;
        for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i += 1) {
          const [xi, yi] = outline[i];
          const [xj, yj] = outline[j];
          if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) hit = !hit;
        }
        return hit;
      };
      let wrong = 0;
      // Samples off the half millimetre, so none lands on a finger's edge.
      for (let x = 0.13; x < W; x += 0.5) {
        for (let y = 0.17; y < H; y += 0.5) {
          for (let z = 0.11; z < D; z += 0.5) {
            const inWall = x < t || x > W - t || z < t || z > D - t || y < t || (lid && y > H - t);
            let count = 0;
            if (y < t && inside(panels.get("Bottom"), x, z)) count += 1;
            if (lid && y > H - t && inside(panels.get("Lid"), x, z)) count += 1;
            if (z < t && inside(panels.get("Back"), x, y)) count += 1;
            if (z > D - t && inside(panels.get("Front"), x, y)) count += 1;
            if (x < t && inside(panels.get("Left side"), z, y)) count += 1;
            if (x > W - t && inside(panels.get("Right side"), z, y)) count += 1;
            if (count !== (inWall ? 1 : 0)) wrong += 1;
          }
        }
      }
      expect(wrong).toBe(0);
    }
  });

  it("uses an odd number of fingers, none thinner than the sheet", () => {
    expect(fingerCount(120, 10, 3)).toBe(11);
    expect(fingerCount(80, 10, 3) % 2).toBe(1);
    expect(fingerCount(12, 10, 3)).toBe(1);
    expect(fingerCount(15, 1, 3)).toBe(3);
  });

  it("keeps each panel inside its own size, with straight sides only", () => {
    for (const panel of boxPanels(spec)) {
      for (const [x, y] of panel.outline) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(panel.width + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(panel.height + 1e-9);
      }
      panel.outline.forEach((point, index) => {
        const next = panel.outline[(index + 1) % panel.outline.length];
        expect(Math.abs(point[0] - next[0]) < 1e-9 || Math.abs(point[1] - next[1]) < 1e-9).toBe(true);
      });
    }
  });

  it("lays the panels out apart from each other", () => {
    const placed = layOutPanels(boxPanels(spec), { gap: 5 });
    for (let a = 0; a < placed.length; a += 1) {
      for (let b = a + 1; b < placed.length; b += 1) {
        const apart = Math.abs(placed[a].x - placed[b].x) >= (placed[a].width + placed[b].width) / 2 + 5 - 1e-9
          || Math.abs(placed[a].z - placed[b].z) >= (placed[a].height + placed[b].height) / 2 + 5 - 1e-9;
        expect(apart).toBe(true);
      }
    }
    const outline = placedOutline(placed[0]);
    expect(area(outline)).toBeCloseTo(area(placed[0].outline), 6);
  });

  it("says when a box is too small for the sheet", () => {
    expect(boxSpecProblem(spec)).toBeNull();
    expect(boxSpecProblem({ ...spec, height: 8 })).toMatch(/at least 9 mm/);
    expect(boxSpecProblem({ ...spec, finger: 0 })).toMatch(/more than 0/);
  });
});
