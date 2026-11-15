import { projectShapesFingerprint } from "@/lib/editorHistory";
import { instantChange, rebuildBody, valuesChangeIsInstant, withDrivenSettings, type RebuildEngine } from "@/lib/parametricRebuild";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Mintr Pro: puts a changed top-level part back into the design. The inspector hands over the
 * part with a value, a sum, a step size or a part inside it changed; this works out what follows,
 * rebuilds it through `rebuildBody`, and commits the result as one undo step.
 *
 * Three things make that safe while the rebuild is slow:
 * - the change itself is shown straight away (without an undo step), so the next change the
 *   person makes builds on it and is never lost;
 * - a newer change stops the one still running, so a slider or quick typing only ever finishes
 *   the latest;
 * - if anything else in the design changed meanwhile, the rebuild is dropped and says so, rather
 *   than overwriting that work.
 */

/** What the controller needs from the editor. Everything here reads the editor's live state. */
export type ValuesHost = {
  /** Every top-level part in the design, as it is now. */
  shapes: () => WorkplaneShape[];
  /** Show these parts without adding an undo step. */
  showShapes: (next: WorkplaneShape[]) => void;
  /** Put these parts in the design as one undo step, with its name. */
  commitShapes: (next: WorkplaneShape[], selectedId: string, message: string) => void;
  /** Change a part's own settings the way a typed size does (one undo step). */
  updateShape: (id: string, patch: Partial<WorkplaneShape>) => void;
  notice: (message: string) => void;
  /** Millimeters per workplane unit. */
  unitMm: () => number;
  engine: () => RebuildEngine;
  /** A tool that owns the CAD session is open (Fillet, Push Pull): steps cannot be replayed now. */
  toolBusy: () => boolean;
  /** Take or give back the CAD session for a step replay. */
  holdSession: (held: boolean) => void;
  /** Put back fillets that were made before steps were recorded, the older way. */
  reapplyLegacyEdgeSteps: (body: WorkplaneShape) => Promise<void>;
  /** What could not follow, for the Values card. An empty list clears it. */
  report: (bodyId: string, problems: string[]) => void;
};

export type ValuesApplied = "committed" | "cancelled" | "dropped" | "blocked" | "missing";

export const SCENE_MOVED_NOTICE = "The design changed while Mintr worked that out. Change the value again.";
export const TOOL_BUSY_NOTICE = "Finish the current tool first";

/** Every field of `next` that is not what `current` has, apart from its id. */
function changedFields(current: WorkplaneShape, next: WorkplaneShape): Partial<WorkplaneShape> {
  const changed: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
    const field = key as keyof WorkplaneShape;
    if (field !== "id" && next[field] !== current[field]) changed[key] = next[field];
  }
  return changed as Partial<WorkplaneShape>;
}

function treeHasSteps(shape: WorkplaneShape): boolean {
  return Boolean(shape.features?.length || shape.edgeTreatments?.length || shape.groupedShapes?.some(treeHasSteps));
}

function summary(problems: readonly string[], message: string) {
  if (problems.length === 0) return message;
  return problems.length === 1 ? problems[0] : `${problems[0]} (and ${problems.length - 1} more, listed under Values)`;
}

