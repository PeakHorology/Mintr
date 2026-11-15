import * as THREE from "three";
import {
  barrelHighlightPositions,
  classifySketchFaceHit,
  collectNearbyTriangleNormals,
  discCapHighlightPositions,
} from "@/lib/sketchFaceClassify";
import { connectedCoplanarTriangles, FACE_REGION_NORMAL_DOT, FACE_REGION_PLANE_EPS, type WorldTriangle } from "@/lib/sketchFaceReference";
import type { WorkplaneShape } from "@/types/sketchforge";
import type { SketchFaceRaycastHit, ThreeState } from "@/components/viewport/viewportTypes";
import { preciseMeshHits } from "@/components/viewport/meshPick";
import { disposeObject } from "@/components/viewport/shapeOutlines";

export const SKETCH_FACE_HIGHLIGHT_NAME = "SketchFacePickHighlight";
export const SKETCH_FACE_OFFSET = 0.18;

export function raycastSketchFaceHit(
  state: ThreeState,
  shapes: WorkplaneShape[],
  clientX: number,
  clientY: number,
): SketchFaceRaycastHit | null {
  const rect = state.renderer.domElement.getBoundingClientRect();
  state.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  state.raycaster.setFromCamera(state.pointer, state.camera);

  const meshHit = preciseMeshHits(state, state.shapeLayer.children).find((entry) => {
      if (!(entry.object instanceof THREE.Mesh) || !entry.face) return false;
      let id = entry.object.userData.shapeId;
      if (typeof id !== "string") {
        let parent = entry.object.parent;
        while (parent && typeof id !== "string") {
          id = parent.userData.shapeId;
          parent = parent.parent;
        }
      }
      if (typeof id !== "string") return false;
      entry.object.userData.shapeId = id;
      const shape = shapes.find((item) => item.id === id);
      return Boolean(shape && !shape.hidden && !shape.hole && !shape.locked);
    });

  if (!meshHit?.face || !(meshHit.object instanceof THREE.Mesh)) return null;

  const worldNormal = meshHit.face.normal.clone();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(meshHit.object.matrixWorld);
  worldNormal.applyMatrix3(normalMatrix).normalize();
  if (worldNormal.dot(state.raycaster.ray.direction) > 0) {
    worldNormal.negate();
  }
  const shapeId = meshHit.object.userData.shapeId as string;
  const shape = shapes.find((item) => item.id === shapeId);
  if (!shape) return null;

  const hitPoint = { x: meshHit.point.x, y: meshHit.point.y, z: meshHit.point.z };
  const normal = { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z };
  const nearbyNormals = shape.importedMesh || shape.groupedShapes
    ? collectNearbyTriangleNormals(meshHit.object, meshHit.point, 3.5)
    : undefined;
  const classification = classifySketchFaceHit(shape, hitPoint, normal, nearbyNormals);
  const planeD = worldNormal.dot(meshHit.point);
  const key = [
    shapeId,
    classification.kind,
    classification.analytic?.type ?? "mesh",
    worldNormal.x.toFixed(3),
    worldNormal.y.toFixed(3),
    worldNormal.z.toFixed(3),
    planeD.toFixed(2),
  ].join("|");
  return { hit: meshHit, mesh: meshHit.object, worldNormal, shapeId, key, classification };
}

