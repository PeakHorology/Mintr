import type { SketchPoint, SketchProfile, SketchSegment } from "@/types/sketchforge";
import { chamferCorner, filletCorner } from "./editOps";
import { orderedSketchPaths } from "./profiles";
import type { SketchDoc, SketchEntity } from "./types";

export type LengthGrow = "end" | "both";
export type StrokeSide = "center" | "inside" | "outside";

type Pt = { x: number; z: number };

function movePoint(profile: SketchProfile, id: string, x: number, z: number): SketchProfile {
  return {
    ...profile,
    points: profile.points.map((point) => (point.id === id ? { ...point, x, z } : point)),
  };
}

/** Keep the start point and move the far end, or grow both ends from the midpoint. */
export function resizeSegmentLength(
  profile: SketchProfile,
  segmentId: string,
  length: number,
  grow: LengthGrow = "end",
): SketchProfile | null {
  if (!(length > 0)) return null;
  const segment = profile.segments.find((entry) => entry.id === segmentId);
  if (!segment) return null;
  const start = profile.points.find((point) => point.id === segment.startId);
  const end = profile.points.find((point) => point.id === segment.endId);
  if (!start || !end) return null;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const span = Math.hypot(dx, dz);
  const ux = span < 1e-9 ? 1 : dx / span;
  const uz = span < 1e-9 ? 0 : dz / span;
  if (grow === "both") {
    const mx = (start.x + end.x) / 2;
    const mz = (start.z + end.z) / 2;
    return movePoint(
      movePoint(profile, start.id, mx - ux * length / 2, mz - uz * length / 2),
      end.id,
      mx + ux * length / 2,
      mz + uz * length / 2,
    );
  }
  return movePoint(profile, end.id, start.x + ux * length, start.z + uz * length);
}

export type SketchCornerMark = {
  pointId: string;
  x: number;
  z: number;
  degrees: number;
  /** Unit bisector pointing into the measured wedge. */
  bx: number;
  bz: number;
  /** Unit directions of the two legs, pointing away from the corner. */
  ux0: number;
  uz0: number;
  ux1: number;
  uz1: number;
  /** Shorter leg, so the arc stays inside the corner. */
  reach: number;
};

function lineLegs(profile: SketchProfile, vertexId: string) {
  const point = profile.points.find((entry) => entry.id === vertexId);
  if (!point) return null;
  const legs = profile.segments.filter((segment) => {
    if (segment.construction) return false;
    if (segment.kind && segment.kind !== "line") return false;
    return segment.startId === vertexId || segment.endId === vertexId;
  });
  if (legs.length !== 2) return null;
  const other = (segment: SketchSegment) => profile.points.find((entry) => entry.id === (segment.startId === vertexId ? segment.endId : segment.startId));
  const p0 = other(legs[0]);
  const p1 = other(legs[1]);
  if (!p0 || !p1) return null;
  const len0 = Math.hypot(p0.x - point.x, p0.z - point.z);
  const len1 = Math.hypot(p1.x - point.x, p1.z - point.z);
  if (len0 < 1e-6 || len1 < 1e-6) return null;
  const u0 = { x: (p0.x - point.x) / len0, z: (p0.z - point.z) / len0 };
  const u1 = { x: (p1.x - point.x) / len1, z: (p1.z - point.z) / len1 };
  const dot = Math.min(1, Math.max(-1, u0.x * u1.x + u0.z * u1.z));
  const interior = Math.acos(dot);
  if (interior < 1e-3 || Math.PI - interior < 1e-3) return null;
  return { point, legs, far: [p0, p1] as const, unit: [u0, u1] as const, lengths: [len0, len1] as const, interior };
}

/** Corner angles where two straight solid lines meet. */
export function sketchCornerMarks(profile: SketchProfile): SketchCornerMark[] {
  const marks: SketchCornerMark[] = [];
  const seen = new Set<string>();
  for (const segment of profile.segments) {
    for (const pointId of [segment.startId, segment.endId]) {
      if (seen.has(pointId)) continue;
      seen.add(pointId);
      const corner = lineLegs(profile, pointId);
      if (!corner) continue;
      let bx = corner.unit[0].x + corner.unit[1].x;
      let bz = corner.unit[0].z + corner.unit[1].z;
      const span = Math.hypot(bx, bz);
      if (span < 1e-6) continue;
      bx /= span;
      bz /= span;
      marks.push({
        pointId,
        x: corner.point.x,
        z: corner.point.z,
        degrees: (corner.interior * 180) / Math.PI,
        bx,
        bz,
        ux0: corner.unit[0].x,
        uz0: corner.unit[0].z,
        ux1: corner.unit[1].x,
        uz1: corner.unit[1].z,
        reach: Math.min(corner.lengths[0], corner.lengths[1]),
      });
    }
  }
  return marks;
}

