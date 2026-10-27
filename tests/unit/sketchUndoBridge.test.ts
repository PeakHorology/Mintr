import { describe, expect, it } from "vitest";
import { nextRedoStep, nextUndoStep } from "@/lib/sketchUndoBridge";

describe("sketch undo bridge", () => {
  it("walks sketch lines, then closes an empty sketch without undoing the solid", () => {
    expect(nextUndoStep({
      sketchActive: true,
      sketchIndex: 2,
      modelIndex: 1,
      editingExisting: false,
      hasCancelledSketch: false,
    })).toEqual({ kind: "sketch" });
    expect(nextUndoStep({
      sketchActive: true,
      sketchIndex: 0,
      modelIndex: 1,
      editingExisting: false,
      hasCancelledSketch: false,
    })).toEqual({ kind: "close-sketch" });
  });

  it("closes an edited sketch without undoing the solid it belongs to", () => {
    expect(nextUndoStep({
      sketchActive: true,
      sketchIndex: 0,
      modelIndex: 3,
      editingExisting: true,
      hasCancelledSketch: false,
    })).toEqual({ kind: "close-sketch" });
  });

  it("reopens a cancelled sketch before older solid steps", () => {
    expect(nextUndoStep({
      sketchActive: false,
      sketchIndex: 0,
      modelIndex: 2,
      editingExisting: false,
      hasCancelledSketch: true,
    })).toEqual({ kind: "reopen-cancelled" });
  });

  it("redoes sketch lines, then the finish, and reopens a finished sketch before replaying it", () => {
    expect(nextRedoStep({
      sketchActive: true,
      sketchIndex: 1,
      sketchLength: 3,
      modelIndex: 1,
      modelLength: 2,
      nextModelStepFinishesSketch: true,
      hasCancelRedo: false,
    })).toEqual({ kind: "sketch" });
    expect(nextRedoStep({
      sketchActive: true,
      sketchIndex: 2,
      sketchLength: 3,
      modelIndex: 1,
      modelLength: 2,
      nextModelStepFinishesSketch: true,
      hasCancelRedo: false,
    })).toEqual({ kind: "finish-sketch" });
    expect(nextRedoStep({
      sketchActive: false,
      sketchIndex: 0,
      sketchLength: 1,
      modelIndex: 1,
      modelLength: 3,
      nextModelStepFinishesSketch: true,
      hasCancelRedo: false,
    })).toEqual({ kind: "reopen-finished" });
  });
});
