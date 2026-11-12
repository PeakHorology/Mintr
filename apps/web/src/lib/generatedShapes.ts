import * as THREE from "three";
import { createLocalId } from "@/lib/localIds";
import { encodeQr, qrSolid } from "@/lib/qrCode";
import {
  regularPolygonSketchGeometry,
  rectangleSketchGeometry,
  roundedRectangleSketchGeometry,
  slotSketchGeometry,
  starSketchGeometry,
} from "@/lib/sketchDrawShapes";
import { bakeSketchExtrusionGeometry, importedMeshPayloadFromGeometry, shapeFromSketchProfile } from "@/lib/sketchProfileShape";
import { findThreadSize } from "@/lib/metricThreads";
import { createThreadShape } from "@/lib/threadShape";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { GeneratedSpec, ScrewHead, ScrewSize, SketchProfile, SketchPoint, WorkplaneShape } from "@/types/sketchforge";

/**
 * Shapes built from a few settings: flat outlines pushed up as sketched parts, shapes turned
 * around their upright axis, and QR codes. A sketched part already has an exact solid on both the
 * desktop and browser engines, so these need no engine work of their own, and its sketch can be
 * opened and changed by hand (after which it is an ordinary sketched part).
 */

export type GeneratedSize = { width: number; depth: number; height: number };

/**
 * Medium clearance hole, socket head, countersunk head, and nut across flats and thickness, in mm.
 * ISO 273, 4762, 10642, 4032. Below M1.6 the heads and nuts come from DIN 912 and DIN 934, and
 * countersunk heads past M20 from DIN 7991 (M30 and M36 follow its proportions, as few are made).
 */
const SCREWS: Record<ScrewSize, { clearance: number; head: number; headHeight: number; countersink: number; nutFlats: number; nutHeight: number }> = {
  M1: { clearance: 1.2, head: 2, headHeight: 1, countersink: 2.2, nutFlats: 2.5, nutHeight: 0.8 },
  "M1.2": { clearance: 1.4, head: 2.3, headHeight: 1.2, countersink: 2.7, nutFlats: 3, nutHeight: 1 },
  "M1.6": { clearance: 1.8, head: 3, headHeight: 1.6, countersink: 3.6, nutFlats: 3.2, nutHeight: 1.3 },
  M2: { clearance: 2.4, head: 3.8, headHeight: 2, countersink: 4.5, nutFlats: 4, nutHeight: 1.6 },
  "M2.5": { clearance: 2.9, head: 4.5, headHeight: 2.5, countersink: 5.6, nutFlats: 5, nutHeight: 2 },
  M3: { clearance: 3.4, head: 5.5, headHeight: 3, countersink: 6.7, nutFlats: 5.5, nutHeight: 2.4 },
  M4: { clearance: 4.5, head: 7, headHeight: 4, countersink: 9, nutFlats: 7, nutHeight: 3.2 },
  M5: { clearance: 5.5, head: 8.5, headHeight: 5, countersink: 11.2, nutFlats: 8, nutHeight: 4.7 },
  M6: { clearance: 6.6, head: 10, headHeight: 6, countersink: 13.4, nutFlats: 10, nutHeight: 5.2 },
  M8: { clearance: 9, head: 13, headHeight: 8, countersink: 17.9, nutFlats: 13, nutHeight: 6.8 },
  M10: { clearance: 11, head: 16, headHeight: 10, countersink: 22.4, nutFlats: 16, nutHeight: 8.4 },
  M12: { clearance: 13.5, head: 18, headHeight: 12, countersink: 26.9, nutFlats: 18, nutHeight: 10.8 },
  M14: { clearance: 15.5, head: 21, headHeight: 14, countersink: 30.8, nutFlats: 21, nutHeight: 12.8 },
  M16: { clearance: 17.5, head: 24, headHeight: 16, countersink: 33.6, nutFlats: 24, nutHeight: 14.8 },
  M18: { clearance: 20, head: 27, headHeight: 18, countersink: 36, nutFlats: 27, nutHeight: 15.8 },
  M20: { clearance: 22, head: 30, headHeight: 20, countersink: 40.3, nutFlats: 30, nutHeight: 18 },
  M24: { clearance: 26, head: 36, headHeight: 24, countersink: 48, nutFlats: 36, nutHeight: 21.5 },
  M30: { clearance: 33, head: 45, headHeight: 30, countersink: 60, nutFlats: 46, nutHeight: 25.6 },
  M36: { clearance: 39, head: 54, headHeight: 36, countersink: 72, nutFlats: 55, nutHeight: 31 },
};
/**
 * Inch screws, in inches, by nominal size: normal-fit clearance hole (ASME B18.2.8), socket head
 * diameter and height (ASME B18.3), 82° flat socket head diameter (ASME B18.3), and hex nut across
 * flats and thickness (machine screw nuts below 1/4, ASME B18.2.2 above). UNC and UNF share them.
 */
