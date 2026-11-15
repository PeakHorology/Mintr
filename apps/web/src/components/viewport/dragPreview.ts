import * as THREE from "three";
import type { WorkplaneShape } from "@/types/sketchforge";
import type { DragItem, DragState, ThreeState } from "@/components/viewport/viewportTypes";
import { findSelectedGroundFootprint, findSelectionHelper, findShapeObject } from "@/components/viewport/sceneLookup";
import { pauseShapeSettle } from "@/components/viewport/shapeSettle";
import { finishEdgeWipe } from "@/components/viewport/shapeMotion";
import { framePoint, selectionFrameForShapes } from "@/components/viewport/selectionFrame";
import { setComplexEdgeVisibility } from "@/components/viewport/shapeObjects";

export function applyDragItemPreview(state: ThreeState, item: DragItem) {
  if (!item.visual || !item.visual.parent) {
    item.visual = findShapeObject(state, item.id);
  }
  if (!item.helper || !item.helper.parent) {
    item.helper = findSelectionHelper(state, item.id);
    item.helperBox = item.helper ? item.helper.box.clone() : null;
  }

  if (item.visual) {
    if (state.edgeWipe && (state.edgeWipe.incoming === item.visual || state.edgeWipe.outgoing === item.visual)) {
      finishEdgeWipe(state);
    }
    if (item.visual.userData.settling || item.visual.userData.pendingSettle || item.visual.userData.combining || item.visual.userData.rising) {
      pauseShapeSettle(item.visual);
    }
    if (!item.hadPreviewSimplified) {
      setComplexEdgeVisibility(item.visual, false);
      item.hadPreviewSimplified = true;
    }
    item.visual.position.x = item.nextX;
    item.visual.position.z = item.nextZ;
    item.visual.updateMatrixWorld(true);
  }

  if (item.helper && item.helperBox) {
    item.helper.box.copy(item.helperBox);
    item.helper.box.translate(new THREE.Vector3(item.nextX - item.startX, 0, item.nextZ - item.startZ));
    item.helper.updateMatrixWorld(true);
  }
}

export function refreshDragPreviewObjects(state: ThreeState | null, drag: DragState | null) {
  if (!state || !drag) return;
  drag.items.forEach((item) => applyDragItemPreview(state, item));
  updateSelectedGroundFootprintPreviews(state, drag);
  state.needsRender = true;
}

export function updateSelectedGroundFootprintPreviews(state: ThreeState, drag: DragState) {
  drag.items.forEach((item) => {
    const footprint = findSelectedGroundFootprint(state, item.id);
    if (!footprint) {
      return;
    }
    footprint.position.x = item.nextX - item.startX;
    footprint.position.z = item.nextZ - item.startZ;
    footprint.updateMatrixWorld(true);
  });
}

export function createSelectedGroundFootprint(shape: WorkplaneShape) {
  const frame = selectionFrameForShapes([shape], [shape.id]);
  if (!frame) {
    return null;
  }

  const group = new THREE.Group();
  group.name = "SelectedGroundFootprint";
  group.userData.shapeId = shape.id;
  // Contact shadow on the workplane — always present so drag can slide it with the object.
  const y = 0.05;
  const footprint = [
    framePoint(frame, frame.min.x, frame.min.y, frame.min.z),
    framePoint(frame, frame.max.x, frame.min.y, frame.min.z),
    framePoint(frame, frame.max.x, frame.min.y, frame.max.z),
    framePoint(frame, frame.min.x, frame.min.y, frame.max.z),
  ].map((point) => new THREE.Vector3(point.x, y, point.z));
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([
        footprint[0].x, footprint[0].y, footprint[0].z,
        footprint[1].x, footprint[1].y, footprint[1].z,
        footprint[2].x, footprint[2].y, footprint[2].z,
        footprint[0].x, footprint[0].y, footprint[0].z,
        footprint[2].x, footprint[2].y, footprint[2].z,
        footprint[3].x, footprint[3].y, footprint[3].z,
      ]),
      3,
    ),
  );
  fillGeometry.computeVertexNormals();
  const fill = new THREE.Mesh(
    fillGeometry,
    new THREE.MeshBasicMaterial({
      color: "#6d7c84",
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  fill.renderOrder = -1;
  group.add(fill);

  const points = [...footprint, footprint[0].clone()];
  const outline = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: "#c6a15b", transparent: true, opacity: 0.92 }),
  );
  outline.userData.shapeId = shape.id;
  group.add(outline);

  return group;
}

