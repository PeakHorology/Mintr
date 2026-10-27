import type { SketchPoint, SketchProfile, SketchSegment } from "@/types/sketchforge";
import { createLocalId } from "@/lib/localIds";
import { curveStandInOwner } from "./migrate";
import type { SketchClosedProfile, SketchDoc, SketchEntity, SketchPointEntity, SketchVec2 } from "./types";

export type OrderedSketchStep = { segment: SketchSegment; from: SketchPoint; to: SketchPoint };
export type OrderedSketchPath = { points: SketchPoint[]; steps: OrderedSketchStep[]; closed: boolean };

/** Region an offset copy belongs to. Loops nest into holes only when this matches. */
export function sketchLoopRegion(steps: ReadonlyArray<{ segment: { regionId?: string } }>): string | null {
  for (const step of steps) {
    if (step.segment.regionId) return step.segment.regionId;
  }
  return null;
}

/**
 * A loop of straight segments whose corners are collinear (drawn out and back
 * along one line) encloses nothing. Reporting it closed sent a zero-area face to
 * the kernel, which either failed or returned an empty solid with no explanation.
 * Curved loops are left alone: a two-point arc-and-line encloses area the
 * corner polygon cannot see.
 */
function straightLoopHasArea(points: SketchPoint[], steps: OrderedSketchStep[]): boolean {
  if (steps.some((step) => step.segment.kind && step.segment.kind !== "line")) return true;
  let twiceArea = 0;
  let extent = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    twiceArea += a.x * b.z - b.x * a.z;
    extent = Math.max(extent, Math.abs(a.x), Math.abs(a.z));
  }
  return Math.abs(twiceArea) > Math.max(1e-9, extent * 1e-6);
}

export function orderedSketchPaths(profile: SketchProfile): OrderedSketchPath[] {
  const pointById = new Map(profile.points.map((point) => [point.id, point]));
  const adjacency = new Map<string, Array<{ pointId: string; segment: SketchSegment }>>();
  profile.points.forEach((point) => adjacency.set(point.id, []));
  const validSegments = profile.segments.filter((segment) => {
    if (!pointById.has(segment.startId) || !pointById.has(segment.endId) || segment.startId === segment.endId) return false;
    adjacency.get(segment.startId)?.push({ pointId: segment.endId, segment });
    adjacency.get(segment.endId)?.push({ pointId: segment.startId, segment });
    return true;
  });
  const unvisited = new Set(validSegments.map((segment) => segment.id));
  const paths: OrderedSketchPath[] = [];
  while (unvisited.size > 0) {
    const seedId = unvisited.values().next().value as string | undefined;
    const seed = validSegments.find((segment) => segment.id === seedId);
    if (!seed) break;
    const componentIds = new Set<string>();
    const queue = [seed.startId, seed.endId];
    while (queue.length > 0) {
      const id = queue.pop();
      if (!id || componentIds.has(id)) continue;
      componentIds.add(id);
      adjacency.get(id)?.forEach((entry) => queue.push(entry.pointId));
    }
    const startId =
      [...componentIds].find((id) => (adjacency.get(id)?.filter((entry) => unvisited.has(entry.segment.id)).length ?? 0) === 1)
      ?? seed.startId;
    const first = pointById.get(startId);
    if (!first) {
      unvisited.delete(seed.id);
      continue;
    }
    const points = [first];
    const steps: OrderedSketchStep[] = [];
    const stepIndexByPoint = new Map<string, number>([[startId, 0]]);
    let currentId = startId;
    let loopStart: number | null = null;
    for (let guard = 0; guard <= validSegments.length; guard += 1) {
      const edge = adjacency.get(currentId)?.find((entry) => unvisited.has(entry.segment.id));
      if (!edge) break;
      const from = pointById.get(currentId);
      const to = pointById.get(edge.pointId);
      if (!from || !to) break;
      unvisited.delete(edge.segment.id);
      steps.push({ segment: edge.segment, from, to });
      currentId = to.id;
      const seenAt = stepIndexByPoint.get(currentId);
      if (seenAt !== undefined) {
        // Walked back onto our own trail. Only comparing against startId meant that a single
        // stray segment touching a corner made the walk begin at the dangling end, so the return
        // to the corner did not register and an otherwise closed loop was reported open — the
        // sketch then had no profile at all and would not extrude.
        loopStart = seenAt;
        break;
      }
      stepIndexByPoint.set(currentId, points.length);
      points.push(to);
    }

    if (loopStart === null) {
      // A second face that shares a side with one we already walked has no unused edge left
      // to close on. Its two ends are still joined by that shared side, so the chain is a loop.
      const closing = points.length >= 3 && currentId !== startId
        ? adjacency.get(currentId)?.find((entry) => entry.pointId === startId)
        : undefined;
      if (closing) {
        const from = pointById.get(currentId);
        const to = pointById.get(startId);
        if (from && to) {
          unvisited.delete(closing.segment.id);
          steps.push({ segment: closing.segment, from, to });
          paths.push({ points, steps, closed: straightLoopHasArea(points, steps) });
          continue;
        }
      }
      paths.push({ points, steps, closed: false });
      continue;
    }
    if (loopStart > 0) {
      // The tail that led into the loop is its own open path.
      paths.push({
        points: points.slice(0, loopStart + 1),
        steps: steps.slice(0, loopStart),
        closed: false,
      });
    }
    const loopSteps = steps.slice(loopStart);
    const loopPoints = points.slice(loopStart);
    paths.push({ points: loopPoints, steps: loopSteps, closed: loopSteps.length >= 3 && straightLoopHasArea(loopPoints, loopSteps) });
  }
  return paths;
}

