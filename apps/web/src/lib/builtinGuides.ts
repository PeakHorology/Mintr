import type { EditorHistoryEntry } from "@/lib/editorHistory";
import type { GuideSession } from "@/lib/mintrGuide";
import { shapeFromSketchProfile } from "@/lib/sketchProfileShape";
import { defaultSketchPlane } from "@/lib/sketchPlane";
import { sceneShape } from "@/lib/shapeCatalog";
import type { SketchProfile, WorkplaneShape } from "@/types/sketchforge";

export const PLATE_GUIDE_ID = "guide:mintr-plate";
export const POCKET_GUIDE_ID = "guide:mintr-pocket";

const PLATE_PROFILE: SketchProfile = {
  points: [
    { id: "a", x: -30, z: -20 },
    { id: "b", x: 30, z: -20 },
    { id: "c", x: 30, z: 20 },
    { id: "d", x: -30, z: 20 },
  ],
  segments: [
    { id: "s1", startId: "a", endId: "b" },
    { id: "s2", startId: "b", endId: "c" },
    { id: "s3", startId: "c", endId: "d" },
    { id: "s4", startId: "d", endId: "a" },
  ],
  sketchPlane: defaultSketchPlane(),
};

function historyEntry(shapes: WorkplaneShape[], label: string): EditorHistoryEntry {
  return {
    shapes,
    selectedIds: shapes.map((shape) => shape.id),
    fingerprint: label,
    estimatedBytes: 1,
    label,
  };
}

function plateShape(): WorkplaneShape {
  const built = shapeFromSketchProfile(PLATE_PROFILE, 4);
  if (!built) throw new Error("The plate guide could not build its rectangle.");
  return { ...built, id: "mintr-plate", name: "Plate" };
}

export function plateGuideSession(): GuideSession {
  const plate = plateShape();
  const chamfered: WorkplaneShape = {
    ...plate,
    edgeTreatments: [{ kind: "chamfer", amount: 1, edgeCount: 12, chamferAngle: 45, allEdges: true }],
  };
  return {
    id: PLATE_GUIDE_ID,
    guide: {
      title: "A plate from a sketch",
      author: "Mintr",
      summary: "Draw a rectangle on the workplane, extrude it, then chamfer every edge.",
      steps: [
        { historyIndex: 1, label: "Sketch the plate", included: true, cue: "sketch" },
        { historyIndex: 2, label: "Chamfer every edge", included: true, cue: "chamfer" },
      ],
    },
    history: [
      historyEntry([], "Start"),
      historyEntry([plate], "Sketch extrusion"),
      historyEntry([chamfered], "Chamfer"),
    ],
  };
}

export function pocketGuideSession(): GuideSession {
  const box = sceneShape({
    id: "mintr-pocket-box",
    name: "Box",
    kind: "box",
    color: "#d41721",
    x: 0,
    z: 0,
    elevation: 0,
    width: 30,
    depth: 40,
    height: 20,
  });
  return {
    id: POCKET_GUIDE_ID,
    guide: {
      title: "A pocket in a block",
      author: "Mintr",
      summary: "Place a box, then cut a pocket into the top with Pad/Pocket.",
      steps: [
        { historyIndex: 1, label: "Add a box", included: true, cue: "box" },
        { historyIndex: 2, label: "Cut a pocket", included: true, cue: "pad/pocket", insetMm: 4, depthMm: 6 },
      ],
    },
    history: [
      historyEntry([], "Start"),
      historyEntry([box], "Box added"),
      historyEntry([box], "Pocket"),
    ],
  };
}

export function builtinGuideSession(id: string): GuideSession | null {
  if (id === PLATE_GUIDE_ID) return plateGuideSession();
  if (id === POCKET_GUIDE_ID) return pocketGuideSession();
  return null;
}
