import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Where added fonts are kept, and how they travel inside a design file. Light on
 * purpose (no three.js, no font data of its own), so the design file code and the
 * project store worker can use it.
 */

/** Mintr's own fonts, by the names shown in the Text shape inspector. */
export const BUILT_IN_TEXT_FONTS = [
  "Multilanguage",
  "Sans",
  "Sans Light",
  "Serif",
  "Serif Light",
  "Script",
  "Script Light",
  "Monospace",
  "Rounded",
  "Rounded Light",
  "Clean",
  "Stencil",
] as const;

/** A font someone added, kept as a three.js typeface (JSON text). */
export type CustomTextFont = { id: string; name: string; fileName: string; typeface: string };

/** A font carried inside a design file, so the design looks the same on any computer. */
export type DesignFont = { name: string; typeface: string };

const CUSTOM_FONTS_KEY = "mintr:custom-fonts";
export const CUSTOM_FONTS_EVENT = "mintr:custom-fonts-changed";
/** A typeface bigger than this would crowd out everything else this computer keeps for Mintr. */
export const MAX_TYPEFACE_CHARS = 2_500_000;
const MAX_DESIGN_FONTS = 16;

export function readCustomFonts(): CustomTextFont[] {
  try {
    if (typeof window === "undefined") return [];
    const parsed = JSON.parse(window.localStorage.getItem(CUSTOM_FONTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is CustomTextFont => Boolean(entry)
      && typeof entry.id === "string" && typeof entry.name === "string" && typeof entry.typeface === "string");
  } catch {
    return [];
  }
}

export function writeCustomFonts(list: CustomTextFont[]): boolean {
  try {
    window.localStorage.setItem(CUSTOM_FONTS_KEY, JSON.stringify(list));
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(CUSTOM_FONTS_EVENT));
  return true;
}

export function newFontId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Every font the shapes use: Text shapes, and text drawn as a texture. Grouped parts count too. */
export function fontsUsedBy(shapes: readonly WorkplaneShape[]): Set<string> {
  const used = new Set<string>();
  const visit = (shape: WorkplaneShape) => {
    if (shape.kind === "text" && shape.font) used.add(shape.font);
    const textFont = shape.surfaceTexture?.image?.text?.font;
    if (textFont) used.add(textFont);
    shape.groupedShapes?.forEach(visit);
  };
  shapes.forEach(visit);
  return used;
}

/** The added fonts these shapes use, to write into the design file. Mintr's own fonts are never written. */
export function designFontsFor(shapes: readonly WorkplaneShape[], library: readonly DesignFont[]): DesignFont[] {
  const used = fontsUsedBy(shapes);
  const builtIn = new Set<string>(BUILT_IN_TEXT_FONTS);
  return library
    .filter((font) => used.has(font.name) && !builtIn.has(font.name))
    .slice(0, MAX_DESIGN_FONTS)
    .map((font) => ({ name: font.name, typeface: font.typeface }));
}

/** Fonts read from a design file, made safe: named, not too big, and not one of Mintr's own. */
export function normalizeDesignFonts(input: unknown): DesignFont[] {
  if (!Array.isArray(input)) return [];
  const builtIn = new Set<string>(BUILT_IN_TEXT_FONTS);
  const seen = new Set<string>();
  const fonts: DesignFont[] = [];
  for (const entry of input) {
    const font = entry as Partial<DesignFont> | null;
    if (!font || typeof font.name !== "string" || typeof font.typeface !== "string") continue;
    const name = font.name.trim().slice(0, 60);
    if (!name || builtIn.has(name) || seen.has(name) || font.typeface.length > MAX_TYPEFACE_CHARS) continue;
    seen.add(name);
    fonts.push({ name, typeface: font.typeface });
    if (fonts.length >= MAX_DESIGN_FONTS) break;
  }
  return fonts;
}

/**
 * Adds the fonts a design brought with it to this computer's fonts, so its text shows as it
 * was made and the font can be used again. A font already kept under that name is left alone.
 * Returns the names added.
 */
export function installDesignFonts(fonts: readonly DesignFont[], designName: string): string[] {
  if (typeof window === "undefined" || fonts.length === 0) return [];
  const list = readCustomFonts();
  const known = new Set(list.map((font) => font.name));
  const added: CustomTextFont[] = [];
  for (const font of fonts) {
    if (known.has(font.name)) continue;
    try {
      // Only a real typeface is kept.
      const parsed = JSON.parse(font.typeface) as { glyphs?: unknown };
      if (!parsed || typeof parsed.glyphs !== "object") continue;
    } catch {
      continue;
    }
    added.push({ id: newFontId(), name: font.name, fileName: `From ${designName}`.slice(0, 120), typeface: font.typeface });
    known.add(font.name);
  }
  if (added.length === 0) return [];
  return writeCustomFonts([...list, ...added]) ? added.map((font) => font.name) : [];
}
