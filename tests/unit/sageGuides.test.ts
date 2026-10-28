import { describe, expect, it } from "vitest";
import { DEFAULT_HOTKEY_BINDINGS, formatHotkeyBinding } from "@/lib/hotkeys";
import { lookupSageGuide, normalizeSageLabel, sageHitById, searchSageGuides } from "@/lib/sageGuides";
import { SETTING_GUIDES, SETTING_TIPS, settingSageKey } from "@/lib/settingGuides";

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

  it("finds a tool by name, and says where it lives", () => {
    const hits = searchSageGuides("fillet");
    expect(hits.slice(0, 2).map((hit) => hit.id).sort()).toEqual(["fillet", "sketch-fillet"]);
    expect(hits.find((hit) => hit.id === "sketch-fillet")?.area).toBe("sketch");
    expect(hits.find((hit) => hit.id === "fillet")?.area).toBe("workplane");
  });

  it("answers a plain question with the right tool", () => {
    expect(searchSageGuides("how do I make a pipe")[0]?.guide.title).toBe("Sweep");
    expect(searchSageGuides("round the edges")[0]?.guide.title).toBe("Fillet");
    expect(searchSageGuides("save")[0]?.area).toBe("anywhere");
  });

  it("explains the laser tools, with pictures for the ones that make parts", () => {
    expect(lookupSageGuide("Box maker")?.picture).toBe("box-maker");
    expect(lookupSageGuide("Flat parts")?.picture).toBe("flat-parts");
    expect(lookupSageGuide("Nest")?.picture).toBe("nest");
    expect(lookupSageGuide("laser-job")?.title).toBe("Cut, score or engrave");
    expect(lookupSageGuide("Open in xTool Studio")?.title).toBe("Open in your laser program");
    expect(searchSageGuides("pack the parts together")[0]?.guide.title).toBe("Nest");
    expect(searchSageGuides("finger joint box")[0]?.guide.title).toBe("Box maker");
  });

  it("finds nothing for filler or nonsense", () => {
    expect(searchSageGuides("")).toEqual([]);
    expect(searchSageGuides("how do I")).toEqual([]);
    expect(searchSageGuides("zzqx")).toEqual([]);
  });

  it("turns on with F1 unless the shortcut is changed", () => {
    expect(formatHotkeyBinding(DEFAULT_HOTKEY_BINDINGS.sage)).toBe("F1");
    expect(lookupSageGuide("Sage")?.hotkey).toBe("sage");
  });

  it("finds a setting and says which Settings tab it is on", () => {
    const theme = searchSageGuides("theme")[0];
    expect(theme?.guide.title).toBe("Theme");
    expect(theme?.area).toBe("settings");
    expect(theme?.section).toBe("appearance");
    expect(theme?.where).toBe("Settings · Appearance");
    expect(searchSageGuides("dark").some((hit) => hit.id === "setting:uitheme")).toBe(true);
  });

  it("still puts tools before settings", () => {
    expect(searchSageGuides("fillet").every((hit) => hit.area !== "settings")).toBe(true);
  });

  it("explains every setting row it is hovered on", () => {
    expect(settingSageKey(SETTING_TIPS.uiTheme)).toBe("setting:uitheme");
    for (const setting of SETTING_GUIDES) {
      const guide = lookupSageGuide(settingSageKey(SETTING_TIPS[setting.key])!);
      expect(guide?.title, setting.key).toBe(setting.title);
      expect(guide?.what).toBe(SETTING_TIPS[setting.key]);
    }
  });

  it("finds its own Show Sage switch in the Sage tab, and opens any answer by id", () => {
    const hit = searchSageGuides("show sage").find((candidate) => candidate.id === "setting:sageenabled");
    expect(hit?.section).toBe("tools");
    expect(hit?.where).toBe("Settings · Sage");
    expect(sageHitById("sweep")?.guide.title).toBe("Sweep");
    expect(sageHitById("setting:snapgrid")?.section).toBe("measurement");
    expect(sageHitById("nope")).toBeNull();
  });
});
