import { expandSketchHoleCuttersIfPossible, restoreGroupedChildren } from "@/lib/editorBoolean";
import {
  containsHelicalThreadSolid,
  isHelicalThreadSolid,
  threadlessEdgeTreatmentStandIn,
} from "@/lib/threadShape";
import { hasUsableCsgResultMesh } from "@/lib/csgTree";
import { type Aabb, worldAabb } from "@/lib/shapeBounds";
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

/** Boxes overlap with real volume, not just touching faces. */
function aabbsShareVolume(a: Aabb, b: Aabb, eps = 1e-4) {
  return [0, 1, 2].every((axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) > eps);
}

/** Every cutter inside a group, where it sits in the world. */
function worldHoleCutters(group: WorkplaneShape): WorkplaneShape[] {
  return restoreGroupedChildren(group).flatMap((child) => {
    if (child.suppressed || child.csg?.suppressed) return [];
    if (child.hole) return [child];
    return child.groupedShapes?.length ? worldHoleCutters(child) : [];
  });
}

/**
 * A finished group's holes cut only that group's own pieces. Once its pieces join the flat
 * list the CAD worker gets, every hole cuts every solid, so a hole that reaches a solid outside
 * the group (a tray's pocket around the insert standing in it) would cut that solid too.
 */
function holesReachOutside(group: WorkplaneShape, outsideSolids: WorkplaneShape[]) {
  if (outsideSolids.length === 0) return false;
  const outside = outsideSolids.map(worldAabb);
  return worldHoleCutters(group).some((cutter) => {
    const box = worldAabb(cutter);
    return outside.some((solid) => aabbsShareVolume(box, solid));
  });
}

function hasExactOrResultSolid(shape: WorkplaneShape) {
  return Boolean(shape.cadBrep || shape.importedMesh?.brepStep || hasUsableCsgResultMesh(shape));
}

function flattenEdgeTreatmentPart(
  shape: WorkplaneShape,
  forceHole = false,
  ignoreThreads = false,
  outsideSolids: WorkplaneShape[] = [],
): WorkplaneShape[] {
  const hole = Boolean(shape.hole || forceHole);
  const marked = hole ? { ...shape, hole: true as const } : shape;
  const expanded = marked.hole ? expandSketchHoleCuttersIfPossible(marked) : [marked];
  if (expanded.length > 1) {
    return expanded.flatMap((part) => flattenEdgeTreatmentPart(part, true, ignoreThreads, outsideSolids));
  }
  const prepared = expanded[0];
  if (ignoreThreads && isHelicalThreadSolid(prepared)) return [];
  const forceOpenForThreads = Boolean(ignoreThreads && containsHelicalThreadSolid(prepared));
  // A display mesh is a cache of this recipe. Rebuild from the boxes and cylinders
  // so a slotted plate is an exact solid instead of an open triangle soup.
  // Threaded groups keep a helix B-Rep; open them anyway so fillet can skip the cutter.
  // A solid group whose holes would reach a solid outside it stays whole (its result mesh),
  // or opening it would let those holes cut parts the group never cut.
  const openGroup = Boolean(
    prepared.groupedShapes?.length
    && ((!prepared.cadBrep && !prepared.importedMesh?.brepStep) || forceOpenForThreads)
    && (forceOpenForThreads || hole || !hasExactOrResultSolid(prepared) || !holesReachOutside(prepared, outsideSolids)),
  );
  if (openGroup) {
    const restored = restoreGroupedChildren(prepared);
    const children = restored.flatMap((child, index) => {
      // A hole group's pieces are all cutters; a solid group's other solids are outside each piece.
      const siblings = hole ? [] : restored.filter((other, otherIndex) => (
        otherIndex !== index && !other.hole && !other.suppressed && !other.csg?.suppressed
      ));
      return flattenEdgeTreatmentPart(child, hole, ignoreThreads, [...outsideSolids, ...siblings]);
    });
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
