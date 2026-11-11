import { catalogSidesForKind, catalogStepsForKind, getActiveDisplayQuality } from "@/lib/displayTessellation";
import { defaultGearSpec, gearFootprint } from "@/lib/gearProfile";
import { isGridfinityKind } from "@/lib/gridfinity";
import { GRIDFINITY_BASEPLATE_COLOR, GRIDFINITY_BIN_COLOR, createGridfinityShape } from "@/lib/gridfinityShape";
import { buildGeneratedShape, defaultGeneratedSize } from "@/lib/generatedShapes";
import { LOFT_COLOR, createLoftShape } from "@/lib/loftShape";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import { createLocalId } from "@/lib/localIds";
import { DEFAULT_TEXT_FONT } from "@/lib/textFonts";
import type { DisplayQuality, ShapeAsset, WorkplaneShape } from "@/types/sketchforge";

/** Solids are plain modeling bodies. Parts are generated pieces such as text, gears, and Gridfinity. */
export type ShapeCatalogGroup = "solid" | "part";

export type ToolbarShapeAsset = ShapeAsset & {
  menuIcon: string;
  group: ShapeCatalogGroup;
  /** Only for 3D printing, so laser designs leave it out of the shapes list. */
  printOnly?: boolean;
  /** Which heading it sits under in the shapes list. */
  section: ShapeCatalogSection;
  /** Other words people type when looking for it in the Find box. */
  keywords?: readonly string[];
};

export type ShapeCatalogSection = "Basic" | "Rounded" | "Flat" | "Text and codes" | "Screws and nuts" | "Gears" | "Gridfinity";

/** Headings in the order they appear in the shapes list. */
export const SHAPE_SECTIONS: readonly ShapeCatalogSection[] = ["Basic", "Rounded", "Flat", "Text and codes", "Screws and nuts", "Gears", "Gridfinity"];

/** A laser cuts flat outlines, so the flat shapes come first in a laser design. */
export const LASER_SHAPE_SECTIONS: readonly ShapeCatalogSection[] = ["Flat", "Basic", "Rounded", "Text and codes", "Screws and nuts", "Gears", "Gridfinity"];

export function shapeSectionsFor(laserDesign: boolean): readonly ShapeCatalogSection[] {
  return laserDesign ? LASER_SHAPE_SECTIONS : SHAPE_SECTIONS;
}

/** The shapes a design can add, in list order. A laser design leaves out the print-only ones. */
export function listedShapeAssets(laserDesign: boolean): ToolbarShapeAsset[] {
  return toolbarShapeAssets.filter((shape) => !(laserDesign && shape.printOnly));
}