/**
 * Turn one line about the corner until the interior angle matches.
 * `movingLeg` 0 or 1 picks which line keeps its length and swings.
 */
export function setCornerAngle(
  profile: SketchProfile,
  vertexId: string,
  angleDeg: number,
  movingLeg: 0 | 1 = 1,
): SketchProfile | null {
  if (!(angleDeg > 1) || !(angleDeg < 179)) return null;
  const corner = lineLegs(profile, vertexId);
  if (!corner) return null;
  const moving = movingLeg === 0 ? 0 : 1;
  const fixed = moving === 0 ? 1 : 0;
  const target = (angleDeg * Math.PI) / 180;
  const cross = corner.unit[fixed].x * corner.unit[moving].z - corner.unit[fixed].z * corner.unit[moving].x;
  const sign = cross >= 0 ? 1 : -1;
  const sine = Math.sin(sign * target);
  const cosine = Math.cos(sign * target);
  const ux = corner.unit[fixed].x * cosine - corner.unit[fixed].z * sine;
  const uz = corner.unit[fixed].x * sine + corner.unit[fixed].z * cosine;
  const length = corner.lengths[moving];
  const far = corner.far[moving];
  return movePoint(profile, far.id, corner.point.x + ux * length, corner.point.z + uz * length);
}

/** Fillet every listed corner. Corners that are not a two-line joint are skipped. */
export function filletCorners(profile: SketchProfile, pointIds: string[], radius: number): { profile: SketchProfile; applied: number } | null {
  let next = profile;
  let applied = 0;
  for (const pointId of pointIds) {
    const cut = filletCorner(next, pointId, radius);
    if (!cut) continue;
    next = cut;
    applied += 1;
  }
  return applied > 0 ? { profile: next, applied } : null;
}

/** Chamfer every listed corner. Each leg is set back by `distance`, capped at 45% of the shorter leg. */
export function chamferCorners(profile: SketchProfile, pointIds: string[], distance: number): { profile: SketchProfile; applied: number } | null {
  let next = profile;
  let applied = 0;
  for (const pointId of pointIds) {
    const cut = chamferCorner(next, pointId, distance);
    if (!cut) continue;
    next = cut;
    applied += 1;
  }
  return applied > 0 ? { profile: next, applied } : null;
}

function signedArea(points: Pt[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.z - next.x * current.z;
  }
  return area / 2;
}

function outwardNormal(ax: number, az: number, bx: number, bz: number, ccw: boolean) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz) || 1;
  const rx = dz / length;
  const rz = -dx / length;
  return ccw ? { x: rx, z: rz } : { x: -rx, z: -rz };
}

function offsetClosed(points: Pt[], distance: number): Pt[] | null {
  if (points.length < 3 || !(Math.abs(distance) > 1e-6)) return distance === 0 ? points.map((point) => ({ ...point })) : null;
  const ccw = signedArea(points) > 0;
  const normals = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return outwardNormal(point.x, point.z, next.x, next.z, ccw);
  });
  const offset: Pt[] = [];
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
  if (Math.abs(signedArea(offset)) < 1e-4) return null;
  return offset;
}

