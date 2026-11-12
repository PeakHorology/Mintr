import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextResponse } from "next/server";
import { readBoundedRequestJson } from "@/lib/requestBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const MAX_REQUEST_BODY_BYTES = Math.ceil((512 * 1024 * 1024 * 4) / 3) + 64 * 1024;

function catalogPath() {
  const starts = [process.cwd()];
  try {
    starts.push(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    // import.meta.url is only a hint. Walking from cwd still finds the catalog.
  }
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i += 1) {
      const candidate = path.join(dir, "electron", "slicerCatalog.cjs");
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

type CatalogCommand = "detect" | "open" | "detect-laser" | "open-laser";

function runCatalog(command: CatalogCommand, payload: Record<string, string>) {
  const catalog = catalogPath();
  if (!catalog) throw new Error("Could not open the slicer");
  // The dev server bundles this route, so it cannot require the catalog itself.
  // A real Node process loads it and is the only thing allowed to start a slicer.
  const script = `
    const catalog = require(process.env.PEAKCAD_SLICER_CATALOG);
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      const fail = (error) => {
        const message = error && error.message ? error.message : "Could not open the slicer";
        process.stdout.write(JSON.stringify({ ok: false, error: message }));
      };
      try {
        const input = raw ? JSON.parse(raw) : {};
        const command = process.env.PEAKCAD_SLICER_COMMAND;
        const run = {
          "open": () => catalog.openInSlicer(input),
          "open-laser": () => catalog.openInLaserApp(input),
          "detect-laser": () => catalog.detectLaserApps(),
        }[command] ?? (() => catalog.detectSlicers());
        // Opening waits for the program to start, so its result is a promise.
        Promise.resolve(run()).then((result) => process.stdout.write(JSON.stringify({ ok: true, result })), fail);
      } catch (error) {
        fail(error);
      }
    });
  `;
  const child = spawnSync(process.execPath, ["-e", script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      PEAKCAD_SLICER_CATALOG: catalog,
      PEAKCAD_SLICER_COMMAND: command,
    },
  });
  if (child.error || child.status !== 0) {
    throw new Error("Could not open the slicer");
  }
  const parsed = JSON.parse(child.stdout || "{}") as { ok?: boolean; result?: unknown; error?: string };
  if (!parsed.ok) throw new Error(parsed.error || "Could not open the slicer");
  return parsed.result;
}

function isLocalSameOriginRequest(request: Request) {
  const requestUrl = new URL(request.url);
  if (!LOCAL_HOSTS.has(requestUrl.hostname)) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.origin !== requestUrl.origin || !LOCAL_HOSTS.has(originUrl.hostname)) return false;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

export async function GET(request: Request) {
  if (!isLocalSameOriginRequest(request)) {
    return NextResponse.json({ error: "Slicer handoff is only available on this computer" }, { status: 403 });
  }
  try {
    const laser = new URL(request.url).searchParams.get("kind") === "laser";
    const slicers = runCatalog(laser ? "detect-laser" : "detect", {});
    return NextResponse.json({ slicers });
  } catch {
    return NextResponse.json({ slicers: [] });
  }
}

export async function POST(request: Request) {
  if (!isLocalSameOriginRequest(request)) {
    return NextResponse.json({ error: "Slicer handoff is only available on this computer" }, { status: 403 });
  }
  const parsed = await readBoundedRequestJson<{
    filename?: unknown;
    base64?: unknown;
    exePath?: unknown;
    folder?: unknown;
    kind?: unknown;
  }>(request, MAX_REQUEST_BODY_BYTES);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.reason === "too-large" ? "This part is too large to send to the slicer" : "Invalid slicer request" },
      { status: parsed.reason === "too-large" ? 413 : 400 },
    );
  }
  try {
    const result = runCatalog(parsed.value.kind === "laser" ? "open-laser" : "open", {
      filename: typeof parsed.value.filename === "string" ? parsed.value.filename : "",
      base64: typeof parsed.value.base64 === "string" ? parsed.value.base64 : "",
      exePath: typeof parsed.value.exePath === "string" ? parsed.value.exePath : "",
      folder: typeof parsed.value.folder === "string" ? parsed.value.folder : "",
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open the slicer";
    const safe = message.startsWith("Choose") || message.startsWith("Mintr") || message.startsWith("That") || message.startsWith("This") || message.startsWith("There")
      ? message
      : "Could not open the slicer";
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
