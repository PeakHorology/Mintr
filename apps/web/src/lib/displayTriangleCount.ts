import {
  getActiveDisplayQuality,
  resolveHollowCylinderSegments,
  resolveIcosahedronDetail,
  resolveShapeSides,
  resolveShapeSteps,
} from "@/lib/displayTessellation";
import { sphereTessellation } from "@/lib/sphereTessellation";
import type { DisplayQuality, WorkplaneShape } from "@/types/sketchforge";

/** Orbit throttle, busy label, and cheap picking use this scene-wide budget. */
export const HEAVY_DISPLAY_TRIANGLES = 80_000;

function cylinderTriangles(radial: number, heightSegments = 1) {
  const r = Math.max(3, Math.round(radial));
  const h = Math.max(1, Math.round(heightSegments));
  return r * h * 2 + r * 2;
}

function sphereTriangles(widthSegments: number, heightSegments: number) {
  const w = Math.max(3, Math.round(widthSegments));
  const h = Math.max(2, Math.round(heightSegments));
  return 2 * w * (h - 1);
}

function estimatePrimitiveTriangles(shape: WorkplaneShape, quality: DisplayQuality) {
  const sides = resolveShapeSides(shape.kind, shape.sides, quality);
  const steps = resolveShapeSteps(shape.kind, shape.steps, quality);
  switch (shape.kind) {
    case "box":
      if (shape.radius && shape.radius > 0) {
        const segs = Math.max(1, steps ?? 12);
        return 24 * segs * segs;
      }
      return 12;
    case "cylinder":
    case "thread":
    case "cone":
      return cylinderTriangles(sides ?? 128, shape.segments ?? 1);
    case "polygon":
      return cylinderTriangles(shape.sides ?? 6);
    case "pyramid":
      return cylinderTriangles(shape.sides ?? 4);
    case "sphere": {
      const tessellation = sphereTessellation(steps);
      return sphereTriangles(tessellation.widthSegments, tessellation.heightSegments);
    }
    case "halfSphere":
      return Math.ceil(sphereTriangles((steps ?? 40) * 2, steps ?? 40) / 2);
    case "torus": {
      const radial = Math.max(8, (steps ?? 48) * 2);
      const tubular = Math.max(12, (steps ?? 48) * 4);
      return radial * tubular * 2;
    }
    case "roundRoof":
      return cylinderTriangles(sides ?? 96);
    case "tube":
    case "ring":
      return cylinderTriangles(resolveHollowCylinderSegments(quality)) * 2;
    case "icosahedron":
      return 20 * 4 ** resolveIcosahedronDetail(quality);
    case "wedge":
    case "roof":
      return 12;
    case "scribble":
      return 120 * 12 * 2;
    case "gear":
    case "text":
      return 4_000;
    default:
      return 12;
  }
}

/** Display triangles for one body. Grouped results use the evaluated mesh, not the children twice. */
export function displayTriangleCount(shape: WorkplaneShape, quality: DisplayQuality = getActiveDisplayQuality()): number {
  if (shape.hidden || shape.construction) return 0;
  const imported = shape.importedMesh?.triangleCount ?? 0;
  if (imported > 0) return imported;
  if (shape.groupedShapes?.length) {
    return shape.groupedShapes.reduce((total, child) => total + displayTriangleCount(child, quality), 0);
  }
  return estimatePrimitiveTriangles(shape, quality);
}

export function displayTriangleTotal(shapes: WorkplaneShape[], quality: DisplayQuality = getActiveDisplayQuality()) {
  return shapes.reduce((total, shape) => total + displayTriangleCount(shape, quality), 0);
}

export function isHeavyDisplayScene(shapes: WorkplaneShape[], quality: DisplayQuality = getActiveDisplayQuality()) {
  return displayTriangleTotal(shapes, quality) > HEAVY_DISPLAY_TRIANGLES;
}

/** Live OCCT n-way fuse stays on the UI thread; skip it once the selection is this large. */
export const LIVE_OCCT_BOOLEAN_OPERANDS = 8;
/** Tessellate worker/BVH operands at draft once the selection crosses this triangle budget. */
export const BOOLEAN_WORKING_TRIANGLE_BUDGET = 40_000;
/** Skip sync three-bvh-csg in the browser above this many display triangles. */
export const BVH_BOOLEAN_TRIANGLE_SKIP = 8_000;
/** Skip three-bvh-csg cut previews above this many solid+hole display triangles. */
export const CUT_PREVIEW_TRIANGLE_SKIP = 8_000;

/**
 * Facet budget for Group/boolean worker meshes. Smooth is a viewport setting, not a CSG budget.
 * Large multi-body parts drop to draft; Smooth otherwise uses Standard.
 */
export function booleanWorkingQuality(
  shapes: WorkplaneShape[],
  quality: DisplayQuality = getActiveDisplayQuality(),
): DisplayQuality {
  const count = shapes.filter((shape) => !shape.hidden && !shape.construction).length;
  const tris = displayTriangleTotal(shapes, quality);
  if (count >= LIVE_OCCT_BOOLEAN_OPERANDS || tris > BOOLEAN_WORKING_TRIANGLE_BUDGET) return "draft";
  if (quality === "smooth") return "standard";
  return quality;
}

/** True when live Group should skip OpenCascade and keep children for export/Ungroup. */
export function shouldSkipLiveOcctBoolean(
  shapes: WorkplaneShape[],
  quality: DisplayQuality = getActiveDisplayQuality(),
): boolean {
  if (shapes.length > LIVE_OCCT_BOOLEAN_OPERANDS) return true;
  return displayTriangleTotal(shapes, quality) > HEAVY_DISPLAY_TRIANGLES;
}

/** True when a sync BVH boolean on the renderer thread would hitch a beginner-to-intermediate part. */
export function isHeavyBooleanSelection(
  shapes: WorkplaneShape[],
  quality: DisplayQuality = getActiveDisplayQuality(),
): boolean {
  if (shapes.length >= LIVE_OCCT_BOOLEAN_OPERANDS) return true;
  return displayTriangleTotal(shapes, quality) > BVH_BOOLEAN_TRIANGLE_SKIP;
}
