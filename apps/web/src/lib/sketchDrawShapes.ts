import { createLocalId } from "@/lib/localIds";
import { orderedSketchPaths, sampledPathOutline } from "@/lib/sketch/profiles";
import type { SketchPoint, SketchProfile, SketchSegment } from "@/types/sketchforge";

const CIRCLE_KAPPA = 0.5522847498307936;

function closedLineRing(points: Array<{ x: number; z: number }>): Pick<SketchProfile, "points" | "segments"> {
  const ids = points.map(() => createLocalId("sketch-point"));
  const sketchPoints: SketchPoint[] = points.map((point, index) => ({
    id: ids[index],
    x: point.x,
    z: point.z,
    mode: "corner",
  }));
  const segments: SketchSegment[] = ids.map((startId, index) => ({
    id: createLocalId("sketch-segment"),
    startId,
    endId: ids[(index + 1) % ids.length],
    kind: "line",
  }));
  return { points: sketchPoints, segments };
}

/** Approximate a circle with four cubic beziers. */
export function circleSketchGeometry(center: { x: number; z: number }, radius: number): Pick<SketchProfile, "points" | "segments"> {
  const k = radius * CIRCLE_KAPPA;
  const rightId = createLocalId("sketch-point");
  const bottomId = createLocalId("sketch-point");
  const leftId = createLocalId("sketch-point");
  const topId = createLocalId("sketch-point");
  const points: SketchPoint[] = [
    {
      id: rightId,
      x: center.x + radius,
      z: center.z,
      mode: "smooth",
      handleIn: { x: center.x + radius, z: center.z - k },
      handleOut: { x: center.x + radius, z: center.z + k },
    },
    {
      id: bottomId,
      x: center.x,
      z: center.z + radius,
      mode: "smooth",
      handleIn: { x: center.x + k, z: center.z + radius },
      handleOut: { x: center.x - k, z: center.z + radius },
    },
    {
      id: leftId,
      x: center.x - radius,
      z: center.z,
      mode: "smooth",
      handleIn: { x: center.x - radius, z: center.z + k },
      handleOut: { x: center.x - radius, z: center.z - k },
    },
    {
      id: topId,
      x: center.x,
      z: center.z - radius,
      mode: "smooth",
      handleIn: { x: center.x - k, z: center.z - radius },
      handleOut: { x: center.x + k, z: center.z - radius },
    },
  ];
  const ring = [rightId, bottomId, leftId, topId];
  const segments: SketchSegment[] = ring.map((startId, index) => ({
    id: createLocalId("sketch-segment"),
    startId,
    endId: ring[(index + 1) % ring.length],
    kind: "bezier",
  }));
  return { points, segments };
}

/** Axis-aligned square from first corner toward opposite corner (equal sides). */
export function squareSketchGeometry(origin: { x: number; z: number }, corner: { x: number; z: number }): Pick<SketchProfile, "points" | "segments"> | null {
  const dx = corner.x - origin.x;
  const dz = corner.z - origin.z;
  const side = Math.max(Math.abs(dx), Math.abs(dz));
  if (side < 0.25) return null;
  const sx = Math.sign(dx) || 1;
  const sz = Math.sign(dz) || 1;
  return closedLineRing([
    { x: origin.x, z: origin.z },
    { x: origin.x + sx * side, z: origin.z },
    { x: origin.x + sx * side, z: origin.z + sz * side },
    { x: origin.x, z: origin.z + sz * side },
  ]);
}

/** Regular polygon (triangle when sides === 3). First vertex toward `vertex`. */
export function regularPolygonSketchGeometry(
  center: { x: number; z: number },
  vertex: { x: number; z: number },
  sides: number,
): Pick<SketchProfile, "points" | "segments"> | null {
  const count = Math.max(3, Math.min(64, Math.round(sides)));
  const radius = Math.hypot(vertex.x - center.x, vertex.z - center.z);
  if (radius < 0.25) return null;
  const startAngle = Math.atan2(vertex.z - center.z, vertex.x - center.x);
  const points = Array.from({ length: count }, (_, index) => {
    const angle = startAngle + (index * 2 * Math.PI) / count;
    return {
      x: center.x + Math.cos(angle) * radius,
      z: center.z + Math.sin(angle) * radius,
    };
  });
  return closedLineRing(points);
}

function circleFromThreePoints(
  a: { x: number; z: number },
  b: { x: number; z: number },
  c: { x: number; z: number },
): { center: { x: number; z: number }; radius: number } | null {
  const d = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
  if (Math.abs(d) < 1e-8) return null;
  const aSq = a.x * a.x + a.z * a.z;
  const bSq = b.x * b.x + b.z * b.z;
  const cSq = c.x * c.x + c.z * c.z;
  const center = {
    x: (aSq * (b.z - c.z) + bSq * (c.z - a.z) + cSq * (a.z - b.z)) / d,
    z: (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d,
  };
  const radius = Math.hypot(a.x - center.x, a.z - center.z);
  if (radius < 0.25) return null;
  return { center, radius };
}

function normalizeAngle(angle: number) {
  let value = angle;
  while (value <= -Math.PI) value += Math.PI * 2;
  while (value > Math.PI) value -= Math.PI * 2;
  return value;
}

/** Circular arc through three points, as cubic bezier spans (open path). */
export function arcSketchGeometry(
  start: { x: number; z: number },
  end: { x: number; z: number },
  through: { x: number; z: number },
): Pick<SketchProfile, "points" | "segments"> | null {
  const fitted = circleFromThreePoints(start, through, end);
  if (!fitted) return null;
  const { center, radius } = fitted;
  let startAngle = Math.atan2(start.z - center.z, start.x - center.x);
  let throughAngle = Math.atan2(through.z - center.z, through.x - center.x);
  let endAngle = Math.atan2(end.z - center.z, end.x - center.x);

  let sweep = normalizeAngle(endAngle - startAngle);
  const throughDelta = normalizeAngle(throughAngle - startAngle);
  // Pick the sweep direction that contains the through point.
  if (sweep >= 0 && (throughDelta < 0 || throughDelta > sweep)) {
    sweep -= Math.PI * 2;
  } else if (sweep < 0 && (throughDelta > 0 || throughDelta < sweep)) {
    sweep += Math.PI * 2;
  }
  if (Math.abs(sweep) < 0.05) return null;

  const quarter = Math.PI / 2;
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / quarter));
  const stepSweep = sweep / steps;
  const points: SketchPoint[] = [];
  const segments: SketchSegment[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const angle = startAngle + stepSweep * index;
    const id = createLocalId("sketch-point");
    const alpha = (4 / 3) * Math.tan(stepSweep / 4);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Tangent direction for increasing angle: (-sin, cos)
    const tx = -sin;
    const tz = cos;
    const handleScale = radius * alpha;
    const point: SketchPoint = {
      id,
      x: center.x + cos * radius,
      z: center.z + sin * radius,
      mode: "smooth",
    };
    if (index > 0) {
      point.handleIn = {
        x: point.x - tx * handleScale,
        z: point.z - tz * handleScale,
      };
    }
    if (index < steps) {
      point.handleOut = {
        x: point.x + tx * handleScale,
        z: point.z + tz * handleScale,
      };
    }
    points.push(point);
    if (index > 0) {
      segments.push({
        id: createLocalId("sketch-segment"),
        startId: points[index - 1].id,
        endId: id,
        kind: "bezier",
      });
    }
  }

  // Pin exact endpoints
  points[0].x = start.x;
  points[0].z = start.z;
  points[points.length - 1].x = end.x;
  points[points.length - 1].z = end.z;
  return { points, segments };
}

