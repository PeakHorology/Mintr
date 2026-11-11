import { closedProfilesFromDoc } from "./profiles";
import type {
  SketchDefinitionStatus,
  SketchDimension,
  SketchDoc,
  SketchPointEntity,
  SketchSolveResult,
} from "./types";
import { cloneSketchDoc } from "./migrate";
import { solveSimultaneously, type SimultaneousSolve, type SimultaneousSolveOptions } from "./simultaneousSolver";

type PointVar = { id: string; x: number; z: number; fixed: boolean };

function getPoints(doc: SketchDoc): Map<string, PointVar> {
  const map = new Map<string, PointVar>();
  for (const entity of doc.entities) {
    if (entity.kind !== "point") continue;
    map.set(entity.id, {
      id: entity.id,
      x: entity.x,
      z: entity.z,
      fixed: Boolean(entity.fixed),
    });
  }
  return map;
}

function lineEndpoints(doc: SketchDoc, lineId: string, points: Map<string, PointVar>) {
  const line = doc.entities.find((e) => e.id === lineId && e.kind === "line");
  if (!line || line.kind !== "line") return null;
  const a = points.get(line.startId);
  const b = points.get(line.endId);
  if (!a || !b) return null;
  return { line, a, b };
}

/** Place a line on an exact direction and length. A fixed end stays put and the free end moves. */
function placeLine(a: PointVar, b: PointVar, dirX: number, dirZ: number, length: number) {
  if (a.fixed && !b.fixed) return applyExact(b, a.x + dirX * length, a.z + dirZ * length);
  if (!a.fixed && b.fixed) return applyExact(a, b.x - dirX * length, b.z - dirZ * length);
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const hx = (dirX * length) / 2;
  const hz = (dirZ * length) / 2;
  return applyExact(a, mx - hx, mz - hz) + applyExact(b, mx + hx, mz + hz);
}

/** Exact set for hard constraints — residual is the prior error that was removed. */
function applyExact(target: PointVar, goalX: number, goalZ: number) {
  if (target.fixed) return 0;
  const err = Math.hypot(goalX - target.x, goalZ - target.z);
  target.x = goalX;
  target.z = goalZ;
  return err;
}

