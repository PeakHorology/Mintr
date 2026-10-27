/** Typed size text. "20" is 20. "150%" is 150% of the current value. "60+12.5" is arithmetic. */
export function parseDimensionEntry(text: string, current: number): number | null {
  const trimmed = text.trim().replace(/mm$/i, "").trim();
  if (!trimmed) return null;
  if (trimmed.endsWith("%")) {
    const percent = parseArithmetic(trimmed.slice(0, -1));
    if (percent === null || !Number.isFinite(current)) return null;
    return current * (percent / 100);
  }
  return parseArithmetic(trimmed);
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
