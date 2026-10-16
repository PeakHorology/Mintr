// One-shot audit: every hardcoded `color:` value, bucketed by lightness, so the ad hoc
// blue-greys can be folded onto a three-step ink ramp.
import { readFileSync } from "node:fs";

const css = readFileSync("apps/web/src/app/globals.css", "utf8");
const lines = css.split("\n");

let inDark = false;
let depth = 0;
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
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
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
  return Math.round(((h * 60) + 360) % 360);
};

const counts = new Map();
lines.forEach((raw, index) => {
  const line = raw.trim();
  if (/^\[data-theme="dark"\]/.test(line)) {
    inDark = true;
    depth = 0;
  }
  if (inDark) {
    depth += (raw.match(/\{/g) || []).length;
    depth -= (raw.match(/\}/g) || []).length;
    if (depth <= 0 && /\}/.test(raw)) inDark = false;
    return;
  }
  const match = /^color\s*:\s*(#[0-9a-fA-F]{3,8})\s*;?\s*$/.exec(line);
  if (!match) return;
  const value = match[1].toLowerCase();
  if (value.length !== 4 && value.length !== 7) return;
  const hit = counts.get(value) || { count: 0, lines: [] };
  hit.count += 1;
  if (hit.lines.length < 4) hit.lines.push(index + 1);
  counts.set(value, hit);
});

const rows = [...counts.entries()].map(([value, hit]) => {
  const rgb = hex(value);
  return { value, ...hit, l: lum(rgb), s: sat(rgb), h: hue(rgb) };
});
rows.sort((a, b) => a.l - b.l);

const total = rows.reduce((sum, row) => sum + row.count, 0);
console.log(`${total} hardcoded color: declarations across ${rows.length} values\n`);
// Blue-grey neutrals are the ones worth collapsing; hues near red/green/gold are semantic.
const neutralish = rows.filter((row) => row.h >= 180 && row.h <= 240 && row.s <= 0.55);
console.log(`blue-grey family (hue 180-240, sat <= .55): ${neutralish.length} values / ${neutralish.reduce((s, r) => s + r.count, 0)} uses`);
for (const row of rows) {
  const tag = neutralish.includes(row) ? "INK " : "    ";
  console.log(`${tag}${row.value}  x${String(row.count).padStart(3)}  lum ${row.l.toFixed(3)}  hue ${String(row.h).padStart(3)}  sat ${row.s.toFixed(2)}  @${row.lines.join(",")}`);
}
