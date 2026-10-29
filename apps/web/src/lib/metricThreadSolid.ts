import { type ResolvedThreadParams } from "@/lib/metricThreads";

export const DEFAULT_THREAD_SIDES = 96;
export const MIN_THREAD_SIDES = 8;
/** Past this the helix stops being a closed solid, so the sides control stops here. */
export const MAX_THREAD_SIDES = 96;
/** Room between a printed screw and its nut or tapped hole, in millimetres off the radius. */
export const DEFAULT_THREAD_CLEARANCE = 0.2;
export const RESIN_THREAD_CLEARANCE = 0.1;
export const MIN_THREAD_CLEARANCE = 0;
export const MAX_THREAD_CLEARANCE = 2;
/** Clearance never eats more than this share of the tooth, so a small hole still grips its screw. */
const MAX_CLEARANCE_SHARE_OF_TOOTH = 0.5;
/** Facets about this long around the thread. Small threads need far fewer sides than large ones. */
const THREAD_FACET_MM = 0.25;

export type MetricThreadSolidMesh = {
  /** Non-indexed triangle soup (9 floats per triangle), editor Y-up, base at y = 0. */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
  brep: string;
  step?: string;
  width: number;
  depth: number;
  height: number;
};

export type ThreadMeshPart = "screw" | "shaft" | "threads";
export type ThreadRole = "rod" | "screw" | "nut" | "bore";
export type ThreadHead = "cylinder" | "countersunk" | "hex";
export type ThreadProfile = "v" | "whitworth" | "trapezoid" | "round";

export type ThreadMeshOptions = {
  /** Radial segments around the shaft / helix (higher = rounder). */
  sides?: number;
  /** Extra radial clearance (mm) for hole cutters / loose fit. */
  clearance?: number;
  /** Which solid to build. */
  part?: ThreadMeshPart;
  role?: ThreadRole;
  head?: ThreadHead;
  /** 45° end chamfer length in mm. */
  chamfer?: number;
  profile?: ThreadProfile;
};

/** The default clearance for the printer in use. Resin prints closer to size than filament. */
export function defaultThreadClearance(printerKind?: "filament" | "resin") {
  return printerKind === "resin" ? RESIN_THREAD_CLEARANCE : DEFAULT_THREAD_CLEARANCE;
}

/**
 * One pitch of tooth: `depth` is the tooth height as a share of the pitch, and `points`
 * trace the height (0 root, 1 crest) along the pitch, straight between points.
 */
type ToothShape = { depth: number; points: Array<[number, number]> };

function sampledTooth(depth: number, samples: number, height: (u: number) => number): ToothShape {
  return { depth, points: Array.from({ length: samples }, (_, index) => [index / samples, height(index / samples)]) };
}

/** Distance from the nearest root (0) to the crest (1) along one pitch. */
function triangleWave(u: number) {
  return 1 - Math.abs(1 - 2 * u);
}

const TOOTH_SHAPES: Record<ThreadProfile, ToothShape> = {
  // ISO 68-1: 60° flanks, a P/8 flat on the crest and a P/4 flat at the root, 5H/8 deep.
  v: { depth: 0.541266, points: [[2 / 16, 0], [7 / 16, 1], [9 / 16, 1], [14 / 16, 0]] },
  // ISO 2904 trapezoidal: 30° flanks, half a pitch deep.
  trapezoid: { depth: 0.5, points: [[0.183, 0], [0.317, 1], [0.683, 1], [0.817, 0]] },
  // Whitworth: 55° flanks with rounded crests and roots.
  whitworth: sampledTooth(0.640327, 12, (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, (triangleWave(u) - 0.08) / 0.84)))),
  // Knuckle thread: one smooth wave per pitch.
  round: sampledTooth(0.5, 12, (u) => 0.5 - 0.5 * Math.cos(2 * Math.PI * u)),
};