function solveOnce(doc: SketchDoc, points: Map<string, PointVar>): number {
  let error = 0;
  const active = doc.constraints.filter((c) => !c.suppressed);

  for (const c of active) {
    switch (c.kind) {
      case "fix": {
        for (const id of c.entityIds) {
          const p = points.get(id);
          if (p) p.fixed = true;
        }
        break;
      }
      case "coincident": {
        const ids = [...(c.pointIds ?? []), ...c.entityIds.filter((id) => points.has(id))];
        if (ids.length < 2) break;
        const pts = ids.map((id) => points.get(id)).filter(Boolean) as PointVar[];
        const free = pts.filter((p) => !p.fixed);
        const anchors = pts.filter((p) => p.fixed);
        const ax = anchors.length ? anchors.reduce((s, p) => s + p.x, 0) / anchors.length : pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const az = anchors.length ? anchors.reduce((s, p) => s + p.z, 0) / anchors.length : pts.reduce((s, p) => s + p.z, 0) / pts.length;
        for (const p of free) error += applyExact(p, ax, az);
        break;
      }
      case "horizontal": {
        const line = c.entityIds[0] ? lineEndpoints(doc, c.entityIds[0], points) : null;
        if (line) {
          const midZ = (line.a.fixed && !line.b.fixed)
            ? line.a.z
            : (!line.a.fixed && line.b.fixed)
              ? line.b.z
              : (line.a.z + line.b.z) / 2;
          error += applyExact(line.a, line.a.x, midZ);
          error += applyExact(line.b, line.b.x, midZ);
        } else if (c.pointIds && c.pointIds.length >= 2) {
          const a = points.get(c.pointIds[0]);
          const b = points.get(c.pointIds[1]);
          if (a && b) {
            const midZ = (a.fixed && !b.fixed) ? a.z : (!a.fixed && b.fixed) ? b.z : (a.z + b.z) / 2;
            error += applyExact(a, a.x, midZ);
            error += applyExact(b, b.x, midZ);
          }
        }
        break;
      }
      case "vertical": {
        const line = c.entityIds[0] ? lineEndpoints(doc, c.entityIds[0], points) : null;
        if (line) {
          const midX = (line.a.fixed && !line.b.fixed)
            ? line.a.x
            : (!line.a.fixed && line.b.fixed)
              ? line.b.x
              : (line.a.x + line.b.x) / 2;
          error += applyExact(line.a, midX, line.a.z);
          error += applyExact(line.b, midX, line.b.z);
        } else if (c.pointIds && c.pointIds.length >= 2) {
          const a = points.get(c.pointIds[0]);
          const b = points.get(c.pointIds[1]);
          if (a && b) {
            const midX = (a.fixed && !b.fixed) ? a.x : (!a.fixed && b.fixed) ? b.x : (a.x + b.x) / 2;
            error += applyExact(a, midX, a.z);
            error += applyExact(b, midX, b.z);
          }
        }
        break;
      }
      case "parallel":
      case "perpendicular": {
        if (c.entityIds.length < 2) break;
        const l1 = lineEndpoints(doc, c.entityIds[0], points);
        const l2 = lineEndpoints(doc, c.entityIds[1], points);
        if (!l1 || !l2) break;
        const v1x = l1.b.x - l1.a.x;
        const v1z = l1.b.z - l1.a.z;
        const len1 = Math.hypot(v1x, v1z) || 1;
        let tx = v1x / len1;
        let tz = v1z / len1;
        if (c.kind === "perpendicular") {
          tx = -tz;
          tz = v1x / len1;
        }
        const v2x = l2.b.x - l2.a.x;
        const v2z = l2.b.z - l2.a.z;
        if (v2x * tx + v2z * tz < 0) {
          tx = -tx;
          tz = -tz;
        }
        const len2 = Math.hypot(v2x, v2z) || 1;
        error += placeLine(l2.a, l2.b, tx, tz, len2);
        break;
      }
      case "equal": {
        if (c.entityIds.length < 2) break;
        const l1 = lineEndpoints(doc, c.entityIds[0], points);
        const l2 = lineEndpoints(doc, c.entityIds[1], points);
        if (!l1 || !l2) break;
        const len1 = Math.hypot(l1.b.x - l1.a.x, l1.b.z - l1.a.z);
        const v2x = l2.b.x - l2.a.x;
        const v2z = l2.b.z - l2.a.z;
        const len2 = Math.hypot(v2x, v2z);
        if (len2 < 1e-9) break;
        error += placeLine(l2.a, l2.b, v2x / len2, v2z / len2, len1);
        break;
      }
      case "midpoint": {
        const line = c.entityIds[0] ? lineEndpoints(doc, c.entityIds[0], points) : null;
        const midPoint = c.pointIds?.[0] ? points.get(c.pointIds[0]) : null;
        if (!line || !midPoint) break;
        error += applyExact(midPoint, (line.a.x + line.b.x) / 2, (line.a.z + line.b.z) / 2);
        break;
      }
      case "concentric": {
        const ids = c.entityIds
          .map((id) => {
            const circle = doc.entities.find((e) => e.id === id && e.kind === "circle");
            return circle && circle.kind === "circle" ? circle.centerId : id;
          })
          .filter((id) => points.has(id));
        if (ids.length >= 2) {
          const a = points.get(ids[0])!;
          const b = points.get(ids[1])!;
          const anchors = [a, b].filter((p) => p.fixed);
          const mx = anchors.length ? anchors.reduce((s, p) => s + p.x, 0) / anchors.length : (a.x + b.x) / 2;
          const mz = anchors.length ? anchors.reduce((s, p) => s + p.z, 0) / anchors.length : (a.z + b.z) / 2;
          error += applyExact(a, mx, mz);
          error += applyExact(b, mx, mz);
        }
        break;
      }
      case "tangent": {
        error += applyTangent(doc, c.entityIds, points);
        break;
      }
      case "symmetry": {
        error += applySymmetry(doc, c, points);
        break;
      }
      default:
        break;
    }
  }

  // Driving dimensions
  for (const dim of doc.dimensions) {
    if (!dim.driving) continue;
    error += applyDimension(doc, dim, points);
  }

  return error;
}

