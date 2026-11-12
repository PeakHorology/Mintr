import { expect, it } from "vitest";
import { groupedShape } from "@/lib/editorGroup";
import { restoreGroupedChildren } from "@/lib/editorBoolean";
import { meshAabb } from "@/lib/editorShapeMesh";
import type { WorkplaneShape } from "@/types/sketchforge";

const box = (id: string, x: number, o: Partial<WorkplaneShape> = {}): WorkplaneShape => ({
  id, name: id, kind: "box", color: "#d41721", x, z: 0, elevation: 0, size: 10, width: 10, depth: 10, height: 10, rotation: 0, locked: false, hidden: false, ...o,
});

it("Ungroup of a stretched group keeps a turned part the size it was on screen", () => {
  // b is 20 wide and 6 deep, turned 90°, so it takes 6 along X and 20 along Z.
  const tie = groupedShape([box("a", -10), box("b", 10, { width: 20, depth: 6, size: 20, rotation: 90 })])!;
  const stretched = { ...tie, width: tie.width * 2, size: tie.width * 2 };
  const [, b] = restoreGroupedChildren(stretched);
  const bounds = meshAabb(b);
  expect(bounds.maxX - bounds.minX).toBeCloseTo(12, 2);
  expect(bounds.maxZ - bounds.minZ).toBeCloseTo(20, 2);
});

it("Ungroup of a stretched group bakes a part turned at an angle, keeping what was drawn", () => {
  const tie = groupedShape([box("a", -10), box("b", 10, { rotation: 30 })])!;
  const stretched = { ...tie, width: tie.width * 2, size: tie.width * 2 };
  const [, b] = restoreGroupedChildren(stretched);
  const before = meshAabb({ ...stretched, groupedShapes: [stretched.groupedShapes![1]] });
  const after = meshAabb(b);
  expect(after.maxX - after.minX).toBeCloseTo(before.maxX - before.minX, 2);
  expect(after.maxZ - after.minZ).toBeCloseTo(before.maxZ - before.minZ, 2);
});
