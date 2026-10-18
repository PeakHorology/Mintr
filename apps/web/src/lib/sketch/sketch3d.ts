import * as THREE from "three";
import type { GridSize, SketchPlane, SketchProfile, SketchSegment } from "@/types/sketchforge";
import { cylinderUVToWorld, cylinderOutwardNormalAtUV, worldToCylinderUV } from "@/lib/sketchCylinder";
import { planeUVToWorld, resolveSketchPlane, worldToPlaneUV } from "@/lib/sketchPlane";
import type { SketchTool } from "@/components/SketchWorkspace";
import { curveStandInOwner } from "./migrate";
import { snapHeading } from "./lineEntry";
import { snapSketchPoint } from "./snaps";

const GROUP_NAME = "sketch-on-model";
const LIFT_MM = 0.35;
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
};

export function emptySketch3DPointer(): Sketch3DPointerState {
  return { gesture: null, arc: [], hover: null };
}

export type Sketch3DHost = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  controls: { target: THREE.Vector3; update: () => void };
};

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
  if (session.activePointId && (session.tool === "line" || session.tool === "smooth")) {
    exclude.push(session.activePointId);
  }
  const onDot = screenNearestSketchPoint(host, session, clientX, clientY, raw, exclude);
  if (onDot) return { x: onDot.x, z: onDot.z };
  const anchor = session.activePointId
    ? session.profile.points.find((point) => point.id === session.activePointId) ?? null
    : null;
  const snapped = snapSketchPoint(session.profile, {
    cursor: raw,
    from: session.tool === "line" || session.tool === "smooth" ? anchor : null,
    screenUnit: screenUnit(host, session.plane),
    gridStep: gridStepOf(session.snap),
    excludePointIds,
  });
  let point = { x: snapped.x, z: snapped.z };
  if (shiftKey && (session.tool === "line" || session.tool === "smooth") && anchor && snapped.kind === "grid") {
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
    session.onNotice?.("That angle is too shallow to draw. Orbit until the face is toward you, or use Look at face.");
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
  if (session.tool === "line" || session.tool === "smooth" || session.tool === "measure") {
    const hit = nearestPoint(session.profile, uv, tolerance * 0.85);
    if (hit) session.onPointPress(hit);
    else session.onPlanePoint(uv);
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

function disposeGroup(group: THREE.Object3D) {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

export function clearSketchOnModel(scene: THREE.Scene) {
  const existing = scene.getObjectByName(GROUP_NAME);
  if (!existing) return;
  scene.remove(existing);
  disposeGroup(existing);
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

export function frameSketchCamera(host: Sketch3DHost, session: SketchOnModelSession) {
  const resolved = resolveSketchPlane(session.plane);
  const bounds = sketchBounds(session.profile);
  const centerUV = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
  const focus = uvWorld(resolved, centerUV.x, centerUV.z);
  const normal = resolved.surface?.kind === "cylinder"
    ? new THREE.Vector3(
      cylinderOutwardNormalAtUV(resolved.surface, centerUV.x).x,
      cylinderOutwardNormalAtUV(resolved.surface, centerUV.x).y,
      cylinderOutwardNormalAtUV(resolved.surface, centerUV.x).z,
    )
    : new THREE.Vector3(resolved.normal.x, resolved.normal.y, resolved.normal.z);
  const distance = THREE.MathUtils.clamp(bounds.span * 2.6, 48, 900);
  host.controls.target.copy(focus);
  host.camera.up.set(0, 1, 0);
  host.camera.position.copy(focus).addScaledVector(normal, distance);
  host.camera.lookAt(focus);
  host.camera.updateProjectionMatrix();
  host.controls.update();
}

export function syncSketchOnModel(host: Sketch3DHost, session: SketchOnModelSession, pointer: Sketch3DPointerState) {
  clearSketchOnModel(host.scene);
  const group = new THREE.Group();
  group.name = GROUP_NAME;
  const plane = resolveSketchPlane(session.plane);
  const curved = plane.surface?.kind === "cylinder";
  const bounds = sketchBounds(session.profile);
  const byId = new Map(session.profile.points.map((point) => [point.id, point]));

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

  for (const segment of session.profile.segments) {
    const start = byId.get(segment.startId);
    const end = byId.get(segment.endId);
    if (!start || !end) continue;
    const positions: number[] = [];
    pushWorld(positions, plane, sampleCurve(start, end, segment.kind), curved || segment.kind === "bezier" || segment.kind === "smooth");
    addLine(group, positions, segment.construction ? "#8a6232" : "#173f60", Boolean(segment.construction));
  }

  const moved = pointer.gesture?.kind === "move" ? pointer.gesture : null;
  for (const point of session.profile.points) {
    if (curveStandInOwner(point.id)) continue;
    const at = moved?.pointId === point.id ? moved.current : point;
    const world = uvWorld(plane, at.x, at.z);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 12, 8),
      new THREE.MeshBasicMaterial({
        color: point.id === session.activePointId || point.id === moved?.pointId ? "#ff8a00" : "#f7fbfc",
        depthTest: true,
      }),
    );
    sphere.position.copy(world);
    sphere.renderOrder = 22;
    group.add(sphere);
  }

  const preview: number[] = [];
  const drag = pointer.gesture?.kind === "drag" ? pointer.gesture : null;
  if (drag) {
    if (drag.tool === "circle") {
      const radius = Math.hypot(drag.current.x - drag.origin.x, drag.current.z - drag.origin.z);
      const ring: UV[] = [];
      for (let step = 0; step <= 48; step += 1) {
        const angle = (step / 48) * Math.PI * 2;
        ring.push({ x: drag.origin.x + Math.cos(angle) * radius, z: drag.origin.z + Math.sin(angle) * radius });
      }
      pushWorld(preview, plane, ring, curved);
    } else {
      pushWorld(preview, plane, [drag.origin, drag.current], curved);
    }
  } else if (pointer.hover && (session.tool === "line" || session.tool === "smooth" || session.tool === "arc")) {
    const anchor = session.activePointId ? byId.get(session.activePointId) : null;
    const from = anchor ?? pointer.arc[pointer.arc.length - 1];
    if (from) pushWorld(preview, plane, [from, pointer.hover], curved);
  }
  addLine(group, preview, "#e07a00");

  host.scene.add(group);
}
