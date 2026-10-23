import type { WorkplaneShape } from "@/types/sketchforge";

export type PlacementBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

function clean(value: number) {
  const rounded = Number(value.toFixed(4));
  return Math.abs(rounded) < 0.0005 ? 0 : rounded;
}

/** Cosine of ~20° from world up. Steeper faces are walls, not a drop landing. */
export const DROP_FACE_UP_DOT = 0.94;

/** Height of an upward flat face, or null when the face is too steep or faces down. */
export function dropSurfaceY(
  normal: [number, number, number],
  point: [number, number, number],
): number | null {
  if (normal[1] < DROP_FACE_UP_DOT) return null;
  return point[1];
}

/**
 * Translate a shape so its mesh bottom sits on a horizontal surface.
 * `surfaceY` may be above or below the shape — Drop lifts as well as lowers.
 * Pass `shift` to slide the shape onto a clicked face without changing its heading.
 */
export function dropPatchOntoFrame(
  shape: Pick<WorkplaneShape, "x" | "z" | "elevation">,
  bounds: PlacementBounds,
  surfaceY = 0,
  shift?: { x: number; z: number },
): Partial<WorkplaneShape> {
  const patch: Partial<WorkplaneShape> = {
    elevation: clean((shape.elevation ?? 0) + (surfaceY - bounds.minY)),
  };
  if (shift) {
    patch.x = clean(shape.x + shift.x);
    patch.z = clean(shape.z + shift.z);
  }
  return patch;
}
