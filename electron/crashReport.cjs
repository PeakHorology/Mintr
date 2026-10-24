const { app, clipboard, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Change this if problem reports should arrive somewhere else. */
const FEEDBACK_EMAIL = "support@peakhorology.com";
const MAX_REPORTS = 8;
const MAX_NOTES = 40;

const notes = [];
let installed = false;

function isPortableBuild() {
  return Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
}

function reportDirectory() {
  const directory = path.join(app.getPath("userData"), "crash-reports");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function trimReports(prefix, extension = ".txt") {
  const directory = reportDirectory();
  const files = fs.readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith(extension))
    .sort();
  while (files.length > MAX_REPORTS) {
    const oldest = files.shift();
    if (oldest) fs.rmSync(path.join(directory, oldest), { force: true });
  }
}

function appFacts() {
  return [
    `Time: ${new Date().toISOString()}`,
    `Version: ${app.getVersion()}`,
    `Electron: ${process.versions.electron}`,
    `Chrome: ${process.versions.chrome}`,
    `Node: ${process.versions.node}`,
    `OS: ${process.platform} ${process.getSystemVersion?.() || ""} ${process.arch}`.replace(/\s+/g, " ").trim(),
    `Packaged: ${app.isPackaged ? "yes" : "no"}`,
    `Portable: ${isPortableBuild() ? "yes" : "no"}`,
  ];
}

function noteBlock() {
  if (!notes.length) return ["(none)"];
  return notes.map((entry) => `- ${entry.time} ${entry.message}`);
}

function addCrashNote(message) {
  const text = String(message ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!text) return;
  notes.push({ time: new Date().toISOString(), message: text });
  if (notes.length > MAX_NOTES) notes.shift();
}

function writeTextReport(prefix, lines) {
  const directory = reportDirectory();
  const filePath = path.join(directory, `${prefix}-${stamp()}.txt`);
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  trimReports(prefix);
  return filePath;
}

/**
 * Stack traces carry C:\Users\<name>\… paths. People paste crash reports into
 * public issues, so the account name is replaced before anything is written.
 */
function redactUserPaths(text) {
  let out = String(text ?? "");
  try {
    const home = os.homedir();
    if (home) {
      const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(escaped.replace(/\\\\/g, "[\\\\/]"), "gi"), "~");
    }
    const user = os.userInfo().username;
    if (user) {
      out = out.replace(new RegExp(`([\\\\/]Users[\\\\/])${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\\\/])`, "gi"), "$1<user>");
    }
  } catch {
    // Redaction is best effort; the report is still written.
  }
  return out;
}

function recordCrash(kind, details) {
  try {
    const lines = [
      "Mintr crash report",
      "====================",
      ...appFacts(),
      `Kind: ${kind}`,
      "",
      "Details",
      "-------",
      redactUserPaths(details).trim() || "(no details)",
      "",
      "Recent notes",
      "------------",
      ...noteBlock(),
      "",
      "The open design is not included.",
    ];
    return writeTextReport("crash", lines);
  } catch {
    return null;
  }
}

function latestCrashText() {
  try {
    const directory = reportDirectory();
    const files = fs.readdirSync(directory).filter((name) => name.startsWith("crash-") && name.endsWith(".txt")).sort();
    const newest = files[files.length - 1];
    if (!newest) return "(no crash saved on this computer)";
    return fs.readFileSync(path.join(directory, newest), "utf8").slice(0, 12000);
  } catch {
    return "(could not read the saved crash report)";
  }
}

function buildProblemReport() {
  return [
    "Mintr problem report",
    "======================",
    ...appFacts(),
    "",
    "What you were doing",
    "-------------------",
    "(filled in by the email)",
    "",
    "Recent notes",
    "------------",
    ...noteBlock(),
    "",
    "Latest crash",
    "------------",
    latestCrashText().trim(),
    "",
    "The open design is not included.",
  ].join("\n");
}

function writeMailDraft(subject, body) {
  const filePath = path.join(reportDirectory(), `message-${stamp()}.eml`);
  const contents = [
    `To: ${FEEDBACK_EMAIL}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=\"utf-8\"",
    "Content-Transfer-Encoding: 8bit",
    "X-Unsent: 1",
    "",
    body,
  ].join("\r\n");
  fs.writeFileSync(filePath, contents, "utf8");
  trimReports("message", ".eml");
  return filePath;
}

async function openMailDraft(subject, body) {
  const filePath = writeMailDraft(subject, body);
  const error = await shell.openPath(filePath);
  return { ok: !error, path: filePath, error: error || "" };
}

async function openFeedback() {
  const subject = `Mintr feedback (${app.getVersion()})`;
  const body = [
    `Mintr ${app.getVersion()}`,
    "",
    "We'd love to hear what you think.",
    "",
    "",
    "Your design is not included. Attach a project file only if you want it looked at.",
  ].join("\n");
  return openMailDraft(subject, body);
}

async function openProblemReport() {
  const report = buildProblemReport();
  const filePath = writeTextReport("problem", report.split("\n"));
  try {
    clipboard.writeText(report);
  } catch {
    // The email still opens with the report written in it.
  }
  const subject = `Mintr problem report (${app.getVersion()})`;
  const body = [
    `Mintr ${app.getVersion()}`,
    "",
    "What were you doing when this happened?",
    "",
    "",
    "Your design is not included. Attach a project file only if you want it looked at.",
    "",
    report,
    "",
    `Saved copy: ${filePath}`,
  ].join("\n");
  const opened = await openMailDraft(subject, body);
  return { ...opened, path: filePath };
}

function installCrashReports() {
  if (installed) return;
  installed = true;

  process.on("uncaughtException", (error) => {
    recordCrash("uncaughtException", error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error));
  });
  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    recordCrash("unhandledRejection", `${error.name}: ${error.message}\n${error.stack || ""}`);
  });

  app.on("child-process-gone", (_event, details) => {
    recordCrash("child-process-gone", `type: ${details.type}\nreason: ${details.reason}\nexit code: ${details.exitCode}\nname: ${details.name || ""}`);
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("render-process-gone", (_goneEvent, details) => {
      recordCrash("render-process-gone", `reason: ${details.reason}\nexit code: ${details.exitCode}`);
    });
  });
}

function registerCrashReportIpc(ipcMain) {
  ipcMain.on("peakcad:crash-note", (_event, message) => {
    if (typeof message === "string") addCrashNote(message);
  });
  ipcMain.handle("peakcad:report-problem", () => openProblemReport());
  ipcMain.handle("peakcad:send-feedback", () => openFeedback());
  ipcMain.handle("peakcad:crash-text", () => buildProblemReport());
}

module.exports = {
  FEEDBACK_EMAIL,
  installCrashReports,
  openFeedback,
  openProblemReport,
  registerCrashReportIpc,
};
