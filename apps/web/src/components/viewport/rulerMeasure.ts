import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import * as THREE from "three";
import {
  antipodeThroughAxis,
  type CircleFit,
  classifyMeasureAlignment,
  closestPointOnSegmentToRay,
  diameterMagnetTarget,
  faceToFacePoint,
  fitCircleFromPoints,
  intersectRayFiniteCylinder,
  isAxialDirection,
  type MeasureAlignKind,
  measureAlignLabelPrefix,
  projectPointOnAxis,
  rulerEdgeIsInFrontOfSurface,
  rulerEdgeNearSurfaceHit,
  type ShapeAxes,
  snapPointToCylinder,
  vec3,
  vecDistance,
} from "@/lib/rulerAlignment";
import { clamp, projectToScreen, rulerShapeDimensions } from "@/lib/viewportInteractionMath";
import type {
  RankedRulerPick,
  RulerAttachment,
  RulerCandidate,
  RulerEdgeAttachment,
  RulerModel,
  RulerOverlayState,
  RulerPoint,
  ThreeState,
} from "@/components/viewport/viewportTypes";
import { formatMeasure, type MeasureFormat } from "@/components/viewport/formatMeasure";
import { findShapeObject } from "@/components/viewport/sceneLookup";
import { projectCadPointToCanvas } from "@/components/viewport/screenProjection";
import { preciseMeshHits } from "@/components/viewport/meshPick";

export function rulerAttachmentWorld(state: ThreeState, attachment: RulerAttachment) {
  const object = findShapeObject(state, attachment.shapeId);
  if (!object) return null;
  const dimensions = rulerShapeDimensions(object);
  return object.localToWorld(new THREE.Vector3(
    attachment.normalized[0] * dimensions[0],
    attachment.normalized[1] * dimensions[1],
    attachment.normalized[2] * dimensions[2],
  ));
}

export function rulerAttachmentFromWorld(state: ThreeState, shapeId: string, world: THREE.Vector3, kind: RulerAttachment["kind"] = "surface"): RulerAttachment | null {
  const object = findShapeObject(state, shapeId);
  if (!object) return null;
  const dimensions = rulerShapeDimensions(object);
  const local = object.worldToLocal(world.clone());
  return {
    shapeId,
    kind,
    topologyKey: object.userData.rulerTopologyKey as string | undefined,
    normalized: [
      local.x / Math.max(0.001, dimensions[0]),
      local.y / Math.max(0.001, dimensions[1]),
      local.z / Math.max(0.001, dimensions[2]),
    ],
  };
}

export function shapeWorldAxes(object: THREE.Object3D): ShapeAxes {
  object.updateWorldMatrix(true, true);
  const e = object.matrixWorld.elements;
  return {
    origin: new THREE.Vector3().setFromMatrixPosition(object.matrixWorld),
    x: vec3(e[0], e[1], e[2]),
    y: vec3(e[4], e[5], e[6]),
    z: vec3(e[8], e[9], e[10]),
  };
}

export function vecFromThree(point: THREE.Vector3) {
  return vec3(point.x, point.y, point.z);
}

export function threeFromVec(point: { x: number; y: number; z: number }) {
  return new THREE.Vector3(point.x, point.y, point.z);
}

export function circleFitFromWorldPoints(worldPoints: THREE.Vector3[]): CircleFit | null {
  if (worldPoints.length < 8) return null;
  const closed = worldPoints[0].distanceToSquared(worldPoints[worldPoints.length - 1]) < 1e-8;
  if (!closed && worldPoints.length < 12) return null;
  return fitCircleFromPoints(worldPoints.map(vecFromThree));
}

export function cylinderMeasureFromObject(object: THREE.Object3D): CircleFit | null {
  if (!object.userData.round && !object.userData.radialSnap) return null;
  const axes = shapeWorldAxes(object);
  const dimensions = rulerShapeDimensions(object);
  const across = dimensions[0];
  const along = dimensions[2];
  if (Math.abs(across - along) > 0.05) return null;
  return {
    center: axes.origin,
    axis: axes.y,
    radius: across / 2,
  };
}

export function snapWorldToCylinder(world: THREE.Vector3, circle: CircleFit) {
  return threeFromVec(snapPointToCylinder(vecFromThree(world), circle.center, circle.axis, circle.radius));
}

export function attachSnappedCirclePoint(
  state: ThreeState,
  shapeId: string,
  world: THREE.Vector3,
  circle: CircleFit,
  kind: RulerAttachment["kind"] = "edge",
  extra?: Partial<RulerAttachment>,
): { x: number; y: number; z: number; attachment: RulerAttachment } {
  const snapped = snapWorldToCylinder(world, circle);
  const attachment = rulerAttachmentFromWorld(state, shapeId, snapped, kind);
  return {
    x: snapped.x,
    y: snapped.y,
    z: snapped.z,
    attachment: {
      ...(attachment ?? { shapeId, kind, normalized: [0, 0, 0] }),
      ...extra,
      circle,
      kind,
    },
  };
}