function applyDimension(doc: SketchDoc, dim: SketchDimension, points: Map<string, PointVar>): number {
  let error = 0;
  if (dim.kind === "linear") {
    let a: PointVar | undefined;
    let b: PointVar | undefined;
    if (dim.pointIds && dim.pointIds.length >= 2) {
      a = points.get(dim.pointIds[0]);
      b = points.get(dim.pointIds[1]);
    } else if (dim.entityIds[0]) {
      const line = lineEndpoints(doc, dim.entityIds[0], points);
      if (line) {
        a = line.a;
        b = line.b;
      }
    }
    if (!a || !b) return 0;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const rawLen = Math.hypot(dx, dz);
    // A collapsed line has no direction to scale along, so the old `dx * (value / len)`
    // stayed 0: the dimension reported zero error while the line sat at length 0 forever.
    // Grow it along the sketch U axis instead so the driving length is reachable.
    const degenerate = rawLen < 1e-9;
    const ux = degenerate ? 1 : dx / rawLen;
    const uz = degenerate ? 0 : dz / rawLen;
    if (a.fixed && !b.fixed) {
      error += applyExact(b, a.x + ux * dim.value, a.z + uz * dim.value);
    } else if (!a.fixed && b.fixed) {
      error += applyExact(a, b.x - ux * dim.value, b.z - uz * dim.value);
    } else {
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const hx = (ux * dim.value) / 2;
      const hz = (uz * dim.value) / 2;
      error += applyExact(a, mx - hx, mz - hz);
      error += applyExact(b, mx + hx, mz + hz);
    }
  } else if (dim.kind === "radius" || dim.kind === "diameter") {
    const circle = doc.entities.find((e) => e.id === dim.entityIds[0] && e.kind === "circle");
    if (!circle || circle.kind !== "circle") return 0;
    const targetR = dim.kind === "diameter" ? dim.value / 2 : dim.value;
    // A typed 0 or negative dimension would collapse the circle to a point (or
    // flip it) and every later tangency would divide by that radius.
    if (Number.isFinite(targetR) && targetR > 0) circle.radius = Math.max(0.01, targetR);
  } else if (dim.kind === "angular" && dim.entityIds.length >= 2) {
    // Turn the second line to the angle, on the side it already sits, measured from a shared corner outwards.
    const l1 = lineEndpoints(doc, dim.entityIds[0], points);
    const l2 = lineEndpoints(doc, dim.entityIds[1], points);
    if (!l1 || !l2) return 0;
    const firstFlip = l1.b === l2.a || l1.b === l2.b ? -1 : 1;
    const secondFlip = l2.b === l1.a || l2.b === l1.b ? -1 : 1;
    const a1 = Math.atan2((l1.b.z - l1.a.z) * firstFlip, (l1.b.x - l1.a.x) * firstFlip);
    const ux = Math.cos(a1);
    const uz = Math.sin(a1);
    const vx = (l2.b.x - l2.a.x) * secondFlip;
    const vz = (l2.b.z - l2.a.z) * secondFlip;
    const side = ux * vz - uz * vx < 0 ? -1 : 1;
    const target = a1 + side * (Math.abs(dim.value) * Math.PI) / 180;
    const len2 = Math.hypot(vx, vz) || 1;
    error += placeLine(l2.a, l2.b, Math.cos(target) * secondFlip, Math.sin(target) * secondFlip, len2);
  }
  return error;
}

