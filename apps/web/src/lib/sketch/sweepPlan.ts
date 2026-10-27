import { resolveSketchPlane, sketchPlaneVAxis } from "@/lib/sketchPlane";
import type { SketchPlane, SketchProfile, SketchSegment } from "@/types/sketchforge";
import { curveStandInOwner } from "./migrate";
import { closedProfilesFromLegacy, orderedSketchPaths, sampledPathOutline, type OrderedSketchPath } from "./profiles";
import type { SketchDoc, SketchEntity } from "./types";

/** A corner this close to the path stays on the path. */
export const SWEEP_PIERCE_MM = 0.35;
const MIN_PATH_MM = 0.5;

export type SweepUv = { x: number; z: number };
export type SweepVec3 = { x: number; y: number; z: number };

export type SweepStep = {
  segmentId: string;
  kind: "line" | "bezier";
  from: SweepUv;
  to: SweepUv;
  c1?: SweepUv;
  c2?: SweepUv;
  /** Analytic circle or arc this chord stands in for. */
  curveId?: string;
  /** Set on the first chord of an arc, so the wire can be one curve. */
  arc?: SweepArc;
};

export type SweepCircle = { kind: "circle"; cx: number; cz: number; radius: number };
export type SweepArc = {
  kind: "arc";
  cx: number;
  cz: number;
  radius: number;
  start: SweepUv;
  mid: SweepUv;
  end: SweepUv;
};

export type SweepChain = {
  id: string;
  closed: boolean;
  points: SweepUv[];
  pointIds: string[];
  segmentIds: string[];
  steps: SweepStep[];
  curveId?: string;
  curve?: SweepCircle | SweepArc;
};

export type SweepOutline = SweepChain & { holes: SweepChain[] };

export type SweepSheet = {
  outlines: SweepOutline[];
  paths: SweepChain[];
};

type SketchSweepSpec = NonNullable<import("@/types/sketchforge").WorkplaneShape["sketchSweep"]>;

function uv(x: number, z: number): SweepUv {
  return { x, z };
}

function hypot(a: SweepUv, b: SweepUv) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function chainLength(points: SweepUv[], closed: boolean) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += hypot(points[index - 1], points[index]);
  if (closed && points.length > 2) length += hypot(points[points.length - 1], points[0]);
  return length;
}

function pointEntity(doc: SketchDoc | null | undefined, id: string) {
  const entity = doc?.entities.find((entry) => entry.kind === "point" && entry.id === id);
  return entity && entity.kind === "point" ? entity : null;
}

function sharedCurveId(segmentIds: string[]) {
  if (!segmentIds.length) return undefined;
  const owner = curveStandInOwner(segmentIds[0]);
  if (!owner) return undefined;
  return segmentIds.every((id) => curveStandInOwner(id) === owner) ? owner : undefined;
}

function arcMid(center: SweepUv, start: SweepUv, end: SweepUv, ccw: boolean): SweepUv {
  const radius = Math.hypot(start.x - center.x, start.z - center.z);
  let a0 = Math.atan2(start.z - center.z, start.x - center.x);
  let a1 = Math.atan2(end.z - center.z, end.x - center.x);
  if (ccw && a1 <= a0) a1 += Math.PI * 2;
  if (!ccw && a0 <= a1) a0 += Math.PI * 2;
  const angle = (a0 + a1) / 2;
  return uv(center.x + Math.cos(angle) * radius, center.z + Math.sin(angle) * radius);
}

function curveGeometry(doc: SketchDoc | null | undefined, curveId: string | undefined): SweepCircle | SweepArc | undefined {
  if (!doc || !curveId) return undefined;
  const entity = doc.entities.find((entry) => entry.id === curveId);
  if (!entity) return undefined;
  if (entity.kind === "circle") {
    const center = pointEntity(doc, entity.centerId);
    if (!center || !(entity.radius > 0)) return undefined;
    return { kind: "circle", cx: center.x, cz: center.z, radius: entity.radius };
  }
  if (entity.kind === "arc") {
    const center = pointEntity(doc, entity.centerId);
    const start = pointEntity(doc, entity.startId);
    const end = pointEntity(doc, entity.endId);
    if (!center || !start || !end) return undefined;
    const radius = Math.hypot(start.x - center.x, start.z - center.z);
    if (!(radius > 0)) return undefined;
    const startUv = uv(start.x, start.z);
    const endUv = uv(end.x, end.z);
    return {
      kind: "arc",
      cx: center.x,
      cz: center.z,
      radius,
      start: startUv,
      end: endUv,
      mid: arcMid(uv(center.x, center.z), startUv, endUv, entity.ccw !== false),
    };
  }
  return undefined;
}

