import { createRequire } from "node:module";
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import {
  addKeyringTab,
  buildPictureKeychain,
  decodeDrawing,
  defaultPictureKeychainSpec,
  encodeDrawing,
  followBacking,
  pictureKeychainLines,
  pictureKeychainNotice,
  thinLineShare,
  type TracedDrawingPiece,
} from "@/lib/pictureKeychain";
import { roundedTopSlab } from "@/lib/toolboxLabel";
import type { WorkplaneShape } from "@/types/sketchforge";

let runtime: ManifoldToplevel;

beforeAll(async () => {
  const manifoldMod = await import("manifold-3d");
  const require = createRequire(import.meta.url);
  const wasmBinary = fs.readFileSync(require.resolve("manifold-3d/manifold.wasm"));
  runtime = await (manifoldMod.default as (cfg: { wasmBinary: Uint8Array }) => Promise<ManifoldToplevel>)({ wasmBinary });
  runtime.setup();
});

function circle(cx: number, cy: number, r: number, steps = 48) {
  return Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
}

function rect(x: number, y: number, w: number, h: number) {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

/**
 * Line art as the tracer gives it, 40 × 30 mm, y down: a ring (a stroke with white inside), a
 * dot in the ring's middle, and a short bar off to the right, apart from the ring.
 */
const LINE_ART: TracedDrawingPiece[] = [
  { outer: circle(15, 15, 15), holes: [circle(15, 15, 13.5)] },
  { outer: circle(15, 15, 2), holes: [] },
  { outer: rect(34, 13, 6, 4), holes: [] },
];
const DRAWING = encodeDrawing(LINE_ART);

function isWatertight(shape: WorkplaneShape) {
  const mesh = shape.importedMesh!;
  const indices = mesh.indices!;
  const edges = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      const a = indices[i + k];
      const b = indices[i + ((k + 1) % 3)];
      edges.set(`${a},${b}`, (edges.get(`${a},${b}`) ?? 0) + 1);
    }
  }
  for (const [key, count] of edges) {
    const [a, b] = key.split(",");
    if (count !== 1 || edges.get(`${b},${a}`) !== 1) return false;
  }
  return true;
}