export function finalizeRulerPick(state: ThreeState, candidate: RulerCandidate): RulerCandidate {
  const circle = candidate.attachment?.circle;
  if (!circle || !candidate.attachment) return candidate;
  return {
    ...attachSnappedCirclePoint(
      state,
      candidate.attachment.shapeId,
      new THREE.Vector3(candidate.x, candidate.y, candidate.z),
      circle,
      candidate.attachment.kind ?? "edge",
    ),
    edge: candidate.edge,
    alignHint: candidate.alignHint,
  };
}

export function alignmentTicks(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size = 9,
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const px = (-dy / length) * size;
  const py = (dx / length) * size;
  return [
    { x1: x1 - px, y1: y1 - py, x2: x1 + px, y2: y1 + py },
    { x1: x2 - px, y1: y2 - py, x2: x2 + px, y2: y2 + py },
  ];
}

export function classifyRulerSegmentAlignment(
  state: ThreeState,
  start: RulerPoint,
  end: RulerPoint,
  startWorld: THREE.Vector3,
  endWorld: THREE.Vector3,
  edge?: RulerEdgeAttachment,
) {
  const startObject = start.attachment ? findShapeObject(state, start.attachment.shapeId) : null;
  const endObject = end.attachment ? findShapeObject(state, end.attachment.shapeId) : null;
  const object = startObject ?? endObject;
  const circle = edge?.circle ?? start.attachment?.circle ?? end.attachment?.circle ?? null;
  return classifyMeasureAlignment({
    start: vecFromThree(startWorld),
    end: vecFromThree(endWorld),
    axes: object ? shapeWorldAxes(object) : undefined,
    circle: circle ?? (object ? cylinderMeasureFromObject(object) ?? undefined : undefined),
    startNormal: start.attachment?.normal ? vec3(...start.attachment.normal) : undefined,
    endNormal: end.attachment?.normal ? vec3(...end.attachment.normal) : undefined,
    round: Boolean(object?.userData.round),
  });
}

export function rulerPointWorld(state: ThreeState, point: Pick<RulerPoint, "x" | "y" | "z" | "attachment">) {
  return point.attachment ? rulerAttachmentWorld(state, point.attachment) ?? new THREE.Vector3(point.x, point.y, point.z) : new THREE.Vector3(point.x, point.y, point.z);
}

export function rulerEdgeWorldPoints(state: ThreeState, edge: RulerEdgeAttachment) {
  return edge.normalizedPoints.flatMap((normalized) => {
    const world = rulerAttachmentWorld(state, { shapeId: edge.shapeId, normalized });
    return world ? [world] : [];
  });
}

export function rulerPolylineLength(points: THREE.Vector3[]) {
  let length = 0;
  for (let index = 0; index + 1 < points.length; index += 1) length += points[index].distanceTo(points[index + 1]);
  return length;
}

export function rulerPolylineMidpoint(points: THREE.Vector3[]) {
  if (points.length === 0) return new THREE.Vector3();
  const half = rulerPolylineLength(points) / 2;
  let traversed = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const length = points[index].distanceTo(points[index + 1]);
    if (traversed + length >= half && length > 1e-9) return points[index].clone().lerp(points[index + 1], (half - traversed) / length);
    traversed += length;
  }
  return points[points.length - 1].clone();
}

export function rulerScreenPointList(points: THREE.Vector3[], state: ThreeState) {
  return points.map((point) => {
    const screen = projectToScreen(point, state);
    return `${screen.x},${screen.y}`;
  }).join(" ");
}

export function chainRulerLineSegments(segments: Array<[THREE.Vector3, THREE.Vector3]>) {
  if (segments.length <= 1) return segments.map(([a, b]) => [a, b]);
  const bounds = new THREE.Box3();
  segments.forEach(([a, b]) => {
    bounds.expandByPoint(a);
    bounds.expandByPoint(b);
  });
  const tolerance = Math.max(1e-6, bounds.getSize(new THREE.Vector3()).length() * 1e-5);
  const tangentLimit = Math.cos(THREE.MathUtils.degToRad(20));
  const unused = new Set(segments.map((_, index) => index));
  const paths: THREE.Vector3[][] = [];

  while (unused.size > 0) {
    const firstIndex = unused.values().next().value as number;
    unused.delete(firstIndex);
    const path = [segments[firstIndex][0].clone(), segments[firstIndex][1].clone()];
    let extended = true;
    while (extended) {
      extended = false;
      for (const index of unused) {
        const [a, b] = segments[index];
        const end = path[path.length - 1];
        const endDirection = end.clone().sub(path[path.length - 2]).normalize();
        const endOther = a.distanceTo(end) <= tolerance ? b : b.distanceTo(end) <= tolerance ? a : null;
        if (endOther && Math.abs(endDirection.dot(endOther.clone().sub(end).normalize())) >= tangentLimit) {
          path.push(endOther.clone());
          unused.delete(index);
          extended = true;
          break;
        }
        const start = path[0];
        const startDirection = start.clone().sub(path[1]).normalize();
        const startOther = a.distanceTo(start) <= tolerance ? b : b.distanceTo(start) <= tolerance ? a : null;
        if (startOther && Math.abs(startDirection.dot(startOther.clone().sub(start).normalize())) >= tangentLimit) {
          path.unshift(startOther.clone());
          unused.delete(index);
          extended = true;
          break;
        }
      }
    }
    paths.push(path);
  }
  return paths;
}

