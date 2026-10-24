/** 2D outline for the Face tool: inset a flat face, then round its corners. */

export type FaceVec2 = { x: number; z: number };
export type FaceVec3 = { x: number; y: number; z: number };

const COLINEAR = 0.035;

function sub2(a: FaceVec2, b: FaceVec2): FaceVec2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

function add2(a: FaceVec2, b: FaceVec2): FaceVec2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

function mul2(a: FaceVec2, scale: number): FaceVec2 {
  return { x: a.x * scale, z: a.z * scale };
}

function dot2(a: FaceVec2, b: FaceVec2) {
  return a.x * b.x + a.z * b.z;
}

function len2(a: FaceVec2) {
  return Math.hypot(a.x, a.z);
}

function norm2(a: FaceVec2): FaceVec2 {
  const length = len2(a);
  if (length < 1e-12) return { x: 0, z: 0 };
  return { x: a.x / length, z: a.z / length };
}

function left2(a: FaceVec2): FaceVec2 {
  return { x: -a.z, z: a.x };
}

export function signedArea2(loop: FaceVec2[]) {
  let area = 0;
  for (let index = 0; index < loop.length; index += 1) {
    const current = loop[index];
    const next = loop[(index + 1) % loop.length];
    area += current.x * next.z - next.x * current.z;
  }
  return area / 2;
}

export function ensureCcw(loop: FaceVec2[]): FaceVec2[] {
  return signedArea2(loop) < 0 ? [...loop].reverse() : loop.slice();
}

/** Drop points that sit on a straight edge so a sampled rectangle stays four corners. */
export function simplifyColinear(loop: FaceVec2[], minCross = COLINEAR): FaceVec2[] {
  if (loop.length < 4) return loop;
  const kept: FaceVec2[] = [];
  for (let index = 0; index < loop.length; index += 1) {
    const previous = loop[(index - 1 + loop.length) % loop.length];
    const current = loop[index];
    const next = loop[(index + 1) % loop.length];
    const inbound = norm2(sub2(current, previous));
    const outbound = norm2(sub2(next, current));
    const cross = inbound.x * outbound.z - inbound.z * outbound.x;
    if (Math.abs(cross) < minCross && dot2(inbound, outbound) > 0) continue;
    kept.push(current);
  }
  return kept.length >= 3 ? kept : loop;
}

function dedupeLoop(loop: FaceVec2[], gap = 0.02): FaceVec2[] {
  const kept: FaceVec2[] = [];
  for (const point of loop) {
    const previous = kept[kept.length - 1];
    if (previous && Math.hypot(previous.x - point.x, previous.z - point.z) < gap) continue;
    kept.push(point);
  }
  if (kept.length > 2) {
    const first = kept[0];
    const last = kept[kept.length - 1];
    if (Math.hypot(first.x - last.x, first.z - last.z) < gap) kept.pop();
  }
  return kept;
}

type OffsetLine = { origin: FaceVec2; dir: FaceVec2 };

function offsetEdge(start: FaceVec2, end: FaceVec2, distance: number): OffsetLine | null {
  const dir = norm2(sub2(end, start));
  if (len2(dir) < 0.5) return null;
  return { origin: add2(start, mul2(left2(dir), distance)), dir };
}

function lineIntersect(a: OffsetLine, b: OffsetLine): FaceVec2 | null {
  const cross = a.dir.x * b.dir.z - a.dir.z * b.dir.x;
  if (Math.abs(cross) < 1e-10) return null;
  const delta = sub2(b.origin, a.origin);
  const t = (delta.x * b.dir.z - delta.z * b.dir.x) / cross;
  return add2(a.origin, mul2(a.dir, t));
}

/** Per-edge inset. A negative value pushes that edge outward. `null` uses the shared inset. */
export type EdgeInset = (start: FaceVec2, end: FaceVec2) => number | null;

/** Inset a CCW loop. An empty result means the outline collapsed. */
export function insetPolygon(loop: FaceVec2[], distance: number, edgeInset: EdgeInset | null = null): FaceVec2[] {
  if (!edgeInset && distance <= 0.001) return loop;
  if (loop.length < 3) return [];
  const lines: OffsetLine[] = [];
  for (let index = 0; index < loop.length; index += 1) {
    const start = loop[index];
    const end = loop[(index + 1) % loop.length];
    const line = offsetEdge(start, end, edgeInset?.(start, end) ?? distance);
    if (!line) return [];
    lines.push(line);
  }
  const next: FaceVec2[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const hit = lineIntersect(lines[(index - 1 + lines.length) % lines.length], lines[index]);
    if (!hit) return [];
    next.push(hit);
  }
  if (signedArea2(next) <= 1e-4) return [];
  for (let index = 0; index < next.length; index += 1) {
    const original = norm2(sub2(loop[(index + 1) % loop.length], loop[index]));
    const moved = norm2(sub2(next[(index + 1) % next.length], next[index]));
    if (dot2(original, moved) < 0.2) return [];
  }
  return next;
}

function cornerTurn(previous: FaceVec2, current: FaceVec2, next: FaceVec2) {
  const inbound = norm2(sub2(current, previous));
  const outbound = norm2(sub2(next, current));
  const cross = inbound.x * outbound.z - inbound.z * outbound.x;
  const turn = Math.atan2(cross, dot2(inbound, outbound));
  return { inbound, outbound, turn, absTurn: Math.abs(turn) };
}