function offsetOpen(points: Pt[], left: number, right: number): Pt[] | null {
  if (points.length < 2) return null;
  const leftNormals: Pt[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    leftNormals.push({ x: -dz / length, z: dx / length });
  }
  const shift = (index: number, distance: number, side: Pt) => ({
    x: points[index].x + side.x * distance,
    z: points[index].z + side.z * distance,
  });
  const sideAt = (index: number) => {
    if (index === 0) return leftNormals[0];
    if (index === points.length - 1) return leftNormals[leftNormals.length - 1];
    const a = leftNormals[index - 1];
    const b = leftNormals[index];
    const mx = a.x + b.x;
    const mz = a.z + b.z;
    const span = Math.hypot(mx, mz);
    if (span < 1e-6) return b;
    return { x: mx / span, z: mz / span };
  };
  const leftSide: Pt[] = [];
  const rightSide: Pt[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const side = sideAt(index);
    const neighbor = index === 0 ? leftNormals[0] : leftNormals[Math.min(index, leftNormals.length) - 1];
    const denom = side.x * neighbor.x + side.z * neighbor.z || 1;
    const scale = Math.min(4, Math.abs(1 / denom));
    leftSide.push(shift(index, left * scale, side));
    rightSide.push(shift(index, -right * scale, side));
  }
  return [...leftSide, ...rightSide.reverse()];
}

function pathPoints(path: ReturnType<typeof orderedSketchPaths>[number]): Pt[] {
  const points: Pt[] = [];
  for (const step of path.steps) {
    if (points.length === 0) points.push({ x: step.from.x, z: step.from.z });
    points.push({ x: step.to.x, z: step.to.z });
  }
  if (path.closed && points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first.x - last.x, first.z - last.z) < 1e-6) points.pop();
  }
  return points;
}

let strokeSerial = 0;
function strokeId(prefix: string) {
  strokeSerial += 1;
  return `${prefix}-${strokeSerial.toString(36)}`;
}

function loopSegments(points: Pt[]): { points: SketchPoint[]; segments: SketchSegment[] } {
  const sketchPoints: SketchPoint[] = points.map((point) => ({ id: strokeId("sketch-point"), x: point.x, z: point.z, mode: "corner" }));
  const segments: SketchSegment[] = sketchPoints.map((point, index) => ({
    id: strokeId("sketch-segment"),
    startId: point.id,
    endId: sketchPoints[(index + 1) % sketchPoints.length].id,
    kind: "line",
  }));
  return { points: sketchPoints, segments };
}

/**
 * Turn solid outlines into a printable wall.
 * A closed outline becomes a frame. An open line becomes a stripe.
 * Construction guides are left in place.
 */
export function strokeProfile(
  profile: SketchProfile,
  options: { width: number; side: StrokeSide },
): SketchProfile | null {
  const width = options.width;
  if (!(width > 0.05)) return null;
  const solidSegments = profile.segments.filter((segment) => !segment.construction);
  if (!solidSegments.length) return null;
  const paths = orderedSketchPaths({ ...profile, segments: solidSegments });
  const builtPoints: SketchPoint[] = [];
  const builtSegments: SketchSegment[] = [];
  let made = 0;
  for (const path of paths) {
    const outline = pathPoints(path);
    if (path.closed && outline.length >= 3) {
      const half = width / 2;
      let outer: Pt[] | null;
      let hole: Pt[] | null;
      if (options.side === "outside") {
        outer = offsetClosed(outline, width);
        hole = outline;
      } else if (options.side === "inside") {
        outer = outline;
        hole = offsetClosed(outline, -width);
      } else {
        outer = offsetClosed(outline, half);
        hole = offsetClosed(outline, -half);
      }
      if (!outer || !hole) continue;
      const outerLoop = loopSegments(outer);
      const holeLoop = loopSegments(hole);
      builtPoints.push(...outerLoop.points, ...holeLoop.points);
      builtSegments.push(...outerLoop.segments, ...holeLoop.segments);
      made += 1;
      continue;
    }
    if (!path.closed && outline.length >= 2) {
      const left = options.side === "inside" ? 0 : options.side === "outside" ? width : width / 2;
      const right = options.side === "outside" ? 0 : options.side === "inside" ? width : width / 2;
      const stripe = offsetOpen(outline, left, right);
      if (!stripe || stripe.length < 4) continue;
      const loop = loopSegments(stripe);
      builtPoints.push(...loop.points);
      builtSegments.push(...loop.segments);
      made += 1;
    }
  }
  if (!made) return null;
  const keptSegments = profile.segments.filter((segment) => segment.construction);
  const used = new Set<string>();
  for (const segment of keptSegments) {
    used.add(segment.startId);
    used.add(segment.endId);
  }
  return {
    ...profile,
    points: [...profile.points.filter((point) => used.has(point.id)), ...builtPoints],
    segments: [...keptSegments, ...builtSegments],
  };
}

