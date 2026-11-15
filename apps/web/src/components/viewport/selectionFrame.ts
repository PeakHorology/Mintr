import * as THREE from "three";
import { gearPatchForFootprint } from "@/lib/gearProfile";
import type { ShapeInspectorUpdateOptions } from "@/components/workplane/ShapeInspector";
import { shapeYawDegrees } from "@/lib/shapeBounds";
import { drawnAssemblyHalfExtents } from "@/lib/editorGroup";
import { hasUsableCsgResultMesh, viewportGroupChildren } from "@/lib/csgTree";
import {
  cleanNearZero,
  conePatchForFootprint,
  proportionalResizeScale,
  resizedShapeSize,
  roofPatchForFootprint,
  shapeDepth,
  shapeWidth,
} from "@/lib/workplaneShapes";
import {
  clamp,
  projectedScreenY,
  projectedScreenYPerWorldUnit,
  quaternionForShape,
  resolveRotationAxis,
  snapDimension,
} from "@/lib/viewportInteractionMath";
import type { DimensionMark, RotationAxis } from "@/components/workplane/TransformOverlay";
import type { WorkplaneShape } from "@/types/sketchforge";
import { MAX_ELEVATION, MIN_ELEVATION, MIN_SHAPE_SIZE } from "@/components/viewport/viewportConstants";
import type {
  ResizeAnchorMemory,
  ResizeSigns,
  RotationHandleSide,
  RotationHandleSides,
  SelectionFrame,
  ThreeState,
  TransformDragState,
} from "@/components/viewport/viewportTypes";

export function shapeCenter(shape: WorkplaneShape) {
  return new THREE.Vector3(shape.x, (shape.elevation ?? 0) + shape.height / 2, shape.z);
}

export function shapeLocalExtents(shape: WorkplaneShape) {
  const children = viewportGroupChildren(shape);
  if (shape.groupedShapes?.some((child) => child.hole) && children.length > 0 && !hasUsableCsgResultMesh(shape)) {
    const extents = drawnAssemblyHalfExtents(shape, children);
    return {
      x: Math.max(MIN_SHAPE_SIZE / 2, extents.x),
      y: Math.max(MIN_SHAPE_SIZE / 2, extents.y),
      z: Math.max(MIN_SHAPE_SIZE / 2, extents.z),
    };
  }
  return {
    x: shapeWidth(shape) / 2,
    y: shape.height / 2,
    z: shapeDepth(shape) / 2,
  };
}

export function selectionFrameForShapes(shapes: WorkplaneShape[], selectedIds: string[]): SelectionFrame | null {
  const selected = selectedIds.map((id) => shapes.find((shape) => shape.id === id)).filter((shape): shape is WorkplaneShape => Boolean(shape && !shape.hidden));
  if (selected.length === 0) {
    return null;
  }

  const singleShape = selected.length === 1 ? selected[0] : null;
  const quaternion = singleShape
    ? new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(singleShape.rotationX ?? 0),
      THREE.MathUtils.degToRad(shapeYawDegrees(singleShape)),
      THREE.MathUtils.degToRad(singleShape.rotationZ ?? 0),
      "XYZ",
    ))
    : new THREE.Quaternion();
  const inverse = quaternion.clone().invert();
  const localMin = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const localMax = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  const origin = singleShape ? shapeCenter(singleShape) : new THREE.Vector3();

  if (!singleShape) {
    selected.forEach((shape) => origin.add(shapeCenter(shape)));
    origin.multiplyScalar(1 / selected.length);
  }

  selected.forEach((shape) => {
    const center = shapeCenter(shape);
    const extents = shapeLocalExtents(shape);
    const shapeQuaternion = quaternionForShape(shape);
    [-1, 1].forEach((xSign) => {
      [-1, 1].forEach((ySign) => {
        [-1, 1].forEach((zSign) => {
          const point = new THREE.Vector3(xSign * extents.x, ySign * extents.y, zSign * extents.z).applyQuaternion(shapeQuaternion).add(center);
          const local = point.sub(origin).applyQuaternion(inverse);
          localMin.min(local);
          localMax.max(local);
        });
      });
    });
  });

  const localCenter = localMin.clone().add(localMax).multiplyScalar(0.5);
  const center = origin.clone().add(localCenter.clone().applyQuaternion(quaternion));
  const width = Math.max(MIN_SHAPE_SIZE, localMax.x - localMin.x);
  const height = Math.max(MIN_SHAPE_SIZE, localMax.y - localMin.y);
  const depth = Math.max(MIN_SHAPE_SIZE, localMax.z - localMin.z);
  const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion).normalize();
  const yAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize();
  const zAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion).normalize();

  return {
    ids: selected.map((shape) => shape.id),
    center,
    quaternion,
    xAxis,
    yAxis,
    zAxis,
    width,
    height,
    depth,
    min: new THREE.Vector3(-width / 2, -height / 2, -depth / 2),
    max: new THREE.Vector3(width / 2, height / 2, depth / 2),
    singleShape,
  };
}

