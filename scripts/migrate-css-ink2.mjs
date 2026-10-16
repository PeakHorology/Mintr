// One-shot codemod, pass two: the deep navies the first pass skipped for being too
// saturated, plus SVG `fill` on overlay text, which is text as far as themes care.
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
  const l = lum(rgb);
  if (h < 193 || h > 222) return null;
  if (l < 0.075) return "--ink-strong";
  return null;
};

let inDark = false;
let darkDepth = 0;
let selector = "";
let pending = "";
let colorCount = 0;
let fillCount = 0;

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

  let next = line.replace(/(^|[\s;])color:\s*(#[0-9a-fA-F]{6})\b/g, (match, lead, value) => {
    const token = tokenFor(value.toLowerCase());
    if (!token) return match;
    colorCount += 1;
    return `${lead}color: var(${token})`;
  });

  // Overlay labels are painted as SVG text, so their fill is a text colour.
  if (/\btext\b|label|dimension/i.test(selector)) {
    next = next.replace(/(^|[\s;])fill:\s*(#[0-9a-fA-F]{6})\b/g, (match, lead, value) => {
      const token = tokenFor(value.toLowerCase());
      if (!token) return match;
      fillCount += 1;
      return `${lead}fill: var(${token})`;
    });
  }
  return next;
});

writeFileSync(path, out.join("\n"));
console.log(`rewrote ${colorCount} color and ${fillCount} fill declarations to --ink-strong`);
