import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  applySketchCameraPose,
  captureSketchCameraPose,
  interpolateSketchCameraPose,
  sketchCameraEase,
  sketchCameraNearlyFramed,
  type SketchCameraPose,
  sketchCameraTweenMs,
  sketchFramingPose,
  type SketchOnModelSession,
} from "@/lib/sketch/sketch3d";
import { clamp } from "@/lib/viewportInteractionMath";
import { prefersReducedMotion } from "@/lib/chromePresence";
import {
  CAMERA_HOME,
  CAMERA_MAX_TARGET_Y,
  CAMERA_MIN_TARGET_Y,
  CAMERA_OVERLAY_TRAIL_EPS,
  CAMERA_TARGET,
} from "@/components/viewport/viewportConstants";
import type { ThreeState, ViewCubeFace, WorkspaceSettings } from "@/components/viewport/viewportTypes";

export function sketch3dHost(state: ThreeState) {
  return {
    scene: state.scene,
    camera: state.camera,
    domElement: state.renderer.domElement,
    controls: state.controls,
  };
}

export function applyRememberedSketchCamera(state: ThreeState, pose: SketchCameraPose) {
  cancelSketchCameraTween(state);
  applySketchCameraPose(sketch3dHost(state), pose);
  stopCameraCoast(state.controls);
  state.controls.enabled = true;
  state.controls.enableDamping = true;
  state.controls.update();
  state.needsRender = true;
}

export function restoreOrbitCameraUp(state: ThreeState) {
  const up = state.camera.up;
  if (up.x === 0 && up.y === 1 && up.z === 0) return;
  state.camera.up.set(0, 1, 0);
  state.camera.lookAt(state.controls.target);
  state.camera.updateProjectionMatrix();
  state.needsRender = true;
}

export function cancelSketchCameraTween(state: ThreeState) {
  const tween = state.cameraTween;
  if (tween?.handle) cancelAnimationFrame(tween.handle);
  const hadTween = Boolean(tween);
  state.cameraTween = null;
  restoreOrbitCameraUp(state);
  if (!hadTween) return;
  state.controls.enabled = true;
  state.controls.enableDamping = true;
}

export function startSketchCameraTween(state: ThreeState, session: SketchOnModelSession) {
  startCameraTween(state, sketchFramingPose(session));
}

/**
 * Glide the camera to `to`, orbiting around the target rather than sliding through the model.
 * Used for sketch framing, Home, and view-cube clicks; reduced motion jumps straight there.
 */
export function startCameraTween(state: ThreeState, to: SketchCameraPose, durationMs?: number) {
  const host = sketch3dHost(state);
  const from = captureSketchCameraPose(host);
  cancelSketchCameraTween(state);
  if (prefersReducedMotion() || sketchCameraNearlyFramed(from, to)) {
    applySketchCameraPose(host, to);
    state.needsRender = true;
    return;
  }
  state.controls.enabled = false;
  state.controls.enableDamping = false;
  stopCameraCoast(state.controls);
  state.wasCameraMoving = true;
  state.cameraStillFrames = 0;
  state.cameraOverlayHold = false;
  const tween = {
    handle: 0,
    started: performance.now(),
    duration: durationMs ?? sketchCameraTweenMs(from, to),
    from,
    to,
  };
  state.cameraTween = tween;
  const tick = (now: number) => {
    if (state.cameraTween !== tween) return;
    const t = Math.min(1, (now - tween.started) / tween.duration);
    applySketchCameraPose(host, interpolateSketchCameraPose(tween.from, tween.to, sketchCameraEase(t)));
    state.needsRender = true;
    if (t < 1) {
      tween.handle = requestAnimationFrame(tick);
      return;
    }
    applySketchCameraPose(host, tween.to);
    cancelSketchCameraTween(state);
  };
  tween.handle = requestAnimationFrame(tick);
  state.needsRender = true;
}

export const PART_SETTLE_MS = 900;

