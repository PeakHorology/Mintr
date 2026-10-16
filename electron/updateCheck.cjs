const { app, shell } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { acceptedSetupAsset, compareVersions, parseLatestYml, plainNotes } = require("./updateFeed.cjs");

const FEED_URL = "https://github.com/PeakHorology/peakcad/releases/latest/download/latest.yml";
const RELEASE_API = "https://api.github.com/repos/PeakHorology/peakcad/releases/latest";
const RELEASE_PAGE = "https://github.com/PeakHorology/peakcad/releases/latest";
const MAX_SETUP_BYTES = 400 * 1024 * 1024;

let offered = null;

function isPortableBuild() {
  return Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
}

async function readText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "PeakCAD",
    },
    signal: AbortSignal.timeout(8000),
    redirect: "follow",
  });
  if (!response.ok) return null;
  return response.text();
}

async function readRelease() {
  const response = await fetch(RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "PeakCAD",
    },
    signal: AbortSignal.timeout(8000),
    redirect: "follow",
  });
  if (!response.ok) return null;
  return response.json();
}

function offerFrom(version, fileName, sha512, notes) {
  if (compareVersions(version, app.getVersion()) <= 0) return null;
  const downloadUrl = `https://github.com/PeakHorology/peakcad/releases/download/v${version}/${fileName}`;
  if (!acceptedSetupAsset(version, downloadUrl)) return null;
  const portable = isPortableBuild();
  return {
    version,
    current: app.getVersion(),
    notes: notes.length ? notes : ["A new version of PeakCAD is ready."],
    portable,
    canInstall: Boolean(app.isPackaged && !portable && sha512),
    sha512: sha512 || null,
    downloadUrl,
    fileName,
  };
}

async function checkForUpdate() {
  offered = null;
  try {
    const yml = parseLatestYml(await readText(FEED_URL));
    const release = await readRelease().catch(() => null);
    const notes = plainNotes(release?.body);
    if (yml) {
      offered = offerFrom(yml.version, yml.fileName, yml.sha512, notes);
      return publicOffer(offered);
    }
    const asset = Array.isArray(release?.assets)
      ? release.assets.find((entry) => acceptedSetupAsset(String(release.tag_name || "").replace(/^v/, ""), entry?.browser_download_url))
      : null;
    const version = String(release?.tag_name || "").replace(/^v/, "");
    if (!asset) return null;
    offered = offerFrom(version, asset.name, null, notes);
    return publicOffer(offered);
  } catch {
    offered = null;
    return null;
  }
}

function publicOffer(offer) {
  if (!offer) return null;
  return {
    version: offer.version,
    current: offer.current,
    notes: offer.notes,
    portable: offer.portable,
    canInstall: offer.canInstall,
  };
}

async function openUpdateDownload() {
  await shell.openExternal(RELEASE_PAGE);
  return { ok: true };
}

async function downloadSetup(offer) {
  const response = await fetch(offer.downloadUrl, {
    headers: { "User-Agent": "PeakCAD", Accept: "application/octet-stream" },
    redirect: "follow",
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error("download failed");
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_SETUP_BYTES) throw new Error("download too large");
  const filePath = path.join(os.tmpdir(), offer.fileName);
  const hash = crypto.createHash("sha512");
  const file = fs.createWriteStream(filePath);
  let received = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += bytes.length;
      if (received > MAX_SETUP_BYTES) throw new Error("download too large");
      hash.update(bytes);
      if (!file.write(bytes)) {
        await new Promise((resolve) => file.once("drain", resolve));
      }
    }
  } catch (error) {
    file.destroy();
    fs.rmSync(filePath, { force: true });
    throw error;
  }
  await new Promise((resolve, reject) => {
    file.end(() => resolve());
    file.on("error", reject);
  });
  const digest = hash.digest("base64");
  if (digest !== offer.sha512) {
    fs.rmSync(filePath, { force: true });
    throw new Error("checksum mismatch");
  }
  return filePath;
}

async function installUpdate() {
  const offer = offered;
  if (!offer?.canInstall) {
    return openUpdateDownload();
  }
  const filePath = await downloadSetup(offer);
  const child = spawn(filePath, [], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  setTimeout(() => app.quit(), 400);
  return { ok: true };
}

function registerUpdateIpc(ipcMain) {
  ipcMain.handle("peakcad:update-check", () => checkForUpdate());
  ipcMain.handle("peakcad:update-open", () => openUpdateDownload());
  ipcMain.handle("peakcad:update-install", () => installUpdate().catch(() => {
    throw new Error("PeakCAD couldn't download the update. Nothing was installed.");
  }));
}

module.exports = { registerUpdateIpc };
