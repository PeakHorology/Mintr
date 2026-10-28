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
  return traceMask(inkMask(picture, options), picture.width, picture.height, options);
}

/** Traces a mask of ink pixels (1) on paper (0) into outlines. */
export function traceMask(mask: Uint8Array, width: number, height: number, options: Pick<TraceOptions, "speckle" | "smoothness">): TraceResult {
  const ink = removeSpecks(mask, width, height, Math.round(options.speckle));
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

function cubicAt(a: TracePoint, b: TracePoint, c: TracePoint, d: TracePoint, t: number): TracePoint {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

type Curve = Extract<TracePiece, { kind: "curve" }>;

/**
 * The cubic through `points[first..last]` that leaves and arrives along the given
 * directions, by least squares (Schneider, "An Algorithm for Automatically Fitting
 * Digitized Curves", Graphics Gems 1990), with where it strays furthest from them.
 */
function fitCubic(points: readonly TracePoint[], first: number, last: number, leave: TracePoint, arrive: TracePoint) {
  const a = points[first];
  const d = points[last];
  const chord = [0];
  for (let index = first + 1; index <= last; index += 1) {
    chord.push(chord[chord.length - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  }
  const total = chord[chord.length - 1] || 1;
  let params = chord.map((length) => length / total);
  let best = { c1: a, c2: d, worst: Infinity, at: Math.floor((first + last) / 2) };
  for (let round = 0; round < 4; round += 1) {
    let c00 = 0;
    let c01 = 0;
    let c11 = 0;
    let x0 = 0;
    let x1 = 0;
    params.forEach((t, offset) => {
      const point = points[first + offset];
      const u = 1 - t;
      const b1 = 3 * u * u * t;
      const b2 = 3 * u * t * t;
      const base = cubicAt(a, a, d, d, t);
      const rest = { x: point.x - base.x, y: point.y - base.y };
      c00 += b1 * b1;
      c01 += b1 * b2 * (leave.x * arrive.x + leave.y * arrive.y);
      c11 += b2 * b2;
      x0 += b1 * (leave.x * rest.x + leave.y * rest.y);
      x1 += b2 * (arrive.x * rest.x + arrive.y * rest.y);
    });
    const det = c00 * c11 - c01 * c01;
    let alpha = Math.abs(det) > 1e-12 ? (x0 * c11 - c01 * x1) / det : 0;
    let beta = Math.abs(det) > 1e-12 ? (c00 * x1 - c01 * x0) / det : 0;
    // A handle pointing backwards or reaching past the whole run is a bad fit; use thirds.
    const span = Math.hypot(d.x - a.x, d.y - a.y);
    if (!(alpha > span * 1e-3) || !(beta > span * 1e-3) || alpha > total || beta > total) alpha = beta = span / 3;
    const c1 = { x: a.x + leave.x * alpha, y: a.y + leave.y * alpha };
    const c2 = { x: d.x + arrive.x * beta, y: d.y + arrive.y * beta };
    // The true gap from each point to the curve, not to the curve at the point's guessed spot.
    const curve = Array.from({ length: 65 }, (_, step) => cubicAt(a, c1, c2, d, step / 64));
    let worst = 0;
    let at = best.at;
    for (let index = first + 1; index < last; index += 1) {
      const gap = distanceToLine(points[index], curve);
      if (gap > worst) {
        worst = gap;
        at = index;
      }
    }
    if (worst < best.worst) best = { c1, c2, worst, at };
    // Newton step: move each point's parameter to its nearest spot on the curve, then refit.
    params = params.map((t, offset) => {
      const point = points[first + offset];
      const u = 1 - t;
      const on = cubicAt(a, c1, c2, d, t);
      const d1 = {
        x: 3 * (u * u * (c1.x - a.x) + 2 * u * t * (c2.x - c1.x) + t * t * (d.x - c2.x)),
        y: 3 * (u * u * (c1.y - a.y) + 2 * u * t * (c2.y - c1.y) + t * t * (d.y - c2.y)),
      };
      const d2 = {
        x: 6 * (u * (c2.x - 2 * c1.x + a.x) + t * (d.x - 2 * c2.x + c1.x)),
        y: 6 * (u * (c2.y - 2 * c1.y + a.y) + t * (d.y - 2 * c2.y + c1.y)),
      };
      const off = { x: on.x - point.x, y: on.y - point.y };
      const denominator = d1.x * d1.x + d1.y * d1.y + off.x * d2.x + off.y * d2.y;
      return denominator === 0 ? t : Math.min(1, Math.max(0, t - (off.x * d1.x + off.y * d1.y) / denominator));
    });
  }
  return best;
}

/** A bend tighter than this within a few pixels is a corner, even where the trace rounded it. */
const CORNER_TURN = Math.PI / 4;

/** How far a point lies from a polyline. */
function distanceToLine(point: TracePoint, line: readonly TracePoint[]) {
  let nearest = Infinity;
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1];
    const b = line[index];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
    nearest = Math.min(nearest, Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t));
  }
  return nearest;
}

function unit(x: number, y: number) {
  const length = Math.hypot(x, y);
  return length > 0 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
}

/**
 * The direction of travel through `points[index]`, looking `reach` along the outline
 * each way so a pixel's wobble doesn't swing it. `closed` lets it look past the ends.
 */
function directionAt(points: readonly TracePoint[], index: number, reach: number, closed: boolean, side: "both" | "ahead" | "behind") {
  const count = points.length;
  const walk = (step: 1 | -1) => {
    let at = index;
    let travelled = 0;
    for (let moves = 0; moves < count - 1; moves += 1) {
      const next = at + step;
      if (!closed && (next < 0 || next >= count)) break;
      const wrapped = (next + count) % count;
      travelled += Math.hypot(points[wrapped].x - points[at].x, points[wrapped].y - points[at].y);
      at = wrapped;
      if (travelled >= reach) break;
    }
    return points[at];
  };
  const ahead = side === "behind" ? points[index] : walk(1);
  const behind = side === "ahead" ? points[index] : walk(-1);
  return unit(ahead.x - behind.x, ahead.y - behind.y);
}

/**
 * Redraws an outline with as few curves as stay within `tolerance` of it, the way a
 * designer would draw it: a circle comes out as a handful of curves instead of one at every
 * bend, straight sides as single lines, and sharp corners stay sharp.
 */
export function joinCurves(loop: { start: TracePoint; pieces: TracePiece[] }, tolerance: number): { start: TracePoint; pieces: TracePiece[] } {
  if (loop.pieces.length < 3) return loop;
  // Dense points along the outline, noting which were sharp corners in the trace.
  const points: TracePoint[] = [];
  // How hard the outline turns at each point: 0 for none, up to 2 for a full turn back.
  const sharp: number[] = [];
  let from = loop.start;
  loop.pieces.forEach((piece, index) => {
    const next = loop.pieces[(index + 1) % loop.pieces.length];
    const steps = piece.kind === "curve" ? 8 : Math.max(1, Math.ceil(Math.hypot(piece.to.x - from.x, piece.to.y - from.y) / Math.max(tolerance, 0.5)));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      points.push(piece.kind === "curve" ? cubicAt(from, piece.c1, piece.c2, piece.to, t) : { x: from.x + (piece.to.x - from.x) * t, y: from.y + (piece.to.y - from.y) * t });
      sharp.push(0);
    }
    // Where a straight piece meets anything at an angle, the trace kept a corner.
    if (piece.kind === "line" || next.kind === "line") {
      const outgoing = next.kind === "curve" ? next.c1 : next.to;
      const into = unit(piece.to.x - (piece.kind === "curve" ? piece.c2.x : from.x), piece.to.y - (piece.kind === "curve" ? piece.c2.y : from.y));
      const out = unit(outgoing.x - piece.to.x, outgoing.y - piece.to.y);
      const along = into.x * out.x + into.y * out.y;
      if (along < Math.cos(Math.PI / 9)) sharp[sharp.length - 1] = 1 - along;
    }
    from = piece.to;
  });
  const count = points.length;
  const reach = Math.max(3, tolerance * 4);
  // A corner a photo has softened traces as tight curves, not a sharp point: find it by how
  // far the outline turns within a few pixels either side.
  for (let index = 0; index < count; index += 1) {
    if (sharp[index] > 0) continue;
    const behind = directionAt(points, index, reach, true, "behind");
    const ahead = directionAt(points, index, reach, true, "ahead");
    const along = behind.x * ahead.x + behind.y * ahead.y;
    if (along < Math.cos(CORNER_TURN)) sharp[index] = 1 - along;
  }
  // Corners split the outline into runs; a loop with none is split in four to start.
  // A corner traced as several bends a pixel apart is one corner: keep its sharpest bend.
  const corners = sharp.flatMap((turn, index) => (turn > 0 ? [index] : []));
  const gapAlong = (from: number, to: number) => {
    let length = 0;
    for (let index = from; index < to; index += 1) length += Math.hypot(points[(index + 1) % count].x - points[index % count].x, points[(index + 1) % count].y - points[index % count].y);
    return length;
  };
  const together = Math.max(3, tolerance * 3);
  let breaks: number[] = [];
  for (const corner of corners) {
    const previous = breaks[breaks.length - 1];
    if (previous !== undefined && gapAlong(previous, corner) < together) {
      if (sharp[corner] > sharp[previous]) breaks[breaks.length - 1] = corner;
    } else {
      breaks.push(corner);
    }
  }
  if (breaks.length > 1 && gapAlong(breaks[breaks.length - 1], breaks[0] + count) < together) {
    const last = breaks.pop()!;
    if (sharp[last] > sharp[breaks[0]]) breaks[0] = last;
    breaks.sort((a, b) => a - b);
  }
  const smoothLoop = breaks.length === 0;
  if (smoothLoop) breaks = [0, 1, 2, 3].map((quarter) => Math.floor((quarter * count) / 4));
  const pieces: TracePiece[] = [];
  const run = (first: number, last: number, leave: TracePoint, arrive: TracePoint, depth: number, corners: { start: boolean; end: boolean }) => {
    const length = last - first;
    const slice = Array.from({ length: length + 1 }, (_, offset) => points[(first + offset) % count]);
    const a = slice[0];
    const d = slice[length];
    // Straight enough for a line? The few pixels by each end are left out: that is where a
    // photo softens a corner, and the line should run right into the corner instead.
    let straight = Math.hypot(d.x - a.x, d.y - a.y) > reach * 6;
    for (let offset = 1; offset < length && straight; offset += 1) {
      const point = slice[offset];
      if ((corners.start && Math.hypot(point.x - a.x, point.y - a.y) < reach * 2) || (corners.end && Math.hypot(point.x - d.x, point.y - d.y) < reach * 2)) continue;
      if (distanceToLine(point, [a, d]) > tolerance) straight = false;
    }
    if (!straight && length > 1) {
      straight = slice.every((point) => distanceToLine(point, [a, d]) <= tolerance);
    }
    if (straight) {
      pieces.push({ kind: "line", to: d });
      return;
    }
    const fit = fitCubic(slice, 0, length, leave, arrive);
    if (fit.worst <= tolerance || length < 4 || depth > 12) {
      pieces.push({ kind: "curve", c1: fit.c1, c2: fit.c2, to: d } satisfies Curve);
      return;
    }
    // Split where it fits worst, smoothly: both halves share the direction there.
    const split = Math.min(length - 2, Math.max(2, fit.at));
    const through = directionAt(points, (first + split) % count, reach, true, "both");
    run(first, first + split, leave, { x: -through.x, y: -through.y }, depth + 1, { start: corners.start, end: false });
    run(first + split, last, through, arrive, depth + 1, { start: false, end: corners.end });
  };
  for (let index = 0; index < breaks.length; index += 1) {
    const first = breaks[index];
    const last = index + 1 < breaks.length ? breaks[index + 1] : breaks[0] + count;
    if (last - first < 1) continue;
    // At a corner each run looks only along itself; between quarters of a smooth loop, both ways.
    const leave = directionAt(points, first % count, reach, true, smoothLoop ? "both" : "ahead");
    const into = directionAt(points, last % count, reach, true, smoothLoop ? "both" : "behind");
    run(first, last, leave, { x: -into.x, y: -into.y }, 0, { start: !smoothLoop, end: !smoothLoop });
  }
  // Straight pieces that carry on in line, such as either side of where a smooth loop was
  // first split, become one.
  const start = points[breaks[0] % count];
  const merged: TracePiece[] = [];
  let at = start;
  let lineStart: TracePoint | null = null;
  for (const piece of pieces) {
    const previous = merged[merged.length - 1];
    if (piece.kind === "line" && previous?.kind === "line" && lineStart && distanceToLine(previous.to, [lineStart, piece.to]) <= tolerance) {
      merged[merged.length - 1] = piece;
    } else {
      lineStart = at;
      merged.push(piece);
    }
    at = piece.to;
  }
  // And across the start, when the loop's first and last pieces are both straight and in line.
  const first = merged[0];
  const last = merged[merged.length - 1];
  if (merged.length > 3 && first.kind === "line" && last.kind === "line") {
    const before = merged.length > 1 ? merged[merged.length - 2].to : start;
    if (distanceToLine(start, [before, first.to]) <= tolerance) {
      merged.pop();
      return { start: before, pieces: merged };
    }
  }
  return { start, pieces: merged };
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
