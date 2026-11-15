import * as THREE from "three";
import type { CadPlanarFace } from "@/lib/cadModifierTypes";
import { ghostPrismMesh } from "@/lib/pushPullGeometry";
import type { ThreeState } from "@/components/viewport/viewportTypes";

export const PUSH_PULL_FACE_BRONZE = new THREE.Color("#c6a15b");
export const PUSH_PULL_FACE_HOVER = new THREE.Color("#ffb21e");

/** A soft fill over one flat face outline, so the face under the pointer reads at a glance. */
export function planarFaceFill(face: CadPlanarFace, color: THREE.Color, opacity: number): THREE.Mesh | null {
  const count = Math.floor(face.points.length / 3);
  if (count < 3) return null;
  const normal = new THREE.Vector3(face.normal.x, face.normal.y, face.normal.z);
  if (normal.lengthSq() < 1e-12) return null;
  normal.normalize();
  const u = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(normal).normalize() : new THREE.Vector3(1, 0, 0).cross(normal).normalize();
  const v = normal.clone().cross(u);
  const loop: THREE.Vector2[] = [];
  const world: THREE.Vector3[] = [];
  for (let index = 0; index < count; index += 1) {
    const point = new THREE.Vector3(face.points[index * 3], face.points[index * 3 + 1], face.points[index * 3 + 2]);
    const last = world[world.length - 1];
    if (last && last.distanceToSquared(point) < 1e-12) continue;
    world.push(point);
    loop.push(new THREE.Vector2(point.dot(u), point.dot(v)));
  }
  if (world.length > 3 && world[0].distanceToSquared(world[world.length - 1]) < 1e-12) {
    world.pop();
    loop.pop();
  }
  if (world.length < 3) return null;
  const triangles = THREE.ShapeUtils.triangulateShape(loop, []);
  if (triangles.length === 0) return null;
  const positions = new Float32Array(triangles.length * 9);
  let cursor = 0;
  for (const triangle of triangles) {
    for (const corner of triangle) {
      const point = world[corner];
      positions[cursor++] = point.x;
      positions[cursor++] = point.y;
      positions[cursor++] = point.z;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }));
  mesh.renderOrder = 1002;
  return mesh;
}

/** Face outlines arrive as an open ordered loop; draw it closed. */
export function polylineToLinePositions(points: number[]) {
  const count = Math.floor(points.length / 3);
  if (count < 2) return new Float32Array(0);
  const last = (count - 1) * 3;
  const alreadyClosed = count > 2
    && Math.hypot(points[0] - points[last], points[1] - points[last + 1], points[2] - points[last + 2]) < 1e-5;
  const segments = count > 2 && !alreadyClosed ? count : count - 1;
  const positions = new Float32Array(segments * 6);
  let cursor = 0;
  for (let index = 0; index < segments; index += 1) {
    const from = index * 3;
    const to = ((index + 1) % count) * 3;
    positions[cursor++] = points[from];
    positions[cursor++] = points[from + 1];
    positions[cursor++] = points[from + 2];
    positions[cursor++] = points[to];
    positions[cursor++] = points[to + 1];
    positions[cursor++] = points[to + 2];
  }
  return positions;
}

export function rebuildPushPullFaces(
  state: ThreeState | null,
  faces: CadPlanarFace[],
  hoverId: number | null,
  selectedId: number | null,
  markedIds: readonly number[] = [],
) {
  if (!state) return;
  const existing = state.modifierLayer.userData.pushPullFaceLines as THREE.LineSegments | undefined;
  const existingFill = state.modifierLayer.userData.pushPullFaceFill as THREE.Mesh | undefined;
  // Nothing drawn and nothing to draw: skip the work and the extra frame.
  if (!existing && !existingFill && faces.length === 0) return;
  for (const old of [existing, existingFill]) {
    if (!old) continue;
    state.modifierLayer.remove(old);
    old.geometry.dispose();
    (old.material as THREE.Material).dispose();
  }
  delete state.modifierLayer.userData.pushPullFaceLines;
  delete state.modifierLayer.userData.pushPullFaceFill;
  const hovered = hoverId !== null && hoverId !== selectedId && !markedIds.includes(hoverId)
    ? faces.find((face) => face.id === hoverId)
    : undefined;
  const fill = hovered ? planarFaceFill(hovered, PUSH_PULL_FACE_HOVER, 0.32) : null;
  if (fill) {
    state.modifierLayer.add(fill);
    state.modifierLayer.userData.pushPullFaceFill = fill;
  }
  const drawable = faces.filter((face) => face.points.length >= 6);
  if (drawable.length === 0) {
    state.needsRender = true;
    return;
  }
  const chunks = drawable.map((face) => polylineToLinePositions(face.points));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const positions = new Float32Array(total);
  const colors = new Float32Array(total);
  let offset = 0;
  drawable.forEach((face, faceIndex) => {
    const chunk = chunks[faceIndex];
    positions.set(chunk, offset);
    const marked = face.id === selectedId || markedIds.includes(face.id);
    const color = marked ? PUSH_PULL_FACE_BRONZE : face.id === hoverId ? PUSH_PULL_FACE_HOVER : PUSH_PULL_FACE_BRONZE;
    const opacityScale = marked || face.id === hoverId ? 1 : 0.42;
    for (let index = 0; index < chunk.length; index += 3) {
      colors[offset + index] = color.r * opacityScale;
      colors[offset + index + 1] = color.g * opacityScale;
      colors[offset + index + 2] = color.b * opacityScale;
    }
    offset += chunk.length;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    vertexColors: true,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  }));
  lines.renderOrder = 1003;
  lines.frustumCulled = false;
  state.modifierLayer.add(lines);
  state.modifierLayer.userData.pushPullFaceLines = lines;
  state.needsRender = true;
}

export function rebuildPushPullGhost(
  state: ThreeState | null,
  faces: CadPlanarFace[],
  selectedId: number | null,
  distance: number,
  show: boolean,
  opacity: number,
) {
  if (!state) return;
  const existing = state.modifierLayer.userData.pushPullGhost as THREE.Mesh | undefined;
  if (!existing && (!show || faces.length === 0)) return;
  if (existing) {
    state.modifierLayer.remove(existing);
    existing.geometry.dispose();
    (existing.material as THREE.Material).dispose();
  }
  delete state.modifierLayer.userData.pushPullGhost;
  const face = faces.find((entry) => entry.id === selectedId);
  if (!show || !face || Math.abs(distance) < 1e-4) {
    state.needsRender = true;
    return;
  }
  const mesh = ghostPrismMesh(face, distance);
  if (mesh.positions.length < 9) {
    state.needsRender = true;
    return;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  const ghost = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: "#efebe8",
    transparent: true,
    opacity: Math.max(0, Math.min(1, opacity)) * 0.42,
    depthWrite: false,
    metalness: 0.06,
    roughness: 0.55,
    side: THREE.DoubleSide,
  }));
  ghost.renderOrder = 1001;
  ghost.frustumCulled = false;
  state.modifierLayer.add(ghost);
  state.modifierLayer.userData.pushPullGhost = ghost;
  state.needsRender = true;
}