export function collectCoplanarFaceHighlightPositions(
  mesh: THREE.Mesh,
  hitPointWorld: THREE.Vector3,
  worldNormal: THREE.Vector3,
): Float32Array | null {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  if (!position) return null;

  const index = geometry.getIndex();
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  if (triangleCount < 1) return null;

  const localA = new THREE.Vector3();
  const localB = new THREE.Vector3();
  const localC = new THREE.Vector3();
  const worldA = new THREE.Vector3();
  const worldB = new THREE.Vector3();
  const worldC = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const edgeC = new THREE.Vector3();
  const triNormal = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const offset = worldNormal.clone().multiplyScalar(SKETCH_FACE_OFFSET);
  const unit = worldNormal.clone().normalize();
  const candidates: WorldTriangle[] = [];

  for (let t = 0; t < triangleCount; t += 1) {
    const ia = index ? index.getX(t * 3) : t * 3;
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    localA.fromBufferAttribute(position, ia);
    localB.fromBufferAttribute(position, ib);
    localC.fromBufferAttribute(position, ic);
    worldA.copy(localA).applyMatrix4(mesh.matrixWorld);
    worldB.copy(localB).applyMatrix4(mesh.matrixWorld);
    worldC.copy(localC).applyMatrix4(mesh.matrixWorld);
    edgeB.copy(worldB).sub(worldA);
    edgeC.copy(worldC).sub(worldA);
    triNormal.copy(edgeB).cross(edgeC);
    if (triNormal.lengthSq() < 1e-12) continue;
    triNormal.normalize();
    if (Math.abs(triNormal.dot(unit)) < FACE_REGION_NORMAL_DOT) continue;
    centroid.copy(worldA).add(worldB).add(worldC).multiplyScalar(1 / 3);
    const planeDist = Math.abs(
      (centroid.x - hitPointWorld.x) * unit.x
      + (centroid.y - hitPointWorld.y) * unit.y
      + (centroid.z - hitPointWorld.z) * unit.z,
    );
    if (planeDist > FACE_REGION_PLANE_EPS) continue;
    candidates.push([
      { x: worldA.x, y: worldA.y, z: worldA.z },
      { x: worldB.x, y: worldB.y, z: worldB.z },
      { x: worldC.x, y: worldC.y, z: worldC.z },
    ]);
  }

  const region = connectedCoplanarTriangles(
    candidates,
    { x: hitPointWorld.x, y: hitPointWorld.y, z: hitPointWorld.z },
    { x: unit.x, y: unit.y, z: unit.z },
  );
  const verts: number[] = [];
  for (const [a, b, c] of region) {
    verts.push(
      a.x + offset.x, a.y + offset.y, a.z + offset.z,
      b.x + offset.x, b.y + offset.y, b.z + offset.z,
      c.x + offset.x, c.y + offset.y, c.z + offset.z,
    );
  }

  return verts.length >= 9 ? new Float32Array(verts) : null;
}

export function clearSketchFaceHighlight(state: ThreeState | null) {
  if (!state) return;
  const existing = state.helperLayer.getObjectByName(SKETCH_FACE_HIGHLIGHT_NAME);
  if (!existing) return;
  state.helperLayer.remove(existing);
  disposeObject(existing);
  state.needsRender = true;
}

export function syncSketchFaceHighlight(state: ThreeState, faceHit: SketchFaceRaycastHit | null, previousKey: string | null) {
  if (!faceHit) {
    clearSketchFaceHighlight(state);
    return null;
  }
  if (previousKey === faceHit.key && state.helperLayer.getObjectByName(SKETCH_FACE_HIGHLIGHT_NAME)) {
    return faceHit.key;
  }

  clearSketchFaceHighlight(state);
  const analytic = faceHit.classification.analytic;
  const positions = analytic?.type === "disc-cap"
    ? discCapHighlightPositions(analytic.origin, analytic.normal, analytic.radius, 48, SKETCH_FACE_OFFSET)
    : analytic?.type === "barrel"
      ? barrelHighlightPositions(analytic.surface, 48, 12, SKETCH_FACE_OFFSET)
      : collectCoplanarFaceHighlightPositions(faceHit.mesh, faceHit.hit.point, faceHit.worldNormal);
  if (!positions) return null;

  const blocked = faceHit.classification.kind === "curved";
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: blocked ? "#c45c26" : "#2f9e5d",
      transparent: true,
      opacity: blocked ? 0.34 : 0.42,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  mesh.name = SKETCH_FACE_HIGHLIGHT_NAME;
  mesh.renderOrder = 40;
  mesh.raycast = () => undefined;
  state.helperLayer.add(mesh);
  state.needsRender = true;
  return faceHit.key;
}
