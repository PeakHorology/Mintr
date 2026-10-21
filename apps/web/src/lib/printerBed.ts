import type { WorkplaneShape } from "@/types/sketchforge";
import { DEFAULT_NOZZLE_MM, normalizeNozzleMm } from "@/lib/thinWalls";

export type PrinterKind = "filament" | "resin";

export type PrinterPreset = {
  id: string;
  brand: string;
  /** Model name, shown after the brand is chosen. */
  label: string;
  width: number;
  depth: number;
  height: number;
  kind: PrinterKind;
};

const CUSTOM_BRAND = "Custom";

function printer(
  id: string,
  brand: string,
  label: string,
  width: number,
  depth: number,
  height: number,
  kind: PrinterKind = "filament",
): PrinterPreset {
  return { id, brand, label, width, depth, height, kind };
}

/**
 * Build volumes in millimetres, width × depth × height, from each maker's
 * published spec. Older saved ids (ender-3, bambu-p1s, prusa-mk4, bambu-a1-mini)
 * stay on the same machines. H2D is the single-nozzle volume.
 */
export const PRINTER_PRESETS: readonly PrinterPreset[] = [
  printer("anycubic-kobra-2", "Anycubic", "Kobra 2", 220, 220, 250),
  printer("anycubic-kobra-2-pro", "Anycubic", "Kobra 2 Pro", 220, 220, 250),
  printer("anycubic-kobra-2-plus", "Anycubic", "Kobra 2 Plus", 320, 320, 400),
  printer("anycubic-kobra-2-max", "Anycubic", "Kobra 2 Max", 420, 420, 500),
  printer("anycubic-kobra-3", "Anycubic", "Kobra 3", 250, 250, 260),
  printer("anycubic-kobra-3-max", "Anycubic", "Kobra 3 Max", 420, 420, 500),
  printer("anycubic-kobra-s1", "Anycubic", "Kobra S1", 250, 250, 250),
  printer("anycubic-kobra-max", "Anycubic", "Kobra Max", 400, 400, 450),
  printer("anycubic-vyper", "Anycubic", "Vyper", 245, 245, 260),
  printer("anycubic-photon-mono-4", "Anycubic", "Photon Mono 4", 153, 87, 165, "resin"),
  printer("anycubic-photon-mono-m5s", "Anycubic", "Photon Mono M5s", 218, 123, 200, "resin"),
  printer("anycubic-photon-mono-m7", "Anycubic", "Photon Mono M7", 223, 126, 230, "resin"),
  printer("anycubic-photon-mono-m7-pro", "Anycubic", "Photon Mono M7 Pro", 223, 126, 230, "resin"),

  printer("artillery-genius-pro", "Artillery", "Genius Pro", 220, 220, 250),
  printer("artillery-sidewinder-x2", "Artillery", "Sidewinder X2", 300, 300, 400),
  printer("artillery-sidewinder-x3", "Artillery", "Sidewinder X3", 240, 240, 260),
  printer("artillery-sidewinder-x4-plus", "Artillery", "Sidewinder X4 Plus", 300, 300, 400),

  printer("bambu-a1", "Bambu Lab", "A1", 256, 256, 256),
  printer("bambu-a1-mini", "Bambu Lab", "A1 mini", 180, 180, 180),
  printer("bambu-h2c", "Bambu Lab", "H2C", 330, 320, 320),
  printer("bambu-h2d", "Bambu Lab", "H2D", 325, 320, 325),
  printer("bambu-h2s", "Bambu Lab", "H2S", 340, 320, 340),
  printer("bambu-p1p", "Bambu Lab", "P1P", 256, 256, 256),
  printer("bambu-p1s", "Bambu Lab", "P1S", 256, 256, 256),
  printer("bambu-p2s", "Bambu Lab", "P2S", 256, 256, 256),
  printer("bambu-x1c", "Bambu Lab", "X1 Carbon", 256, 256, 256),
  printer("bambu-x1e", "Bambu Lab", "X1E", 256, 256, 256),

  printer("creality-cr-10", "Creality", "CR-10", 300, 300, 400),
  printer("ender-3", "Creality", "Ender 3 / V2 / Pro", 220, 220, 250),
  printer("creality-ender-3-max", "Creality", "Ender 3 Max", 300, 300, 340),
  printer("creality-ender-3-s1", "Creality", "Ender 3 S1 / S1 Pro", 220, 220, 270),
  printer("creality-ender-3-v3", "Creality", "Ender 3 V3", 220, 220, 250),
  printer("creality-ender-3-v3-ke", "Creality", "Ender 3 V3 KE", 220, 220, 240),
  printer("creality-ender-5", "Creality", "Ender 5", 220, 220, 300),
  printer("creality-ender-5-plus", "Creality", "Ender 5 Plus", 350, 350, 400),
  printer("creality-k1", "Creality", "K1", 220, 220, 250),
  printer("creality-k1c", "Creality", "K1C", 220, 220, 250),
  printer("creality-k1-max", "Creality", "K1 Max", 300, 300, 300),
  printer("creality-k2-plus", "Creality", "K2 Plus", 350, 350, 350),
  printer("creality-halot-mage", "Creality", "Halot Mage", 211, 131, 230, "resin"),
  printer("creality-halot-mage-s", "Creality", "Halot Mage S", 222, 122, 230, "resin"),

  printer("elegoo-centauri-carbon", "Elegoo", "Centauri Carbon", 256, 256, 256),
  printer("elegoo-neptune-3-pro", "Elegoo", "Neptune 3 Pro", 225, 225, 280),
  printer("elegoo-neptune-4", "Elegoo", "Neptune 4", 225, 225, 265),
  printer("elegoo-neptune-4-pro", "Elegoo", "Neptune 4 Pro", 225, 225, 265),
  printer("elegoo-neptune-4-plus", "Elegoo", "Neptune 4 Plus", 320, 320, 385),
  printer("elegoo-neptune-4-max", "Elegoo", "Neptune 4 Max", 420, 420, 480),
  printer("elegoo-mars-4", "Elegoo", "Mars 4", 153, 78, 175, "resin"),
  printer("elegoo-saturn-3", "Elegoo", "Saturn 3", 219, 123, 250, "resin"),
  printer("elegoo-saturn-4-ultra", "Elegoo", "Saturn 4 Ultra", 219, 123, 220, "resin"),

  printer("flashforge-adventurer-5m", "FlashForge", "Adventurer 5M", 220, 220, 220),
  printer("flashforge-adventurer-5m-pro", "FlashForge", "Adventurer 5M Pro", 220, 220, 220),
  printer("flashforge-guider-3-plus", "FlashForge", "Guider 3 Plus", 350, 350, 600),

  printer("flsun-super-racer", "FLSun", "Super Racer", 260, 260, 330),
  printer("flsun-v400", "FLSun", "V400", 300, 300, 410),

  printer("formlabs-form-2", "Formlabs", "Form 2", 145, 145, 175, "resin"),
  printer("formlabs-form-3", "Formlabs", "Form 3 / 3+", 145, 145, 185, "resin"),
  printer("formlabs-form-3b", "Formlabs", "Form 3B / 3B+", 145, 145, 185, "resin"),
  printer("formlabs-form-3l", "Formlabs", "Form 3L", 335, 200, 300, "resin"),
  printer("formlabs-form-3bl", "Formlabs", "Form 3BL", 335, 200, 300, "resin"),
  printer("formlabs-form-4", "Formlabs", "Form 4", 200, 125, 210, "resin"),
  printer("formlabs-form-4b", "Formlabs", "Form 4B", 200, 125, 210, "resin"),
  printer("formlabs-form-4l", "Formlabs", "Form 4L", 354, 196, 350, "resin"),
  printer("formlabs-form-4bl", "Formlabs", "Form 4BL", 354, 196, 350, "resin"),

  printer("prusa-core-one", "Prusa", "Core One", 250, 220, 270),
  printer("prusa-core-one-l", "Prusa", "Core One L", 300, 300, 330),
  printer("prusa-mini", "Prusa", "MINI+", 180, 180, 180),
  printer("prusa-mk3s", "Prusa", "MK3S+", 250, 210, 210),
  printer("prusa-mk4", "Prusa", "MK4", 250, 210, 220),
  printer("prusa-mk4s", "Prusa", "MK4S", 250, 210, 220),
  printer("prusa-xl", "Prusa", "XL", 360, 360, 360),
  printer("prusa-sl1s", "Prusa", "SL1S SPEED", 127, 80, 150, "resin"),

  printer("qidi-q1-pro", "Qidi", "Q1 Pro", 245, 245, 240),
  printer("qidi-plus-4", "Qidi", "Plus 4", 305, 305, 280),
  printer("qidi-x-plus-3", "Qidi", "X-Plus 3", 280, 280, 270),
  printer("qidi-x-max-3", "Qidi", "X-Max 3", 325, 325, 315),

  printer("sovol-sv06", "Sovol", "SV06", 220, 220, 250),
  printer("sovol-sv06-plus", "Sovol", "SV06 Plus", 300, 300, 340),
  printer("sovol-sv07", "Sovol", "SV07", 220, 220, 250),
  printer("sovol-sv08", "Sovol", "SV08", 350, 350, 345),

  printer("ultimaker-s5", "UltiMaker", "S5", 330, 240, 300),
  printer("ultimaker-s7", "UltiMaker", "S7", 330, 240, 300),
  printer("ultimaker-factor-4", "UltiMaker", "Factor 4", 330, 240, 300),

  printer("voron-0", "Voron", "0.2", 120, 120, 120),
  printer("voron-24-250", "Voron", "2.4 250", 250, 250, 250),
  printer("voron-24-300", "Voron", "2.4 300", 300, 300, 300),
  printer("voron-24-350", "Voron", "2.4 350", 350, 350, 350),
  printer("voron-trident-300", "Voron", "Trident 300", 300, 300, 250),
  printer("voron-trident-350", "Voron", "Trident 350", 350, 350, 250),

  printer("custom", CUSTOM_BRAND, "Custom size", 220, 220, 250),
];

