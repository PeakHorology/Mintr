import { afterAll, describe, expect, it } from "vitest";
import { planValues, withChangedPart, withTypedSetting, withTypedStepSize } from "@/components/workplane/valueDrivenPatches";
import { fingerprintsForEdgeIds } from "@/lib/edgeTreatmentRematch";
import { buildGroupedShapeFromSelection, remeshCsgGroupFromWorldChildren, restoreGroupedChildren } from "@/lib/editorBoolean";
import type { ReplayEngine, ReplayPrepared } from "@/lib/featureReplay";
import { rebuildBody, valueProblems, valuesChangeIsInstant, withDrivenSettings, type RebuildEngine, type RebuildOutcome } from "@/lib/parametricRebuild";
import { edgeTreatmentPartFeature, hollowPartFeature, withPartFeature } from "@/lib/partFeatures";
import { tagLinearPatternInstances } from "@/lib/patternFeature";
import { linearPatternInstances } from "@/lib/linearPattern";
import { addLinearDimension } from "@/lib/sketch";
import { sceneShape } from "@/lib/shapeCatalog";
import { shapeFromSketchProfile } from "@/lib/sketchProfileShape";
import { rebuildSketchedShape } from "@/lib/sketchRebuild";
import type { PartFeature, ShapeValue, WorkplaneShape } from "@/types/sketchforge";
import { kernelEngines, meshVolume, type KernelClient } from "../helpers/kernelRebuildEngine";
import { hasNativeKernelExe, spawnNativeKernelClient, type NativeKernelClient } from "../helpers/nativeKernelChild";
import { hasWasmKernel, startWasmKernel } from "../helpers/wasmKernel";

/**
 * `rebuildBody` is the one function a value change, a resize with steps and a step edit all end
 * in. These tests hold it to one rule: changing a value gives the same part as making that change
 * by hand. The ones that build geometry run on the desktop engine and on its WebAssembly build.
 */

const box = (id: string, width = 20, depth = 20, height = 20, extra: Partial<WorkplaneShape> = {}): WorkplaneShape =>
  sceneShape({ id, name: id, kind: "box", color: "#d41721", width, depth, height, ...extra });
const cylinder = (id: string, diameter: number, height: number, extra: Partial<WorkplaneShape> = {}): WorkplaneShape =>
  sceneShape({ id, name: id, kind: "cylinder", color: "#d97813", width: diameter, depth: diameter, height, ...extra });

const withValues = (shape: WorkplaneShape, values: ShapeValue[]): WorkplaneShape => ({ ...shape, values });
const setValue = (shape: WorkplaneShape, name: string, expression: string): WorkplaneShape =>
  ({ ...shape, values: (shape.values ?? []).map((value) => (value.name === name ? { ...value, expression } : value)) });

async function group(parts: WorkplaneShape[]): Promise<WorkplaneShape> {
  const built = await buildGroupedShapeFromSelection(parts);
  if (!built.group) throw new Error("could not group");
  return built.group;
}

/** A part inside a group, by the name it was given (grouping gives parts new ids). */
function partNamed(body: WorkplaneShape, name: string): WorkplaneShape {
  for (const child of body.groupedShapes ?? []) {
    if (child.name === name) return child;
    if (child.groupedShapes?.length) {
      try {
        return partNamed(child, name);
      } catch {
        // keep looking in the other parts
      }
    }
  }
  throw new Error(`no part named ${name}`);
}

const follow = (body: WorkplaneShape, name: string, sums: Record<string, string>) =>
  withChangedPart(body, partNamed(body, name).id, (part) => ({ ...part, drivenBy: { ...part.drivenBy, ...sums } }));

function rebuilt(outcome: RebuildOutcome): Extract<RebuildOutcome, { status: "rebuilt" }> {
  expect(outcome.status, JSON.stringify("problems" in outcome ? outcome.problems : [])).toBe("rebuilt");
  return outcome as Extract<RebuildOutcome, { status: "rebuilt" }>;
}