function applyTangent(doc: SketchDoc, entityIds: string[], points: Map<string, PointVar>): number {
  if (entityIds.length < 2) return 0;
  const a = doc.entities.find((e) => e.id === entityIds[0]);
  const b = doc.entities.find((e) => e.id === entityIds[1]);
  if (!a || !b) return 0;

  const asCircle = (e: typeof a) => (e.kind === "circle" ? e : null);
  const asLine = (e: typeof a) => (e.kind === "line" ? e : null);
  const circleA = asCircle(a);
  const circleB = asCircle(b);
  const lineA = asLine(a);
  const lineB = asLine(b);

  // Line–circle: distance(center, line) ≈ radius
  const line = lineA ?? lineB;
  const circle = circleA ?? circleB;
  if (line && circle && circle.kind === "circle") {
    const ends = lineEndpoints(doc, line.id, points);
    const center = points.get(circle.centerId);
    if (!ends || !center) return 0;
    const dx = ends.b.x - ends.a.x;
    const dz = ends.b.z - ends.a.z;
    const len = Math.hypot(dx, dz) || 1e-9;
    const nx = -dz / len;
    const nz = dx / len;
    const dist = (center.x - ends.a.x) * nx + (center.z - ends.a.z) * nz;
    const target = circle.radius * Math.sign(dist || 1);
    const delta = target - dist;
    if (!center.fixed) return applyExact(center, center.x + nx * delta, center.z + nz * delta);
    return applyExact(ends.a, ends.a.x - nx * delta, ends.a.z - nz * delta)
      + applyExact(ends.b, ends.b.x - nx * delta, ends.b.z - nz * delta);
  }

  // Circle–circle: external tangent |d − (r1+r2)| → 0
  if (circleA && circleB && circleA.kind === "circle" && circleB.kind === "circle") {
    const c1 = points.get(circleA.centerId);
    const c2 = points.get(circleB.centerId);
    if (!c1 || !c2) return 0;
    const dx = c2.x - c1.x;
    const dz = c2.z - c1.z;
    const dist = Math.hypot(dx, dz) || 1e-9;
    const target = circleA.radius + circleB.radius;
    const scale = target / dist;
    const mx = (c1.x + c2.x) / 2;
    const mz = (c1.z + c2.z) / 2;
    const hx = (dx * scale) / 2;
    const hz = (dz * scale) / 2;
    return applyExact(c1, mx - hx, mz - hz) + applyExact(c2, mx + hx, mz + hz);
  }

  return 0;
}

function applySymmetry(
  doc: SketchDoc,
  constraint: { entityIds: string[]; pointIds?: string[] },
  points: Map<string, PointVar>,
): number {
  const axisLineId = constraint.entityIds[constraint.entityIds.length - 1];
  const axis = lineEndpoints(doc, axisLineId, points);
  if (!axis) return 0;
  const ax = axis.b.x - axis.a.x;
  const az = axis.b.z - axis.a.z;
  const len2 = ax * ax + az * az || 1;
  const reflect = (x: number, z: number) => {
    const px = x - axis.a.x;
    const pz = z - axis.a.z;
    const t = (px * ax + pz * az) / len2;
    const projX = axis.a.x + ax * t;
    const projZ = axis.a.z + az * t;
    return { x: 2 * projX - x, z: 2 * projZ - z };
  };

  const pairIds = (constraint.pointIds && constraint.pointIds.length >= 2)
    ? constraint.pointIds.slice(0, 2)
    : constraint.entityIds.slice(0, 2);
  if (pairIds.length < 2) return 0;

  const resolvePoint = (id: string): PointVar | null => {
    if (points.has(id)) return points.get(id)!;
    const circle = doc.entities.find((e) => e.id === id && e.kind === "circle");
    if (circle && circle.kind === "circle") return points.get(circle.centerId) ?? null;
    const line = lineEndpoints(doc, id, points);
    if (line) {
      // Symmetry of line midpoints when whole lines are paired
      return null;
    }
    return null;
  };

  const pA = resolvePoint(pairIds[0]);
  const pB = resolvePoint(pairIds[1]);
  if (pA && pB) return projectSymmetricPair(pA, pB, reflect);

  const l1 = lineEndpoints(doc, pairIds[0], points);
  const l2 = lineEndpoints(doc, pairIds[1], points);
  if (!l1 || !l2) return 0;
  return projectSymmetricPair(l1.a, l2.a, reflect) + projectSymmetricPair(l1.b, l2.b, reflect);
}

