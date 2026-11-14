/**
 * Picture keychains: a drawing traced from a picture (Trace a drawing), stood up on a plate that
 * follows its outline, with a keyring hole in a tab on one side. The same part with no hole is a
 * plaque or a magnet; with no plate it is the drawing on its own.
 *
 * Built with Manifold, which runs the same in the browser and the desktop app, so there is no
 * native kernel version to keep in step.
 */
import type { CrossSection, ManifoldToplevel, Vec2 } from "manifold-3d";
import { meshPart, roundedTopSlab, tieOf } from "@/lib/toolboxLabel";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { PictureKeychainSpec, WorkplaneShape } from "@/types/sketchforge";

export const PICTURE_KEYCHAIN_NAME = "Picture Keychain";
/** Line art is black on white, so the plate is the white and the lines the black. */
export const PICTURE_KEYCHAIN_PLATE_COLOR = "#f2f2ee";
export const PICTURE_KEYCHAIN_LINE_COLOR = "#1d1f22";
/** Thinner than two 0.4 mm nozzle lines, a stroke prints badly or not at all. */
export const MIN_PRINTABLE_LINE = 0.8;
/** Plastic round the keyring hole. */
const RING_WALL = 2.5;
/** A rounded top edge on the plate, as Name Plate has. */
const EDGE_ROUND = 0.4;
/** What stays under inset lines. */
const INSET_FLOOR = 0.8;

export type TracedDrawingPiece = { outer: Array<{ x: number; y: number }>; holes: Array<Array<{ x: number; y: number }>> };

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The drawing as text: pieces by ";", loops by "|", points by " ", each "x,y". */
export function encodeDrawing(pieces: TracedDrawingPiece[]): string {
  const loop = (points: Array<{ x: number; y: number }>) => points.map((point) => `${round2(point.x)},${round2(point.y)}`).join(" ");
  return pieces
    .filter((piece) => piece.outer.length >= 3)
    .map((piece) => [piece.outer, ...piece.holes.filter((hole) => hole.length >= 3)].map(loop).join("|"))
    .join(";");
}

export function decodeDrawing(drawing: string): Vec2[][][] {
  if (!drawing) return [];
  return drawing.split(";").map((piece) => piece.split("|").map((loop) => loop.split(" ").map((pair) => {
    const [x, y] = pair.split(",");
    return [Number(x), Number(y)] as Vec2;
  }).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)))
    .filter((loop) => loop.length >= 3))
    .filter((piece) => piece.length > 0);
}

/** What the trace dialog's three choices make. */
export type PictureMake = "keychain" | "plaque" | "drawing";

export function defaultPictureKeychainSpec(drawing: string, drawingWidth: number, drawingHeight: number, make: PictureMake = "keychain", width = drawingWidth): PictureKeychainSpec {
  return normalizePictureKeychainSpec({
    drawing,
    drawingWidth,
    drawingHeight,
    width,
    backing: make === "drawing" ? "none" : "follow",
    lines: "raised",
    hole: make === "keychain" ? "top" : "none",
    holeDiameter: 5,
    pad: 2,
    thickness: 3,
    raise: 1,
    thicken: 0,
    plateColor: PICTURE_KEYCHAIN_PLATE_COLOR,
    lineColor: PICTURE_KEYCHAIN_LINE_COLOR,
  });
}

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function normalizePictureKeychainSpec(input: Partial<PictureKeychainSpec>): PictureKeychainSpec {
  const drawingWidth = clamp(input.drawingWidth, 0.1, 5000, 40);
  const drawingHeight = clamp(input.drawingHeight, 0.1, 5000, 40);
  const thickness = clamp(input.thickness, 0.6, 30, 3);
  const lines = input.lines === "inset" ? "inset" : "raised";
  const backing = input.backing === "none" ? "none" : "follow";
  return {
    drawing: typeof input.drawing === "string" ? input.drawing : "",
    drawingWidth,
    drawingHeight,
    width: clamp(input.width, 2, 1000, drawingWidth),
    backing,
    lines,
    hole: input.hole === "left" || input.hole === "right" || input.hole === "top" ? input.hole : input.hole === "none" ? "none" : "top",
    holeDiameter: clamp(input.holeDiameter, 1.5, 30, 5),
    pad: clamp(input.pad, 0.5, 30, 2),
    thickness,
    // Inset lines leave a floor; raised ones stand any height.
    raise: lines === "inset" && backing === "follow" ? clamp(input.raise, 0.2, Math.max(0.2, thickness - INSET_FLOOR), 1) : clamp(input.raise, 0.2, 20, 1),
    thicken: clamp(input.thicken, 0, 5, 0),
    plateColor: typeof input.plateColor === "string" ? input.plateColor : PICTURE_KEYCHAIN_PLATE_COLOR,
    lineColor: typeof input.lineColor === "string" ? input.lineColor : PICTURE_KEYCHAIN_LINE_COLOR,
  };
}

