import { PLATE_GUIDE_ID, POCKET_GUIDE_ID } from "@/lib/builtinGuides";
import { withCsgMeta } from "@/lib/csgTree";
import { sceneShape } from "@/lib/shapeCatalog";
import { aabbsOverlap, worldAabb } from "@/lib/shapeBounds";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";
import type { WorkplaneShape } from "@/types/sketchforge";

export const INTRO_PROJECT_ID = "peakcad-intro-block-hole";
export const INTRO_PROJECT_NAME = "Block with a hole";
export const INTRO_SEEDED_STORAGE_KEY = "peakcad:introSeeded";
export const INTRO_COACH_DISMISSED_KEY = "peakcad:introCoachDismissed";

export function isIntroProjectId(projectId: string | null | undefined) {
  return projectId === INTRO_PROJECT_ID;
}

export function hasIntroBeenSeeded() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(INTRO_SEEDED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markIntroSeeded() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INTRO_SEEDED_STORAGE_KEY, "1");
  } catch {
    // First-run still works in-memory for this session.
  }
}

export function hasIntroCoachBeenDismissed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(INTRO_COACH_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markIntroCoachDismissed() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INTRO_COACH_DISMISSED_KEY, "1");
  } catch {
    // Coach stays dismissed for this session.
  }
}

export function createIntroShapes(): WorkplaneShape[] {
  const box = sceneShape({
    id: "intro-box",
    name: "Box",
    kind: "box",
    color: "#d41721",
    x: 0,
    z: 0,
    elevation: 0,
    size: 24,
    width: 24,
    depth: 24,
    height: 16,
  });
  const hole = sceneShape({
    id: "intro-hole",
    name: "Hole",
    kind: "cylinder",
    color: "#d97813",
    hole: true,
    x: 0,
    z: 0,
    elevation: -2,
    size: 10,
    width: 10,
    depth: 10,
    height: 20,
    bevel: 0,
    segments: 1,
  });
  const group = withCsgMeta(
    sceneShape({
      id: "intro-group",
      name: INTRO_PROJECT_NAME,
      kind: "mesh",
      color: "#d41721",
      x: 0,
      z: 0,
      elevation: 0,
      size: 24,
      width: 24,
      depth: 24,
      height: 16,
      groupedBaseWidth: 24,
      groupedBaseDepth: 24,
      groupedBaseHeight: 16,
      groupedShapes: [box, hole],
    }),
    "subtract",
    1,
    true,
  );
  return [group];
}

export function createIntroProjectMeta(now = Date.now()) {
  return {
    id: INTRO_PROJECT_ID,
    name: INTRO_PROJECT_NAME,
    createdAt: now,
    updatedAt: now,
    shapes: 1,
    accent: "cyan" as const,
    revision: now,
    workspace: DEFAULT_WORKPLANE_WORKSPACE,
    snapGrid: DEFAULT_SNAP_GRID,
    folderId: null,
  };
}

/** Empty lesson. Beginners build the part themselves. Older "Block with a hole" files are left alone. */
export const LESSON_PROJECT_ID = "peakcad-lesson-first-part";
export const LESSON_PROJECT_NAME = "Add a Hole to a Box";
export const LESSON_SEEDED_STORAGE_KEY = "peakcad:lessonSeeded";
export const LESSON_COACH_DISMISSED_KEY = "peakcad:lessonCoachDismissed";
export const LESSON_DONE_STORAGE_KEY = "peakcad:lessonDone";

export function isLessonProjectId(projectId: string | null | undefined) {
  return projectId === LESSON_PROJECT_ID;
}

export function isBuiltinGuideId(projectId: string | null | undefined) {
  return projectId === PLATE_GUIDE_ID || projectId === POCKET_GUIDE_ID;
}

export function isShippedTutorialId(projectId: string | null | undefined) {
  return isLessonProjectId(projectId) || isBuiltinGuideId(projectId);
}

export function isSampleProjectId(projectId: string | null | undefined) {
  return isIntroProjectId(projectId) || isShippedTutorialId(projectId);
}

export function hasLessonBeenSeeded() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LESSON_SEEDED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLessonSeeded() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LESSON_SEEDED_STORAGE_KEY, "1");
  } catch {
    // The lesson still opens for this session.
  }
}

export function hasLessonCoachBeenDismissed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LESSON_COACH_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLessonCoachDismissed() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LESSON_COACH_DISMISSED_KEY, "1");
  } catch {
    // The coach stays closed for this session.
  }
}

export function hasLessonBeenCompleted() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LESSON_DONE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLessonCompleted() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LESSON_DONE_STORAGE_KEY, "1");
  } catch {
    // Completion still shows until the page reloads.
  }
}

