// Publishes the web version of Mintr (apps/web/.next-export) to Cloudflare Pages, which
// serves it at app.mintr3d.com. Run `npm run export` first, then `npm run deploy:web`.
// The first time, sign in once with `npx wrangler login` (it opens a browser to Cloudflare).
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve("apps/web/.next-export");
const project = process.env.MINTR_PAGES_PROJECT ?? "mintr-app";
// Cloudflare Pages refuses any single file over 25 MiB.
const FILE_LIMIT = 25 * 1024 * 1024;

if (!existsSync(path.join(root, "index.html")) || !existsSync(path.join(root, "_headers"))) {
  console.error("No web build found (or it has no _headers file). Run `npm run export` first.");
  process.exit(1);
}

const tooBig = [];
let files = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      files += 1;
      if (statSync(full).size > FILE_LIMIT) tooBig.push(path.relative(root, full));
    }
  }
};
walk(root);
if (tooBig.length > 0) {
  console.error(`These files are over Cloudflare's 25 MiB limit:\n  ${tooBig.join("\n  ")}`);
  process.exit(1);
}
console.log(`Publishing ${files} files from ${root} to the Cloudflare Pages project "${project}".`);

// Wrangler 3 on purpose: newer versions turn a Pages deploy into a Workers set-up that rewrites
// package.json, and a Workers site cannot take app.mintr3d.com while the domain stays at Squarespace.
// It runs from inside the build folder so it never sees the repository's own package.json.
const child = spawn("npx", ["--yes", "wrangler@3", "pages", "deploy", ".", "--project-name", project, "--branch", "main", "--commit-dirty=true"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 1));