export const PRINTER_BRANDS: readonly string[] = PRINTER_PRESETS.reduce<string[]>((brands, preset) => {
  if (!brands.includes(preset.brand)) brands.push(preset.brand);
  return brands;
}, []);

export function brandForPreset(id: string | null | undefined) {
  return PRINTER_PRESETS.find((entry) => entry.id === id)?.brand ?? CUSTOM_BRAND;
}

export function kindForPreset(id: string | null | undefined): PrinterKind {
  return PRINTER_PRESETS.find((entry) => entry.id === id)?.kind ?? "filament";
}

export function brandsForKind(kind: PrinterKind) {
  const brands: string[] = [];
  for (const entry of PRINTER_PRESETS) {
    if (entry.id === "custom" || entry.kind !== kind) continue;
    if (!brands.includes(entry.brand)) brands.push(entry.brand);
  }
  brands.push(CUSTOM_BRAND);
  return brands;
}

export function printersForBrand(brand: string, kind?: PrinterKind) {
  const matches = PRINTER_PRESETS.filter((entry) => {
    if (entry.brand !== brand) return false;
    if (!kind || entry.id === "custom") return true;
    return entry.kind === kind;
  });
  return matches.length > 0 ? matches : PRINTER_PRESETS.filter((entry) => entry.brand === CUSTOM_BRAND);
}

