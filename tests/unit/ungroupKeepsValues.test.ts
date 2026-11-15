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

it("a group joined again keeps its own values, and its parts keep following them", async () => {
  const { buildGroupedShapeFromSelection, remeshCsgGroup } = await import("@/lib/editorBoolean");
  const { bumpCsgVersion } = await import("@/lib/csgTree");
  const built = await buildGroupedShapeFromSelection([
    box("plate", 0, { width: 30, drivenBy: { Height: "wall * 5" } }),
    box("cutter", 0, { width: 4, depth: 4, height: 30, hole: true, values: [{ name: "own", expression: "1" }] }),
  ]);
  const group = { ...built.group!, values: [{ name: "wall", expression: "2" }], drivenBy: { Length: "wall * 10" } };
  const again = (await remeshCsgGroup(bumpCsgVersion(group)))!;
  // The group's list and sums are the group's, not something the join makes.
  expect(again.values).toEqual(group.values);
  expect(again.drivenBy).toEqual(group.drivenBy);
  const [plate, cutter] = again.groupedShapes!;
  // The plate did not get a copy of `wall`, which would hide the group's value from then on.
  expect(plate.values).toBeUndefined();
  expect(plate.drivenBy).toEqual({ Height: "wall * 5" });
  expect(cutter.values).toEqual([{ name: "own", expression: "1" }]);
  // A group with no values comes back with none, not an empty list.
  const plain = (await remeshCsgGroup(bumpCsgVersion(built.group!)))!;
  expect(plain.values).toBeUndefined();
  expect(plain.drivenBy).toBeUndefined();
  expect("values" in plain || "drivenBy" in plain).toBe(false);
});
