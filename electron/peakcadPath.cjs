const fs = require("node:fs");
const path = require("node:path");

const CURRENT_EXTENSION = ".mintr";
const LEGACY_EXTENSION = ".peakcad";
const EXTENSIONS = [CURRENT_EXTENSION, LEGACY_EXTENSION];
const MAX_BYTES = 512 * 1024 * 1024;

function defaultProjectDir(app) {
  return path.join(app.getPath("documents"), "PeakCAD");
}

function hasProjectExtension(filePath) {
  return EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function normalizePeakcadPath(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("Missing project file path.");
  }
  const resolved = path.resolve(filePath.trim());
  if (!hasProjectExtension(resolved)) {
    throw new Error("Mintr projects must use the .mintr or .peakcad extension.");
  }
  return resolved;
}

function siblingDocumentsProjectDir(defaultDir) {
  const resolved = path.resolve(defaultDir);
  const name = path.basename(resolved).toLowerCase();
  const parent = path.dirname(resolved);
  if (name === "peakcad") return path.join(parent, "Mintr");
  if (name === "mintr") return path.join(parent, "PeakCAD");
  return null;
}

function isInsideDir(filePath, rootDir) {
  const resolved = path.resolve(filePath).toLowerCase();
  const root = `${path.resolve(rootDir)}${path.sep}`.toLowerCase();
  return resolved.startsWith(root);
}

function isWritablePeakcadPath(filePath, defaultDir, allowedPaths) {
  const resolved = normalizePeakcadPath(filePath);
  const roots = [defaultDir, siblingDocumentsProjectDir(defaultDir)].filter(Boolean);
  const inside = roots.some((root) => isInsideDir(resolved, root));
  return inside || allowedPaths.has(resolved.toLowerCase());
}

function ensureProjectExtension(filePath, preferred = CURRENT_EXTENSION) {
  if (typeof filePath !== "string" || !filePath.trim()) return `Untitled design${preferred}`;
  const trimmed = filePath.trim();
  if (hasProjectExtension(trimmed)) return trimmed;
  return `${trimmed}${preferred}`;
}

function projectStem(filePath) {
  const ext = path.extname(filePath);
  return hasProjectExtension(filePath) ? path.basename(filePath, ext) : path.basename(filePath);
}

function stemTaken(dir, stem) {
  return EXTENSIONS.some((ext) => fs.existsSync(path.join(dir, `${stem}${ext}`)));
}

function uniquePath(filePath) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const preferred = hasProjectExtension(filePath) ? ext : CURRENT_EXTENSION;
  const original = projectStem(filePath);
  let stem = original;
  let index = 2;
  while (stemTaken(dir, stem)) {
    stem = `${original} (${index})`;
    index += 1;
  }
  return path.join(dir, `${stem}${preferred}`);
}

function findPeakcadArg(argv = []) {
  return argv.find((arg) => {
    if (typeof arg !== "string" || arg.startsWith("-")) return false;
    return hasProjectExtension(arg);
  }) ?? null;
}

const LEGACY_WALK_DEPTH = 6;

function collectLegacyProjectFiles(rootDir, extraPaths = [], isAllowed = () => true) {
  const found = new Map();
  const root = path.resolve(rootDir);
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) walk(full, depth - 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(LEGACY_EXTENSION)) continue;
      found.set(full.toLowerCase(), full);
    }
  };
  if (fs.existsSync(root)) walk(root, LEGACY_WALK_DEPTH);
  for (const extra of extraPaths) {
    if (typeof extra !== "string" || !extra.trim()) continue;
    let resolved;
    try {
      resolved = normalizePeakcadPath(extra);
    } catch {
      continue;
    }
    if (path.extname(resolved).toLowerCase() !== LEGACY_EXTENSION) continue;
    if (!isAllowed(resolved)) continue;
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    found.set(resolved.toLowerCase(), resolved);
  }
  return [...found.values()];
}

function relativeInside(root, filePath) {
  const rel = path.relative(path.resolve(root), path.resolve(filePath));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel;
}

function destinationForProjectFile(from, legacyRoot, mintrRoot) {
  const ext = path.extname(from);
  const stem = path.basename(from, ext);
  const fileName = `${stem}${CURRENT_EXTENSION}`;
  const fromLegacy = relativeInside(legacyRoot, from);
  const fromMintr = relativeInside(mintrRoot, from);
  const rel = fromLegacy ?? fromMintr;
  if (!rel) return path.join(mintrRoot, fileName);
  const relDir = path.dirname(rel);
  return path.join(mintrRoot, relDir === "." ? "" : relDir, fileName);
}

