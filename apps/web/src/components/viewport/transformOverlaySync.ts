import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import * as THREE from "three";
import type { AlignOverlayState, CircularPatternOverlayState, MirrorOverlayState } from "@/components/workplane/ActionOverlays";
import { rotateHandleRect, separateDimensionLabels } from "@/lib/overlayLabelSeparation";
import { cameraFacingTiltAxis, projectToScreen } from "@/lib/viewportInteractionMath";
import {
  type DimensionMark,
  type RotationAxis,
  type RotationPlaneView,
  rotationWheelRadiiFromPlaneRadius,
  type RotationWheelView,
  type TransformOverlayState,
} from "@/components/workplane/TransformOverlay";
import type { AlignAxis, AlignHandleStatus, AlignTarget, WorkplaneShape } from "@/types/sketchforge";
import { MIN_SHAPE_SIZE } from "@/components/viewport/viewportConstants";
import type { RotationHandleSide, ThreeState } from "@/components/viewport/viewportTypes";
import { formatMeasure, type MeasureFormat } from "@/components/viewport/formatMeasure";
import { disposeObject } from "@/components/viewport/shapeOutlines";
import { EDGE_WIPE_TRACE_NAME } from "@/components/viewport/shapeMotion";
import {
  dominantRotationSide,
  framePoint,
  ROTATION_FACE_SCREEN_OFFSET,
  ROTATION_TILT_ABOVE_LIFT_OFFSET,
  rotationHandleIconAngle,
  rotationHandleSidesForCamera,
  rotationHandleTangent,
  selectionFrameCorners,
  selectionFrameForShapes,
  wheelCenterTowardCamera,
} from "@/components/viewport/selectionFrame";
import { createSelectedGroundFootprint } from "@/components/viewport/dragPreview";

export function rebuildSelectionHelpers(state: ThreeState | null, shapes: WorkplaneShape[], selectedIds: string[]) {
  if (!state) {
    return;
  }

  for (const child of [...state.helperLayer.children]) {
    if (child.name === EDGE_WIPE_TRACE_NAME) continue;
    state.helperLayer.remove(child);
    disposeObject(child);
  }
  selectedIds.forEach((id) => {
    const shape = shapes.find((entry) => entry.id === id && !entry.hidden);
    if (!shape) {
      return;
    }
    const shadow = createSelectedGroundFootprint(shape);
    if (shadow) {
      state.helperLayer.add(shadow);
    }
  });
}

export function setSelectionHelpersVisible(state: ThreeState | null, shown: boolean) {
  // The move and resize handles stay away while Smooth points are being edited.
  const visible = shown && !state?.scene.userData.smoothEdit;
  if (!state || state.helperLayer.visible === visible) {
    return;
  }
  state.helperLayer.visible = visible;
  state.needsRender = true;
}

export function makeDimensionMark(
  key: string,
  handleKey: string,
  axis: DimensionMark["axis"],
  label: string,
  fromWorld: THREE.Vector3,
  toWorld: THREE.Vector3,
  outwardWorld: THREE.Vector3,
  project: (point: THREE.Vector3) => { x: number; y: number },
): DimensionMark {
  const from = project(fromWorld);
  const to = project(toWorld);
  const outwardAxis = outwardWorld.clone();
  outwardAxis.normalize();

  const railOffset = 5.8;
  const extensionOverrun = 1.4;
  const labelOffset = 3.2;
  const railFrom = project(fromWorld.clone().add(outwardAxis.clone().multiplyScalar(railOffset)));
  const railTo = project(toWorld.clone().add(outwardAxis.clone().multiplyScalar(railOffset)));
  const extensionFrom = project(fromWorld.clone().add(outwardAxis.clone().multiplyScalar(railOffset + extensionOverrun)));
  const extensionTo = project(toWorld.clone().add(outwardAxis.clone().multiplyScalar(railOffset + extensionOverrun)));
  const labelPoint = project(
    fromWorld
      .clone()
      .lerp(toWorld, 0.5)
      .add(outwardAxis.clone().multiplyScalar(railOffset + labelOffset)),
  );

  return {
    key,
    handleKey,
    axis,
    label,
    x1: railFrom.x,
    y1: railFrom.y,
    x2: railTo.x,
    y2: railTo.y,
    e1x1: from.x,
    e1y1: from.y,
    e1x2: extensionFrom.x,
    e1y2: extensionFrom.y,
    e2x1: to.x,
    e2y1: to.y,
    e2x2: extensionTo.x,
    e2y2: extensionTo.y,
    labelX: labelPoint.x,
    labelY: labelPoint.y,
  };
}

