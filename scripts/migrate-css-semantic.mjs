// One-shot codemod, pass three: the saturated accent, danger, warning and success text
// colours. Same problem as the ink ramp — a fixed dark red is unreadable on a dark card.
import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/web/src/app/globals.css";
const lines = readFileSync(path, "utf8").split("\n");

const hex = (value) => {
  const raw = value.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const sat = ([r, g, b]) => {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
};
const hue = ([r, g, b]) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
};

const tokenFor = (value) => {
  const rgb = hex(value);
  const h = hue(rgb);
  const s = sat(rgb);
  const l = lum(rgb);
  if (s < 0.3 || l > 0.55) return null;
  if (h >= 188 && h <= 214) return "--accent-text";
  if (h >= 330 || h <= 18) return "--danger-text";
  if (h > 18 && h <= 60) return "--warning-text";
  if (h >= 100 && h <= 165) return "--success-text";
  return null;
};

let inDark = false;
let darkDepth = 0;
const tally = new Map();

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
  return line.replace(/^(\s*)color(\s*:\s*)(#[0-9a-fA-F]{6})(\s*;?\s*)$/, (match, indent, sep, value, tail) => {
    const token = tokenFor(value.toLowerCase());
    if (!token) return match;
    tally.set(token, (tally.get(token) || 0) + 1);
    return `${indent}color${sep}var(${token})${tail}`;
  });
});

writeFileSync(path, out.join("\n"));
console.log(`rewrote ${[...tally.values()].reduce((s, n) => s + n, 0)} declarations`);
for (const [token, count] of tally) console.log(`  ${token}: ${count}`);