describe("picture keychain", () => {
  it("keeps the drawing as text that reads back the same", () => {
    const pieces = decodeDrawing(DRAWING);
    expect(pieces).toHaveLength(3);
    expect(pieces[0]).toHaveLength(2);
    expect(pieces[0][0][0][0]).toBeCloseTo(30, 2);
  });

  it("fills the white inside the drawing and joins pieces that are apart", () => {
    const spec = defaultPictureKeychainSpec(DRAWING, 40, 30);
    const lines = pictureKeychainLines(runtime, spec)!;
    const { outline, pieces } = followBacking(runtime, lines, spec.pad, 30);
    expect(pieces).toBe(1);
    // A spot in the ring's white, between the stroke and the dot, is plate.
    const probe = runtime.CrossSection.circle(0.5, 16).translate([-5 + 6, 0]);
    expect(outline.intersect(probe).area()).toBeCloseTo(probe.area(), 3);
    probe.delete();
    outline.delete();
    lines.delete();
  });

  it("measures strokes too thin to print, and thickening fixes them", () => {
    const thin = runtime.CrossSection.square([20, 0.5], true);
    const thick = runtime.CrossSection.square([20, 2], true);
    expect(thinLineShare(thin)).toBeGreaterThan(0.9);
    expect(thinLineShare(thick)).toBeLessThan(0.05);
    thin.delete();
    thick.delete();
    const hairline = encodeDrawing([{ outer: rect(0, 0, 30, 0.4), holes: [] }]);
    const plain = buildPictureKeychain(runtime, defaultPictureKeychainSpec(hairline, 30, 0.4, "plaque"))!;
    expect(plain.thinShare).toBeGreaterThan(0.9);
    expect(pictureKeychainNotice(plain)).toContain("Thicken lines");
    const thickened = buildPictureKeychain(runtime, { ...defaultPictureKeychainSpec(hairline, 30, 0.4, "plaque"), thicken: 1 })!;
    expect(thickened.thinShare).toBeLessThan(0.05);
  });

  it("puts the keyring hole in a tab, clear of the drawing", () => {
    const plate = runtime.CrossSection.square([30, 20], true);
    const { plate: withTab, hole } = addKeyringTab(runtime, plate, "top", 5);
    expect(withTab.bounds().max[1]).toBeGreaterThan(10 + 5);
    expect(withTab.intersect(hole).area()).toBeLessThan(0.01);
    expect(hole.bounds().min[1]).toBeGreaterThanOrEqual(10 - 0.01);
    plate.delete();
    withTab.delete();
    hole.delete();
  });

  it("builds a keychain as a plate and raised lines, both watertight", () => {
    const built = buildPictureKeychain(runtime, defaultPictureKeychainSpec(DRAWING, 40, 30), { id: "kc", x: 10, z: 5 })!;
    expect(built.platePieces).toBe(1);
    const { shape } = built;
    expect(shape.id).toBe("kc");
    expect(shape.x).toBe(10);
    expect(shape.pictureKeychain?.hole).toBe("top");
    const [plate, lines] = shape.groupedShapes!;
    expect(plate.color).toBe(shape.pictureKeychain!.plateColor);
    expect(lines.color).toBe(shape.pictureKeychain!.lineColor);
    expect(isWatertight(plate)).toBe(true);
    expect(isWatertight(lines)).toBe(true);
    expect(lines.elevation - plate.elevation).toBeCloseTo(3, 3);
    // The tab makes it deeper than the drawing plus padding.
    expect(shape.depth).toBeGreaterThan(30 + 4 + 5);
  });

  it("keeps the top of the plate whole round the keyring tab, on every side", () => {
    for (const hole of ["top", "left", "right"] as const) {
      for (const holeDiameter of [3, 5, 8]) {
        const { shape } = buildPictureKeychain(runtime, { ...defaultPictureKeychainSpec(DRAWING, 40, 30), hole, holeDiameter })!;
        const plate = shape.groupedShapes![0];
        const { positions: p, indices } = plate.importedMesh!;
        let folded = 0;
        for (let i = 0; i < indices!.length; i += 3) {
          const [a, b, c] = [indices![i] * 3, indices![i + 1] * 3, indices![i + 2] * 3];
          if (Math.min(p[a + 1], p[b + 1], p[c + 1]) < plate.height - 1e-3) continue;
          // Seen from above, with Mintr's z towards the front, a top face runs anticlockwise.
          const area = (p[b] - p[a]) * (p[a + 2] - p[c + 2]) - (p[a + 2] - p[b + 2]) * (p[c] - p[a]);
          if (area < -1e-6) folded += 1;
        }
        expect(folded, `${hole} ${holeDiameter}`).toBe(0);
        expect(isWatertight(plate)).toBe(true);
      }
    }
  });

  it("rounds the top of an outline with doubled points and micro zigzags without folding it", () => {
    // Points as a joined, traced outline leaves them: one doubled, and a zigzag a few microns
    // across that doubles back, along the bottom edge (taken from a real keychain that folded).
    const outline = new runtime.CrossSection([[
      [-18.42, -10.89], [-18.367, -10.895], [-18.333, -10.899], [-18.28, -10.906], [-18.236, -10.913],
      [-18.237, -10.915], [-18.223, -10.918], [-18.222, -10.913], [-17.886, -10.955], [-17.886, -10.955],
      [-10, -11], [10, -11], [10, 10], [-25, 10], [-25, -10.5],
    ]], "Positive");
    const slab = roundedTopSlab(runtime, outline, 3, 0.4);
    const mesh = slab.getMesh();
    let folded = 0;
    for (let i = 0; i < mesh.triVerts.length; i += 3) {
      const v = [0, 1, 2].map((k) => mesh.triVerts[i + k] * mesh.numProp);
      const z = v.map((at) => mesh.vertProperties[at + 2]);
      if (Math.min(...z) < 3 - 1e-3) continue;
      const [a, b, c] = v.map((at) => [mesh.vertProperties[at], mesh.vertProperties[at + 1]]);
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < -1e-6) folded += 1;
    }
    expect(folded).toBe(0);
    expect(slab.volume()).toBeGreaterThan(outline.area() * 2.6);
    expect(slab.volume()).toBeLessThan(outline.area() * 3 + 1e-6);
    slab.delete();
    outline.delete();
  });

  it("makes one part with inset lines, and the bare drawing with no backing", () => {
    const inset = buildPictureKeychain(runtime, { ...defaultPictureKeychainSpec(DRAWING, 40, 30), lines: "inset" })!;
    expect(inset.shape.groupedShapes).toBeUndefined();
    expect(isWatertight(inset.shape)).toBe(true);
    expect(inset.shape.height).toBeCloseTo(3, 3);
    const bare = buildPictureKeychain(runtime, defaultPictureKeychainSpec(DRAWING, 40, 30, "drawing"))!;
    expect(bare.shape.groupedShapes).toBeUndefined();
    expect(bare.shape.width).toBeCloseTo(40, 1);
  });

  it("resizes the drawing to the chosen width", () => {
    const built = buildPictureKeychain(runtime, { ...defaultPictureKeychainSpec(DRAWING, 40, 30, "drawing"), width: 80 })!;
    expect(built.shape.width).toBeCloseTo(80, 1);
    expect(built.shape.depth).toBeCloseTo(60, 1);
  });
});
