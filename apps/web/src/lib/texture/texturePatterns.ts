import type { SurfaceTextureImage, SurfaceTexturePattern } from "./surfaceTexture";

/**
 * Height of a pattern from 0 (the surface) to 1 (the top of the texture).
 * u and v are measured in repeats, so one repeat runs from 0 to 1.
 */
export type PatternHeight = (u: number, v: number) => number;

const fract = (x: number) => x - Math.floor(x);

/** 0 on whole repeats, 1 halfway between them. */
const peak = (x: number) => 1 - 2 * Math.abs(fract(x) - 0.5);

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const KNURL_ROUND = 0.1;

/** A ridge profile with straight flanks and slightly rounded crests and valleys, as a real knurl wheel leaves. */
function roundedPeak(x: number): number {
  const p = peak(x);
  const k = KNURL_ROUND;
  const flank = p < k ? (p * p) / (2 * k) : p > 1 - k ? 1 - k - ((1 - p) * (1 - p)) / (2 * k) : p - k / 2;
  return flank / (1 - k);
}

/** The lower of two heights, with the crease between them rounded over a width of k. */
function softMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(0, Math.min(a, b) - (h * h * k) / 4);
}

/** Raised diamonds, like a knurled grip: two crossed sets of ridges, each diamond a pyramid. */
const knurl: PatternHeight = (u, v) => softMin(roundedPeak(u + v), roundedPeak(u - v), KNURL_ROUND);

/** Round-bottomed ridges that print cleanly in any direction. */
const grooves: PatternHeight = (u) => 0.5 - 0.5 * Math.cos(2 * Math.PI * u);

const SQRT3 = Math.sqrt(3);
const HEX_WALL = 0.16;

/** Raised hexagons with a narrow channel between them. One repeat is the distance between centres. */
const honeycomb: PatternHeight = (u, v) => {
  // Two offset rectangular grids; the nearer centre is the hexagon the point is in.
  const ax = u - Math.floor(u) - 0.5;
  const ay = v / SQRT3 - Math.floor(v / SQRT3);
  const a = [ax, (ay - 0.5) * SQRT3];
  const bx = u - 0.5 - Math.floor(u - 0.5) - 0.5;
  const by = (v - SQRT3 / 2) / SQRT3 - Math.floor((v - SQRT3 / 2) / SQRT3);
  const b = [bx, (by - 0.5) * SQRT3];
  const g = a[0] * a[0] + a[1] * a[1] < b[0] * b[0] + b[1] * b[1] ? a : b;
  const x = Math.abs(g[0]);
  const y = Math.abs(g[1]);
  // Distance from the centre to the hexagon's edge is 0.5 across the flats.
  const hexDistance = Math.max(x, (x + SQRT3 * y) / 2);
  return smoothstep(0, HEX_WALL, 0.5 - hexDistance);
};

const BUMP_RADIUS = 0.42;

/**
 * Rounded dots in staggered rows, like a grip pad. The dome rises softly from the surface
 * (a cosine, not a half ball), so there is no wall at its foot: smooth to look at, and no
 * overhang to print.
 */
const bumps: PatternHeight = (u, v) => {
  const row = Math.floor(v);
  const shifted = u + (row % 2 === 0 ? 0 : 0.5);
  const x = fract(shifted) - 0.5;
  const y = fract(v) - 0.5;
  const r = Math.sqrt(x * x + y * y) / BUMP_RADIUS;
  return r >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * r);
};

/** Strands woven over and under, like a basket or carbon cloth. Two strands each way per repeat. */
const weave: PatternHeight = (u, v) => {
  const a = fract(u * 2);
  const b = fract(v * 2);
  const over = (Math.floor(u * 2) + Math.floor(v * 2)) % 2 === 0;
  // Each strand is rounded across its width and dips where it passes under the other.
  const across = over ? Math.sin(Math.PI * b) : Math.sin(Math.PI * a);
  const along = over ? Math.sin(Math.PI * a) : Math.sin(Math.PI * b);
  return Math.sqrt(Math.max(0, across)) * (0.55 + 0.45 * along);
};

const MORTAR = 0.07;

/** Bricks in a running bond: one brick long and half a repeat high, every other row moved half a brick. */
const brick: PatternHeight = (u, v) => {
  const row = Math.floor(v * 2);
  const x = fract(u + (row % 2 === 0 ? 0 : 0.5));
  const y = fract(v * 2);
  // Distance to the nearest joint, in repeats; rows are half as tall, so their joints count half.
  const edge = Math.min(x, 1 - x, (y / 2), (1 - y) / 2);
  return smoothstep(0, MORTAR, edge);
};

/** Tread plate: raised lozenges turned one way, then the other, like a steel step. */
const diamondPlate: PatternHeight = (u, v) => {
  const cu = Math.floor(u * 2);
  const cv = Math.floor(v * 2);
  const x = fract(u * 2) - 0.5;
  const y = fract(v * 2) - 0.5;
  const turn = (cu + cv) % 2 === 0 ? 1 : -1;
  const along = (x + turn * y) / Math.SQRT2;
  const across = (x - turn * y) / Math.SQRT2;
  const r = Math.hypot(along / 0.34, across / 0.08);
  return r >= 1 ? 0 : Math.sqrt(1 - r * r);
};

