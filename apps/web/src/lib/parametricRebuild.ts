import { isProOnlyLabel } from "@/components/workplane/proProperties";
import { drivenByWithout, drivenPartChanges, type DrivenPart } from "@/components/workplane/valueDrivenPatches";
import { inferCsgOp } from "@/lib/csgTree";
import { cleanShapePatch, remeshCsgGroupFromWorldChildren, restoreGroupedChildren } from "@/lib/editorBoolean";
import { cloneAsGroupChild, keepStoredChildValues } from "@/lib/editorGroup";
import { placeReplayedShape, replayPartFeatures, type ReplayEngine, type ReplayResult } from "@/lib/featureReplay";
import {
  bakedPartSize,
  edgeTreatmentsForSteps,
  hasPartSteps,
  partFeatureShortLabel,
  partStepSize,
  rebuildsOnResize,
  resizedFeatureBase,
  stepsCanReplay,
} from "@/lib/partFeatures";
import { rebuildCircularPatternFeature, rebuildLinearPatternFeature, replacePatternFeature } from "@/lib/patternFeature";
import type { SketchDoc } from "@/lib/sketch/types";
import { rebuildSketchedShape, type SketchRebuild } from "@/lib/sketchRebuild";
import { canonicalizeShape, shapeDepth, shapeWidth, workplaneShapesEqual } from "@/lib/workplaneShapes";
import type { PartFeature, ShapeKind, WorkplaneShape } from "@/types/sketchforge";

/**
 * Mintr's scene is already a recipe: a box is its numbers, a sketched part is its sketch and a
 * height, a group is its parts and how they join, and a fillet, chamfer, hollow or pull is a
 * recorded step. Every mesh is a cache. `rebuildBody` is the one place that walks a top-level
 * part from its values down and makes the caches again:
 *
 *   1. work out the part's values against the values around it,
 *   2. set the settings that follow sums, on the part and on every part inside it,
 *   3. rebuild a sketched part from its sketch when a sketch size changed,
 *   4. do the same for the parts grouped inside, however deep,
 *   5. join each group again from its rebuilt parts,
 *   6. replay the recorded steps, marking any that no longer fit,
 *   7. say what could not follow, in plain words.
 *
 * Changing a value, resizing a part that has steps, and editing a step all come here, so there
 * is one place to be right and one place to test on both engines. It asks the engine only for
 * jobs that already exist (a sketch extrude, a group's join, the steps' own tools).
 */

/** The work `rebuildBody` hands to the CAD engine. The editor answers with its live tools. */
export type RebuildEngine = {
  /** A sketched part built again from a changed sketch, where the part sits in the world. */
  rebuildSketch: (shape: WorkplaneShape, doc: SketchDoc) => Promise<SketchRebuild>;
  /** A group joined again from its parts, given where each sits in the world. Null when it cannot be. */
  remeshGroup: (group: WorkplaneShape, worldChildren: WorkplaneShape[]) => Promise<WorkplaneShape | null>;
  /** The calls a step replay makes, or null where steps cannot be replayed. */
  replay: (() => ReplayEngine) | null;
};

/** The engine as the editor's own code paths use it. `replay` is the editor's, since it owns the CAD session. */
export function editorRebuildEngine(replay: RebuildEngine["replay"], onNotice?: (message: string) => void): RebuildEngine {
  return {
    rebuildSketch: (shape, doc) => rebuildSketchedShape(shape, doc, { exact: true }),
    remeshGroup: (group, worldChildren) => remeshCsgGroupFromWorldChildren(group, worldChildren, { onNotice }),
    replay,
  };
}

export type RebuildOptions = {
  /** Millimeters per workplane unit: plain numbers in sums are in this unit. */
  unitMm?: number;
  /** The part as it is in the design now, to tell what a change touched. Without it only sums count. */
  live?: WorkplaneShape;
  /** True once a newer change has taken over. The rebuild stops at its next step and reports "cancelled". */
  cancelled?: () => boolean;
};

