import { duplicateShapeForPattern } from "@/lib/circularPattern";
import { worldAabb } from "@/lib/shapeBounds";
import { shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

export const LINEAR_PATTERN_MIN_COUNT = 1;
export const LINEAR_PATTERN_MAX_COUNT = 24;
export const LINEAR_PATTERN_DEFAULT_COUNT_X = 3;
export const LINEAR_PATTERN_DEFAULT_COUNT_Z = 1;
export const LINEAR_PATTERN_DEFAULT_COUNT_Y = 1;
export const LINEAR_PATTERN_MIN_SPACING = 0.1;
export const LINEAR_PATTERN_MAX_SPACING = 160;
/** Sanity limit on patterned positions (mm); see CIRCULAR_PATTERN_POSITION_LIMIT. */
export const LINEAR_PATTERN_POSITION_LIMIT = 10000;
// Parts may sit below the workplane (a sunk hole) or high above it; only runaway values are limited.
const MIN_ELEVATION = -10000;
const MAX_ELEVATION = 10000;

export type LinearPatternCounts = {
  countX: number;
  countZ: number;
  countY?: number;
};

export type LinearPatternSpacing = {
  spacingX: number;
  spacingZ: number;
  spacingY?: number;
  /**
   * Degrees the rows and columns turn around the original, counterclockwise seen from above,
   * so a row can run at any angle. The copies keep the original's own facing.
   */
  turn?: number;
};

/** The pattern turn, in whole degrees from 0 to 359. */
export function clampLinearPatternTurn(degrees: number | undefined) {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) return 0;
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** A row and column offset turned by `turnDeg`, the same way a circular pattern turns. */
function turnedOffset(dx: number, dz: number, turnDeg: number) {
  if (turnDeg === 0) return { dx, dz };
  const angle = (turnDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { dx: dx * cos + dz * sin, dz: -dx * sin + dz * cos };
}

export type LinearPatternOptions = {
  createId?: (sourceId: string, ix: number, iz: number, iy: number) => string;
};

function clampPosition(value: number) {
  return Math.max(-LINEAR_PATTERN_POSITION_LIMIT, Math.min(LINEAR_PATTERN_POSITION_LIMIT, value));
}

function clampElevation(value: number) {
  return Math.max(MIN_ELEVATION, Math.min(MAX_ELEVATION, value));
}

function clean(value: number) {
  const rounded = Number(value.toFixed(4));
  return Math.abs(rounded) < 0.0005 ? 0 : rounded;
}

export function clampLinearPatternCount(count: number, fallback = LINEAR_PATTERN_DEFAULT_COUNT_X) {
  if (!Number.isFinite(count)) return fallback;
  return Math.max(LINEAR_PATTERN_MIN_COUNT, Math.min(LINEAR_PATTERN_MAX_COUNT, Math.round(count)));
}

export function clampLinearPatternSpacing(spacing: number, fallback = 20) {
  if (!Number.isFinite(spacing)) return fallback;
  const clamped = Math.max(-LINEAR_PATTERN_MAX_SPACING, Math.min(LINEAR_PATTERN_MAX_SPACING, spacing));
  if (Math.abs(clamped) < LINEAR_PATTERN_MIN_SPACING) {
    return 0;
  }
  return clamped;
}

export function linearPatternCopyId(sourceId: string, ix: number, iz: number, iy: number) {
  return `${sourceId}__linear_pattern__${ix}_${iz}_${iy}`;
}

export function resolveLinearPatternSourceId(
  pickId: string,
  session: { sourceIds: readonly string[] },
): string | null {
  if (session.sourceIds.includes(pickId)) return pickId;
  const marker = "__linear_pattern__";
  const markerAt = pickId.indexOf(marker);
  if (markerAt > 0) {
    const sourceId = pickId.slice(0, markerAt);
    if (session.sourceIds.includes(sourceId)) return sourceId;
  }
  return null;
}

function footprintExtent(shape: WorkplaneShape, axis: "x" | "z" | "y") {
  const box = worldAabb(shape);
  if (axis === "x") return box.max[0] - box.min[0];
  if (axis === "z") return box.max[2] - box.min[2];
  return box.max[1] - box.min[1];
}

export function linearPatternSuggestedSpacing(
  sources: readonly WorkplaneShape[],
  axis: "x" | "z" | "y",
) {
  if (sources.length === 0) return 20;
  const gap = 2;
  // Use the world footprint, not the unrotated width. A turned part is wider
  // on screen than shape.width, and spacing from the local size overlaps the
  // copies so they look crushed.
  const span = Math.max(...sources.map((shape) => footprintExtent(shape, axis)));
  if (!Number.isFinite(span) || span <= 0) {
    if (axis === "x") return clampLinearPatternSpacing(Math.max(...sources.map((shape) => shapeWidth(shape))) + gap);
    if (axis === "z") return clampLinearPatternSpacing(Math.max(...sources.map((shape) => shapeDepth(shape))) + gap);
    return clampLinearPatternSpacing(Math.max(...sources.map((shape) => shape.height)) + gap);
  }
  return clampLinearPatternSpacing(span + gap);
}

/**
 * Most instances one linear pattern may produce per source. Each copy carries
 * its own mesh, so 24 × 24 × 24 (13,824 bodies) would freeze the preview; a
 * full 24 × 24 grid of pegs still fits.
 */
export const LINEAR_PATTERN_MAX_INSTANCES = 600;

/**
 * Clamp per-axis counts and then the product. When the product is over budget
 * the most recently changed axis is reduced first so the panel reflects what
 * the user just typed being limited, not an unrelated axis shrinking.
 */
export function boundLinearPatternCounts(
  counts: LinearPatternCounts,
  changed: "countX" | "countZ" | "countY" | null = null,
): Required<LinearPatternCounts> {
  let countX = clampLinearPatternCount(counts.countX, LINEAR_PATTERN_DEFAULT_COUNT_X);
  let countZ = clampLinearPatternCount(counts.countZ ?? 1, LINEAR_PATTERN_DEFAULT_COUNT_Z);
  let countY = clampLinearPatternCount(counts.countY ?? 1, LINEAR_PATTERN_DEFAULT_COUNT_Y);
  const order: Array<"countX" | "countZ" | "countY"> = changed
    ? [changed, ...(["countY", "countZ", "countX"] as const).filter((axis) => axis !== changed)]
    : ["countY", "countZ", "countX"];
  for (const axis of order) {
    if (countX * countZ * countY <= LINEAR_PATTERN_MAX_INSTANCES) break;
    const others = axis === "countX" ? countZ * countY : axis === "countZ" ? countX * countY : countX * countZ;
    const allowed = Math.max(LINEAR_PATTERN_MIN_COUNT, Math.floor(LINEAR_PATTERN_MAX_INSTANCES / Math.max(1, others)));
    if (axis === "countX") countX = Math.min(countX, allowed);
    else if (axis === "countZ") countZ = Math.min(countZ, allowed);
    else countY = Math.min(countY, allowed);
  }
  return { countX, countZ, countY };
}

export function linearPatternInstanceCount(counts: LinearPatternCounts) {
  const { countX, countZ, countY } = boundLinearPatternCounts(counts);
  return countX * countZ * countY;
}

export function linearPatternWouldClamp(
  sources: readonly Pick<WorkplaneShape, "x" | "z">[],
  counts: LinearPatternCounts,
  spacing: LinearPatternSpacing,
) {
  const countX = clampLinearPatternCount(counts.countX, LINEAR_PATTERN_DEFAULT_COUNT_X);
  const countZ = clampLinearPatternCount(counts.countZ ?? 1, LINEAR_PATTERN_DEFAULT_COUNT_Z);
  const spacingX = clampLinearPatternSpacing(spacing.spacingX);
  const spacingZ = clampLinearPatternSpacing(spacing.spacingZ);
  const turn = clampLinearPatternTurn(spacing.turn);
  return sources.some((source) => {
    for (let ix = 0; ix < countX; ix += 1) {
      for (let iz = 0; iz < countZ; iz += 1) {
        const offset = turnedOffset(ix * spacingX, iz * spacingZ, turn);
        const x = source.x + offset.dx;
        const z = source.z + offset.dz;
        if (Math.abs(x) > LINEAR_PATTERN_POSITION_LIMIT || Math.abs(z) > LINEAR_PATTERN_POSITION_LIMIT) {
          return true;
        }
      }
    }
    return false;
  });
}

/**
 * Build a rectangular / linear array. Instance (0,0,0) keeps the source id.
 * Offsets are applied in workplane X/Z and optional elevation Y.
 */
export function linearPatternInstances(
  sources: readonly WorkplaneShape[],
  counts: LinearPatternCounts,
  spacing: LinearPatternSpacing,
  options: LinearPatternOptions = {},
): WorkplaneShape[] {
  const { countX, countZ, countY } = boundLinearPatternCounts(counts);
  const spacingX = clampLinearPatternSpacing(spacing.spacingX);
  const spacingZ = clampLinearPatternSpacing(spacing.spacingZ);
  const spacingY = clampLinearPatternSpacing(spacing.spacingY ?? linearPatternSuggestedSpacing(sources, "y"));
  const turn = clampLinearPatternTurn(spacing.turn);
  const createId = options.createId ?? linearPatternCopyId;
  const results: WorkplaneShape[] = [];

  for (const source of sources) {
    for (let iy = 0; iy < countY; iy += 1) {
      for (let iz = 0; iz < countZ; iz += 1) {
        for (let ix = 0; ix < countX; ix += 1) {
          const keep = ix === 0 && iz === 0 && iy === 0;
          const id = keep ? source.id : createId(source.id, ix, iz, iy);
          const base = keep ? { ...source } : duplicateShapeForPattern(source, id);
          const offset = turnedOffset(ix * spacingX, iz * spacingZ, turn);
          results.push({
            ...base,
            id,
            x: clampPosition(clean(source.x + offset.dx)),
            z: clampPosition(clean(source.z + offset.dz)),
            elevation: clampElevation(clean((source.elevation ?? 0) + iy * spacingY)),
          });
        }
      }
    }
  }

  return results;
}
