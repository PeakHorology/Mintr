import {
  getShapeProperties,
  TYPED_DIMENSION_MAX_MM,
  type RangePropertyConfig,
  type ShapeInspectorUpdateOptions,
} from "@/components/workplane/shapeProperties";
import { proRangeProperties, type PartContext } from "@/components/workplane/proProperties";
import { bumpCsgVersion } from "@/lib/csgTree";
import { cleanShapePatch, restoreGroupedChildren } from "@/lib/editorBoolean";
import { evaluateValueExpression, resolveValues, valueNameProblem } from "@/lib/parametricValues";
import { partFeatureShortLabel, partStepSize, withPartStepSize } from "@/lib/partFeatures";
import { setDrivingDimensionValue } from "@/lib/sketch";
import type { SketchDoc } from "@/lib/sketch/types";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { PartFeature, WorkplaneShape } from "@/types/sketchforge";

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
  return /length|width|height|radius|bevel|thickness|clearance|module|backlash|rim|hole|padding|raise|spacing|fit across|fit deep|edge round|diameter|offset/i.test(label);
}

/**
 * Every number setting a value can drive: the inspector's own rows, then the ones only Mintr Pro
 * has (a pattern's copies and spacing, a part's place in its group, which needs `context`).
 */
function rangeProperties(
  shape: WorkplaneShape,
  onUpdate: (patch: Partial<WorkplaneShape>, options?: ShapeInspectorUpdateOptions) => void,
  context: PartContext = {},
) {
  return [
    ...getShapeProperties(shape, onUpdate).filter((property): property is RangePropertyConfig => !("type" in property) || property.type === "range"),
    ...proRangeProperties(shape, onUpdate, context),
  ];
}

/** The number settings of a part that values can drive, by label. */
export function drivablePropertyLabels(shape: WorkplaneShape, context: PartContext = {}): string[] {
  return rangeProperties(shape, () => {}, context).map((property) => property.label);
}