/**
 * Closed regions the cutter should build.
 *
 * Two faces that share a side (a rectangle, then a triangle drawn on that side) are both loops.
 * Extruding them separately stacks two walls on the shared side and the boolean drops the added
 * face. Drop every side used by two loops and walk what remains: one outline around both.
 * A loop with no shared side, such as a hole inside a profile, stays its own outline.
 */
export function materialOutlines(profile: SketchProfile): OrderedSketchPath[] {
  const solid = {
    ...profile,
    segments: profile.segments.filter((segment) => !segment.construction),
  };
  const closed = orderedSketchPaths(solid).filter((path) => path.closed);
  if (closed.length < 2) return closed;
  const useCount = new Map<string, number>();
  for (const path of closed) {
    for (const step of path.steps) {
      useCount.set(step.segment.id, (useCount.get(step.segment.id) ?? 0) + 1);
    }
  }
  const internal = new Set(
    [...useCount.entries()].filter(([, count]) => count >= 2).map(([id]) => id),
  );
  if (internal.size === 0) return closed;
  const boundary = orderedSketchPaths({
    ...solid,
    segments: solid.segments.filter((segment) => !internal.has(segment.id)),
  }).filter((path) => path.closed);
  return boundary.length > 0 ? boundary : closed;
}

/** Gap under which an open chain is treated as closed. A 3D click on a corner dot can land a millimetre off. */
const CLOSE_GAP_MM = 1.25;

/**
 * Join an open chain back to its start when the two ends are only a small gap apart.
 * Line sketches drawn on the 3D view often miss the first point by a fraction of a millimetre,
 * so the chain looks closed and then extrudes as nothing.
 */
export function closeOpenPathGaps(profile: SketchProfile, gapMm = CLOSE_GAP_MM): SketchProfile {
  const extra: SketchSegment[] = [];
  const existing = new Set(profile.segments.map((segment) => [segment.startId, segment.endId].sort().join("|")));
  for (const path of orderedSketchPaths(profile)) {
    if (path.closed || path.points.length < 3) continue;
    if (path.steps.some((step) => step.segment.construction)) continue;
    const first = path.points[0];
    const last = path.points[path.points.length - 1];
    if (first.id === last.id) continue;
    if (Math.hypot(first.x - last.x, first.z - last.z) > gapMm) continue;
    const key = [first.id, last.id].sort().join("|");
    if (existing.has(key)) continue;
    existing.add(key);
    extra.push({
      id: createLocalId("sketch-segment"),
      startId: last.id,
      endId: first.id,
      kind: "line",
    });
  }
  if (extra.length === 0) return profile;
  return { ...profile, segments: [...profile.segments, ...extra] };
}

