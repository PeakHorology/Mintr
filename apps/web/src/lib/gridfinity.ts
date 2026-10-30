import type {
  GridfinityBaseplateSpec,
  GridfinityBinSpec,
  GridfinityConnector,
  GridfinitySide,
  WorkplaneShape,
} from "@/types/sketchforge";

/**
 * Gridfinity generator — bins and baseplates on the 42 mm grid.
 *
 * All geometry comes out as a *recipe*: an ordered list of add / cut solids in a
 * local frame (X right, Y up, Z toward the viewer, body resting on y = 0, footprint
 * centred on the origin). The native MintrKernel and the brepjs worker interpret
 * the same recipe, so the exact body is identical whichever kernel built it.
 *
 * Dimensions follow the public Gridfinity specification:
 * - 42 mm pitch, 7 mm height units, bins 0.5 mm under pitch (41.5 per cell).
 * - Foot (bottom up): 0.8 mm 45° chamfer, 1.8 mm vertical, 2.15 mm 45° chamfer.
 * - Stacking lip (top down): 1.9 mm chamfer, 1.8 mm vertical, 0.7 mm chamfer.
 * - Baseplate pocket (top down): 2.15 chamfer, 1.8 vertical, 0.7 chamfer (4.65 tall).
 * - Magnets 6.5 × 2.4, screws 3 mm, both 26 mm apart per cell.
 */

export const GRIDFINITY_PITCH = 42;
export const GRIDFINITY_HEIGHT_UNIT = 7;
/** Total under-pitch clearance of a bin (0.25 per side). */
export const GRIDFINITY_BIN_CLEARANCE = 0.5;
export const GRIDFINITY_BIN_RADIUS = 3.75;
export const GRIDFINITY_FOOT_HEIGHT = 4.75;
export const GRIDFINITY_LIP_HEIGHT = 4.4;
/** Inset of the cavity at the wall top where the stacking lip starts. */
export const GRIDFINITY_LIP_INSET = 2.6;
export const GRIDFINITY_PLATE_HEIGHT = 4.65;
export const GRIDFINITY_PLATE_RADIUS = 4;
export const GRIDFINITY_MAGNET_DIAMETER = 6.5;
export const GRIDFINITY_MAGNET_DEPTH = 2.4;
export const GRIDFINITY_MAGNET_OFFSET = 13;
export const GRIDFINITY_SCREW_DIAMETER = 3;
export const GRIDFINITY_SCREW_DEPTH = 6;
/** Minimum baseplate floor once magnets, screws, or alignment tabs need material. */
export const GRIDFINITY_PLATE_MIN_FLOOR = 3;
export const GRIDFINITY_TAB_LENGTH = 4;
export const GRIDFINITY_TAB_WIDTH = 10;
export const GRIDFINITY_TAB_CLEARANCE = 0.2;
/** Integral dovetail on an open frame: narrow at the wall, wider at the tip. */
export const GRIDFINITY_DOVETAIL_PROTRUSION = 1.5;
const DOVETAIL_BASE_HALF = 1;
const DOVETAIL_TIP_HALF = 1.3;
const DOVETAIL_CLEARANCE = 0.15;

export const GRIDFINITY_MAX_UNITS = 16;
export const GRIDFINITY_MAX_HEIGHT_UNITS = 20;
export const GRIDFINITY_MAX_PADDING = 41;
export const GRIDFINITY_MAX_COMPARTMENTS = 8;

export const GRIDFINITY_SIDES: readonly GridfinitySide[] = ["left", "right", "front", "back"];

/** Small overlap so fused features never meet the body at a bare face. */
const OVERLAP = 0.5;
const MIN_CORNER_RADIUS = 0.3;

// --------------------------------------------------------------------------------
// Recipe
// --------------------------------------------------------------------------------

/** Rounded rectangle at height y. Corner radii run (x0,z0) → (x1,z0) → (x1,z1) → (x0,z1). */
export type RecipeSection = {
  y: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  r: [number, number, number, number];
};

export type RecipeProfileStep =
  | { kind: "line"; to: [number, number] }
  | { kind: "arc"; to: [number, number]; mid: [number, number] };

export type RecipeSolid =
  /** Ruled loft through sections sorted by ascending y. Equal sections make a prism. */
  | { kind: "stack"; sections: RecipeSection[] }
  | { kind: "cylinder"; cx: number; cz: number; y0: number; y1: number; r: number }
  | { kind: "cone"; cx: number; cz: number; y0: number; r0: number; y1: number; r1: number }
  | { kind: "box"; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
  /**
   * Closed profile extruded along an axis. Profile coordinates are (u, v): for
   * axis "x" u = z and v = y; for axis "z" u = x and v = y; for axis "y" u = x and v = z.
   */
  | { kind: "prism"; axis: "x" | "y" | "z"; a0: number; a1: number; start: [number, number]; steps: RecipeProfileStep[] };

export type RecipeOp = { op: "add" | "cut"; solid: RecipeSolid };

export type GridfinityRecipe = {
  version: 1;
  ops: RecipeOp[];
  /** Analytic AABB of the finished body (centred on X/Z, resting on y = 0). */
  width: number;
  depth: number;
  height: number;
};

// --------------------------------------------------------------------------------
// Spec normalization
// --------------------------------------------------------------------------------

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  return clamp(Math.round(finite(value, fallback)), min, max);
}

function round(value: number, step: number) {
  return Math.round(value / step) * step;
}

function isSide(value: unknown): value is GridfinitySide {
  return value === "left" || value === "right" || value === "front" || value === "back";
}

export function defaultGridfinityBinSpec(): GridfinityBinSpec {
  return {
    unitsX: 2,
    unitsZ: 2,
    heightUnits: 3,
    stackingLip: true,
    wallThickness: 1.2,
    floorThickness: 2.25,
    compartmentsX: 1,
    compartmentsZ: 1,
    magnets: false,
    screws: false,
    scoop: "none",
    scoopRadius: 0,
    openSides: [],
    solid: false,
  };
}

