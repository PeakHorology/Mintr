// Serves the static export the way app.mintr3d.com will: the files in apps/web/.next-export,
// with the headers from its _headers file. Run `npm run export` first, then `npm run preview:web`.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve("apps/web/.next-export");
const port = Number(process.env.PORT ?? 4173);

if (!existsSync(path.join(root, "index.html"))) {
  console.error("No web build found. Run `npm run export` first.");
  process.exit(1);
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** The _headers file: a path pattern line, then indented `Name: value` lines. */
function readHeaderRules() {
  const file = path.join(root, "_headers");
  if (!existsSync(file)) return [];
  const rules = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      const pattern = new RegExp(`^${line.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      rules.push({ pattern, headers: [] });
      continue;
    }
    const at = line.indexOf(":");
    if (at > 0 && rules.length > 0) rules[rules.length - 1].headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
  }
  return rules;
}
const rules = readHeaderRules();

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const candidate = path.join(root, clean);
  if (!candidate.startsWith(root)) return null;
  for (const option of [candidate, path.join(candidate, "index.html"), `${candidate}.html`]) {
    if (existsSync(option) && statSync(option).isFile()) return option;
  }
  return null;
}

createServer((request, response) => {
  const urlPath = (request.url ?? "/").split("?")[0];
  const file = resolveFile(urlPath) ?? path.join(root, "404.html");
  const status = file.endsWith("404.html") && !urlPath.endsWith("404.html") ? 404 : 200;
  for (const rule of rules) {
    if (!rule.pattern.test(urlPath)) continue;
    for (const [name, value] of rule.headers) response.setHeader(name, value);
  }
  response.setHeader("Content-Type", types[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  response.writeHead(status);
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Mintr web preview: http://localhost:${port}/`);
});
