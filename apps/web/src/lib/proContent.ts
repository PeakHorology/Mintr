import type { SketchDoc } from "@/lib/sketch/types";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * What a design made with Mintr Pro carries that a design made without it never does. With Pro
 * off this content is still honoured (sizes keep their numbers, sketch rules keep holding), it is
 * just not shown. These checks decide when to say so in one line, and they are false for
 * everything drawn without Pro, so that line never appears on a beginner's own work.
 */

/** A part, or a part grouped inside it, has named values or a size that follows a sum. */
export function shapeCarriesProValues(shape: WorkplaneShape): boolean {
  if (shape.values?.length) return true;
  if (shape.drivenBy && Object.keys(shape.drivenBy).length > 0) return true;
  if (shape.sketchDoc?.dimensions.some((dimension) => Boolean(dimension.expression))) return true;
  if (shape.features?.some((feature) => Boolean(feature.sizeFollows))) return true;
  return Boolean(shape.groupedShapes?.some(shapeCarriesProValues));
}

/** A sketch has rules or sizes that hold its drawing: only Mintr Pro adds them. */
export function sketchCarriesProRules(doc: SketchDoc | null | undefined): boolean {
  if (!doc) return false;
  return doc.constraints.some((constraint) => !constraint.suppressed) || doc.dimensions.some((dimension) => dimension.driving);
}

/** The sketch's rules moved something: the solved drawing is not the drawing that went in. */
export function sketchRulesMovedDrawing(before: SketchDoc, after: SketchDoc): boolean {
  if (!sketchCarriesProRules(before)) return false;
  const solved = new Map(after.entities.map((entity) => [entity.id, entity]));
  return before.entities.some((entity) => {
    const next = solved.get(entity.id);
    if (!next || next === entity) return false;
    if (entity.kind === "point" && next.kind === "point") return Math.abs(entity.x - next.x) > 1e-6 || Math.abs(entity.z - next.z) > 1e-6;
    if (entity.kind === "circle" && next.kind === "circle") return Math.abs(entity.radius - next.radius) > 1e-6;
    return false;
  });
}

/** The one line shown in place of the Values card when Pro is off. */
export const PRO_VALUES_NOTE = "This design uses Mintr Pro values. Turn Pro on in Settings to change them.";
/** The one line shown in a sketch when its rules resist a drag and Pro is off. */
export const PRO_SKETCH_RULES_NOTE = "This sketch has rules from Mintr Pro. Turn Pro on in Settings to see or change them.";