export function rulerNormalizedLineSegments(state: ThreeState, shapeId: string) {
  const object = findShapeObject(state, shapeId);
  if (!object) return [];
  object.updateWorldMatrix(true, true);
  const dimensions = rulerShapeDimensions(object);
  const normalizedFromWorld = (world: THREE.Vector3) => {
    const local = object.worldToLocal(world.clone());
    return new THREE.Vector3(
      local.x / Math.max(0.001, dimensions[0]),
      local.y / Math.max(0.001, dimensions[1]),
      local.z / Math.max(0.001, dimensions[2]),
    );
  };
  const segments: Array<[THREE.Vector3, THREE.Vector3]> = [];
  object.traverse((child) => {
    if (!(child instanceof THREE.Line) || !child.visible) return;
    const position = child.geometry.getAttribute("position");
    if (!position || position.count < 2) return;
    const points: THREE.Vector3[] = [];
    for (let index = 0; index < position.count; index += 1) {
      points.push(normalizedFromWorld(new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld)));
    }
    if ((child as THREE.LineSegments).isLineSegments) {
      for (let index = 0; index + 1 < points.length; index += 2) segments.push([points[index], points[index + 1]]);
    } else {
      for (let index = 0; index + 1 < points.length; index += 1) segments.push([points[index], points[index + 1]]);
      if ((child as THREE.LineLoop).isLineLoop && points.length > 2) segments.push([points[points.length - 1], points[0]]);
    }
  });
  return segments;
}

export function rulerPointToSegmentDistance(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3) {
  const delta = end.clone().sub(start);
  const lengthSq = delta.lengthSq();
  const amount = lengthSq > 1e-12 ? clamp(point.clone().sub(start).dot(delta) / lengthSq, 0, 1) : 0;
  return point.distanceTo(start.clone().addScaledVector(delta, amount));
}

export function rulerAttachmentMatchesTopology(state: ThreeState, attachment: RulerAttachment) {
  const object = findShapeObject(state, attachment.shapeId);
  if (!object) return false;
  const currentTopologyKey = object.userData.rulerTopologyKey as string | undefined;
  if (!attachment.topologyKey || attachment.topologyKey === currentTopologyKey || attachment.kind === "surface") return true;
  const target = new THREE.Vector3(...attachment.normalized);
  const segments = rulerNormalizedLineSegments(state, attachment.shapeId);
  if (attachment.kind === "vertex") {
    return segments.some(([start, end]) => start.distanceTo(target) <= 0.002 || end.distanceTo(target) <= 0.002);
  }
  return segments.some(([start, end]) => rulerPointToSegmentDistance(target, start, end) <= 0.002);
}

export function rulerEdgeMatchesTopology(state: ThreeState, edge: RulerEdgeAttachment) {
  const object = findShapeObject(state, edge.shapeId);
  if (!object) return false;
  const currentTopologyKey = object.userData.rulerTopologyKey as string | undefined;
  if (!edge.topologyKey || edge.topologyKey === currentTopologyKey) return true;
  const segments = rulerNormalizedLineSegments(state, edge.shapeId);
  if (segments.length === 0) return false;
  const samples = edge.normalizedPoints.filter((_, index) => (
    index === 0
    || index === edge.normalizedPoints.length - 1
    || index % Math.max(1, Math.floor(edge.normalizedPoints.length / 8)) === 0
  ));
  return samples.every((point) => {
    const target = new THREE.Vector3(...point);
    return segments.some(([start, end]) => rulerPointToSegmentDistance(target, start, end) <= 0.002);
  });
}

