import { describe, expect, it } from "vitest";
import type { EditorHistoryEntry } from "@/lib/editorHistory";
import { EMPTY_GUIDE_LOG, compactGuideForFile, slimGuideEntry, syncGuideLog } from "@/lib/guideLog";
import { guideLessonGroups, guidePrompt, proposeGuideSteps, type MintrGuide } from "@/lib/mintrGuide";
import {
  buildPeakcadDocument,
  isPackedMintrGuide,
  packMintrGuideText,
  parsePeakcadDocument,
  serializeMintrGuide,
  unpackMintrGuideText,
} from "@/lib/peakcadDocument";
import { sceneShape } from "@/lib/shapeCatalog";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(id: string, patch: Partial<WorkplaneShape> = {}) {
  return sceneShape({ name: id, kind: "box", color: "#d41721", width: 20, depth: 20, height: 20, ...patch, id });
}

/** A grouped part the way the editor stores one: a full display mesh and an exact solid. */
function heavyGroup(id: string, height: number): WorkplaneShape {
  const positions = Array.from({ length: 60_000 * 9 }, (_, index) => Math.round(Math.sin(index) * 1000) / 100);
  return {
    ...box(id, { height }),
    kind: "mesh",
    groupedShapes: [box(`${id}-a`, { height }), box(`${id}-b`, { x: 10, height })],
    importedMesh: { positions, baseWidth: 30, baseDepth: 20, baseHeight: height, triangleCount: 60_000, sourceFormat: "json" },
    cadBrep: "ISO-10303-21;".padEnd(200_000, "x"),
  };
}

function entry(shapes: WorkplaneShape[], label?: string): EditorHistoryEntry {
  return {
    shapes,
    selectedIds: [],
    fingerprint: `${label ?? ""}|${shapes.map((shape) => `${shape.id}@${shape.x},${shape.height},${shape.width}`).join(",")}`,
    estimatedBytes: 1,
    label,
  };
}

function prompt(guide: MintrGuide, history: EditorHistoryEntry[], shapes: WorkplaneShape[]) {
  return guidePrompt({
    guide, history, shapes,
    sketchMode: false, pickingFace: false, sketching: false, sketchingOffPart: false, sketchClosed: false, extrudeOpen: false, sketchPoints: [],
  });
}

const history = [
  entry([], "Start"),
  entry([box("a")], "Box added"),
  entry([box("a", { color: "#2f6bd8" })], "Color"),
  entry([box("a", { color: "#2f6bd8" }), box("b", { x: 40, width: 10 })], "Box added"),
  entry([box("a", { color: "#2f6bd8" }), box("b", { x: 40, width: 10, height: 30 })]),
  entry([box("a", { color: "#2f6bd8" }), box("b", { x: 60, width: 10, height: 30 })], "Moved"),
];

