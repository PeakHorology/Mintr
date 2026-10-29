// Stages the occt-wasm runtime (Emscripten glue + 22 MB WASM) into the web app's
// public/ folder so the STEP exporter can load it lazily at runtime. The kernel is
// imported via a webpackIgnore dynamic import from /occt/, deliberately bypassing
// the Next.js bundler — Emscripten glue does not survive bundling. The copied files
// are gitignored; this script runs before dev/build to recreate them from the package.
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "occt-wasm", "dist");
const dest = join(root, "apps", "web", "public", "occt");
const manifoldSrc = join(root, "node_modules", "manifold-3d");
const publicDir = join(root, "apps", "web", "public");

if (!existsSync(src)) {
  console.error(`[copy-occt-wasm] occt-wasm not installed at ${src}. Run \`npm install\` first.`);
  process.exit(1);
}

await mkdir(dest, { recursive: true });

const entries = await readdir(src);
const wanted = entries.filter((name) => name.endsWith(".js") || name.endsWith(".wasm"));
await Promise.all(wanted.map((name) => cp(join(src, name), join(dest, name))));

console.log(`[copy-occt-wasm] staged ${wanted.length} files into apps/web/public/occt/`);

if (!existsSync(join(manifoldSrc, "manifold.wasm")) || !existsSync(join(manifoldSrc, "manifold.js"))) {
  console.error(`[copy-occt-wasm] manifold-3d not installed at ${manifoldSrc}. Run \`npm install\` first.`);
  process.exit(1);
}

await mkdir(publicDir, { recursive: true });
await cp(join(manifoldSrc, "manifold.js"), join(publicDir, "manifold.js"));
await cp(join(manifoldSrc, "manifold.wasm"), join(publicDir, "manifold.wasm"));
console.log("[copy-occt-wasm] staged manifold.js and manifold.wasm into apps/web/public/");


// The Mintr engine built to WebAssembly (npm run build:kernel:wasm). Optional: without
// it the browser keeps using the occt-wasm code paths.
const mintrSrc = join(root, "native", "mintr-kernel", "dist-wasm");
const mintrDest = join(publicDir, "mintr-kernel");
if (existsSync(join(mintrSrc, "MintrKernel.mjs")) && existsSync(join(mintrSrc, "MintrKernel.wasm"))) {
  await mkdir(mintrDest, { recursive: true });
  await cp(join(mintrSrc, "MintrKernel.mjs"), join(mintrDest, "MintrKernel.mjs"));
  await cp(join(mintrSrc, "MintrKernel.wasm"), join(mintrDest, "MintrKernel.wasm"));
  console.log("[copy-occt-wasm] staged the Mintr engine into apps/web/public/mintr-kernel/");
} else {
  console.log("[copy-occt-wasm] no Mintr engine build in native/mintr-kernel/dist-wasm; the browser uses occt-wasm only");
}
