import type { CadPlanarFace } from "@/lib/cadModifierTypes";
import { meshAabb } from "@/lib/editorShapeMesh";
import {
  faceAxes,
  faceOutlineFromLoop,
  projectFacePoints,
  type FaceVec2,
  type FaceVec3,
} from "@/lib/faceOutline";
import { shapeFromSketchProfile } from "@/lib/sketchProfileShape";
import type { SketchPlane, SketchProfile, WorkplaneShape } from "@/types/sketchforge";

export type FaceDirection = "out" | "in";

export type FaceBodyResult = {
  shape: WorkplaneShape | null;
  error: string | null;
  notice: string | null;
  depth: number;
};

/** One face the Face tool will build. Live slider values are applied to every face in the set. */
export type FaceDraft = {
  faceId: number;
  direction: FaceDirection;
  inset: number;
  cornerRadius: number;
  depth: number;
};

/** Keep a face that was already set, replacing an older pass on that same face. */
export function rememberFaceDraft(kept: readonly FaceDraft[], draft: FaceDraft): FaceDraft[] {
  return [...kept.filter((entry) => entry.faceId !== draft.faceId), draft];
}

/**
 * Faces to preview and create.
 * While a face is selected, every face already added uses those same live settings.
 * Between picks, faces already added keep the settings they had.
 */
export function faceDraftsToBuild(kept: readonly FaceDraft[], current: FaceDraft | null): FaceDraft[] {
  if (!current) return [...kept];
  const shared = {
    direction: current.direction,
    inset: current.inset,
    cornerRadius: current.cornerRadius,
    depth: current.depth,
  };
  return rememberFaceDraft(kept, current).map((draft) => ({ ...draft, ...shared }));
}

const NARROW = "That part of the face is narrower than the inset and corner radius.";
const CURVED = "A curved face does not work. Click a flat face.";
const POCKET_LIMIT = "A pocket goes no deeper than the body behind the face.";
const WALL_LIMIT = "The pocket stops one inset short of the far side, so the inset is the wall there too.";
const WALL_THICK = "The inset is thicker than the body behind this face.";
const THROUGH_OVERSHOOT = 0.2;

export type FacePlane = { origin: FaceVec3; normal: FaceVec3 };

export type JoinedFaceDraft = FaceDraft & {
  /** An opposite pocket is selected too, so this one runs through. */
  passThrough: boolean;
  /** Depth stops one inset short of the far side, so the inset is the wall there too. */
  keepFarWall: boolean;
  /** Planes of neighbouring pockets. Edges on these planes open up so the pockets merge. */
  openPlanes: FacePlane[];
};

function normalDot(a: FaceVec3, b: FaceVec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Every pocket goes to its Depth, never closer than the inset to the far side, so the inset
 * is the wall all round.
 * Leave column: the bar of material along an edge two pockets share stays.
 * Join through: the pockets join like Hollow. Pockets that share an edge open into each other
 * so that bar is gone, and pockets on opposite faces run through each other.
 */
export function joinedFaceDrafts(
  host: WorkplaneShape,
  faces: readonly CadPlanarFace[],
  drafts: readonly FaceDraft[],
  joinThrough: boolean,
): JoinedFaceDraft[] {
  const located = drafts.flatMap((draft) => {
    const face = faces.find((entry) => entry.id === draft.faceId);
    return face ? [{ draft, face }] : [];
  });
  return located.map(({ draft, face }) => {
    if (draft.direction !== "in") return { ...draft, passThrough: false, keepFarWall: false, openPlanes: [] };
    if (!joinThrough) return { ...draft, passThrough: false, keepFarWall: true, openPlanes: [] };
    const into = cutDirection(host, face.origin, face.normal);
    const others = located.filter((other) => other.draft.faceId !== draft.faceId && other.draft.direction === "in");
    const opposite = others.filter((other) => normalDot(into, cutDirection(host, other.face.origin, other.face.normal)) < -0.5);
    const neighbours = others.filter((other) => Math.abs(normalDot(into, cutDirection(host, other.face.origin, other.face.normal))) < 0.5);
    const openPlanes = neighbours.map((other) => ({ origin: other.face.origin, normal: other.face.normal }));
    if (opposite.length > 0) {
      const span = materialBehindFace(host, face.origin, face.normal);
      const reach = opposite.reduce((furthest, other) => Math.max(furthest, gapAlong(face.origin, other.face.origin, into)), span.depth);
      return { ...draft, depth: reach + THROUGH_OVERSHOOT, passThrough: true, keepFarWall: false, openPlanes };
    }
    return { ...draft, passThrough: false, keepFarWall: true, openPlanes };
  });
}

function pointOnPlane(point: FaceVec3, plane: FacePlane) {
  const length = Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z) || 1;
  const distance = (
    (point.x - plane.origin.x) * plane.normal.x
    + (point.y - plane.origin.y) * plane.normal.y
    + (point.z - plane.origin.z) * plane.normal.z
  ) / length;
  return Math.abs(distance) < 0.05;
}