const INCH_SCREWS: Record<string, [clearance: number, head: number, headHeight: number, countersink: number, nutFlats: number, nutHeight: number]> = {
  "#4": [0.1285, 0.183, 0.112, 0.255, 0.25, 0.094],
  "#6": [0.1495, 0.226, 0.138, 0.307, 0.3125, 0.109],
  "#8": [0.177, 0.27, 0.164, 0.359, 0.344, 0.125],
  "#10": [0.201, 0.312, 0.19, 0.411, 0.375, 0.125],
  "1/4": [0.266, 0.375, 0.25, 0.531, 0.4375, 0.219],
  "5/16": [0.332, 0.469, 0.312, 0.656, 0.5, 0.266],
  "3/8": [0.397, 0.562, 0.375, 0.789, 0.5625, 0.328],
  "1/2": [0.531, 0.75, 0.5, 1.045, 0.75, 0.438],
  "5/8": [0.656, 0.938, 0.625, 1.311, 0.9375, 0.547],
  "3/4": [0.781, 1.125, 0.75, 1.555, 1.125, 0.641],
  "1": [1.0625, 1.5, 1, 2.073, 1.5, 0.859],
};

export type ScrewDimensions = {
  clearance: number;
  head: number;
  headHeight: number;
  countersink: number;
  /** The countersink's included angle: 90° for metric heads, 82° for inch ones. */
  countersinkAngle: number;
  nutFlats: number;
  nutHeight: number;
  /** True when no standard covers the size and the numbers follow metric proportions. */
  proportional: boolean;
};

/** The screw a size stands for. Below this a custom screw is too small to make sense of. */
const MIN_CUSTOM_DIAMETER = 0.8;

/**
 * The clearance hole, heads and nut for any size Threads offers. Metric and inch screws come from
 * their standards. Pipe threads and custom sizes have no screw standard, so they follow the
 * proportions of metric screws from the thread diameter.
 */
export function screwDimensions(spec: { size: string; diameter?: number }): ScrewDimensions {
  const metric = Object.hasOwn(SCREWS, spec.size) ? SCREWS[spec.size as ScrewSize] : undefined;
  if (metric) return { ...metric, countersinkAngle: 90, proportional: false };
  const listed = findThreadSize(spec.size);
  if (listed && (listed.series === "unc" || listed.series === "unf")) {
    const inch = INCH_SCREWS[listed.id.split("-")[0]];
    if (inch) {
      const [clearance, head, headHeight, countersink, nutFlats, nutHeight] = inch.map((value) => value * 25.4);
      return { clearance, head, headHeight, countersink, countersinkAngle: 82, nutFlats, nutHeight, proportional: false };
    }
  }
  const raw = listed?.majorDiameter ?? spec.diameter ?? 3;
  const d = Number.isFinite(raw) ? Math.max(MIN_CUSTOM_DIAMETER, raw) : 3;
  return {
    // ISO 273 medium fit is about a tenth over the screw; small screws need at least 0.2 mm.
    clearance: Math.max(d * 1.1, d + 0.2),
    head: d * 1.6,
    headHeight: d,
    countersink: d * 2.2,
    countersinkAngle: 90,
    nutFlats: d * 1.6,
    nutHeight: d * 0.8,
    proportional: true,
  };
}

