import type { ManifoldToplevel, Vec2 } from "manifold-3d";

/**
 * Packing parts on the laser bed by their real outlines, not the boxes round them.
 *
 * Each outline grows by half the gap, so two grown outlines that do not overlap
 * leave at least the gap between the parts. The grown outlines are drawn onto a
 * fine grid, counting every square they touch, and each part goes in the first
 * place it fits from the back left corner, whichever of four quarter turns packs
 * it tightest. Because the grid keeps holes, a small part can sit inside the hole
 * of a big one, cut from what would have been waste.
 */

export type ShapeNestItem = {
  id: string;
  /** The part's outline from above, in bed millimetres: x to the right, z toward the front. Holes as inner loops. */
  loops: readonly (readonly Vec2[])[];
  /** False keeps the part the way it lies, such as a part tipped on its side. */
  canTurn?: boolean;
};

export type ShapeNestPlacement = {
  id: string;
  /** Quarter turns, the same way as adding 90° to a part's turn: a point [x, z] goes to [z, -x]. */
  quarterTurns: 0 | 1 | 2 | 3;
  /** Move after turning about the bed's centre. */
  dx: number;
  dz: number;
  sheet: number;
};

export type ShapeNestResult = {
  placements: ShapeNestPlacement[];
  sheets: number;
  /** Parts that do not fit on an empty bed whichever way they lie. Each gets a sheet of its own. */
  tooBig: string[];
};

export type ShapeNestOptions = {
  /** Grid square size in millimetres. Smaller packs closer but takes longer; by default it suits the bed. */
  cell?: number;
  /**
   * Outlines already on the bed that stay put, such as parts left out of the nest, in bed
   * millimetres. Their squares on the first sheet, grown by half the gap, are taken first,
   * so nested parts keep the gap from them too. Each is a part's loops, holes as inner loops.
   */
  obstacles?: readonly (readonly (readonly Vec2[])[])[];
};

/** A point turned q quarter turns the way a part's turn goes. */
export function turnPoint([x, z]: readonly [number, number], quarterTurns: number): Vec2 {
  switch (((quarterTurns % 4) + 4) % 4) {
    case 1:
      return [z, -x];
    case 2:
      return [-x, -z];
    case 3:
      return [-z, x];
    default:
      return [x, z];
  }
}

/** Where a point of a part lands once it is placed. */
export function placePoint(point: readonly [number, number], placement: Pick<ShapeNestPlacement, "quarterTurns" | "dx" | "dz">): Vec2 {
  const [x, z] = turnPoint(point, placement.quarterTurns);
  return [x + placement.dx, z + placement.dz];
}

/**
 * Sorts outlines into groups that overlap, such as engraving sitting on a plate, so
 * each group can be nested as one. Returns each group's members by index and the
 * group's outline.
 */
export function overlappingGroups(runtime: ManifoldToplevel, outlines: readonly (readonly (readonly Vec2[])[])[]): { members: number[]; loops: Vec2[][] }[] {
  const boxes = outlines.map((loops) => {
    const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const loop of loops) {
      for (const [x, z] of loop) {
        box.minX = Math.min(box.minX, x);
        box.maxX = Math.max(box.maxX, x);
        box.minZ = Math.min(box.minZ, z);
        box.maxZ = Math.max(box.maxZ, z);
      }
    }
    return box;
  });
  const copy = (loops: readonly (readonly Vec2[])[]) => loops.map((loop) => loop.map(([x, z]) => [x, z] as Vec2));
  const parent = outlines.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index])));
  for (let i = 0; i < outlines.length; i += 1) {
    for (let j = i + 1; j < outlines.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ) continue;
      if (root(i) === root(j)) continue;
      const left = new runtime.CrossSection(copy(outlines[i]), "EvenOdd");
      const right = new runtime.CrossSection(copy(outlines[j]), "EvenOdd");
      const both = left.intersect(right);
      if (both.area() > 1e-4) parent[root(i)] = root(j);
      [left, right, both].forEach((section) => section.delete());
    }
  }
  const groups = new Map<number, number[]>();
  outlines.forEach((_, index) => {
    const key = root(index);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  return [...groups.values()].map((members) => {
    if (members.length === 1) return { members, loops: copy(outlines[members[0]]) };
    // Each outline is filled on its own, then all are joined, so one part's hole under another part stays filled.
    let union: InstanceType<ManifoldToplevel["CrossSection"]> | null = null;
    for (const index of members) {
      const section = new runtime.CrossSection(copy(outlines[index]), "EvenOdd");
      if (!union) {
        union = section;
      } else {
        const joined: InstanceType<ManifoldToplevel["CrossSection"]> = union.add(section);
        union.delete();
        section.delete();
        union = joined;
      }
    }
    const loops = union!.toPolygons().map((loop) => loop.map(([x, z]) => [x, z] as Vec2));
    union!.delete();
    return { members, loops };
  });
}

/** Grid squares a shape covers, as runs per row. */
type Raster = {
  /** Its corner on the grid's lines, in millimetres, before it is placed. */
  originX: number;
  originZ: number;
  width: number;
  height: number;
  /** For each row, pairs of first and last square covered. */
  rows: Int32Array[];
  area: number;
};

type Box = { minX: number; minZ: number; maxX: number; maxZ: number };

function boundsOf(loops: readonly (readonly Vec2[])[]): Box {
  const box = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const loop of loops) {
    for (const [x, z] of loop) {
      box.minX = Math.min(box.minX, x);
      box.minZ = Math.min(box.minZ, z);
      box.maxX = Math.max(box.maxX, x);
      box.maxZ = Math.max(box.maxZ, z);
    }
  }
  return box;
}

