import type { RangePropertyConfig, ShapeInspectorUpdate } from "@/components/workplane/shapeProperties";
import {
  CIRCULAR_PATTERN_MAX_COUNT,
  CIRCULAR_PATTERN_MAX_RADIUS,
  CIRCULAR_PATTERN_MIN_COUNT,
  CIRCULAR_PATTERN_MIN_RADIUS,
  clampCircularPatternCount,
  clampCircularPatternRadius,
} from "@/lib/circularPattern";
import {
  boundLinearPatternCounts,
  clampLinearPatternSpacing,
  LINEAR_PATTERN_MAX_COUNT,
  LINEAR_PATTERN_MAX_SPACING,
  LINEAR_PATTERN_MIN_COUNT,
} from "@/lib/linearPattern";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Mintr Pro: settings a value can drive that are not rows of the ordinary inspector. They are
 * only ever built when Pro is on, so the inspector a person without Pro sees
 * (`getShapeProperties`) is untouched.
 *
 * - Where a part sits inside its group, measured from the group's first part. The first part
 *   is the fixed point: a group's own middle moves whenever a part in it moves, so it cannot be
 *   measured from.
 * - A pattern's copies and spacing, on the part the pattern was made from.
 */

/** What a part sits in, for the settings that depend on it. */
export type PartContext = {
  /** The parts of the group this part is in, as stored (in the group's own frame). */
  siblings?: readonly WorkplaneShape[];
};

export const OFFSET_LABELS = ["Offset right", "Offset forward", "Offset up"] as const;
const OFFSET_LIMIT_MM = 2000;

/** The part the others in a group are measured from: the first that is not a pattern copy. */
export function groupAnchor(siblings: readonly WorkplaneShape[] | undefined): WorkplaneShape | null {
  return siblings?.find((part) => part.patternFeature?.role !== "instance") ?? null;
}

function offsetProperties(shape: WorkplaneShape, onUpdate: ShapeInspectorUpdate, context: PartContext): RangePropertyConfig[] {
  const anchor = groupAnchor(context.siblings);
  // The first part has nothing to be measured from, and a pattern copy is placed by its pattern.
  if (!anchor || anchor.id === shape.id || shape.patternFeature?.role === "instance") return [];
  if (!context.siblings?.some((part) => part.id === shape.id)) return [];
  const hint = `From ${anchor.name || "the first part"}, the first part in this group.`;
  const row = (label: string, value: number, patch: (next: number) => Partial<WorkplaneShape>): RangePropertyConfig => ({
    label,
    value,
    min: -OFFSET_LIMIT_MM,
    max: OFFSET_LIMIT_MM,
    step: 0.1,
    hint,
    onChange: (next) => onUpdate(patch(next)),
  });
  return [
    row(OFFSET_LABELS[0], shape.x - anchor.x, (next) => ({ x: anchor.x + next })),
    row(OFFSET_LABELS[1], shape.z - anchor.z, (next) => ({ z: anchor.z + next })),
    row(OFFSET_LABELS[2], (shape.elevation ?? 0) - (anchor.elevation ?? 0), (next) => ({ elevation: (anchor.elevation ?? 0) + next })),
  ];
}

function patternProperties(shape: WorkplaneShape, onUpdate: ShapeInspectorUpdate): RangePropertyConfig[] {
  const feature = shape.patternFeature;
  if (!feature || feature.role !== "source") return [];
  if (feature.kind === "linear" && feature.linear) {
    const params = feature.linear;
    const counts = boundLinearPatternCounts(params);
    const setCount = (axis: "countX" | "countZ" | "countY", next: number) => {
      const bounded = boundLinearPatternCounts({ ...counts, [axis]: next }, axis);
      onUpdate({ patternFeature: { ...feature, linear: { ...params, ...bounded } } });
    };
    const setSpacing = (axis: "spacingX" | "spacingZ" | "spacingY", next: number) => {
      onUpdate({ patternFeature: { ...feature, linear: { ...params, [axis]: clampLinearPatternSpacing(next) } } });
    };
    const count = (label: string, axis: "countX" | "countZ" | "countY"): RangePropertyConfig => ({
      label,
      value: counts[axis],
      min: LINEAR_PATTERN_MIN_COUNT,
      max: LINEAR_PATTERN_MAX_COUNT,
      step: 1,
      onChange: (next) => setCount(axis, next),
    });
    const spacing = (label: string, axis: "spacingX" | "spacingZ" | "spacingY"): RangePropertyConfig => ({
      label,
      value: clampLinearPatternSpacing(params[axis] ?? 0, 0),
      min: -LINEAR_PATTERN_MAX_SPACING,
      max: LINEAR_PATTERN_MAX_SPACING,
      step: 0.1,
      onChange: (next) => setSpacing(axis, next),
    });
    return [
      count("Copies across", "countX"),
      spacing("Spacing across", "spacingX"),
      count("Copies forward", "countZ"),
      spacing("Spacing forward", "spacingZ"),
      count("Copies up", "countY"),
      spacing("Spacing up", "spacingY"),
    ];
  }
  if (feature.kind === "circular" && feature.circular) {
    const params = feature.circular;
    return [
      {
        label: "Copies",
        value: clampCircularPatternCount(params.count),
        min: CIRCULAR_PATTERN_MIN_COUNT,
        max: CIRCULAR_PATTERN_MAX_COUNT,
        step: 1,
        onChange: (next) => onUpdate({ patternFeature: { ...feature, circular: { ...params, count: clampCircularPatternCount(next) } } }),
      },
      {
        label: "Circle radius",
        value: clampCircularPatternRadius(params.radius),
        min: CIRCULAR_PATTERN_MIN_RADIUS,
        max: CIRCULAR_PATTERN_MAX_RADIUS,
        step: 0.1,
        onChange: (next) => onUpdate({ patternFeature: { ...feature, circular: { ...params, radius: clampCircularPatternRadius(next) } } }),
      },
    ];
  }
  return [];
}

/** The extra settings Mintr Pro offers for a part: its pattern, then its place in its group. */
export function proRangeProperties(shape: WorkplaneShape, onUpdate: ShapeInspectorUpdate, context: PartContext = {}): RangePropertyConfig[] {
  return [...patternProperties(shape, onUpdate), ...offsetProperties(shape, onUpdate, context)];
}

/** True for a label that only Mintr Pro's extra settings use. */
export function isProOnlyLabel(label: string) {
  return (OFFSET_LABELS as readonly string[]).includes(label) || /^(Copies|Spacing) (across|forward|up)$/.test(label) || label === "Copies" || label === "Circle radius";
}