export function updateTransformOverlayIfChanged(
  overlayRef: MutableRefObject<TransformOverlayState | null>,
  setOverlay: Dispatch<SetStateAction<TransformOverlayState | null>>,
  next: TransformOverlayState,
) {
  if (overlayRef.current && JSON.stringify(overlayRef.current) === JSON.stringify(next)) {
    return;
  }
  overlayRef.current = next;
  setOverlay(next);
}

export function syncTransformOverlay(
  state: ThreeState,
  shapes: WorkplaneShape[],
  selectedIds: string[],
  overlayRef: MutableRefObject<TransformOverlayState | null>,
  setOverlay: Dispatch<SetStateAction<TransformOverlayState | null>>,
  measure: MeasureFormat,
  keepVisibleDuringInteraction = false,
) {
  if (selectedIds.length < 1) {
    if (overlayRef.current) {
      overlayRef.current = null;
      setOverlay(null);
    }
    return;
  }

  const frame = selectionFrameForShapes(shapes, selectedIds);
  if (!frame) {
    if (overlayRef.current) {
      overlayRef.current = null;
      setOverlay(null);
    }
    return;
  }

  const rect = state.renderer.domElement.getBoundingClientRect();
  // Future edits: do not remove this. The transform overlay is projected with
  // Vector3.project(), outside Three's renderer. With OrbitControls damping, the
  // camera matrix can otherwise be one frame stale, making handles/lines trail.
  state.camera.updateMatrixWorld();
  const corners = selectionFrameCorners(frame);
  const projectedCorners = corners.map((corner) => {
    const cameraSpace = corner.clone().applyMatrix4(state.camera.matrixWorldInverse);
    const projected = corner.clone().project(state.camera);
    return { cameraSpace, projected };
  });
  const nearPlane = state.camera instanceof THREE.PerspectiveCamera ? state.camera.near : 0.1;
  const selectionRadius = Math.max(MIN_SHAPE_SIZE, Math.sqrt(frame.width ** 2 + frame.height ** 2 + frame.depth ** 2) / 2);
  const cameraDistance = state.camera.position.distanceTo(frame.center);
  // When zoomed into/through a selected object, the projected overlay can span
  // thousands of pixels even before any corner crosses the near plane. Hide it
  // at that depth instead of drawing misleading dashed lines across the scene.
  const cameraInsideSelection = cameraDistance < selectionRadius * 1.12;
  const projectionInvalid = projectedCorners.some(({ cameraSpace, projected }) => cameraSpace.z > -nearPlane * 1.5 || !Number.isFinite(projected.x) || !Number.isFinite(projected.y));
  const projectedSpanTooLarge = (() => {
    const xs = projectedCorners.map(({ projected }) => ((projected.x + 1) / 2) * rect.width);
    const ys = projectedCorners.map(({ projected }) => ((1 - projected.y) / 2) * rect.height);
    return Math.max(...xs) - Math.min(...xs) > rect.width * 4 || Math.max(...ys) - Math.min(...ys) > rect.height * 4;
  })();
  const overlayTooClose = projectionInvalid || (!keepVisibleDuringInteraction && (cameraInsideSelection || projectedSpanTooLarge));
  if (overlayTooClose) {
    if (overlayRef.current) {
      overlayRef.current = null;
      setOverlay(null);
    }
    return;
  }
  const project = (point: THREE.Vector3) => {
    const projected = point.clone().project(state.camera);
    return {
      x: ((projected.x + 1) / 2) * rect.width,
      y: ((1 - projected.y) / 2) * rect.height,
    };
  };

  const worldMinY = Math.min(...corners.map((corner) => corner.y));
  const worldMaxY = Math.max(...corners.map((corner) => corner.y));
  const worldMinX = Math.min(...corners.map((corner) => corner.x));
  const worldMaxX = Math.max(...corners.map((corner) => corner.x));
  const worldMinZ = Math.min(...corners.map((corner) => corner.z));
  const worldMaxZ = Math.max(...corners.map((corner) => corner.z));
  const worldCenterX = (worldMinX + worldMaxX) / 2;
  const worldCenterY = (worldMinY + worldMaxY) / 2;
  const worldCenterZ = (worldMinZ + worldMaxZ) / 2;
  const worldCenter = new THREE.Vector3(worldCenterX, worldCenterY, worldCenterZ);
  const worldHeight = Math.max(MIN_SHAPE_SIZE, worldMaxY - worldMinY);
  const liftOffset = Math.max(2, worldHeight * 0.08);
  const verticalBase = new THREE.Vector3(worldCenterX, worldMinY, worldCenterZ);
  const verticalTop = new THREE.Vector3(worldCenterX, worldMaxY, worldCenterZ);
  const showLowerHandles = state.camera.position.y < frame.center.y;
  const liftHandle = new THREE.Vector3(worldCenterX, showLowerHandles ? worldMinY - liftOffset : worldMaxY + liftOffset, worldCenterZ);
  const xFootAxis = frame.xAxis.clone().normalize();
  const zFootAxis = frame.zAxis.clone().normalize();
  const localBottomY = frame.min.y;
  const localTopY = frame.max.y;
  const footprintWorld = {
    nearLeft: framePoint(frame, frame.min.x, localBottomY, frame.max.z),
    nearRight: framePoint(frame, frame.max.x, localBottomY, frame.max.z),
    farRight: framePoint(frame, frame.max.x, localBottomY, frame.min.z),
    farLeft: framePoint(frame, frame.min.x, localBottomY, frame.min.z),
    near: framePoint(frame, 0, localBottomY, frame.max.z),
    right: framePoint(frame, frame.max.x, localBottomY, 0),
    far: framePoint(frame, 0, localBottomY, frame.min.z),
    left: framePoint(frame, frame.min.x, localBottomY, 0),
  };
  const bottomCenterWorld = framePoint(frame, 0, localBottomY, 0);
  const topCenterWorld = framePoint(frame, 0, localTopY, 0);
  const bottom = {
    nearLeft: project(footprintWorld.nearLeft),
    nearRight: project(footprintWorld.nearRight),
    farRight: project(footprintWorld.farRight),
    farLeft: project(footprintWorld.farLeft),
  };
  const mid = {
    near: project(footprintWorld.near),
    right: project(footprintWorld.right),
    far: project(footprintWorld.far),
    left: project(footprintWorld.left),
  };
  const bottomCenterPoint = project(bottomCenterWorld);
  const topPoint = project(topCenterWorld);
  const heightPoint = project(showLowerHandles ? bottomCenterWorld : topCenterWorld);
  const liftPoint = project(liftHandle);
  const centerPoint = project(frame.center);
  const footprintGuides = [
    { x1: bottom.nearLeft.x, y1: bottom.nearLeft.y, x2: bottom.nearRight.x, y2: bottom.nearRight.y },
    { x1: bottom.nearRight.x, y1: bottom.nearRight.y, x2: bottom.farRight.x, y2: bottom.farRight.y },
    { x1: bottom.farRight.x, y1: bottom.farRight.y, x2: bottom.farLeft.x, y2: bottom.farLeft.y },
    { x1: bottom.farLeft.x, y1: bottom.farLeft.y, x2: bottom.nearLeft.x, y2: bottom.nearLeft.y },
  ];
  const widthLabel = formatMeasure(frame.width, measure);
  const depthLabel = formatMeasure(frame.depth, measure);
  const heightLabel = formatMeasure(frame.height, measure);
  const nearOut = zFootAxis;
  const farOut = zFootAxis.clone().multiplyScalar(-1);
  const rightOut = xFootAxis;
  const leftOut = xFootAxis.clone().multiplyScalar(-1);
  const heightHandleKey = showLowerHandles ? "bottom-height" : "top-height";
  const liftHandleKey = showLowerHandles ? "lower-shape" : "lift-shape";
  const workplaneAnchor = new THREE.Vector3(worldCenterX, 0, worldCenterZ);
  const liftLabel = formatMeasure(worldMinY, measure);
  const makeFootprintDimensionMark = (handleKey: string, axis: "width" | "depth") => {
    if (axis === "width") {
      const useFarSide = handleKey.includes("far") || handleKey.includes("left");
      return makeDimensionMark(
        `${handleKey}-width`,
        handleKey,
        "width",
        widthLabel,
        useFarSide ? footprintWorld.farLeft : footprintWorld.nearLeft,
        useFarSide ? footprintWorld.farRight : footprintWorld.nearRight,
        useFarSide ? farOut : nearOut,
        project,
      );
    }
    const useLeftSide = handleKey.includes("left") || handleKey.includes("far");
    return makeDimensionMark(
      `${handleKey}-depth`,
      handleKey,
      "depth",
      depthLabel,
      useLeftSide ? footprintWorld.nearLeft : footprintWorld.nearRight,
      useLeftSide ? footprintWorld.farLeft : footprintWorld.farRight,
      useLeftSide ? leftOut : rightOut,
      project,
    );
  };
  const footprintHandleKeys = ["near-left", "near-right", "far-right", "far-left", "near-mid", "right-mid", "far-mid", "left-mid"];
  const footprintDimensionMarks = Object.fromEntries(
    footprintHandleKeys.map((handleKey) => {
      const axes = new Set<"width" | "depth">();
      if (handleKey.includes("left") || handleKey.includes("right")) {
        axes.add("width");
      }
      if (handleKey.includes("near") || handleKey.includes("far")) {
        axes.add("depth");
      }
      return [handleKey, Array.from(axes).map((axis) => makeFootprintDimensionMark(handleKey, axis))];
    }),
  );
  const dimensionMarks = {
    ...footprintDimensionMarks,
    [heightHandleKey]: [makeDimensionMark("height", heightHandleKey, "height", heightLabel, bottomCenterWorld, topCenterWorld, rightOut, project)],
    [liftHandleKey]: [makeDimensionMark("elevation", liftHandleKey, "elevation", liftLabel, workplaneAnchor, verticalBase, rightOut, project)],
    selection: [
      makeFootprintDimensionMark("near-mid", "width"),
      makeFootprintDimensionMark("right-mid", "depth"),
      makeDimensionMark("height", heightHandleKey, "height", heightLabel, bottomCenterWorld, topCenterWorld, rightOut, project),
    ],
  };
  const screenOffsetFromCenter = (point: { x: number; y: number }, distance: number) => {
    const dx = point.x - centerPoint.x;
    const dy = point.y - centerPoint.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    return {
      x: point.x + (dx / length) * distance,
      y: point.y + (dy / length) * distance,
    };
  };
  const rotationSides = rotationHandleSidesForCamera(state, worldCenter);
  const sidePoint = (side: RotationHandleSide, y: number) => {
    if (side === "right") {
      return new THREE.Vector3(worldMaxX, y, worldCenterZ);
    }
    if (side === "left") {
      return new THREE.Vector3(worldMinX, y, worldCenterZ);
    }
    if (side === "near") {
      return new THREE.Vector3(worldCenterX, y, worldMaxZ);
    }
    return new THREE.Vector3(worldCenterX, y, worldMinZ);
  };
  const wheelNudge = Math.max(10, Math.max(frame.width, frame.depth, frame.height) * 0.12);
  const yawPivot = new THREE.Vector3(worldCenterX, worldMinY, worldCenterZ);
  // Yaw sits on the oriented selection footprint (not world AABB), so the icon tracks a real box edge.
  const footprintYawEdge = (side: RotationHandleSide) => {
    if (side === "near") {
      return { mid: footprintWorld.near, start: footprintWorld.nearLeft, end: footprintWorld.nearRight };
    }
    if (side === "far") {
      return { mid: footprintWorld.far, start: footprintWorld.farLeft, end: footprintWorld.farRight };
    }
    if (side === "right") {
      return { mid: footprintWorld.right, start: footprintWorld.nearRight, end: footprintWorld.farRight };
    }
    return { mid: footprintWorld.left, start: footprintWorld.nearLeft, end: footprintWorld.farLeft };
  };
  const toCameraFlat = state.camera.position.clone().sub(bottomCenterWorld);
  toCameraFlat.y = 0;
  let yawSide: RotationHandleSide = rotationSides.y;
  if (toCameraFlat.lengthSq() > 0.0001) {
    toCameraFlat.normalize();
    const xHorizontal = new THREE.Vector3(xFootAxis.x, 0, xFootAxis.z);
    const zHorizontal = new THREE.Vector3(zFootAxis.x, 0, zFootAxis.z);
    if (xHorizontal.lengthSq() > 0.0001 && zHorizontal.lengthSq() > 0.0001) {
      xHorizontal.normalize();
      zHorizontal.normalize();
      yawSide = dominantRotationSide(toCameraFlat.dot(xHorizontal), toCameraFlat.dot(zHorizontal), state.rotationHandleSides?.y);
      if (state.rotationHandleSides) {
        state.rotationHandleSides = { ...state.rotationHandleSides, y: yawSide };
      }
    }
  }
  const yawEdge = footprintYawEdge(yawSide);
  const rotateBottomWorld = yawEdge.mid;
  const rotateBottom = screenOffsetFromCenter(project(rotateBottomWorld), ROTATION_FACE_SCREEN_OFFSET + 10);
  const yawEdgeStart = project(yawEdge.start);
  const yawEdgeEnd = project(yawEdge.end);
  let yawIconAngle = (Math.atan2(yawEdgeEnd.y - yawEdgeStart.y, yawEdgeEnd.x - yawEdgeStart.x) * 180) / Math.PI;
  // Keep the arc bow on the outside of the selection box (SVG +Y after rotate).
  {
    const outwardX = rotateBottom.x - centerPoint.x;
    const outwardY = rotateBottom.y - centerPoint.y;
    const bowX = -Math.sin((yawIconAngle * Math.PI) / 180);
    const bowY = Math.cos((yawIconAngle * Math.PI) / 180);
    if (bowX * outwardX + bowY * outwardY < 0) {
      yawIconAngle += 180;
    }
  }
  const tiltAxis = cameraFacingTiltAxis(state, frame);
  const tiltAxisVector = tiltAxis === "x" ? xFootAxis : zFootAxis;
  const tiltHandleWorld = new THREE.Vector3(liftHandle.x, liftHandle.y, liftHandle.z);
  const tiltTangent = rotationHandleTangent(tiltAxisVector, frame.center, tiltHandleWorld, tiltAxis === "x" ? zFootAxis : xFootAxis);
  const xFaceCenter = wheelCenterTowardCamera(state.camera, frame.center, sidePoint(rotationSides.x, worldCenterY), wheelNudge);
  const zFaceCenter = wheelCenterTowardCamera(state.camera, frame.center, sidePoint(rotationSides.z, worldCenterY), wheelNudge);
  const yFaceCenter = wheelCenterTowardCamera(state.camera, yawPivot, verticalBase, wheelNudge);
  const rotateHandles: Array<{ key: string; className: string; x: number; y: number; angle: number; title?: string }> = [
    {
      key: "rotate-tilt",
      className: `screen-tilt axis-${tiltAxis}`,
      x: liftPoint.x,
      y: liftPoint.y - ROTATION_TILT_ABOVE_LIFT_OFFSET,
      angle: rotationHandleIconAngle(project, tiltHandleWorld, tiltTangent),
      title: tiltAxis === "x" ? "Rotate (tilt X)" : "Rotate (tilt Z)",
    },
    {
      key: "rotate-bottom",
      className: "screen-bottom axis-y",
      x: rotateBottom.x,
      y: rotateBottom.y,
      angle: yawIconAngle,
      title: "Rotate (yaw)",
    },
  ];
  const rotateObstacles = rotateHandles.map(rotateHandleRect);
  const labelViewport = { width: rect.width, height: rect.height };
  for (const marks of Object.values(dimensionMarks)) {
    separateDimensionLabels(marks, rotateObstacles, labelViewport);
  }
  const planeRadius = 154;
  /** Screen-space circle so the protractor stays readable from every camera angle. */
  const makeBillboardPlaneView = (centerWorld: THREE.Vector3): RotationPlaneView => {
    const screenCenter = project(centerWorld);
    const unit = planeRadius / 100;
    return {
      x: screenCenter.x,
      y: screenCenter.y,
      a: unit,
      b: 0,
      c: 0,
      d: unit,
    };
  };
  const makeWheel = (centerWorld: THREE.Vector3) => {
    const screenCenter = project(centerWorld);
    return { x: screenCenter.x, y: screenCenter.y, ...rotationWheelRadiiFromPlaneRadius(planeRadius) };
  };
  const makeWorldPoint = (point: THREE.Vector3) => ({ x: point.x, y: point.y, z: point.z });
  const rotationWheels: Record<RotationAxis, RotationWheelView> = {
    x: makeWheel(xFaceCenter),
    y: makeWheel(yFaceCenter),
    z: makeWheel(zFaceCenter),
  };
  const rotationPlaneCenters: Record<RotationAxis, { x: number; y: number; z: number }> = {
    x: makeWorldPoint(xFaceCenter),
    y: makeWorldPoint(yFaceCenter),
    z: makeWorldPoint(zFaceCenter),
  };
  // Display rings face the camera. Drag math uses screen angle around the wheel (plus axis sign).
  const rotationPlanes: Record<RotationAxis, RotationPlaneView> = {
    x: makeBillboardPlaneView(xFaceCenter),
    y: makeBillboardPlaneView(yFaceCenter),
    z: makeBillboardPlaneView(zFaceCenter),
  };

  const next = {
    id: frame.ids.join("|"),
    width: rect.width,
    height: rect.height,
    guides: [
      { x1: topPoint.x, y1: topPoint.y, x2: bottomCenterPoint.x, y2: bottomCenterPoint.y },
      ...footprintGuides,
    ],
    handles: [
      { key: "near-left", className: "corner", kind: "scale" as const, x: bottom.nearLeft.x, y: bottom.nearLeft.y, title: "Even" },
      { key: "near-right", className: "corner", kind: "scale" as const, x: bottom.nearRight.x, y: bottom.nearRight.y, title: "Even" },
      { key: "far-right", className: "corner", kind: "scale" as const, x: bottom.farRight.x, y: bottom.farRight.y, title: "Even" },
      { key: "far-left", className: "corner", kind: "scale" as const, x: bottom.farLeft.x, y: bottom.farLeft.y, title: "Even" },
      { key: "near-mid", className: "edge dark", kind: "scale" as const, x: mid.near.x, y: mid.near.y, title: "Stretch" },
      { key: "right-mid", className: "edge dark", kind: "scale" as const, x: mid.right.x, y: mid.right.y, title: "Stretch" },
      { key: "far-mid", className: "edge dark", kind: "scale" as const, x: mid.far.x, y: mid.far.y, title: "Stretch" },
      { key: "left-mid", className: "edge dark", kind: "scale" as const, x: mid.left.x, y: mid.left.y, title: "Stretch" },
      { key: heightHandleKey, className: "height-top", kind: "height" as const, x: heightPoint.x, y: heightPoint.y, title: "Height" },
      { key: liftHandleKey, className: showLowerHandles ? "height-lift lower" : "height-lift", kind: "lift" as const, x: liftPoint.x, y: liftPoint.y, title: "Lift (double-click to drop to workplane)" },
    ],
    rotateHandles,
    dimensions: dimensionMarks,
    rotationWheel: rotationWheels.y,
    rotationWheels,
    rotationPlaneCenters,
    rotationPlanes,
  };

  updateTransformOverlayIfChanged(overlayRef, setOverlay, next);
}