function toothHeight(tooth: ToothShape, phase: number) {
  const points = tooth.points;
  const u = phase - Math.floor(phase);
  // Before the first point is the stretch that wraps round from the last one.
  const at = u < points[0][0] ? u + 1 : u;
  for (let index = 0; index < points.length; index += 1) {
    const [u0, h0] = points[index];
    const [u1, h1] = index + 1 === points.length ? [points[0][0] + 1, points[0][1]] : points[index + 1];
    if (at >= u0 && at <= u1) return h0 + (h1 - h0) * (u1 - u0 > 1e-9 ? (at - u0) / (u1 - u0) : 0);
  }
  return points[0][1];
}

/**
 * Fewer sides on small threads: about one facet per quarter millimetre around, in steps of
 * twelve so hex flats land on a side. The sides control still caps it.
 */
export function threadSidesFor(diameter: number, requested: number) {
  const capped = Math.max(MIN_THREAD_SIDES, Math.min(MAX_THREAD_SIDES, Math.round(requested)));
  const needed = Math.max(24, Math.ceil((Math.PI * diameter) / THREAD_FACET_MM / 12) * 12);
  return Math.min(capped, needed);
}

/** Clearance that still leaves at least half of each tooth to grip. */
export function effectiveThreadClearance(clearance: number, pitch: number, profile: ThreadProfile = "v") {
  const tooth = TOOTH_SHAPES[profile].depth * pitch;
  return Math.max(MIN_THREAD_CLEARANCE, Math.min(MAX_THREAD_CLEARANCE, clearance, tooth * MAX_CLEARANCE_SHARE_OF_TOOTH));
}

/** Indexed triangles that share every corner, so the result is one closed shell. */
class SolidBuilder {
  readonly points: number[] = [];
  readonly triangles: number[] = [];

  vertex(x: number, y: number, z: number) {
    this.points.push(x, y, z);
    return this.points.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number) {
    this.triangles.push(a, b, c);
  }

  /** A ring of corners at height y, one per side, `radius(angle)` from the axis. */
  ring(sides: number, y: number, radius: (angle: number) => number) {
    return Array.from({ length: sides }, (_, index) => {
      const angle = (index / sides) * Math.PI * 2;
      const r = radius(angle);
      return this.vertex(Math.cos(angle) * r, y, Math.sin(angle) * r);
    });
  }

  /**
   * Joins two rings of the same side count. Rings are given in the order the outline runs:
   * outward along the bottom, up the outside, inward across the top, down any bore.
   */
  bridge(from: number[], to: number[]) {
    const sides = from.length;
    for (let index = 0; index < sides; index += 1) {
      const next = (index + 1) % sides;
      this.triangle(from[index], to[index], from[next]);
      this.triangle(to[index], to[next], from[next]);
    }
  }

  /** Closes a ring with a point on the axis. `bottom` faces down, otherwise up. */
  cap(ring: number[], y: number, bottom: boolean) {
    const center = this.vertex(0, y, 0);
    const sides = ring.length;
    for (let index = 0; index < sides; index += 1) {
      const next = (index + 1) % sides;
      if (bottom) this.triangle(center, ring[index], ring[next]);
      else this.triangle(center, ring[next], ring[index]);
    }
  }

  soup() {
    const triangleCount = this.triangles.length / 3;
    const positions = new Float32Array(triangleCount * 9);
    const normals = new Float32Array(triangleCount * 9);
    const p = this.points;
    for (let t = 0; t < triangleCount; t += 1) {
      const ia = this.triangles[t * 3] * 3;
      const ib = this.triangles[t * 3 + 1] * 3;
      const ic = this.triangles[t * 3 + 2] * 3;
      const abx = p[ib] - p[ia];
      const aby = p[ib + 1] - p[ia + 1];
      const abz = p[ib + 2] - p[ia + 2];
      const acx = p[ic] - p[ia];
      const acy = p[ic + 1] - p[ia + 1];
      const acz = p[ic + 2] - p[ia + 2];
      let nx = aby * acz - abz * acy;
      let ny = abz * acx - abx * acz;
      let nz = abx * acy - aby * acx;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      for (const [slot, index] of [[0, ia], [1, ib], [2, ic]] as const) {
        positions[t * 9 + slot * 3] = p[index];
        positions[t * 9 + slot * 3 + 1] = p[index + 1];
        positions[t * 9 + slot * 3 + 2] = p[index + 2];
        normals[t * 9 + slot * 3] = nx;
        normals[t * 9 + slot * 3 + 1] = ny;
        normals[t * 9 + slot * 3 + 2] = nz;
      }
    }
    return { positions, normals, triangleCount };
  }
}