/** Parallel copy of a straight segment offset toward `toward`. */
export function offsetLineSketchGeometry(
  start: { x: number; z: number },
  end: { x: number; z: number },
  toward: { x: number; z: number },
): Pick<SketchProfile, "points" | "segments"> | null {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.25) return null;
  const nx = -dz / length;
  const nz = dx / length;
  const mid = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
  const side = (toward.x - mid.x) * nx + (toward.z - mid.z) * nz;
  const distance = Math.abs(side);
  if (distance < 0.05) return null;
  const ox = nx * Math.sign(side || 1) * distance;
  const oz = nz * Math.sign(side || 1) * distance;
  const aId = createLocalId("sketch-point");
  const bId = createLocalId("sketch-point");
  return {
    points: [
      { id: aId, x: start.x + ox, z: start.z + oz, mode: "corner" },
      { id: bId, x: end.x + ox, z: end.z + oz, mode: "corner" },
    ],
    segments: [{ id: createLocalId("sketch-segment"), startId: aId, endId: bId, kind: "line" }],
  };
}

export type SketchOffsetHit = {
  geometry: Pick<SketchProfile, "points" | "segments">;
  closed: boolean;
  distance: number;
  preview: Array<{ x: number; z: number }>;
};

/** Drag an edge. A closed outline copies the whole outline. A lone line copies that line. */
export function sketchOffsetAt(
  profile: Pick<SketchProfile, "points" | "segments">,
  segmentId: string,
  toward: { x: number; z: number },
): SketchOffsetHit | "curve" | null {
  const path = sketchPathForSegment(profile, segmentId);
  if (path && pathHasCurve(path)) {
    const distance = dragDistanceForPath(path, segmentId, toward);
    if (distance === null) return null;
    return offsetSketchPath(path, distance);
  }
  const segment = profile.segments.find((entry) => entry.id === segmentId);
  const start = segment ? profile.points.find((point) => point.id === segment.startId) : null;
  const end = segment ? profile.points.find((point) => point.id === segment.endId) : null;
  if (!segment || !start || !end) return null;
  const ring = straightClosedRing(profile, segmentId);
  if (ring) {
    const distance = outwardDistance(start, end, toward, ring);
    if (distance === null) return null;
    const moved = offsetClosedRing(ring, distance);
    if (!moved) return null;
    return {
      geometry: closedLineRing(moved),
      closed: true,
      distance: Math.abs(distance),
      preview: moved,
    };
  }
  const line = offsetLineSketchGeometry(start, end, toward);
  if (!line) return null;
  return {
    geometry: line,
    closed: false,
    distance: Math.hypot(line.points[0].x - start.x, line.points[0].z - start.z),
    preview: line.points.map((point) => ({ x: point.x, z: point.z })),
  };
}

function closedStraightPaths(profile: Pick<SketchProfile, "points" | "segments">) {
  return orderedSketchPaths(profile as SketchProfile).filter(
    (path) => path.closed
      && path.points.length >= 3
      && path.steps.every((step) => !step.segment.kind || step.segment.kind === "line"),
  );
}

function ringFromPath(path: { points: Array<{ x: number; z: number }> }) {
  const points = path.points.map((point) => ({ x: point.x, z: point.z }));
  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && Math.hypot(first.x - last.x, first.z - last.z) < 1e-6) points.pop();
  return points.length >= 3 ? points : null;
}

/** The closed straight outline that owns these sketch points, if it is one loop. */
export function straightRingForPointIds(
  profile: Pick<SketchProfile, "points" | "segments">,
  pointIds: readonly string[],
): Array<{ x: number; z: number }> | null {
  if (pointIds.length < 3) return null;
  const wanted = new Set(pointIds);
  const path = closedStraightPaths(profile).find((entry) => entry.points.every((point) => wanted.has(point.id)));
  return path ? ringFromPath(path) : null;
}

/** The one closed straight outline that contains every selected segment. */
export function straightRingForSegments(
  profile: Pick<SketchProfile, "points" | "segments">,
  segmentIds: readonly string[],
): Array<{ x: number; z: number }> | null {
  if (!segmentIds.length) return null;
  const wanted = new Set(segmentIds);
  const hits = closedStraightPaths(profile).filter((path) => path.steps.some((step) => wanted.has(step.segment.id)));
  if (hits.length !== 1) return null;
  if (!segmentIds.every((id) => hits[0].steps.some((step) => step.segment.id === id))) return null;
  return ringFromPath(hits[0]);
}

/**
 * Offset target for the command: the selected closed outline, else the selected
 * segments' outline, else the only closed outline in the sketch.
 */
export function offsetRingForCommand(
  profile: Pick<SketchProfile, "points" | "segments">,
  selectedPointIdLists: readonly (readonly string[])[],
  segmentIds: readonly string[],
): Array<{ x: number; z: number }> | null {
  for (const pointIds of selectedPointIdLists) {
    const ring = straightRingForPointIds(profile, pointIds);
    if (ring) return ring;
  }
  return straightRingForSegments(profile, segmentIds) ?? onlyClosedStraightRing(profile);
}

/** The outline to offset when the sketch has exactly one closed straight shape. */
export function onlyClosedStraightRing(
  profile: Pick<SketchProfile, "points" | "segments">,
): Array<{ x: number; z: number }> | null {
  const paths = closedStraightPaths(profile);
  if (paths.length !== 1) return null;
  return ringFromPath(paths[0]);
}

export function sameOffsetRing(
  left: Array<{ x: number; z: number }> | null,
  right: Array<{ x: number; z: number }>,
) {
  if (!left || left.length !== right.length) return false;
  return left.every((point, index) => Math.hypot(point.x - right[index].x, point.z - right[index].z) < 1e-4);
}

/** The outline Offset is aimed at. Segment ids keep circles and corner arcs exact. */
export type OffsetTarget = {
  segmentIds: string[];
  closed: boolean;
};

function asSketchProfile(profile: Pick<SketchProfile, "points" | "segments">): SketchProfile {
  return profile as SketchProfile;
}

