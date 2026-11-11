import type { ShapeValue, WorkplaneShape } from "@/types/sketchforge";

/**
 * Mintr Pro's named values: `wall = 2`, `width = length / 2 + wall`. A small expression
 * language of numbers, names, + - * / ^, brackets, a few functions and mm/cm/in units.
 * Angles in sin/cos/tan are degrees, as everywhere else in Mintr.
 */

export type ValueResult = { ok: true; value: number } | { ok: false; error: string };

type Token =
  | { kind: "number"; value: number }
  | { kind: "name"; name: string }
  | { kind: "op"; op: string };

const UNITS: Record<string, number> = { mm: 1, cm: 10, in: 25.4 };
const CONSTANTS: Record<string, number> = { pi: Math.PI };
const DEG = Math.PI / 180;

const FUNCTIONS: Record<string, { min: number; max: number; run: (args: number[]) => number }> = {
  min: { min: 1, max: Infinity, run: (args) => Math.min(...args) },
  max: { min: 1, max: Infinity, run: (args) => Math.max(...args) },
  round: { min: 1, max: 1, run: ([x]) => Math.round(x) },
  floor: { min: 1, max: 1, run: ([x]) => Math.floor(x) },
  ceil: { min: 1, max: 1, run: ([x]) => Math.ceil(x) },
  abs: { min: 1, max: 1, run: ([x]) => Math.abs(x) },
  sqrt: { min: 1, max: 1, run: ([x]) => Math.sqrt(x) },
  sin: { min: 1, max: 1, run: ([x]) => Math.sin(x * DEG) },
  cos: { min: 1, max: 1, run: ([x]) => Math.cos(x * DEG) },
  tan: { min: 1, max: 1, run: ([x]) => Math.tan(x * DEG) },
  asin: { min: 1, max: 1, run: ([x]) => Math.asin(x) / DEG },
  acos: { min: 1, max: 1, run: ([x]) => Math.acos(x) / DEG },
  atan: { min: 1, max: 1, run: ([x]) => Math.atan(x) / DEG },
};

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MAX_VALUE_NAME_LENGTH = 32;

/** Words the language already uses, so they cannot name a value. */
function isReservedName(name: string) {
  const lower = name.toLowerCase();
  return lower in UNITS || lower in CONSTANTS || lower in FUNCTIONS;
}

/** Why a name cannot be used, or null when it can. */
export function valueNameProblem(name: string): string | null {
  if (!name) return "Give the value a name.";
  if (name.length > MAX_VALUE_NAME_LENGTH) return `Keep the name under ${MAX_VALUE_NAME_LENGTH} letters.`;
  if (!NAME_PATTERN.test(name)) return "Use letters, numbers and _ only, starting with a letter.";
  if (isReservedName(name)) return `“${name}” is already part of Mintr's sums. Pick another name.`;
  return null;
}

function tokenize(source: string): Token[] | string {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(source.slice(index));
      if (!match) return `“${char}” is not a number.`;
      tokens.push({ kind: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index))!;
      tokens.push({ kind: "name", name: match[0] });
      index += match[0].length;
      continue;
    }
    if ("+-*/^(),".includes(char)) {
      tokens.push({ kind: "op", op: char });
      index += 1;
      continue;
    }
    return `“${char}” cannot be used in a value.`;
  }
  return tokens;
}

/** A unit straight after a number ("12mm", "2 in") scales it, and is not a name. */
function isUnitAfterNumber(tokens: Token[], index: number) {
  const token = tokens[index];
  return token.kind === "name" && token.name.toLowerCase() in UNITS && tokens[index - 1]?.kind === "number";
}

/** The value names a sum uses, in order, without repeats. */
export function expressionNames(text: string): string[] {
  const tokens = tokenize(text);
  if (typeof tokens === "string") return [];
  const names: string[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== "name" || isUnitAfterNumber(tokens, index)) return;
    const lower = token.name.toLowerCase();
    if (lower in CONSTANTS || (lower in FUNCTIONS && tokens[index + 1]?.kind === "op" && (tokens[index + 1] as { op: string }).op === "(")) return;
    if (!names.includes(token.name)) names.push(token.name);
  });
  return names;
}

/** True when typed text is a sum with names or functions in it, not a plain number. */
export function isValueExpression(text: string): boolean {
  const tokens = tokenize(text);
  if (typeof tokens === "string") return /[A-Za-z_]/.test(text.replace(/\s*(mm|cm|in)\s*$/i, ""));
  return tokens.some((token, index) => token.kind === "name" && !isUnitAfterNumber(tokens, index));
}

