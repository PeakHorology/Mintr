import { createRequire } from "node:module";
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { strFromU8, unzipSync } from "fflate";
import { to3mfForShapes } from "@/lib/threeMfExport";
import { printMeshForShape } from "@/lib/texture/texturedShape";
import { buildPeakcadDocument, parsePeakcadDocument, serializePeakcadDocument } from "@/lib/peakcadDocument";
import {
  autoMagnetCount,
  buildOneToolboxLabel,
  buildToolboxLabelSet,
  buildToolboxLabelSetReport,
  defaultToolboxLabelSpec,
  layoutToolboxLabels,
  magnetFitProblem,
  magnetPocket,
  magnetsThatFit,
  normalizeToolboxLabelSpec,
  PLATE_GAP,
  toolboxLabelPlateSizes,
  toolboxLabelSetNotice,
} from "@/lib/toolboxLabel";
import { bedFitForShapes, normalizePrinterBed } from "@/lib/printerBed";
import { shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

let runtime: ManifoldToplevel;

beforeAll(async () => {
  const manifoldMod = await import("manifold-3d");
  const require = createRequire(import.meta.url);
  const wasmBinary = fs.readFileSync(require.resolve("manifold-3d/manifold.wasm"));
  runtime = await (manifoldMod.default as (cfg: { wasmBinary: Uint8Array }) => Promise<ManifoldToplevel>)({ wasmBinary });
  runtime.setup();
});

/** Every edge of a closed solid is shared by exactly two triangles, once each way. */
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

function volumeOf(shape: WorkplaneShape) {
  const { positions, indices } = shape.importedMesh!;
  let volume = 0;
  for (let i = 0; i < indices!.length; i += 3) {
    const [a, b, c] = [indices![i], indices![i + 1], indices![i + 2]].map((v) => positions.slice(v * 3, v * 3 + 3));
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return volume;
}

describe("toolbox labels", () => {
  it("fills in safe settings and drops blank labels", () => {
    const spec = normalizeToolboxLabelSpec({ labels: [{ text: "  " }, { text: "taps & dies", letterHeight: -3 }], slant: 90, magnetSize: "6x2", magnetDiameter: 99 });
    expect(spec.labels).toEqual([{ text: "taps & dies" }]);
    expect(spec.slant).toBe(20);
    expect(spec.magnetDiameter).toBe(6);
    expect(normalizeToolboxLabelSpec({ labels: [] }).labels).toEqual([{ text: "SOCKETS" }]);
  });

  it("puts a magnet about every 50 mm, at least one", () => {
    expect(autoMagnetCount(30)).toBe(1);
    expect(autoMagnetCount(50)).toBe(1);
    expect(autoMagnetCount(62)).toBe(2);
    expect(autoMagnetCount(160)).toBe(4);
  });

  it("says plainly when a magnet does not fit", () => {
    const spec = defaultToolboxLabelSpec();
    expect(magnetFitProblem(spec, 16)).toBeNull();
    expect(magnetFitProblem({ ...spec, thickness: 3 }, 16)).toMatch(/at least 3.5 mm thick/);
    expect(magnetFitProblem({ ...spec, pocket: "hidden" }, 16)).toMatch(/hidden/);
    expect(magnetFitProblem({ ...spec, magnetDiameter: 12 }, 12)).toMatch(/too wide/);
    expect(magnetPocket(spec)).toEqual({ diameter: 8.15, depth: 3.2 });
  });

  it("makes SOCKETS as a watertight plate with two pockets and letters standing on it", () => {
    const spec = defaultToolboxLabelSpec();
    const built = buildOneToolboxLabel(runtime, spec, { text: "SOCKETS" })!;
    expect(built).not.toBeNull();
    expect(built.problem).toBeNull();
    expect(built.magnets).toBe(2);
    expect(isWatertight(built.plate)).toBe(true);
    expect(isWatertight(built.letters)).toBe(true);
    expect(built.plate.height).toBeCloseTo(spec.thickness, 3);
    // The letters start exactly on the plate's top and are as tall as the raise.
    expect(built.letters.elevation).toBeCloseTo(spec.thickness, 3);
    expect(built.letters.height).toBeCloseTo(spec.raise, 3);
    // Pockets came out of the plate: less than a solid rounded plate.
    const solid = built.plateWidth * built.plateHeight * spec.thickness;
    const pocket = magnetPocket(spec);
    const pockets = 2 * Math.PI * (pocket.diameter / 2) ** 2 * pocket.depth;
    expect(volumeOf(built.plate)).toBeLessThan(solid - pockets * 0.9);
    // Capitals are the letter height (plus the lean), and the plate is that plus padding.
    expect(built.letters.depth).toBeGreaterThan(spec.letterHeight - 0.2);
    expect(built.letters.depth).toBeLessThan(spec.letterHeight + 0.5);
    expect(built.plateHeight).toBeCloseTo(spec.letterHeight + spec.padEnds * 2, 1);
  });

  it("keeps lowercase descenders and odd names on the plate", () => {
    const spec = { ...defaultToolboxLabelSpec(), allCaps: false };
    for (const text of ["pliers", 'TAPS & DIES', '1/4" SOCKETS', "3/8", "X", "ALLEN WRENCHES AND HEX KEYS METRIC"]) {
      const built = buildOneToolboxLabel(runtime, spec, { text })!;
      expect(built, text).not.toBeNull();
      expect(isWatertight(built.letters), text).toBe(true);
      expect(isWatertight(built.plate), text).toBe(true);
      expect(built.letters.depth, text).toBeLessThan(built.plate.depth);
      expect(built.letters.width, text).toBeLessThan(built.plate.width);
    }
  });

  it("makes the set as a Tie of labels, each a Tie of plate and letters, keeping its settings", () => {
    const set = buildToolboxLabelSet(runtime, null, { x: 10, z: 5 })!;
    expect(set.csg?.op).toBe("assemble");
    expect(set.toolboxLabel?.labels[0].text).toBe("SOCKETS");
    const [label] = set.groupedShapes!;
    expect(label.csg?.op).toBe("assemble");
    expect(label.name).toBe("SOCKETS");
    expect(label.groupedShapes?.map((part) => part.color)).toEqual([set.toolboxLabel!.plateColor, set.toolboxLabel!.letterColor]);
    expect(set.x).toBe(10);
  });

  it("exports a label to 3MF as one object of two parts in two colours", () => {
    const set = buildToolboxLabelSet(runtime, null)!;
    const xml = strFromU8(unzipSync(to3mfForShapes([set]).bytes)["3D/3dmodel.model"]);
    expect(xml.match(/<base /g)).toHaveLength(2);
    expect(xml).toContain('displaycolor="#1D1F22FF"');
    expect(xml).toContain('displaycolor="#F2F2EEFF"');
    expect(xml.match(/<component /g)).toHaveLength(2);
    expect(xml.match(/<item /g)).toHaveLength(1);
    // A plain part still goes out on its own.
    const box: WorkplaneShape = { id: "b", name: "Box", kind: "box", color: "#d41721", x: 80, z: 0, elevation: 0, size: 20, width: 20, depth: 20, height: 20, rotation: 0, locked: false, hidden: false };
    const both = strFromU8(unzipSync(to3mfForShapes([set, box]).bytes)["3D/3dmodel.model"]);
    expect(both.match(/<item /g)).toHaveLength(2);
  });

  it("saves in a .mintr file and opens with its settings, parts and font", () => {
    const set = buildToolboxLabelSet(runtime, { labels: [{ text: "RATCHETS" }], magnetSize: "10x3", font: "Brush" })!;
    const project = { id: "p1", name: "Drawers", createdAt: 1, updatedAt: 1, accent: "cyan" as const, shapes: 1 };
    const fonts = [{ id: "a", name: "Brush", fileName: "Brush.ttf", typeface: "{}" }];
    const opened = parsePeakcadDocument(serializePeakcadDocument(buildPeakcadDocument({ project, shapes: [set], fonts })));
    const back = opened.shapes[0];
    expect(back.toolboxLabel).toEqual(set.toolboxLabel);
    expect(back.toolboxLabel?.magnetDiameter).toBe(10);
    const parts = back.groupedShapes?.[0].groupedShapes;
    expect(parts?.map((part) => part.name)).toEqual(["RATCHETS plate", "RATCHETS letters"]);
    expect(parts?.[0].importedMesh?.positions.length).toBe(set.groupedShapes?.[0].groupedShapes?.[0].importedMesh?.positions.length);
    expect(opened.fonts?.map((font) => font.name)).toEqual(["Brush"]);
  });

  it("rounds the plate's top edge and leaves its bottom flat", () => {
    const square = buildOneToolboxLabel(runtime, { ...defaultToolboxLabelSpec(), edgeRound: 0, magnetCount: 1 }, { text: "X" })!;
    const round = buildOneToolboxLabel(runtime, { ...defaultToolboxLabelSpec(), edgeRound: 1, magnetCount: 1 }, { text: "X" })!;
    expect(isWatertight(round.plate)).toBe(true);
    expect(round.plate.height).toBeCloseTo(square.plate.height, 3);
    expect(round.plate.width).toBeCloseTo(square.plate.width, 3);
    expect(volumeOf(round.plate)).toBeLessThan(volumeOf(square.plate));
  });

  it("exports to STL with both the plate and the letters", () => {
    const set = buildToolboxLabelSet(runtime, null)!;
    const [plate, letters] = set.groupedShapes![0].groupedShapes!;
    const faces = printMeshForShape(set).faces.length;
    expect(faces).toBe(plate.importedMesh!.indices!.length / 3 + letters.importedMesh!.indices!.length / 3);
  });
});

describe("toolbox label sets", () => {
  const bed = { width: 220, depth: 220 };
  const DRAWERS = ["SOCKETS", "RATCHETS", "ALLEN WRENCHES", "TAPS & DIES", '1/4" SOCKETS', "pliers", "3/8", "X"];

  it("lays labels in rows, 4 mm apart, in the order given", () => {
    const { placements, plates } = layoutToolboxLabels([{ width: 100, height: 16 }, { width: 100, height: 16 }, { width: 100, height: 16 }], bed);
    expect(plates).toBe(1);
    expect(placements.map((place) => [place.x, place.y])).toEqual([[50, 8], [154, 8], [50, 28]]);
  });

  it("starts a new plate beside the bed when one is full, and drops nothing", () => {
    const sizes = Array.from({ length: 30 }, () => ({ width: 100, height: 16 }));
    const { placements, plates } = layoutToolboxLabels(sizes, bed);
    // Two labels a row, eleven rows a plate (11 × 16 + 10 × 4 = 216 mm).
    expect(plates).toBe(2);
    expect(placements).toHaveLength(30);
    expect(placements.filter((place) => place.plate === 0)).toHaveLength(22);
    // Plate 2 sits to the right of the bed, a gap away.
    expect(placements[22].x - 50).toBe(220 + PLATE_GAP);
    for (const place of placements) {
      const left = place.plate * (bed.width + PLATE_GAP);
      expect(place.x - 50).toBeGreaterThanOrEqual(left - 1e-9);
      expect(place.x + 50).toBeLessThanOrEqual(left + bed.width + 1e-9);
      expect(place.y + 8).toBeLessThanOrEqual(bed.depth + 1e-9);
    }
  });

  it("gives a label bigger than the bed a plate of its own and says so", () => {
    const { placements, plates } = layoutToolboxLabels([{ width: 50, height: 16 }, { width: 300, height: 16 }, { width: 50, height: 16 }], bed);
    expect(plates).toBe(3);
    expect(placements.map((place) => place.plate)).toEqual([0, 1, 2]);
    expect(placements[1].tooBig).toBe(true);
    const notice = toolboxLabelSetNotice({ perPlate: [1, 1, 1], tooBig: ["ALLEN WRENCHES"], problem: null, missing: [] }, bed);
    expect(notice).toMatch(/"ALLEN WRENCHES" is bigger than the 220 × 220 mm bed/);
    expect(notice).toMatch(/3 printer plates: 1 on plate 1, 1 on plate 2, 1 on plate 3/);
  });

  it("starts the next plate clear of a label that runs past its own", () => {
    const sizes = [{ width: 50, height: 16 }, { width: 300, height: 16 }, { width: 50, height: 16 }];
    const { placements } = layoutToolboxLabels(sizes, bed);
    const rightOfBig = placements[1].x + 150;
    expect(placements[2].x - 25).toBeGreaterThanOrEqual(rightOfBig + PLATE_GAP - 1e-9);
  });

  it("leaves out letters the font lacks instead of printing ?, and says which", () => {
    const report = buildToolboxLabelSetReport(runtime, { ...defaultToolboxLabelSpec(), labels: [{ text: "PLIERS☃" }] }, {}, bed)!;
    expect(report.unknownLetters).toEqual(["☃"]);
    const plain = buildToolboxLabelSetReport(runtime, { ...defaultToolboxLabelSpec(), labels: [{ text: "PLIERS" }] }, {}, bed)!;
    expect(shapeWidth(report.shape)).toBeCloseTo(shapeWidth(plain.shape), 3);
    expect(toolboxLabelSetNotice({ ...report, perPlate: [1] }, bed)).toMatch(/The font has no "☃", so that letter was left out/);
  });

  it("counts how many magnet pockets fit along a plate", () => {
    expect(magnetsThatFit(10, 6.2)).toBe(1);
    expect(magnetsThatFit(5, 6.2)).toBe(0);
    // 13 pockets and 14 walls take 97.4 mm.
    expect(magnetsThatFit(100, 6.2)).toBe(13);
  });
  it("builds every tricky name in one set, all watertight and the same height", () => {
    const report = buildToolboxLabelSetReport(runtime, { labels: DRAWERS.map((text) => ({ text })), allCaps: false }, {}, bed)!;
    const labels = report.shape.groupedShapes!;
    expect(labels.map((label) => label.name)).toEqual(DRAWERS);
    expect(report.perPlate).toEqual([DRAWERS.length]);
    expect(report.problem).toBeNull();
    expect(toolboxLabelSetNotice(report, bed)).toBeNull();
    const heights = toolboxLabelPlateSizes(report.shape).map((size) => size.height);
    for (const height of heights) expect(height).toBeCloseTo(heights[0], 6);
    for (const label of labels) {
      for (const part of label.groupedShapes!) expect(isWatertight(part), part.name).toBe(true);
    }
    // Nothing overlaps: every label's footprint is apart from the others.
    const boxes = labels.map((label) => ({ minX: label.x - label.width! / 2, maxX: label.x + label.width! / 2, minZ: label.z - label.depth! / 2, maxZ: label.z + label.depth! / 2 }));
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const apart = boxes[a].maxX <= boxes[b].minX + 1e-6 || boxes[b].maxX <= boxes[a].minX + 1e-6 || boxes[a].maxZ <= boxes[b].minZ + 1e-6 || boxes[b].maxZ <= boxes[a].minZ + 1e-6;
        expect(apart, `${labels[a].name} / ${labels[b].name}`).toBe(true);
      }
    }
  });

  it("makes every plate as wide as the widest with Same width, and lets one name have its own letters", () => {
    const same = buildToolboxLabelSet(runtime, { labels: [{ text: "X" }, { text: "SOCKETS" }], sameWidth: true }, {}, bed)!;
    const widths = toolboxLabelPlateSizes(same).map((size) => size.width);
    expect(widths[0]).toBeCloseTo(widths[1], 6);
    const own = buildToolboxLabelSet(runtime, { labels: [{ text: "SOCKETS" }, { text: "ALLEN WRENCHES", letterHeight: 5 }], sameHeight: false }, {}, bed)!;
    const [sockets, allen] = own.groupedShapes!.map((label) => label.groupedShapes![1]);
    expect(allen.depth).toBeLessThan(sockets.depth - 2);
  });

  it("grows from its back-left corner when a label is added", () => {
    const first = buildToolboxLabelSet(runtime, { labels: [{ text: "SOCKETS" }] }, { x: -60, z: -40 }, bed)!;
    const second = buildToolboxLabelSet(runtime, { labels: [{ text: "SOCKETS" }, { text: "RATCHETS" }] }, first, bed)!;
    expect(second.x - second.width! / 2).toBeCloseTo(first.x - first.width! / 2, 6);
    expect(second.z - second.depth! / 2).toBeCloseTo(first.z - first.depth! / 2, 6);
  });

  it("keeps its first plate on the bed, and only that plate has to fit it", () => {
    const printer = normalizePrinterBed({ printerPreset: "ender-3" });
    const one = buildToolboxLabelSet(runtime, null, { x: 60, z: 0 }, printer)!;
    const eight = buildToolboxLabelSet(runtime, { labels: DRAWERS.map((text) => ({ text })) }, one, printer)!;
    expect(bedFitForShapes([eight], printer).message).toBeNull();
    const many = buildToolboxLabelSet(runtime, { labels: Array.from({ length: 40 }, (_, i) => ({ text: `DRAWER ${i + 1}` })) }, eight, printer)!;
    expect(shapeWidth(many)).toBeGreaterThan(printer.width);
    expect(bedFitForShapes([many], printer).message).toBeNull();
    expect(bedFitForShapes([{ ...many, x: many.x + 100 }], printer).message).toMatch(/Past the/);
  });

  it("exports a set to 3MF as one object per label, each with its plate and letters in two colours", () => {
    const set = buildToolboxLabelSet(runtime, { labels: [{ text: "SOCKETS" }, { text: "RATCHETS" }, { text: "PLIERS" }] }, {}, bed)!;
    const xml = strFromU8(unzipSync(to3mfForShapes([set]).bytes)["3D/3dmodel.model"]);
    expect(xml.match(/<item /g)).toHaveLength(3);
    expect(xml.match(/<component /g)).toHaveLength(6);
    expect(xml.match(/<base /g)).toHaveLength(2);
    expect(xml).toContain('name="RATCHETS"');
  });
});
