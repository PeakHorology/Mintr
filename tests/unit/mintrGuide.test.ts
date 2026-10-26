import { describe, expect, it } from "vitest";
import { faceHoleCutDepthMm } from "@/lib/csgTree";
import type { EditorHistoryEntry } from "@/lib/editorHistory";
import { plateGuideSession, pocketGuideSession } from "@/lib/builtinGuides";
import {
  ghostFromProfile,
  guidePrompt,
  guideSketchTool,
  guideStartShapes,
  pocketMatches,
  proposeGuideSteps,
  sceneMatchesGuide,
  sketchTracesGhost,
} from "@/lib/mintrGuide";
import { buildPeakcadDocument, parsePeakcadDocument, serializeMintrGuide } from "@/lib/peakcadDocument";
import { sceneShape } from "@/lib/shapeCatalog";
import type { SketchProfile, WorkplaneShape } from "@/types/sketchforge";

function box(id: string, patch: Partial<WorkplaneShape> = {}) {
  return sceneShape({ name: id, kind: "box", color: "#d41721", width: 20, depth: 20, height: 20, ...patch, id });
}

function entry(shapes: WorkplaneShape[], label?: string): EditorHistoryEntry {
  return {
    shapes,
    selectedIds: [],
    fingerprint: label ?? `${shapes.length}:${shapes.map((shape) => shape.id).join(",")}`,
    estimatedBytes: 1,
    label,
  };
}

const square: SketchProfile = {
  points: [
    { id: "a", x: 0, z: 0 },
    { id: "b", x: 10, z: 0 },
    { id: "c", x: 10, z: 10 },
    { id: "d", x: 0, z: 10 },
  ],
  segments: [
    { id: "s1", startId: "a", endId: "b" },
    { id: "s2", startId: "b", endId: "c" },
    { id: "s3", startId: "c", endId: "d" },
    { id: "s4", startId: "d", endId: "a" },
  ],
};

