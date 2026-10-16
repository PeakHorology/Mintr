// One-shot audit: which literal colors does globals.css still hardcode, and where?
import { readFileSync } from "node:fs";

const css = readFileSync("apps/web/src/app/globals.css", "utf8");
const lines = css.split("\n");

// Track which lines sit inside the dark-theme block so we can separate the two palettes.
const darkLines = new Set();
let depth = 0;
let inDark = false;
lines.forEach((line, index) => {
  if (/^\[data-theme="dark"\]/.test(line.trim())) {
    inDark = true;
    depth = 0;
  }
  if (inDark) {
    darkLines.add(index);
    depth += (line.match(/\{/g) || []).length;
    depth -= (line.match(/\}/g) || []).length;
    if (depth <= 0 && /\}/.test(line)) inDark = false;
  }
});

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

const counts = new Map();
lines.forEach((line, index) => {
  if (darkLines.has(index)) return;
  for (const match of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const value = match[0].toLowerCase();
    if (value.length !== 4 && value.length !== 7) continue;
    const hit = counts.get(value) || { count: 0, lines: [] };
    hit.count += 1;
    if (hit.lines.length < 3) hit.lines.push(index + 1);
    counts.set(value, hit);
  }
});

const rows = [...counts.entries()]
  .map(([value, hit]) => ({ value, ...hit, l: Math.round(lum(hex(value)) * 1000) / 1000 }))
  .sort((a, b) => b.count - a.count);

const total = rows.reduce((sum, row) => sum + row.count, 0);
console.log(`literal hex uses outside the dark block: ${total} across ${rows.length} distinct values`);
console.log(`values used 4+ times: ${rows.filter((r) => r.count >= 4).length}`);
console.log(`those cover ${rows.filter((r) => r.count >= 4).reduce((s, r) => s + r.count, 0)} uses\n`);
for (const row of rows.filter((r) => r.count >= 4)) {
  console.log(`${row.value}  x${String(row.count).padStart(3)}  lum ${String(row.l).padEnd(5)}  first@ ${row.lines.join(",")}`);
}