export function framePoint(frame: SelectionFrame, x: number, y: number, z: number) {
  return frame.center
    .clone()
    .add(frame.xAxis.clone().multiplyScalar(x))
    .add(frame.yAxis.clone().multiplyScalar(y))
    .add(frame.zAxis.clone().multiplyScalar(z));
}

export function frameLocalPoint(frame: SelectionFrame, point: THREE.Vector3) {
  const offset = point.clone().sub(frame.center);
  return new THREE.Vector3(offset.dot(frame.xAxis), offset.dot(frame.yAxis), offset.dot(frame.zAxis));
}

export function frameLocalDelta(frame: SelectionFrame, start: THREE.Vector3, current: THREE.Vector3) {
  const offset = current.clone().sub(start);
  return new THREE.Vector3(offset.dot(frame.xAxis), offset.dot(frame.yAxis), offset.dot(frame.zAxis));
}

export function selectionFrameCorners(frame: SelectionFrame) {
  const corners: THREE.Vector3[] = [];
  [-1, 1].forEach((xSign) => {
    [-1, 1].forEach((ySign) => {
      [-1, 1].forEach((zSign) => {
        corners.push(framePoint(frame, (xSign * frame.width) / 2, (ySign * frame.height) / 2, (zSign * frame.depth) / 2));
      });
    });
  });
  return corners;
}

export function selectionWorldYBounds(frame: SelectionFrame) {
  const corners = selectionFrameCorners(frame);
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < corners.length; index += 1) {
    const y = corners[index].y;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const cleanedMin = cleanNearZero(min);
  const cleanedMax = cleanNearZero(max);
  return { min: cleanedMin, max: cleanedMax, height: Math.max(MIN_SHAPE_SIZE, cleanedMax - cleanedMin) };
}

export function localResizePlaneForFrame(frame: SelectionFrame) {
  return new THREE.Plane().setFromNormalAndCoplanarPoint(
    frame.yAxis.clone().normalize(),
    framePoint(frame, 0, frame.min.y, 0),
  );
}

export function resizeSignsForHandle(handleKey: string): ResizeSigns {
  const key = handleKey.toLowerCase();
  return {
    x: key.includes("right") ? 1 : key.includes("left") ? -1 : 0,
    z: key.includes("near") ? 1 : key.includes("far") ? -1 : 0,
  };
}

export function resizeAnchorPointForFrame(frame: SelectionFrame, signs: ResizeSigns) {
  return framePoint(
    frame,
    signs.x ? (-signs.x * frame.width) / 2 : 0,
    frame.min.y,
    signs.z ? (-signs.z * frame.depth) / 2 : 0,
  );
}

export function resizeCenterFromAnchor(frame: SelectionFrame, anchor: THREE.Vector3, signs: ResizeSigns, width: number, depth: number) {
  return anchor
    .clone()
    .add(frame.yAxis.clone().multiplyScalar(frame.height / 2))
    .add(frame.xAxis.clone().multiplyScalar(signs.x ? (signs.x * width) / 2 : 0))
    .add(frame.zAxis.clone().multiplyScalar(signs.z ? (signs.z * depth) / 2 : 0));
}

export function resizedShapePatchFromFrame(shape: WorkplaneShape, center: THREE.Vector3, width: number, depth: number): Partial<WorkplaneShape> {
  const patch: Partial<WorkplaneShape> = {
    x: cleanNearZero(center.x, 0.0005),
    z: cleanNearZero(center.z, 0.0005),
    elevation: cleanNearZero(center.y - shape.height / 2, 0.0005),
    width,
    depth,
    size: resizedShapeSize(width, depth),
  };
  if (shape.kind === "cone") {
    Object.assign(patch, conePatchForFootprint(shape, width, depth));
  }
  if (shape.kind === "gear") {
    Object.assign(patch, gearPatchForFootprint(shape, width, depth));
  }
  return patch;
}

