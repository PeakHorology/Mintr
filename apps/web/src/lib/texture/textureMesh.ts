/**
 * Mesh plumbing for surface textures: welding, splitting long edges, and the
 * checks that keep the result closed. Positions are flat xyz arrays in mm.
 */
export type IndexedMesh = {
  positions: Float32Array;
  indices: Uint32Array;
};

/** The mesh after splitting, with the input triangle each new triangle came from. */
export type RefinedMesh = IndexedMesh & {
  parents: Uint32Array;
};

/** Detail passes stop once they would split fewer than this share of the triangles. */
const DETAIL_TAIL_SHARE = 0.004;

/** Edge key for a vertex pair, exact for meshes of up to 2^26 vertices. */
const EDGE_STRIDE = 2 ** 26;
const edgeKey = (a: number, b: number) => (a < b ? a * EDGE_STRIDE + b : b * EDGE_STRIDE + a);

/** Joins corners that sit at the same point (within 0.1 µm) and drops triangles that collapse. */
export function weldTriangles(positions: ArrayLike<number>, indices?: ArrayLike<number>): IndexedMesh {
  const cornerCount = indices ? indices.length : positions.length / 3;
  const map = new Map<string, number>();
  const welded: number[] = [];
  const remap = new Int32Array(positions.length / 3).fill(-1);
  const out: number[] = [];
  const idOf = (source: number) => {
    if (remap[source] >= 0) return remap[source];
    const x = positions[source * 3];
    const y = positions[source * 3 + 1];
    const z = positions[source * 3 + 2];
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = welded.length / 3;
      map.set(key, id);
      welded.push(x, y, z);
    }
    remap[source] = id;
    return id;
  };
  for (let corner = 0; corner + 2 < cornerCount; corner += 3) {
    const a = idOf(indices ? indices[corner] : corner);
    const b = idOf(indices ? indices[corner + 1] : corner + 1);
    const c = idOf(indices ? indices[corner + 2] : corner + 2);
    if (a === b || b === c || c === a) continue;
    out.push(a, b, c);
  }
  return { positions: new Float32Array(welded), indices: new Uint32Array(out) };
}

/**
 * Splits every edge longer than `maxEdge` at its middle, again and again, until
 * none is left or the triangle cap is reached. Both triangles beside an edge
 * share its middle point, so a closed mesh stays closed.
 */
export type SubdivideOptions = {
  /**
   * Also split a shorter edge (down to `minEdge`) when this says so, e.g. where the texture height
   * jumps. Asked once per triangle beside the edge, with that triangle's facing direction; the edge
   * splits if either triangle says so, so both sides agree.
   */
  split?: (a: number, b: number, nx: number, ny: number, nz: number, positions: ArrayLike<number>) => boolean;
  minEdge?: number;
  /**
   * 1 for each input triangle that needs no detail of its own (it stays smooth). It is only split
   * where a neighbour's split reaches it, so the mesh stays closed.
   */
  frozen?: Uint8Array;
  /** Detail passes stop once they would split fewer than this share of the triangles. */
  tailShare?: number;
  /** Told about every new middle point, so callers can keep per-point data in step. */
  onMiddle?: (id: number, a: number, b: number) => void;
  /** Told as each pass finishes, for a progress bar. */
  onPass?: (pass: number) => void;
};

