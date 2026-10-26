import * as THREE from "three";
import type { GridSize, SketchPlane, SketchProfile, SketchSegment, WorkplaneShape } from "@/types/sketchforge";
import { cylinderUVToWorld, cylinderOutwardNormalAtUV, worldToCylinderUV } from "@/lib/sketchCylinder";
import { planeUVToWorld, resolveSketchPlane, sketchPlaneVAxis, worldToPlaneUV } from "@/lib/sketchPlane";
import type { SketchTool } from "@/components/SketchWorkspace";
import { curveStandInOwner } from "./migrate";
import { parseLineEntry, pointAtLengthAngle, screenAngleDeg, snapHeading } from "./lineEntry";
import { orderedSketchPaths } from "./profiles";
import { snapSketchPoint } from "./snaps";
import { sketchCenterSnapPoints } from "./shapeCenterSnap";

const GROUP_NAME = "sketch-on-model";
const LIVE_GROUP_NAME = "sketch-on-model-live";
const LIFT_MM = 0.35;

// Shared across every point dot; never disposed with the overlay groups.
const POINT_GEOMETRY = new THREE.SphereGeometry(0.7, 12, 8);
const POINT_MATERIAL = new THREE.MeshBasicMaterial({ color: "#f7fbfc", depthTest: true });
const POINT_MATERIAL_ACTIVE = new THREE.MeshBasicMaterial({ color: "#ff8a00", depthTest: true });
const CENTER_MARK_MATERIAL = new THREE.LineBasicMaterial({ color: "#2aa77e", depthTest: false, transparent: true });
const GUIDE_GHOST_MATERIAL = new THREE.LineBasicMaterial({ color: "#2aa77e", depthTest: false, transparent: true });
const SHARED_RESOURCES = new Set<THREE.BufferGeometry | THREE.Material>([
  POINT_GEOMETRY,
  POINT_MATERIAL,
  POINT_MATERIAL_ACTIVE,
  CENTER_MARK_MATERIAL,
  GUIDE_GHOST_MATERIAL,
]);
/** Cosine of the angle between the view and the face. Below this, a click is too side-on to draw. */
const MIN_DRAW_FACING = 0.5;
/** Clicking the dot on screen counts even when the ray meets the plane a little beside the point. */
const POINT_PICK_PX = 18;

const DRAG_TOOLS = new Set<SketchTool>([
  "bezier",
  "circle",
  "ellipse",
  "square",
  "rectangle",
  "roundRect",
  "slot",
  "triangle",
  "polygon",
  "star",
]);

const DRAW_TOOLS = new Set<SketchTool>([
  "line",
  "smooth",
  "bezier",
  "circle",
  "ellipse",
  "square",
  "rectangle",
  "roundRect",
  "slot",
  "triangle",
  "polygon",
  "star",
  "arc",
  "select",
  "erase",
  "offset",
  "measure",
  "fillet",
  "chamfer",
]);

export type SketchOnModelSession = {
  plane: SketchPlane;
  profile: SketchProfile;
  tool: SketchTool;
  snap: GridSize;
  activePointId: string | null;
  onPlanePoint: (
    point: { x: number; z: number },
    handles?: { handleIn: { x: number; z: number }; handleOut: { x: number; z: number } },
  ) => void;
  onDrawCircle: (center: { x: number; z: number }, radius: number) => void;
  onDrawEllipse: (origin: { x: number; z: number }, corner: { x: number; z: number }) => void;
  onDrawSquare: (origin: { x: number; z: number }, corner: { x: number; z: number }) => void;
  onDrawRectangle: (origin: { x: number; z: number }, corner: { x: number; z: number }) => void;
  onDrawRoundRect: (origin: { x: number; z: number }, corner: { x: number; z: number }) => void;
  onDrawSlot: (origin: { x: number; z: number }, corner: { x: number; z: number }) => void;
  onDrawTriangle: (center: { x: number; z: number }, vertex: { x: number; z: number }) => void;
  onDrawPolygon: (center: { x: number; z: number }, vertex: { x: number; z: number }) => void;
  onDrawStar: (center: { x: number; z: number }, tip: { x: number; z: number }) => void;
  onDrawArc: (start: { x: number; z: number }, end: { x: number; z: number }, through: { x: number; z: number }) => void;
  onOffsetSegment: (segmentId: string, toward: { x: number; z: number }) => void;
  onPointPress: (id: string) => void;
  onSelectSegment: (id: string, at?: { x: number; z: number }) => void;
  onSelectMany: (pointIds: string[], segmentIds: string[], imageIds: string[]) => void;
  onMovePoint: (id: string, point: { x: number; z: number }) => void;
  onEraseEntities: (pointIds: string[], segmentIds: string[]) => void;
  onNotice?: (message: string) => void;
  /** Solids whose centers this sketch can snap to. */
  shapes?: readonly WorkplaneShape[];
  /** Mint outline a guide asks the learner to trace. */
  guideGhost?: { points: { x: number; z: number }[]; segments: { start: number; end: number }[] } | null;
};

type UV = { x: number; z: number };

export type Sketch3DGesture =
  | { kind: "drag"; tool: SketchTool; pointerId: number; origin: UV; current: UV }
  | { kind: "move"; pointerId: number; pointId: string; origin: UV; current: UV; moved: boolean }
  | { kind: "erase"; pointerId: number; pointIds: string[]; segmentIds: string[] };

export type Sketch3DPointerState = {
  gesture: Sketch3DGesture | null;
  arc: UV[];
  hover: UV | null;
  /** Digits typed while drawing a line, same as the flat sheet (`50` or `50<30`). */
  lineEntry?: string;
};

export function emptySketch3DPointer(): Sketch3DPointerState {
  return { gesture: null, arc: [], hover: null, lineEntry: "" };
}

/** Point a typed length lands on, in sketch millimetres. Angle follows the pointer unless `50<30`. */
export function sketch3DTypedPoint(anchor: UV | null, hover: UV | null, raw: string | undefined): UV | null {
  if (!anchor || !raw?.trim()) return null;
  const parsed = parseLineEntry(raw);
  if (!parsed) return null;
  const angle = parsed.angleDeg ?? (hover ? screenAngleDeg(anchor, hover) : null);
  if (angle === null) return null;
  return pointAtLengthAngle(anchor, parsed.length, angle);
}

export type Sketch3DLineKeyResult =
  | { kind: "ignore" }
  | { kind: "clear" }
  | { kind: "edit"; lineEntry: string }
  | { kind: "place"; point: UV }
  | { kind: "need-angle" };

/** Keyboard length entry for a 3D line. Matches the flat sheet: type `50` or `50<30`, then Enter. */
export function sketch3DLineKey(
  session: Pick<SketchOnModelSession, "tool" | "activePointId" | "profile">,
  pointer: Sketch3DPointerState,
  key: string,
): Sketch3DLineKeyResult {
  if (session.tool !== "line" || !session.activePointId) return { kind: "ignore" };
  const entry = pointer.lineEntry ?? "";
  if (key === "Escape") return entry ? { kind: "clear" } : { kind: "ignore" };
  if (key === "Backspace") return entry ? { kind: "edit", lineEntry: entry.slice(0, -1) } : { kind: "ignore" };
  if (key === "Enter") {
    if (!entry) return { kind: "ignore" };
    const anchor = session.profile.points.find((point) => point.id === session.activePointId) ?? null;
    if (!anchor || !parseLineEntry(entry)) return { kind: "ignore" };
    const point = sketch3DTypedPoint(anchor, pointer.hover, entry);
    if (!point) return { kind: "need-angle" };
    return { kind: "place", point };
  }
  if (/^[0-9.<+-]$/.test(key)) return { kind: "edit", lineEntry: `${entry}${key}`.slice(0, 32) };
  return { kind: "ignore" };
}

