import * as THREE from "three";
import { worldAabb } from "@/lib/shapeBounds";
import { cleanRotationDegrees, mirrorSign, shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

export const OBJECT_SNAP_DEFAULT_TOLERANCE = 1.5;

export type SnapAabb = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export type ObjectSnapKind = "face" | "edge" | "mid";

export type ObjectSnapGuide = {
  kind: ObjectSnapKind;
  axis: "x" | "z" | "xz";
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
};

export type ObjectSnapResult = {
  deltaX: number;
  deltaZ: number;
  kind: ObjectSnapKind;
  guides: ObjectSnapGuide[];
};

type AxisCandidate = {
  kind: "face" | "mid";
  axis: "x" | "z";
  delta: number;
  error: number;
  line: number;
  moving: SnapAabb;
  target: SnapAabb;
};

function clean(value: number) {
  const rounded = Number(value.toFixed(6));
  return Math.abs(rounded) < 1e-6 ? 0 : rounded;
}

export function snapAabbFromShape(shape: WorkplaneShape): SnapAabb {
  const box = worldAabb(shape);
  return {
    minX: box.min[0],
    maxX: box.max[0],
    minY: box.min[1],
    maxY: box.max[1],
    minZ: box.min[2],
    maxZ: box.max[2],
  };
}

export function unionSnapAabbs(boxes: readonly SnapAabb[]): SnapAabb | null {
  if (boxes.length === 0) return null;
  return boxes.reduce((bounds, box) => ({
    minX: Math.min(bounds.minX, box.minX),
    maxX: Math.max(bounds.maxX, box.maxX),
    minY: Math.min(bounds.minY, box.minY),
    maxY: Math.max(bounds.maxY, box.maxY),
    minZ: Math.min(bounds.minZ, box.minZ),
    maxZ: Math.max(bounds.maxZ, box.maxZ),
  }));
}

export function translateSnapAabb(box: SnapAabb, deltaX: number, deltaZ: number): SnapAabb {
  return {
    ...box,
    minX: box.minX + deltaX,
    maxX: box.maxX + deltaX,
    minZ: box.minZ + deltaZ,
    maxZ: box.maxZ + deltaZ,
  };
}

function axisPairs(moving: SnapAabb, target: SnapAabb, axis: "x" | "z"): Array<{ kind: "face" | "mid"; moving: number; target: number }> {
  const mMin = axis === "x" ? moving.minX : moving.minZ;
  const mMax = axis === "x" ? moving.maxX : moving.maxZ;
  const tMin = axis === "x" ? target.minX : target.minZ;
  const tMax = axis === "x" ? target.maxX : target.maxZ;
  return [
    { kind: "face", moving: mMax, target: tMin },
    { kind: "face", moving: mMin, target: tMax },
    { kind: "face", moving: mMin, target: tMin },
    { kind: "face", moving: mMax, target: tMax },
    { kind: "mid", moving: (mMin + mMax) / 2, target: (tMin + tMax) / 2 },
  ];
}

function pickAxisCandidate(
  moving: SnapAabb,
  targets: readonly SnapAabb[],
  axis: "x" | "z",
  proposedDelta: number,
  tolerance: number,
): AxisCandidate | null {
  let best: AxisCandidate | null = null;
  for (const target of targets) {
    for (const pair of axisPairs(moving, target, axis)) {
      const delta = pair.target - pair.moving;
      const error = Math.abs(delta - proposedDelta);
      if (error > tolerance + 1e-6) continue;
      const rank = pair.kind === "face" ? 0 : 1;
      const bestRank = best?.kind === "face" ? 0 : 1;
      if (!best || rank < bestRank || (rank === bestRank && error < best.error - 1e-9)) {
        best = {
          kind: pair.kind,
          axis,
          delta,
          error,
          line: pair.target,
          moving,
          target,
        };
      }
    }
  }
  return best;
}

function guideForCandidate(candidate: AxisCandidate, moved: SnapAabb): ObjectSnapGuide {
  const y = Math.max(moved.minY, candidate.target.minY);
  const top = Math.min(moved.maxY, candidate.target.maxY);
  const midY = (y + top) / 2;
  if (candidate.axis === "x") {
    const z0 = Math.min(moved.minZ, candidate.target.minZ);
    const z1 = Math.max(moved.maxZ, candidate.target.maxZ);
    return {
      kind: candidate.kind,
      axis: "x",
      start: { x: candidate.line, y: midY, z: z0 },
      end: { x: candidate.line, y: midY, z: z1 },
    };
  }
  const x0 = Math.min(moved.minX, candidate.target.minX);
  const x1 = Math.max(moved.maxX, candidate.target.maxX);
  return {
    kind: candidate.kind,
    axis: "z",
    start: { x: x0, y: midY, z: candidate.line },
    end: { x: x1, y: midY, z: candidate.line },
  };
}

/**
 * Snap a moving AABB against other shapes on X/Z: face-to-face, flush, or midpoint.
 * `proposedDelta` is the unconstrained drag delta from the start pose.
 */
export function snapMovingAabb(
  moving: SnapAabb,
  targets: readonly SnapAabb[],
  proposedDelta: { x: number; z: number },
  tolerance = OBJECT_SNAP_DEFAULT_TOLERANCE,
): ObjectSnapResult | null {
  if (targets.length === 0 || !(tolerance > 0)) return null;
  const xHit = pickAxisCandidate(moving, targets, "x", proposedDelta.x, tolerance);
  const zHit = pickAxisCandidate(moving, targets, "z", proposedDelta.z, tolerance);
  const xChanged = Boolean(xHit && Math.abs(xHit.delta - proposedDelta.x) > 1e-6);
  const zChanged = Boolean(zHit && Math.abs(zHit.delta - proposedDelta.z) > 1e-6);
  if (!xChanged && !zChanged) return null;

  const deltaX = clean(xHit?.delta ?? proposedDelta.x);
  const deltaZ = clean(zHit?.delta ?? proposedDelta.z);
  const moved = translateSnapAabb(moving, deltaX, deltaZ);
  const guides: ObjectSnapGuide[] = [];
  if (xHit) guides.push(guideForCandidate(xHit, moved));
  if (zHit) guides.push(guideForCandidate(zHit, moved));

  const kind: ObjectSnapKind = xHit && zHit ? "edge" : (xHit?.kind === "mid" || zHit?.kind === "mid") ? "mid" : "face";
  return { deltaX, deltaZ, kind, guides };
}

export function objectSnapTolerance(gridStep: number) {
  return Math.max(OBJECT_SNAP_DEFAULT_TOLERANCE, gridStep > 0 ? gridStep : 0);
}

export type FaceSnapSample = {
  point: [number, number, number];
  normal: [number, number, number];
};

export type FaceMatePose = {
  x: number;
  z: number;
  elevation: number;
  rotationX: number;
  rotation: number;
  rotationZ: number;
};

type FaceMateBody = Pick<WorkplaneShape, "x" | "z" | "height" | "rotation" | "width" | "depth" | "size"> & Partial<Pick<WorkplaneShape, "elevation" | "rotationX" | "rotationZ" | "mirrorX" | "mirrorY" | "mirrorZ">>;

/**
 * Turn the first shape so the chosen faces point at each other, then move it
 * until that face is centered on the second face. Where on the face you click
 * only chooses the face.
 */
export function faceToFaceMate(
  sourceShape: FaceMateBody,
  source: FaceSnapSample,
  targetShape: FaceMateBody,
  target: FaceSnapSample,
): FaceMatePose | null {
  const sourceNormal = unitVector(source.normal);
  const targetNormal = unitVector(target.normal);
  const sourceFace = sourceNormal ? faceCenter(sourceShape, sourceNormal) : null;
  const targetFace = targetNormal ? faceCenter(targetShape, targetNormal) : null;
  if (!sourceNormal || !targetNormal || !sourceFace || !targetFace) return null;
  const center = new THREE.Vector3(sourceShape.x, (sourceShape.elevation ?? 0) + sourceShape.height / 2, sourceShape.z);
  const current = shapeQuaternion(sourceShape);
  const turn = new THREE.Quaternion().setFromUnitVectors(
    sourceNormal,
    targetNormal.clone().negate(),
  );
  const next = turn.clone().multiply(current);
  const landed = sourceFace.clone().sub(center).applyQuaternion(turn).add(center);
  const shift = targetFace.clone().sub(landed);
  const euler = new THREE.Euler().setFromQuaternion(next, "XYZ");
  return {
    x: clean(sourceShape.x + shift.x),
    z: clean(sourceShape.z + shift.z),
    elevation: clean((sourceShape.elevation ?? 0) + shift.y),
    rotationX: cleanRotationDegrees(THREE.MathUtils.radToDeg(euler.x)),
    rotation: cleanRotationDegrees(THREE.MathUtils.radToDeg(euler.y)),
    rotationZ: cleanRotationDegrees(THREE.MathUtils.radToDeg(euler.z)),
  };
}

function shapeQuaternion(shape: FaceMateBody) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(shape.rotationX ?? 0),
    THREE.MathUtils.degToRad(shape.rotation),
    THREE.MathUtils.degToRad(shape.rotationZ ?? 0),
    "XYZ",
  ));
}

