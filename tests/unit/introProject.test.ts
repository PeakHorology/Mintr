import { describe, expect, it } from "vitest";
import {
  createIntroShapes,
  createLessonShapes,
  INTRO_PROJECT_NAME,
  lessonExportNote,
  lessonExportOk,
  lessonPrompt,
  lessonStlKeepsHole,
  LESSON_PROJECT_ID,
  LESSON_PROJECT_NAME,
  sceneHasThroughHole,
  TUTORIALS,
  tutorialsForQuery,
  tutorialsOnHome,
} from "@/lib/introProject";
import { inferCsgOp } from "@/lib/csgTree";
import { sceneShape } from "@/lib/shapeCatalog";
import type { WorkplaneShape } from "@/types/sketchforge";

describe("intro project", () => {
  it("builds a grouped box with a through hole", () => {
    const shapes = createIntroShapes();
    expect(shapes).toHaveLength(1);
    const group = shapes[0];
    expect(group?.name).toBe(INTRO_PROJECT_NAME);
    expect(inferCsgOp(group!)).toBe("subtract");
    expect(group?.csg?.dirty).toBe(true);
    expect(group?.groupedShapes?.map((child) => child.kind)).toEqual(["box", "cylinder"]);
    expect(group?.groupedShapes?.[0]?.hole).toBeFalsy();
    expect(group?.groupedShapes?.[1]?.hole).toBe(true);
    expect((group?.groupedShapes?.[1]?.height ?? 0) > (group?.groupedShapes?.[0]?.height ?? 0)).toBe(true);
  });
});

function box(): WorkplaneShape {
  return sceneShape({ name: "Box", kind: "box", color: "#d41721", width: 20, depth: 20, height: 20 });
}

describe("first-part lesson", () => {
  const idle = { shapes: [] as WorkplaneShape[], sketching: false };
  const cylinder = (extra: Partial<WorkplaneShape> = {}) => sceneShape({ name: "Cylinder", kind: "cylinder", color: "#d97813", width: 20, depth: 20, height: 20, ...extra });

  it("starts empty so the beginner places the box", () => {
    expect(createLessonShapes()).toEqual([]);
    expect(lessonPrompt(idle).cue).toBe("box");
    expect(TUTORIALS.map((tutorial) => tutorial.id)).toEqual([
      LESSON_PROJECT_ID,
      "guide:mintr-plate",
      "guide:mintr-pocket",
    ]);
    expect(TUTORIALS[0]?.title).toBe(LESSON_PROJECT_NAME);
    expect(tutorialsForQuery("stl")).toHaveLength(0);
    expect(tutorialsForQuery("chamfer").map((tutorial) => tutorial.title)).toEqual(["A plate from a sketch"]);
    expect(tutorialsForQuery("pocket").map((tutorial) => tutorial.title)).toEqual(["A pocket in a block"]);
    expect(tutorialsForQuery("fillet")).toEqual([]);
    expect(tutorialsOnHome("")).toHaveLength(3);
    expect(tutorialsOnHome("", { hidden: true })).toEqual([]);
    expect(tutorialsOnHome("", { completedIds: [LESSON_PROJECT_ID] })).toHaveLength(2);
    expect(tutorialsForQuery("")).toHaveLength(3);
  });

  it("walks box, cylinder, hole, size, select and group, one prompt at a time", () => {
    expect(lessonPrompt({ ...idle, shapes: [box()] })).toMatchObject({ cue: "cylinder", step: 2, total: 6 });
    expect(lessonPrompt({ ...idle, shapes: [box(), cylinder()] }).cue).toBe("hole");
    // A new cylinder lands on the box at its full width: as a hole it would carve the box away.
    const wide = lessonPrompt({ ...idle, shapes: [box(), cylinder({ hole: true })] });
    expect(wide).toMatchObject({ cue: "size", title: "Make the hole smaller" });
    // Flush with the box top and bottom counts as through.
    const sized = [box(), cylinder({ hole: true, width: 8, depth: 8 })];
    expect(sceneHasThroughHole(sized)).toBe(true);
    // Group needs both selected: one alone is not enough.
    expect(lessonPrompt({ ...idle, shapes: sized }).cue).toBe("select-both");
    expect(lessonPrompt({ ...idle, shapes: sized, selectedIds: [sized[1].id] }).cue).toBe("select-both");
    expect(lessonPrompt({ ...idle, shapes: sized, selectedIds: [sized[0].id, sized[1].id] })).toMatchObject({ cue: "group", step: 6 });
    const grouped = sceneShape({ name: "Group", kind: "box", color: "#d41721", width: 20, depth: 20, height: 20, groupedShapes: sized });
    const finished = lessonPrompt({ ...idle, shapes: [grouped] });
    expect(finished).toMatchObject({ cue: "done", complete: true, step: 6, total: 6 });
    expect(finished.body).not.toMatch(/STL/);
  });

  it("sends a beginner who opened Sketch back to Geometry", () => {
    expect(lessonPrompt({ shapes: [box()], sketching: true }).cue).toBe("geometry");
  });

  it("does not treat a hole that stops inside the box as finished", () => {
    const short = cylinder({ hole: true, width: 8, depth: 8, height: 10 });
    expect(sceneHasThroughHole([box(), short])).toBe(false);
    expect(lessonPrompt({ ...idle, shapes: [box(), short] })).toMatchObject({ cue: "size", title: "Line the hole up" });
  });

  it("tells them when the exported STL has no hole", () => {
    const report = { keptHole: true };
    expect(lessonExportOk(report, false)).toBe(false);
    expect(lessonExportNote(report, false)).toMatch(/no hole/i);
    expect(lessonExportOk(report, true)).toBe(true);
    expect(lessonStlKeepsHole([box(), sceneShape({
      name: "Hole",
      kind: "cylinder",
      color: "#d97813",
      hole: true,
      width: 8,
      depth: 8,
      height: 30,
      elevation: -5,
    })])).toBe(false);
    const grouped = sceneShape({
      name: "Part",
      kind: "box",
      color: "#d41721",
      width: 20,
      depth: 20,
      height: 20,
      groupedShapes: [
        box(),
        sceneShape({
          name: "Hole",
          kind: "cylinder",
          color: "#d97813",
          hole: true,
          width: 8,
          depth: 8,
          height: 30,
          elevation: -5,
        }),
      ],
    });
    expect(lessonStlKeepsHole([grouped])).toBe(true);
    expect(lessonExportNote({ keptHole: false }, true)).toMatch(/did not make it into the STL/i);
  });
});
