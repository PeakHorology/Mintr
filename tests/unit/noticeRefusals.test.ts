import { describe, expect, it } from "vitest";
import { noticeIsActionable } from "@/lib/noticePolicy";

describe("refusals are shown, so a command never just does nothing", () => {
  it.each([
    "Unlock every selected shape before grouping",
    "Unlock every selected outline before lofting",
    "Unsupported file type: .xyz",
    "This mesh is too dense for Face",
    "Push Pull needs an exact CAD body. Group CAD parts first.",
    "Still getting ready. Try that again in a moment.",
    "The design changed while Mintr worked that out. Try again.",
    "Finish the current tool first",
    "Nothing to copy yet",
    "Nothing selected to delete",
    "A curved face does not work for this",
    "Gridfinity bins stay in one piece",
    "Wait for a fillet preview before applying",
    "Type an extrude height.",
    "Please select a shape to begin",
    "Sketch is empty",
    "That part has no sketch to edit",
    "Hole mode applies in 3D — finish or exit the sketch first",
    "\"Box\" is already part of a linear pattern. Dissolve that pattern first, then make the circular one.",
    "The hole covered the whole solid, so nothing is left. Press Ctrl+Z to undo.",
  ])("shows %s", (message) => {
    expect(noticeIsActionable(message)).toBe(true);
  });

  it.each([
    "Box added",
    "Selection cleared",
    "Smoothing…",
    "Click the face that should lie on the workplane",
    "Linear pattern cancelled",
  ])("keeps %s off the screen", (message) => {
    expect(noticeIsActionable(message)).toBe(false);
  });
});
