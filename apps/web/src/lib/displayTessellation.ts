import type { CadModifierQuality } from "@/lib/cadModifierTypes";
import { hardwareProfile } from "@/lib/desktopHardware";
import type { DisplayQuality, ShapeKind, WorkplaneShape } from "@/types/sketchforge";

export const DEFAULT_DISPLAY_QUALITY: DisplayQuality = "standard";

export const DISPLAY_QUALITY_OPTIONS: DisplayQuality[] = ["draft", "standard", "smooth"];

/**
 * Facet counts baked into shapes by older catalog builds, per kind. Those were never a user
 * choice, so they still mean “follow display quality”.
 *
 * Matching is per-kind on purpose. A single global value set both swallowed deliberate user
 * input (a cylinder set to 144 sides jumped to 192) and missed real auto values for other
 * kinds (a draft round roof stored 48, which no quality default could then update).
 */
const LEGACY_BAKED_SIDES: Partial<Record<ShapeKind, number>> = {
  cylinder: 96,
  cone: 96,
  roundRoof: 64,
};

const LEGACY_BAKED_STEPS: Partial<Record<ShapeKind, number>> = {
  box: 10,
  sphere: 24,
  halfSphere: 32,
};

const SIDE_DEFAULTS: Record<DisplayQuality, Partial<Record<ShapeKind, number>>> = {
  draft: { cylinder: 64, cone: 64, roundRoof: 48, tube: 96, ring: 96, thread: 48 },
  standard: { cylinder: 128, cone: 128, roundRoof: 96, tube: 192, ring: 192, thread: 96 },
  smooth: { cylinder: 192, cone: 192, roundRoof: 128, tube: 256, ring: 256, thread: 96 },
};

const STEP_DEFAULTS: Record<DisplayQuality, Partial<Record<ShapeKind, number>>> = {
  draft: { sphere: 16, torus: 16, halfSphere: 20, box: 6 },
  standard: { sphere: 48, torus: 48, halfSphere: 40, box: 12 },
  smooth: { sphere: 64, torus: 64, halfSphere: 56, box: 16 },
};

const HOLLOW_SEGMENTS: Record<DisplayQuality, number> = {
  draft: 96,
  standard: 192,
  smooth: 256,
};

let activeDisplayQuality: DisplayQuality = DEFAULT_DISPLAY_QUALITY;

export function normalizeDisplayQuality(value: unknown, fallback: DisplayQuality = DEFAULT_DISPLAY_QUALITY): DisplayQuality {
  return DISPLAY_QUALITY_OPTIONS.includes(value as DisplayQuality) ? (value as DisplayQuality) : fallback;
}

export function setActiveDisplayQuality(quality: DisplayQuality) {
  activeDisplayQuality = normalizeDisplayQuality(quality);
}

export function getActiveDisplayQuality() {
  return activeDisplayQuality;
}

/** Run tessellation-sensitive work at a temporary quality, then restore the viewport setting. */
export function withDisplayQuality<T>(quality: DisplayQuality, fn: () => T): T {
  const previous = getActiveDisplayQuality();
  setActiveDisplayQuality(quality);
  try {
    return fn();
  } finally {
    setActiveDisplayQuality(previous);
  }
}

export async function withDisplayQualityAsync<T>(quality: DisplayQuality, fn: () => Promise<T>): Promise<T> {
  const previous = getActiveDisplayQuality();
  setActiveDisplayQuality(quality);
  try {
    return await fn();
  } finally {
    setActiveDisplayQuality(previous);
  }
}

export function isCurvedTessellationKind(kind: ShapeKind) {
  return (
    kind === "cylinder"
    || kind === "cone"
    || kind === "sphere"
    || kind === "torus"
    || kind === "halfSphere"
    || kind === "roundRoof"
    || kind === "tube"
    || kind === "ring"
    || kind === "thread"
  );
}

function clampSides(value: number) {
  return Math.max(3, Math.min(hardwareProfile().maxShapeSides, Math.round(value)));
}

