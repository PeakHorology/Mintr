import { orderCorners, type Point } from "@/lib/photoTrace/geometry";
import type { Rgba } from "@/lib/photoTrace/picture";

/** What the object lies on. Black paper keeps shiny metal from vanishing into a white sheet. */
export type Backdrop = "white" | "black";

function greyOf(picture: Rgba) {
  const grey = new Float32Array(picture.width * picture.height);
  for (let index = 0; index < grey.length; index += 1) {
    grey[index] = (0.2126 * picture.data[index * 4] + 0.7152 * picture.data[index * 4 + 1] + 0.0722 * picture.data[index * 4 + 2]) / 255;
  }
  return grey;
}

/** Otsu's cut-off between the two main groups of greys. */
export function otsu(values: Float32Array, mask?: Uint8Array) {
  const bins = new Float64Array(256);
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (mask && !mask[index]) continue;
    bins[Math.max(0, Math.min(255, Math.floor(values[index] * 255)))] += 1;
    total += 1;
  }
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
    const between = below * above * (sumBelow / below - (sumAll - sumBelow) / above) ** 2;
    if (between > best) {
      best = between;
      threshold = level + 0.5;
    }
  }
  return threshold / 255;
}

/** Convex hull, Andrew's monotone chain. */
function hull(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function quadArea(a: Point, b: Point, c: Point, d: Point) {
  const points = [a, b, c, d];
  let area = 0;
  for (let index = 0; index < 4; index += 1) {
    const p = points[index];
    const q = points[(index + 1) % 4];
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area) / 2;
}

/** The best-fitting line through some points: a point on it and its direction. */
function fitLine(points: Point[]) {
  const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    xx += (point.x - cx) ** 2;
    xy += (point.x - cx) * (point.y - cy);
    yy += (point.y - cy) ** 2;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  return { cx, cy, dx: Math.cos(angle), dy: Math.sin(angle) };
}

function meet(a: ReturnType<typeof fitLine>, b: ReturnType<typeof fitLine>): Point | null {
  const cross = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(cross) < 1e-6) return null;
  const t = ((b.cx - a.cx) * b.dy - (b.cy - a.cy) * b.dx) / cross;
  return { x: a.cx + a.dx * t, y: a.cy + a.dy * t };
}

/**
 * Finds the sheet of paper: the biggest patch as light as white paper (or as dark as black
 * paper), its outline squared up into four corners. Each side is a line fitted along the
 * sheet's edge away from the corners, so a tool lying across one edge doesn't drag a corner.
 * Returns corners in the picture's pixels, top-left first, or null when no sheet stands out.
 */
export function findPaper(picture: Rgba, backdrop: Backdrop): Point[] | null {
  const { width, height } = picture;
  const grey = greyOf(picture);
  const cut = otsu(grey);
  const sheet = new Uint8Array(grey.length);
  for (let index = 0; index < grey.length; index += 1) sheet[index] = (backdrop === "white" ? grey[index] > cut : grey[index] < cut) ? 1 : 0;
  // The biggest connected patch is the sheet.
  const label = new Int32Array(grey.length).fill(-1);
  let bestLabel = -1;
  let bestSize = 0;
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < grey.length; start += 1) {
    if (!sheet[start] || label[start] >= 0) continue;
    let size = 0;
    stack.push(start);
    label[start] = next;
    while (stack.length > 0) {
      const index = stack.pop()!;
      size += 1;
      const x = index % width;
      const y = (index - x) / width;
      const visit = (other: number) => {
        if (sheet[other] && label[other] < 0) {
          label[other] = next;
          stack.push(other);
        }
      };
      if (x > 0) visit(index - 1);
      if (x < width - 1) visit(index + 1);
      if (y > 0) visit(index - width);
      if (y < height - 1) visit(index + width);
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = next;
    }
    next += 1;
  }
  // Too small, or the whole picture: no sheet to find.
  if (bestLabel < 0 || bestSize < grey.length * 0.08) return null;
  const edge: Point[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (label[index] !== bestLabel) continue;
      const outside = (x === 0 || label[index - 1] !== bestLabel) || (x === width - 1 || label[index + 1] !== bestLabel)
        || (y === 0 || label[index - width] !== bestLabel) || (y === height - 1 || label[index + width] !== bestLabel);
      if (outside) edge.push({ x: x + 0.5, y: y + 0.5 });
    }
  }
  const around = hull(edge);
  if (around.length < 4) return null;
  // Thin the hull to a few dozen points, then take the four making the biggest quadrilateral.
  const step = Math.max(1, Math.ceil(around.length / 28));
  const few = around.filter((_, index) => index % step === 0);
  let best: Point[] | null = null;
  let bestArea = 0;
  for (let a = 0; a < few.length; a += 1) {
    for (let b = a + 1; b < few.length; b += 1) {
      for (let c = b + 1; c < few.length; c += 1) {
        for (let d = c + 1; d < few.length; d += 1) {
          const area = quadArea(few[a], few[b], few[c], few[d]);
          if (area > bestArea) {
            bestArea = area;
            best = [few[a], few[b], few[c], few[d]];
          }
        }
      }
    }
  }
  if (!best) return null;
  const rough = orderCorners(best);
  // Refine each side with a line through the sheet's edge pixels along its middle stretch.
  const reach = Math.hypot(width, height) * 0.02;
  const lines = rough.map((start, side) => {
    const end = rough[(side + 1) % 4];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const near = edge.filter((point) => {
      const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (length * length);
      if (t < 0.12 || t > 0.88) return false;
      return Math.abs((point.x - start.x) * dy - (point.y - start.y) * dx) / length < reach;
    });
    return near.length >= 12 ? fitLine(near) : { cx: start.x, cy: start.y, dx: dx / length, dy: dy / length };
  });
  const corners = lines.map((line, side) => meet(lines[(side + 3) % 4], line) ?? rough[side]);
  // A refined corner that wandered far from the rough one is less trustworthy than the rough one.
  return corners.map((corner, index) => (Math.hypot(corner.x - rough[index].x, corner.y - rough[index].y) > reach * 3 ? rough[index] : corner));
}