/** The engine the editor uses in a test run: Mintr's own code, with Manifold for a group's join and no step replay. */
const plainEngine: RebuildEngine = {
  rebuildSketch: (shape, doc) => rebuildSketchedShape(shape, doc),
  remeshGroup: (body, worldChildren) => remeshCsgGroupFromWorldChildren(body, worldChildren, { skipOcct: true }),
  replay: null,
};

/** A triangle drawn 20 wide, extruded 5 tall, whose bottom side is a sketch size. */
function sketchedTriangle(name: string, base = 20, expression?: string): WorkplaneShape {
  const ids = ["a", "b", "c"];
  const at = [[-base / 2, -5], [base / 2, -5], [0, 12]];
  const shape = shapeFromSketchProfile({
    points: ids.map((id, index) => ({ id, x: at[index][0], z: at[index][1], mode: "corner" as const })),
    segments: ids.map((id, index) => ({ id: `s${index}`, startId: id, endId: ids[(index + 1) % 3], kind: "line" as const })),
    images: [],
  }, 5)!;
  const sized = addLinearDimension(shape.sketchDoc!, { entityId: "s0", value: base }).doc;
  const doc = expression ? { ...sized, dimensions: sized.dimensions.map((dimension) => ({ ...dimension, expression })) } : sized;
  return { ...shape, id: name, name, sketchDoc: doc };
}

describe("what a value change needs", () => {
  it("is nothing when the values change no size", async () => {
    const body = withValues(box("a", 20, 20, 20, { drivenBy: { Width: "w" } }), [{ name: "w", expression: "20" }]);
    const added = { ...body, values: [...body.values!, { name: "spare", expression: "5" }] };
    const outcome = await rebuildBody(added, undefined, plainEngine, { live: body });
    expect(outcome).toMatchObject({ status: "unchanged", problems: [] });
  });

  it("is only its own settings for a single part, which then go the way a typed size goes", async () => {
    const body = withValues(box("a", 20, 20, 20, { drivenBy: { Width: "w", Height: "w / 2" } }), [{ name: "w", expression: "20" }]);
    const outcome = await rebuildBody(setValue(body, "w", "30"), undefined, plainEngine, { live: body });
    expect(outcome.status).toBe("settings");
    if (outcome.status !== "settings") return;
    expect(outcome.patch).toMatchObject({ width: 30, height: 15 });
    expect(withDrivenSettings(setValue(body, "w", "30"))).toMatchObject({ width: 30, height: 15 });
  });

  it("tells a part that redraws in a frame from one that has to be rebuilt", async () => {
    expect(valuesChangeIsInstant(box("a"))).toBe(true);
    expect(valuesChangeIsInstant(cylinder("c", 8, 10))).toBe(true);
    expect(valuesChangeIsInstant(sketchedTriangle("t"))).toBe(false);
    expect(valuesChangeIsInstant(await group([box("a"), cylinder("h", 8, 30, { hole: true })]))).toBe(false);
    expect(valuesChangeIsInstant({ ...box("a"), edgeTreatments: [{ kind: "fillet", amount: 1, edgeCount: 4 }] })).toBe(false);
    expect(valuesChangeIsInstant(sceneShape({ id: "g", name: "Gear", kind: "gear", color: "#2aa77e" }))).toBe(false);
  });
});