/** A step back and a touch higher than now, around the same point: the new part comes into view. */
export function settledPartPose(state: ThreeState): SketchCameraPose {
  const target = state.controls.target;
  const offset = state.camera.position.clone().sub(target);
  offset.multiplyScalar(1.14);
  offset.y += offset.length() * 0.04;
  return {
    target: { x: target.x, y: target.y, z: target.z },
    position: { x: target.x + offset.x, y: target.y + offset.y, z: target.z + offset.z },
    up: { x: 0, y: 1, z: 0 },
  };
}

export function resetCamera(state: ThreeState) {
  cancelSketchCameraTween(state);
  state.controls.enabled = true;
  state.camera.up.set(0, 1, 0);
  state.camera.position.copy(CAMERA_HOME);
  state.controls.target.copy(CAMERA_TARGET);
  state.camera.lookAt(CAMERA_TARGET);
  state.camera.updateProjectionMatrix();
  state.controls.update();
  state.needsRender = true;
}

/**
 * Home, as a glide: the starting angle, around the parts on the plane and far enough back to
 * show all of them. A fixed pose cropped anything much over 100 mm. Never closer than the
 * starting view, so a small part still sits on its workplane.
 */
export function glideCameraHome(state: ThreeState) {
  const offset = CAMERA_HOME.clone().sub(CAMERA_TARGET);
  const baseDistance = offset.length();
  offset.normalize();
  const bounds = new THREE.Box3();
  for (const child of state.shapeLayer.children) {
    if (!child.visible || !child.userData.shapeId || child.userData.edgeWipeRole === "out" || child.userData.previewHold) continue;
    bounds.expandByObject(child);
  }
  let target = CAMERA_TARGET.clone();
  let distance = baseDistance;
  if (!bounds.isEmpty()) {
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const camera = state.camera as THREE.PerspectiveCamera;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const fit = (sphere.radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.05;
    if (fit > baseDistance) {
      target = sphere.center;
      distance = fit;
    }
  }
  startCameraTween(state, {
    target: { x: target.x, y: target.y, z: target.z },
    position: { x: target.x + offset.x * distance, y: target.y + offset.y * distance, z: target.z + offset.z * distance },
    up: { x: 0, y: 1, z: 0 },
  });
}

/** A view-cube face, as a glide: the same pose as setCameraToViewFace. */
export function glideCameraToViewFace(state: ThreeState, face: ViewCubeFace) {
  const target = state.controls.target;
  const distance = clamp(state.camera.position.clone().sub(target).length(), 22, 4200);
  const direction = VIEW_FACE_DIRECTIONS[face];
  startCameraTween(state, {
    target: { x: target.x, y: target.y, z: target.z },
    position: { x: target.x + direction.x * distance, y: target.y + direction.y * distance, z: target.z + direction.z * distance },
    up: { x: 0, y: 1, z: 0 },
  });
}

export const VIEW_FACE_DIRECTIONS: Record<ViewCubeFace, { x: number; y: number; z: number }> = {
  top: { x: 0, y: 1, z: 0 },
  bottom: { x: 0, y: -1, z: 0 },
  front: { x: 0, y: 0, z: 1 },
  back: { x: 0, y: 0, z: -1 },
  right: { x: 1, y: 0, z: 0 },
  left: { x: -1, y: 0, z: 0 },
};

export function viewCubeFaceFromTarget(target: EventTarget | null): ViewCubeFace | null {
  const element = target instanceof Element ? target.closest("[data-view-cube-face]") : null;
  const face = element?.getAttribute("data-view-cube-face");
  if (face === "top" || face === "bottom" || face === "front" || face === "back" || face === "right" || face === "left") {
    return face;
  }
  return null;
}

export function setCameraToViewFace(state: ThreeState, face: ViewCubeFace) {
  cancelSketchCameraTween(state);
  const offset = state.camera.position.clone().sub(state.controls.target);
  const distance = clamp(offset.length(), 22, 4200);
  const directionByFace: Record<ViewCubeFace, THREE.Vector3> = {
    top: new THREE.Vector3(0, 1, 0),
    bottom: new THREE.Vector3(0, -1, 0),
    front: new THREE.Vector3(0, 0, 1),
    back: new THREE.Vector3(0, 0, -1),
    right: new THREE.Vector3(1, 0, 0),
    left: new THREE.Vector3(-1, 0, 0),
  };
  const direction = directionByFace[face].clone().normalize();

  state.camera.up.set(0, 1, 0);
  state.camera.position.copy(state.controls.target).add(direction.multiplyScalar(distance));
  state.camera.lookAt(state.controls.target);
  state.camera.updateProjectionMatrix();
  state.controls.update();
  state.needsRender = true;
}

export const VIEW_CUBE_ORBIT_RADIANS_PER_PX = 0.0075;

export function orbitCameraByPointerDelta(state: ThreeState, deltaX: number, deltaY: number) {
  cancelSketchCameraTween(state);
  const offset = state.camera.position.clone().sub(state.controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.theta -= deltaX * VIEW_CUBE_ORBIT_RADIANS_PER_PX;
  spherical.phi = clamp(
    spherical.phi - deltaY * VIEW_CUBE_ORBIT_RADIANS_PER_PX,
    0.08,
    Math.PI - 0.08,
  );
  spherical.makeSafe();
  offset.setFromSpherical(spherical);
  state.camera.up.set(0, 1, 0);
  state.camera.position.copy(state.controls.target).add(offset);
  state.camera.lookAt(state.controls.target);
  state.camera.updateProjectionMatrix();
  state.controls.update();
  state.needsRender = true;
}

export function stopCameraCoast(controls: OrbitControls) {
  const coast = controls as OrbitControls & {
    _sphericalDelta?: { set: (x: number, y: number, z: number) => void };
    _panOffset?: { set: (x: number, y: number, z: number) => void };
  };
  coast._sphericalDelta?.set(0, 0, 0);
  coast._panOffset?.set(0, 0, 0);
}

export function rememberCameraHoldPose(state: ThreeState) {
  state.cameraHoldPosition.copy(state.camera.position);
  state.cameraHoldTarget.copy(state.controls.target);
  state.cameraHoldQuaternion.copy(state.camera.quaternion);
}

export function cameraHoldPoseMoved(state: ThreeState) {
  const rotationDelta = 8 * (1 - Math.abs(state.cameraHoldQuaternion.dot(state.camera.quaternion)));
  return (
    state.camera.position.distanceToSquared(state.cameraHoldPosition) > CAMERA_OVERLAY_TRAIL_EPS ||
    state.controls.target.distanceToSquared(state.cameraHoldTarget) > CAMERA_OVERLAY_TRAIL_EPS ||
    rotationDelta > CAMERA_OVERLAY_TRAIL_EPS
  );
}

export function constrainCamera(state: ThreeState, workspace: WorkspaceSettings) {
  const target = state.controls.target;
  const previousTarget = target.clone();
  target.x = clamp(target.x, -workspace.width / 2, workspace.width / 2);
  target.y = clamp(target.y, CAMERA_MIN_TARGET_Y, CAMERA_MAX_TARGET_Y);
  target.z = clamp(target.z, -workspace.depth / 2, workspace.depth / 2);

  const targetShift = target.clone().sub(previousTarget);
  if (targetShift.lengthSq() > 0) {
    state.camera.position.add(targetShift);
    state.camera.updateProjectionMatrix();
  }
}

export function syncViewCube(state: ThreeState, cube: HTMLDivElement | null) {
  if (!cube) {
    return;
  }

  const offset = state.camera.position.clone().sub(state.controls.target);
  const horizontalDistance = Math.max(0.001, Math.hypot(offset.x, offset.z));
  const pitch = THREE.MathUtils.radToDeg(Math.atan2(offset.y, horizontalDistance));
  const yaw = THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z));
  cube.style.transform = `rotateX(${-pitch}deg) rotateY(${-yaw}deg)`;
}
