import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matchedTextWidth, textLayoutMetrics, withMatchedTextFootprint } from "@/lib/editorShapeMesh";
import { resolveTextFont, TEXT_FONT_OPTIONS, textGlyphFont } from "@/lib/textFonts";
import { getShapeProperties, MAX_TEXT_SHAPE_LETTERS } from "@/components/workplane/shapeProperties";
import { sceneShape } from "@/lib/shapeCatalog";
import { MAX_TEXTURE_FONT_NAME_LENGTH, normalizeSurfaceTexture } from "@/lib/texture/surfaceTexture";
import type { WorkplaneShape } from "@/types/sketchforge";

const monoJson = createRequire(import.meta.url)("three/examples/fonts/droid/droid_sans_mono_regular.typeface.json");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const ACCENTED = [..."éüñçßøłőЖ€"];

describe("Letters a font lacks", () => {
  it("borrows each missing letter from a built-in font that has it", () => {
    for (const name of TEXT_FONT_OPTIONS) {
      for (const char of ACCENTED) {
        const font = textGlyphFont(name, char);
        expect(font, `${name} ${char}`).not.toBeNull();
        expect((font!.data.glyphs as Record<string, unknown>)[char], `${name} ${char}`).toBeTruthy();
      }
    }
    // A letter the font has is drawn with that font.
    expect(textGlyphFont("Multilanguage", "A")).toBe(resolveTextFont("Multilanguage"));
  });

  it("measures Café with a real é, not a question mark", () => {
    const cafe = textLayoutMetrics({ text: "Café", font: "Multilanguage" });
    const question = textLayoutMetrics({ text: "Caf?", font: "Multilanguage" });
    expect(cafe.laidWidth).not.toBeCloseTo(question.laidWidth, 3);
    const sans = resolveTextFont("Sans");
    const multi = resolveTextFont("Multilanguage");
    const advance = (font: typeof sans, char: string) =>
      ((font.data.glyphs as Record<string, { ha: number }>)[char].ha * 20) / font.data.resolution;
    expect(cafe.laidWidth).toBeCloseTo(advance(multi, "C") + advance(multi, "a") + advance(multi, "f") + advance(sans, "é"), 6);
  });

  it("composes decomposed accents first", () => {
    const composed = textLayoutMetrics({ text: "Café", font: "Clean" });
    const decomposed = textLayoutMetrics({ text: "Café", font: "Clean" });
    expect(decomposed).toEqual(composed);
  });

  it("keeps text the font fully covers exactly as before", () => {
    const multi = resolveTextFont("Multilanguage");
    const glyphs = multi.data.glyphs as Record<string, { ha: number }>;
    const expected = [..."HELLO"].reduce((sum, char) => sum + (glyphs[char].ha * 20) / multi.data.resolution, 0);
    expect(textLayoutMetrics({ text: "HELLO", font: "Multilanguage" }).laidWidth).toBeCloseTo(expected, 9);
  });
});

describe("Editing a Text shape's words", () => {
  const textShape = () => sceneShape({ name: "Text", kind: "text", color: "#888888", width: 30, depth: 8, height: 3, text: "HELLO" } as never) as WorkplaneShape;
  const edit = (shape: WorkplaneShape, text: string) => {
    let patch: Partial<WorkplaneShape> | null = null;
    const property = getShapeProperties(shape, (next) => {
      patch = next;
    }).find((entry) => entry.label === "Text") as { onChange: (value: string) => void; maxLength?: number; hint?: string };
    property.onChange(text);
    return { patch: patch as unknown as Partial<WorkplaneShape>, property };
  };

  it("keeps the letter height the person set", () => {
    const shape = textShape();
    const { patch } = edit(shape, "HELL0");
    expect(patch.width).toBeCloseTo(matchedTextWidth({ ...shape, text: "HELL0" }, shape.depth ?? 8), 6);
    const footprint = withMatchedTextFootprint(shape, patch);
    expect(footprint.depth).toBeCloseTo(shape.depth ?? 8, 2);
  });

  it("cuts long text by letters, never splitting an emoji, and says so", () => {
    const shape = textShape();
    const { patch, property } = edit(shape, "ABCDEFGHIJKLMNOPQRSTUVW\u{1F600}XYZ");
    expect(Array.from(patch.text!)).toHaveLength(MAX_TEXT_SHAPE_LETTERS);
    expect(patch.text!.endsWith("\u{1F600}")).toBe(true);
    expect(property.hint).toMatch(/24 letters/);
    expect(property.maxLength).toBeGreaterThanOrEqual(MAX_TEXT_SHAPE_LETTERS);
  });
});

describe("Text texture font names", () => {
  it("keeps a 60-letter added font name", () => {
    const name = "F".repeat(60);
    expect(MAX_TEXTURE_FONT_NAME_LENGTH).toBe(60);
    const image = { name: "t", width: 3, height: 1, data: "AAAA", invert: false, text: { value: "Hi", font: name } };
    expect(normalizeSurfaceTexture({ pattern: "image", image }).image?.text?.font).toBe(name);
  });
});

function stubBrowser(options: { full?: boolean } = {}) {
  const store = new Map<string, string>();
  const listeners: Array<() => void> = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (options.full) throw new Error("QuotaExceededError");
        store.set(key, value);
      },
    },
    addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
    dispatchEvent: () => {
      listeners.forEach((listener) => listener());
      return true;
    },
  });
  vi.stubGlobal("CustomEvent", class extends Event {});
}

describe("Added fonts", () => {
  it("measures text again once its font is added", async () => {
    stubBrowser();
    vi.resetModules();
    const mesh = await import("@/lib/editorShapeMesh");
    const store = await import("@/lib/customFontStore");
    const shape = { text: "iiiii", font: "MyMono" };
    const before = mesh.textLayoutMetrics(shape);
    store.writeCustomFonts([{ id: "1", name: "MyMono", fileName: "x.ttf", typeface: JSON.stringify(monoJson) }]);
    const after = mesh.textLayoutMetrics(shape);
    expect(after).toEqual(mesh.textLayoutMetrics({ text: "iiiii", font: "Monospace" }));
    expect(after.laidWidth).not.toBeCloseTo(before.laidWidth, 3);
  });

  it("keeps a design's font when there is no room to install it", async () => {
    stubBrowser({ full: true });
    vi.resetModules();
    const store = await import("@/lib/customFontStore");
    const fonts = await import("@/lib/textFonts");
    const report = store.installDesignFontsReport([{ name: "Carried", typeface: JSON.stringify(monoJson) }, { name: "Bad", typeface: "{" }], "Sign");
    expect(report).toEqual({ added: [], failed: ["Carried"] });
    expect(store.designFontsNotKeptMessage(report.failed)).toMatch(/Carried/);
    expect(store.designFontsNotKeptMessage([])).toBeNull();
    // Saving still writes it into the file.
    const label = { id: "t", name: "T", kind: "text", font: "Carried" } as unknown as WorkplaneShape;
    expect(store.designFontsFor([label], store.designFontLibrary()).map((font) => font.name)).toEqual(["Carried"]);
    // And the text still draws with it.
    expect(fonts.resolveTextFont("Carried")).not.toBe(fonts.resolveTextFont("Multilanguage"));
    expect(store.installDesignFonts([{ name: "Carried", typeface: JSON.stringify(monoJson) }], "Sign")).toEqual([]);
  });
});
