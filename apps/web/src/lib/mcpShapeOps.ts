import { rewriteSketchHostIds } from "@/lib/editorBoolean";
import { isConstructionShape } from "@/lib/holeFeature";
import { MIN_SHAPE_DIMENSION } from "@/lib/modelDimension";
import { patternMemberIds } from "@/lib/patternFeature";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * What Delete does to a set of ids, the same way the Delete button does it: a pattern copy
 * takes its whole pattern with it (sync would bring a lone copy back), and locked shapes stay.
 */
export function planShapeDelete(shapes: readonly WorkplaneShape[], ids: Iterable<string>) {
  const chosen = new Set(ids);
  for (const id of [...chosen]) {
    const shape = shapes.find((entry) => entry.id === id);
    if (shape?.patternFeature) {
      patternMemberIds(shapes, shape.patternFeature.id).forEach((memberId) => chosen.add(memberId));
    }
  }
  const removedIds = shapes.filter((shape) => chosen.has(shape.id) && !shape.locked).map((shape) => shape.id);
  const lockedIds = shapes.filter((shape) => chosen.has(shape.id) && shape.locked).map((shape) => shape.id);
  const remaining = shapes.filter((shape) => !chosen.has(shape.id) || shape.locked);
  return { remaining, removedIds, lockedIds };
}

/**
 * Applies `change` to each unlocked shape in `ids`. `change` returns null when the shape is
 * already as asked, so `changedIds` lists only the shapes that really changed.
 */
export function changeUnlockedShapes(
  shapes: readonly WorkplaneShape[],
  ids: Iterable<string>,
  change: (shape: WorkplaneShape) => WorkplaneShape | null,
) {
  const chosen = new Set(ids);
  const changedIds: string[] = [];
  const next = shapes.map((shape) => {
    if (!chosen.has(shape.id) || shape.locked) return shape;
    const changed = change(shape);
    if (!changed) return shape;
    changedIds.push(shape.id);
    return changed;
  });
  return { next, changedIds };
}

/** Hide or show shapes. Hidden shapes leave the selection, as they do with the Hide button. */
export function planShapeVisibility(
  shapes: readonly WorkplaneShape[],
  ids: Iterable<string>,
  hidden: boolean,
  selectedIds: readonly string[],
) {
  const { next, changedIds } = changeUnlockedShapes(
    shapes,
    ids,
    (shape) => (Boolean(shape.hidden) === hidden ? null : { ...shape, hidden }),
  );
  const nextSelected = hidden
    ? selectedIds.filter((id) => next.find((shape) => shape.id === id)?.hidden !== true)
    : [...selectedIds];
  return { next, changedIds, nextSelected };
}

/** The shapes Group, Tie and Intersect work on: construction planes never join. */
export function groupableShapes(shapes: readonly WorkplaneShape[], ids: Iterable<string>) {
  const chosen = new Set(ids);
  return shapes.filter((shape) => chosen.has(shape.id) && !isConstructionShape(shape));
}

/**
 * Puts a finished Group into the scene: the grouped solids leave, left-out shapes stay, and
 * sketches hosted on any of the solids now point at the new group.
 */
export function placeGroupedShape(
  shapes: readonly WorkplaneShape[],
  groupable: readonly WorkplaneShape[],
  group: WorkplaneShape,
  leftOutShapes: readonly WorkplaneShape[] = [],
) {
  let linkedGroup = group;
  for (const solid of groupable.filter((shape) => !shape.hole)) {
    linkedGroup = rewriteSketchHostIds(linkedGroup, solid.id, group.id);
  }
  const leftOutIds = new Set(leftOutShapes.map((shape) => shape.id));
  const groupedIds = new Set(groupable.filter((shape) => !leftOutIds.has(shape.id)).map((shape) => shape.id));
  const next = [...shapes.filter((shape) => !groupedIds.has(shape.id)), linkedGroup];
  return { next, linkedGroup, groupedIds };
}

/** Width, depth, height and size never go below the smallest shape Mintr can draw. */
export function clampShapeSizePatch<T extends Partial<Record<"width" | "depth" | "height" | "size", number>>>(patch: T): T {
  const next = { ...patch };
  (["width", "depth", "height", "size"] as const).forEach((key) => {
    const value = next[key];
    if (typeof value === "number") (next as Record<string, number>)[key] = Math.max(MIN_SHAPE_DIMENSION, value);
  });
  return next;
}
