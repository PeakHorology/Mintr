import { describe, expect, it } from "vitest";
import {
  expandSketchHoleCuttersIfPossible,
  rebuildSketchHoleCutterIfPossible,
  SKETCH_HOLE_BATCH_NOTICE,
  sketchHoleBatchNotice,
} from "@/lib/editorBoolean";
import type { SketchPoint, SketchProfile, WorkplaneShape } from "@/types/sketchforge";

function circle(id: string, cx: number, cz: number, r: number): Pick<SketchProfile, "points" | "segments"> {
  const k = (4 / 3) * Math.tan(Math.PI / 8) * r;
  const points: SketchPoint[] = [
    { id: `${id}1`, x: cx + r, z: cz, mode: "smooth", handleIn: { x: cx + r, z: cz - k }, handleOut: { x: cx + r, z: cz + k } },
    { id: `${id}2`, x: cx, z: cz + r, mode: "smooth", handleIn: { x: cx + k, z: cz + r }, handleOut: { x: cx - k, z: cz + r } },
    { id: `${id}3`, x: cx - r, z: cz, mode: "smooth", handleIn: { x: cx - r, z: cz + k }, handleOut: { x: cx - r, z: cz - k } },
    { id: `${id}4`, x: cx, z: cz - r, mode: "smooth", handleIn: { x: cx - k, z: cz - r }, handleOut: { x: cx + k, z: cz - r } },
  ];
  const ids = points.map((point) => point.id);
  return {
    points,
    segments: ids.map((startId, index) => ({
      id: `${id}s${index}`,
      startId,
      endId: ids[(index + 1) % ids.length],
      kind: "bezier" as const,
    })),
  };
}

function holeShape(profile: SketchProfile, extra: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "holes",
    name: "Holes",
    kind: "mesh",
    color: "#d41721",
    x: 0,
    z: 0,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
    hole: true,
    sketchProfile: profile,
    ...extra,
  };
}

describe("expandSketchHoleCuttersIfPossible", () => {
  it("splits two separate sketch circles into exact cylinder cutters", () => {
    const a = circle("a", -8, 0, 3);
    const b = circle("b", 8, 0, 3);
    const expanded = expandSketchHoleCuttersIfPossible(holeShape({
      points: [...a.points, ...b.points],
      segments: [...a.segments, ...b.segments],
    }));
    expect(expanded).toHaveLength(2);
    expect(expanded.every((shape) => shape.hole && shape.kind === "cylinder")).toBe(true);
    expect(sketchHoleBatchNotice([holeShape({
      points: [...a.points, ...b.points],
      segments: [...a.segments, ...b.segments],
    })])).toBeUndefined();
  });

  it("keeps a face-hosted circle as a mesh so Group can bake exact B-Rep in place", () => {
    const a = circle("a", 0, 0, 3);
    const faceHole = holeShape(
      { points: a.points, segments: a.segments },
      {
        sketchPlane: {
          origin: { x: 0, y: 10, z: 0 },
          normal: { x: 0, y: 1, z: 0 },
          uAxis: { x: 1, y: 0, z: 0 },
          hostShapeId: "box-1",
        },
      },
    );
    const rebuilt = rebuildSketchHoleCutterIfPossible(faceHole);
    expect(rebuilt.kind).toBe("mesh");
    expect(rebuilt.hole).toBe(true);
  });

  it("keeps an exact face pocket as it is instead of re-baking it as a through hole", () => {
    // A Face pocket is a blind rectangle on a face with its exact solid attached.
    // Re-baking it with cutIntoFace pulled it back to the 0.5 mm overshoot.
    const pocket = holeShape(
      {
        points: [
          { id: "p1", x: -8, z: -8 },
          { id: "p2", x: 8, z: -8 },
          { id: "p3", x: 8, z: 8 },
          { id: "p4", x: -8, z: 8 },
        ],
        segments: [
          { id: "s1", startId: "p1", endId: "p2", kind: "line" },
          { id: "s2", startId: "p2", endId: "p3", kind: "line" },
          { id: "s3", startId: "p3", endId: "p4", kind: "line" },
          { id: "s4", startId: "p4", endId: "p1", kind: "line" },
        ],
        sketchPlane: {
          origin: { x: 0, y: 22, z: 0 },
          normal: { x: 0, y: -1, z: 0 },
          uAxis: { x: 1, y: 0, z: 0 },
          hostShapeId: "box-1",
        },
        faceReferenceLoops: [[{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }]],
      },
      { width: 16, depth: 16, height: 7.8, elevation: 14.2, cadBrep: "DBRep_DrawableShape", sketchFinish: "extrude" },
    );
    expect(expandSketchHoleCuttersIfPossible(pocket)).toEqual([pocket]);
    const stepPocket = { ...pocket, cadBrep: undefined, importedMesh: { positions: [], indices: [], brepStep: "ISO-10303-21;" } } as WorkplaneShape;
    expect(expandSketchHoleCuttersIfPossible(stepPocket)).toEqual([stepPocket]);
  });

  it("leaves a nested circle as one cutter so a ring does not become two holes", () => {
    const outer = circle("o", 0, 0, 10);
    const inner = circle("i", 0, 0, 4);
    const shape = holeShape({
      points: [...outer.points, ...inner.points],
      segments: [...outer.segments, ...inner.segments],
    });
    const expanded = expandSketchHoleCuttersIfPossible(shape);
    expect(expanded).toHaveLength(1);
    expect(expanded[0]?.id).toBe(shape.id);
  });

  it("asks for one hole per sketch when freeform loops cannot rebuild as exact cutters", () => {
    const profile: SketchProfile = {
      points: [
        { id: "p1", x: -6, z: -4 },
        { id: "p2", x: 0, z: -5 },
        { id: "p3", x: 6, z: -3 },
        { id: "p4", x: 8, z: 6 },
        { id: "p5", x: 2, z: 8 },
        { id: "p6", x: -7, z: 5 },
      ],
      segments: [
        { id: "s1", startId: "p1", endId: "p2", kind: "line" },
        { id: "s2", startId: "p2", endId: "p3", kind: "line" },
        { id: "s3", startId: "p3", endId: "p1", kind: "line" },
        { id: "s4", startId: "p4", endId: "p5", kind: "line" },
        { id: "s5", startId: "p5", endId: "p6", kind: "line" },
        { id: "s6", startId: "p6", endId: "p4", kind: "line" },
      ],
    };
    const shape = holeShape(profile);
    expect(expandSketchHoleCuttersIfPossible(shape)).toEqual([shape]);
    expect(sketchHoleBatchNotice([shape])).toBe(SKETCH_HOLE_BATCH_NOTICE);
  });
});