/** True millimetres of the line or shape under the pointer. This is the size that will be drawn. */
export function sketch3DMeasureLabel(
  session: Pick<SketchOnModelSession, "tool" | "activePointId" | "profile">,
  pointer: Sketch3DPointerState,
): string | null {
  const drag = pointer.gesture?.kind === "drag" ? pointer.gesture : null;
  if (drag) {
    const dx = Math.abs(drag.current.x - drag.origin.x);
    const dz = Math.abs(drag.current.z - drag.origin.z);
    const span = Math.hypot(drag.current.x - drag.origin.x, drag.current.z - drag.origin.z);
    if (span < 0.05) return null;
    if (drag.tool === "circle" || drag.tool === "triangle" || drag.tool === "polygon" || drag.tool === "star") {
      return `${(span * 2).toFixed(1)} mm across`;
    }
    if (drag.tool === "square") return `${Math.max(dx, dz).toFixed(1)} mm`;
    if (dx >= 0.05 && dz >= 0.05) return `${dx.toFixed(1)} × ${dz.toFixed(1)} mm`;
    return `${span.toFixed(1)} mm`;
  }
  if (session.tool !== "line" || !session.activePointId) return null;
  const anchor = session.profile.points.find((point) => point.id === session.activePointId) ?? null;
  if (!anchor) return null;
  const entry = pointer.lineEntry?.trim() ?? "";
  if (entry) {
    const parsed = parseLineEntry(entry);
    if (!parsed) return entry;
    if (parsed.angleDeg !== null) return `${parsed.length.toFixed(1)} mm at ${parsed.angleDeg.toFixed(0)}°`;
    if (!sketch3DTypedPoint(anchor, pointer.hover, entry)) return `${parsed.length.toFixed(1)} mm — move the pointer for the angle`;
    return `${parsed.length.toFixed(1)} mm`;
  }
  if (!pointer.hover) return null;
  const length = Math.hypot(pointer.hover.x - anchor.x, pointer.hover.z - anchor.z);
  if (length < 0.05) return null;
  return `${length.toFixed(1)} mm`;
}

/** A size sitting on an edge of the shape being drawn, in sketch-plane millimetres. */
export type SketchSizeCallout = {
  id: string;
  text: string;
  u: number;
  v: number;
  /** Sketch-plane direction that points away from the shape, used to nudge the label off the line. */
  outU: number;
  outV: number;
};

function formatSketchMm(value: number) {
  return `${value.toFixed(1)} mm`;
}

function edgeCallout(
  id: string,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  outU: number,
  outV: number,
): SketchSizeCallout | null {
  const length = Math.hypot(bx - ax, bz - az);
  if (length < 0.05) return null;
  return {
    id,
    text: formatSketchMm(length),
    u: (ax + bx) / 2,
    v: (az + bz) / 2,
    outU,
    outV,
  };
}

/** Width along the bottom edge and height along the right edge of a dragged box. */
function boxCallouts(origin: UV, current: UV): SketchSizeCallout[] {
  const x0 = Math.min(origin.x, current.x);
  const x1 = Math.max(origin.x, current.x);
  const z0 = Math.min(origin.z, current.z);
  const z1 = Math.max(origin.z, current.z);
  const width = edgeCallout("drag-width", x0, z0, x1, z0, 0, -1);
  const height = edgeCallout("drag-height", x1, z0, x1, z1, 1, 0);
  return [width, height].filter((callout): callout is SketchSizeCallout => callout !== null);
}

function radialCallout(origin: UV, current: UV, across: boolean): SketchSizeCallout | null {
  const dx = current.x - origin.x;
  const dz = current.z - origin.z;
  const span = Math.hypot(dx, dz);
  if (span < 0.05) return null;
  return {
    id: "drag-across",
    text: across ? `${(span * 2).toFixed(1)} mm across` : formatSketchMm(span),
    u: current.x,
    v: current.z,
    outU: dx,
    outV: dz,
  };
}

function profileSizeCallouts(profile: SketchProfile): SketchSizeCallout[] {
  const pointById = new Map(profile.points.map((point) => [point.id, point]));
  const curves = new Map<string, UV[]>();
  const consumed = new Set<string>();
  for (const segment of profile.segments) {
    const owner = curveStandInOwner(segment.id);
    if (!owner || segment.construction) continue;
    consumed.add(segment.id);
    const start = pointById.get(segment.startId);
    const end = pointById.get(segment.endId);
    if (!start || !end) continue;
    const points = curves.get(owner) ?? [];
    points.push(start, end);
    curves.set(owner, points);
  }
  const callouts: SketchSizeCallout[] = [];
  for (const [owner, points] of curves) {
    const unique = new Map<string, UV>();
    for (const point of points) unique.set(`${point.x.toFixed(3)}:${point.z.toFixed(3)}`, point);
    const ring = [...unique.values()];
    if (ring.length < 6) continue;
    const center = ring.reduce((sum, point) => ({ x: sum.x + point.x, z: sum.z + point.z }), { x: 0, z: 0 });
    center.x /= ring.length;
    center.z /= ring.length;
    const radius = ring.reduce((sum, point) => sum + Math.hypot(point.x - center.x, point.z - center.z), 0) / ring.length;
    if (radius < 0.05) continue;
    let edge = ring[0];
    let maxReach = 0;
    for (const point of ring) {
      const reach = Math.hypot(point.x - center.x, point.z - center.z);
      if (reach > maxReach) {
        maxReach = reach;
        edge = point;
      }
    }
    const fullCircle = maxReach * 2 > radius * 1.75;
    callouts.push({
      id: `curve-${owner}`,
      text: fullCircle ? `${(radius * 2).toFixed(1)} mm across` : `${radius.toFixed(1)} mm radius`,
      u: edge.x,
      v: edge.z,
      outU: edge.x - center.x,
      outV: edge.z - center.z,
    });
  }
  let centroidX = 0;
  let centroidZ = 0;
  let counted = 0;
  for (const segment of profile.segments) {
    if (consumed.has(segment.id) || segment.construction) continue;
    const start = pointById.get(segment.startId);
    const end = pointById.get(segment.endId);
    if (!start || !end) continue;
    centroidX += start.x + end.x;
    centroidZ += start.z + end.z;
    counted += 2;
  }
  if (counted > 0) {
    centroidX /= counted;
    centroidZ /= counted;
  }
  for (const segment of profile.segments) {
    if (consumed.has(segment.id) || segment.construction) continue;
    const start = pointById.get(segment.startId);
    const end = pointById.get(segment.endId);
    if (!start || !end) continue;
    const midU = (start.x + end.x) / 2;
    const midV = (start.z + end.z) / 2;
    let outU = midU - centroidX;
    let outV = midV - centroidZ;
    if (Math.hypot(outU, outV) < 0.05) {
      outU = -(end.z - start.z);
      outV = end.x - start.x;
    }
    const callout = edgeCallout(segment.id, start.x, start.z, end.x, end.z, outU, outV);
    if (callout) callouts.push(callout);
  }
  return callouts;
}

