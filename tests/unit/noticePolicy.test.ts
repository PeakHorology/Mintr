import { describe, expect, it } from "vitest";
import { noticeIsActionable, noticeIsFailure } from "@/lib/noticePolicy";

describe("noticeIsActionable", () => {
  it("hides confirmations and next-step coaching", () => {
    expect(noticeIsActionable("Ready")).toBe(false);
    expect(noticeIsActionable("Box added")).toBe(false);
    expect(noticeIsActionable("Offset outline added")).toBe(false);
    expect(noticeIsActionable("Sketch started: place the first point")).toBe(false);
    expect(noticeIsActionable("Undo")).toBe(false);
    expect(noticeIsActionable("Copied 1 shape")).toBe(false);
    expect(noticeIsActionable("Click the path.")).toBe(false);
    expect(noticeIsActionable("Polygon: click the center, then drag (6 sides)")).toBe(false);
    expect(noticeIsActionable("Building sketch…")).toBe(false);
    expect(noticeIsActionable("Select highlighted edges")).toBe(false);
    expect(noticeIsActionable("Saved · exact STEP stored for 1 imported body")).toBe(false);
  });

  it("keeps failures and refused commands", () => {
    expect(noticeIsActionable("Could not save the project")).toBe(true);
    expect(noticeIsActionable("Finish the current drag or transform before undoing")).toBe(true);
    expect(noticeIsActionable("Select a shape first")).toBe(true);
    expect(noticeIsActionable("“Box” is locked")).toBe(true);
    expect(noticeIsActionable("Close at least one profile before extruding")).toBe(true);
    expect(noticeIsActionable("Offset works on straight edges. A closed box copies the whole outline.")).toBe(true);
    expect(noticeIsActionable("Turn on Mintr Pro in Settings to use sketch constraints.")).toBe(true);
    expect(noticeIsActionable("Nothing to undo")).toBe(true);
    expect(noticeIsActionable("Sketch clipboard is empty")).toBe(true);
  });

  it("counts a failed command, and leaves a refusal out", () => {
    expect(noticeIsFailure("Could not save the project")).toBe(true);
    expect(noticeIsFailure("The group could not be built")).toBe(true);
    expect(noticeIsFailure("Select a shape first")).toBe(false);
    expect(noticeIsFailure("Offset distance is too small")).toBe(false);
    expect(noticeIsFailure("Box added")).toBe(false);
  });
});