export function syncAlignOverlay(
  state: ThreeState,
  shapes: WorkplaneShape[],
  selectedIds: string[],
  alignMode: boolean,
  alignAnchorId: string | null,
  statuses: AlignHandleStatus[],
  overlayRef: MutableRefObject<AlignOverlayState | null>,
  setOverlay: Dispatch<SetStateAction<AlignOverlayState | null>>,
) {
  const clear = () => {
    if (overlayRef.current) {
      overlayRef.current = null;
      setOverlay(null);
    }
  };

  if (!alignMode || selectedIds.length < 2) {
    clear();
    return;
  }

  const selectedFrame = selectionFrameForShapes(shapes, selectedIds);
  const anchorFrame = alignAnchorId && selectedIds.includes(alignAnchorId) ? selectionFrameForShapes(shapes, [alignAnchorId]) : null;
  const frame = anchorFrame ?? selectedFrame;
  if (!frame) {
    clear();
    return;
  }

  const rect = state.renderer.domElement.getBoundingClientRect();
  state.camera.updateMatrixWorld();
  const corners = selectionFrameCorners(frame);
  const projectedCorners = corners.map((corner) => {
    const cameraSpace = corner.clone().applyMatrix4(state.camera.matrixWorldInverse);
    const projected = corner.clone().project(state.camera);
    return { cameraSpace, projected };
  });
  const nearPlane = state.camera instanceof THREE.PerspectiveCamera ? state.camera.near : 0.1;
  if (projectedCorners.some(({ cameraSpace, projected }) => cameraSpace.z > -nearPlane * 1.5 || !Number.isFinite(projected.x) || !Number.isFinite(projected.y))) {
    clear();
    return;
  }

  const project = (point: THREE.Vector3) => {
    const projected = point.clone().project(state.camera);
    return {
      x: ((projected.x + 1) / 2) * rect.width,
      y: ((1 - projected.y) / 2) * rect.height,
    };
  };
  const worldMinY = Math.min(...corners.map((corner) => corner.y));
  const worldMaxY = Math.max(...corners.map((corner) => corner.y));
  const worldMinX = Math.min(...corners.map((corner) => corner.x));
  const worldMaxX = Math.max(...corners.map((corner) => corner.x));
  const worldMinZ = Math.min(...corners.map((corner) => corner.z));
  const worldMaxZ = Math.max(...corners.map((corner) => corner.z));
  const worldCenterX = (worldMinX + worldMaxX) / 2;
  const worldCenterY = (worldMinY + worldMaxY) / 2;
  const worldCenterZ = (worldMinZ + worldMaxZ) / 2;
  const offset = Math.max(8, Math.max(worldMaxX - worldMinX, worldMaxY - worldMinY, worldMaxZ - worldMinZ) * 0.16);
  const statusByKey = new Map(statuses.map((status) => [`${status.axis}:${status.target}`, status]));

  const guidePoints = {
    x0: project(new THREE.Vector3(worldMinX, worldMinY, worldMaxZ + offset)),
    x1: project(new THREE.Vector3(worldMaxX, worldMinY, worldMaxZ + offset)),
    z0: project(new THREE.Vector3(worldMaxX + offset, worldMinY, worldMinZ)),
    z1: project(new THREE.Vector3(worldMaxX + offset, worldMinY, worldMaxZ)),
    y0: project(new THREE.Vector3(worldMinX - offset, worldMinY, worldMaxZ + offset)),
    y1: project(new THREE.Vector3(worldMinX - offset, worldMaxY, worldMaxZ + offset)),
  };

  const makeHandle = (axis: AlignAxis, target: AlignTarget, point: THREE.Vector3) => {
    const status = statusByKey.get(`${axis}:${target}`);
    if (!status) {
      return null;
    }
    const screen = project(point);
    return {
      ...status,
      key: `${axis}-${target}`,
      x: screen.x,
      y: screen.y,
    };
  };

  const handles = [
    makeHandle("x", "min", new THREE.Vector3(worldMinX, worldMinY, worldMaxZ + offset)),
    makeHandle("x", "center", new THREE.Vector3(worldCenterX, worldMinY, worldMaxZ + offset)),
    makeHandle("x", "max", new THREE.Vector3(worldMaxX, worldMinY, worldMaxZ + offset)),
    makeHandle("z", "min", new THREE.Vector3(worldMaxX + offset, worldMinY, worldMinZ)),
    makeHandle("z", "center", new THREE.Vector3(worldMaxX + offset, worldMinY, worldCenterZ)),
    makeHandle("z", "max", new THREE.Vector3(worldMaxX + offset, worldMinY, worldMaxZ)),
    makeHandle("y", "min", new THREE.Vector3(worldMinX - offset, worldMinY, worldMaxZ + offset)),
    makeHandle("y", "center", new THREE.Vector3(worldMinX - offset, worldCenterY, worldMaxZ + offset)),
    makeHandle("y", "max", new THREE.Vector3(worldMinX - offset, worldMaxY, worldMaxZ + offset)),
  ].filter((handle): handle is AlignOverlayState["handles"][number] => Boolean(handle));

  const next = {
    guides: [
      { key: "x", x1: guidePoints.x0.x, y1: guidePoints.x0.y, x2: guidePoints.x1.x, y2: guidePoints.x1.y },
      { key: "z", x1: guidePoints.z0.x, y1: guidePoints.z0.y, x2: guidePoints.z1.x, y2: guidePoints.z1.y },
      { key: "y", x1: guidePoints.y0.x, y1: guidePoints.y0.y, x2: guidePoints.y1.x, y2: guidePoints.y1.y },
    ],
    handles,
  };

  overlayRef.current = next;
  setOverlay(next);
}

