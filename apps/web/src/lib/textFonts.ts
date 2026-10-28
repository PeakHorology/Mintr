import { FontLoader, type Font, type FontData } from "three/examples/jsm/loaders/FontLoader.js";
import droidMonoFontJson from "three/examples/fonts/droid/droid_sans_mono_regular.typeface.json";
import droidSansBoldFontJson from "three/examples/fonts/droid/droid_sans_bold.typeface.json";
import droidSansRegularFontJson from "three/examples/fonts/droid/droid_sans_regular.typeface.json";
import droidSerifBoldFontJson from "three/examples/fonts/droid/droid_serif_bold.typeface.json";
import droidSerifRegularFontJson from "three/examples/fonts/droid/droid_serif_regular.typeface.json";
import gentilisBoldFontJson from "three/examples/fonts/gentilis_bold.typeface.json";
import gentilisRegularFontJson from "three/examples/fonts/gentilis_regular.typeface.json";
import helvetikerBoldFontJson from "three/examples/fonts/helvetiker_bold.typeface.json";
import helvetikerRegularFontJson from "three/examples/fonts/helvetiker_regular.typeface.json";
import optimerBoldFontJson from "three/examples/fonts/optimer_bold.typeface.json";
import optimerRegularFontJson from "three/examples/fonts/optimer_regular.typeface.json";
import {
  BUILT_IN_TEXT_FONTS,
  CUSTOM_FONTS_EVENT,
  MAX_TYPEFACE_CHARS,
  newFontId,
  readCustomFonts,
  writeCustomFonts,
  type CustomTextFont,
} from "./customFontStore";

export const DEFAULT_TEXT_FONT = "Multilanguage";

/** Display names shown in the Text shape inspector. */
export const TEXT_FONT_OPTIONS = BUILT_IN_TEXT_FONTS;

export type TextFontName = (typeof TEXT_FONT_OPTIONS)[number];

const fontLoader = new FontLoader();

function parseFont(data: unknown): Font {
  return fontLoader.parse(data as FontData);
}

/**
 * Three.js ships a small set of typeface.json fonts. We expose every distinct
 * face (including regular weights) under readable PeakCAD names. Stencil reuses
 * Helvetiker Bold with reduced curve segments at geometry time.
 */
const textFonts: Record<string, Font> = {
  Multilanguage: parseFont(helvetikerBoldFontJson),
  Sans: parseFont(droidSansBoldFontJson),
  "Sans Light": parseFont(droidSansRegularFontJson),
  Serif: parseFont(droidSerifBoldFontJson),
  "Serif Light": parseFont(droidSerifRegularFontJson),
  Script: parseFont(gentilisBoldFontJson),
  "Script Light": parseFont(gentilisRegularFontJson),
  Monospace: parseFont(droidMonoFontJson),
  Rounded: parseFont(optimerBoldFontJson),
  "Rounded Light": parseFont(optimerRegularFontJson),
  Clean: parseFont(helvetikerRegularFontJson),
  Stencil: parseFont(helvetikerBoldFontJson),
};

export function resolveTextFont(fontName?: string | null): Font {
  if (fontName && textFonts[fontName]) return textFonts[fontName];
  return (fontName ? customFont(fontName) : null) ?? textFonts[DEFAULT_TEXT_FONT];
}

export function textFontCurveSegments(fontName?: string | null): number {
  return fontName === "Stencil" ? 1 : 8;
}

/**
 * Fonts people add themselves, for Text shapes and text textures alike. Each is kept
 * on this computer as a three.js typeface, so it can be drawn at once without the
 * font file reader. A design file carries the added fonts it uses, so it looks the
 * same on another computer.
 */
export {
  CUSTOM_FONTS_EVENT,
  readCustomFonts,
  type CustomTextFont,
} from "./customFontStore";

const customFontCache = new Map<string, Font>();
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener(CUSTOM_FONTS_EVENT, () => customFontCache.clear());
}

/** Every font name a Text shape or text texture can use: Mintr's own, then the ones added. */
export function textFontOptions(): string[] {
  return [...TEXT_FONT_OPTIONS, ...readCustomFonts().map((font) => font.name)];
}

function customFont(fontName: string): Font | null {
  const known = customFontCache.get(fontName);
  if (known) return known;
  const entry = readCustomFonts().find((font) => font.name === fontName);
  if (!entry) return null;
  try {
    const font = parseFont(JSON.parse(entry.typeface));
    customFontCache.set(fontName, font);
    return font;
  } catch {
    return null;
  }
}

/** Reads a font file (TTF, OTF or WOFF) and keeps it. Returns its name, or why it could not. */
export async function addCustomFont(file: File): Promise<{ name: string } | { error: string }> {
  let typeface: Record<string, unknown>;
  try {
    const { TTFLoader } = await import("three/examples/jsm/loaders/TTFLoader.js");
    typeface = new TTFLoader().parse(await file.arrayBuffer()) as unknown as Record<string, unknown>;
  } catch {
    return { error: `Could not read ${file.name}. Try a TTF or OTF font file.` };
  }
  const glyphs = typeface.glyphs as Record<string, unknown> | undefined;
  if (!glyphs || Object.keys(glyphs).length === 0) return { error: `${file.name} has no letters Mintr can use.` };
  const text = JSON.stringify(typeface);
  if (text.length > MAX_TYPEFACE_CHARS) {
    return { error: `${file.name} is too big to keep (fonts with every language can be). Try a smaller version of the font.` };
  }
  const list = readCustomFonts();
  const taken = new Set<string>([...TEXT_FONT_OPTIONS, ...list.map((font) => font.name)]);
  const base = (typeof typeface.familyName === "string" && typeface.familyName.trim()) || file.name.replace(/\.[^.]+$/, "") || "My font";
  let name = base.slice(0, 60);
  for (let n = 2; taken.has(name); n += 1) name = `${base.slice(0, 56)} ${n}`;
  const entry: CustomTextFont = { id: newFontId(), name, fileName: file.name, typeface: text };
  if (!writeCustomFonts([...list, entry])) return { error: "There is no room left to keep that font. Remove a font you no longer use, then try again." };
  return { name };
}

export function removeCustomFont(id: string) {
  writeCustomFonts(readCustomFonts().filter((font) => font.id !== id));
}