function ghostSizeCallouts(ghost: NonNullable<SketchOnModelSession["guideGhost"]>): SketchSizeCallout[] {
  let centroidU = 0;
  let centroidV = 0;
  let counted = 0;
  for (const segment of ghost.segments) {
    const start = ghost.points[segment.start];
    const end = ghost.points[segment.end];
    if (!start || !end) continue;
    centroidU += start.x + end.x;
    centroidV += start.z + end.z;
    counted += 2;
  }
  if (counted > 0) {
    centroidU /= counted;
    centroidV /= counted;
  }
  const callouts: SketchSizeCallout[] = [];
  ghost.segments.forEach((segment, index) => {
    const start = ghost.points[segment.start];
    const end = ghost.points[segment.end];
    if (!start || !end) return;
    const midU = (start.x + end.x) / 2;
    const midV = (start.z + end.z) / 2;
    const callout = edgeCallout(`ghost-${index}`, start.x, start.z, end.x, end.z, midU - centroidU, midV - centroidV);
    if (callout) callouts.push(callout);
  });
  return callouts;
}

/**
 * Sizes drawn on the shape itself. A drag reports the shape under the pointer.
 * Once the pointer is up, each finished edge keeps its length, and a circle
 * keeps how wide it is.
 */
export function sketch3DSizeCallouts(
  session: Pick<SketchOnModelSession, "tool" | "activePointId" | "profile" | "guideGhost">,
  pointer: Sketch3DPointerState,
): SketchSizeCallout[] {
  const drag = pointer.gesture?.kind === "drag" ? pointer.gesture : null;
  if (drag) {
    const span = Math.hypot(drag.current.x - drag.origin.x, drag.current.z - drag.origin.z);
    if (span < 0.05) return profileSizeCallouts(session.profile);
    if (drag.tool === "circle") {
      const callout = radialCallout(drag.origin, drag.current, true);
      return callout ? [callout] : [];
    }
    if (drag.tool === "triangle" || drag.tool === "polygon" || drag.tool === "star") {
      const callout = radialCallout(drag.origin, drag.current, true);
      return callout ? [callout] : [];
    }
    if (
      drag.tool === "rectangle"
      || drag.tool === "square"
      || drag.tool === "ellipse"
      || drag.tool === "roundRect"
      || drag.tool === "slot"
    ) {
      return boxCallouts(drag.origin, drag.current);
    }
    const callout = radialCallout(drag.origin, drag.current, false);
    return callout ? [callout] : [];
  }
  const placed = profileSizeCallouts(session.profile);
  if (placed.length > 0) return placed;
  if (session.tool === "line" && session.activePointId && pointer.hover) {
    const anchor = session.profile.points.find((point) => point.id === session.activePointId);
    if (anchor) {
      const typed = sketch3DTypedPoint(anchor, pointer.hover, pointer.lineEntry);
      const end = typed ?? pointer.hover;
      const callout = edgeCallout("line", anchor.x, anchor.z, end.x, end.z, -(end.z - anchor.z), end.x - anchor.x);
      if (callout) return [callout];
    }
  }
  if (session.guideGhost?.segments.length) return ghostSizeCallouts(session.guideGhost);
  return [];
}

/** World position of a sketch-plane point, lifted off the face the same way the sketch lines are. */
export function sketchUvToWorld(plane: SketchPlane, u: number, v: number) {
  const point = uvWorld(plane, u, v);
  return { x: point.x, y: point.y, z: point.z };
}

export type Sketch3DHost = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  controls: { target: THREE.Vector3; update: () => void };
};

export type SketchCameraPose = {
  target: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
};

const SKETCH_CAMERA_TILT = 0.14;
const SKETCH_CAMERA_NEAR_MM = 3;

function gridStepOf(snap: GridSize) {
  if (snap === "Off") return 0;
  const value = Number.parseFloat(snap);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Where a camera ray meets the sketch plane, in sketch millimetres (x = U, z = V). */
export function raySketchUV(
  plane: SketchPlane,
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
): UV | null {
  const resolved = resolveSketchPlane(plane);
  const surface = resolved.surface;
  if (surface?.kind === "cylinder") {
    const hit = rayCylinderPoint(surface.axisOrigin, surface.axisDir, surface.radius, origin, direction);
    if (!hit) return null;
    const uv = worldToCylinderUV(surface, hit);
    return { x: uv.u, z: uv.v };
  }
  const normal = resolved.normal;
  const denom = dot(direction, normal);
  if (Math.abs(denom) < 1e-6) return null;
  const delta = {
    x: resolved.origin.x - origin.x,
    y: resolved.origin.y - origin.y,
    z: resolved.origin.z - origin.z,
  };
  const t = dot(delta, normal) / denom;
  if (t < 0) return null;
  const world = {
    x: origin.x + direction.x * t,
    y: origin.y + direction.y * t,
    z: origin.z + direction.z * t,
  };
  const uv = worldToPlaneUV(resolved, world);
  return { x: uv.u, z: uv.v };
}

function rayCylinderPoint(
  axisOrigin: { x: number; y: number; z: number },
  axisDir: { x: number; y: number; z: number },
  radius: number,
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
) {
  const oc = {
    x: origin.x - axisOrigin.x,
    y: origin.y - axisOrigin.y,
    z: origin.z - axisOrigin.z,
  };
  const ocDot = dot(oc, axisDir);
  const dirDot = dot(direction, axisDir);
  const ocPerp = { x: oc.x - axisDir.x * ocDot, y: oc.y - axisDir.y * ocDot, z: oc.z - axisDir.z * ocDot };
  const dirPerp = { x: direction.x - axisDir.x * dirDot, y: direction.y - axisDir.y * dirDot, z: direction.z - axisDir.z * dirDot };
  const a = dot(dirPerp, dirPerp);
  const b = 2 * dot(ocPerp, dirPerp);
  const c = dot(ocPerp, ocPerp) - radius * radius;
  if (a < 1e-10) return null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t0 = (-b - root) / (2 * a);
  const t1 = (-b + root) / (2 * a);
  const t = t0 > 1e-4 ? t0 : t1 > 1e-4 ? t1 : null;
  if (t === null) return null;
  return {
    x: origin.x + direction.x * t,
    y: origin.y + direction.y * t,
    z: origin.z + direction.z * t,
  };
}

function screenUnit(host: Sketch3DHost, plane: SketchPlane) {
  const resolved = resolveSketchPlane(plane);
  const origin = resolved.surface?.kind === "cylinder" ? resolved.surface.axisOrigin : resolved.origin;
  const distance = host.camera.position.distanceTo(new THREE.Vector3(origin.x, origin.y, origin.z));
  const height = host.domElement.clientHeight || 720;
  const worldHeight = 2 * Math.tan(THREE.MathUtils.degToRad(host.camera.fov) / 2) * Math.max(distance, 1);
  return worldHeight / height;
}

function rayFromClient(host: Sketch3DHost, clientX: number, clientY: number) {
  const rect = host.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
    -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, host.camera);
  return raycaster.ray;
}

