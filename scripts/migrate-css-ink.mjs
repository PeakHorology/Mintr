// One-shot codemod: fold the 60-odd ad hoc blue-grey text colours onto the ink ramp.
// Only touches `color:` declarations outside the dark-theme block, and only values in
// the neutral blue-grey family so brand blues, reds and golds stay literal.
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

const tokenFor = (value, selector) => {
  const rgb = hex(value);
  const h = hue(rgb);
  const s = sat(rgb);
  const l = lum(rgb);
  if (h < 202 || h > 218 || s > 0.62 || l > 0.45) return null;
  if (/:disabled|\.disabled|\[disabled\]|:not\(:disabled\)\s*$/.test(selector) && !/:not\(\.disabled\)/.test(selector)) {
    return "--ink-disabled";
  }
  if (l < 0.05) return "--ink-strong";
  if (l < 0.11) return "--ink";
  if (l < 0.155) return "--ink-soft";
  return "--ink-muted";
};

let inDark = false;
let darkDepth = 0;
let selector = "";
let pending = "";
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

  // Track the selector this declaration belongs to; selectors can span several lines.
  if (/\{\s*$/.test(line)) {
    selector = (pending + " " + line.replace(/\{\s*$/, "")).trim();
    pending = "";
  } else if (/^\s*[.#&:\[a-zA-Z*][^:;{}]*,\s*$/.test(line)) {
    pending += " " + line.trim();
  } else if (/\}/.test(line)) {
    pending = "";
  }

  return line.replace(/(^|[\s;])color:\s*(#[0-9a-fA-F]{3,8})\b/g, (match, lead, value) => {
    if (value.length !== 4 && value.length !== 7) return match;
    const token = tokenFor(value.toLowerCase(), selector);
    if (!token) return match;
    tally.set(token, (tally.get(token) || 0) + 1);
    return `${lead}color: var(${token})`;
  });
});

writeFileSync(path, out.join("\n"));
const total = [...tally.values()].reduce((sum, n) => sum + n, 0);
console.log(`rewrote ${total} color declarations`);
for (const [token, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${token}: ${count}`);
}