type ThreadBand = {
  sides: number;
  pitch: number;
  height: number;
  /** +1 right hand, −1 left hand. */
  hand: number;
  tooth: ToothShape | null;
  minorR: number;
  toothDepth: number;
  /** Radius limit at height y (chamfers). Applied with min for screws, max for holes. */
  limit?: (y: number) => number;
  limitIsFloor?: boolean;
  /** Extra heights to sample on every side, where a chamfer bends. */
  extraHeights?: number[];
};

function bandRadius(band: ThreadBand, angle: number, y: number) {
  const phase = y / band.pitch - (band.hand * angle) / (Math.PI * 2);
  const r = band.tooth ? band.minorR + band.toothDepth * toothHeight(band.tooth, phase) : band.minorR;
  if (!band.limit) return r;
  const limit = band.limit(y);
  return Math.max(0.05, band.limitIsFloor ? Math.max(r, limit) : Math.min(r, limit));
}

/**
 * The threaded wall from y = 0 to the top, facing away from the axis. Each side samples
 * every point of the tooth along the helix, so the teeth are exact, and neighbouring
 * sides are stitched by height. Returns its bottom and top rings for capping.
 */
function buildThreadBand(builder: SolidBuilder, band: ThreadBand) {
  const { sides, pitch, height } = band;
  const nearlySame = Math.max(1e-4, pitch * 1e-4);
  const columns: number[][] = [];
  for (let side = 0; side < sides; side += 1) {
    const angle = (side / sides) * Math.PI * 2;
    const heights = [0, height, ...(band.extraHeights ?? [])];
    if (band.tooth) {
      const start = (band.hand * angle) / (Math.PI * 2);
      const firstTurn = Math.floor(-start) - 1;
      const lastTurn = Math.ceil(height / pitch - start) + 1;
      for (let turn = firstTurn; turn <= lastTurn; turn += 1) {
        for (const [u] of band.tooth.points) heights.push((start + turn + u) * pitch);
      }
    }
    const kept = [0];
    for (const y of heights.sort((a, b) => a - b)) {
      if (y - kept[kept.length - 1] >= nearlySame && height - y >= nearlySame) kept.push(y);
    }
    kept.push(height);
    columns.push(kept.map((y) => {
      const r = bandRadius(band, angle, y);
      return builder.vertex(Math.cos(angle) * r, y, Math.sin(angle) * r);
    }));
  }
  const yOf = (vertex: number) => builder.points[vertex * 3 + 1];
  for (let side = 0; side < sides; side += 1) {
    const a = columns[side];
    const b = columns[(side + 1) % sides];
    let ia = 0;
    let ib = 0;
    while (ia < a.length - 1 || ib < b.length - 1) {
      const advanceA = ib === b.length - 1 || (ia < a.length - 1 && yOf(a[ia + 1]) <= yOf(b[ib + 1]));
      if (advanceA) {
        builder.triangle(a[ia], a[ia + 1], b[ib]);
        ia += 1;
      } else {
        builder.triangle(a[ia], b[ib + 1], b[ib]);
        ib += 1;
      }
    }
  }
  return {
    bottom: columns.map((column) => column[0]),
    top: columns.map((column) => column[column.length - 1]),
  };
}

