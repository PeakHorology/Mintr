import { describe, expect, it } from "vitest";
import {
  designTreeAncestors,
  designTreeBodyId,
  designTreeChildren,
  designTreeGroupLabel,
  designTreeOp,
  designTreeRows,
  designTreeSteps,
  partStepsBefore,
  removePartFromTree,
  reorderPartSteps,
  stepDropIndex,
  treeDropFor,
  type DesignTreeRow,
} from "../../apps/web/src/lib/designTree";
import { withCsgMeta } from "../../apps/web/src/lib/csgTree";
import type { PartFeature, WorkplaneShape } from "../../apps/web/src/types/sketchforge";

function part(id: string, patch: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id,
    name: id,
    kind: "box",
    color: "#d41721",
    x: 0,
    z: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    ...patch,
  };
}

function fillet(id: string, amount = 1): PartFeature {
  return { id, kind: "fillet", amount, edges: { rule: "allSharp", sharpAngle: 25 } };
}

function hollow(id: string): PartFeature {
  return { id, kind: "hollow", thickness: 1.5, openings: ["top"], corners: "sharp", cornerRadius: 0 };
}

/** plate, then a cut group holding a lid group (box + hole) and a hole, then text. */
function design(): WorkplaneShape[] {
  const lid = withCsgMeta(part("lid", { kind: "mesh", groupedShapes: [part("lid-box"), part("lid-hole", { hole: true })] }), "subtract");
  const bracket = withCsgMeta(part("bracket", { kind: "mesh", groupedShapes: [part("base"), lid, part("bore", { hole: true, suppressed: true })] }), "subtract");
  return [part("plate"), bracket, part("text")];
}

/** A filleted, then hollowed box with its starting box stored, so its steps can be rebuilt. */
function steppedBox(id = "cup"): WorkplaneShape {
  return part(id, { kind: "mesh", features: [fillet("f1"), hollow("h1")], featureBase: part(`${id}-base`) });
}

const rowIds = (rows: DesignTreeRow[]) => rows.map((row) => `${"  ".repeat(row.depth)}${row.kind === "step" ? `step ${row.step.id}` : row.shape.id}`);

describe("designTreeRows", () => {
  it("lists every part newest first, with the parts inside a group under it, newest first", () => {
    const rows = designTreeRows(design());
    expect(rowIds(rows)).toEqual([
      "text",
      "bracket",
      "  bore",
      "  lid",
      "    lid-hole",
      "    lid-box",
      "  base",
      "plate",
    ]);
  });

  it("tells each row which top-level part it belongs to and which group holds it", () => {
    const rows = designTreeRows(design());
    const byId = new Map(rows.map((row) => [row.kind === "part" ? row.shape.id : row.step.id, row]));
    expect(byId.get("plate")).toMatchObject({ bodyId: "plate", depth: 0, parentId: null, op: null, hasChildren: false });
    expect(byId.get("bracket")).toMatchObject({ bodyId: "bracket", depth: 0, parentId: null, op: "subtract", hasChildren: true, expanded: true });
    expect(byId.get("lid")).toMatchObject({ bodyId: "bracket", depth: 1, parentId: "bracket", op: "subtract", hasChildren: true });
    expect(byId.get("lid-hole")).toMatchObject({ bodyId: "bracket", depth: 2, parentId: "lid", hasChildren: false });
  });

  it("marks a part that is turned off inside its group", () => {
    const rows = designTreeRows(design());
    expect(rows.find((row) => row.kind === "part" && row.shape.id === "bore")).toMatchObject({ off: true });
    expect(rows.find((row) => row.kind === "part" && row.shape.id === "base")).toMatchObject({ off: false });
    const offGroup = withCsgMeta(part("g", { kind: "mesh", groupedShapes: [part("a")] }), "union");
    const nested = withCsgMeta(part("outer", { kind: "mesh", groupedShapes: [{ ...offGroup, csg: { ...offGroup.csg!, suppressed: true } }] }), "union");
    expect(designTreeRows([nested]).find((row) => row.kind === "part" && row.shape.id === "g")).toMatchObject({ off: true });
  });

  it("leaves out the parts inside a collapsed group but still lists the group", () => {
    const rows = designTreeRows(design(), new Set(["lid"]));
    expect(rowIds(rows).map((id) => id.trim())).toEqual(["text", "bracket", "bore", "lid", "base", "plate"]);
    expect(rows.find((row) => row.kind === "part" && row.shape.id === "lid")).toMatchObject({ hasChildren: true, expanded: false });
    const closedTop = designTreeRows(design(), new Set(["bracket"]));
    expect(rowIds(closedTop)).toEqual(["text", "bracket", "plate"]);
  });

  it("infers the op of a group saved before csg metadata existed", () => {
    const old = part("old", { kind: "mesh", groupedShapes: [part("a"), part("b", { hole: true })] });
    expect(designTreeOp(old)).toBe("subtract");
    expect(designTreeOp(part("plain"))).toBeNull();
    expect(designTreeChildren(old).map((child) => child.id)).toEqual(["b", "a"]);
  });

  it("lists a part's steps under it, newest first, before the parts inside it", () => {
    const cup = steppedBox();
    const group = withCsgMeta(part("g", { kind: "mesh", groupedShapes: [part("a"), part("b", { hole: true })], features: [fillet("gf")] }), "subtract");
    const rows = designTreeRows([cup, group]);
    expect(rowIds(rows)).toEqual([
      "g",
      "  step gf",
      "  b",
      "  a",
      "cup",
      "  step h1",
      "  step f1",
    ]);
    const stepRow = rows.find((row) => row.kind === "step" && row.step.id === "f1");
    expect(stepRow).toMatchObject({ kind: "step", bodyId: "cup", depth: 1, index: 0, count: 2 });
    expect(rows.find((row) => row.kind === "part" && row.shape.id === "cup")).toMatchObject({ hasChildren: true, expanded: true, op: null });
  });

  it("hides a part's steps when it is collapsed, and shows none for steps that cannot be rebuilt", () => {
    const cup = steppedBox();
    expect(rowIds(designTreeRows([cup], new Set(["cup"])))).toEqual(["cup"]);
    const noBase = part("old", { kind: "mesh", features: [fillet("f1")] });
    expect(designTreeSteps(noBase)).toEqual([]);
    expect(designTreeRows([noBase])).toMatchObject([{ kind: "part", hasChildren: false }]);
    // A step picked by edges but recorded without a frame cannot be rebuilt either.
    const unplaced = part("u", { kind: "mesh", featureBase: part("u-base"), features: [{ id: "p", kind: "fillet", amount: 1, edges: { rule: "picked", sharpAngle: 25, fingerprints: [] } }] });
    expect(designTreeSteps(unplaced)).toEqual([]);
  });

  it("only lists steps for top-level parts: a part inside a group cannot rebuild on its own", () => {
    const inner = steppedBox("inner");
    const group = withCsgMeta(part("g", { kind: "mesh", groupedShapes: [inner, part("b")] }), "union");
    expect(rowIds(designTreeRows([group]))).toEqual(["g", "  b", "  inner"]);
  });
});

