import * as THREE from "three";
import { roofAnglesFromProfile } from "@/lib/roofGeometry";
import { resolveSketchPlane, worldToPlaneUV } from "@/lib/sketchPlane";
import { groupedChildrenDisplayScale, mirrorSign, shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { SketchPlane, WorkplaneShape } from "@/types/sketchforge";
import type { SketchVec2 } from "./types";

const CENTER_KINDS = new Set<WorkplaneShape["kind"]>(["box", "cylinder", "roof"]);
/** A face sits on the boundary, so the center is allowed this far outside the solid. */
const FACE_EPS_MM = 0.25;

type Frame = {
  origin: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

function shapeQuaternion(shape: WorkplaneShape) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(shape.rotationX ?? 0),
    THREE.MathUtils.degToRad(shape.rotation ?? 0),
    THREE.MathUtils.degToRad(shape.rotationZ ?? 0),
    "XYZ",
  ));
}

/** Center in the shape's own frame. A cube and a cylinder use the middle. A triangle uses its centroid. */
function localCenter(shape: WorkplaneShape) {
  if (shape.kind !== "roof") return new THREE.Vector3();
  const width = shapeWidth(shape);
  const height = Math.max(0.01, shape.height);
  const { ridgeX } = roofAnglesFromProfile(width, height, shape.leftAngle, shape.rightAngle);
  return new THREE.Vector3(
    (ridgeX / 3) * mirrorSign(shape.mirrorX),
    (-height / 6) * mirrorSign(shape.mirrorY),
    0,
  );
}

function frameFor(shape: WorkplaneShape, parent: WorkplaneShape | null, parentFrame: Frame | null): Frame {
  const quaternion = shapeQuaternion(shape);
  if (!parent || !parentFrame) {
    return {
      origin: new THREE.Vector3(shape.x, (shape.elevation ?? 0) + shape.height / 2, shape.z),
      quaternion,
    };
  }
  const scale = groupedChildrenDisplayScale(parent);
  const local = new THREE.Vector3(
    shape.x * scale.x * mirrorSign(parent.mirrorX),
    (-parent.height / 2 + ((shape.elevation ?? 0) + shape.height / 2) * scale.y) * mirrorSign(parent.mirrorY),
    shape.z * scale.z * mirrorSign(parent.mirrorZ),
  );
  local.applyQuaternion(parentFrame.quaternion);
  return {
    origin: parentFrame.origin.clone().add(local),
    quaternion: parentFrame.quaternion.clone().multiply(quaternion),
  };
}

function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
) {
  const v0x = cx - ax;
  const v0y = cy - ay;
  const v1x = bx - ax;
  const v1y = by - ay;
  const v2x = px - ax;
  const v2y = py - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-8) return false;
  const u = (dot11 * dot02 - dot01 * dot12) / denom;
  const v = (dot00 * dot12 - dot01 * dot02) / denom;
  return u >= -1e-3 && v >= -1e-3 && u + v <= 1 + 1e-3;
}

function containsProjected(shape: WorkplaneShape, frame: Frame, world: THREE.Vector3) {
  const local = world.clone().sub(frame.origin).applyQuaternion(frame.quaternion.clone().invert());
  local.x *= mirrorSign(shape.mirrorX);
  local.y *= mirrorSign(shape.mirrorY);
  local.z *= mirrorSign(shape.mirrorZ);
  const hx = shapeWidth(shape) / 2;
  const hy = shape.height / 2;
  const hz = shapeDepth(shape) / 2;
  const eps = FACE_EPS_MM;
  if (shape.kind === "cylinder") {
    const nx = local.x / Math.max(hx, 1e-6);
    const nz = local.z / Math.max(hz, 1e-6);
    return nx * nx + nz * nz <= 1 + eps && Math.abs(local.y) <= hy + eps;
  }
  if (shape.kind === "roof") {
    if (Math.abs(local.z) > hz + eps) return false;
    const { ridgeX } = roofAnglesFromProfile(shapeWidth(shape), shape.height, shape.leftAngle, shape.rightAngle);
    return pointInTriangle(local.x, local.y, -hx, -hy, hx, -hy, ridgeX, hy);
  }
  return Math.abs(local.x) <= hx + eps && Math.abs(local.y) <= hy + eps && Math.abs(local.z) <= hz + eps;
}

function centerOnPlane(shape: WorkplaneShape, frame: Frame, plane: SketchPlane): SketchVec2 | null {
  const world = localCenter(shape).applyQuaternion(frame.quaternion).add(frame.origin);
  const resolved = resolveSketchPlane(plane);
  const normal = resolved.normal;
  const distance = (world.x - resolved.origin.x) * normal.x
    + (world.y - resolved.origin.y) * normal.y
    + (world.z - resolved.origin.z) * normal.z;
  const projected = world.clone().addScaledVector(new THREE.Vector3(normal.x, normal.y, normal.z), -distance);
  if (!containsProjected(shape, frame, projected)) return null;
  const uv = worldToPlaneUV(resolved, { x: projected.x, y: projected.y, z: projected.z });
  return { x: uv.u, z: uv.v };
}

function collect(
  shapes: readonly WorkplaneShape[],
  parent: WorkplaneShape | null,
  parentFrame: Frame | null,
  plane: SketchPlane,
  out: SketchVec2[],
) {
  for (const shape of shapes) {
    if (shape.hidden || shape.suppressed || shape.csg?.suppressed) continue;
    const frame = frameFor(shape, parent, parentFrame);
    if (CENTER_KINDS.has(shape.kind)) {
      const point = centerOnPlane(shape, frame, plane);
      if (point) out.push(point);
    }
    if (shape.groupedShapes?.length) collect(shape.groupedShapes, shape, frame, plane, out);
  }
}

/**
 * Sketch points that land on the center of a cube, cylinder, or triangle roof
 * when the sketch plane cuts that solid. A sketch on the side of a cylinder
 * uses the middle of that wall.
 */
export function sketchCenterSnapPoints(shapes: readonly WorkplaneShape[], plane: SketchPlane): SketchVec2[] {
  if (plane.surface?.kind === "cylinder") return [{ x: 0, z: 0 }];
  const points: SketchVec2[] = [];
  collect(shapes, null, null, plane, points);
  return points;
}