/** App preference. Finished tutorials leave the home page on their own. */
export const HIDE_TUTORIALS_STORAGE_KEY = "peakcad:hideTutorials";

export function tutorialsAreHidden() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(HIDE_TUTORIALS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTutorialsHidden(hidden: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HIDE_TUTORIALS_STORAGE_KEY, hidden ? "1" : "0");
  } catch {
    // The home page still follows the choice for this session.
  }
}

function tutorialDoneKey(id: string) {
  return id === LESSON_PROJECT_ID ? LESSON_DONE_STORAGE_KEY : `peakcad:tutorialDone:${id}`;
}

export function isTutorialCompleted(id: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(tutorialDoneKey(id)) === "1";
  } catch {
    return false;
  }
}

export function markTutorialCompleted(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(tutorialDoneKey(id), "1");
  } catch {
    // The check still shows until the page reloads.
  }
}

export function createLessonShapes(): WorkplaneShape[] {
  return [];
}

export function createLessonProjectMeta(now = Date.now()) {
  return {
    id: LESSON_PROJECT_ID,
    name: LESSON_PROJECT_NAME,
    createdAt: now,
    updatedAt: now,
    shapes: 0,
    accent: "cyan" as const,
    revision: now,
    workspace: DEFAULT_WORKPLANE_WORKSPACE,
    snapGrid: DEFAULT_SNAP_GRID,
    folderId: null,
  };
}

/** Home-page catalog. A fresh install does not drop these into the design list. */
export type Tutorial = {
  id: string;
  title: string;
  summary: string;
  length: string;
};

export const TUTORIALS: Tutorial[] = [
  {
    id: LESSON_PROJECT_ID,
    title: LESSON_PROJECT_NAME,
    summary: "Place a box, turn a cylinder into a hole, and group them to cut through.",
    length: "6 steps",
  },
  {
    id: PLATE_GUIDE_ID,
    title: "A plate from a sketch",
    summary: "Draw a rectangle on the workplane, extrude it, then chamfer every edge.",
    length: "2 steps",
  },
  {
    id: POCKET_GUIDE_ID,
    title: "A pocket in a block",
    summary: "Place a box, then cut a pocket into the top with Pad/Pocket.",
    length: "2 steps",
  },
];

export function completedTutorialIds() {
  return TUTORIALS.filter((tutorial) => isTutorialCompleted(tutorial.id)).map((tutorial) => tutorial.id);
}

export function tutorialsForQuery(query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return TUTORIALS;
  return TUTORIALS.filter((tutorial) => `${tutorial.title} ${tutorial.summary}`.toLowerCase().includes(needle));
}

/** Home cards. A finished tutorial stays in Settings and leaves this list. */
export function tutorialsOnHome(query: string, options?: { hidden?: boolean; completedIds?: readonly string[] }) {
  if (options?.hidden) return [];
  const done = new Set(options?.completedIds ?? []);
  return tutorialsForQuery(query).filter((tutorial) => !done.has(tutorial.id));
}

/** A hole counts when it overlaps a solid and sticks out both sides, so the cut actually opens. */
export function sceneHasThroughHole(shapes: WorkplaneShape[]): boolean {
  const list = shapes.filter((shape) => !shape.hidden && !shape.suppressed && !shape.csg?.suppressed);
  const solids = list.filter((shape) => !shape.hole && !shape.construction);
  const holes = list.filter((shape) => shape.hole);
  if (solids.some((solid) => holes.some((hole) => holePunchesThrough(solid, hole)))) return true;
  return list.some((shape) => Boolean(shape.groupedShapes?.length) && sceneHasThroughHole(shape.groupedShapes ?? []));
}

/**
 * The hole reaches both sides of the part along one direction (flush counts: a hole as tall as
 * the box cuts right through) and is narrower than the part the other two ways, so it opens a
 * hole rather than carving the part away.
 */
function holePunchesThrough(solid: WorkplaneShape, hole: WorkplaneShape) {
  const part = worldAabb(solid);
  const cutter = worldAabb(hole);
  if (!aabbsOverlap(part, cutter)) return false;
  const spans = (axis: number) => cutter.min[axis] <= part.min[axis] + 0.01 && cutter.max[axis] >= part.max[axis] - 0.01;
  const inside = (axis: number) => cutter.min[axis] > part.min[axis] + 0.2 && cutter.max[axis] < part.max[axis] - 0.2;
  return [0, 1, 2].some((axis) => spans(axis) && [0, 1, 2].every((other) => other === axis || inside(other)));
}

/** Loose cylinders at the top of the scene: the one the lesson turns into a hole. */
function looseCylinders(shapes: WorkplaneShape[]) {
  return shapes.filter((shape) => !shape.hidden && !shape.suppressed && shape.kind === "cylinder" && !shape.groupedShapes?.length);
}