/** How deep a countersink for this screw cuts below the top. */
function countersinkDepth(screw: ScrewDimensions) {
  const flare = (screw.countersink + POCKET_CLEARANCE - screw.clearance) / 2;
  return flare / Math.tan((screw.countersinkAngle * Math.PI) / 360);
}

/** Extra room so a printed pocket takes the head or nut, whose walls print slightly tight. */
const POCKET_CLEARANCE = 0.3;

export const MIN_QR_MM = 5;

export function screwHoleDepthMin(spec: { size: string; head: ScrewHead; threaded?: boolean; diameter?: number }) {
  // A tapped hole has no head pocket; it needs room for a couple of turns of thread.
  if (spec.threaded) return 1;
  const screw = screwDimensions(spec);
  if (spec.head === "counterbore") return screw.headHeight + 0.5;
  if (spec.head === "countersink") return countersinkDepth(screw) + 0.5;
  return 0.5;
}

/** A nut pocket's own default depth: the nut, and a little room. */
export function nutPocketHeight(spec: { size: string; diameter?: number }) {
  return screwDimensions(spec).nutHeight + 0.2;
}

/** The size a shape keeps fixed by its settings, for those whose footprint is not free. */
function fixedFootprint(spec: GeneratedSpec): { width: number; depth: number } | null {
  if (spec.form === "screwHole") {
    // A tapped hole's width comes from the thread itself.
    if (spec.threaded) return null;
    const screw = screwDimensions(spec);
    const widest = spec.head === "counterbore" ? screw.head + POCKET_CLEARANCE : spec.head === "countersink" ? screw.countersink + POCKET_CLEARANCE : screw.clearance;
    return { width: widest, depth: widest };
  }
  if (spec.form === "nutPocket") {
    const flats = screwDimensions(spec).nutFlats + POCKET_CLEARANCE;
    return { width: flats / Math.cos(Math.PI / 6), depth: flats };
  }
  return null;
}

/** Every point an outline passes through, closely enough to measure it: curves bulge past their end points. */
function outlineSamples(geometry: Pick<SketchProfile, "points" | "segments">) {
  const byId = new Map(geometry.points.map((point) => [point.id, point]));
  const samples: { x: number; z: number }[] = [...geometry.points];
  for (const segment of geometry.segments) {
    const from = byId.get(segment.startId);
    const to = byId.get(segment.endId);
    if (!from || !to || (!from.handleOut && !to.handleIn)) continue;
    const c1 = from.handleOut ?? from;
    const c2 = to.handleIn ?? to;
    for (let step = 1; step < 48; step += 1) {
      const t = step / 48;
      const mt = 1 - t;
      samples.push({
        x: mt * mt * mt * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * to.x,
        z: mt * mt * mt * from.z + 3 * mt * mt * t * c1.z + 3 * mt * t * t * c2.z + t * t * t * to.z,
      });
    }
  }
  return samples;
}

/** Stretches an outline to fill a width and depth, centred. */
function fitOutline(geometry: Pick<SketchProfile, "points" | "segments">, width: number, depth: number): SketchProfile {
  const samples = outlineSamples(geometry);
  const xs = samples.map((point) => point.x);
  const zs = samples.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const sx = width / Math.max(1e-6, maxX - minX);
  const sz = depth / Math.max(1e-6, maxZ - minZ);
  const place = (point: { x: number; z: number }) => ({ x: (point.x - (minX + maxX) / 2) * sx, z: (point.z - (minZ + maxZ) / 2) * sz });
  return {
    points: geometry.points.map((point) => ({
      ...point,
      ...place(point),
      handleIn: point.handleIn ? place(point.handleIn) : undefined,
      handleOut: point.handleOut ? place(point.handleOut) : undefined,
    })),
    segments: geometry.segments,
    images: [],
  };
}