export function normalizeGridfinityBinSpec(input?: Partial<GridfinityBinSpec> | null): GridfinityBinSpec {
  const base = defaultGridfinityBinSpec();
  const openSides = Array.isArray(input?.openSides)
    ? GRIDFINITY_SIDES.filter((side) => input.openSides!.some((entry) => entry === side))
    : [];
  const solid = Boolean(input?.solid);
  const requestedScoop = input?.scoop;
  const scoop: GridfinityBinSpec["scoop"] =
    !solid && isSide(requestedScoop) && !openSides.includes(requestedScoop) ? requestedScoop : "none";
  const scoopRadius = finite(input?.scoopRadius, 0);
  return {
    unitsX: clampInt(input?.unitsX, base.unitsX, 1, GRIDFINITY_MAX_UNITS),
    unitsZ: clampInt(input?.unitsZ, base.unitsZ, 1, GRIDFINITY_MAX_UNITS),
    heightUnits: clampInt(input?.heightUnits, base.heightUnits, 1, GRIDFINITY_MAX_HEIGHT_UNITS),
    stackingLip: input?.stackingLip ?? base.stackingLip,
    wallThickness: round(clamp(finite(input?.wallThickness, base.wallThickness), 0.8, 3), 0.05),
    floorThickness: round(clamp(finite(input?.floorThickness, base.floorThickness), 0.8, 60), 0.05),
    compartmentsX: solid ? 1 : clampInt(input?.compartmentsX, 1, 1, GRIDFINITY_MAX_COMPARTMENTS),
    compartmentsZ: solid ? 1 : clampInt(input?.compartmentsZ, 1, 1, GRIDFINITY_MAX_COMPARTMENTS),
    magnets: Boolean(input?.magnets),
    screws: Boolean(input?.screws),
    scoop,
    scoopRadius: scoopRadius <= 0 ? 0 : round(clamp(scoopRadius, 1, 120), 0.5),
    openSides,
    solid,
  };
}

export function defaultGridfinityBaseplateSpec(): GridfinityBaseplateSpec {
  return {
    unitsX: 3,
    unitsZ: 3,
    padLeft: 0,
    padRight: 0,
    padFront: 0,
    padBack: 0,
    drawerWidth: 0,
    drawerLength: 0,
    floorThickness: 0,
    magnets: false,
    screws: false,
  };
}

function normalizeConnectors(input: unknown): GridfinityBaseplateSpec["connectors"] {
  if (!input || typeof input !== "object") return undefined;
  const next: Partial<Record<GridfinitySide, GridfinityConnector>> = {};
  let any = false;
  for (const side of GRIDFINITY_SIDES) {
    const value = (input as Record<string, unknown>)[side];
    if (value === "tab" || value === "slot" || value === "dovetail" || value === "groove") {
      next[side] = value;
      any = true;
    }
  }
  return any ? next : undefined;
}

export function normalizeGridfinityBaseplateSpec(
  input?: Partial<GridfinityBaseplateSpec> | null,
): GridfinityBaseplateSpec {
  const base = defaultGridfinityBaseplateSpec();
  const pad = (value: unknown) => round(clamp(finite(value, 0), 0, GRIDFINITY_MAX_PADDING), 0.1);
  const connectors = normalizeConnectors(input?.connectors);
  const magnets = Boolean(input?.magnets);
  const screws = Boolean(input?.screws);
  let floor = round(clamp(finite(input?.floorThickness, 0), 0, 12), 0.1);
  if (floor > 0 && floor < 1) floor = 1;
  const alignmentTabs = connectors
    ? GRIDFINITY_SIDES.some((side) => connectors[side] === "tab" || connectors[side] === "slot")
    : false;
  if ((magnets || screws || alignmentTabs) && floor < GRIDFINITY_PLATE_MIN_FLOOR) floor = GRIDFINITY_PLATE_MIN_FLOOR;
  const drawer = (value: unknown) => {
    const size = finite(value, 0);
    return size <= 0 ? 0 : round(clamp(size, GRIDFINITY_PITCH + GRIDFINITY_BIN_CLEARANCE, 2000), 0.1);
  };
  return {
    unitsX: clampInt(input?.unitsX, base.unitsX, 1, GRIDFINITY_MAX_UNITS),
    unitsZ: clampInt(input?.unitsZ, base.unitsZ, 1, GRIDFINITY_MAX_UNITS),
    padLeft: pad(input?.padLeft),
    padRight: pad(input?.padRight),
    padFront: pad(input?.padFront),
    padBack: pad(input?.padBack),
    drawerWidth: drawer(input?.drawerWidth),
    drawerLength: drawer(input?.drawerLength),
    floorThickness: floor,
    magnets,
    screws,
    ...(connectors ? { connectors } : {}),
  };
}

/** Stable key of everything that changes the built body. */
export function gridfinityBinKey(spec: GridfinityBinSpec) {
  const s = normalizeGridfinityBinSpec(spec);
  return [
    "bin1",
    s.unitsX,
    s.unitsZ,
    s.heightUnits,
    s.stackingLip ? 1 : 0,
    s.wallThickness,
    s.floorThickness,
    s.compartmentsX,
    s.compartmentsZ,
    s.magnets ? 1 : 0,
    s.screws ? 1 : 0,
    s.scoop,
    s.scoopRadius,
    s.openSides.join("+") || "-",
    s.solid ? 1 : 0,
  ].join("|");
}

export function gridfinityBaseplateKey(spec: GridfinityBaseplateSpec) {
  const s = normalizeGridfinityBaseplateSpec(spec);
  const connectors = GRIDFINITY_SIDES.map((side) => s.connectors?.[side]?.[0] ?? "-").join("");
  return [
    "plate1",
    s.unitsX,
    s.unitsZ,
    s.padLeft,
    s.padRight,
    s.padFront,
    s.padBack,
    s.floorThickness,
    s.magnets ? 1 : 0,
    s.screws ? 1 : 0,
    connectors,
  ].join("|");
}

