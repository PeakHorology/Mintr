import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { ThreeState } from "@/components/viewport/viewportTypes";
import { findShapeObject } from "@/components/viewport/sceneLookup";
import { clearShapeSettle } from "@/components/viewport/shapeSettle";

export const SHAPE_HOVER_OUTLINE = "ShapeHoverOutline";
export const SHAPE_SELECTION_OUTLINE = "ShapeSelectionOutline";
export const CAD_DISPLAY_EDGE_NAME = "CadDisplayEdge";
export const SHAPE_OUTLINE_BRONZE = "#c6a15b";
export const SHAPE_OUTLINE_EDGE_THRESHOLD = 24;
export const SHAPE_OUTLINE_MIN_EDGE_VERTS = 12;
export const SHAPE_OUTLINE_PIXELS = 2;
export const SHAPE_SILHOUETTE_STRIDE = 12;
export const SHAPE_SILHOUETTE_TRI_CAP = 250_000;
export const shapeHoverEdgeCache = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>();
export const shapeOutlineEdgeCache = new WeakMap<THREE.BufferGeometry, LineSegmentsGeometry>();
export const shapeSilhouetteCache = new WeakMap<THREE.BufferGeometry, SilhouetteTopology | null>();
export const _silhouetteCamLocal = new THREE.Vector3();

export function createOutlineLineMaterial(color: string, opacity = 1) {
  const material = new LineMaterial({
    color,
    linewidth: SHAPE_OUTLINE_PIXELS,
    worldUnits: false,
    dashed: false,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    toneMapped: false,
    alphaToCoverage: true,
  });
  material.userData.shared = true;
  return material;
}

export const shapeHoverMaterial = createOutlineLineMaterial(SHAPE_OUTLINE_BRONZE, 1);
export const shapeSelectionMaterial = createOutlineLineMaterial(SHAPE_OUTLINE_BRONZE, 1);

export type SilhouetteTopology = {
  data: Float32Array;
  count: number;
};

export function silhouetteTopologyFor(geometry: THREE.BufferGeometry) {
  const cached = shapeSilhouetteCache.get(geometry);
  if (cached !== undefined) return cached;
  const next = buildSilhouetteTopology(geometry);
  shapeSilhouetteCache.set(geometry, next);
  return next;
}

export function buildSilhouetteTopology(geometry: THREE.BufferGeometry): SilhouetteTopology | null {
  const position = geometry.getAttribute("position");
  if (!position || position.count < 3) return null;
  const index = geometry.getIndex();
  const triCount = Math.floor((index ? index.count : position.count) / 3);
  if (triCount < 4 || triCount > SHAPE_SILHOUETTE_TRI_CAP) return null;

  const weld = new Map<string, number>();
  const verts: number[] = [];
  const remap = (vertexIndex: number) => {
    const x = position.getX(vertexIndex);
    const y = position.getY(vertexIndex);
    const z = position.getZ(vertexIndex);
    const key = `${Math.round(x * 1000)}|${Math.round(y * 1000)}|${Math.round(z * 1000)}`;
    const existing = weld.get(key);
    if (existing !== undefined) return existing;
    const id = verts.length / 3;
    weld.set(key, id);
    verts.push(x, y, z);
    return id;
  };

  type EdgeAcc = { a: number; b: number; n1x: number; n1y: number; n1z: number; n2x: number; n2y: number; n2z: number; faces: number };
  const edges = new Map<number, EdgeAcc>();
  const addEdge = (a: number, b: number, nx: number, ny: number, nz: number) => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * 1_000_000_003 + hi;
    const existing = edges.get(key);
    if (!existing) {
      edges.set(key, { a: lo, b: hi, n1x: nx, n1y: ny, n1z: nz, n2x: 0, n2y: 0, n2z: 0, faces: 1 });
      return;
    }
    if (existing.faces === 1) {
      existing.n2x = nx;
      existing.n2y = ny;
      existing.n2z = nz;
    }
    existing.faces += 1;
  };

  const addFace = (ia: number, ib: number, ic: number) => {
    const ax = verts[ia * 3];
    const ay = verts[ia * 3 + 1];
    const az = verts[ia * 3 + 2];
    const bx = verts[ib * 3];
    const by = verts[ib * 3 + 1];
    const bz = verts[ib * 3 + 2];
    const cx = verts[ic * 3];
    const cy = verts[ic * 3 + 1];
    const cz = verts[ic * 3 + 2];
    if (ax === undefined || bx === undefined || cx === undefined) return;
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return;
    nx /= len;
    ny /= len;
    nz /= len;
    addEdge(ia, ib, nx, ny, nz);
    addEdge(ib, ic, nx, ny, nz);
    addEdge(ic, ia, nx, ny, nz);
  };

  if (index) {
    for (let t = 0; t < index.count; t += 3) {
      const a = remap(index.getX(t));
      const b = remap(index.getX(t + 1));
      const c = remap(index.getX(t + 2));
      if (a === b || b === c || c === a) continue;
      addFace(a, b, c);
    }
  } else {
    for (let t = 0; t < position.count; t += 3) {
      const a = remap(t);
      const b = remap(t + 1);
      const c = remap(t + 2);
      if (a === b || b === c || c === a) continue;
      addFace(a, b, c);
    }
  }

  if (edges.size < 3) return null;
  const data = new Float32Array(edges.size * SHAPE_SILHOUETTE_STRIDE);
  let count = 0;
  edges.forEach((edge) => {
    if (edge.faces > 2) return;
    const o = count * SHAPE_SILHOUETTE_STRIDE;
    data[o] = verts[edge.a * 3];
    data[o + 1] = verts[edge.a * 3 + 1];
    data[o + 2] = verts[edge.a * 3 + 2];
    data[o + 3] = verts[edge.b * 3];
    data[o + 4] = verts[edge.b * 3 + 1];
    data[o + 5] = verts[edge.b * 3 + 2];
    data[o + 6] = edge.n1x;
    data[o + 7] = edge.n1y;
    data[o + 8] = edge.n1z;
    data[o + 9] = edge.faces === 1 ? 0 : edge.n2x;
    data[o + 10] = edge.faces === 1 ? 0 : edge.n2y;
    data[o + 11] = edge.faces === 1 ? 0 : edge.n2z;
    count += 1;
  });
  return count > 0 ? { data, count } : null;
}

