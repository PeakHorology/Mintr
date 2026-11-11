import { describe, expect, it } from "vitest";
import type { Vec2 } from "manifold-3d";
import { arcBulge, fitPath } from "@/lib/laser/arcFit";
import { cutLayoutDxf, cutLayoutSvg, type CutLayout } from "@/lib/laser/cutFile";

const circle = (radius: number, sides: number, cx = 0, cy = 0, clockwise = false): Vec2[] => Array.from({ length: sides }, (_, index) => {
  const angle = (index / sides) * Math.PI * 2 * (clockwise ? -1 : 1);
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
});

function roundedRectangle(width: number, depth: number, radius: number, perCorner = 16): Vec2[] {
  const out: Vec2[] = [];
  const corners: [number, number, number][] = [[width - radius, depth - radius, 0], [radius, depth - radius, 90], [radius, radius, 180], [width - radius, radius, 270]];
  for (const [cx, cy, start] of corners) {
    for (let step = 0; step <= perCorner; step += 1) {
      const angle = ((start + (step / perCorner) * 90) * Math.PI) / 180;
      out.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
    }
  }
  return out;
}

/** Every outline point must still sit on what was fitted. */
function worstMiss(points: readonly Vec2[], closed: boolean) {
  const fitted = fitPath(points, closed)!;
  const drawn: Vec2[] = [];
  let from = fitted.start;
  for (const segment of fitted.segments) {
    if (segment.kind === "line") {
      for (let t = 0; t <= 1; t += 0.05) drawn.push([from[0] + (segment.to[0] - from[0]) * t, from[1] + (segment.to[1] - from[1]) * t]);
    } else {
      const a = Math.atan2(from[1] - segment.center[1], from[0] - segment.center[0]);
      for (let t = 0; t <= 1; t += 0.001) {
        const angle = a + (segment.sweep ? 1 : -1) * segment.angle * t;
        drawn.push([segment.center[0] + segment.radius * Math.cos(angle), segment.center[1] + segment.radius * Math.sin(angle)]);
      }
    }
    from = segment.to;
  }
  return Math.max(...points.map((point) => Math.min(...drawn.map((other) => Math.hypot(point[0] - other[0], point[1] - other[1])))));
}

const count = (points: readonly Vec2[], closed = true) => {
  const fitted = fitPath(points, closed)!;
  return {
    arcs: fitted.segments.filter((segment) => segment.kind === "arc").length,
    lines: fitted.segments.filter((segment) => segment.kind === "line").length,
  };
};