describe("a group rebuilt from its values", () => {
  it("resizes a hole cutter, and keeps following the group's values the second time too", async () => {
    let body = withValues(await group([box("plate", 40, 40, 10), cylinder("bore", 8, 30, { hole: true, elevation: -10 })]), [{ name: "d", expression: "8" }]);
    body = follow(body, "bore", { Width: "d", Length: "d" });
    for (const diameter of [16, 12]) {
      const outcome = rebuilt(await rebuildBody(setValue(body, "d", String(diameter)), undefined, plainEngine, { live: body }));
      expect(outcome.problems).toEqual([]);
      expect(partNamed(outcome.body, "bore")).toMatchObject({ width: diameter, depth: diameter, hole: true });
      // The cutter is still the group's part, with no copy of the group's value hiding it.
      expect(partNamed(outcome.body, "bore").values).toBeUndefined();
      expect(outcome.body.values).toEqual([{ name: "d", expression: String(diameter) }]);
      const expected = 40 * 40 * 10 - Math.PI * (diameter / 2) ** 2 * 10;
      expect(Math.abs(meshVolume(outcome.body) - expected) / expected).toBeLessThan(0.02);
      body = outcome.body;
    }
  }, 60000);

  it("reaches a part two groups deep, through the values of each group around it", async () => {
    const inner = await group([box("plate", 40, 40, 10), cylinder("bore", 8, 30, { hole: true, elevation: -10 })]);
    let body = withValues(await group([{ ...inner, name: "inner", values: [{ name: "d", expression: "outer / 2" }] }, box("rail", 10, 60, 10, { x: 40 })]), [{ name: "outer", expression: "16" }]);
    body = follow(body, "bore", { Width: "d", Length: "d" });
    expect(planValues(body).errors).toEqual([]);
    for (const outer of [24, 20]) {
      const outcome = rebuilt(await rebuildBody(setValue(body, "outer", String(outer)), undefined, plainEngine, { live: body }));
      expect(outcome.problems).toEqual([]);
      expect(partNamed(outcome.body, "bore").width).toBeCloseTo(outer / 2, 6);
      const expected = 40 * 40 * 10 - Math.PI * (outer / 4) ** 2 * 10 + 10 * 60 * 10;
      expect(Math.abs(meshVolume(outcome.body) - expected) / expected).toBeLessThan(0.02);
      // The inner group kept its own value, and the rail did not move.
      expect(partNamed(outcome.body, "inner").values).toEqual([{ name: "d", expression: "outer / 2" }]);
      body = outcome.body;
    }
  }, 60000);

  it("rebuilds a sketched part two groups deep from its sketch", async () => {
    const inner = await group([sketchedTriangle("wedge", 20, "w"), box("foot", 6, 6, 5, { x: 30 })]);
    let body = withValues(await group([{ ...inner, name: "inner" }, box("rail", 10, 10, 5, { z: 40 })]), [{ name: "w", expression: "20" }]);
    const before = meshVolume(body);
    const outcome = rebuilt(await rebuildBody(setValue(body, "w", "30"), undefined, plainEngine, { live: body }));
    expect(outcome.problems).toEqual([]);
    const wedge = partNamed(outcome.body, "wedge");
    expect(wedge.sketchDoc?.dimensions[0]).toMatchObject({ value: 30, expression: "w" });
    expect(wedge.width).toBeCloseTo(30, 3);
    // The triangle's base went from 20 to 30 with its height unchanged, so its volume grew by half.
    const triangleBefore = (20 * 17 / 2) * 5;
    expect(meshVolume(outcome.body) - before).toBeCloseTo(triangleBefore / 2, 0);
    body = outcome.body;
    const back = rebuilt(await rebuildBody(setValue(body, "w", "20"), undefined, plainEngine, { live: body }));
    expect(meshVolume(back.body)).toBeCloseTo(before, 0);
  }, 60000);

  it("moves a part by its place in the group, measured from the first part", async () => {
    let body = withValues(await group([box("base", 40, 20, 5), box("post", 6, 6, 20, { x: 10 })]), [{ name: "gap", expression: "10" }]);
    const post = partNamed(body, "post");
    const base = partNamed(body, "base");
    expect(post.x - base.x).toBeCloseTo(10, 6);
    body = follow(body, "post", { "Offset right": "gap", "Offset up": "gap / 2" });
    for (const gap of [-12, 14]) {
      const outcome = rebuilt(await rebuildBody(setValue(body, "gap", String(gap)), undefined, plainEngine, { live: body }));
      expect(outcome.problems).toEqual([]);
      const moved = partNamed(outcome.body, "post");
      const anchor = partNamed(outcome.body, "base");
      expect(moved.x - anchor.x).toBeCloseTo(gap, 6);
      expect((moved.elevation ?? 0) - (anchor.elevation ?? 0)).toBeCloseTo(gap / 2, 6);
      // The same again changes nothing: the place is measured from a part, not from the group's shifting middle.
      const again = await rebuildBody(outcome.body, undefined, plainEngine, { live: outcome.body });
      expect(again.status).toBe("unchanged");
      body = outcome.body;
    }
    // The first part is what the others are measured from, so it has no place of its own to set.
    const anchored = follow(body, "base", { "Offset right": "gap" });
    expect(valueProblems(anchored).join(" ")).toMatch(/no Offset right setting/);
  }, 60000);

  it("makes a pattern's copies again when its count or its first part follows a value", async () => {
    const hole = cylinder("peg", 4, 30, { hole: true, x: -15, elevation: -10 });
    const params = { countX: 3, countZ: 1, spacingX: 10, spacingZ: 10 };
    const copies = tagLinearPatternInstances(linearPatternInstances([hole], params, params), hole, params, "pattern-1");
    expect(copies).toHaveLength(3);
    let body = withValues(await group([box("plate", 60, 20, 10), ...copies]), [{ name: "n", expression: "3" }, { name: "d", expression: "4" }]);
    const source = (body.groupedShapes ?? []).find((part) => part.patternFeature?.role === "source")!;
    body = withChangedPart(body, source.id, (part) => ({ ...part, drivenBy: { "Copies across": "n", Width: "d", Length: "d" } }));
    const volumeWith = (count: number, diameter: number) => 60 * 20 * 10 - count * Math.PI * (diameter / 2) ** 2 * 10;

    const more = rebuilt(await rebuildBody(setValue(body, "n", "5"), undefined, plainEngine, { live: body }));
    expect(more.problems).toEqual([]);
    const members = (shape: WorkplaneShape) => (shape.groupedShapes ?? []).filter((part) => part.patternFeature?.id === "pattern-1");
    expect(members(more.body)).toHaveLength(5);
    expect(members(more.body).filter((part) => part.patternFeature?.role === "source")).toHaveLength(1);
    expect(new Set((more.body.groupedShapes ?? []).map((part) => part.id)).size).toBe(6);
    expect(Math.abs(meshVolume(more.body) - volumeWith(5, 4)) / volumeWith(5, 4)).toBeLessThan(0.02);
    // A copy is placed by its pattern: it does not carry the pattern's own sums.
    expect(members(more.body).filter((part) => part.patternFeature?.role === "instance").every((part) => !part.drivenBy?.["Copies across"])).toBe(true);

    const wider = rebuilt(await rebuildBody(setValue(more.body, "d", "7"), undefined, plainEngine, { live: more.body }));
    expect(members(wider.body).every((part) => Math.abs(part.width - 7) < 1e-6)).toBe(true);
    expect(Math.abs(meshVolume(wider.body) - volumeWith(5, 7)) / volumeWith(5, 7)).toBeLessThan(0.02);

    const fewer = rebuilt(await rebuildBody(setValue(wider.body, "n", "2"), undefined, plainEngine, { live: wider.body }));
    expect(members(fewer.body)).toHaveLength(2);
    expect(valueProblems(fewer.body)).toEqual([]);
  }, 60000);

  it("gives the same group as changing the part by hand", async () => {
    let body = withValues(await group([box("plate", 40, 40, 10), cylinder("bore", 8, 30, { hole: true, elevation: -10 })]), [{ name: "d", expression: "8" }]);
    body = follow(body, "bore", { Width: "d", Length: "d" });
    const byValue = rebuilt(await rebuildBody(setValue(body, "d", "14"), undefined, plainEngine, { live: body }));
    // By hand: type 14 into both boxes of the cutter, with no sums anywhere.
    const plain = await group([box("plate", 40, 40, 10), cylinder("bore", 8, 30, { hole: true, elevation: -10 })]);
    const typed = withChangedPart(plain, partNamed(plain, "bore").id, (part) => withTypedSetting(withTypedSetting(part, "Width", 14), "Length", 14));
    const byHand = rebuilt(await rebuildBody(typed, undefined, plainEngine, { live: plain }));
    expect(meshVolume(byValue.body)).toBeCloseTo(meshVolume(byHand.body), 3);
    expect([byValue.body.width, byValue.body.depth, byValue.body.height]).toEqual([byHand.body.width, byHand.body.depth, byHand.body.height]);
  }, 60000);
});