export type SweepInputs = {
  section: Pt[];
  path: Pt[];
  pathClosed: boolean;
};

function chainLength(points: Pt[]) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
  }
  return length;
}

/** Largest closed solid outline, plus the longest construction path on the same sheet. */
export function findSweepInputs(profile: SketchProfile): SweepInputs | null {
  const solid = orderedSketchPaths({
    ...profile,
    segments: profile.segments.filter((segment) => !segment.construction),
  }).filter((path) => path.closed);
  if (!solid.length) return null;
  const sectionPath = solid
    .map((path) => ({ path, area: Math.abs(signedArea(pathPoints(path))) }))
    .sort((a, b) => b.area - a.area)[0]?.path;
  if (!sectionPath) return null;
  const section = pathPoints(sectionPath);
  if (section.length < 3) return null;

  const guides = orderedSketchPaths({
    ...profile,
    segments: profile.segments.filter((segment) => segment.construction),
  });
  if (!guides.length) return null;
  const ranked = guides
    .map((path) => ({ path, points: pathPoints(path), length: chainLength(pathPoints(path)) }))
    .filter((entry) => entry.points.length >= 2 && entry.length > 0.5)
    .sort((a, b) => b.length - a.length);
  const path = ranked[0];
  if (!path) return null;
  return { section, path: path.points, pathClosed: path.path.closed };
}

/** Copy construction lines that live only on the document into the profile so they draw, snap, and sweep. */
export function profileWithConstructionGuides(profile: SketchProfile, doc: SketchDoc | null | undefined): SketchProfile {
  if (!doc) return profile;
  const segmentIds = new Set(profile.segments.map((segment) => segment.id));
  const pointIds = new Set(profile.points.map((point) => point.id));
  const points = [...profile.points];
  const segments = [...profile.segments];
  const pointOf = (id: string) => doc.entities.find((entity): entity is Extract<SketchEntity, { kind: "point" }> => entity.kind === "point" && entity.id === id);
  for (const entity of doc.entities) {
    if (!entity.construction || segmentIds.has(entity.id)) continue;
    if (entity.kind !== "line" && entity.kind !== "bezier" && entity.kind !== "smooth") continue;
    const start = pointOf(entity.startId);
    const end = pointOf(entity.endId);
    if (!start || !end) continue;
    for (const point of [start, end]) {
      if (pointIds.has(point.id)) continue;
      pointIds.add(point.id);
      points.push({ id: point.id, x: point.x, z: point.z, mode: point.mode });
    }
    segments.push({
      id: entity.id,
      startId: entity.startId,
      endId: entity.endId,
      kind: entity.kind === "line" ? "line" : entity.kind,
      construction: true,
    });
  }
  return { ...profile, points, segments };
}

/** Dashed guides for construction geometry that is not already a profile segment. */
export function constructionGuideLines(doc: SketchDoc, profile: SketchProfile) {
  const known = new Set(profile.segments.map((segment) => segment.id));
  const guides: Array<{ id: string; x1: number; z1: number; x2: number; z2: number }> = [];
  const pointOf = (id: string) => doc.entities.find((entity): entity is Extract<SketchEntity, { kind: "point" }> => entity.kind === "point" && entity.id === id);
  for (const entity of doc.entities) {
    if (!entity.construction) continue;
    if ((entity.kind === "line" || entity.kind === "bezier" || entity.kind === "smooth") && !known.has(entity.id)) {
      const start = pointOf(entity.startId);
      const end = pointOf(entity.endId);
      if (!start || !end) continue;
      guides.push({ id: entity.id, x1: start.x, z1: start.z, x2: end.x, z2: end.z });
    } else if (entity.kind === "circle") {
      const center = pointOf(entity.centerId);
      if (!center) continue;
      const steps = 24;
      for (let index = 0; index < steps; index += 1) {
        const a0 = (index / steps) * Math.PI * 2;
        const a1 = ((index + 1) / steps) * Math.PI * 2;
        guides.push({
          id: `${entity.id}-g${index}`,
          x1: center.x + Math.cos(a0) * entity.radius,
          z1: center.z + Math.sin(a0) * entity.radius,
          x2: center.x + Math.cos(a1) * entity.radius,
          z2: center.z + Math.sin(a1) * entity.radius,
        });
      }
    }
  }
  return guides;
}