export function isGridfinityKind(kind: WorkplaneShape["kind"]): kind is "gridfinityBin" | "gridfinityBaseplate" {
  return kind === "gridfinityBin" || kind === "gridfinityBaseplate";
}

/**
 * Kinds whose display and export body is `importedMesh` rather than a primitive:
 * imported meshes, threads, and kernel-built Gridfinity parts.
 */
export function shapeUsesImportedMesh(
  shape: WorkplaneShape,
): shape is WorkplaneShape & { importedMesh: NonNullable<WorkplaneShape["importedMesh"]> } {
  return Boolean(shape.importedMesh) && (shape.kind === "mesh" || shape.kind === "thread" || shape.kind === "loft" || isGridfinityKind(shape.kind));
}

/** Spec key for any Gridfinity shape, or null for other kinds. */
export function gridfinityShapeKey(shape: WorkplaneShape): string | null {
  if (shape.kind === "gridfinityBin") return gridfinityBinKey(shape.gridfinityBin ?? defaultGridfinityBinSpec());
  if (shape.kind === "gridfinityBaseplate") {
    return gridfinityBaseplateKey(shape.gridfinityBaseplate ?? defaultGridfinityBaseplateSpec());
  }
  return null;
}

/** True when the stored mesh / B-Rep does not match the current spec. */
export function gridfinityBuildPending(shape: WorkplaneShape): boolean {
  const key = gridfinityShapeKey(shape);
  if (!key) return false;
  return shape.gridfinityBuilt !== key || !shape.importedMesh;
}

// --------------------------------------------------------------------------------
// Footprints
// --------------------------------------------------------------------------------

export type GridfinityFootprint = {
  width: number;
  depth: number;
  height: number;
  /** AABB centre relative to the grid outline centre (alignment tabs shift it). */
  offsetX: number;
  offsetZ: number;
};

export function gridfinityBinFootprint(input: GridfinityBinSpec): GridfinityFootprint {
  const spec = normalizeGridfinityBinSpec(input);
  const open = new Set(spec.openSides);
  const half = GRIDFINITY_BIN_CLEARANCE / 2;
  const width = spec.unitsX * GRIDFINITY_PITCH - (open.has("left") ? 0 : half) - (open.has("right") ? 0 : half);
  const depth = spec.unitsZ * GRIDFINITY_PITCH - (open.has("back") ? 0 : half) - (open.has("front") ? 0 : half);
  const offsetX = ((open.has("right") ? 0 : -half) - (open.has("left") ? 0 : -half)) / 2;
  const offsetZ = ((open.has("front") ? 0 : -half) - (open.has("back") ? 0 : -half)) / 2;
  const height = spec.heightUnits * GRIDFINITY_HEIGHT_UNIT + (spec.stackingLip ? GRIDFINITY_LIP_HEIGHT : 0);
  return { width, depth, height, offsetX, offsetZ };
}

export function gridfinityBaseplateFootprint(input: GridfinityBaseplateSpec): GridfinityFootprint {
  const spec = normalizeGridfinityBaseplateSpec(input);
  const tab = (side: GridfinitySide) => spec.connectors?.[side] === "tab"
    ? GRIDFINITY_TAB_LENGTH
    : spec.connectors?.[side] === "dovetail" ? GRIDFINITY_DOVETAIL_PROTRUSION : 0;
  const x0 = -spec.unitsX * GRIDFINITY_PITCH / 2 - spec.padLeft - tab("left");
  const x1 = spec.unitsX * GRIDFINITY_PITCH / 2 + spec.padRight + tab("right");
  const z0 = -spec.unitsZ * GRIDFINITY_PITCH / 2 - spec.padBack - tab("back");
  const z1 = spec.unitsZ * GRIDFINITY_PITCH / 2 + spec.padFront + tab("front");
  return {
    width: x1 - x0,
    depth: z1 - z0,
    height: spec.floorThickness + GRIDFINITY_PLATE_HEIGHT,
    offsetX: (x0 + x1) / 2,
    offsetZ: (z0 + z1) / 2,
  };
}

export function gridfinityFootprint(shape: WorkplaneShape): GridfinityFootprint | null {
  if (shape.kind === "gridfinityBin") return gridfinityBinFootprint(shape.gridfinityBin ?? defaultGridfinityBinSpec());
  if (shape.kind === "gridfinityBaseplate") {
    return gridfinityBaseplateFootprint(shape.gridfinityBaseplate ?? defaultGridfinityBaseplateSpec());
  }
  return null;
}

/** Units that best match a dragged footprint, for gizmo / inspector size edits. */
export function gridfinityUnitsForSpan(span: number, extra = 0) {
  return clamp(Math.round((span - extra + GRIDFINITY_BIN_CLEARANCE) / GRIDFINITY_PITCH), 1, GRIDFINITY_MAX_UNITS);
}

export function gridfinityHeightUnitsForHeight(height: number, stackingLip: boolean) {
  const body = height - (stackingLip ? GRIDFINITY_LIP_HEIGHT : 0);
  return clamp(Math.round(body / GRIDFINITY_HEIGHT_UNIT), 1, GRIDFINITY_MAX_HEIGHT_UNITS);
}

export function gridfinityBinName(spec: GridfinityBinSpec) {
  const s = normalizeGridfinityBinSpec(spec);
  return `Gridfinity Bin ${s.unitsX}×${s.unitsZ}×${s.heightUnits}`;
}

export function gridfinityBaseplateName(spec: GridfinityBaseplateSpec) {
  const s = normalizeGridfinityBaseplateSpec(spec);
  return `Gridfinity Baseplate ${s.unitsX}×${s.unitsZ}`;
}

/** Default names the inspector may overwrite when units change. */
export function isDefaultGridfinityName(name: string | undefined) {
  return !name || /^Gridfinity (Bin|Baseplate)\b/.test(name);
}