export function sceneHasBox(shapes: WorkplaneShape[]): boolean {
  return shapes.some((shape) => !shape.hidden && !shape.hole && !shape.suppressed && (
    shape.kind === "box" || (shape.groupedShapes ?? []).some((child) => child.kind === "box" && !child.hole && !child.suppressed)
  ));
}

export type LessonCue =
  | "box"
  | "cylinder"
  | "hole"
  | "size"
  | "select-both"
  | "group"
  | "geometry"
  | "export"
  | "download-stl"
  | "done";

export type LessonPrompt = {
  cue: LessonCue;
  step: number;
  total: number;
  title: string;
  body: string;
  complete: boolean;
};

export type LessonExportReport = {
  /** The STL kept the hole. A loose hole shape is left out of an STL. */
  keptHole: boolean;
};

/** STL writes solids only. A hole counts when it lives inside a solid that gets written. */
export function lessonStlKeepsHole(shapes: WorkplaneShape[]): boolean {
  const list = shapes.filter((shape) => !shape.hidden && !shape.suppressed && !shape.csg?.suppressed);
  return list.some((shape) => !shape.hole && !shape.construction && sceneHasThroughHole([shape]));
}

export function lessonExportOk(report: LessonExportReport, hasThroughHole: boolean) {
  return hasThroughHole && report.keptHole;
}

export function lessonExportNote(report: LessonExportReport | null, hasThroughHole: boolean): string | null {
  if (!report || lessonExportOk(report, hasThroughHole)) return null;
  if (!hasThroughHole) return "That file is a solid with no hole. Follow the prompt, then Download STL again.";
  if (!report.keptHole) return "The hole did not make it into the STL. Group the hole with the box, then Download STL again.";
  return null;
}

const LESSON_TOTAL = 6;

/** The single next prompt. Later scenes skip ahead, so a finished hole does not send them back to Box. */
export function lessonPrompt(input: {
  shapes: WorkplaneShape[];
  /** In the Sketch tab, or sketching: this lesson only uses shapes. */
  sketching: boolean;
  /** Selected shape ids: Group needs the box and the hole both selected. */
  selectedIds?: readonly string[];
}): LessonPrompt {
  const step = (cue: LessonCue, at: number, title: string, body: string): LessonPrompt => ({ cue, step: at, total: LESSON_TOTAL, title, body, complete: false });
  if (lessonStlKeepsHole(input.shapes)) {
    return { cue: "done", step: LESSON_TOTAL, total: LESSON_TOTAL, title: "You made a part with a hole", body: "The box has a hole through it. Close this when you want to keep modeling.", complete: true };
  }
  if (input.sketching) {
    return step("geometry", 1, "This guide uses shapes", "Click Cancel if you are drawing, then click Geometry at the top.");
  }
  const hasBox = sceneHasBox(input.shapes);
  if (!hasBox) {
    return step("box", 1, "Place a box", "Click Box on the right. A red box lands on the grid.");
  }
  const cylinders = looseCylinders(input.shapes);
  const holes = cylinders.filter((shape) => shape.hole);
  if (holes.length === 0) {
    if (cylinders.length === 0) {
      return step("cylinder", 2, "Add a cylinder", "Click Cylinder on the right. It lands right where the box is.");
    }
    return step("hole", 3, "Turn the cylinder into a hole", "With the cylinder selected, click Hole in the panel on the right.");
  }
  if (sceneHasThroughHole(input.shapes)) {
    const selected = new Set(input.selectedIds ?? []);
    const bothPicked = holes.some((hole) => selected.has(hole.id))
      && input.shapes.some((shape) => !shape.hole && !shape.hidden && selected.has(shape.id));
    if (!bothPicked) {
      return step("select-both", 5, "Select the box and the hole", "Group needs both selected. Click the hole, then hold Shift and click the box. Ctrl+A selects everything.");
    }
    return step("group", 6, "Cut the hole", "Both are selected. Click Group at the top, and the hole cuts through the box.");
  }
  const solids = input.shapes.filter((shape) => !shape.hidden && !shape.hole && !shape.suppressed);
  const tooWide = holes.every((hole) => solids.some((solid) => {
    const part = worldAabb(solid);
    const cutter = worldAabb(hole);
    return cutter.max[0] - cutter.min[0] >= part.max[0] - part.min[0] - 0.2 || cutter.max[2] - cutter.min[2] >= part.max[2] - part.min[2] - 0.2;
  }));
  if (tooWide) {
    return step("size", 4, "Make the hole smaller", "The hole is as wide as the box. Set its Length and Width to 8 mm in the panel on the right.");
  }
  return step("size", 4, "Line the hole up", "Move the hole so it sits inside the box, and make its Height at least as tall as the box so it cuts all the way through.");
}