export function rulerWorldPerPixel(state: ThreeState, world: THREE.Vector3, rect: DOMRect) {
  const camera = state.camera;
  const distance = camera.position.distanceTo(world);
  if (!(camera instanceof THREE.PerspectiveCamera) || rect.height < 1) return 0.25;
  return (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / rect.height;
}

export function rulerPointAlongRay(state: ThreeState, world: THREE.Vector3) {
  return Math.max(0, world.clone().sub(state.camera.position).dot(state.raycaster.ray.direction));
}

export function rulerWorldIsOccluded(state: ThreeState, targets: THREE.Object3D[], world: THREE.Vector3, rect: DOMRect, surfaceDistance?: number) {
  const firstDistance = surfaceDistance ?? preciseMeshHits(state, targets)[0]?.distance;
  if (firstDistance === undefined) return false;
  const slack = Math.max(0.75, rulerWorldPerPixel(state, world, rect) * 4);
  return firstDistance + slack < rulerPointAlongRay(state, world);
}

export const RULER_VERTEX_PX = 10;
export const RULER_EDGE_PX = 12;
export const RULER_ANTIPODE_PX = 28;
export const RULER_ALIGN_PX = 22;

export function stampRulerNormal(candidate: RulerCandidate, normal: THREE.Vector3 | null): RulerCandidate {
  if (!normal || !candidate.attachment || candidate.attachment.normal) return candidate;
  return {
    ...candidate,
    attachment: { ...candidate.attachment, normal: [normal.x, normal.y, normal.z] },
  };
}

export function applySeedAlignment(
  state: ThreeState,
  seed: RulerPoint,
  candidate: RulerCandidate,
  rect: DOMRect,
  pointerX: number,
  pointerY: number,
  hitNormal?: THREE.Vector3 | null,
): RulerCandidate {
  const stamped = stampRulerNormal(candidate, hitNormal ?? null);
  const seedWorld = rulerPointWorld(state, seed);
  const endWorld = new THREE.Vector3(stamped.x, stamped.y, stamped.z);
  const hoverPoint: RulerPoint = {
    id: "hover",
    x: stamped.x,
    y: stamped.y,
    z: stamped.z,
    attachment: stamped.attachment,
  };
  const startObject = seed.attachment ? findShapeObject(state, seed.attachment.shapeId) : null;
  const endObject = stamped.attachment ? findShapeObject(state, stamped.attachment.shapeId) : null;
  const object = startObject ?? endObject;
  const sameShape = Boolean(seed.attachment && stamped.attachment && seed.attachment.shapeId === stamped.attachment.shapeId);
  const circle = stamped.attachment?.circle
    ?? seed.attachment?.circle
    ?? stamped.edge?.circle
    ?? (object ? cylinderMeasureFromObject(object) : null);
  const barrelCircle = object?.userData.radialSnap ? cylinderMeasureFromObject(object) ?? circle : circle;

  if (sameShape && barrelCircle && stamped.attachment) {
    const snappedSeed = snapPointToCylinder(vecFromThree(seedWorld), barrelCircle.center, barrelCircle.axis, barrelCircle.radius);
    const antipode = antipodeThroughAxis(snappedSeed, barrelCircle.center, barrelCircle.axis);
    const antipodeScreen = projectCadPointToCanvas(threeFromVec(antipode), state, rect);
    const antipodeDist = antipodeScreen ? Math.hypot(pointerX - antipodeScreen.x, pointerY - antipodeScreen.y) : Infinity;
    const magnet = diameterMagnetTarget(vecFromThree(seedWorld), vecFromThree(endWorld), barrelCircle, antipodeDist, { maxPx: RULER_ANTIPODE_PX });
    if (magnet) {
      return {
        ...attachSnappedCirclePoint(
          state,
          stamped.attachment.shapeId,
          threeFromVec(magnet),
          barrelCircle,
          "surface",
          hitNormal
            ? { normal: [hitNormal.x, hitNormal.y, hitNormal.z] }
            : stamped.attachment.normal
              ? { normal: stamped.attachment.normal }
              : undefined,
        ),
        alignHint: "diameter",
      };
    }
  }

  const endNormal = stamped.attachment?.normal;
  if (seed.attachment?.normal && endNormal) {
    const projected = faceToFacePoint(
      vecFromThree(seedWorld),
      vec3(...seed.attachment.normal),
      vecFromThree(endWorld),
      vec3(...endNormal),
    );
    const faceGap = projected ? vecDistance(projected, vecFromThree(seedWorld)) : 0;
    if (projected && faceGap >= 0.5) {
      const projectedWorld = threeFromVec(projected);
      const projectedScreen = projectCadPointToCanvas(projectedWorld, state, rect);
      const screenDist = projectedScreen ? Math.hypot(pointerX - projectedScreen.x, pointerY - projectedScreen.y) : Infinity;
      if (screenDist <= RULER_ALIGN_PX || vecDistance(projected, vecFromThree(endWorld)) <= 4) {
        const shapeId = stamped.attachment?.shapeId ?? seed.attachment.shapeId;
        const attachment = rulerAttachmentFromWorld(state, shapeId, projectedWorld, "surface");
        if (attachment) {
          attachment.normal = endNormal;
          return { x: projectedWorld.x, y: projectedWorld.y, z: projectedWorld.z, attachment, alignHint: "face" };
        }
      }
    }
  }

  const alignment = classifyRulerSegmentAlignment(state, seed, hoverPoint, seedWorld, endWorld, stamped.edge);
  if (alignment?.kind === "axis" && object) {
    const axes = shapeWorldAxes(object);
    const axisVec = alignment.axis === "x" ? axes.x : alignment.axis === "y" ? axes.y : axes.z;
    const projected = projectPointOnAxis(vecFromThree(endWorld), vecFromThree(seedWorld), axisVec);
    const projectedWorld = threeFromVec(projected);
    const projectedScreen = projectCadPointToCanvas(projectedWorld, state, rect);
    const screenDist = projectedScreen ? Math.hypot(pointerX - projectedScreen.x, pointerY - projectedScreen.y) : Infinity;
    if (screenDist <= 18 || vecDistance(projected, vecFromThree(endWorld)) <= 3) {
      const shapeId = stamped.attachment?.shapeId ?? (object.userData.shapeId as string);
      const attachment = rulerAttachmentFromWorld(state, shapeId, projectedWorld, stamped.attachment?.kind ?? "surface");
      if (attachment) {
        if (stamped.attachment?.normal) attachment.normal = stamped.attachment.normal;
        if (stamped.attachment?.circle) attachment.circle = stamped.attachment.circle;
        return { x: projectedWorld.x, y: projectedWorld.y, z: projectedWorld.z, attachment, alignHint: "axis" };
      }
    }
  }

  if (alignment) return { ...stamped, alignHint: alignment.kind };
  return stamped;
}

export function rulerSnapWindowMm(worldPerPixel: number) {
  return Math.max(1.5, Math.min(2.8, worldPerPixel * 8));
}

export function compareRulerPicks(a: RankedRulerPick, b: RankedRulerPick) {
  if (Math.abs(a.rayDist - b.rayDist) > 0.25) return a.rayDist - b.rayDist;
  if (Math.abs(a.rayT - b.rayT) > 1) return a.rayT - b.rayT;
  return a.screenDist - b.screenDist;
}

export function pickModelRulerCandidate(
  state: ThreeState,
  shapeIds: string[],
  clientX: number,
  clientY: number,
  seed?: RulerPoint | null,
): RulerCandidate | null {
  const rect = state.renderer.domElement.getBoundingClientRect();
  const pointerX = clientX - rect.left;
  const pointerY = clientY - rect.top;
  const targets = shapeIds.flatMap((id) => {
    const object = findShapeObject(state, id);
    return object ? [object] : [];
  });
  if (targets.length === 0) return null;

  state.camera.updateMatrixWorld();
  targets.forEach((target) => target.updateWorldMatrix(true, true));
  state.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  state.raycaster.setFromCamera(state.pointer, state.camera);
  const rayOrigin = vecFromThree(state.raycaster.ray.origin);
  const rayDir = vecFromThree(state.raycaster.ray.direction);
  const ranked: RankedRulerPick[] = [];

  targets.forEach((target) => {
    const shapeId = target.userData.shapeId as string;
    target.traverse((child) => {
      if (!(child instanceof THREE.Line) || !child.visible) return;
      const position = child.geometry.getAttribute("position");
      if (!position || position.count < 2) return;
      const paths: THREE.Vector3[][] = [];
      if ((child as THREE.LineSegments).isLineSegments) {
        const segments: Array<[THREE.Vector3, THREE.Vector3]> = [];
        for (let index = 0; index + 1 < position.count; index += 2) {
          segments.push([
            new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld),
            new THREE.Vector3().fromBufferAttribute(position, index + 1).applyMatrix4(child.matrixWorld),
          ]);
        }
        paths.push(...chainRulerLineSegments(segments));
      } else {
        const path: THREE.Vector3[] = [];
        for (let index = 0; index < position.count; index += 1) path.push(new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld));
        if ((child as THREE.LineLoop).isLineLoop && path.length > 2) path.push(path[0].clone());
        paths.push(path);
      }

      paths.forEach((worldPoints, pathIndex) => {
        if (worldPoints.length < 2) return;
        const attachments = worldPoints.map((point) => rulerAttachmentFromWorld(state, shapeId, point, "edge"));
        if (attachments.some((attachment) => !attachment)) return;
        const normalizedPoints = attachments.map((attachment) => (attachment as RulerAttachment).normalized);
        const closed = worldPoints[0].distanceToSquared(worldPoints[worldPoints.length - 1]) < 1e-10;
        const edge: RulerEdgeAttachment = {
          key: `${shapeId}:${child.uuid}:${pathIndex}`,
          shapeId,
          normalizedPoints,
          topologyKey: target.userData.rulerTopologyKey as string | undefined,
          circle: circleFitFromWorldPoints(worldPoints) ?? undefined,
        };
        const circle = edge.circle;
        const endpointIndexes = closed ? [0] : [0, worldPoints.length - 1];
        endpointIndexes.forEach((index) => {
          const screen = projectCadPointToCanvas(worldPoints[index], state, rect);
          if (!screen) return;
          const screenDist = Math.hypot(pointerX - screen.x, pointerY - screen.y);
          if (screenDist > RULER_VERTEX_PX) return;
          const along = closestPointOnSegmentToRay(vecFromThree(worldPoints[index]), vecFromThree(worldPoints[index]), rayOrigin, rayDir);
          const maxRay = rulerSnapWindowMm(rulerWorldPerPixel(state, worldPoints[index], rect));
          if (along.distance > maxRay) return;
          ranked.push({
            screenDist,
            rayDist: along.distance,
            rayT: along.rayT,
            candidate: {
              x: worldPoints[index].x,
              y: worldPoints[index].y,
              z: worldPoints[index].z,
              attachment: { ...(attachments[index] as RulerAttachment), kind: "vertex", circle },
              edge,
            },
          });
        });

        for (let index = 0; index + 1 < worldPoints.length; index += 1) {
          const start = worldPoints[index];
          const end = worldPoints[index + 1];
          const aScreen = projectCadPointToCanvas(start, state, rect);
          const bScreen = projectCadPointToCanvas(end, state, rect);
          if (!aScreen || !bScreen) continue;
          const along = closestPointOnSegmentToRay(vecFromThree(start), vecFromThree(end), rayOrigin, rayDir);
          const world = threeFromVec(along.point);
          const screen = projectCadPointToCanvas(world, state, rect);
          if (!screen) continue;
          const screenDist = Math.hypot(pointerX - screen.x, pointerY - screen.y);
          if (screenDist > RULER_EDGE_PX) continue;
          const maxRay = rulerSnapWindowMm(rulerWorldPerPixel(state, world, rect));
          if (along.distance > maxRay) continue;
          const amount = along.segmentT;
          const normalizedA = normalizedPoints[index];
          const normalizedB = normalizedPoints[index + 1];
          ranked.push({
            screenDist,
            rayDist: along.distance,
            rayT: along.rayT,
            candidate: {
              x: world.x,
              y: world.y,
              z: world.z,
              attachment: {
                shapeId,
                kind: "edge",
                topologyKey: target.userData.rulerTopologyKey as string | undefined,
                circle,
                normalized: [
                  normalizedA[0] + (normalizedB[0] - normalizedA[0]) * amount,
                  normalizedA[1] + (normalizedB[1] - normalizedA[1]) * amount,
                  normalizedA[2] + (normalizedB[2] - normalizedA[2]) * amount,
                ],
              },
              edge,
            },
          });
        }
      });
    });
  });

  ranked.sort(compareRulerPicks);

  const surfaceHit = preciseMeshHits(state, targets)[0];

  if (surfaceHit) {
    const hitPoint = surfaceHit.point.clone();
    const hitId = (surfaceHit.object.userData.shapeId as string | undefined) ?? (surfaceHit.object.parent?.userData.shapeId as string | undefined);
    const hitWpp = rulerWorldPerPixel(state, hitPoint, rect);
    const worldNormal = surfaceHit.face
      ? surfaceHit.face.normal.clone().transformDirection(surfaceHit.object.matrixWorld).normalize()
      : null;
    const hitObject = hitId ? findShapeObject(state, hitId) : null;
    const barrelCircle = hitObject?.userData.radialSnap ? cylinderMeasureFromObject(hitObject) : null;
    const barrelHit = Boolean(barrelCircle && worldNormal && !isAxialDirection(vecFromThree(worldNormal), barrelCircle.axis));
    const nearby = ranked.filter((pick) => {
      if (hitId && pick.candidate.attachment?.shapeId !== hitId) return false;
      if (pick.screenDist > RULER_EDGE_PX) return false;
      const world = new THREE.Vector3(pick.candidate.x, pick.candidate.y, pick.candidate.z);
      const onFace = rulerEdgeNearSurfaceHit(vecFromThree(hitPoint), vecFromThree(world), hitWpp);
      const inFront = rulerEdgeIsInFrontOfSurface(pick.rayT, surfaceHit.distance, hitWpp);
      if (!onFace && !inFront) return false;
      return !rulerWorldIsOccluded(state, targets, world, rect, surfaceHit.distance);
    });
    nearby.sort(compareRulerPicks);

    const surfaceCandidate = (() => {
      if (!hitId) return null;
      if (barrelCircle && barrelHit) {
        return attachSnappedCirclePoint(
          state,
          hitId,
          hitPoint,
          barrelCircle,
          "surface",
          worldNormal ? { normal: [worldNormal.x, worldNormal.y, worldNormal.z] } : undefined,
        );
      }
      const attachment = rulerAttachmentFromWorld(state, hitId, hitPoint);
      if (!attachment) return null;
      if (worldNormal) attachment.normal = [worldNormal.x, worldNormal.y, worldNormal.z];
      return { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z, attachment } satisfies RulerCandidate;
    })();

    const finish = (candidate: RulerCandidate) => (
      seed ? applySeedAlignment(state, seed, candidate, rect, pointerX, pointerY, worldNormal) : stampRulerNormal(candidate, worldNormal)
    );

    if (nearby[0]) return stampRulerNormal(finalizeRulerPick(state, nearby[0].candidate), worldNormal);
    if (seed && surfaceCandidate) {
      const aligned = applySeedAlignment(state, seed, surfaceCandidate, rect, pointerX, pointerY, worldNormal);
      const seedWorld = rulerPointWorld(state, seed);
      const jumpedToSeed = Math.hypot(aligned.x - seedWorld.x, aligned.y - seedWorld.y, aligned.z - seedWorld.z) < 0.5;
      if (!jumpedToSeed && (aligned.alignHint === "diameter" || aligned.alignHint === "face")) return aligned;
    }
    if (surfaceCandidate) return finish(surfaceCandidate);
    return null;
  }

  const silhouette = ranked.find((pick) => (
    pick.screenDist <= RULER_EDGE_PX
    && !rulerWorldIsOccluded(state, targets, new THREE.Vector3(pick.candidate.x, pick.candidate.y, pick.candidate.z), rect)
  ));
  if (silhouette) {
    const pick = finalizeRulerPick(state, silhouette.candidate);
    return seed ? applySeedAlignment(state, seed, pick, rect, pointerX, pointerY) : pick;
  }

  for (const target of targets) {
    if (target.userData.shapeKind !== "cylinder") continue;
    const circle = cylinderMeasureFromObject(target);
    if (!circle) continue;
    const dimensions = rulerShapeDimensions(target);
    const hit = intersectRayFiniteCylinder(
      rayOrigin,
      rayDir,
      circle.center,
      circle.axis,
      circle.radius,
      dimensions[1] / 2,
    );
    if (!hit) continue;
    const world = threeFromVec(hit.point);
    const screen = projectCadPointToCanvas(world, state, rect);
    if (!screen || Math.hypot(pointerX - screen.x, pointerY - screen.y) > RULER_EDGE_PX) continue;
    if (rulerWorldIsOccluded(state, targets, world, rect)) continue;
    const analytic = attachSnappedCirclePoint(state, target.userData.shapeId as string, world, circle, "surface");
    return seed ? applySeedAlignment(state, seed, analytic, rect, pointerX, pointerY) : analytic;
  }

  return null;
}