/** One exact step onto B = reflect(A). Both free: split the gap. One fixed: the other snaps. */
function projectSymmetricPair(
  a: PointVar,
  b: PointVar,
  reflect: (x: number, z: number) => { x: number; z: number },
) {
  if (a.fixed && !b.fixed) {
    const reflected = reflect(a.x, a.z);
    return applyExact(b, reflected.x, reflected.z);
  }
  if (!a.fixed && b.fixed) {
    const reflected = reflect(b.x, b.z);
    return applyExact(a, reflected.x, reflected.z);
  }
  const mirrored = reflect(b.x, b.z);
  const ax = (a.x + mirrored.x) / 2;
  const az = (a.z + mirrored.z) / 2;
  const bx = reflect(ax, az);
  return applyExact(a, ax, az) + applyExact(b, bx.x, bx.z);
}

/** The old one-rule-at-a-time solve: each rule snaps in turn until they all settle. */
function solveStepwise(input: SketchDoc, iterations: number): SketchDoc {
  const doc = cloneSketchDoc(input);
  const points = getPoints(doc);
  for (const c of doc.constraints) {
    if (c.kind === "fix" && !c.suppressed) {
      for (const id of c.entityIds) {
        const p = points.get(id);
        if (p) p.fixed = true;
      }
    }
  }
  for (let i = 0; i < iterations; i += 1) {
    if (solveOnce(doc, points) < 1e-5) break;
  }
  doc.entities = doc.entities.map((entity) => {
    if (entity.kind !== "point") return entity;
    const p = points.get(entity.id);
    if (!p) return entity;
    return { ...entity, x: p.x, z: p.z } satisfies SketchPointEntity;
  });
  return doc;
}

/** The sketch with the simultaneous answer written in. Points held by a Fix rule are marked fixed. */
function withSolvedGeometry(input: SketchDoc, solved: SimultaneousSolve): SketchDoc {
  const doc = cloneSketchDoc(input);
  doc.entities = doc.entities.map((entity) => {
    if (entity.kind === "point") {
      const point = solved.points.get(entity.id);
      if (!point) return entity;
      return { ...entity, x: point.x, z: point.z, fixed: point.fixed || entity.fixed } satisfies SketchPointEntity;
    }
    if (entity.kind === "circle") {
      const radius = solved.radii.get(entity.id);
      return radius === undefined || radius === entity.radius ? entity : { ...entity, radius };
    }
    return entity;
  });
  return doc;
}

function definitionOf(doc: SketchDoc, solved: SimultaneousSolve): { status: SketchDefinitionStatus; dof: number; conflicts: string[] } {
  if (!doc.entities.some((entity) => entity.kind === "point" || entity.kind === "circle")) {
    return { status: "empty", dof: 0, conflicts: [] };
  }
  if (solved.unsatisfied.length) {
    // Rules that repeat each other and do not hold are too many rules; a rule nothing can move to meet needs a fix.
    const fighting = solved.unsatisfied.some((id) => solved.redundant.includes(id));
    const conflicts = fighting
      ? [...new Set([...solved.unsatisfied, ...solved.redundant])]
      : solved.unsatisfied;
    return { status: fighting ? "over-constrained" : "unsolved", dof: solved.dof, conflicts: conflicts.slice(0, 8) };
  }
  return { status: solved.dof === 0 ? "fully-defined" : "under-defined", dof: solved.dof, conflicts: [] };
}

export type SolveSketchOptions = Pick<SimultaneousSolveOptions, "holdPointIds">;

/**
 * Constraint solve. Every constraint and driving dimension is solved together, moving the
 * drawing as little as it can. A sketch is fully defined only when nothing is left free to move
 * and every rule holds.
 */