describe("fitting arcs to an outline", () => {
  it("turns a many-sided circle into a few true arcs, in both directions", () => {
    for (const clockwise of [false, true]) {
      const { arcs, lines } = count(circle(20, 96, 5, 7, clockwise));
      expect(lines).toBe(0);
      expect(arcs).toBeGreaterThanOrEqual(3);
      expect(arcs).toBeLessThanOrEqual(5);
      expect(worstMiss(circle(20, 96, 5, 7, clockwise), true)).toBeLessThan(0.03);
    }
  });

  it("finds the corners and sides of a rounded rectangle", () => {
    const outline = roundedRectangle(60, 40, 5);
    const { arcs, lines } = count(outline);
    expect(arcs).toBe(4);
    expect(lines).toBe(4);
    expect(worstMiss(outline, true)).toBeLessThan(0.03);
  });

  it("leaves real polygons and straight parts alone", () => {
    expect(count(circle(20, 6))).toEqual({ arcs: 0, lines: 6 });
    expect(count(circle(50, 16))).toEqual({ arcs: 0, lines: 16 });
    expect(count([[0, 0], [30, 0], [30, 20], [0, 20]])).toEqual({ arcs: 0, lines: 4 });
    expect(count([[0, 0], [10, 0], [20, 0.001], [30, 0], [40, 0]], false).arcs).toBe(0);
  });

  it("does not bridge a corner where two arcs meet", () => {
    // A lens: two arcs meeting at sharp points.
    const lens: Vec2[] = [];
    for (let i = 0; i <= 20; i += 1) {
      const a = (Math.PI / 3) * (i / 20) - Math.PI / 6;
      lens.push([20 * Math.cos(a) - 17.32, 20 * Math.sin(a)]);
    }
    for (let i = 1; i < 20; i += 1) {
      const a = (5 * Math.PI) / 6 + (Math.PI / 3) * (i / 20);
      lens.push([20 * Math.cos(a) + 17.32, 20 * Math.sin(a)]);
    }
    const { arcs, lines } = count(lens);
    expect(arcs).toBe(2);
    expect(lines).toBe(0);
    expect(worstMiss(lens, true)).toBeLessThan(0.03);
  });

  it("follows a curve that is not a circle closely with several arcs", () => {
    const curve: Vec2[] = Array.from({ length: 120 }, (_, index) => {
      const t = (index / 120) * Math.PI * 2;
      return [30 * Math.cos(t), 12 * Math.sin(t)];
    });
    const { arcs } = count(curve);
    expect(arcs).toBeGreaterThan(3);
    expect(arcs).toBeLessThan(60);
    expect(worstMiss(curve, true)).toBeLessThan(0.03);
  });

  it("gives the bulge DXF needs: a quarter circle bulges by tan(22.5 degrees)", () => {
    const arc = fitPath(Array.from({ length: 13 }, (_, index) => {
      const angle = (index / 12) * (Math.PI / 2);
      return [10 * Math.cos(angle), 10 * Math.sin(angle)] as Vec2;
    }), false)!.segments[0];
    if (arc.kind !== "arc") throw new Error("Expected an arc");
    expect(arcBulge(arc)).toBeCloseTo(Math.tan(Math.PI / 8), 3);
  });

  it("is quick on a long outline", () => {
    const started = performance.now();
    fitPath(circle(100, 20000), true);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

/** Reads a file back and walks it: the middle of each arc shows which way it really bends. */
describe("the files", () => {
  const outline = circle(10, 64, 50, 50);
  const layout: CutLayout = {
    cut: [{ points: outline, closed: true }, { points: roundedRectangle(60, 40, 5).map(([x, y]) => [x + 100, y] as Vec2), closed: true }],
    score: [],
    engrave: [],
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
    cutLength: 0,
    scoreLength: 0,
    skipped: [],
  };

  it("SVG arcs bend the right way", () => {
    const svg = cutLayoutSvg(layout, { title: "Test", style: "lightburn" });
    const d = /d="(M[^"]*A[^"]*)"/.exec(svg)![1];
    const tokens = d.replace(/([MALZ])/g, " $1 ").trim().split(/\s+/);
    let index = 0;
    let at: Vec2 = [0, 0];
    let arcs = 0;
    while (index < tokens.length) {
      const op = tokens[index++];
      if (op === "M" || op === "L") {
        at = [Number(tokens[index++]), Number(tokens[index++])];
        continue;
      }
      if (op === "Z") continue;
      const radius = Number(tokens[index++]);
      index += 4;
      const sweep = tokens[index - 1] === "1";
      const to: Vec2 = [Number(tokens[index++]), Number(tokens[index++])];
      // Sweep 1 moves toward positive angles, so the centre is on the positive-turn side of the chord.
      const mx = (at[0] + to[0]) / 2;
      const my = (at[1] + to[1]) / 2;
      const half = Math.hypot(to[0] - at[0], to[1] - at[1]) / 2;
      const rise = Math.sqrt(Math.max(0, radius * radius - half * half));
      const nx = -(to[1] - at[1]) / (2 * half);
      const ny = (to[0] - at[0]) / (2 * half);
      const center: Vec2 = [mx + nx * rise * (sweep ? 1 : -1), my + ny * rise * (sweep ? 1 : -1)];
      // Shifted by the 1 mm margin: the circle's own centre.
      expect(center[0]).toBeCloseTo(51, 1);
      expect(center[1]).toBeCloseTo(51, 1);
      at = to;
      arcs += 1;
    }
    expect(arcs).toBeGreaterThan(1);
  });

  it("DXF arcs bend the right way and the loop still closes", () => {
    const lines = cutLayoutDxf(layout).split("\n");
    const polylines: { x: number; y: number; bulge: number }[][] = [];
    let inVertex = false;
    for (let index = 0; index + 1 < lines.length; index += 2) {
      const code = lines[index];
      const value = lines[index + 1];
      if (code === "0") inVertex = value === "VERTEX";
      if (code === "0" && value === "POLYLINE") polylines.push([]);
      if (code === "0" && value === "VERTEX") polylines[polylines.length - 1].push({ x: 0, y: 0, bulge: 0 });
      if (!inVertex) continue;
      const vertex = polylines[polylines.length - 1][polylines[polylines.length - 1].length - 1];
      if (code === "10") vertex.x = Number(value);
      if (code === "20") vertex.y = Number(value);
      if (code === "42") vertex.bulge = Number(value);
    }
    const loop = polylines[0];
    expect(loop.length).toBeLessThan(8);
    let total = 0;
    loop.forEach((vertex, index) => {
      const next = loop[(index + 1) % loop.length];
      expect(vertex.bulge).not.toBe(0);
      // A positive bulge bows to the right of the way it travels, by bulge x half the chord.
      const mx = (vertex.x + next.x) / 2;
      const my = (vertex.y + next.y) / 2;
      const peak = [mx + (vertex.bulge * (next.y - vertex.y)) / 2, my - (vertex.bulge * (next.x - vertex.x)) / 2];
      expect(Math.hypot(peak[0] - 50, peak[1] - 50)).toBeCloseTo(10, 1);
      total += 4 * Math.atan(vertex.bulge);
    });
    expect(Math.abs(total)).toBeCloseTo(Math.PI * 2, 2);
  });
});
