import { mirroredShapePatch } from "@/lib/editorBoolean";
import { boundsForShapes } from "@/lib/editorShapeMesh";
import { createLocalId } from "@/lib/localIds";
import { duplicateShapeWithFreshIds } from "@/lib/shapeClipboard";
import type { AlignAxis, WorkplaneShape } from "@/types/sketchforge";

/**
 * Mirror makes a mirrored copy of the selection on the side you pick, the way Fusion, Onshape
 * and SolidWorks do. The mirror plane is that side of the selection, so the copy lands touching
 * it: build half a part, mirror it, and the halves meet. Nothing goes below the workplane, so
 * there is no bottom side.
 */
export type MirrorSide = "right" | "left" | "front" | "back" | "top";

export const MIRROR_SIDES: readonly MirrorSide[] = ["right", "left", "front", "back", "top"];

/** +x is right, +z faces the view cube's Front, +y is up. Matches Align's names. */
export function mirrorSideAxis(side: MirrorSide): { axis: AlignAxis; sign: 1 | -1 } {
  switch (side) {
    case "right": return { axis: "x", sign: 1 };
    case "left": return { axis: "x", sign: -1 };
    case "front": return { axis: "z", sign: 1 };
    case "back": return { axis: "z", sign: -1 };
    case "top": return { axis: "y", sign: 1 };
  }
}

/** "Mirrored 2 shapes to the right": the history label, also read back by guides. */
export function mirrorCopyLabel(count: number, side: MirrorSide) {
  const what = count === 1 ? "a copy" : `copies of ${count} shapes`;
  return side === "top" ? `Mirrored ${what} on top` : `Mirrored ${what} to the ${side}`;
}

/** The side named in a history label, from this build ("to the right") or older flips ("left-right"). */
export function mirrorSideFromLabel(label: string): MirrorSide | null {
  const text = label.trim();
  if (!/^Mirrored /i.test(text)) return null;
  const side = MIRROR_SIDES.find((entry) => new RegExp(`\\b(to the ${entry}|on ${entry})\\b`, "i").test(text));
  if (side) return side;
  if (/front-back/i.test(text)) return "front";
  if (/top-bottom/i.test(text)) return "top";
  return "right";
}

export function parseMirrorSide(value: unknown): MirrorSide | null {
  return typeof value === "string" && (MIRROR_SIDES as readonly string[]).includes(value) ? (value as MirrorSide) : null;
}

/**
 * The scene with a mirrored copy of each selected part added. The originals stay exactly as
 * they were. A copy is a plain, unlocked part with its own ids, like Duplicate makes.
 */
export function mirroredCopiesForSelection(
  shapes: WorkplaneShape[],
  selectedShapes: WorkplaneShape[],
  side: MirrorSide,
  makeId: (source: WorkplaneShape) => string = (source) => createLocalId(`${source.id}-mirror`),
): { nextShapes: WorkplaneShape[]; copies: WorkplaneShape[] } {
  if (selectedShapes.length === 0) return { nextShapes: shapes, copies: [] };
  const { axis, sign } = mirrorSideAxis(side);
  const bounds = boundsForShapes(selectedShapes);
  const pivot = axis === "x"
    ? (sign > 0 ? bounds.maxX : bounds.minX)
    : axis === "z"
      ? (sign > 0 ? bounds.maxZ : bounds.minZ)
      : bounds.maxY;
  const copies = selectedShapes.map((shape) => {
    const copy = { ...duplicateShapeWithFreshIds(shape, makeId(shape)), locked: false };
    return { ...copy, ...mirroredShapePatch(copy, axis, pivot) } as WorkplaneShape;
  });
  return { nextShapes: [...shapes, ...copies], copies };
}
