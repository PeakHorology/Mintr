import { describe, expect, it } from "vitest";
import { appendEditorHistorySnapshot, compactHistoryShapes, editorHistoryEntry, expandHistoryShapes, type EditorHistoryMeshVault } from "@/lib/editorHistory";
import { slimGuideEntry } from "@/lib/guideLog";
import { buildPeakcadDocument, parsePeakcadDocument, serializeMintrGuide, serializePeakcadDocument } from "@/lib/peakcadDocument";
import { createCollectingSink, dehydrateHistoryEntry, dehydrateShape, hydrateStoredProjectRecord, PROJECT_RECORD_FORMAT, type StoredProjectRecord } from "@/lib/projectMeshBlobs";
import { hydrateClipboardShape, parseClipboardShapes, serializeClipboardShapes } from "@/lib/shapeClipboard";
import { addLinearDimension, createEmptySketchDoc } from "@/lib/sketch";
import { defaultSketchPlane } from "@/lib/sketchPlane";
import { sceneShape } from "@/lib/shapeCatalog";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Mintr Pro content is three optional fields: a part's `values`, the sums its settings follow
 * (`drivenBy`), and a sketch size written as a sum (`dimension.expression`). A design must carry
 * them through every way it is stored or copied, with Pro on or off, because none of these paths
 * knows about Pro. A field lost here would turn a parametric design into a plain one silently.
 */

const VALUES = [
  { name: "wall", expression: "2" },
  { name: "width", expression: "wall * 20 + 1in", min: 10, max: 80, note: "Outside width" },
];
const triangle = [0, 0, 0, 10, 0, 0, 0, 10, 0];

function sketchedPart(): WorkplaneShape {
  const doc = createEmptySketchDoc(defaultSketchPlane(), "sketch-1");
  doc.entities = [
    { kind: "point", id: "a", x: 0, z: 0 },
    { kind: "point", id: "b", x: 30, z: 0 },
    { kind: "point", id: "c", x: 30, z: 12 },
    { kind: "line", id: "ab", startId: "a", endId: "b" },
    { kind: "line", id: "bc", startId: "b", endId: "c" },
    { kind: "line", id: "ca", startId: "c", endId: "a" },
  ];
  const sized = addLinearDimension(doc, { entityId: "ab", value: 30 }).doc;
  sized.dimensions = sized.dimensions.map((dimension) => ({ ...dimension, expression: "width - wall" }));
  return sceneShape({
    id: "sketched",
    name: "Bracket",
    kind: "sketch",
    color: "#3b82f6",
    width: 30,
    depth: 12,
    height: 5,
    sketchFinish: "extrude",
    sketchId: sized.id,
    sketchDoc: sized,
    drivenBy: { Height: "wall * 2.5" },
  });
}

/** A group with values, holding a part that follows them and a sketched part with a sum for a size. */
function proDesign(): WorkplaneShape[] {
  const child = sceneShape({ id: "child", name: "Lid", kind: "box", color: "#d41721", width: 41, depth: 20, height: 4, drivenBy: { Width: "width", Height: "wall * 2" }, values: [{ name: "lip", expression: "wall / 2" }] });
  const group = sceneShape({
    id: "group",
    name: "Box and lid",
    kind: "mesh",
    color: "#d41721",
    width: 41,
    depth: 20,
    height: 9,
    values: VALUES,
    drivenBy: { Length: "width / 2" },
    groupedShapes: [child, sketchedPart()],
    csg: { op: "union", version: 3 },
    importedMesh: { positions: triangle, indices: [0, 1, 2], baseWidth: 41, baseDepth: 20, baseHeight: 9, triangleCount: 1, sourceFormat: "json" },
  });
  const loose = sceneShape({ id: "loose", name: "Peg", kind: "cylinder", color: "#d97813", width: 8, depth: 8, height: 12, values: [{ name: "d", expression: "8" }], drivenBy: { Height: "d * 1.5" } });
  return [group, loose];
}

type ProContent = { id: string; values: unknown; drivenBy: unknown; expressions: unknown; inside: ProContent[] };

function proContent(shape: WorkplaneShape): ProContent {
  return {
    id: shape.id,
    values: shape.values,
    drivenBy: shape.drivenBy,
    expressions: shape.sketchDoc?.dimensions.map((dimension) => dimension.expression),
    inside: (shape.groupedShapes ?? []).map(proContent),
  };
}

const expected = proDesign().map(proContent);

