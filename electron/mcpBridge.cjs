const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const STALE_MS = 6500;
const CLIENT_LISTEN_MS = 20_000;
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const READ_ACTIONS = new Set([
  "get_scene",
  "list_objects",
  "list_edges",
  "inspect_errors",
  "capture_image",
  "select_objects",
]);

function createId() {
  return crypto.randomUUID();
}

function createBridge() {
  const editors = new Map();
  const queues = new Map();
  const pending = new Map();
  let clientSeenAt = 0;
  let clientName = "";

  function prune(current = Date.now()) {
    for (const [editorId, editor] of editors) {
      if (current - editor.lastSeen <= STALE_MS) continue;
      editors.delete(editorId);
      queues.delete(editorId);
      for (const [commandId, entry] of pending) {
        if (entry.editorId !== editorId) continue;
        clearTimeout(entry.timer);
        pending.delete(commandId);
        entry.resolve({
          commandId,
          ok: false,
          error: `PeakCAD project ${editor.editorNumber} is no longer open`,
          completedAt: current,
        });
      }
    }
  }

  function listEditors() {
    prune();
    return [...editors.values()].sort((a, b) => a.editorNumber - b.editorNumber);
  }

  function shouldListen(editorId) {
    const recent = Date.now() - clientSeenAt < CLIENT_LISTEN_MS;
    const queued = (queues.get(editorId)?.length ?? 0) > 0;
    const waiting = [...pending.values()].some((entry) => entry.editorId === editorId);
    return recent || queued || waiting;
  }

  function register(editor) {
    const current = Date.now();
    prune(current);
    editors.set(editor.editorId, { ...editor, lastSeen: current });
    queues.set(editor.editorId, queues.get(editor.editorId) ?? []);
  }

  function poll(editorId) {
    prune();
    const queue = queues.get(editorId);
    return queue?.shift() ?? null;
  }

  function waitFor(editorId, waitMs) {
    const immediate = poll(editorId);
    if (immediate || waitMs <= 0) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      const started = Date.now();
      let settled = false;
      const finish = (command) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        resolve(command);
      };
      const timer = setInterval(() => {
        const command = poll(editorId);
        if (command || Date.now() - started >= waitMs) finish(command);
      }, 40);
    });
  }

  function complete(editorId, result) {
    const entry = pending.get(result.commandId);
    if (!entry || entry.editorId !== editorId) return false;
    clearTimeout(entry.timer);
    pending.delete(result.commandId);
    entry.resolve({ ...result, completedAt: result.completedAt ?? Date.now() });
    return true;
  }

  function dispatch({ editorId, editorNumber, action, params = {}, timeoutMs = 15000, clientName: namedClient }) {
    prune();
    if (namedClient) clientName = namedClient;
    clientSeenAt = Date.now();
    const editor =
      (editorId ? editors.get(editorId) : null) ??
      (typeof editorNumber === "number" ? [...editors.values()].find((candidate) => candidate.editorNumber === editorNumber) : null);
    if (!editor) {
      return Promise.resolve({
        commandId: "",
        ok: false,
        error: typeof editorNumber === "number" ? `No open PeakCAD project ${editorNumber}` : "No open PeakCAD project",
        completedAt: Date.now(),
      });
    }
    if (editor.modelsEnabled === false) {
      return Promise.resolve({
        commandId: "",
        ok: false,
        error: "Models are turned off in PeakCAD Settings",
        completedAt: Date.now(),
      });
    }
    const command = {
      id: createId(),
      action,
      params,
      clientName: clientName || "A model",
      createdAt: Date.now(),
    };
    const queue = queues.get(editor.editorId) ?? [];
    queue.push(command);
    queues.set(editor.editorId, queue);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(command.id);
        const queued = queues.get(editor.editorId);
        if (queued) {
          const index = queued.findIndex((entry) => entry.id === command.id);
          if (index >= 0) queued.splice(index, 1);
        }
        resolve({
          commandId: command.id,
          ok: false,
          error: `Timed out waiting for PeakCAD project ${editor.editorNumber}`,
          completedAt: Date.now(),
        });
      }, Math.max(1000, Math.min(timeoutMs, 180000)));
      pending.set(command.id, { editorId: editor.editorId, resolve, timer });
    });
  }

  return {
    listEditors,
    shouldListen,
    register,
    waitFor,
    complete,
    dispatch,
    noteClient(name) {
      clientSeenAt = Date.now();
      if (name) clientName = name;
    },
    clientName: () => clientName,
    readActions: READ_ACTIONS,
  };
}

function pairingCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function writeSession(filePath, session) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  response.end(body);
}

function isPageRequest(request, origin) {
  const header = request.headers.origin;
  if (header && header === origin) return true;
  return request.headers["sec-fetch-site"] === "same-origin";
}

function presentedToken(request) {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const alternate = request.headers["x-peakcad-token"];
  return typeof alternate === "string" ? alternate.trim() : "";
}

function createModelServer({ userData, port, origin }) {
  const bridge = createBridge();
  const session = {
    token: crypto.randomBytes(24).toString("hex"),
    pairingCode: pairingCode(),
    port,
    url: origin,
  };
  const sessionPath = path.join(userData, "mcp-session.json");
  writeSession(sessionPath, session);

  function authorized(request) {
    const token = presentedToken(request);
    return token === session.token || token === session.pairingCode;
  }

  async function handle(request, response) {
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname !== "/api/sketchforge-mcp" && url.pathname !== "/api/peakcad-mcp") {
      return false;
    }
    try {
      if (request.method === "GET") {
        if (!isPageRequest(request, origin) && !authorized(request)) {
          sendJson(response, 401, { error: "PeakCAD needs the session token from this computer." });
          return true;
        }
        if (authorized(request)) bridge.noteClient();
        sendJson(response, 200, {
          editors: bridge.listEditors(),
          pairingCode: isPageRequest(request, origin) ? session.pairingCode : undefined,
          port,
          ready: true,
        });
        return true;
      }
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      const body = await readBody(request);
      const page = isPageRequest(request, origin);
      if (body.type === "heartbeat" && page) {
        if (!body.editor || typeof body.editor !== "object") {
          sendJson(response, 400, { error: "Invalid editor heartbeat." });
          return true;
        }
        bridge.register(body.editor);
        const editorId = typeof body.editor.editorId === "string" ? body.editor.editorId : "";
        sendJson(response, 200, {
          ok: true,
          listen: editorId ? bridge.shouldListen(editorId) : false,
          clientName: bridge.clientName(),
        });
        return true;
      }
      if (body.type === "poll" && page) {
        if (typeof body.editorId !== "string") {
          sendJson(response, 400, { error: "Invalid editor poll." });
          return true;
        }
        const waitMs = typeof body.waitMs === "number" ? Math.max(0, Math.min(2000, body.waitMs)) : 0;
        const command = await bridge.waitFor(body.editorId, waitMs);
        if (!response.writableEnded) sendJson(response, 200, { command });
        return true;
      }
      if (body.type === "result" && page) {
        if (!body.result || typeof body.result.commandId !== "string") {
          sendJson(response, 400, { error: "Invalid command result." });
          return true;
        }
        sendJson(response, 200, { ok: bridge.complete(body.editorId, body.result) });
        return true;
      }
      if (body.type === "command") {
        if (!authorized(request)) {
          sendJson(response, 401, { error: "PeakCAD needs the session token from this computer." });
          return true;
        }
        if (typeof body.action !== "string") {
          sendJson(response, 400, { error: "Invalid command action." });
          return true;
        }
        const result = await bridge.dispatch({
          editorId: typeof body.editorId === "string" ? body.editorId : undefined,
          editorNumber: typeof body.editorNumber === "number" ? body.editorNumber : undefined,
          action: body.action,
          params: body.params && typeof body.params === "object" ? body.params : {},
          timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : 15000,
          clientName: typeof body.clientName === "string" ? body.clientName : "",
        });
        sendJson(response, 200, result);
        return true;
      }
      sendJson(response, 400, { error: "Invalid PeakCAD model request." });
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : "Invalid request" });
      }
    }
    return true;
  }

  return { handle, session, sessionPath };
}

module.exports = { createModelServer, createBridge, READ_ACTIONS };
