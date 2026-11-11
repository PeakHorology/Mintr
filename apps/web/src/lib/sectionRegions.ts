/**
 * The flat shapes an X-ray cut makes, worked out from the line pieces where a part's
 * triangles cross the cut plane. Each region is one solid patch of the cut: an outer
 * edge and any holes in it. Used to tell how thin a wall is, which parts sit next to
 * each other, and to measure a wall or a gap under the pointer.
 *
 * Points are in the cut plane's own 2D frame, in millimetres.
 */

export type Point2 = { x: number; y: number };

export type SectionLoop = {
  points: Point2[];
  /** Enclosed area, always positive. */
  area: number;
  length: number;
  box: SectionBox;
};

export type SectionBox = { minX: number; minY: number; maxX: number; maxY: number };

export type SectionRegion = {
  outer: SectionLoop;
  holes: SectionLoop[];
  area: number;
  perimeter: number;
  /** About how thick the patch is: the short side of a strip with the same area and edge. */
  thickness: number;
  box: SectionBox;
};

export type SectionMeasure = {
  kind: "wall" | "gap";
  from: Point2;
  to: Point2;
  length: number;
};

/** Ends closer than this are the same point: meshes often repeat a seam vertex a hair apart. */
const JOIN_TOLERANCE = 1e-4;

/**
 * Joins line pieces (x1, y1, x2, y2, …) into closed loops. Chains that never close, from
 * a part whose mesh is not watertight, are left out.
 */