/** True when the camera is looking at the face, not along it. */
export function sketchViewFacesPlane(
  viewDirection: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  minimum = MIN_DRAW_FACING,
) {
  const viewLength = Math.hypot(viewDirection.x, viewDirection.y, viewDirection.z);
  const normalLength = Math.hypot(normal.x, normal.y, normal.z);
  if (viewLength < 1e-8 || normalLength < 1e-8) return false;
  const facing = Math.abs(
    (viewDirection.x * normal.x + viewDirection.y * normal.y + viewDirection.z * normal.z) / (viewLength * normalLength),
  );
  return facing >= minimum;
}

function faceNormalAt(plane: SketchPlane, uv: UV) {
  const resolved = resolveSketchPlane(plane);
  if (resolved.surface?.kind === "cylinder") return cylinderOutwardNormalAtUV(resolved.surface, uv.x);
  return resolved.normal;
}

function drawingAngleOk(host: Sketch3DHost, plane: SketchPlane, uv: UV) {
  const forward = new THREE.Vector3();
  host.camera.getWorldDirection(forward);
  return sketchViewFacesPlane(forward, faceNormalAt(plane, uv));
}

function clickOutsideFace(profile: SketchProfile, uv: UV) {
  const loops = profile.faceReferenceLoops;
  if (!loops?.length) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  loops.forEach((loop) => {
    loop.forEach((point) => {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    });
  });
  if (!Number.isFinite(minX)) return false;
  const span = Math.max(maxX - minX, maxZ - minZ, 10);
  const margin = Math.max(8, span * 0.35);
  return uv.x < minX - margin || uv.x > maxX + margin || uv.z < minZ - margin || uv.z > maxZ + margin;
}

function cursorOnSketch(
  host: Sketch3DHost,
  session: SketchOnModelSession,
  clientX: number,
  clientY: number,
  shiftKey: boolean,
  excludePointIds?: readonly string[],
): UV | null {
  const ray = rayFromClient(host, clientX, clientY);
  const raw = raySketchUV(session.plane, ray.origin, ray.direction);
  if (!raw) return null;
  const exclude = [...(excludePointIds ?? [])];
  if (session.activePointId && session.tool === "line") {
    exclude.push(session.activePointId);
  }
  const onDot = screenNearestSketchPoint(host, session, clientX, clientY, raw, exclude);
  if (onDot) return { x: onDot.x, z: onDot.z };
  const anchor = session.activePointId
    ? session.profile.points.find((point) => point.id === session.activePointId) ?? null
    : null;
  const snapped = snapSketchPoint(session.profile, {
    cursor: raw,
    from: session.tool === "line" ? anchor : null,
    screenUnit: screenUnit(host, session.plane),
    gridStep: gridStepOf(session.snap),
    excludePointIds,
    centers: sketchCenterSnapPoints(session.shapes ?? [], session.plane),
  });
  let point = { x: snapped.x, z: snapped.z };
  if (shiftKey && session.tool === "line" && anchor && snapped.kind === "grid") {
    point = snapHeading(anchor, point, 15);
  }
  return point;
}

/** Closest point id whose screen position is inside the pixel radius. */
export function nearestScreenPoint(
  hits: ReadonlyArray<{ id: string; x: number; y: number }>,
  clickX: number,
  clickY: number,
  pixelRadius: number,
): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const hit of hits) {
    const distance = Math.hypot(hit.x - clickX, hit.y - clickY);
    if (distance <= pixelRadius && (!best || distance < best.distance)) best = { id: hit.id, distance };
  }
  return best?.id ?? null;
}

function screenNearestSketchPoint(
  host: Sketch3DHost,
  session: SketchOnModelSession,
  clientX: number,
  clientY: number,
  raw: UV | null,
  excludePointIds?: readonly string[],
) {
  if (!raw) return null;
  const excluded = excludePointIds?.length ? new Set(excludePointIds) : null;
  const rect = host.domElement.getBoundingClientRect();
  const hits: Array<{ id: string; x: number; y: number }> = [];
  for (const point of session.profile.points) {
    if (curveStandInOwner(point.id) || excluded?.has(point.id)) continue;
    const world = uvWorld(session.plane, point.x, point.z);
    world.project(host.camera);
    if (world.z < -1 || world.z > 1) continue;
    const screenX = (world.x * 0.5 + 0.5) * rect.width + rect.left;
    const screenY = (-world.y * 0.5 + 0.5) * rect.height + rect.top;
    const distance = Math.hypot(screenX - clientX, screenY - clientY);
    if (distance > POINT_PICK_PX) continue;
    // A face-on click on the dot lands within a few millimetres. Reject a far point that
    // only lines up because the view is zoomed out.
    const limit = Math.max(4, screenUnit(host, session.plane) * POINT_PICK_PX);
    if (Math.hypot(point.x - raw.x, point.z - raw.z) > limit) continue;
    hits.push({ id: point.id, x: screenX, y: screenY });
  }
  const id = nearestScreenPoint(hits, clientX, clientY, POINT_PICK_PX);
  return id ? session.profile.points.find((point) => point.id === id) ?? null : null;
}

function nearestPoint(profile: SketchProfile, uv: UV, tolerance: number) {
  let best: { id: string; distance: number } | null = null;
  for (const point of profile.points) {
    if (curveStandInOwner(point.id)) continue;
    const distance = Math.hypot(point.x - uv.x, point.z - uv.z);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { id: point.id, distance };
  }
  return best?.id ?? null;
}

function nearestSegment(profile: SketchProfile, uv: UV, tolerance: number) {
  const byId = new Map(profile.points.map((point) => [point.id, point]));
  let best: { id: string; distance: number } | null = null;
  for (const segment of profile.segments) {
    const a = byId.get(segment.startId);
    const b = byId.get(segment.endId);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((uv.x - a.x) * dx + (uv.z - a.z) * dz) / len2));
    const distance = Math.hypot(a.x + dx * t - uv.x, a.z + dz * t - uv.z);
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { id: curveStandInOwner(segment.id) ?? segment.id, distance };
    }
  }
  return best?.id ?? null;
}

function addEraseHit(profile: SketchProfile, uv: UV, tolerance: number, pointIds: Set<string>, segmentIds: Set<string>) {
  const pointId = nearestPoint(profile, uv, tolerance);
  if (pointId) pointIds.add(pointId);
  const segmentId = nearestSegment(profile, uv, tolerance);
  if (segmentId) segmentIds.add(segmentId);
}

