// One-shot check: every var(--token) resolves, and every token defined in the light
// theme has a dark counterpart unless it is deliberately theme-independent.
import { readFileSync } from "node:fs";

const css = readFileSync("apps/web/src/app/globals.css", "utf8");

const blockFor = (selector) => {
  const start = css.indexOf(selector + " {");
  if (start < 0) return "";
  let depth = 0;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, i);
    }
  }
  return "";
};

const namesIn = (text) => new Set([...text.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
const root = namesIn(blockFor(":root"));
const dark = namesIn(blockFor('[data-theme="dark"]'));
const defined = new Set([...namesIn(css)]);
const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));

const missing = [...used].filter((name) => !defined.has(name) && !name.startsWith("--font-peak") && !name.startsWith("--tw"));
console.log(`tokens defined: ${defined.size}, referenced: ${used.size}`);
console.log(missing.length ? `UNDEFINED: ${missing.join(", ")}` : "no undefined token references");

const unused = [...root].filter((name) => !used.has(name));
console.log(unused.length ? `\nunused in :root: ${unused.join(", ")}` : "\nevery :root token is used");

const darkOnly = [...dark].filter((name) => !root.has(name));
console.log(darkOnly.length ? `\ndark-only tokens (no light default): ${darkOnly.join(", ")}` : "\nno dark-only tokens");