export type RebuildOutcome =
  /** A newer change took over before this one finished. Nothing should be committed. */
  | { status: "cancelled" }
  /** Nothing needed rebuilding. `body` carries any new values and sums, with the geometry it had. */
  | { status: "unchanged"; body: WorkplaneShape; problems: string[] }
  /**
   * A single part whose values only change its own settings. Setting them through the same path
   * a typed size takes rebuilds everything that follows a size (threads, text, a part's steps).
   */
  | { status: "settings"; body: WorkplaneShape; patch: Partial<WorkplaneShape>; problems: string[] }
  /** The part was rebuilt. `legacyEdgeSteps` asks the caller to put back fillets made before steps were recorded. */
  | { status: "rebuilt"; body: WorkplaneShape; problems: string[]; legacyEdgeSteps: boolean };

class RebuildCancelled extends Error {}

type Context = {
  engine: RebuildEngine;
  unitMm: number;
  cancelled?: () => boolean;
  problems: string[];
  legacyEdgeSteps: boolean;
};

function stopIfCancelled(context: Context) {
  if (context.cancelled?.()) throw new RebuildCancelled();
}

/** Two parts are the same apart from their values, sums, steps, sketch and the parts inside them. */
function sameOwnSettings(a: WorkplaneShape, b: WorkplaneShape) {
  return workplaneShapesEqual({ ...a, values: b.values, drivenBy: b.drivenBy, features: b.features, sketchDoc: b.sketchDoc, groupedShapes: b.groupedShapes }, b);
}

/** A step was added, removed, switched or resized: the part's steps have to run again. */
function stepsDiffer(a: readonly PartFeature[] | undefined, b: readonly PartFeature[] | undefined) {
  if (a === b) return false;
  if ((a?.length ?? 0) !== (b?.length ?? 0)) return true;
  return (a ?? []).some((step, index) => {
    const other = b![index];
    return step.id !== other.id || step.kind !== other.kind || Boolean(step.suppressed) !== Boolean(other.suppressed) || Math.abs(partStepSize(step) - partStepSize(other)) > 1e-9;
  });
}

function sizeOf(shape: WorkplaneShape): [number, number, number] {
  return [shapeWidth(shape), shape.height, shapeDepth(shape)];
}

function sizeDiffers(a: WorkplaneShape, b: WorkplaneShape) {
  const before = sizeOf(a);
  return sizeOf(b).some((size, axis) => Math.abs(size - before[axis]) > 1e-4);
}

export type StepReplay = {
  /** The part rebuilt from its steps and put where `live` is. */
  rebuilt: WorkplaneShape;
  steps: ReplayResult["steps"];
};

/**
 * A part rebuilt from `features` on `start` (the part before its steps), then put where `live`
 * is now. A group's start is its freshly joined pieces; any other part's is its stored base.
 * `resized` says the part was rebuilt at a new size, so it is not stretched to that size after.
 */
export async function replayStepsOnPart(
  live: WorkplaneShape,
  features: readonly PartFeature[],
  start: WorkplaneShape,
  engine: ReplayEngine,
  options: { resized?: boolean } = {},
): Promise<StepReplay> {
  const result = await replayPartFeatures(start, features, engine);
  const placed = placeReplayedShape(result.shape, options.resized ? { ...live, cadBrepFrame: undefined } : live, result.lastApplied);
  const rebuilt = canonicalizeShape({
    ...placed,
    features: result.features.length ? result.features : undefined,
    featureBase: result.features.length && !live.groupedShapes?.length ? start : undefined,
    edgeTreatments: edgeTreatmentsForSteps(result.features, live),
    edgeTreatmentHistory: undefined,
    edgeResizeMode: live.edgeResizeMode,
    csg: live.csg ? { ...live.csg, dirty: false } : live.csg,
  });
  return { rebuilt, steps: result.steps };
}

