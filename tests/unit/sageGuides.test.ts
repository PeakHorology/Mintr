import { describe, expect, it } from "vitest";
import { lookupSageGuide, normalizeSageLabel } from "@/lib/sageGuides";

describe("sage guides", () => {
  it("finds a tool by its button name", () => {
    expect(normalizeSageLabel("Save as…")).toBe("save as");
    const guide = lookupSageGuide("Line");
    expect(guide?.what).toMatch(/straight/i);
    expect(guide?.picture).toBe("line");
    expect(guide?.steps.length).toBeGreaterThan(1);
  });

  it("keeps sketch fillet apart from the solid fillet", () => {
    expect(lookupSageGuide("Fillet")?.what).toMatch(/edges/i);
    expect(lookupSageGuide("sketch-fillet")?.what).toMatch(/corner/i);
  });

  it("explains a shape that has no hand-written guide", () => {
    const guide = lookupSageGuide("Add Wedge");
    expect(guide?.steps[0]).toMatch(/click/i);
  });

  it("keeps the camera home button apart from the project home button", () => {
    expect(lookupSageGuide("Home")?.what).toMatch(/project list/i);
    expect(lookupSageGuide("camera-home")?.what).toMatch(/camera/i);
  });

  it("does not invent a guide for a dialog button", () => {
    expect(lookupSageGuide("Stay in this project")).toBeNull();
  });

  it("draws pictures for tools that change geometry, not for menus or the camera", () => {
    expect(lookupSageGuide("Extrude")?.picture).toBe("extrude");
    expect(lookupSageGuide("Group")?.picture).toBe("group");
    expect(lookupSageGuide("sketch-fillet")?.picture).toBe("sketch-fillet");
    expect(lookupSageGuide("Fillet")?.picture).toBe("fillet");
    expect(lookupSageGuide("Save")?.picture).toBeUndefined();
    expect(lookupSageGuide("Zoom in")?.picture).toBeUndefined();
    expect(lookupSageGuide("Add Wedge")?.picture).toBeUndefined();
  });
});