/**
 * Every grid square the loops touch or hold, within the frame (by default the loops'
 * own box); whatever lies outside the frame is left off. A square is touched when an
 * edge passes through it; a square no edge passes through is wholly inside or wholly
 * outside, which its middle tells.
 */
function rasterize(loops: readonly (readonly Vec2[])[], cell: number, frame: Box = boundsOf(loops)): Raster | null {
  const { minX, minZ, maxX, maxZ } = frame;
  if (!Number.isFinite(minX) || !Number.isFinite(minZ) || maxX - minX <= 0 || maxZ - minZ <= 0) return null;
  const width = Math.max(1, Math.ceil((maxX - minX) / cell - 1e-9));
  const height = Math.max(1, Math.ceil((maxZ - minZ) / cell - 1e-9));
  const edges: [number, number, number, number][] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      edges.push([(a[0] - minX) / cell, (a[1] - minZ) / cell, (b[0] - minX) / cell, (b[1] - minZ) / cell]);
    }
  }
  const rows: Int32Array[] = [];
  const line = new Uint8Array(width);
  let area = 0;
  const mark = (from: number, to: number) => {
    const first = Math.max(0, Math.floor(from));
    const last = Math.min(width - 1, Math.floor(to));
    for (let i = first; i <= last; i += 1) line[i] = 1;
  };
  for (let row = 0; row < height; row += 1) {
    line.fill(0);
    const top = row;
    const bottom = row + 1;
    const middle = row + 0.5;
    const crossings: number[] = [];
    for (const [x0, z0, x1, z1] of edges) {
      // Squares the edge passes through in this row.
      const low = Math.min(z0, z1);
      const high = Math.max(z0, z1);
      if (high >= top && low <= bottom) {
        if (high - low < 1e-12) {
          mark(Math.min(x0, x1), Math.max(x0, x1));
        } else {
          const at = (z: number) => x0 + ((x1 - x0) * (z - z0)) / (z1 - z0);
          const xa = at(Math.max(low, top));
          const xb = at(Math.min(high, bottom));
          mark(Math.min(xa, xb), Math.max(xa, xb));
        }
      }
      // Where the edge crosses the row's middle, for the squares wholly inside.
      if ((z0 <= middle) !== (z1 <= middle)) crossings.push(x0 + ((x1 - x0) * (middle - z0)) / (z1 - z0));
    }
    crossings.sort((left, right) => left - right);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const first = Math.ceil(crossings[i] - 0.5);
      const last = Math.floor(crossings[i + 1] - 0.5);
      if (last >= first) mark(first, last);
    }
    const runs: number[] = [];
    for (let i = 0; i < width; i += 1) {
      if (!line[i]) continue;
      const start = i;
      while (i + 1 < width && line[i + 1]) i += 1;
      runs.push(start, i);
      area += i - start + 1;
    }
    rows.push(Int32Array.from(runs));
  }
  return { originX: minX, originZ: minZ, width, height, rows, area };
}

/** One sheet's grid: which squares are taken, and for each square the last taken one at or before it in its row. */
class Sheet {
  readonly taken: Uint8Array;
  readonly lastTaken: Int32Array;
  /** A sheet holding a part too big for the bed takes nothing else. */
  full = false;