export function shapeScreenBounds(state: ThreeState, shape: WorkplaneShape) {
  const frame = selectionFrameForShapes([shape], [shape.id]);
  if (!frame) {
    return null;
  }
  const rect = state.renderer.domElement.getBoundingClientRect();
  state.camera.updateMatrixWorld();
  const corners = selectionFrameCorners(frame);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let visibleCorners = 0;
  for (let index = 0; index < corners.length; index += 1) {
    // Corners behind the camera project to mirrored, meaningless positions; a
    // marquee drawn while orbiting inside a scene used to select bodies
    // behind the viewer. Only corners in front of the camera count.
    const projected = corners[index].clone().project(state.camera);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z > 1) continue;
    visibleCorners += 1;
    const x = ((projected.x + 1) / 2) * rect.width;
    const y = ((1 - projected.y) / 2) * rect.height;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (visibleCorners === 0) return null;
  return { minX, maxX, minY, maxY };
}

export function boundsIntersectRect(bounds: NonNullable<ReturnType<typeof shapeScreenBounds>>, rect: { left: number; top: number; right: number; bottom: number }) {
  return bounds.maxX >= rect.left && bounds.minX <= rect.right && bounds.maxY >= rect.top && bounds.minY <= rect.bottom;
}

export function rotationAxisVectorForFrame(handleKey: string, frame: SelectionFrame, resolvedAxis?: RotationAxis) {
  const axis = resolvedAxis ?? resolveRotationAxis(handleKey, null, frame);
  if (axis === "x") {
    return frame.xAxis.clone().normalize();
  }
  if (axis === "z") {
    return frame.zAxis.clone().normalize();
  }
  return frame.yAxis.clone().normalize();
}

export function rayPointOnRotationPlane(state: ThreeState, clientX: number, clientY: number, pivot: THREE.Vector3, axis: THREE.Vector3) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  state.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  state.raycaster.setFromCamera(state.pointer, state.camera);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis.clone().normalize(), pivot);
  return state.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}

export function signedAngleAroundAxis(start: THREE.Vector3, current: THREE.Vector3, axis: THREE.Vector3) {
  const a = start.clone().normalize();
  const b = current.clone().normalize();
  return Math.atan2(axis.clone().normalize().dot(a.clone().cross(b)), clamp(a.dot(b), -1, 1));
}

export const ROTATION_HANDLE_SIDE_HYSTERESIS = 0.22;
export const ROTATION_HANDLE_DOMINANCE_HYSTERESIS = 0.18;
/** Rotate-cw art ends toward top-right; offset so the tip tracks the motion tangent. */
export const ROTATION_HANDLE_ICON_ART_OFFSET = -40;
export const ROTATION_FACE_SCREEN_OFFSET = 24;
export const ROTATION_TILT_ABOVE_LIFT_OFFSET = 42;

/** Motion tangent around `axis` at `handleWorld`, for aligning curved rotate icons. */
export function rotationHandleTangent(axis: THREE.Vector3, pivot: THREE.Vector3, handleWorld: THREE.Vector3, fallback: THREE.Vector3) {
  const axisN = axis.clone().normalize();
  const fromPivot = handleWorld.clone().sub(pivot);
  fromPivot.addScaledVector(axisN, -fromPivot.dot(axisN));
  if (fromPivot.lengthSq() < 0.0001) {
    const fallbackDir = fallback.clone();
    if (fallbackDir.lengthSq() < 0.0001) {
      return new THREE.Vector3(1, 0, 0);
    }
    return fallbackDir.normalize();
  }
  const tangent = axisN.cross(fromPivot);
  if (tangent.lengthSq() < 0.0001) {
    return fallback.clone().normalize();
  }
  return tangent.normalize();
}

/** Keep wheel centers on the camera-facing side and slightly in front of the mesh. */
export function wheelCenterTowardCamera(camera: THREE.Camera, pivot: THREE.Vector3, face: THREE.Vector3, nudge: number) {
  const toCamera = camera.position.clone().sub(pivot);
  if (toCamera.lengthSq() < 0.0001) {
    return face.clone();
  }
  toCamera.normalize();
  const offset = face.clone().sub(pivot);
  const nearFace = offset.dot(toCamera) < -0.05 ? pivot.clone().sub(offset) : face.clone();
  return nearFace.add(toCamera.multiplyScalar(nudge));
}

