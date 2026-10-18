import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = String(pkg.version ?? "");
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