/** A number as a sum's answer is shown: short, in the workplane's unit for a length. */
function shownNumber(value: number, label: string, unitMm: number) {
  const shown = drivenLabelIsLength(label) && unitMm !== 1 ? value / unitMm : value;
  const rounded = Math.round(shown * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
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
export function drivenSettingsPatch(shape: WorkplaneShape, scope: ReadonlyMap<string, number>, unitMm = 1, context: PartContext = {}): DrivenSettings {
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
    }, context).find((entry) => entry.label === label);
    if (!property) {
      errors[label] = `This part has no ${label} setting now.`;
      continue;
    }
    const wanted = drivenLabelIsLength(label) && unitMm !== 1 ? result.value * unitMm : result.value;
    const target = boundForProperty(property, wanted);
    let landed = property.value;
    if (Math.abs(target - property.value) >= 1e-9) {
      property.onChange(target);
      const change = recorded as { patch: Partial<WorkplaneShape>; options?: ShapeInspectorUpdateOptions } | null;
      if (change) {
        Object.assign(patch, change.patch);
        resizeAxis = change.options?.resizeAxis ?? resizeAxis;
        current = canonicalizeShape({ ...current, ...cleanShapePatch(change.patch) });
        landed = rangeProperties(current, () => {}, context).find((entry) => entry.label === label)?.value ?? target;
      }
    }
    // The setting may not be able to be what the sum says: past its range, or not a whole number.
    if (Math.abs(landed - wanted) > 1e-4 * Math.max(1, Math.abs(wanted))) {
      errors[label] = `${expression} comes to ${shownNumber(wanted, label, unitMm)}, but this setting can only be ${shownNumber(landed, label, unitMm)}.`;
    }
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

/** A step's size is a length, and has to be more than nothing to make a step at all. */
function stepSizeProblem(feature: PartFeature, sizeMm: number): string | null {
  if (feature.kind === "pushPull") return Math.abs(sizeMm) < 1e-6 ? "A push or pull has to move the face." : null;
  return sizeMm > 0 ? null : "A step's size has to be more than 0.";
}

/**
 * A part's steps (fillet, chamfer, hollow, push or pull) with every size that follows a sum set to
 * its answer, or null when none change. Errors are by the step's name.
 */
export function drivenStepSizes(shape: WorkplaneShape, scope: ReadonlyMap<string, number>, unitMm = 1): { features: PartFeature[] | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const steps = shape.features;
  if (!steps?.some((feature) => feature.sizeFollows)) return { features: null, errors };
  let changed = false;
  const features = steps.map((feature) => {
    if (!feature.sizeFollows) return feature;
    const name = partFeatureShortLabel(feature);
    const answer = evaluateValueExpression(feature.sizeFollows, scope, unitMm);
    if (!answer.ok) {
      errors[name] = answer.error;
      return feature;
    }
    const sizeMm = unitMm !== 1 ? answer.value * unitMm : answer.value;
    const problem = stepSizeProblem(feature, sizeMm);
    if (problem) {
      errors[name] = `${feature.sizeFollows} comes to ${shownNumber(sizeMm, "length", unitMm)}. ${problem}`;
      return feature;
    }
    if (Math.abs(sizeMm - partStepSize(feature)) < 1e-9) return feature;
    changed = true;
    return withPartStepSize(feature, sizeMm);
  });
  return { features: changed ? features : null, errors };
}

/** A part's steps with a plain number set for one step's size, and that step's sum let go. */
export function withTypedStepSize(features: readonly PartFeature[], featureId: string, sizeMm: number): PartFeature[] {
  return features.map((feature) => {
    if (feature.id !== featureId) return feature;
    const { sizeFollows: _released, ...rest } = withPartStepSize(feature, sizeMm);
    return rest as PartFeature;
  });
}

/** Everything one part's own values change on it, with what could not follow in plain words. */
export type DrivenPart = DrivenSettings & {
  /** The part's sketch with its sums worked out, when a sketch size changes. */
  sketchDoc: SketchDoc | null;
  /** The part's steps with their sums worked out, when a step size changes. */
  features: PartFeature[] | null;
  /** The names this part and the parts inside it can use. */
  scope: Map<string, number>;
  problems: string[];
};

/**
 * What a part's values and the values around it change on the part itself: its settings, its
 * sketch sizes and its step sizes. `named` is put before each problem ("Lid "), empty for the
 * top-level part.
 */
export function drivenPartChanges(part: WorkplaneShape, outer: ReadonlyMap<string, number> | undefined, unitMm = 1, context: PartContext = {}, named = ""): DrivenPart {
  const resolved = resolveValues(part.values, outer, unitMm);
  const settings = drivenSettingsPatch(part, resolved.scope, unitMm, context);
  const sketch = drivenSketchDoc(part, resolved.scope, unitMm);
  const steps = drivenStepSizes(part, resolved.scope, unitMm);
  const problems = [
    ...[...resolved.errors].map(([name, error]) => `${named}${name}: ${error}`),
    ...Object.entries(settings.errors).map(([label, error]) => `${named}${label}: ${error}`),
    ...Object.values(sketch.errors).map((error) => (named ? `${named.trimEnd()}: ${error}` : error)),
    ...Object.entries(steps.errors).map(([name, error]) => `${named}${name}: ${error}`),
  ];
  return { ...settings, sketchDoc: sketch.doc, features: steps.features, scope: resolved.scope, problems };
}

export type ValuesPlan = {
  /** The top-level part's own settings, sketch and steps. */
  body: DrivenSettings & { sketchDoc: SketchDoc | null; features: PartFeature[] | null };
  /** Parts grouped inside it, at any depth, whose settings, sketch or steps change, by id. */
  children: Map<string, { patch: Partial<WorkplaneShape>; sketchDoc: SketchDoc | null; features: PartFeature[] | null }>;
  errors: string[];
};

/**
 * Everything a top-level part's values change: its own settings and those of the parts inside it,
 * however deep. Each group's values reach every part inside it; a name inside hides the same name
 * further out. `unitMm` is millimeters per workplane unit (1 on a millimeter workplane).
 */
export function planValues(body: WorkplaneShape, unitMm = 1): ValuesPlan {
  const own = drivenPartChanges(body, undefined, unitMm);
  const errors = [...own.problems];
  const children: ValuesPlan["children"] = new Map();
  const visit = (group: WorkplaneShape, outer: ReadonlyMap<string, number>) => {
    for (const child of group.groupedShapes ?? []) {
      const driven = drivenPartChanges(child, outer, unitMm, { siblings: group.groupedShapes }, `${child.name} `);
      errors.push(...driven.problems);
      if (Object.keys(driven.patch).length || driven.sketchDoc || driven.features) {
        children.set(child.id, { patch: driven.patch, sketchDoc: driven.sketchDoc, features: driven.features });
      }
      if (child.groupedShapes?.length) visit(child, driven.scope);
    }
  };
  visit(body, own.scope);
  return { body: { patch: own.patch, resizeAxis: own.resizeAxis, errors: own.errors, sketchDoc: own.sketchDoc, features: own.features }, children, errors };
}

/** The values a part can use: its own, over those of every group around it, out to `body`. */
export function valueScopeForPart(body: WorkplaneShape, partId: string, unitMm = 1): Map<string, number> {
  let scope = resolveValues(body.values, undefined, unitMm).scope;
  let group = body;
  while (group.id !== partId) {
    const next = (group.groupedShapes ?? []).find((child) => child.id === partId || findGroupedPart(child, partId));
    if (!next) break;
    scope = resolveValues(next.values, scope, unitMm).scope;
    group = next;
  }
  return scope;
}

/** The group a part sits directly in, inside `body`, or null for the top-level part itself. */
export function groupHoldingPart(body: WorkplaneShape, partId: string): WorkplaneShape | null {
  for (const child of body.groupedShapes ?? []) {
    if (child.id === partId) return body;
    const inner = groupHoldingPart(child, partId);
    if (inner) return inner;
  }
  return null;
}

/**
 * A group's parts with a plan's setting changes put in, at any depth. A group holding a changed
 * part is marked to be worked out again. Parts that do not change are kept as they are.
 */
export function withPlannedChildPatches(group: WorkplaneShape, children: ValuesPlan["children"]): WorkplaneShape[] {
  return (group.groupedShapes ?? []).map((child) => {
    const change = children.get(child.id);
    let next = change && Object.keys(change.patch).length ? canonicalizeShape({ ...child, ...cleanShapePatch(change.patch) }) : child;
    if (change?.features) next = { ...next, features: change.features };
    if (next.groupedShapes?.length && containsPlannedPatch(next, children)) {
      next = bumpCsgVersion({ ...next, groupedShapes: withPlannedChildPatches(next, children) });
    }
    return next;
  });
}

function containsPlannedPatch(group: WorkplaneShape, children: ValuesPlan["children"]): boolean {
  return (group.groupedShapes ?? []).some((child) => {
    const change = children.get(child.id);
    return Boolean(change && (Object.keys(change.patch).length || change.features)) || containsPlannedPatch(child, children);
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

/** A part's sums without the ones for `labels`, or undefined when none are left. */
export function drivenByWithout(drivenBy: WorkplaneShape["drivenBy"], labels: readonly string[]): Record<string, string> | undefined {
  const rest = Object.fromEntries(Object.entries(drivenBy ?? {}).filter(([label]) => !labels.includes(label)));
  return Object.keys(rest).length ? rest : undefined;
}

/**
 * What a plain number set for `labels` adds to its change: the sums those settings followed are
 * let go, so the number stays. Empty when none of them follows a sum, which is every part made
 * without Mintr Pro. This runs with Pro on or off.
 */
export function releaseDrivenPatch(shape: Pick<WorkplaneShape, "drivenBy">, labels: readonly string[]): Partial<WorkplaneShape> {
  const drivenBy = shape.drivenBy;
  if (!drivenBy || !labels.some((label) => label in drivenBy)) return {};
  return { drivenBy: drivenByWithout(drivenBy, labels) };
}

/** The part with a plain number set for `label`, through the inspector's own setting, and its sum for that label let go. */
export function withTypedSetting(target: WorkplaneShape, label: string, value: number, context: PartContext = {}): WorkplaneShape {
  let recorded: Partial<WorkplaneShape> = {};
  rangeProperties(target, (patch) => {
    recorded = patch;
  }, context).find((property) => property.label === label)?.onChange(value);
  return canonicalizeShape({ ...target, ...cleanShapePatch(recorded), drivenBy: drivenByWithout(target.drivenBy, [label]) });
}

/** A top-level part with the part `id` (itself, or one grouped inside it at any depth) changed. */
export function withChangedPart(body: WorkplaneShape, id: string, change: (part: WorkplaneShape) => WorkplaneShape): WorkplaneShape {
  if (body.id === id) return change(body);
  if (!body.groupedShapes?.length || !findGroupedPart(body, id)) return body;
  return { ...body, groupedShapes: body.groupedShapes.map((child) => withChangedPart(child, id, change)) };
}

function everyValueName(shape: WorkplaneShape, into = new Set<string>()): Set<string> {
  for (const value of shape.values ?? []) into.add(value.name);
  for (const child of shape.groupedShapes ?? []) everyValueName(child, into);
  return into;
}

/** A value name made from a setting's label ("Top radius" becomes top_radius), not yet taken. */
export function valueNameForLabel(label: string, taken: ReadonlySet<string>): string {
  let stem = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "size";
  if (/^[0-9]/.test(stem)) stem = `size_${stem}`;
  if (valueNameProblem(stem)) stem = `${stem}_size`;
  for (let index = 1; ; index += 1) {
    const name = index === 1 ? stem : `${stem}${index}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * "Make this a value": the setting's number becomes a named value on the top-level part, and the
 * setting follows it. Nothing changes size. `unitMm` is millimeters per workplane unit. Null when
 * the part has no such setting.
 */
export function makeValueFromSetting(body: WorkplaneShape, targetId: string, label: string, unitMm = 1): { body: WorkplaneShape; name: string } | null {
  const target = body.id === targetId ? body : findGroupedPart(body, targetId);
  const context: PartContext = { siblings: groupHoldingPart(body, targetId)?.groupedShapes };
  const property = target ? rangeProperties(target, () => {}, context).find((entry) => entry.label === label) : undefined;
  if (!target || !property || !Number.isFinite(property.value)) return null;
  const shown = drivenLabelIsLength(label) && unitMm !== 1 ? property.value / unitMm : property.value;
  const name = valueNameForLabel(label, everyValueName(body));
  const withValue: WorkplaneShape = { ...body, values: [...(body.values ?? []), { name, expression: String(Number(shown.toFixed(6))) }] };
  return { body: withChangedPart(withValue, targetId, (part) => ({ ...part, drivenBy: { ...part.drivenBy, [label]: name } })), name };
}