export function sketch3DPointerDown(
  host: Sketch3DHost,
  session: SketchOnModelSession,
  pointer: Sketch3DPointerState,
  clientX: number,
  clientY: number,
  pointerId: number,
  shiftKey: boolean,
) {
  if (session.tool !== "arc") pointer.arc = [];
  const uv = cursorOnSketch(host, session, clientX, clientY, shiftKey);
  if (!uv) {
    session.onNotice?.("Turn the view until you can see the sketch face, then click it");
    return;
  }
  if (!drawingAngleOk(host, session.plane, uv)) {
    pointer.hover = null;
    session.onNotice?.("That angle is too shallow to draw. Orbit until the face is toward you, or click 3D sketch again.");
    syncSketchOnModel(host, session, pointer);
    return;
  }
  if (clickOutsideFace(session.profile, uv)) {
    session.onNotice?.("Click on the sketch face");
    return;
  }
  pointer.hover = uv;
  const tolerance = Math.max(1.2, screenUnit(host, session.plane) * 12);
  if (session.tool === "select") {
    const pointId = nearestPoint(session.profile, uv, tolerance);
    if (pointId) {
      pointer.gesture = { kind: "move", pointerId, pointId, origin: uv, current: uv, moved: false };
      syncSketchOnModel(host, session, pointer);
      return;
    }
    const segmentId = nearestSegment(session.profile, uv, tolerance);
    if (segmentId) session.onSelectSegment(segmentId, uv);
    else session.onSelectMany([], [], []);
    return;
  }
  if (session.tool === "erase") {
    const pointIds = new Set<string>();
    const segmentIds = new Set<string>();
    addEraseHit(session.profile, uv, tolerance, pointIds, segmentIds);
    pointer.gesture = { kind: "erase", pointerId, pointIds: [...pointIds], segmentIds: [...segmentIds] };
    return;
  }
  if (session.tool === "offset") {
    const segmentId = nearestSegment(session.profile, uv, tolerance * 1.4);
    if (segmentId) session.onOffsetSegment(segmentId, uv);
    else session.onNotice?.("Click a line to offset");
    return;
  }
  if (DRAG_TOOLS.has(session.tool)) {
    pointer.gesture = { kind: "drag", tool: session.tool, pointerId, origin: uv, current: uv };
    syncSketchOnModel(host, session, pointer);
    return;
  }
  if (session.tool === "arc") {
    const next = [...pointer.arc, uv];
    if (next.length >= 3) {
      session.onDrawArc(next[0], next[1], next[2]);
      pointer.arc = [];
    } else {
      pointer.arc = next;
    }
    syncSketchOnModel(host, session, pointer);
    return;
  }
  if (session.tool === "line" || session.tool === "measure") {
    const hit = nearestPoint(session.profile, uv, tolerance * 0.85);
    if (hit) session.onPointPress(hit);
    else session.onPlanePoint(uv);
    return;
  }
  if (session.tool === "smooth") {
    const hit = nearestPoint(session.profile, uv, tolerance * 0.85);
    if (hit) session.onPointPress(hit);
    else {
      const segmentId = nearestSegment(session.profile, uv, tolerance);
      if (segmentId) session.onSelectSegment(segmentId, uv);
      else session.onPlanePoint(uv);
    }
    return;
  }
  const pointId = nearestPoint(session.profile, uv, tolerance);
  if (pointId) {
    session.onPointPress(pointId);
    return;
  }
  const segmentId = nearestSegment(session.profile, uv, tolerance);
  if (segmentId) {
    session.onSelectSegment(segmentId, uv);
    return;
  }
  if (!DRAW_TOOLS.has(session.tool)) {
    session.onNotice?.("Open Focus 2D to use that tool on the flat sheet");
  }
}

export function sketch3DPointerMove(
  host: Sketch3DHost,
  session: SketchOnModelSession,
  pointer: Sketch3DPointerState,
  clientX: number,
  clientY: number,
  shiftKey: boolean,
) {
  const draggingId = pointer.gesture?.kind === "move" ? pointer.gesture.pointId : undefined;
  if (session.tool !== "line") pointer.lineEntry = "";
  const uv = cursorOnSketch(host, session, clientX, clientY, shiftKey, draggingId ? [draggingId] : undefined);
  if (uv && !pointer.gesture && !drawingAngleOk(host, session.plane, uv)) {
    pointer.hover = null;
    syncSketchOnModel(host, session, pointer);
    return;
  }
  pointer.hover = uv;
  const gesture = pointer.gesture;
  if (uv && gesture?.kind === "drag") gesture.current = uv;
  if (uv && gesture?.kind === "move") {
    gesture.current = uv;
    gesture.moved = gesture.moved || Math.hypot(uv.x - gesture.origin.x, uv.z - gesture.origin.z) > 0.4;
  }
  if (uv && gesture?.kind === "erase") {
    const tolerance = Math.max(1.2, screenUnit(host, session.plane) * 12);
    const pointIds = new Set(gesture.pointIds);
    const segmentIds = new Set(gesture.segmentIds);
    addEraseHit(session.profile, uv, tolerance, pointIds, segmentIds);
    gesture.pointIds = [...pointIds];
    gesture.segmentIds = [...segmentIds];
  }
  syncSketchOnModel(host, session, pointer);
}

export function sketch3DPointerUp(session: SketchOnModelSession, pointer: Sketch3DPointerState) {
  const gesture = pointer.gesture;
  pointer.gesture = null;
  if (!gesture) return;
  if (gesture.kind === "move") {
    if (gesture.moved) session.onMovePoint(gesture.pointId, gesture.current);
    else session.onPointPress(gesture.pointId);
    return;
  }
  if (gesture.kind === "erase") {
    if (gesture.pointIds.length || gesture.segmentIds.length) {
      session.onEraseEntities(gesture.pointIds, gesture.segmentIds);
    }
    return;
  }
  const { origin, current, tool } = gesture;
  const span = Math.hypot(current.x - origin.x, current.z - origin.z);
  if (tool === "bezier") {
    const dx = current.x - origin.x;
    const dz = current.z - origin.z;
    session.onPlanePoint(origin, span > 0.4 ? {
      handleIn: { x: origin.x - dx, z: origin.z - dz },
      handleOut: { x: origin.x + dx, z: origin.z + dz },
    } : undefined);
    return;
  }
  if (span < 0.4) return;
  if (tool === "circle") session.onDrawCircle(origin, span);
  else if (tool === "ellipse") session.onDrawEllipse(origin, current);
  else if (tool === "square") session.onDrawSquare(origin, current);
  else if (tool === "rectangle") session.onDrawRectangle(origin, current);
  else if (tool === "roundRect") session.onDrawRoundRect(origin, current);
  else if (tool === "slot") session.onDrawSlot(origin, current);
  else if (tool === "triangle") session.onDrawTriangle(origin, current);
  else if (tool === "polygon") session.onDrawPolygon(origin, current);
  else if (tool === "star") session.onDrawStar(origin, current);
}

function addCenterMark(
  group: THREE.Group,
  host: Sketch3DHost,
  plane: SketchPlane,
  session: SketchOnModelSession,
  pointer: Sketch3DPointerState,
) {
  const cursor = pointer.gesture?.kind === "drag" || pointer.gesture?.kind === "move"
    ? pointer.gesture.current
    : pointer.hover;
  if (!cursor) return;
  const centers = sketchCenterSnapPoints(session.shapes ?? [], plane);
  if (!centers.some((center) => Math.hypot(center.x - cursor.x, center.z - cursor.z) < 0.05)) return;
  const radius = Math.max(1.5, screenUnit(host, plane) * 10);
  const ring: number[] = [];
  const steps = 24;
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const point = uvWorld(plane, cursor.x + Math.cos(angle) * radius, cursor.z + Math.sin(angle) * radius);
    ring.push(point.x, point.y, point.z);
  }
  const left = uvWorld(plane, cursor.x - radius, cursor.z);
  const right = uvWorld(plane, cursor.x + radius, cursor.z);
  const down = uvWorld(plane, cursor.x, cursor.z - radius);
  const up = uvWorld(plane, cursor.x, cursor.z + radius);
  const ringGeometry = new THREE.BufferGeometry();
  ringGeometry.setAttribute("position", new THREE.Float32BufferAttribute(ring, 3));
  const ringLine = new THREE.Line(ringGeometry, CENTER_MARK_MATERIAL);
  ringLine.renderOrder = 24;
  group.add(ringLine);
  const crossGeometry = new THREE.BufferGeometry();
  crossGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
    left.x, left.y, left.z, right.x, right.y, right.z,
    down.x, down.y, down.z, up.x, up.y, up.z,
  ], 3));
  const cross = new THREE.LineSegments(crossGeometry, CENTER_MARK_MATERIAL);
  cross.renderOrder = 24;
  group.add(cross);
}

