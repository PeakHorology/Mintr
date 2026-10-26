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
export const LESSON_PROJECT_NAME = "Make a block with a hole";
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
    summary: "Place a box, sketch a hole on the top, and cut through.",
    length: "3 steps",
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

function holePunchesThrough(solid: WorkplaneShape, hole: WorkplaneShape) {
  const part = worldAabb(solid);
  const cutter = worldAabb(hole);
  if (!aabbsOverlap(part, cutter)) return false;
  return [0, 1, 2].some((axis) => cutter.min[axis] < part.min[axis] - 0.2 && cutter.max[axis] > part.max[axis] + 0.2);
}

export function sceneHasBox(shapes: WorkplaneShape[]): boolean {
  return shapes.some((shape) => !shape.hidden && !shape.hole && !shape.suppressed && (
    shape.kind === "box" || (shape.groupedShapes ?? []).some((child) => child.kind === "box" && !child.hole && !child.suppressed)
  ));
}

export type LessonCue =
  | "box"
  | "sketch"
  | "new-sketch"
  | "face"
  | "circle"
  | "extrude"
  | "cut"
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
  if (!report.keptHole) return "The hole did not make it into the STL. Cut into the box, then Download STL again.";
  return null;
}

const LESSON_TOTAL = 3;

/** The single next prompt. Later scenes skip ahead, so a finished hole does not send them back to Box. */
export function lessonPrompt(input: {
  shapes: WorkplaneShape[];
  sketchMode: boolean;
  pickingFace: boolean;
  sketchingOnPart: boolean;
  sketchingOffPart: boolean;
  sketchClosed: boolean;
  extrudeOpen: boolean;
}): LessonPrompt {
  const hasBox = sceneHasBox(input.shapes);
  const through = sceneHasThroughHole(input.shapes);
  if (through) {
    return { cue: "done", step: LESSON_TOTAL, total: LESSON_TOTAL, title: "You made a part with a hole", body: "The box has a hole through it. Close this when you want to keep modeling.", complete: true };
  }
  if (input.extrudeOpen) {
    return { cue: "cut", step: 3, total: LESSON_TOTAL, title: "Cut the hole", body: "Leave the number. It matches the box, so the cut goes all the way through. Click Cut into part.", complete: false };
  }
  if (input.sketchingOnPart && input.sketchClosed) {
    return { cue: "extrude", step: 3, total: LESSON_TOTAL, title: "Turn the circle into a hole", body: "Click Extrude.", complete: false };
  }
  if (input.sketchingOnPart) {
    return { cue: "circle", step: 2, total: LESSON_TOTAL, title: "Draw the hole", body: "Click Circle. Drag on the face, starting near the middle. Keep it smaller than the box.", complete: false };
  }
  if (input.sketchingOffPart && hasBox) {
    return { cue: "face", step: 2, total: LESSON_TOTAL, title: "Sketch on the box", body: "This sketch is on the empty grid. Click Cancel, then New sketch, and click the top of the box.", complete: false };
  }
  if (input.pickingFace && hasBox) {
    return { cue: "face", step: 2, total: LESSON_TOTAL, title: "Click the top of the box", body: "Click the top face. The view turns toward it. Draw on that face.", complete: false };
  }
  if (input.sketchMode && hasBox) {
    return { cue: "new-sketch", step: 2, total: LESSON_TOTAL, title: "Start a sketch on the box", body: "Click New sketch. Then click the top of the box.", complete: false };
  }
  if (hasBox) {
    return { cue: "sketch", step: 2, total: LESSON_TOTAL, title: "Sketch on the box", body: "Click Sketch at the top, next to Geometry.", complete: false };
  }
  return { cue: "box", step: 1, total: LESSON_TOTAL, title: "Place a box", body: "Click Box on the right. A red box lands on the grid.", complete: false };
}