  constructor(readonly width: number, readonly height: number) {
    this.taken = new Uint8Array(width * height);
    this.lastTaken = new Int32Array(width * height).fill(-1);
  }

  /** The first place, row by row from the back left, where the raster fits; null when it fits nowhere. */
  firstFit(raster: Raster): { x: number; y: number } | null {
    const { width, height } = this;
    if (this.full || raster.width > width || raster.height > height) return null;
    const order = Array.from({ length: raster.height }, (_, index) => index);
    for (let y = 0; y + raster.height <= height; y += 1) {
      let x = 0;
      while (x + raster.width <= width) {
        let jump = -1;
        for (let k = 0; k < order.length; k += 1) {
          const r = order[k];
          const runs = raster.rows[r];
          const base = (y + r) * width;
          for (let i = 0; i < runs.length; i += 2) {
            const last = this.lastTaken[base + x + runs[i + 1]];
            if (last >= base + x + runs[i]) {
              jump = last - base - runs[i] + 1;
              break;
            }
          }
          if (jump >= 0) {
            // The row that blocked is likely to block again, so try it first next time.
            if (k > 0) {
              order.splice(k, 1);
              order.unshift(r);
            }
            break;
          }
        }
        if (jump < 0) return { x, y };
        x = Math.max(x + 1, jump);
      }
    }
    return null;
  }

  place(raster: Raster, x: number, y: number) {
    const { width } = this;
    for (let r = 0; r < raster.height; r += 1) {
      const runs = raster.rows[r];
      if (runs.length === 0) continue;
      const base = (y + r) * width;
      for (let i = 0; i < runs.length; i += 2) this.taken.fill(1, base + x + runs[i], base + x + runs[i + 1] + 1);
      let last = x + runs[0] > 0 ? this.lastTaken[base + x + runs[0] - 1] : -1;
      for (let i = x + runs[0]; i < width; i += 1) {
        if (this.taken[base + i]) last = base + i;
        this.lastTaken[base + i] = last;
      }
    }
  }
}

function defaultCell(bed: { width: number; depth: number }, gap: number) {
  // About a million squares a sheet, no finer than a quarter millimetre and no coarser than the gap allows.
  const bySize = Math.sqrt((bed.width * bed.depth) / 1_000_000);
  return Math.min(Math.max(0.25, bySize), Math.max(0.25, gap > 0 ? gap / 2 : 1), 2);
}