/** A step that stopped fitting, said the way the Features list says it. */
function stepProblems(features: readonly PartFeature[], steps: ReplayResult["steps"], named: string): string[] {
  return steps.filter((step) => !step.ok).map((step) => {
    const feature = features.find((entry) => entry.id === step.id);
    const what = feature ? partFeatureShortLabel(feature) : "A step";
    return `${named}${what} no longer fits and was skipped.${step.message ? ` ${step.message}` : ""}`;
  });
}

/** Replay a single part's own steps on its stored base, grown to the part's new size if it was resized. */
async function replayOwnSteps(part: WorkplaneShape, resized: boolean, context: Context, named: string): Promise<WorkplaneShape> {
  const features = part.features;
  if (!features?.length || !part.featureBase || !stepsCanReplay(features)) {
    // Fillets from before steps were recorded are put back by the editor's older path.
    if (part.edgeTreatments?.length) context.legacyEdgeSteps = true;
    return part;
  }
  if (!context.engine.replay) {
    context.problems.push(`${named}The steps on this part could not be rebuilt here.`);
    return part;
  }
  let start = part.featureBase;
  const baked = bakedPartSize(part);
  const grow = resized && baked && rebuildsOnResize(part);
  if (grow) start = resizedFeatureBase(start, baked, sizeOf(part));
  stopIfCancelled(context);
  const replay = await replayStepsOnPart(part, features, start, context.engine.replay(), { resized: Boolean(grow) });
  stopIfCancelled(context);
  context.problems.push(...stepProblems(features, replay.steps, named));
  return replay.rebuilt;
}

/**
 * One part that is not a group, already carrying its new settings: rebuilt from its sketch when a
 * sketch size changed, then its steps replayed when the sketch, a step size or its size changed.
 */
async function rebuildSinglePart(
  part: WorkplaneShape,
  resized: boolean,
  driven: Pick<DrivenPart, "sketchDoc" | "features">,
  stepsChanged: boolean,
  context: Context,
  named: string,
): Promise<WorkplaneShape> {
  let next = driven.features ? { ...part, features: driven.features } : part;
  let replay = stepsChanged || Boolean(driven.features);
  let grown = resized;
  if (driven.sketchDoc) {
    stopIfCancelled(context);
    const rebuild = await context.engine.rebuildSketch(next, driven.sketchDoc);
    stopIfCancelled(context);
    if (rebuild.ok) {
      // The sketch makes a new body: its steps start again from it, at the size it came out.
      next = rebuild.shape;
      replay = replay || hasPartSteps(next);
      grown = false;
    } else {
      context.problems.push(`${named}${rebuild.message}`);
    }
  }
  if (hasPartSteps(next) && (replay || (grown && rebuildsOnResize(next)))) {
    next = await replayOwnSteps(next, grown, context, named);
  }
  return next;
}

/** A pattern's copies inside a group, made again from the part they were copied from. */
function rebuildGroupPattern(parts: WorkplaneShape[], before: readonly WorkplaneShape[], source: WorkplaneShape, named: string, problems: string[]): WorkplaneShape[] {
  const feature = source.patternFeature!;
  const old = before.filter((part) => part.patternFeature?.id === feature.id);
  let rebuilt: WorkplaneShape[] | null = null;
  if (feature.kind === "linear" && feature.linear) {
    rebuilt = rebuildLinearPatternFeature(source, feature.linear, feature.id);
  } else if (feature.kind === "circular" && feature.circular) {
    // The stored centre is where the pattern was made, in the world. Inside a group the copies
    // sit evenly round their own middle, which is the centre in the group's frame.
    if (old.length < 2) {
      problems.push(`${named}The pattern of ${source.name} could not be rebuilt, because its copies are no longer in this group.`);
      return parts;
    }
    const centre = { x: old.reduce((sum, part) => sum + part.x, 0) / old.length, z: old.reduce((sum, part) => sum + part.z, 0) / old.length };
    const stored = feature.circular;
    rebuilt = rebuildCircularPatternFeature(source, { ...stored, center: centre }, feature.id).map((part) => (
      part.patternFeature?.circular ? { ...part, patternFeature: { ...part.patternFeature, circular: { ...part.patternFeature.circular, center: stored.center } } } : part
    ));
  }
  if (!rebuilt) return parts;
  // A copy keeps the id it had, so a part picked in the Parts tree stays picked.
  const oldIds = new Map(old.filter((part) => part.patternFeature?.role === "instance").map((part) => [part.patternFeature!.instanceIndex, part.id]));
  const taken = new Set(parts.filter((part) => part.patternFeature?.id !== feature.id).map((part) => part.id));
  const copies = rebuilt.map((part) => {
    if (part.id === source.id) return part;
    const kept = oldIds.get(part.patternFeature?.instanceIndex);
    const id = kept && !taken.has(kept) ? kept : part.id;
    taken.add(id);
    // A copy is placed by its pattern, so it does not carry the sums for the pattern or for a place in the group.
    const sums = drivenByWithout(part.drivenBy, Object.keys(part.drivenBy ?? {}).filter(isProOnlyLabel));
    const { drivenBy: _sums, ...rest } = part;
    return { ...rest, id, ...(sums ? { drivenBy: sums } : {}) } as WorkplaneShape;
  });
  return replacePatternFeature(parts, copies, feature.id);
}