function hexRadiusAt(acrossFlats: number, angle: number) {
  const sector = Math.PI / 3;
  const local = ((angle - Math.PI / 6) % sector + sector) % sector;
  return (acrossFlats / 2) / Math.cos(local - sector / 2);
}

/**
 * Fast procedural metric screw / shaft / thread-cutter mesh.
 * Pure JS — no OCCT/WASM — so inserting/updating stays interactive.
 */
export function threadHeadSize(majorDiameter: number, head: ThreadHead) {
  const diameter = Math.max(1, majorDiameter);
  if (head === "countersunk") return { across: diameter * 2, height: diameter * 0.6 };
  if (head === "hex") return { across: diameter * 1.6, height: diameter * 0.7 };
  return { across: diameter * 1.7, height: diameter };
}

export function threadNutSize(majorDiameter: number) {
  const diameter = Math.max(1, majorDiameter);
  return { across: diameter * 1.6, height: diameter * 0.8 };
}

/** Heights from `from` to `to` about every eighth of a pitch, where a chamfer cuts the teeth. */
function chamferHeights(from: number, to: number, pitch: number) {
  const step = pitch / 8;
  const heights: number[] = [];
  for (let y = from; y < to; y += step) heights.push(y);
  heights.push(to);
  return heights;
}

/**
 * Fast procedural thread solid: rod, headed screw, nut, or tapped-hole cutter. Always one
 * closed shell facing outward, so it can be joined to or cut from other parts.
 * Pure JS — no OCCT/WASM — so inserting/updating stays interactive.
 */