/** Largest circular radius that still fits every sharp corner of a CCW loop. */
export function maxCornerRadius(loop: FaceVec2[]): number {
  if (loop.length < 3) return 0;
  let limit = Infinity;
  for (let index = 0; index < loop.length; index += 1) {
    const previous = loop[(index - 1 + loop.length) % loop.length];
    const current = loop[index];
    const next = loop[(index + 1) % loop.length];
    const { absTurn } = cornerTurn(previous, current, next);
    if (absTurn < 0.08) continue;
    const tanHalf = Math.tan(absTurn / 2);
    if (tanHalf < 1e-4) continue;
    const room = Math.min(len2(sub2(current, previous)), len2(sub2(next, current))) * 0.5;
    limit = Math.min(limit, room / tanHalf);
  }
  return Number.isFinite(limit) ? Math.max(0, limit) : 0;
}

/**
 * Round every sharp corner with a circular arc of the given radius.
 * A convex corner that cannot hold the full radius uses the largest arc that fits.
 * A notch narrower than twice the radius is left out.
 * Small turns (a sampled curve) stay as they are.
 */
export function roundPolygonCorners(loop: FaceVec2[], radius: number, steps = 0): FaceVec2[] {
  if (radius <= 0.01 || loop.length < 3) return loop;
  const out: FaceVec2[] = [];
  for (let index = 0; index < loop.length; index += 1) {
    const previous = loop[(index - 1 + loop.length) % loop.length];
    const current = loop[index];
    const next = loop[(index + 1) % loop.length];
    const { inbound, outbound, turn, absTurn } = cornerTurn(previous, current, next);
    if (absTurn < 0.08) {
      out.push(current);
      continue;
    }
    const tanHalf = Math.tan(absTurn / 2);
    const room = Math.min(len2(sub2(current, previous)), len2(sub2(next, current))) * 0.5;
    if (!(tanHalf > 1e-4) || !(room > 0.05)) {
      out.push(current);
      continue;
    }
    let used = radius;
    let trim = used * tanHalf;
    if (trim > room + 1e-4) {
      // A concave notch narrower than the radius closes. A convex corner keeps the largest arc that fits.
      if (turn < 0) continue;
      used = room / tanHalf;
      trim = room;
    }
    if (used < 0.05) {
      out.push(current);
      continue;
    }
    const arcSteps = steps > 0 ? steps : Math.max(6, Math.ceil(absTurn / (Math.PI / 18)));
    const start = sub2(current, mul2(inbound, trim));
    const end = add2(current, mul2(outbound, trim));
    const sign = turn > 0 ? 1 : -1;
    const center = add2(start, mul2(left2(inbound), sign * used));
    out.push(start);
    const startAngle = Math.atan2(start.z - center.z, start.x - center.x);
    const endAngle = Math.atan2(end.z - center.z, end.x - center.x);
    let sweep = endAngle - startAngle;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    if (Math.abs(Math.abs(sweep) - absTurn) > 0.35) {
      sweep = sweep > 0 ? sweep - Math.PI * 2 : sweep + Math.PI * 2;
    }
    for (let step = 1; step < arcSteps; step += 1) {
      const angle = startAngle + sweep * (step / arcSteps);
      out.push({
        x: center.x + Math.cos(angle) * used,
        z: center.z + Math.sin(angle) * used,
      });
    }
    out.push(end);
  }
  const cleaned = dedupeLoop(out);
  return cleaned.length >= 3 && signedArea2(cleaned) > 1e-4 ? cleaned : [];
}

export function faceOutlineFromLoop(
  loop: FaceVec2[],
  inset: number,
  cornerRadius: number,
  edgeInset: EdgeInset | null = null,
): FaceVec2[] {
  const simplified = simplifyColinear(ensureCcw(loop));
  const insetLoop = insetPolygon(simplified, Math.max(0, inset), edgeInset);
  if (insetLoop.length < 3) return [];
  return roundPolygonCorners(insetLoop, Math.max(0, cornerRadius));
}

function normalize3(value: FaceVec3): FaceVec3 {
  const length = Math.hypot(value.x, value.y, value.z);
  if (length < 1e-12) return { x: 0, y: 1, z: 0 };
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function cross3(a: FaceVec3, b: FaceVec3): FaceVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function faceAxes(normal: FaceVec3) {
  const n = normalize3(normal);
  const hint = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = normalize3(cross3(hint, n));
  const v = cross3(n, u);
  return { n, u, v };
}

export function projectFacePoints(points: number[], origin: FaceVec3, u: FaceVec3, v: FaceVec3): FaceVec2[] {
  const loop: FaceVec2[] = [];
  for (let index = 0; index + 2 < points.length; index += 3) {
    const dx = points[index] - origin.x;
    const dy = points[index + 1] - origin.y;
    const dz = points[index + 2] - origin.z;
    loop.push({
      x: dx * u.x + dy * u.y + dz * u.z,
      z: dx * v.x + dy * v.y + dz * v.z,
    });
  }
  if (loop.length > 1) {
    const first = loop[0];
    const last = loop[loop.length - 1];
    if (Math.hypot(first.x - last.x, first.z - last.z) < 0.05) loop.pop();
  }
  return loop;
}

/** Largest corner radius the face can hold after the inset, in millimetres. */
export function faceCornerRadiusLimit(points: number[], origin: FaceVec3, normal: FaceVec3, inset = 0) {
  const axes = faceAxes(normal);
  const raw = simplifyColinear(ensureCcw(projectFacePoints(points, origin, axes.u, axes.v)));
  const loop = inset > 0.001 ? insetPolygon(raw, inset) : raw;
  if (loop.length < 3) return 0;
  const limit = maxCornerRadius(loop);
  return Math.floor((limit + 1e-6) * 100) / 100;
}

export function faceInsetLimit(points: number[], origin: FaceVec3, normal: FaceVec3) {
  const axes = faceAxes(normal);
  const loop = projectFacePoints(points, origin, axes.u, axes.v);
  if (loop.length < 3) return 20;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of loop) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return Math.max(0.2, Math.min(maxX - minX, maxZ - minZ) / 2);
}
