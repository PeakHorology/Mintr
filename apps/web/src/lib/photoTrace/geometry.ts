/**
 * The measuring side of Trace from photo: straightening a photo of a sheet of paper so
 * every pixel is a known size, and turning a few typed-in distances into a scale.
 */

export type Point = { x: number; y: number };
/** A 3 × 3 projective map, row by row. */
export type Homography = [number, number, number, number, number, number, number, number, number];

/** Paper sizes people lay things on, in millimetres, short side first. */
export const PAPER_SIZES = {
  letter: { label: "US Letter", width: 215.9, height: 279.4 },
  a4: { label: "A4", width: 210, height: 297 },
  a5: { label: "A5", width: 148, height: 210 },
  legal: { label: "US Legal", width: 215.9, height: 355.6 },
} as const;
export type PaperSize = keyof typeof PAPER_SIZES;

/** Solves a small square system by Gaussian elimination with pivoting; null when singular. */
function solve(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (Math.abs(a[pivot][column]) < 1e-12) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = a[row][column] / a[column][column];
      for (let k = column; k <= n; k += 1) a[row][k] -= factor * a[column][k];
    }
  }
  return a.map((row, index) => row[n] / row[index]);
}

/** The homography taking each `from` point onto the matching `to` point (four of each). */
export function homographyFrom(from: readonly Point[], to: readonly Point[]): Homography | null {
  if (from.length !== 4 || to.length !== 4) return null;
  const rows: number[][] = [];
  const values: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = from[index];
    const { x: u, y: v } = to[index];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  }
  const h = solve(rows, values);
  return h ? [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] : null;
}

export function applyHomography(h: Homography, point: Point): Point {
  const w = h[6] * point.x + h[7] * point.y + h[8];
  return { x: (h[0] * point.x + h[1] * point.y + h[2]) / w, y: (h[3] * point.x + h[4] * point.y + h[5]) / w };
}

export function invertHomography(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, i, j] = h;
  const det = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inverse: Homography = [
    (e * j - f * i) / det, (c * i - b * j) / det, (b * f - c * e) / det,
    (f * g - d * j) / det, (a * j - c * g) / det, (c * d - a * f) / det,
    (d * i - e * g) / det, (b * g - a * i) / det, (a * e - b * d) / det,
  ];
  return inverse;
}

/** Orders four corners: top-left, top-right, bottom-right, bottom-left, as seen in the photo. */
export function orderCorners(corners: readonly Point[]): Point[] {
  const centre = corners.reduce((sum, point) => ({ x: sum.x + point.x / corners.length, y: sum.y + point.y / corners.length }), { x: 0, y: 0 });
  const sorted = [...corners].sort((a, b) => Math.atan2(a.y - centre.y, a.x - centre.x) - Math.atan2(b.y - centre.y, b.x - centre.x));
  // atan2 with y down runs clockwise from the left; start at the corner nearest top-left.
  let start = 0;
  let best = Infinity;
  sorted.forEach((point, index) => {
    const score = point.x + point.y;
    if (score < best) {
      best = score;
      start = index;
    }
  });
  return [0, 1, 2, 3].map((step) => sorted[(start + step) % 4]);
}

/**
 * Which way up the sheet lies: its longer side follows the longer side seen in the photo,
 * so a sheet photographed sideways is measured sideways.
 */
export function paperOrientation(corners: readonly Point[], size: PaperSize) {
  const [tl, tr, br, bl] = corners;
  const across = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
  const down = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
  const paper = PAPER_SIZES[size];
  return across >= down ? { width: paper.height, height: paper.width } : { width: paper.width, height: paper.height };
}

/** One typed-in distance between two clicked points. */
export type ReferencePair = { a: Point; b: Point; mm: number };

/**
 * Turns typed-in distances into millimetres per pixel, across and down.
 * One distance sets a single scale. Two or more allow the photo to be stretched a little
 * differently across than down, as a slightly tilted camera does, and each distance is
 * then checked against the fit, so a third distance tells you how far to trust it.
 */
export function scaleFromReferences(pairs: readonly ReferencePair[]) {
  const usable = pairs.filter((pair) => pair.mm > 0 && Math.hypot(pair.b.x - pair.a.x, pair.b.y - pair.a.y) > 1);
  if (usable.length === 0) return null;
  let across: number;
  let down: number;
  if (usable.length === 1) {
    const pair = usable[0];
    across = down = pair.mm / Math.hypot(pair.b.x - pair.a.x, pair.b.y - pair.a.y);
  } else {
    // mm² = across² · dx² + down² · dy², fitted by least squares in (across², down²).
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    let bx = 0;
    let by = 0;
    for (const pair of usable) {
      const dx2 = (pair.b.x - pair.a.x) ** 2;
      const dy2 = (pair.b.y - pair.a.y) ** 2;
      const target = pair.mm ** 2;
      sxx += dx2 * dx2;
      sxy += dx2 * dy2;
      syy += dy2 * dy2;
      bx += dx2 * target;
      by += dy2 * target;
    }
    const fit = solve([[sxx, sxy], [sxy, syy]], [bx, by]);
    // Two distances in nearly the same direction can't tell across from down: use one scale.
    if (!fit || !(fit[0] > 0) || !(fit[1] > 0) || Math.abs(Math.log(fit[0] / fit[1])) > Math.log(4)) {
      const total = usable.reduce((sum, pair) => sum + pair.mm, 0);
      const pixels = usable.reduce((sum, pair) => sum + Math.hypot(pair.b.x - pair.a.x, pair.b.y - pair.a.y), 0);
      across = down = total / pixels;
    } else {
      across = Math.sqrt(fit[0]);
      down = Math.sqrt(fit[1]);
    }
  }
  const checks = usable.map((pair) => {
    const measured = Math.hypot((pair.b.x - pair.a.x) * across, (pair.b.y - pair.a.y) * down);
    return { typed: pair.mm, measured, percentOff: ((measured - pair.mm) / pair.mm) * 100 };
  });
  return { across, down, checks };
}

/** Millimetres per pixel from a picture's recorded resolution. */
export function scaleFromDpi(dpi: number) {
  return dpi > 0 ? 25.4 / dpi : 0;
}
