import type { EditorHistoryEntry } from "@/lib/editorHistory";
import { guideStartIndex, type GuideStep } from "@/lib/mintrGuide";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Guides compare a learner's model with the author's step by step, but only by numbers: kinds,
 * sizes, positions, sketch outlines, edge treatments and grouping. They never read meshes or exact
 * solids, so every step except the starting model can be a slim "recipe" of the shapes.
 */
function slimGuideShape(shape: WorkplaneShape): WorkplaneShape {
  const next: WorkplaneShape = {
    ...shape,
    importedMesh: undefined,
    cadBrep: undefined,
    cadBrepFrame: undefined,
    cadDisplayEdges: undefined,
    cadDisplayEdgesVersion: undefined,
    sketchDoc: undefined,
  };
  if (shape.imagePlate) next.imagePlate = { ...shape.imagePlate, dataUrl: "" };
  if (shape.sketchProfile?.images?.length) next.sketchProfile = { ...shape.sketchProfile, images: undefined };
  if (shape.groupedShapes?.length) next.groupedShapes = shape.groupedShapes.map(slimGuideShape);
  return next;
}

const slimCache = new WeakMap<EditorHistoryEntry, EditorHistoryEntry>();

/** One history step as a recipe. Cached per entry, so following the history costs almost nothing. */
export function slimGuideEntry(entry: EditorHistoryEntry): EditorHistoryEntry {
  const cached = slimCache.get(entry);
  if (cached) return cached;
  const shapes = entry.shapes.map(slimGuideShape);
  const slim: EditorHistoryEntry = {
    shapes,
    selectedIds: [],
    fingerprint: entry.fingerprint,
    estimatedBytes: JSON.stringify(shapes).length,
    ...(entry.label ? { label: entry.label } : {}),
  };
  slimCache.set(entry, slim);
  slimCache.set(slim, slim);
  return slim;
}

/**
 * Every step of a design in one line, longer than the undo history: the steps the undo history has
 * already let go of (`offset` of them), then the current undo history up to the cursor. A step that
 * was undone and never redone is not in it, just as it is not in a guide.
 */
export type GuideLog = { entries: EditorHistoryEntry[]; offset: number };

export const EMPTY_GUIDE_LOG: GuideLog = { entries: [], offset: 0 };

/** Far beyond any undo history, and still small: recipes are a few kilobytes each. */
const MAX_GUIDE_LOG_ENTRIES = 5000;
const MAX_GUIDE_LOG_BYTES = 48 * 1024 * 1024;

/**
 * Bring the log up to date with the undo history. The history's first entry is found in the log
 * (it can only move forward as the history trims), everything before it is kept, and the rest is
 * the history itself. If it cannot be found, the history is a different one and the log restarts.
 */
export function syncGuideLog(log: GuideLog, history: readonly EditorHistoryEntry[], historyIndex: number): GuideLog {
  const end = Math.min(Math.max(0, historyIndex), history.length - 1);
  const branch = history.slice(0, end + 1).map(slimGuideEntry);
  if (!branch.length) return EMPTY_GUIDE_LOG;
  let at = -1;
  for (let index = Math.max(0, log.offset); index < log.entries.length; index += 1) {
    if (log.entries[index].fingerprint === branch[0].fingerprint) {
      at = index;
      break;
    }
  }
  let entries = at < 0 ? branch : [...log.entries.slice(0, at), ...branch];
  let offset = at < 0 ? 0 : at;
  let bytes = entries.reduce((total, entry) => total + entry.estimatedBytes, 0);
  // Over budget: let the oldest recipes go, but never the live undo history.
  while (offset > 0 && (entries.length > MAX_GUIDE_LOG_ENTRIES || bytes > MAX_GUIDE_LOG_BYTES)) {
    bytes -= entries[0].estimatedBytes;
    entries = entries.slice(1);
    offset -= 1;
  }
  return { entries, offset };
}

/**
 * What a .mintrguide needs to hold: the starting model in full (so the learner opens it as it was),
 * then a recipe for each step the lesson reads (every kept step and the one before it). Steps are
 * renumbered to the trimmed list; consecutive steps stay consecutive, so folding is unchanged.
 */
export function compactGuideForFile(
  history: readonly EditorHistoryEntry[],
  steps: readonly GuideStep[],
  fullStart?: EditorHistoryEntry,
): { history: EditorHistoryEntry[]; steps: GuideStep[] } {
  const kept = steps.filter((step) => step.included);
  const start = guideStartIndex(history, kept);
  const needed = new Set<number>([start]);
  for (const step of kept) {
    needed.add(step.historyIndex);
    needed.add(step.historyIndex - 1);
  }
  const order = [...needed].filter((index) => index >= 0 && index < history.length).sort((left, right) => left - right);
  const renumber = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  return {
    history: order.map((index) => (index === start && fullStart ? fullStart : slimGuideEntry(history[index]))),
    steps: kept.map((step) => ({ ...step, historyIndex: renumber.get(step.historyIndex)! })),
  };
}
