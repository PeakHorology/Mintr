// One-shot audit: find rules that mix a theme-inverting token with a hardcoded colour.
// Those are the pairs that look right in one theme and break in the other.
import { readFileSync } from "node:fs";

const css = readFileSync("apps/web/src/app/globals.css", "utf8");

// Tokens whose lightness flips between the two themes.
const INVERTING = [
  "--peak-charcoal", "--peak-forest", "--peak-sage", "--peak-teal", "--peak-text",
  "--peak-text-muted", "--peak-cream", "--peak-cream-light", "--peak-cream-panel",
  "--peak-stone", "--peak-tan", "--peak-border", "--foreground", "--nav-text",
  "--background", "--topbar", "--subbar", "--panel", "--tile", "--tile-hover",
];
const invertingRe = new RegExp(`var\\((${INVERTING.join("|")})\\)`);

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
const literalLum = (value) => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "white") return 1;
  if (trimmed === "black") return 0;
  const hexMatch = /#[0-9a-f]{3,8}\b/.exec(trimmed);
  if (hexMatch && (hexMatch[0].length === 4 || hexMatch[0].length === 7)) return lum(hex(hexMatch[0]));
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(trimmed);
  if (rgb) return lum([Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]);
  return null;
};

// Walk top-level-ish blocks, tracking whether we sit under a dark-theme selector.
const blocks = [];
let selector = "";
let body = "";
let depth = 0;
let line = 1;
let selectorLine = 1;
for (let i = 0; i < css.length; i += 1) {
  const ch = css[i];
  if (ch === "\n") line += 1;
  if (ch === "{") {
    depth += 1;
    if (depth === 1) {
      selector = body.trim();
      selectorLine = line;
      body = "";
      continue;
    }
  } else if (ch === "}") {
    depth -= 1;
    if (depth === 0) {
      blocks.push({ selector, body, line: selectorLine });
      body = "";
      continue;
    }
  }
  body += ch;
}

const decl = (text, prop) => {
  const match = new RegExp(`(?:^|;|\\n)\\s*${prop}\\s*:\\s*([^;}]+)`, "i").exec(text);
  return match ? match[1].trim() : null;
};

const findings = [];
for (const block of blocks) {
  if (/^\[data-theme/.test(block.selector)) continue;
  if (/^@/.test(block.selector)) continue;
  const bg = decl(block.body, "background") || decl(block.body, "background-color");
  const fg = decl(block.body, "color");
  if (!bg || !fg) continue;
  const bgToken = invertingRe.test(bg);
  const fgToken = invertingRe.test(fg);
  const bgLum = literalLum(bg);
  const fgLum = literalLum(fg);
  // Inverting background under a fixed foreground (or the mirror image) cannot hold up
  // in both themes.
  if (bgToken && !fgToken && fgLum !== null) {
    findings.push({ ...block, kind: "fixed text on inverting bg", bg, fg });
  } else if (fgToken && !bgToken && bgLum !== null && bgLum > 0.35) {
    findings.push({ ...block, kind: "inverting text on fixed light bg", bg, fg });
  }
}

console.log(`${findings.length} rules mix a fixed colour with an inverting token\n`);
for (const hit of findings) {
  console.log(`${String(hit.line).padStart(5)}  ${hit.selector.replace(/\s+/g, " ").slice(0, 74)}`);
  console.log(`       ${hit.kind}: color ${hit.fg.slice(0, 30)} / bg ${hit.bg.slice(0, 46)}`);
}