/**
 * A group, already carrying its own new settings, rebuilt from the parts inside it. `forced` says
 * the group itself changed (its size, or a step's size), so it is joined again whatever its parts did.
 */
async function rebuildGroup(
  group: WorkplaneShape,
  live: WorkplaneShape | undefined,
  scope: ReadonlyMap<string, number>,
  forced: boolean,
  context: Context,
  named: string,
): Promise<{ shape: WorkplaneShape; changed: boolean }> {
  const stored = group.groupedShapes ?? [];
  const liveById = new Map((live?.groupedShapes ?? []).map((child) => [child.id, child]));
  let dirty = forced;

  // Each part's settings, in the group's own frame, where a part's place is measured.
  const drivenById = new Map<string, DrivenPart>();
  const changedIds = new Set<string>();
  let local = stored.map((child) => {
    const driven = drivenPartChanges(child, scope, context.unitMm, { siblings: stored }, `${child.name || "A part"} `);
    context.problems.push(...driven.problems);
    drivenById.set(child.id, driven);
    const liveChild = liveById.get(child.id);
    const patched = Object.keys(driven.patch).length ? canonicalizeShape({ ...child, ...cleanShapePatch(driven.patch) }) : child;
    if (patched !== child || (liveChild && liveChild !== child && !sameOwnSettings(liveChild, child))) changedIds.add(child.id);
    return patched;
  });

  // A pattern follows the part it was made from: when that part or its pattern changed, its copies are made again.
  for (const source of local.filter((part) => part.patternFeature?.role === "source" && changedIds.has(part.id))) {
    const next = rebuildGroupPattern(local, stored, source, named, context.problems);
    if (next !== local) {
      local = next;
      for (const part of local) if (part.patternFeature?.id === source.patternFeature?.id) changedIds.add(part.id);
      dirty = true;
    }
  }
  if (local.length !== stored.length) dirty = true;

  const world = keepStoredChildValues(restoreGroupedChildren({ ...group, groupedShapes: local }, { preserveIds: true }), local);
  const storedById = new Map(stored.map((child) => [child.id, child]));
  const nextWorld: WorkplaneShape[] = [];
  for (let index = 0; index < world.length; index += 1) {
    const child = world[index];
    const before = storedById.get(child.id);
    const liveChild = liveById.get(child.id);
    const driven = drivenById.get(child.id) ?? { sketchDoc: null, features: null, scope: new Map(scope) };
    const childName = `${child.name || "A part"}: `;
    if (child.groupedShapes?.length) {
      const inner = await rebuildGroup(
        driven.features ? { ...child, features: driven.features } : child,
        liveChild,
        driven.scope,
        changedIds.has(child.id) || Boolean(driven.features) || stepsDiffer(liveChild?.features, before?.features),
        context,
        childName,
      );
      if (inner.changed) dirty = true;
      nextWorld.push(inner.shape);
      continue;
    }
    const stepsChanged = Boolean(liveChild && before && stepsDiffer(liveChild.features, before.features));
    if (!changedIds.has(child.id) && !driven.sketchDoc && !driven.features && !stepsChanged) {
      nextWorld.push(child);
      continue;
    }
    dirty = true;
    const resized = Boolean(before && sizeDiffers(liveChild ?? before, local[index]));
    nextWorld.push(await rebuildSinglePart(child, resized, driven, stepsChanged, context, childName));
  }

  if (!dirty) return { shape: group, changed: false };

  stopIfCancelled(context);
  const body = { ...group, groupedShapes: local };
  const remeshed = await context.engine.remeshGroup(body, nextWorld);
  stopIfCancelled(context);
  if (!remeshed) {
    context.problems.push(`${named}Mintr could not join ${group.name || "this group"} again, so it kept the shape it had.`);
    // The parts keep their new settings; the group shows its last good shape until it can be joined.
    const kept = keepStoredChildValues(nextWorld, local).map((child) => cloneAsGroupChild(child, group.x, group.z, group.elevation ?? 0, true));
    const op = group.csg?.op ?? inferCsgOp(group) ?? "union";
    return { shape: { ...group, groupedShapes: kept, csg: { ...(group.csg ?? { op, version: 1 }), dirty: true } }, changed: true };
  }

  let next = remeshed;
  const steps = next.features;
  if (steps?.length && stepsCanReplay(steps)) {
    if (context.engine.replay) {
      // A group's steps start from its freshly joined pieces.
      const start: WorkplaneShape = { ...next, features: undefined, edgeTreatments: undefined, edgeTreatmentHistory: undefined };
      const replay = await replayStepsOnPart(next, steps, start, context.engine.replay());
      stopIfCancelled(context);
      context.problems.push(...stepProblems(steps, replay.steps, named));
      next = replay.rebuilt;
    } else {
      context.problems.push(`${named}The steps on ${group.name || "this group"} could not be rebuilt here.`);
    }
  } else if (hasPartSteps(next)) {
    context.legacyEdgeSteps = true;
  }
  return { shape: next, changed: true };
}

