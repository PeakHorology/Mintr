import { describe, expect, it } from "vitest";
import { withChangedPart, withTypedSetting } from "@/components/workplane/valueDrivenPatches";
import { buildGroupedShapeFromSelection, cleanShapePatch, remeshCsgGroupFromWorldChildren } from "@/lib/editorBoolean";
import { appendEditorHistorySnapshot, editorHistoryEntry, type EditorHistoryEntry } from "@/lib/editorHistory";
import type { RebuildEngine } from "@/lib/parametricRebuild";
import { sceneShape } from "@/lib/shapeCatalog";
import { rebuildSketchedShape } from "@/lib/sketchRebuild";
import { createValuesController, SCENE_MOVED_NOTICE, TOOL_BUSY_NOTICE, type ValuesHost } from "@/lib/valuesController";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { ShapeValue, WorkplaneShape } from "@/types/sketchforge";
import { meshVolume } from "../helpers/kernelRebuildEngine";

/**
 * The values controller is what the editor's `applyValues` calls. These tests stand in for the
 * editor with a small host that keeps a real undo history, and hold the controller to: one undo
 * step per value change, the newest change winning, and never overwriting other work.
 */

const box = (id: string, width = 20, depth = 20, height = 20, extra: Partial<WorkplaneShape> = {}): WorkplaneShape =>
  sceneShape({ id, name: id, kind: "box", color: "#d41721", width, depth, height, ...extra });
const cylinder = (id: string, diameter: number, height: number, extra: Partial<WorkplaneShape> = {}): WorkplaneShape =>
  sceneShape({ id, name: id, kind: "cylinder", color: "#d97813", width: diameter, depth: diameter, height, ...extra });
const setValue = (shape: WorkplaneShape, name: string, expression: string): WorkplaneShape =>
  ({ ...shape, values: (shape.values ?? []).map((value) => (value.name === name ? { ...value, expression } : value)) });
const partNamed = (body: WorkplaneShape, name: string) => (body.groupedShapes ?? []).find((child) => child.name === name)!;

/** A plate with a hole through it: the hole's width follows `d`, the plate's height follows `h`. */
async function drilledPlate(values: ShapeValue[] = [{ name: "d", expression: "8" }, { name: "h", expression: "10" }]): Promise<WorkplaneShape> {
  const built = await buildGroupedShapeFromSelection([box("plate", 40, 40, 10), cylinder("bore", 8, 60, { hole: true, elevation: -20 })]);
  let body: WorkplaneShape = { ...built.group!, id: "body", name: "Drilled plate", values };
  body = withChangedPart(body, partNamed(body, "bore").id, (part) => ({ ...part, drivenBy: { Width: "d", Length: "d" } }));
  return withChangedPart(body, partNamed(body, "plate").id, (part) => ({ ...part, drivenBy: { Height: "h" } }));
}

type Gate = { open: () => void; waiting: () => number };

/** An editor in miniature: the design, its undo history, and everything the controller asks for. */
function fakeEditor(start: WorkplaneShape[], options: { gate?: boolean } = {}) {
  let shapes = start;
  let history: EditorHistoryEntry[] = [editorHistoryEntry(shapes, [])];
  let index = 0;
  const notices: string[] = [];
  const reports: Array<[string, string[]]> = [];
  const sessions: boolean[] = [];
  const legacy: string[] = [];
  const state = { toolBusy: false, joins: 0 };
  let release: Array<() => void> = [];
  const commit = (next: WorkplaneShape[], label?: string) => {
    shapes = next.map(canonicalizeShape);
    const appended = appendEditorHistorySnapshot(history, index, editorHistoryEntry(shapes, [], label));
    history = appended.entries;
    index = appended.index;
  };
  const engine: RebuildEngine = {
    rebuildSketch: (shape, doc) => rebuildSketchedShape(shape, doc),
    remeshGroup: async (group, worldChildren) => {
      state.joins += 1;
      if (options.gate) await new Promise<void>((resolve) => release.push(resolve));
      return remeshCsgGroupFromWorldChildren(group, worldChildren, { skipOcct: true });
    },
    replay: null,
  };
  const host: ValuesHost = {
    shapes: () => shapes,
    showShapes: (next) => {
      shapes = next;
    },
    commitShapes: (next, _selectedId, message) => commit(next, message),
    updateShape: (id, patch) => commit(shapes.map((shape) => (shape.id === id ? canonicalizeShape({ ...shape, ...cleanShapePatch(patch) }) : shape))),
    notice: (message) => notices.push(message),
    unitMm: () => 1,
    engine: () => engine,
    toolBusy: () => state.toolBusy,
    holdSession: (held) => sessions.push(held),
    reapplyLegacyEdgeSteps: async (body) => {
      legacy.push(body.id);
    },
    report: (bodyId, problems) => reports.push([bodyId, problems]),
  };
  const gate: Gate = {
    open: () => {
      const waiting = release;
      release = [];
      waiting.forEach((resolve) => resolve());
    },
    waiting: () => release.length,
  };
  return {
    host,
    gate,
    state,
    notices,
    reports,
    sessions,
    legacy,
    shapes: () => shapes,
    body: (id = "body") => shapes.find((shape) => shape.id === id)!,
    /** Undo steps made since the design was opened, by name. */
    undoSteps: () => history.slice(1).map((entry) => entry.label ?? "(unnamed)"),
    moveSomethingElse: () => {
      shapes = shapes.map((shape) => (shape.id === "other" ? { ...shape, x: shape.x + 5 } : shape));
    },
  };
}