/** The drawing at its chosen size, centred, y up, with any thickening. Null when it is empty. */
export function pictureKeychainLines(runtime: ManifoldToplevel, spec: PictureKeychainSpec): CrossSection | null {
  const scale = spec.width / spec.drawingWidth;
  const pieces = decodeDrawing(spec.drawing).map((loops) => new runtime.CrossSection(
    loops.map((loop) => loop.map(([x, y]) => [(x - spec.drawingWidth / 2) * scale, -(y - spec.drawingHeight / 2) * scale] as Vec2)),
    "EvenOdd",
  ));
  if (pieces.length === 0) return null;
  const joined = runtime.CrossSection.union(pieces);
  pieces.forEach((piece) => piece.delete());
  if (joined.isEmpty()) {
    joined.delete();
    return null;
  }
  if (spec.thicken <= 0) return joined;
  const thick = joined.offset(spec.thicken / 2, "Round", 2, 24);
  joined.delete();
  return thick;
}

/**
 * The share of the drawing's area (0 to 1) in strokes thinner than `minWidth`: what is left
 * after shrinking by half of it and growing back is the part thick enough.
 */
export function thinLineShare(lines: CrossSection, minWidth = MIN_PRINTABLE_LINE): number {
  const total = lines.area();
  if (total <= 0) return 0;
  const shrunk = lines.offset(-minWidth / 2, "Round", 2, 16);
  const opened = shrunk.offset(minWidth / 2, "Round", 2, 16);
  shrunk.delete();
  const kept = opened.area();
  opened.delete();
  return Math.min(1, Math.max(0, 1 - kept / total));
}