export function evaluateValueExpression(text: string, scope: ReadonlyMap<string, number>): ValueResult {
  const tokens = tokenize(text);
  if (typeof tokens === "string") return { ok: false, error: tokens };
  if (tokens.length === 0) return { ok: false, error: "Type a number or a sum." };
  let index = 0;
  const peekOp = (op: string) => {
    const token = tokens[index];
    return token?.kind === "op" && token.op === op;
  };
  const fail = (error: string): never => {
    throw new ValueError(error);
  };

  const parseSum = (): number => {
    let left = parseProduct();
    while (peekOp("+") || peekOp("-")) {
      const op = (tokens[index] as { op: string }).op;
      index += 1;
      const right = parseProduct();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  const parseProduct = (): number => {
    let left = parsePower();
    while (peekOp("*") || peekOp("/")) {
      const op = (tokens[index] as { op: string }).op;
      index += 1;
      const right = parsePower();
      if (op === "/" && right === 0) fail("That divides by zero.");
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };
  const parsePower = (): number => {
    const base = parseUnary();
    if (!peekOp("^")) return base;
    index += 1;
    // Right to left, so 2^3^2 is 2^9.
    return base ** parsePower();
  };
  const parseUnary = (): number => {
    if (peekOp("+")) {
      index += 1;
      return parseUnary();
    }
    if (peekOp("-")) {
      index += 1;
      return -parseUnary();
    }
    return parsePrimary();
  };
  const parsePrimary = (): number => {
    const token = tokens[index];
    if (!token) return fail("The sum stops too early.");
    if (token.kind === "number") {
      index += 1;
      const unit = tokens[index];
      if (unit?.kind === "name" && unit.name.toLowerCase() in UNITS) {
        index += 1;
        return token.value * UNITS[unit.name.toLowerCase()];
      }
      return token.value;
    }
    if (token.kind === "op") {
      if (token.op !== "(") return fail(`“${token.op}” is in the wrong place.`);
      index += 1;
      const inner = parseSum();
      if (!peekOp(")")) fail("A bracket is not closed.");
      index += 1;
      return inner;
    }
    index += 1;
    const lower = token.name.toLowerCase();
    if (peekOp("(") && lower in FUNCTIONS) {
      index += 1;
      const args: number[] = [];
      if (!peekOp(")")) {
        args.push(parseSum());
        while (peekOp(",")) {
          index += 1;
          args.push(parseSum());
        }
      }
      if (!peekOp(")")) fail(`${lower}( is not closed.`);
      index += 1;
      const fn = FUNCTIONS[lower];
      if (args.length < fn.min || args.length > fn.max) fail(`${lower} takes ${fn.min === fn.max ? fn.min : `${fn.min} or more`} number${fn.min === 1 && fn.max === 1 ? "" : "s"}.`);
      return fn.run(args);
    }
    if (scope.has(token.name)) return scope.get(token.name)!;
    if (lower in CONSTANTS) return CONSTANTS[lower];
    return fail(`There is no value named “${token.name}”.`);
  };

  try {
    const value = parseSum();
    if (index < tokens.length) {
      const extra = tokens[index];
      return { ok: false, error: `“${extra.kind === "op" ? extra.op : extra.kind === "name" ? extra.name : extra.value}” is in the wrong place.` };
    }
    if (!Number.isFinite(value)) return { ok: false, error: "That sum has no answer." };
    return { ok: true, value };
  } catch (error) {
    if (error instanceof ValueError) return { ok: false, error: error.message };
    throw error;
  }
}

class ValueError extends Error {}

export type ResolvedValues = {
  /** Every name visible here: the outer values, then these (which win). */
  scope: Map<string, number>;
  /** This list's own values, worked out. */
  own: Map<string, number>;
  /** Why a value has no number, by name. */
  errors: Map<string, string>;
};

/**
 * Work out a list of values. Each may use the outer values and the others in the list, in any
 * order; a value that leads back to itself is reported rather than looping.
 */
export function resolveValues(values: readonly ShapeValue[] | undefined, outer: ReadonlyMap<string, number> = new Map()): ResolvedValues {
  const scope = new Map(outer);
  const own = new Map<string, number>();
  const errors = new Map<string, string>();
  const byName = new Map<string, ShapeValue>();
  // The first of two values with one name still works; the second is reported.
  const late = new Map<string, string>();
  for (const value of values ?? []) {
    const problem = valueNameProblem(value.name);
    if (problem) {
      late.set(value.name, problem);
      continue;
    }
    if (byName.has(value.name)) {
      late.set(value.name, `There are two values named “${value.name}”.`);
      continue;
    }
    byName.set(value.name, value);
  }
  // Own names hide outer ones while working out.
  for (const name of byName.keys()) scope.delete(name);

  const state = new Map<string, "working" | "done">();
  const visit = (name: string, chain: string[]): void => {
    if (state.get(name) === "done") return;
    if (state.get(name) === "working") {
      const loop = [...chain.slice(chain.indexOf(name)), name].join(" → ");
      for (const member of chain.slice(chain.indexOf(name))) errors.set(member, `These values use each other in a loop: ${loop}.`);
      return;
    }
    state.set(name, "working");
    const value = byName.get(name)!;
    for (const used of expressionNames(value.expression)) {
      if (byName.has(used)) visit(used, [...chain, name]);
    }
    state.set(name, "done");
    if (errors.has(name)) return;
    const result = evaluateValueExpression(value.expression, scope);
    if (!result.ok) {
      errors.set(name, result.error);
      return;
    }
    own.set(name, result.value);
    scope.set(name, result.value);
  };
  for (const name of byName.keys()) visit(name, []);
  for (const [name, problem] of late) if (!errors.has(name)) errors.set(name, problem);
  return { scope, own, errors };
}

/** The values a shape's own settings can use: its own list over the groups around it. */
export function valueScopeFor(shape: WorkplaneShape, outer: ReadonlyMap<string, number> = new Map()) {
  return resolveValues(shape.values, outer).scope;
}

/**
 * A part with a value renamed in every sum that uses it: its other values, its driven settings,
 * its sketch sizes, and the parts inside it that do not have a value of that name themselves.
 */
export function renameValueInShape(shape: WorkplaneShape, from: string, to: string): WorkplaneShape {
  const rename = (text: string) => renameInExpression(text, from, to);
  const drivenBy = shape.drivenBy
    ? Object.fromEntries(Object.entries(shape.drivenBy).map(([label, text]) => [label, rename(text)]))
    : undefined;
  const sketchDoc = shape.sketchDoc?.dimensions.some((dimension) => dimension.expression)
    ? {
        ...shape.sketchDoc,
        dimensions: shape.sketchDoc.dimensions.map((dimension) => (dimension.expression ? { ...dimension, expression: rename(dimension.expression) } : dimension)),
      }
    : shape.sketchDoc;
  return {
    ...shape,
    values: shape.values?.map((value) => ({ ...value, name: value.name === from ? to : value.name, expression: rename(value.expression) })),
    drivenBy,
    sketchDoc,
    groupedShapes: shape.groupedShapes?.map((child) => (child.values?.some((value) => value.name === from) ? child : renameValueInShape(child, from, to))),
  };
}

/** Rename a value everywhere a sum uses it. */
export function renameInExpression(text: string, from: string, to: string): string {
  const tokens = tokenize(text);
  if (typeof tokens === "string" || !expressionNames(text).includes(from)) return text;
  return text.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (word, offset: number) => {
    if (word !== from) return word;
    // Leave a unit after a number alone ("2in" with a value named in).
    const before = text.slice(0, offset).trimEnd();
    if (/[0-9.]$/.test(before) && word.toLowerCase() in UNITS) return word;
    return to;
  });
}

/** A value's slider: its lowest and highest, and a step that lands on round numbers. Null without a usable range. */
export function valueSliderRange(value: Pick<ShapeValue, "min" | "max">): { min: number; max: number; step: number } | null {
  const { min, max } = value;
  if (typeof min !== "number" || typeof max !== "number" || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  // About a hundred stops, rounded to 1, 2 or 5 of a power of ten.
  const rough = (max - min) / 100;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? rough;
  return { min, max, step };
}

/** Why a value's answer is outside the range it was given, or null. */
export function valueRangeProblem(value: Pick<ShapeValue, "min" | "max">, result: number | undefined): string | null {
  if (result === undefined) return null;
  if (typeof value.min === "number" && result < value.min - 1e-9) return `This is below its lowest, ${value.min}.`;
  if (typeof value.max === "number" && result > value.max + 1e-9) return `This is above its highest, ${value.max}.`;
  return null;
}