export function fillSilhouetteGeometry(
  lineGeometry: LineSegmentsGeometry,
  mesh: THREE.Mesh,
  topology: SilhouetteTopology,
  camera: THREE.Camera,
) {
  mesh.updateWorldMatrix(true, false);
  _silhouetteCamLocal.copy(camera.position);
  mesh.worldToLocal(_silhouetteCamLocal);
  const camx = _silhouetteCamLocal.x;
  const camy = _silhouetteCamLocal.y;
  const camz = _silhouetteCamLocal.z;
  const data = topology.data;
  let packed = lineGeometry.userData.packed as Float32Array | undefined;
  const needed = topology.count * 6;
  if (!packed || packed.length < needed) {
    packed = new Float32Array(needed);
    lineGeometry.userData.packed = packed;
  }
  let used = 0;
  for (let i = 0; i < topology.count; i += 1) {
    const o = i * SHAPE_SILHOUETTE_STRIDE;
    const ax = data[o];
    const ay = data[o + 1];
    const az = data[o + 2];
    const bx = data[o + 3];
    const by = data[o + 4];
    const bz = data[o + 5];
    const n1x = data[o + 6];
    const n1y = data[o + 7];
    const n1z = data[o + 8];
    const n2x = data[o + 9];
    const n2y = data[o + 10];
    const n2z = data[o + 11];
    const mx = (ax + bx) * 0.5;
    const my = (ay + by) * 0.5;
    const mz = (az + bz) * 0.5;
    const vx = camx - mx;
    const vy = camy - my;
    const vz = camz - mz;
    const d1 = n1x * vx + n1y * vy + n1z * vz;
    const boundary = n2x === 0 && n2y === 0 && n2z === 0;
    const d2 = boundary ? 0 : n2x * vx + n2y * vy + n2z * vz;
    const silhouette = boundary || (d1 > 1e-5 && d2 < -1e-5) || (d1 < -1e-5 && d2 > 1e-5);
    if (!silhouette) continue;
    packed[used] = ax;
    packed[used + 1] = ay;
    packed[used + 2] = az;
    packed[used + 3] = bx;
    packed[used + 4] = by;
    packed[used + 5] = bz;
    used += 6;
  }
  // One graphics buffer per outline, refilled in place as the camera turns. Calling
  // setPositions() every frame made a new buffer each time and left the old ones behind.
  const buffer = lineGeometry.userData.silhouetteBuffer as THREE.InterleavedBuffer | undefined;
  if (buffer && buffer.array === packed) {
    buffer.clearUpdateRanges();
    buffer.addUpdateRange(0, used);
    buffer.needsUpdate = true;
    lineGeometry.instanceCount = used / 6;
    return;
  }
  if (used < 6) return;
  lineGeometry.setPositions(packed);
  const start = lineGeometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute | undefined;
  lineGeometry.userData.silhouetteBuffer = start?.data;
  lineGeometry.instanceCount = used / 6;
}

