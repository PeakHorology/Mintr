const { dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const {
  CURRENT_EXTENSION,
  MAX_BYTES,
  defaultProjectDir,
  ensureProjectExtension,
  findPeakcadArg,
  isWritablePeakcadPath,
  normalizePeakcadPath,
  resolveProjectFile,
  transitionProjectFilesToMintrDir,
  uniquePath,
} = require("./peakcadPath.cjs");

const allowedPaths = new Set();
const PROJECT_FOLDER_FILE = "mintr-project-folder.json";
const PROJECT_MOVES_FILE = "mintr-project-moves.json";

function projectFolderFlag(app) {
  return path.join(app.getPath("userData"), PROJECT_FOLDER_FILE);
}

function mintrProjectFolderChosen(app) {
  try {
    return JSON.parse(fs.readFileSync(projectFolderFlag(app), "utf8"))?.folder === "mintr";
  } catch {
    return false;
  }
}

function chooseMintrProjectFolder(app) {
  const target = projectFolderFlag(app);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ folder: "mintr" }), "utf8");
  fs.renameSync(temporary, target);
}

function activeProjectDir(app) {
  const documents = app.getPath("documents");
  return path.join(documents, mintrProjectFolderChosen(app) ? "Mintr" : "PeakCAD");
}

function movesFile(app) {
  return path.join(app.getPath("userData"), PROJECT_MOVES_FILE);
}

function readRememberedMoves(app) {
  try {
    const parsed = JSON.parse(fs.readFileSync(movesFile(app), "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.from === "string" && typeof item.to === "string");
  } catch {
    return [];
  }
}

function rememberMove(app, move) {
  const moves = readRememberedMoves(app).filter((item) => item.from.toLowerCase() !== move.from.toLowerCase());
  moves.push({ from: move.from, to: move.to });
  const target = movesFile(app);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(moves), "utf8");
  fs.renameSync(temporary, target);
}

function allowPath(filePath) {
  const resolved = normalizePeakcadPath(filePath);
  allowedPaths.add(resolved.toLowerCase());
  return resolved;
}

function isAllowlisted(filePath) {
  return allowedPaths.has(normalizePeakcadPath(filePath).toLowerCase());
}

function assertWritable(app, filePath) {
  const resolved = normalizePeakcadPath(filePath);
  if (isWritablePeakcadPath(resolved, activeProjectDir(app), allowedPaths)) {
    return resolved;
  }
  throw new Error("That file path is not available for save.");
}

function writeTextFile(filePath, text) {
  if (typeof text !== "string") {
    throw new Error("Project file contents must be text.");
  }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_BYTES) {
    throw new Error("This project file is too large to save.");
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Write beside the target and rename over it. A crash, power loss, full disk
  // or a sync client holding the file mid-write must never leave a truncated
  // .mintr where the user's only on-disk copy used to be.
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, text, "utf8");
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // The target file is untouched; the leftover temp file is harmless.
    }
    throw error;
  }
  return allowPath(filePath);
}

function readTextFile(filePath) {
  const resolved = normalizePeakcadPath(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error("That path is not a file.");
  }
  if (stat.size > MAX_BYTES) {
    throw new Error("This project file is too large to open.");
  }
  return { path: resolved, text: fs.readFileSync(resolved, "utf8") };
}

function registerProjectFileIpc(app, getWindow) {
  ipcMain.handle("peakcad:file-default-dir", async () => activeProjectDir(app));

  ipcMain.handle("peakcad:file-open", async () => {
    const window = getWindow();
    const result = await dialog.showOpenDialog(window ?? undefined, {
      title: "Open Mintr project",
      filters: [{ name: "Mintr project", extensions: ["mintr", "peakcad"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const resolved = allowPath(result.filePaths[0]);
    return readTextFile(resolved);
  });

  ipcMain.handle("peakcad:file-read", async (_event, filePath) => readTextFile(filePath));

  ipcMain.handle("peakcad:file-write", async (_event, payload) => {
    const resolved = assertWritable(app, payload?.path);
    return { path: writeTextFile(resolved, payload?.text) };
  });

  ipcMain.handle("peakcad:file-save-as", async (_event, payload) => {
    const window = getWindow();
    const result = await dialog.showSaveDialog(window ?? undefined, {
      title: "Save Mintr project",
      defaultPath: path.join(activeProjectDir(app), typeof payload?.defaultName === "string" ? payload.defaultName : `Untitled design${CURRENT_EXTENSION}`),
      filters: [{ name: "Mintr project", extensions: ["mintr", "peakcad"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const target = allowPath(ensureProjectExtension(result.filePath, CURRENT_EXTENSION));
    return { path: writeTextFile(target, payload?.text) };
  });

  ipcMain.handle("peakcad:file-resolve-name", async (_event, defaultName) => {
    const target = resolveProjectFile(activeProjectDir(app), defaultName);
    if (!target) return null;
    return readTextFile(target);
  });

  ipcMain.handle("peakcad:file-write-new", async (_event, payload) => {
    const dir = activeProjectDir(app);
    fs.mkdirSync(dir, { recursive: true });
    const name = ensureProjectExtension(
      typeof payload?.defaultName === "string" ? payload.defaultName : `Untitled design${CURRENT_EXTENSION}`,
      CURRENT_EXTENSION,
    );
    const target = uniquePath(path.join(dir, name));
    return { path: writeTextFile(target, payload?.text) };
  });

  ipcMain.handle("peakcad:file-pending-moves", async () => readRememberedMoves(app));

  ipcMain.handle("peakcad:file-transition-legacy", async (_event, extraPaths) => {
    const documents = app.getPath("documents");
    const legacyRoot = path.join(documents, "PeakCAD");
    const mintrRoot = path.join(documents, "Mintr");
    const result = transitionProjectFilesToMintrDir(
      legacyRoot,
      mintrRoot,
      Array.isArray(extraPaths) ? extraPaths : [],
      (filePath) => isWritablePeakcadPath(filePath, legacyRoot, allowedPaths),
    );
    for (const move of result.renamed) {
      allowedPaths.delete(move.from.toLowerCase());
      allowPath(move.to);
      rememberMove(app, move);
    }
    chooseMintrProjectFolder(app);
    return result;
  });

  ipcMain.handle("peakcad:file-reveal", async (_event, filePath) => {
    const resolved = normalizePeakcadPath(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error("That project file is no longer on disk.");
    }
    shell.showItemInFolder(resolved);
  });
}

module.exports = {
  allowPath,
  defaultProjectDir,
  findPeakcadArg,
  isAllowlisted,
  readTextFile,
  registerProjectFileIpc,
  writeTextFile,
};
