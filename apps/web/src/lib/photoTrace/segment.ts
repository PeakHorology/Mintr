import { findPaper, type Backdrop } from "@/lib/photoTrace/paper";
import type { Point } from "@/lib/photoTrace/geometry";
import { resizePicture, type Rgba } from "@/lib/photoTrace/picture";

/** A click on the photo: on the object (keep) or on something that isn't (drop). */
export type TraceClick = { x: number; y: number; keep: boolean };

export type SegmentOptions = {
  backdrop: Backdrop;
  /** 0 to 1: higher keeps fainter differences from the paper as part of the object. */
  sensitivity: number;
  /** 0 to 1, on white paper: how much a darker patch of the paper's own colour counts as shadow. */
  ignoreShadows: number;
};

/** A colour in a lightness + two colour axes space, so shadow (darker, same colour) can be weighed apart. */
function colourAt(data: Uint8ClampedArray, index: number) {
  const r = data[index * 4];
  const g = data[index * 4 + 1];
  const b = data[index * 4 + 2];
  return { l: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, a: (r - g) / 255, b: ((r + g) / 2 - b) / 255 };
}
type Colour = ReturnType<typeof colourAt>;

/**
 * Where the paper is in the picture: all of it (a straightened sheet), only the border band
 * (a scan, or a photo with no sheet in it), or inside the sheet's four corners.
 */
export type PaperArea = "whole" | "border" | readonly Point[];

/** Whether a point is inside a polygon (even-odd rule). */
function insidePolygon(polygon: readonly Point[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The sheet's corners pulled in a little, so the blurry strip at its edge isn't read as paper. */
function insetPolygon(polygon: readonly Point[], fraction: number) {
  const middle = polygon.reduce((sum, point) => ({ x: sum.x + point.x / polygon.length, y: sum.y + point.y / polygon.length }), { x: 0, y: 0 });
  return polygon.map((point) => ({ x: point.x + (middle.x - point.x) * fraction, y: point.y + (middle.y - point.y) * fraction }));
}

/** The polygon's area, in square pixels. */
function polygonArea(polygon: readonly Point[]) {
  let twice = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) twice += polygon[j].x * polygon[i].y - polygon[i].x * polygon[j].y;
  return Math.abs(twice) / 2;
}

/**
 * Where the paper is in a photo that wasn't straightened: the sheet, when one shows with the
 * table around it, or else the border band (a scan, or paper filling the frame).
 */
export function sheetIn(picture: Rgba, backdrop: Backdrop): PaperArea {
  const small = Math.min(1, 700 / Math.max(picture.width, picture.height));
  const preview = small < 1 ? resizePicture(picture, Math.max(1, Math.round(picture.width * small)), Math.max(1, Math.round(picture.height * small))) : picture;
  const found = findPaper(preview, backdrop);
  if (!found) return "border";
  const corners = found.map((corner) => ({ x: corner.x / small, y: corner.y / small }));
  const share = polygonArea(corners) / (picture.width * picture.height);
  return share > 0.1 && share < 0.95 ? corners : "border";
}

/** The paper's colour: the middle colour of the picture's border band, the whole picture, or the sheet. */
export function paperColour(picture: Rgba, area: PaperArea): Colour {
  const ls: number[] = [];
  const as: number[] = [];
  const bs: number[] = [];
  const { width, height } = picture;
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.04));
  const step = Math.max(1, Math.round(Math.sqrt((width * height) / 40000)));
  const sheet = typeof area === "string" ? null : insetPolygon(area, 0.03);
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (area === "border" && x > band && y > band && x < width - band && y < height - band) continue;
      if (sheet && !insidePolygon(sheet, x, y)) continue;
      const index = y * width + x;
      if (picture.data[index * 4 + 3] < 128) continue;
      const colour = colourAt(picture.data, index);
      ls.push(colour.l);
      as.push(colour.a);
      bs.push(colour.b);
    }
  }
  const middle = (values: number[]) => {
    values.sort((p, q) => p - q);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  return { l: middle(ls), a: middle(as), b: middle(bs) };
}

/** The average colour in a little square around a click. */
function colourAround(picture: Rgba, x: number, y: number): Colour {
  let l = 0;
  let a = 0;
  let b = 0;
  let n = 0;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= picture.width || py >= picture.height) continue;
      const colour = colourAt(picture.data, py * picture.width + px);
      l += colour.l;
      a += colour.a;
      b += colour.b;
      n += 1;
    }
  }
  return n ? { l: l / n, a: a / n, b: b / n } : { l: 0, a: 0, b: 0 };
}

