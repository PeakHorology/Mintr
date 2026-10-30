import { describe, expect, it } from "vitest";
import { remeshCsgGroup, shrinkWrapMeshShape } from "@/lib/editorBoolean";
import { inferCsgOp } from "@/lib/csgTree";
import { toNativeKernelSolids } from "@/lib/nativeKernelProtocol";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(id: string, x: number, size = 10, extra: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return { id, name: id, kind: "box", color: "#d41721", x, z: 0, elevation: 0, size, width: size, depth: size, height: size, rotation: 0, locked: false, hidden: false, ...extra };
}

function volume(positions: ArrayLike<number>) {
  let sum = 0;
  for (let i = 0; i < positions.length; i += 9) {
    sum += positions[i] * (positions[i + 4] * positions[i + 8] - positions[i + 5] * positions[i + 7])
      - positions[i + 1] * (positions[i + 3] * positions[i + 8] - positions[i + 5] * positions[i + 6])
      + positions[i + 2] * (positions[i + 3] * positions[i + 7] - positions[i + 4] * positions[i + 6]);
  }
  return sum / 6;
}

describe("shrink wrap", () => {
  it("wraps two boxes in one skin that fills the gap between them", async () => {
    const wrapped = await shrinkWrapMeshShape([box("a", -10), box("b", 10)]);
    expect(wrapped).not.toBeNull();
    expect(inferCsgOp(wrapped!)).toBe("hull");
    expect(wrapped!.name).toBe("Shrink wrap");
    expect(wrapped!.width).toBeCloseTo(30, 3);
    // Two 10 mm cubes 10 mm apart: the skin is one 30 x 10 x 10 block.
    expect(volume(wrapped!.importedMesh!.positions)).toBeCloseTo(3000, 0);
    expect(wrapped!.groupedShapes?.map((child) => child.name)).toEqual(["a", "b"]);
  });

  it("cuts holes after wrapping", async () => {
    const hole = box("hole", 0, 4, { hole: true, height: 20, elevation: -5 });
    const wrapped = await shrinkWrapMeshShape([box("a", -10), box("b", 10), hole]);
    expect(wrapped).not.toBeNull();
    expect(inferCsgOp(wrapped!)).toBe("hull");
    expect(volume(wrapped!.importedMesh!.positions)).toBeCloseTo(3000 - 160, -1);
    expect(wrapped!.groupedShapes).toHaveLength(3);
  });

  it("rebuilds as a wrap after a part moves, and stays off the exact engines", async () => {
    const wrapped = (await shrinkWrapMeshShape([box("a", -10), box("b", 10)]))!;
    const children = wrapped.groupedShapes!.map((child) => (child.name === "b" ? { ...child, x: child.x + 10 } : child));
    const remeshed = await remeshCsgGroup({ ...wrapped, groupedShapes: children });
    expect(remeshed).not.toBeNull();
    expect(inferCsgOp(remeshed!)).toBe("hull");
    expect(remeshed!.width).toBeCloseTo(40, 3);
    expect(toNativeKernelSolids([remeshed!])).toBeNull();
  });
});