export function syncRulerOverlay(
  state: ThreeState,
  model: RulerModel,
  overlayRef: MutableRefObject<RulerOverlayState | null>,
  setOverlay: Dispatch<SetStateAction<RulerOverlayState | null>>,
  measure: MeasureFormat,
) {
  const projectedPoints = new Map<string, { screenX: number; screenY: number }>();
  const points = model.points.map((point) => {
    const screen = projectToScreen(rulerPointWorld(state, point), state);
    const projected = { screenX: screen.x, screenY: screen.y };
    projectedPoints.set(point.id, projected);
    return { ...point, ...projected };
  });
  const segments = model.segments.flatMap((segment) => {
    const start = model.points.find((point) => point.id === segment.startId);
    const end = model.points.find((point) => point.id === segment.endId);
    const startScreen = projectedPoints.get(segment.startId);
    const endScreen = projectedPoints.get(segment.endId);
    if (!start || !end || !startScreen || !endScreen) {
      return [];
    }
    const startWorld = rulerPointWorld(state, start);
    const endWorld = rulerPointWorld(state, end);
    const attachedEdgePoints = segment.edge ? rulerEdgeWorldPoints(state, segment.edge) : [];
    const worldPoints = attachedEdgePoints.length >= 2 ? attachedEdgePoints : [startWorld, endWorld];
    const labelScreen = projectToScreen(rulerPolylineMidpoint(worldPoints), state);
    const alignment = classifyRulerSegmentAlignment(state, start, end, startWorld, endWorld, segment.edge);
    const alignKind = alignment?.kind ?? null;
    const prefix = measureAlignLabelPrefix(alignKind);
    return [
      {
        ...segment,
        x1: startScreen.screenX,
        y1: startScreen.screenY,
        x2: endScreen.screenX,
        y2: endScreen.screenY,
        screenPoints: segment.edge && worldPoints.length >= 2 ? rulerScreenPointList(worldPoints, state) : undefined,
        labelX: labelScreen.x,
        labelY: labelScreen.y - 18,
        label: `${prefix}${formatMeasure(rulerPolylineLength(worldPoints), measure)}`,
        alignKind,
        ticks: alignKind ? alignmentTicks(startScreen.screenX, startScreen.screenY, endScreen.screenX, endScreen.screenY) : undefined,
      },
    ];
  });
  const hoverWorld = model.hover ? rulerPointWorld(state, model.hover) : null;
  const hoverScreen = hoverWorld ? projectToScreen(hoverWorld, state) : null;
  const hoverEdgePoints = model.hover?.edge ? rulerEdgeWorldPoints(state, model.hover.edge) : [];
  const pointAlign = new Map<string, MeasureAlignKind>();
  segments.forEach((segment) => {
    if (!segment.alignKind) return;
    pointAlign.set(segment.startId, segment.alignKind);
    pointAlign.set(segment.endId, segment.alignKind);
  });
  const alignedPoints = points.map((point) => ({ ...point, alignKind: pointAlign.get(point.id) ?? null }));
  const startPoint = model.startPointId ? model.points.find((point) => point.id === model.startPointId) : null;
  const startWorld = startPoint ? rulerPointWorld(state, startPoint) : null;
  const startScreen = startPoint ? projectedPoints.get(startPoint.id) : null;
  let hoverAlign = model.hover?.alignHint ?? null;
  let hoverPreview: NonNullable<RulerOverlayState["hover"]>["preview"];
  if (startPoint && startWorld && startScreen && hoverWorld && hoverScreen && model.hover) {
    const hoverPoint: RulerPoint = {
      id: "hover",
      x: model.hover.x,
      y: model.hover.y,
      z: model.hover.z,
      attachment: model.hover.attachment,
    };
    const live = classifyRulerSegmentAlignment(state, startPoint, hoverPoint, startWorld, hoverWorld, model.hover.edge);
    hoverAlign = startWorld.distanceTo(hoverWorld) < 0.4 ? null : (model.hover.alignHint ?? live?.kind ?? null);
    const prefix = measureAlignLabelPrefix(hoverAlign);
    const midScreen = projectToScreen(startWorld.clone().lerp(hoverWorld, 0.5), state);
    hoverPreview = {
      x1: startScreen.screenX,
      y1: startScreen.screenY,
      x2: hoverScreen.x,
      y2: hoverScreen.y,
      ticks: hoverAlign ? alignmentTicks(startScreen.screenX, startScreen.screenY, hoverScreen.x, hoverScreen.y) : undefined,
      label: `${prefix}${formatMeasure(startWorld.distanceTo(hoverWorld), measure)}`,
      labelX: midScreen.x,
      labelY: midScreen.y - 18,
    };
  }
  const next: RulerOverlayState = {
    points: alignedPoints,
    segments,
    hover: hoverScreen ? {
      screenX: hoverScreen.x,
      screenY: hoverScreen.y,
      edgeScreenPoints: hoverEdgePoints.length >= 2 ? rulerScreenPointList(hoverEdgePoints, state) : undefined,
      alignKind: hoverAlign,
      preview: hoverPreview,
    } : null,
  };
  const previous = overlayRef.current;
  const unchanged =
    previous &&
    previous.points.length === next.points.length &&
    previous.segments.length === next.segments.length &&
    previous.points.every((point, index) => {
      const candidate = next.points[index];
      return point.id === candidate.id && Math.abs(point.screenX - candidate.screenX) < 0.2 && Math.abs(point.screenY - candidate.screenY) < 0.2;
    }) &&
    previous.segments.every((segment, index) => {
      const candidate = next.segments[index];
      return segment.id === candidate.id
        && segment.label === candidate.label
        && segment.screenPoints === candidate.screenPoints
        && Math.abs(segment.x1 - candidate.x1) < 0.2
        && Math.abs(segment.y1 - candidate.y1) < 0.2
        && Math.abs(segment.x2 - candidate.x2) < 0.2
        && Math.abs(segment.y2 - candidate.y2) < 0.2
        && Math.abs(segment.labelX - candidate.labelX) < 0.2
        && Math.abs(segment.labelY - candidate.labelY) < 0.2
        && segment.alignKind === candidate.alignKind;
    }) &&
    ((!previous.hover && !next.hover) ||
      (previous.hover && next.hover
        && previous.hover.edgeScreenPoints === next.hover.edgeScreenPoints
        && previous.hover.alignKind === next.hover.alignKind
        && previous.hover.preview?.label === next.hover.preview?.label
        && Math.abs((previous.hover.preview?.x1 ?? 0) - (next.hover.preview?.x1 ?? 0)) < 0.2
        && Math.abs((previous.hover.preview?.y1 ?? 0) - (next.hover.preview?.y1 ?? 0)) < 0.2
        && Math.abs((previous.hover.preview?.x2 ?? 0) - (next.hover.preview?.x2 ?? 0)) < 0.2
        && Math.abs((previous.hover.preview?.y2 ?? 0) - (next.hover.preview?.y2 ?? 0)) < 0.2
        && Math.abs(previous.hover.screenX - next.hover.screenX) < 0.2
        && Math.abs(previous.hover.screenY - next.hover.screenY) < 0.2));
  if (!unchanged) {
    overlayRef.current = next;
    setOverlay(next);
  }
}
