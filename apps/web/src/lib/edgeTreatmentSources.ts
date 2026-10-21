import { rebuildSketchHoleCutterIfPossible, restoreGroupedChildren } from "@/lib/editorBoolean";
import {
  containsHelicalThreadSolid,
  isHelicalThreadSolid,
  threadlessEdgeTreatmentStandIn,
} from "@/lib/threadShape";
import { shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

/** A rectangular solid can be cut and filleted exactly, even if a display mesh is cached on it. */
export function shapeCanBeAnalyticBox(shape: WorkplaneShape) {
  if (shape.kind !== "box" || shape.groupedShapes?.length) return false;
  return [shapeWidth(shape), shapeDepth(shape), shape.height].every((value) => Number.isFinite(value) && value > 0);
}

/** A round cylinder can be filleted exactly. An oval is a mesh. */
export function shapeCanBeAnalyticCylinder(shape: WorkplaneShape) {
  if (shape.kind !== "cylinder" || shape.groupedShapes?.length || shape.cadBrep) return false;
  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  if (![width, depth, shape.height].every((value) => Number.isFinite(value) && value > 0)) return false;
  return Math.abs(width - depth) < 1e-4;
}

function flattenEdgeTreatmentPart(
  shape: WorkplaneShape,
  forceHole = false,
  ignoreThreads = false,
): WorkplaneShape[] {
  const hole = Boolean(shape.hole || forceHole);
  const marked = hole ? { ...shape, hole: true as const } : shape;
  const prepared = marked.hole ? rebuildSketchHoleCutterIfPossible(marked) : marked;
  if (ignoreThreads && isHelicalThreadSolid(prepared)) return [];
  // A display mesh is a cache of this recipe. Rebuild from the boxes and cylinders
  // so a slotted plate is an exact solid instead of an open triangle soup.
  // Threaded groups keep a helix B-Rep; open them anyway so fillet can skip the cutter.
  const openGroup = Boolean(
    prepared.groupedShapes?.length
    && (!prepared.cadBrep || (ignoreThreads && containsHelicalThreadSolid(prepared))),
  );
  if (openGroup) {
    const children = restoreGroupedChildren(prepared).flatMap((child) => (
      flattenEdgeTreatmentPart(child, hole, ignoreThreads)
    ));
    if (children.length > 0) return children;
    if (ignoreThreads && containsHelicalThreadSolid(prepared)) return [];
  }
  return [prepared];
}

export type EdgeTreatmentSourceOptions = {
  keepResultMesh?: boolean;
  /** Omit helix cutters/screws so fillet and chamfer run on the host solid. */
  ignoreThreads?: boolean;
};

/**
 * Parts the fillet/chamfer tool should rebuild.
 * Nested groups are opened so each slot cutter stays its own solid.
 * A body that already has a fillet keeps its result mesh.
 * Pass ignoreThreads for fillet/chamfer so tapped holes do not send a helix to OCCT.
 */
export function edgeTreatmentSourceParts(shape: WorkplaneShape, options?: EdgeTreatmentSourceOptions): WorkplaneShape[] {
  const ignoreThreads = Boolean(options?.ignoreThreads);
  if (options?.keepResultMesh) {
    if (ignoreThreads && containsHelicalThreadSolid(shape) && !shape.cadBrep) {
      const parts = flattenEdgeTreatmentPart(shape, false, true);
      if (parts.length > 0) return parts;
    }
    if (ignoreThreads && isHelicalThreadSolid(shape) && !shape.groupedShapes?.length) {
      return [threadlessEdgeTreatmentStandIn(shape)];
    }
    return [shape];
  }
  if (!shape.groupedShapes?.length) {
    if (ignoreThreads && isHelicalThreadSolid(shape)) {
      return [threadlessEdgeTreatmentStandIn(shape)];
    }
    return [shape];
  }
  const parts = flattenEdgeTreatmentPart(shape, false, ignoreThreads);
  return parts.length > 0 ? parts : [shape];
}
