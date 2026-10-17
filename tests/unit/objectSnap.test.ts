import { describe, expect, it } from "vitest";
import { faceSampleForSide, faceToFaceMate, layFaceOnWorkplane, snapAabbFromShape, snapMovingAabb, unionSnapAabbs } from "@/lib/objectSnap";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(partial: Partial<WorkplaneShape> & Pick<WorkplaneShape, "id" | "x" | "z">): WorkplaneShape {
  return {
    name: "Box",
    kind: "box",
    color: "#fff",
    size: 10,
    width: 10,
    depth: 10,
    height: 10,
    rotation: 0,
    ...partial,
  };
}

describe("snapAabbFromShape", () => {
  it("uses the footprint center and elevation as the bottom", () => {
    expect(snapAabbFromShape(box({ id: "a", x: 10, z: -4, elevation: 2, width: 8, depth: 6, height: 5 }))).toEqual({
      minX: 6,
      maxX: 14,
      minY: 2,
      maxY: 7,
      minZ: -7,
      maxZ: -1,
    });
  });

  it("grows the footprint when the solid is rotated", () => {
    const axis = snapAabbFromShape(box({ id: "a", x: 0, z: 0, width: 10, depth: 10, height: 10, rotation: 0 }));
    const turned = snapAabbFromShape(box({ id: "b", x: 0, z: 0, width: 10, depth: 10, height: 10, rotation: 45 }));
    expect(turned.maxX - turned.minX).toBeGreaterThan(axis.maxX - axis.minX);
  });
});

describe("snapMovingAabb", () => {
  it("snaps a dragged face flush against a neighbor", () => {
    const moving = snapAabbFromShape(box({ id: "move", x: 0, z: 0, width: 10, depth: 10, height: 10 }));
    const target = snapAabbFromShape(box({ id: "park", x: 20, z: 30, width: 10, depth: 10, height: 10 }));
    // Right face of the mover meets the left face of the target when deltaX = 10.
    const snapped = snapMovingAabb(moving, [target], { x: 9.4, z: 0 }, 1.5);
    expect(snapped).not.toBeNull();
    expect(snapped?.deltaX).toBe(10);
    expect(snapped?.deltaZ).toBe(0);
    expect(snapped?.kind).toBe("face");
  });

  it("snaps midpoints when centers almost line up", () => {
    const moving = snapAabbFromShape(box({ id: "move", x: 0, z: 0, width: 10 }));
    const target = snapAabbFromShape(box({ id: "park", x: 30, z: 40, width: 20 }));
    const snapped = snapMovingAabb(moving, [target], { x: 29.6, z: 0 }, 1.5);
    expect(snapped?.deltaX).toBe(30);
    expect(snapped?.kind).toBe("mid");
  });

  it("reports an edge snap when both axes lock", () => {
    const moving = snapAabbFromShape(box({ id: "move", x: 0, z: 0 }));
    const target = snapAabbFromShape(box({ id: "park", x: 20, z: 20 }));
    const snapped = snapMovingAabb(moving, [target], { x: 9.4, z: 9.3 }, 1.5);
    expect(snapped?.kind).toBe("edge");
    expect(snapped?.deltaX).toBe(10);
    expect(snapped?.deltaZ).toBe(10);
  });

  it("does not snap when the drag is outside tolerance", () => {
    const moving = snapAabbFromShape(box({ id: "move", x: 0, z: 0 }));
    const target = snapAabbFromShape(box({ id: "park", x: 40, z: 30 }));
    expect(snapMovingAabb(moving, [target], { x: 8, z: 0 }, 1.5)).toBeNull();
  });
});

describe("unionSnapAabbs", () => {
  it("unions a multi-selection footprint", () => {
    const union = unionSnapAabbs([
      snapAabbFromShape(box({ id: "a", x: 0, z: 0 })),
      snapAabbFromShape(box({ id: "b", x: 20, z: 0 })),
    ]);
    expect(union).toMatchObject({ minX: -5, maxX: 25, minZ: -5, maxZ: 5 });
  });
});

describe("faceToFaceMate", () => {
  const source = box({ id: "source", x: 0, z: 0, elevation: 0, width: 10, depth: 10, height: 10, rotation: 0 });
  const target = box({ id: "target", x: 30, z: 4, elevation: 12, width: 10, depth: 20, height: 8, rotation: 0 });

  it("centers the first face on the second, ignoring where on the face you click", () => {
    const fromCorner = faceToFaceMate(
      source,
      { point: [5, 0.2, 4.8], normal: [1, 0, 0] },
      target,
      { point: [25, 12.1, -5.5], normal: [-1, 0, 0] },
    );
    const fromCenter = faceToFaceMate(
      source,
      { point: [5, 5, 0], normal: [1, 0, 0] },
      target,
      { point: [25, 16, 4], normal: [-1, 0, 0] },
    );
    expect(fromCorner).toEqual(fromCenter);
    expect(fromCenter).toMatchObject({ x: 20, z: 4, elevation: 11, rotationX: 0, rotation: 0, rotationZ: 0 });
  });

  it("turns the first face onto the second and centers it there", () => {
    const pose = faceToFaceMate(
      source,
      { point: [5, 1, -3], normal: [1, 0, 0] },
      target,
      { point: [34, 20, 8], normal: [0, 1, 0] },
    );
    expect(pose).toMatchObject({ x: 30, z: 4, elevation: 20, rotationX: 0, rotation: 0, rotationZ: 270 });
  });
});

describe("layFaceOnWorkplane", () => {
  const shape = box({ id: "box", x: 4, z: -6, elevation: 8, width: 10, depth: 10, height: 10, rotation: 0 });

  it("turns a side face down and rests it on the workplane", () => {
    const pose = layFaceOnWorkplane(shape, { point: [9, 12, -4], normal: [1, 0, 0] });
    expect(pose).toMatchObject({ x: 4, z: -6, elevation: 0, rotationX: 0, rotation: 0, rotationZ: 270 });
  });

  it("drops a face that is already down onto the workplane", () => {
    const pose = layFaceOnWorkplane(shape, { point: [4, 8, -6], normal: [0, -1, 0] });
    expect(pose).toMatchObject({ x: 4, z: -6, elevation: 0, rotationX: 0, rotation: 0, rotationZ: 0 });
  });
});

describe("faceSampleForSide", () => {
  it("points the top face up from the top of the box", () => {
    const sample = faceSampleForSide(box({ id: "box", x: 4, z: -6, elevation: 8, width: 10, depth: 10, height: 10 }), "top");
    expect(sample?.normal[1]).toBeCloseTo(1);
    expect(sample?.point[1]).toBeCloseTo(18);
  });
});
