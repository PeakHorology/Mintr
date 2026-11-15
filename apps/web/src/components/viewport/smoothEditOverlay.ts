import * as THREE from "three";
import type { SmoothEditOverlay, ThreeState } from "@/components/viewport/viewportTypes";
import { pointerWorldRay, projectToCanvasPx } from "@/components/viewport/screenProjection";
import { surfaceHits } from "@/components/viewport/meshPick";

export const SMOOTH_DOT_COLOR = new THREE.Color("#ffffff");
export const SMOOTH_DOT_SELECTED = new THREE.Color("#0098c7");
export const SMOOTH_DOT_TWIN = new THREE.Color("#8fd3ea");
export const SMOOTH_DOT_LOCKED = new THREE.Color("#8a949a");
export let smoothDotTexture: THREE.Texture | null = null;
export let smoothRingTexture: THREE.Texture | null = null;

/** A hollow ring drawn round each Mirror twin, so the point that will move with yours stands out. */
export function smoothRingSprite() {
  if (smoothRingTexture) return smoothRingTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.beginPath();
    context.arc(32, 32, 24, 0, Math.PI * 2);
    context.lineWidth = 10;
    context.strokeStyle = "#ffffff";
    context.stroke();
    context.beginPath();
    context.arc(32, 32, 24, 0, Math.PI * 2);
    context.lineWidth = 6;
    context.strokeStyle = "#0098c7";
    context.stroke();
  }
  smoothRingTexture = new THREE.CanvasTexture(canvas);
  return smoothRingTexture;
}

export function smoothDotSprite() {
  if (smoothDotTexture) return smoothDotTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.beginPath();
    context.arc(32, 32, 26, 0, Math.PI * 2);
    context.fillStyle = "#ffffff";
    context.fill();
    context.lineWidth = 8;
    context.strokeStyle = "#1f2a30";
    context.stroke();
  }
  smoothDotTexture = new THREE.CanvasTexture(canvas);
  return smoothDotTexture;
}

/** Draw a little in front of the surface the dots sit on, so they are not lost in it. */
export function biasTowardCamera<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      // A small share of the distance, not of the depth buffer: depth steps grow far from the
      // camera, and a fixed depth nudge there pushed the dots right through the part.
      "#include <project_vertex>\n  gl_Position = projectionMatrix * vec4(mvPosition.xyz * 0.996, 1.0);",
    );
  };
  material.customProgramCacheKey = () => "smooth-edit-bias-2";
  return material;
}