export function refreshSilhouetteOutlines(state: ThreeState) {
  state.shapeLayer.traverse((child) => {
    if (!child.userData.silhouetteOutline || !(child instanceof LineSegments2)) return;
    const mesh = child.userData.silhouetteSource as THREE.Mesh | undefined;
    if (!mesh?.geometry) return;
    const topology = silhouetteTopologyFor(mesh.geometry);
    if (!topology) return;
    fillSilhouetteGeometry(child.geometry as LineSegmentsGeometry, mesh, topology, state.camera);
  });
}

export function disposeOutlineObject(child: THREE.Object3D) {
  if (child.userData.silhouetteOutline && child instanceof LineSegments2) {
    child.geometry.dispose();
  }
  child.parent?.remove(child);
}

export function clearNamedOutlines(root: THREE.Object3D, name: string) {
  const stale: THREE.Object3D[] = [];
  root.traverse((child) => {
    if (child.name === name) stale.push(child);
  });
  stale.forEach(disposeOutlineObject);
}

export function clearShapeHoverOutlines(root: THREE.Object3D) {
  clearNamedOutlines(root, SHAPE_HOVER_OUTLINE);
}

export let hoverOutlineRoot: THREE.Object3D | null = null;

export function isOutlineSourceMesh(child: THREE.Object3D): child is THREE.Mesh {
  return child instanceof THREE.Mesh
    && !child.userData.cutPreview
    && child.raycast.length !== 0;
}

/**
 * The outline lines cached for a shape's surface live on the graphics card too. Free
 * them when that surface is freed; otherwise every edit left its old outlines behind.
 */
export function releaseOutlineCachesWith(source: THREE.BufferGeometry) {
  source.addEventListener("dispose", () => {
    shapeHoverEdgeCache.get(source)?.dispose();
    shapeOutlineEdgeCache.get(source)?.dispose();
    shapeHoverEdgeCache.delete(source);
    shapeOutlineEdgeCache.delete(source);
    shapeSilhouetteCache.delete(source);
  });
}

