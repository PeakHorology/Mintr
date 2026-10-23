import { describe, expect, it } from "vitest";
import {
  buildPeakcadDocument,
  parsePeakcadDocument,
  peakcadFilename,
  peakcadNamesMatch,
  serializePeakcadDocument,
} from "@/lib/peakcadDocument";
import { editorHistoryEntry, expandHistoryShapes, hydrateEditorHistoryState } from "@/lib/editorHistory";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "box-1",
    name: "Box",
    kind: "box",
    color: "#d41721",
    x: 0,
    z: 0,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

describe("peakcad document", () => {
  it("round-trips a project with imported mesh typed arrays", () => {
    const document = buildPeakcadDocument({
      project: {
        id: "project-1",
        name: "Watch plate",
        createdAt: 10,
        updatedAt: 20,
        accent: "gold",
        shapes: 1,
      },
      shapes: [
        box({
          importedMesh: {
            positions: new Float32Array([0, 1, 2, 3, 4, 5]) as unknown as number[],
            indices: new Uint32Array([0, 1, 2]) as unknown as number[],
            baseWidth: 20,
            baseDepth: 20,
            baseHeight: 20,
            triangleCount: 1,
            sourceFormat: "stl",
          },
        }),
      ],
    });

    const parsed = parsePeakcadDocument(serializePeakcadDocument(document));
    expect(parsed.project.name).toBe("Watch plate");
    expect(parsed.shapes[0]?.importedMesh?.positions).toEqual([0, 1, 2, 3, 4, 5]);
    expect(parsed.shapes[0]?.importedMesh?.indices).toEqual([0, 1, 2]);
  });

  it("rejects a non-PeakCAD JSON file", () => {
    expect(() => parsePeakcadDocument(JSON.stringify({ name: "nope" }))).toThrow(/not a PeakCAD project/i);
  });

  it("keeps the saved format so older projects still open", () => {
    const document = buildPeakcadDocument({
      project: {
        id: "project-1",
        name: "Watch plate",
        createdAt: 10,
        updatedAt: 20,
        accent: "gold",
        shapes: 0,
      },
      shapes: [],
    });
    expect(document.format).toBe("peakcad");
    expect(document.version).toBe(1);
    expect(parsePeakcadDocument(serializePeakcadDocument(document)).project.name).toBe("Watch plate");
  });

  it("builds a safe Windows filename", () => {
    expect(peakcadFilename('Case / "A"')).toBe("Case A.mintr");
    expect(peakcadFilename("   ")).toBe("Untitled design.mintr");
    expect(peakcadFilename("Design · Sep 9.peakcad")).toBe("Design · Sep 9.mintr");
  });

  it("treats a design title as matching its saved project name", () => {
    expect(peakcadNamesMatch("Design · Sep 9", "Design · Sep 9.peakcad")).toBe(true);
    expect(peakcadNamesMatch("Design · Sep 9.peakcad", "Design · Sep 9.peakcad")).toBe(true);
    expect(peakcadNamesMatch("Design · Sep 9", "Design · Sep 9.mintr")).toBe(true);
    expect(peakcadNamesMatch("Design · Sep 9.peakcad", "Design · Sep 9.mintr")).toBe(true);
    expect(peakcadNamesMatch("Design · Sep 9", "Case plate.peakcad")).toBe(false);
    expect(peakcadNamesMatch("  Watch plate  ", "Watch plate")).toBe(true);
  });

  it("round-trips native PeakCAD pieces and a group without an imported STL", () => {
    const cylinder: WorkplaneShape = {
      id: "cyl-1",
      name: "Cylinder",
      kind: "cylinder",
      color: "#e67e22",
      x: 30,
      z: 0,
      elevation: 0,
      size: 16,
      width: 16,
      depth: 16,
      height: 24,
      rotation: 0,
      locked: false,
      hidden: false,
    };
    const groupedChild: WorkplaneShape = {
      ...box({ id: "box-2", name: "Inner box", x: 4 }),
    };
    const document = buildPeakcadDocument({
      project: {
        id: "project-native",
        name: "Native pieces",
        createdAt: 10,
        updatedAt: 20,
        accent: "cyan",
        shapes: 3,
      },
      shapes: [
        box({ id: "box-1", name: "Bottom" }),
        cylinder,
        {
          ...box({ id: "group-1", name: "Group", kind: "box", x: 60 }),
          groupedShapes: [groupedChild],
          groupedBaseWidth: 20,
          groupedBaseDepth: 20,
          groupedBaseHeight: 20,
        },
      ],
    });

    const parsed = parsePeakcadDocument(serializePeakcadDocument(document));
    expect(parsed.shapes).toHaveLength(3);
    expect(parsed.shapes.map((shape) => shape.kind)).toEqual(["box", "cylinder", "box"]);
    expect(parsed.shapes[0]?.importedMesh).toBeUndefined();
    expect(parsed.shapes[1]).toMatchObject({ name: "Cylinder", width: 16, height: 24, x: 30 });
    expect(parsed.shapes[2]?.groupedShapes).toHaveLength(1);
    expect(parsed.shapes[2]?.groupedShapes?.[0]?.name).toBe("Inner box");
    expect(parsed.project.shapes).toBe(3);
  });

  it("round-trips model history including groups, holes, and step names", () => {
    const solid = box({ id: "solid", name: "Solid" });
    const hole = box({ id: "hole", name: "Hole", hole: true, x: 4 });
    const grouped = box({
      id: "group-1",
      name: "Group",
      groupedShapes: [solid, hole],
      groupedBaseWidth: 20,
      groupedBaseDepth: 20,
      groupedBaseHeight: 20,
    });
    const document = buildPeakcadDocument({
      project: {
        id: "shared-1",
        name: "Shared plate",
        createdAt: 10,
        updatedAt: 20,
        accent: "cyan",
        shapes: 1,
      },
      shapes: [grouped],
      history: [
        editorHistoryEntry([solid, hole], [], "Start"),
        editorHistoryEntry([grouped], ["group-1"], "Grouped 2 shapes"),
      ],
      historyIndex: 1,
    });

    const parsed = parsePeakcadDocument(serializePeakcadDocument(document));
    expect(parsed.history).toHaveLength(2);
    expect(parsed.historyIndex).toBe(1);
    expect(parsed.history?.[1]?.label).toBe("Grouped 2 shapes");
    expect(parsed.history?.[0]?.shapes.map((shape) => shape.id)).toEqual(["solid", "hole"]);
    expect(parsed.history?.[0]?.shapes[1]?.hole).toBe(true);
    expect(parsed.history?.[1]?.shapes[0]?.groupedShapes).toHaveLength(2);
    expect(parsed.shapes[0]?.groupedShapes?.map((shape) => shape.id)).toEqual(["solid", "hole"]);

    const hydrated = hydrateEditorHistoryState(parsed.shapes, parsed.history, parsed.historyIndex);
    expect(hydrated.entries).toHaveLength(2);
    expect(hydrated.index).toBe(1);
    expect(hydrated.entries[0]?.shapes).toHaveLength(2);
  });

  it("round-trips history mesh vaults so imported bodies can undo", () => {
    const shape = box({
      id: "import-1",
      kind: "mesh",
      importedMesh: {
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        baseWidth: 1,
        baseDepth: 1,
        baseHeight: 1,
        triangleCount: 1,
        sourceFormat: "stl",
        brepStep: "ISO-10303-21;",
      },
    });
    const document = buildPeakcadDocument({
      project: {
        id: "import-1",
        name: "Imported body",
        createdAt: 10,
        updatedAt: 20,
        accent: "gold",
        shapes: 1,
      },
      shapes: [shape],
      history: [editorHistoryEntry([shape], [shape.id], "Imported")],
      historyIndex: 0,
    });

    const parsed = parsePeakcadDocument(serializePeakcadDocument(document));
    expect(parsed.history?.[0]?.label).toBe("Imported");
    expect(parsed.history?.[0]?.meshVault?.["import-1"]?.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(parsed.history?.[0]?.meshVault?.["import-1"]?.brepStep).toBe("ISO-10303-21;");
    const restored = expandHistoryShapes(parsed.history![0].shapes, parsed.history![0].meshVault);
    expect(restored[0]?.importedMesh?.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(hydrateEditorHistoryState(parsed.shapes, parsed.history, parsed.historyIndex).entries).toHaveLength(1);
  });
});