function sketchPathForSegment(
  profile: Pick<SketchProfile, "points" | "segments">,
  segmentId: string,
) {
  return orderedSketchPaths(asSketchProfile(profile)).find((path) => path.steps.some((step) => step.segment.id === segmentId)) ?? null;
}

function pathHasCurve(path: { steps: Array<{ segment: SketchSegment }> }) {
  return path.steps.some((step) => step.segment.kind === "bezier" || step.segment.kind === "smooth");
}

function targetFromPath(path: { steps: Array<{ segment: SketchSegment }>; closed: boolean }): OffsetTarget {
  return { segmentIds: path.steps.map((step) => step.segment.id), closed: path.closed };
}

export function sameOffsetTarget(left: OffsetTarget | null, right: OffsetTarget | null) {
  if (!left || !right || left.segmentIds.length !== right.segmentIds.length) return false;
  return left.segmentIds.every((id, index) => id === right.segmentIds[index]);
}

export function offsetTargetForPointIds(
  profile: Pick<SketchProfile, "points" | "segments">,
  pointIds: readonly string[],
): OffsetTarget | null {
  if (pointIds.length < 3) return null;
  const wanted = new Set(pointIds);
  const path = orderedSketchPaths(asSketchProfile(profile)).find(
    (entry) => entry.closed && entry.points.length >= 3 && entry.points.every((point) => wanted.has(point.id)),
  );
  return path ? targetFromPath(path) : null;
}

export function offsetTargetForSegments(
  profile: Pick<SketchProfile, "points" | "segments">,
  segmentIds: readonly string[],
): OffsetTarget | null {
  if (!segmentIds.length) return null;
  const path = sketchPathForSegment(profile, segmentIds[0]);
  if (!path) return null;
  if (!path.closed && !pathHasCurve(path)) return null;
  if (!segmentIds.every((id) => path.steps.some((step) => step.segment.id === id))) return null;
  return targetFromPath(path);
}

/** Selected outline, else the only closed outline. A lone open curve is included when nothing else is closed. */
export function offsetTargetForCommand(
  profile: Pick<SketchProfile, "points" | "segments">,
  selectedPointIdLists: readonly (readonly string[])[],
  segmentIds: readonly string[],
): OffsetTarget | null {
  for (const pointIds of selectedPointIdLists) {
    const target = offsetTargetForPointIds(profile, pointIds);
    if (target) return target;
  }
  if (segmentIds.length) {
    const target = offsetTargetForSegments(profile, segmentIds);
    if (target) return target;
  }
  const paths = orderedSketchPaths(asSketchProfile(profile));
  const closed = paths.filter((path) => path.closed && path.points.length >= 3);
  if (closed.length === 1) return targetFromPath(closed[0]);
  const openCurves = paths.filter((path) => !path.closed && pathHasCurve(path));
  if (closed.length === 0 && openCurves.length === 1) return targetFromPath(openCurves[0]);
  return null;
}

function cubicPoint(p0: { x: number; z: number }, p1: { x: number; z: number }, p2: { x: number; z: number }, p3: { x: number; z: number }, t: number) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    z: u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z,
  };
}

function stepControls(step: { segment: SketchSegment; from: SketchPoint; to: SketchPoint }) {
  const forward = step.segment.startId === step.from.id;
  const p0 = { x: step.from.x, z: step.from.z };
  const p3 = { x: step.to.x, z: step.to.z };
  const c1 = forward ? (step.from.handleOut ?? p0) : (step.from.handleIn ?? p0);
  const c2 = forward ? (step.to.handleIn ?? p3) : (step.to.handleOut ?? p3);
  return { p0, p1: c1, p2: c2, p3 };
}

function pathIsCcw(path: { steps: Array<{ segment: SketchSegment; from: SketchPoint; to: SketchPoint }> }) {
  const samples: Array<{ x: number; z: number }> = [];
  for (const step of path.steps) {
    if (!step.segment.kind || step.segment.kind === "line") {
      samples.push({ x: step.from.x, z: step.from.z });
      continue;
    }
    const { p0, p1, p2, p3 } = stepControls(step);
    for (let index = 0; index < 6; index += 1) samples.push(cubicPoint(p0, p1, p2, p3, index / 6));
  }
  return ringIsCcw(samples);
}

type CircularArc = {
  center: { x: number; z: number };
  radius: number;
  startAngle: number;
  sweep: number;
};

function circularArcOf(step: { segment: SketchSegment; from: SketchPoint; to: SketchPoint }): CircularArc | null {
  if (step.segment.kind !== "bezier" && step.segment.kind !== "smooth") return null;
  const { p0, p1, p2, p3 } = stepControls(step);
  const mid = cubicPoint(p0, p1, p2, p3, 0.5);
  const fitted = circleFromThreePoints(p0, mid, p3);
  if (!fitted) return null;
  const tolerance = 0.002 * fitted.radius + 0.05;
  for (const t of [0.25, 0.75]) {
    const sample = cubicPoint(p0, p1, p2, p3, t);
    if (Math.abs(Math.hypot(sample.x - fitted.center.x, sample.z - fitted.center.z) - fitted.radius) > tolerance) return null;
  }
  let startAngle = Math.atan2(p0.z - fitted.center.z, p0.x - fitted.center.x);
  let endAngle = Math.atan2(p3.z - fitted.center.z, p3.x - fitted.center.x);
  let sweep = normalizeAngle(endAngle - startAngle);
  const throughDelta = normalizeAngle(Math.atan2(mid.z - fitted.center.z, mid.x - fitted.center.x) - startAngle);
  if (sweep >= 0 && (throughDelta < 0 || throughDelta > sweep)) sweep -= Math.PI * 2;
  else if (sweep < 0 && (throughDelta > 0 || throughDelta < sweep)) sweep += Math.PI * 2;
  if (Math.abs(sweep) < 0.05) return null;
  return { center: fitted.center, radius: fitted.radius, startAngle, sweep };
}

function closedCircle(path: { steps: Array<{ segment: SketchSegment; from: SketchPoint; to: SketchPoint }>; closed: boolean; points: SketchPoint[] }) {
  if (!path.closed || path.steps.length < 3) return null;
  if (path.steps.some((step) => !circularArcOf(step))) return null;
  const first = circularArcOf(path.steps[0]);
  if (!first) return null;
  const arcs = path.steps.map((step) => circularArcOf(step)!);
  if (arcs.some((arc) => Math.hypot(arc.center.x - first.center.x, arc.center.z - first.center.z) > 0.15)) return null;
  if (arcs.some((arc) => Math.abs(arc.radius - first.radius) > 0.15)) return null;
  const sweep = arcs.reduce((total, arc) => total + Math.abs(arc.sweep), 0);
  if (sweep < Math.PI * 1.7) return null;
  return first;
}

