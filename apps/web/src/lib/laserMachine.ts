/**
 * Laser cutters and engravers: the machines, the sheets they cut, and which kind
 * of design a project is. A laser design is flat parts cut from one sheet; a
 * print design is everything else Mintr makes.
 */

/** What this person makes with. It follows the person, not the design. */
export type MachineChoice = "printer" | "laser" | "both";
/** A design is made for a 3D printer or cut on a laser. */
export type DesignKind = "print" | "laser";
/** Diode and CO2 lasers cut wood and acrylic; infrared (fiber) lasers mark metal and engrave finely; UV marks glass and plastic cold. */
export type LaserType = "diode" | "co2" | "infrared" | "uv";
/** How a cut file marks what to cut, score and engrave, for the software that runs the laser. */
export type CutFileStyle = "lightburn" | "xtool" | "glowforge";

export type LaserPreset = {
  id: string;
  brand: string;
  label: string;
  /** Work area in millimetres, left to right and front to back. */
  width: number;
  depth: number;
  type: LaserType;
  /** The software most owners use with it. */
  style: CutFileStyle;
};

function laser(id: string, brand: string, label: string, width: number, depth: number, type: LaserType, style: CutFileStyle): LaserPreset {
  return { id, brand, label, width, depth, type, style };
}

/**
 * Work areas from each maker's published spec. Every model is listed by its own name,
 * even where its bed matches another's, so people find the one on their machine.
 * A machine with a diode and another laser is listed as diode, the one that cuts.
 */
export const LASER_PRESETS: readonly LaserPreset[] = [
  laser("atomstack-a10-pro", "Atomstack", "A10 Pro", 410, 400, "diode", "lightburn"),
  laser("creality-falcon2", "Creality", "Falcon2", 400, 415, "diode", "lightburn"),
  laser("glowforge-basic", "Glowforge", "Basic / Plus / Pro", 495, 279, "co2", "glowforge"),
  laser("glowforge-aura", "Glowforge", "Aura", 508, 305, "diode", "glowforge"),
  laser("omtech-k40", "OMTech", "K40", 300, 200, "co2", "lightburn"),
  laser("ortur-lm3", "Ortur", "Laser Master 3", 400, 380, "diode", "lightburn"),
  laser("sculpfun-s30", "Sculpfun", "S30", 410, 400, "diode", "lightburn"),
  laser("xtool-d1-pro", "xTool", "D1 Pro", 430, 390, "diode", "xtool"),
  laser("xtool-f1", "xTool", "F1", 115, 115, "diode", "xtool"),
  laser("xtool-f1-ultra", "xTool", "F1 Ultra", 220, 220, "diode", "xtool"),
  laser("xtool-f2", "xTool", "F2", 115, 115, "diode", "xtool"),
  // Each F2 Ultra is listed again with its conveyor, which feeds a longer sheet through front to back.
  laser("xtool-f2-ultra", "xTool", "F2 Ultra (MOPA + diode)", 220, 220, "diode", "xtool"),
  laser("xtool-f2-ultra-conveyor", "xTool", "F2 Ultra (MOPA + diode) with conveyor", 220, 500, "diode", "xtool"),
  laser("xtool-f2-ultra-single", "xTool", "F2 Ultra (MOPA only)", 220, 220, "infrared", "xtool"),
  laser("xtool-f2-ultra-single-conveyor", "xTool", "F2 Ultra (MOPA only) with conveyor", 220, 500, "infrared", "xtool"),
  laser("xtool-f2-ultra-uv", "xTool", "F2 Ultra UV", 200, 200, "uv", "xtool"),
  laser("xtool-f2-ultra-uv-conveyor", "xTool", "F2 Ultra UV with conveyor", 200, 500, "uv", "xtool"),
  laser("xtool-m1", "xTool", "M1", 385, 300, "diode", "xtool"),
  laser("xtool-m1-ultra", "xTool", "M1 Ultra", 300, 300, "diode", "xtool"),
  laser("xtool-p2", "xTool", "P2 / P2S", 600, 308, "co2", "xtool"),
  laser("xtool-s1", "xTool", "S1", 498, 319, "diode", "xtool"),
  laser("custom", "Custom", "Custom size", 400, 400, "diode", "lightburn"),
];

export const DEFAULT_LASER_ID = "xtool-s1";

export const LASER_TYPE_LABEL: Record<LaserType, string> = {
  diode: "Diode",
  co2: "CO2",
  infrared: "Infrared (fiber)",
  uv: "UV",
};

/** Typical width the beam burns away. People measure their own and type it in. */
export const DEFAULT_KERF_MM: Record<LaserType, number> = {
  diode: 0.08,
  co2: 0.15,
  infrared: 0.05,
  uv: 0.03,
};

export const MIN_KERF_MM = 0;
export const MAX_KERF_MM = 1;

