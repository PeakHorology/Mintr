import { expect, it } from "vitest";
import { groupedShape } from "@/lib/editorGroup";
import { restoreGroupedChildren } from "@/lib/editorBoolean";
import type { WorkplaneShape } from "@/types/sketchforge";

const box = (id: string, x: number, o: Partial<WorkplaneShape> = {}): WorkplaneShape => ({
  id, name: id, kind: "box", color: "#d41721", x, z: 0, elevation: 0, size: 10, width: 10, depth: 10, height: 10, rotation: 0, locked: false, hidden: false, ...o,
});

it("Ungroup keeps the group's values each part's sums use", () => {
  const tie = groupedShape([
    box("a", -10, { drivenBy: { height: "wall * 4" } }),
    box("b", 10, { values: [{ name: "wall", expression: "9" }], drivenBy: { width: "wall" } }),
    box("c", 30),
  ])!;
  const group = { ...tie, values: [{ name: "wall", expression: "base + 1" }, { name: "base", expression: "2" }, { name: "unused", expression: "7" }] };
  const [a, b, c] = restoreGroupedChildren(group);
  // a uses wall, and wall uses base: both come along, unused does not.
  expect(a.values?.map((value) => value.name).sort()).toEqual(["base", "wall"]);
  // b has its own wall, which wins.
  expect(b.values).toEqual([{ name: "wall", expression: "9" }]);
  // c uses nothing.
  expect(c.values).toBeUndefined();
});
