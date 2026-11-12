/** Millimeters in each unit a typed size may end with. */
const ENTRY_UNITS_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  inch: 25.4,
  inches: 25.4,
  '"': 25.4,
  ft: 304.8,
  "'": 304.8,
};

export type DimensionEntry = {
  /** In millimeters when `unitGiven`; otherwise in whatever unit the box shows. */
  value: number;
  /** True when the text ended with a unit ("50mm", "2 in", 1.5"), so the box's own unit does not apply. */
  unitGiven: boolean;
};

/**
 * Typed size text, with whether it named its unit. "20" is 20 in the box's unit. "50mm", "2in",
 * "1.5\"", "3 cm", "1ft" and "(10+2)mm" are millimeters. "150%" is 150% of the current value.
 */
export function parseDimensionEntryWithUnit(text: string, current: number): DimensionEntry | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const unitMatch = /(mm|cm|m|inches|inch|in|ft|"|')$/i.exec(trimmed);
  if (unitMatch) {
    const body = trimmed.slice(0, -unitMatch[0].length).trim();
    const value = parseArithmetic(body);
    if (value === null) return null;
    return { value: value * ENTRY_UNITS_MM[unitMatch[0].toLowerCase()], unitGiven: true };
  }
  if (trimmed.endsWith("%")) {
    const percent = parseArithmetic(trimmed.slice(0, -1));
    if (percent === null || !Number.isFinite(current)) return null;
    return { value: current * (percent / 100), unitGiven: false };
  }
  const value = parseArithmetic(trimmed);
  return value === null ? null : { value, unitGiven: false };
}

/**
 * Typed size text. "20" is 20. "150%" is 150% of the current value. "60+12.5" is arithmetic.
 * A unit at the end gives millimeters: "50mm" is 50, "2in" is 50.8.
 */
export function parseDimensionEntry(text: string, current: number): number | null {
  return parseDimensionEntryWithUnit(text, current)?.value ?? null;
}

function parseArithmetic(source: string): number | null {
  const expression = source.replace(/\s+/g, "");
  if (!expression) return null;
  let index = 0;
  const value = parseSum();
  if (value === null || index !== expression.length || !Number.isFinite(value)) return null;
  return value;

  function parseSum(): number | null {
    let left = parseProduct();
    if (left === null) return null;
    while (expression[index] === "+" || expression[index] === "-") {
      const op = expression[index];
      index += 1;
      const right = parseProduct();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseProduct(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    while (expression[index] === "*" || expression[index] === "/") {
      const op = expression[index];
      index += 1;
      const right = parseFactor();
      if (right === null || (op === "/" && right === 0)) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  function parseFactor(): number | null {
    if (expression[index] === "+") {
      index += 1;
      return parseFactor();
    }
    if (expression[index] === "-") {
      index += 1;
      const value = parseFactor();
      return value === null ? null : -value;
    }
    if (expression[index] === "(") {
      index += 1;
      const value = parseSum();
      if (value === null || expression[index] !== ")") return null;
      index += 1;
      return value;
    }
    const start = index;
    if (expression[index] === ".") index += 1;
    while (index < expression.length && expression[index] >= "0" && expression[index] <= "9") index += 1;
    if (expression[index] === "." && start !== index) {
      index += 1;
      while (index < expression.length && expression[index] >= "0" && expression[index] <= "9") index += 1;
    }
    if (start === index) return null;
    const value = Number(expression.slice(start, index));
    return Number.isFinite(value) ? value : null;
  }
}