export const DEFAULT_PRINTER_ID = "ender-3";
export const DEFAULT_RESIN_PRINTER_ID = "formlabs-form-4";
export const DEFAULT_OVERHANG_ANGLE = 45;
export { DEFAULT_NOZZLE_MM };

export function defaultPrinterForKind(kind: PrinterKind, brand?: string) {
  if (brand) {
    const match = printersForBrand(brand, kind).find((entry) => entry.id !== "custom");
    if (match) return match;
  }
  const fallbackId = kind === "resin" ? DEFAULT_RESIN_PRINTER_ID : DEFAULT_PRINTER_ID;
  return PRINTER_PRESETS.find((entry) => entry.id === fallbackId)
    ?? PRINTER_PRESETS.find((entry) => entry.kind === kind && entry.id !== "custom")!;
}

export type PrinterBed = {
  preset: string;
  label: string;
  width: number;
  depth: number;
  height: number;
  kind: PrinterKind;
  /** Degrees from vertical. A face that leans out more than this needs support. */
  overhangAngle: number;
  nozzleMm: number;
  showBed: boolean;
  showStripes: boolean;
  showThinWalls: boolean;
  showSmallHoles: boolean;
  showTrappedResin: boolean;
};

export type BedFit = {
  pastFootprint: boolean;
  pastHeight: boolean;
  message: string | null;
};

