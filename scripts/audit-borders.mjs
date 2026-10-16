// One-shot audit: pale hardcoded borders, which ring dark panels with a light halo.
import { readFileSync } from "node:fs";

const css = readFileSync("apps/web/src/app/globals.css", "utf8");
const lines = css.split("\n");
let inDark = false;
let depth = 0;
let selector = "";
let pending = "";
const rows = [];

lines.forEach((line, index) => {
  if (/^\[data-theme="dark"\]/.test(line.trim())) {
    inDark = true;
    depth = 0;
  }
  if (inDark) {
    depth += (line.match(/\{/g) || []).length;
    depth -= (line.match(/\}/g) || []).length;
    if (depth <= 0 && /\}/.test(line)) inDark = false;
    return;
  }
  if (/\{\s*$/.test(line)) {
    selector = (pending + " " + line.replace(/\{\s*$/, "")).trim();
    pending = "";
  } else if (/^\s*[.#&:\[a-zA-Z*][^:;{}]*,\s*$/.test(line)) {
    pending += " " + line.trim();
  } else if (/\}/.test(line)) {
    pending = "";
  }
  const match = /^\s*(border(?:-(?:top|right|bottom|left))?(?:-color)?)\s*:\s*([^;]+);?\s*$/.exec(line);
  if (!match) return;
  const colour = /(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/.exec(match[2]);
  if (!colour) return;
  const value = colour[1];
  const rgba = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(value);
  let rgb;
  let alpha = 1;
  if (rgba) {
    rgb = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
    alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
  } else {
    const raw = value.replace("#", "");
    const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
    if (full.length !== 6) return;
    rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  }
  if (Math.min(...rgb) < 170 || alpha < 0.4) return;
  rows.push({ line: index + 1, prop: match[1], value, selector: selector.replace(/\s+/g, " ").slice(0, 60) });
});

const byValue = new Map();
for (const row of rows) {
  const hit = byValue.get(row.value) || [];
  hit.push(row);
  byValue.set(row.value, hit);
}
console.log(`${rows.length} pale border declarations across ${byValue.size} values\n`);
for (const [value, hits] of [...byValue.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${value}  x${hits.length}   e.g. ${hits[0].selector}`);
}