// --------------------------------------------------------------------------------
// Bin recipe
// --------------------------------------------------------------------------------

type Bounds = { x0: number; x1: number; z0: number; z1: number };

function cornerRadii(inset: number, open: ReadonlySet<GridfinitySide>, outerRadius: number): [number, number, number, number] {
  const r = Math.max(MIN_CORNER_RADIUS, outerRadius - inset);
  const corner = (a: GridfinitySide, b: GridfinitySide) => (open.has(a) || open.has(b) ? 0 : r);
  // (x0,z0) back-left, (x1,z0) back-right, (x1,z1) front-right, (x0,z1) front-left
  return [corner("left", "back"), corner("right", "back"), corner("right", "front"), corner("left", "front")];
}

/** Section of the bin outline inset by `inset` on closed sides; open sides reach past the outline. */
function binSection(
  y: number,
  inset: number,
  outline: Bounds,
  open: ReadonlySet<GridfinitySide>,
  openExtra: number,
): RecipeSection {
  return {
    y,
    x0: open.has("left") ? outline.x0 - openExtra : outline.x0 + inset,
    x1: open.has("right") ? outline.x1 + openExtra : outline.x1 - inset,
    z0: open.has("back") ? outline.z0 - openExtra : outline.z0 + inset,
    z1: open.has("front") ? outline.z1 + openExtra : outline.z1 - inset,
    r: cornerRadii(inset, open, GRIDFINITY_BIN_RADIUS),
  };
}

function cellSection(y: number, inset: number, cx: number, cz: number): RecipeSection {
  const half = (GRIDFINITY_PITCH - GRIDFINITY_BIN_CLEARANCE) / 2 - inset;
  const r = Math.max(MIN_CORNER_RADIUS, GRIDFINITY_BIN_RADIUS - inset);
  return { y, x0: cx - half, x1: cx + half, z0: cz - half, z1: cz + half, r: [r, r, r, r] };
}

function cellCenters(units: number) {
  return Array.from({ length: units }, (_, index) => -units * GRIDFINITY_PITCH / 2 + GRIDFINITY_PITCH / 2 + index * GRIDFINITY_PITCH);
}

/**
 * Keep the part of an ascending (y, inset) profile at or above `fromY`, adding the
 * interpolated point at `fromY`. Points closer than 0.01 mm collapse to one so a
 * loft never sees two sections at the same height.
 */
function clipProfile(profile: Array<[number, number]>, fromY: number): Array<[number, number]> {
  const sorted = [...profile].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const [y, inset] = sorted[index];
    if (y < fromY - 1e-6) {
      const next = sorted[index + 1];
      if (next && next[0] > fromY + 1e-6) {
        const t = (fromY - y) / (next[0] - y);
        out.push([fromY, inset + (next[1] - inset) * t]);
      }
      continue;
    }
    out.push([y, inset]);
  }
  const unique: Array<[number, number]> = [];
  for (const point of out) {
    const last = unique[unique.length - 1];
    if (last && Math.abs(last[0] - point[0]) < 0.01) unique[unique.length - 1] = point;
    else unique.push(point);
  }
  return unique;
}

