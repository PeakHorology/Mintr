import type { WorkplaneShape } from "@/types/sketchforge";
import { resizedShapeSize, shapeDepth, shapeWidth } from "@/lib/workplaneShapes";

const MIN_SIZE = 0.05;

/** Scale length, width, and height by the same ratio. The bottom (elevation) is left where it is. */
export function uniformScalePatch(
  shape: Pick<WorkplaneShape, "kind" | "width" | "depth" | "size" | "height" | "topRadius" | "baseRadius" | "radius" | "bevel">,
  ratio: number,
): Partial<WorkplaneShape> | null {
  if (!Number.isFinite(ratio) || ratio <= 0 || Math.abs(ratio - 1) < 1e-9) return null;
  const width = Math.max(MIN_SIZE, shapeWidth(shape) * ratio);
  const depth = Math.max(MIN_SIZE, shapeDepth(shape) * ratio);
  const height = Math.max(MIN_SIZE, shape.height * ratio);
  const patch: Partial<WorkplaneShape> = {
    width,
    depth,
    height,
    size: resizedShapeSize(width, depth),
  };
  if (typeof shape.topRadius === "number") patch.topRadius = Math.max(0, shape.topRadius * ratio);
  if (typeof shape.baseRadius === "number") patch.baseRadius = Math.max(MIN_SIZE / 2, shape.baseRadius * ratio);
  if (typeof shape.radius === "number") patch.radius = Math.max(MIN_SIZE / 2, shape.radius * ratio);
  if ((shape.kind === "tube" || shape.kind === "ring") && typeof shape.bevel === "number") {
    patch.bevel = Math.max(0.05, shape.bevel * ratio);
  }
  return patch;
}
