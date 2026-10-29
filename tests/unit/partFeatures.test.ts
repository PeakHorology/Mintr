import { describe, expect, it } from "vitest";
import { projectShapesFingerprint, type EditorHistoryEntry } from "@/lib/editorHistory";
import { shapeWithEdgeTreatmentRecord } from "@/lib/editorEdgeTreatments";
import { slimGuideEntry } from "@/lib/guideLog";
import {
  failedEdgeTreatmentFeatures,
  fingerprintFromFrame,
  rebuildsOnResize,
  resizedFeatureBase,
  stepsFromSnapshots,
  hollowPartFeature,
  pushPullPartFeature,
  withoutEdgeTreatmentFeatures,
  withPartFeature,
} from "@/lib/partFeatures";
import { sceneShape } from "@/lib/shapeCatalog";
import { workplaneShapesEqual } from "@/lib/workplaneShapes";
import type { EdgeTreatmentFeature, WorkplaneShape } from "@/types/sketchforge";

function box(id: string, patch: Partial<WorkplaneShape> = {}) {
  return sceneShape({ name: id, kind: "box", color: "#d41721", width: 20, depth: 20, height: 20, ...patch, id });
}

const topEdgeFillet: EdgeTreatmentFeature = {
  kind: "fillet",
  amount: 2,
  edgeCount: 1,
  filletProfile: "cove",
  sharpAngle: 25,
  edgeFingerprints: [{ mid: [40, 30, -5], centroid: [40, 30, -5], length: 20, angle: 90, direction: [1, 0, 0] }],
};

