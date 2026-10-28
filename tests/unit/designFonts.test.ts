import { afterEach, describe, expect, it, vi } from "vitest";
import { designFontsFor, fontsUsedBy, installDesignFonts, normalizeDesignFonts, readCustomFonts } from "@/lib/customFontStore";
import { buildPeakcadDocument, parsePeakcadDocument, serializePeakcadDocument } from "@/lib/peakcadDocument";
import type { WorkplaneShape } from "@/types/sketchforge";

const typeface = JSON.stringify({ glyphs: { A: { ha: 600, x_min: 0, x_max: 600, o: "m 0 0 l 600 0 l 300 700 z" } }, resolution: 1000 });
const library = [
  { id: "a", name: "Brush", fileName: "Brush.ttf", typeface },
  { id: "b", name: "Unused", fileName: "Unused.ttf", typeface },
];

function shape(overrides: Partial<WorkplaneShape>): WorkplaneShape {
  return {
    id: "s", name: "Shape", kind: "box", color: "#d41721",
    x: 0, z: 0, elevation: 0, size: 20, width: 20, depth: 20, height: 10, rotation: 0,
    ...overrides,
  };
}

const project = { id: "p1", name: "Sign", createdAt: 1, updatedAt: 1, accent: "cyan" as const, shapes: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fonts in design files", () => {
  it("finds fonts in Text shapes, text textures and grouped parts", () => {
    const used = fontsUsedBy([
      shape({ kind: "text", font: "Brush" }),
      shape({
        kind: "group",
        groupedShapes: [shape({
          surfaceTexture: { pattern: "image", image: { name: "t", width: 4, height: 4, data: "", invert: false, text: { value: "HI", font: "Stencilish" } } },
        } as Partial<WorkplaneShape>)],
      }),
    ]);
    expect([...used].sort()).toEqual(["Brush", "Stencilish"]);
  });

  it("writes only the added fonts a design uses, and reads them back", () => {
    const shapes = [shape({ kind: "text", font: "Brush" }), shape({ kind: "text", font: "Serif" })];
    const text = serializePeakcadDocument(buildPeakcadDocument({ project, shapes, fonts: library }));
    const opened = parsePeakcadDocument(text);
    expect(opened.fonts).toEqual([{ name: "Brush", typeface }]);
    expect(designFontsFor(shapes, [{ name: "Serif", typeface }])).toEqual([]);
    expect(parsePeakcadDocument(serializePeakcadDocument(buildPeakcadDocument({ project, shapes: [] , fonts: library }))).fonts).toBeUndefined();
  });

  it("ignores broken or built-in fonts in a file", () => {
    expect(normalizeDesignFonts([{ name: "Sans", typeface }, { name: 3 }, null, { name: " Brush ", typeface }, { name: "Brush", typeface }]))
      .toEqual([{ name: "Brush", typeface }]);
  });

  it("adds a design's fonts to this computer once", () => {
    const store = new Map<string, string>();
    const events: string[] = [];
    vi.stubGlobal("window", {
      localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) },
      dispatchEvent: (event: Event) => events.push(event.type),
    });
    vi.stubGlobal("CustomEvent", class extends Event {});
    expect(installDesignFonts([{ name: "Brush", typeface }, { name: "Bad", typeface: "{" }], "Sign")).toEqual(["Brush"]);
    expect(installDesignFonts([{ name: "Brush", typeface }], "Sign")).toEqual([]);
    expect(readCustomFonts().map((font) => [font.name, font.fileName])).toEqual([["Brush", "From Sign"]]);
    expect(events).toEqual(["mintr:custom-fonts-changed"]);
  });
});
