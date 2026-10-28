import { createRequire } from "node:module";
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel, Vec2 } from "manifold-3d";
import type { MeshData } from "@/lib/editorShapeMesh";
import { buildCutLayout, cutLayoutDxf, cutLayoutSvg, lengthLabel } from "@/lib/laser/cutFile";

let runtime: ManifoldToplevel;

beforeAll(async () => {
  const manifoldMod = await import("manifold-3d");
  const require = createRequire(import.meta.url);
  const wasmBinary = fs.readFileSync(require.resolve("manifold-3d/manifold.wasm"));
  runtime = await (manifoldMod.default as (cfg: { wasmBinary: Uint8Array }) => Promise<ManifoldToplevel>)({ wasmBinary });
  runtime.setup();
});

/** A world-space mesh from a Manifold solid, laid as Mintr lays parts: y up. */
function meshOf(solid: ReturnType<ManifoldToplevel["Manifold"]["cube"]>, name = "Part"): MeshData {
  // Manifold builds z up; turn it so z becomes y.
  const turned = solid.rotate([-90, 0, 0]);
  const mesh = turned.getMesh();
  const vertices: [number, number, number][] = [];
  for (let i = 0; i < mesh.numVert; i += 1) {
    vertices.push([mesh.vertProperties[i * mesh.numProp], mesh.vertProperties[i * mesh.numProp + 1], mesh.vertProperties[i * mesh.numProp + 2]]);
  }
  const faces: [number, number, number][] = [];
  for (let i = 0; i < mesh.triVerts.length; i += 3) faces.push([mesh.triVerts[i], mesh.triVerts[i + 1], mesh.triVerts[i + 2]]);
  turned.delete();
  return { name, vertices, faces };
}

function area(points: readonly Vec2[]) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) sum += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  return Math.abs(sum / 2);
}

function plateWithHoleAndPocket() {
  const { Manifold } = runtime;
  const plate = Manifold.cube([40, 30, 3]);
  const through = Manifold.cylinder(10, 4, 4, 64).translate([10, 15, -1]);
  const pocket = Manifold.cube([8, 8, 1.5]).translate([25, 10, 2]);
  const result = plate.subtract(through).subtract(pocket);
  [plate, through, pocket].forEach((solid) => solid.delete());
  return result;
}

describe("laser cut files", () => {
  it("cuts the outline and the through hole, not the pocket", () => {
    const solid = plateWithHoleAndPocket();
    const layout = buildCutLayout(runtime, [{ name: "Plate", job: "cut", mesh: meshOf(solid) }]);
    solid.delete();
    expect(layout.cut.length).toBe(2);
    // The hole is cut first, then the plate around it.
    expect(area(layout.cut[0].points)).toBeCloseTo(Math.PI * 16, 0);
    expect(area(layout.cut[1].points)).toBeCloseTo(1200, 3);
    expect(layout.cut.every((path) => path.closed)).toBe(true);
    expect(layout.bounds).toEqual({ minX: 0, minY: -30, maxX: 40, maxY: 0 });
    expect(layout.cutLength).toBeCloseTo(140 + 2 * Math.PI * 4, 0);
  });

  it("cuts a shared edge once when two parts touch", () => {
    const { Manifold } = runtime;
    const left = Manifold.cube([10, 10, 3]);
    const right = Manifold.cube([10, 10, 3]).translate([10, 0, 0]);
    const layout = buildCutLayout(runtime, [
      { name: "Left", job: "cut", mesh: meshOf(left) },
      { name: "Right", job: "cut", mesh: meshOf(right) },
    ]);
    [left, right].forEach((solid) => solid.delete());
    // Two 10 mm squares side by side: 7 edges of 10 mm, not 8.
    expect(layout.cutLength).toBeCloseTo(70, 3);
  });

  it("allows for the kerf, so a part and its hole come out the size drawn", () => {
    const solid = plateWithHoleAndPocket();
    const layout = buildCutLayout(runtime, [{ name: "Plate", job: "cut", mesh: meshOf(solid) }], { kerfMm: 0.2 });
    solid.delete();
    const [hole, outline] = layout.cut;
    const holeBox = hole.points.reduce((box, [x]) => ({ min: Math.min(box.min, x), max: Math.max(box.max, x) }), { min: Infinity, max: -Infinity });
    // The beam's centre runs 0.1 mm inside the hole and 0.1 mm outside the plate.
    expect(holeBox.max - holeBox.min).toBeCloseTo(7.8, 1);
    const outBox = outline.points.reduce((box, [x]) => ({ min: Math.min(box.min, x), max: Math.max(box.max, x) }), { min: Infinity, max: -Infinity });
    expect(outBox.max - outBox.min).toBeCloseTo(40.2, 2);
  });

  it("writes an SVG at true size, with engraving filled and lines by job", () => {
    const { Manifold } = runtime;
    const plate = Manifold.cube([50, 20, 3]);
    const mark = Manifold.cube([10, 5, 1]).translate([5, 5, 3]);
    const layout = buildCutLayout(runtime, [
      { name: "Plate", job: "cut", mesh: meshOf(plate) },
      { name: "Mark", job: "engrave", mesh: meshOf(mark) },
      { name: "Fold", job: "score", mesh: meshOf(mark) },
    ]);
    [plate, mark].forEach((solid) => solid.delete());
    const svg = cutLayoutSvg(layout, { title: "Tag & sign", style: "xtool" });
    expect(svg).toContain('width="52mm" height="22mm" viewBox="0 0 52 22"');
    expect(svg).toContain('<g id="Engrave" fill="#000000"');
    expect(svg).toContain('<g id="Score" fill="none" stroke="#0000FF"');
    expect(svg).toContain('<g id="Cut" fill="none" stroke="#FF0000"');
    expect(svg).toContain("<title>Tag &amp; sign</title>");
    // xTool Studio reads each shape's job from this, as it cannot tell lines apart by colour.
    expect(svg).toContain('data-processing-type="VECTOR_CUTTING"');
    expect(svg).toContain('data-processing-type="VECTOR_ENGRAVING"');
    expect(svg).toContain('data-processing-type="FILL_VECTOR_ENGRAVING"');
    // Cut comes last, so a part is cut free only after its marks are made.
    expect(svg.indexOf('id="Cut"')).toBeGreaterThan(svg.indexOf('id="Engrave"'));
    const dxf = cutLayoutDxf(layout);
    expect(dxf).toContain("CUT");
    expect(dxf).toContain("ENGRAVE");
    expect(dxf.trim().endsWith("EOF")).toBe(true);
  });

  it("skips a part with nothing to cut, and says so", () => {
    const layout = buildCutLayout(runtime, [{ name: "Empty", job: "cut", mesh: { name: "Empty", vertices: [], faces: [] } }]);
    expect(layout.skipped).toEqual(["Empty"]);
    expect(layout.bounds).toBeNull();
    expect(lengthLabel(1240)).toBe("1.24 m");
    expect(lengthLabel(420)).toBe("42 cm");
  });
});
