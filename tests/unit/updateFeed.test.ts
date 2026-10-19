import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { acceptedSetupAsset, compareVersions, parseLatestYml, plainNotes } = require("../../electron/updateFeed.cjs");

describe("PeakCAD update feed", () => {
  it("reads a signed setup description and ignores anything else", () => {
    const parsed = parseLatestYml(`
version: 1.0.5
files:
  - url: PeakCAD-Setup-1.0.5.exe
    sha512: abcdef==
    size: 10
path: PeakCAD-Setup-1.0.5.exe
sha512: abcdef==
`);
    expect(parsed).toEqual({
      version: "1.0.5",
      fileName: "PeakCAD-Setup-1.0.5.exe",
      sha512: "abcdef==",
    });
    expect(parseLatestYml("version: 1.0.5\npath: other.exe\nsha512: abcdef==\n")).toBeNull();
  });

  it("accepts only this repository's setup file for the same version", () => {
    const url = "https://github.com/PeakHorology/peakcad/releases/download/v1.0.5/PeakCAD-Setup-1.0.5.exe";
    expect(acceptedSetupAsset("1.0.5", url)?.fileName).toBe("PeakCAD-Setup-1.0.5.exe");
    const mintr = "https://github.com/PeakHorology/peakcad/releases/download/v1.0.8/Mintr-Setup-1.0.8.exe";
    expect(acceptedSetupAsset("1.0.8", mintr)?.fileName).toBe("Mintr-Setup-1.0.8.exe");
    expect(parseLatestYml("version: 1.0.8\npath: Mintr-Setup-1.0.8.exe\nsha512: abcdef==\n")?.fileName).toBe("Mintr-Setup-1.0.8.exe");
    expect(acceptedSetupAsset("1.0.5", "https://example.com/PeakCAD-Setup-1.0.5.exe")).toBeNull();
    expect(acceptedSetupAsset("1.0.8", "https://github.com/PeakHorology/peakcad/releases/download/v1.0.8/Mintr-Setup-1.0.7.exe")).toBeNull();
    expect(acceptedSetupAsset("1.0.4", url)).toBeNull();
  });

  it("keeps the published download name so current installs can update", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(pkg.build.nsis.artifactName).toBe("PeakCAD-Setup-${version}.${ext}");
    expect(pkg.build.portable.artifactName).toBe("PeakCAD-${version}-portable.${ext}");
  });

  it("notices a newer version and keeps release notes short", () => {
    expect(compareVersions("1.0.5", "1.0.4")).toBe(1);
    expect(compareVersions("1.0.4", "1.0.4")).toBe(0);
    expect(compareVersions("1.0.3", "v1.0.4")).toBe(-1);
    expect(compareVersions("1.0.7.5", "1.0.7")).toBe(1);
    expect(compareVersions("1.0.8", "1.0.7.5")).toBe(1);
    expect(compareVersions("1.0.7.4", "1.0.7.5")).toBe(-1);
    expect(plainNotes("# PeakCAD 1.0.5\n\n- History opens under its button.\n```")).toEqual([
      "PeakCAD 1.0.5",
      "History opens under its button.",
    ]);
    const longNotes = ["# PeakCAD 1.0.6", ...Array.from({ length: 20 }, (_, index) => `- Note ${index + 1}`)].join("\n");
    expect(plainNotes(longNotes)).toHaveLength(16);
  });
});