function closedEllipse(path: { steps: Array<{ segment: SketchSegment; from: SketchPoint; to: SketchPoint }>; closed: boolean; points: SketchPoint[] }) {
  if (!path.closed || path.points.length !== 4 || path.steps.length !== 4) return null;
  if (path.steps.some((step) => step.segment.kind !== "bezier" && step.segment.kind !== "smooth")) return null;
  const xs = path.points.map((point) => point.x);
  const zs = path.points.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const rx = (maxX - minX) / 2;
  const ry = (maxZ - minZ) / 2;
  if (rx < 0.25 || ry < 0.25) return null;
  if (Math.abs(rx - ry) < 0.2) return null;
  const extremes = [
    { x: cx + rx, z: cz },
    { x: cx - rx, z: cz },
    { x: cx, z: cz + ry },
    { x: cx, z: cz - ry },
  ];
  const matched = extremes.every((extreme) => path.points.some((point) => Math.hypot(point.x - extreme.x, point.z - extreme.z) < 0.2));
  return matched ? { cx, cz, rx, ry } : null;
}

function previewRing(points: Array<{ x: number; z: number }>) {
  return points.length >= 2 ? points : null;
}

function circlePreview(center: { x: number; z: number }, radius: number) {
  return Array.from({ length: 48 }, (_, index) => {
    const angle = (index / 48) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius };
  });
}

function geometryPreview(geometry: Pick<SketchProfile, "points" | "segments">) {
  const byId = new Map(geometry.points.map((point) => [point.id, point]));
  const samples: Array<{ x: number; z: number }> = [];
  for (const segment of geometry.segments) {
    const start = byId.get(segment.startId);
    const end = byId.get(segment.endId);
    if (!start || !end) continue;
    if (!segment.kind || segment.kind === "line") {
      samples.push({ x: start.x, z: start.z });
      continue;
    }
    const p0 = { x: start.x, z: start.z };
    const p3 = { x: end.x, z: end.z };
    const p1 = start.handleOut ?? p0;
    const p2 = end.handleIn ?? p3;
    for (let index = 0; index < 8; index += 1) samples.push(cubicPoint(p0, p1, p2, p3, index / 8));
  }
  return samples;
}

type OffsetPiece = {
  start: { x: number; z: number };
  end: { x: number; z: number };
  kind: "line" | "arc" | "curve";
  through?: { x: number; z: number };
  c1?: { x: number; z: number };
  c2?: { x: number; z: number };
  mode?: SketchPoint["mode"];
};

function offsetSketchPath(
  path: { steps: Array<{ segment: SketchSegment; from: SketchPoint; to: SketchPoint }>; closed: boolean; points: SketchPoint[] },
  signedDistance: number,
): SketchOffsetHit | null {
  if (!(Math.abs(signedDistance) > 1e-6)) return null;
  if (path.closed && path.steps.every((step) => !step.segment.kind || step.segment.kind === "line")) {
    const ring = ringFromPath(path);
    if (!ring) return null;
    const straight = offsetStraightRing(ring, signedDistance);
    return straight ? { ...straight, geometry: closedLineRing(straight.preview) } : null;
  }
  const circle = closedCircle(path);
  if (circle) {
    const radius = circle.radius + signedDistance;
    if (radius < 0.25) return null;
    const geometry = circleSketchGeometry(circle.center, radius);
    const preview = circlePreview(circle.center, radius);
    return { geometry, closed: true, distance: Math.abs(signedDistance), preview };
  }
  const ellipse = closedEllipse(path);
  if (ellipse) {
    const rx = ellipse.rx + signedDistance;
    const ry = ellipse.ry + signedDistance;
    if (rx < 0.25 || ry < 0.25) return null;
    const geometry = ellipseSketchGeometry(
      { x: ellipse.cx - rx, z: ellipse.cz - ry },
      { x: ellipse.cx + rx, z: ellipse.cz + ry },
    );
    if (!geometry) return null;
    return { geometry, closed: true, distance: Math.abs(signedDistance), preview: geometryPreview(geometry) };
  }
  return offsetMixedPath(path, signedDistance);
}

function offsetMixedPath(
  path: { steps: Array<{ segment: SketchSegment; from: SketchPoint; to: SketchPoint }>; closed: boolean },
  signedDistance: number,
): SketchOffsetHit | null {
  const ccw = path.closed ? pathIsCcw(path) : true;
  const pieces: OffsetPiece[] = [];
  for (const step of path.steps) {
    if (!step.segment.kind || step.segment.kind === "line") {
      const normal = outwardEdgeNormal(step.from, step.to, ccw);
      pieces.push({
        kind: "line",
        start: { x: step.from.x + normal.x * signedDistance, z: step.from.z + normal.z * signedDistance },
        end: { x: step.to.x + normal.x * signedDistance, z: step.to.z + normal.z * signedDistance },
      });
      continue;
    }
    const arc = circularArcOf(step);
    if (arc) {
      const { p0, p1, p2, p3 } = stepControls(step);
      const mid = cubicPoint(p0, p1, p2, p3, 0.5);
      const ahead = cubicPoint(p0, p1, p2, p3, 0.62);
      const normal = outwardEdgeNormal(mid, ahead, ccw);
      const radialX = mid.x - arc.center.x;
      const radialZ = mid.z - arc.center.z;
      const radialLen = Math.hypot(radialX, radialZ) || 1;
      const grow = path.closed && (radialX / radialLen) * normal.x + (radialZ / radialLen) * normal.z < 0 ? -1 : 1;
      const radius = arc.radius + signedDistance * grow;
      if (radius < 0.25) return null;
      const startAngle = Math.atan2(p0.z - arc.center.z, p0.x - arc.center.x);
      const endAngle = startAngle + arc.sweep;
      const midAngle = startAngle + arc.sweep / 2;
      const at = (angle: number) => ({
        x: arc.center.x + Math.cos(angle) * radius,
        z: arc.center.z + Math.sin(angle) * radius,
      });
      pieces.push({ kind: "arc", start: at(startAngle), end: at(endAngle), through: at(midAngle) });
      continue;
    }
    const { p0, p1, p2, p3 } = stepControls(step);
    const startAhead = cubicPoint(p0, p1, p2, p3, 0.08);
    const endBehind = cubicPoint(p0, p1, p2, p3, 0.92);
    const endPoint = cubicPoint(p0, p1, p2, p3, 1);
    const n0 = outwardEdgeNormal(p0, startAhead, ccw);
    const n3 = outwardEdgeNormal(endBehind, endPoint, ccw);
    pieces.push({
      kind: "curve",
      start: { x: p0.x + n0.x * signedDistance, z: p0.z + n0.z * signedDistance },
      end: { x: p3.x + n3.x * signedDistance, z: p3.z + n3.z * signedDistance },
      c1: { x: p1.x + n0.x * signedDistance, z: p1.z + n0.z * signedDistance },
      c2: { x: p2.x + n3.x * signedDistance, z: p2.z + n3.z * signedDistance },
      mode: "smooth",
    });
  }
  if (!pieces.length) return null;
  const count = pieces.length;
  const last = path.closed ? count : count - 1;
  for (let index = 0; index < last; index += 1) {
    const current = pieces[index];
    const next = pieces[(index + 1) % count];
    if (current.kind === "line" && next.kind === "line") {
      const hit = offsetLineIntersection(current.start, current.end, next.start, next.end);
      if (hit) {
        current.end = hit;
        next.start = hit;
      }
      continue;
    }
    const join = {
      x: (current.end.x + next.start.x) / 2,
      z: (current.end.z + next.start.z) / 2,
    };
    current.end = join;
    next.start = join;
  }
  const geometry = piecesToGeometry(pieces, path.closed);
  const preview = previewRing(geometryPreview(geometry));
  if (!preview) return null;
  return { geometry, closed: path.closed, distance: Math.abs(signedDistance), preview };
}

