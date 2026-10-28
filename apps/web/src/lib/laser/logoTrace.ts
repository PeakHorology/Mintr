/**
 * Trace a logo: turns a picture with solid dark and light areas into closed outlines a
 * laser can follow. Written for Mintr, after the ideas in Peter Selinger's Potrace paper
 * ("Potrace: a polygon-based tracing algorithm", 2003): follow the pixel edges, drop specks,
 * straighten the staircase into a polygon, then round each polygon corner into a curve
 * unless it is sharp enough to stay a corner. Small pictures are enlarged smoothly before
 * the cut-off is applied, as ImageTracer and VTracer advise, so edges land between pixels.
 *
 * It keeps only "ink" and "paper", so it suits logos, text and line drawings, not photos.
 */

/** RGBA pixels, as a canvas gives them. */
export type TracePicture = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };

/** A grey picture, 0 dark to 1 light, with how opaque each pixel is. */
export type GreyPicture = { width: number; height: number; grey: Float32Array; alpha: Float32Array };

export type TraceOptions = {
  /** Pixels darker than this (0 to 1) are ink. */
  threshold: number;
  /** A light logo on a dark background: light pixels are ink instead. */
  invert: boolean;
  /** Blobs and gaps smaller than this many pixels are dropped. */
  speckle: number;
  /** 0 keeps every corner sharp; 4/3 rounds all of them. Potrace's alphamax, 1 by default. */
  smoothness: number;
  /** Transparent pixels are always paper, and every opaque one is ink, whatever its colour. */
  useTransparency: boolean;
};

/** One closed outline in picture pixels. Outer edges run one way, holes the other. */
export type TraceLoop = {
  /** Pieces in order; each ends where the next starts. */
  pieces: TracePiece[];
  /** Positive for an outer edge, negative for a hole. */
  area: number;
};

export type TracePoint = { x: number; y: number };
export type TracePiece =
  | { kind: "line"; to: TracePoint }
  | { kind: "curve"; c1: TracePoint; c2: TracePoint; to: TracePoint };

export type TraceResult = {
  width: number;
  height: number;
  loops: Array<TraceLoop & { start: TracePoint }>;
};

/** Pictures are traced at a long side between these, enlarged or shrunk smoothly. */
const MIN_TRACE_SIZE = 600;
const MAX_TRACE_SIZE = 1000;

/** Reads a picture into grey at a size good for tracing. */
export function greyForTracing(picture: TracePicture): GreyPicture {
  const long = Math.max(picture.width, picture.height);
  const scale = long < MIN_TRACE_SIZE ? MIN_TRACE_SIZE / long : long > MAX_TRACE_SIZE ? MAX_TRACE_SIZE / long : 1;
  const width = Math.max(1, Math.round(picture.width * scale));
  const height = Math.max(1, Math.round(picture.height * scale));
  const sourceGrey = new Float32Array(picture.width * picture.height);
  const sourceAlpha = new Float32Array(picture.width * picture.height);
  for (let index = 0; index < sourceGrey.length; index += 1) {
    const r = picture.data[index * 4];
    const g = picture.data[index * 4 + 1];
    const b = picture.data[index * 4 + 2];
    const a = picture.data[index * 4 + 3] / 255;
    // A see-through pixel reads as white paper.
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    sourceGrey[index] = lum * a + (1 - a);
    sourceAlpha[index] = a;
  }
  if (scale === 1) return { width, height, grey: sourceGrey, alpha: sourceAlpha };
  const grey = new Float32Array(width * height);
  const alpha = new Float32Array(width * height);
  if (scale > 1) {
    // Enlarge with bilinear blending, so the cut-off falls between the old pixels.
    for (let y = 0; y < height; y += 1) {
      const sy = Math.min(picture.height - 1, Math.max(0, (y + 0.5) / scale - 0.5));
      const y0 = Math.floor(sy);
      const y1 = Math.min(picture.height - 1, y0 + 1);
      const fy = sy - y0;
      for (let x = 0; x < width; x += 1) {
        const sx = Math.min(picture.width - 1, Math.max(0, (x + 0.5) / scale - 0.5));
        const x0 = Math.floor(sx);
        const x1 = Math.min(picture.width - 1, x0 + 1);
        const fx = sx - x0;
        const blend = (values: Float32Array) => {
          const top = values[y0 * picture.width + x0] * (1 - fx) + values[y0 * picture.width + x1] * fx;
          const bottom = values[y1 * picture.width + x0] * (1 - fx) + values[y1 * picture.width + x1] * fx;
          return top * (1 - fy) + bottom * fy;
        };
        grey[y * width + x] = blend(sourceGrey);
        alpha[y * width + x] = blend(sourceAlpha);
      }
    }
    return { width, height, grey, alpha };
  }
  // Shrink by averaging every source pixel that falls in each new one.
  const counts = new Float32Array(width * height);
  for (let y = 0; y < picture.height; y += 1) {
    const ty = Math.min(height - 1, Math.floor(y * scale));
    for (let x = 0; x < picture.width; x += 1) {
      const target = ty * width + Math.min(width - 1, Math.floor(x * scale));
      grey[target] += sourceGrey[y * picture.width + x];
      alpha[target] += sourceAlpha[y * picture.width + x];
      counts[target] += 1;
    }
  }
  for (let index = 0; index < grey.length; index += 1) {
    grey[index] /= counts[index] || 1;
    alpha[index] /= counts[index] || 1;
  }
  return { width, height, grey, alpha };
}