describe("recorded part steps", () => {
  it("records a fillet as a step measured from the solid it went on, without a copy of the part", () => {
    const before = box("part", { x: 40, z: -5, elevation: 10 });
    const treated = { ...before, kind: "mesh" as const };
    // The solid's outline: a 20 mm cube whose bottom centre is (40, 10, -5).
    const solidEdges = [{ points: [30, 10, -15, 50, 30, 5] }];
    const recorded = shapeWithEdgeTreatmentRecord(treated, before, topEdgeFillet, false, 1, solidEdges);
    const step = recorded.features?.[0];
    expect(recorded.features).toHaveLength(1);
    // The step can be rebuilt from the base, so no copy of the part before it is kept.
    expect(recorded.edgeTreatmentHistory).toBeUndefined();
    expect(step).toMatchObject({ kind: "fillet", amount: 2, filletProfile: "cove", appliedAt: [40, 10, -5] });
    if (step?.kind !== "fillet" || step.edges.rule !== "picked") throw new Error("expected picked edges");
    expect(step.frame).toEqual({ origin: [40, 10, -5], size: [20, 20, 20] });
    expect(step.edges.fingerprints[0].centroid).toEqual([0, 20, 0]);
    expect(step.edges.fingerprints[0].mid).toEqual([0, 20, 0]);
    expect(step.edges.fingerprints[0].direction).toEqual([1, 0, 0]);
    // The world-space recipe guides compare is unchanged.
    expect(recorded.edgeTreatments?.[0]?.edgeFingerprints?.[0].centroid).toEqual([40, 30, -5]);
    // The first step keeps the part it started from, so the steps can be replayed on it.
    expect(recorded.featureBase).toMatchObject({ kind: "box", x: 40, width: 20 });
    expect(recorded.featureBase?.features).toBeUndefined();
  });

  it("places a stored edge back on a moved, resized solid", () => {
    const frame = { origin: [0, 0, 0] as [number, number, number], size: [20, 20, 20] as [number, number, number] };
    const print = { mid: [0, 20, 0] as [number, number, number], centroid: [0, 20, 0] as [number, number, number], length: 20, angle: 90 };
    const live = { origin: [100, 5, 0] as [number, number, number], size: [40, 30, 20] as [number, number, number] };
    const placed = fingerprintFromFrame(print, frame, live);
    expect(placed.centroid).toEqual([100, 35, 0]);
    expect(placed.length).toBeCloseTo(40);
  });

  it("records every-sharp-edge treatments by rule, not by edge", () => {
    const before = box("part");
    const recorded = shapeWithEdgeTreatmentRecord(
      before,
      before,
      { kind: "chamfer", amount: 1, edgeCount: 12, chamferAngle: 45, allEdges: true, sharpAngle: 30 },
      false,
      1,
    );
    expect(recorded.features?.[0]).toMatchObject({ kind: "chamfer", chamferAngle: 45, edges: { rule: "allSharp", sharpAngle: 30 } });
  });

  it("keeps earlier steps in order", () => {
    const first = shapeWithEdgeTreatmentRecord(box("part"), box("part"), topEdgeFillet, false, 1);
    const hollowed = withPartFeature(first, first, hollowPartFeature("h1", { thickness: 1.5, openings: ["top"], corners: "sharp", cornerRadius: 0 }, first));
    const side = { id: 3, origin: { x: 10, y: 10, z: 0 }, normal: { x: 1, y: 0, z: 0 }, points: [10, 0, -10, 10, 20, 10], area: 400 };
    const otherSide = { ...side, id: 4, origin: { x: -10, y: 10, z: 0 }, normal: { x: -1, y: 0, z: 0 }, points: [-10, 0, -10, -10, 20, 10] };
    const pushed = withPartFeature(hollowed, hollowed, pushPullPartFeature("p1", side, 4, [side, otherSide]));
    expect(pushed.features?.map((step) => step.kind)).toEqual(["fillet", "hollow", "pushPull"]);
    expect(pushed.features?.[2]).toMatchObject({ face: { origin: [10, 10, 0], normal: [1, 0, 0], area: 400 }, distance: 4 });
    // Later steps keep the base the first one stored.
    expect(pushed.featureBase).toBe(first.featureBase);
    expect(withoutEdgeTreatmentFeatures(pushed.features)?.map((step) => step.kind)).toEqual(["hollow", "pushPull"]);
  });

  it("marks steps whose edges were lost instead of dropping them", () => {
    const part = shapeWithEdgeTreatmentRecord(box("part"), box("part"), topEdgeFillet, false, 1);
    const failed = failedEdgeTreatmentFeatures(part, [0]);
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe(part.features?.[0]?.id);
    expect(failed[0]).toHaveProperty("failed");
    // A part saved before steps were recorded has nothing to mark.
    expect(failedEdgeTreatmentFeatures({ ...part, features: undefined }, [0])).toEqual([]);
  });

  it("counts a changed step list as a change for undo and for shape equality", () => {
    const part = shapeWithEdgeTreatmentRecord(box("part"), box("part"), topEdgeFillet, false, 1);
    const edited = { ...part, features: part.features?.map((step) => ({ ...step, amount: 3 })) };
    expect(projectShapesFingerprint([edited])).not.toBe(projectShapesFingerprint([part]));
    expect(workplaneShapesEqual(edited, part)).toBe(false);
  });

  it("leaves undo snapshots out of guide steps but keeps the recorded steps", () => {
    const part = shapeWithEdgeTreatmentRecord(box("part"), box("part"), topEdgeFillet, false, 1);
    expect(part.edgeTreatmentHistory?.[0]?.before).toBeTruthy();
    const entry: EditorHistoryEntry = { shapes: [part], selectedIds: [], fingerprint: "f", estimatedBytes: 1 };
    const slim = slimGuideEntry(entry).shapes[0];
    expect(slim.edgeTreatmentHistory).toBeUndefined();
    expect(slim.edgeTreatments).toEqual(part.edgeTreatments);
    expect(slim.features).toEqual(part.features);
  });

  it("keeps the copy for a step that could not be placed on its solid", () => {
    // No edges of the solid came back, so the picked edge has nothing to be measured from.
    const part = shapeWithEdgeTreatmentRecord(box("part"), box("part"), topEdgeFillet, false, 1);
    expect(part.edgeTreatmentHistory?.[0]?.id).toBe(part.features?.[0]?.id);
  });

  it("grows the base by as much as the part grew, so steps keep their sizes", () => {
    const base = resizedFeatureBase(box("b"), [20, 26, 20], [30, 32, 18]);
    expect([base.width, base.height, base.depth, base.size]).toEqual([30, 26, 18, 30]);
    const pulled = withPartFeature({ ...box("b"), kind: "mesh", height: 26 }, box("b"), pushPullPartFeature("p", {
      id: 1, origin: { x: 0, y: 20, z: 0 }, normal: { x: 0, y: 1, z: 0 }, area: 400, points: [-10, 20, -10, 10, 20, 10],
    }, 6, [{ id: 2, origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: -1, z: 0 }, area: 400, points: [-10, 0, -10, 10, 20, 10] }]));
    expect(rebuildsOnResize(pulled)).toBe(true);
    expect(rebuildsOnResize({ ...pulled, edgeResizeMode: "scale" })).toBe(false);
  });

  it("turns an older file's fillet copies into steps, and leaves turned parts alone", () => {
    const before = box("part", { x: 40, z: -5 });
    const old: WorkplaneShape = {
      ...before,
      kind: "mesh",
      edgeTreatments: [topEdgeFillet],
      edgeTreatmentHistory: [{ id: "e1", createdAt: 1, feature: topEdgeFillet, before }],
    };
    const converted = stepsFromSnapshots(old);
    expect(converted.edgeTreatmentHistory).toBeUndefined();
    expect(converted.featureBase).toMatchObject({ kind: "box", x: 40 });
    const step = converted.features?.[0];
    if (step?.kind !== "fillet" || step.edges.rule !== "picked") throw new Error("expected picked edges");
    expect(step.id).toBe("e1");
    expect(step.frame).toEqual({ origin: [40, 0, -5], size: [20, 20, 20] });
    expect(step.edges.fingerprints[0].centroid).toEqual([0, 30, 0]);
    // A copy that was turned is not boxed square, so the part keeps its copies as they were.
    const turned = { ...old, edgeTreatmentHistory: [{ id: "e1", createdAt: 1, feature: topEdgeFillet, before: { ...before, rotation: 30 } }] };
    expect(stepsFromSnapshots(turned)).toBe(turned);
    // Copies that do not match the part's fillets one to one are left alone too.
    const mismatched = { ...old, edgeTreatments: [] };
    expect(stepsFromSnapshots(mismatched)).toBe(mismatched);
  });
});