function offsetLineIntersection(
  a0: { x: number; z: number },
  a1: { x: number; z: number },
  b0: { x: number; z: number },
  b1: { x: number; z: number },
) {
  const dxa = a1.x - a0.x;
  const dza = a1.z - a0.z;
  const dxb = b1.x - b0.x;
  const dzb = b1.z - b0.z;
  const denom = dxa * dzb - dza * dxb;
  if (Math.abs(denom) < 1e-8) return null;
  const t = ((b0.x - a0.x) * dzb - (b0.z - a0.z) * dxb) / denom;
  return { x: a0.x + dxa * t, z: a0.z + dza * t };
}

function piecesToGeometry(pieces: OffsetPiece[], closed: boolean): Pick<SketchProfile, "points" | "segments"> {
  const points: SketchPoint[] = [];
  const segments: SketchSegment[] = [];
  const makePoint = (at: { x: number; z: number }, mode: SketchPoint["mode"]) => {
    const point: SketchPoint = { id: createLocalId("sketch-point"), x: at.x, z: at.z, mode };
    points.push(point);
    return point;
  };
  const link = (start: SketchPoint, end: SketchPoint, kind: SketchSegment["kind"]) => {
    segments.push({ id: createLocalId("sketch-segment"), startId: start.id, endId: end.id, kind });
  };
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index];
    const closing = closed && index === pieces.length - 1;
    const start = index === 0
      ? makePoint(piece.start, piece.kind === "line" ? "corner" : "smooth")
      : points[points.length - 1];
    start.x = piece.start.x;
    start.z = piece.start.z;
    if (piece.kind === "arc" && piece.through) {
      const arc = arcSketchGeometry({ x: start.x, z: start.z }, piece.end, piece.through);
      if (arc && arc.points.length >= 2) {
        start.handleOut = arc.points[0].handleOut;
        start.mode = "smooth";
        let cursor = start;
        for (let step = 1; step < arc.points.length; step += 1) {
          const source = arc.points[step];
          const atEnd = step === arc.points.length - 1;
          const point = atEnd && closing
            ? points[0]
            : atEnd
              ? makePoint(piece.end, "smooth")
              : makePoint(source, "smooth");
          point.x = atEnd ? piece.end.x : source.x;
          point.z = atEnd ? piece.end.z : source.z;
          point.handleIn = source.handleIn;
          point.mode = "smooth";
          if (!atEnd) point.handleOut = source.handleOut;
          link(cursor, point, "bezier");
          cursor = point;
        }
        continue;
      }
    }
    const end = closing ? points[0] : makePoint(piece.end, piece.kind === "line" ? "corner" : "smooth");
    end.x = piece.end.x;
    end.z = piece.end.z;
    if (piece.kind === "curve" && piece.c1 && piece.c2) {
      start.handleOut = piece.c1;
      end.handleIn = piece.c2;
      start.mode = "smooth";
      end.mode = "smooth";
    }
    link(start, end, piece.kind === "line" ? "line" : "bezier");
  }
  return { points, segments };
}

function dragDistanceForPath(
  path: { steps: Array<{ segment: SketchSegment; from: SketchPoint; to: SketchPoint }>; closed: boolean; points: SketchPoint[] },
  segmentId: string,
  toward: { x: number; z: number },
) {
  const circle = closedCircle(path);
  if (circle) {
    const distance = Math.hypot(toward.x - circle.center.x, toward.z - circle.center.z) - circle.radius;
    return Math.abs(distance) < 0.05 ? null : distance;
  }
  const step = path.steps.find((entry) => entry.segment.id === segmentId);
  if (!step) return null;
  const arc = circularArcOf(step);
  if (arc) {
    const distance = Math.hypot(toward.x - arc.center.x, toward.z - arc.center.z) - arc.radius;
    return Math.abs(distance) < 0.05 ? null : distance;
  }
  if (!path.closed) return null;
  const samples = path.steps.map((entry) => ({ x: entry.from.x, z: entry.from.z }));
  return outwardDistance(step.from, step.to, toward, samples);
}

export function offsetTargetHit(
  profile: Pick<SketchProfile, "points" | "segments">,
  target: OffsetTarget,
  signedDistance: number,
): SketchOffsetHit | null {
  const path = sketchPathForSegment(profile, target.segmentIds[0] ?? "");
  if (!path) return null;
  if (!target.segmentIds.every((id) => path.steps.some((step) => step.segment.id === id))) return null;
  return offsetSketchPath(path, signedDistance);
}

/** Positive distance grows the outline. Negative distance shrinks it. */
export function offsetStraightRing(
  points: Array<{ x: number; z: number }>,
  signedDistance: number,
): SketchOffsetHit | null {
  const moved = offsetClosedRing(points, signedDistance);
  if (!moved) return null;
  return {
    geometry: closedLineRing(moved),
    closed: true,
    distance: Math.abs(signedDistance),
    preview: moved,
  };
}

function straightClosedRing(
  profile: Pick<SketchProfile, "points" | "segments">,
  segmentId: string,
): Array<{ x: number; z: number }> | null {
  const owner = orderedSketchPaths(profile as SketchProfile).find(
    (path) => path.closed && path.points.length >= 3 && path.steps.some((step) => step.segment.id === segmentId),
  );
  if (!owner) return null;
  if (owner.steps.some((step) => step.segment.kind && step.segment.kind !== "line")) return null;
  const points = owner.points.map((point) => ({ x: point.x, z: point.z }));
  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && Math.hypot(first.x - last.x, first.z - last.z) < 1e-6) points.pop();
  return points.length >= 3 ? points : null;
}

function ringIsCcw(points: Array<{ x: number; z: number }>) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area > 0;
}

function outwardEdgeNormal(start: { x: number; z: number }, end: { x: number; z: number }, ccw: boolean) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz) || 1;
  const rx = dz / length;
  const rz = -dx / length;
  return ccw ? { x: rx, z: rz } : { x: -rx, z: -rz };
}