/** Direction from the face into the solid. A reported normal may point either way. */
function cutDirection(host: WorkplaneShape, origin: FaceVec3, normal: FaceVec3): FaceVec3 {
  const span = materialBehindFace(host, origin, normal);
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  return {
    x: (normal.x / length) * span.sign,
    y: (normal.y / length) * span.sign,
    z: (normal.z / length) * span.sign,
  };
}

function gapAlong(from: FaceVec3, to: FaceVec3, direction: FaceVec3) {
  return Math.abs((to.x - from.x) * direction.x + (to.y - from.y) * direction.y + (to.z - from.z) * direction.z);
}

/** How far the solid extends from the face, and which way is into the material. */
function materialBehindFace(host: WorkplaneShape, origin: FaceVec3, normal: FaceVec3) {
  const bounds = meshAabb(host);
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const nx = normal.x / length;
  const ny = normal.y / length;
  const nz = normal.z / length;
  let minDot = Infinity;
  let maxDot = -Infinity;
  const xs = [bounds.minX, bounds.maxX];
  const ys = [bounds.minY, bounds.maxY];
  const zs = [bounds.minZ, bounds.maxZ];
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        const dot = x * nx + y * ny + z * nz;
        minDot = Math.min(minDot, dot);
        maxDot = Math.max(maxDot, dot);
      }
    }
  }
  const originDot = origin.x * nx + origin.y * ny + origin.z * nz;
  const behind = Math.max(0, originDot - minDot);
  const ahead = Math.max(0, maxDot - originDot);
  // A reported normal can point into the body. Extrude toward the material.
  return behind >= ahead
    ? { depth: behind, sign: -1 as const }
    : { depth: ahead, sign: 1 as const };
}

function scale3(value: FaceVec3, factor: number): FaceVec3 {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor };
}

function cross3(a: FaceVec3, b: FaceVec3): FaceVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function loopToWorld(loop: FaceVec2[], origin: FaceVec3, u: FaceVec3, v: FaceVec3): FaceVec3[] {
  return loop.map((point) => ({
    x: origin.x + u.x * point.x + v.x * point.z,
    y: origin.y + u.y * point.x + v.y * point.z,
    z: origin.z + u.z * point.x + v.z * point.z,
  }));
}

function projectWorld(points: FaceVec3[], origin: FaceVec3, u: FaceVec3, v: FaceVec3): FaceVec2[] {
  return points.map((point) => {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const dz = point.z - origin.z;
    return {
      x: dx * u.x + dy * u.y + dz * u.z,
      z: dx * v.x + dy * v.y + dz * v.z,
    };
  });
}

