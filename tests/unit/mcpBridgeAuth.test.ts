import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const { createModelServer } = require("../../electron/mcpBridge.cjs") as {
  createModelServer: (options: { userData: string; port: number; origin: string }) => {
    handle: (request: unknown, response: unknown) => Promise<boolean>;
    session: { token: string; pairingCode: string };
  };
};

const ORIGIN = "http://127.0.0.1:3000";

function fakeRequest(token: string, body: unknown) {
  const request = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string> };
  request.method = "POST";
  request.url = "/api/peakcad-mcp";
  request.headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  queueMicrotask(() => {
    request.emit("data", Buffer.from(JSON.stringify(body)));
    request.emit("end");
  });
  return request;
}

function fakeResponse() {
  const captured = { status: 0, headers: {} as Record<string, string>, body: "" };
  return {
    captured,
    headersSent: false,
    writableEnded: false,
    setHeader(name: string, value: string) { captured.headers[name] = value; },
    writeHead(status: number) { captured.status = status; this.headersSent = true; },
    end(body: string) { captured.body = body; this.writableEnded = true; },
  };
}

describe("model bridge pairing-code brute-force protection", () => {
  it("locks out after repeated wrong tokens and rotates the pairing code", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mintr-bridge-"));
    try {
      const server = createModelServer({ userData, port: 3000, origin: ORIGIN });
      const original = server.session.pairingCode;
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const response = fakeResponse();
        await server.handle(fakeRequest(`00000${attempt}`, { type: "command", action: "list_shapes" }), response);
        statuses.push(response.captured.status);
      }
      // Two plain misses; the third starts the lockout and from there we answer 429 with Retry-After.
      expect(statuses.slice(0, 2)).toEqual([401, 401]);
      expect(statuses.slice(2).every((status) => status === 429)).toBe(true);
      expect(statuses.every((status) => status === 401 || status === 429)).toBe(true);
      // Even the real token is refused while locked, so a guess racing the lockout gains nothing.
      const locked = fakeResponse();
      await server.handle(fakeRequest(server.session.token, { type: "command", action: "list_shapes" }), locked);
      expect(locked.captured.status).toBe(429);
      expect(Number(locked.captured.headers["Retry-After"])).toBeGreaterThan(0);
      // Rotation after enough misses means the code shown on the dashboard changed.
      expect(server.session.pairingCode).not.toBe(original);
      expect(JSON.parse(fs.readFileSync(path.join(userData, "mcp-session.json"), "utf8")).pairingCode).toBe(server.session.pairingCode);
    } finally {
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
});