export function syncCircularPatternOverlay(
  state: ThreeState,
  active: boolean,
  center: { x: number; z: number } | null | undefined,
  radius: number,
  overlayRef: MutableRefObject<CircularPatternOverlayState | null>,
  setOverlay: Dispatch<SetStateAction<CircularPatternOverlayState | null>>,
) {
  const clear = () => {
    if (overlayRef.current) {
      overlayRef.current = null;
      setOverlay(null);
    }
  };

  if (!active || !center) {
    clear();
    return;
  }

  const centerPoint = new THREE.Vector3(center.x, 0.05, center.z);
  const rimPoint = new THREE.Vector3(center.x + Math.max(radius, 0.01), 0.05, center.z);
  const screenCenter = projectToScreen(centerPoint, state);
  const screenRim = projectToScreen(rimPoint, state);
  if (![screenCenter.x, screenCenter.y, screenRim.x, screenRim.y].every(Number.isFinite)) {
    clear();
    return;
  }

  const next: CircularPatternOverlayState = {
    cx: screenCenter.x,
    cy: screenCenter.y,
    radiusPx: Math.hypot(screenRim.x - screenCenter.x, screenRim.y - screenCenter.y),
  };
  const previous = overlayRef.current;
  if (
    previous
    && Math.abs(previous.cx - next.cx) < 0.5
    && Math.abs(previous.cy - next.cy) < 0.5
    && Math.abs(previous.radiusPx - next.radiusPx) < 0.5
  ) {
    return;
  }
  overlayRef.current = next;
  setOverlay(next);
}

