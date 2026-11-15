/**
 * Fonts may draw their letters clockwise or counter-clockwise: printers and screens only care that
 * a letter's holes run the other way to its outside. three.js decides what is a hole from the
 * direction alone, and expects outsides clockwise, so a font drawn the other way round loses holes:
 * the top of a B fills in. Here each outline is sorted by what it sits inside instead (inside an
 * odd number of others makes it a hole) and turned the way three.js expects.
 */

type Point = [number, number];
type Segment = { type: "l" | "q" | "b"; end: Point; controls: Point[] };
type Contour = { start: Point; segments: Segment[] };

function parseOutline(outline: string): Contour[] | null {
  const tokens = outline.split(" ").filter(Boolean);
  const contours: Contour[] = [];
  let current: Contour | null = null;
  const read = (at: number): Point | null => {
    const x = Number(tokens[at]);
    const y = Number(tokens[at + 1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  };
  for (let i = 0; i < tokens.length; ) {
    const action = tokens[i++];
    if (action === "z") continue;
    if (action === "m") {
      const start = read(i);
      if (!start) return null;
      i += 2;
      current = { start, segments: [] };
      contours.push(current);
      continue;
    }
    const count = action === "l" ? 1 : action === "q" ? 2 : action === "b" ? 3 : 0;
    if (!count || !current) return null;
    const points: Point[] = [];
    for (let n = 0; n < count; n += 1, i += 2) {
      const point = read(i);
      if (!point) return null;
      points.push(point);
    }
    // three.js's order: the end point first, then the control points.
    current.segments.push({ type: action as Segment["type"], end: points[0], controls: points.slice(1) });
  }
  return contours;
}

/** Points along the outline, close enough to tell inside from outside. */
function polygon(contour: Contour): Point[] {
  const points: Point[] = [contour.start];
  let from = contour.start;
  for (const segment of contour.segments) {
    const pts = [from, ...segment.controls, segment.end];
    if (segment.type !== "l") {
      for (const t of [0.25, 0.5, 0.75]) {
        let level = pts;
        while (level.length > 1) level = level.slice(1).map((p, k) => [level[k][0] + (p[0] - level[k][0]) * t, level[k][1] + (p[1] - level[k][1]) * t] as Point);
        points.push(level[0]);
      }
    }
    points.push(segment.end);
    from = segment.end;
  }
  return points;
}

function signedArea(points: Point[]) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) sum += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  return sum / 2;
}

function inside(point: Point, ring: Point[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function reversed(contour: Contour): Contour {
  const starts = [contour.start, ...contour.segments.map((segment) => segment.end)];
  const segments = contour.segments
    .map((segment, index) => ({ type: segment.type, end: starts[index], controls: [...segment.controls].reverse() }))
    .reverse();
  return { start: starts[starts.length - 1], segments };
}

const format = (contours: Contour[]) =>
  contours
    .map((contour) => [`m ${contour.start[0]} ${contour.start[1]}`, ...contour.segments.map((segment) => [segment.type, ...[segment.end, ...segment.controls].flat()].join(" ")), "z"].join(" "))
    .join(" ") + " ";

/** One letter's outline with every outside clockwise and every hole counter-clockwise. */
export function normalizeGlyphOutline(outline: string): string {
  const contours = parseOutline(outline);
  if (!contours || contours.length === 0) return outline;
  const rings = contours.map(polygon);
  let changed = false;
  const fixed = contours.map((contour, index) => {
    const ring = rings[index];
    // A few points of the outline vote, in case one sits right on another outline.
    const voters = [0, Math.floor(ring.length / 3), Math.floor((2 * ring.length) / 3)].map((at) => ring[at]);
    const holeVotes = voters.filter((point) => rings.filter((other, at) => at !== index && inside(point, other)).length % 2 === 1).length;
    const hole = holeVotes * 2 > voters.length;
    const clockwise = signedArea(ring) < 0;
    if (clockwise !== hole) return contour;
    changed = true;
    return reversed(contour);
  });
  return changed ? format(fixed) : outline;
}

/** A three.js typeface with each letter's outlines turned the way three.js reads holes. */
export function normalizeTypefaceWinding<T extends { glyphs?: unknown }>(typeface: T): T {
  const glyphs = typeface.glyphs as Record<string, { o?: unknown } | null> | undefined;
  if (!glyphs || typeof glyphs !== "object") return typeface;
  const next: Record<string, unknown> = {};
  for (const [char, glyph] of Object.entries(glyphs)) {
    next[char] = glyph && typeof glyph.o === "string" ? { ...glyph, o: normalizeGlyphOutline(glyph.o) } : glyph;
  }
  return { ...typeface, glyphs: next };
}