/**
 * How unlike the paper each pixel is, 0 to about 1. Darker-but-same-colour counts for less
 * on white paper as `ignoreShadows` rises; on black paper every change in brightness counts,
 * since a shiny part shows up by its highlights against the dark sheet.
 */
export function differenceMap(picture: Rgba, papers: readonly Colour[], options: Pick<SegmentOptions, "backdrop" | "ignoreShadows">) {
  const { width, height } = picture;
  const raw = new Float32Array(width * height);
  const shadowWeight = options.backdrop === "white" ? 1 - 0.85 * Math.max(0, Math.min(1, options.ignoreShadows)) : 1;
  for (let index = 0; index < raw.length; index += 1) {
    if (picture.data[index * 4 + 3] < 128) continue;
    const colour = colourAt(picture.data, index);
    let nearest = Infinity;
    for (const paper of papers) {
      const dl = colour.l - paper.l;
      // Only darkening is shadow; a part lighter than white paper is still a part.
      const weight = dl < 0 ? shadowWeight : 1;
      const distance = Math.sqrt(weight * dl * dl + 2.5 * ((colour.a - paper.a) ** 2 + (colour.b - paper.b) ** 2));
      if (distance < nearest) nearest = distance;
    }
    raw[index] = nearest;
  }
  // A light 3 × 3 blur, so camera noise doesn't fray the edge.
  const blurred = new Float32Array(raw.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const py = y + dy;
        if (py < 0 || py >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const px = x + dx;
          if (px < 0 || px >= width) continue;
          sum += raw[py * width + px];
          n += 1;
        }
      }
      blurred[y * width + x] = sum / n;
    }
  }
  return blurred;
}

/** Otsu's cut-off over a difference map, which runs 0 to about 1. */
function cutOff(values: Float32Array) {
  const bins = new Float64Array(256);
  for (const value of values) bins[Math.min(255, Math.floor(Math.min(1, value) * 255))] += 1;
  const total = values.length;
  let sumAll = 0;
  for (let level = 0; level < 256; level += 1) sumAll += level * bins[level];
  let below = 0;
  let sumBelow = 0;
  let best = -1;
  let threshold = 40;
  for (let level = 0; level < 256; level += 1) {
    below += bins[level];
    if (below === 0) continue;
    const above = total - below;
    if (above === 0) break;
    sumBelow += level * bins[level];
    const between = below * above * (sumBelow / below - (sumAll - sumBelow) / above) ** 2;
    if (between > best) {
      best = between;
      threshold = level + 0.5;
    }
  }
  return threshold / 255;
}

/**
 * The simple tracer: everything unlike the paper, then only the pieces under a keep click.
 * A drop click teaches it that colour is paper too (a shadow, a smudge), so it falls away
 * everywhere at once, the way a person would expect.
 */
export function segmentByColour(picture: Rgba, clicks: readonly TraceClick[], options: SegmentOptions, paperArea: PaperArea) {
  const { width, height } = picture;
  const papers = [paperColour(picture, paperArea), ...clicks.filter((click) => !click.keep).map((click) => colourAround(picture, click.x, click.y))];
  const difference = differenceMap(picture, papers, options);
  // The object lies on the sheet, so the table around it is never part of it.
  if (typeof paperArea !== "string") {
    const sheet = insetPolygon(paperArea, 0.005);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) if (!insidePolygon(sheet, x + 0.5, y + 0.5)) difference[y * width + x] = 0;
    }
  }
  // The auto cut-off sits between paper and object; sensitivity slides it from there.
  const auto = cutOff(difference);
  const threshold = Math.max(0.01, auto * (1.6 - 1.2 * Math.max(0, Math.min(1, options.sensitivity))));
  const object = new Uint8Array(width * height);
  for (let index = 0; index < object.length; index += 1) object[index] = difference[index] > threshold ? 1 : 0;
  // A colour clicked as part of the object (a pale handle) counts wherever it is closer to that than to the paper.
  const kept = clicks.filter((click) => click.keep).map((click) => colourAround(picture, click.x, click.y));
  if (kept.length > 0) {
    for (let index = 0; index < object.length; index += 1) {
      if (object[index] || picture.data[index * 4 + 3] < 128) continue;
      const colour = colourAt(picture.data, index);
      const toObject = Math.min(...kept.map((part) => Math.hypot(colour.l - part.l, 1.6 * (colour.a - part.a), 1.6 * (colour.b - part.b))));
      if (toObject < difference[index] * 0.6 && toObject < 0.12) object[index] = 1;
    }
  }
  const closed = closeMask(object, width, height, 1);
  return keepClicked(closed, width, height, clicks);
}

