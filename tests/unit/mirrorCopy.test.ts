import { describe, expect, it } from "vitest";
import { boundsForShapes, meshForShape } from "@/lib/editorShapeMesh";
import { MIRROR_SIDES, mirrorCopyLabel, mirroredCopiesForSelection, mirrorSideAxis, mirrorSideFromLabel, type MirrorSide } from "@/lib/mirrorCopy";
import type { WorkplaneShape } from "@/types/sketchforge";

const wedge = (extra: Partial<WorkplaneShape> = {}): WorkplaneShape => ({
  id: "w", name: "Wedge", kind: "wedge", color: "#2a2", x: 10, z: 5, elevation: 2,
  size: 20, width: 20, depth: 12, height: 8, rotation: 0, ...extra,
});
/** The copy's corners are the original's corners reflected across that side of the original. */
function isMirrorImageAcrossSide(original: WorkplaneShape, copy: WorkplaneShape, side: MirrorSide) {
  const { axis, sign } = mirrorSideAxis(side);
  const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const before = meshForShape(original).vertices;
  const after = meshForShape(copy).vertices;
  const plane = sign > 0 ? Math.max(...before.map((v) => v[index])) : Math.min(...before.map((v) => v[index]));
  const near = (a: readonly number[], b: readonly number[]) => a.every((value, i) => Math.abs(value - b[i]) <= 1e-3);
  const reflected = before.map((v) => { const c = [...v]; c[index] = 2 * plane - c[index]; return c; });
  return reflected.every((corner) => after.some((v) => near(v, corner))) && after.every((v) => reflected.some((corner) => near(v, corner)));
}

describe("Mirror makes a mirrored copy", () => {
  for (const side of MIRROR_SIDES) {
    for (const [name, shape] of [["a wedge", wedge()], ["a turned, tipped wedge", wedge({ rotation: 30, rotationX: 20 })]] as const) {
      it(`puts a mirror image of ${name} on the ${side}, touching it`, () => {
        const { nextShapes, copies } = mirroredCopiesForSelection([shape], [shape], side, () => "copy");
        expect(nextShapes).toHaveLength(2);
        expect(nextShapes[0]).toBe(shape);
        expect(copies).toHaveLength(1);
        expect(isMirrorImageAcrossSide(shape, copies[0], side)).toBe(true);
      });
    }
  }

  it("mirrors several parts as one piece, across the side of the whole selection", () => {
    const a = wedge({ id: "a", x: 0 });
    const b = wedge({ id: "b", x: 30 });
    let next = 0;
    const { copies } = mirroredCopiesForSelection([a, b], [a, b], "right", () => `copy-${(next += 1)}`);
    const original = boundsForShapes([a, b]);
    const mirrored = boundsForShapes(copies);
    expect(mirrored.minX).toBeCloseTo(original.maxX, 6);
    expect(mirrored.maxX - mirrored.minX).toBeCloseTo(original.maxX - original.minX, 6);
    // The part furthest right ends up nearest the plane.
    expect(copies.map((copy) => copy.id)).toEqual(["copy-1", "copy-2"]);
    expect(copies[1].x).toBeLessThan(copies[0].x);
  });

  it("never puts a copy below the workplane", () => {
    const { copies } = mirroredCopiesForSelection([wedge()], [wedge()], "top", () => "copy");
    expect(copies[0].elevation).toBeCloseTo(10, 6);
    expect(copies[0].mirrorY).toBe(true);
  });

  it("gives the copy its own ids, unlocked, and leaves a locked original alone", () => {
    const group: WorkplaneShape = { ...wedge({ id: "g", locked: true }), groupedShapes: [wedge({ id: "child" })] };
    const { copies, nextShapes } = mirroredCopiesForSelection([group], [group], "left", () => "copy");
    expect(copies[0].id).toBe("copy");
    expect(copies[0].locked).toBe(false);
    expect(copies[0].groupedShapes?.[0].id).not.toBe("child");
    expect(nextShapes[0]).toEqual(group);
  });

  it("adds nothing when nothing is selected", () => {
    const shape = wedge();
    expect(mirroredCopiesForSelection([shape], [], "right")).toEqual({ nextShapes: [shape], copies: [] });
  });
});

describe("Mirror history labels", () => {
  it("names the side, and guides read it back", () => {
    for (const side of MIRROR_SIDES) {
      expect(mirrorSideFromLabel(mirrorCopyLabel(1, side))).toBe(side);
      expect(mirrorSideFromLabel(mirrorCopyLabel(3, side))).toBe(side);
    }
    expect(mirrorCopyLabel(1, "right")).toBe("Mirrored a copy to the right");
    expect(mirrorCopyLabel(2, "top")).toBe("Mirrored copies of 2 shapes on top");
  });

  it("still reads steps recorded by older Mintr", () => {
    expect(mirrorSideFromLabel("Mirrored 1 shape left-right")).toBe("right");
    expect(mirrorSideFromLabel("Mirrored 2 shapes front-back")).toBe("front");
    expect(mirrorSideFromLabel("Mirrored 1 shape top-bottom")).toBe("top");
    expect(mirrorSideFromLabel("Moved 1 shape")).toBeNull();
  });
});
