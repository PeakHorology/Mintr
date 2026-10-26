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
  const idle = {
    shapes: [] as WorkplaneShape[],
    sketchMode: false,
    pickingFace: false,
    sketchingOnPart: false,
    sketchingOffPart: false,
    sketchClosed: false,
    extrudeOpen: false,
  };

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

  it("walks one prompt at a time and skips ahead once the hole goes through", () => {
    const withBox = lessonPrompt({ ...idle, shapes: [box()] });
    expect(withBox.cue).toBe("sketch");
    expect(withBox.step).toBe(2);

    expect(lessonPrompt({ ...idle, shapes: [box()], sketchMode: true }).cue).toBe("new-sketch");
    expect(lessonPrompt({ ...idle, shapes: [box()], pickingFace: true }).cue).toBe("face");
    expect(lessonPrompt({ ...idle, shapes: [box()], sketchingOnPart: true }).cue).toBe("circle");
    expect(lessonPrompt({ ...idle, shapes: [box()], sketchingOnPart: true, sketchClosed: true }).cue).toBe("extrude");
    expect(lessonPrompt({ ...idle, shapes: [box()], extrudeOpen: true }).title).toBe("Cut the hole");

    const hole = sceneShape({
      name: "Hole",
      kind: "cylinder",
      color: "#d97813",
      hole: true,
      width: 8,
      depth: 8,
      height: 30,
      elevation: -5,
    });
    const holed = [box(), hole];
    expect(sceneHasThroughHole(holed)).toBe(true);
    const finished = lessonPrompt({ ...idle, shapes: holed });
    expect(finished.cue).toBe("done");
    expect(finished.complete).toBe(true);
    expect(finished.step).toBe(3);
    expect(finished.total).toBe(3);
    expect(finished.body).not.toMatch(/STL/);
  });

  it("does not treat a hole that stops inside the box as finished", () => {
    const short = sceneShape({
      name: "Hole",
      kind: "cylinder",
      color: "#d97813",
      hole: true,
      width: 8,
      depth: 8,
      height: 10,
    });
    expect(sceneHasThroughHole([box(), short])).toBe(false);
    expect(lessonPrompt({ ...idle, shapes: [box(), short] }).cue).toBe("sketch");
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