export function gridfinityBinRecipe(input: GridfinityBinSpec): GridfinityRecipe {
  const spec = normalizeGridfinityBinSpec(input);
  const open = new Set(spec.openSides);
  const foot = gridfinityBinFootprint(spec);
  const t = spec.wallThickness;
  const wallTop = spec.heightUnits * GRIDFINITY_HEIGHT_UNIT;
  const top = foot.height;
  const half = GRIDFINITY_BIN_CLEARANCE / 2;
  const gridHalfX = spec.unitsX * GRIDFINITY_PITCH / 2;
  const gridHalfZ = spec.unitsZ * GRIDFINITY_PITCH / 2;
  // Grid-centred outline; the recipe is shifted to the AABB centre at the end.
  const outline: Bounds = {
    x0: -gridHalfX + (open.has("left") ? 0 : half),
    x1: gridHalfX - (open.has("right") ? 0 : half),
    z0: -gridHalfZ + (open.has("back") ? 0 : half),
    z1: gridHalfZ - (open.has("front") ? 0 : half),
  };
  const ops: RecipeOp[] = [];

  // Body: straight walls from the foot top to the top edge.
  ops.push({
    op: "add",
    solid: {
      kind: "stack",
      sections: [
        binSection(GRIDFINITY_FOOT_HEIGHT, 0, outline, open, 0),
        binSection(top, 0, outline, open, 0),
      ],
    },
  });

  // Feet: one per cell, overlapping 0.5 mm up into the body with a slight inward taper.
  const centersX = cellCenters(spec.unitsX);
  const centersZ = cellCenters(spec.unitsZ);
  for (const cx of centersX) {
    for (const cz of centersZ) {
      ops.push({
        op: "add",
        solid: {
          kind: "stack",
          sections: [
            cellSection(0, 2.95, cx, cz),
            cellSection(0.8, 2.15, cx, cz),
            cellSection(2.6, 2.15, cx, cz),
            cellSection(GRIDFINITY_FOOT_HEIGHT, 0, cx, cz),
            cellSection(GRIDFINITY_FOOT_HEIGHT + OVERLAP, OVERLAP / 2, cx, cz),
          ],
        },
      });
    }
  }

  // Cavity (and stacking-lip socket) as one cut.
  const floorTop = GRIDFINITY_FOOT_HEIGHT + spec.floorThickness;
  const lipStart = wallTop - Math.max(0, GRIDFINITY_LIP_INSET - t);
  // Full-height cavity profile (y, inset from the outline); the floor clips it.
  const profile: Array<[number, number]> = [];
  if (!spec.solid) profile.push([GRIDFINITY_FOOT_HEIGHT, t]);
  if (spec.stackingLip) {
    if (!spec.solid) profile.push([lipStart, t]);
    profile.push(
      [wallTop, GRIDFINITY_LIP_INSET],
      [wallTop + 0.7, 1.9],
      [wallTop + 2.5, 1.9],
      [wallTop + GRIDFINITY_LIP_HEIGHT, 0],
      [wallTop + GRIDFINITY_LIP_HEIGHT + OVERLAP, -OVERLAP],
    );
  } else if (!spec.solid) {
    profile.push([wallTop + OVERLAP, t]);
  }
  const cavityFrom = spec.solid ? wallTop : floorTop;
  const clipped = profile.length ? clipProfile(profile, cavityFrom) : [];
  const cavityOpen = spec.solid ? new Set<GridfinitySide>() : open;
  if (clipped.length >= 2) {
    ops.push({
      op: "cut",
      solid: {
        kind: "stack",
        sections: clipped.map(([y, inset]) => binSection(y, inset, outline, cavityOpen, OVERLAP)),
      },
    });
  }

  // Magnet pockets and screw holes in every foot.
  if (spec.magnets || spec.screws) {
    for (const cx of centersX) {
      for (const cz of centersZ) {
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const px = cx + sx * GRIDFINITY_MAGNET_OFFSET;
            const pz = cz + sz * GRIDFINITY_MAGNET_OFFSET;
            if (spec.magnets) {
              ops.push({
                op: "cut",
                solid: { kind: "cylinder", cx: px, cz: pz, y0: -OVERLAP, y1: GRIDFINITY_MAGNET_DEPTH, r: GRIDFINITY_MAGNET_DIAMETER / 2 },
              });
            }
            if (spec.screws) {
              ops.push({
                op: "cut",
                solid: { kind: "cylinder", cx: px, cz: pz, y0: -OVERLAP, y1: GRIDFINITY_SCREW_DEPTH, r: GRIDFINITY_SCREW_DIAMETER / 2 },
              });
            }
          }
        }
      }
    }
  }

  if (!spec.solid && clipped.length >= 2) {
    const inner: Bounds = {
      x0: open.has("left") ? outline.x0 : outline.x0 + t,
      x1: open.has("right") ? outline.x1 : outline.x1 - t,
      z0: open.has("back") ? outline.z0 : outline.z0 + t,
      z1: open.has("front") ? outline.z1 : outline.z1 - t,
    };
    // Reach into closed walls so the fuse overlaps; stop flush at an open edge.
    const reach = (side: GridfinitySide) => (open.has(side) ? 0 : OVERLAP);
    const dividerTop = wallTop;
    const dividerBottom = floorTop - OVERLAP;

    if (dividerTop > dividerBottom + 0.5) {
      for (let index = 1; index < spec.compartmentsX; index += 1) {
        const x = inner.x0 + ((inner.x1 - inner.x0) * index) / spec.compartmentsX;
        ops.push({
          op: "add",
          solid: {
            kind: "box",
            x0: x - t / 2,
            x1: x + t / 2,
            y0: dividerBottom,
            y1: dividerTop,
            z0: inner.z0 - reach("back"),
            z1: inner.z1 + reach("front"),
          },
        });
      }
      for (let index = 1; index < spec.compartmentsZ; index += 1) {
        const z = inner.z0 + ((inner.z1 - inner.z0) * index) / spec.compartmentsZ;
        ops.push({
          op: "add",
          solid: {
            kind: "box",
            x0: inner.x0 - reach("left"),
            x1: inner.x1 + reach("right"),
            y0: dividerBottom,
            y1: dividerTop,
            z0: z - t / 2,
            z1: z + t / 2,
          },
        });
      }
    }

    if (spec.scoop !== "none" && !open.has(spec.scoop)) {
      const scoopSolid = scoopPrism(spec, inner, floorTop, spec.stackingLip ? lipStart : wallTop, reach);
      if (scoopSolid) ops.push({ op: "add", solid: scoopSolid });
    }
  }

  const recipe: GridfinityRecipe = {
    version: 1,
    ops,
    width: foot.width,
    depth: foot.depth,
    height: top,
  };
  return translateRecipe(recipe, -foot.offsetX, -foot.offsetZ);
}

function scoopPrism(
  spec: GridfinityBinSpec,
  inner: Bounds,
  floorTop: number,
  cavityTop: number,
  reach: (side: GridfinitySide) => number,
): RecipeSolid | null {
  const side = spec.scoop as GridfinitySide;
  const alongX = side === "front" || side === "back";
  const innerSpan = alongX ? inner.z1 - inner.z0 : inner.x1 - inner.x0;
  const maxRadius = Math.min(cavityTop - floorTop - 0.05, innerSpan - 1);
  if (maxRadius < 1) return null;
  const radius = spec.scoopRadius > 0 ? Math.min(spec.scoopRadius, maxRadius) : maxRadius;
  // Wall face coordinate (u) and the direction into the cavity.
  const wall = side === "front" ? inner.z1 : side === "back" ? inner.z0 : side === "right" ? inner.x1 : inner.x0;
  const into = side === "front" || side === "right" ? -1 : 1;
  const u = (offsetIntoCavity: number) => wall + into * offsetIntoCavity;
  const diag = radius * (1 - Math.SQRT1_2);
  const a0 = alongX ? inner.x0 - reach("left") : inner.z0 - reach("back");
  const a1 = alongX ? inner.x1 + reach("right") : inner.z1 + reach("front");
  return {
    kind: "prism",
    axis: alongX ? "x" : "z",
    a0,
    a1,
    start: [u(-OVERLAP), floorTop - OVERLAP],
    steps: [
      { kind: "line", to: [u(radius), floorTop - OVERLAP] },
      { kind: "line", to: [u(radius), floorTop] },
      { kind: "arc", to: [u(0), floorTop + radius], mid: [u(diag), floorTop + diag] },
      { kind: "line", to: [u(-OVERLAP), floorTop + radius] },
    ],
  };
}

// --------------------------------------------------------------------------------
// Baseplate recipe
// --------------------------------------------------------------------------------