function stepsFromPath(path: OrderedSketchPath, doc: SketchDoc | null | undefined): SweepStep[] {
  const seenArc = new Set<string>();
  return path.steps.map(({ segment, from, to }) => {
    const forward = segment.startId === from.id;
    const raw1 = forward ? from.handleOut : from.handleIn;
    const raw2 = forward ? to.handleIn : to.handleOut;
    const control1 = raw1 ?? from;
    const control2 = raw2 ?? to;
    const curved = segment.kind !== "line" && Boolean(raw1 || raw2);
    const curveId = curveStandInOwner(segment.id) ?? undefined;
    const geometry = curveGeometry(doc, curveId);
    const arc = geometry?.kind === "arc" && curveId && !seenArc.has(curveId) ? geometry : undefined;
    if (curveId && geometry?.kind === "arc") seenArc.add(curveId);
    return {
      segmentId: segment.id,
      kind: curved ? "bezier" : "line",
      from: uv(from.x, from.z),
      to: uv(to.x, to.z),
      ...(curved ? { c1: uv(control1.x, control1.z), c2: uv(control2.x, control2.z) } : {}),
      curveId,
      arc,
    };
  });
}

function chainFromPath(path: OrderedSketchPath, doc: SketchDoc | null | undefined): SweepChain | null {
  if (path.points.length < 2 || path.steps.length < 1) return null;
  const segmentIds = path.steps.map((step) => step.segment.id);
  const curveId = sharedCurveId(segmentIds);
  const curve = curveGeometry(doc, curveId);
  const samples = path.steps.some((step) => step.segment.kind !== "line")
    ? sampledPathOutline(path)
    : path.points.map((point) => uv(point.x, point.z));
  const points = curve?.kind === "circle"
    ? circleSamples(curve)
    : samples;
  if (chainLength(points, path.closed || curve?.kind === "circle") <= MIN_PATH_MM) return null;
  return {
    id: curveId ?? segmentIds[0],
    closed: path.closed || curve?.kind === "circle",
    points,
    pointIds: path.points.map((point) => point.id),
    segmentIds,
    steps: stepsFromPath(path, doc),
    curveId,
    curve,
  };
}

function circleSamples(circle: SweepCircle): SweepUv[] {
  const points: SweepUv[] = [];
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    points.push(uv(circle.cx + Math.cos(angle) * circle.radius, circle.cz + Math.sin(angle) * circle.radius));
  }
  return points;
}

function chainFromCurve(entity: Extract<SketchEntity, { kind: "circle" | "arc" }>, doc: SketchDoc): SweepChain | null {
  const curve = curveGeometry(doc, entity.id);
  if (!curve) return null;
  if (curve.kind === "circle") {
    return {
      id: entity.id,
      closed: true,
      points: circleSamples(curve),
      pointIds: [entity.centerId],
      segmentIds: [entity.id],
      steps: [],
      curveId: entity.id,
      curve,
    };
  }
  if (entity.kind !== "arc") return null;
  const points = [curve.start, curve.mid, curve.end];
  if (chainLength(points, false) <= MIN_PATH_MM) return null;
  return {
    id: entity.id,
    closed: false,
    points,
    pointIds: [entity.startId, entity.endId],
    segmentIds: [entity.id],
    steps: [],
    curveId: entity.id,
    curve,
  };
}

function samePointSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const ids = new Set(a);
  return b.every((id) => ids.has(id));
}

function segmentIsConstruction(segment: SketchSegment | undefined) {
  return Boolean(segment?.construction);
}