export function buildMetricThreadedCylinder(
  params: ResolvedThreadParams,
  height: number,
  options: ThreadMeshOptions = {},
): MetricThreadSolidMesh {
  const part: ThreadMeshPart = options.part ?? "screw";
  const role: ThreadRole = options.role
    ?? (part === "shaft" ? "rod" : part === "threads" ? "bore" : "rod");
  const head: ThreadHead = options.head ?? "cylinder";
  const profile: ThreadProfile = options.profile ?? "v";
  const tooth = TOOTH_SHAPES[profile] ?? TOOTH_SHAPES.v;
  const internal = role === "bore" || role === "nut";
  const pitch = Math.max(0.15, params.pitch);
  const clearance = internal ? effectiveThreadClearance(options.clearance ?? 0, pitch, profile) : 0;
  const nominalR = Math.max(0.35, params.majorDiameter / 2);
  const majorR = nominalR + clearance;
  const toothDepth = Math.min(tooth.depth * pitch, majorR * 0.45);
  const minorR = Math.max(0.2, majorR - toothDepth);
  const shank = Math.max(pitch * 1.05, height);
  const hand = params.handedness === "left" ? -1 : 1;
  const sides = threadSidesFor(params.majorDiameter, options.sides ?? DEFAULT_THREAD_SIDES);
  const headSize = threadHeadSize(params.majorDiameter, head);
  const nutSize = threadNutSize(params.majorDiameter);
  const builder = new SolidBuilder();

  if (role === "nut") {
    const nutHeight = Math.max(pitch, height);
    // A countersink at each mouth helps the screw start.
    const mouth = Math.min(options.chamfer ?? 0, nutHeight * 0.3, majorR * 0.45);
    const boreStart = builder.triangles.length;
    const band = buildThreadBand(builder, {
      sides,
      pitch,
      height: nutHeight,
      hand,
      tooth,
      minorR,
      toothDepth,
      ...(mouth > 0.05
        ? {
            limit: (y: number) => majorR + mouth - Math.min(y, nutHeight - y),
            limitIsFloor: true,
            extraHeights: [...chamferHeights(0, mouth, pitch), ...chamferHeights(nutHeight - mouth, nutHeight, pitch)],
          }
        : {}),
    });
    // The bore was built facing away from the axis; turn it to face into the hole.
    for (let index = boreStart; index < builder.triangles.length; index += 3) {
      const b = builder.triangles[index + 1];
      builder.triangles[index + 1] = builder.triangles[index + 2];
      builder.triangles[index + 2] = b;
    }
    const hex = (angle: number) => hexRadiusAt(nutSize.across, angle);
    const outerBottom = builder.ring(sides, 0, hex);
    const outerTop = builder.ring(sides, nutHeight, hex);
    builder.bridge(band.bottom, outerBottom);
    builder.bridge(outerBottom, outerTop);
    builder.bridge(outerTop, band.top);
  } else {
    const chamfer = Math.max(0, Math.min(options.chamfer ?? 0, shank * 0.3, minorR * 0.8));
    const bottomChamfer = chamfer > 0.05 ? chamfer : 0;
    const topChamfer = role === "screw" ? 0 : bottomChamfer;
    const plain = part === "shaft";
    let limit: ((y: number) => number) | undefined;
    let extraHeights: number[] | undefined;
    if (bottomChamfer > 0 && role === "bore") {
      // A tapped hole widens at each mouth, like a countersink, so the screw finds it.
      limit = (y) => majorR + bottomChamfer - Math.min(y, shank - y);
      extraHeights = [...chamferHeights(0, bottomChamfer, pitch), ...chamferHeights(shank - bottomChamfer, shank, pitch)];
    } else if (bottomChamfer > 0) {
      // A 45° end chamfer from just inside the root, cutting the first teeth back.
      const reach = bottomChamfer + (plain ? 0 : toothDepth);
      limit = (y) => minorR - bottomChamfer + (topChamfer ? Math.min(y, shank - y) : y);
      extraHeights = [
        ...chamferHeights(0, Math.min(reach, shank / 2), pitch),
        ...(topChamfer ? chamferHeights(Math.max(shank / 2, shank - reach), shank, pitch) : []),
      ];
    }
    const band = buildThreadBand(builder, {
      sides,
      pitch,
      height: shank,
      hand,
      tooth: plain ? null : tooth,
      minorR,
      toothDepth,
      limit,
      limitIsFloor: role === "bore",
      extraHeights,
    });
    builder.cap(band.bottom, 0, true);
    if (role !== "screw") {
      builder.cap(band.top, shank, false);
    } else {
      // The head continues the thread's top rim, so the screw is one closed shell.
      const y0 = shank;
      const y1 = shank + headSize.height;
      if (head === "hex") {
        const hex = (angle: number) => hexRadiusAt(headSize.across, angle);
        const under = builder.ring(sides, y0, hex);
        const top = builder.ring(sides, y1, hex);
        builder.bridge(band.top, under);
        builder.bridge(under, top);
        builder.cap(top, y1, false);
      } else if (head === "countersunk") {
        const top = builder.ring(sides, y1, () => headSize.across / 2);
        builder.bridge(band.top, top);
        builder.cap(top, y1, false);
      } else {
        const under = builder.ring(sides, y0, () => headSize.across / 2);
        const top = builder.ring(sides, y1, () => headSize.across / 2);
        builder.bridge(band.top, under);
        builder.bridge(under, top);
        builder.cap(top, y1, false);
      }
    }
  }

  const { positions, normals, triangleCount } = builder.soup();
  const indices = new Uint32Array(triangleCount * 3);
  for (let i = 0; i < indices.length; i += 1) indices[i] = i;

  const hexSpan = (across: number) => (across / Math.sqrt(3)) * 2;
  const outer = role === "nut"
    ? hexSpan(nutSize.across)
    : role === "screw"
      ? Math.max(majorR * 2, head === "hex" ? hexSpan(headSize.across) : headSize.across)
      : (part === "shaft" ? minorR : majorR) * 2;
  const totalHeight = role === "nut" ? Math.max(pitch, height) : role === "screw" ? shank + headSize.height : shank;

  return {
    positions,
    normals,
    indices,
    triangleCount,
    brep: "",
    width: outer,
    depth: outer,
    height: totalHeight,
  };
}
