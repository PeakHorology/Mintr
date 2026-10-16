/**
 * Display-only chord for a STEP body. The exact solid is unchanged.
 * A 400 mm part meshes at 1 mm; a 20 mm part stays near 0.05 mm.
 * Angular deflection stays coarse enough that tiny rounds do not explode.
 */
export function stepDisplayTolerance(span: number): { tolerance: number; angularTolerance: number } {
  const safe = Number.isFinite(span) && span > 0 ? span : 10;
  return {
    tolerance: Math.min(1, Math.max(0.05, safe / 400)),
    angularTolerance: 0.35,
  };
}

export function stepBodySpan(bounds: { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number }) {
  return Math.max(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin, bounds.zMax - bounds.zMin);
}