export function createTransformHandles(box: THREE.Box3, id: string) {
  const group = new THREE.Group();
  group.name = "SketchForgeTransformHandles";
  group.userData.shapeId = id;

  const handleMaterial = new THREE.MeshBasicMaterial({ color: "#e8eef1" });
  const darkMaterial = new THREE.MeshBasicMaterial({ color: "#273849" });
  const dashMaterial = new THREE.LineDashedMaterial({ color: "#2c3339", dashSize: 2.2, gapSize: 2.4, transparent: true, opacity: 0.72 });
  const handleGeometry = new THREE.BoxGeometry(2.6, 2.6, 2.6);
  const dotGeometry = new THREE.BoxGeometry(1.7, 1.7, 1.7);

  const center = box.getCenter(new THREE.Vector3());
  const topY = box.max.y + 1.4;
  const x0 = box.min.x;
  const x1 = box.max.x;
  const z0 = box.min.z;
  const z1 = box.max.z;
  const xm = center.x;
  const zm = center.z;

  const cornerPoints = [
    { key: "far-left", kind: "scale" as const, point: new THREE.Vector3(x0, box.min.y + 1.3, z0) },
    { key: "far-right", kind: "scale" as const, point: new THREE.Vector3(x1, box.min.y + 1.3, z0) },
    { key: "near-left", kind: "scale" as const, point: new THREE.Vector3(x0, box.min.y + 1.3, z1) },
    { key: "near-right", kind: "scale" as const, point: new THREE.Vector3(x1, box.min.y + 1.3, z1) },
    { key: "far-left", kind: "scale" as const, point: new THREE.Vector3(x0, topY, z0) },
    { key: "far-right", kind: "scale" as const, point: new THREE.Vector3(x1, topY, z0) },
    { key: "near-left", kind: "scale" as const, point: new THREE.Vector3(x0, topY, z1) },
    { key: "near-right", kind: "scale" as const, point: new THREE.Vector3(x1, topY, z1) },
    { key: "top-height", kind: "height" as const, point: new THREE.Vector3(xm, box.max.y + 7, zm) },
  ];

  cornerPoints.forEach(({ key, kind, point }) => {
    const handle = new THREE.Mesh(handleGeometry, handleMaterial);
    handle.position.copy(point);
    handle.userData.shapeId = id;
    handle.userData.transformHandle = kind;
    handle.userData.transformHandleKey = key;
    handle.userData.transformPlaneY = point.y;
    group.add(handle);
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(handleGeometry), new THREE.LineBasicMaterial({ color: "#2d3439", transparent: true, opacity: 0.86 }));
    outline.position.copy(point);
    outline.userData.shapeId = id;
    outline.userData.transformHandle = handle.userData.transformHandle;
    outline.userData.transformHandleKey = key;
    outline.userData.transformPlaneY = point.y;
    group.add(outline);
  });

  [
    { key: "far-mid", point: new THREE.Vector3(xm, topY, z0) },
    { key: "near-mid", point: new THREE.Vector3(xm, topY, z1) },
    { key: "left-mid", point: new THREE.Vector3(x0, topY, zm) },
    { key: "right-mid", point: new THREE.Vector3(x1, topY, zm) },
    { key: "far-mid", point: new THREE.Vector3(xm, box.min.y + 1.3, z0) },
    { key: "near-mid", point: new THREE.Vector3(xm, box.min.y + 1.3, z1) },
    { key: "left-mid", point: new THREE.Vector3(x0, box.min.y + 1.3, zm) },
    { key: "right-mid", point: new THREE.Vector3(x1, box.min.y + 1.3, zm) },
  ].forEach(({ key, point }) => {
    const dot = new THREE.Mesh(dotGeometry, darkMaterial);
    dot.position.copy(point);
    dot.userData.shapeId = id;
    dot.userData.transformHandle = "scale";
    dot.userData.transformHandleKey = key;
    dot.userData.transformPlaneY = point.y;
    group.add(dot);
  });

  [
    [new THREE.Vector3(xm, box.max.y + 7, zm), new THREE.Vector3(xm, box.min.y + 1.3, zm)],
  ].forEach(([from, to]) => {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geometry, dashMaterial);
    line.computeLineDistances();
    group.add(line);
  });

  return group;
}
