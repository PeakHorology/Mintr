export type LineEntry = {
  length: number;
  /** Degrees counter-clockwise from the right, on the sketch screen. Null follows the pointer. */
  angleDeg: number | null;
};

/** Parse `50`, `50<30`, and sums such as `20+30<45`. */
export function parseLineEntry(raw: string): LineEntry | null {
  const text = raw.trim().replace(/\s+/g, "");
  if (!text) return null;
  const parts = text.split("<");
  if (parts.length > 2) return null;
  const length = evaluateSum(parts[0]);
  if (length === null || !(length > 0)) return null;
  if (parts.length === 1 || parts[1] === "") return { length, angleDeg: null };
  const angleDeg = evaluateSum(parts[1]);
  if (angleDeg === null) return null;
  return { length, angleDeg };
}

function evaluateSum(text: string): number | null {
  if (!text) return null;
  const terms = text.match(/[+-]?\d*\.?\d+/g);
  if (!terms || terms.join("") !== text) return null;
  let sum = 0;
  for (const term of terms) {
    const value = Number(term);
    if (!Number.isFinite(value)) return null;
    sum += value;
  }
  return sum;
}

/** Screen angle in degrees, counter-clockwise from +x. Up the sketch page is positive. */
export function screenAngleDeg(from: { x: number; z: number }, to: { x: number; z: number }): number | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) < 1e-9) return null;
  return (Math.atan2(-dz, dx) * 180) / Math.PI;
}

/** Place a point at a typed length. Angle is counter-clockwise from the right. */
export function pointAtLengthAngle(
  from: { x: number; z: number },
  length: number,
  angleDeg: number,
): { x: number; z: number } {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: from.x + Math.cos(radians) * length,
    z: from.z - Math.sin(radians) * length,
  };
}

/** Snap the pointer heading to `stepDeg` increments, keeping the pointer distance. */
export function snapHeading(
  from: { x: number; z: number },
  to: { x: number; z: number },
  stepDeg = 15,
): { x: number; z: number } {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const angle = screenAngleDeg(from, to);
  if (angle === null || !(length > 0) || !(stepDeg > 0)) return { x: to.x, z: to.z };
  const snapped = Math.round(angle / stepDeg) * stepDeg;
  return pointAtLengthAngle(from, length, snapped);
}
