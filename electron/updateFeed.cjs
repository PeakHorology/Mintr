/**
 * Pure checks for PeakCAD's update feed. The desktop app only accepts a setup
 * file whose name and address match this repository.
 */

const SETUP_NAME = /^PeakCAD-Setup-(\d+\.\d+\.\d+)\.exe$/;
const RELEASE_DOWNLOAD = /^https:\/\/github\.com\/PeakHorology\/peakcad\/releases\/download\/v?(\d+\.\d+\.\d+)\/PeakCAD-Setup-(\d+\.\d+\.\d+)\.exe$/;

function versionParts(value) {
  const match = String(value ?? "").trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** 1 when `latest` is newer, 0 when equal, -1 when older. */
function compareVersions(latest, current) {
  const next = versionParts(latest);
  const installed = versionParts(current);
  if (!next || !installed) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index] ? 1 : -1;
  }
  return 0;
}

function parseLatestYml(text) {
  const body = String(text ?? "");
  const version = body.match(/^version:\s*v?(\d+\.\d+\.\d+)\s*$/m)?.[1];
  const fileName = body.match(/^path:\s*(PeakCAD-Setup-\d+\.\d+\.\d+\.exe)\s*$/m)?.[1];
  const sha512 = body.match(/^sha512:\s*([A-Za-z0-9+/=]+)\s*$/m)?.[1];
  if (!version || !fileName || !sha512) return null;
  if (!SETUP_NAME.test(fileName) || fileName !== `PeakCAD-Setup-${version}.exe`) return null;
  return { version, fileName, sha512 };
}

function acceptedSetupAsset(version, downloadUrl) {
  const match = RELEASE_DOWNLOAD.exec(String(downloadUrl ?? ""));
  if (!match) return null;
  if (match[1] !== version || match[2] !== version) return null;
  return {
    version,
    fileName: `PeakCAD-Setup-${version}.exe`,
    downloadUrl: match[0],
  };
}

function plainNotes(body) {
  const lines = String(body ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter((line) => line && !line.startsWith("```") && line.length < 220);
  return lines.slice(0, 6);
}

module.exports = {
  SETUP_NAME,
  acceptedSetupAsset,
  compareVersions,
  parseLatestYml,
  plainNotes,
  versionParts,
};