/** Shapes whose name, heading or keywords contain every word typed. An empty query matches everything. */
export function searchShapeAssets(assets: readonly ToolbarShapeAsset[], query: string): ToolbarShapeAsset[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...assets];
  return assets.filter((shape) => {
    const haystack = [shape.name, shape.section, ...(shape.keywords ?? [])].join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export const toolbarShapeAssets: ToolbarShapeAsset[] = [
  { id: "box", name: "Box", src: "assets/peakcad/shape-icons/box.png", menuIcon: "assets/peakcad/shape-icons/box.png", kind: "box", color: "#d41721", group: "solid", section: "Basic", keywords: ["cube", "block", "rectangle", "square"] },
  { id: "cylinder", name: "Cylinder", src: "assets/peakcad/shape-icons/cylinder.png", menuIcon: "assets/peakcad/shape-icons/cylinder.png", kind: "cylinder", color: "#d97813", group: "solid", section: "Basic", keywords: ["circle", "round", "disc", "rod"] },
  { id: "sphere", name: "Sphere", src: "assets/peakcad/shape-icons/sphere.png", menuIcon: "assets/peakcad/shape-icons/sphere.png", kind: "sphere", color: "#0098c7", group: "solid", section: "Basic", keywords: ["ball", "round"] },
  { id: "cone", name: "Cone", src: "assets/peakcad/shape-icons/cone.png", menuIcon: "assets/peakcad/shape-icons/cone.png", kind: "cone", color: "#6e2786", group: "solid", section: "Basic", keywords: ["pointed", "taper"] },
  { id: "pyramid", name: "Pyramid", src: "assets/peakcad/shape-icons/pyramid.png", menuIcon: "assets/peakcad/shape-icons/pyramid.png", kind: "pyramid", color: "#f2cf10", group: "solid", section: "Basic", keywords: ["pointed"] },
  { id: "wedge", name: "Wedge", src: "assets/peakcad/shape-icons/wedge.png", menuIcon: "assets/peakcad/shape-icons/wedge.png", kind: "wedge", color: "#33983d", group: "solid", section: "Basic", keywords: ["ramp", "slope", "doorstop"] },
  { id: "roof", name: "Triangle", src: "assets/peakcad/shape-icons/roof.png", menuIcon: "assets/peakcad/shape-icons/roof.png", kind: "roof", color: "#a83c32", group: "solid", section: "Basic", keywords: ["roof", "prism"] },
  { id: "polygon", name: "Polygon", src: "assets/peakcad/shape-icons/polygon.png", menuIcon: "assets/peakcad/shape-icons/polygon.png", kind: "polygon", color: "#3b82f6", group: "solid", section: "Basic", keywords: ["hexagon", "hex", "octagon", "pentagon", "sides"] },
  { id: "tube", name: "Ring", src: "assets/peakcad/shape-icons/tube.png", menuIcon: "assets/peakcad/shape-icons/tube.png", kind: "tube", color: "#ce7013", group: "solid", section: "Rounded", keywords: ["tube", "pipe", "washer", "hollow"] },
  { id: "torus", name: "Torus", src: "assets/peakcad/shape-icons/torus.png", menuIcon: "assets/peakcad/shape-icons/torus.png", kind: "torus", color: "#0098c7", group: "solid", section: "Rounded", keywords: ["donut", "doughnut", "o-ring"] },
  { id: "half-sphere", name: "Half Sphere", src: "assets/peakcad/shape-icons/half-sphere.png", menuIcon: "assets/peakcad/shape-icons/half-sphere.png", kind: "halfSphere", color: "#c9009a", group: "solid", section: "Rounded", keywords: ["dome", "bump"] },
  { id: "round-roof", name: "Round Roof", src: "assets/peakcad/shape-icons/round-roof.png", menuIcon: "assets/peakcad/shape-icons/round-roof.png", kind: "roundRoof", color: "#67c4ce", group: "solid", section: "Rounded", keywords: ["arch", "half cylinder"] },
  { id: "paraboloid", name: "Paraboloid", src: "assets/peakcad/shape-icons/paraboloid.png", menuIcon: "assets/peakcad/shape-icons/paraboloid.png", kind: "mesh", color: "#7a6fd0", group: "solid", section: "Rounded", generated: { form: "paraboloid" }, keywords: ["bullet", "dish", "dome"] },
  { id: "loft", name: "Loft", src: "assets/peakcad/shape-icons/loft.png", menuIcon: "assets/peakcad/shape-icons/loft.png", kind: "loft", color: LOFT_COLOR, group: "solid", section: "Rounded", printOnly: true, keywords: ["vase", "blend", "twist"] },
  { id: "plate", name: "Rounded Plate", src: "assets/peakcad/shape-icons/plate.png", menuIcon: "assets/peakcad/shape-icons/plate.png", kind: "mesh", color: "#c9812f", group: "solid", section: "Flat", generated: { form: "plate", cornerRadius: 5 }, keywords: ["tag", "card", "rounded rectangle", "base"] },
  { id: "slot", name: "Slot", src: "assets/peakcad/shape-icons/slot.png", menuIcon: "assets/peakcad/shape-icons/slot.png", kind: "mesh", color: "#3f8fa8", group: "solid", section: "Flat", generated: { form: "slot" }, keywords: ["pill", "oblong", "stadium"] },
  { id: "star", name: "Star", src: "assets/peakcad/shape-icons/star.png", menuIcon: "assets/peakcad/shape-icons/star.png", kind: "mesh", color: "#e0a81c", group: "solid", section: "Flat", generated: { form: "star", points: 5, inner: 0.45 } },
  { id: "heart", name: "Heart", src: "assets/peakcad/shape-icons/heart.png", menuIcon: "assets/peakcad/shape-icons/heart.png", kind: "mesh", color: "#d43f5e", group: "solid", section: "Flat", generated: { form: "heart" }, keywords: ["love"] },
  { id: "text", name: "Text", src: "assets/peakcad/shape-icons/text.png", menuIcon: "assets/peakcad/shape-icons/text.png", kind: "text", color: "#cf101b", group: "part", section: "Text and codes", keywords: ["letters", "words", "font", "label", "name"] },
  { id: "qr-code", name: "QR Code", src: "assets/peakcad/shape-icons/qr-code.png", menuIcon: "assets/peakcad/shape-icons/qr-code.png", kind: "mesh", color: "#2f3540", group: "part", section: "Text and codes", generated: { form: "qr", text: "https://mintr3d.com" }, keywords: ["link", "scan", "barcode"] },
  { id: "thread", name: "Threads", src: "assets/peakcad/shape-icons/thread.png", menuIcon: "assets/peakcad/shape-icons/thread.png", kind: "thread", color: "#d97813", group: "part", section: "Screws and nuts", printOnly: true, keywords: ["bolt", "screw", "nut", "lid", "cap"] },
  { id: "screw-hole", name: "Threaded Hole", src: "assets/peakcad/shape-icons/screw-hole.png", menuIcon: "assets/peakcad/shape-icons/screw-hole.png", kind: "mesh", color: "#8a8f98", hole: true, group: "part", section: "Screws and nuts", printOnly: true, generated: { form: "screwHole", size: "M3", head: "counterbore", threaded: true }, keywords: ["screw", "bolt", "tapped", "tap", "clearance", "thread", "countersink", "counterbore", "m3"] },
  { id: "nut-pocket", name: "Nut Pocket", src: "assets/peakcad/shape-icons/nut-pocket.png", menuIcon: "assets/peakcad/shape-icons/nut-pocket.png", kind: "mesh", color: "#8a8f98", hole: true, group: "part", section: "Screws and nuts", printOnly: true, generated: { form: "nutPocket", size: "M3" }, keywords: ["hex", "trap", "m3"] },
  { id: "gear", name: "Gear", src: "assets/peakcad/shape-icons/gear.png", menuIcon: "assets/peakcad/shape-icons/gear.png", kind: "gear", color: "#2aa77e", group: "part", section: "Gears", keywords: ["cog", "teeth", "wheel"] },
  { id: "gridfinity-bin", name: "Gridfinity Bin", src: "assets/peakcad/shape-icons/gridfinity-bin.png", menuIcon: "assets/peakcad/shape-icons/gridfinity-bin.png", kind: "gridfinityBin", color: GRIDFINITY_BIN_COLOR, group: "part", section: "Gridfinity", printOnly: true, keywords: ["box", "tray", "drawer", "organiser", "organizer"] },
  { id: "gridfinity-baseplate", name: "Gridfinity Baseplate", src: "assets/peakcad/shape-icons/gridfinity-baseplate.png", menuIcon: "assets/peakcad/shape-icons/gridfinity-baseplate.png", kind: "gridfinityBaseplate", color: GRIDFINITY_BASEPLATE_COLOR, group: "part", section: "Gridfinity", printOnly: true, keywords: ["base", "grid", "drawer", "organiser", "organizer"] },
];

export function sceneShape(shape: Partial<WorkplaneShape> & Pick<WorkplaneShape, "name" | "kind" | "color">): WorkplaneShape {
  const width = shape.width ?? shape.size ?? 20;
  const depth = shape.depth ?? shape.size ?? 20;
  const height = shape.height ?? 20;
  // Spread rather than list fields: this is also the clipboard paste path, and any field
  // missing from a whitelist is silently destroyed on paste. That lost mirroring (turning a
  // left-hand part into a right-hand one), baked B-Rep (downgrading STEP to faceted), edge
  // treatments and CSG history.
  return canonicalizeShape({
    ...shape,
    id: shape.id ?? createLocalId("shape"),
    name: shape.name,
    kind: shape.kind,
    color: shape.color,
    x: shape.x ?? 0,
    z: shape.z ?? 0,
    elevation: shape.elevation ?? 0,
    size: shape.size ?? Math.max(width, depth),
    width,
    depth,
    height,
    rotation: shape.rotation ?? 0,
    rotationX: shape.rotationX ?? 0,
    rotationZ: shape.rotationZ ?? 0,
    locked: shape.locked ?? false,
    hidden: shape.hidden ?? false,
  });
}

export function makeShapeFromAsset(
  asset: ShapeAsset,
  point?: { x: number; z: number; elevation?: number },
  displayQuality: DisplayQuality = getActiveDisplayQuality(),
  /** In a laser design, a new part is as thick as the sheet it is cut from. */
  sheetThickness?: number,
): WorkplaneShape {
  if (asset.generated) {
    const size = defaultGeneratedSize(asset.generated);
    const thin = sheetThickness && sheetThickness > 0 ? sheetThickness : null;
    const made = buildGeneratedShape(asset.generated, thin ? { ...size, height: thin } : size, {
      id: createLocalId(asset.id),
      name: asset.name,
      color: asset.color,
      hole: asset.hole,
      x: point?.x ?? 0,
      z: point?.z ?? 0,
      elevation: point?.elevation ?? 0,
      // A QR code on a sheet is burned onto its surface, not cut out square by square.
      laserJob: thin && asset.generated.form === "qr" ? "engrave" : undefined,
    });
    if (made) return made;
  }
  if (asset.kind === "loft") {
    return createLoftShape(point, { id: createLocalId(asset.id), color: asset.color });
  }
  if (isGridfinityKind(asset.kind)) {
    return createGridfinityShape(asset.kind, point, { id: createLocalId(asset.id), color: asset.color });
  }
  const gear = asset.kind === "gear" ? defaultGearSpec() : null;
  const gearSize = gear ? gearFootprint(gear) : null;
  const roundProfile = asset.kind === "sphere" || asset.kind === "torus" || asset.kind === "ring" || asset.kind === "halfSphere" || asset.kind === "icosahedron";
  const flatProfile = asset.kind === "torus" || asset.kind === "ring" || asset.kind === "text";
  const size = gearSize ? gearSize.width : roundProfile ? 22 : 20;
  const height = sheetThickness && sheetThickness > 0
    ? sheetThickness
    : asset.kind === "gear" ? 8 : asset.kind === "text" ? 10 : asset.kind === "roundRoof" ? 10 : asset.kind === "halfSphere" ? 11 : flatProfile ? 5 : 20;
  const width = asset.kind === "text" ? 86 : gearSize ? gearSize.width : size;
  const depth = asset.kind === "text" ? 28 : gearSize ? gearSize.depth : size;
  const steps = catalogStepsForKind(asset.kind, displayQuality);
  const sides = catalogSidesForKind(asset.kind, displayQuality);

  return {
    id: createLocalId(asset.id),
    name: asset.name,
    kind: asset.kind,
    color: asset.color,
    hole: asset.hole,
    x: point?.x ?? 0,
    z: point?.z ?? 0,
    elevation: point?.elevation ?? 0,
    size,
    width,
    depth,
    height,
    rotation: 0,
    rotationX: 0,
    rotationZ: 0,
    radius: asset.kind === "torus" ? height / 2 : asset.kind === "box" ? 0 : undefined,
    text: asset.kind === "text" ? "TEXT" : undefined,
    font: asset.kind === "text" ? DEFAULT_TEXT_FONT : undefined,
    steps,
    sides,
    bevel: asset.kind === "cylinder" ? 0 : asset.kind === "tube" || asset.kind === "ring" ? 4 : undefined,
    segments: asset.kind === "cylinder" ? 1 : undefined,
    topRadius: asset.kind === "cone" ? 0 : undefined,
    baseRadius: asset.kind === "cone" ? size / 2 : undefined,
    gearSpec: gear ?? undefined,
    locked: false,
    hidden: false,
  };
}