function outwardDistance(
  start: { x: number; z: number },
  end: { x: number; z: number },
  toward: { x: number; z: number },
  ring: Array<{ x: number; z: number }>,
): number | null {
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  if (length < 0.25) return null;
  const normal = outwardEdgeNormal(start, end, ringIsCcw(ring));
  const mid = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
  const distance = (toward.x - mid.x) * normal.x + (toward.z - mid.z) * normal.z;
  if (Math.abs(distance) < 0.05) return null;
  return distance;
}

function offsetClosedRing(points: Array<{ x: number; z: number }>, distance: number): Array<{ x: number; z: number }> | null {
  if (points.length < 3 || !(Math.abs(distance) > 1e-6)) return null;
  const ccw = ringIsCcw(points);
  const normals = points.map((point, index) => outwardEdgeNormal(point, points[(index + 1) % points.length], ccw));
  const offset: Array<{ x: number; z: number }> = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = normals[(index + points.length - 1) % points.length];
    const next = normals[index];
    let mx = previous.x + next.x;
    let mz = previous.z + next.z;
    const span = Math.hypot(mx, mz);
    if (span < 1e-6) {
      offset.push({ x: points[index].x + next.x * distance, z: points[index].z + next.z * distance });
      continue;
    }
    mx /= span;
    mz /= span;
    const denom = mx * next.x + mz * next.z;
    const scale = Math.abs(denom) < 0.2 ? null : distance / denom;
    if (scale === null || Math.abs(scale) > Math.abs(distance) * 6) {
      offset.push({ x: points[index].x + previous.x * distance, z: points[index].z + previous.z * distance });
      offset.push({ x: points[index].x + next.x * distance, z: points[index].z + next.z * distance });
      continue;
    }
    offset.push({ x: points[index].x + mx * scale, z: points[index].z + mz * scale });
  }
  let nextArea = 0;
  for (let index = 0; index < offset.length; index += 1) {
    const a = offset[index];
    const b = offset[(index + 1) % offset.length];
    nextArea += a.x * b.z - b.x * a.z;
  }
  if (Math.abs(nextArea) < 1e-4) return null;
  return offset;
}

/** Axis-aligned rectangle from corner to opposite corner. */
export function rectangleSketchGeometry(origin: { x: number; z: number }, corner: { x: number; z: number }): Pick<SketchProfile, "points" | "segments"> | null {
  const width = Math.abs(corner.x - origin.x);
  const depth = Math.abs(corner.z - origin.z);
  if (width < 0.25 || depth < 0.25) return null;
  const minX = Math.min(origin.x, corner.x);
  const maxX = Math.max(origin.x, corner.x);
  const minZ = Math.min(origin.z, corner.z);
  const maxZ = Math.max(origin.z, corner.z);
  return closedLineRing([
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ]);
}

/** Ellipse inscribed in the corner-drag bounding box (4 cubic beziers). */
export function ellipseSketchGeometry(origin: { x: number; z: number }, corner: { x: number; z: number }): Pick<SketchProfile, "points" | "segments"> | null {
  const rx = Math.abs(corner.x - origin.x) / 2;
  const ry = Math.abs(corner.z - origin.z) / 2;
  if (rx < 0.25 || ry < 0.25) return null;
  const cx = (origin.x + corner.x) / 2;
  const cz = (origin.z + corner.z) / 2;
  const kx = rx * CIRCLE_KAPPA;
  const ky = ry * CIRCLE_KAPPA;
  const rightId = createLocalId("sketch-point");
  const bottomId = createLocalId("sketch-point");
  const leftId = createLocalId("sketch-point");
  const topId = createLocalId("sketch-point");
  const points: SketchPoint[] = [
    {
      id: rightId,
      x: cx + rx,
      z: cz,
      mode: "smooth",
      handleIn: { x: cx + rx, z: cz - ky },
      handleOut: { x: cx + rx, z: cz + ky },
    },
    {
      id: bottomId,
      x: cx,
      z: cz + ry,
      mode: "smooth",
      handleIn: { x: cx + kx, z: cz + ry },
      handleOut: { x: cx - kx, z: cz + ry },
    },
    {
      id: leftId,
      x: cx - rx,
      z: cz,
      mode: "smooth",
      handleIn: { x: cx - rx, z: cz + ky },
      handleOut: { x: cx - rx, z: cz - ky },
    },
    {
      id: topId,
      x: cx,
      z: cz - ry,
      mode: "smooth",
      handleIn: { x: cx - kx, z: cz - ry },
      handleOut: { x: cx + kx, z: cz - ry },
    },
  ];
  const ring = [rightId, bottomId, leftId, topId];
  return {
    points,
    segments: ring.map((startId, index) => ({
      id: createLocalId("sketch-segment"),
      startId,
      endId: ring[(index + 1) % ring.length],
      kind: "bezier" as const,
    })),
  };
}

function appendQuarterArc(
  points: SketchPoint[],
  segments: SketchSegment[],
  from: { x: number; z: number },
  to: { x: number; z: number },
  center: { x: number; z: number },
) {
  const startId = points.length === 0 ? createLocalId("sketch-point") : points[points.length - 1].id;
  if (points.length === 0) {
    points.push({ id: startId, x: from.x, z: from.z, mode: "smooth" });
  }
  const endId = createLocalId("sketch-point");
  const startAngle = Math.atan2(from.z - center.z, from.x - center.x);
  const endAngle = Math.atan2(to.z - center.z, to.x - center.x);
  let sweep = endAngle - startAngle;
  while (sweep <= 0) sweep += Math.PI * 2;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  // Prefer the short positive quarter (~π/2)
  if (Math.abs(sweep) < 0.01) sweep = Math.PI / 2;
  const radius = Math.hypot(from.x - center.x, from.z - center.z);
  const alpha = (4 / 3) * Math.tan(sweep / 4);
  const startCos = Math.cos(startAngle);
  const startSin = Math.sin(startAngle);
  const endCos = Math.cos(endAngle);
  const endSin = Math.sin(endAngle);
  const start = points[points.length - 1];
  start.handleOut = {
    x: start.x + -startSin * radius * alpha,
    z: start.z + startCos * radius * alpha,
  };
  points.push({
    id: endId,
    x: to.x,
    z: to.z,
    mode: "smooth",
    handleIn: {
      x: to.x - -endSin * radius * alpha,
      z: to.z - endCos * radius * alpha,
    },
  });
  segments.push({ id: createLocalId("sketch-segment"), startId, endId, kind: "bezier" });
}

function appendLine(points: SketchPoint[], segments: SketchSegment[], to: { x: number; z: number }) {
  const startId = points[points.length - 1].id;
  const endId = createLocalId("sketch-point");
  points.push({ id: endId, x: to.x, z: to.z, mode: "corner" });
  segments.push({ id: createLocalId("sketch-segment"), startId, endId, kind: "line" });
}

