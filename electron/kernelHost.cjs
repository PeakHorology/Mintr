const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let child = null;
let starting = null;
let nextWrite = Promise.resolve();
const pending = new Map();
let stdoutBuf = Buffer.alloc(0);

function resolveKernelExe() {
  const packed = path.join(process.resourcesPath || "", "mintr-kernel", "MintrKernel.exe");
  if (packed && fs.existsSync(packed)) return packed;
  const root = path.join(__dirname, "..");
  const candidates = [
    path.join(root, "native", "mintr-kernel", "build", "Release", "MintrKernel.exe"),
    path.join(root, "native", "mintr-kernel", "dist", "MintrKernel.exe"),
    path.join(root, "native", "mintr-kernel", "build", "MintrKernel.exe"),
  ];
  return candidates.find((filePath) => fs.existsSync(filePath)) ?? null;
}

function settle(id, value) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.resolve(value);
}

function settleAll(value) {
  for (const id of [...pending.keys()]) settle(id, value);
}

function stopKernel() {
  const active = child;
  child = null;
  starting = null;
  stdoutBuf = Buffer.alloc(0);
  settleAll({ ok: false, fallback: true, message: "CAD kernel stopped" });
  if (!active) return;
  try {
    active.kill();
  } catch {
    // already gone
  }
}

function consumeStdout() {
  while (stdoutBuf.length >= 4) {
    const size = stdoutBuf.readUInt32LE(0);
    if (size === 0 || size > 256 * 1024 * 1024) {
      stopKernel();
      return;
    }
    if (stdoutBuf.length < 4 + size) return;
    const payload = stdoutBuf.subarray(4, 4 + size).toString("utf8");
    stdoutBuf = Buffer.from(stdoutBuf.subarray(4 + size));
    let reply;
    try {
      reply = JSON.parse(payload);
    } catch {
      continue;
    }
    const replyId = typeof reply?.id === "number" ? reply.id : reply?.requestId;
    if (typeof replyId === "number") settle(replyId, reply);
  }
}

function attachChild(proc) {
  child = proc;
  proc.stdout.on("data", (chunk) => {
    stdoutBuf = Buffer.concat([stdoutBuf, chunk]);
    consumeStdout();
  });
  proc.on("exit", () => {
    if (child === proc) stopKernel();
  });
  proc.on("error", () => {
    if (child === proc) stopKernel();
  });
}

function ensureKernel() {
  if (child && !child.killed) return Promise.resolve(child);
  if (starting) return starting;
  const exe = resolveKernelExe();
  if (!exe) return Promise.resolve(null);
  starting = new Promise((resolve) => {
    try {
      const proc = spawn(exe, [], {
        cwd: path.dirname(exe),
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      });
      attachChild(proc);
      resolve(proc);
    } catch {
      child = null;
      resolve(null);
    } finally {
      starting = null;
    }
  });
  return starting;
}

function writeFrame(proc, payload) {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  proc.stdin.write(header);
  proc.stdin.write(body);
}

async function requestNativeKernel(job, timeoutMs) {
  const proc = await ensureKernel();
  if (!proc) return { ok: false, fallback: true, message: "MintrKernel.exe is not built yet" };
  const id = job.id;
  const run = () => new Promise((resolve) => {
    const timer = setTimeout(() => {
      settle(id, { ok: false, fallback: true, message: "CAD kernel timed out" });
      stopKernel();
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    try {
      writeFrame(proc, JSON.stringify(job));
    } catch {
      settle(id, { ok: false, fallback: true, message: "CAD kernel write failed" });
      stopKernel();
    }
  });
  const wait = nextWrite.then(run, run);
  nextWrite = wait.then(() => undefined, () => undefined);
  return wait;
}

function registerKernelIpc(ipcMain) {
  ipcMain.handle("peakcad:kernel-ready", () => Boolean(resolveKernelExe()));
  ipcMain.handle("peakcad:kernel-request", (_event, payload) => {
    const timeoutMs = Number(payload?.timeoutMs);
    return requestNativeKernel(payload?.job, Number.isFinite(timeoutMs) ? timeoutMs : 45_000);
  });
}

module.exports = { registerKernelIpc, stopKernel, resolveKernelExe };