describe("designTreeGroupLabel", () => {
  it("names each kind of group in plain words", () => {
    expect(designTreeGroupLabel(null)).toBeNull();
    expect(designTreeGroupLabel("union")).toBe("Group");
    expect(designTreeGroupLabel("subtract")).toBe("Group");
    expect(designTreeGroupLabel("assemble")).toBe("Tie");
    expect(designTreeGroupLabel("intersect")).toBe("Intersect");
    expect(designTreeGroupLabel("hull")).toBe("Shrink wrap");
    expect(designTreeGroupLabel("smooth")).toBe("Smooth");
  });
});

describe("designTreeAncestors and designTreeBodyId", () => {
  it("finds the groups that hold a part, top-level first", () => {
    const shapes = design();
    expect(designTreeAncestors(shapes, "lid-hole")).toEqual(["bracket", "lid"]);
    expect(designTreeAncestors(shapes, "base")).toEqual(["bracket"]);
    expect(designTreeAncestors(shapes, "bracket")).toEqual([]);
    expect(designTreeAncestors(shapes, "missing")).toEqual([]);
  });

  it("finds the top-level part a nested part belongs to", () => {
    const shapes = design();
    expect(designTreeBodyId(shapes, "lid-hole")).toBe("bracket");
    expect(designTreeBodyId(shapes, "plate")).toBe("plate");
    expect(designTreeBodyId(shapes, "missing")).toBeNull();
  });
});

describe("steps: reorder, remove from, drop index", () => {
  const steps = [fillet("a"), hollow("b"), fillet("c", 2)];

  it("moves a step to a new place and leaves the list alone when it is already there", () => {
    expect(reorderPartSteps(steps, "c", 0).map((step) => step.id)).toEqual(["c", "a", "b"]);
    expect(reorderPartSteps(steps, "a", 2).map((step) => step.id)).toEqual(["b", "c", "a"]);
    expect(reorderPartSteps(steps, "a", 9).map((step) => step.id)).toEqual(["b", "c", "a"]);
    expect(reorderPartSteps(steps, "b", 1)).toEqual(steps);
    expect(reorderPartSteps(steps, "missing", 0)).toEqual(steps);
    expect(reorderPartSteps(steps, "c", 0)).not.toBe(steps);
  });

  it("keeps the steps before one and drops it and everything after", () => {
    expect(partStepsBefore(steps, "b").map((step) => step.id)).toEqual(["a"]);
    expect(partStepsBefore(steps, "a")).toEqual([]);
    expect(partStepsBefore(steps, "c").map((step) => step.id)).toEqual(["a", "b"]);
    expect(partStepsBefore(steps, "missing")).toEqual(steps);
  });

  it("drops above a row (newest first) to go after that step, below it to go before", () => {
    expect(stepDropIndex(1, true)).toBe(2);
    expect(stepDropIndex(1, false)).toBe(1);
  });
});