export function nestOutlines(
  runtime: ManifoldToplevel,
  items: readonly ShapeNestItem[],
  bed: { width: number; depth: number },
  gap: number,
  options: ShapeNestOptions = {},
): ShapeNestResult {
  const half = Math.max(0, gap) / 2;
  const cell = options.cell ?? defaultCell(bed, gap);
  // The grown outlines may reach half the gap past the bed's edge; the parts themselves stay on it.
  const gridWidth = Math.floor((bed.width + 2 * half) / cell + 1e-9);
  const gridHeight = Math.floor((bed.depth + 2 * half) / cell + 1e-9);
  const gridX = -bed.width / 2 - half;
  const gridZ = -bed.depth / 2 - half;
  const sheetStep = bed.width + Math.max(20, gap * 4);
  // A part this close past the bed's size still counts as fitting.
  const slack = 1e-6;

  /** An outline grown by at least half the gap everywhere. */
  const grow = (loops: Vec2[][]): Vec2[][] => {
    if (half <= 0) return loops;
    const section = new runtime.CrossSection(loops, "EvenOdd");
    // Round corners are drawn in straight steps that fall just inside the true curve; grow a touch more to cover them.
    const offset = section.offset(half / Math.cos(Math.PI / 32) + 1e-3, "Round", 2, 32);
    const grown = offset.toPolygons().map((loop) => loop.map(([x, z]) => [x, z] as Vec2));
    section.delete();
    offset.delete();
    return grown;
  };

  type Turn = { quarterTurns: 0 | 1 | 2 | 3; raster: Raster; fitsBed: boolean };
  type Prepared = { id: string; turns: Turn[]; area: number };
  const prepared: Prepared[] = [];
  const tooBig: string[] = [];
  const placements: ShapeNestPlacement[] = [];
  for (const item of items) {
    const loops = item.loops.filter((loop) => loop.length >= 3).map((loop) => loop.map(([x, z]) => [x, z] as Vec2));
    if (loops.length === 0) continue;
    const grown = grow(loops);
    const quarterTurns: (0 | 1 | 2 | 3)[] = item.canTurn === false ? [0] : [0, 1, 2, 3];
    const turns: Turn[] = [];
    for (const q of quarterTurns) {
      const raw = boundsOf(loops.map((loop) => loop.map((point) => turnPoint(point, q))));
      // The grown outline is drawn only within half the gap of the part's own box: the true grown
      // outline goes no further, and the extra grown for round corners must not make a part that
      // fits the bed look a square too big.
      const frame = { minX: raw.minX - half, minZ: raw.minZ - half, maxX: raw.maxX + half, maxZ: raw.maxZ + half };
      const raster = rasterize(grown.map((loop) => loop.map((point) => turnPoint(point, q))), cell, frame);
      const fitsBed = raw.maxX - raw.minX <= bed.width + slack && raw.maxZ - raw.minZ <= bed.depth + slack;
      if (raster) turns.push({ quarterTurns: q, raster, fitsBed });
    }
    if (turns.length === 0) continue;
    prepared.push({ id: item.id, turns, area: turns[0].raster.area });
  }
  // Biggest first, so small parts fill the spaces left round them.
  prepared.sort((left, right) => right.area - left.area);

  const sheets: Sheet[] = [];
  const newSheet = () => {
    const sheet = new Sheet(gridWidth, gridHeight);
    sheets.push(sheet);
    return sheet;
  };
  // Parts left where they are take their squares on the bed first.
  const obstacles = (options.obstacles ?? [])
    .map((loops) => loops.filter((loop) => loop.length >= 3).map((loop) => loop.map(([x, z]) => [x, z] as Vec2)))
    .filter((loops) => loops.length > 0);
  if (obstacles.length > 0 && gridWidth > 0 && gridHeight > 0) {
    const bedSheet = newSheet();
    const frame = { minX: gridX, minZ: gridZ, maxX: gridX + gridWidth * cell, maxZ: gridZ + gridHeight * cell };
    for (const loops of obstacles) {
      const raster = rasterize(grow(loops), cell, frame);
      if (raster && raster.area > 0) bedSheet.place(raster, 0, 0);
    }
  }
  const placementFor = (turn: Turn, id: string, x: number, y: number, sheet: number): ShapeNestPlacement => ({
    id,
    quarterTurns: turn.quarterTurns,
    dx: gridX + x * cell - turn.raster.originX + sheet * sheetStep,
    dz: gridZ + y * cell - turn.raster.originZ,
    sheet,
  });
  /** A sheet of its own, the part at the bed's back left corner. */
  const alone = (turn: Turn, id: string) => {
    const sheet = newSheet();
    sheet.full = true;
    placements.push(placementFor(turn, id, 0, 0, sheets.length - 1));
  };

  for (const part of prepared) {
    const fitting = part.turns.filter((turn) => turn.fitsBed);
    if (fitting.length === 0) {
      tooBig.push(part.id);
      alone(part.turns[0], part.id);
      continue;
    }
    const fitsGrid = fitting.filter((turn) => turn.raster.width <= gridWidth && turn.raster.height <= gridHeight);
    if (fitsGrid.length === 0) {
      // Fits the bed, but only just: the grid's last part-square falls past the bed's edge.
      alone(fitting[0], part.id);
      continue;
    }
    let placed = false;
    for (let index = 0; index <= sheets.length && !placed; index += 1) {
      const sheet = index < sheets.length ? sheets[index] : newSheet();
      // Of the turns that fit, the one that reaches least far toward the front, then least far right.
      let best: { turn: Turn; x: number; y: number } | null = null;
      for (const turn of fitsGrid) {
        const fit = sheet.firstFit(turn.raster);
        if (!fit) continue;
        if (
          !best
          || fit.y + turn.raster.height < best.y + best.turn.raster.height
          || (fit.y + turn.raster.height === best.y + best.turn.raster.height && fit.x + turn.raster.width < best.x + best.turn.raster.width)
        ) {
          best = { turn, x: fit.x, y: fit.y };
        }
      }
      if (best) {
        sheet.place(best.turn.raster, best.x, best.y);
        placements.push(placementFor(best.turn, part.id, best.x, best.y, index));
        placed = true;
      }
    }
  }
  return { placements, sheets: Math.max(1, sheets.length), tooBig };
}