describe("mintr guide", () => {
  it("ignores steps that were undone and never redone", () => {
    const history = [
      entry([], "Start"),
      entry([box("a")], "Box added"),
      entry([box("a"), box("b", { x: 40 })], "Box added"),
      entry([box("a"), box("b", { x: 40 }), box("c", { x: 80 })], "Box added"),
    ];
    const steps = proposeGuideSteps(history, 1);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ historyIndex: 1, included: true, cue: "box" });
    expect(guideStartShapes(history, steps)).toEqual([]);
  });

  it("leaves a color change unchecked and keeps a new solid", () => {
    const first = box("a");
    const recolored = box("a", { color: "#111111", name: "Renamed" });
    const history = [
      entry([], "Start"),
      entry([first], "Box added"),
      entry([recolored], "Color"),
    ];
    const steps = proposeGuideSteps(history, 2);
    expect(steps[0].included).toBe(true);
    expect(steps[1]).toMatchObject({ included: false, label: "Color" });
    expect(sceneMatchesGuide([box("other-id")], [recolored])).toBe(true);
  });

  it("turns a new sketch into a traceable outline", () => {
    const host = box("a");
    const sketched = box("a", { sketchProfile: square, width: 30 });
    const history = [entry([host], "Box added"), entry([sketched], "Sketch feature consumed the host solid")];
    const steps = proposeGuideSteps(history, 1);
    expect(steps[0]).toMatchObject({ cue: "sketch", included: true, label: "Sketch on the part" });
    const ghost = ghostFromProfile(square);
    expect(guideSketchTool(ghost)).toBe("rectangle");
    expect(sketchTracesGhost([{ x: 0.4, z: 0.2 }, { x: 10, z: 0 }, { x: 9.8, z: 10 }, { x: 0, z: 10.2 }], ghost)).toBe(true);
    expect(sketchTracesGhost([{ x: 0, z: 0 }], ghost)).toBe(false);
  });

  it("highlights the next control and finishes when the model matches", () => {
    const history = [entry([], "Start"), entry([box("a")], "Box added")];
    const guide = {
      title: "A block",
      author: "Ada",
      summary: "A guide by Ada.",
      steps: proposeGuideSteps(history, 1),
    };
    const waiting = guidePrompt({
      guide,
      history,
      shapes: [],
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    });
    expect(waiting).toMatchObject({
      cue: "box",
      complete: false,
      step: 1,
      total: 1,
      body: "Click Box. Set Length to 20 mm, Width to 20 mm, and Height to 20 mm.",
    });
    const done = guidePrompt({
      guide,
      history,
      shapes: [box("learner")],
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    });
    expect(done?.complete).toBe(true);
  });

  it("carries later size edits into the shape that was just added", () => {
    const dropped = sceneShape({ name: "c", kind: "cylinder", color: "#d97813", width: 20, depth: 20, height: 20, x: 2, z: 1, id: "c" });
    const longer = sceneShape({ ...dropped, depth: 60, size: 60 });
    const wider = sceneShape({ ...longer, width: 60 });
    const finished = sceneShape({ ...wider, height: 10 });
    const history = [
      entry([], "Start"),
      entry([dropped], "Cylinder added"),
      entry([longer], "Length"),
      entry([wider], "Width"),
      entry([finished], "Height"),
    ];
    const guide = {
      title: "A cylinder",
      author: "Jeremy Flynn",
      summary: "A guide by Jeremy Flynn.",
      steps: proposeGuideSteps(history, 4),
    };
    const idle = {
      guide,
      history,
      shapes: [] as WorkplaneShape[],
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    };
    expect(guidePrompt(idle)).toMatchObject({
      step: 1,
      total: 1,
      complete: false,
      body: "Click Cylinder. Set Length to 60 mm, Width to 60 mm, and Height to 10 mm.",
    });
    const placed = guidePrompt({
      ...idle,
      shapes: [sceneShape({ ...finished, id: "learner", x: 40, z: -12 })],
    });
    expect(placed?.complete).toBe(true);
    const stillDefault = guidePrompt({
      ...idle,
      shapes: [sceneShape({ ...dropped, id: "learner", x: 0, z: 0 })],
    });
    expect(stillDefault?.complete).toBe(false);
    expect(stillDefault?.step).toBe(1);
  });

  it("folds a hole and its later size into the cylinder that was added", () => {
    const host = sceneShape({ name: "host", kind: "cylinder", color: "#d97813", width: 60, depth: 60, height: 10, id: "host" });
    const dropped = sceneShape({ name: "cut", kind: "cylinder", color: "#d97813", width: 20, depth: 20, height: 20, x: 57, z: -36, id: "cut" });
    const hole = sceneShape({ ...dropped, hole: true });
    const finished = sceneShape({ ...hole, width: 30, depth: 30, height: 5, size: 30 });
    const history = [
      entry([host], "Start"),
      entry([host, dropped], "Cylinder added"),
      entry([host, hole], "Changed to hole"),
      entry([host, finished], "Height"),
    ];
    const guide = {
      title: "A hole",
      author: "Jeremy Flynn",
      summary: "A guide by Jeremy Flynn.",
      steps: proposeGuideSteps(history, 3),
    };
    const idle = {
      guide,
      history,
      shapes: [sceneShape({ ...host, id: "learner-host" })],
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    };
    expect(guidePrompt(idle)).toMatchObject({
      step: 1,
      total: 1,
      body: "Click Cylinder. Set Length to 30 mm, Width to 30 mm, and Height to 5 mm.",
    });
    const sized = guidePrompt({
      ...idle,
      shapes: [
        sceneShape({ ...host, id: "learner-host" }),
        sceneShape({ ...finished, hole: false, id: "learner-solid", x: 4, z: 8 }),
      ],
    });
    expect(sized).toMatchObject({ cue: "hole", body: "Click Hole." });
    const placed = guidePrompt({
      ...idle,
      shapes: [
        sceneShape({ ...host, id: "learner-host", x: 12 }),
        sceneShape({ ...finished, id: "learner-hole", x: 0, z: 0 }),
      ],
    });
    expect(placed?.complete).toBe(true);
  });

  it("writes the sketch size and the extrude depth, including a through cut", () => {
    const host = box("host");
    const hole = box("hole", {
      hole: true,
      height: faceHoleCutDepthMm(20),
      sketchProfile: {
        ...square,
        faceReferenceLoops: [[{ x: -8, z: -8 }, { x: 8, z: -8 }, { x: 8, z: 8 }, { x: -8, z: 8 }]],
        sketchPlane: {
          origin: { x: 0, y: 20, z: 0 },
          normal: { x: 0, y: 1, z: 0 },
          uAxis: { x: 1, y: 0, z: 0 },
          hostShapeId: "host",
        },
      },
    });
    const history = [entry([host], "Box added"), entry([hole], "Sketch hole cut into Box")];
    const guide = {
      title: "A pocket",
      author: "Ada",
      summary: "A guide by Ada.",
      steps: proposeGuideSteps(history, 1),
    };
    const drawing = guidePrompt({
      guide,
      history,
      shapes: [host],
      sketchMode: false,
      pickingFace: false,
      sketching: true,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    });
    expect(drawing?.body).toBe("Draw a rectangle 10 mm by 10 mm. Trace the mint outline.");
    const cutting = guidePrompt({
      guide,
      history,
      shapes: [host],
      sketchMode: false,
      pickingFace: false,
      sketching: true,
      sketchingOffPart: false,
      sketchClosed: true,
      extrudeOpen: true,
      sketchPoints: square.points,
    });
    expect(cutting?.body).toBe("Type 20 mm, then click Cut into part.");
  });

  it("writes a changed height into the prompt", () => {
    const history = [
      entry([box("a")], "Box added"),
      entry([box("a", { height: 30 })], "Height"),
    ];
    const guide = {
      title: "Taller",
      author: "Ada",
      summary: "A guide by Ada.",
      steps: proposeGuideSteps(history, 1),
    };
    const prompt = guidePrompt({
      guide,
      history,
      shapes: [box("a")],
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    });
    expect(prompt?.body).toBe("Set Height to 30 mm.");
  });

  it("round-trips the guide chapter without raising the file version", () => {
    const history = [entry([], "Start"), entry([box("a")], "Box added")];
    const text = serializeMintrGuide(buildPeakcadDocument({
      project: {
        id: "project-1",
        name: "A block",
        createdAt: 1,
        updatedAt: 1,
        accent: "cyan",
        shapes: 1,
      },
      shapes: [box("a")],
      history,
      historyIndex: 1,
      guide: {
        title: "A block",
        author: "Ada",
        summary: "A guide by Ada.",
        steps: proposeGuideSteps(history, 1),
      },
    }));
    const parsed = parsePeakcadDocument(text);
    expect(parsed.version).toBe(1);
    expect(parsed.format).toBe("peakcad");
    expect(parsed.guide).toMatchObject({ title: "A block", author: "Ada" });
    expect(parsed.guide?.steps[0].cue).toBe("box");
  });

  it("teaches the plate sketch, then waits for a 1 mm chamfer", () => {
    const session = plateGuideSession();
    const idle = {
      guide: session.guide,
      history: session.history,
      shapes: [] as WorkplaneShape[],
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    };
    expect(guidePrompt(idle)?.body).toBe("Click Sketch.");
    const plate = session.history[1].shapes;
    expect(sceneMatchesGuide(plate, session.history[2].shapes)).toBe(false);
    const partial = plate.map((shape) => ({
      ...shape,
      edgeTreatments: [{ kind: "chamfer" as const, amount: 1, edgeCount: 4, chamferAngle: 45 }],
    }));
    expect(sceneMatchesGuide(partial, session.history[2].shapes)).toBe(false);
    expect(guidePrompt({ ...idle, shapes: plate })?.body).toBe("Click Chamfer.");
    expect(guidePrompt({ ...idle, shapes: plate, edgeKind: "chamfer", edgeAmount: 0.6 })?.body).toBe("Set the distance to 1 mm.");
    expect(guidePrompt({ ...idle, shapes: plate, edgeKind: "chamfer", edgeAmount: 1 })?.body).toBe("Click All sharp edges.");
    expect(guidePrompt({ ...idle, shapes: plate, edgeKind: "chamfer", edgeAmount: 1, allEdgesSelected: true })?.body).toBe("Click Apply.");
    expect(guidePrompt({ ...idle, shapes: plate, edgeKind: "fillet", edgeAmount: 1, allEdgesSelected: true })?.body).toBe("Click Chamfer.");
    expect(guidePrompt({ ...idle, shapes: partial })?.body).toBe("Click Chamfer.");
    const applied = {
      ...session.history[2].shapes[0],
      kind: "mesh" as const,
      edgeTreatments: [{ kind: "chamfer" as const, amount: 1, edgeCount: 24, chamferAngle: 45, allEdges: true }],
    };
    expect(guidePrompt({ ...idle, shapes: [applied] })?.title).toBe("Tutorial complete");
    expect(guidePrompt({ ...idle, shapes: session.history[2].shapes })?.title).toBe("Tutorial complete");
    expect(proposeGuideSteps(session.history, 2).map((step) => step.cue)).toEqual(["sketch", "chamfer"]);
  });

  it("sets a fillet radius before all sharp edges, in any guide", () => {
    const session = plateGuideSession();
    const host = session.history[1].shapes[0];
    const filleted = {
      ...host,
      edgeTreatments: [{ kind: "fillet" as const, amount: 2, edgeCount: 12, allEdges: true }],
    };
    const input = {
      guide: {
        ...session.guide,
        steps: [{ historyIndex: 1, label: "Round the edges", included: true, cue: "fillet" }],
      },
      history: [session.history[0], { ...session.history[1], shapes: [filleted] }],
      shapes: [host],
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    };
    expect(guidePrompt(input)?.body).toBe("Click Fillet.");
    expect(guidePrompt({ ...input, edgeKind: "fillet", edgeAmount: 1 })?.body).toBe("Set the radius to 2 mm.");
    expect(guidePrompt({ ...input, edgeKind: "fillet", edgeAmount: 2 })?.body).toBe("Click All sharp edges.");
    expect(guidePrompt({ ...input, edgeKind: "fillet", edgeAmount: 2, allEdgesSelected: true })?.body).toBe("Click Apply.");
    expect(guidePrompt({ ...input, shapes: [filleted] })?.title).toBe("Tutorial complete");
  });

  it("asks for only the chamfered edges when the guide did not chamfer all of them", () => {
    const session = plateGuideSession();
    const host = session.history[1].shapes[0];
    const partial = {
      ...host,
      edgeTreatments: [{ kind: "chamfer" as const, amount: 1, edgeCount: 4, chamferAngle: 45 }],
    };
    const all = {
      ...host,
      edgeTreatments: [{ kind: "chamfer" as const, amount: 1, edgeCount: 12, chamferAngle: 45, allEdges: true }],
    };
    const input = {
      guide: session.guide,
      history: [session.history[0], session.history[1], { ...session.history[2], shapes: [partial] }],
      shapes: [host],
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    };
    expect(guidePrompt({ ...input, edgeKind: "chamfer", edgeAmount: 1 })?.body).toBe("Select 4 edges. Leave the others sharp.");
    expect(guidePrompt({ ...input, edgeKind: "chamfer", edgeAmount: 1, allEdgesSelected: true, edgeSelectedCount: 12 })?.body).toBe("Select 4 edges. Leave the others sharp.");
    expect(guidePrompt({ ...input, edgeKind: "chamfer", edgeAmount: 1, edgeSelectedCount: 4 })?.body).toBe("Click Apply.");
    expect(guidePrompt({ ...input, shapes: [all] })?.body).toBe("Click Chamfer.");
    expect(guidePrompt({ ...input, shapes: [partial] })?.title).toBe("Tutorial complete");
  });

  it("teaches the box, then Pad/Pocket, and finishes when the pocket is the right size", () => {
    const session = pocketGuideSession();
    const box = session.history[1].shapes;
    const idle = {
      guide: session.guide,
      history: session.history,
      shapes: [] as WorkplaneShape[],
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    };
    expect(guidePrompt(idle)?.body).toBe("Click Box. Set Length to 40 mm, Width to 30 mm, and Height to 20 mm.");
    expect(guidePrompt({ ...idle, shapes: box })?.body).toBe("Click Pad/Pocket.");
    expect(guidePrompt({ ...idle, shapes: box, faceTool: true, faceChosen: true, faceDirection: "in" })?.body).toBe(
      "Set Inset to 4 mm and Depth to 6 mm. Then click Create.",
    );
    const pocket = sceneShape({
      id: "pocket",
      name: "Pocket",
      kind: "box",
      color: "#d41721",
      hole: true,
      width: 22,
      depth: 32,
      height: 6,
    });
    expect(pocketMatches([pocket], { width: 22, depth: 32, height: 6 })).toBe(true);
    expect(guidePrompt({ ...idle, shapes: [box[0], pocket] })?.complete).toBe(true);
  });

  it("finishes a sketch plate that was drawn somewhere else on the grid", () => {
    const session = plateGuideSession();
    const plate = session.history[1].shapes[0];
    const idle = {
      guide: session.guide,
      history: session.history,
      shapes: [{ ...plate, x: 80, z: -30 }],
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    };
    expect(guidePrompt(idle)?.body).toBe("Click Chamfer.");
  });

  it("accepts Align and Group away from the recorded spot, and a chamfer does not skip them", () => {
    const host = sceneShape({ name: "host", kind: "cylinder", color: "#d97813", width: 60, depth: 60, height: 10, x: 2, z: 1, id: "host" });
    const hole = sceneShape({ name: "cut", kind: "cylinder", color: "#d97813", width: 30, depth: 30, height: 5, hole: true, x: 57, z: -36, id: "cut" });
    const centered = [
      sceneShape({ ...host, x: 22 }),
      sceneShape({ ...hole, x: 22 }),
    ];
    const grouped = sceneShape({
      name: "Group",
      kind: "mesh",
      color: "#d97813",
      width: 60,
      depth: 60,
      height: 10,
      x: 22,
      z: -10,
      id: "group",
      groupedShapes: centered,
    });
    const chamfered = {
      ...grouped,
      edgeTreatments: [{ kind: "chamfer" as const, amount: 1, edgeCount: 2, chamferAngle: 45 }],
    };
    const history = [
      entry([host, hole], "Parts"),
      entry(centered, "Aligned 2 shapes center"),
      entry([grouped], "Grouped 2 shapes"),
      entry([chamfered], "Chamfered 2 edges"),
    ];
    const guide = {
      title: "Join",
      author: "Jeremy Flynn",
      summary: "A guide by Jeremy Flynn.",
      steps: proposeGuideSteps(history, 3),
    };
    const base = {
      guide,
      history,
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    };
    const apart = [
      sceneShape({ ...host, id: "a", x: 0, z: 0 }),
      sceneShape({ ...hole, id: "b", x: 40, z: 10 }),
    ];
    expect(guidePrompt({ ...base, shapes: apart })?.body).toBe("Select the parts, then click Align.");
    expect(guidePrompt({ ...base, shapes: apart, alignMode: true })?.body).toBe("Click Center.");
    const aligned = [
      sceneShape({ ...host, id: "a", x: 5, z: 0 }),
      sceneShape({ ...hole, id: "b", x: 5, z: 10 }),
    ];
    expect(guidePrompt({ ...base, shapes: aligned })?.body).toBe("Select the parts, then click Group.");
    const elsewhere = sceneShape({
      ...grouped,
      id: "learner-group",
      x: 80,
      z: 15,
      groupedShapes: aligned,
    });
    expect(guidePrompt({ ...base, shapes: [elsewhere] })?.body).toBe("Click Chamfer.");
    const earlyChamfer = {
      ...apart[0],
      edgeTreatments: [{ kind: "chamfer" as const, amount: 1, edgeCount: 2 }],
    };
    expect(guidePrompt({ ...base, shapes: [earlyChamfer, apart[1]] })?.body).toBe("Select the parts, then click Align.");
  });

  it("reads a recorded pocket as Pad/Pocket with the inset and depth from the hole", () => {
    const host = box("host", { width: 30, depth: 40, height: 20 });
    const cutter = box("pocket", { hole: true, width: 22, depth: 32, height: 6 });
    const grouped = sceneShape({
      ...host,
      id: "body",
      kind: "mesh",
      groupedShapes: [host, cutter],
    });
    const history = [
      entry([host], "Box added"),
      entry([grouped], "Pocket grouped into the body"),
    ];
    const guide = {
      title: "Pocket",
      author: "Ada",
      summary: "A guide by Ada.",
      steps: proposeGuideSteps(history, 1),
    };
    expect(guide.steps[0]).toMatchObject({ cue: "pad/pocket", insetMm: 4, depthMm: 6 });
    const savedAsGroup = {
      ...guide,
      steps: [{ ...guide.steps[0], cue: "group", insetMm: undefined, depthMm: undefined }],
    };
    const idle = {
      guide: savedAsGroup,
      history,
      shapes: [host],
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    };
    expect(guidePrompt(idle)?.body).toBe("Click Pad/Pocket.");
    expect(guidePrompt({ ...idle, shapes: [host, cutter] })?.complete).toBe(true);
  });

  it("does not accept a partial chamfer on different edges", () => {
    const host = box("a");
    const right = {
      ...host,
      edgeTreatments: [{
        kind: "chamfer" as const,
        amount: 1,
        edgeCount: 1,
        edgeFingerprints: [{ mid: [10, 10, 0] as [number, number, number], centroid: [10, 10, 0] as [number, number, number], length: 20, angle: 90, direction: [0, 1, 0] as [number, number, number] }],
      }],
    };
    const wrong = {
      ...host,
      x: 30,
      edgeTreatments: [{
        kind: "chamfer" as const,
        amount: 1,
        edgeCount: 1,
        edgeFingerprints: [{ mid: [30, 0, 10] as [number, number, number], centroid: [30, 0, 10] as [number, number, number], length: 20, angle: 90, direction: [0, 0, 1] as [number, number, number] }],
      }],
    };
    const shifted = {
      ...wrong,
      edgeTreatments: [{
        kind: "chamfer" as const,
        amount: 1,
        edgeCount: 1,
        edgeFingerprints: [{ mid: [40, 10, 0] as [number, number, number], centroid: [40, 10, 0] as [number, number, number], length: 20, angle: 90, direction: [0, 1, 0] as [number, number, number] }],
      }],
    };
    const history = [entry([host], "Box"), entry([right], "Chamfered 1 edge")];
    const guide = {
      title: "Edge",
      author: "Ada",
      summary: "A guide by Ada.",
      steps: proposeGuideSteps(history, 1),
    };
    const input = {
      guide,
      history,
      shapes: [host],
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    };
    expect(guidePrompt({ ...input, shapes: [wrong] })?.title).not.toBe("Tutorial complete");
    expect(guidePrompt({ ...input, shapes: [shifted] })?.title).toBe("Tutorial complete");
    expect(guidePrompt({
      ...input,
      edgeKind: "chamfer",
      edgeAmount: 1,
      edgeSelectedCount: 1,
      edgeFingerprints: [{ mid: [0, 0, 10], centroid: [0, 0, 10], length: 20, angle: 90, direction: [0, 0, 1] }],
    })?.body).toBe("Select 1 edge. Leave the others sharp.");
  });

  it("accepts a taller box away from the recorded spot", () => {
    const history = [
      entry([box("a", { x: 4 })], "Box"),
      entry([box("a", { x: 4, height: 30 })], "Height"),
    ];
    const guide = {
      title: "Taller",
      author: "Ada",
      summary: "A guide by Ada.",
      steps: proposeGuideSteps(history, 1),
    };
    const prompt = guidePrompt({
      guide,
      history,
      shapes: [box("learner", { x: 90, height: 30 })],
      sketchMode: false,
      pickingFace: false,
      sketching: false,
      sketchingOffPart: false,
      sketchClosed: false,
      extrudeOpen: false,
      sketchPoints: [],
    });
    expect(prompt?.complete).toBe(true);
  });
});
