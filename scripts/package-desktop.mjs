import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = String(pkg.version ?? "");

// Installed copies only search for these download names. Renaming them before
// a release that accepts Mintr-Setup is already installed makes that update
// invisible. It does not touch saved projects. Remove this guard only after
// that release has shipped, then publish Mintr-Setup-${version}.exe.
const setupName = pkg.build?.nsis?.artifactName;
const portableName = pkg.build?.portable?.artifactName;
const renamedDownload = process.argv.some((arg) => arg.includes("artifactName") && !arg.includes("PeakCAD-"));
if (setupName !== "PeakCAD-Setup-${version}.${ext}" || portableName !== "PeakCAD-${version}-portable.${ext}" || renamedDownload) {
  console.error("Refusing to rename the installer download. Keep PeakCAD-Setup-${version}.exe until a shipped release already accepts Mintr-Setup. Saved projects are not involved, but people on the current install would not be offered the update.");
  process.exit(1);
}
const fourPart = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(version);
const builderArgs = ["--win", ...process.argv.slice(2)];
if (fourPart) {
  builderArgs.push(`-c.buildNumber=${fourPart[4]}`, `-c.buildVersion=${version}`);
}

const child = spawn(
  process.execPath,
  ["-r", join(root, "scripts", "allow-four-part-version.cjs"), join(root, "node_modules", "electron-builder", "cli.js"), ...builderArgs],
  { stdio: "inherit", cwd: root },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