/** Rounded rectangle from corner drag; corner radius scales with the shorter side. */
export function roundedRectangleSketchGeometry(origin: { x: number; z: number }, corner: { x: number; z: number }): Pick<SketchProfile, "points" | "segments"> | null {
  const width = Math.abs(corner.x - origin.x);
  const depth = Math.abs(corner.z - origin.z);
  if (width < 0.5 || depth < 0.5) return null;
  const minX = Math.min(origin.x, corner.x);
  const maxX = Math.max(origin.x, corner.x);
  const minZ = Math.min(origin.z, corner.z);
  const maxZ = Math.max(origin.z, corner.z);
  const radius = Math.min(width, depth) * 0.22;
  const points: SketchPoint[] = [];
  const segments: SketchSegment[] = [];

  // Start at top edge after top-left corner, go clockwise.
  points.push({ id: createLocalId("sketch-point"), x: minX + radius, z: minZ, mode: "corner" });
  appendLine(points, segments, { x: maxX - radius, z: minZ });
  appendQuarterArc(points, segments, { x: maxX - radius, z: minZ }, { x: maxX, z: minZ + radius }, { x: maxX - radius, z: minZ + radius });
  appendLine(points, segments, { x: maxX, z: maxZ - radius });
  appendQuarterArc(points, segments, { x: maxX, z: maxZ - radius }, { x: maxX - radius, z: maxZ }, { x: maxX - radius, z: maxZ - radius });
  appendLine(points, segments, { x: minX + radius, z: maxZ });
  appendQuarterArc(points, segments, { x: minX + radius, z: maxZ }, { x: minX, z: maxZ - radius }, { x: minX + radius, z: maxZ - radius });
  appendLine(points, segments, { x: minX, z: minZ + radius });
  appendQuarterArc(points, segments, { x: minX, z: minZ + radius }, { x: minX + radius, z: minZ }, { x: minX + radius, z: minZ + radius });
  const closing = points[points.length - 1];
  points[0].handleIn = closing.handleIn;
  points[0].mode = "smooth";
  segments[segments.length - 1].endId = points[0].id;
  points.pop();
  return { points, segments };
}

/** Capsule / stadium (slot) from corner-drag bounds. */
export function slotSketchGeometry(origin: { x: number; z: number }, corner: { x: number; z: number }): Pick<SketchProfile, "points" | "segments"> | null {
  const width = Math.abs(corner.x - origin.x);
  const depth = Math.abs(corner.z - origin.z);
  if (width < 0.5 || depth < 0.5) return null;
  const minX = Math.min(origin.x, corner.x);
  const maxX = Math.max(origin.x, corner.x);
  const minZ = Math.min(origin.z, corner.z);
  const maxZ = Math.max(origin.z, corner.z);
  const points: SketchPoint[] = [];
  const segments: SketchSegment[] = [];

  if (width >= depth) {
    const r = depth / 2;
    const cz = (minZ + maxZ) / 2;
    const left = minX + r;
    const right = maxX - r;
    if (right - left < 0.05) {
      return circleSketchGeometry({ x: (minX + maxX) / 2, z: cz }, r);
    }
    points.push({ id: createLocalId("sketch-point"), x: left, z: minZ, mode: "corner" });
    appendLine(points, segments, { x: right, z: minZ });
    appendQuarterArc(points, segments, { x: right, z: minZ }, { x: maxX, z: cz }, { x: right, z: cz });
    appendQuarterArc(points, segments, { x: maxX, z: cz }, { x: right, z: maxZ }, { x: right, z: cz });
    appendLine(points, segments, { x: left, z: maxZ });
    appendQuarterArc(points, segments, { x: left, z: maxZ }, { x: minX, z: cz }, { x: left, z: cz });
    appendQuarterArc(points, segments, { x: minX, z: cz }, { x: left, z: minZ }, { x: left, z: cz });
    const closing = points[points.length - 1];
    points[0].handleIn = closing.handleIn;
    points[0].mode = "smooth";
    segments[segments.length - 1].endId = points[0].id;
    points.pop();
    return { points, segments };
  }

  const r = width / 2;
  const cx = (minX + maxX) / 2;
  const top = minZ + r;
  const bottom = maxZ - r;
  if (bottom - top < 0.05) {
    return circleSketchGeometry({ x: cx, z: (minZ + maxZ) / 2 }, r);
  }
  points.push({ id: createLocalId("sketch-point"), x: maxX, z: top, mode: "corner" });
  appendLine(points, segments, { x: maxX, z: bottom });
  appendQuarterArc(points, segments, { x: maxX, z: bottom }, { x: cx, z: maxZ }, { x: cx, z: bottom });
  appendQuarterArc(points, segments, { x: cx, z: maxZ }, { x: minX, z: bottom }, { x: cx, z: bottom });
  appendLine(points, segments, { x: minX, z: top });
  appendQuarterArc(points, segments, { x: minX, z: top }, { x: cx, z: minZ }, { x: cx, z: top });
  appendQuarterArc(points, segments, { x: cx, z: minZ }, { x: maxX, z: top }, { x: cx, z: top });
  const closing = points[points.length - 1];
  points[0].handleIn = closing.handleIn;
  points[0].mode = "smooth";
  segments[segments.length - 1].endId = points[0].id;
  points.pop();
  return { points, segments };
}

/** Regular star polygon; `points` is tip count (default 5). */
export function starSketchGeometry(
  center: { x: number; z: number },
  tip: { x: number; z: number },
  tips = DEFAULT_SKETCH_STAR_POINTS,
): Pick<SketchProfile, "points" | "segments"> | null {
  const count = Math.max(3, Math.min(16, Math.round(tips)));
  const outer = Math.hypot(tip.x - center.x, tip.z - center.z);
  if (outer < 0.25) return null;
  const inner = outer * 0.382;
  const startAngle = Math.atan2(tip.z - center.z, tip.x - center.x);
  const verts: Array<{ x: number; z: number }> = [];
  for (let index = 0; index < count * 2; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = startAngle + (index * Math.PI) / count;
    verts.push({
      x: center.x + Math.cos(angle) * radius,
      z: center.z + Math.sin(angle) * radius,
    });
  }
  return closedLineRing(verts);
}

export const DEFAULT_SKETCH_POLYGON_SIDES = 6;
export const MIN_SKETCH_POLYGON_SIDES = 3;
export const MAX_SKETCH_POLYGON_SIDES = 16;
export const DEFAULT_SKETCH_STAR_POINTS = 5;

