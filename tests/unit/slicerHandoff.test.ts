import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { preferenceFromPath, resolveSlicerChoice, slicerFromExeName, type DetectedSlicer } from "@/lib/slicerHandoff";

const require = createRequire(import.meta.url);
const { detectSlicersIn, identifyExe } = require("../../electron/slicerCatalog.cjs") as {
  detectSlicersIn: (roots: string[]) => DetectedSlicer[];
  identifyExe: (filePath: string) => DetectedSlicer;
};

const orca: DetectedSlicer = {
  id: "orca",
  name: "OrcaSlicer",
  path: "C:\\Program Files\\OrcaSlicer\\orca-slicer.exe",
  format: "3mf",
};
const cura: DetectedSlicer = {
  id: "cura",
  name: "UltiMaker Cura",
  path: "C:\\Program Files\\UltiMaker Cura 5.8\\UltiMaker-Cura.exe",
  format: "stl",
};

describe("slicer handoff", () => {
  it("sends 3MF to Orca, Bambu, and Prusa, and STL to Cura", () => {
    expect(slicerFromExeName("orca-slicer.exe")?.format).toBe("3mf");
    expect(slicerFromExeName("bambu-studio.exe")?.format).toBe("3mf");
    expect(slicerFromExeName("prusa-slicer.exe")?.format).toBe("3mf");
    expect(slicerFromExeName("UltiMaker-Cura.exe")?.format).toBe("stl");
    expect(slicerFromExeName("notepad.exe")).toBeNull();
  });

  it("uses the first installed slicer until one is chosen", () => {
    const choice = resolveSlicerChoice({ mode: "auto" }, [orca, cura]);
    expect(choice.label).toBe("Open in OrcaSlicer");
    expect(choice.format).toBe("3mf");
    expect(choice.launch).toBe(true);
    expect(choice.caption).toContain("Writes a 3MF");
  });

  it("downloads a 3MF when slicer handoff is off or nothing is installed", () => {
    expect(resolveSlicerChoice({ mode: "off" }, [orca]).label).toBe("Download 3MF");
    expect(resolveSlicerChoice({ mode: "auto" }, []).launch).toBe(false);
  });

  it("keeps a chosen Cura install on STL", () => {
    const choice = resolveSlicerChoice({
      mode: "app",
      id: "cura",
      name: "UltiMaker Cura",
      path: cura.path,
      format: "stl",
    }, [orca]);
    expect(choice.label).toBe("Open in UltiMaker Cura");
    expect(choice.format).toBe("stl");
  });

  it("reads a program path only for a known slicer", () => {
    expect(preferenceFromPath("D:\\tools\\OrcaSlicer\\orca-slicer.exe")?.mode).toBe("app");
    expect(preferenceFromPath("D:\\tools\\notes.txt")).toBeNull();
  });
});

describe("slicer discovery", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds slicers one folder down from Program Files, including a versioned Cura directory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "peakcad-slicers-"));
    roots.push(root);
    const orcaDir = path.join(root, "OrcaSlicer");
    const curaDir = path.join(root, "UltiMaker Cura 5.8");
    const prusaDir = path.join(root, "Prusa3D", "PrusaSlicer");
    mkdirSync(orcaDir, { recursive: true });
    mkdirSync(curaDir, { recursive: true });
    mkdirSync(prusaDir, { recursive: true });
    writeFileSync(path.join(orcaDir, "orca-slicer.exe"), "");
    writeFileSync(path.join(curaDir, "UltiMaker-Cura.exe"), "");
    writeFileSync(path.join(prusaDir, "prusa-slicer.exe"), "");

    const found = detectSlicersIn([root]);
    expect(found.map((slicer: DetectedSlicer) => slicer.id)).toEqual(["orca", "prusa", "cura"]);
    expect(found.find((slicer: DetectedSlicer) => slicer.id === "cura")?.format).toBe("stl");
    expect(identifyExe(path.join(prusaDir, "prusa-slicer.exe")).name).toBe("PrusaSlicer");
  });
});