/** Spreads an edge's two ends over every bit, so nearby edges land far apart in a table. */
function edgeHash(a: number, b: number) {
  let h = Math.imul(a, 0x9e3779b1) ^ b;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Every edge of a mesh, each with a number, for the millions of edges of a fine texture.
 * A Map or Set of that many numbers is slow to fill and to read. Here each triangle looks
 * its edges up once, and after that reads their numbers straight from an array.
 */
class EdgeSlots {
  private keys: Float64Array;
  /** One number per edge, -1 to start. */
  values: Int32Array;
  private mask: number;

  /** Room for this many edges without growing; a closed mesh has 1.5 per triangle, any mesh at most 3. */
  constructor(triangles: number) {
    let capacity = 16;
    while (capacity < triangles * 4) capacity *= 2;
    this.keys = new Float64Array(capacity).fill(-1);
    this.values = new Int32Array(capacity).fill(-1);
    this.mask = capacity - 1;
  }

  /** The edge's slot, added if new. */
  slotOf(a: number, b: number) {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * EDGE_STRIDE + hi;
    let h = edgeHash(lo, hi) & this.mask;
    while (this.keys[h] !== -1 && this.keys[h] !== key) h = (h + 1) & this.mask;
    this.keys[h] = key;
    return h;
  }
}

/** A growing list of xyz points. */
class PointList {
  data: Float64Array;
  count: number;

  constructor(initial: ArrayLike<number>, room: number) {
    this.data = new Float64Array(Math.max(initial.length, room * 3, 48));
    this.data.set(initial);
    this.count = initial.length / 3;
  }

  push(x: number, y: number, z: number) {
    if ((this.count + 1) * 3 > this.data.length) {
      const bigger = new Float64Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.count * 3] = x;
    this.data[this.count * 3 + 1] = y;
    this.data[this.count * 3 + 2] = z;
    this.count += 1;
    return this.count - 1;
  }
}

/** An edge's number: not splitting this pass, splitting with no middle point yet, or (0 and up) its middle point. */
const KEEP = -1;
const SPLIT_PENDING = -2;

export function subdivideToEdgeLength(
  mesh: IndexedMesh,
  maxEdge: number,
  maxTriangles: number,
  options: SubdivideOptions = {},
): RefinedMesh & { capped: boolean } {
  const points = new PointList(mesh.positions, (mesh.positions.length / 3) * 2);
  let indices = Uint32Array.from(mesh.indices);
  let parents = new Uint32Array(indices.length / 3);
  for (let i = 0; i < parents.length; i += 1) parents[i] = i;
  // 1 for each triangle made by the last pass. One the pass left whole already had every edge
  // asked about and none split, and asking again gives the same answer, so it is skipped.
  let fresh: Uint8Array | null = null;
  const limitSq = maxEdge * maxEdge;
  const minSq = (options.minEdge ?? maxEdge) ** 2;
  const split = options.split;
  const lengthSq = (a: number, b: number) => {
    const p = points.data;
    const dx = p[a * 3] - p[b * 3];
    const dy = p[a * 3 + 1] - p[b * 3 + 1];
    const dz = p[a * 3 + 2] - p[b * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  let capped = false;

  const facing = [0, 0, 0];
  const faceNormalOf = (t: number) => {
    const p = points.data;
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    facing[0] = nx / length;
    facing[1] = ny / length;
    facing[2] = nz / length;
  };
  let longEdges = 0;
  let normalDone = false;
  /** Whether triangle t wants edge a, b split. */
  const marked = (t: number, a: number, b: number) => {
    const length = lengthSq(a, b);
    if (length > limitSq) {
      longEdges += 1;
      return true;
    }
    if (!split || length <= minSq) return false;
    if (!normalDone) {
      faceNormalOf(t);
      normalDone = true;
    }
    return split(a, b, facing[0], facing[1], facing[2], points.data);
  };
  const longestOf = (t: number) => {
    let best = 0;
    let bestLength = -1;
    for (let k = 0; k < 3; k += 1) {
      const a = indices[t + k];
      const b = indices[t + ((k + 1) % 3)];
      const length = lengthSq(a, b);
      if (length > bestLength || (length === bestLength && edgeKey(a, b) < edgeKey(indices[t + best], indices[t + ((best + 1) % 3)]))) {
        best = k;
        bestLength = length;
      }
    }
    return best;
  };

  for (let pass = 0; pass < 32; pass += 1) {
    // Which edges split this pass. A triangle that splits any edge always splits its longest
    // one first (longest-edge bisection), so the new triangles keep a good shape even when the
    // part starts as long thin slivers, like the sides and caps of a cylinder.
    const table = new EdgeSlots(indices.length / 3);
    const edges = table.values;
    const slots = new Int32Array(indices.length);
    for (let i = 0; i < indices.length; i += 3) {
      slots[i] = table.slotOf(indices[i], indices[i + 1]);
      slots[i + 1] = table.slotOf(indices[i + 1], indices[i + 2]);
      slots[i + 2] = table.slotOf(indices[i + 2], indices[i]);
    }
    let splitting = 0;
    longEdges = 0;
    const frozen = options.frozen;
    for (let t = 0; t < indices.length; t += 3) {
      if (frozen && frozen[parents[t / 3]]) continue;
      if (fresh && !fresh[t / 3]) continue;
      normalDone = false;
      for (let k = 0; k < 3; k += 1) {
        const slot = slots[t + k];
        if (edges[slot] !== KEEP) continue;
        if (!marked(t, indices[t + k], indices[t + ((k + 1) % 3)])) continue;
        edges[slot] = SPLIT_PENDING;
        splitting += 1;
      }
    }
    if (splitting === 0) break;
    // Once every edge is short enough, detail passes that would add almost nothing are not worth a
    // scan of the whole mesh; a few last edges on a sharp ridge would otherwise take dozens of passes.
    // A share of 0 never stops early: every last edge is split.
    const tail = options.tailShare ?? DETAIL_TAIL_SHARE;
    if (tail > 0 && longEdges === 0 && splitting < Math.max(64, (indices.length / 3) * tail)) break;
    for (let changed = true; changed;) {
      changed = false;
      for (let t = 0; t < indices.length; t += 3) {
        if (edges[slots[t]] === KEEP && edges[slots[t + 1]] === KEEP && edges[slots[t + 2]] === KEEP) continue;
        const slot = slots[t + longestOf(t)];
        if (edges[slot] === KEEP) {
          edges[slot] = SPLIT_PENDING;
          changed = true;
        }
      }
    }

    // Count first, so a pass that would pass the cap is not started.
    let grown = 0;
    for (let i = 0; i < indices.length; i += 1) if (edges[slots[i]] !== KEEP) grown += 1;
    if (indices.length / 3 + grown > maxTriangles) {
      capped = true;
      break;
    }

    const middleOf = (slot: number, a: number, b: number) => {
      const known = edges[slot];
      if (known !== SPLIT_PENDING) return known;
      const p = points.data;
      const id = points.push((p[a * 3] + p[b * 3]) / 2, (p[a * 3 + 1] + p[b * 3 + 1]) / 2, (p[a * 3 + 2] + p[b * 3 + 2]) / 2);
      edges[slot] = id;
      options.onMiddle?.(id, a, b);
      return id;
    };

    const next = new Uint32Array(indices.length + grown * 3);
    const nextParents = new Uint32Array(next.length / 3);
    const nextFresh = new Uint8Array(next.length / 3);
    let written = 0;
    const push = (parent: number, a: number, b: number, c: number, made = 1) => {
      next[written * 3] = a;
      next[written * 3 + 1] = b;
      next[written * 3 + 2] = c;
      nextParents[written] = parent;
      nextFresh[written] = made;
      written += 1;
    };
    for (let t = 0; t < indices.length; t += 3) {
      const parent = parents[t / 3];
      const r = longestOf(t);
      const a = indices[t + r];
      const b = indices[t + ((r + 1) % 3)];
      const c = indices[t + ((r + 2) % 3)];
      const m = middleOf(slots[t + r], a, b);
      if (m < 0) {
        push(parent, a, b, c, 0);
        continue;
      }
      // Halve across the longest edge, then split each half again if its other edge splits too.
      const q = middleOf(slots[t + ((r + 2) % 3)], c, a);
      if (q >= 0) {
        push(parent, a, m, q);
        push(parent, m, c, q);
      } else {
        push(parent, a, m, c);
      }
      const p = middleOf(slots[t + ((r + 1) % 3)], b, c);
      if (p >= 0) {
        push(parent, m, b, p);
        push(parent, m, p, c);
      } else {
        push(parent, m, b, c);
      }
    }
    indices = next.subarray(0, written * 3);
    parents = nextParents.subarray(0, written);
    fresh = nextFresh.subarray(0, written);
    options.onPass?.(pass);
  }

  return {
    positions: Float32Array.from(points.data.subarray(0, points.count * 3)),
    indices: Uint32Array.from(indices),
    parents: Uint32Array.from(parents),
    capped,
  };
}

const FLAT_DOT = Math.cos((1 * Math.PI) / 180);

/**
 * On flat areas, swaps the shared edge of two triangles when the other diagonal
 * gives fatter triangles (Delaunay flips). Turns the long wedges of a cylinder
 * cap into an even mesh. Curved and sharp spots are left alone, and the mesh
 * stays closed.
 */
export function flipFlatSlivers(mesh: RefinedMesh, maxRounds = 6): RefinedMesh {
  return flipEdges(mesh, FLAT_DOT, (quad) => quad.angleC + quad.angleD > Math.PI + 1e-9, maxRounds);
}

/** Two triangles sharing edge from→to: (from, to, c) and (to, from, d). */
export type FlipQuad = { from: number; to: number; c: number; d: number; angleC: number; angleD: number; nx: number; ny: number; nz: number };

/** Turns edges toward the texture's ridges and valleys, so a slanted ridge is one straight edge, not a sawtooth. */
export function flipTowardPattern(
  mesh: RefinedMesh,
  heightAt: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number,
  maxRounds = 4,
  /** 1 for each triangle that stays smooth; an edge between two of them is left alone. */
  smooth?: Uint8Array,
): RefinedMesh {
  const p = mesh.positions;
  // A point is read once per facing it is seen with, as the build reads it.
  const vertexCount = p.length / 3;
  const seenHeight = new Float32Array(vertexCount);
  const seenNormal = new Float32Array(vertexCount * 3);
  const seen = new Uint8Array(vertexCount);
  const heightOf = (v: number, nx: number, ny: number, nz: number) => {
    if (seen[v] && seenNormal[v * 3] * nx + seenNormal[v * 3 + 1] * ny + seenNormal[v * 3 + 2] * nz > SAME_FACING_DOT) return seenHeight[v];
    const h = heightAt(p[v * 3], p[v * 3 + 1], p[v * 3 + 2], nx, ny, nz);
    seen[v] = 1;
    seenHeight[v] = h;
    seenNormal[v * 3] = nx;
    seenNormal[v * 3 + 1] = ny;
    seenNormal[v * 3 + 2] = nz;
    return h;
  };
  const misfit = (a: number, b: number, nx: number, ny: number, nz: number) => {
    const mid = heightAt((p[a * 3] + p[b * 3]) / 2, (p[a * 3 + 1] + p[b * 3 + 1]) / 2, (p[a * 3 + 2] + p[b * 3 + 2]) / 2, nx, ny, nz);
    const ends = (heightOf(a, nx, ny, nz) + heightOf(b, nx, ny, nz)) / 2;
    return Math.abs(mid - ends);
  };
  return flipEdges(mesh, CURVED_DOT, (quad) => {
    // Keep the triangles fat enough: no corner under about 12°.
    if (quad.angleC + quad.angleD < Math.PI * 0.55) return false;
    const now = misfit(quad.from, quad.to, quad.nx, quad.ny, quad.nz);
    if (now < 1e-4) return false;
    return misfit(quad.c, quad.d, quad.nx, quad.ny, quad.nz) < now * 0.5;
  }, maxRounds, true, smooth);
}

const CURVED_DOT = Math.cos((8 * Math.PI) / 180);
/** Facings closer than about 2.5° read the pattern the same. */
const SAME_FACING_DOT = 0.999;

/**
 * Each edge and the two triangles on it, in flat arrays. An edge with more than two
 * triangles is counted, so it is never flipped.
 */
class EdgeOwners {
  keys: Float64Array;
  first: Int32Array;
  second: Int32Array;
  count: Int32Array;
  private mask: number;
  private size = 0;
  /** Goes up when the table grows, which moves every slot. */
  version = 0;

  constructor(expected: number) {
    let capacity = 16;
    while (capacity < expected * 1.5) capacity *= 2;
    this.keys = new Float64Array(capacity).fill(-1);
    this.first = new Int32Array(capacity).fill(-1);
    this.second = new Int32Array(capacity).fill(-1);
    this.count = new Int32Array(capacity);
    this.mask = capacity - 1;
  }

  /** The edge's slot, made if it is new. */
  slot(key: number): number {
    const hi = Math.floor(key / EDGE_STRIDE);
    const lo = key - hi * EDGE_STRIDE;
    let h = edgeHash(hi, lo) & this.mask;
    while (this.keys[h] !== -1 && this.keys[h] !== key) h = (h + 1) & this.mask;
    if (this.keys[h] === -1) {
      if ((this.size + 1) * 3 > this.keys.length * 2) {
        this.grow();
        return this.slot(key);
      }
      this.keys[h] = key;
      this.size += 1;
    }
    return h;
  }

  add(key: number, t: number) {
    const at = this.slot(key);
    if (this.first[at] < 0) this.first[at] = t;
    else if (this.second[at] < 0) this.second[at] = t;
    this.count[at] += 1;
  }

  drop(key: number, t: number) {
    const at = this.slot(key);
    if (this.first[at] === t) {
      this.first[at] = this.second[at];
      this.second[at] = -1;
    } else if (this.second[at] === t) {
      this.second[at] = -1;
    }
    this.count[at] -= 1;
  }

  /** How many triangles use the edge. */
  uses(key: number) {
    return this.count[this.slot(key)];
  }

  private grow() {
    const { keys, first, second, count } = this;
    this.keys = new Float64Array(keys.length * 2).fill(-1);
    this.first = new Int32Array(keys.length * 2).fill(-1);
    this.second = new Int32Array(keys.length * 2).fill(-1);
    this.count = new Int32Array(keys.length * 2);
    this.mask = this.keys.length - 1;
    this.size = 0;
    this.version += 1;
    for (let i = 0; i < keys.length; i += 1) {
      if (keys[i] === -1) continue;
      const at = this.slot(keys[i]);
      this.first[at] = first[i];
      this.second[at] = second[i];
      this.count[at] = count[i];
    }
  }
}

function flipEdges(
  mesh: RefinedMesh,
  flatDot: number,
  wantsFlip: (quad: FlipQuad) => boolean,
  maxRounds: number,
  checkShape = false,
  smooth?: Uint8Array,
): RefinedMesh {
  const p = mesh.positions;
  const tris = Uint32Array.from(mesh.indices);
  const faceCount = tris.length / 3;
  const owners = new EdgeOwners(faceCount * 1.5);
  for (let t = 0; t < faceCount; t += 1) {
    for (let k = 0; k < 3; k += 1) owners.add(edgeKey(tris[t * 3 + k], tris[t * 3 + ((k + 1) % 3)]), t);
  }
  const facings = new Float32Array(faceCount * 3);
  const normalInto = (t: number) => {
    const a = tris[t * 3] * 3;
    const b = tris[t * 3 + 1] * 3;
    const c = tris[t * 3 + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    facings[t * 3] = nx / length;
    facings[t * 3 + 1] = ny / length;
    facings[t * 3 + 2] = nz / length;
  };
  for (let t = 0; t < faceCount; t += 1) normalInto(t);
  /** Angle at corner c of the triangle a, b, c. */
  const angleAt = (c: number, a: number, b: number) => {
    const ax = p[a * 3] - p[c * 3];
    const ay = p[a * 3 + 1] - p[c * 3 + 1];
    const az = p[a * 3 + 2] - p[c * 3 + 2];
    const bx = p[b * 3] - p[c * 3];
    const by = p[b * 3 + 1] - p[c * 3 + 1];
    const bz = p[b * 3 + 2] - p[c * 3 + 2];
    const dot = ax * bx + ay * by + az * bz;
    const cross = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    return Math.atan2(cross, dot);
  };
  const facesSameWay = (a: number, b: number, c: number, quad: FlipQuad) => {
    const ux = p[b * 3] - p[a * 3];
    const uy = p[b * 3 + 1] - p[a * 3 + 1];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vy = p[c * 3 + 1] - p[a * 3 + 1];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    return length > 1e-12 && (nx * quad.nx + ny * quad.ny + nz * quad.nz) / length > 0.9;
  };
  /** The corner of triangle t that is not on edge a, b, with the edge in t's own order. */
  const opposite = (t: number, a: number, b: number) => {
    for (let k = 0; k < 3; k += 1) {
      const x = tris[t * 3 + k];
      const y = tris[t * 3 + ((k + 1) % 3)];
      if ((x === a && y === b) || (x === b && y === a)) return { from: x, to: y, other: tris[t * 3 + ((k + 2) % 3)] };
    }
    return null;
  };

  // After the first round, only edges beside a flip can want flipping again.
  let near: Uint8Array | null = null;
  for (let round = 0; round < maxRounds; round += 1) {
    let flips = 0;
    const nextNear = new Uint8Array(faceCount);
    // New edges made by a flip may land anywhere in the table; a later round reaches them.
    const version = owners.version;
    for (let slot = 0; slot < owners.keys.length && owners.version === version; slot += 1) {
      const key = owners.keys[slot];
      if (key === -1 || owners.count[slot] !== 2) continue;
      const t1 = owners.first[slot];
      const t2 = owners.second[slot];
      if (smooth && smooth[t1] && smooth[t2]) continue;
      if (near && !near[t1] && !near[t2]) continue;
      const dot = facings[t1 * 3] * facings[t2 * 3] + facings[t1 * 3 + 1] * facings[t2 * 3 + 1] + facings[t1 * 3 + 2] * facings[t2 * 3 + 2];
      if (dot < flatDot) continue;
      const a = Math.floor(key / EDGE_STRIDE);
      const b = key - a * EDGE_STRIDE;
      const first = opposite(t1, a, b);
      const second = opposite(t2, a, b);
      if (!first || !second || first.other === second.other) continue;
      const c = first.other;
      const d = second.other;
      const nx = facings[t1 * 3] + facings[t2 * 3];
      const ny = facings[t1 * 3 + 1] + facings[t2 * 3 + 1];
      const nz = facings[t1 * 3 + 2] + facings[t2 * 3 + 2];
      const nl = Math.hypot(nx, ny, nz) || 1;
      const quad: FlipQuad = {
        from: first.from, to: first.to, c, d,
        angleC: angleAt(c, first.from, first.to), angleD: angleAt(d, first.from, first.to),
        nx: nx / nl, ny: ny / nl, nz: nz / nl,
      };
      if (!wantsFlip(quad)) continue;
      if (owners.uses(edgeKey(c, d)) > 0) continue;
      // The new pair must face the same way as the old one (no fold over a non-convex quad).
      if (checkShape && !facesSameWay(c, first.from, d, quad)) continue;
      if (checkShape && !facesSameWay(c, d, first.to, quad)) continue;
      // t1 = (from, to, c), t2 = (to, from, d)  →  (c, from, d) and (c, d, to).
      const from = first.from;
      const to = first.to;
      owners.drop(edgeKey(from, to), t1);
      owners.drop(edgeKey(from, to), t2);
      owners.drop(edgeKey(to, c), t1);
      owners.drop(edgeKey(from, d), t2);
      tris[t1 * 3] = c;
      tris[t1 * 3 + 1] = from;
      tris[t1 * 3 + 2] = d;
      tris[t2 * 3] = c;
      tris[t2 * 3 + 1] = d;
      tris[t2 * 3 + 2] = to;
      owners.add(edgeKey(c, d), t1);
      owners.add(edgeKey(c, d), t2);
      owners.add(edgeKey(from, d), t1);
      owners.add(edgeKey(to, c), t2);
      normalInto(t1);
      normalInto(t2);
      nextNear[t1] = 1;
      nextNear[t2] = 1;
      flips += 1;
    }
    if (flips === 0) break;
    near = nextNear;
  }
  return { positions: mesh.positions, indices: tris, parents: mesh.parents };
}

/** Edges used by other than exactly two triangles. 0 means the mesh is closed. */
export function openEdgeCount(indices: ArrayLike<number>): number {
  const uses = new Map<number, number>();
  for (let t = 0; t + 2 < indices.length; t += 3) {
    for (let k = 0; k < 3; k += 1) {
      const key = edgeKey(indices[t + k], indices[t + ((k + 1) % 3)]);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  uses.forEach((count) => {
    if (count !== 2) open += 1;
  });
  return open;
}

/** Signed volume in mm³; positive when the triangles face outward. */
export function meshVolume(mesh: IndexedMesh): number {
  const { positions: p, indices } = mesh;
  let volume = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    volume += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return volume / 6;
}

/** Total surface area in mm². */
export function meshArea(mesh: IndexedMesh): number {
  const { positions: p, indices } = mesh;
  let area = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  }
  return area;
}

/** Unit facing and area of each triangle. */
export function faceNormals(mesh: IndexedMesh) {
  const { positions: p, indices } = mesh;
  const faces = indices.length / 3;
  const normals = new Float32Array(faces * 3);
  const areas = new Float32Array(faces);
  for (let f = 0; f < faces; f += 1) {
    const a = indices[f * 3] * 3;
    const b = indices[f * 3 + 1] * 3;
    const c = indices[f * 3 + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    areas[f] = length / 2;
    if (length > 0) {
      normals[f * 3] = nx / length;
      normals[f * 3 + 1] = ny / length;
      normals[f * 3 + 2] = nz / length;
    }
  }
  return { normals, areas };
}

/**
 * For drawing: a point where the surface folds sharply is split into one point per
 * side, each with that side's own facing, so shading stays crisp at an edge and
 * does not smear along a long flat triangle beside it.
 */
export function splitCreasesForShading(mesh: IndexedMesh, creaseDegrees = 30): IndexedMesh & { normals: Float32Array; sources: Uint32Array } {
  const { positions: p, indices } = mesh;
  const vertexCount = p.length / 3;
  const { normals, areas } = faceNormals(mesh);
  const start = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < indices.length; i += 1) start[indices[i] + 1] += 1;
  for (let v = 0; v < vertexCount; v += 1) start[v + 1] += start[v];
  const fill = start.slice(0, vertexCount);
  const corners = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i += 1) corners[fill[indices[i]]++] = i;
  const limit = Math.cos((creaseDegrees * Math.PI) / 180);
  const outPositions: number[] = [];
  const outNormals: number[] = [];
  const sources: number[] = [];
  const outIndices = new Uint32Array(indices.length);
  const groupOf: number[] = [];
  const groupNormal: number[] = [];
  for (let v = 0; v < vertexCount; v += 1) {
    groupOf.length = 0;
    groupNormal.length = 0;
    for (let i = start[v]; i < start[v + 1]; i += 1) {
      const f = (corners[i] / 3) | 0;
      const nx = normals[f * 3];
      const ny = normals[f * 3 + 1];
      const nz = normals[f * 3 + 2];
      let group = -1;
      for (let g = 0; g < groupNormal.length; g += 3) {
        const length = Math.hypot(groupNormal[g], groupNormal[g + 1], groupNormal[g + 2]) || 1;
        if ((groupNormal[g] * nx + groupNormal[g + 1] * ny + groupNormal[g + 2] * nz) / length >= limit) {
          group = g / 3;
          break;
        }
      }
      if (group < 0) {
        group = groupNormal.length / 3;
        groupNormal.push(0, 0, 0);
      }
      // Weighted by area and by the corner's angle would be finer; area alone is plenty for a texture.
      groupNormal[group * 3] += nx * areas[f];
      groupNormal[group * 3 + 1] += ny * areas[f];
      groupNormal[group * 3 + 2] += nz * areas[f];
      groupOf.push(group);
    }
    const first = outPositions.length / 3;
    for (let g = 0; g < groupNormal.length; g += 3) {
      const length = Math.hypot(groupNormal[g], groupNormal[g + 1], groupNormal[g + 2]) || 1;
      outPositions.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
      sources.push(v);
      outNormals.push(groupNormal[g] / length, groupNormal[g + 1] / length, groupNormal[g + 2] / length);
    }
    for (let i = start[v]; i < start[v + 1]; i += 1) outIndices[corners[i]] = first + groupOf[i - start[v]];
  }
  return { positions: new Float32Array(outPositions), indices: outIndices, normals: new Float32Array(outNormals), sources: new Uint32Array(sources) };
}