export function createValuesController(host: ValuesHost) {
  let generation = 0;
  let running: Promise<unknown> | null = null;
  /** The part as it was before the first of a run of changes that are still being worked out. */
  let settled: { id: string; shape: WorkplaneShape } | null = null;

  const put = (body: WorkplaneShape) => host.shapes().map((entry) => (entry.id === body.id ? body : entry));

  /**
   * Put a changed top-level part into the design, with everything its values now give.
   * Resolves once it is committed, or once it is known it will not be.
   */
  async function apply(nextBody: WorkplaneShape, message: string): Promise<ValuesApplied> {
    const mine = (generation += 1);
    const cancelled = () => mine !== generation;
    const current = host.shapes().find((entry) => entry.id === nextBody.id);
    if (!current) return "missing";
    const unitMm = host.unitMm();
    const live = settled?.id === nextBody.id ? settled.shape : current;

    // A single part whose values only set its own numbers goes the way a typed size goes.
    const instant = running ? null : instantChange(nextBody, live, undefined, unitMm);
    if (instant) {
      host.updateShape(nextBody.id, { ...changedFields(current, nextBody), ...instant.patch });
      host.report(nextBody.id, instant.problems);
      host.notice(summary(instant.problems, message));
      return "committed";
    }

    const needsSession = treeHasSteps(nextBody);
    if (needsSession && !running && host.toolBusy()) {
      host.notice(TOOL_BUSY_NOTICE);
      return "blocked";
    }

    // Show the change now; its geometry follows. A change made on top of it keeps it.
    if (!settled || settled.id !== nextBody.id) settled = { id: nextBody.id, shape: current };
    host.showShapes(put(nextBody));
    const sceneBefore = projectShapesFingerprint(host.shapes());

    const work = (async (): Promise<ValuesApplied> => {
      // Only one rebuild uses the engine at a time: wait for the one this change replaced to stop.
      const earlier = running;
      if (earlier) await earlier.catch(() => undefined);
      if (cancelled()) return "cancelled";
      if (needsSession) host.holdSession(true);
      try {
        const outcome = await rebuildBody(nextBody, undefined, host.engine(), { unitMm, live, cancelled });
        if (outcome.status === "cancelled" || cancelled()) return "cancelled";
        if (projectShapesFingerprint(host.shapes()) !== sceneBefore) {
          settled = null;
          host.notice(SCENE_MOVED_NOTICE);
          return "dropped";
        }
        settled = null;
        const body = outcome.status === "settings" ? withDrivenSettings(outcome.body, undefined, unitMm) : outcome.body;
        host.commitShapes(put(body), body.id, message);
        host.report(body.id, outcome.problems);
        if (outcome.problems.length) host.notice(summary(outcome.problems, message));
        if (outcome.status === "rebuilt" && outcome.legacyEdgeSteps) {
          if (needsSession) host.holdSession(false);
          await host.reapplyLegacyEdgeSteps(body);
        }
        return "committed";
      } catch (error) {
        settled = null;
        host.notice(error instanceof Error && error.message ? error.message : "Could not rebuild this part");
        return "dropped";
      } finally {
        if (needsSession) host.holdSession(false);
      }
    })();
    running = work;
    try {
      return await work;
    } finally {
      if (running === work) running = null;
    }
  }

  /**
   * Show a part with a value changed while its slider is dragged, without an undo step. Only a
   * plain shape moves while dragging; anything else waits for the slider to be let go.
   */
  function preview(nextBody: WorkplaneShape): boolean {
    const current = host.shapes().find((entry) => entry.id === nextBody.id);
    if (!current || running || !valuesChangeIsInstant(current)) return false;
    host.showShapes(put(withDrivenSettings(nextBody, undefined, host.unitMm())));
    return true;
  }

  /** Stop a rebuild that is running; nothing it made is committed. */
  function cancel() {
    generation += 1;
    settled = null;
  }

  return { apply, preview, cancel, isRunning: () => running !== null };
}

export type ValuesController = ReturnType<typeof createValuesController>;

/**
 * A host that always asks the newest one in `ref`. The editor rebuilds its host on every render
 * (it closes over the render's callbacks), while the controller is made once.
 */
export function delegatingValuesHost(ref: { current: ValuesHost | null }): ValuesHost {
  const host = () => {
    if (!ref.current) throw new Error("The values host is not ready");
    return ref.current;
  };
  return {
    shapes: () => host().shapes(),
    showShapes: (next) => host().showShapes(next),
    commitShapes: (next, selectedId, message) => host().commitShapes(next, selectedId, message),
    updateShape: (id, patch) => host().updateShape(id, patch),
    notice: (message) => host().notice(message),
    unitMm: () => host().unitMm(),
    engine: () => host().engine(),
    toolBusy: () => host().toolBusy(),
    holdSession: (held) => host().holdSession(held),
    reapplyLegacyEdgeSteps: (body) => host().reapplyLegacyEdgeSteps(body),
    report: (bodyId, problems) => host().report(bodyId, problems),
  };
}