export function syncMirrorOverlay(
  state: ThreeState,
  shapes: WorkplaneShape[],
  selectedIds: string[],
  mirrorMode: boolean,
  overlayRef: MutableRefObject<MirrorOverlayState | null>,
  setOverlay: Dispatch<SetStateAction<MirrorOverlayState | null>>,
) {
  const clear = () => {
    if (overlayRef.current) {
      overlayRef.current = null;
      setOverlay(null);
    }
  };

  if (!mirrorMode || selectedIds.length < 1) {
    clear();
    return;
  }

  const frame = selectionFrameForShapes(shapes, selectedIds);
  if (!frame) {
    clear();
    return;
  }

  const rect = state.renderer.domElement.getBoundingClientRect();
  state.camera.updateMatrixWorld();
  const corners = selectionFrameCorners(frame);
  const projectedCorners = corners.map((corner) => {
    const cameraSpace = corner.clone().applyMatrix4(state.camera.matrixWorldInverse);
    const projected = corner.clone().project(state.camera);
    return { cameraSpace, projected };
  });
  const nearPlane = state.camera instanceof THREE.PerspectiveCamera ? state.camera.near : 0.1;
  if (projectedCorners.some(({ cameraSpace, projected }) => cameraSpace.z > -nearPlane * 1.5 || !Number.isFinite(projected.x) || !Number.isFinite(projected.y))) {
    clear();
    return;
  }

  const project = (point: THREE.Vector3) => {
    const projected = point.clone().project(state.camera);
    return {
      x: ((projected.x + 1) / 2) * rect.width,
      y: ((1 - projected.y) / 2) * rect.height,
    };
  };
  const screenAngle = (from: THREE.Vector3, to: THREE.Vector3) => {
    const a = project(from);
    const b = project(to);
    return THREE.MathUtils.radToDeg(Math.atan2(b.y - a.y, b.x - a.x));
  };
  const worldMinY = Math.min(...corners.map((corner) => corner.y));
  const worldMaxY = Math.max(...corners.map((corner) => corner.y));
  const worldMinX = Math.min(...corners.map((corner) => corner.x));
  const worldMaxX = Math.max(...corners.map((corner) => corner.x));
  const worldMinZ = Math.min(...corners.map((corner) => corner.z));
  const worldMaxZ = Math.max(...corners.map((corner) => corner.z));
  const worldCenterX = (worldMinX + worldMaxX) / 2;
  const worldCenterY = (worldMinY + worldMaxY) / 2;
  const worldCenterZ = (worldMinZ + worldMaxZ) / 2;
  const width = Math.max(MIN_SHAPE_SIZE, worldMaxX - worldMinX);
  const height = Math.max(MIN_SHAPE_SIZE, worldMaxY - worldMinY);
  const depth = Math.max(MIN_SHAPE_SIZE, worldMaxZ - worldMinZ);
  const offset = Math.max(10, Math.max(width, height, depth) * 0.2);
  const step = Math.max(10, Math.max(width, height, depth) * 0.28);

  const xWorld = new THREE.Vector3(worldCenterX, worldMinY, worldMaxZ + offset);
  const zWorld = new THREE.Vector3(worldMaxX + offset, worldMinY, worldCenterZ);
  const yWorld = new THREE.Vector3(worldMinX - offset, worldCenterY, worldMaxZ + offset);
  const xScreen = project(xWorld);
  const zScreen = project(zWorld);
  const yScreen = project(yWorld);
  const xGuideA = new THREE.Vector3(worldMinX, worldMinY, worldMaxZ + offset);
  const xGuideB = new THREE.Vector3(worldMaxX, worldMinY, worldMaxZ + offset);
  const zGuideA = new THREE.Vector3(worldMaxX + offset, worldMinY, worldMinZ);
  const zGuideB = new THREE.Vector3(worldMaxX + offset, worldMinY, worldMaxZ);
  const yGuideA = new THREE.Vector3(worldMinX - offset, worldMinY, worldMaxZ + offset);
  const yGuideB = new THREE.Vector3(worldMinX - offset, worldMaxY, worldMaxZ + offset);
  const xA = project(xGuideA);
  const xB = project(xGuideB);
  const zA = project(zGuideA);
  const zB = project(zGuideB);
  const yA = project(yGuideA);
  const yB = project(yGuideB);

  const next = {
    guides: [
      { key: "x", x1: xA.x, y1: xA.y, x2: xB.x, y2: xB.y },
      { key: "z", x1: zA.x, y1: zA.y, x2: zB.x, y2: zB.y },
      { key: "y", x1: yA.x, y1: yA.y, x2: yB.x, y2: yB.y },
    ],
    handles: [
      {
        axis: "x" as const,
        key: "mirror-x",
        x: xScreen.x,
        y: xScreen.y,
        angle: screenAngle(xWorld.clone().add(new THREE.Vector3(-step, 0, 0)), xWorld.clone().add(new THREE.Vector3(step, 0, 0))),
        title: "Mirror left-right",
      },
      {
        axis: "z" as const,
        key: "mirror-z",
        x: zScreen.x,
        y: zScreen.y,
        angle: screenAngle(zWorld.clone().add(new THREE.Vector3(0, 0, -step)), zWorld.clone().add(new THREE.Vector3(0, 0, step))),
        title: "Mirror front-back",
      },
      {
        axis: "y" as const,
        key: "mirror-y",
        x: yScreen.x,
        y: yScreen.y,
        angle: screenAngle(yWorld.clone().add(new THREE.Vector3(0, -step, 0)), yWorld.clone().add(new THREE.Vector3(0, step, 0))),
        title: "Mirror top-bottom",
      },
    ],
  };

  overlayRef.current = next;
  setOverlay(next);
}
