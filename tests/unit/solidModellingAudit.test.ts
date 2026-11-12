import { describe, expect, it } from "vitest";
import { groupedShape } from "@/lib/editorGroup";
import { shrinkWrapMeshShape } from "@/lib/editorBoolean";
import { groupMeshChildren, meshAabb, meshForShape } from "@/lib/editorShapeMesh";
import { localChildFromGroup, toNativeKernelSolids } from "@/lib/nativeKernelProtocol";
import { groupScaleInChildFrame, shapeYawDegrees } from "@/lib/shapeBounds";
import { createThreadShape, matchingThreadPart } from "@/lib/threadShape";
import type { WorkplaneShape } from "@/types/sketchforge";

const box = (id: string, x: number, o: Partial<WorkplaneShape> = {}): WorkplaneShape => ({
  id, name: id, kind: "box", color: "#d41721", x, z: 0, elevation: 0, size: 10, width: 10, depth: 10, height: 10, rotation: 0, locked: false, hidden: false, ...o,
});

const extent = (shape: WorkplaneShape) => {
  const b = meshAabb(shape);
  return { x: b.maxX - b.minX, y: b.maxY - b.minY, z: b.maxZ - b.minZ, minX: b.minX, maxX: b.maxX };
};

describe("meshForShape on groups", () => {
  it("follows a resized Tie, like the viewport", () => {
    const tie = groupedShape([box("a", -10), box("b", 10)])!; // 30 x 10 x 10
    const stretched = { ...tie, width: 60, size: 60, height: 15 };
    const e = extent(stretched);
    expect(e.x).toBeCloseTo(60, 3);
    expect(e.y).toBeCloseTo(15, 3);
    expect(e.z).toBeCloseTo(10, 3);
    expect(e.minX).toBeCloseTo(tie.x - 30, 3);
  });

  it("leaves out a solid group's hole and suppressed children, but a hole group keeps its cutters", () => {
    const tie = groupedShape([box("solid", 0), box("cut", 0, { hole: true, height: 40, width: 4, depth: 4 })])!;
    expect(groupMeshChildren(tie).map((child) => child.name)).toEqual(["solid"]);
    expect(extent(tie).y).toBeCloseTo(10, 3);

    const suppressed = { ...tie, groupedShapes: tie.groupedShapes!.map((child) => (child.name === "solid" ? child : { ...child, hole: false, suppressed: true })) };
    expect(extent(suppressed).y).toBeCloseTo(10, 3);

    const asHole = { ...tie, hole: true };
    expect(groupMeshChildren(asHole)).toHaveLength(2);
    expect(extent(asHole).y).toBeCloseTo(40, 3);

    const holesOnly = groupedShape([box("h1", 0, { hole: true }), box("h2", 20, { hole: true })])!;
    expect(groupMeshChildren(holesOnly)).toHaveLength(2);
  });

  it("Shrink Wrap does not hull a Tie's cutter", async () => {
    const tie = groupedShape([box("tb", 20), box("cut", 20, { hole: true, height: 40, width: 4, depth: 4 })])!;
    const wrapped = await shrinkWrapMeshShape([box("a", 0), tie]);
    expect(wrapped!.height).toBeCloseTo(10, 2);
  });
});

describe("turn of a low-sided cylinder", () => {
  const cyl = (rotation: number, sides?: number): WorkplaneShape => ({
    id: "c", name: "c", kind: "cylinder", color: "#d41721", x: 0, z: 0, elevation: 0, size: 20, width: 20, depth: 20, height: 10, rotation, sides, locked: false, hidden: false,
  });
  const maxX = (shape: WorkplaneShape) => Math.max(...meshForShape(shape).vertices.map((v) => v[0]));

  it("keeps the turn of a 6-sided cylinder and cone", () => {
    expect(shapeYawDegrees(cyl(30, 6))).toBe(30);
    expect(shapeYawDegrees({ ...cyl(30, 6), kind: "cone" })).toBe(30);
    expect(maxX(cyl(30, 6))).not.toBeCloseTo(maxX(cyl(0, 6)), 3);
  });

  it("still ignores the turn of a round cylinder", () => {
    expect(shapeYawDegrees(cyl(30))).toBe(0);
    expect(shapeYawDegrees(cyl(30, 128))).toBe(0);
    // A stretched footprint is not round, so the turn always counts.
    expect(shapeYawDegrees({ ...cyl(30), width: 30 })).toBe(30);
  });
});