/** Outlines are closed solid loops. Paths are open chains, or closed construction geometry. */
export function planSketchSweep(profile: SketchProfile, doc?: SketchDoc | null): SweepSheet {
  const profiles = closedProfilesFromLegacy(profile);
  const solidPaths = orderedSketchPaths({
    ...profile,
    segments: profile.segments.filter((segment) => !segment.construction),
  }).filter((path) => path.closed);
  const outlines: SweepOutline[] = [];
  for (const region of profiles) {
    const outerPath = solidPaths.find((path) => samePointSet(path.points.map((point) => point.id), region.pointIds));
    const outer = outerPath ? chainFromPath(outerPath, doc) : null;
    if (!outer) continue;
    const holes: SweepChain[] = [];
    for (const holeIds of region.holePointIdLoops) {
      const holePath = solidPaths.find((path) => samePointSet(path.points.map((point) => point.id), holeIds));
      const hole = holePath ? chainFromPath(holePath, doc) : null;
      if (hole) holes.push(hole);
    }
    outlines.push({ ...outer, holes });
  }

  const outlineSegmentIds = new Set(outlines.flatMap((outline) => [
    ...outline.segmentIds,
    ...outline.holes.flatMap((hole) => hole.segmentIds),
  ]));
  const paths: SweepChain[] = [];
  for (const path of orderedSketchPaths(profile)) {
    if (path.steps.some((step) => outlineSegmentIds.has(step.segment.id))) continue;
    const closed = path.closed;
    const construction = path.steps.every((step) => segmentIsConstruction(step.segment));
    if (closed && !construction) continue;
    const chain = chainFromPath(path, doc);
    if (chain) paths.push(chain);
  }

  if (doc) {
    const known = new Set([...outlines, ...paths].flatMap((chain) => chain.curveId ? [chain.curveId] : []));
    for (const entity of doc.entities) {
      if ((entity.kind !== "circle" && entity.kind !== "arc") || !entity.construction || known.has(entity.id)) continue;
      const chain = chainFromCurve(entity, doc);
      if (chain) paths.push(chain);
    }
  }

  return { outlines, paths };
}

export function sweepChainHit(chain: SweepChain, segmentId: string) {
  if (chain.id === segmentId || chain.curveId === segmentId || chain.segmentIds.includes(segmentId)) return true;
  const owner = curveStandInOwner(segmentId);
  return owner !== null && (owner === chain.curveId || owner === chain.id);
}

export function sweepSpec(outline: SweepOutline, path: SweepChain, section?: SketchSweepSpec["section"]): SketchSweepSpec {
  const hole = outline.holes[0];
  return {
    ...(section ? { section } : {}),
    outlineSegmentIds: outline.segmentIds,
    holeSegmentIds: hole?.segmentIds ?? [],
    pathSegmentIds: path.segmentIds,
    outlineCurveId: outline.curveId,
    holeCurveId: hole?.curveId,
    pathCurveId: path.curveId,
    pathClosed: path.closed,
  };
}

function findChain(chains: SweepChain[], specIds: string[], curveId?: string) {
  if (curveId) {
    const byCurve = chains.find((chain) => chain.curveId === curveId || chain.id === curveId);
    if (byCurve) return byCurve;
  }
  return chains.find((chain) => specIds.length > 0 && specIds.every((id) => chain.segmentIds.includes(id) || chain.id === id));
}

/** Rebuild the chosen outline and path from the ids stored on the solid. */
export function resolveSketchSweep(profile: SketchProfile, doc: SketchDoc | null | undefined, spec: SketchSweepSpec): {
  outline: SweepOutline;
  path: SweepChain;
  /** The outline was drawn on a sheet of its own (the Sweep steps). */
  separateSection: boolean;
  /** That sheet stood across the path start, so the outline is placed exactly where it was drawn. */
  standingSection: boolean;
} | null {
  const plan = planSketchSweep(profile, doc);
  // A cross-section lives on its own sheet; every closed loop on the path sheet can then be a path.
  const outlinePlan = spec.section ? planSketchSweep(spec.section.profile, spec.section.doc) : plan;
  const outline = outlinePlan.outlines.find((candidate) => (
    (spec.outlineCurveId && (candidate.curveId === spec.outlineCurveId || candidate.id === spec.outlineCurveId))
    || spec.outlineSegmentIds.every((id) => candidate.segmentIds.includes(id))
  ));
  if (!outline || outline.holes.length > 1) return null;
  const hole = outline.holes[0];
  if (spec.holeSegmentIds.length > 0 && !hole) return null;
  const path = findChain(plan.paths, spec.pathSegmentIds, spec.pathCurveId)
    ?? findChain(spec.section ? plan.outlines : plan.outlines.filter((candidate) => candidate.id !== outline.id), spec.pathSegmentIds, spec.pathCurveId);
  if (!path) return null;
  return { outline, path, separateSection: Boolean(spec.section), standingSection: Boolean(spec.section?.standing) };
}