const LEATHER_CELLS = 4;

const cellHash = (i: number, j: number, k: number) => hash3(i, j, k, 7);

/** Pebbled grain like leather: soft rounded cells with narrow creases. Four cells across a repeat. */
const leather: PatternHeight = (u, v) => {
  const x = u * LEATHER_CELLS;
  const y = v * LEATHER_CELLS;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let first = Infinity;
  let second = Infinity;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      // Cells wrap every repeat, so the grain meets itself around a part.
      const cx = ix + dx;
      const cy = iy + dy;
      const wx = ((cx % LEATHER_CELLS) + LEATHER_CELLS) % LEATHER_CELLS;
      const wy = ((cy % LEATHER_CELLS) + LEATHER_CELLS) % LEATHER_CELLS;
      const px = cx + 0.15 + 0.7 * cellHash(wx, wy, 0);
      const py = cy + 0.15 + 0.7 * cellHash(wx, wy, 1);
      const d = Math.hypot(x - px, y - py);
      if (d < first) {
        second = first;
        first = d;
      } else if (d < second) {
        second = d;
      }
    }
  }
  return smoothstep(0, 0.35, second - first);
};

/** Wood grain: long wavering lines across the repeat. */
const wood: PatternHeight = (u, v) => {
  const line = u + 0.18 * Math.sin(2 * Math.PI * v * 0.23) + 0.07 * Math.sin(2 * Math.PI * v * 0.71 + 1.3);
  return (0.5 - 0.5 * Math.cos(2 * Math.PI * line)) ** 3;
};

/** Smooth ripples that sway as they run. */
const waves: PatternHeight = (u, v) => 0.5 + 0.5 * Math.sin(2 * Math.PI * (u + 0.25 * Math.sin(Math.PI * v)));

export const PATTERN_HEIGHTS: Record<Exclude<SurfaceTexturePattern, "fuzzy" | "image">, PatternHeight> = {
  knurl,
  grooves,
  honeycomb,
  bumps,
  weave,
  brick,
  diamondPlate,
  leather,
  wood,
  waves,
};

/**
 * A picture as a pattern: lighter is higher. One repeat is the picture's width;
 * its height keeps the picture's shape. Read smoothly between pixels and
 * wrapped at the sides, as the graphics card reads it for the preview.
 */
export function imageHeight(image: { width: number; height: number; pixels: Uint8Array; invert: boolean }): PatternHeight {
  const { width, height, pixels, invert } = image;
  const tall = height / width;
  const at = (x: number, y: number) => {
    const value = pixels[(((y % height) + height) % height) * width + (((x % width) + width) % width)] / 255;
    return invert ? 1 - value : value;
  };
  return (u, v) => {
    const x = fract(u) * width - 0.5;
    const y = (1 - fract(v / tall)) * height - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

/** Integer hash to 0..1, so the same seed always gives the same grain. */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const corner = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = lerp(corner(0, 0, 0), corner(1, 0, 0), sx);
  const x10 = lerp(corner(0, 1, 0), corner(1, 1, 0), sx);
  const x01 = lerp(corner(0, 0, 1), corner(1, 0, 1), sx);
  const x11 = lerp(corner(0, 1, 1), corner(1, 1, 1), sx);
  return lerp(lerp(x00, x10, sy), lerp(x01, x11, sy), sz);
}

/**
 * Fuzzy skin as real geometry: a random grain that needs no wrapping, so it has
 * no seams and looks the same on every face. Position is in grains.
 */
export function fuzzyHeight(x: number, y: number, z: number, seed: number): number {
  const coarse = valueNoise(x, y, z, seed);
  const fine = valueNoise(x * 2.03 + 17.1, y * 2.03 + 5.3, z * 2.03 + 11.7, seed + 1);
  return Math.min(1, Math.max(0, (coarse * 0.7 + fine * 0.3 - 0.5) * 1.8 + 0.5));
}

const decoded = new Map<string, Uint8Array>();

/** The picture's grey bytes, decoded once per picture. */
export function decodeTextureImage(image: SurfaceTextureImage): { width: number; height: number; pixels: Uint8Array; invert: boolean } {
  let pixels = decoded.get(image.data);
  if (!pixels) {
    const text = atob(image.data);
    pixels = new Uint8Array(image.width * image.height);
    for (let i = 0; i < pixels.length; i += 1) pixels[i] = text.charCodeAt(i);
    decoded.set(image.data, pixels);
    while (decoded.size > 8) {
      const oldest = decoded.keys().next().value;
      if (oldest === undefined) break;
      decoded.delete(oldest);
    }
  }
  return { width: image.width, height: image.height, pixels, invert: image.invert };
}

/** Grey bytes as base64, for keeping a picture in the settings. */
export function encodeTextureImage(pixels: Uint8Array): string {
  let text = "";
  for (let i = 0; i < pixels.length; i += 1) text += String.fromCharCode(pixels[i]);
  return btoa(text);
}
