// One-shot codemod: fold the 74 hand-picked near-white backgrounds onto the surface and
// wash tokens. Neutral values become surfaces, tinted ones become washes keyed by hue.
import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/web/src/app/globals.css";
const lines = readFileSync(path, "utf8").split("\n");

// Overlay chrome that has to stay light in both themes: 3D gizmo handles read as
// physical grips, and the card tints get their own themed tokens by hand.
const SKIP = [
  /\.transform-handle/,
  /\.circular-pattern-center/,
  /\.project-preview\.accent-/,
  /\.cad-ready-badge/,
  /\.csg-feature-quality--/,
  /::-webkit-scrollbar/,
];

const parse = (value) => {
  const rgba = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(value);
  if (rgba) {
    return {
      rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])],
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  const raw = value.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return null;
  return { rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)), alpha: 1 };
};

const tokenFor = (value) => {
  const parsed = parse(value);
  if (!parsed) return null;
  const [r, g, b] = parsed.rgb;
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  if (min < 200 || parsed.alpha < 0.8) return null;
  const chroma = max - min;
  if (chroma < 8) {
    // Neutral: a surface, graded by how far it sits from white.
    if (parsed.alpha < 1) return r >= g && g >= b ? "--glass-surface-strong" : "--glass-surface";
    if (min >= 250) return "--control-surface";
    if (min >= 235) return "--control-surface-sunken";
    return "--control-border";
  }
  if (parsed.alpha < 1) {
    // Translucent tints over the viewport are all the same warm/cool glass.
    return r >= b ? "--glass-surface-strong" : "--glass-surface";
  }
  if (r === max && g - b > 6) return "--wash-gold";
  if (r === max) return "--wash-danger";
  if (g === max && g - b > 2 && b <= r) return "--wash-green";
  return min >= 236 ? "--wash" : "--wash-strong";
};

let inDark = false;
let darkDepth = 0;
let selector = "";
let pending = "";
const tally = new Map();
const changes = [];

const out = lines.map((line, index) => {
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
  const match = /^(\s*)(background|background-color)(\s*:\s*)(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})(\s*;?\s*)$/.exec(line);
  if (!match) return line;
  if (SKIP.some((re) => re.test(selector))) return line;
  const token = tokenFor(match[4]);
  if (!token) return line;
  tally.set(token, (tally.get(token) || 0) + 1);
  changes.push(`${String(index + 1).padStart(5)}  ${token.padEnd(24)} was ${match[4].padEnd(26)} ${selector.replace(/\s+/g, " ").slice(0, 52)}`);
  return `${match[1]}${match[2]}${match[3]}var(${token})${match[5]}`;
});

writeFileSync(path, out.join("\n"));
console.log(changes.join("\n"));
console.log(`\nrewrote ${changes.length} background declarations`);
for (const [token, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${token}: ${count}`);
}