function clampSteps(value: number) {
  return Math.max(6, Math.min(128, Math.round(value)));
}

export function defaultSidesForKind(kind: ShapeKind, quality: DisplayQuality = getActiveDisplayQuality()) {
  return SIDE_DEFAULTS[quality][kind];
}

export function defaultStepsForKind(kind: ShapeKind, quality: DisplayQuality = getActiveDisplayQuality()) {
  return STEP_DEFAULTS[quality][kind];
}

/** True when `stored` is a value this kind gets automatically, rather than a user override. */
function followsDisplayQuality(
  stored: number,
  kind: ShapeKind,
  defaults: Record<DisplayQuality, Partial<Record<ShapeKind, number>>>,
  legacy: Partial<Record<ShapeKind, number>>,
) {
  return stored === legacy[kind] || DISPLAY_QUALITY_OPTIONS.some((quality) => defaults[quality][kind] === stored);
}

export function resolveShapeSides(
  kind: ShapeKind,
  stored: number | undefined,
  quality: DisplayQuality = getActiveDisplayQuality(),
) {
  const target = defaultSidesForKind(kind, quality);
  if (target == null) {
    return stored;
  }
  // The round roof has no sides slider. Display quality is the only control.
  if (kind === "roundRoof" || stored == null || followsDisplayQuality(stored, kind, SIDE_DEFAULTS, LEGACY_BAKED_SIDES)) {
    return clampSides(target);
  }
  return clampSides(stored);
}

export function resolveShapeSteps(
  kind: ShapeKind,
  stored: number | undefined,
  quality: DisplayQuality = getActiveDisplayQuality(),
) {
  const target = defaultStepsForKind(kind, quality);
  if (target == null) {
    return stored;
  }
  // Half sphere and torus have no step slider. Display quality is the only control.
  if (kind === "halfSphere" || kind === "torus" || stored == null || followsDisplayQuality(stored, kind, STEP_DEFAULTS, LEGACY_BAKED_STEPS)) {
    return clampSteps(target);
  }
  return clampSteps(stored);
}

export function resolveHollowCylinderSegments(quality: DisplayQuality = getActiveDisplayQuality()) {
  return clampSides(HOLLOW_SEGMENTS[quality]);
}

export function resolveIcosahedronDetail(quality: DisplayQuality = getActiveDisplayQuality()) {
  if (quality === "draft") return 1;
  if (quality === "smooth") return 2;
  return 1;
}

/** Barrel / radial hole meshes follow the same display budget. */
export function resolveHoleRadialSegments(radiusMm: number, quality: DisplayQuality = getActiveDisplayQuality()) {
  const cap = quality === "draft" ? 96 : quality === "smooth" ? 256 : 192;
  const floor = quality === "draft" ? 32 : 48;
  const density = quality === "draft" ? 4 : quality === "smooth" ? 8 : 6;
  return Math.min(cap, Math.max(floor, Math.ceil(Math.max(0.01, radiusMm) * density)));
}

type CurveSideSource = {
  kind: ShapeKind;
  sides?: number;
  steps?: number;
  groupedShapes?: CurveSideSource[];
};

/** How many facets around the curve the viewport already uses for this solid. */
export function curveSidesForShape(shape: CurveSideSource | null, quality: DisplayQuality = getActiveDisplayQuality()) {
  const fallback = defaultSidesForKind("cylinder", quality) ?? 128;
  if (!shape) return fallback;
  const own = curveSidesOf(shape, quality);
  const nested = (shape.groupedShapes ?? []).reduce((max, child) => Math.max(max, curveSidesOf(child, quality)), 0);
  return Math.max(own, nested) || fallback;
}

const COARSE_BOOLEAN_ANGULAR = 0.32;

function curvedSidesInTree(shape: CurveSideSource | null | undefined, quality: DisplayQuality): number {
  if (!shape) return 0;
  let sides = curveSidesOf(shape, quality);
  for (const child of shape.groupedShapes ?? []) {
    sides = Math.max(sides, curvedSidesInTree(child, quality));
  }
  return sides;
}