/** Open chain, or a closed loop when `closed` is set and there are at least three points. */
export function polylineSketchGeometry(
  points: Array<{ x: number; z: number }>,
  closed = false,
): Pick<SketchProfile, "points" | "segments"> | null {
  if (points.length < 2) return null;
  if (closed && points.length >= 3) return closedLineRing(points);
  const ids = points.map(() => createLocalId("sketch-point"));
  return {
    points: points.map((point, index) => ({ id: ids[index], x: point.x, z: point.z, mode: "corner" as const })),
    segments: ids.slice(0, -1).map((startId, index) => ({
      id: createLocalId("sketch-segment"),
      startId,
      endId: ids[index + 1],
      kind: "line" as const,
    })),
  };
}

function sketchNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sketchPoint(value: unknown, fallbackX = 0, fallbackZ = 0) {
  if (value && typeof value === "object" && "x" in value && "z" in value) {
    const point = value as { x: unknown; z: unknown };
    return { x: sketchNumber(point.x, fallbackX), z: sketchNumber(point.z, fallbackZ) };
  }
  return { x: fallbackX, z: fallbackZ };
}

function cornerBox(spec: Record<string, unknown>) {
  const x = sketchNumber(spec.x);
  const z = sketchNumber(spec.z);
  const width = Math.abs(sketchNumber(spec.width ?? spec.size, 20));
  const depth = Math.abs(sketchNumber(spec.depth ?? spec.width ?? spec.size, width));
  return {
    origin: { x: x - width / 2, z: z - depth / 2 },
    corner: { x: x + width / 2, z: z + depth / 2 },
  };
}

/** One sketch-tool profile, in sketch coordinates (x across, z back). */
export function geometryForSketchPart(spec: Record<string, unknown>): Pick<SketchProfile, "points" | "segments"> | null {
  const kind = typeof spec.kind === "string" ? spec.kind : "";
  const center = { x: sketchNumber(spec.x), z: sketchNumber(spec.z) };
  if (kind === "circle") {
    const radius = sketchNumber(spec.radius ?? spec.size, 0);
    if (radius < 0.25) return null;
    return circleSketchGeometry(center, radius);
  }
  if (kind === "rectangle" || kind === "square" || kind === "roundedRect" || kind === "slot" || kind === "ellipse") {
    const box = cornerBox(spec);
    if (kind === "square") return squareSketchGeometry(box.origin, box.corner);
    if (kind === "roundedRect") return roundedRectangleSketchGeometry(box.origin, box.corner);
    if (kind === "slot") return slotSketchGeometry(box.origin, box.corner);
    if (kind === "ellipse") return ellipseSketchGeometry(box.origin, box.corner);
    return rectangleSketchGeometry(box.origin, box.corner);
  }
  if (kind === "polygon" || kind === "triangle") {
    const radius = sketchNumber(spec.radius ?? spec.size, 10);
    const sides = kind === "triangle" ? 3 : sketchNumber(spec.sides, 6);
    return regularPolygonSketchGeometry(center, { x: center.x + radius, z: center.z }, sides);
  }
  if (kind === "star") {
    const radius = sketchNumber(spec.radius ?? spec.size, 10);
    return starSketchGeometry(center, { x: center.x + radius, z: center.z }, sketchNumber(spec.sides, 5));
  }
  if (kind === "arc") {
    return arcSketchGeometry(
      sketchPoint(spec.start),
      sketchPoint(spec.end, 10, 0),
      sketchPoint(spec.through, 5, 5),
    );
  }
  if (kind === "line" || kind === "polyline") {
    const points = Array.isArray(spec.points) ? spec.points.map((point) => sketchPoint(point)) : [];
    return polylineSketchGeometry(points, spec.closed === true);
  }
  return null;
}

export function composeSketchProfile(parts: Array<Pick<SketchProfile, "points" | "segments">>): SketchProfile {
  return {
    points: parts.flatMap((part) => part.points),
    segments: parts.flatMap((part) => part.segments),
    images: [],
  };
}

const MIN_OUTLINE_MM = 0.25;

export type SketchOutlineSize = {
  pointIds: string[];
  /** Span along z, the same axis a solid calls Length. */
  length: number;
  /** Span along x, the same axis a solid calls Width. */
  width: number;
};

function closedOutline(profile: Pick<SketchProfile, "points" | "segments">, pointIds: readonly string[]) {
  const wanted = new Set(pointIds);
  if (wanted.size < 3) return null;
  return orderedSketchPaths(profile).find((path) => (
    path.closed
    && path.points.length === wanted.size
    && path.points.every((point) => wanted.has(point.id))
  )) ?? null;
}

function outlineSpan(profile: Pick<SketchProfile, "points" | "segments">, pointIds: readonly string[]) {
  const path = closedOutline(profile, pointIds);
  if (!path) return null;
  const samples = sampledPathOutline(path);
  if (samples.length < 3) return null;
  const xs = samples.map((point) => point.x);
  const zs = samples.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const width = maxX - minX;
  const length = maxZ - minZ;
  if (width < MIN_OUTLINE_MM || length < MIN_OUTLINE_MM) return null;
  return { path, minX, maxX, minZ, maxZ, width, length };
}

/** Length and width of one selected closed outline. A partial selection returns nothing. */
export function sketchOutlineSize(
  profile: Pick<SketchProfile, "points" | "segments">,
  pointIds: readonly string[],
): SketchOutlineSize | null {
  const span = outlineSpan(profile, pointIds);
  if (!span) return null;
  return {
    pointIds: span.path.points.map((point) => point.id),
    length: span.length,
    width: span.width,
  };
}

/** Scale that outline about its center. Handles move with the points, so a circle stays round when both axes match. */
export function resizeSketchOutline(
  profile: SketchProfile,
  pointIds: readonly string[],
  next: { length?: number; width?: number },
): SketchProfile | null {
  const span = outlineSpan(profile, pointIds);
  if (!span) return null;
  const length = next.length ?? span.length;
  const width = next.width ?? span.width;
  if (!(length >= MIN_OUTLINE_MM) || !(width >= MIN_OUTLINE_MM)) return null;
  const sx = width / span.width;
  const sz = length / span.length;
  if (Math.abs(sx - 1) < 1e-9 && Math.abs(sz - 1) < 1e-9) return profile;
  const cx = (span.minX + span.maxX) / 2;
  const cz = (span.minZ + span.maxZ) / 2;
  const scale = (x: number, z: number) => ({ x: cx + (x - cx) * sx, z: cz + (z - cz) * sz });
  const ids = new Set(span.path.points.map((point) => point.id));
  return {
    ...profile,
    points: profile.points.map((point) => {
      if (!ids.has(point.id)) return point;
      const at = scale(point.x, point.z);
      return {
        ...point,
        x: at.x,
        z: at.z,
        handleIn: point.handleIn ? scale(point.handleIn.x, point.handleIn.z) : undefined,
        handleOut: point.handleOut ? scale(point.handleOut.x, point.handleOut.z) : undefined,
      };
    }),
  };
}