export function joinSegments(coords: ArrayLike<number>, tolerance = JOIN_TOLERANCE): Point2[][] {
  const count = Math.floor(coords.length / 4);
  const cell = (v: number) => Math.round(v / tolerance);
  // Each end filed by grid cell; a lookup checks the cells round it too.
  const grid = new Map<string, number[]>();
  const keep: boolean[] = new Array(count).fill(false);
  const endX = (s: number, end: number) => coords[s * 4 + end * 2];
  const endY = (s: number, end: number) => coords[s * 4 + end * 2 + 1];
  for (let s = 0; s < count; s++) {
    if (Math.hypot(endX(s, 1) - endX(s, 0), endY(s, 1) - endY(s, 0)) <= tolerance) continue;
    keep[s] = true;
    for (let end = 0; end < 2; end++) {
      const key = `${cell(endX(s, end))}|${cell(endY(s, end))}`;
      const list = grid.get(key);
      if (list) list.push(s * 2 + end);
      else grid.set(key, [s * 2 + end]);
    }
  }
  const used: boolean[] = new Array(count).fill(false);
  /** An unused piece with an end at p, as piece * 2 + end. */
  const findEnd = (p: Point2) => {
    const cx = cell(p.x);
    const cy = cell(p.y);
    let best = -1;
    let bestDistance = tolerance;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const entry of grid.get(`${cx + dx}|${cy + dy}`) ?? []) {
          const s = entry >> 1;
          if (used[s]) continue;
          const distance = Math.hypot(endX(s, entry & 1) - p.x, endY(s, entry & 1) - p.y);
          if (distance <= bestDistance) {
            best = entry;
            bestDistance = distance;
          }
        }
      }
    }
    return best;
  };
  const loops: Point2[][] = [];
  for (let start = 0; start < count; start++) {
    if (!keep[start] || used[start]) continue;
    used[start] = true;
    const first = { x: endX(start, 0), y: endY(start, 0) };
    const loop: Point2[] = [first];
    let current = { x: endX(start, 1), y: endY(start, 1) };
    let closed = false;
    for (let guard = 0; guard <= count; guard++) {
      if (loop.length >= 2 && Math.hypot(current.x - first.x, current.y - first.y) <= tolerance) {
        closed = true;
        break;
      }
      loop.push(current);
      const next = findEnd(current);
      if (next < 0) break;
      const s = next >> 1;
      used[s] = true;
      const other = 1 - (next & 1);
      current = { x: endX(s, other), y: endY(s, other) };
    }
    if (closed && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function makeLoop(points: Point2[]): SectionLoop {
  let twice = 0;
  let length = 0;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
    length += Math.hypot(b.x - a.x, b.y - a.y);
    box.minX = Math.min(box.minX, a.x);
    box.minY = Math.min(box.minY, a.y);
    box.maxX = Math.max(box.maxX, a.x);
    box.maxY = Math.max(box.maxY, a.y);
  }
  return { points, area: Math.abs(twice) / 2, length, box };
}

function boxHolds(box: SectionBox, p: Point2) {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
}

export function pointInLoop(p: Point2, loop: SectionLoop) {
  if (!boxHolds(loop.box, p)) return false;
  const points = loop.points;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function pointInRegion(p: Point2, region: SectionRegion) {
  return pointInLoop(p, region.outer) && !region.holes.some((hole) => pointInLoop(p, hole));
}

/**
 * How thick a patch is, from its area and edge length: the short side of the rectangle
 * that has both. Exact for a strip or a ring; a round patch comes out a little under
 * its width, which is fine for telling thin walls from thick ones.
 */
export function stripThickness(area: number, perimeter: number) {
  const half = perimeter / 2;
  const disc = half * half - 4 * area;
  return disc > 0 ? (half - Math.sqrt(disc)) / 2 : half / 2;
}

/** A point just inside a loop's first edge, for asking which loops hold it. */
function probePoint(loop: SectionLoop): Point2 {
  const a = loop.points[0];
  const b = loop.points[1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Sorts loops into solid patches: even-depth loops are outer edges, odd-depth ones holes. */
export function buildRegions(rawLoops: Point2[][]): SectionRegion[] {
  const loops = rawLoops.map(makeLoop).filter((loop) => loop.area > 1e-9);
  loops.sort((a, b) => b.area - a.area);
  const depth = loops.map(() => 0);
  const parent: number[] = loops.map(() => -1);
  for (let i = 0; i < loops.length; i++) {
    const probe = probePoint(loops[i]);
    // Loops are largest first, so the last holder found is the tightest one.
    for (let j = 0; j < i; j++) {
      if (pointInLoop(probe, loops[j])) {
        depth[i]++;
        parent[i] = j;
      }
    }
  }
  const regions = new Map<number, SectionRegion>();
  loops.forEach((loop, i) => {
    if (depth[i] % 2 === 0) {
      regions.set(i, { outer: loop, holes: [], area: loop.area, perimeter: loop.length, thickness: 0, box: loop.box });
    }
  });
  loops.forEach((loop, i) => {
    if (depth[i] % 2 === 1) {
      const region = regions.get(parent[i]);
      if (!region) return;
      region.holes.push(loop);
      region.area -= loop.area;
      region.perimeter += loop.length;
    }
  });
  const out = [...regions.values()];
  out.forEach((region) => {
    region.thickness = stripThickness(region.area, region.perimeter);
  });
  return out;
}

function regionLoops(region: SectionRegion) {
  return [region.outer, ...region.holes];
}

type Nearest = { point: Point2; distance: number; normal: Point2 };

function nearestOnLoops(p: Point2, loops: SectionLoop[]): Nearest | null {
  let best: Nearest | null = null;
  for (const loop of loops) {
    const points = loop.points;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq === 0) continue;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
      const q = { x: a.x + dx * t, y: a.y + dy * t };
      const distance = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || distance < best.distance) {
        const length = Math.sqrt(lengthSq);
        best = { point: q, distance, normal: { x: -dy / length, y: dx / length } };
      }
    }
  }
  return best;
}

/** How far along `dir` from `from` the first edge is, past a hair's breadth. */
function castAcross(from: Point2, dir: Point2, loops: SectionLoop[], skip: number): number | null {
  let best: number | null = null;
  for (const loop of loops) {
    const points = loop.points;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denom = dir.x * ey - dir.y * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const wx = a.x - from.x;
      const wy = a.y - from.y;
      const t = (wx * ey - wy * ex) / denom;
      const u = (wx * dir.y - wy * dir.x) / denom;
      if (t > skip && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
    }
  }
  return best;
}

/**
 * The wall or gap under a point, measured straight across from the nearest edge, the
 * way calipers would. Inside solid material it is the wall; in the space between edges
 * it is the gap, which also reads a hole straight across. Out in the open it is nothing.
 */
export function measureAt(regions: SectionRegion[], p: Point2): SectionMeasure | null {
  if (regions.length === 0) return null;
  const skip = 1e-6;
  const inside = regions.find((region) => pointInRegion(p, region));
  const loops = inside ? regionLoops(inside) : regions.flatMap(regionLoops);
  const nearest = nearestOnLoops(p, loops);
  if (!nearest) return null;
  let dir: Point2;
  if (nearest.distance > 1e-9) {
    dir = { x: (p.x - nearest.point.x) / nearest.distance, y: (p.y - nearest.point.y) / nearest.distance };
  } else {
    // Right on an edge: go across, into the material or out into the gap.
    const n = nearest.normal;
    const nudge = { x: p.x + n.x * 1e-4, y: p.y + n.y * 1e-4 };
    const intoSolid = regions.some((region) => pointInRegion(nudge, region));
    dir = intoSolid === Boolean(inside) ? n : { x: -n.x, y: -n.y };
  }
  const across = castAcross(nearest.point, dir, loops, skip);
  if (across === null) return null;
  return {
    kind: inside ? "wall" : "gap",
    from: nearest.point,
    to: { x: nearest.point.x + dir.x * across, y: nearest.point.y + dir.y * across },
    length: across,
  };
}

/** Do two boxes overlap or come within `reach` of each other. */
export function boxesNear(a: SectionBox, b: SectionBox, reach: number) {
  return a.minX - reach <= b.maxX && b.minX - reach <= a.maxX && a.minY - reach <= b.maxY && b.minY - reach <= a.maxY;
}

/**
 * Hatch styles for parts, so parts that meet get different ones, as in a drawing.
 * Keeps a part's previous style when it still differs from its neighbours, so styles
 * do not jump about as the cut moves.
 */
export function assignHatchStyles(boxes: (SectionBox | null)[], previous: (number | undefined)[], styleCount: number, reach: number): number[] {
  const styles: number[] = boxes.map(() => -1);
  const near = (i: number) =>
    boxes.map((box, j) => (j !== i && box && boxes[i] && boxesNear(boxes[i]!, box, reach) ? j : -1)).filter((j) => j >= 0);
  boxes.forEach((box, i) => {
    if (!box) {
      styles[i] = previous[i] ?? 0;
      return;
    }
    const taken = new Set(near(i).map((j) => styles[j]).filter((s) => s >= 0));
    const kept = previous[i];
    if (kept !== undefined && !taken.has(kept)) {
      styles[i] = kept;
      return;
    }
    let style = 0;
    while (taken.has(style) && style < styleCount - 1) style++;
    styles[i] = style;
  });
  return styles;
}
