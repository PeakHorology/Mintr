import { createRequire } from "node:module";
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel, Vec2 } from "manifold-3d";
import { footprintOutline } from "@/lib/laser/cutFile";
import { laserBatches, loopPieces, makeLaserParts, pendingLaserShapes, sendableShapes, shapesCentre, sheetPartFromLoops, sourcesForUpdate } from "@/lib/laser/sendToLaser";
import { meshForShape, type MeshData } from "@/lib/editorShapeMesh";
import type { WorkplaneShape } from "@/types/sketchforge";

let runtime: ManifoldToplevel;

beforeAll(async () => {
  const manifoldMod = await import("manifold-3d");
  const require = createRequire(import.meta.url);
  const wasmBinary = fs.readFileSync(require.resolve("manifold-3d/manifold.wasm"));
  runtime = await (manifoldMod.default as (cfg: { wasmBinary: Uint8Array }) => Promise<ManifoldToplevel>)({ wasmBinary });
  runtime.setup();
});

const box: WorkplaneShape = { id: "box", name: "Plate", kind: "box", color: "#d41721", x: 10, z: -5, elevation: 0, size: 40, width: 40, depth: 20, height: 15, rotation: 0, locked: true, hidden: false };
const cylinder: WorkplaneShape = { ...box, id: "cyl", name: "Knob", kind: "cylinder", x: 60, z: 0, width: 20, depth: 20, height: 30, locked: false };
const sheet = { thickness: 3, bedWidth: 400, bedDepth: 300, gap: 2 };
const link = { designId: "design-1", designName: "Lamp", mode: "outline" as const, revision: 7 };

describe("bringing a 3D model into a laser design", () => {
  it("sends only parts you can see, unlocked and marked to be made into sheet parts", () => {
    const hole: WorkplaneShape = { ...box, id: "hole", hole: true };
    const hidden: WorkplaneShape = { ...box, id: "hidden", hidden: true };
    const sent = pendingLaserShapes(sendableShapes([box, hole, hidden, cylinder]), link);
    expect(sent).toHaveLength(2);
    expect(sent.every((shape) => shape.laserLink?.pending && !shape.locked)).toBe(true);
    expect(sent[0].laserLink?.sourceIds).toEqual(["box", "cyl"]);
    expect(new Set(sent.map((shape) => shape.laserLink?.batch)).size).toBe(1);
    expect(sent[0].id).not.toBe("box");
  });

  it("Outline makes one sheet-thick part per 3D part, where it was", () => {
    const sent = pendingLaserShapes([box, cylinder], link);
    const result = makeLaserParts(runtime, sent, sheet, { color: "#c79a62" });
    expect(result.skipped).toEqual([]);
    expect(result.shapes).toHaveLength(2);
    const [plate, knob] = result.shapes;
    expect(plate.height).toBeCloseTo(3, 3);
    expect(plate.width).toBeCloseTo(40, 1);
    expect(plate.depth).toBeCloseTo(20, 1);
    expect(plate.x).toBeCloseTo(10, 1);
    expect(plate.z).toBeCloseTo(-5, 1);
    expect(knob.width).toBeCloseTo(20, 0);
    expect(plate.laserLink?.pending).toBeUndefined();
    expect(plate.laserLink?.batch).toBe(sent[0].laserLink?.batch);
  });

  it("Stacked layers makes as many layers as the material allows, packed on the bed", () => {
    const sent = pendingLaserShapes([cylinder], { ...link, mode: "stack" });
    const result = makeLaserParts(runtime, sent, sheet, { color: "#c79a62" });
    expect(result.shapes.length).toBe(10);
    expect(result.shapes.every((shape) => Math.abs(shape.height - 3) < 1e-6)).toBe(true);
  });

  it("an update keeps the engrave or score you chose on each part", () => {
    const first = makeLaserParts(runtime, pendingLaserShapes([box], link), sheet, { color: "#c79a62" }).shapes;
    const engraved = first.map((shape) => ({ ...shape, laserJob: "engrave" as const }));
    const again = makeLaserParts(runtime, pendingLaserShapes([{ ...box, width: 50 }], link), sheet, { color: "#c79a62", previous: engraved }).shapes;
    expect(again[0].laserJob).toBe("engrave");
    expect(again[0].width).toBeCloseTo(50, 1);
    expect(shapesCentre(again).x).toBeCloseTo(10, 1);
  });

  it("finds the parts to make again, and how many have gone", () => {
    const [part] = makeLaserParts(runtime, pendingLaserShapes([box, cylinder], link), sheet, { color: "#c79a62" }).shapes;
    expect(laserBatches([part, box]).size).toBe(1);
    const { found, missing } = sourcesForUpdate(part.laserLink!, [box]);
    expect(found.map((shape) => shape.id)).toEqual(["box"]);
    expect(missing).toBe(1);
  });
});

const square = (r: number, ccw: boolean): Vec2[] => (ccw ? [[-r, -r], [r, -r], [r, r], [-r, r]] : [[-r, -r], [-r, r], [r, r], [r, -r]]);
const footprintArea = (shape: WorkplaneShape) => {
  const section = new runtime.CrossSection(footprintOutline(runtime, meshForShape(shape)), "EvenOdd");
  const area = section.area();
  section.delete();
  return area;
};

