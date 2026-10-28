/**
 * Crystal blanks for engraving inside glass (K9 crystal, for example on the xTool
 * F2 Ultra UV). A blank is a block or a ball; the model sits inside it, a little way in
 * from every surface so the glass doesn't crack.
 */

export type CrystalShape = "block" | "ball";

/** A crystal blank. A block uses width, depth and height; a ball uses its diameter. */
export type CrystalBlank = {
  shape: CrystalShape;
  width: number;
  depth: number;
  height: number;
  diameter: number;
  /** How far in from every surface the model stays, in millimetres. */
  margin: number;
};

export type CrystalSize = Omit<CrystalBlank, "margin">;

export const CRYSTAL_MATERIAL_ID = "k9-crystal";
export const MIN_CRYSTAL_MM = 5;
export const MAX_CRYSTAL_MM = 300;
export const MAX_CRYSTAL_MARGIN = 20;
/** The F2 Ultra UV reaches only the middle 70 × 70 mm of the glass from above. */
export const F2_ULTRA_UV_REACH = 70;

export const DEFAULT_CRYSTAL: CrystalBlank = { shape: "block", width: 50, depth: 50, height: 80, diameter: 80, margin: 3 };

const block = (width: number, depth: number, height: number): CrystalSize => ({ shape: "block", width, depth, height, diameter: DEFAULT_CRYSTAL.diameter });
const ball = (diameter: number): CrystalSize => ({ shape: "ball", width: DEFAULT_CRYSTAL.width, depth: DEFAULT_CRYSTAL.depth, height: DEFAULT_CRYSTAL.height, diameter });

/** Sizes K9 blanks are commonly sold in, to start from. */
export const COMMON_CRYSTAL_SIZES: readonly CrystalSize[] = [
  block(50, 50, 50),
  block(60, 60, 60),
  block(50, 50, 80),
  block(80, 50, 50),
  ball(60),
  ball(80),
];

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampSize(value: unknown, fallback: number) {
  return Number(Math.max(MIN_CRYSTAL_MM, Math.min(MAX_CRYSTAL_MM, finite(value, fallback))).toFixed(2));
}

export function normalizeCrystal(value: unknown, fallback: CrystalBlank = DEFAULT_CRYSTAL): CrystalBlank {
  const input = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof CrystalBlank, unknown>>;
  return {
    shape: input.shape === "ball" ? "ball" : input.shape === "block" ? "block" : fallback.shape,
    width: clampSize(input.width, fallback.width),
    depth: clampSize(input.depth, fallback.depth),
    height: clampSize(input.height, fallback.height),
    diameter: clampSize(input.diameter, fallback.diameter),
    margin: Number(Math.max(0, Math.min(MAX_CRYSTAL_MARGIN, finite(input.margin, fallback.margin))).toFixed(2)),
  };
}

const mm = (value: number) => `${Number(value.toFixed(1))}`;

/** "50 × 50 × 80 mm block" or "80 mm ball". */
export function crystalSizeLabel(size: CrystalSize) {
  return size.shape === "ball" ? `${mm(size.diameter)} mm ball` : `${mm(size.width)} × ${mm(size.depth)} × ${mm(size.height)} mm block`;
}

export function sameCrystalSize(a: CrystalSize, b: CrystalSize) {
  return a.shape === b.shape && (a.shape === "ball" ? a.diameter === b.diameter : a.width === b.width && a.depth === b.depth && a.height === b.height);
}

/** The blank's outside, centred on the plate and sitting on it. */
export function crystalBounds(blank: CrystalBlank) {
  if (blank.shape === "ball") {
    const r = blank.diameter / 2;
    return { minX: -r, maxX: r, minY: 0, maxY: blank.diameter, minZ: -r, maxZ: r };
  }
  return { minX: -blank.width / 2, maxX: blank.width / 2, minY: 0, maxY: blank.height, minZ: -blank.depth / 2, maxZ: blank.depth / 2 };
}

type Vec3 = readonly [number, number, number];
type Box = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

function boundsOf(points: Iterable<Vec3>): Box | null {
  let box: Box | null = null;
  for (const [x, y, z] of points) {
    if (!box) box = { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z };
    else {
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
      box.minZ = Math.min(box.minZ, z);
      box.maxZ = Math.max(box.maxZ, z);
    }
  }
  return box;
}

/**
 * The space a model may fill: in from each surface by the margin, and for a block on the
 * F2 Ultra UV, no wider than the middle 70 × 70 mm the laser reaches.
 */
export function crystalSpace(blank: CrystalBlank, reach: number | null) {
  const m = blank.margin;
  if (blank.shape === "ball") {
    const radius = Math.max(0.5, blank.diameter / 2 - m);
    const limit = reach ? Math.min(radius, reach / 2) : radius;
    return { shape: "ball" as const, centre: [0, blank.diameter / 2, 0] as Vec3, radius, reachHalf: reach ? reach / 2 : null, limit };
  }
  const halfX = Math.max(0.25, blank.width / 2 - m);
  const halfZ = Math.max(0.25, blank.depth / 2 - m);
  return {
    shape: "block" as const,
    halfX: reach ? Math.min(halfX, reach / 2) : halfX,
    halfZ: reach ? Math.min(halfZ, reach / 2) : halfZ,
    minY: Math.min(m, blank.height / 2 - 0.25),
    maxY: Math.max(blank.height - m, blank.height / 2 + 0.25),
  };
}

