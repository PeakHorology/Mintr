import type { Vec2 } from "manifold-3d";

/**
 * Turns the many short straight lines of a laser outline back into true arcs where they
 * follow a circle. The cut comes out smoother, the machine does not slow down at every
 * tiny corner, and the file is much smaller. Anything that is not a curve stays as it was.
 */

export type PathSegment =
  | { kind: "line"; to: Vec2 }
  /** `sweep` is true when the arc turns from +x toward +y, the way the points are stored. */
  | { kind: "arc"; to: Vec2; center: Vec2; radius: number; sweep: boolean; angle: number };

export type FittedPath = { start: Vec2; segments: PathSegment[] };

/** How far a corner of the outline may sit from the arc that replaces it. */
const POINT_TOLERANCE_MM = 0.02;
/**
 * How far the middle of a straight piece may sit from the arc. A circle's corners lie on it and
 * its straight pieces cut inside, so this is looser, and it is what keeps a real many-sided
 * shape from turning round: its flats are too long to pass.
 */
const FLAT_TOLERANCE_MM = 0.08;
/** A corner this sharp is a corner, whatever the points around it do. */
const MAX_TURN = (35 * Math.PI) / 180;
/** Below this it is simpler to leave it straight. */
const MIN_ARC_TURN = (4 * Math.PI) / 180;
const MAX_ARC_ANGLE = (170 * Math.PI) / 180;
const MIN_POINTS = 4;
const MAX_RADIUS_MM = 50_000;

function turnAt(a: Vec2, b: Vec2, c: Vec2) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const vx = c[0] - b[0];
  const vy = c[1] - b[1];
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

function circleThrough(a: Vec2, b: Vec2, c: Vec2): { center: Vec2; radius: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const aa = a[0] * a[0] + a[1] * a[1];
  const bb = b[0] * b[0] + b[1] * b[1];
  const cc = c[0] * c[0] + c[1] * c[1];
  const x = (aa * (b[1] - c[1]) + bb * (c[1] - a[1]) + cc * (a[1] - b[1])) / d;
  const y = (aa * (c[0] - b[0]) + bb * (a[0] - c[0]) + cc * (b[0] - a[0])) / d;
  const radius = Math.hypot(a[0] - x, a[1] - y);
  return Number.isFinite(radius) && radius <= MAX_RADIUS_MM ? { center: [x, y], radius } : null;
}

/** The arc through points `from` to `to`, or null if those points do not follow one. */
function arcFor(points: readonly Vec2[], from: number, to: number): Extract<PathSegment, { kind: "arc" }> | null {
  const count = to - from + 1;
  if (count < MIN_POINTS) return null;
  const circle = circleThrough(points[from], points[from + Math.floor((to - from) / 2)], points[to]);
  if (!circle) return null;
  const { center, radius } = circle;
  let turned = 0;
  let direction = 0;
  for (let index = from + 1; index < to; index += 1) {
    const turn = turnAt(points[index - 1], points[index], points[index + 1]);
    if (Math.abs(turn) > MAX_TURN) return null;
    if (Math.abs(turn) > 1e-7) {
      const side = Math.sign(turn);
      if (direction !== 0 && side !== direction) return null;
      direction = side;
    }
    turned += turn;
  }
  if (direction === 0 || Math.abs(turned) < MIN_ARC_TURN) return null;
  for (let index = from; index <= to; index += 1) {
    const [x, y] = points[index];
    if (Math.abs(Math.hypot(x - center[0], y - center[1]) - radius) > POINT_TOLERANCE_MM) return null;
    if (index < to) {
      const midX = (x + points[index + 1][0]) / 2;
      const midY = (y + points[index + 1][1]) / 2;
      if (Math.abs(Math.hypot(midX - center[0], midY - center[1]) - radius) > FLAT_TOLERANCE_MM) return null;
    }
  }
  // Add up the angle swept so a long arc is split before its ends become ambiguous.
  let angle = 0;
  for (let index = from; index < to; index += 1) {
    const a = Math.atan2(points[index][1] - center[1], points[index][0] - center[0]);
    const b = Math.atan2(points[index + 1][1] - center[1], points[index + 1][0] - center[0]);
    let step = b - a;
    while (step > Math.PI) step -= 2 * Math.PI;
    while (step < -Math.PI) step += 2 * Math.PI;
    if (Math.sign(step) !== direction && Math.abs(step) > 1e-7) return null;
    angle += Math.abs(step);
  }
  if (angle > MAX_ARC_ANGLE) return null;
  return { kind: "arc", to: points[to], center, radius, sweep: direction > 0, angle };
}

/**
 * Where a closed loop starts, so no arc is broken in two at the seam: its sharpest corner, or on
 * a smooth loop the end of its longest straight piece, which is where a curve begins.
 */
function startAtSeam(points: readonly Vec2[]): Vec2[] {
  const count = points.length;
  let corner = 0;
  let sharpest = -1;
  let longest = 0;
  let longestLength = -1;
  for (let index = 0; index < count; index += 1) {
    const before = points[(index + count - 1) % count];
    const turn = Math.abs(turnAt(before, points[index], points[(index + 1) % count]));
    if (turn > sharpest) {
      sharpest = turn;
      corner = index;
    }
    const length = Math.hypot(points[index][0] - before[0], points[index][1] - before[1]);
    if (length > longestLength) {
      longestLength = length;
      longest = index;
    }
  }
  const start = sharpest > MAX_TURN ? corner : longest;
  return [...points.slice(start), ...points.slice(0, start)];
}

export function fitPath(input: readonly Vec2[], closed: boolean): FittedPath | null {
  if (input.length === 0) return null;
  const opened = closed && input.length > 2 ? startAtSeam(input) : [...input];
  const points = closed && input.length > 2 ? [...opened, opened[0]] : opened;
  const segments: PathSegment[] = [];
  let index = 0;
  while (index < points.length - 1) {
    let best: Extract<PathSegment, { kind: "arc" }> | null = null;
    let bestEnd = index;
    // Grow the arc for as long as the points still follow one.
    for (let end = index + MIN_POINTS - 1; end < points.length; end += 1) {
      const arc = arcFor(points, index, end);
      if (arc) {
        best = arc;
        bestEnd = end;
      } else if (best) {
        break;
      } else if (end - index >= MIN_POINTS + 2) {
        break;
      }
    }
    if (best) {
      segments.push(best);
      index = bestEnd;
    } else {
      segments.push({ kind: "line", to: points[index + 1] });
      index += 1;
    }
  }
  return { start: points[0], segments };
}

/** DXF stores an arc as a bulge on its first point: the tangent of a quarter of its angle. */
export function arcBulge(arc: Extract<PathSegment, { kind: "arc" }>) {
  return Math.tan(arc.angle / 4) * (arc.sweep ? 1 : -1);
}