export function gridfinityBaseplateRecipe(input: GridfinityBaseplateSpec): GridfinityRecipe {
  const spec = normalizeGridfinityBaseplateSpec(input);
  const foot = gridfinityBaseplateFootprint(spec);
  const floor = spec.floorThickness;
  const height = floor + GRIDFINITY_PLATE_HEIGHT;
  const outline: Bounds = {
    x0: -spec.unitsX * GRIDFINITY_PITCH / 2 - spec.padLeft,
    x1: spec.unitsX * GRIDFINITY_PITCH / 2 + spec.padRight,
    z0: -spec.unitsZ * GRIDFINITY_PITCH / 2 - spec.padBack,
    z1: spec.unitsZ * GRIDFINITY_PITCH / 2 + spec.padFront,
  };
  const r = GRIDFINITY_PLATE_RADIUS;
  const ops: RecipeOp[] = [
    {
      op: "add",
      solid: {
        kind: "stack",
        sections: [
          { y: 0, ...outline, r: [r, r, r, r] },
          { y: height, ...outline, r: [r, r, r, r] },
        ],
      },
    },
  ];

  const centersX = cellCenters(spec.unitsX);
  const centersZ = cellCenters(spec.unitsZ);
  const pocket = (y: number, halfSize: number, cx: number, cz: number): RecipeSection => {
    const radius = Math.max(MIN_CORNER_RADIUS, GRIDFINITY_PLATE_RADIUS - (GRIDFINITY_PITCH / 2 - halfSize));
    return { y, x0: cx - halfSize, x1: cx + halfSize, z0: cz - halfSize, z1: cz + halfSize, r: [radius, radius, radius, radius] };
  };
  const halfPitch = GRIDFINITY_PITCH / 2;

  // Joints are fused before the pockets so a cut never has to split them.
  const connectors = spec.connectors;
  if (connectors) {
    const tabY0 = 0.6;
    const tabY1 = Math.max(tabY0 + 1, floor - 0.6);
    const halfTab = GRIDFINITY_TAB_WIDTH / 2;
    const c = GRIDFINITY_TAB_CLEARANCE;
    const placeTab = (side: GridfinitySide, kind: "tab" | "slot") => {
      const slot = kind === "slot";
      const y0 = slot ? tabY0 - c : tabY0;
      const y1 = slot ? tabY1 + c : tabY1;
      const w = slot ? halfTab + c : halfTab;
      const reach = GRIDFINITY_TAB_LENGTH + (slot ? c : 0);
      const along = side === "left" || side === "right" ? centersZ : centersX;
      for (const center of along) {
        let box: RecipeSolid;
        if (side === "left") {
          box = { kind: "box", x0: slot ? outline.x0 - OVERLAP : outline.x0 - reach, x1: slot ? outline.x0 + reach : outline.x0 + OVERLAP, y0, y1, z0: center - w, z1: center + w };
        } else if (side === "right") {
          box = { kind: "box", x0: slot ? outline.x1 - reach : outline.x1 - OVERLAP, x1: slot ? outline.x1 + OVERLAP : outline.x1 + reach, y0, y1, z0: center - w, z1: center + w };
        } else if (side === "back") {
          box = { kind: "box", x0: center - w, x1: center + w, y0, y1, z0: slot ? outline.z0 - OVERLAP : outline.z0 - reach, z1: slot ? outline.z0 + reach : outline.z0 + OVERLAP };
        } else {
          box = { kind: "box", x0: center - w, x1: center + w, y0, y1, z0: slot ? outline.z1 - reach : outline.z1 - OVERLAP, z1: slot ? outline.z1 + OVERLAP : outline.z1 + reach };
        }
        ops.push({ op: slot ? "cut" : "add", solid: box });
      }
    };
    // Full-height trapezoid, narrow at the wall and wider at the tip, so two
    // open frames slide together. One at each wall between cells; a single cell
    // gets one in the middle of that edge.
    const relief = new Set<string>();
    const placeDovetail = (side: GridfinitySide, groove: boolean) => {
      const horizontal = side === "left" || side === "right";
      const outward: 1 | -1 = side === "right" || side === "front" ? 1 : -1;
      const wall = side === "left" ? outline.x0 : side === "right" ? outline.x1 : side === "back" ? outline.z0 : outline.z1;
      const units = horizontal ? spec.unitsZ : spec.unitsX;
      const centers = horizontal ? centersZ : centersX;
      const start = -units * GRIDFINITY_PITCH / 2;
      const stations = units <= 1 ? [0] : Array.from({ length: units - 1 }, (_, index) => start + (index + 1) * GRIDFINITY_PITCH);
      const base = groove ? DOVETAIL_BASE_HALF + DOVETAIL_CLEARANCE : DOVETAIL_BASE_HALF;
      const tip = groove ? DOVETAIL_TIP_HALF + DOVETAIL_CLEARANCE : DOVETAIL_TIP_HALF;
      const reach = groove ? GRIDFINITY_DOVETAIL_PROTRUSION + DOVETAIL_CLEARANCE : GRIDFINITY_DOVETAIL_PROTRUSION;
      const mouth = wall + outward * (groove ? OVERLAP : -OVERLAP);
      const tipAt = wall + outward * (groove ? -reach : reach);
      for (const bp of stations) {
        const corners: [number, number][] = horizontal
          ? [[mouth, bp + base], [tipAt, bp + tip], [tipAt, bp - tip], [mouth, bp - base]]
          : [[bp + base, mouth], [bp + tip, tipAt], [bp - tip, tipAt], [bp - base, mouth]];
        let area = 0;
        for (let i = 0; i < corners.length; i += 1) {
          const [x1, z1] = corners[i];
          const [x2, z2] = corners[(i + 1) % corners.length];
          area += x1 * z2 - x2 * z1;
        }
        const points = area < 0 ? [...corners].reverse() : corners;
        const [first, ...rest] = points;
        ops.push({
          op: groove ? "cut" : "add",
          solid: {
            kind: "prism",
            axis: "y",
            a0: groove ? -OVERLAP : 0,
            a1: groove ? height + OVERLAP : height,
            start: first,
            steps: rest.map((to) => ({ kind: "line", to })),
          },
        });
        if (groove) continue;
        for (const center of centers) {
          if (Math.abs(center - bp) > halfPitch + 1e-6) continue;
          const across = wall + outward * halfPitch;
          const cx = horizontal ? across : center;
          const cz = horizontal ? center : across;
          relief.add(`${cx.toFixed(3)},${cz.toFixed(3)}`);
        }
      }
    };
    for (const side of GRIDFINITY_SIDES) {
      const kind = connectors[side];
      if (kind === "tab" || kind === "slot") placeTab(side, kind);
      else if (kind === "dovetail" || kind === "groove") placeDovetail(side, kind === "groove");
    }
    for (const key of relief) {
      const [cx, cz] = key.split(",").map(Number);
      const sections: RecipeSection[] = [
        pocket(height + OVERLAP, halfPitch, cx, cz),
        pocket(height, halfPitch, cx, cz),
        pocket(height - 2.15, halfPitch - 2.15, cx, cz),
        pocket(height - 3.95, halfPitch - 2.15, cx, cz),
        pocket(floor, halfPitch - 2.85, cx, cz),
      ];
      if (floor <= 0) sections.push(pocket(-OVERLAP, halfPitch - 2.85, cx, cz));
      ops.push({ op: "cut", solid: { kind: "stack", sections: sections.sort((a, b) => a.y - b.y) } });
    }
  }

  for (const cx of centersX) {
    for (const cz of centersZ) {
      const sections: RecipeSection[] = [
        pocket(height + OVERLAP, halfPitch + OVERLAP, cx, cz),
        pocket(height, halfPitch, cx, cz),
        pocket(height - 2.15, halfPitch - 2.15, cx, cz),
        pocket(height - 3.95, halfPitch - 2.15, cx, cz),
        pocket(floor, halfPitch - 2.85, cx, cz),
      ];
      if (floor <= 0) sections.push(pocket(-OVERLAP, halfPitch - 2.85, cx, cz));
      ops.push({ op: "cut", solid: { kind: "stack", sections: sections.sort((a, b) => a.y - b.y) } });

      if (floor > 0 && spec.magnets) {
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            ops.push({
              op: "cut",
              solid: {
                kind: "cylinder",
                cx: cx + sx * GRIDFINITY_MAGNET_OFFSET,
                cz: cz + sz * GRIDFINITY_MAGNET_OFFSET,
                y0: floor - GRIDFINITY_MAGNET_DEPTH,
                y1: floor + OVERLAP,
                r: GRIDFINITY_MAGNET_DIAMETER / 2,
              },
            });
          }
        }
      }
      if (floor > 0 && spec.screws) {
        const through = 1.7;
        const head = 3.25;
        ops.push({ op: "cut", solid: { kind: "cylinder", cx, cz, y0: -OVERLAP, y1: floor + OVERLAP, r: through } });
        ops.push({
          op: "cut",
          solid: { kind: "cone", cx, cz, y0: floor - (head - through), r0: through, y1: floor + OVERLAP, r1: head + OVERLAP },
        });
      }
    }
  }

  const recipe: GridfinityRecipe = { version: 1, ops, width: foot.width, depth: foot.depth, height };
  return translateRecipe(recipe, -foot.offsetX, -foot.offsetZ);
}

