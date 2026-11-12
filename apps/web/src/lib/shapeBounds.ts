import * as THREE from "three";
import type { WorkplaneShape } from "@/types/sketchforge";
import { resolveShapeSides } from "@/lib/displayTessellation";
import { shapeDepth, shapeWidth } from "@/lib/workplaneShapes";

/**
 * World placement maths shared by the STEP writer and the export preflight.
 *
 * These live apart from `stepExport` so the inspector can reason about which cutters reach which
 * parts without pulling the OCCT kernel into the render path.
 */

const SIZE_EPS = 0.0005;

// SketchForge composes rotation as a THREE Euler in "XYZ" order, so the world
// matrix is Rx·Ry·Rz. Re-applying the same rotations about world axes through
// the origin (Z, then Y, then X) reproduces that product before the shape is
// translated off-origin. Circular cylinders/cones with enough sides ignore yaw, matching the
// editor's meshYawDegrees so the exported diameter is invariant.
export function shapeYawDegrees(shape: WorkplaneShape): number {
  // "polygon" is deliberately absent: an n-gon prism is not invariant around Y, so zeroing
  // its yaw exported a hex standoff flat-to-flat when the viewport showed it point-to-point.
  const round =
    shape.kind === "cylinder"
    || shape.kind === "cone"
    || shape.kind === "tube"
    || shape.kind === "ring"
    || shape.kind === "torus"
    || shape.kind === "halfSphere";
  const circular = Math.abs(shapeWidth(shape) - shapeDepth(shape)) < SIZE_EPS;
  return round && circular && looksRound(shape) ? 0 : shape.rotation;
}

/**
 * Below this many sides a cylinder or cone reads as a prism (Sides goes down to 3), so its
 * turn shows and must be kept. The display-quality defaults never go below 64.
 */
export const ROUND_YAW_MIN_SIDES = 48;

function looksRound(shape: WorkplaneShape) {
  if (shape.kind !== "cylinder" && shape.kind !== "cone") return true;
  const sides = resolveShapeSides(shape.kind, shape.sides);
  return sides == null || sides >= ROUND_YAW_MIN_SIDES;
}

export type AxisScale = { x: number; y: number; z: number };

/**
 * A resized group stretches its contents along the group's own axes. For a turned child that
 * stretch, seen from the child's axes, is R^T·S·R. When that is diagonal (no turn, quarter
 * turns, or an even stretch) the child stays the same kind of shape: keep its turn and scale
 * its width, height and depth by the diagonal. Otherwise the stretch would shear the child,
 * which no width/height/depth can express: null, so the caller bakes it to a mesh instead.
 *
 * `rotation` is the turn to keep: a round cylinder's ignored yaw comes back as 0, since its
 * footprint is no longer round once stretched unevenly.
 */
export function groupScaleInChildFrame(
  child: WorkplaneShape,
  scale: AxisScale,
): { scale: AxisScale; rotation: number } | null {
  const yaw = shapeYawDegrees(child);
  const tiltX = child.rotationX ?? 0;
  const tiltZ = child.rotationZ ?? 0;
  const uniform = Math.abs(scale.x - scale.y) < 1e-9 && Math.abs(scale.x - scale.z) < 1e-9;
  if (uniform || (yaw === 0 && tiltX === 0 && tiltZ === 0)) {
    return { scale: { ...scale }, rotation: yaw };
  }
  const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(tiltX),
    THREE.MathUtils.degToRad(yaw),
    THREE.MathUtils.degToRad(tiltZ),
    "XYZ",
  ));
  const local = rotation.clone().transpose()
    .multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z))
    .multiply(rotation)
    .elements; // column-major
  const largest = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z), 1e-9);
  const offDiagonal = Math.max(
    Math.abs(local[1]), Math.abs(local[2]), Math.abs(local[4]),
    Math.abs(local[6]), Math.abs(local[8]), Math.abs(local[9]),
  );
  if (offDiagonal > largest * 1e-6) return null;
  return { scale: { x: local[0], y: local[5], z: local[10] }, rotation: yaw };
}

export type Aabb = { min: [number, number, number]; max: [number, number, number] };

/**
 * Axis-aligned bounds of the width × height × depth box the viewport draws.
 * A stretched cylinder, sphere, cone, or polygon uses this same box as a rectangle,
 * including yaw once the footprint is no longer circular.
 */
export function worldAabb(shape: WorkplaneShape): Aabb {
  const hx = shapeWidth(shape) / 2;
  const hy = shape.height / 2;
  const hz = shapeDepth(shape) / 2;
  const center = new THREE.Vector3(shape.x, (shape.elevation ?? 0) + hy, shape.z);
  const yaw = shapeYawDegrees(shape);
  const tiltX = shape.rotationX ?? 0;
  const tiltZ = shape.rotationZ ?? 0;
  if (yaw === 0 && tiltX === 0 && tiltZ === 0) {
    return {
      min: [center.x - hx, center.y - hy, center.z - hz],
      max: [center.x + hx, center.y + hy, center.z + hz],
    };
  }
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(tiltX),
    THREE.MathUtils.degToRad(yaw),
    THREE.MathUtils.degToRad(tiltZ),
    "XYZ",
  ));
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const point = new THREE.Vector3(sx * hx, sy * hy, sz * hz).applyQuaternion(quaternion).add(center);
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.z < minZ) minZ = point.z;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
        if (point.z > maxZ) maxZ = point.z;
      }
    }
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function aabbsOverlap(a: Aabb, b: Aabb): boolean {
  return (
    a.min[0] <= b.max[0] &&
    a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] &&
    a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] &&
    a.max[2] >= b.min[2]
  );
}
