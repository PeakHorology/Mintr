import { csgTreeContainsId, inferCsgOp } from "@/lib/csgTree";
import { stepsReplaceSnapshots } from "@/lib/partFeatures";
import type { CsgOp, PartFeature, WorkplaneShape } from "@/types/sketchforge";

/**
 * The Parts tree: every part in the design, with its steps (fillets, walls, pulls) and the parts
 * inside each group under it, at any depth. Newest first at every level, like the parts list
 * before it: a group's steps come before the parts it was built from, since they were applied
 * later. The rows are plain data so the rail can draw them and tests can check them without React.
 */
export type DesignTreePartRow = {
  kind: "part";
  shape: WorkplaneShape;
  /** The top-level part this row belongs to: itself for a top-level row. */
  bodyId: string;
  /** 0 for a top-level part, 1 for a part inside it, and so on. */
  depth: number;
  /** The group this row sits in, or null for a top-level part. */
  parentId: string | null;
  /** How this group combines the parts inside it, or null for a plain part. */
  op: CsgOp | null;
  /** The row can open: it is a group with parts inside, or a part with steps. */
  hasChildren: boolean;
  expanded: boolean;
  /** Turned off inside its group, so the group is built without it. */
  off: boolean;
};

export type DesignTreeStepRow = {
  kind: "step";
  /** The top-level part the step belongs to. Only top-level parts can rebuild from their steps. */
  bodyId: string;
  shape: WorkplaneShape;
  depth: number;
  step: PartFeature;
  /** Position in the part's steps, oldest first: 0 is the first step applied. */
  index: number;
  /** How many steps the part has. */
  count: number;
};

export type DesignTreeRow = DesignTreePartRow | DesignTreeStepRow;

/** How a group combines its parts, or null when the shape is not a group. */
export function designTreeOp(shape: WorkplaneShape): CsgOp | null {
  if (!shape.groupedShapes?.length) return null;
  return shape.csg?.op ?? inferCsgOp(shape);
}

/** The short word shown beside a group in the tree. */
export function designTreeGroupLabel(op: CsgOp | null): string | null {
  if (!op) return null;
  if (op === "assemble") return "Tie";
  if (op === "intersect") return "Intersect";
  if (op === "hull") return "Shrink wrap";
  if (op === "smooth") return "Smooth";
  return "Group";
}

/** The parts inside a group, newest first. */
export function designTreeChildren(shape: WorkplaneShape): WorkplaneShape[] {
  return [...(shape.groupedShapes ?? [])].reverse();
}

/**
 * The steps the tree lists under a top-level part: the ones it can rebuild from. A part whose
 * steps cannot be replayed (saved before steps were recorded) shows none, as the inspector does.
 */
export function designTreeSteps(shape: WorkplaneShape): PartFeature[] {
  return stepsReplaceSnapshots(shape) ? shape.features ?? [] : [];
}

/**
 * The rows of the tree, top to bottom. A group in `collapsed` is listed without the parts
 * inside it; a part in `collapsed` is listed without its steps.
 */
export function designTreeRows(shapes: readonly WorkplaneShape[], collapsed: ReadonlySet<string> = new Set()): DesignTreeRow[] {
  const rows: DesignTreeRow[] = [];
  const visit = (shape: WorkplaneShape, bodyId: string, depth: number, parentId: string | null) => {
    const op = designTreeOp(shape);
    const steps = depth === 0 ? designTreeSteps(shape) : [];
    const hasChildren = Boolean(op) || steps.length > 0;
    const expanded = hasChildren && !collapsed.has(shape.id);
    rows.push({
      kind: "part",
      shape,
      bodyId,
      depth,
      parentId,
      op,
      hasChildren,
      expanded,
      off: Boolean(shape.suppressed || shape.csg?.suppressed),
    });
    if (!expanded) return;
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      rows.push({ kind: "step", bodyId, shape, depth: depth + 1, step: steps[index], index, count: steps.length });
    }
    for (const child of designTreeChildren(shape)) visit(child, bodyId, depth + 1, shape.id);
  };
  for (const shape of [...shapes].reverse()) visit(shape, shape.id, 0, null);
  return rows;
}

/**
 * The groups that hold `id`, from the top-level part down to the group it sits in. Empty for a
 * top-level part or an id that is not in the design.
 */
export function designTreeAncestors(shapes: readonly WorkplaneShape[], id: string): string[] {
  const path: string[] = [];
  const visit = (shape: WorkplaneShape): boolean => {
    if (shape.id === id) return true;
    for (const child of shape.groupedShapes ?? []) {
      path.push(shape.id);
      if (visit(child)) return true;
      path.pop();
    }
    return false;
  };
  for (const shape of shapes) {
    if (visit(shape)) return path;
    path.length = 0;
  }
  return [];
}

