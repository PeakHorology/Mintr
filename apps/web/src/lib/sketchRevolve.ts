import * as THREE from "three";
import { createLocalId } from "@/lib/localIds";
import { sketchProfileToDoc } from "@/lib/sketch/migrate";
import { materialOutlines, sketchLoopRegion, type OrderedSketchPath } from "@/lib/sketch/profiles";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { SketchPoint, SketchProfile, WorkplaneShape } from "@/types/sketchforge";

export type SketchRevolveAxis = {
  start: { x: number; z: number };
  end: { x: number; z: number };
};

function cloneSketchProfile(profile: SketchProfile): SketchProfile {
  return {
    points: profile.points.map((point) => ({
      ...point,
      handleIn: point.handleIn ? { ...point.handleIn } : undefined,
      handleOut: point.handleOut ? { ...point.handleOut } : undefined,
    })),
    segments: profile.segments.map((segment) => ({ ...segment })),
    images: (profile.images ?? []).map((image) => ({ ...image })),
  };
}

function cubicPoint(
  start: SketchPoint,
  first: { x: number; z: number },
  second: { x: number; z: number },
  end: SketchPoint,
  amount: number,
) {
  const inverse = 1 - amount;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * amount * first.x + 3 * inverse * amount ** 2 * second.x + amount ** 3 * end.x,
    z: inverse ** 3 * start.z + 3 * inverse ** 2 * amount * first.z + 3 * inverse * amount ** 2 * second.z + amount ** 3 * end.z,
  };
}

/** Dense polyline samples of a closed sketch path in the XZ plane. */
function sampleClosedPath(path: OrderedSketchPath): Array<{ x: number; z: number }> {
  const samples: Array<{ x: number; z: number }> = [];
  path.steps.forEach(({ segment, from, to }, stepIndex) => {
    if (stepIndex === 0) samples.push({ x: from.x, z: from.z });
    const forward = segment.startId === from.id;
    const raw1 = forward ? from.handleOut : from.handleIn;
    const raw2 = forward ? to.handleIn : to.handleOut;
    const control1 = raw1 ?? from;
    const control2 = raw2 ?? to;
    const curved = segment.kind !== "line" && Boolean(raw1 || raw2);
    if (curved) {
      const steps = 12;
      for (let index = 1; index <= steps; index += 1) {
        samples.push(cubicPoint(from, control1, control2, to, index / steps));
      }
    } else {
      samples.push({ x: to.x, z: to.z });
    }
  });
  if (samples.length > 1) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (Math.hypot(first.x - last.x, first.z - last.z) > 1e-6) {
      samples.push({ ...first });
    }
  }
  return samples;
}

const ON_AXIS_RADIUS = 1e-3;

function signedProfileArea(points: Array<{ x: number; y: number }>) {
  let area = 0;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    area += points[previous].x * points[index].y - points[index].x * points[previous].y;
  }
  return area * 0.5;
}

/**
 * LatheGeometry faces outward only for a counterclockwise profile in (radius, along).
 * A sketch loop can be walked either way, and the opposite way turns the solid inside out.
 * An edge that lies on the axis is the cut: the polyline starts and ends there so that edge is not spun.
 */
function orientLatheProfile(points: THREE.Vector2[]): THREE.Vector2[] {
  const open: THREE.Vector2[] = [];
  for (const point of points) {
    const previous = open[open.length - 1];
    if (previous && previous.distanceTo(point) < 1e-4) continue;
    open.push(point);
  }
  if (open.length > 1 && open[0].distanceTo(open[open.length - 1]) < 1e-4) open.pop();
  if (open.length < 3) return open;
  if (signedProfileArea(open) < 0) open.reverse();

  const onAxis = (point: THREE.Vector2) => point.x <= ON_AXIS_RADIUS;
  let axisEdge = -1;
  for (let index = 0; index < open.length; index += 1) {
    const next = open[(index + 1) % open.length];
    if (onAxis(open[index]) && onAxis(next)) {
      axisEdge = index;
      break;
    }
  }
  if (axisEdge >= 0) {
    const start = (axisEdge + 1) % open.length;
    const rotated: THREE.Vector2[] = [];
    for (let step = 0; step < open.length; step += 1) rotated.push(open[(start + step) % open.length]);
    return rotated;
  }
  const closed = open.slice();
  closed.push(open[0].clone());
  return closed;
}