/** Keeps only the pieces of a mask that a keep click lands on (or near). */
export function keepClicked(mask: Uint8Array, width: number, height: number, clicks: readonly TraceClick[]) {
  const result = new Uint8Array(mask.length);
  const stack: number[] = [];
  for (const click of clicks) {
    if (!click.keep) continue;
    // A click just off the edge still picks the piece beside it.
    let seed = -1;
    for (let radius = 0; radius <= 6 && seed < 0; radius += 1) {
      for (let dy = -radius; dy <= radius && seed < 0; dy += 1) {
        for (let dx = -radius; dx <= radius && seed < 0; dx += 1) {
          const x = Math.round(click.x) + dx;
          const y = Math.round(click.y) + dy;
          if (x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x]) seed = y * width + x;
        }
      }
    }
    if (seed < 0 || result[seed]) continue;
    result[seed] = 1;
    stack.push(seed);
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && !result[next]) {
            result[next] = 1;
            stack.push(next);
          }
        }
      }
    }
  }
  return result;
}

/** One dimension of the squared distance transform (Felzenszwalb & Huttenlocher). */
function distance1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}

/** Squared distance, in pixels, from each pixel to the nearest set pixel of the mask. */
export function squaredDistanceTo(mask: Uint8Array, width: number, height: number) {
  const big = 1e20;
  const grid = new Float64Array(width * height);
  for (let index = 0; index < grid.length; index += 1) grid[index] = mask[index] ? 0 : big;
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) f[y] = grid[y * width + x];
    distance1d(f, height, d, v, z);
    for (let y = 0; y < height; y += 1) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) f[x] = grid[y * width + x];
    distance1d(f, width, d, v, z);
    for (let x = 0; x < width; x += 1) grid[y * width + x] = d[x];
  }
  return grid;
}

/** Grows a mask outward by `pixels` (shrinks it for a negative number), round at the corners. */
export function growMask(mask: Uint8Array, width: number, height: number, pixels: number) {
  if (Math.abs(pixels) < 1e-6) return mask.slice();
  const result = new Uint8Array(mask.length);
  if (pixels > 0) {
    const distance = squaredDistanceTo(mask, width, height);
    const limit = pixels * pixels;
    for (let index = 0; index < result.length; index += 1) result[index] = distance[index] <= limit ? 1 : 0;
  } else {
    const inverse = new Uint8Array(mask.length);
    for (let index = 0; index < mask.length; index += 1) inverse[index] = mask[index] ? 0 : 1;
    const distance = squaredDistanceTo(inverse, width, height);
    const limit = pixels * pixels;
    for (let index = 0; index < result.length; index += 1) result[index] = mask[index] && distance[index] > limit ? 1 : 0;
  }
  return result;
}

/** Closes small gaps and nicks: grow, then shrink back by the same amount. */
export function closeMask(mask: Uint8Array, width: number, height: number, pixels: number) {
  return growMask(growMask(mask, width, height, pixels), width, height, -pixels);
}

/** The size of a mask's set pixels, in pixels: its bounding box. */
export function maskBounds(mask: Uint8Array, width: number) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const x = index % width;
    const y = (index - x) / width;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + 1);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + 1);
  }
  return Number.isFinite(minX) ? { minX, minY, width: maxX - minX, height: maxY - minY } : null;
}

/** A brush stroke drawn over the trace: it adds to the object, or erases from it. */
export type TraceStroke = { erase: boolean; radius: number; points: readonly Point[] };

/** Paints strokes onto a mask in the order they were drawn, as round-ended bands of the brush's width. */
export function applyStrokes(mask: Uint8Array | null, width: number, height: number, strokes: readonly TraceStroke[]) {
  const result = mask ? mask.slice() : new Uint8Array(width * height);
  for (const stroke of strokes) {
    const value = stroke.erase ? 0 : 1;
    const r = Math.max(0.5, stroke.radius);
    const points = stroke.points.length === 1 ? [stroke.points[0], stroke.points[0]] : stroke.points;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length2 = dx * dx + dy * dy;
      const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - r));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + r));
      const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - r));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + r));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const px = x + 0.5;
          const py = y + 0.5;
          const t = length2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length2)) : 0;
          if ((px - a.x - t * dx) ** 2 + (py - a.y - t * dy) ** 2 <= r * r) result[y * width + x] = value;
        }
      }
    }
  }
  return result;
}
