/**
 * A surface texture is a finish on a part, not a new part. The shape keeps its
 * exact CAD body and stores only these settings; the textured triangles are
 * rebuilt from the body whenever it changes.
 */
export type SurfaceTexturePattern =
  | "knurl"
  | "grooves"
  | "honeycomb"
  | "bumps"
  | "fuzzy"
  | "weave"
  | "brick"
  | "diamondPlate"
  | "leather"
  | "wood"
  | "waves"
  | "image";

/**
 * A picture used as a texture: lighter is higher. Kept small (the longest side
 * at most 256 pixels, one byte a pixel), so a project file stays light.
 */
export type SurfaceTextureImage = {
  name: string;
  width: number;
  height: number;
  /** The grey of each pixel, row by row from the top, as base64. */
  data: string;
  /** Darker is higher instead. */
  invert: boolean;
  /** Set when the picture was drawn from typed text, so the words can be changed later. */
  text?: SurfaceTextureText;
};

/** Words drawn as a picture, in one of Mintr's text fonts. */
export type SurfaceTextureText = { value: string; font: string };

/** A picture from a file is at most this many pixels on its longest side. */
export const MAX_TEXTURE_PICTURE_SIDE = 256;
/** Text is wide and short, so it may be wider: letters stay sharp along a long word. */
export const MAX_TEXTURE_IMAGE_SIDE = 512;
export const MAX_TEXTURE_TEXT_LENGTH = 40;

/** How the pattern is laid on the part. Auto picks Around for round parts, All round otherwise. */
export type SurfaceTextureWrap = "auto" | "around" | "allRound";

/**
 * Which faces take the texture. Sides (shown as Walls) leaves the top and bottom smooth;
 * Picked (shown as Choose) textures the chosen sides and the faces clicked.
 */
export type SurfaceTextureFaces = "all" | "sides" | "picked";

/** A whole side of the part, in its own frame before it is turned: front faces +z, right +x. */
export type SurfaceTextureSide = "top" | "bottom" | "front" | "back" | "left" | "right";

export const SURFACE_TEXTURE_SIDES: readonly SurfaceTextureSide[] = ["top", "bottom", "front", "back", "left", "right"];

export const SIDE_DIRECTIONS: Record<SurfaceTextureSide, [number, number, number]> = {
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
};

/**
 * A clicked face, kept as a point on it and the way it faces, in the part's own
 * frame before it is turned or mirrored. The point is a share of the part's
 * width, height and depth, so it stays on the same face when the part is resized.
 */
export type SurfaceTextureFacePick = { point: [number, number, number]; normal: [number, number, number] };

/** How fine the triangles get. Finer is sharper and slower to build, with a bigger file. */
export type SurfaceTextureDetail = "normal" | "fine" | "finest";

/** A picture repeats over the part, sits once where it was clicked, or sits centred on each face. */
export type SurfaceTexturePlacement = "tile" | "once" | "each";

/** Out raises the pattern above the surface. In cuts it into the surface, so the part keeps its size. */
export type SurfaceTextureDirection = "out" | "in";

export type SurfaceTexture = {
  pattern: SurfaceTexturePattern;
  /** Size of one repeat of the pattern, in mm. For Fuzzy it is the size of a grain. */
  spacing: number;
  /** How far the texture rises or cuts, in mm. */
  depth: number;
  direction: SurfaceTextureDirection;
  wrap: SurfaceTextureWrap;
  /** Turns Grooves and Knurl, in degrees. */
  angle: number;
  /** Faces that point down within this many degrees stay smooth, so the part sits flat on the bed. 0 textures them. */
  smoothBottomDeg: number;
  /** Sharp edges stay clean: the texture eases out before it reaches them, so it never hangs over an edge. */
  keepEdges: boolean;
  /** The texture eases in over this distance from a smooth face or a clean edge, in mm. */
  fade: number;
  /** Changes the random grain of Fuzzy. */
  seed: number;
  faces: SurfaceTextureFaces;
  /** The faces that take the texture when faces is Picked. */
  picks: SurfaceTextureFacePick[];
  /** The whole sides that take the texture when faces is Picked. */
  sides: SurfaceTextureSide[];
  /** Round holes and bores stay smooth, so screws, pins and bearings still fit. */
  smoothHoles: boolean;
  /** Faces pressed against another part stay smooth, so parts still fit together. */
  smoothContacts: boolean;
  /** The picture, when the pattern is Image. */
  image?: SurfaceTextureImage;
  detail: SurfaceTextureDetail;
  /** For a picture: repeat it, or place it once at `stamp`. */
  placement: SurfaceTexturePlacement;
  /** Where a picture placed once sits: its middle, on the face that was clicked. */
  stamp?: SurfaceTextureFacePick;
};