function signedArea(loop: Vec2[]) {
  let area = 0;
  for (let index = 0; index < loop.length; index += 1) {
    const [x1, y1] = loop[index];
    const [x2, y2] = loop[(index + 1) % loop.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/**
 * A plate that follows the drawing, cut like a sticker: grown by `pad`, smoothed, and with the
 * white areas inside it filled. Drawings with pieces apart are smoothed harder until they join;
 * `pieces` says how many it is still in when they never do.
 */
export function followBacking(runtime: ManifoldToplevel, lines: CrossSection, pad: number, size: number): { outline: CrossSection; pieces: number } {
  const first = Math.min(6, Math.max(1, size * 0.05));
  let outers: Vec2[][] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const smooth = first * 2 ** attempt;
    const grown = lines.offset(pad + smooth, "Round", 2, 32);
    const shrunk = grown.offset(-smooth, "Round", 2, 32);
    grown.delete();
    outers = shrunk.toPolygons().filter((loop) => signedArea(loop) > 0);
    shrunk.delete();
    if (outers.length <= 1) break;
  }
  const parts = outers.map((loop) => new runtime.CrossSection([loop], "Positive"));
  const outline = runtime.CrossSection.union(parts);
  parts.forEach((part) => part.delete());
  return { outline, pieces: outers.length };
}

const HOLE_DIRECTIONS: Record<Exclude<PictureKeychainSpec["hole"], "none">, Vec2> = { top: [0, 1], left: [-1, 0], right: [1, 0] };

/**
 * A ring on the plate's furthest point that way, blended in, and the hole through it. The
 * hole's edge meets the plate's old edge, so it stays `pad` clear of the drawing.
 */
export function addKeyringTab(runtime: ManifoldToplevel, plate: CrossSection, side: Exclude<PictureKeychainSpec["hole"], "none">, holeDiameter: number): { plate: CrossSection; hole: CrossSection } {
  const [dx, dy] = HOLE_DIRECTIONS[side];
  let best: Vec2 = [0, 0];
  let reach = -Infinity;
  for (const loop of plate.toPolygons()) {
    for (const point of loop) {
      const along = point[0] * dx + point[1] * dy;
      if (along > reach) {
        reach = along;
        best = point;
      }
    }
  }
  const radius = holeDiameter / 2;
  const centre: Vec2 = [best[0] + dx * radius, best[1] + dy * radius];
  const rawRing = runtime.CrossSection.circle(radius + RING_WALL, 64);
  const ring = rawRing.translate(centre);
  rawRing.delete();
  const joined = runtime.CrossSection.union([plate, ring]);
  ring.delete();
  // A fillet where the ring meets the plate.
  const fillet = Math.max(1, RING_WALL * 0.8);
  const grown = joined.offset(fillet, "Round", 2, 32);
  joined.delete();
  const blended = grown.offset(-fillet, "Round", 2, 32);
  grown.delete();
  const rawHole = runtime.CrossSection.circle(radius, 64);
  const hole = rawHole.translate(centre);
  rawHole.delete();
  const withHole = blended.subtract(hole);
  blended.delete();
  return { plate: withHole, hole };
}

export type PictureKeychainBuild = {
  shape: WorkplaneShape;
  /** Share of the drawing in strokes too thin to print well. */
  thinShare: number;
  /** How many pieces the plate is in; more than 1 means parts of the drawing never joined. */
  platePieces: number;
};

/** The keychain, plaque or drawing as one part (a Tie of plate and lines when raised). */
export function buildPictureKeychain(runtime: ManifoldToplevel, input: Partial<PictureKeychainSpec>, previous: Partial<WorkplaneShape> = {}): PictureKeychainBuild | null {
  const spec = normalizePictureKeychainSpec(input);
  const lines = pictureKeychainLines(runtime, spec);
  if (!lines) return null;
  const thinShare = thinLineShare(lines);
  const name = previous.name ?? PICTURE_KEYCHAIN_NAME;
  const at = { x: 0, z: 0 };
  let made: WorkplaneShape | null = null;
  let platePieces = 1;

  if (spec.backing === "none") {
    const solid = lines.extrude(spec.thickness);
    lines.delete();
    made = meshPart(solid, { name, color: spec.lineColor }, at);
    solid.delete();
  } else {
    const size = Math.min(spec.width, spec.width * (spec.drawingHeight / spec.drawingWidth));
    const backing = followBacking(runtime, lines, spec.pad, size);
    platePieces = backing.pieces;
    let outline = backing.outline;
    let drawing = lines;
    if (spec.hole !== "none") {
      const tab = addKeyringTab(runtime, outline, spec.hole, spec.holeDiameter);
      outline.delete();
      outline = tab.plate;
      // Nothing of the drawing ever crosses the hole.
      const clearance = tab.hole.offset(0.6, "Round", 2, 32);
      tab.hole.delete();
      drawing = lines.subtract(clearance);
      clearance.delete();
      lines.delete();
    }
    let plate = roundedTopSlab(runtime, outline, spec.thickness, EDGE_ROUND);
    outline.delete();
    if (spec.lines === "inset") {
      const raw = drawing.extrude(spec.raise + 0.01);
      const cutter = raw.translate([0, 0, spec.thickness - spec.raise]);
      raw.delete();
      drawing.delete();
      const cut = plate.subtract(cutter);
      plate.delete();
      cutter.delete();
      plate = cut;
      made = meshPart(plate, { name, color: spec.plateColor }, at);
      plate.delete();
    } else {
      const raw = drawing.extrude(spec.raise);
      drawing.delete();
      const raised = raw.translate([0, 0, spec.thickness]);
      raw.delete();
      const platePart = meshPart(plate, { name: `${name} plate`, color: spec.plateColor }, at);
      const linePart = meshPart(raised, { name: `${name} lines`, color: spec.lineColor }, at);
      plate.delete();
      raised.delete();
      made = platePart && linePart ? tieOf([platePart, linePart], name, spec.plateColor) : null;
    }
  }
  if (!made) return null;
  const shape = canonicalizeShape({
    ...made,
    id: previous.id ?? made.id,
    name,
    x: previous.x ?? 0,
    z: previous.z ?? 0,
    elevation: previous.elevation ?? 0,
    rotation: previous.rotation ?? 0,
    rotationX: previous.rotationX ?? 0,
    rotationZ: previous.rotationZ ?? 0,
    locked: previous.locked ?? false,
    hidden: previous.hidden ?? false,
    pictureKeychain: spec,
  });
  return { shape, thinShare, platePieces };
}

/** What to tell someone after a build: thin lines, or a plate in pieces. */
export function pictureKeychainNotice(build: PictureKeychainBuild): string | null {
  const spec = build.shape.pictureKeychain;
  if (spec?.backing === "follow" && build.platePieces > 1) {
    return `The plate is in ${build.platePieces} pieces: parts of the drawing are too far apart. Raise Padding to join them.`;
  }
  if (build.thinShare > 0.05) {
    return `${Math.round(build.thinShare * 100)}% of the lines are thinner than ${MIN_PRINTABLE_LINE} mm and may not print. Raise Thicken lines, or make it bigger.`;
  }
  return null;
}
