import * as THREE from "three";
import {
  chooseModifierEdgeCandidate,
  closestPointOnScreenSegment,
  MODIFIER_EDGE_PICK_RADIUS_PX,
  type ModifierEdgeCandidate,
} from "@/lib/modifierEdgePick";
import type { CadModifierEdge, CadPlanarFace } from "@/lib/cadModifierTypes";
import { pushPullScreenAxis, type PushPullScreenAxis } from "@/lib/pushPullGeometry";
import type { ThreeState } from "@/components/viewport/viewportTypes";

export function projectCadPointToCanvas(point: THREE.Vector3, state: ThreeState, rect: DOMRect) {
  const projected = point.clone().project(state.camera);
  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z < -1 || projected.z > 1) {
    return null;
  }
  return {
    x: ((projected.x + 1) / 2) * rect.width,
    y: ((1 - projected.y) / 2) * rect.height,
    depth: projected.z,
  };
}

export function pickModifierEdgeFromScreen(state: ThreeState, edges: CadModifierEdge[], clientX: number, clientY: number) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  const pointerX = clientX - rect.left;
  const pointerY = clientY - rect.top;
  const pointA = new THREE.Vector3();
  const pointB = new THREE.Vector3();
  const candidates = new Map<number, ModifierEdgeCandidate>();
  state.camera.updateMatrixWorld();
  edges.forEach((edge) => {
    for (let index = 0; index + 5 < edge.points.length; index += 3) {
      pointA.set(edge.points[index], edge.points[index + 1], edge.points[index + 2]);
      pointB.set(edge.points[index + 3], edge.points[index + 4], edge.points[index + 5]);
      const a = projectCadPointToCanvas(pointA, state, rect);
      const b = projectCadPointToCanvas(pointB, state, rect);
      if (!a || !b) continue;
      const hit = closestPointOnScreenSegment(pointerX, pointerY, a.x, a.y, b.x, b.y);
      if (hit.distance >= MODIFIER_EDGE_PICK_RADIUS_PX) continue;
      const existing = candidates.get(edge.id);
      if (existing && existing.distance <= hit.distance) continue;
      candidates.set(edge.id, {
        id: edge.id,
        distance: hit.distance,
        depth: a.depth + (b.depth - a.depth) * hit.amount,
      });
    }
  });
  return chooseModifierEdgeCandidate(candidates.values());
}

export function pointerWorldRay(state: ThreeState, clientX: number, clientY: number) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  state.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  state.raycaster.setFromCamera(state.pointer, state.camera);
  const origin = state.raycaster.ray.origin;
  const dir = state.raycaster.ray.direction;
  return {
    origin: { x: origin.x, y: origin.y, z: origin.z },
    dir: { x: dir.x, y: dir.y, z: dir.z },
  };
}

/** Screen pixel position of a world point (CSS pixels relative to the canvas). */
export function projectToCanvasPx(state: ThreeState, point: { x: number; y: number; z: number }) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  const projected = new THREE.Vector3(point.x, point.y, point.z).project(state.camera);
  return {
    x: ((projected.x + 1) / 2) * rect.width,
    y: ((1 - projected.y) / 2) * rect.height,
  };
}

/** World millimetres covered by one CSS pixel at the depth of `point`. */
export function mmPerPixelAt(state: ThreeState, point: { x: number; y: number; z: number }) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  const look = new THREE.Vector3();
  state.camera.getWorldDirection(look);
  const toPoint = new THREE.Vector3(point.x, point.y, point.z).sub(state.camera.position);
  const depth = Math.max(1e-3, toPoint.dot(look));
  const viewHeight = 2 * depth * Math.tan(THREE.MathUtils.degToRad(state.camera.fov) / 2);
  return viewHeight / Math.max(1, rect.height);
}

/** Pointer-travel mapping for a Push Pull drag on `face`, fixed at pointer-down. */
export function pushPullDragAxis(state: ThreeState, face: CadPlanarFace): PushPullScreenAxis {
  const tipMm = 10;
  const tip = {
    x: face.origin.x + face.normal.x * tipMm,
    y: face.origin.y + face.normal.y * tipMm,
    z: face.origin.z + face.normal.z * tipMm,
  };
  return pushPullScreenAxis(
    projectToCanvasPx(state, face.origin),
    projectToCanvasPx(state, tip),
    tipMm,
    mmPerPixelAt(state, face.origin),
  );
}

export function canvasPx(state: ThreeState, clientX: number, clientY: number) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}
