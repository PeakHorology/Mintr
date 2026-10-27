import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeShapeFromAsset, sceneShape, toolbarShapeAssets } from "@/lib/shapeCatalog";
import { composeSketchProfile, rectangleSketchGeometry } from "@/lib/sketchDrawShapes";
import { shapeFromSketchProfile } from "@/lib/sketchProfileShape";
import { defaultSketchPlane } from "@/lib/sketchPlane";
import { createThreadShape, DEFAULT_THREAD_DESIGNATION } from "@/lib/threadShape";
import { buildPeakcadDocument, parsePeakcadDocument } from "@/lib/peakcadDocument";
import { guidePrompt, type GuideStep } from "@/lib/mintrGuide";
import type { EditorHistoryEntry } from "@/lib/editorHistory";
import type { WorkplaneShape } from "@/types/sketchforge";

const GUIDE_PATH = path.join(
  process.env.USERPROFILE ?? "",
  "OneDrive",
  "Documents",
  "Mintr",
  "Every tool.mintrguide",
);

function snap(shapes: WorkplaneShape[]): WorkplaneShape[] {
  return JSON.parse(JSON.stringify(shapes)) as WorkplaneShape[];
}

function promptFor(history: EditorHistoryEntry[], steps: GuideStep[], shapes: WorkplaneShape[]) {
  return guidePrompt({
    guide: {
      title: "Every tool",
      author: "Mintr",
      summary: "Walk the tools.",
      steps,
    },
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

describe("every-tool guide", () => {
  it("walks each solid tool, then writes a guide file that opens", () => {
    const history: EditorHistoryEntry[] = [];
    const steps: GuideStep[] = [];
    const live: WorkplaneShape[] = [];
    const commit = (label: string, step?: Omit<GuideStep, "historyIndex">) => {
      history.push({
        shapes: snap(live),
        selectedIds: live.map((shape) => shape.id),
        fingerprint: label,
        estimatedBytes: 1,
        label,
      });
      if (step) steps.push({ historyIndex: history.length - 1, ...step });
    };

    commit("Start");
    const boxAsset = toolbarShapeAssets.find((asset) => asset.kind === "box");
    const cylinderAsset = toolbarShapeAssets.find((asset) => asset.kind === "cylinder");
    if (!boxAsset || !cylinderAsset) throw new Error("Box and cylinder are missing from the shape list.");
    const box = makeShapeFromAsset(boxAsset);
    box.id = "guide-box";
    box.depth = 40;
    box.width = 30;
    box.height = 16;
    box.size = 40;
    live.push(box);
    commit("Box added", { label: "Add a box", included: true, cue: "box" });

    for (const asset of toolbarShapeAssets) {
      if (asset.kind === "box" || asset.kind === "cylinder") continue;
      if (asset.kind === "thread") {
        live.push(createThreadShape({
          designation: DEFAULT_THREAD_DESIGNATION,
          point: { x: 0, z: 0 },
          base: { id: "guide-thread", name: `Threads ${DEFAULT_THREAD_DESIGNATION}`, color: asset.color },
        }));
      } else {
        const shape = makeShapeFromAsset(asset);
        shape.id = `guide-${asset.id}`;
        live.push(shape);
      }
      commit(`${asset.name} added`, { label: `Add a ${asset.name.toLowerCase()}`, included: true, cue: asset.kind });
    }

    const cylinder = makeShapeFromAsset(cylinderAsset);
    cylinder.id = "guide-cylinder";
    cylinder.hole = true;
    live.push(cylinder);
    commit("Cylinder hole", { label: "Add a cylinder", included: true, cue: "cylinder" });

    const rectangle = rectangleSketchGeometry({ x: -30, z: -20 }, { x: 30, z: 20 });
    if (!rectangle) throw new Error("The guide rectangle did not build.");
    const profile = { ...composeSketchProfile([rectangle]), sketchPlane: defaultSketchPlane() };
    const extruded = shapeFromSketchProfile(profile, 8);
    if (!extruded) throw new Error("The guide sketch did not extrude.");
    live.push({ ...extruded, id: "guide-sketch", name: "Plate" });
    commit("Sketch extrusion", { label: "Sketch the plate", included: true, cue: "sketch" });

    box.edgeTreatments = [{ kind: "fillet", amount: 1, edgeCount: 12, chamferAngle: 45, allEdges: true }];
    commit("Fillet", { label: "Round the edges", included: true, cue: "fillet" });

    const roof = live.find((shape) => shape.kind === "roof");
    if (!roof) throw new Error("Triangle did not join the scene.");
    roof.edgeTreatments = [{ kind: "chamfer", amount: 1, edgeCount: 8, chamferAngle: 45, allEdges: true }];
    commit("Chamfer", { label: "Chamfer the edges", included: true, cue: "chamfer" });

    live.push(sceneShape({
      id: "guide-pocket",
      name: "Pocket",
      kind: "box",
      color: "#888888",
      hole: true,
      x: 0,
      z: 0,
      width: 22,
      depth: 32,
      height: 6,
    }));
    commit("Pocket", { label: "Cut a pocket", included: true, cue: "pad/pocket", insetMm: 4, depthMm: 6 });

    box.rotation = 90;
    commit("Turn the box", { label: "Turn the box", included: true, cue: "model" });

    let shapes = history[0].shapes;
    for (const step of steps) {
      const before = promptFor(history, steps, shapes);
      expect(before?.complete).toBe(false);
      expect(before?.title.length).toBeGreaterThan(0);
      shapes = history[step.historyIndex].shapes;
      const after = promptFor(history, steps, shapes);
      const advanced = Boolean(after?.complete) || (after?.step ?? 0) > (before?.step ?? 0);
      expect(advanced, `${before?.step} ${before?.title} -> ${after?.step} ${after?.title}`).toBe(true);
    }
    expect(promptFor(history, steps, shapes)?.complete).toBe(true);

    const document = buildPeakcadDocument({
      project: {
        id: "guide-every-tool",
        name: "Every tool",
        createdAt: 0,
        updatedAt: 0,
        accent: "gold",
        shapes: history[history.length - 1].shapes.length,
      },
      shapes: history[0].shapes,
      history,
      historyIndex: 0,
      savedAt: 0,
      guide: {
        title: "Every tool",
        author: "Mintr",
        summary: "Click each shape, draw the plate, then size, turn, align, make the cylinder a hole, fillet, chamfer, and cut a pocket. On the sketch step, try the other drawing tools and Undo back to the rectangle before Extrude.",
        steps,
      },
    });
    mkdirSync(path.dirname(GUIDE_PATH), { recursive: true });
    writeFileSync(GUIDE_PATH, `${JSON.stringify(document)}\n`);
    const opened = parsePeakcadDocument(JSON.stringify(document));
    expect(opened.guide?.steps).toHaveLength(steps.length);
    expect(opened.history?.length).toBe(history.length);
  });
});
