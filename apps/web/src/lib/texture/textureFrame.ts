import * as THREE from "three";
import { shapeYawDegrees } from "@/lib/shapeBounds";
import { mirrorSign, shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";
import type { SurfaceTextureFacePick } from "./surfaceTexture";

type Vec = [number, number, number];

/**
 * The texture is built in the part's posed frame: the world's directions, with
 * the origin at the part's centre (x, elevation + height / 2, z). A clicked face
 * is kept in the part's own frame instead, as shares of its size, so it stays on
 * the same face when the part is moved, turned, mirrored or resized.
 */
export function partOrigin(shape: WorkplaneShape): Vec {
  return [shape.x, (shape.elevation ?? 0) + shape.height / 2, shape.z];
}

function turn(shape: WorkplaneShape) {
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(shape.rotationX ?? 0),
    THREE.MathUtils.degToRad(shapeYawDegrees(shape)),
    THREE.MathUtils.degToRad(shape.rotationZ ?? 0),
    "XYZ",
  ));
}

const mirror = (shape: WorkplaneShape) => new THREE.Vector3(mirrorSign(shape.mirrorX), mirrorSign(shape.mirrorY), mirrorSign(shape.mirrorZ));
const size = (shape: WorkplaneShape) => new THREE.Vector3(
  Math.max(shapeWidth(shape), 1e-6),
  Math.max(shape.height, 1e-6),
  Math.max(shapeDepth(shape), 1e-6),
);

/** A click on the part in world space, as a face pick in the part's own frame. */
export function facePickFromWorld(shape: WorkplaneShape, point: Vec, normal: Vec): SurfaceTextureFacePick {
  const back = turn(shape).invert();
  const [ox, oy, oz] = partOrigin(shape);
  const m = mirror(shape);
  const local = new THREE.Vector3(point[0] - ox, point[1] - oy, point[2] - oz).applyMatrix4(back).multiply(m).divide(size(shape));
  const facing = new THREE.Vector3(...normal).transformDirection(back).multiply(m).normalize();
  return { point: [local.x, local.y, local.z], normal: [facing.x, facing.y, facing.z] };
}

/** A face pick in the posed frame the texture is built in. */
export function facePickToPosed(shape: WorkplaneShape, pick: SurfaceTextureFacePick): { point: Vec; normal: Vec } {
  const forward = turn(shape);
  const m = mirror(shape);
  const point = new THREE.Vector3(...pick.point).multiply(size(shape)).multiply(m).applyMatrix4(forward);
  const facing = new THREE.Vector3(...pick.normal).multiply(m).transformDirection(forward);
  return { point: [point.x, point.y, point.z], normal: [facing.x, facing.y, facing.z] };
}
