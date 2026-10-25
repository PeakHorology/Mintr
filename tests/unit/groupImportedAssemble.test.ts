import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGroupedShapeFromSelection, primitiveManifoldForShape } from "@/lib/editorBoolean";
import { viewportGroupChildren } from "@/lib/csgTree";
import { meshForShape } from "@/lib/editorShapeMesh";
import type { WorkplaneShape } from "@/types/sketchforge";

function importedPart(id: string, x: number): WorkplaneShape {
  return {
    id,
    name: id,
    kind: "mesh",
    color: "#3ec6e0",
    x,
    z: 0,
    elevation: 0,
    size: 10,
    width: 10,
    depth: 10,
    height: 4,
    rotation: 0,
    importedMesh: {
      positions: [-5, 0, -5, 5, 0, -5, 0, 4, 0],
      indices: [0, 1, 2],
      baseWidth: 10,
      baseDepth: 10,
      baseHeight: 4,
      triangleCount: 1,
      sourceFormat: "step",
    },
  };
}

function box(id: string, x = 0): WorkplaneShape {
  return {
    id,
    name: id,
    kind: "box",
    color: "#d41721",
    x,
    z: 0,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
  };
}

describe("grouping imported solids", () => {
  it("fuses the parts into one solid instead of leaving them side by side", async () => {
    const result = await buildGroupedShapeFromSelection([
      importedPart("gear", 0),
      importedPart("plate", 2),
    ]);
    expect(result.group?.csg?.op).toBe("union");
    expect(result.group?.name).toBe("Group");
    expect(result.group?.importedMesh?.positions.length).toBeGreaterThan(0);
    expect(viewportGroupChildren(result.group!)).toEqual([]);
  });

  it("joins exact solids into one object when the exact fuse does not come back", async () => {
    const result = await buildGroupedShapeFromSelection([box("a"), box("b", 8)]);
    expect(result.group?.csg?.op).toBe("union");
    expect(result.group?.importedMesh?.positions.length).toBeGreaterThan(8);
    expect(result.group?.importedMesh?.brepStep).toBeUndefined();
    expect(result.qualityNotice).toMatch(/mesh/);
    expect(result.consumed).toBe(false);
  });

  it("includes a mesh part in the same group as exact solids", async () => {
    const result = await buildGroupedShapeFromSelection([
      box("a"),
      box("b", 8),
      importedPart("label", 4),
    ]);
    expect(result.group?.csg?.op).toBe("union");
    expect(result.leftOutShapes ?? []).toEqual([]);
    expect(result.group?.importedMesh?.positions.length).toBeGreaterThan(8);
  });

  it("joins cylinders that overlap, sit apart, or are added onto a group", async () => {
    const cylinder = (id: string, x: number, extra: Partial<WorkplaneShape> = {}): WorkplaneShape => ({
      id,
      name: id,
      kind: "cylinder",
      color: "#e07a1f",
      x,
      z: 0,
      elevation: 0,
      size: 20,
      width: 20,
      depth: 20,
      height: 20,
      rotation: 0,
      ...extra,
    });
    const overlap = await buildGroupedShapeFromSelection([cylinder("a", 0), cylinder("b", 12)]);
    const apart = await buildGroupedShapeFromSelection([cylinder("a", 0), cylinder("b", 40)]);
    const turned = await buildGroupedShapeFromSelection([
      cylinder("a", 0),
      cylinder("b", 0, { rotationX: 90, z: 16 }),
    ]);
    expect(overlap.group?.csg?.op).toBe("union");
    expect(apart.group?.csg?.op).toBe("union");
    expect(apart.group?.width).toBeGreaterThan(40);
    expect(turned.group?.csg?.op).toBe("union");
    const again = await buildGroupedShapeFromSelection([overlap.group!, cylinder("c", 24)]);
    expect(again.group?.csg?.op).toBe("union");
    expect(again.group?.importedMesh?.positions.length).toBeGreaterThan(8);
  });

  it("still groups a large exact selection on the mesh path", async () => {
    const many = Array.from({ length: 9 }, (_, index) => box(`b${index}`, index * 22));
    const result = await buildGroupedShapeFromSelection(many);
    expect(result.group?.importedMesh?.positions.length).toBeGreaterThan(8);
    expect(result.group?.importedMesh?.brepStep).toBeUndefined();
  });

  it("fuses overlapping cylinders into fewer triangles than the two shells", async () => {
    const cylinder = (id: string, x: number): WorkplaneShape => ({
      id,
      name: id,
      kind: "cylinder",
      color: "#e07a1f",
      x,
      z: 0,
      elevation: 0,
      size: 20,
      width: 20,
      depth: 20,
      height: 20,
      rotation: 0,
      sides: 32,
    });
    const a = cylinder("a", 0);
    const b = cylinder("b", 12);
    const sourceTriangles = meshForShape(a).faces.length + meshForShape(b).faces.length;
    const scriptUrl = pathToFileURL("apps/web/public/manifold.js").href;
    const wasmUrl = pathToFileURL("apps/web/public/manifold.wasm").href;
    const loaded = (await import(/* webpackIgnore: true */ scriptUrl)) as {
      default: (config: { locateFile: () => string }) => Promise<{
        setup: () => void;
        Manifold: { union: (parts: Array<{ status: () => string; numTri: () => number; delete?: () => void }>) => { status: () => string; numTri: () => number; delete?: () => void } };
      }>;
    };
    const runtime = await loaded.default({ locateFile: () => wasmUrl });
    runtime.setup();
    const created: Array<{ delete?: () => void }> = [];
    const left = primitiveManifoldForShape(runtime as never, a, created as never);
    const right = primitiveManifoldForShape(runtime as never, b, created as never);
    const union = left && right ? runtime.Manifold.union([left, right]) : null;
    console.log("parts", left?.status(), left?.numTri(), right?.status(), right?.numTri(), "union", union?.status(), union?.numTri(), "source", sourceTriangles);
    expect(union?.numTri() ?? sourceTriangles).toBeLessThan(sourceTriangles);
  });
});
