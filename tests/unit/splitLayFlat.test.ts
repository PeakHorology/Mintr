import { describe, expect, it } from "vitest";
import { meshAabb } from "@/lib/editorShapeMesh";
import { splitPiecesCutSideDown } from "@/lib/splitLayFlat";
import { splitShapeWithPlane, type SplitCut } from "@/lib/splitShape";
import type { WorkplaneShape } from "@/types/sketchforge";

function cone(): WorkplaneShape {
  return { id: "cone", name: "Cone", kind: "cone", color: "#d97813", x: -50, z: 6, size: 20, width: 20, depth: 20, height: 20, elevation: 0, rotation: 0 };
}

function block(): WorkplaneShape {
  return { id: "box", name: "Block", kind: "box", color: "#d97813", x: 10, z: -4, size: 20, width: 20, depth: 12, height: 16, elevation: 2, rotation: 0 };
}

function laid(source: WorkplaneShape, cut: SplitCut) {
  const pieces = splitShapeWithPlane(source, cut);
  expect(pieces).toHaveLength(2);
  const poses = splitPiecesCutSideDown(source, cut, pieces);
  expect(poses).toHaveLength(2);
  return pieces.map((piece) => ({ piece, after: { ...piece, ...poses.find((entry) => entry.id === piece.id)!.pose } }));
}

describe("Split, laying pieces cut-side down", () => {
  it("turns the bottom of a cone over and rests both pieces on the workplane, apart", () => {
    const result = laid(cone(), { axis: "y", offset: 0 });
    const bottom = result.find((entry) => entry.piece.name.endsWith("Bottom"))!;
    const top = result.find((entry) => entry.piece.name.endsWith("Top"))!;
    // The wide cut face of the bottom piece now lies on the workplane: turned half over.
    expect(Math.abs(bottom.after.rotationX ?? 0) + Math.abs(bottom.after.rotationZ ?? 0)).toBeCloseTo(180, 3);
    // The top piece was already cut face down.
    expect(top.after.rotationX ?? 0).toBeCloseTo(0, 3);
    expect(top.after.rotationZ ?? 0).toBeCloseTo(0, 3);
    for (const { after } of result) expect(meshAabb(after).minY).toBeCloseTo(0, 2);
    const [a, b] = result.map(({ after }) => meshAabb(after)).sort((p, q) => p.minX - q.minX);
    expect(b.minX - a.maxX).toBeCloseTo(8, 1);
    // Where the cone was, left to right.
    expect((a.minX + b.maxX) / 2).toBeCloseTo(-50, 1);
  });

  it("lays a left / right cut on its cut faces, side by side along the cut", () => {
    const result = laid(block(), { axis: "x", offset: 4 });
    for (const { piece, after } of result) {
      const box = meshAabb(after);
      expect(box.minY).toBeCloseTo(0, 2);
      // Standing on its cut face: as tall as the piece was wide.
      const before = meshAabb(piece);
      expect(box.maxY - box.minY).toBeCloseTo(before.maxX - before.minX, 2);
    }
    const boxes = result.map(({ after }) => meshAabb(after)).sort((p, q) => p.minX - q.minX);
    expect(boxes[1].minX - boxes[0].maxX).toBeCloseTo(8, 1);
  });
});
