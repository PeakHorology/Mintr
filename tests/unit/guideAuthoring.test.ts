import { describe, expect, it } from "vitest";
import type { EditorHistoryEntry } from "@/lib/editorHistory";
import { plateGuideSession, pocketGuideSession } from "@/lib/builtinGuides";
import { applyGuideDraft } from "@/lib/guideAuthoring";
import {
  describeGuideStep,
  guideLessonGroups,
  guideMinutes,
  guidePrompt,
  guideStepCount,
  proposeGuideSteps,
  type GuideStep,
  type MintrGuide,
} from "@/lib/mintrGuide";
import { buildPeakcadDocument, parsePeakcadDocument, serializeMintrGuide } from "@/lib/peakcadDocument";
import { sceneShape } from "@/lib/shapeCatalog";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(id: string, patch: Partial<WorkplaneShape> = {}) {
  return sceneShape({ name: id, kind: "box", color: "#d41721", width: 20, depth: 20, height: 20, ...patch, id });
}

function entry(shapes: WorkplaneShape[], label?: string): EditorHistoryEntry {
  return {
    shapes,
    selectedIds: [],
    fingerprint: label ?? `${shapes.length}:${shapes.map((shape) => `${shape.id}@${shape.x},${shape.height}`).join(",")}`,
    estimatedBytes: 1,
    label,
  };
}

function prompt(guide: MintrGuide, history: EditorHistoryEntry[], shapes: WorkplaneShape[]) {
  return guidePrompt({
    guide,
    history,
    shapes,
    sketchMode: false,
    pickingFace: false,
    sketching: false,
    sketchingOffPart: false,
    sketchClosed: false,
    extrudeOpen: false,
    sketchPoints: [],
  });
}

function roundTrip(guide: MintrGuide, history: EditorHistoryEntry[]) {
  const text = serializeMintrGuide(buildPeakcadDocument({
    project: { id: "design-g1", name: guide.title, createdAt: 1, updatedAt: 1, accent: "cyan", shapes: 1 },
    shapes: history[history.length - 1].shapes,
    history,
    historyIndex: history.length - 1,
    guide,
  }));
  return parsePeakcadDocument(text).guide;
}

// Two blocks of different sizes, then the second slides further along.
const thin = { width: 10 };
const twoBlocks = [
  entry([], "Start"),
  entry([box("a")], "Box added"),
  entry([box("a"), box("b", { x: 40, ...thin })], "Box added"),
  entry([box("a"), box("b", { x: 60, ...thin })], "Moved"),
];

