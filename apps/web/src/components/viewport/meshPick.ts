import * as THREE from "three";
import { buildPickBvh, type PickBvh, raycastPickBvh } from "@/lib/meshPickBvh";
import type { ThreeState } from "@/components/viewport/viewportTypes";

export const PICK_INDEX_TRIANGLE_MIN = 800;
export const geometryPickIndex = new WeakMap<THREE.BufferGeometry, PickBvh | null>();

export function meshIsDoubleSided(mesh: THREE.Mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some((material) => material.side === THREE.DoubleSide);
}

export function geometryTriangleCount(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  if (!position) return 0;
  const index = geometry.getIndex();
  return Math.floor((index ? index.count : position.count) / 3);
}

export function pickIndexForGeometry(geometry: THREE.BufferGeometry) {
  const cached = geometryPickIndex.get(geometry);
  if (cached !== undefined) return cached;
  const position = geometry.getAttribute("position");
  if (!position) {
    geometryPickIndex.set(geometry, null);
    return null;
  }
  const index = geometry.getIndex();
  const count = geometryTriangleCount(geometry);
  // Flat soup rather than one object per triangle: the first click on a dense
  // import builds this index, and the object version doubled its memory.
  const soup = new Float64Array(count * 9);
  for (let triangle = 0; triangle < count; triangle += 1) {
    const a = index ? index.getX(triangle * 3) : triangle * 3;
    const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    const at = triangle * 9;
    soup[at] = position.getX(a); soup[at + 1] = position.getY(a); soup[at + 2] = position.getZ(a);
    soup[at + 3] = position.getX(b); soup[at + 4] = position.getY(b); soup[at + 5] = position.getZ(b);
    soup[at + 6] = position.getX(c); soup[at + 7] = position.getY(c); soup[at + 8] = position.getZ(c);
  }
  const tree = buildPickBvh(soup);
  geometryPickIndex.set(geometry, tree);
  return tree;
}

export const pickInverse = new THREE.Matrix4();
export const pickOrigin = new THREE.Vector3();
export const pickDirection = new THREE.Vector3();
export const pickPoint = new THREE.Vector3();
export const pickNormal = new THREE.Vector3();

export function raycastIndexedMesh(mesh: THREE.Mesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
  const tree = pickIndexForGeometry(mesh.geometry);
  if (!tree) return;
  pickInverse.copy(mesh.matrixWorld).invert();
  pickOrigin.copy(raycaster.ray.origin).applyMatrix4(pickInverse);
  pickDirection.copy(raycaster.ray.direction).transformDirection(pickInverse);
  const hit = raycastPickBvh(tree, pickOrigin, pickDirection, meshIsDoubleSided(mesh));
  if (!hit) return;
  pickPoint.set(hit.x, hit.y, hit.z).applyMatrix4(mesh.matrixWorld);
  const distance = raycaster.ray.origin.distanceTo(pickPoint);
  if (distance < raycaster.near || distance > raycaster.far) return;
  pickNormal.set(hit.nx, hit.ny, hit.nz).transformDirection(mesh.matrixWorld).normalize();
  hits.push({
    distance,
    point: pickPoint.clone(),
    object: mesh,
    face: { a: 0, b: 0, c: 0, normal: pickNormal.clone(), materialIndex: 0 },
  });
}

export function preciseMeshHits(state: ThreeState, targets: THREE.Object3D[]) {
  const hits: THREE.Intersection[] = [];
  const raycastMesh = THREE.Mesh.prototype.raycast;
  targets.forEach((target) => {
    target.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.visible) return;
      // Overlays opt out with an empty raycast. Dense imports otherwise answer with
      // their bounding box, which selects the larger shape and blocks empty clicks.
      if (child.raycast.length === 0) return;
      // A textured part answers from its smooth body: quicker, and a click reads the face, not a bump.
      const pickGeometry = child.userData.pickGeometry as THREE.BufferGeometry | undefined;
      if (pickGeometry) {
        const shown = child.geometry;
        child.geometry = pickGeometry;
        raycastMesh.call(child, state.raycaster, hits);
        child.geometry = shown;
        return;
      }
      if (geometryTriangleCount(child.geometry) >= PICK_INDEX_TRIANGLE_MIN) {
        raycastIndexedMesh(child, state.raycaster, hits);
        return;
      }
      raycastMesh.call(child, state.raycaster, hits);
    });
  });
  hits.sort((a, b) => a.distance - b.distance);
  return hits;
}

export function objectIsShown(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible || current.userData.previewHold) return false;
    current = current.parent;
  }
  return true;
}

/** Nearest dot within reach of the pointer, preferring dots in front of the part. */
/** Drawn on screen: it and everything it sits in are visible, and its material draws. */
export function isDrawn(object: THREE.Object3D) {
  const material = (object as THREE.Mesh).material;
  if (Array.isArray(material) ? material.every((m) => !m.visible || m.opacity === 0) : material && (!material.visible || material.opacity === 0)) return false;
  for (let at: THREE.Object3D | null = object; at; at = at.parent) if (!at.visible) return false;
  return true;
}

/**
 * What the ray meets on the parts' real surfaces, nearest first. Large meshes normally answer
 * clicks with their outer box to stay quick; that would hide every point inside it.
 */
export function heldInHoleOrGhost(object: THREE.Object3D) {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (current.userData.hole || current.userData.construction) return true;
  }
  return false;
}

export function surfaceHits(state: ThreeState) {
  const hits: THREE.Intersection[] = [];
  state.shapeLayer.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !isDrawn(mesh)) return;
    if (mesh.userData.boundsPick) THREE.Mesh.prototype.raycast.call(mesh, state.raycaster, hits);
    else mesh.raycast(state.raycaster, hits);
  });
  return hits.sort((a, b) => a.distance - b.distance);
}