/** A heart from four curves, lobes toward the back. A sketch's +z is the workplane's back. */
function heartOutline(): Pick<SketchProfile, "points" | "segments"> {
  const at = (id: string, x: number, z: number, handleIn: [number, number], handleOut: [number, number], mode: SketchPoint["mode"]): SketchPoint => ({
    id,
    x,
    z,
    mode,
    handleIn: { x: handleIn[0], z: handleIn[1] },
    handleOut: { x: handleOut[0], z: handleOut[1] },
  });
  const ids = ["notch", "right", "tip", "left"].map(() => createLocalId("sketch-point"));
  const points = [
    at(ids[0], 0, 0.62, [-0.14, 1.06], [0.14, 1.06], "corner"),
    at(ids[1], 1, 0.46, [1, 1.0], [1, 0.02], "smooth"),
    at(ids[2], 0, -1, [0.44, -0.52], [-0.44, -0.52], "corner"),
    at(ids[3], -1, 0.46, [-1, 0.02], [-1, 1.0], "smooth"),
  ];
  // Each lobe is one curve from the notch over the top to its widest point.
  const segments = ids.map((startId, index) => ({ id: createLocalId("sketch-segment"), startId, endId: ids[(index + 1) % ids.length], kind: "bezier" as const }));
  return { points, segments };
}

function outlineFor(spec: GeneratedSpec, width: number, depth: number): SketchProfile | null {
  const half = { x: width / 2, z: depth / 2 };
  const corners = [{ x: -half.x, z: -half.z }, half] as const;
  switch (spec.form) {
    case "plate": {
      const radius = clampPlateRadius(spec.cornerRadius, width, depth);
      const made = radius > 0.001 ? roundedRectangleSketchGeometry(corners[0], corners[1], radius) : rectangleSketchGeometry(corners[0], corners[1]);
      return made ? { ...made, images: [] } : null;
    }
    case "slot": {
      const made = slotSketchGeometry(corners[0], corners[1]);
      return made ? { ...made, images: [] } : null;
    }
    case "star": {
      // Tip toward the back, then fitted so the size boxes read the star's true size.
      const made = starSketchGeometry({ x: 0, z: 0 }, { x: 0, z: 1 }, spec.points, spec.inner);
      return made ? fitOutline(made, width, depth) : null;
    }
    case "heart":
      return fitOutline(heartOutline(), width, depth);
    case "nutPocket": {
      const made = regularPolygonSketchGeometry({ x: 0, z: 0 }, { x: width / 2, z: 0 }, 6);
      return made ? { ...made, images: [] } : null;
    }
    default:
      return null;
  }
}

export function clampPlateRadius(radius: number, width: number, depth: number) {
  return Math.max(0, Math.min(radius, Math.min(width, depth) / 2 - 0.01));
}

/** One half of a turned shape, from the axis at the bottom round to the axis at the top: [radius, height]. */
export function latheProfile(spec: GeneratedSpec, width: number, height: number): [number, number][] | null {
  if (spec.form === "paraboloid") {
    const radius = width / 2;
    const rings = 48;
    const points: [number, number][] = [[0, 0]];
    for (let step = 0; step < rings; step += 1) {
      // Rings bunch up where the curve is steepest, at the base.
      const along = (step / rings) ** 2;
      points.push([radius * Math.sqrt(1 - along), along * height]);
    }
    points.push([0, height]);
    return points;
  }
  if (spec.form === "screwHole") {
    // A tapped hole is a thread, not a turned outline.
    if (spec.threaded) return null;
    const screw = screwDimensions(spec);
    const shaft = screw.clearance / 2;
    if (spec.head === "counterbore") {
      const radius = (screw.head + POCKET_CLEARANCE) / 2;
      const seat = height - screw.headHeight;
      return [[0, 0], [shaft, 0], [shaft, seat], [radius, seat], [radius, height], [0, height]];
    }
    if (spec.head === "countersink") {
      const radius = (screw.countersink + POCKET_CLEARANCE) / 2;
      // The cone matches the head: 90° for metric screws, 82° for inch ones.
      return [[0, 0], [shaft, 0], [shaft, height - countersinkDepth(screw)], [radius, height], [0, height]];
    }
    return [[0, 0], [shaft, 0], [shaft, height], [0, height]];
  }
  return null;
}