export const MAX_TEXTURE_FACE_PICKS = 64;

export const SURFACE_TEXTURE_PATTERNS: readonly SurfaceTexturePattern[] = [
  "knurl",
  "grooves",
  "honeycomb",
  "bumps",
  "fuzzy",
  "weave",
  "brick",
  "diamondPlate",
  "leather",
  "wood",
  "waves",
  "image",
];

export const SURFACE_TEXTURE_LABELS: Record<SurfaceTexturePattern, string> = {
  knurl: "Knurl",
  grooves: "Grooves",
  honeycomb: "Honeycomb",
  bumps: "Bumps",
  fuzzy: "Fuzzy skin",
  weave: "Weave",
  brick: "Brick",
  diamondPlate: "Tread plate",
  leather: "Leather",
  wood: "Wood grain",
  waves: "Waves",
  image: "Your picture",
};

export const SURFACE_TEXTURE_LIMITS = {
  spacing: { min: 0.4, max: 50 },
  depth: { min: 0.05, max: 5 },
  angle: { min: -90, max: 90 },
  smoothBottomDeg: { min: 0, max: 89 },
  fade: { min: 0, max: 20 },
} as const;

const PATTERN_DEFAULTS: Record<SurfaceTexturePattern, Pick<SurfaceTexture, "spacing" | "depth" | "angle">> = {
  knurl: { spacing: 2.5, depth: 0.6, angle: 0 },
  grooves: { spacing: 2, depth: 0.5, angle: 0 },
  honeycomb: { spacing: 5, depth: 0.5, angle: 0 },
  bumps: { spacing: 3, depth: 0.6, angle: 0 },
  fuzzy: { spacing: 0.8, depth: 0.3, angle: 0 },
  weave: { spacing: 6, depth: 0.5, angle: 0 },
  brick: { spacing: 12, depth: 0.5, angle: 0 },
  diamondPlate: { spacing: 8, depth: 0.6, angle: 0 },
  leather: { spacing: 8, depth: 0.4, angle: 0 },
  wood: { spacing: 6, depth: 0.4, angle: 0 },
  waves: { spacing: 4, depth: 0.5, angle: 0 },
  image: { spacing: 20, depth: 0.6, angle: 0 },
};

export function defaultSurfaceTexture(pattern: SurfaceTexturePattern = "knurl"): SurfaceTexture {
  return {
    pattern,
    ...PATTERN_DEFAULTS[pattern],
    direction: "out",
    wrap: "auto",
    smoothBottomDeg: 30,
    keepEdges: true,
    fade: 1,
    seed: 1,
    faces: "all",
    picks: [],
    sides: [],
    smoothHoles: true,
    smoothContacts: true,
    detail: "normal",
    placement: "tile",
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finiteOr = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

const finiteVec = (value: unknown): [number, number, number] | null =>
  Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n))
    ? [value[0], value[1], value[2]]
    : null;