export function rebuildSmoothEditOverlay(state: ThreeState | null, overlay: SmoothEditOverlay | null) {
  if (!state) return;
  const existing = state.scene.userData.smoothEdit as THREE.Group | undefined;
  if (existing) {
    state.scene.remove(existing);
    existing.traverse((object) => {
      const drawable = object as THREE.Points | THREE.LineSegments;
      drawable.geometry?.dispose();
      (drawable.material as THREE.Material | undefined)?.dispose();
    });
    delete state.scene.userData.smoothEdit;
  }
  if (!overlay || overlay.points.length < 3) {
    state.needsRender = true;
    return;
  }
  const group = new THREE.Group();
  group.name = "SmoothEdit";
  const edgeLines = (edges: Uint32Array, color: string, opacity: number) => {
    const linePositions = new Float32Array(edges.length * 3);
    edges.forEach((v, i) => {
      linePositions[i * 3] = overlay.points[v * 3];
      linePositions[i * 3 + 1] = overlay.points[v * 3 + 1];
      linePositions[i * 3 + 2] = overlay.points[v * 3 + 2];
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
    return new THREE.LineSegments(geometry, biasTowardCamera(new THREE.LineBasicMaterial({ color, transparent: true, opacity })));
  };
  const lines = edgeLines(overlay.edges, "#1f2a30", 0.45);
  lines.renderOrder = 1003;
  const sharp = edgeLines(overlay.sharpEdges, "#005f80", 0.95);
  sharp.renderOrder = 1003;
  const count = overlay.points.length / 3;
  const colors = new Float32Array(overlay.points.length);
  for (let v = 0; v < count; v += 1) {
    const color = overlay.selected.has(v) ? SMOOTH_DOT_SELECTED : overlay.twins.has(v) ? SMOOTH_DOT_TWIN : overlay.locked[v] ? SMOOTH_DOT_LOCKED : SMOOTH_DOT_COLOR;
    colors[v * 3] = color.r;
    colors[v * 3 + 1] = color.g;
    colors[v * 3 + 2] = color.b;
  }
  const dotGeometry = new THREE.BufferGeometry();
  dotGeometry.setAttribute("position", new THREE.BufferAttribute(overlay.points, 3));
  dotGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const dotMaterial = (size: number) => new THREE.PointsMaterial({
    size,
    sizeAttenuation: false,
    map: smoothDotSprite(),
    vertexColors: true,
    transparent: true,
    alphaTest: 0.2,
    depthWrite: false,
  });
  // The points a detail down are drawn full size and the new ones in between smaller,
  // so the shape still reads at the finest detail. Coarse points come first in the list.
  const coarse = overlay.coarseCount > 0 ? overlay.coarseCount : count;
  const dots = (first: number, last: number, size: number) => {
    if (last <= first) return [];
    // Points round the back stay hidden by the part, so the side you are shaping reads clearly.
    const front = new THREE.Points(dotGeometry, biasTowardCamera(dotMaterial(size)));
    front.renderOrder = 1004;
    front.onBeforeRender = () => dotGeometry.setDrawRange(first, last - first);
    return [front];
  };
  const objects: THREE.Object3D[] = [lines, sharp, ...dots(0, coarse, 11), ...dots(coarse, count, 7)];
  if (overlay.twins.size > 0) {
    // Rings round the twins show through the part, since a twin is often round the back.
    const ringPositions = new Float32Array(overlay.twins.size * 3);
    [...overlay.twins].forEach((v, i) => {
      ringPositions[i * 3] = overlay.points[v * 3];
      ringPositions[i * 3 + 1] = overlay.points[v * 3 + 1];
      ringPositions[i * 3 + 2] = overlay.points[v * 3 + 2];
    });
    const ringGeometry = new THREE.BufferGeometry();
    ringGeometry.setAttribute("position", new THREE.BufferAttribute(ringPositions, 3));
    const rings = new THREE.Points(ringGeometry, new THREE.PointsMaterial({
      size: 22,
      sizeAttenuation: false,
      map: smoothRingSprite(),
      transparent: true,
      alphaTest: 0.2,
      depthTest: false,
      depthWrite: false,
    }));
    rings.renderOrder = 1005;
    objects.push(rings);
  }
  for (const object of objects) object.frustumCulled = false;
  group.add(...objects);
  state.scene.add(group);
  state.scene.userData.smoothEdit = group;
  state.needsRender = true;
}

/** Dots inside a box on the canvas that face the camera, so a box does not reach through the part. */
export function smoothPointsInBox(state: ThreeState, overlay: SmoothEditOverlay, box: { left: number; top: number; right: number; bottom: number }) {
  const picked: number[] = [];
  const point = new THREE.Vector3();
  const toPoint = new THREE.Vector3();
  for (let v = 0; v < overlay.points.length / 3; v += 1) {
    point.set(overlay.points[v * 3], overlay.points[v * 3 + 1], overlay.points[v * 3 + 2]);
    if (overlay.locked[v]) continue;
    const screen = projectToCanvasPx(state, point);
    if (screen.x < box.left || screen.x > box.right || screen.y < box.top || screen.y > box.bottom) continue;
    toPoint.copy(point).sub(state.camera.position);
    const facing = overlay.normals[v * 3] * toPoint.x + overlay.normals[v * 3 + 1] * toPoint.y + overlay.normals[v * 3 + 2] * toPoint.z;
    if (facing < 0) picked.push(v);
  }
  return picked;
}

export function pickSmoothPoint(state: ThreeState, overlay: SmoothEditOverlay, clientX: number, clientY: number) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const reach = 12;
  const near: { v: number; away: number }[] = [];
  const point = new THREE.Vector3();
  for (let v = 0; v < overlay.points.length / 3; v += 1) {
    if (overlay.locked[v]) continue;
    point.set(overlay.points[v * 3], overlay.points[v * 3 + 1], overlay.points[v * 3 + 2]);
    const screen = projectToCanvasPx(state, point);
    const away = Math.hypot(screen.x - x, screen.y - y);
    if (away <= reach) near.push({ v, away });
  }
  near.sort((a, b) => a.away - b.away);
  // The nearest dot the camera can see: points behind the part cannot be picked.
  const eye = state.camera.position;
  const toward = new THREE.Vector3();
  for (const { v } of near) {
    point.set(overlay.points[v * 3], overlay.points[v * 3 + 1], overlay.points[v * 3 + 2]);
    const distance = point.distanceTo(eye);
    toward.subVectors(point, eye).normalize();
    state.raycaster.set(eye, toward);
    const surface = surfaceHits(state)[0];
    if (!surface || surface.distance >= distance - Math.max(0.1, distance * 0.01)) return v;
  }
  return null;
}

export function smoothPlanePoint(state: ThreeState, plane: THREE.Plane, clientX: number, clientY: number) {
  pointerWorldRay(state, clientX, clientY);
  return state.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}
