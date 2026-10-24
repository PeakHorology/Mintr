import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  collectLegacyProjectFiles,
  ensureProjectExtension,
  findPeakcadArg,
  isWritablePeakcadPath,
  normalizePeakcadPath,
  resolveProjectFile,
  transitionLegacyProjectFile,
  transitionProjectFilesToMintrDir,
  uniquePath,
} = require("../../electron/peakcadPath.cjs") as {
  collectLegacyProjectFiles: (rootDir: string, extraPaths?: string[], isAllowed?: (filePath: string) => boolean) => string[];
  ensureProjectExtension: (filePath: string, preferred?: string) => string;
  findPeakcadArg: (argv: string[]) => string | null;
  isWritablePeakcadPath: (filePath: string, defaultDir: string, allowed: Set<string>) => boolean;
  normalizePeakcadPath: (filePath: string) => string;
  resolveProjectFile: (dir: string, defaultName: string) => string | null;
  transitionLegacyProjectFile: (filePath: string) => { from: string; to: string; status: "renamed" | "already" };
  transitionProjectFilesToMintrDir: (
    legacyRoot: string,
    mintrRoot: string,
    extraPaths?: string[],
    isAllowed?: (filePath: string) => boolean,
  ) => {
    renamed: { from: string; to: string }[];
    already: { from: string; to: string }[];
    failed: { from: string; message: string }[];
  };
  uniquePath: (filePath: string) => string;
};
const {
  allowPath,
  isAllowlisted,
  readTextFile,
  writeTextFile,
} = require("../../electron/projectFile.cjs") as {
  allowPath: (filePath: string) => string;
  isAllowlisted: (filePath: string) => boolean;
  readTextFile: (filePath: string) => { path: string; text: string };
  writeTextFile: (filePath: string, text: string) => string;
};

const defaultDir = path.join("C:", "Users", "docs", "PeakCAD");

describe("normalizePeakcadPath", () => {
  it("accepts .mintr and .peakcad, and rejects other extensions", () => {
    expect(normalizePeakcadPath(path.join(defaultDir, "hub.mintr"))).toBe(path.resolve(defaultDir, "hub.mintr"));
    expect(normalizePeakcadPath(path.join(defaultDir, "hub.peakcad"))).toBe(path.resolve(defaultDir, "hub.peakcad"));
    expect(() => normalizePeakcadPath(path.join(defaultDir, "notes.txt"))).toThrow(/extension/);
  });
});