describe("stretched group with a turned child", () => {
  it("scales the child along the group's axes, turned into its own frame", () => {
    expect(groupScaleInChildFrame(box("b", 0, { rotation: 90 }), { x: 2, y: 1, z: 1 })!.scale)
      .toEqual({ x: expect.closeTo(1, 9), y: expect.closeTo(1, 9), z: expect.closeTo(2, 9) });
    expect(groupScaleInChildFrame(box("b", 0, { rotation: 30 }), { x: 2, y: 2, z: 2 })!.scale).toEqual({ x: 2, y: 2, z: 2 });
    // A 30 degree turn under a one-axis stretch would shear the child.
    expect(groupScaleInChildFrame(box("b", 0, { rotation: 30 }), { x: 2, y: 1, z: 1 })).toBeNull();
    // A round cylinder's turn is ignored, so it stretches into an unturned ellipse.
    const round: WorkplaneShape = { ...box("c", 0, { rotation: 30 }), kind: "cylinder", width: 10, depth: 10 };
    expect(groupScaleInChildFrame(round, { x: 2, y: 1, z: 1 })).toEqual({ scale: { x: 2, y: 1, z: 1 }, rotation: 0 });
  });

  it("native engine: a quarter-turned child keeps its world size; a shear falls back", () => {
    const child = box("b", 10, { width: 20, depth: 6, size: 20, rotation: 90 });
    const tie = groupedShape([box("a", -10), child])!;
    const stretched = { ...tie, width: tie.width * 2, size: tie.width * 2 };
    const local = localChildFromGroup(stretched, stretched.groupedShapes![1])!;
    expect(local.rotation).toBe(90);
    expect(local.width).toBeCloseTo(20, 6);
    expect(local.depth).toBeCloseTo(12, 6);
    // World extent: 12 along X, 20 along Z — the same box the viewport draws.
    const drawn = extent({ ...stretched, groupedShapes: [stretched.groupedShapes![1]] });
    const placed = extent({ ...local, x: local.x + stretched.x, z: local.z + stretched.z });
    expect(placed.x).toBeCloseTo(12, 6);
    expect(placed.z).toBeCloseTo(20, 6);
    expect(drawn.x).toBeCloseTo(12, 6);
    expect(drawn.z).toBeCloseTo(20, 6);

    const tilted = groupedShape([box("a", -10), box("t", 10, { rotationZ: 90, width: 20, height: 6 })])!;
    const tall = { ...tilted, height: tilted.height * 2 };
    const tiltedLocal = localChildFromGroup(tall, tall.groupedShapes![1])!;
    expect(tiltedLocal.width).toBeCloseTo(40, 6); // turned onto Y, so the height stretch lengthens it
    expect(tiltedLocal.height).toBeCloseTo(6, 6);
    expect(tiltedLocal.elevation! + tiltedLocal.height / 2).toBeCloseTo((tall.groupedShapes![1].elevation! + 3) * 2, 6);

    const sheared = groupedShape([box("a", -10), box("s", 10, { rotation: 30 })])!;
    const wide = { ...sheared, width: sheared.width * 2, size: sheared.width * 2 };
    expect(localChildFromGroup(wide, wide.groupedShapes![1])).toBeNull();
    expect(toNativeKernelSolids([wide])).toBeNull();
  });
});

describe("matching threaded hole", () => {
  it("sits on the threaded end of an upside-down screw", () => {
    const base = {
      id: "s", name: "Screw", color: "#d97813", height: 20,
      threadSpec: { designation: "M4", majorDiameter: 4, pitch: 0.7, role: "screw", head: "cylinder", length: 12 },
    } as never;
    const screw = createThreadShape({ designation: "M4", point: { x: 5, z: 2, elevation: 3 }, base });
    const upright = matchingThreadPart(screw)!;
    expect(upright.elevation).toBeCloseTo(3, 6);

    const flipped = matchingThreadPart({ ...screw, mirrorY: true })!;
    expect(flipped.height).toBeCloseTo(12, 6);
    expect((flipped.elevation ?? 0) + flipped.height).toBeCloseTo((screw.elevation ?? 0) + screw.height, 6);
    expect(flipped.x).toBeCloseTo(5, 6);
  });
});
