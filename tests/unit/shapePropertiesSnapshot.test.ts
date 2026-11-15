import { describe, expect, it } from "vitest";
import { getShapeProperties, type ShapePropertyConfig } from "@/components/workplane/shapeProperties";
import { drivablePropertyLabels } from "@/components/workplane/valueDrivenPatches";
import { makeShapeFromAsset, sceneShape, toolbarShapeAssets } from "@/lib/shapeCatalog";
import { createThreadShape } from "@/lib/threadShape";
import type { ShapeKind, WorkplaneShape } from "@/types/sketchforge";

/**
 * The inspector's rows are data (`getShapeProperties`), and every user meets them on every
 * selection. This snapshot holds the rows a person without Mintr Pro sees, for one sample of
 * every kind of part: labels, order, numbers, ranges, steps, hints and choices. A change to it is
 * a change basic users can see, so it should only ever change on purpose.
 */

function describeRows(rows: ShapePropertyConfig[]) {
  const number = (value: number | undefined) => (value === undefined ? undefined : Number(value.toFixed(6)));
  return rows.map((row) => {
    if (row.type === "heading") return { type: "heading", label: row.label };
    if (row.type === "text") return { type: "text", label: row.label, value: row.value, maxLength: row.maxLength, multiline: row.multiline, hint: row.hint };
    if (row.type === "select") return { type: "select", label: row.label, value: row.value, options: row.options, hint: row.hint };
    return {
      type: "range",
      label: row.label,
      value: number(row.value),
      min: number(row.min),
      max: number(row.max),
      typedMax: number(row.typedMax),
      step: number(row.step),
      hint: row.hint,
      centerDetent: row.centerDetent,
    };
  });
}

const cube = [0, 0, 0, 10, 0, 0, 0, 10, 0];
const mesh = (name: string, extra: Partial<WorkplaneShape> = {}): WorkplaneShape => sceneShape({
  id: name,
  name,
  kind: "mesh",
  color: "#b08d57",
  width: 30,
  depth: 20,
  height: 12,
  importedMesh: { positions: cube, baseWidth: 30, baseDepth: 20, baseHeight: 12, triangleCount: 1, sourceFormat: "stl" },
  ...extra,
});
const plain = (kind: ShapeKind, extra: Partial<WorkplaneShape> = {}): WorkplaneShape =>
  sceneShape({ id: kind, name: kind, kind, color: "#d41721", width: 24, depth: 18, height: 12, ...extra });

function samples(): Array<[string, WorkplaneShape]> {
  const out: Array<[string, WorkplaneShape]> = [];
  // Everything the Shapes list can add, as it lands on the workplane.
  for (const asset of toolbarShapeAssets) {
    const shape = asset.kind === "thread"
      ? createThreadShape({ designation: "M6", base: { id: "thread", name: "Threads M6", color: asset.color } })
      : makeShapeFromAsset(asset, { x: 0, z: 0 }, "standard");
    out.push([`shapes list: ${asset.name}`, shape]);
  }
  // Kinds that are not in the list any more, or are made by other tools.
  out.push(["kind: ring", plain("ring", { radius: 3 })]);
  out.push(["kind: icosahedron", plain("icosahedron")]);
  out.push(["kind: scribble", plain("scribble")]);
  out.push(["kind: sketch", plain("sketch")]);
  const box = plain("box");
  const cylinder = plain("cylinder", { id: "cyl", x: 4 });
  out.push(["a hole", { ...cylinder, hole: true }]);
  out.push(["a group", sceneShape({
    id: "group", name: "Group", kind: "mesh", color: "#d41721", width: 28, depth: 18, height: 12,
    importedMesh: { positions: cube, baseWidth: 28, baseDepth: 18, baseHeight: 12, triangleCount: 1, sourceFormat: "json" },
    groupedShapes: [box, { ...cylinder, hole: true }],
    csg: { op: "subtract", version: 1 },
  })]);
  out.push(["a sketched part", plain("sketch", {
    id: "sketched",
    sketchFinish: "extrude",
    sketchProfile: {
      points: [{ id: "a", x: 0, z: 0 }, { id: "b", x: 20, z: 0 }, { id: "c", x: 20, z: 10 }],
      segments: [{ id: "ab", startId: "a", endId: "b" }, { id: "bc", startId: "b", endId: "c" }, { id: "ca", startId: "c", endId: "a" }],
      closed: true,
    } as WorkplaneShape["sketchProfile"],
  })]);
  out.push(["a revolved sketch", plain("sketch", { id: "revolved", sketchFinish: "revolve", sketchRevolveAxis: { x1: 0, z1: 0, x2: 0, z2: 10 } })]);
  out.push(["a split piece", mesh("Split piece", { cadBrep: "brep", cadBrepFrame: { x: 0, z: 0, elevation: 0, width: 30, depth: 20, height: 12 } })]);
  out.push(["an import", mesh("Imported STL")]);
  out.push(["an exact import", mesh("Imported STEP", { importedMesh: { positions: cube, baseWidth: 30, baseDepth: 20, baseHeight: 12, triangleCount: 1, sourceFormat: "step", brepStep: "ISO-10303-21;" } })]);
  out.push(["a filleted box", { ...box, id: "filleted", edgeTreatments: [{ kind: "fillet", amount: 2, edgeCount: 4 }] }]);
  return out;
}

describe("the inspector's rows without Mintr Pro", () => {
  const all = samples();

  it("covers every kind of part", () => {
    const kinds = new Set(all.map(([, shape]) => shape.kind));
    const every: ShapeKind[] = [
      "box", "cylinder", "sphere", "sketch", "scribble", "cone", "pyramid", "roof", "text", "roundRoof", "halfSphere", "torus",
      "tube", "ring", "wedge", "polygon", "icosahedron", "mesh", "thread", "gear", "gridfinityBin", "gridfinityBaseplate", "loft",
    ];
    expect(every.filter((kind) => !kinds.has(kind))).toEqual([]);
  });

  for (const [name, shape] of all) {
    it(`stays the same for ${name}`, () => {
      expect(describeRows(getShapeProperties(shape, () => {}))).toMatchSnapshot();
    });
  }

  it("builds the same rows for a resin printer, apart from the settings that are about resin", () => {
    const threads = all.find(([name]) => name === "shapes list: Threads")![1];
    expect(describeRows(getShapeProperties(threads, () => {}, [], "resin"))).toMatchSnapshot();
  });

  it("only reads the part: asking for the rows changes nothing and calls nothing", () => {
    for (const [, shape] of all) {
      const before = JSON.stringify(shape);
      let calls = 0;
      getShapeProperties(shape, () => { calls += 1; });
      expect(calls).toBe(0);
      expect(JSON.stringify(shape)).toBe(before);
    }
  });

  it("offers Mintr Pro only number rows to follow a sum", () => {
    for (const [, shape] of all) {
      const rows = getShapeProperties(shape, () => {});
      const numbers = rows.filter((row) => !("type" in row) || row.type === "range" || row.type === undefined).map((row) => row.label);
      expect(drivablePropertyLabels(shape)).toEqual(numbers);
    }
  });
});