/**
 * Angular step for a Group cut, join, or intersect.
 * Only a real curve contributes its side count. A box stays at the coarse step.
 */
export function booleanAngularDeflection(
  shapes: Array<CurveSideSource | null | undefined>,
  quality: DisplayQuality = getActiveDisplayQuality(),
) {
  let sides = 0;
  for (const shape of shapes) sides = Math.max(sides, curvedSidesInTree(shape, quality));
  if (sides <= 0) return COARSE_BOOLEAN_ANGULAR;
  const clamped = Math.max(8, Math.min(512, Math.round(sides)));
  return (Math.PI * 2) / clamped;
}

function curveSidesOf(shape: CurveSideSource, quality: DisplayQuality) {
  if (shape.kind === "sphere" || shape.kind === "halfSphere") {
    const steps = resolveShapeSteps(shape.kind, shape.steps, quality) ?? defaultStepsForKind(shape.kind, quality) ?? 32;
    return Math.max(8, steps * 2);
  }
  if (shape.kind === "torus") {
    const steps = resolveShapeSteps(shape.kind, shape.steps, quality) ?? defaultStepsForKind(shape.kind, quality) ?? 48;
    return Math.max(24, steps * 4);
  }
  if (isCurvedTessellationKind(shape.kind)) {
    return resolveShapeSides(shape.kind, shape.sides, quality) ?? defaultSidesForKind("cylinder", quality) ?? 128;
  }
  return 0;
}

/**
 * Picture of a fillet or chamfer.
 *
 * Chord error stays fixed. It used to shrink with the radius, so a later
 * smaller fillet asked for a finer mesh of the whole body. The exact solid
 * is what the next fillet cuts; this mesh is only the picture. Do not tie
 * the chord error to the radius again.
 *
 * The angle step follows `sides`, the facets already on that round body.
 * A fixed angle (the kernel used 0.32 rad, about 20 flats) is what makes a
 * filleted cylinder look coarse. That step is not the triangle-count guard.
 */
export function curvedDisplayTessellation(_amount: number, sides: number) {
  const safeSides = Math.max(8, Math.min(512, Math.round(sides)));
  return {
    linearDeflection: 0.055,
    angularDeflection: (Math.PI * 2) / safeSides,
  };
}

export function modifierQualityForDisplay(quality: DisplayQuality = getActiveDisplayQuality()): CadModifierQuality {
  if (quality === "draft") return "draft";
  if (quality === "smooth") return "ultra";
  return "fine";
}

/** Live fillet/chamfer preview. Ultra waits for Apply, or a Smooth user picking it in the panel. */
export function modifierPreviewQualityForDisplay(quality: DisplayQuality = getActiveDisplayQuality()): CadModifierQuality {
  if (quality === "draft") return "draft";
  return "fine";
}

export function catalogSidesForKind(kind: ShapeKind, quality: DisplayQuality = getActiveDisplayQuality()) {
  if (kind === "pyramid") return 4;
  if (kind === "polygon") return 6;
  return defaultSidesForKind(kind, quality);
}

export function catalogStepsForKind(kind: ShapeKind, quality: DisplayQuality = getActiveDisplayQuality()) {
  return defaultStepsForKind(kind, quality);
}

export function shapeTessellationFingerprint(shape: Pick<WorkplaneShape, "kind" | "sides" | "steps">, quality: DisplayQuality) {
  if (!isCurvedTessellationKind(shape.kind) && shape.kind !== "box" && shape.kind !== "icosahedron") {
    return "";
  }
  return `|dq:${quality}:s${resolveShapeSides(shape.kind, shape.sides, quality) ?? "-"}:t${resolveShapeSteps(shape.kind, shape.steps, quality) ?? "-"}:i${resolveIcosahedronDetail(quality)}:h${resolveHollowCylinderSegments(quality)}`;
}
