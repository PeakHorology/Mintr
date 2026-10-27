/** Which undo or redo step comes next when sketch edits and solid edits share one button. */

export type UndoStep =
  | { kind: "sketch" }
  | { kind: "close-sketch-then-model" }
  | { kind: "close-sketch" }
  | { kind: "reopen-cancelled" }
  | { kind: "model" }
  | { kind: "none" };

export type RedoStep =
  | { kind: "sketch" }
  | { kind: "finish-sketch" }
  | { kind: "reopen-finished" }
  | { kind: "recancel" }
  | { kind: "model" }
  | { kind: "none" };

export function nextUndoStep(state: {
  sketchActive: boolean;
  sketchIndex: number;
  modelIndex: number;
  /** Reopening a solid that already came from a sketch. Closing it should not also undo the solid. */
  editingExisting: boolean;
  hasCancelledSketch: boolean;
}): UndoStep {
  if (state.sketchActive) {
    if (state.sketchIndex > 0) return { kind: "sketch" };
    // An empty sketch only closes. The solid underneath stays until the next Undo.
    return { kind: "close-sketch" };
  }
  if (state.hasCancelledSketch) return { kind: "reopen-cancelled" };
  if (state.modelIndex > 0) return { kind: "model" };
  return { kind: "none" };
}

export function nextRedoStep(state: {
  sketchActive: boolean;
  sketchIndex: number;
  sketchLength: number;
  modelIndex: number;
  modelLength: number;
  /** The next solid step was made by finishing this sketch. */
  nextModelStepFinishesSketch: boolean;
  hasCancelRedo: boolean;
}): RedoStep {
  if (state.sketchActive) {
    if (state.sketchIndex < state.sketchLength - 1) return { kind: "sketch" };
    if (state.hasCancelRedo) return { kind: "recancel" };
    if (state.nextModelStepFinishesSketch) return { kind: "finish-sketch" };
    return { kind: "none" };
  }
  if (state.nextModelStepFinishesSketch) return { kind: "reopen-finished" };
  if (state.modelIndex < state.modelLength - 1) return { kind: "model" };
  return { kind: "none" };
}