/** What the picture looks like, for picking starting settings and warning about photos. */
export type PictureLook = {
  /** Otsu's cut-off between the dark and light parts. */
  threshold: number;
  /** The edge of the picture is dark, so the logo is probably light on dark. */
  darkBackground: boolean;
  /** Enough see-through pixels that the transparency is the outline. */
  transparentBackground: boolean;
  /** Lots of in-between greys: a photo or a shaded drawing, which traces into blotches. */
  looksLikePhoto: boolean;
};

export function lookAtPicture(picture: GreyPicture): PictureLook {
  const bins = new Float64Array(256);
  let total = 0;
  let clear = 0;
  for (let index = 0; index < picture.grey.length; index += 1) {
    if (picture.alpha[index] < 0.5) {
      clear += 1;
      continue;
    }
    bins[Math.min(255, Math.floor(picture.grey[index] * 256))] += 1;
    total += 1;
  }
  // Otsu: the cut-off that best splits the greys into two tight groups.
  let sumAll = 0;
  for (let level = 0; level < 256; level += 1) sumAll += level * bins[level];
  let below = 0;
  let sumBelow = 0;
  let best = -1;
  let threshold = 128;
  for (let level = 0; level < 256; level += 1) {
    below += bins[level];
    if (below === 0) continue;
    const above = total - below;
    if (above === 0) break;
    sumBelow += level * bins[level];
    const meanBelow = sumBelow / below;
    const meanAbove = (sumAll - sumBelow) / above;
    const between = below * above * (meanBelow - meanAbove) ** 2;
    if (between > best) {
      best = between;
      threshold = level + 1;
    }
  }
  // A pixel counts as in-between when it is well clear of both groups' ends.
  let middling = 0;
  for (let level = 0; level < 256; level += 1) {
    const grey = level / 255;
    if (grey > 0.15 && grey < 0.85 && Math.abs(level - threshold) > 25) middling += bins[level];
  }
  let edgeDark = 0;
  let edgeCount = 0;
  const { width, height } = picture;
  const edge = (x: number, y: number) => {
    const index = y * width + x;
    if (picture.alpha[index] < 0.5) return;
    edgeCount += 1;
    if (picture.grey[index] < threshold / 256) edgeDark += 1;
  };
  for (let x = 0; x < width; x += 1) {
    edge(x, 0);
    edge(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    edge(0, y);
    edge(width - 1, y);
  }
  const pixels = picture.grey.length;
  return {
    threshold: threshold / 256,
    darkBackground: edgeCount > 0 && edgeDark / edgeCount > 0.6,
    transparentBackground: clear / pixels > 0.05,
    looksLikePhoto: total > 0 && middling / total > 0.3,
  };
}

/** Which pixels are ink. */
export function inkMask(picture: GreyPicture, options: Pick<TraceOptions, "threshold" | "invert" | "useTransparency">) {
  const ink = new Uint8Array(picture.grey.length);
  for (let index = 0; index < ink.length; index += 1) {
    if (options.useTransparency) {
      ink[index] = picture.alpha[index] >= 0.5 ? 1 : 0;
      continue;
    }
    const dark = picture.grey[index] < options.threshold;
    ink[index] = dark !== options.invert ? 1 : 0;
  }
  return ink;
}

/**
 * Drops blobs of ink, and gaps in it, smaller than `speckle` pixels: dust and JPEG noise.
 * Ink joins at corners as well as sides, so a thin diagonal stroke stays one piece.
 */
export function removeSpecks(ink: Uint8Array, width: number, height: number, speckle: number) {
  if (speckle <= 0) return ink;
  const result = ink.slice();
  const seen = new Uint8Array(ink.length);
  const stack: number[] = [];
  const members: number[] = [];
  for (let start = 0; start < ink.length; start += 1) {
    if (seen[start]) continue;
    const value = result[start];
    // Ink connects through corners; paper only through sides, as the outlines are traced.
    const diagonal = value === 1;
    stack.length = 0;
    members.length = 0;
    stack.push(start);
    seen[start] = 1;
    let touchesEdge = false;
    while (stack.length > 0) {
      const index = stack.pop()!;
      members.push(index);
      const x = index % width;
      const y = (index - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          if (!diagonal && dx !== 0 && dy !== 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next] || result[next] !== value) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    // Paper around the picture's edge is the background, never a speck.
    if (members.length < speckle && (value === 1 || !touchesEdge)) {
      for (const index of members) result[index] = value === 1 ? 0 : 1;
    }
  }
  return result;
}

/**
 * Follows the edges between ink and paper pixels into closed loops of pixel corners,
 * with ink always on the right. Where two ink pixels touch only at a corner, the loop
 * turns to keep them joined.
 */
export function traceEdges(ink: Uint8Array, width: number, height: number): TracePoint[][] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? ink[y * width + x] === 1 : false);
  // Heading 0 east, 1 south, 2 west, 3 north; y runs down the picture.
  const step = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  // An edge leaving corner (x, y) along a heading is an outline edge when ink is on its right.
  const isEdge = (x: number, y: number, heading: number) => {
    switch (heading) {
      case 0: return at(x, y) && !at(x, y - 1);
      case 1: return at(x - 1, y) && !at(x, y);
      case 2: return at(x - 1, y - 1) && !at(x - 1, y);
      default: return at(x, y - 1) && !at(x - 1, y - 1);
    }
  };
  const corners = width + 1;
  const used = new Uint8Array(corners * (height + 1));
  const loops: TracePoint[][] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Every loop has an east-heading edge along the top of some ink pixel.
      if (!isEdge(x, y, 0) || used[y * corners + x] & 1) continue;
      const loop: TracePoint[] = [];
      let cx = x;
      let cy = y;
      let heading = 0;
      for (;;) {
        used[cy * corners + cx] |= 1 << heading;
        loop.push({ x: cx, y: cy });
        cx += step[heading][0];
        cy += step[heading][1];
        // Left first keeps corner-touching ink joined, then straight on, then right.
        const left = (heading + 3) % 4;
        const right = (heading + 1) % 4;
        if (isEdge(cx, cy, left)) heading = left;
        else if (!isEdge(cx, cy, heading)) heading = right;
        if (cx === x && cy === y && heading === 0) break;
        if (loop.length > 4 * (width + 1) * (height + 1)) break;
      }
      loops.push(loop);
    }
  }
  return loops;
}