/**
 * How to scale and move a model (given as its world points) so it fills the crystal's
 * space: one ratio for every part, about the model's middle, then the middle placed at
 * the space's middle.
 */
export function fitInsideCrystal(points: readonly Vec3[], blank: CrystalBlank, reach: number | null) {
  const box = boundsOf(points);
  if (!box) return null;
  const middle: Vec3 = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2];
  const space = crystalSpace(blank, reach);
  let ratio: number;
  let target: Vec3;
  if (space.shape === "ball") {
    let furthest = 0;
    for (const [x, y, z] of points) furthest = Math.max(furthest, Math.hypot(x - middle[0], y - middle[1], z - middle[2]));
    ratio = furthest > 0 ? space.radius / furthest : 1;
    // The laser's reach from above limits how wide it may be, too.
    if (space.reachHalf) {
      let wide = 0;
      for (const [x, , z] of points) wide = Math.max(wide, Math.abs(x - middle[0]), Math.abs(z - middle[2]));
      if (wide > 0) ratio = Math.min(ratio, space.reachHalf / wide);
    }
    target = space.centre;
  } else {
    const ratios = [
      (2 * space.halfX) / Math.max(1e-9, box.maxX - box.minX),
      (2 * space.halfZ) / Math.max(1e-9, box.maxZ - box.minZ),
      (space.maxY - space.minY) / Math.max(1e-9, box.maxY - box.minY),
    ];
    ratio = Math.min(...ratios);
    target = [0, (space.minY + space.maxY) / 2, 0];
  }
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return { ratio, middle, target };
}

export type CrystalCheck =
  | { status: "inside" }
  | { status: "close" | "outside"; message: string };

/** Whether a model (its world points) keeps within the crystal's space. */
export function checkInsideCrystal(points: Iterable<Vec3>, blank: CrystalBlank, reach: number | null): CrystalCheck {
  const outside = crystalBounds(blank);
  const space = crystalSpace(blank, reach);
  let poking = false;
  let close = false;
  let pastReach = false;
  const slack = 0.01;
  for (const [x, y, z] of points) {
    if (blank.shape === "ball") {
      const centre = blank.diameter / 2;
      const distance = Math.hypot(x, y - centre, z);
      if (distance > centre + slack) poking = true;
      else if (space.shape === "ball" && distance > space.radius + slack) close = true;
    } else if (x < outside.minX - slack || x > outside.maxX + slack || z < outside.minZ - slack || z > outside.maxZ + slack || y < -slack || y > outside.maxY + slack) {
      poking = true;
    } else if (space.shape === "block" && (Math.abs(x) > blank.width / 2 - blank.margin + slack || Math.abs(z) > blank.depth / 2 - blank.margin + slack || y < space.minY - slack || y > space.maxY + slack)) {
      close = true;
    }
    if (reach && (Math.abs(x) > reach / 2 + slack || Math.abs(z) > reach / 2 + slack)) pastReach = true;
    if (poking) break;
  }
  if (poking) return { status: "outside", message: "Part of the model is outside the crystal. Use Fit in crystal to scale it inside." };
  if (pastReach) return { status: "outside", message: `Part of the model is outside the middle ${F2_ULTRA_UV_REACH} × ${F2_ULTRA_UV_REACH} mm the laser reaches inside glass. Use Fit in crystal.` };
  if (close) return { status: "close", message: `Part of the model is closer than ${mm(blank.margin)} mm to the crystal's surface, where the glass can crack. Use Fit in crystal.` };
  return { status: "inside" };
}

const SAVED_KEY = "mintr:crystal-sizes";
export const CRYSTAL_SIZES_EVENT = "mintr:crystal-sizes";

/** The sizes this person has saved, shared by all their designs. */
export function loadSavedCrystalSizes(): CrystalSize[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
      const { margin: _margin, ...size } = normalizeCrystal(entry);
      return size;
    });
  } catch {
    return [];
  }
}

function storeSizes(sizes: readonly CrystalSize[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(sizes));
    window.dispatchEvent(new Event(CRYSTAL_SIZES_EVENT));
  } catch {
    // Saved sizes are a convenience; the design keeps its own blank either way.
  }
}

export function saveCrystalSize(size: CrystalSize) {
  const saved = loadSavedCrystalSizes();
  if (saved.some((entry) => sameCrystalSize(entry, size)) || COMMON_CRYSTAL_SIZES.some((entry) => sameCrystalSize(entry, size))) return;
  storeSizes([...saved, size]);
}

export function forgetCrystalSize(size: CrystalSize) {
  storeSizes(loadSavedCrystalSizes().filter((entry) => !sameCrystalSize(entry, size)));
}