function addGuideGhost(group: THREE.Group, plane: SketchPlane, ghost: SketchOnModelSession["guideGhost"]) {
  if (!ghost?.segments.length) return;
  const positions: number[] = [];
  for (const segment of ghost.segments) {
    const start = ghost.points[segment.start];
    const end = ghost.points[segment.end];
    if (!start || !end) continue;
    const a = uvWorld(plane, start.x, start.z);
    const b = uvWorld(plane, end.x, end.z);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  if (positions.length < 6) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(geometry, GUIDE_GHOST_MATERIAL);
  lines.renderOrder = 21;
  group.add(lines);
}

function uvWorld(plane: SketchPlane, u: number, v: number) {
  const resolved = resolveSketchPlane(plane);
  if (resolved.surface?.kind === "cylinder") {
    const point = cylinderUVToWorld(resolved.surface, u, v);
    const normal = cylinderOutwardNormalAtUV(resolved.surface, u);
    return new THREE.Vector3(
      point.x + normal.x * LIFT_MM,
      point.y + normal.y * LIFT_MM,
      point.z + normal.z * LIFT_MM,
    );
  }
  const point = planeUVToWorld(resolved, u, v);
  const normal = resolved.normal;
  return new THREE.Vector3(
    point.x + normal.x * LIFT_MM,
    point.y + normal.y * LIFT_MM,
    point.z + normal.z * LIFT_MM,
  );
}

function sampleCurve(start: { x: number; z: number; handleOut?: { x: number; z: number } }, end: { x: number; z: number; handleIn?: { x: number; z: number } }, kind: SketchSegment["kind"]) {
  if (kind !== "bezier" && kind !== "smooth") return [start, end];
  const c1 = start.handleOut ?? start;
  const c2 = end.handleIn ?? end;
  const points: UV[] = [];
  for (let step = 0; step <= 16; step += 1) {
    const t = step / 16;
    const u = 1 - t;
    points.push({
      x: u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
      z: u * u * u * start.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * end.z,
    });
  }
  return points;
}

function pushWorld(positions: number[], plane: SketchPlane, points: UV[], subdivide: boolean) {
  const samples: UV[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = subdivide ? Math.max(1, Math.ceil(length / 2)) : 1;
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      samples.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  const last = points[points.length - 1];
  if (last) samples.push(last);
  samples.forEach((point) => {
    const world = uvWorld(plane, point.x, point.z);
    positions.push(world.x, world.y, world.z);
  });
}

function addLine(group: THREE.Group, positions: number[], color: string, dashed = false) {
  if (positions.length < 6) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 1.4, gapSize: 0.9, depthTest: true })
    : new THREE.LineBasicMaterial({ color, depthTest: true });
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  line.renderOrder = 20;
  group.add(line);
}

function addFill(group: THREE.Group, plane: SketchPlane, loop: UV[], color: string, opacity: number) {
  if (loop.length < 3) return;
  let geometry: THREE.ShapeGeometry;
  try {
    const shape = new THREE.Shape(loop.map((point) => new THREE.Vector2(point.x, point.z)));
    geometry = new THREE.ShapeGeometry(shape);
  } catch {
    return;
  }
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const world = uvWorld(plane, position.getX(index), position.getY(index));
    position.setXYZ(index, world.x, world.y, world.z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  mesh.renderOrder = 19;
  group.add(mesh);
}

function roundedBoxLoop(origin: UV, corner: UV, radius: number, steps = 4): UV[] {
  const x0 = Math.min(origin.x, corner.x);
  const x1 = Math.max(origin.x, corner.x);
  const z0 = Math.min(origin.z, corner.z);
  const z1 = Math.max(origin.z, corner.z);
  const width = x1 - x0;
  const height = z1 - z0;
  const r = Math.min(radius, width / 2, height / 2);
  if (r <= 0.01) {
    return [
      { x: x0, z: z0 },
      { x: x1, z: z0 },
      { x: x1, z: z1 },
      { x: x0, z: z1 },
      { x: x0, z: z0 },
    ];
  }
  const corners: Array<{ cx: number; cz: number; start: number }> = [
    { cx: x1 - r, cz: z0 + r, start: -Math.PI / 2 },
    { cx: x1 - r, cz: z1 - r, start: 0 },
    { cx: x0 + r, cz: z1 - r, start: Math.PI / 2 },
    { cx: x0 + r, cz: z0 + r, start: Math.PI },
  ];
  const loop: UV[] = [];
  for (const cornerArc of corners) {
    for (let step = 0; step <= steps; step += 1) {
      const angle = cornerArc.start + (step / steps) * (Math.PI / 2);
      loop.push({
        x: cornerArc.cx + Math.cos(angle) * r,
        z: cornerArc.cz + Math.sin(angle) * r,
      });
    }
  }
  loop.push(loop[0]);
  return loop;
}

function regularLoop(origin: UV, vertex: UV, sides: number, inner = 1): UV[] {
  const radius = Math.hypot(vertex.x - origin.x, vertex.z - origin.z);
  if (radius < 0.01) return [];
  const start = Math.atan2(vertex.z - origin.z, vertex.x - origin.x);
  const count = inner < 1 ? sides * 2 : sides;
  const loop: UV[] = [];
  for (let step = 0; step <= count; step += 1) {
    const angle = start + (step / count) * Math.PI * 2;
    const span = inner < 1 && step % 2 === 1 ? radius * inner : radius;
    loop.push({ x: origin.x + Math.cos(angle) * span, z: origin.z + Math.sin(angle) * span });
  }
  return loop;
}

function dragPreviewLoop(tool: SketchTool, origin: UV, current: UV): UV[] {
  if (tool === "circle") {
    const radius = Math.hypot(current.x - origin.x, current.z - origin.z);
    if (radius < 0.01) return [];
    const ring: UV[] = [];
    for (let step = 0; step <= 48; step += 1) {
      const angle = (step / 48) * Math.PI * 2;
      ring.push({ x: origin.x + Math.cos(angle) * radius, z: origin.z + Math.sin(angle) * radius });
    }
    return ring;
  }
  if (tool === "ellipse") {
    const cx = (origin.x + current.x) / 2;
    const cz = (origin.z + current.z) / 2;
    const rx = Math.abs(current.x - origin.x) / 2;
    const rz = Math.abs(current.z - origin.z) / 2;
    if (rx < 0.01 || rz < 0.01) return [];
    const ring: UV[] = [];
    for (let step = 0; step <= 48; step += 1) {
      const angle = (step / 48) * Math.PI * 2;
      ring.push({ x: cx + Math.cos(angle) * rx, z: cz + Math.sin(angle) * rz });
    }
    return ring;
  }
  if (tool === "square") {
    const dx = current.x - origin.x;
    const dz = current.z - origin.z;
    const side = Math.max(Math.abs(dx), Math.abs(dz));
    if (side < 0.01) return [];
    const sx = Math.sign(dx) || 1;
    const sz = Math.sign(dz) || 1;
    return [
      origin,
      { x: origin.x + sx * side, z: origin.z },
      { x: origin.x + sx * side, z: origin.z + sz * side },
      { x: origin.x, z: origin.z + sz * side },
      origin,
    ];
  }
  if (tool === "rectangle") {
    if (Math.abs(current.x - origin.x) < 0.01 || Math.abs(current.z - origin.z) < 0.01) return [];
    return [
      origin,
      { x: current.x, z: origin.z },
      current,
      { x: origin.x, z: current.z },
      origin,
    ];
  }
  if (tool === "roundRect") {
    const width = Math.abs(current.x - origin.x);
    const height = Math.abs(current.z - origin.z);
    if (width < 0.01 || height < 0.01) return [];
    return roundedBoxLoop(origin, current, Math.min(width, height) * 0.22);
  }
  if (tool === "slot") {
    const width = Math.abs(current.x - origin.x);
    const height = Math.abs(current.z - origin.z);
    if (width < 0.01 || height < 0.01) return [];
    return roundedBoxLoop(origin, current, Math.min(width, height) / 2, 8);
  }
  if (tool === "triangle") return regularLoop(origin, current, 3);
  if (tool === "polygon") return regularLoop(origin, current, 6);
  if (tool === "star") return regularLoop(origin, current, 5, 0.4);
  return [origin, current];
}

function disposeGroup(group: THREE.Object3D) {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line)) return;
    if (!SHARED_RESOURCES.has(child.geometry)) child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!SHARED_RESOURCES.has(material)) material.dispose();
    });
  });
}

