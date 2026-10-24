const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

/** Keep in sync with apps/web/src/lib/slicerHandoff.ts */
const SLICERS = [
  {
    id: "orca",
    name: "OrcaSlicer",
    format: "3mf",
    exes: ["orca-slicer.exe"],
    dirPrefixes: ["orcaslicer"],
  },
  {
    id: "bambu",
    name: "Bambu Studio",
    format: "3mf",
    exes: ["bambu-studio.exe"],
    dirPrefixes: ["bambu studio", "bambustudio"],
  },
  {
    id: "prusa",
    name: "PrusaSlicer",
    format: "3mf",
    exes: ["prusa-slicer.exe"],
    dirPrefixes: ["prusa3d", "prusaslicer"],
  },
  {
    id: "superslicer",
    name: "SuperSlicer",
    format: "3mf",
    exes: ["superslicer.exe"],
    dirPrefixes: ["superslicer"],
  },
  {
    id: "cura",
    name: "UltiMaker Cura",
    format: "stl",
    exes: ["ultimaker-cura.exe", "cura.exe"],
    dirPrefixes: ["ultimaker cura", "ultimaker-cura"],
  },
  {
    id: "formlabs",
    name: "Formlabs PreForm",
    format: "stl",
    exes: ["preform.exe"],
    dirPrefixes: ["formlabs", "preform"],
  },
];

const BY_EXE = new Map();
for (const slicer of SLICERS) {
  for (const exe of slicer.exes) BY_EXE.set(exe, slicer);
}

const MAX_BYTES = 512 * 1024 * 1024;

function exeIn(dir, exes) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const wanted = new Set(exes);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!wanted.has(entry.name.toLowerCase())) continue;
    return path.join(dir, entry.name);
  }
  return null;
}

function findInstalled(roots, spec) {
  for (const root of roots) {
    if (!root) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folder = entry.name.toLowerCase();
      if (!spec.dirPrefixes.some((prefix) => folder.startsWith(prefix))) continue;
      const dir = path.join(root, entry.name);
      const direct = exeIn(dir, spec.exes);
      if (direct) return direct;
      let children = [];
      try {
        children = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of children) {
        if (!child.isDirectory()) continue;
        const nested = exeIn(path.join(dir, child.name), spec.exes);
        if (nested) return nested;
      }
    }
  }
  return null;
}

function detectSlicersIn(roots) {
  const found = [];
  for (const spec of SLICERS) {
    const installed = findInstalled(roots, spec);
    if (!installed) continue;
    found.push({ id: spec.id, name: spec.name, path: installed, format: spec.format });
  }
  return found;
}

function windowsScanRoots() {
  if (process.platform !== "win32") return [];
  const local = process.env.LOCALAPPDATA || "";
  return [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    local ? path.join(local, "Programs") : "",
    local,
  ].filter(Boolean);
}

function detectSlicers() {
  return detectSlicersIn(windowsScanRoots());
}

function identifyExe(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("Choose a slicer program.");
  }
  const resolved = path.resolve(filePath);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error("That slicer program is not on this computer.");
  }
  if (!stat.isFile()) {
    throw new Error("Choose the slicer program itself, not a folder.");
  }
  const spec = BY_EXE.get(path.basename(resolved).toLowerCase());
  if (!spec) {
    throw new Error("Choose OrcaSlicer, Bambu Studio, PrusaSlicer, SuperSlicer, UltiMaker Cura, or Formlabs PreForm.");
  }
  return { id: spec.id, name: spec.name, path: resolved, format: spec.format };
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function exportDirectory(folder) {
  const downloads = path.join(os.homedir(), "Downloads");
  const requested = typeof folder === "string" ? folder.trim() : "";
  if (requested) {
    const resolved = path.resolve(requested);
    if (isInside(os.homedir(), resolved) || isInside(os.tmpdir(), resolved)) {
      return resolved;
    }
  }
  return downloads;
}

function safeFileName(filename, format) {
  const ext = format === "stl" ? ".stl" : ".3mf";
  const base = path.basename(typeof filename === "string" ? filename : "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();
  if (!base.toLowerCase().endsWith(ext)) return `Mintr design${ext}`;
  return base;
}

function uniqueFile(dir, filename) {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let n = 2;
  while (fs.existsSync(candidate) && n < 50) {
    candidate = path.join(dir, `${stem} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

async function openInSlicer(payload) {
  const slicer = identifyExe(payload?.exePath);
  const format = slicer.format;
  const bytes = Buffer.from(typeof payload?.base64 === "string" ? payload.base64 : "", "base64");
  if (bytes.length === 0) {
    throw new Error("There is nothing to send to the slicer.");
  }
  if (bytes.length > MAX_BYTES) {
    throw new Error("This part is too large to send to the slicer.");
  }
  const dir = exportDirectory(payload?.folder);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = uniqueFile(dir, safeFileName(payload?.filename, format));
  fs.writeFileSync(filePath, bytes);
  // Wait for the spawn to succeed. A slicer that was uninstalled since the
  // last scan, or blocked by policy, would otherwise emit an unhandled "error"
  // event that crashes the main process instead of telling the user.
  await new Promise((resolve, reject) => {
    const child = spawn(slicer.path, [filePath], { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", (error) => {
      reject(new Error(`Mintr couldn't start ${slicer.name}${error?.message ? ` (${error.message})` : ""}. The file was saved to ${filePath}.`));
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return { path: filePath, name: slicer.name, format };
}

module.exports = {
  SLICERS,
  detectSlicers,
  detectSlicersIn,
  identifyExe,
  openInSlicer,
};