/** Twice the signed area: positive for outer edges, negative for holes. */
export function loopArea(points: TracePoint[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** How far a straight side may stray from the pixel edges, in pixels. */
const STRAIGHTNESS = 0.7;

/**
 * Straightens a pixel staircase into a polygon whose sides stay within a pixel of it.
 * Works on the edge midpoints, which already sit on the smooth line the staircase stands for.
 */
export function straighten(points: TracePoint[], tolerance = STRAIGHTNESS): TracePoint[] {
  const count = points.length;
  if (count < 4) return points.slice();
  const middles = points.map((point, index) => {
    const next = points[(index + 1) % count];
    return { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
  });
  // Split the loop at the two points farthest apart, then simplify each half.
  let far = 0;
  let farDistance = -1;
  for (let index = 1; index < count; index += 1) {
    const distance = (middles[index].x - middles[0].x) ** 2 + (middles[index].y - middles[0].y) ** 2;
    if (distance > farDistance) {
      farDistance = distance;
      far = index;
    }
  }
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[far] = 1;
  const simplify = (from: number, to: number) => {
    // Indices wrap; `to` may be past the end.
    const stack: Array<[number, number]> = [[from, to]];
    while (stack.length > 0) {
      const [a, b] = stack.pop()!;
      if (b - a < 2) continue;
      const pa = middles[a % count];
      const pb = middles[b % count];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const length = Math.hypot(dx, dy) || 1;
      let worst = -1;
      let worstIndex = -1;
      for (let index = a + 1; index < b; index += 1) {
        const point = middles[index % count];
        const distance = Math.abs((point.x - pa.x) * dy - (point.y - pa.y) * dx) / length;
        if (distance > worst) {
          worst = distance;
          worstIndex = index;
        }
      }
      if (worst > tolerance) {
        keep[worstIndex % count] = 1;
        stack.push([a, worstIndex], [worstIndex, b]);
      }
    }
  };
  simplify(0, far);
  simplify(far, count);
  const kept: number[] = [];
  for (let index = 0; index < count; index += 1) if (keep[index]) kept.push(index);
  if (kept.length < 3) return kept.map((index) => middles[index]);
  // Each side is the best-fitting line through the edge midpoints it covers.
  const sides = kept.map((from, side) => {
    const to = side + 1 < kept.length ? kept[side + 1] : kept[0] + count;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let index = from; index <= to; index += 1) {
      sx += middles[index % count].x;
      sy += middles[index % count].y;
      n += 1;
    }
    const cx = sx / n;
    const cy = sy / n;
    let xx = 0;
    let xy = 0;
    let yy = 0;
    for (let index = from; index <= to; index += 1) {
      const dx = middles[index % count].x - cx;
      const dy = middles[index % count].y - cy;
      xx += dx * dx;
      xy += dx * dy;
      yy += dy * dy;
    }
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    return { cx, cy, dx: Math.cos(angle), dy: Math.sin(angle) };
  });
  // Potrace's vertex adjustment: a corner moves to where its two sides meet, which puts a
  // square's corner back on the corner instead of a pixel's width inside it. It may move
  // at most a pixel, so a shallow bend never shoots off.
  return kept.map((index, side) => {
    const original = middles[index];
    const a = sides[(side + sides.length - 1) % sides.length];
    const b = sides[side];
    const cross = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(cross) < 1e-3) return original;
    const t = ((b.cx - a.cx) * b.dy - (b.cy - a.cy) * b.dx) / cross;
    const meet = { x: a.cx + a.dx * t, y: a.cy + a.dy * t };
    return Math.abs(meet.x - original.x) <= 1 && Math.abs(meet.y - original.y) <= 1 ? meet : original;
  });
}

/**
 * Rounds a polygon into curves, Potrace's way: each side's midpoint is a joint, and between
 * two joints the polygon's corner becomes a curve, or stays a sharp corner when it bends
 * too hard for `smoothness`.
 */
export function roundCorners(polygon: TracePoint[], smoothness: number): { start: TracePoint; pieces: TracePiece[] } {
  const count = polygon.length;
  const mid = (a: TracePoint, b: TracePoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const toward = (a: TracePoint, b: TracePoint, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  if (count < 3) {
    return { start: polygon[0] ?? { x: 0, y: 0 }, pieces: polygon.slice(1).map((to) => ({ kind: "line" as const, to })) };
  }
  const start = mid(polygon[count - 1], polygon[0]);
  const pieces: TracePiece[] = [];
  for (let index = 0; index < count; index += 1) {
    const before = polygon[(index + count - 1) % count];
    const corner = polygon[index];
    const after = polygon[(index + 1) % count];
    const end = mid(corner, after);
    // How far the corner pokes out past the line between its neighbours, against a
    // pixel-sized yardstick: Potrace's measure of how sharp it is.
    const denominator = Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
    let alpha = 4 / 3;
    if (denominator !== 0) {
      const poke = Math.abs((corner.x - before.x) * (after.y - before.y) - (corner.y - before.y) * (after.x - before.x)) / denominator;
      alpha = (poke > 1 ? 1 - 1 / poke : 0) / 0.75;
    }
    if (alpha >= smoothness) {
      pieces.push({ kind: "line", to: corner }, { kind: "line", to: end });
      continue;
    }
    const pull = 0.5 + 0.5 * Math.min(1, Math.max(0.55, alpha));
    pieces.push({ kind: "curve", c1: toward(before, corner, pull), c2: toward(after, corner, pull), to: end });
  }
  return { start, pieces };
}

/** Traces a grey picture into outlines. */
export function traceLogo(picture: GreyPicture, options: TraceOptions): TraceResult {
  const { width, height } = picture;
  const ink = removeSpecks(inkMask(picture, options), width, height, Math.round(options.speckle));
  const loops: TraceResult["loops"] = [];
  for (const edge of traceEdges(ink, width, height)) {
    const area = loopArea(edge);
    const polygon = straighten(edge);
    if (polygon.length < 3) continue;
    const { start, pieces } = roundCorners(polygon, options.smoothness);
    loops.push({ start, pieces, area });
  }
  return { width, height, loops };
}

/**
 * Flattens a loop into points no more than `tolerance` from its curves. Mintr cuts
 * from straight-sided outlines, and a few points a curve keep a big logo light.
 */
export function flattenLoop(loop: { start: TracePoint; pieces: TracePiece[] }, tolerance: number): TracePoint[] {
  const points: TracePoint[] = [loop.start];
  let from = loop.start;
  for (const piece of loop.pieces) {
    if (piece.kind === "curve") {
      // A cubic's flatness bounds how many steps keep it within tolerance.
      const ddx = Math.max(Math.abs(from.x - 2 * piece.c1.x + piece.c2.x), Math.abs(piece.c1.x - 2 * piece.c2.x + piece.to.x));
      const ddy = Math.max(Math.abs(from.y - 2 * piece.c1.y + piece.c2.y), Math.abs(piece.c1.y - 2 * piece.c2.y + piece.to.y));
      const steps = Math.min(32, Math.max(1, Math.ceil(Math.sqrt((0.75 * Math.hypot(ddx, ddy)) / tolerance))));
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const u = 1 - t;
        points.push({
          x: u * u * u * from.x + 3 * u * u * t * piece.c1.x + 3 * u * t * t * piece.c2.x + t * t * t * piece.to.x,
          y: u * u * u * from.y + 3 * u * u * t * piece.c1.y + 3 * u * t * t * piece.c2.y + t * t * t * piece.to.y,
        });
      }
    } else {
      points.push(piece.to);
    }
    from = piece.to;
  }
  // The last piece ends back at the start.
  points.pop();
  return points;
}

/** Whether a point is inside a polygon. */
function inside(point: TracePoint, polygon: TracePoint[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

/**
 * Groups flattened loops into solid pieces: each outer edge with the holes directly in it.
 * A dot inside an "O"'s hole is its own piece.
 */
export function groupIntoPieces(loops: Array<{ points: TracePoint[]; area: number }>) {
  const outers = loops
    .map((loop, index) => ({ ...loop, index }))
    .filter((loop) => loop.area > 0)
    .sort((a, b) => a.area - b.area);
  const pieces = outers.map((outer) => ({ outer: outer.points, holes: [] as TracePoint[][] }));
  for (const loop of loops) {
    if (loop.area >= 0 || loop.points.length === 0) continue;
    const size = -loop.area;
    // The smallest outer edge around the hole is the one it was cut from.
    const owner = outers.findIndex((outer) => outer.area > size && inside(loop.points[0], outer.points));
    if (owner >= 0) pieces[owner].holes.push(loop.points);
  }
  return pieces;
}
