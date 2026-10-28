import { resolveTextFont, textFontCurveSegments } from "@/lib/textFonts";
import {
  MAX_TEXTURE_IMAGE_SIDE,
  MAX_TEXTURE_PICTURE_SIDE,
  MAX_TEXTURE_TEXT_LENGTH,
  type SurfaceTexture,
  type SurfaceTextureImage,
  type SurfaceTexturePattern,
} from "./surfaceTexture";
import { decodeTextureImage, encodeTextureImage, fuzzyHeight, imageHeight, PATTERN_HEIGHTS, type PatternHeight } from "./texturePatterns";

/**
 * Pictures for the texture gallery and pictures turned into textures. Browser
 * only: both draw on a canvas.
 */

const THUMB_PX = 64;
/** Each tile shows two repeats each way, so the pattern reads as a pattern. */
const THUMB_REPEATS = 2;

const thumbs = new Map<string, string>();

function heightFor(pattern: SurfaceTexturePattern, image?: SurfaceTextureImage): (u: number, v: number) => number {
  if (pattern === "fuzzy") return (u, v) => fuzzyHeight(u * 6, v * 6, 0.5, 1);
  if (pattern === "image" && image) return imageHeight(decodeTextureImage(image));
  return PATTERN_HEIGHTS[pattern === "image" ? "knurl" : pattern] as PatternHeight;
}

/** A small lit picture of a pattern, as raised relief seen from above. */
export function textureThumbnail(pattern: SurfaceTexturePattern, image?: SurfaceTextureImage): string | null {
  if (typeof document === "undefined") return null;
  const key = pattern === "image" ? `image|${image?.data.length ?? 0}|${image?.data.slice(0, 64) ?? ""}|${image?.data.slice(-64) ?? ""}|${image?.invert ?? false}` : pattern;
  const known = thumbs.get(key);
  if (known) return known;
  if (pattern === "image" && !image) return null;
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_PX;
  canvas.height = THUMB_PX;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const height = heightFor(pattern, image);
  const repeats = pattern === "image" && image ? 1 : THUMB_REPEATS;
  const tall = pattern === "image" && image ? image.height / image.width : 1;
  const step = repeats / THUMB_PX;
  const pixels = context.createImageData(THUMB_PX, THUMB_PX);
  const at = (x: number, y: number) => height(x * step, (THUMB_PX - y) * step * tall);
  for (let y = 0; y < THUMB_PX; y += 1) {
    for (let x = 0; x < THUMB_PX; x += 1) {
      const h = at(x, y);
      // Light from the upper left: slopes facing it are brighter.
      const slope = (at(x - 1, y) - at(x + 1, y)) + (at(x, y - 1) - at(x, y + 1));
      const shade = Math.max(0, Math.min(1, 0.55 + h * 0.25 + slope * 2.2));
      const o = (y * THUMB_PX + x) * 4;
      pixels.data[o] = 70 + shade * 170;
      pixels.data[o + 1] = 74 + shade * 166;
      pixels.data[o + 2] = 80 + shade * 160;
      pixels.data[o + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const url = canvas.toDataURL();
  thumbs.set(key, url);
  return url;
}

/** Turns a picture file into a texture picture: grey, at most 256 pixels on its longest side. */
export async function textureImageFromFile(file: File): Promise<SurfaceTextureImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_TEXTURE_PICTURE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not read that picture");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const rgba = context.getImageData(0, 0, width, height).data;
  const grey = new Uint8Array(width * height);
  for (let i = 0; i < grey.length; i += 1) {
    // See-through parts count as low.
    const alpha = rgba[i * 4 + 3] / 255;
    grey[i] = Math.round((0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) * alpha);
  }
  return { name: file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Picture", width, height, data: encodeTextureImage(grey), invert: false };
}

/** Settings for a picture texture, keeping the other choices. */
export function withTextureImage(texture: SurfaceTexture, image: SurfaceTextureImage): SurfaceTexture {
  return { ...texture, pattern: "image", image };
}

/** Letters are drawn this tall, in pixels, before the picture is fitted to its size limit. */
const TEXT_DRAW_SIZE = 120;
const TEXT_MARGIN = 0.08;

/**
 * Draws words as a texture picture, white letters on black, in the same fonts as Mintr's
 * Text shapes. Null when there is nothing to draw.
 */
export function textureImageFromText(value: string, font: string): SurfaceTextureImage | null {
  if (typeof document === "undefined") return null;
  const text = value.slice(0, MAX_TEXTURE_TEXT_LENGTH);
  if (!text.trim()) return null;
  const shapes = resolveTextFont(font).generateShapes(text, TEXT_DRAW_SIZE);
  const segments = textFontCurveSegments(font) * 2;
  const outlines = shapes.map((shape) => {
    const { shape: outer, holes } = shape.extractPoints(segments);
    return [outer, ...holes];
  });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  outlines.forEach((loops) => loops.forEach((loop) => loop.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  })));
  if (!Number.isFinite(minX) || maxX - minX < 1e-6 || maxY - minY < 1e-6) return null;
  // A margin all round, so the letters do not touch the edge of the picture.
  const margin = (maxY - minY) * TEXT_MARGIN;
  const spanX = maxX - minX + margin * 2;
  const spanY = maxY - minY + margin * 2;
  const scale = MAX_TEXTURE_IMAGE_SIDE / Math.max(spanX, spanY);
  const width = Math.max(1, Math.round(spanX * scale));
  const height = Math.max(1, Math.round(spanY * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#fff";
  // Font outlines have y up; the picture has its first row at the top.
  const toX = (x: number) => (x - minX + margin) * scale;
  const toY = (y: number) => (maxY - y + margin) * scale;
  outlines.forEach((loops) => {
    context.beginPath();
    loops.forEach((loop) => {
      loop.forEach((point, index) => {
        if (index === 0) context.moveTo(toX(point.x), toY(point.y));
        else context.lineTo(toX(point.x), toY(point.y));
      });
      context.closePath();
    });
    // Holes in letters (the middle of an O) stay low.
    context.fill("evenodd");
  });
  const rgba = context.getImageData(0, 0, width, height).data;
  const grey = new Uint8Array(width * height);
  for (let i = 0; i < grey.length; i += 1) grey[i] = rgba[i * 4];
  return { name: text, width, height, data: encodeTextureImage(grey), invert: false, text: { value: text, font } };
}

const fontPreviews = new Map<string, string>();

/** A short sample of a font as a picture, ink on clear, for choosing between fonts. */
export function fontPreviewUrl(font: string, sample = "Aa Bb 123", ink = "#5b6470"): string | null {
  const key = `${font}|${sample}|${ink}`;
  const known = fontPreviews.get(key);
  if (known) return known;
  const image = textureImageFromText(sample, font);
  if (!image) return null;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const { pixels } = decodeTextureImage(image);
  const out = context.createImageData(image.width, image.height);
  const r = parseInt(ink.slice(1, 3), 16);
  const g = parseInt(ink.slice(3, 5), 16);
  const b = parseInt(ink.slice(5, 7), 16);
  for (let i = 0; i < pixels.length; i += 1) {
    out.data[i * 4] = r;
    out.data[i * 4 + 1] = g;
    out.data[i * 4 + 2] = b;
    out.data[i * 4 + 3] = pixels[i];
  }
  context.putImageData(out, 0, 0);
  const url = canvas.toDataURL();
  fontPreviews.set(key, url);
  return url;
}