/** What a change to a single part needs: nothing, only its settings, or a rebuild of its geometry. */
function singlePartNeeds(body: WorkplaneShape, live: WorkplaneShape | undefined, driven: DrivenPart) {
  const stepsChanged = Boolean(live && stepsDiffer(live.features, body.features));
  const geometry = Boolean(driven.sketchDoc || driven.features || stepsChanged);
  const settings = Object.keys(driven.patch).length > 0 || Boolean(live && !sameOwnSettings(live, body));
  return { stepsChanged, geometry, settings };
}

/**
 * True when changing this part's values only ever sets its own numbers, which the viewport draws
 * again in a frame: a plain shape with no steps, no sketch and nothing grouped in it. A slider on
 * such a part can move the part while it is dragged; every other part rebuilds when it is let go.
 */
export function valuesChangeIsInstant(body: WorkplaneShape): boolean {
  const plain: ShapeKind[] = ["box", "cylinder", "sphere", "cone", "pyramid", "roof", "roundRoof", "halfSphere", "torus", "tube", "ring", "wedge", "polygon", "icosahedron"];
  return plain.includes(body.kind)
    && !body.groupedShapes?.length
    && !hasPartSteps(body)
    && !body.sketchDoc
    && !body.importedMesh
    && !body.cadBrep
    && !body.generated
    && !body.patternFeature;
}

/**
 * The part with its values worked out and its own settings set, without touching the engine.
 * This is what a slider shows while it is dragged on a part that redraws in a frame.
 */
export function withDrivenSettings(body: WorkplaneShape, outerScope?: ReadonlyMap<string, number>, unitMm = 1): WorkplaneShape {
  const driven = drivenPartChanges(body, outerScope, unitMm);
  return Object.keys(driven.patch).length ? canonicalizeShape({ ...body, ...cleanShapePatch(driven.patch) }) : body;
}