/** The top-level part that holds `id` (itself when `id` is top-level), or null. */
export function designTreeBodyId(shapes: readonly WorkplaneShape[], id: string): string | null {
  for (const shape of shapes) {
    if (shape.id === id) return shape.id;
    if (designTreeAncestors([shape], id).length) return shape.id;
  }
  return null;
}

/**
 * `features` with the step `stepId` taken out and put back at `toIndex` in what is left
 * (oldest first). The list comes back unchanged when that is where it already sits.
 */
export function reorderPartSteps(features: readonly PartFeature[], stepId: string, toIndex: number): PartFeature[] {
  const from = features.findIndex((feature) => feature.id === stepId);
  if (from < 0) return [...features];
  const next = [...features];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, moved);
  return next;
}

/**
 * Where a step dragged onto another step lands, as the index in the part's steps without the
 * dragged one (oldest first). The tree lists steps newest first, so dropping on the upper
 * half of a row puts the step after that row's step, and the lower half before it.
 */
export function stepDropIndex(targetIndex: number, upperHalf: boolean): number {
  return upperHalf ? targetIndex + 1 : targetIndex;
}

/** The steps that stay when `stepId` and everything after it are removed. */
export function partStepsBefore(features: readonly PartFeature[], stepId: string): PartFeature[] {
  const index = features.findIndex((feature) => feature.id === stepId);
  return index < 0 ? [...features] : features.slice(0, index);
}

/**
 * `body` without the part `childId`, wherever it sits inside it. Returns null when nothing
 * would be left: the removed part was the only one in the top-level group.
 */
export function removePartFromTree(body: WorkplaneShape, childId: string): WorkplaneShape | null {
  const children = body.groupedShapes ?? [];
  if (!children.some((child) => csgTreeContainsId(child, childId))) return body;
  const kept: WorkplaneShape[] = [];
  for (const child of children) {
    if (child.id === childId) continue;
    if (child.groupedShapes?.length && csgTreeContainsId(child, childId)) {
      const trimmed = removePartFromTree(child, childId);
      if (trimmed) kept.push(trimmed);
      continue;
    }
    kept.push(child);
  }
  if (kept.length === 0) return null;
  return { ...body, groupedShapes: kept };
}

export type TreeDrop =
  | { kind: "reorder-step"; bodyId: string; stepId: string; toIndex: number }
  | { kind: "into-group"; partId: string; fromBodyId: string | null; groupId: string; bodyId: string }
  | { kind: "out-of-group"; partId: string; fromBodyId: string };

/**
 * What dropping `dragged` on `target` (or on the tree's empty space when `target` is null) does,
 * or null when the drop is not allowed. Steps only move within their own part. A part can be
 * dragged into a group that is not itself or inside it, and a part inside a group can be
 * dragged out to the top level. Locked parts and groups stay as they are.
 */
export function treeDropFor(dragged: DesignTreeRow, target: DesignTreeRow | null, upperHalf = false): TreeDrop | null {
  if (dragged.kind === "step") {
    if (!target || target.kind !== "step" || target.bodyId !== dragged.bodyId || target.step.id === dragged.step.id) return null;
    if (dragged.shape.locked) return null;
    const without = (dragged.shape.features ?? []).filter((feature) => feature.id !== dragged.step.id);
    const toIndex = stepDropIndex(without.findIndex((feature) => feature.id === target.step.id), upperHalf);
    const settled = reorderPartSteps(dragged.shape.features ?? [], dragged.step.id, toIndex);
    if (settled.every((feature, index) => feature === dragged.shape.features?.[index])) return null;
    return { kind: "reorder-step", bodyId: dragged.bodyId, stepId: dragged.step.id, toIndex };
  }
  if (dragged.shape.locked) return null;
  const toTopLevel = !target || (target.kind === "part" && !target.op) || target.kind === "step";
  if (toTopLevel) {
    if (dragged.depth === 0) return null;
    return { kind: "out-of-group", partId: dragged.shape.id, fromBodyId: dragged.bodyId };
  }
  if (target.kind !== "part" || !target.op) return null;
  if (target.shape.locked) return null;
  if (target.shape.id === dragged.shape.id || csgTreeContainsId(dragged.shape, target.shape.id)) return null;
  if (dragged.parentId === target.shape.id) return null;
  return {
    kind: "into-group",
    partId: dragged.shape.id,
    fromBodyId: dragged.depth === 0 ? null : dragged.bodyId,
    groupId: target.shape.id,
    bodyId: target.bodyId,
  };
}
