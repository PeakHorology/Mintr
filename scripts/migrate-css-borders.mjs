// One-shot codemod: fold 60-odd pale hardcoded borders onto the control border tokens,
// keeping the semantic tints (danger, warning, green, accent) apart from the neutrals.
import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/web/src/app/globals.css";
const lines = readFileSync(path, "utf8").split("\n");

// The align dot and gizmo grips are physical marks on the 3D view, not chrome.
const SKIP = [/\.align-dot/, /\.transform-handle/, /\.circular-pattern-center/];

const tokenFor = (value) => {
  const rgba = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(value);
  let rgb;
  let alpha = 1;
  if (rgba) {
    rgb = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
    alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
  } else {
    const raw = value.replace("#", "");
    const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
    if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return null;
    rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  }
  const [r, g, b] = rgb;
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  if (min < 170 || alpha < 0.4) return null;
  const chroma = max - min;
  if (r === max && chroma >= 30) return g - b > 20 ? "--control-border-warning" : "--control-border-danger";
  if (g === max && chroma >= 14 && b <= r + 4) return "--control-border-green";
  if (b === max && chroma >= 35) return "--control-border-accent";
  return min >= 205 ? "--control-border" : "--control-border-strong";
};

let inDark = false;
let darkDepth = 0;
let selector = "";
let pending = "";
const tally = new Map();
let count = 0;

const out = lines.map((line) => {
  if (/^\[data-theme="dark"\]/.test(line.trim())) {
    inDark = true;
    darkDepth = 0;
  }
  if (inDark) {
    darkDepth += (line.match(/\{/g) || []).length;
    darkDepth -= (line.match(/\}/g) || []).length;
    if (darkDepth <= 0 && /\}/.test(line)) inDark = false;
    return line;
  }
  if (/\{\s*$/.test(line)) {
    selector = (pending + " " + line.replace(/\{\s*$/, "")).trim();
    pending = "";
  } else if (/^\s*[.#&:\[a-zA-Z*][^:;{}]*,\s*$/.test(line)) {
    pending += " " + line.trim();
  } else if (/\}/.test(line)) {
    pending = "";
  }
  const match = /^(\s*)(border(?:-(?:top|right|bottom|left))?(?:-color)?)(\s*:\s*)([^;]+)(;?\s*)$/.exec(line);
  if (!match) return line;
  if (SKIP.some((re) => re.test(selector))) return line;
  const colour = /(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/.exec(match[4]);
  if (!colour) return line;
  const token = tokenFor(colour[1]);
  if (!token) return line;
  tally.set(token, (tally.get(token) || 0) + 1);
  count += 1;
  const rest = match[4].replace(colour[1], `var(${token})`);
  return `${match[1]}${match[2]}${match[3]}${rest}${match[5]}`;
});

writeFileSync(path, out.join("\n"));
console.log(`rewrote ${count} border declarations`);
for (const [token, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${token}: ${n}`);