const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};

/** Wait for something the engine does in its own time. */
async function until(check: () => boolean) {
  for (let turn = 0; turn < 2000 && !check(); turn += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(check()).toBe(true);
}

describe("changing a value on a single part", () => {
  it("is one undo step, through the same path as a typed size", async () => {
    const part = box("body", 20, 20, 20, { drivenBy: { Width: "w", Height: "w / 2" }, values: [{ name: "w", expression: "20" }] });
    const editor = fakeEditor([part, box("other", 5, 5, 5, { x: 50 })]);
    const controller = createValuesController(editor.host);
    expect(await controller.apply(setValue(editor.body(), "w", "32"), "w = 32")).toBe("committed");
    expect(editor.body()).toMatchObject({ width: 32, height: 16, values: [{ name: "w", expression: "32" }] });
    expect(editor.undoSteps()).toHaveLength(1);
    expect(editor.notices).toEqual(["w = 32"]);
    expect(editor.reports.at(-1)).toEqual(["body", []]);
    expect(editor.state.joins).toBe(0);
  });

  it("records a value that changes no size as one undo step too, and adds none when nothing changed", async () => {
    const part = box("body", 20, 20, 20, { values: [{ name: "w", expression: "20" }] });
    const editor = fakeEditor([part]);
    const controller = createValuesController(editor.host);
    await controller.apply({ ...editor.body(), values: [...editor.body().values!, { name: "spare", expression: "3" }] }, "Added a value");
    expect(editor.body().values).toHaveLength(2);
    expect(editor.undoSteps()).toHaveLength(1);
    await controller.apply({ ...editor.body() }, "Nothing");
    expect(editor.undoSteps()).toHaveLength(1);
  });

  it("says what could not follow, and still applies the rest", async () => {
    const part = box("body", 20, 20, 20, { drivenBy: { Width: "w", Height: "tall" }, values: [{ name: "w", expression: "20" }] });
    const editor = fakeEditor([part]);
    const controller = createValuesController(editor.host);
    await controller.apply(setValue(editor.body(), "w", "25"), "w = 25");
    expect(editor.body().width).toBe(25);
    expect(editor.reports.at(-1)).toEqual(["body", ["Height: There is no value named “tall”."]]);
    expect(editor.notices.at(-1)).toBe("Height: There is no value named “tall”.");
  });

  it("does nothing for a part that is no longer in the design", async () => {
    const editor = fakeEditor([box("other")]);
    const controller = createValuesController(editor.host);
    expect(await controller.apply(box("gone"), "x")).toBe("missing");
    expect(editor.undoSteps()).toEqual([]);
  });
});

describe("changing a value on a group", () => {
  it("shows the value at once and commits the rebuilt group as one named undo step", async () => {
    const editor = fakeEditor([await drilledPlate(), box("other", 5, 5, 5, { x: 80 })], { gate: true });
    const controller = createValuesController(editor.host);
    const before = meshVolume(editor.body());
    const pending = controller.apply(setValue(editor.body(), "d", "16"), "d = 16");
    await settle();
    // The Values card already shows 16, the shape has not changed yet, and nothing is in the undo history.
    expect(editor.body().values?.[0]).toEqual({ name: "d", expression: "16" });
    expect(meshVolume(editor.body())).toBe(before);
    expect(editor.undoSteps()).toEqual([]);
    expect(controller.isRunning()).toBe(true);
    editor.gate.open();
    expect(await pending).toBe("committed");
    expect(controller.isRunning()).toBe(false);
    expect(editor.undoSteps()).toEqual(["d = 16"]);
    expect(partNamed(editor.body(), "bore").width).toBe(16);
    const expected = 40 * 40 * 10 - Math.PI * 64 * 10;
    expect(Math.abs(meshVolume(editor.body()) - expected) / expected).toBeLessThan(0.02);
    expect(editor.reports.at(-1)).toEqual(["body", []]);
  }, 60000);

  it("lets a newer change take over: only the newest is committed, and it keeps the older one's value", async () => {
    const editor = fakeEditor([await drilledPlate()], { gate: true });
    const controller = createValuesController(editor.host);
    const first = controller.apply(setValue(editor.body(), "d", "16"), "d = 16");
    await settle();
    expect(editor.gate.waiting()).toBe(1);
    // The second change is made from what the inspector shows now, which already has d = 16.
    const second = controller.apply(setValue(editor.body(), "h", "14"), "h = 14");
    editor.gate.open();
    // The first stops once the engine hands back; only then does the second ask the engine.
    await until(() => editor.state.joins === 2 && editor.gate.waiting() === 1);
    editor.gate.open();
    expect(await first).toBe("cancelled");
    expect(await second).toBe("committed");
    expect(editor.undoSteps()).toEqual(["h = 14"]);
    expect(editor.body().values).toEqual([{ name: "d", expression: "16" }, { name: "h", expression: "14" }]);
    expect(partNamed(editor.body(), "bore").width).toBe(16);
    expect(partNamed(editor.body(), "plate").height).toBe(14);
    const expected = 40 * 40 * 14 - Math.PI * 64 * 14;
    expect(Math.abs(meshVolume(editor.body()) - expected) / expected).toBeLessThan(0.02);
  }, 60000);

  it("keeps a size typed by hand in a change that a newer change replaced", async () => {
    const editor = fakeEditor([await drilledPlate()], { gate: true });
    const controller = createValuesController(editor.host);
    // First: a plain number typed over the plate's height, which lets its sum go.
    const typed = withChangedPart(editor.body(), partNamed(editor.body(), "plate").id, (part) => withTypedSetting(part, "Height", 18));
    const first = controller.apply(typed, "Height set to a number");
    await settle();
    const second = controller.apply(setValue(editor.body(), "d", "12"), "d = 12");
    editor.gate.open();
    await until(() => editor.state.joins === 2 && editor.gate.waiting() === 1);
    editor.gate.open();
    expect(await first).toBe("cancelled");
    expect(await second).toBe("committed");
    expect(partNamed(editor.body(), "plate")).toMatchObject({ height: 18, drivenBy: undefined });
    const expected = 40 * 40 * 18 - Math.PI * 36 * 18;
    expect(Math.abs(meshVolume(editor.body()) - expected) / expected).toBeLessThan(0.02);
    expect(editor.undoSteps()).toEqual(["d = 12"]);
  }, 60000);

  it("finishes only the last of many quick changes, as a slider on a group makes", async () => {
    const editor = fakeEditor([await drilledPlate()], { gate: true });
    const controller = createValuesController(editor.host);
    const results = [9, 10, 11, 12, 13].map((d) => controller.apply(setValue(editor.body(), "d", String(d)), `d = ${d}`));
    await until(() => editor.gate.waiting() === 1);
    editor.gate.open();
    expect(await Promise.all(results)).toEqual(["cancelled", "cancelled", "cancelled", "cancelled", "committed"]);
    expect(editor.undoSteps()).toEqual(["d = 13"]);
    expect(partNamed(editor.body(), "bore").width).toBe(13);
    // Changes made in the same breath never reach the engine: it was asked once, for the last.
    expect(editor.state.joins).toBe(1);
  }, 60000);

  it("drops its work and says so when something else in the design changed meanwhile", async () => {
    const editor = fakeEditor([await drilledPlate(), box("other", 5, 5, 5, { x: 80 })], { gate: true });
    const controller = createValuesController(editor.host);
    const pending = controller.apply(setValue(editor.body(), "d", "16"), "d = 16");
    await settle();
    editor.moveSomethingElse();
    editor.gate.open();
    expect(await pending).toBe("dropped");
    expect(editor.notices.at(-1)).toBe(SCENE_MOVED_NOTICE);
    expect(editor.undoSteps()).toEqual([]);
    expect(partNamed(editor.body(), "bore").width).toBe(8);
    // Changing the value again picks the work up from where the design is now.
    const again = controller.apply(setValue(editor.body(), "d", "16"), "d = 16");
    await settle();
    editor.gate.open();
    expect(await again).toBe("committed");
    expect(partNamed(editor.body(), "bore").width).toBe(16);
    expect(editor.shapes().find((shape) => shape.id === "other")?.x).toBe(85);
  }, 60000);

  it("records a value that changes nothing in the group as one undo step, without the engine", async () => {
    const editor = fakeEditor([await drilledPlate()]);
    const controller = createValuesController(editor.host);
    expect(await controller.apply({ ...editor.body(), values: [...editor.body().values!, { name: "spare", expression: "1" }] }, "Added a value")).toBe("committed");
    expect(editor.undoSteps()).toEqual(["Added a value"]);
    expect(editor.state.joins).toBe(0);
  }, 60000);

  it("waits for an open tool when the part has steps, and changes nothing", async () => {
    const plate = await drilledPlate();
    const withStep: WorkplaneShape = { ...plate, edgeTreatments: [{ kind: "fillet", amount: 1, edgeCount: 4 }] };
    const editor = fakeEditor([withStep]);
    editor.state.toolBusy = true;
    const controller = createValuesController(editor.host);
    expect(await controller.apply(setValue(editor.body(), "d", "16"), "d = 16")).toBe("blocked");
    expect(editor.notices).toEqual([TOOL_BUSY_NOTICE]);
    expect(editor.body().values?.[0].expression).toBe("8");
    expect(editor.undoSteps()).toEqual([]);

    // With the tool closed it holds the CAD session for the rebuild, gives it back, and hands
    // fillets made before steps were recorded to the editor's older path.
    editor.state.toolBusy = false;
    expect(await controller.apply(setValue(editor.body(), "d", "16"), "d = 16")).toBe("committed");
    expect(editor.sessions[0]).toBe(true);
    expect(editor.sessions.at(-1)).toBe(false);
    expect(editor.legacy).toEqual(["body"]);
    expect(editor.undoSteps()).toEqual(["d = 16"]);
  }, 60000);
});

describe("dragging a value's slider", () => {
  it("moves a plain shape while dragging, and makes one undo step when it is let go", async () => {
    const part = box("body", 20, 20, 20, { drivenBy: { Width: "w" }, values: [{ name: "w", expression: "20", min: 10, max: 60 }] });
    const editor = fakeEditor([part]);
    const controller = createValuesController(editor.host);
    for (const w of [22, 27, 31, 36]) {
      expect(controller.preview(setValue(editor.body(), "w", String(w)))).toBe(true);
      expect(editor.body().width).toBe(w);
    }
    expect(editor.undoSteps()).toEqual([]);
    // Letting go commits the number the slider stopped on.
    expect(await controller.apply(setValue(editor.body(), "w", "36"), "w = 36")).toBe("committed");
    expect(editor.undoSteps()).toHaveLength(1);
    expect(editor.body()).toMatchObject({ width: 36, values: [{ name: "w", expression: "36", min: 10, max: 60 }] });
  });

  it("leaves a group alone until the slider is let go", async () => {
    const editor = fakeEditor([await drilledPlate()]);
    const controller = createValuesController(editor.host);
    const before = editor.body();
    expect(controller.preview(setValue(before, "d", "16"))).toBe(false);
    expect(editor.body()).toBe(before);
    expect(editor.state.joins).toBe(0);
  }, 60000);
});