/** Center of the side the normal points out of, in world space. */
function faceCenter(shape: FaceMateBody, worldNormal: THREE.Vector3) {
  const rotation = shapeQuaternion(shape);
  const scale = new THREE.Vector3(mirrorSign(shape.mirrorX), mirrorSign(shape.mirrorY), mirrorSign(shape.mirrorZ));
  const localNormal = worldNormal.clone().applyQuaternion(rotation.clone().invert()).multiply(scale);
  const ax = Math.abs(localNormal.x);
  const ay = Math.abs(localNormal.y);
  const az = Math.abs(localNormal.z);
  const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  if (Math.max(ax, ay, az) < 1e-8) return null;
  const sign = Math.sign(localNormal.getComponent(axis)) || 1;
  const half = [shapeWidth(shape) / 2, shape.height / 2, shapeDepth(shape) / 2];
  const local = new THREE.Vector3();
  local.setComponent(axis, sign * half[axis]);
  const center = new THREE.Vector3(shape.x, (shape.elevation ?? 0) + shape.height / 2, shape.z);
  return local.multiply(scale).applyQuaternion(rotation).add(center);
}

const FACE_SIDE_LOCAL: Record<"top" | "bottom" | "front" | "back" | "left" | "right", [number, number, number]> = {
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  front: [0, 0, 1],
  back: [0, 0, -1],
};