export function overlayEdgesForMesh(mesh: THREE.Mesh) {
  const triangles = Math.floor((mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position")?.count ?? 0) / 3);
  if (triangles > 20_000) return null;
  let edges = shapeHoverEdgeCache.get(mesh.geometry);
  if (!edges) {
    edges = new THREE.EdgesGeometry(mesh.geometry, SHAPE_OUTLINE_EDGE_THRESHOLD);
    edges.userData.cached = true;
    shapeHoverEdgeCache.set(mesh.geometry, edges);
    releaseOutlineCachesWith(mesh.geometry);
  }
  const count = edges.getAttribute("position")?.count ?? 0;
  return count >= SHAPE_OUTLINE_MIN_EDGE_VERTS ? edges : null;
}

export function overlayFatEdgesForMesh(mesh: THREE.Mesh) {
  const sharp = overlayEdgesForMesh(mesh);
  if (!sharp) return null;
  let fat = shapeOutlineEdgeCache.get(mesh.geometry);
  if (fat) return fat;
  const position = sharp.getAttribute("position");
  if (!(position instanceof THREE.BufferAttribute)) return null;
  const src = position.array;
  const n = position.count * 3;
  const positions = src instanceof Float32Array && src.length === n
    ? src
    : Float32Array.from(src).subarray(0, n);
  fat = new LineSegmentsGeometry();
  fat.setPositions(positions);
  fat.userData.cached = true;
  shapeOutlineEdgeCache.set(mesh.geometry, fat);
  return fat;
}

export function meshWantsSilhouette(object: THREE.Object3D, mesh: THREE.Mesh, sharp: THREE.EdgesGeometry | null) {
  if (!sharp) return true;
  if (object.userData.round) return true;
  const triangles = Math.floor((mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position")?.count ?? 0) / 3);
  const segments = (sharp.getAttribute("position")?.count ?? 0) / 2;
  return triangles > 80 && segments < triangles * 0.15;
}

export function poseOutlineChild(target: THREE.Object3D, source: THREE.Object3D) {
  target.position.copy(source.position);
  target.rotation.copy(source.rotation);
  target.scale.copy(source.scale);
}

export function attachOutlineLines(
  geometry: LineSegmentsGeometry,
  parent: THREE.Object3D | null | undefined,
  source: THREE.Object3D,
  name: string,
  lineMaterial: LineMaterial,
  renderOrder: number,
  extra?: Record<string, unknown>,
) {
  const lines = new LineSegments2(geometry, lineMaterial);
  lines.name = name;
  lines.userData.outlineLine = true;
  if (extra) Object.assign(lines.userData, extra);
  lines.raycast = () => undefined;
  lines.frustumCulled = false;
  poseOutlineChild(lines, source);
  lines.renderOrder = renderOrder;
  parent?.add(lines);
  return lines;
}

export function attachSilhouetteOutline(
  mesh: THREE.Mesh,
  name: string,
  lineMaterial: LineMaterial,
  renderOrder: number,
  camera: THREE.Camera,
) {
  const topology = silhouetteTopologyFor(mesh.geometry);
  if (!topology) return false;
  const geometry = new LineSegmentsGeometry();
  fillSilhouetteGeometry(geometry, mesh, topology, camera);
  const segments = Number.isFinite(geometry.instanceCount) ? geometry.instanceCount : 0;
  if (segments < SHAPE_OUTLINE_MIN_EDGE_VERTS / 2) {
    geometry.dispose();
    return false;
  }
  attachOutlineLines(geometry, mesh.parent, mesh, name, lineMaterial, renderOrder, {
    silhouetteOutline: true,
    silhouetteSource: mesh,
  });
  return true;
}

export function attachObjectOutline(
  object: THREE.Object3D,
  name: string,
  lineMaterial: LineMaterial,
  renderOrder: number,
  camera?: THREE.Camera,
) {
  object.traverse((child) => {
    if (!isOutlineSourceMesh(child)) return;
    const sharp = overlayEdgesForMesh(child);
    const fat = overlayFatEdgesForMesh(child);
    if (fat) {
      attachOutlineLines(fat, child.parent, child, name, lineMaterial, renderOrder);
    }
    if (camera && meshWantsSilhouette(object, child, sharp)) {
      attachSilhouetteOutline(child, name, lineMaterial, renderOrder, camera);
    }
  });
}

export function attachEdgeOverlay(
  object: THREE.Object3D,
  name: string,
  material: LineMaterial,
  renderOrder: number,
  camera?: THREE.Camera,
) {
  attachObjectOutline(object, name, material, renderOrder, camera);
}

export function syncSelectionOutline(object: THREE.Object3D, selected: boolean, camera?: THREE.Camera) {
  clearNamedOutlines(object, SHAPE_SELECTION_OUTLINE);
  if (!selected) return;
  attachObjectOutline(object, SHAPE_SELECTION_OUTLINE, shapeSelectionMaterial, 3, camera);
}

export function showShapeHoverOutline(state: ThreeState, shapeId: string | null) {
  if (hoverOutlineRoot?.parent && hoverOutlineRoot.userData.shapeId === shapeId && shapeId) {
    return;
  }
  if (hoverOutlineRoot) {
    if (hoverOutlineRoot.parent) clearShapeHoverOutlines(hoverOutlineRoot);
    hoverOutlineRoot = null;
  }
  if (!shapeId) {
    state.needsRender = true;
    return;
  }
  const object = findShapeObject(state, shapeId);
  if (!object) return;
  attachEdgeOverlay(object, SHAPE_HOVER_OUTLINE, shapeHoverMaterial, 4, state.camera);
  hoverOutlineRoot = object;
  state.needsRender = true;
}

export function disposeChildren(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[group.children.length - 1];
    if (child) {
      group.remove(child);
      disposeObject(child);
    }
  }
}

export function disposeObject(object: THREE.Object3D) {
  if (hoverOutlineRoot === object) hoverOutlineRoot = null;
  clearShapeSettle(object);
  object.traverse((child) => {
    const mesh = child as THREE.Mesh | THREE.LineSegments;
    if ("geometry" in mesh && mesh.geometry) {
      if (!mesh.geometry.userData.cached) {
        mesh.geometry.dispose();
      }
    }
    if ("material" in mesh && mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        if (material.userData.shared) return;
        const map = "map" in material ? (material.map as THREE.Texture | null) : null;
        if (map && !map.userData.cached) {
          map.dispose();
        }
        material.dispose();
      });
    }
  });
}