describe("removePartFromTree", () => {
  it("takes a part out of a group at any depth and drops a group that would be left empty", () => {
    const [, bracket] = design();
    const withoutBase = removePartFromTree(bracket, "base");
    expect(withoutBase?.groupedShapes?.map((child) => child.id)).toEqual(["lid", "bore"]);
    const withoutLidBox = removePartFromTree(bracket, "lid-box");
    const lid = withoutLidBox?.groupedShapes?.find((child) => child.id === "lid");
    expect(lid?.groupedShapes?.map((child) => child.id)).toEqual(["lid-hole"]);
    expect(removePartFromTree(bracket, "missing")).toBe(bracket);
    const single = withCsgMeta(part("g", { kind: "mesh", groupedShapes: [part("only")] }), "union");
    expect(removePartFromTree(single, "only")).toBeNull();
    // Emptying a nested group removes that group too.
    const nested = withCsgMeta(part("outer", { kind: "mesh", groupedShapes: [single, part("b")] }), "union");
    expect(removePartFromTree(nested, "only")?.groupedShapes?.map((child) => child.id)).toEqual(["b"]);
  });
});

describe("treeDropFor", () => {
  const cup = steppedBox();
  const shapes = [...design(), cup];
  const rows = designTreeRows(shapes);
  const row = (id: string) => rows.find((entry) => (entry.kind === "part" ? entry.shape.id : entry.step.id) === id)!;

  it("reorders a step only within its own part", () => {
    // The tree shows h1 above f1. Dropping f1 on the upper half of h1 puts it above h1: last in the steps.
    const drop = treeDropFor(row("f1"), row("h1"), true);
    expect(drop).toEqual({ kind: "reorder-step", bodyId: "cup", stepId: "f1", toIndex: 1 });
    expect(reorderPartSteps(cup.features!, "f1", 1).map((step) => step.id)).toEqual(["h1", "f1"]);
    // Dropping it on the lower half of h1 is where it already is, so nothing happens.
    expect(treeDropFor(row("f1"), row("h1"), false)).toBeNull();
    expect(treeDropFor(row("h1"), row("f1"), false)).toEqual({ kind: "reorder-step", bodyId: "cup", stepId: "h1", toIndex: 0 });
    expect(treeDropFor(row("h1"), row("f1"), true)).toBeNull();
    expect(treeDropFor(row("f1"), row("f1"))).toBeNull();
    expect(treeDropFor(row("f1"), row("plate"))).toBeNull();
    expect(treeDropFor(row("f1"), null)).toBeNull();
    const other = designTreeRows([steppedBox("other")]);
    expect(treeDropFor(row("f1"), other.find((entry) => entry.kind === "step")!)).toBeNull();
  });

  it("moves a part inside a group out to the top level when dropped on empty space or a plain part", () => {
    expect(treeDropFor(row("base"), null)).toEqual({ kind: "out-of-group", partId: "base", fromBodyId: "bracket" });
    expect(treeDropFor(row("lid-box"), row("plate"))).toEqual({ kind: "out-of-group", partId: "lid-box", fromBodyId: "bracket" });
    expect(treeDropFor(row("lid-box"), row("f1"))).toEqual({ kind: "out-of-group", partId: "lid-box", fromBodyId: "bracket" });
    expect(treeDropFor(row("plate"), null)).toBeNull();
  });

  it("moves a part into a group, but never into itself, a group inside it, or the group it is already in", () => {
    expect(treeDropFor(row("plate"), row("bracket"))).toEqual({ kind: "into-group", partId: "plate", fromBodyId: null, groupId: "bracket", bodyId: "bracket" });
    expect(treeDropFor(row("plate"), row("lid"))).toEqual({ kind: "into-group", partId: "plate", fromBodyId: null, groupId: "lid", bodyId: "bracket" });
    expect(treeDropFor(row("base"), row("lid"))).toEqual({ kind: "into-group", partId: "base", fromBodyId: "bracket", groupId: "lid", bodyId: "bracket" });
    expect(treeDropFor(row("bracket"), row("bracket"))).toBeNull();
    expect(treeDropFor(row("bracket"), row("lid"))).toBeNull();
    expect(treeDropFor(row("base"), row("bracket"))).toBeNull();
    expect(treeDropFor(row("lid-box"), row("lid"))).toBeNull();
  });

  it("leaves locked parts and locked groups where they are", () => {
    const lockedRows = designTreeRows([part("free"), withCsgMeta(part("g", { kind: "mesh", locked: true, groupedShapes: [part("a")] }), "union"), part("stuck", { locked: true })]);
    const pick = (id: string) => lockedRows.find((entry) => entry.kind === "part" && entry.shape.id === id)!;
    expect(treeDropFor(pick("free"), pick("g"))).toBeNull();
    expect(treeDropFor(pick("stuck"), pick("g"))).toBeNull();
    const lockedStep = designTreeRows([{ ...steppedBox(), locked: true }]).filter((entry) => entry.kind === "step");
    expect(treeDropFor(lockedStep[0], lockedStep[1], false)).toBeNull();
  });
});
