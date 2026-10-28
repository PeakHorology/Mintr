import type { SurfaceTexture, SurfaceTexturePattern } from "./surfaceTexture";

/**
 * Whether a texture will come out on the person's printer. A filament printer
 * cannot draw a ridge narrower than its nozzle, and a top face only shows
 * height in whole layers. Resin prints far finer detail.
 */
export type TexturePrinter = { kind: "filament" | "resin"; nozzleMm: number };

export type TexturePrintAdvice = {
  notes: string[];
  /** Settings that print, when the current ones would not. */
  fix: Pick<SurfaceTexture, "spacing" | "depth"> | null;
};

/** The smallest repeat, in nozzle widths, that leaves each ridge, dot or wall at least one nozzle wide. */
const NOZZLES_PER_REPEAT: Record<SurfaceTexturePattern, number> = {
  knurl: 4,
  grooves: 3,
  honeycomb: 4,
  bumps: 4,
  fuzzy: 1.5,
  // Four strands per repeat.
  weave: 8,
  // The joints are a seventh of a brick wide.
  brick: 7,
  // Each lozenge is about a twelfth of a repeat across.
  diamondPlate: 12,
  // Four pebbles across, with creases between.
  leather: 8,
  wood: 4,
  waves: 3,
  // A picture's detail is finer than its width; about a tenth is a fair guess.
  image: 10,
};

const FILAMENT_LAYER_MM = 0.2;
const RESIN_DETAIL_MM = 0.1;
const RESIN_LAYER_MM = 0.05;

const roundUp = (value: number, step: number) => Math.ceil(value / step - 1e-9) * step;

export function texturePrintAdvice(texture: SurfaceTexture, printer: TexturePrinter, spacingUsed = texture.spacing): TexturePrintAdvice {
  const notes: string[] = [];
  const resin = printer.kind === "resin";
  const nozzle = resin ? RESIN_DETAIL_MM : Math.max(0.1, printer.nozzleMm || 0.4);
  const layer = resin ? RESIN_LAYER_MM : FILAMENT_LAYER_MM;
  const minSpacing = roundUp(NOZZLES_PER_REPEAT[texture.pattern] * nozzle, 0.1);
  let spacing = texture.spacing;
  let depth = texture.depth;
  if (spacingUsed < minSpacing - 1e-9) {
    notes.push(resin
      ? `Finer than resin can show. Use ${minSpacing.toFixed(1)} mm or more.`
      : `Too fine for a ${nozzle.toFixed(2).replace(/0$/, "")} mm nozzle; it would print as a blur. Use ${minSpacing.toFixed(1)} mm or more.`);
    spacing = Math.max(spacing, minSpacing);
  }
  if (depth < layer - 1e-9) {
    notes.push(`Shallower than one ${layer} mm layer, so it will not show on the top. Use ${layer} mm or more.`);
    depth = layer;
  }
  if (texture.direction === "out" && depth > spacing * 0.6) {
    notes.push("Deep for its size: the underside of each ridge may droop. A smaller depth prints cleaner.");
  }
  const fixed = spacing !== texture.spacing || depth !== texture.depth;
  return { notes, fix: fixed ? { spacing, depth } : null };
}

/** Measured on textured parts: STL keeps 50 bytes a triangle; 3MF is zipped, about a fifth of that. */
const STL_BYTES_PER_TRIANGLE = 50;
const THREE_MF_BYTES_PER_TRIANGLE = 10.5;
/** Past this an STL is slow to save, send and slice. */
const LARGE_STL_BYTES = 60 * 1024 * 1024;

export function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** How big the textured triangles make an export, and what to do if that is a lot. */
export function textureFileSize(triangles: number, texture?: Pick<SurfaceTexture, "detail">) {
  const stl = triangles * STL_BYTES_PER_TRIANGLE;
  const threeMf = triangles * THREE_MF_BYTES_PER_TRIANGLE;
  const large = stl > LARGE_STL_BYTES;
  const fix = !large
    ? null
    : texture && texture.detail !== "normal"
      ? "Normal detail makes it much smaller."
      : "A larger pattern size makes it smaller.";
  return { stl, threeMf, large, text: `about ${fileSizeLabel(stl)} as STL, ${fileSizeLabel(threeMf)} as 3MF`, fix };
}