export function clearSketchOnModel(scene: THREE.Scene) {
  for (const name of [GROUP_NAME, LIVE_GROUP_NAME]) {
    const existing = scene.getObjectByName(name);
    if (!existing) continue;
    scene.remove(existing);
    disposeGroup(existing);
  }
}

function sketchBounds(profile: SketchProfile) {
  const points = [
    ...profile.points.filter((point) => !curveStandInOwner(point.id)),
    ...(profile.faceReferenceLoops ?? []).flat(),
  ];
  if (points.length === 0) return { minX: -40, maxX: 40, minZ: -40, maxZ: 40, span: 80 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  });
  const span = Math.max(maxX - minX, maxZ - minZ, 20);
  const pad = Math.max(8, span * 0.2);
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad, span: span + pad * 2 };
}

function vec3(x: number, y: number, z: number) {
  return { x, y, z };
}

function hypot3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function sphericalFromOffset(offset: { x: number; y: number; z: number }) {
  const radius = Math.max(Math.hypot(offset.x, offset.y, offset.z), 1e-6);
  return {
    radius,
    phi: Math.acos(Math.min(1, Math.max(-1, offset.y / radius))),
    theta: Math.atan2(offset.x, offset.z),
  };
}

function offsetFromSpherical(radius: number, phi: number, theta: number) {
  const sinPhi = Math.sin(phi);
  return vec3(
    radius * sinPhi * Math.sin(theta),
    radius * Math.cos(phi),
    radius * sinPhi * Math.cos(theta),
  );
}