function weldLatheSeam(geometry: THREE.BufferGeometry, profileCount: number, segments: number) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  if (!index || !position || profileCount < 2) return;
  const ring = profileCount;
  for (let row = 0; row < ring; row += 1) {
    const source = row;
    const copy = row + segments * ring;
    if (copy >= position.count) continue;
    position.setXYZ(copy, position.getX(source), position.getY(source), position.getZ(source));
  }
  const array = index.array;
  for (let entry = 0; entry < array.length; entry += 1) {
    const vertex = array[entry];
    const column = Math.floor(vertex / ring);
    const row = vertex % ring;
    if (column === segments) array[entry] = row;
  }
  position.needsUpdate = true;
  index.needsUpdate = true;
}

function flatTriangleNormals(positions: ArrayLike<number>): number[] {
  const normals: number[] = [];
  for (let index = 0; index < positions.length; index += 9) {
    const ax = positions[index];
    const ay = positions[index + 1];
    const az = positions[index + 2];
    const bx = positions[index + 3] - ax;
    const by = positions[index + 4] - ay;
    const bz = positions[index + 5] - az;
    const cx = positions[index + 6] - ax;
    const cy = positions[index + 7] - ay;
    const cz = positions[index + 8] - az;
    let nx = by * cz - bz * cy;
    let ny = bz * cx - bx * cz;
    let nz = bx * cy - by * cx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) {
      normals.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
      continue;
    }
    nx /= length;
    ny /= length;
    nz /= length;
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  }
  return normals;
}

function signedPathArea(samples: Array<{ x: number; z: number }>) {
  let area = 0;
  for (let index = 0, previous = samples.length - 1; index < samples.length; previous = index, index += 1) {
    area += samples[previous].x * samples[index].z - samples[index].x * samples[previous].z;
  }
  return area * 0.5;
}

function insidePolygon(point: { x: number; z: number }, polygon: Array<{ x: number; z: number }>) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.z > point.z !== b.z > point.z && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

type RevolveLoop = {
  /** Closed samples, first point repeated at the end, as the lathe wants them. */
  samples: Array<{ x: number; z: number }>;
  /** The same outline without the repeat, for area and containment. */
  ring: Array<{ x: number; z: number }>;
  area: number;
  region: string | null;
};
type RevolveRegion = { outer: RevolveLoop; holes: RevolveLoop[] };

/**
 * Closed regions to revolve: every solid outline with the holes inside it.
 * Construction lines are guides and never part of the section. Loops nest by containment the
 * way extrude nests them: even depth is material, odd depth is a hole in its parent.
 */
function revolveRegions(profile: SketchProfile): RevolveRegion[] {
  const outlines = materialOutlines({
    ...profile,
    segments: profile.segments.filter((segment) => !segment.construction),
  });
  const loops: RevolveLoop[] = outlines
    .map((path) => {
      const samples = sampleClosedPath(path);
      const first = samples[0];
      const last = samples[samples.length - 1];
      const ring = samples.length > 1 && Math.hypot(first.x - last.x, first.z - last.z) < 1e-6 ? samples.slice(0, -1) : samples;
      return { samples, ring, area: Math.abs(signedPathArea(ring)), region: sketchLoopRegion(path.steps) };
    })
    .filter((loop) => loop.ring.length >= 3 && loop.area > 1e-9)
    .sort((a, b) => b.area - a.area);
  const parent = new Map<number, number>();
  const depth: number[] = [];
  loops.forEach((loop, index) => {
    let best = -1;
    for (let candidate = 0; candidate < index; candidate += 1) {
      if (loops[candidate].region !== loop.region) continue;
      // Most of the outline inside, so a hole touching its parent at a corner still counts.
      const inside = loop.ring.filter((point) => insidePolygon(point, loops[candidate].ring)).length;
      if (inside * 2 <= loop.ring.length) continue;
      if (best < 0 || loops[candidate].area < loops[best].area) best = candidate;
    }
    if (best >= 0) parent.set(index, best);
    depth[index] = best >= 0 ? depth[best] + 1 : 0;
  });
  const regions = new Map<number, RevolveRegion>();
  loops.forEach((loop, index) => {
    if (depth[index] % 2 === 0) regions.set(index, { outer: loop, holes: [] });
  });
  loops.forEach((loop, index) => {
    if (depth[index] % 2 === 1) regions.get(parent.get(index)!)?.holes.push(loop);
  });
  return [...regions.values()];
}

