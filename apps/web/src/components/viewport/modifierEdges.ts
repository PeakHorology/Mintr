import * as THREE from "three";
import { clipPolylineToSurface, indexMeshSurface, type MeshSurfaceIndex, SURFACE_LINE_TOLERANCE } from "@/lib/clipEdgesToMesh";
import type { CadModifierEdge, CadPlanarFace } from "@/lib/cadModifierTypes";
import type { ThreeState } from "@/components/viewport/viewportTypes";
import { objectIsShown } from "@/components/viewport/meshPick";
import { disposeChildren } from "@/components/viewport/shapeOutlines";
import { applyXrayClipping } from "@/components/viewport/xrayScene";

export const MODIFIER_EDGE_IDLE = new THREE.Color("#17b7e5");
export const MODIFIER_EDGE_HOVER = new THREE.Color("#2aa77e");
export const MODIFIER_EDGE_SELECTED = new THREE.Color("#ff8a1d");
export const MODIFIER_EDGE_SELECTED_HOVER = new THREE.Color("#ffbf45");
export const MODIFIER_EDGE_PAPER = new THREE.Color("#f3f0e8");

export type ModifierEdgeRange = { start: number; count: number };

export type ModifierEdgeBatch = {
  source: CadModifierEdge[];
  previewKey: string;
  ranges: Map<number, ModifierEdgeRange>;
  positions: Float32Array;
  selected: Set<number>;
  lines: THREE.LineSegments;
  hover: THREE.LineSegments;
};

export function modifierEdgeColor(active: boolean, target: THREE.Color) {
  if (active) return target.copy(MODIFIER_EDGE_SELECTED);
  return target.copy(MODIFIER_EDGE_IDLE).lerp(MODIFIER_EDGE_PAPER, 0.28);
}

export function paintModifierEdgeColors(batch: ModifierEdgeBatch, selected: Set<number>) {
  const colors = batch.lines.geometry.getAttribute("color") as THREE.BufferAttribute;
  const array = colors.array as Float32Array;
  const color = new THREE.Color();
  batch.ranges.forEach((range, id) => {
    modifierEdgeColor(selected.has(id), color);
    for (let vertex = range.start; vertex < range.start + range.count; vertex += 1) {
      const offset = vertex * 3;
      array[offset] = color.r;
      array[offset + 1] = color.g;
      array[offset + 2] = color.b;
    }
  });
  colors.needsUpdate = true;
  batch.selected = selected;
}

export function showModifierEdgeHover(batch: ModifierEdgeBatch, hoverId: number | null) {
  const range = hoverId === null ? undefined : batch.ranges.get(hoverId);
  const geometry = batch.hover.geometry;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const material = batch.hover.material as THREE.LineBasicMaterial;
  if (!range || range.count < 2) {
    batch.hover.visible = false;
    return;
  }
  const destination = position.array as Float32Array;
  destination.set(batch.positions.subarray(range.start * 3, (range.start + range.count) * 3));
  position.needsUpdate = true;
  geometry.setDrawRange(0, range.count);
  material.color.copy(hoverId !== null && batch.selected.has(hoverId) ? MODIFIER_EDGE_SELECTED_HOVER : MODIFIER_EDGE_HOVER);
  batch.hover.visible = true;
}

/** World-space surface of the solids on screen, skipping the sharp body held under a preview. */
export function previewSurface(state: ThreeState): MeshSurfaceIndex | null {
  const positions: number[] = [];
  const indices: number[] = [];
  const vertex = new THREE.Vector3();
  state.shapeLayer.updateMatrixWorld(true);
  state.shapeLayer.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.printBody !== true || !objectIsShown(object)) return;
    const attribute = object.geometry.getAttribute("position");
    if (!attribute) return;
    const base = positions.length / 3;
    object.updateWorldMatrix(true, false);
    for (let index = 0; index < attribute.count; index += 1) {
      vertex.fromBufferAttribute(attribute, index).applyMatrix4(object.matrixWorld);
      positions.push(vertex.x, vertex.y, vertex.z);
    }
    const index = object.geometry.getIndex();
    if (index) {
      for (let cursor = 0; cursor < index.count; cursor += 1) indices.push(base + index.getX(cursor));
    } else {
      for (let cursor = 0; cursor < attribute.count; cursor += 1) indices.push(base + cursor);
    }
  });
  if (positions.length < 9) return null;
  return indexMeshSurface(positions, indices);
}

