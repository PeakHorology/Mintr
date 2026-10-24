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
  stdoutChunks = [];
  stdoutPending = 0;
  settleAll({ ok: false, fallback: true, message: "CAD kernel stopped" });
  if (!active) return;
  try {
    active.kill();
  } catch {
    // already gone
  }
}

// Incoming chunks are queued and joined once per complete frame. Concatenating
// on every 64 KB chunk re-copied the whole partial reply each time, which made a
// 60 MB tessellation reply cost gigabytes of memcpy before it could be parsed.
let stdoutChunks = [];
let stdoutPending = 0;

function flattenStdout() {
  if (stdoutChunks.length === 0) return;
  stdoutBuf = stdoutBuf.length === 0 && stdoutChunks.length === 1 ? stdoutChunks[0] : Buffer.concat([stdoutBuf, ...stdoutChunks]);
  stdoutChunks = [];
  stdoutPending = 0;
}

function pushStdout(chunk) {
  stdoutChunks.push(chunk);
  stdoutPending += chunk.length;
  const available = stdoutBuf.length + stdoutPending;
  if (available < 4) return;
  let header = stdoutBuf;
  if (header.length < 4) {
    flattenStdout();
    header = stdoutBuf;
  }
  const size = header.readUInt32LE(0);
  if (size === 0 || size > 256 * 1024 * 1024) {
    stopKernel();
    return;
  }
  if (stdoutBuf.length + stdoutPending < 4 + size) return;
  flattenStdout();
  consumeStdout();
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
    // Copy the remainder so the (possibly huge) frame buffer can be collected.
    const rest = stdoutBuf.subarray(4 + size);
    stdoutBuf = rest.length === 0 ? Buffer.alloc(0) : Buffer.from(rest);
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
  proc.stdout.on("data", pushStdout);
  proc.on("exit", () => {
    if (child === proc) stopKernel();
  });
  proc.on("error", () => {
    if (child === proc) stopKernel();
  });
  // Writing to a kernel that just exited raises EPIPE asynchronously on stdin;
  // without a listener that is an uncaught exception in the main process.
  proc.stdin.on("error", () => {
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
  if (!resolveKernelExe()) return { ok: false, fallback: true, message: "MintrKernel.exe is not built yet" };
  const id = job.id;
  // Resolve the process inside the queued step, not before queueing: an earlier
  // request that timed out has already killed the kernel by the time this one
  // runs, and writing to that dead stdin would wait out a second full timeout.
  const run = async () => {
    const proc = await ensureKernel();
    if (!proc || proc.killed) return { ok: false, fallback: true, message: "CAD kernel is not running" };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        settle(id, { ok: false, fallback: true, message: "CAD kernel timed out" });
        // Only kill the process this request was talking to. A respawned kernel
        // serving later requests must not die for an older request's timeout.
        if (child === proc) stopKernel();
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      try {
        writeFrame(proc, JSON.stringify(job));
      } catch {
        settle(id, { ok: false, fallback: true, message: "CAD kernel write failed" });
        if (child === proc) stopKernel();
      }
    });
  };
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

// Framing internals for the unit test only; absent in the packaged app.
if (process.env.VITEST || process.env.NODE_ENV === "test") {
  module.exports.__test = { attachChild, pending };
}
