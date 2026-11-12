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
  "Heavy",
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

/** Every font the shapes use: Text shapes, toolbox labels, and text drawn as a texture. Grouped parts count too. */
export function fontsUsedBy(shapes: readonly WorkplaneShape[]): Set<string> {
  const used = new Set<string>();
  const visit = (shape: WorkplaneShape) => {
    if (shape.kind === "text" && shape.font) used.add(shape.font);
    if (shape.toolboxLabel?.font) used.add(shape.toolboxLabel.font);
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
 * Fonts the designs opened in this session brought with them, by name, kept in memory whether or
 * not this computer could keep them. Saving merges them back in, so a font that did not fit here
 * is not dropped from the file, and its text still draws with it.
 */
const carriedDesignFonts = new Map<string, DesignFont>();

/** A font an opened design brought with it, or null. */
export function readCarriedDesignFont(name: string): DesignFont | null {
  return carriedDesignFonts.get(name) ?? null;
}

/**
 * Every font a design file can take its fonts from: this computer's fonts, then the ones opened
 * designs brought that this computer does not have. Pass it to `designFontsFor` when saving.
 */
export function designFontLibrary(): DesignFont[] {
  const local = readCustomFonts();
  const known = new Set(local.map((font) => font.name));
  return [
    ...local.map((font) => ({ name: font.name, typeface: font.typeface })),
    ...[...carriedDesignFonts.values()].filter((font) => !known.has(font.name)),
  ];
}

function isTypeface(text: string) {
  try {
    const parsed = JSON.parse(text) as { glyphs?: unknown } | null;
    return Boolean(parsed && typeof parsed.glyphs === "object" && parsed.glyphs);
  } catch {
    return false;
  }
}

export type DesignFontInstall = {
  /** Fonts added to this computer's fonts. */
  added: string[];
  /** Fonts that could not be kept here (no room left). The design still keeps them when saved. */
  failed: string[];
};

/**
 * Adds the fonts a design brought with it to this computer's fonts, so its text shows as it
 * was made and the font can be used again. A font already kept under that name is left alone.
 * Every font is also remembered for this session, so saving the design keeps it even when this
 * computer had no room for it.
 */
export function installDesignFontsReport(fonts: readonly DesignFont[], designName: string): DesignFontInstall {
  if (typeof window === "undefined" || fonts.length === 0) return { added: [], failed: [] };
  const list = readCustomFonts();
  const known = new Set(list.map((font) => font.name));
  const added: CustomTextFont[] = [];
  for (const font of fonts) {
    // Only a real typeface is kept.
    if (!isTypeface(font.typeface)) continue;
    carriedDesignFonts.set(font.name, { name: font.name, typeface: font.typeface });
    if (known.has(font.name)) continue;
    added.push({ id: newFontId(), name: font.name, fileName: `From ${designName}`.slice(0, 120), typeface: font.typeface });
    known.add(font.name);
  }
  if (added.length === 0) return { added: [], failed: [] };
  if (writeCustomFonts([...list, ...added])) return { added: added.map((font) => font.name), failed: [] };
  // Text already drawn with a stand-in font is drawn again with the font the design carried.
  window.dispatchEvent(new CustomEvent(CUSTOM_FONTS_EVENT));
  return { added: [], failed: added.map((font) => font.name) };
}

/** As `installDesignFontsReport`, returning only the names added. */
export function installDesignFonts(fonts: readonly DesignFont[], designName: string): string[] {
  return installDesignFontsReport(fonts, designName).added;
}

/** What to tell someone when an opened design's fonts could not be kept on this computer. */
export function designFontsNotKeptMessage(failed: readonly string[]): string | null {
  if (failed.length === 0) return null;
  const names = failed.length === 1 ? `the font ${failed[0]}` : `${failed.length} fonts (${failed.join(", ")})`;
  return `There was no room on this computer to keep ${names} from this design. Its text still shows in that font and saving keeps it in the file, but other designs cannot use it until you remove a font you no longer use.`;
}