type RevolveBuild = { positions: number[]; normals: number[]; centerX: number; centerZ: number } | { issue: string };

function buildRevolve(profile: SketchProfile, axis: SketchRevolveAxis, radialSegments: number): RevolveBuild {
  const axisDx = axis.end.x - axis.start.x;
  const axisDz = axis.end.z - axis.start.z;
  const axisLength = Math.hypot(axisDx, axisDz);
  if (axisLength < 0.25) return { issue: "The axis line is too short. Pick a longer straight line to revolve around." };
  const ux = axisDx / axisLength;
  const uz = axisDz / axisLength;

  const regions = revolveRegions(profile);
  if (regions.length === 0) return { issue: "Revolve needs a closed profile. Close the outline first, then pick the axis." };

  type LatheSample = { radius: number; along: number; sign: number };
  const toLathe = (samples: Array<{ x: number; z: number }>): LatheSample[] => samples.map((point) => {
    const vx = point.x - axis.start.x;
    const vz = point.z - axis.start.z;
    const along = vx * ux + vz * uz;
    const rx = vx - along * ux;
    const rz = vz - along * uz;
    const radius = Math.hypot(rx, rz);
    const sign = Math.sign(ux * vz - uz * vx) || 1;
    return { radius, along, sign };
  });
  const lathe = regions.map((region) => ({
    outer: toLathe(region.outer.samples),
    holes: region.holes.map((hole) => toLathe(hole.samples)),
  }));

  // Every loop must sit on one side. Two sections on opposite sides would sweep through each other.
  const all = lathe.flatMap((entry) => [...entry.outer, ...entry.holes.flat()]);
  const sideVotes = all.reduce((sum, sample) => sum + (sample.radius < 1e-4 ? 0 : sample.sign), 0);
  const side = Math.sign(sideVotes) || 1;
  if (all.some((sample) => sample.radius > 0.2 && sample.sign !== side)) {
    return { issue: "The profile crosses the axis. Keep the whole profile on one side of the axis line." };
  }

  const segments = Math.max(16, Math.min(128, Math.floor(radialSegments)));
  const radial = new THREE.Vector3(-uz * side, 0, ux * side).normalize();
  const axisVec = new THREE.Vector3(ux, 0, uz);
  const binormal = new THREE.Vector3().crossVectors(radial, axisVec).normalize();
  const matrix = new THREE.Matrix4().makeBasis(radial, axisVec, binormal);
  matrix.setPosition(axis.start.x, 0, axis.start.z);

  const positions: number[] = [];
  let maxRadius = 0;
  const spin = (samples: LatheSample[], hole: boolean) => {
    const cleaned = orientLatheProfile(samples.map((sample) => new THREE.Vector2(Math.max(0, sample.radius), sample.along)));
    if (cleaned.length < 3) return;
    // A hole is the same surface turned inside out: walked clockwise, it faces into the void.
    if (hole) cleaned.reverse();
    maxRadius = cleaned.reduce((max, point) => Math.max(max, point.x), maxRadius);
    const geometry = new THREE.LatheGeometry(cleaned, segments);
    // The lathe repeats the first meridian as a separate last column. Those two
    // copies are the same edge, and leaving them split draws a crack down the solid.
    weldLatheSeam(geometry, cleaned.length, segments);
    geometry.applyMatrix4(matrix);
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const array = flat.getAttribute("position").array as ArrayLike<number>;
    for (let index = 0; index < array.length; index += 1) positions.push(array[index]);
    if (flat !== geometry) flat.dispose();
    geometry.dispose();
  };
  for (const entry of lathe) {
    spin(entry.outer, false);
    for (const hole of entry.holes) spin(hole, true);
  }
  if (positions.length === 0 || maxRadius < 0.25) {
    return { issue: "The profile is too close to the axis to make a solid. Move it away from the axis line." };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < positions.length; index += 3) {
    minX = Math.min(minX, positions[index]);
    maxX = Math.max(maxX, positions[index]);
    minY = Math.min(minY, positions[index + 1]);
    minZ = Math.min(minZ, positions[index + 2]);
    maxZ = Math.max(maxZ, positions[index + 2]);
  }
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  // Center on the footprint and seat the solid on the plate (y = 0).
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] -= centerX;
    positions[index + 1] -= minY;
    positions[index + 2] -= centerZ;
  }
  // One normal per face. Display shading welds the gentle steps around the
  // axis and keeps a corner where the profile actually turns.
  return { positions, normals: flatTriangleNormals(positions), centerX, centerZ };
}

