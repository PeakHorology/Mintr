/**
 * Pure checks for the update feed. The desktop app only accepts a setup file
 * whose name and address match this repository.
 *
 * Installed copies only look for PeakCAD-Setup. Keep publishing that name
 * until a release with this check is already on their machines. The release
 * after that may use Mintr-Setup. People on the current install never see a
 * four-part version as newer, so the next update they can receive is a
 * three-part version such as 1.0.8, still named PeakCAD-Setup-1.0.8.exe.
 */

const SETUP_PREFIX = "(?:PeakCAD-Setup|Mintr-Setup)";
const VERSION_NUMBER = "(\\d+\\.\\d+\\.\\d+(?:\\.\\d+)?)";
const SETUP_NAME = new RegExp(`^${SETUP_PREFIX}-${VERSION_NUMBER}\\.exe$`);
const RELEASE_DOWNLOAD = new RegExp(
  // The repo was renamed from peakcad to Mintr; downloads redirected from the old name still count.
  `^https://github\\.com/PeakHorology/(?:peakcad|Mintr)/releases/download/v?${VERSION_NUMBER}/(${SETUP_PREFIX})-${VERSION_NUMBER}\\.exe$`,
);

function versionParts(value) {
  const match = String(value ?? "").trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ? Number(match[4]) : 0];
}

/** 1 when `latest` is newer, 0 when equal, -1 when older. */
function compareVersions(latest, current) {
  const next = versionParts(latest);
  const installed = versionParts(current);
  if (!next || !installed) return 0;
  for (let index = 0; index < 4; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index] ? 1 : -1;
  }
  return 0;
}

function parseLatestYml(text) {
  const body = String(text ?? "");
  const version = body.match(/^version:\s*v?(\d+\.\d+\.\d+(?:\.\d+)?)\s*$/m)?.[1];
  const fileName = body.match(/^path:\s*((?:PeakCAD-Setup|Mintr-Setup)-\d+\.\d+\.\d+(?:\.\d+)?\.exe)\s*$/m)?.[1];
  const sha512 = body.match(/^sha512:\s*([A-Za-z0-9+/=]+)\s*$/m)?.[1];
  if (!version || !fileName || !sha512) return null;
  const named = SETUP_NAME.exec(fileName);
  if (!named || named[1] !== version) return null;
  return { version, fileName, sha512 };
}

function acceptedSetupAsset(version, downloadUrl) {
  const match = RELEASE_DOWNLOAD.exec(String(downloadUrl ?? ""));
  if (!match) return null;
  const urlVersion = match[1];
  const prefix = match[2];
  const fileVersion = match[3];
  if (urlVersion !== version || fileVersion !== version) return null;
  return {
    version,
    fileName: `${prefix}-${version}.exe`,
    downloadUrl: match[0],
  };
}

function plainNotes(body) {
  const lines = String(body ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter((line) => line && !line.startsWith("```") && line.length < 220);
  return lines.slice(0, 16);
}

module.exports = {
  SETUP_NAME,
  acceptedSetupAsset,
  compareVersions,
  parseLatestYml,
  plainNotes,
  versionParts,
};