export const CUT_FILE_STYLES: readonly { id: CutFileStyle; label: string; description: string }[] = [
  { id: "lightburn", label: "LightBurn", description: "Lines coloured by job: red cuts, blue scores, black engraves. LightBurn puts each colour on its own layer." },
  { id: "xtool", label: "xTool Studio", description: "Lines grouped by job, named Cut, Score and Engrave, so each group gets its setting in a click." },
  { id: "glowforge", label: "Glowforge", description: "Lines coloured by job. The Glowforge app makes one step for each colour." },
];

export type LaserMaterial = { id: string; label: string; thickness: number };

export const LASER_MATERIALS: readonly LaserMaterial[] = [
  { id: "plywood-3", label: "Plywood", thickness: 3 },
  { id: "plywood-6", label: "Plywood", thickness: 6 },
  { id: "mdf-3", label: "MDF", thickness: 3 },
  { id: "acrylic-3", label: "Acrylic", thickness: 3 },
  { id: "acrylic-5", label: "Acrylic", thickness: 5 },
  { id: "cardboard-2", label: "Cardboard", thickness: 2 },
  { id: "leather-2", label: "Leather", thickness: 2 },
  { id: "card-0.3", label: "Card stock", thickness: 0.3 },
  { id: "custom", label: "Other", thickness: 3 },
];

export const DEFAULT_MATERIAL_ID = "plywood-3";
export const MIN_SHEET_MM = 0.1;
export const MAX_SHEET_MM = 30;

/** "3 mm plywood", or "4 mm sheet" for a material with no name. */
export function materialLabel(material: Pick<LaserMaterial, "id" | "label">, thickness: number) {
  const size = `${Number(thickness.toFixed(2))} mm`;
  return material.id === "custom" ? `${size} sheet` : `${size} ${material.label.toLowerCase()}`;
}

export type LaserSettings = {
  designKind: DesignKind;
  laserPreset: string;
  laserType: LaserType;
  laserWidth: number;
  laserDepth: number;
  kerfMm: number;
  materialPreset: string;
  materialThickness: number;
  cutFileStyle: CutFileStyle;
  showLaserBed: boolean;
};

export const LASER_SETTING_KEYS = [
  "designKind",
  "laserPreset",
  "laserType",
  "laserWidth",
  "laserDepth",
  "kerfMm",
  "materialPreset",
  "materialThickness",
  "cutFileStyle",
  "showLaserBed",
] as const satisfies readonly (keyof LaserSettings)[];

export const DEFAULT_LASER_SETTINGS: LaserSettings = {
  designKind: "print",
  laserPreset: DEFAULT_LASER_ID,
  laserType: "diode",
  laserWidth: 498,
  laserDepth: 319,
  kerfMm: DEFAULT_KERF_MM.diode,
  materialPreset: DEFAULT_MATERIAL_ID,
  materialThickness: 3,
  cutFileStyle: "xtool",
  showLaserBed: true,
};

const MIN_LASER_BED = 40;
const MAX_LASER_BED = 3000;

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function laserPresetById(id: unknown): LaserPreset {
  return LASER_PRESETS.find((entry) => entry.id === id) ?? LASER_PRESETS.find((entry) => entry.id === DEFAULT_LASER_ID)!;
}

export function materialById(id: unknown): LaserMaterial {
  return LASER_MATERIALS.find((entry) => entry.id === id) ?? LASER_MATERIALS.find((entry) => entry.id === DEFAULT_MATERIAL_ID)!;
}

export function laserBrands(): string[] {
  const brands = [...new Set(LASER_PRESETS.filter((entry) => entry.id !== "custom").map((entry) => entry.brand))];
  return [...brands, "Custom"];
}

export function lasersForBrand(brand: string) {
  const matches = LASER_PRESETS.filter((entry) => entry.brand === brand);
  return matches.length > 0 ? matches : LASER_PRESETS.filter((entry) => entry.id === "custom");
}

/** A named machine fixes its size and type; Custom keeps what was typed. */
export function normalizeLaserSettings(value: Partial<Record<keyof LaserSettings, unknown>> | null | undefined, fallback: LaserSettings = DEFAULT_LASER_SETTINGS): LaserSettings {
  const input = value ?? {};
  const preset = laserPresetById(input.laserPreset ?? fallback.laserPreset);
  const custom = preset.id === "custom";
  const typeInput = input.laserType ?? fallback.laserType;
  const laserType: LaserType = custom
    ? (typeInput === "co2" || typeInput === "infrared" || typeInput === "uv" ? typeInput : "diode")
    : preset.type;
  const material = materialById(input.materialPreset ?? fallback.materialPreset);
  const styleInput = input.cutFileStyle ?? fallback.cutFileStyle;
  return {
    designKind: input.designKind === "laser" ? "laser" : input.designKind === "print" ? "print" : fallback.designKind,
    laserPreset: preset.id,
    laserType,
    laserWidth: custom ? clamp(finite(input.laserWidth, fallback.laserWidth), MIN_LASER_BED, MAX_LASER_BED) : preset.width,
    laserDepth: custom ? clamp(finite(input.laserDepth, fallback.laserDepth), MIN_LASER_BED, MAX_LASER_BED) : preset.depth,
    kerfMm: Number(clamp(finite(input.kerfMm, fallback.kerfMm), MIN_KERF_MM, MAX_KERF_MM).toFixed(3)),
    materialPreset: material.id,
    // Choosing a material sets its usual thickness; a measured one is kept.
    materialThickness: Number(clamp(finite(input.materialThickness, material.thickness), MIN_SHEET_MM, MAX_SHEET_MM).toFixed(2)),
    cutFileStyle: styleInput === "lightburn" || styleInput === "glowforge" || styleInput === "xtool" ? styleInput : fallback.cutFileStyle,
    showLaserBed: typeof input.showLaserBed === "boolean" ? input.showLaserBed : fallback.showLaserBed,
  };
}