describe("Mintr Pro values survive every way a design is stored", () => {
  it("has all three kinds of content in the sample, at two depths", () => {
    expect(expected[0].values).toEqual(VALUES);
    expect(expected[0].inside[0].drivenBy).toEqual({ Width: "width", Height: "wall * 2" });
    expect(expected[0].inside[1].expressions).toEqual(["width - wall"]);
    expect(expected[1].drivenBy).toEqual({ Height: "d * 1.5" });
  });

  it("saving to a .mintr file and opening it again", () => {
    const shapes = proDesign();
    const history = [editorHistoryEntry(shapes, ["group"], "wall = 2")];
    const text = serializePeakcadDocument(buildPeakcadDocument({
      project: { id: "p", name: "Pro design", shapes: shapes.length, updatedAt: 1, accent: "cyan" } as never,
      shapes,
      history,
      historyIndex: 0,
    }));
    const opened = parsePeakcadDocument(text);
    expect(opened.shapes.map(proContent)).toEqual(expected);
    expect(opened.shapes.map(hydrateClipboardShape).map(proContent)).toEqual(expected);
    // The undo history inside the file carries them too.
    const entry = opened.history![0];
    expect(expandHistoryShapes(entry.shapes, entry.meshVault).map(proContent)).toEqual(expected);
  });

  it("the project store, where meshes are moved out into blobs", () => {
    const shapes = proDesign();
    const { sink, blobs } = createCollectingSink();
    const keys = new Set<string>();
    const dehydrated = shapes.map((shape) => dehydrateShape(shape, sink, keys));
    const history = [dehydrateHistoryEntry(editorHistoryEntry(shapes, []), sink, keys)];
    const record: StoredProjectRecord = { id: "p", revision: 1, format: PROJECT_RECORD_FORMAT, updatedAt: 1, shapes: dehydrated, history, historyIndex: 0, blobKeys: [...keys] } as StoredProjectRecord;
    const hydrated = hydrateStoredProjectRecord(structuredClone(record), structuredClone(blobs));
    expect(hydrated.missing).toEqual([]);
    expect(hydrated.shapes.map(proContent)).toEqual(expected);
    expect(hydrated.shapes[0].importedMesh?.positions).toEqual(triangle);
  });

  it("copy and paste", () => {
    const pasted = parseClipboardShapes(serializeClipboardShapes(proDesign()));
    expect(pasted.map(proContent)).toEqual(expected);
  });

  it("opening a part through hydrateClipboardShape, the path every load goes through", () => {
    expect(proDesign().map(hydrateClipboardShape).map(proContent)).toEqual(expected);
    // JSON in between, as a file or the clipboard has.
    const viaJson = (JSON.parse(JSON.stringify(proDesign())) as WorkplaneShape[]).map(hydrateClipboardShape);
    expect(viaJson.map(proContent)).toEqual(expected);
  });

  it("undo, where meshes are moved out into a vault", () => {
    const vault: EditorHistoryMeshVault = {};
    const compact = compactHistoryShapes(proDesign(), vault);
    expect(compact.map(proContent)).toEqual(expected);
    expect(expandHistoryShapes(compact, vault).map(proContent)).toEqual(expected);

    const before = proDesign();
    const after = before.map((shape) => (shape.id === "group" ? { ...shape, values: [{ name: "wall", expression: "3" }, VALUES[1]] } : shape));
    const { entries, index } = appendEditorHistorySnapshot([editorHistoryEntry(before, [])], 0, editorHistoryEntry(after, [], "wall = 3"));
    expect(index).toBe(1);
    // Undo brings the old value back, redo the new one.
    expect(expandHistoryShapes(entries[0].shapes, entries[0].meshVault).map(proContent)).toEqual(expected);
    expect(expandHistoryShapes(entries[1].shapes, entries[1].meshVault)[0].values?.[0]).toEqual({ name: "wall", expression: "3" });
  });

  it("a .mintrguide: its steps are slimmed to recipes, its finished design is whole", () => {
    const shapes = proDesign();
    const entry = editorHistoryEntry(shapes, []);
    const slim = slimGuideEntry(entry).shapes;
    // A recipe step keeps the values and the sums. It leaves sketches out altogether (a guide
    // checks numbers, not drawings), so a sketch size's sum is not in a recipe step.
    expect(slim.map((shape) => [shape.values, shape.drivenBy])).toEqual(expected.map((entry) => [entry.values, entry.drivenBy]));
    expect(slim[0].groupedShapes?.map((child) => child.drivenBy)).toEqual(expected[0].inside.map((child) => child.drivenBy));
    expect(slim[0].groupedShapes?.[1].sketchDoc).toBeUndefined();

    const text = serializeMintrGuide(buildPeakcadDocument({
      project: { id: "g", name: "Pro guide", shapes: shapes.length, updatedAt: 1, accent: "cyan" } as never,
      shapes,
      history: [entry, slimGuideEntry(entry)],
      historyIndex: 1,
    }));
    const opened = parsePeakcadDocument(text);
    expect(opened.shapes.map(proContent)).toEqual(expected);
  });

  it("an empty list or an empty set of sums is stored as given and never invented", () => {
    const plain = sceneShape({ id: "plain", name: "Box", kind: "box", color: "#d41721" });
    const copy = parseClipboardShapes(serializeClipboardShapes([plain]))[0];
    expect("values" in copy && copy.values !== undefined).toBe(false);
    expect("drivenBy" in copy && copy.drivenBy !== undefined).toBe(false);
  });
});