export function solveSketchDoc(input: SketchDoc, iterations = 40, options: SolveSketchOptions = {}): SketchSolveResult {
  let solved = solveSimultaneously(input, { holdPointIds: options.holdPointIds, iterations: Math.max(iterations, 60) });
  let doc = withSolvedGeometry(input, solved);
  if (solved.unsatisfied.length) {
    // A sketch the simultaneous solve could not settle gets the old step-by-step pass too, and keeps whichever lands closer.
    const stepwise = solveStepwise(input, iterations);
    const check = solveSimultaneously(stepwise, { iterations: 0 });
    if (check.worst < solved.worst) {
      solved = check;
      doc = withSolvedGeometry(stepwise, check);
    }
  }
  const { status, dof, conflicts } = definitionOf(doc, solved);
  return { doc, status, dof, conflicts, profiles: closedProfilesFromDoc(doc) };
}

export function setDrivingDimensionValue(doc: SketchDoc, dimensionId: string, value: number): SketchSolveResult {
  const next = cloneSketchDoc(doc);
  next.dimensions = next.dimensions.map((d) => (d.id === dimensionId ? { ...d, value: Math.max(1e-6, value) } : d));
  return solveSketchDoc(next);
}

export function addLinearDimension(
  doc: SketchDoc,
  args: { entityId?: string; pointIds?: string[]; value: number; driving?: boolean },
): SketchSolveResult {
  const next = cloneSketchDoc(doc);
  next.dimensions.push({
    id: `d-${Math.random().toString(36).slice(2, 10)}`,
    kind: "linear",
    entityIds: args.entityId ? [args.entityId] : [],
    pointIds: args.pointIds,
    value: args.value,
    driving: args.driving !== false,
  });
  return solveSketchDoc(next);
}

export function addRadiusDimension(
  doc: SketchDoc,
  circleId: string,
  value: number,
  asDiameter = false,
): SketchSolveResult {
  const next = cloneSketchDoc(doc);
  next.dimensions.push({
    id: `d-${Math.random().toString(36).slice(2, 10)}`,
    kind: asDiameter ? "diameter" : "radius",
    entityIds: [circleId],
    value,
    driving: true,
  });
  return solveSketchDoc(next);
}

/** The angle in degrees from the first line to the second, measured the short way (0–180). */
export function angleBetweenSketchLines(doc: SketchDoc, firstLineId: string, secondLineId: string): number | null {
  const points = getPoints(doc);
  const first = lineEndpoints(doc, firstLineId, points);
  const second = lineEndpoints(doc, secondLineId, points);
  if (!first || !second) return null;
  const ux = first.b.x - first.a.x;
  const uz = first.b.z - first.a.z;
  let vx = second.b.x - second.a.x;
  let vz = second.b.z - second.a.z;
  if (Math.hypot(ux, uz) < 1e-9 || Math.hypot(vx, vz) < 1e-9) return null;
  // Lines that meet are measured from their shared corner outwards.
  const shared = [first.a, first.b].find((point) => point === second.a || point === second.b);
  const firstOut = shared === first.b ? { x: -ux, z: -uz } : { x: ux, z: uz };
  if (shared === second.b) {
    vx = -vx;
    vz = -vz;
  }
  const angle = (Math.atan2(firstOut.x * vz - firstOut.z * vx, firstOut.x * vx + firstOut.z * vz) * 180) / Math.PI;
  return Math.abs(angle);
}

export function addAngularDimension(doc: SketchDoc, firstLineId: string, secondLineId: string, value: number): SketchSolveResult {
  const next = cloneSketchDoc(doc);
  next.dimensions.push({
    id: `d-${Math.random().toString(36).slice(2, 10)}`,
    kind: "angular",
    entityIds: [firstLineId, secondLineId],
    value,
    driving: true,
  });
  return solveSketchDoc(next);
}

/** A dimension in plain words: "Length 20.00 mm", "Angle 30.0°". */
export function sketchDimensionText(dimension: Pick<SketchDimension, "kind" | "value" | "driving">) {
  const text = dimension.kind === "angular"
    ? `Angle ${Math.abs(dimension.value).toFixed(1)}°`
    : `${dimension.kind === "radius" ? "Radius" : dimension.kind === "diameter" ? "Diameter" : "Length"} ${dimension.value.toFixed(2)} mm`;
  return dimension.driving ? text : `${text} (measured)`;
}