/**
 * Why a revolve cannot be built, in words for the person drawing, or null when it can.
 * The editor can show this instead of a generic notice when `shapeFromSketchRevolve` returns null.
 */
export function sketchRevolveIssue(profile: SketchProfile, axis: SketchRevolveAxis, radialSegments = 72): string | null {
  const built = buildRevolve(profile, axis, radialSegments);
  return "issue" in built ? built.issue : null;
}

export function resolveSketchRevolveAxis(
  profile: SketchProfile,
  selection: { kind: string; id?: string } | null,
): SketchRevolveAxis | null {
  if (!selection || selection.kind !== "segment" || !selection.id) return null;
  const segment = profile.segments.find((entry) => entry.id === selection.id);
  if (!segment || segment.kind === "bezier" || segment.kind === "smooth") return null;
  const start = profile.points.find((point) => point.id === segment.startId);
  const end = profile.points.find((point) => point.id === segment.endId);
  if (!start || !end) return null;
  if (Math.hypot(end.x - start.x, end.z - start.z) < 0.25) return null;
  return { start: { x: start.x, z: start.z }, end: { x: end.x, z: end.z } };
}

/**
 * Revolve the closed sketch profiles around a straight axis in the sketch plane.
 * Every solid outline is spun, each with the holes drawn inside it, so a washer section comes
 * out as a ring with its void. Profiles that stay away from the axis become tubes and rings.
 * Returns null when it cannot be built; `sketchRevolveIssue` says why.
 */
export function shapeFromSketchRevolve(
  profile: SketchProfile,
  axis: SketchRevolveAxis,
  existing?: WorkplaneShape | null,
  radialSegments = 72,
): WorkplaneShape | null {
  const built = buildRevolve(profile, axis, radialSegments);
  if ("issue" in built) return null;
  const { positions, normals, centerX: meshCenterX, centerZ: meshCenterZ } = built;

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < positions.length; index += 3) {
    minX = Math.min(minX, positions[index]);
    maxX = Math.max(maxX, positions[index]);
    minY = Math.min(minY, positions[index + 1]);
    maxY = Math.max(maxY, positions[index + 1]);
    minZ = Math.min(minZ, positions[index + 2]);
    maxZ = Math.max(maxZ, positions[index + 2]);
  }
  const width = Math.max(0.01, maxX - minX);
  const height = Math.max(0.01, maxY - minY);
  const depth = Math.max(0.01, maxZ - minZ);

  return canonicalizeShape({
    id: existing?.id ?? createLocalId("sketch-revolve"),
    name: existing?.name ?? "Sketch revolve",
    kind: "mesh",
    color: existing?.color ?? "#d41721",
    hole: Boolean(existing?.hole),
    x: meshCenterX,
    z: meshCenterZ,
    elevation: 0,
    size: Math.max(width, depth),
    width,
    depth,
    height,
    rotation: 0,
    importedMesh: {
      positions,
      normals,
      baseWidth: width,
      baseDepth: depth,
      baseHeight: height,
      triangleCount: Math.floor(positions.length / 9),
      sourceFormat: "json",
    },
    sketchProfile: cloneSketchProfile(profile),
    sketchDoc: (() => {
      const doc = sketchProfileToDoc(profile, existing?.sketchId);
      if (existing?.sketchDoc?.constraints?.length) doc.constraints = existing.sketchDoc.constraints;
      if (existing?.sketchDoc?.dimensions?.length) doc.dimensions = existing.sketchDoc.dimensions;
      return doc;
    })(),
    sketchId: existing?.sketchId ?? existing?.sketchDoc?.id,
    sketchFinish: "revolve",
    values: existing?.values,
    drivenBy: existing?.drivenBy,
    sketchRevolveAxis: {
      x1: axis.start.x,
      z1: axis.start.z,
      x2: axis.end.x,
      z2: axis.end.z,
    },
  } satisfies WorkplaneShape);
}