export function rotationHandleIconAngle(
  project: (point: THREE.Vector3) => { x: number; y: number },
  origin: THREE.Vector3,
  tangent: THREE.Vector3,
  /** Extra degrees so glyph art lines up with the motion tangent (tilt cw tip vs yaw left/right arc). */
  artOffset = ROTATION_HANDLE_ICON_ART_OFFSET,
) {
  const step = 8;
  const direction = tangent.clone();
  if (direction.lengthSq() < 0.0001) {
    return artOffset;
  }
  direction.normalize().multiplyScalar(step);
  const a = project(origin);
  const b = project(origin.clone().add(direction));
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + artOffset;
}

export function signedRotationSide(value: number, previous: RotationHandleSide | undefined, positiveSide: RotationHandleSide, negativeSide: RotationHandleSide) {
  if (previous === positiveSide && value > -ROTATION_HANDLE_SIDE_HYSTERESIS) {
    return previous;
  }
  if (previous === negativeSide && value < ROTATION_HANDLE_SIDE_HYSTERESIS) {
    return previous;
  }
  return value >= 0 ? positiveSide : negativeSide;
}

export function rotationSideScore(side: RotationHandleSide, viewX: number, viewZ: number) {
  if (side === "right") {
    return viewX;
  }
  if (side === "left") {
    return -viewX;
  }
  if (side === "near") {
    return viewZ;
  }
  return -viewZ;
}

export function dominantRotationSide(viewX: number, viewZ: number, previous: RotationHandleSide | undefined) {
  const sides: RotationHandleSide[] = ["near", "right", "far", "left"];
  const best = sides.reduce(
    (current, side) => {
      const score = rotationSideScore(side, viewX, viewZ);
      return score > current.score ? { side, score } : current;
    },
    { side: "near" as RotationHandleSide, score: Number.NEGATIVE_INFINITY },
  );

  if (previous && rotationSideScore(previous, viewX, viewZ) >= best.score - ROTATION_HANDLE_DOMINANCE_HYSTERESIS) {
    return previous;
  }
  return best.side;
}

export function rotationHandleSidesForCamera(state: ThreeState, center: THREE.Vector3) {
  const view = state.camera.position.clone().sub(center);
  view.y = 0;
  const length = view.length();
  if (length < 0.0001) {
    return state.rotationHandleSides ?? { x: "right", y: "near", z: "near" };
  }

  const viewX = view.x / length;
  const viewZ = view.z / length;
  const previous = state.rotationHandleSides ?? undefined;
  const next: RotationHandleSides = {
    x: signedRotationSide(viewX, previous?.x, "right", "left"),
    y: dominantRotationSide(viewX, viewZ, previous?.y),
    z: signedRotationSide(viewZ, previous?.z, "near", "far"),
  };
  state.rotationHandleSides = next;
  return next;
}

export function projectedWorldYForScreenY(state: ThreeState, shape: WorkplaneShape, targetScreenY: number, startWorldY: number) {
  let nextWorldY = startWorldY;
  for (let index = 0; index < 8; index += 1) {
    const currentScreenY = projectedScreenY(state, shape, nextWorldY);
    const screenSlope = projectedScreenYPerWorldUnit(state, shape, nextWorldY);
    if (Math.abs(screenSlope) < 0.01) {
      break;
    }
    nextWorldY = clamp(nextWorldY - (currentScreenY - targetScreenY) / screenSlope, MIN_ELEVATION - 80, MAX_ELEVATION + 80);
  }
  return nextWorldY;
}

export function patchWithPreservedWorldYEdge(shape: WorkplaneShape, patch: Partial<WorkplaneShape>, edge: "bottom" | "top") {
  const startFrame = selectionFrameForShapes([shape], [shape.id]);
  if (!startFrame) {
    return patch;
  }
  const startBounds = selectionWorldYBounds(startFrame);
  const draftShape = { ...shape, ...patch };
  const draftFrame = selectionFrameForShapes([draftShape], [shape.id]);
  if (!draftFrame) {
    return patch;
  }
  const draftBounds = selectionWorldYBounds(draftFrame);
  const delta = edge === "bottom" ? startBounds.min - draftBounds.min : startBounds.max - draftBounds.max;
  return {
    ...patch,
    elevation: cleanNearZero(clamp((draftShape.elevation ?? 0) + delta, MIN_ELEVATION, MAX_ELEVATION), 0.0005),
  };
}