function moveProjectFile(from, to) {
  const source = path.resolve(from);
  const target = path.resolve(to);
  if (source.toLowerCase() === target.toLowerCase()) return { from: source, to: target, status: "unchanged" };
  if (fs.existsSync(target)) return { from: source, to: target, status: "already" };
  const sourceStat = fs.statSync(source);
  if (!sourceStat.isFile()) throw new Error("That path is not a file.");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (!error || error.code !== "EXDEV") throw error;
    try {
      fs.copyFileSync(source, target);
      const copied = fs.statSync(target);
      if (!copied.isFile() || copied.size !== sourceStat.size) {
        throw new Error("The copy did not match the original, so the original was left in place.");
      }
    } catch (copyError) {
      fs.rmSync(target, { force: true });
      throw copyError;
    }
    try {
      fs.rmSync(source, { force: true });
    } catch {
      // The new file matches the original. The original stays as a second copy.
    }
  }
  if (!fs.existsSync(target) || fs.statSync(target).size !== sourceStat.size) {
    throw new Error("The file could not be moved, so the original was left in place.");
  }
  return { from: source, to: target, status: "renamed" };
}

function collectProjectFilesForMintrDir(legacyRoot, mintrRoot, extraPaths = [], isAllowed = () => true) {
  const found = new Map();
  const addFile = (filePath) => {
    let resolved;
    try {
      resolved = normalizePeakcadPath(filePath);
    } catch {
      return;
    }
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return;
    }
    if (!stat.isFile()) return;
    if (isInsideDir(resolved, mintrRoot) && path.extname(resolved).toLowerCase() === CURRENT_EXTENSION) return;
    found.set(resolved.toLowerCase(), resolved);
  };
  const walk = (dir, depth, extension) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) walk(full, depth - 1, extension);
        continue;
      }
      if (!entry.isFile()) continue;
      const name = entry.name.toLowerCase();
      if (extension && !name.endsWith(extension)) continue;
      if (!extension && !EXTENSIONS.some((ext) => name.endsWith(ext))) continue;
      addFile(full);
    }
  };
  if (fs.existsSync(legacyRoot)) walk(legacyRoot, LEGACY_WALK_DEPTH, null);
  if (fs.existsSync(mintrRoot)) walk(mintrRoot, LEGACY_WALK_DEPTH, LEGACY_EXTENSION);
  for (const extra of extraPaths) {
    if (typeof extra !== "string" || !extra.trim()) continue;
    let resolved;
    try {
      resolved = normalizePeakcadPath(extra);
    } catch {
      continue;
    }
    if (!isAllowed(resolved)) continue;
    addFile(resolved);
  }
  return [...found.values()].sort((left, right) => {
    const leftRank = left.toLowerCase().endsWith(CURRENT_EXTENSION) ? 0 : 1;
    const rightRank = right.toLowerCase().endsWith(CURRENT_EXTENSION) ? 0 : 1;
    return leftRank - rightRank;
  });
}

/**
 * Move project files into Documents/Mintr and use the .mintr name.
 * A destination that already exists is left untouched, and so is the source.
 */
function transitionProjectFilesToMintrDir(legacyRoot, mintrRoot, extraPaths = [], isAllowed = () => true) {
  const renamed = [];
  const already = [];
  const failed = [];
  for (const file of collectProjectFilesForMintrDir(legacyRoot, mintrRoot, extraPaths, isAllowed)) {
    try {
      const result = moveProjectFile(file, destinationForProjectFile(file, legacyRoot, mintrRoot));
      if (result.status === "renamed") renamed.push({ from: result.from, to: result.to });
      else if (result.status === "already") already.push({ from: result.from, to: result.to });
    } catch (error) {
      failed.push({
        from: file,
        message: error instanceof Error ? error.message : "Could not move that file.",
      });
    }
  }
  return { renamed, already, failed };
}

/** Rename one `.peakcad` file to `.mintr`. An existing `.mintr` file is left in place. */
function transitionLegacyProjectFile(filePath) {
  const from = normalizePeakcadPath(filePath);
  if (path.extname(from).toLowerCase() !== LEGACY_EXTENSION) {
    throw new Error("Only a .peakcad file can be changed to .mintr.");
  }
  const to = path.join(path.dirname(from), `${path.basename(from, path.extname(from))}${CURRENT_EXTENSION}`);
  if (fs.existsSync(to)) return { from, to, status: "already" };
  fs.renameSync(from, to);
  return { from, to, status: "renamed" };
}

/** Existing file for a design name. `.mintr` wins when both extensions are present. */
function resolveProjectFile(dir, defaultName) {
  const raw = typeof defaultName === "string" && defaultName.trim()
    ? defaultName.trim()
    : `Untitled design${CURRENT_EXTENSION}`;
  const stem = projectStem(raw);
  const current = path.join(dir, `${stem}${CURRENT_EXTENSION}`);
  if (fs.existsSync(current)) return current;
  const legacy = path.join(dir, `${stem}${LEGACY_EXTENSION}`);
  if (fs.existsSync(legacy)) return legacy;
  return null;
}

module.exports = {
  CURRENT_EXTENSION,
  LEGACY_EXTENSION,
  EXTENSIONS,
  MAX_BYTES,
  collectLegacyProjectFiles,
  defaultProjectDir,
  ensureProjectExtension,
  findPeakcadArg,
  isWritablePeakcadPath,
  normalizePeakcadPath,
  resolveProjectFile,
  transitionLegacyProjectFile,
  transitionProjectFilesToMintrDir,
  uniquePath,
};