describe("what could not follow, in plain words", () => {
  it("names a value that does not exist, a size past its range and a number that has to be whole", () => {
    const gear = sceneShape({ id: "gear", name: "Gear", kind: "gear", color: "#2aa77e", gearSpec: { teeth: 20, module: 2 }, drivenBy: { Teeth: "count / 2" }, values: [{ name: "count", expression: "15" }] });
    expect(valueProblems(gear)).toEqual(["Teeth: count / 2 comes to 7.5, but this setting can only be 8."]);
    const wide = box("a", 20, 20, 20, { drivenBy: { Width: "w * 100", Height: "missing + 1" }, values: [{ name: "w", expression: "50" }] });
    const problems = valueProblems(withDrivenSettings(wide));
    expect(problems).toContain("Width: w * 100 comes to 5000, but this setting can only be 2000.");
    expect(problems).toContain("Height: There is no value named “missing”.");
  });

  it("says which part inside a group a problem is on", async () => {
    let body = withValues(await group([box("plate", 40, 40, 10), cylinder("bore", 8, 30, { hole: true, elevation: -10 })]), [{ name: "d", expression: "8" }]);
    body = follow(body, "bore", { Width: "d / nothing" });
    expect(valueProblems(body)).toEqual(["bore Width: There is no value named “nothing”."]);
    const outcome = await rebuildBody(body, undefined, plainEngine, { live: body });
    expect(outcome).toMatchObject({ status: "unchanged", problems: ["bore Width: There is no value named “nothing”."] });
  });

  it("says when a sweep or a step cannot follow, and keeps the rest", async () => {
    const swept: WorkplaneShape = { ...sketchedTriangle("sweep", 20, "w"), sketchFinish: "sweep", values: [{ name: "w", expression: "30" }] };
    const outcome = rebuilt(await rebuildBody(swept, undefined, plainEngine, { live: swept }));
    expect(outcome.problems.join(" ")).toMatch(/sweep's sizes are changed in its sketch/);
    expect(outcome.body.values).toEqual(swept.values);

    const step: PartFeature = { ...hollowPartFeature("h", { thickness: 2, openings: ["top"], corners: "sharp", cornerRadius: 0 }), sizeFollows: "wall - 5" };
    const hollowed = withValues({ ...box("cup"), features: [step], featureBase: box("cup") }, [{ name: "wall", expression: "3" }]);
    expect(valueProblems(hollowed)).toEqual(["Hollow 2 mm: wall - 5 comes to -2. A step's size has to be more than 0."]);
  });

  it("stops when a newer change takes over, without finishing", async () => {
    let body = withValues(await group([box("plate", 40, 40, 10), cylinder("bore", 8, 30, { hole: true, elevation: -10 })]), [{ name: "d", expression: "8" }]);
    body = follow(body, "bore", { Width: "d", Length: "d" });
    let joins = 0;
    let superseded = false;
    const slow: RebuildEngine = {
      ...plainEngine,
      remeshGroup: async (group, world) => {
        joins += 1;
        superseded = true;
        return plainEngine.remeshGroup(group, world);
      },
    };
    const outcome = await rebuildBody(setValue(body, "d", "16"), undefined, slow, { live: body, cancelled: () => superseded });
    expect(outcome).toEqual({ status: "cancelled" });
    expect(joins).toBe(1);
    // Cancelled before it starts: the engine is never asked.
    expect(await rebuildBody(setValue(body, "d", "16"), undefined, slow, { live: body, cancelled: () => true })).toEqual({ status: "cancelled" });
    expect(joins).toBe(1);
  }, 60000);
});

/** The four upright corner edges, picked the way a person would click them. */
function cornerEdgeIds(prepared: ReplayPrepared) {
  return prepared.edges
    .filter((edge) => edge.display && edge.selectable && edge.manifold && !edge.boundary)
    .filter((edge) => {
      const [x, , z] = edge.points;
      for (let i = 0; i + 2 < edge.points.length; i += 3) {
        if (Math.abs(edge.points[i] - x) > 1e-3 || Math.abs(edge.points[i + 2] - z) > 1e-3) return false;
      }
      return true;
    })
    .map((edge) => edge.id);
}

/** Round a part's upright corners and record the step, as the Fillet tool does. */
async function filletCorners(engine: ReplayEngine, base: WorkplaneShape, amount: number, id = "fillet"): Promise<WorkplaneShape> {
  const prepared = await engine.prepare(base, 25);
  const edgeIds = cornerEdgeIds(prepared);
  expect(edgeIds.length).toBeGreaterThanOrEqual(4);
  const recipe = { kind: "fillet" as const, amount, edgeCount: edgeIds.length, sharpAngle: 25, edgeFingerprints: fingerprintsForEdgeIds(prepared.edges, edgeIds) };
  const filleted = await engine.edgeTreatment(base, { kind: "fillet", edgeIds, amount, chamferAngle: 45, filletProfile: "round", quality: "standard" });
  return withPartFeature({ ...filleted, edgeTreatments: [...(base.edgeTreatments ?? []), recipe] }, base, edgeTreatmentPartFeature(id, recipe, prepared.edges));
}

/** Hollow a part open at the top and record the step, as the Hollow tool does. */
async function hollowOpenTop(engine: ReplayEngine, base: WorkplaneShape, thickness: number, id = "hollow"): Promise<WorkplaneShape> {
  const settings = { thickness, openings: ["top"] as Array<"top">, corners: "sharp" as const, cornerRadius: 0 };
  await engine.prepare(base, 12);
  const hollowed = await engine.hollow(base, settings);
  return withPartFeature(hollowed, base, hollowPartFeature(id, settings, base));
}

const stepFollows = (shape: WorkplaneShape, id: string, sum: string): WorkplaneShape =>
  ({ ...shape, features: shape.features?.map((step) => (step.id === id ? { ...step, sizeFollows: sum } : step)) });

const engines: Array<{ name: string; available: boolean; start: () => Promise<KernelClient & { close?: () => void }> }> = [
  { name: "desktop engine", available: hasNativeKernelExe, start: async () => spawnNativeKernelClient() },
  { name: "browser engine (WebAssembly)", available: hasWasmKernel, start: startWasmKernel },
];

for (const { name, available, start } of engines) {
  describe.skipIf(!available)(`rebuilding from values on the ${name}`, () => {
    let client: (KernelClient & { close?: () => void }) | null = null;
    const made = () => kernelEngines({ request: async (job, timeout) => (client ??= await start()).request(job, timeout) });
    afterAll(() => (client as NativeKernelClient | null)?.close?.());

    it("changes a fillet and a wall that follow values, as if each step were edited by hand", async () => {
      const { replay, rebuild } = made();
      const cup = await hollowOpenTop(replay(), await filletCorners(replay(), box("cup"), 3), 1.5);
      expect(cup.features?.map((step) => step.kind)).toEqual(["fillet", "hollow"]);
      const body = withValues(stepFollows(stepFollows(cup, "fillet", "corner"), "hollow", "wall"), [{ name: "corner", expression: "3" }, { name: "wall", expression: "1.5" }]);
      // Nothing changes while the values say what the steps already are.
      expect((await rebuildBody(body, undefined, rebuild, { live: body })).status).toBe("unchanged");

      const changed = setValue(setValue(body, "corner", "4"), "wall", "2");
      const outcome = rebuilt(await rebuildBody(changed, undefined, rebuild, { live: body }));
      expect(outcome.problems).toEqual([]);
      expect(outcome.body.features?.map((step) => [step.kind, step.kind === "hollow" ? step.thickness : step.kind === "fillet" ? step.amount : 0, step.failed, step.sizeFollows]))
        .toEqual([["fillet", 4, undefined, "corner"], ["hollow", 2, undefined, "wall"]]);
      const byHand = await hollowOpenTop(replay(), await filletCorners(replay(), box("cup"), 4), 2);
      expect(meshVolume(outcome.body)).toBeCloseTo(meshVolume(byHand), 1);
      expect(outcome.body.edgeTreatments?.[0]).toMatchObject({ kind: "fillet", amount: 4 });
      expect(outcome.body.featureBase).toBeTruthy();
      expect(outcome.body.values).toEqual(changed.values);
    }, 120000);

    it("resizes a part with steps and changes a step at once, keeping the step sizes", async () => {
      const { replay, rebuild } = made();
      const cup = await hollowOpenTop(replay(), await filletCorners(replay(), box("cup"), 3), 1.5);
      const body = withValues({ ...stepFollows(cup, "hollow", "wall"), drivenBy: { Width: "w" } }, [{ name: "w", expression: "20" }, { name: "wall", expression: "1.5" }]);
      const outcome = rebuilt(await rebuildBody(setValue(setValue(body, "w", "30"), "wall", "2"), undefined, rebuild, { live: body }));
      expect(outcome.problems).toEqual([]);
      expect(outcome.body.width).toBeCloseTo(30, 3);
      const byHand = await hollowOpenTop(replay(), await filletCorners(replay(), box("cup", 30, 20, 20), 3), 2);
      expect(meshVolume(outcome.body)).toBeCloseTo(meshVolume(byHand), 0);
    }, 120000);

    it("lets a plain number typed for a step stop it following its sum", async () => {
      const { replay, rebuild } = made();
      const filleted = await filletCorners(replay(), box("block"), 2);
      const body = withValues(stepFollows(filleted, "fillet", "corner"), [{ name: "corner", expression: "2" }]);
      const typed = { ...body, features: withTypedStepSize(body.features!, "fillet", 5) };
      expect(typed.features?.[0].sizeFollows).toBeUndefined();
      const outcome = rebuilt(await rebuildBody(typed, undefined, rebuild, { live: body }));
      const byHand = await filletCorners(replay(), box("block"), 5);
      expect(meshVolume(outcome.body)).toBeCloseTo(meshVolume(byHand), 1);
      // The value no longer reaches the step.
      const later = await rebuildBody(setValue(outcome.body, "corner", "1"), undefined, rebuild, { live: outcome.body });
      expect(later.status).toBe("unchanged");
    }, 120000);

    it("marks a step that no longer fits, says so, and keeps the steps that do", async () => {
      const { replay, rebuild } = made();
      const cup = await hollowOpenTop(replay(), await filletCorners(replay(), box("cup"), 2), 1.5);
      const body = withValues(stepFollows(cup, "fillet", "corner"), [{ name: "corner", expression: "2" }]);
      // A 30 mm round cannot go on the corners of a 20 mm box.
      const outcome = rebuilt(await rebuildBody(setValue(body, "corner", "30"), undefined, rebuild, { live: body }));
      expect(outcome.body.features?.[0].failed).toBeTruthy();
      expect(outcome.body.features?.[1].failed).toBeUndefined();
      expect(outcome.problems).toHaveLength(1);
      expect(outcome.problems[0]).toMatch(/^Fillet 30 mm no longer fits and was skipped\./);
      expect(valueProblems(outcome.body)[0]).toMatch(/^Fillet 30 mm no longer fits and was skipped\./);
      // The part is still a hollow cup, on the sharp box.
      expect(meshVolume(outcome.body)).toBeGreaterThan(0);
      expect(meshVolume(outcome.body)).toBeLessThan(20 * 20 * 20 * 0.4);
      // Putting the value back clears the mark.
      const back = rebuilt(await rebuildBody(setValue(outcome.body, "corner", "2"), undefined, rebuild, { live: outcome.body }));
      expect(back.body.features?.every((step) => !step.failed)).toBe(true);
      expect(meshVolume(back.body)).toBeCloseTo(meshVolume(cup), 1);
    }, 120000);

    it("joins a group again on this engine when a hole cutter follows a value", async () => {
      const { rebuild } = made();
      let body = withValues(await group([box("plate", 40, 40, 10), cylinder("bore", 8, 30, { hole: true, elevation: -10 })]), [{ name: "d", expression: "8" }]);
      body = follow(body, "bore", { Width: "d", Length: "d" });
      const outcome = rebuilt(await rebuildBody(setValue(body, "d", "16"), undefined, rebuild, { live: body }));
      const expected = 40 * 40 * 10 - Math.PI * 8 ** 2 * 10;
      expect(Math.abs(meshVolume(outcome.body) - expected) / expected).toBeLessThan(0.02);
      // By hand: the same parts at the new size, joined by this engine.
      const fresh = await group([box("plate", 40, 40, 10), cylinder("bore", 16, 30, { hole: true, elevation: -10 })]);
      const byHand = await rebuild.remeshGroup(fresh, restoreGroupedChildren(fresh, { preserveIds: true }));
      expect(meshVolume(outcome.body)).toBeCloseTo(meshVolume(byHand!), 1);
    }, 120000);

    it("replays a fillet on a group after a part inside it follows a value", async () => {
      const { replay, rebuild } = made();
      const plain = await group([box("plate", 40, 40, 10), cylinder("bore", 8, 30, { hole: true, elevation: -10 })]);
      const filleted = await filletCorners(replay(), plain, 3);
      expect(filleted.groupedShapes).toHaveLength(2);
      expect(filleted.featureBase).toBeUndefined();
      let body = withValues(stepFollows(filleted, "fillet", "corner"), [{ name: "d", expression: "8" }, { name: "corner", expression: "3" }]);
      body = follow(body, "bore", { Width: "d", Length: "d" });
      const outcome = rebuilt(await rebuildBody(setValue(setValue(body, "d", "14"), "corner", "5"), undefined, rebuild, { live: body }));
      expect(outcome.problems).toEqual([]);
      expect(outcome.body.features?.[0]).toMatchObject({ kind: "fillet", amount: 5, sizeFollows: "corner" });
      expect(partNamed(outcome.body, "bore").width).toBeCloseTo(14, 6);
      const fresh = await group([box("plate", 40, 40, 10), cylinder("bore", 14, 30, { hole: true, elevation: -10 })]);
      const byHand = await filletCorners(replay(), fresh, 5);
      expect(meshVolume(outcome.body)).toBeCloseTo(meshVolume(byHand), 0);
      // Rounder corners and a wider hole both take material away.
      expect(meshVolume(outcome.body)).toBeLessThan(meshVolume(filleted));
    }, 120000);

    it("replays the steps of a part inside a group when that part is resized by a value", async () => {
      const { replay, rebuild } = made();
      const knob = await filletCorners(replay(), box("knob", 10, 10, 10, { x: 30 }), 2);
      let body = withValues(await group([box("plate", 40, 40, 10), knob]), [{ name: "k", expression: "10" }]);
      expect(partNamed(body, "knob").features).toHaveLength(1);
      body = follow(body, "knob", { Width: "k" });
      const outcome = rebuilt(await rebuildBody(setValue(body, "k", "16"), undefined, rebuild, { live: body }));
      expect(outcome.problems).toEqual([]);
      const resized = partNamed(outcome.body, "knob");
      expect(resized.width).toBeCloseTo(16, 2);
      expect(resized.features?.[0]).toMatchObject({ kind: "fillet", amount: 2 });
      // The knob's corners stayed 2 mm round: the same as rounding a 16 mm knob by hand.
      const byHand = await filletCorners(replay(), box("knob", 16, 10, 10), 2);
      expect(meshVolume({ ...resized, importedMesh: resized.importedMesh })).toBeCloseTo(meshVolume(byHand), 0);
    }, 120000);
  });
}