/**
 * What a top-level part's values, and the values of the parts inside it, cannot do right now, in
 * plain words. Read straight from the part, so the Values card can show it at any time.
 */
export function valueProblems(body: WorkplaneShape, unitMm = 1): string[] {
  const problems: string[] = [];
  const visit = (part: WorkplaneShape, outer: ReadonlyMap<string, number> | undefined, siblings: readonly WorkplaneShape[] | undefined, named: string) => {
    const driven = drivenPartChanges(part, outer, unitMm, { siblings }, named);
    problems.push(...driven.problems);
    for (const step of part.features ?? []) {
      if (step.failed && !step.suppressed) problems.push(`${named}${partFeatureShortLabel(step)} no longer fits and was skipped. ${step.failed}`);
    }
    for (const child of part.groupedShapes ?? []) visit(child, driven.scope, part.groupedShapes, `${child.name || "A part"} `);
  };
  visit(body, undefined, undefined, "");
  return [...new Set(problems)];
}

/**
 * Rebuild a top-level part after its values, its settings, a step or a part inside it changed.
 * `outerScope` holds values from outside the part (none today; the design's own list later).
 * Nothing is committed here: the caller puts the returned body in the design as one undo step.
 */
export async function rebuildBody(
  body: WorkplaneShape,
  outerScope: ReadonlyMap<string, number> | undefined,
  engine: RebuildEngine,
  options: RebuildOptions = {},
): Promise<RebuildOutcome> {
  const context: Context = { engine, unitMm: options.unitMm ?? 1, cancelled: options.cancelled, problems: [], legacyEdgeSteps: false };
  const live = options.live;
  try {
    stopIfCancelled(context);
    const driven = drivenPartChanges(body, outerScope, context.unitMm);
    context.problems.push(...driven.problems);
    const patched = Object.keys(driven.patch).length ? canonicalizeShape({ ...body, ...cleanShapePatch(driven.patch) }) : body;

    if (body.groupedShapes?.length) {
      const forced = patched !== body || Boolean(driven.features) || Boolean(live && (!sameOwnSettings(live, body) || stepsDiffer(live.features, body.features)));
      const result = await rebuildGroup(driven.features ? { ...patched, features: driven.features } : patched, live, driven.scope, forced, context, "");
      if (!result.changed) return { status: "unchanged", body, problems: context.problems };
      return { status: "rebuilt", body: result.shape, problems: context.problems, legacyEdgeSteps: context.legacyEdgeSteps };
    }

    const needs = singlePartNeeds(body, live, driven);
    if (!needs.geometry) {
      if (!needs.settings) return { status: "unchanged", body, problems: context.problems };
      return { status: "settings", body, patch: driven.patch, problems: context.problems };
    }
    const resized = sizeDiffers(live ?? body, patched);
    const rebuilt = await rebuildSinglePart(patched, resized, driven, needs.stepsChanged, context, "");
    return { status: "rebuilt", body: rebuilt, problems: context.problems, legacyEdgeSteps: context.legacyEdgeSteps };
  } catch (error) {
    if (error instanceof RebuildCancelled) return { status: "cancelled" };
    throw error;
  }
}

/**
 * Whether a change can be made without the engine: nothing to do, or only a single part's own
 * settings. Null when the part has to be rebuilt. The same test `rebuildBody` makes first, so a
 * caller can decide before starting anything slow.
 */
export function instantChange(
  body: WorkplaneShape,
  live: WorkplaneShape | undefined,
  outerScope?: ReadonlyMap<string, number>,
  unitMm = 1,
): { status: "unchanged" | "settings"; patch: Partial<WorkplaneShape>; problems: string[] } | null {
  if (body.groupedShapes?.length) return null;
  const driven = drivenPartChanges(body, outerScope, unitMm);
  const needs = singlePartNeeds(body, live, driven);
  if (needs.geometry) return null;
  return { status: needs.settings ? "settings" : "unchanged", patch: driven.patch, problems: driven.problems };
}