describe("project file names", () => {
  it("keeps a chosen extension and adds .mintr when one is missing", () => {
    expect(ensureProjectExtension("Design.PEAKCAD")).toBe("Design.PEAKCAD");
    expect(ensureProjectExtension("Design.mintr")).toBe("Design.mintr");
    expect(ensureProjectExtension("Design")).toBe("Design.mintr");
  });

  it("opens either extension from a double-click", () => {
    expect(findPeakcadArg(["--inspect", "C:\\designs\\Plate.mintr"])).toBe("C:\\designs\\Plate.mintr");
    expect(findPeakcadArg(["C:\\designs\\Plate.PEAKCAD"])).toBe("C:\\designs\\Plate.PEAKCAD");
    expect(findPeakcadArg(["--Plate.mintr", "notes.txt"])).toBeNull();
  });

  it("treats either extension as the same design name", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mintr-name-"));
    try {
      const legacy = path.join(dir, "Design.peakcad");
      fs.writeFileSync(legacy, "{}", "utf8");
      expect(resolveProjectFile(dir, "Design.mintr")).toBe(legacy);
      expect(uniquePath(path.join(dir, "Design.mintr"))).toBe(path.join(dir, "Design (2).mintr"));
      fs.writeFileSync(path.join(dir, "Design.mintr"), "{}", "utf8");
      expect(resolveProjectFile(dir, "Design.peakcad")).toBe(path.join(dir, "Design.mintr"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("isWritablePeakcadPath", () => {
  it("allows .mintr and .peakcad files under the default PeakCAD documents folder", () => {
    expect(isWritablePeakcadPath(path.join(defaultDir, "hub.peakcad"), defaultDir, new Set())).toBe(true);
    expect(isWritablePeakcadPath(path.join(defaultDir, "hub.mintr"), defaultDir, new Set())).toBe(true);
    const mintrDir = path.join(path.dirname(defaultDir), "Mintr");
    expect(isWritablePeakcadPath(path.join(mintrDir, "hub.mintr"), defaultDir, new Set())).toBe(true);
  });

  it("rejects a sibling folder until the user picks it in a dialog", () => {
    const outsider = path.join("C:", "Users", "docs", "Other", "secret.peakcad");
    expect(isWritablePeakcadPath(outsider, defaultDir, new Set())).toBe(false);
  });

  it("allows a path only after it is explicitly allowlisted", () => {
    const outsider = path.join("C:", "Users", "docs", "Other", "picked.peakcad");
    const allowed = new Set([path.resolve(outsider).toLowerCase()]);
    expect(isWritablePeakcadPath(outsider, defaultDir, allowed)).toBe(true);
  });
});

describe("transitionLegacyProjectFile", () => {
  it("renames .peakcad files in the project folder and leaves an existing .mintr file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mintr-transition-"));
    const nested = path.join(root, "sets");
    fs.mkdirSync(nested);
    const plate = path.join(root, "Plate.peakcad");
    const gear = path.join(nested, "Gear.PEAKCAD");
    const notes = path.join(root, "notes.txt");
    const kept = path.join(root, "Kept.peakcad");
    const keptMintr = path.join(root, "Kept.mintr");
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.peakcad`);
    fs.writeFileSync(plate, "{\"format\":\"peakcad\"}", "utf8");
    fs.writeFileSync(gear, "{\"format\":\"peakcad\"}", "utf8");
    fs.writeFileSync(notes, "leave me", "utf8");
    fs.writeFileSync(kept, "old", "utf8");
    fs.writeFileSync(keptMintr, "current", "utf8");
    fs.writeFileSync(outside, "outside", "utf8");
    try {
      const files = collectLegacyProjectFiles(root, [outside], () => false);
      expect(files.map((file) => path.basename(file)).sort()).toEqual(["Gear.PEAKCAD", "Kept.peakcad", "Plate.peakcad"]);
      const renamed = files.map((file) => transitionLegacyProjectFile(file));
      expect(renamed.find((item) => item.from === plate)?.status).toBe("renamed");
      expect(fs.readFileSync(path.join(root, "Plate.mintr"), "utf8")).toContain("peakcad");
      expect(fs.existsSync(plate)).toBe(false);
      expect(fs.existsSync(path.join(nested, "Gear.mintr"))).toBe(true);
      expect(fs.existsSync(gear)).toBe(false);
      expect(fs.readFileSync(notes, "utf8")).toBe("leave me");
      expect(fs.readFileSync(kept, "utf8")).toBe("old");
      expect(fs.readFileSync(keptMintr, "utf8")).toBe("current");
      expect(fs.existsSync(outside)).toBe(true);
      const allowed = collectLegacyProjectFiles(root, [outside], () => true).map((file) => path.basename(file)).sort();
      expect(allowed).toEqual(["Kept.peakcad", path.basename(outside)].sort());
      expect(transitionLegacyProjectFile(outside).status).toBe("renamed");
      expect(fs.existsSync(outside)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { force: true });
      fs.rmSync(path.join(path.dirname(outside), `${path.basename(outside, ".peakcad")}.mintr`), { force: true });
    }
  });
});

describe("transitionProjectFilesToMintrDir", () => {
  it("moves projects into Documents/Mintr without replacing a file that is already there", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mintr-move-"));
    const legacy = path.join(root, "PeakCAD");
    const mintr = path.join(root, "Mintr");
    const nested = path.join(legacy, "sets");
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(mintr, { recursive: true });
    const plate = path.join(legacy, "Plate.peakcad");
    const gear = path.join(nested, "Gear.MINTR");
    const notes = path.join(legacy, "notes.txt");
    const kept = path.join(legacy, "Kept.peakcad");
    const keptCurrent = path.join(legacy, "Kept.mintr");
    const existing = path.join(mintr, "Kept.mintr");
    const outside = path.join(root, "Outside.peakcad");
    fs.writeFileSync(plate, "{\"format\":\"peakcad\"}", "utf8");
    fs.writeFileSync(gear, "gear", "utf8");
    fs.writeFileSync(notes, "leave me", "utf8");
    fs.writeFileSync(kept, "old", "utf8");
    fs.writeFileSync(keptCurrent, "current", "utf8");
    fs.writeFileSync(existing, "already", "utf8");
    fs.writeFileSync(outside, "outside", "utf8");
    try {
      const blocked = transitionProjectFilesToMintrDir(legacy, mintr, [outside], () => false);
      expect(blocked.renamed.map((item) => path.basename(item.to)).sort()).toEqual(["Gear.mintr", "Plate.mintr"]);
      expect(fs.readFileSync(path.join(mintr, "Plate.mintr"), "utf8")).toContain("peakcad");
      expect(fs.existsSync(plate)).toBe(false);
      expect(fs.readFileSync(path.join(mintr, "sets", "Gear.mintr"), "utf8")).toBe("gear");
      expect(fs.existsSync(gear)).toBe(false);
      expect(fs.readFileSync(notes, "utf8")).toBe("leave me");
      expect(fs.readFileSync(existing, "utf8")).toBe("already");
      expect(fs.readFileSync(keptCurrent, "utf8")).toBe("current");
      expect(fs.readFileSync(kept, "utf8")).toBe("old");
      expect(fs.existsSync(outside)).toBe(true);
      const allowed = transitionProjectFilesToMintrDir(legacy, mintr, [outside], () => true);
      expect(allowed.renamed.map((item) => path.basename(item.to))).toEqual(["Outside.mintr"]);
      expect(fs.readFileSync(path.join(mintr, "Outside.mintr"), "utf8")).toBe("outside");
      expect(fs.existsSync(outside)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("writeTextFile", () => {
  it("replaces the file atomically and leaves no temp file behind", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mintr-write-"));
    const target = path.join(dir, "Plate.mintr");
    try {
      fs.writeFileSync(target, "old", "utf8");
      writeTextFile(target, "{\"format\":\"mintr\"}");
      expect(fs.readFileSync(target, "utf8")).toBe("{\"format\":\"mintr\"}");
      expect(fs.readdirSync(dir)).toEqual(["Plate.mintr"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the previous file intact when the write cannot complete", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mintr-write-fail-"));
    const target = path.join(dir, "Plate.mintr");
    try {
      fs.writeFileSync(target, "previous save", "utf8");
      // A directory squatting on the temp name makes writeFileSync fail
      // before anything touches the real project file.
      fs.mkdirSync(`${target}.${process.pid}.tmp`);
      expect(() => writeTextFile(target, "new contents")).toThrow();
      expect(fs.readFileSync(target, "utf8")).toBe("previous save");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-string contents before touching the disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mintr-write-type-"));
    const target = path.join(dir, "Plate.mintr");
    try {
      expect(() => writeTextFile(target, 42 as unknown as string)).toThrow(/text/);
      expect(fs.existsSync(target)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readTextFile", () => {
  it("does not grant write after a file is read", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcad-read-"));
    const legacy = path.join(dir, "opened.peakcad");
    const current = path.join(dir, "opened.mintr");
    fs.writeFileSync(legacy, "{\"name\":\"demo\"}", "utf8");
    fs.writeFileSync(current, "{\"name\":\"mintr\"}", "utf8");
    try {
      expect(readTextFile(legacy).text).toContain("demo");
      expect(readTextFile(current).text).toContain("mintr");
      expect(isAllowlisted(legacy)).toBe(false);
      expect(isAllowlisted(current)).toBe(false);
      expect(isWritablePeakcadPath(current, defaultDir, new Set())).toBe(false);
      allowPath(current);
      expect(isAllowlisted(current)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