/** Outward face on an axis-aligned side, in world space, including the shape's rotation. */
export function faceSampleForSide(
  shape: FaceMateBody,
  side: keyof typeof FACE_SIDE_LOCAL,
): FaceSnapSample | null {
  const rotation = shapeQuaternion(shape);
  const scale = new THREE.Vector3(mirrorSign(shape.mirrorX), mirrorSign(shape.mirrorY), mirrorSign(shape.mirrorZ));
  const worldNormal = new THREE.Vector3(...FACE_SIDE_LOCAL[side]).multiply(scale).applyQuaternion(rotation);
  if (worldNormal.lengthSq() < 1e-8) return null;
  worldNormal.normalize();
  const center = faceCenter(shape, worldNormal);
  if (!center) return null;
  return {
    point: [center.x, center.y, center.z],
    normal: [worldNormal.x, worldNormal.y, worldNormal.z],
  };
}

/** Turn the shape so this face points down, then rest that face on the workplane. */
export function layFaceOnWorkplane(shape: FaceMateBody, face: FaceSnapSample): FaceMatePose | null {
  const normal = unitVector(face.normal);
  if (!normal) return null;
  const center = new THREE.Vector3(shape.x, (shape.elevation ?? 0) + shape.height / 2, shape.z);
  const current = shapeQuaternion(shape);
  const turn = new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, -1, 0));
  const next = turn.clone().multiply(current);
  const landed = new THREE.Vector3(...face.point).sub(center).applyQuaternion(turn).add(center);
  const euler = new THREE.Euler().setFromQuaternion(next, "XYZ");
  return {
    x: shape.x,
    z: shape.z,
    elevation: clean((shape.elevation ?? 0) - landed.y),
    rotationX: cleanRotationDegrees(THREE.MathUtils.radToDeg(euler.x)),
    rotation: cleanRotationDegrees(THREE.MathUtils.radToDeg(euler.y)),
    rotationZ: cleanRotationDegrees(THREE.MathUtils.radToDeg(euler.z)),
  };
}

function unitVector(value: [number, number, number]) {
  const vector = new THREE.Vector3(...value);
  if (vector.lengthSq() < 1e-12) return null;
  return vector.normalize();
}
