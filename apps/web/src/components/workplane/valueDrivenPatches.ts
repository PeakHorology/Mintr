import {
  getShapeProperties,
  TYPED_DIMENSION_MAX_MM,
  type RangePropertyConfig,
  type ShapeInspectorUpdateOptions,
} from "@/components/workplane/shapeProperties";
import { bumpCsgVersion } from "@/lib/csgTree";
import { cleanShapePatch, restoreGroupedChildren } from "@/lib/editorBoolean";
import { evaluateValueExpression, resolveValues } from "@/lib/parametricValues";
import { setDrivingDimensionValue } from "@/lib/sketch";
import type { SketchDoc } from "@/lib/sketch/types";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Mintr Pro: turn a part's values into its settings. A driven setting is kept by its inspector
 * label ("Width", "Teeth"), and the inspector's own setting does the change, so every kind of
 * part (boxes, gears, bins, threads) is driven the same way a typed number would drive it.
 */

const SIZE_LABELS = new Set(["Length", "Width", "Height"]);

/**
 * Settings measured in lengths, which follow the workplane's unit. The same test the inspector
 * uses to show a length box in inches or millimeters (ShapeInspector `propertyUsesLengthUnit`).
 */
export function drivenLabelIsLength(label: string) {
  return /length|width|height|radius|bevel|thickness|clearance|module|backlash|rim|hole|padding|raise|spacing|fit across|fit deep|edge round|diameter/i.test(label);
}

function rangeProperties(shape: WorkplaneShape, onUpdate: (patch: Partial<WorkplaneShape>, options?: ShapeInspectorUpdateOptions) => void) {
  return getShapeProperties(shape, onUpdate).filter((property): property is RangePropertyConfig => !("type" in property) || property.type === "range");
}

/** The number settings of a part that values can drive, by label. */
export function drivablePropertyLabels(shape: WorkplaneShape): string[] {
  return rangeProperties(shape, () => {}).map((property) => property.label);
}

/** A typed setting is held to the range the inspector holds it to. */
function boundForProperty(property: RangePropertyConfig, value: number) {
  const ceiling = property.typedMax ?? (SIZE_LABELS.has(property.label) ? TYPED_DIMENSION_MAX_MM : property.max);
  return Math.min(ceiling, Math.max(property.min, value));
}

export type DrivenSettings = {
  /** Everything the values change on this part, merged; empty when nothing changes. */
  patch: Partial<WorkplaneShape>;
  resizeAxis?: ShapeInspectorUpdateOptions["resizeAxis"];
  /** Why a setting could not follow its sum, by label. */
  errors: Record<string, string>;
};

/**
 * What a part's own driven settings come to with these values. Answers are in the workplane's
 * unit (`unitMm` millimeters each); a length setting turns them into millimeters.
 */
export function drivenSettingsPatch(shape: WorkplaneShape, scope: ReadonlyMap<string, number>, unitMm = 1): DrivenSettings {
  const errors: Record<string, string> = {};
  const patch: Partial<WorkplaneShape> = {};
  let resizeAxis: DrivenSettings["resizeAxis"];
  let current = shape;
  for (const [label, expression] of Object.entries(shape.drivenBy ?? {})) {
    const result = evaluateValueExpression(expression, scope, unitMm);
    if (!result.ok) {
      errors[label] = result.error;
      continue;
    }
    let recorded: { patch: Partial<WorkplaneShape>; options?: ShapeInspectorUpdateOptions } | null = null;
    const property = rangeProperties(current, (next, options) => {
      recorded = { patch: next, options };
    }).find((entry) => entry.label === label);
    if (!property) {
      errors[label] = `This part has no ${label} setting now.`;
      continue;
    }
    const target = boundForProperty(property, drivenLabelIsLength(label) && unitMm !== 1 ? result.value * unitMm : result.value);
    if (Math.abs(target - property.value) < 1e-9) continue;
    property.onChange(target);
    const change = recorded as { patch: Partial<WorkplaneShape>; options?: ShapeInspectorUpdateOptions } | null;
    if (!change) continue;
    Object.assign(patch, change.patch);
    resizeAxis = change.options?.resizeAxis ?? resizeAxis;
    current = canonicalizeShape({ ...current, ...cleanShapePatch(change.patch) });
  }
  return { patch, resizeAxis, errors };
}