function profileFromLoop(loop: FaceVec2[], plane: SketchPlane, reference: FaceVec2[]): SketchProfile {
  const points = loop.map((point, index) => ({
    id: `face-p-${index}`,
    x: point.x,
    z: point.z,
  }));
  return {
    points,
    segments: points.map((point, index) => ({
      id: `face-s-${index}`,
      startId: point.id,
      endId: points[(index + 1) % points.length].id,
      kind: "line" as const,
    })),
    sketchPlane: plane,
    faceReferenceLoops: [reference.map((point) => ({ x: point.x, z: point.z }))],
  };
}

export function buildFaceBody(input: {
  host: WorkplaneShape;
  face: CadPlanarFace;
  direction: FaceDirection;
  inset: number;
  cornerRadius: number;
  depth: number;
  /** Join through set this depth. It is used as given, even past the far side. */
  passThrough?: boolean;
  /** Neighbouring pockets that open into this one. The shared edge is not inset. */
  openPlanes?: readonly FacePlane[];
  /** Stop one inset short of the far side so the inset is the wall there too. */
  keepFarWall?: boolean;
}): FaceBodyResult {
  const origin = input.face.origin;
  const axes = faceAxes(input.face.normal);
  const raw = projectFacePoints(input.face.points, origin, axes.u, axes.v);
  if (raw.length < 3) return { shape: null, error: CURVED, notice: null, depth: 0 };
  const openPlanes = input.direction === "in" ? input.openPlanes ?? [] : [];
  const edgeInset = openPlanes.length === 0
    ? null
    : (start: FaceVec2, end: FaceVec2) => {
      const [a, b] = loopToWorld([start, end], origin, axes.u, axes.v);
      return openPlanes.some((plane) => pointOnPlane(a, plane) && pointOnPlane(b, plane)) ? -THROUGH_OVERSHOOT : null;
    };
  const outline = faceOutlineFromLoop(raw, input.inset, input.cornerRadius, edgeInset);
  if (outline.length < 3) return { shape: null, error: NARROW, notice: null, depth: 0 };

  let depth = Math.max(0, input.depth);
  let notice: string | null = null;
  const span = input.direction === "in" ? materialBehindFace(input.host, origin, axes.n) : null;
  if (span && input.passThrough) {
    depth = Math.min(depth, span.depth + THROUGH_OVERSHOOT);
  } else if (span) {
    const wall = input.keepFarWall ? Math.max(0, input.inset) : 0;
    const limit = span.depth - wall;
    if (limit < 0.05) return { shape: null, error: WALL_THICK, notice: null, depth: 0 };
    if (depth > limit + 0.05) {
      depth = limit;
      notice = wall > 0 ? WALL_LIMIT : POCKET_LIMIT;
    }
  }
  if (depth < 0.05) return { shape: null, error: "Enter a depth.", notice, depth: 0 };

  const inward = input.direction === "in";
  const flipped = inward && span?.sign === -1;
  const normal = flipped ? scale3(axes.n, -1) : axes.n;
  const u = flipped ? scale3(axes.u, -1) : axes.u;
  const v = cross3(normal, u);
  const world = loopToWorld(outline, origin, axes.u, axes.v);
  const profileLoop = flipped
    ? faceOutlineFromLoop(projectWorld(world, origin, u, v), 0, 0)
    : outline;
  if (profileLoop.length < 3) return { shape: null, error: NARROW, notice, depth };
  const referenceWorld = loopToWorld(
    faceOutlineFromLoop(raw, 0, 0),
    origin,
    axes.u,
    axes.v,
  );
  const reference = flipped ? projectWorld(referenceWorld, origin, u, v) : faceOutlineFromLoop(raw, 0, 0);
  const plane: SketchPlane = {
    origin,
    normal,
    uAxis: u,
    hostShapeId: input.host.id,
  };
  const built = shapeFromSketchProfile(profileFromLoop(profileLoop, plane, reference), depth, null, { cutIntoFace: false });
  if (!built) return { shape: null, error: NARROW, notice, depth };
  built.name = inward ? "Pocket" : "Face";
  built.color = input.host.color;
  built.solidColor = input.host.solidColor || input.host.color;
  built.hole = inward;
  return { shape: built, error: null, notice, depth };
}