export function modifierEdgePolylines(edge: CadModifierEdge, surface: MeshSurfaceIndex | null) {
  if (!surface) return [edge.points];
  return clipPolylineToSurface(edge.points, surface, SURFACE_LINE_TOLERANCE);
}

export function rebuildModifierEdges(state: ThreeState | null, edges: CadModifierEdge[], selectedIds: number[], previewActive = false, hoverId: number | null = null) {
  if (!state) return;
  const previewKey = previewActive ? `on:${state.shapeRevision ?? 0}` : "off";
  const existing = state.modifierLayer.userData.modifierEdgeBatch as ModifierEdgeBatch | undefined;
  const selected = new Set(selectedIds);

  if (existing && existing.source === edges && existing.previewKey === previewKey) {
    const sameSelection = existing.selected.size === selected.size && selectedIds.every((id) => existing.selected.has(id));
    if (!sameSelection) paintModifierEdgeColors(existing, selected);
    showModifierEdgeHover(existing, hoverId);
    state.needsRender = true;
    return;
  }

  const surface = previewActive ? previewSurface(state) : null;
  const drawable = edges
    .map((edge) => ({ id: edge.id, polylines: modifierEdgePolylines(edge, surface).filter((points) => points.length >= 6) }))
    .filter((edge) => edge.polylines.length > 0);

  disposeChildren(state.modifierLayer);
  if (drawable.length === 0) {
    delete state.modifierLayer.userData.modifierEdgeBatch;
    state.needsRender = true;
    return;
  }

  let vertexCount = 0;
  let longest = 0;
  drawable.forEach((edge) => {
    let vertices = 0;
    edge.polylines.forEach((points) => {
      vertices += Math.max(0, Math.floor(points.length / 3) - 1) * 2;
    });
    vertexCount += vertices;
    longest = Math.max(longest, vertices);
  });
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const ranges = new Map<number, ModifierEdgeRange>();
  let cursor = 0;
  drawable.forEach((edge) => {
    const start = cursor;
    edge.polylines.forEach((points) => {
      const count = Math.floor(points.length / 3);
      for (let index = 0; index + 1 < count; index += 1) {
        const from = index * 3;
        positions[cursor * 3] = points[from];
        positions[cursor * 3 + 1] = points[from + 1];
        positions[cursor * 3 + 2] = points[from + 2];
        cursor += 1;
        positions[cursor * 3] = points[from + 3];
        positions[cursor * 3 + 1] = points[from + 4];
        positions[cursor * 3 + 2] = points[from + 5];
        cursor += 1;
      }
    });
    ranges.set(edge.id, { start, count: cursor - start });
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
  lines.renderOrder = 1002;
  lines.frustumCulled = false;

  const hoverGeometry = new THREE.BufferGeometry();
  hoverGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(2, longest) * 3), 3));
  const hover = new THREE.LineSegments(hoverGeometry, new THREE.LineBasicMaterial({
    color: MODIFIER_EDGE_HOVER,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  }));
  hover.renderOrder = 1005;
  hover.frustumCulled = false;
  hover.visible = false;

  const batch: ModifierEdgeBatch = { source: edges, previewKey, ranges, positions, selected, lines, hover };
  paintModifierEdgeColors(batch, selected);
  showModifierEdgeHover(batch, hoverId);
  state.modifierLayer.add(lines, hover);
  state.modifierLayer.userData.modifierEdgeBatch = batch;
  applyXrayClipping(state);
  state.needsRender = true;
}

export const NO_IDS: number[] = [];
export const NO_FACES: CadPlanarFace[] = [];
export const NO_MODIFIER_EDGES: CadModifierEdge[] = [];