function normalizePicks(input: unknown): SurfaceTextureFacePick[] {
  if (!Array.isArray(input)) return [];
  const picks: SurfaceTextureFacePick[] = [];
  for (const entry of input) {
    const point = finiteVec((entry as SurfaceTextureFacePick | null)?.point);
    const normal = finiteVec((entry as SurfaceTextureFacePick | null)?.normal);
    if (!point || !normal || Math.hypot(...normal) < 1e-9) continue;
    picks.push({ point, normal });
    if (picks.length >= MAX_TEXTURE_FACE_PICKS) break;
  }
  return picks;
}

function normalizeImage(input: unknown): SurfaceTextureImage | undefined {
  const image = input as Partial<SurfaceTextureImage> | null | undefined;
  if (!image || typeof image.data !== "string") return undefined;
  const width = Math.round(finiteOr(image.width, 0));
  const height = Math.round(finiteOr(image.height, 0));
  if (width < 1 || height < 1 || width > MAX_TEXTURE_IMAGE_SIDE || height > MAX_TEXTURE_IMAGE_SIDE) return undefined;
  // Base64 of width × height bytes.
  if (image.data.length !== Math.ceil((width * height) / 3) * 4) return undefined;
  return {
    name: typeof image.name === "string" ? image.name.slice(0, 120) : "Picture",
    width,
    height,
    data: image.data,
    invert: image.invert === true,
    ...(image.text && typeof image.text.value === "string" && typeof image.text.font === "string"
      ? { text: { value: image.text.value.slice(0, MAX_TEXTURE_TEXT_LENGTH), font: image.text.font.slice(0, 40) } }
      : {}),
  };
}

/** Settings from a file or a panel, made safe to build from. */
export function normalizeSurfaceTexture(input: Partial<SurfaceTexture> | null | undefined): SurfaceTexture {
  const image = normalizeImage(input?.image);
  let pattern = SURFACE_TEXTURE_PATTERNS.includes(input?.pattern as SurfaceTexturePattern)
    ? (input!.pattern as SurfaceTexturePattern)
    : "knurl";
  // A picture texture without its picture cannot be built.
  if (pattern === "image" && !image) pattern = "knurl";
  const base = defaultSurfaceTexture(pattern);
  const { spacing, depth, angle, smoothBottomDeg, fade } = SURFACE_TEXTURE_LIMITS;
  return {
    pattern,
    spacing: clamp(finiteOr(input?.spacing, base.spacing), spacing.min, spacing.max),
    depth: clamp(finiteOr(input?.depth, base.depth), depth.min, depth.max),
    direction: input?.direction === "in" ? "in" : "out",
    wrap: input?.wrap === "around" || input?.wrap === "allRound" ? input.wrap : "auto",
    angle: clamp(finiteOr(input?.angle, base.angle), angle.min, angle.max),
    smoothBottomDeg: clamp(finiteOr(input?.smoothBottomDeg, base.smoothBottomDeg), smoothBottomDeg.min, smoothBottomDeg.max),
    // Always on: a texture that runs over a sharp edge prints ragged and hangs over it.
    keepEdges: true,
    fade: clamp(finiteOr(input?.fade, base.fade), fade.min, fade.max),
    seed: Math.round(finiteOr(input?.seed, base.seed)),
    faces: input?.faces === "sides" || input?.faces === "picked" ? input.faces : "all",
    picks: normalizePicks(input?.picks),
    sides: SURFACE_TEXTURE_SIDES.filter((side) => Array.isArray(input?.sides) && input.sides.includes(side)),
    smoothHoles: input?.smoothHoles !== false,
    smoothContacts: input?.smoothContacts !== false,
    ...(pattern === "image" && image ? { image } : {}),
    detail: input?.detail === "fine" || input?.detail === "finest" ? input.detail : "normal",
    placement: pattern === "image" && (input?.placement === "once" || input?.placement === "each") ? input.placement : "tile",
    ...(pattern === "image" && input?.placement === "once" && normalizePicks([input?.stamp])[0]
      ? { stamp: normalizePicks([input?.stamp])[0] }
      : {}),
  };
}
