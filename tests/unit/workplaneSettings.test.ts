import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkplaneWorkspaceSettings } from "@/types/sketchforge";
import { formatMeasurementNumber, lengthDisplayUnit, millimetersToDisplay, normalizeScaleForUnits, scaleOptionsForUnits } from "@/lib/measurementUnits";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE, GLOBAL_WORKSPACE_DEFAULT_STORAGE_KEY, normalizeSnapGrid, normalizeWorkspaceSettings, PEAKCAD_PRO_STORAGE_KEY, peakcadProEnabled, savePeakcadPro, workplaneSettingsFingerprint, workspaceHydrationSyncDecision } from "@/lib/workplaneSettings";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workplane settings helpers", () => {
  it("accepts known snap grid values and falls back for unknown values", () => {
    expect(normalizeSnapGrid("0.5 mm")).toBe("0.5 mm");
    expect(normalizeSnapGrid("Huge")).toBe(DEFAULT_SNAP_GRID);
    expect(normalizeSnapGrid(null, "Off")).toBe("Off");
  });

  it("normalizes workspace settings from partial or invalid data", () => {
    const fallback: WorkplaneWorkspaceSettings = {
      ...DEFAULT_WORKPLANE_WORKSPACE,
      width: 300,
      depth: 250,
      background: "#ffffff",
    };

    expect(normalizeWorkspaceSettings(null, fallback)).toEqual(fallback);
    expect(
      normalizeWorkspaceSettings(
        {
          width: 500,
          depth: Number.NaN,
          sizePreset: "",
          gridBlockSize: 2.5,
          gridBlockPreset: "Custom",
          background: "#123456",
          showShadows: false,
          showGrid: false,
          cruiseShapes: false,
          zoomSpeed: Infinity,
          units: "Bricks",
          scale: "1:10 (centimeters)",
          accuracy: 3,
          displayQuality: "draft",
        },
        fallback,
      ),
    ).toEqual({
      ...fallback,
      width: 500,
      gridBlockSize: 2.5,
      gridBlockPreset: "Custom",
      background: "#123456",
      showShadows: false,
      showGrid: false,
      cruiseShapes: false,
      units: "Bricks",
      scale: "1:1 (studs)",
      accuracy: 3,
      displayQuality: "draft",
    });

    expect(normalizeWorkspaceSettings({ accuracy: 9 }, fallback).accuracy).toBe(fallback.accuracy);
    expect(normalizeWorkspaceSettings({}, fallback).displayQuality).toBe(fallback.displayQuality);
    expect(normalizeWorkspaceSettings({ displayQuality: "ultra" as never }, fallback).displayQuality).toBe(fallback.displayQuality);
    expect(DEFAULT_WORKPLANE_WORKSPACE.peakcadPro).toBe(false);
    expect(peakcadProEnabled(normalizeWorkspaceSettings({}, fallback))).toBe(false);
    expect(peakcadProEnabled(normalizeWorkspaceSettings({ peakcadPro: true }, fallback))).toBe(true);
    expect(normalizeWorkspaceSettings({ peakcadPro: "yes" as never }, fallback).peakcadPro).toBe(false);
  });

  it("keeps PeakCAD Pro as one choice for every project on this computer", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
      },
    });

    const beginnerProject = { peakcadPro: false };
    const proProject = { peakcadPro: true };
    expect(normalizeWorkspaceSettings(proProject).peakcadPro).toBe(false);
    expect(store.get(PEAKCAD_PRO_STORAGE_KEY)).toBe("0");

    savePeakcadPro(true);
    expect(normalizeWorkspaceSettings(beginnerProject).peakcadPro).toBe(true);
    expect(peakcadProEnabled({ peakcadPro: false })).toBe(true);

    savePeakcadPro(false);
    expect(normalizeWorkspaceSettings(proProject).peakcadPro).toBe(false);
  });

  it("adopts a PeakCAD Pro choice already saved with workspace defaults", () => {
    const store = new Map<string, string>([
      [GLOBAL_WORKSPACE_DEFAULT_STORAGE_KEY, JSON.stringify({ workspace: { peakcadPro: true }, snap: "1.0 mm" })],
    ]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
      },
    });

    expect(normalizeWorkspaceSettings({ peakcadPro: false }).peakcadPro).toBe(true);
    expect(store.get(PEAKCAD_PRO_STORAGE_KEY)).toBe("1");
  });

  it("keeps scale options in the selected unit family", () => {
    expect(scaleOptionsForUnits("Metric (Default)")).toEqual(["1:1 (millimeters)", "1:10 (centimeters)", "1:1000 (meters)"]);
    expect(normalizeScaleForUnits("Metric (Default)", "1:100 (meters)")).toBe("1:1000 (meters)");
    expect(scaleOptionsForUnits("Imperial")).toEqual(["1:1 (inches)", "1:1 (feet)"]);
    expect(normalizeScaleForUnits("Imperial", "1:100 (meters)")).toBe("1:1 (inches)");
    expect(normalizeWorkspaceSettings({ units: "Imperial", scale: "1:100 (meters)" }).scale).toBe("1:1 (inches)");
  });

  it("changes display units without scaling model values", () => {
    expect(lengthDisplayUnit({ units: "Metric (Default)", scale: "1:1000 (meters)" }).label).toBe("m");
    expect(millimetersToDisplay(20, { units: "Metric (Default)", scale: "1:1 (millimeters)" })).toBe(20);
    expect(millimetersToDisplay(20, { units: "Metric (Default)", scale: "1:1000 (meters)" })).toBe(0.02);
    expect(millimetersToDisplay(20, { units: "Metric (Default)", scale: "1:100 (meters)" })).toBe(0.02);
    expect(Number(millimetersToDisplay(25.4, { units: "Imperial", scale: "1:1 (inches)" }).toFixed(4))).toBe(1);
    expect(Number(millimetersToDisplay(304.8, { units: "Imperial", scale: "1:1 (feet)" }).toFixed(4))).toBe(1);
  });

  it("uses accuracy as display precision", () => {
    expect(formatMeasurementNumber(20, 1, 0.01)).toBe("20.0");
    expect(formatMeasurementNumber(20, 3, 0.01)).toBe("20.000");
    expect(formatMeasurementNumber(0.0004, 1, 0.001)).toBe("0.0004");
  });

  it("fingerprints workspace and snap settings together", () => {
    const base = workplaneSettingsFingerprint(DEFAULT_WORKPLANE_WORKSPACE, "1.0 mm");
    const equivalentNewReference = workplaneSettingsFingerprint({ ...DEFAULT_WORKPLANE_WORKSPACE }, "1.0 mm");
    const changedSnap = workplaneSettingsFingerprint(DEFAULT_WORKPLANE_WORKSPACE, "5.0 mm");
    const changedWorkspace = workplaneSettingsFingerprint({ ...DEFAULT_WORKPLANE_WORKSPACE, width: 300 }, "1.0 mm");

    expect(equivalentNewReference).toBe(base);
    expect(changedSnap).not.toBe(base);
    expect(changedWorkspace).not.toBe(base);
  });

  it("blocks the previous project's workspace while a new project hydrates", () => {
    const projectOne = workplaneSettingsFingerprint({ ...DEFAULT_WORKPLANE_WORKSPACE, width: 350, depth: 260 }, "5.0 mm");
    const projectTwo = workplaneSettingsFingerprint(DEFAULT_WORKPLANE_WORKSPACE, "1.0 mm");

    const staleCommit = workspaceHydrationSyncDecision(projectTwo, projectOne);
    expect(staleCommit).toEqual({ shouldSync: false, pendingFingerprint: projectTwo });

    const hydratedCommit = workspaceHydrationSyncDecision(staleCommit.pendingFingerprint, projectTwo);
    expect(hydratedCommit).toEqual({ shouldSync: false, pendingFingerprint: null });

    expect(workspaceHydrationSyncDecision(hydratedCommit.pendingFingerprint, projectTwo).shouldSync).toBe(true);
  });
});