/** The part's sketch with every dimension written as a sum set to its answer, or null when none change. */
export function drivenSketchDoc(shape: WorkplaneShape, scope: ReadonlyMap<string, number>, unitMm = 1): { doc: SketchDoc | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const doc = shape.sketchDoc;
  if (!doc?.dimensions.some((dimension) => dimension.expression)) return { doc: null, errors };
  let next: SketchDoc | null = null;
  for (const dimension of doc.dimensions) {
    if (!dimension.expression || !dimension.driving) continue;
    const answer = evaluateValueExpression(dimension.expression, scope, unitMm);
    if (!answer.ok) {
      errors[dimension.id] = answer.error;
      continue;
    }
    // Angles stay degrees; every other sketch size is a length.
    const result = { value: dimension.kind !== "angular" && unitMm !== 1 ? answer.value * unitMm : answer.value };
    if (!(result.value > 0)) {
      errors[dimension.id] = "A sketch size has to be more than 0.";
      continue;
    }
    if (Math.abs(result.value - dimension.value) < 1e-9) continue;
    next = setDrivingDimensionValue(next ?? doc, dimension.id, result.value).doc;
  }
  return { doc: next, errors };
}

export type ValuesPlan = {
  /** The top-level part's own settings and sketch. */
  body: DrivenSettings & { sketchDoc: SketchDoc | null };
  /** Parts grouped inside it, at any depth, whose settings or sketch change, by id. */
  children: Map<string, { patch: Partial<WorkplaneShape>; sketchDoc: SketchDoc | null }>;
  errors: string[];
};

/**
 * Everything a top-level part's values change: its own settings and those of the parts inside it,
 * however deep. Each group's values reach every part inside it; a name inside hides the same name
 * further out. `unitMm` is millimeters per workplane unit (1 on a millimeter workplane).
 */
export function planValues(body: WorkplaneShape, unitMm = 1): ValuesPlan {
  const resolved = resolveValues(body.values, undefined, unitMm);
  const errors = [...resolved.errors].map(([name, error]) => `${name}: ${error}`);
  const own = drivenSettingsPatch(body, resolved.scope, unitMm);
  const ownSketch = drivenSketchDoc(body, resolved.scope, unitMm);
  errors.push(...Object.entries(own.errors).map(([label, error]) => `${label}: ${error}`));
  errors.push(...Object.values(ownSketch.errors));
  const children = new Map<string, { patch: Partial<WorkplaneShape>; sketchDoc: SketchDoc | null }>();
  const visit = (group: WorkplaneShape, outer: ReadonlyMap<string, number>) => {
    for (const child of group.groupedShapes ?? []) {
      const scope = resolveValues(child.values, outer, unitMm).scope;
      const settings = drivenSettingsPatch(child, scope, unitMm);
      const sketch = drivenSketchDoc(child, scope, unitMm);
      errors.push(...Object.entries(settings.errors).map(([label, error]) => `${child.name} ${label}: ${error}`));
      errors.push(...Object.values(sketch.errors).map((error) => `${child.name}: ${error}`));
      if (Object.keys(settings.patch).length || sketch.doc) children.set(child.id, { patch: settings.patch, sketchDoc: sketch.doc });
      if (child.groupedShapes?.length) visit(child, scope);
    }
  };
  visit(body, resolved.scope);
  return { body: { ...own, sketchDoc: ownSketch.doc }, children, errors };
}

/**
 * A group's parts with a plan's setting changes put in, at any depth. A group holding a changed
 * part is marked to be worked out again. Parts that do not change are kept as they are.
 */
export function withPlannedChildPatches(group: WorkplaneShape, children: ValuesPlan["children"]): WorkplaneShape[] {
  return (group.groupedShapes ?? []).map((child) => {
    const change = children.get(child.id);
    let next = change && Object.keys(change.patch).length ? canonicalizeShape({ ...child, ...cleanShapePatch(change.patch) }) : child;
    if (next.groupedShapes?.length && containsPlannedPatch(next, children)) {
      next = bumpCsgVersion({ ...next, groupedShapes: withPlannedChildPatches(next, children) });
    }
    return next;
  });
}

function containsPlannedPatch(group: WorkplaneShape, children: ValuesPlan["children"]): boolean {
  return (group.groupedShapes ?? []).some((child) => {
    const change = children.get(child.id);
    return Boolean(change && Object.keys(change.patch).length) || containsPlannedPatch(child, children);
  });
}

/** A part inside a group, at any depth, as it is stored (in its group's frame). */
export function findGroupedPart(group: WorkplaneShape, id: string): WorkplaneShape | null {
  for (const child of group.groupedShapes ?? []) {
    if (child.id === id) return child;
    const inner = findGroupedPart(child, id);
    if (inner) return inner;
  }
  return null;
}

/** A part inside a group, at any depth, placed where it sits in the world. */
export function worldGroupedPart(group: WorkplaneShape, id: string): WorkplaneShape | null {
  if (!findGroupedPart(group, id)) return null;
  for (const child of restoreGroupedChildren(group, { preserveIds: true })) {
    if (child.id === id) return child;
    if (child.groupedShapes?.length && findGroupedPart(child, id)) return worldGroupedPart(child, id);
  }
  return null;
}
