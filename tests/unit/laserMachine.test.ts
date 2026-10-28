import { afterEach, describe, expect, it, vi } from "vitest";
import {
  laserDesignLabel,
  laserDesignWorkspace,
  laserPresetPatch,
  loadMachineChoice,
  normalizeLaserSettings,
  saveMachineChoice,
} from "@/lib/laserMachine";
import { makeShapeFromAsset } from "@/lib/shapeCatalog";
import { DEFAULT_WORKPLANE_WORKSPACE, normalizeWorkspaceSettings } from "@/lib/workplaneSettings";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("laser machines", () => {
  it("keeps older designs as print designs", () => {
    const workspace = normalizeWorkspaceSettings({ width: 300 });
    expect(workspace.designKind).toBe("print");
    expect(workspace.laserPreset).toBe("xtool-s1");
    expect(workspace.materialThickness).toBe(3);
  });

  it("takes a named laser's size and type, and keeps a custom size", () => {
    const named = normalizeLaserSettings({ laserPreset: "xtool-p2", laserWidth: 10, laserType: "diode" });
    expect([named.laserWidth, named.laserDepth, named.laserType]).toEqual([600, 308, "co2"]);
    const custom = normalizeLaserSettings({ laserPreset: "custom", laserWidth: 700, laserDepth: 20, laserType: "infrared" });
    expect([custom.laserWidth, custom.laserDepth, custom.laserType]).toEqual([700, 40, "infrared"]);
  });

  it("keeps a measured sheet thickness with its material", () => {
    const sheet = normalizeLaserSettings({ materialPreset: "plywood-3", materialThickness: 3.2 });
    expect(sheet.materialThickness).toBe(3.2);
    expect(laserDesignLabel(sheet)).toBe("Laser · 3.2 mm plywood");
    expect(laserDesignLabel(normalizeLaserSettings({ materialPreset: "custom", materialThickness: 4 }))).toBe("Laser · 4 mm sheet");
    expect(normalizeLaserSettings({ kerfMm: 5 }).kerfMm).toBe(1);
  });

  it("picks a machine's usual software and kerf, unless a kerf was measured", () => {
    expect(laserPresetPatch("glowforge-basic", { laserType: "diode", kerfMm: 0.08 })).toMatchObject({ cutFileStyle: "glowforge", kerfMm: 0.15, laserType: "co2" });
    expect(laserPresetPatch("glowforge-basic", { laserType: "diode", kerfMm: 0.11 }).kerfMm).toBeUndefined();
  });

  it("grows a new laser design's workplane to hold the laser bed", () => {
    const workspace = laserDesignWorkspace(DEFAULT_WORKPLANE_WORKSPACE);
    expect(workspace.designKind).toBe("laser");
    expect(workspace.width).toBeGreaterThanOrEqual(498 + 40);
    expect(workspace.depth).toBeGreaterThanOrEqual(319 + 40);
    expect(workspace.sizePreset).toBe("Custom");
  });

  it("starts new parts in a laser design at the sheet's thickness", () => {
    const asset = { id: "box", name: "Box", src: "", kind: "box" as const, color: "#d41721" };
    expect(makeShapeFromAsset(asset, undefined, "standard", 3).height).toBe(3);
    expect(makeShapeFromAsset(asset, undefined, "standard").height).toBe(20);
  });

  it("remembers what this computer makes with, starting with a 3D printer", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) },
      dispatchEvent: () => true,
    });
    vi.stubGlobal("CustomEvent", class extends Event {});
    expect(loadMachineChoice()).toBe("printer");
    saveMachineChoice("both");
    expect(loadMachineChoice()).toBe("both");
  });
});