export function gridfinityRecipeForShape(shape: WorkplaneShape): GridfinityRecipe | null {
  if (shape.kind === "gridfinityBin") return gridfinityBinRecipe(shape.gridfinityBin ?? defaultGridfinityBinSpec());
  if (shape.kind === "gridfinityBaseplate") {
    return gridfinityBaseplateRecipe(shape.gridfinityBaseplate ?? defaultGridfinityBaseplateSpec());
  }
  return null;
}

function translateRecipe(recipe: GridfinityRecipe, dx: number, dz: number): GridfinityRecipe {
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return recipe;
  const move = (solid: RecipeSolid): RecipeSolid => {
    switch (solid.kind) {
      case "stack":
        return {
          kind: "stack",
          sections: solid.sections.map((s) => ({ ...s, x0: s.x0 + dx, x1: s.x1 + dx, z0: s.z0 + dz, z1: s.z1 + dz })),
        };
      case "cylinder":
      case "cone":
        return { ...solid, cx: solid.cx + dx, cz: solid.cz + dz };
      case "box":
        return { ...solid, x0: solid.x0 + dx, x1: solid.x1 + dx, z0: solid.z0 + dz, z1: solid.z1 + dz };
      case "prism": {
        if (solid.axis === "y") {
          const shift = (point: [number, number]): [number, number] => [point[0] + dx, point[1] + dz];
          return {
            ...solid,
            start: shift(solid.start),
            steps: solid.steps.map((step) => step.kind === "arc"
              ? { kind: "arc", to: shift(step.to), mid: shift(step.mid) }
              : { kind: "line", to: shift(step.to) }),
          };
        }
        const du = solid.axis === "x" ? dz : dx;
        const da = solid.axis === "x" ? dx : dz;
        return {
          ...solid,
          a0: solid.a0 + da,
          a1: solid.a1 + da,
          start: [solid.start[0] + du, solid.start[1]],
          steps: solid.steps.map((step) => step.kind === "arc"
            ? { kind: "arc", to: [step.to[0] + du, step.to[1]], mid: [step.mid[0] + du, step.mid[1]] }
            : { kind: "line", to: [step.to[0] + du, step.to[1]] }),
        };
      }
      default:
        return solid;
    }
  };
  return { ...recipe, ops: recipe.ops.map((op) => ({ op: op.op, solid: move(op.solid) })) };
}

// --------------------------------------------------------------------------------
// Drawer fit and print-bed split
// --------------------------------------------------------------------------------