describe("guide file size", () => {
  it("keeps steps the undo history has let go of, and follows undo and redo", () => {
    let log = syncGuideLog(EMPTY_GUIDE_LOG, history.slice(0, 3), 2);
    expect(log.entries).toHaveLength(3);
    // The undo history trims its oldest entry and adds a new one: the log keeps the old one.
    log = syncGuideLog(log, history.slice(1, 4), 2);
    expect(log.entries.map((item) => item.fingerprint)).toEqual(history.slice(0, 4).map((item) => item.fingerprint));
    expect(log.offset).toBe(1);
    // Undo two steps: the log ends where the cursor is.
    log = syncGuideLog(log, history.slice(1, 4), 0);
    expect(log.entries).toHaveLength(2);
    // Redo: back again.
    log = syncGuideLog(log, history.slice(1, 4), 2);
    expect(log.entries).toHaveLength(4);
    // A different history entirely starts the log again.
    log = syncGuideLog(log, [entry([box("z")], "Other")], 0);
    expect(log.entries).toHaveLength(1);
    expect(log.offset).toBe(0);
  });

  it("stores only the steps a lesson reads, and plays exactly the same", () => {
    const steps = proposeGuideSteps(history, history.length - 1);
    const guide: MintrGuide = { title: "Blocks", author: "Ada", summary: "", steps };
    const compact = compactGuideForFile(history, steps);
    const small: MintrGuide = { ...guide, steps: compact.steps };
    // The colour change was skipped, so nothing after the first box needs it as a "before" step except the next box.
    expect(compact.history.length).toBeLessThanOrEqual(history.length);
    expect(compact.steps.every((step) => step.included)).toBe(true);
    expect(guideLessonGroups(small, compact.history).length).toBe(guideLessonGroups(guide, history).length);
    const learnerStates = [
      [],
      [box("a")],
      [box("a"), box("b", { x: 40, width: 10 })],
      [box("a"), box("b", { x: 40, width: 10, height: 30 })],
      [box("a"), box("b", { x: 60, width: 10, height: 30 })],
    ];
    for (const shapes of learnerStates) {
      const before = prompt(guide, history, shapes);
      const after = prompt(small, compact.history, shapes);
      expect({ ...after, checklist: undefined }).toEqual({ ...before, checklist: undefined });
      expect(after?.checklist).toEqual(before?.checklist);
    }
  });

  it("keeps the starting model in full and every other step as a recipe", () => {
    const heavy = [
      entry([heavyGroup("g", 20)], "Grouped"),
      entry([heavyGroup("g", 20), box("c", { x: 50 })], "Box added"),
      entry([heavyGroup("g", 20), box("c", { x: 50, height: 40 })]),
      entry([heavyGroup("g", 30), box("c", { x: 50, height: 40 })], "Changed"),
    ];
    const steps = proposeGuideSteps(heavy, heavy.length - 1);
    const compact = compactGuideForFile(heavy, steps, heavy[0]);
    expect(compact.history[0]).toBe(heavy[0]);
    expect(compact.history.slice(1).every((item) => item.shapes.every((shape) => !shape.importedMesh && !shape.cadBrep))).toBe(true);
    // The recipe still carries what playback compares.
    expect(compact.history[compact.history.length - 1].shapes[0].groupedShapes).toHaveLength(2);
    expect(slimGuideEntry(heavy[3]).shapes[0].height).toBe(30);

    const write = (entries: EditorHistoryEntry[], guideSteps: typeof steps) => serializeMintrGuide(buildPeakcadDocument({
      project: { id: "design-g1", name: "Heavy", createdAt: 1, updatedAt: 1, accent: "cyan", shapes: 2 },
      shapes: entries[entries.length - 1].shapes,
      history: entries,
      historyIndex: entries.length - 1,
      guide: { title: "Heavy", author: "Ada", summary: "", steps: guideSteps },
    }));
    const full = write(heavy, steps);
    const slim = write(compact.history, compact.steps);
    expect(slim.length).toBeLessThan(full.length / 2.5);
  });

  it("packs a guide much smaller and opens it back exactly", async () => {
    const steps = proposeGuideSteps(history, history.length - 1);
    const text = serializeMintrGuide(buildPeakcadDocument({
      project: { id: "design-g1", name: "Blocks", createdAt: 1, updatedAt: 1, accent: "cyan", shapes: 2 },
      shapes: history[history.length - 1].shapes,
      history,
      historyIndex: history.length - 1,
      guide: { title: "Blocks", author: "Ada", summary: "", steps },
    }));
    const packed = await packMintrGuideText(text);
    expect(isPackedMintrGuide(packed)).toBe(true);
    expect(isPackedMintrGuide(text)).toBe(false);
    expect(packed.length).toBeLessThan(text.length / 3);
    const opened = await unpackMintrGuideText(packed);
    expect(opened).toBe(text);
    expect(parsePeakcadDocument(opened).guide?.title).toBe("Blocks");
    await expect(unpackMintrGuideText('{"format":"mintrguide-packed","encoding":"gzip+base64","data":"bm90IGd6aXA="}')).rejects.toThrow(/damaged/);
    await expect(unpackMintrGuideText('{"format":"mintrguide-packed","encoding":"zstd","data":""}')).rejects.toThrow(/newer Mintr/);
  });
});