describe("guide authoring", () => {
  it("keeps a pocket's size, step names, tips, folds and the author's look through saving", () => {
    const steps: GuideStep[] = [
      { historyIndex: 1, label: "Add a box", included: true, cue: "box", name: "The base", tip: "Type the sizes in the panel" },
      { historyIndex: 2, label: "Cut a pocket", included: true, cue: "pad/pocket", insetMm: 3, depthMm: 5, fold: false },
    ];
    const history = [entry([], "Start"), entry([box("a")], "Box added"), entry([box("a", { height: 18 })], "Pocket")];
    const parsed = roundTrip({
      title: "Tray", author: "Ada", summary: "A small tray.", steps,
      color: "purple", avatar: "data:image/jpeg;base64,AAAA", minutes: 4,
    }, history);
    expect(parsed?.steps[1]).toMatchObject({ cue: "pad/pocket", insetMm: 3, depthMm: 5, fold: false });
    expect(parsed?.steps[0]).toMatchObject({ name: "The base", tip: "Type the sizes in the panel" });
    expect(parsed).toMatchObject({ summary: "A small tray.", color: "purple", avatar: "data:image/jpeg;base64,AAAA", minutes: 4 });
  });

  it("never lets a file claim Mintr's own look, and keeps mint for Mintr", () => {
    const history = [entry([], "Start"), entry([box("a")], "Box added")];
    const parsed = roundTrip({
      title: "Fake", author: "Mintr", summary: "", steps: proposeGuideSteps(history, 1),
      official: true, color: "mint" as never,
    }, history);
    expect(parsed?.official).toBeUndefined();
    expect(parsed?.color).toBeUndefined();
    expect(plateGuideSession().guide.official).toBe(true);
    expect(pocketGuideSession().guide.official).toBe(true);
  });

  it("folds a step into the one before it, so the learner sees one step and does both parts in order", () => {
    const steps = proposeGuideSteps(twoBlocks, 3);
    steps[2] = { ...steps[2], fold: true, included: true };
    steps[1] = { ...steps[1], name: "Second block", tip: "Leave a gap" };
    const guide: MintrGuide = { title: "Blocks", author: "Ada", summary: "", steps };
    expect(guideLessonGroups(guide, twoBlocks).map((group) => group.map((step) => step.historyIndex))).toEqual([[1], [2, 3]]);
    expect(guideStepCount(guide, twoBlocks)).toBe(2);

    const placeSecond = prompt(guide, twoBlocks, [box("a")]);
    expect(placeSecond).toMatchObject({ step: 2, total: 2, heading: "Second block", tip: "Leave a gap" });
    expect(placeSecond?.body).toContain("Click Box");

    const moveSecond = prompt(guide, twoBlocks, [box("a"), box("b", { x: 40, ...thin })]);
    expect(moveSecond).toMatchObject({ step: 2, total: 2 });
    expect(moveSecond?.body).toMatch(/^Move it/);

    expect(prompt(guide, twoBlocks, [box("a"), box("b", { x: 60, ...thin })])?.complete).toBe(true);
  });

  it("starts the steps with nothing to learn skipped, and size edits folded", () => {
    const solo = proposeGuideSteps([entry([], "Start"), entry([box("a")], "Box added"), entry([box("a", { x: 30 })], "Moved")], 2);
    expect(solo[1].included).toBe(false);

    const back = proposeGuideSteps([
      entry([], "Start"),
      entry([box("a")], "Box added"),
      entry([box("a"), box("b", { x: 40 })], "Box added"),
      entry([box("a")]),
    ], 3);
    expect(back[2].included).toBe(false);

    const hidden = proposeGuideSteps([entry([], "Start"), entry([box("a")], "Box added"), entry([box("a", { hidden: true })], "Selection hidden")], 2);
    expect(hidden[1].included).toBe(false);

    const sized = proposeGuideSteps([entry([], "Start"), entry([box("a")], "Box added"), entry([box("a", { height: 30 })])], 2);
    expect(sized[1]).toMatchObject({ included: true, fold: true, label: "Change the size" });
  });

  it("describes a step in plain words with its real numbers", () => {
    const history = [entry([], "Start"), entry([box("a")], "Box added"), entry([box("a", { height: 30 })])];
    const steps = proposeGuideSteps(history, 2);
    const about = describeGuideStep(steps[0], history, steps);
    expect(about.title).toBe("Add a box 20 × 20 × 30 mm");
    expect(about.body).toBe("Click Box. Set Length to 20 mm, Width to 20 mm, and Height to 30 mm.");
  });

  it("reapplies the author's earlier choices to the same steps only", () => {
    const steps = proposeGuideSteps(twoBlocks, 3);
    const applied = applyGuideDraft(steps, {
      guideId: "design-g1",
      title: "Blocks",
      summary: "",
      steps: [
        { historyIndex: 1, cue: "box", included: false, name: "Base" },
        { historyIndex: 2, cue: "sketch", included: false },
      ],
    });
    expect(applied[0]).toMatchObject({ included: false, name: "Base" });
    expect(applied[1].included).toBe(true);
  });

  it("estimates a minute a step", () => {
    const steps = proposeGuideSteps(twoBlocks, 3);
    expect(guideMinutes({ title: "Blocks", author: "Ada", summary: "", steps }, twoBlocks)).toBe(guideStepCount({ title: "Blocks", author: "Ada", summary: "", steps }, twoBlocks));
  });
});
