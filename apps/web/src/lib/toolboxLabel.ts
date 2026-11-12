import type { CrossSection, Manifold, ManifoldToplevel, Vec2 } from "manifold-3d";
import { withCsgMeta } from "@/lib/csgTree";
import { cloneAsGroupChild } from "@/lib/editorGroup";
import { boundsForShapes } from "@/lib/editorShapeMesh";
import { createLocalId } from "@/lib/localIds";
import { resolveTextFont, textFontCurveSegments } from "@/lib/textFonts";
import { canonicalizeShape, shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { ToolboxLabelMagnetSize, ToolboxLabelSpec, WorkplaneShape } from "@/types/sketchforge";

/**
 * Magnetic labels for the drawer fronts of steel tool boxes: a plate, raised letters in a
 * second colour on top, and magnet pockets in the back. Each label is a Tie of its plate and
 * its letters, so they stay two parts (two colours in a 3MF) and Ungroup takes them apart.
 * The solids are made with Manifold, which runs the same in the desktop app and the browser.
 */

export const TOOLBOX_LABEL_PLATE_COLOR = "#1d1f22";
export const TOOLBOX_LABEL_LETTER_COLOR = "#f2f2ee";
/** Mintr's bold, wide font: the free stand-in for tool box lettering. */
export const TOOLBOX_LABEL_FONT = "Heavy";
/** Close to the orange of US General tool boxes, for orange labels. */
export const TOOLBOX_LABEL_ORANGE = "#e8611a";

/** Round magnets people buy for this, diameter × thickness in mm. */
export const TOOLBOX_MAGNET_SIZES: Record<Exclude<ToolboxLabelMagnetSize, "custom">, { diameter: number; depth: number }> = {
  "6x2": { diameter: 6, depth: 2 },
  "8x3": { diameter: 8, depth: 3 },
  "10x3": { diameter: 10, depth: 3 },
  "12x3": { diameter: 12, depth: 3 },
};

/** Plastic left over an open pocket: the bridge the printer lays across the magnet. */
export const OPEN_POCKET_MIN_ROOF = 0.3;
/** Plastic kept above and below a sealed magnet, so it does not show through. */
export const HIDDEN_POCKET_MIN_SKIN = 0.6;
/** Plastic kept between a pocket and the plate's edge. */
const POCKET_MIN_WALL = 1;
/** One magnet about every this many mm along a label. */
const MAGNET_SPACING = 50;
/** Labels in one set: more than a few tool chests' worth. */
export const MAX_LABELS = 100;

export function defaultToolboxLabelSpec(): ToolboxLabelSpec {
  return {
    labels: [{ text: "SOCKETS" }],
    allCaps: true,
    font: TOOLBOX_LABEL_FONT,
    slant: 12,
    letterHeight: 8,
    letterSpacing: 0,
    raise: 1,
    plateShape: "rounded",
    cornerRadius: 3,
    padSides: 6,
    padEnds: 4,
    // An 8 × 3 magnet's pocket is 3.2 deep, leaving 0.8 mm over it.
    thickness: 4,
    sameHeight: true,
    sameWidth: false,
    edgeRound: 0.4,
    magnetSize: "8x3",
    magnetDiameter: 8,
    magnetDepth: 3,
    fitAcross: 0.15,
    fitDeep: 0.2,
    magnetCount: 0,
    pocket: "open",
    preset: "usGeneral",
    plateColor: TOOLBOX_LABEL_PLATE_COLOR,
    letterColor: TOOLBOX_LABEL_LETTER_COLOR,
  };
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
};

/** Settings made safe to build from, whatever a file or an older version saved. */
export function normalizeToolboxLabelSpec(input?: Partial<ToolboxLabelSpec> | null): ToolboxLabelSpec {
  const base = defaultToolboxLabelSpec();
  const spec = { ...base, ...(input ?? {}) };
  const labels = (Array.isArray(spec.labels) ? spec.labels : base.labels)
    .map((label) => ({
      text: typeof label?.text === "string" ? label.text : "",
      ...(typeof label?.letterHeight === "number" && label.letterHeight > 0 ? { letterHeight: clamp(label.letterHeight, 1, 500, base.letterHeight) } : {}),
    }))
    .filter((label) => label.text.trim().length > 0)
    .slice(0, MAX_LABELS);
  const magnetSize: ToolboxLabelMagnetSize = spec.magnetSize in TOOLBOX_MAGNET_SIZES || spec.magnetSize === "custom" ? spec.magnetSize : base.magnetSize;
  const preset = magnetSize === "custom" ? null : TOOLBOX_MAGNET_SIZES[magnetSize];
  return {
    labels: labels.length > 0 ? labels : base.labels,
    allCaps: spec.allCaps !== false,
    font: typeof spec.font === "string" && spec.font.trim() ? spec.font : base.font,
    slant: clamp(spec.slant, 0, 20, base.slant),
    letterHeight: clamp(spec.letterHeight, 1, 500, base.letterHeight),
    letterSpacing: clamp(spec.letterSpacing, -5, 50, base.letterSpacing),
    raise: clamp(spec.raise, 0.2, 20, base.raise),
    plateShape: spec.plateShape === "follow" ? "follow" : "rounded",
    cornerRadius: clamp(spec.cornerRadius, 0, 100, base.cornerRadius),
    padSides: clamp(spec.padSides, 0, 200, base.padSides),
    padEnds: clamp(spec.padEnds, 0, 200, base.padEnds),
    thickness: clamp(spec.thickness, 0.6, 50, base.thickness),
    sameHeight: spec.sameHeight !== false,
    sameWidth: Boolean(spec.sameWidth),
    edgeRound: clamp(spec.edgeRound, 0, 1, base.edgeRound),
    magnetSize,
    magnetDiameter: preset ? preset.diameter : clamp(spec.magnetDiameter, 1, 100, base.magnetDiameter),
    magnetDepth: preset ? preset.depth : clamp(spec.magnetDepth, 0.5, 40, base.magnetDepth),
    fitAcross: clamp(spec.fitAcross, 0, 2, base.fitAcross),
    fitDeep: clamp(spec.fitDeep, 0, 2, base.fitDeep),
    magnetCount: Math.round(clamp(spec.magnetCount, 0, 50, 0)),
    pocket: spec.pocket === "hidden" ? "hidden" : "open",
    preset: spec.preset === "custom" ? "custom" : "usGeneral",
    plateColor: typeof spec.plateColor === "string" ? spec.plateColor : base.plateColor,
    letterColor: typeof spec.letterColor === "string" ? spec.letterColor : base.letterColor,
  };
}

export function toolboxLabelText(spec: Pick<ToolboxLabelSpec, "allCaps">, text: string) {
  const trimmed = text.trim();
  return spec.allCaps ? trimmed.toUpperCase() : trimmed;
}

/** Magnets along a label: one about every 50 mm, at least one. */
export function autoMagnetCount(plateWidth: number) {
  return Math.max(1, Math.ceil(plateWidth / MAGNET_SPACING - 1e-6));
}

/** How many pockets of this width fit along a plate, with a wall between them and at each end. */
export function magnetsThatFit(plateWidth: number, pocketDiameter: number) {
  return Math.max(0, Math.floor((plateWidth - POCKET_MIN_WALL + 1e-6) / (pocketDiameter + POCKET_MIN_WALL)));
}

/** The pocket a magnet sits in, with the fit clearance added. */
export function magnetPocket(spec: Pick<ToolboxLabelSpec, "magnetDiameter" | "magnetDepth" | "fitAcross" | "fitDeep">) {
  return { diameter: spec.magnetDiameter + spec.fitAcross, depth: spec.magnetDepth + spec.fitDeep };
}

/** The height to pause the print at to drop a hidden magnet in: the top of its pocket. */
export function hiddenPocketPauseHeight(spec: Pick<ToolboxLabelSpec, "magnetDiameter" | "magnetDepth" | "fitAcross" | "fitDeep">) {
  return HIDDEN_POCKET_MIN_SKIN + magnetPocket(spec).depth;
}

/** What stops the magnets fitting in a plate this size, in plain words, or null when they fit. */
export function magnetFitProblem(spec: ToolboxLabelSpec, plateHeight: number, plateWidth?: number): string | null {
  const pocket = magnetPocket(spec);
  if (spec.pocket === "hidden") {
    const needed = pocket.depth + HIDDEN_POCKET_MIN_SKIN * 2;
    if (spec.thickness < needed - 1e-6) {
      return `A hidden ${spec.magnetDiameter} × ${spec.magnetDepth} mm magnet needs a plate at least ${round1(needed)} mm thick. Make the plate thicker, pick a thinner magnet, or use open pockets.`;
    }
  } else if (spec.thickness - pocket.depth < OPEN_POCKET_MIN_ROOF - 1e-6) {
    const needed = pocket.depth + OPEN_POCKET_MIN_ROOF;
    return `A ${spec.magnetDiameter} × ${spec.magnetDepth} mm magnet needs a plate at least ${round1(needed)} mm thick. Make the plate thicker or pick a thinner magnet.`;
  }
  if (pocket.diameter + POCKET_MIN_WALL * 2 > plateHeight + 1e-6) {
    return `${spec.magnetDiameter} mm magnets are too wide for a ${round1(plateHeight)} mm tall label. Make the letters or the space around them bigger, or pick smaller magnets.`;
  }
  if (plateWidth !== undefined && magnetsThatFit(plateWidth, pocket.diameter) === 0) {
    return `${spec.magnetDiameter} mm magnets don't fit along a ${round1(plateWidth)} mm wide label. Add padding at the sides or pick smaller magnets.`;
  }
  return null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** A rounded rectangle centred on the origin. */
function roundedRectangle(width: number, height: number, radius: number): Vec2[] {
  const r = Math.max(0, Math.min(radius, width / 2 - 0.01, height / 2 - 0.01));
  const hw = width / 2;
  const hh = height / 2;
  if (r < 0.01) return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const points: Vec2[] = [];
  const corners: [number, number, number][] = [[hw - r, -hh + r, -90], [hw - r, hh - r, 0], [-hw + r, hh - r, 90], [-hw + r, -hh + r, 180]];
  const steps = 12;
  for (const [cx, cy, start] of corners) {
    for (let step = 0; step <= steps; step += 1) {
      const angle = ((start + (90 * step) / steps) * Math.PI) / 180;
      points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
  }
  return points;
}

/** Slices in a rounded top edge: each well under a print layer, so the steps never show. */
const EDGE_ROUND_SLICES = 10;

/**
 * An outline pushed up `thickness`, its top edge rounded over by `round`. The round is thin
 * layers, each drawn in a little more, following a quarter circle.
 */
function roundedTopSlab(runtime: ManifoldToplevel, outline: CrossSection, thickness: number, round: number): Manifold {
  const r = Math.min(round, thickness * 0.5);
  if (r < 0.02) return outline.extrude(thickness);
  const layers: Manifold[] = [outline.extrude(thickness - r)];
  for (let slice = 0; slice < EDGE_ROUND_SLICES; slice += 1) {
    const top = (r * (slice + 1)) / EDGE_ROUND_SLICES;
    const inset = r - Math.sqrt(Math.max(0, r * r - top * top));
    const ring = outline.offset(-inset, "Round", 2, 32);
    const raw = ring.extrude(r / EDGE_ROUND_SLICES);
    layers.push(raw.translate([0, 0, thickness - r + (r * slice) / EDGE_ROUND_SLICES]));
    raw.delete();
    ring.delete();
  }
  const slab = runtime.Manifold.union(layers);
  layers.forEach((layer) => layer.delete());
  return slab;
}

/** How tall a capital is in the font's own units, from its H. */
function capHeightUnits(font: ReturnType<typeof resolveTextFont>) {
  const resolution = font.data.resolution;
  let min = Infinity;
  let max = -Infinity;
  for (const shape of font.generateShapes("H", resolution)) {
    for (const point of shape.getPoints(2)) {
      min = Math.min(min, point.y);
      max = Math.max(max, point.y);
    }
  }
  return max > min ? max - min : resolution * 0.7;
}

/**
 * The letters of one label as a flat outline, laid out along a line with the baseline at y = 0
 * and capitals `capHeight` tall, leaning by `slant` degrees.
 */
export function letterOutline(
  runtime: ManifoldToplevel,
  text: string,
  options: { font: string; capHeight: number; spacing: number; slant: number; skipped?: Set<string> },
): CrossSection | null {
  const font = resolveTextFont(options.font);
  const resolution = font.data.resolution;
  const size = (options.capHeight * resolution) / capHeightUnits(font);
  const unit = size / resolution;
  const lean = Math.tan((options.slant * Math.PI) / 180);
  const segments = Math.max(textFontCurveSegments(options.font), 6);
  const glyphs = font.data.glyphs as Record<string, { ha?: number } | undefined>;
  const pieces: CrossSection[] = [];
  let cursor = 0;
  for (const char of Array.from(text)) {
    const glyph = glyphs[char];
    // A letter the font does not have is left out (and reported), rather than printed as "?".
    if (char.trim() && !glyph) {
      options.skipped?.add(char);
      continue;
    }
    if (char.trim()) {
      for (const shape of font.generateShapes(char, size)) {
        const { shape: outer, holes } = shape.extractPoints(segments);
        const contour = (points: { x: number; y: number }[]): Vec2[] => points.map((point) => [point.x + cursor + point.y * lean, point.y]);
        const loops = [outer, ...holes].filter((loop) => loop.length >= 3).map(contour);
        if (loops.length === 0) continue;
        pieces.push(new runtime.CrossSection(loops, "EvenOdd"));
      }
    }
    cursor += (glyph?.ha ?? resolution) * unit + options.spacing;
  }
  if (pieces.length === 0) return null;
  const joined = runtime.CrossSection.union(pieces);
  pieces.forEach((piece) => piece.delete());
  if (joined.isEmpty()) {
    joined.delete();
    return null;
  }
  return joined;
}

/** A Manifold solid (Z up, +Y towards the back) as a mesh part sitting where it was made. */
function meshPart(solid: Manifold, base: { name: string; color: string }, at: { x: number; z: number }): WorkplaneShape | null {
  const mesh = solid.getMesh();
  const stride = mesh.numProp;
  const count = mesh.vertProperties.length / stride;
  if (count < 3 || mesh.triVerts.length < 3) return null;
  // Mintr is Y up with -Z towards the back, so (x, y, z) here is (x, z, -y) there.
  const world: number[] = new Array(count * 3);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const x = mesh.vertProperties[index * stride];
    const y = mesh.vertProperties[index * stride + 2];
    const z = -mesh.vertProperties[index * stride + 1];
    world[index * 3] = x;
    world[index * 3 + 1] = y;
    world[index * 3 + 2] = z;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const positions = world.map((value, index) => (index % 3 === 0 ? value - cx : index % 3 === 1 ? value - minY : value - cz));
  const width = maxX - minX;
  const height = maxY - minY;
  const depth = maxZ - minZ;
  return canonicalizeShape({
    id: createLocalId("toolbox-label-part"),
    name: base.name,
    kind: "mesh",
    color: base.color,
    x: at.x + cx,
    z: at.z + cz,
    elevation: minY,
    size: Math.max(width, depth),
    width,
    depth,
    height,
    rotation: 0,
    rotationX: 0,
    rotationZ: 0,
    importedMesh: {
      positions,
      indices: Array.from(mesh.triVerts),
      baseWidth: width,
      baseDepth: depth,
      baseHeight: height,
      triangleCount: mesh.triVerts.length / 3,
      sourceFormat: "json",
    },
    locked: false,
    hidden: false,
  });
}

/** A Tie of parts: they stay apart and move together. Works for one part too, unlike Group. */
export function tieOf(parts: WorkplaneShape[], name: string, color: string): WorkplaneShape {
  const bounds = boundsForShapes(parts);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const height = bounds.maxY - bounds.minY;
  return withCsgMeta({
    id: createLocalId("toolbox-label"),
    name,
    kind: "mesh",
    color,
    x: cx,
    z: cz,
    elevation: bounds.minY,
    size: Math.max(width, depth),
    width,
    depth,
    height,
    rotation: 0,
    groupedBaseWidth: width,
    groupedBaseDepth: depth,
    groupedBaseHeight: height,
    groupedShapes: parts.map((part) => cloneAsGroupChild(part, cx, cz, bounds.minY)),
    locked: false,
    hidden: false,
  }, "assemble", 1, false);
}

export type ToolboxLabelBuild = {
  /** Plate and letters, centred on the origin. */
  plate: WorkplaneShape;
  letters: WorkplaneShape;
  plateWidth: number;
  plateHeight: number;
  magnets: number;
  problem: string | null;
};

/** One label's letters, measured: the outline centred on the label, and the plate it needs. */
type MeasuredLabel = {
  text: string;
  letters2d: CrossSection;
  plateWidth: number;
  plateHeight: number;
  /** Letters the font does not have, left out. */
  skipped: string[];
};

function measureLabel(runtime: ManifoldToplevel, spec: ToolboxLabelSpec, label: ToolboxLabelSpec["labels"][number]): MeasuredLabel | null {
  const text = toolboxLabelText(spec, label.text);
  const capHeight = label.letterHeight ?? spec.letterHeight;
  const skipped = new Set<string>();
  const outline = letterOutline(runtime, text, { font: spec.font, capHeight, spacing: spec.letterSpacing, slant: spec.slant, skipped });
  if (!outline) return null;
  const ink = outline.bounds();
  // Letters centred across the label, and centred on their capitals so a label with
  // descenders (pliers) lines up with one without.
  const shiftX = -(ink.min[0] + ink.max[0]) / 2;
  const letters2d = outline.translate([shiftX, -capHeight / 2]);
  outline.delete();
  const inkBottom = ink.min[1] - capHeight / 2;
  const inkTop = ink.max[1] - capHeight / 2;
  // Round letters (S, O) poke a hair past the capitals; only real descenders and accents
  // make the plate taller, so labels in a set come out the same height.
  const overshoot = capHeight * 0.08;
  const past = Math.max(Math.abs(inkBottom), Math.abs(inkTop)) - capHeight / 2;
  const reach = capHeight / 2 + (past > overshoot ? past : 0);
  return {
    text,
    letters2d,
    plateWidth: ink.max[0] - ink.min[0] + spec.padSides * 2,
    plateHeight: reach * 2 + spec.padEnds * 2,
    skipped: [...skipped],
  };
}

/** One label's plate and letters, centred on (x, z) with the plate on the bed. */
export function buildOneToolboxLabel(runtime: ManifoldToplevel, spec: ToolboxLabelSpec, label: ToolboxLabelSpec["labels"][number], at: { x: number; z: number } = { x: 0, z: 0 }): ToolboxLabelBuild | null {
  const measured = measureLabel(runtime, spec, label);
  if (!measured) return null;
  return buildMeasuredLabel(runtime, spec, measured, measured.plateWidth, measured.plateHeight, at);
}

/** A measured label built at a plate size at least as big as it needs. Frees its outline. */
function buildMeasuredLabel(runtime: ManifoldToplevel, spec: ToolboxLabelSpec, measured: MeasuredLabel, plateWidth: number, plateHeight: number, at: { x: number; z: number }): ToolboxLabelBuild | null {
  const { text, letters2d } = measured;
  const plateOutline = new runtime.CrossSection([roundedRectangle(plateWidth, plateHeight, spec.cornerRadius)], "Positive");
  let plate = roundedTopSlab(runtime, plateOutline, spec.thickness, spec.edgeRound);
  plateOutline.delete();

  const problem = magnetFitProblem(spec, plateHeight, plateWidth);
  const wanted =spec.magnetCount > 0 ? spec.magnetCount : autoMagnetCount(plateWidth);
  const pocket = magnetPocket(spec);
  const radius = pocket.diameter / 2;
  // Pockets keep a wall to the plate's ends and between each other, so asking for more than
  // fit gives as many as fit instead of a slot through the plate.
  const count = Math.min(wanted, magnetsThatFit(plateWidth, pocket.diameter));
  let magnets = 0;
  if (!problem && count > 0) {
    const bottom = spec.pocket === "hidden" ? HIDDEN_POCKET_MIN_SKIN : -0.01;
    const depth = spec.pocket === "hidden" ? pocket.depth : pocket.depth + 0.01;
    // Pockets sit evenly across `reach`; the outermost centres stay a radius and a wall in from
    // the plate's ends.
    const outermost = plateWidth / 2 - radius - POCKET_MIN_WALL;
    const reach = count > 1 ? Math.min(plateWidth - spec.padSides, (2 * outermost * count) / (count - 1)) : 0;
    for (let index = 0; index < count; index += 1) {
      const x = count === 1 ? 0 : -reach / 2 + (reach * (index + 0.5)) / count;
      const raw = runtime.Manifold.cylinder(depth, radius, radius, 64);
      const cutter = raw.translate([x, 0, bottom]);
      raw.delete();
      const cut = plate.subtract(cutter);
      plate.delete();
      cutter.delete();
      plate = cut;
      magnets += 1;
    }
  }

  const rawLetters = letters2d.extrude(spec.raise);
  const lettersSolid = rawLetters.translate([0, 0, spec.thickness]);
  rawLetters.delete();
  letters2d.delete();
  const name = text;
  const platePart = meshPart(plate, { name: `${name} plate`, color: spec.plateColor }, at);
  const letterPart = meshPart(lettersSolid, { name: `${name} letters`, color: spec.letterColor }, at);
  plate.delete();
  lettersSolid.delete();
  if (!platePart || !letterPart) return null;
  return { plate: platePart, letters: letterPart, plateWidth, plateHeight, magnets, problem };
}

/** Space between labels on the bed. */
export const LABEL_GAP = 4;
/** Space between one bed-sized plate of labels and the next. */
export const PLATE_GAP = 20;
/** The bed used when none is given: a common 220 mm printer. */
const FALLBACK_BED = { width: 220, depth: 220 };

export type LabelPlacement = {
  /** Which printer plate the label is on, from 0. */
  plate: number;
  /** The label's centre: x to the right, y towards the front, from the back-left of plate 1. */
  x: number;
  y: number;
  /** Wider or deeper than the bed, so it cannot print however it is placed. */
  tooBig: boolean;
};

/**
 * Labels in rows on a printer bed, in the order given, `LABEL_GAP` apart. When a plate is full
 * the rest start a new bed-sized plate beside it, so no label is ever left out.
 */
export function layoutToolboxLabels(sizes: { width: number; height: number }[], bed: { width: number; depth: number }): { placements: LabelPlacement[]; plates: number } {
  const placements: LabelPlacement[] = [];
  let plate = 0;
  let rowX = 0;
  let rowY = 0;
  let rowHeight = 0;
  let plateUsed = false;
  let plateLeft = 0;
  // The right edge of everything placed so far: a too-big label runs past its plate.
  let usedRight = 0;
  for (const { width, height } of sizes) {
    const tooBig = width > bed.width + 1e-6 || height > bed.depth + 1e-6;
    // Next row when this label runs past the right edge.
    if (rowX > 0 && rowX + width > bed.width + 1e-6) {
      rowY += rowHeight + LABEL_GAP;
      rowX = 0;
      rowHeight = 0;
    }
    // Next plate when the row runs past the front, or a label too big for any bed gets its own.
    if (plateUsed && (rowY + height > bed.depth + 1e-6 || tooBig)) {
      plate += 1;
      plateLeft = Math.max(plate * (bed.width + PLATE_GAP), usedRight + PLATE_GAP);
      rowX = 0;
      rowY = 0;
      rowHeight = 0;
    }
    placements.push({ plate, x: plateLeft + rowX + width / 2, y: rowY + height / 2, tooBig });
    usedRight = Math.max(usedRight, plateLeft + rowX + width);
    plateUsed = true;
    rowX += width + LABEL_GAP;
    rowHeight = Math.max(rowHeight, height);
    if (tooBig) {
      // Nothing else shares a plate with a label that does not fit one.
      rowX = Infinity;
      rowY = Infinity;
    }
  }
  return { placements, plates: plate + 1 };
}

export type ToolboxLabelSetReport = {
  shape: WorkplaneShape;
  /** How many labels went on each printer plate. */
  perPlate: number[];
  /** Labels bigger than the bed. */
  tooBig: string[];
  /** Why there are no magnet pockets, when there are none. */
  problem: string | null;
  /** Labels the font has no letters for, left out. */
  missing: string[];
  /** Single letters the font does not have, left out of labels that are otherwise made. */
  unknownLetters?: string[];
  /** Labels past the most a set can hold, left out. */
  dropped?: number;
};

/** What happened to a set, in a sentence, or null when there is nothing to say. */
export function toolboxLabelSetNotice(report: Omit<ToolboxLabelSetReport, "shape">, bed: { width: number; depth: number } = FALLBACK_BED): string | null {
  const notes: string[] = [];
  if (report.problem) notes.push(`No magnet pockets: ${report.problem}`);
  if (report.tooBig.length > 0) {
    const names = report.tooBig.map((name) => `"${name}"`).join(", ");
    notes.push(`${names} ${report.tooBig.length === 1 ? "is" : "are"} bigger than the ${Math.round(bed.width)} × ${Math.round(bed.depth)} mm bed. Make the letters smaller or the label shorter.`);
  }
  if (report.perPlate.length > 1) {
    const total = report.perPlate.reduce((sum, count) => sum + count, 0);
    const split = report.perPlate.map((count, index) => `${count} on plate ${index + 1}`).join(", ");
    notes.push(`${total} labels need ${report.perPlate.length} printer plates: ${split}. The extra plates sit to the right of the bed; print them one at a time.`);
  }
  if (report.unknownLetters?.length) {
    const letters = report.unknownLetters.map((char) => `"${char}"`).join(" ");
    notes.push(`The font has no ${letters}, so ${report.unknownLetters.length === 1 ? "that letter was" : "those letters were"} left out. Try another font.`);
  }
  if (report.dropped) notes.push(`A set holds up to ${MAX_LABELS} labels, so the last ${report.dropped} ${report.dropped === 1 ? "was" : "were"} left out. Start a second set for the rest.`);
  if (report.missing.length > 0) notes.push(`The font has none of the letters in ${report.missing.map((name) => `"${name}"`).join(", ")}, so ${report.missing.length === 1 ? "it was" : "they were"} left out.`);
  return notes.length > 0 ? notes.join(" ") : null;
}

/** The plate heights of a set's labels, read from the part itself. */
export function toolboxLabelPlateSizes(shape: WorkplaneShape): { width: number; height: number }[] {
  const children = shape.groupedShapes ?? [];
  const labels = children.some((child) => child.groupedShapes?.length) ? children.filter((child) => child.groupedShapes?.length) : [shape];
  return labels.map((label) => ({ width: shapeWidth(label), height: shapeDepth(label) }));
}

/**
 * The whole set as one part: a Tie holding the settings, with each label a Tie of plate and
 * letters, laid out in rows on the printer bed. A rebuilt set keeps its back-left corner, so
 * adding a label grows it to the right and forwards instead of moving the rest.
 */
export function buildToolboxLabelSetReport(
  runtime: ManifoldToplevel,
  input: Partial<ToolboxLabelSpec> | null | undefined,
  previous: Partial<WorkplaneShape> = {},
  bed: { width: number; depth: number } = FALLBACK_BED,
): ToolboxLabelSetReport | null {
  const spec = normalizeToolboxLabelSpec(input);
  const asked = (input?.labels ?? []).filter((label) => typeof label?.text === "string" && label.text.trim().length > 0).length;
  const dropped = Math.max(0, asked - spec.labels.length);
  const missing: string[] = [];
  const measured: MeasuredLabel[] = [];
  for (const label of spec.labels) {
    const made = measureLabel(runtime, spec, label);
    if (made) measured.push(made);
    else missing.push(toolboxLabelText(spec, label.text));
  }
  if (measured.length === 0) return null;
  const sameWidth = spec.sameWidth ? Math.max(...measured.map((label) => label.plateWidth)) : 0;
  const sameHeight = spec.sameHeight ? Math.max(...measured.map((label) => label.plateHeight)) : 0;
  const sizes = measured.map((label) => ({ width: Math.max(label.plateWidth, sameWidth), height: Math.max(label.plateHeight, sameHeight) }));
  const { placements, plates } = layoutToolboxLabels(sizes, bed);
  const perPlate = new Array<number>(plates).fill(0);
  const tooBig: string[] = [];
  let problem: string | null = null;
  const labels: WorkplaneShape[] = [];
  measured.forEach((label, index) => {
    const place = placements[index];
    // Mintr's +Z is towards the front, which is the layout's +y.
    const built = buildMeasuredLabel(runtime, spec, label, sizes[index].width, sizes[index].height, { x: place.x, z: place.y });
    if (!built) {
      missing.push(label.text);
      return;
    }
    perPlate[place.plate] += 1;
    if (place.tooBig) tooBig.push(label.text);
    problem ??= built.problem;
    labels.push(tieOf([built.plate, built.letters], label.text, spec.plateColor));
  });
  if (labels.length === 0) return null;
  const unknownLetters = [...new Set(measured.flatMap((label) => label.skipped))];
  const set = tieOf(labels, previous.name ?? "Toolbox Label", spec.plateColor);
  // Where it goes: the old set's back-left corner, or centred where it was dropped.
  let x = previous.x ?? 0;
  let z = previous.z ?? 0;
  const turned = Math.abs(previous.rotation ?? 0) > 1e-6 || Math.abs(previous.rotationX ?? 0) > 1e-6 || Math.abs(previous.rotationZ ?? 0) > 1e-6;
  if (!turned) {
    let left = x - shapeWidth(set) / 2;
    let back = z - shapeDepth(set) / 2;
    if (previous.groupedShapes?.length && typeof previous.width === "number" && typeof previous.depth === "number") {
      left = (previous.x ?? 0) - previous.width / 2;
      back = (previous.z ?? 0) - previous.depth / 2;
    }
    // Nudged onto the bed (centred on the origin) when the first plate's labels would run past it.
    const firstWidth = Math.max(...placements.filter((place) => place.plate === 0).map((place, index) => place.x + sizes[index].width / 2));
    const firstDepth = Math.max(...placements.filter((place) => place.plate === 0).map((place, index) => place.y + sizes[index].height / 2));
    if (firstWidth <= bed.width + 1e-6) left = Math.min(Math.max(left, -bed.width / 2), bed.width / 2 - firstWidth);
    if (firstDepth <= bed.depth + 1e-6) back = Math.min(Math.max(back, -bed.depth / 2), bed.depth / 2 - firstDepth);
    x = left + shapeWidth(set) / 2;
    z = back + shapeDepth(set) / 2;
  }
  const shape = canonicalizeShape({
    ...set,
    id: previous.id ?? set.id,
    x,
    z,
    elevation: previous.elevation ?? 0,
    rotation: previous.rotation ?? 0,
    rotationX: previous.rotationX ?? 0,
    rotationZ: previous.rotationZ ?? 0,
    locked: previous.locked ?? false,
    hidden: previous.hidden ?? false,
    toolboxLabel: spec,
  });
  return { shape, perPlate: perPlate.filter((count) => count > 0), tooBig, problem, missing, unknownLetters, dropped };
}

/** The set as one part, or null when the font has none of its letters. */
export function buildToolboxLabelSet(
  runtime: ManifoldToplevel,
  input: Partial<ToolboxLabelSpec> | null | undefined,
  previous: Partial<WorkplaneShape> = {},
  bed?: { width: number; depth: number },
): WorkplaneShape | null {
  return buildToolboxLabelSetReport(runtime, input, previous, bed)?.shape ?? null;
}