function pointInPolygon(point: SketchVec2, polygon: SketchVec2[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;
    const intersect = zi > point.z !== zj > point.z && point.x < ((xj - xi) * (point.z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Samples per curved segment when measuring a loop. Enough that area settles to ~0.1%. */
const CURVE_MEASURE_SAMPLES = 16;

function cubicPoint(
  start: SketchVec2,
  control1: SketchVec2,
  control2: SketchVec2,
  end: SketchVec2,
  t: number,
): SketchVec2 {
  const inv = 1 - t;
  return {
    x: inv ** 3 * start.x + 3 * inv ** 2 * t * control1.x + 3 * inv * t ** 2 * control2.x + t ** 3 * end.x,
    z: inv ** 3 * start.z + 3 * inv ** 2 * t * control1.z + 3 * inv * t ** 2 * control2.z + t ** 3 * end.z,
  };
}

/**
 * Outline of a loop with its curved segments sampled.
 *
 * Measuring and testing containment against the bare anchor points treated a bezier loop as its
 * inscribed polygon — a circle drawn from four anchors measured as a square of 2r² rather than πr².
 * That understated area could invert which loop was considered the outer one, and containment tests
 * against the shrunken outline missed holes sitting near a curved boundary.
 */
export function sampledPathOutline(path: OrderedSketchPath): SketchVec2[] {
  if (path.steps.length === 0) return path.points.map((point) => ({ x: point.x, z: point.z }));
  const outline: SketchVec2[] = [];
  for (const { segment, from, to } of path.steps) {
    outline.push({ x: from.x, z: from.z });
    if (segment.kind === "line") continue;
    const forward = segment.startId === from.id;
    const control1 = forward ? from.handleOut : from.handleIn;
    const control2 = forward ? to.handleIn : to.handleOut;
    if (!control1 || !control2) continue;
    for (let step = 1; step < CURVE_MEASURE_SAMPLES; step += 1) {
      outline.push(cubicPoint(from, control1, control2, to, step / CURVE_MEASURE_SAMPLES));
    }
  }
  // Closed paths wrap back to the first point, so the final `to` is already the outline's head.
  if (!path.closed) {
    const last = path.steps[path.steps.length - 1].to;
    outline.push({ x: last.x, z: last.z });
  }
  return outline;
}

function polygonArea(points: SketchVec2[]) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) * 0.5;
}

function polygonCentroid(points: SketchVec2[]): SketchVec2 {
  let cx = 0;
  let cz = 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.z - b.x * a.z;
    area += cross;
    cx += (a.x + b.x) * cross;
    cz += (a.z + b.z) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    const n = points.length || 1;
    return {
      x: points.reduce((sum, p) => sum + p.x, 0) / n,
      z: points.reduce((sum, p) => sum + p.z, 0) / n,
    };
  }
  return { x: cx / (3 * area), z: cz / (3 * area) };
}

/** Closed profiles from a legacy point/segment graph (nested loops become holes). */
export function closedProfilesFromLegacy(profile: SketchProfile): SketchClosedProfile[] {
  const solid = {
    ...profile,
    segments: profile.segments.filter((segment) => !segment.construction),
  };
  const closed = materialOutlines(solid);
  const loops = closed.map((path, index) => {
    // Measure the curve, not the anchors it was drawn from.
    const outline = sampledPathOutline(path);
    return {
      id: `profile-${index}`,
      regionId: sketchLoopRegion(path.steps),
      pointIds: path.points.map((p) => p.id),
      holePointIdLoops: [] as string[][],
      area: polygonArea(outline),
      centroid: polygonCentroid(outline),
      points: outline,
    };
  });
  loops.sort((a, b) => b.area - a.area);

  // Nest by containment depth against every larger loop. Claiming any smaller contained loop as a
  // hole of the outermost one meant a solid island inside a hole (a post standing in a bore) was
  // recorded as a second hole; cutting it from already-void space did nothing, so the island
  // silently vanished. Even depth is material, odd depth is a void.
  type Loop = (typeof loops)[number];
  const parentById = new Map<string, Loop | null>();
  const depthById = new Map<string, number>();
    loops.forEach((loop, index) => {
    let parent: Loop | null = null;
    for (let j = 0; j < index; j += 1) {
      const candidate = loops[j];
      // An offset copy has its own region, so sitting inside another outline does not make it a hole.
      if (candidate.regionId !== loop.regionId) continue;
      if (!pointInPolygon(loop.centroid, candidate.points)) continue;
      // Loops are sorted largest first, so the smallest enclosing one is the immediate parent.
      if (!parent || candidate.area < parent.area) parent = candidate;
    }
    parentById.set(loop.id, parent);
    depthById.set(loop.id, parent ? (depthById.get(parent.id) ?? 0) + 1 : 0);
  });

  const holesByParentId = new Map<string, string[][]>();
  for (const loop of loops) {
    if ((depthById.get(loop.id) ?? 0) % 2 === 0) continue;
    const parent = parentById.get(loop.id);
    if (!parent) continue;
    const existing = holesByParentId.get(parent.id) ?? [];
    existing.push(loop.pointIds);
    holesByParentId.set(parent.id, existing);
  }

  return loops
    .filter((loop) => (depthById.get(loop.id) ?? 0) % 2 === 0)
    .map((loop) => ({
      id: loop.id,
      pointIds: loop.pointIds,
      holePointIdLoops: holesByParentId.get(loop.id) ?? [],
      area: loop.area,
      centroid: loop.centroid,
    }));
}

/**
 * Points that translate together when a closed shape is dragged.
 * A circle's fill is a sampled loop (`${circleId}-pN`); the circle itself is
 * drawn from its center. Both have to move, or the circle snaps back on commit.
 */
export function shapeMovePointIds(profile: SketchClosedProfile, entities: readonly SketchEntity[]): string[] {
  const ids = [...profile.pointIds, ...profile.holePointIdLoops.flat()];
  const extra: string[] = [];
  for (const entity of entities) {
    if (entity.kind !== "circle") continue;
    const prefix = `${entity.id}-p`;
    if (ids.some((id) => id.startsWith(prefix)) && !ids.includes(entity.centerId)) extra.push(entity.centerId);
  }
  return extra.length ? [...ids, ...extra] : ids;
}

/**
 * Every edge of one closed shape, including a hole.
 * A click inside the shape uses this. A click on a line does not: that line is patterned alone.
 */
export function closedShapeSelection(
  profile: SketchProfile,
  entities: readonly SketchEntity[],
  hit: { segmentId?: string; profileId?: string },
): { profileId: string; pointIds: string[]; segmentIds: string[] } | null {
  const profiles = closedProfilesFromLegacy(profile);
  let match: SketchClosedProfile | null = null;
  if (hit.profileId) {
    match = profiles.find((entry) => entry.id === hit.profileId) ?? null;
  } else if (hit.segmentId) {
    const segment = profile.segments.find((entry) => entry.id === hit.segmentId);
    const owner = curveStandInOwner(hit.segmentId);
    const candidates = profiles.filter((closed) => {
      const ids = new Set(shapeMovePointIds(closed, entities));
      if (segment && ids.has(segment.startId) && ids.has(segment.endId)) return true;
      if (owner && closed.pointIds.some((id) => curveStandInOwner(id) === owner)) return true;
      if (!segment && closed.pointIds.some((id) => curveStandInOwner(id) === hit.segmentId)) return true;
      return false;
    });
    match = candidates.reduce<SketchClosedProfile | null>((best, closed) => (
      !best || closed.area < best.area ? closed : best
    ), null);
  }
  if (!match) return null;
  const pointIds = shapeMovePointIds(match, entities);
  const wanted = new Set(pointIds);
  const segmentIds = profile.segments
    .filter((segment) => wanted.has(segment.startId) && wanted.has(segment.endId))
    .map((segment) => segment.id);
  const curves = new Set<string>();
  for (const id of segmentIds) {
    const owner = curveStandInOwner(id);
    if (owner) curves.add(owner);
  }
  if (hit.segmentId && entities.some((entity) => entity.id === hit.segmentId && (entity.kind === "circle" || entity.kind === "arc"))) {
    curves.add(hit.segmentId);
  }
  for (const id of curves) segmentIds.push(id);
  return { profileId: match.id, pointIds, segmentIds };
}

export type WholeEraseTarget = { pointIds: string[]; segmentIds: string[] };

/**
 * One click of armed Erase removes the closed loop or open line that was touched,
 * including the points that belong only to it. A corner shared with something else stays.
 */
export function wholeEraseTarget(
  profile: SketchProfile,
  hit: { segmentId?: string; pointId?: string; at?: SketchVec2 },
  entities: readonly SketchEntity[] = [],
): WholeEraseTarget | null {
  const loops = orderedSketchPaths({
    ...profile,
    segments: profile.segments.filter((segment) => !segment.construction),
  }).filter((path) => path.closed);
  const loopSegmentIds = new Set(loops.flatMap((path) => path.steps.map((step) => step.segment.id)));

  const smallest = (paths: OrderedSketchPath[]) => {
    let best: OrderedSketchPath | null = null;
    let bestArea = Number.POSITIVE_INFINITY;
    for (const path of paths) {
      const area = polygonArea(sampledPathOutline(path));
      if (area < bestArea) {
        best = path;
        bestArea = area;
      }
    }
    return best;
  };

  const fromLoop = (path: OrderedSketchPath): WholeEraseTarget => {
    const segmentIds = path.steps.map((step) => step.segment.id);
    const circleIds = circleEraseIds([...segmentIds, ...path.points.map((point) => point.id)], entities);
    if (circleIds) return { pointIds: [], segmentIds: circleIds };
    return {
      segmentIds,
      pointIds: pointsOnlyUsedBy(profile, new Set(segmentIds), path.points.map((point) => point.id)),
    };
  };

  if (hit.segmentId) {
    const circleId = circleEntityId(hit.segmentId, entities);
    if (circleId) return { pointIds: [], segmentIds: [circleId] };
    const segment = profile.segments.find((entry) => entry.id === hit.segmentId);
    if (!segment) return null;
    if (segment.construction) {
      return connectedChain(profile, segment, profile.segments.filter((entry) => entry.construction));
    }
    const loop = smallest(loops.filter((path) => path.steps.some((step) => step.segment.id === segment.id)));
    if (loop) return fromLoop(loop);
    return connectedChain(
      profile,
      segment,
      profile.segments.filter((entry) => !entry.construction && !curveStandInOwner(entry.id) && !loopSegmentIds.has(entry.id)),
    );
  }

  if (hit.pointId) {
    const standIn = curveStandInOwner(hit.pointId);
    const standInCircle = standIn ? circleEntityId(standIn, entities) : null;
    if (standInCircle) return { pointIds: [], segmentIds: [standInCircle] };
    const circles = entities.filter((entity) => entity.kind === "circle" && !entity.construction && entity.centerId === hit.pointId);
    const touching = profile.segments.filter(
      (segment) => !segment.construction && !curveStandInOwner(segment.id) && (segment.startId === hit.pointId || segment.endId === hit.pointId),
    );
    if (circles.length > 0 && touching.length === 0) return { pointIds: [], segmentIds: circles.map((circle) => circle.id) };
    const loop = smallest(loops.filter((path) => path.points.some((point) => point.id === hit.pointId)));
    if (loop) return fromLoop(loop);
    const open = touching.find((segment) => !loopSegmentIds.has(segment.id));
    if (open) {
      return connectedChain(
        profile,
        open,
        profile.segments.filter((entry) => !entry.construction && !curveStandInOwner(entry.id) && !loopSegmentIds.has(entry.id)),
      );
    }
    if (!curveStandInOwner(hit.pointId)) return { pointIds: [hit.pointId], segmentIds: [] };
    return null;
  }

  if (hit.at) {
    const loop = smallest(loops.filter((path) => {
      const outline = sampledPathOutline(path);
      return outline.length >= 3 && pointInPolygon(hit.at!, outline);
    }));
    const circle = smallestCircleAt(profile, hit.at, entities);
    if (loop && circle) {
      const area = polygonArea(sampledPathOutline(loop));
      if (circle.area + 0.01 < area) return { pointIds: [], segmentIds: [circle.id] };
      return fromLoop(loop);
    }
    if (loop) return fromLoop(loop);
    if (circle) return { pointIds: [], segmentIds: [circle.id] };
  }
  return null;
}

function circleEntityId(id: string, entities: readonly SketchEntity[]) {
  const owner = curveStandInOwner(id) ?? id;
  return entities.some((entity) => entity.kind === "circle" && entity.id === owner) ? owner : null;
}

/** Stand-in chords of an analytic circle erase as that circle, not as loose lines. */
function circleEraseIds(ids: string[], entities: readonly SketchEntity[]) {
  if (ids.length === 0) return null;
  const owners = new Set<string>();
  for (const id of ids) {
    const owner = circleEntityId(id, entities);
    if (!owner) return null;
    owners.add(owner);
  }
  return [...owners];
}

function pointsOnlyUsedBy(profile: SketchProfile, segmentIds: Set<string>, pointIds: Iterable<string>) {
  const usedElsewhere = new Set<string>();
  for (const segment of profile.segments) {
    if (segmentIds.has(segment.id)) continue;
    const owner = curveStandInOwner(segment.id);
    if (owner && segmentIds.has(owner)) continue;
    usedElsewhere.add(segment.startId);
    usedElsewhere.add(segment.endId);
  }
  return [...new Set(pointIds)].filter((id) => !usedElsewhere.has(id) && !curveStandInOwner(id));
}

function connectedChain(profile: SketchProfile, seed: SketchSegment, pool: SketchSegment[]): WholeEraseTarget | null {
  if (!pool.some((segment) => segment.id === seed.id)) return null;
  const byPoint = new Map<string, SketchSegment[]>();
  for (const segment of pool) {
    for (const id of [segment.startId, segment.endId]) {
      const list = byPoint.get(id) ?? [];
      list.push(segment);
      byPoint.set(id, list);
    }
  }
  const segmentIds = new Set<string>();
  const pointIds = new Set<string>();
  const queue = [seed];
  while (queue.length > 0) {
    const segment = queue.pop();
    if (!segment || segmentIds.has(segment.id)) continue;
    segmentIds.add(segment.id);
    pointIds.add(segment.startId);
    pointIds.add(segment.endId);
    for (const id of [segment.startId, segment.endId]) {
      for (const next of byPoint.get(id) ?? []) {
        if (!segmentIds.has(next.id)) queue.push(next);
      }
    }
  }
  return {
    segmentIds: [...segmentIds],
    pointIds: pointsOnlyUsedBy(profile, segmentIds, pointIds),
  };
}

function smallestCircleAt(profile: SketchProfile, at: SketchVec2, entities: readonly SketchEntity[]) {
  let best: { id: string; area: number } | null = null;
  for (const entity of entities) {
    if (entity.kind !== "circle" || entity.construction) continue;
    const center = profile.points.find((point) => point.id === entity.centerId)
      ?? entities.find((entry): entry is SketchPointEntity => entry.kind === "point" && entry.id === entity.centerId);
    if (!center) continue;
    if (Math.hypot(at.x - center.x, at.z - center.z) > entity.radius) continue;
    const area = Math.PI * entity.radius * entity.radius;
    if (!best || area < best.area) best = { id: entity.id, area };
  }
  return best;
}

function pointEntities(doc: SketchDoc): SketchPointEntity[] {
  return doc.entities.filter((e): e is SketchPointEntity => e.kind === "point");
}

function curveEntities(doc: SketchDoc) {
  return doc.entities.filter(
    (e): e is Extract<SketchEntity, { kind: "line" | "bezier" | "smooth" }> =>
      e.kind === "line" || e.kind === "bezier" || e.kind === "smooth",
  );
}

/** Profiles from SketchDoc curve graph (ignores construction + projected-only when they don't form solid curves). */
export function closedProfilesFromDoc(doc: SketchDoc): SketchClosedProfile[] {
  const points = pointEntities(doc).filter((p) => !p.construction || true);
  const pointById = new Map(points.map((p) => [p.id, p]));
  const curves = curveEntities(doc).filter((c) => !c.construction);
  const legacy: SketchProfile = {
    points: points.map((p) => ({
      id: p.id,
      x: p.x,
      z: p.z,
      handleIn: p.handleIn,
      handleOut: p.handleOut,
      mode: p.mode,
    })),
    segments: curves.map((c) => ({
      id: c.id,
      startId: c.startId,
      endId: c.endId,
      kind: c.kind === "line" ? "line" : c.kind,
    })),
  };
  // Circles as synthetic closed loops (4 quadrant points) for profile picking
  const circleProfiles: SketchClosedProfile[] = [];
  for (const entity of doc.entities) {
    if (entity.kind !== "circle" || entity.construction) continue;
    const center = pointById.get(entity.centerId);
    if (!center) continue;
    const r = entity.radius;
    const pts = [
      { x: center.x + r, z: center.z },
      { x: center.x, z: center.z + r },
      { x: center.x - r, z: center.z },
      { x: center.x, z: center.z - r },
    ];
    circleProfiles.push({
      id: `circle-${entity.id}`,
      pointIds: [entity.centerId],
      holePointIdLoops: [],
      area: Math.PI * r * r,
      centroid: { x: center.x, z: center.z },
    });
    void pts;
  }
  const fromCurves = closedProfilesFromLegacy(legacy);
  return [...fromCurves, ...circleProfiles].sort((a, b) => b.area - a.area);
}

export function pickProfileAtPoint(profiles: SketchClosedProfile[], point: SketchVec2, legacy: SketchProfile): string | null {
  const byId = new Map(legacy.points.map((p) => [p.id, p]));
  for (const profile of profiles) {
    if (profile.id.startsWith("circle-")) {
      const dist = Math.hypot(point.x - profile.centroid.x, point.z - profile.centroid.z);
      const radius = Math.sqrt(profile.area / Math.PI);
      if (dist <= radius) return profile.id;
      continue;
    }
    const poly = profile.pointIds.map((id) => byId.get(id)).filter(Boolean).map((p) => ({ x: p!.x, z: p!.z }));
    if (poly.length >= 3 && pointInPolygon(point, poly)) return profile.id;
  }
  return null;
}