/** A closed indexed mesh turned round Y, stretched to a footprint. Base at y = 0. */
function latheGeometry(profile: readonly [number, number][], width: number, depth: number, segments: number) {
  const radiusMax = Math.max(...profile.map(([radius]) => radius), 1e-6);
  const sx = width / 2 / radiusMax;
  const sz = depth / 2 / radiusMax;
  const positions: number[] = [];
  const indices: number[] = [];
  const rings = profile.map(([radius, y]) => {
    if (radius < 1e-9) {
      positions.push(0, y, 0);
      return { start: positions.length / 3 - 1, pole: true };
    }
    const start = positions.length / 3;
    for (let step = 0; step < segments; step += 1) {
      const angle = (step / segments) * Math.PI * 2;
      positions.push(Math.cos(angle) * radius * sx, y, Math.sin(angle) * radius * sz);
    }
    return { start, pole: false };
  });
  for (let index = 0; index + 1 < rings.length; index += 1) {
    const low = rings[index];
    const high = rings[index + 1];
    for (let step = 0; step < segments; step += 1) {
      const next = (step + 1) % segments;
      if (low.pole && high.pole) continue;
      if (low.pole) {
        indices.push(low.start, high.start + step, high.start + next);
      } else if (high.pole) {
        indices.push(low.start + next, low.start + step, high.start);
      } else {
        indices.push(low.start + next, low.start + step, high.start + step, low.start + next, high.start + step, high.start + next);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The squares of a QR code as one flat mesh. Too many corners for a useful exact solid or sketch, so it stays a mesh, like text. */
function qrGeometry(text: string, size: number, height: number) {
  const squares = encodeQr(text);
  if (!squares) return null;
  const unit = size / squares.length;
  const solid = qrSolid(squares, height);
  const positions = solid.positions.map((value, index) => (index % 3 === 1 ? value : value * unit - size / 2));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(solid.indices);
  geometry.computeVertexNormals();
  return geometry;
}

function meshFields(geometry: THREE.BufferGeometry, size: GeneratedSize): Partial<WorkplaneShape> {
  const importedMesh = importedMeshPayloadFromGeometry(geometry, size.width, size.depth, size.height);
  geometry.dispose();
  return {
    kind: "mesh",
    width: size.width,
    depth: size.depth,
    height: size.height,
    size: Math.max(size.width, size.depth),
    importedMesh,
    // These have no sketch; clear what a previous build may have carried.
    sketchProfile: undefined,
    sketchDoc: undefined,
    sketchId: undefined,
    sketchProfileIds: undefined,
    sketchPlane: undefined,
    sketchFinish: undefined,
    sketchRevolveAxis: undefined,
    // Nor a thread, if this was a tapped hole before.
    threadSpec: undefined,
  };
}

/**
 * A threaded screw hole is the very tapped hole Threads makes, so cutting, exporting and print
 * clearance all work the same. The fit someone set on it is kept across a rebuild.
 */
function tappedHoleFields(spec: Extract<GeneratedSpec, { form: "screwHole" }>, depth: number, previous: Partial<WorkplaneShape>): Partial<WorkplaneShape> {
  const custom = spec.size === "Custom";
  const tapped = createThreadShape({
    designation: spec.size,
    height: depth,
    base: {
      id: "screw-hole",
      name: "Threaded Hole",
      color: "#b8c2cc",
      sides: previous.kind === "thread" ? previous.sides : undefined,
      threadSpec: {
        designation: spec.size,
        // A custom thread needs its own diameter and pitch; listed ones look theirs up.
        majorDiameter: custom ? Math.max(MIN_CUSTOM_DIAMETER, spec.diameter ?? 3) : 0,
        pitch: custom ? spec.pitch ?? Math.max(0.2, (spec.diameter ?? 3) * 0.15) : 0,
        series: custom ? "custom" : undefined,
        style: "hole",
        part: "threads",
        role: "bore",
        clearance: previous.threadSpec?.role === "bore" ? previous.threadSpec.clearance : undefined,
        exact: previous.threadSpec?.exact,
        length: depth,
      },
    },
  });
  return {
    kind: "thread",
    width: tapped.width,
    depth: tapped.depth,
    height: tapped.height,
    size: tapped.size,
    sides: tapped.sides,
    threadSpec: tapped.threadSpec,
    importedMesh: tapped.importedMesh,
    sketchProfile: undefined,
    sketchDoc: undefined,
    sketchId: undefined,
    sketchProfileIds: undefined,
    sketchPlane: undefined,
    sketchFinish: undefined,
    sketchRevolveAxis: undefined,
  };
}

/** The part's geometry fields from its settings and size, or null if they make no shape. */
function buildGeometry(spec: GeneratedSpec, size: GeneratedSize, previous: Partial<WorkplaneShape> = {}): Partial<WorkplaneShape> | null {
  if (spec.form === "screwHole" && spec.threaded) return tappedHoleFields(spec, size.height, previous);
  if (spec.form === "qr") {
    const geometry = qrGeometry(spec.text, size.width, size.height);
    return geometry ? meshFields(geometry, size) : null;
  }
  const profile = latheProfile(spec, size.width, size.height);
  if (profile) return meshFields(latheGeometry(profile, size.width, size.depth, 96), size);
  const outline = outlineFor(spec, size.width, size.depth);
  return outline ? shapeFromSketchProfile(outline, size.height) : null;
}

/**
 * A generated part made or rebuilt from settings. `previous` holds whatever should survive a
 * rebuild: where it is, its colour, whether it is a hole. A size the settings fix wins over the
 * size asked for.
 */
export function buildGeneratedShape(spec: GeneratedSpec, size: GeneratedSize, previous: Partial<WorkplaneShape> & Pick<WorkplaneShape, "name" | "color">): WorkplaneShape | null {
  const fixed = fixedFootprint(spec);
  const square = spec.form === "qr";
  const width = Math.max(square ? MIN_QR_MM : 0.5, fixed?.width ?? size.width);
  const depth = square ? width : Math.max(0.5, fixed?.depth ?? size.depth);
  const minHeight = spec.form === "screwHole" ? screwHoleDepthMin(spec) : 0.1;
  const height = Math.max(minHeight, size.height);
  const built = buildGeometry(spec, { width, depth, height }, previous);
  if (!built) return null;
  return canonicalizeShape({
    ...previous,
    ...built,
    id: previous.id ?? createLocalId(spec.form),
    name: spec.form === "screwHole" ? screwHoleName(spec.threaded === true, previous.name) : previous.name,
    color: previous.color,
    hole: previous.hole,
    x: previous.x ?? 0,
    z: previous.z ?? 0,
    elevation: previous.elevation ?? 0,
    rotation: previous.rotation ?? 0,
    rotationX: previous.rotationX ?? 0,
    rotationZ: previous.rotationZ ?? 0,
    // A rebuild starts from settings, so the old exact solid no longer matches.
    cadBrep: undefined,
    cadBrepFrame: undefined,
    generated: spec,
    locked: previous.locked ?? false,
    hidden: previous.hidden ?? false,
  } as WorkplaneShape);
}

/**
 * A screw hole's own name follows Threaded or Slides through, so a plain hole is not called
 * threaded. A name someone typed is kept.
 */
function screwHoleName(threaded: boolean, name: string) {
  const threadedName = /^(Threaded Hole|Tapped hole)( |$)/.test(name);
  const clearanceName = /^Clearance Hole( |$)/.test(name);
  if (threaded && clearanceName) return name.replace(/^Clearance Hole/, "Threaded Hole");
  if (!threaded && threadedName) return name.replace(/^(Threaded Hole|Tapped hole)/, "Clearance Hole");
  return name;
}

/** Starting settings and size for each generated shape on the menu. */
export function defaultGeneratedSize(spec: GeneratedSpec): GeneratedSize {
  switch (spec.form) {
    case "plate":
      return { width: 60, depth: 40, height: 3 };
    case "slot":
      return { width: 30, depth: 12, height: 10 };
    case "star":
    case "heart":
      return { width: 30, depth: 30, height: 5 };
    case "paraboloid":
      return { width: 20, depth: 20, height: 20 };
    case "screwHole":
      return { width: 0, depth: 0, height: 15 };
    case "nutPocket":
      return { width: 0, depth: 0, height: nutPocketHeight(spec) };
    case "qr":
      return { width: 40, depth: 40, height: 2 };
  }
}

/** How big one square of a QR code comes out. */
export function qrSquareSize(spec: { text: string }, width: number) {
  const squares = encodeQr(spec.text);
  return squares ? width / squares.length : null;
}
