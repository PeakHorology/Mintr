import * as THREE from "three";
import { mirrorSign, shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";
import type { ThreeState } from "@/components/viewport/viewportTypes";

export const FACE_SNAP_HOVER_NAME = "FaceSnapHover";
export const FACE_SNAP_LOCK_NAME = "FaceSnapLock";
export const TEXTURE_HOVER_NAME = "TextureHover";
export const TEXTURE_CHOSEN_NAME = "TextureChosen";

/** Shows one texture guide by name, rebuilding it only when its key changes. Null clears it. */
export function syncTextureHelper(
  state: ThreeState,
  name: string,
  key: string | null,
  build: (() => THREE.Object3D | null) | null,
) {
  const existing = state.helperLayer.getObjectByName(name);
  if (existing && key !== null && existing.userData.guideKey === key) return;
  if (existing) {
    state.helperLayer.remove(existing);
    existing.traverse((child) => {
      if (!(child instanceof THREE.Mesh || child instanceof THREE.Line)) return;
      child.geometry.dispose();
      // The picture on a ghost is shared, so only the material goes.
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
    state.needsRender = true;
  }
  if (key === null || !build) return;
  const object = build();
  if (!object) return;
  object.name = name;
  object.userData.guideKey = key;
  state.helperLayer.add(object);
  state.needsRender = true;
}

export function clearNamedHelper(state: ThreeState, name: string) {
  const existing = state.helperLayer.getObjectByName(name);
  if (!existing) return;
  state.helperLayer.remove(existing);
  existing.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

export function syncFaceSnapHighlight(
  state: ThreeState,
  name: string,
  shape: WorkplaneShape | null,
  pick: { shapeId: string; point: [number, number, number]; normal: [number, number, number] } | null,
  opacity: number,
) {
  const existing = state.helperLayer.getObjectByName(name);
  if (!shape || !pick) {
    if (existing) {
      clearNamedHelper(state, name);
      state.needsRender = true;
    }
    return;
  }
  const key = `${pick.shapeId}:${pick.normal.join(",")}`;
  if (existing?.userData.faceKey === key) return;
  clearNamedHelper(state, name);
  const positions = faceSnapQuadPositions(shape, pick.point, pick.normal);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: "#2aa77e",
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  mesh.name = name;
  mesh.userData.faceKey = key;
  mesh.renderOrder = 4;
  state.helperLayer.add(mesh);
  state.needsRender = true;
}

export function faceSnapQuadPositions(
  shape: WorkplaneShape,
  _point: [number, number, number],
  normal: [number, number, number],
): Float32Array {
  const worldNormal = new THREE.Vector3(...normal);
  if (worldNormal.lengthSq() < 1e-12) return new Float32Array(18);
  worldNormal.normalize();
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(shape.rotationX ?? 0),
    THREE.MathUtils.degToRad(shape.rotation),
    THREE.MathUtils.degToRad(shape.rotationZ ?? 0),
    "XYZ",
  ));
  const localNormal = worldNormal.clone().applyQuaternion(rotation.clone().invert());
  localNormal.x *= mirrorSign(shape.mirrorX);
  localNormal.y *= mirrorSign(shape.mirrorY);
  localNormal.z *= mirrorSign(shape.mirrorZ);
  const ax = Math.abs(localNormal.x);
  const ay = Math.abs(localNormal.y);
  const az = Math.abs(localNormal.z);
  const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  const sign = Math.sign(localNormal.getComponent(axis)) || 1;
  const half = [shapeWidth(shape) / 2, shape.height / 2, shapeDepth(shape) / 2];
  const span = [0, 1, 2].filter((item) => item !== axis);
  const center = new THREE.Vector3(shape.x, (shape.elevation ?? 0) + shape.height / 2, shape.z);
  const scale = new THREE.Vector3(mirrorSign(shape.mirrorX), mirrorSign(shape.mirrorY), mirrorSign(shape.mirrorZ));
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const local = new THREE.Vector3();
    local.setComponent(axis, sign * half[axis]);
    local.setComponent(span[0], u * half[span[0]]);
    local.setComponent(span[1], v * half[span[1]]);
    return local.multiply(scale).applyQuaternion(rotation).add(center).addScaledVector(worldNormal, 0.35);
  });
  return new Float32Array([
    ...corners[0].toArray(), ...corners[1].toArray(), ...corners[2].toArray(),
    ...corners[0].toArray(), ...corners[2].toArray(), ...corners[3].toArray(),
  ]);
}

export function faceSnapNormal(normal: THREE.Vector3): [number, number, number] | null {
  if (normal.lengthSq() < 1e-12) return null;
  const unit = normal.clone().normalize();
  const ax = Math.abs(unit.x);
  const ay = Math.abs(unit.y);
  const az = Math.abs(unit.z);
  const largest = Math.max(ax, ay, az);
  if (largest > 0.985) {
    if (ax === largest) return [Math.sign(unit.x) || 1, 0, 0];
    if (ay === largest) return [0, Math.sign(unit.y) || 1, 0];
    return [0, 0, Math.sign(unit.z) || 1];
  }
  return [unit.x, unit.y, unit.z];
}