function shortestAngle(from: number, to: number) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function sketchCameraEase(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

export function sketchFramingPose(session: Pick<SketchOnModelSession, "plane" | "profile">): SketchCameraPose {
  const resolved = resolveSketchPlane(session.plane);
  const bounds = sketchBounds(session.profile);
  const centerUV = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
  const focus = uvWorld(resolved, centerUV.x, centerUV.z);
  const normal = resolved.surface?.kind === "cylinder"
    ? cylinderOutwardNormalAtUV(resolved.surface, centerUV.x)
    : resolved.normal;
  const distance = THREE.MathUtils.clamp(bounds.span * 2.6, 48, 900);
  const position = vec3(
    focus.x + normal.x * distance,
    focus.y + normal.y * distance,
    focus.z + normal.z * distance,
  );
  // A hair of pitch keeps lookAt stable. Offset along -V (not the isometric XZ
  // diagonal) so sketch U is screen-right and the grid sits square, not diamond.
  if (Math.abs(normal.y) > 0.94) {
    const v = sketchPlaneVAxis(resolved);
    const hx = -v.x;
    const hz = -v.z;
    const hLen = Math.hypot(hx, hz) || 1;
    position.x += (hx / hLen) * distance * SKETCH_CAMERA_TILT;
    position.z += (hz / hLen) * distance * SKETCH_CAMERA_TILT;
  }
  // OrbitControls captures its up-axis quaternion once. A sketch-aligned camera.up
  // rolls lookAt while orbit/pan/zoom still use world Y, so the view feels stuck
  // after the enter tween and after Extrude. Keep world up; the tilt is enough.
  return { target: vec3(focus.x, focus.y, focus.z), position, up: vec3(0, 1, 0) };
}

export function captureSketchCameraPose(host: Sketch3DHost): SketchCameraPose {
  return {
    target: vec3(host.controls.target.x, host.controls.target.y, host.controls.target.z),
    position: vec3(host.camera.position.x, host.camera.position.y, host.camera.position.z),
    up: vec3(host.camera.up.x, host.camera.up.y, host.camera.up.z),
  };
}

export function applySketchCameraPose(host: Sketch3DHost, pose: SketchCameraPose) {
  host.controls.target.set(pose.target.x, pose.target.y, pose.target.z);
  host.camera.up.set(0, 1, 0);
  host.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  host.camera.lookAt(host.controls.target);
  host.camera.updateProjectionMatrix();
  host.controls.update();
}

export function interpolateSketchCameraPose(
  from: SketchCameraPose,
  to: SketchCameraPose,
  t: number,
): SketchCameraPose {
  const u = Math.min(1, Math.max(0, t));
  const target = vec3(
    from.target.x + (to.target.x - from.target.x) * u,
    from.target.y + (to.target.y - from.target.y) * u,
    from.target.z + (to.target.z - from.target.z) * u,
  );
  const fromOff = vec3(
    from.position.x - from.target.x,
    from.position.y - from.target.y,
    from.position.z - from.target.z,
  );
  const toOff = vec3(
    to.position.x - to.target.x,
    to.position.y - to.target.y,
    to.position.z - to.target.z,
  );
  const a = sphericalFromOffset(fromOff);
  const b = sphericalFromOffset(toOff);
  const offset = offsetFromSpherical(
    a.radius + (b.radius - a.radius) * u,
    a.phi + (b.phi - a.phi) * u,
    a.theta + shortestAngle(a.theta, b.theta) * u,
  );
  const up = vec3(
    from.up.x + (to.up.x - from.up.x) * u,
    from.up.y + (to.up.y - from.up.y) * u,
    from.up.z + (to.up.z - from.up.z) * u,
  );
  const upLen = Math.hypot(up.x, up.y, up.z) || 1;
  return {
    target,
    position: vec3(target.x + offset.x, target.y + offset.y, target.z + offset.z),
    up: vec3(up.x / upLen, up.y / upLen, up.z / upLen),
  };
}

export function sketchCameraNearlyFramed(from: SketchCameraPose, to: SketchCameraPose) {
  return hypot3(from.position, to.position) < SKETCH_CAMERA_NEAR_MM
    && hypot3(from.target, to.target) < SKETCH_CAMERA_NEAR_MM;
}

export function sketchCameraTweenMs(from: SketchCameraPose, to: SketchCameraPose) {
  const fromOff = vec3(
    from.position.x - from.target.x,
    from.position.y - from.target.y,
    from.position.z - from.target.z,
  );
  const toOff = vec3(
    to.position.x - to.target.x,
    to.position.y - to.target.y,
    to.position.z - to.target.z,
  );
  const fromLen = Math.hypot(fromOff.x, fromOff.y, fromOff.z) || 1;
  const toLen = Math.hypot(toOff.x, toOff.y, toOff.z) || 1;
  const dot = Math.min(1, Math.max(-1,
    (fromOff.x * toOff.x + fromOff.y * toOff.y + fromOff.z * toOff.z) / (fromLen * toLen),
  ));
  const angle = Math.acos(dot);
  const targetTravel = hypot3(from.target, to.target);
  return THREE.MathUtils.clamp(300 + angle * 280 + Math.min(targetTravel, 140) * 1.35, 380, 640);
}

export function frameSketchCamera(host: Sketch3DHost, session: SketchOnModelSession) {
  applySketchCameraPose(host, sketchFramingPose(session));
}

type StaticLayerKey = {
  profile: SketchProfile;
  plane: SketchOnModelSession["plane"];
  snap: SketchOnModelSession["snap"];
};

/**
 * Pointer moves re-sync the overlay many times a second. The grid, fills and
 * segment lines only depend on the profile/plane/snap identities, so they live
 * in their own group and are rebuilt only when one of those changes; hover and
 * drag previews (plus point dots) are rebuilt in a light "live" group.
 */
function reuseStaticLayer(scene: THREE.Scene, key: StaticLayerKey): THREE.Group | null {
  const existing = scene.getObjectByName(GROUP_NAME);
  if (!(existing instanceof THREE.Group)) return null;
  const previous = existing.userData.staticKey as StaticLayerKey | undefined;
  if (!previous || previous.profile !== key.profile || previous.plane !== key.plane || previous.snap !== key.snap) {
    scene.remove(existing);
    disposeGroup(existing);
    return null;
  }
  return existing;
}

export function syncSketchOnModel(host: Sketch3DHost, session: SketchOnModelSession, pointer: Sketch3DPointerState) {
  const plane = resolveSketchPlane(session.plane);
  const curved = plane.surface?.kind === "cylinder";
  const byId = new Map(session.profile.points.map((point) => [point.id, point]));
  const staticKey: StaticLayerKey = { profile: session.profile, plane: session.plane, snap: session.snap };

  let group = reuseStaticLayer(host.scene, staticKey);
  if (!group) {
    group = buildStaticLayer(session, plane, curved, byId);
    group.userData.staticKey = staticKey;
    host.scene.add(group);
  }

  const liveExisting = host.scene.getObjectByName(LIVE_GROUP_NAME);
  if (liveExisting) {
    host.scene.remove(liveExisting);
    disposeGroup(liveExisting);
  }
  const live = new THREE.Group();
  live.name = LIVE_GROUP_NAME;

  const moved = pointer.gesture?.kind === "move" ? pointer.gesture : null;
  for (const point of session.profile.points) {
    if (curveStandInOwner(point.id)) continue;
    const at = moved?.pointId === point.id ? moved.current : point;
    const world = uvWorld(plane, at.x, at.z);
    const active = point.id === session.activePointId || point.id === moved?.pointId;
    const sphere = new THREE.Mesh(POINT_GEOMETRY, active ? POINT_MATERIAL_ACTIVE : POINT_MATERIAL);
    sphere.position.copy(world);
    sphere.renderOrder = 22;
    live.add(sphere);
  }

  const preview: number[] = [];
  const drag = pointer.gesture?.kind === "drag" ? pointer.gesture : null;
  if (drag) {
    const loop = dragPreviewLoop(drag.tool, drag.origin, drag.current);
    if (loop.length >= 3 && (loop[0].x !== loop[loop.length - 1].x || loop[0].z !== loop[loop.length - 1].z)) {
      loop.push(loop[0]);
    }
    if (loop.length >= 4) addFill(live, plane, loop, "#169fce", 0.12);
    pushWorld(preview, plane, loop.length >= 2 ? loop : [drag.origin, drag.current], curved || drag.tool === "circle" || drag.tool === "ellipse");
  } else if (pointer.hover && (session.tool === "line" || session.tool === "arc")) {
    const anchor = session.activePointId ? byId.get(session.activePointId) : null;
    const from = anchor ?? pointer.arc[pointer.arc.length - 1];
    const typed = session.tool === "line" && anchor ? sketch3DTypedPoint(anchor, pointer.hover, pointer.lineEntry) : null;
    const end = typed ?? pointer.hover;
    if (from) pushWorld(preview, plane, [from, end], curved);
  }
  addLine(live, preview, "#169fce");
  addCenterMark(live, host, plane, session, pointer);
  addGuideGhost(live, plane, session.guideGhost);

  host.scene.add(live);
}

function buildStaticLayer(
  session: SketchOnModelSession,
  plane: SketchPlane,
  curved: boolean,
  byId: Map<string, SketchProfile["points"][number]>,
): THREE.Group {
  const group = new THREE.Group();
  group.name = GROUP_NAME;
  const bounds = sketchBounds(session.profile);

  if (!curved) {
    const grid = gridStepOf(session.snap) || 10;
    const positions: number[] = [];
    const startX = Math.ceil(bounds.minX / grid) * grid;
    const startZ = Math.ceil(bounds.minZ / grid) * grid;
    for (let x = startX; x <= bounds.maxX + 0.001 && positions.length < 4000; x += grid) {
      const a = uvWorld(plane, x, bounds.minZ);
      const b = uvWorld(plane, x, bounds.maxZ);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    for (let z = startZ; z <= bounds.maxZ + 0.001 && positions.length < 8000; z += grid) {
      const a = uvWorld(plane, bounds.minX, z);
      const b = uvWorld(plane, bounds.maxX, z);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    if (positions.length >= 6) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color: "#7f9caf",
        transparent: true,
        opacity: 0.45,
        depthTest: true,
      }));
      lines.renderOrder = 18;
      group.add(lines);
    }
  }

  for (const loop of session.profile.faceReferenceLoops ?? []) {
    if (loop.length < 2) continue;
    const positions: number[] = [];
    pushWorld(positions, plane, [...loop, loop[0]], curved);
    addLine(group, positions, "#2f6f9f");
  }

  for (const path of orderedSketchPaths(session.profile)) {
    if (!path.closed || path.steps.every((step) => step.segment.construction)) continue;
    const loop: UV[] = [];
    for (const step of path.steps) {
      const samples = sampleCurve(step.from, step.to, step.segment.kind);
      if (loop.length === 0) loop.push(...samples);
      else loop.push(...samples.slice(1));
    }
    addFill(group, plane, loop, "#4a8cc8", 0.22);
  }

  for (const segment of session.profile.segments) {
    const start = byId.get(segment.startId);
    const end = byId.get(segment.endId);
    if (!start || !end) continue;
    const positions: number[] = [];
    pushWorld(positions, plane, sampleCurve(start, end, segment.kind), curved || segment.kind === "bezier" || segment.kind === "smooth");
    addLine(group, positions, segment.construction ? "#8a6232" : "#173f60", Boolean(segment.construction));
  }

  return group;
}
