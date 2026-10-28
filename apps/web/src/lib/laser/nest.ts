/**
 * Packing parts onto the laser bed, by the box round each one's footprint. Tallest
 * first, in rows from the back left corner; a part is turned a quarter when that
 * fits it better. Boxes waste a little round curved parts, but the parts never
 * touch and a row is easy to see.
 */

export type NestItem = { id: string; width: number; depth: number };

export type NestPlacement = {
  id: string;
  /** Where the part's box starts: its left and back edges, in bed millimetres from the bed's centre. */
  minX: number;
  minZ: number;
  /** Turned a quarter from how it lies now. */
  turned: boolean;
  /** Which sheet it lands on, from 0. Parts past the first sheet go on the next, laid beside the bed. */
  sheet: number;
};

export type NestResult = {
  placements: NestPlacement[];
  sheets: number;
  /** Parts bigger than the bed whichever way they lie. */
  tooBig: string[];
};

type Shelf = { z: number; depth: number; x: number };

export function nestParts(items: readonly NestItem[], bed: { width: number; depth: number }, gap = 3): NestResult {
  const tooBig: string[] = [];
  const fits = (w: number, d: number) => w <= bed.width + 1e-6 && d <= bed.depth + 1e-6;
  // Each part lies its longer side along the bed's longer side, unless only the other way fits.
  const wide = bed.width >= bed.depth;
  const oriented = items.map((item) => {
    const long = Math.max(item.width, item.depth);
    const short = Math.min(item.width, item.depth);
    const preferred = wide ? { w: long, d: short } : { w: short, d: long };
    const other = { w: preferred.d, d: preferred.w };
    const choice = fits(preferred.w, preferred.d) ? preferred : fits(other.w, other.d) ? other : null;
    if (!choice) tooBig.push(item.id);
    const pick = choice ?? { w: item.width, d: item.depth };
    return { item, w: pick.w, d: pick.d, turned: Math.abs(pick.w - item.width) > 1e-6 || Math.abs(pick.d - item.depth) > 1e-6 };
  });
  // Deepest first, so each row is as shallow as it can be.
  oriented.sort((a, b) => b.d - a.d || b.w - a.w);
  const sheets: Shelf[][] = [[]];
  const placements: NestPlacement[] = [];
  for (const part of oriented) {
    let placed = false;
    for (let sheet = 0; sheet < sheets.length && !placed; sheet += 1) {
      const shelves = sheets[sheet];
      for (const shelf of shelves) {
        if (part.d <= shelf.depth + 1e-6 && shelf.x + part.w <= bed.width + 1e-6) {
          placements.push({ id: part.item.id, minX: shelf.x, minZ: shelf.z, turned: part.turned, sheet });
          shelf.x += part.w + gap;
          placed = true;
          break;
        }
      }
      if (placed) break;
      const last = shelves[shelves.length - 1];
      const z = last ? last.z + last.depth + gap : 0;
      if (z + part.d <= bed.depth + 1e-6 || shelves.length === 0) {
        shelves.push({ z, depth: part.d, x: part.w + gap });
        placements.push({ id: part.item.id, minX: 0, minZ: z, turned: part.turned, sheet });
        placed = true;
      }
    }
    if (!placed) {
      sheets.push([{ z: 0, depth: part.d, x: part.w + gap }]);
      placements.push({ id: part.item.id, minX: 0, minZ: 0, turned: part.turned, sheet: sheets.length - 1 });
    }
  }
  // From the bed's corner to bed coordinates, each further sheet laid to the right of the last.
  const sheetStep = bed.width + Math.max(20, gap * 4);
  return {
    placements: placements.map((placement) => ({
      ...placement,
      minX: placement.minX - bed.width / 2 + placement.sheet * sheetStep,
      minZ: placement.minZ - bed.depth / 2,
    })),
    sheets: sheets.length,
    tooBig,
  };
}