export function patchWithPreservedWorldBottom(shape: WorkplaneShape, patch: Partial<WorkplaneShape>) {
  return patchWithPreservedWorldYEdge(shape, patch, "bottom");
}

export function resizeSignsForDimension(signs: ResizeSigns, axis: "width" | "depth") {
  return axis === "width" ? { x: signs.x, z: 0 } : { x: 0, z: signs.z };
}

export function patchWithResizeAnchor(
  shape: WorkplaneShape,
  patch: Partial<WorkplaneShape>,
  axis: ShapeInspectorUpdateOptions["resizeAxis"] | DimensionMark["axis"],
  anchor: ResizeAnchorMemory | null,
) {
  // Hole/solid/color/lock/hide toggles must not run through elevation preservation —
  // that path can nudge oriented sketch meshes and make hole mode feel broken.
  const patchKeys = Object.keys(patch);
  if (
    patchKeys.length > 0 &&
    patchKeys.every((key) => key === "hole" || key === "color" || key === "locked" || key === "hidden" || key === "name")
  ) {
    return patch;
  }

  if (axis === "height") {
    return patchWithPreservedWorldYEdge(shape, patch, anchor?.shapeId === shape.id && anchor.pressedY === "bottom" ? "top" : "bottom");
  }

  if (axis !== "width" && axis !== "depth") {
    return patchWithPreservedWorldBottom(shape, patch);
  }
  if (!anchor || anchor.shapeId !== shape.id) {
    return patchWithPreservedWorldBottom(shape, patch);
  }

  const signs = resizeSignsForDimension(anchor.signs, axis);
  if (!signs.x && !signs.z) {
    return patchWithPreservedWorldBottom(shape, patch);
  }

  const frame = selectionFrameForShapes([shape], [shape.id]);
  if (!frame) {
    return patchWithPreservedWorldBottom(shape, patch);
  }

  const width = Math.max(MIN_SHAPE_SIZE, patch.width ?? shapeWidth(shape));
  const depth = Math.max(MIN_SHAPE_SIZE, patch.depth ?? shapeDepth(shape));
  const center = resizeCenterFromAnchor(frame, resizeAnchorPointForFrame(frame, signs), signs, width, depth);
  return patchWithPreservedWorldBottom(shape, {
    ...patch,
    ...resizedShapePatchFromFrame(shape, center, width, depth),
  });
}

export function resizeShapeFromFrameHandle(
  transform: TransformDragState,
  point: THREE.Vector3,
  handleKey: string,
  _shiftKey: boolean,
  altKey: boolean,
  step: number,
): Partial<WorkplaneShape> {
  const shape = transform.startShape;
  const frame = transform.selectionFrame;
  const width = frame.width;
  const depth = frame.depth;
  const localDelta = transform.scaleStartPoint ? frameLocalDelta(frame, transform.scaleStartPoint, point) : new THREE.Vector3();

  const signs = transform.scaleSigns ?? resizeSignsForHandle(handleKey);
  const maxSize = 220;

  const axisResize = (current: number, delta: number, sign: number) => {
    if (!sign) {
      return current;
    }
    const signedDelta = sign * delta;
    if (altKey) {
      return snapDimension(current + signedDelta * 2, step, MIN_SHAPE_SIZE, maxSize);
    }
    return snapDimension(current + signedDelta, step, MIN_SHAPE_SIZE, maxSize);
  };

  let nextWidth = axisResize(width, localDelta.x, signs.x);
  let nextDepth = axisResize(depth, localDelta.z, signs.z);
  const corner = Boolean(signs.x && signs.z);

  if (corner) {
    const scale = proportionalResizeScale(width, depth, nextWidth, nextDepth);
    const limitedScale = clamp(scale, MIN_SHAPE_SIZE / Math.max(MIN_SHAPE_SIZE, Math.min(width, depth)), maxSize / Math.max(width, depth));
    nextWidth = snapDimension(width * limitedScale, step, MIN_SHAPE_SIZE, maxSize);
    nextDepth = snapDimension(depth * limitedScale, step, MIN_SHAPE_SIZE, maxSize);
  }

  const nextCenter = altKey
    ? frame.center.clone()
    : resizeCenterFromAnchor(frame, transform.scaleAnchorPoint ?? resizeAnchorPointForFrame(frame, signs), signs, nextWidth, nextDepth);
  const patch = resizedShapePatchFromFrame(shape, nextCenter, nextWidth, nextDepth);
  if (corner && shape.kind === "roof") {
    Object.assign(patch, roofPatchForFootprint(shape, nextWidth, nextDepth));
  } else if (corner) {
    const scale = nextWidth / Math.max(MIN_SHAPE_SIZE, width);
    patch.height = snapDimension(shape.height * scale, step, MIN_SHAPE_SIZE, maxSize);
  }
  return patch;
}