/** Choosing a machine also picks its usual software and a kerf for its kind of laser. */
export function laserPresetPatch(id: string, current: Pick<LaserSettings, "laserType" | "kerfMm">): Partial<LaserSettings> {
  const preset = laserPresetById(id);
  if (preset.id === "custom") return { laserPreset: preset.id };
  const kerfWasTypical = Object.values(DEFAULT_KERF_MM).includes(current.kerfMm);
  return {
    laserPreset: preset.id,
    laserType: preset.type,
    laserWidth: preset.width,
    laserDepth: preset.depth,
    cutFileStyle: preset.style,
    ...(kerfWasTypical ? { kerfMm: DEFAULT_KERF_MM[preset.type] } : {}),
  };
}

/**
 * The workspace a new laser design starts with: the plate grows to hold the laser's
 * whole work area with a margin, and never shrinks below what was set.
 */
export function laserDesignWorkspace<T extends LaserSettings & { width: number; depth: number; sizePreset: string }>(workspace: T): T {
  const fit = (bed: number, current: number) => Math.max(current, Math.ceil((bed + 40) / 50) * 50);
  const width = fit(workspace.laserWidth, workspace.width);
  const depth = fit(workspace.laserDepth, workspace.depth);
  const grew = width !== workspace.width || depth !== workspace.depth;
  return { ...workspace, designKind: "laser", width, depth, sizePreset: grew ? "Custom" : workspace.sizePreset };
}

/** "the xTool S1", or "your laser" for a custom one. */
export function laserMachineName(settings: Pick<LaserSettings, "laserPreset">) {
  const preset = laserPresetById(settings.laserPreset);
  return preset.id === "custom" ? "your laser" : `the ${preset.brand} ${preset.label}`;
}

export function isLaserDesign(settings: Pick<LaserSettings, "designKind"> | null | undefined) {
  return settings?.designKind === "laser";
}

/** The label in the corner of a laser design, e.g. "Laser · 3 mm plywood". */
export function laserDesignLabel(settings: Pick<LaserSettings, "materialPreset" | "materialThickness">) {
  return `Laser · ${materialLabel(materialById(settings.materialPreset), settings.materialThickness)}`;
}

/** Parts that run off the laser's work area, by their footprint. */
export function laserBedMessage(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null,
  settings: Pick<LaserSettings, "laserWidth" | "laserDepth">,
): string | null {
  if (!bounds) return null;
  const halfW = settings.laserWidth / 2;
  const halfD = settings.laserDepth / 2;
  const past = bounds.minX < -halfW - 0.2 || bounds.maxX > halfW + 0.2 || bounds.minZ < -halfD - 0.2 || bounds.maxZ > halfD + 0.2;
  return past ? `Past the ${Math.round(settings.laserWidth)} × ${Math.round(settings.laserDepth)} mm laser bed.` : null;
}

const MACHINES_KEY = "mintr:machines";
export const MACHINES_EVENT = "mintr:machines-changed";

/** Everyone starts with a 3D printer, so Mintr looks as it always has until a laser is chosen. */
export function loadMachineChoice(): MachineChoice {
  try {
    if (typeof window === "undefined") return "printer";
    const stored = window.localStorage.getItem(MACHINES_KEY);
    return stored === "laser" || stored === "both" ? stored : "printer";
  } catch {
    return "printer";
  }
}

export function saveMachineChoice(choice: MachineChoice) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MACHINES_KEY, choice);
  } catch {
    // The choice still applies until Mintr closes.
  }
  window.dispatchEvent(new CustomEvent(MACHINES_EVENT, { detail: choice }));
}

export function machineHasLaser(choice: MachineChoice) {
  return choice !== "printer";
}

export function machineHasPrinter(choice: MachineChoice) {
  return choice !== "laser";
}

/** The kind a new design starts as when nobody is asked. */
export function defaultDesignKind(choice: MachineChoice): DesignKind {
  return choice === "laser" ? "laser" : "print";
}