const MIN_BED = 40;
const MAX_BED = 2000;

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizePrinterBed(input: {
  printerPreset?: unknown;
  printerKind?: unknown;
  printerWidth?: unknown;
  printerDepth?: unknown;
  printerHeight?: unknown;
  overhangAngle?: unknown;
  nozzleMm?: unknown;
  showPrinterBed?: unknown;
  showOverhangStripes?: unknown;
  showThinWalls?: unknown;
  showSmallHoles?: unknown;
  showTrappedResin?: unknown;
} | null | undefined): PrinterBed {
  const requested = typeof input?.printerPreset === "string" ? input.printerPreset : DEFAULT_PRINTER_ID;
  const preset = PRINTER_PRESETS.find((entry) => entry.id === requested)
    ?? PRINTER_PRESETS.find((entry) => entry.id === DEFAULT_PRINTER_ID)!;
  const custom = preset.id === "custom";
  const kind: PrinterKind = custom
    ? (input?.printerKind === "resin" ? "resin" : "filament")
    : preset.kind;
  return {
    preset: preset.id,
    label: preset.brand === "Custom" ? preset.label : `${preset.brand} ${preset.label}`,
    width: custom ? clamp(finiteNumber(input?.printerWidth, preset.width), MIN_BED, MAX_BED) : preset.width,
    depth: custom ? clamp(finiteNumber(input?.printerDepth, preset.depth), MIN_BED, MAX_BED) : preset.depth,
    height: custom ? clamp(finiteNumber(input?.printerHeight, preset.height), 20, MAX_BED) : preset.height,
    kind,
    overhangAngle: clamp(finiteNumber(input?.overhangAngle, DEFAULT_OVERHANG_ANGLE), 0, 85),
    nozzleMm: normalizeNozzleMm(input?.nozzleMm, DEFAULT_NOZZLE_MM),
    showBed: typeof input?.showPrinterBed === "boolean" ? input.showPrinterBed : true,
    showStripes: typeof input?.showOverhangStripes === "boolean" ? input.showOverhangStripes : false,
    showThinWalls: typeof input?.showThinWalls === "boolean" ? input.showThinWalls : false,
    showSmallHoles: typeof input?.showSmallHoles === "boolean" ? input.showSmallHoles : false,
    showTrappedResin: typeof input?.showTrappedResin === "boolean" ? input.showTrappedResin : false,
  };
}

/**
 * A face leans out past `angleDeg` when its outward normal points down
 * steeper than that angle from vertical. The bottom face sitting on the bed
 * is not an overhang.
 */
export function triangleNeedsSupport(
  y0: number,
  y1: number,
  y2: number,
  normalY: number,
  angleDeg: number,
) {
  const limit = Math.sin((clamp(angleDeg, 0, 85) * Math.PI) / 180);
  if (!(normalY < -limit - 1e-4)) return false;
  const midY = (y0 + y1 + y2) / 3;
  if (midY <= 0.6 && normalY < -0.85) return false;
  return true;
}

function quantizedVertexKey(x: number, y: number, z: number, quantize: number) {
  return `${Math.round(x * quantize)},${Math.round(y * quantize)},${Math.round(z * quantize)}`;
}

/**
 * Edges used by only one overhang triangle — the outline of the warning region.
 * `positions` is a triangle soup (9 floats per triangle). Pass matching
 * `normals` and `lift` to push the outline out with the fill, using the
 * owning triangle's normal so interior edges still cancel.
 */