function closestOnSegment(point: SweepUv, a: SweepUv, b: SweepUv) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq < 1e-12 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq));
  return uv(a.x + dx * t, a.z + dz * t);
}

function distanceToChain(point: SweepUv, chain: SweepChain) {
  let best = Infinity;
  const count = chain.closed ? chain.points.length : chain.points.length - 1;
  for (let index = 0; index < count; index += 1) {
    const next = chain.points[(index + 1) % chain.points.length];
    const on = closestOnSegment(point, chain.points[index], next);
    best = Math.min(best, hypot(point, on));
  }
  if (chain.curve?.kind === "circle") {
    best = Math.min(best, Math.abs(Math.hypot(point.x - chain.curve.cx, point.z - chain.curve.cz) - chain.curve.radius));
  }
  return best;
}

function centroid(points: SweepUv[]): SweepUv {
  if (!points.length) return uv(0, 0);
  let x = 0;
  let z = 0;
  for (const point of points) {
    x += point.x;
    z += point.z;
  }
  return uv(x / points.length, z / points.length);
}

/** Center the section on the path start, unless one of its points already lies on the path. */
export function sweepAnchor(outline: SweepOutline, path: SweepChain): { at: SweepUv; pierced: boolean } {
  const corners = outline.curve?.kind === "circle"
    ? outline.points
    : outline.steps.length
      ? outline.steps.map((step) => step.from)
      : outline.points;
  for (const point of corners) {
    if (distanceToChain(point, path) <= SWEEP_PIERCE_MM) return { at: point, pierced: true };
  }
  if (outline.curve?.kind === "circle") {
    const center = uv(outline.curve.cx, outline.curve.cz);
    const gap = distanceToChain(center, path);
    if (Math.abs(gap - outline.curve.radius) <= SWEEP_PIERCE_MM) {
      return { at: center, pierced: false };
    }
    if (gap <= SWEEP_PIERCE_MM) return { at: center, pierced: true };
    return { at: center, pierced: false };
  }
  return { at: centroid(corners.length ? corners : outline.points), pierced: false };
}

function add(a: SweepVec3, b: SweepVec3, scale = 1): SweepVec3 {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale };
}

