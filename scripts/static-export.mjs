import { spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

process.env.STATIC_EXPORT = "true";

// The slicer route starts a program on this computer. A static desktop export
// cannot include it. The packaged app opens the slicer through Electron instead.
const slicerRoute = path.resolve("apps/web/src/app/api/slicer");
const slicerHold = path.resolve("apps/web/.export-hold/slicer");

function restoreSlicerRoute() {
  if (!existsSync(slicerHold)) return;
  if (existsSync(slicerRoute)) {
    rmSync(slicerHold, { recursive: true, force: true });
  } else {
    mkdirSync(path.dirname(slicerRoute), { recursive: true });
    renameSync(slicerHold, slicerRoute);
  }
  rmSync(path.dirname(slicerHold), { recursive: true, force: true });
}

function parkSlicerRoute() {
  restoreSlicerRoute();
  if (!existsSync(slicerRoute)) return;
  mkdirSync(path.dirname(slicerHold), { recursive: true });
  renameSync(slicerRoute, slicerHold);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: true, env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

let exportError = null;
parkSlicerRoute();
try {
  await run("npx", ["next", "build", "apps/web"]);
  await run("node", ["scripts/verify-static-worker-assets.mjs"]);
} catch (error) {
  exportError = error;
} finally {
  restoreSlicerRoute();
}
if (exportError) throw exportError;