export function appendOverhangBoundaryLines(
  positions: number[],
  lines: number[],
  quantize = 1000,
  normals?: number[],
  lift = 0,
) {
  const edges = new Map<string, { count: number; ax: number; ay: number; az: number; bx: number; by: number; bz: number; nx: number; ny: number; nz: number }>();
  for (let offset = 0; offset + 8 < positions.length; offset += 9) {
    const nx = normals?.[offset] ?? 0;
    const ny = normals?.[offset + 1] ?? 0;
    const nz = normals?.[offset + 2] ?? 0;
    const corners = [offset, offset + 3, offset + 6];
    for (let index = 0; index < 3; index += 1) {
      const a = corners[index];
      const b = corners[(index + 1) % 3];
      const ax = positions[a];
      const ay = positions[a + 1];
      const az = positions[a + 2];
      const bx = positions[b];
      const by = positions[b + 1];
      const bz = positions[b + 2];
      const ka = quantizedVertexKey(ax, ay, az, quantize);
      const kb = quantizedVertexKey(bx, by, bz, quantize);
      if (ka === kb) continue;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const existing = edges.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        edges.set(key, { count: 1, ax, ay, az, bx, by, bz, nx, ny, nz });
      }
    }
  }
  for (const edge of edges.values()) {
    if (edge.count !== 1) continue;
    const dx = edge.nx * lift;
    const dy = edge.ny * lift;
    const dz = edge.nz * lift;
    lines.push(edge.ax + dx, edge.ay + dy, edge.az + dz, edge.bx + dx, edge.by + dy, edge.bz + dz);
  }
}

type Corner = [number, number, number];

function rotateXyz(point: Corner, rx: number, ry: number, rz: number): Corner {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const [x, y, z] = point;
  return [
    cy * cz * x + -cy * sz * y + sy * z,
    (sx * sy * cz + cx * sz) * x + (-sx * sy * sz + cx * cz) * y + -sx * cy * z,
    (-cx * sy * cz + sx * sz) * x + (cx * sy * sz + sx * cz) * y + cx * cy * z,
  ];
}

function shapeCorners(shape: WorkplaneShape): Corner[] {
  const halfW = Math.max(0, shape.width) / 2;
  const halfD = Math.max(0, shape.depth) / 2;
  const halfH = Math.max(0, shape.height) / 2;
  const rx = ((shape.rotationX ?? 0) * Math.PI) / 180;
  const ry = ((shape.rotation ?? 0) * Math.PI) / 180;
  const rz = ((shape.rotationZ ?? 0) * Math.PI) / 180;
  const center: Corner = [shape.x, (shape.elevation ?? 0) + shape.height / 2, shape.z];
  const local: Corner[] = [
    [-halfW, -halfH, -halfD],
    [halfW, -halfH, -halfD],
    [-halfW, halfH, -halfD],
    [halfW, halfH, -halfD],
    [-halfW, -halfH, halfD],
    [halfW, -halfH, halfD],
    [-halfW, halfH, halfD],
    [halfW, halfH, halfD],
  ];
  return local.map((corner) => {
    const turned = rotateXyz(corner, rx, ry, rz);
    return [turned[0] + center[0], turned[1] + center[1], turned[2] + center[2]];
  });
}

export function bedFitForShapes(shapes: WorkplaneShape[], bed: PrinterBed): BedFit {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let counted = 0;
  for (const shape of shapes) {
    if (shape.hidden || shape.hole) continue;
    counted += 1;
    for (const [x, y, z] of shapeCorners(shape)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  if (counted === 0) {
    return { pastFootprint: false, pastHeight: false, message: null };
  }
  const halfW = bed.width / 2;
  const halfD = bed.depth / 2;
  const pastFootprint = minX < -halfW - 0.2 || maxX > halfW + 0.2 || minZ < -halfD - 0.2 || maxZ > halfD + 0.2;
  const pastHeight = maxY > bed.height + 0.2;
  const footprint = `Past the ${Math.round(bed.width)} × ${Math.round(bed.depth)} mm bed.`;
  const height = `Taller than ${Math.round(bed.height)} mm.`;
  const message = pastFootprint && pastHeight
    ? `${footprint.replace(/\.$/, "")}, and taller than ${Math.round(bed.height)} mm.`
    : pastFootprint
      ? footprint
      : pastHeight
        ? height
        : null;
  return { pastFootprint, pastHeight, message };
}