/** Units and even padding that fill a drawer of the given inner size (0.5 mm clearance). */
export function gridfinityDrawerFit(innerWidth: number, innerLength: number, current: GridfinityBaseplateSpec): GridfinityBaseplateSpec {
  const fit = (inner: number) => {
    const usable = Math.max(0, inner - GRIDFINITY_BIN_CLEARANCE);
    const units = clamp(Math.floor(usable / GRIDFINITY_PITCH), 1, GRIDFINITY_MAX_UNITS);
    const spare = Math.max(0, usable - units * GRIDFINITY_PITCH);
    const pad = Math.min(GRIDFINITY_MAX_PADDING, Math.floor((spare / 2) * 10) / 10);
    return { units, pad };
  };
  const x = fit(innerWidth);
  const z = fit(innerLength);
  return normalizeGridfinityBaseplateSpec({
    ...current,
    unitsX: x.units,
    unitsZ: z.units,
    padLeft: x.pad,
    padRight: x.pad,
    padBack: z.pad,
    padFront: z.pad,
    drawerWidth: innerWidth,
    drawerLength: innerLength,
  });
}

export type GridfinityPlatePiece = {
  spec: GridfinityBaseplateSpec;
  /** Grid-outline centre of this piece relative to the original plate's grid centre. */
  gridX: number;
  gridZ: number;
  /** Column / row of the piece in the split. */
  col: number;
  row: number;
};

function splitUnits(total: number, maxPerPiece: number): number[] {
  const pieces = Math.max(1, Math.ceil(total / Math.max(1, maxPerPiece)));
  const base = Math.floor(total / pieces);
  const extra = total - base * pieces;
  return Array.from({ length: pieces }, (_, index) => base + (index < extra ? 1 : 0));
}

/**
 * Break a baseplate into pieces that each fit the printer bed. Padding stays on the
 * outer edges. An open frame gets dovetails on the cut edges. A plate with a solid
 * bottom keeps tabs and slots. Returns null when the plate already fits.
 */
export function gridfinitySplitForBed(
  input: GridfinityBaseplateSpec,
  bed: { width: number; depth: number },
  options: { connectors: boolean; margin?: number; gap?: number },
): GridfinityPlatePiece[] | null {
  const spec = normalizeGridfinityBaseplateSpec({ ...input, connectors: undefined });
  const margin = options.margin ?? 5;
  const usableX = bed.width - 2 * margin;
  const usableZ = bed.depth - 2 * margin;
  const whole = gridfinityBaseplateFootprint(spec);
  if (whole.width <= usableX + 1e-6 && whole.depth <= usableZ + 1e-6) return null;
  const openFrame = spec.floorThickness <= 0;
  const reach = options.connectors ? (openFrame ? GRIDFINITY_DOVETAIL_PROTRUSION : GRIDFINITY_TAB_LENGTH) : 0;

  const plan = (units: number, padA: number, padB: number, usable: number) => {
    let maxUnits = Math.max(1, Math.floor((usable - reach) / GRIDFINITY_PITCH));
    for (let guard = 0; guard < 64; guard += 1) {
      const parts = splitUnits(units, maxUnits);
      const fits = parts.every((count, index) => {
        const first = index === 0;
        const last = index === parts.length - 1;
        const span = count * GRIDFINITY_PITCH
          + (first ? padA : 0)
          + (last ? padB : 0)
          + (parts.length > 1 && !last ? reach : 0);
        return span <= usable + 1e-6;
      });
      if (fits) return parts;
      if (maxUnits === 1) break;
      maxUnits -= 1;
    }
    return null;
  };

  const partsX = plan(spec.unitsX, spec.padLeft, spec.padRight, usableX);
  const partsZ = plan(spec.unitsZ, spec.padBack, spec.padFront, usableZ);
  if (!partsX || !partsZ) return null;

  const gap = options.gap ?? 12;
  const pieces: GridfinityPlatePiece[] = [];
  let startX = -spec.unitsX * GRIDFINITY_PITCH / 2;
  let shiftX = 0;
  for (let col = 0; col < partsX.length; col += 1) {
    const unitsX = partsX[col];
    const firstX = col === 0;
    const lastX = col === partsX.length - 1;
    let startZ = -spec.unitsZ * GRIDFINITY_PITCH / 2;
    let shiftZ = 0;
    for (let row = 0; row < partsZ.length; row += 1) {
      const unitsZ = partsZ[row];
      const firstZ = row === 0;
      const lastZ = row === partsZ.length - 1;
      const connectors: Partial<Record<GridfinitySide, GridfinityConnector>> = {};
      if (options.connectors) {
        if (openFrame) {
          if (!firstX) connectors.left = "groove";
          if (!lastX) connectors.right = "dovetail";
          if (!firstZ) connectors.back = "groove";
          if (!lastZ) connectors.front = "dovetail";
        } else {
          if (!firstX) connectors.left = "slot";
          if (!lastX) connectors.right = "tab";
          if (!firstZ) connectors.back = "slot";
          if (!lastZ) connectors.front = "tab";
        }
      }
      const piece = normalizeGridfinityBaseplateSpec({
        ...spec,
        unitsX,
        unitsZ,
        padLeft: firstX ? spec.padLeft : 0,
        padRight: lastX ? spec.padRight : 0,
        padBack: firstZ ? spec.padBack : 0,
        padFront: lastZ ? spec.padFront : 0,
        drawerWidth: 0,
        drawerLength: 0,
        connectors: Object.keys(connectors).length ? connectors : undefined,
      });
      pieces.push({
        spec: piece,
        gridX: startX + unitsX * GRIDFINITY_PITCH / 2 + shiftX,
        gridZ: startZ + unitsZ * GRIDFINITY_PITCH / 2 + shiftZ,
        col,
        row,
      });
      startZ += unitsZ * GRIDFINITY_PITCH;
      shiftZ += gap + reach;
    }
    startX += unitsX * GRIDFINITY_PITCH;
    shiftX += gap + reach;
  }
  return pieces;
}