export function resizeSelectionFromHandle(
  transform: TransformDragState,
  point: THREE.Vector3,
  handleKey: string,
  _shiftKey: boolean,
  altKey: boolean,
  step: number,
) {
  const frame = transform.selectionFrame;
  const localDelta = transform.scaleStartPoint ? frameLocalDelta(frame, transform.scaleStartPoint, point) : new THREE.Vector3();
  const signs = transform.scaleSigns ?? resizeSignsForHandle(handleKey);
  const axisResize = (current: number, delta: number, sign: number) => {
    if (!sign) {
      return { size: current, scale: 1 };
    }
    const signedDelta = sign * delta;
    if (altKey) {
      const size = snapDimension(current + signedDelta * 2, step, MIN_SHAPE_SIZE, 260);
      return { size, scale: size / Math.max(MIN_SHAPE_SIZE, current) };
    }
    const rawSize = current + signedDelta;
    const size = snapDimension(rawSize, step, MIN_SHAPE_SIZE, 260);
    return {
      size,
      scale: size / Math.max(MIN_SHAPE_SIZE, current),
    };
  };

  let nextX = axisResize(frame.width, localDelta.x, signs.x);
  let nextZ = axisResize(frame.depth, localDelta.z, signs.z);
  const corner = Boolean(signs.x && signs.z);
  if (corner) {
    const scale = proportionalResizeScale(frame.width, frame.depth, nextX.size, nextZ.size);
    const limitedScale = clamp(scale, MIN_SHAPE_SIZE / Math.max(MIN_SHAPE_SIZE, Math.min(frame.width, frame.depth)), 260 / Math.max(frame.width, frame.depth));
    const width = snapDimension(frame.width * limitedScale, step, MIN_SHAPE_SIZE, 260);
    const depth = snapDimension(frame.depth * limitedScale, step, MIN_SHAPE_SIZE, 260);
    nextX = {
      size: width,
      scale: width / Math.max(MIN_SHAPE_SIZE, frame.width),
    };
    nextZ = {
      size: depth,
      scale: depth / Math.max(MIN_SHAPE_SIZE, frame.depth),
    };
  }

  const nextCenter = altKey
    ? frame.center.clone()
    : resizeCenterFromAnchor(frame, transform.scaleAnchorPoint ?? resizeAnchorPointForFrame(frame, signs), signs, nextX.size, nextZ.size);

  return transform.items.map((item) => {
    const localCenter = frameLocalPoint(frame, item.startCenter);
    const nextItemCenter = nextCenter
      .clone()
      .add(frame.xAxis.clone().multiplyScalar(localCenter.x * nextX.scale))
      .add(frame.yAxis.clone().multiplyScalar(localCenter.y))
      .add(frame.zAxis.clone().multiplyScalar(localCenter.z * nextZ.scale));
    const width = snapDimension(shapeWidth(item.startShape) * nextX.scale, step, MIN_SHAPE_SIZE, 260);
    const depth = snapDimension(shapeDepth(item.startShape) * nextZ.scale, step, MIN_SHAPE_SIZE, 260);
    const patch: Partial<WorkplaneShape> = {
      x: nextItemCenter.x,
      z: nextItemCenter.z,
      elevation: cleanNearZero(nextItemCenter.y - item.startShape.height / 2, 0.0005),
      width,
      depth,
      size: resizedShapeSize(width, depth),
    };
    if (corner) {
      if (item.startShape.kind === "roof") {
        Object.assign(patch, roofPatchForFootprint(item.startShape, width, depth));
      } else {
        patch.height = snapDimension(item.startShape.height * nextX.scale, step, MIN_SHAPE_SIZE, 260);
      }
    }
    return {
      id: item.id,
      patch,
    };
  });
}