describe("laser parts with islands inside holes", () => {
  it("sorts loops into solid pieces by how deep they sit", () => {
    const loops = [square(40, true), square(30, false), square(20, true), square(10, false), [[100, 0], [110, 0], [110, 10]] as Vec2[]];
    const pieces = loopPieces(loops).map((piece) => [...piece]).sort((a, b) => a[0] - b[0]);
    expect(pieces).toEqual([[0, 1], [2, 3], [4]]);
    // Winding does not matter, only nesting.
    expect(loopPieces([square(10, true), square(5, true)])).toEqual([[0, 1]]);
  });

  it("keeps a post inside a ring's hole solid", () => {
    const part = sheetPartFromLoops([square(40, true), square(30, false), square(20, true), square(10, false)], 3, { name: "Target", color: "#c" })!;
    expect(footprintArea(part)).toBeCloseTo(80 * 80 - 60 * 60 + 40 * 40 - 20 * 20, 1);
    const two = sheetPartFromLoops([[[0, 0], [10, 0], [10, 10], [0, 10]], [[20, 0], [30, 0], [30, 10], [20, 10]]], 3, { name: "Two", color: "#c" })!;
    expect(footprintArea(two)).toBeCloseTo(200, 1);
  });

  it("Outline and Stacked layers keep the island of a ring with a post in it", () => {
    const { Manifold } = runtime;
    const ring = Manifold.cube([80, 10, 80], true).subtract(Manifold.cube([60, 12, 60], true));
    const solid = ring.add(Manifold.cube([40, 10, 40], true));
    const m = solid.getMesh();
    const vertices: [number, number, number][] = [];
    for (let i = 0; i < m.numVert; i += 1) vertices.push([m.vertProperties[i * m.numProp], m.vertProperties[i * m.numProp + 1], m.vertProperties[i * m.numProp + 2]]);
    const faces: [number, number, number][] = [];
    for (let i = 0; i < m.triVerts.length; i += 3) faces.push([m.triVerts[i], m.triVerts[i + 1], m.triVerts[i + 2]]);
    [ring, solid].forEach((body) => body.delete());
    const mesh: MeshData = { name: "Target", vertices, faces };
    const target: WorkplaneShape = { ...box, id: "target", name: "Target", width: 80, depth: 80, height: 10 };
    for (const mode of ["outline", "stack"] as const) {
      const result = makeLaserParts(runtime, pendingLaserShapes([target], { ...link, mode }), { ...sheet, thickness: 5 }, { color: "#c", meshOf: () => mesh });
      expect(result.shapes.length).toBeGreaterThan(0);
      for (const part of result.shapes) expect(footprintArea(part), mode).toBeCloseTo(4400, 0);
    }
  });
});

describe("Update from model with parts of the same name", () => {
  const left: WorkplaneShape = { ...box, id: "left", name: "Box", x: -50, z: 0, height: 3, locked: false };
  const right: WorkplaneShape = { ...box, id: "right", name: "Box", x: 50, z: 0, height: 3, locked: false };

  it("keeps each part's job by the 3D part it came from", () => {
    const first = makeLaserParts(runtime, pendingLaserShapes([left, right], link), sheet, { color: "#c" }).shapes;
    expect(first.map((shape) => [shape.laserLink?.sourceId, shape.laserLink?.piece])).toEqual([["left", 0], ["right", 0]]);
    for (const which of [0, 1]) {
      const edited = first.map((shape, index) => (index === which ? { ...shape, laserJob: "engrave" as const } : shape));
      // Update from model passes the 3D parts themselves, with the link copied from the batch's first part.
      const sources = [left, right].map((shape) => ({ ...shape, laserLink: { ...edited[0].laserLink!, pending: true } }));
      const again = makeLaserParts(runtime, sources, sheet, { color: "#c", previous: edited }).shapes;
      expect(again.map((shape) => shape.laserLink?.sourceId)).toEqual(["left", "right"]);
      expect(again.map((shape) => shape.laserJob)).toEqual(which === 0 ? ["engrave", undefined] : [undefined, "engrave"]);
    }
  });

  it("keeps each layer's job when two parts share a name", () => {
    const tall = { ...left, height: 9 };
    const tallRight = { ...right, height: 9 };
    const first = makeLaserParts(runtime, pendingLaserShapes([tall, tallRight], { ...link, mode: "stack" }), sheet, { color: "#c" }).shapes;
    expect(first).toHaveLength(6);
    const target = first.find((shape) => shape.laserLink?.sourceId === "right" && shape.laserLink?.piece === 1)!;
    const edited = first.map((shape) => (shape === target ? { ...shape, laserJob: "score" as const } : shape));
    const sources = [tall, tallRight].map((shape) => ({ ...shape, laserLink: { ...edited[0].laserLink!, pending: true } }));
    const again = makeLaserParts(runtime, sources, sheet, { color: "#c", previous: edited }).shapes;
    const scored = again.filter((shape) => shape.laserJob === "score");
    expect(scored.map((shape) => [shape.laserLink?.sourceId, shape.laserLink?.piece])).toEqual([["right", 1]]);
  });

  it("older parts without an origin carry over by name only when the name is not shared", () => {
    const strip = (shape: WorkplaneShape): WorkplaneShape => {
      const { sourceId: _sourceId, piece: _piece, ...rest } = shape.laserLink!;
      return { ...shape, laserLink: rest };
    };
    const plate = { ...box, id: "plate", locked: false };
    const old = makeLaserParts(runtime, pendingLaserShapes([plate, left, right], link), sheet, { color: "#c" }).shapes
      .map(strip)
      .map((shape) => ({ ...shape, laserJob: "engrave" as const }));
    const again = makeLaserParts(runtime, pendingLaserShapes([plate, left, right], link), sheet, { color: "#c", previous: old }).shapes;
    expect(again.map((shape) => [shape.name, shape.laserJob])).toEqual([["Plate", "engrave"], ["Box", undefined], ["Box", undefined]]);
  });
});