function cross(a: SweepVec3, b: SweepVec3): SweepVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: SweepVec3, b: SweepVec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: SweepVec3): SweepVec3 | null {
  const length = Math.hypot(v.x, v.y, v.z);
  if (length < 1e-8) return null;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function planePoint(plane: ReturnType<typeof resolveSketchPlane>, vAxis: SweepVec3, point: SweepUv): SweepVec3 {
  return add(add(plane.origin, {
    x: plane.uAxis.x * point.x,
    y: plane.uAxis.y * point.x,
    z: plane.uAxis.z * point.x,
  }), {
    x: vAxis.x * point.z,
    y: vAxis.y * point.z,
    z: vAxis.z * point.z,
  });
}

function planeDirection(plane: ReturnType<typeof resolveSketchPlane>, vAxis: SweepVec3, point: SweepUv): SweepVec3 | null {
  return normalize({
    x: plane.uAxis.x * point.x + vAxis.x * point.z,
    y: plane.uAxis.y * point.x + vAxis.y * point.z,
    z: plane.uAxis.z * point.x + vAxis.z * point.z,
  });
}

function startTangentUv(path: SweepChain): SweepUv | null {
  if (path.curve?.kind === "circle") return uv(0, 1);
  if (path.curve?.kind === "arc") {
    const radial = uv(path.curve.start.x - path.curve.cx, path.curve.start.z - path.curve.cz);
    const towardMid = uv(path.curve.mid.x - path.curve.start.x, path.curve.mid.z - path.curve.start.z);
    const ccw = uv(-radial.z, radial.x);
    const sign = ccw.x * towardMid.x + ccw.z * towardMid.z >= 0 ? 1 : -1;
    const length = Math.hypot(radial.x, radial.z) || 1;
    return uv((-radial.z / length) * sign, (radial.x / length) * sign);
  }
  const step = path.steps[0];
  if (!step) {
    if (path.points.length < 2) return null;
    return uv(path.points[1].x - path.points[0].x, path.points[1].z - path.points[0].z);
  }
  if (step.kind === "bezier" && step.c1) return uv(step.c1.x - step.from.x, step.c1.z - step.from.z);
  return uv(step.to.x - step.from.x, step.to.z - step.from.z);
}

function pathStartUv(path: SweepChain): SweepUv {
  if (path.curve?.kind === "circle") return uv(path.curve.cx + path.curve.radius, path.curve.cz);
  if (path.curve?.kind === "arc") return path.curve.start;
  return path.steps[0]?.from ?? path.points[0];
}

export type PlacedPoint = SweepVec3;

export type PlacedEdge =
  | { kind: "line"; from: PlacedPoint; to: PlacedPoint }
  | { kind: "bezier"; from: PlacedPoint; c1: PlacedPoint; c2: PlacedPoint; to: PlacedPoint }
  | { kind: "arc"; from: PlacedPoint; mid: PlacedPoint; to: PlacedPoint };

export type PlacedLoop = {
  circle?: { center: PlacedPoint; radius: number; axis: PlacedPoint };
  edges: PlacedEdge[];
};

export type PlacedSweep = {
  pierced: boolean;
  tangent: PlacedPoint;
  outer: PlacedLoop;
  hole?: PlacedLoop;
  path: PlacedLoop;
  pathClosed: boolean;
};

function newell(edges: PlacedEdge[]): SweepVec3 {
  const points: PlacedPoint[] = [];
  for (const edge of edges) points.push(edge.from);
  let x = 0;
  let y = 0;
  let z = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  return { x, y, z };
}

function reverseEdges(edges: PlacedEdge[]): PlacedEdge[] {
  return [...edges].reverse().map((edge) => {
    if (edge.kind === "line") return { kind: "line", from: edge.to, to: edge.from };
    if (edge.kind === "arc") return { kind: "arc", from: edge.to, mid: edge.mid, to: edge.from };
    return { kind: "bezier", from: edge.to, c1: edge.c2, c2: edge.c1, to: edge.from };
  });
}

function edgesOnSection(chain: SweepChain, map: (point: SweepUv) => PlacedPoint): PlacedEdge[] {
  if (chain.curve?.kind === "arc") {
    return [{
      kind: "arc",
      from: map(chain.curve.start),
      mid: map(chain.curve.mid),
      to: map(chain.curve.end),
    }];
  }
  const edges: PlacedEdge[] = [];
  let index = 0;
  while (index < chain.steps.length) {
    const step = chain.steps[index];
    const run = step.curveId;
    if (step.arc && run) {
      edges.push({
        kind: "arc",
        from: map(step.arc.start),
        mid: map(step.arc.mid),
        to: map(step.arc.end),
      });
      while (index < chain.steps.length && chain.steps[index].curveId === run) index += 1;
      continue;
    }
    if (step.kind === "bezier" && step.c1 && step.c2) {
      edges.push({ kind: "bezier", from: map(step.from), c1: map(step.c1), c2: map(step.c2), to: map(step.to) });
    } else {
      edges.push({ kind: "line", from: map(step.from), to: map(step.to) });
    }
    index += 1;
  }
  return edges;
}

function alignToTangent(loop: PlacedLoop, tangent: SweepVec3): PlacedLoop {
  if (loop.circle || loop.edges.length < 3) return loop;
  const normal = newell(loop.edges);
  if (dot(normal, tangent) >= 0) return loop;
  return { ...loop, edges: reverseEdges(loop.edges) };
}

/** Start point, travel direction, and the across / up directions of the path, in world space. */
function pathStartFrame(path: SweepChain, planeInput?: SketchPlane | null) {
  const plane = resolveSketchPlane(planeInput);
  const vAxis = sketchPlaneVAxis(plane);
  const tangentUv = startTangentUv(path);
  if (!tangentUv) return null;
  const tangent = planeDirection(plane, vAxis, tangentUv);
  const across = planeDirection(plane, vAxis, uv(-tangentUv.z, tangentUv.x));
  const up = normalize(plane.normal);
  if (!tangent || !across || !up) return null;
  return { plane, vAxis, tangent, across, up, start: planePoint(plane, vAxis, pathStartUv(path)) };
}

/**
 * The sheet a cross-section is drawn on: standing across the start of the path, facing along it.
 * Its origin is the path start and its X runs across the path. The flat sketch view draws V
 * downward on screen, so V points down into the path's own sheet: a shape drawn above the
 * horizontal axis on screen sits on top of that sheet, seen from behind the path start.
 */
export function sweepSectionPlane(path: SweepChain, planeInput?: SketchPlane | null): SketchPlane | null {
  const frame = pathStartFrame(path, planeInput);
  if (!frame) return null;
  const candidate: SketchPlane = { origin: frame.start, normal: frame.tangent, uAxis: frame.across };
  // V = normal × U; flip U if that would point V up off the path's sheet.
  const uAxis = dot(sketchPlaneVAxis(candidate), frame.up) <= 0 ? frame.across : { x: -frame.across.x, y: -frame.across.y, z: -frame.across.z };
  return { origin: frame.start, normal: frame.tangent, uAxis };
}

/**
 * Largest sketch Z of the outline: its bottom edge on screen, because the flat sketch view draws
 * Z downward. The stood-up profile rests on the sheet there, the right way up as it was drawn.
 */
function screenBottomZ(outline: SweepOutline) {
  if (outline.curve?.kind === "circle") return outline.curve.cz + outline.curve.radius;
  return Math.max(...outline.points.map((point) => point.z));
}

/** Middle of a profile drawn on its own sheet; its position there means nothing. */
function profileCentre(outline: SweepOutline): SweepUv {
  if (outline.curve?.kind === "circle") return uv(outline.curve.cx, outline.curve.cz);
  const xs = outline.points.map((point) => point.x);
  return uv((Math.min(...xs) + Math.max(...xs)) / 2, 0);
}

/**
 * Stand the outline up on the start of the path.
 * Sketch X runs across the path, centred on it (right on screen is right, looking along the path).
 * Screen up on the drawing is up off the sheet, and the outline's bottom edge rests on the sheet,
 * so the part sits on top of it like an extrude, the same way up as it was drawn.
 */
export function placeSketchSweep(
  outline: SweepOutline,
  path: SweepChain,
  planeInput?: SketchPlane | null,
  options: { standingSection?: boolean; separateSection?: boolean } = {},
): PlacedSweep | null {
  const plane = resolveSketchPlane(planeInput);
  const vAxis = sketchPlaneVAxis(plane);
  const tangentUv = startTangentUv(path);
  if (!tangentUv) return null;
  const tangent = planeDirection(plane, vAxis, tangentUv);
  if (!tangent) return null;
  const acrossUv = uv(-tangentUv.z, tangentUv.x);
  const across = planeDirection(plane, vAxis, acrossUv);
  const normal = normalize(plane.normal);
  if (!across || !normal) return null;
  // On its own sheet the profile cannot touch the path, so it is simply centred on it.
  const anchor = options.separateSection ? { at: profileCentre(outline), pierced: false } : sweepAnchor(outline, path);
  const pathStart = planePoint(plane, vAxis, pathStartUv(path));
  const bottom = screenBottomZ(outline);
  const sectionSheet = options.standingSection ? sweepSectionPlane(path, planeInput) : null;
  if (options.standingSection && !sectionSheet) return null;
  const sectionOf = sectionSheet
    // Drawn on the cross-section sheet: use it exactly where it was drawn on that sheet.
    ? (point: SweepUv) => planePoint(sectionSheet, sketchPlaneVAxis(sectionSheet), point)
    : (point: SweepUv) => add(
      pathStart,
      add(
        { x: across.x * (point.x - anchor.at.x), y: across.y * (point.x - anchor.at.x), z: across.z * (point.x - anchor.at.x) },
        { x: normal.x * (bottom - point.z), y: normal.y * (bottom - point.z), z: normal.z * (bottom - point.z) },
      ),
    );
  const onPlane = (point: SweepUv) => planePoint(plane, vAxis, point);

  const loopOf = (chain: SweepChain, map: (point: SweepUv) => PlacedPoint, axis: SweepVec3): PlacedLoop => {
    if (chain.curve?.kind === "circle") {
      return {
        circle: { center: map(uv(chain.curve.cx, chain.curve.cz)), radius: chain.curve.radius, axis },
        edges: [],
      };
    }
    return { edges: edgesOnSection(chain, map) };
  };

  const hole = outline.holes.length === 1 ? outline.holes[0] : undefined;
  const outer = alignToTangent(loopOf(outline, sectionOf, tangent), tangent);
  const placedHole = hole ? alignToTangent(loopOf(hole, sectionOf, tangent), tangent) : undefined;
  const pathLoop = loopOf(path, onPlane, normal);
  return {
    pierced: !sectionSheet && anchor.pierced,
    tangent,
    outer,
    hole: placedHole,
    path: pathLoop,
    pathClosed: path.closed,
  };
}
