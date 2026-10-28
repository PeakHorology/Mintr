import type { CrossSection, Manifold, ManifoldToplevel, Vec2 } from "manifold-3d";
import type { MeshData } from "@/lib/editorShapeMesh";

/**
 * A 3D part made from flat sheet: either stacked layers to glue one on another, or
 * two sets of upright slices with slots that push together crosswise.
 *
 * Manifold slices along its z, so the part is turned first to put the slicing
 * direction there. Each turn is a true rotation, never a mirror, so the solid stays
 * the right way out.
 */

export type FlatPartsStyle = "stack" | "interlock";

/** One flat part: its outlines (holes inside) from its own corner, in millimetres. */
export type FlatPart = {
  name: string;
  /** Outlines with x across and y up the part; inner ones are holes. */
  polygons: Vec2[][];
  width: number;
  height: number;
};

export type FlatPartsOptions = {
  thickness: number;
  /** Interlocking: how many slices across (left to right) and along (front to back). */
  across?: number;
  along?: number;
};

type Turn = (point: readonly [number, number, number]) => [number, number, number];

// Stacked: up becomes the slicing direction; the layer lies with x across and the back at the top.
const UP_TO_Z: Turn = ([x, y, z]) => [x, -z, y];
// Across: left to right becomes the slicing direction; the slice is seen from the left, front on the left.
const ACROSS_TO_Z: Turn = ([x, y, z]) => [-z, y, x];
// Along: front to back is already the slicing direction; the slice is seen from the front.
const ALONG_TO_Z: Turn = (point) => [point[0], point[1], point[2]];

function solidFrom(runtime: ManifoldToplevel, mesh: MeshData, turn: Turn): Manifold {
  const vertProperties = new Float32Array(mesh.vertices.length * 3);
  mesh.vertices.forEach((vertex, index) => vertProperties.set(turn(vertex), index * 3));
  const triVerts = new Uint32Array(mesh.faces.length * 3);
  mesh.faces.forEach((face, index) => triVerts.set(face, index * 3));
  const manifoldMesh = new runtime.Mesh({ numProp: 3, vertProperties, triVerts, tolerance: 0.001 });
  manifoldMesh.merge();
  return new runtime.Manifold(manifoldMesh);
}

/** How many layers a part this tall makes, each a sheet thick. */
export function layerCount(height: number, thickness: number) {
  return Math.max(1, Math.round(height / thickness));
}

/** A sensible number of slices for a side: about one every sixth of the longest side, at least two. */
export function suggestedSlices(length: number, longest: number, thickness: number) {
  const spacing = Math.max(thickness * 4, longest / 6);
  return Math.max(2, Math.min(40, Math.round(length / spacing)));
}

/** Where n slices sit in [min, max]: evenly, half a gap in from each end. */
export function slicePositions(min: number, max: number, count: number) {
  const step = (max - min) / count;
  return Array.from({ length: count }, (_, index) => min + step * (index + 0.5));
}

function partFrom(name: string, section: CrossSection, minArea: number): FlatPart | null {
  const cleaned = section.simplify(0.005);
  const area = cleaned.area();
  const polygons = area < minArea ? [] : cleaned.toPolygons().filter((polygon) => polygon.length >= 3);
  cleaned.delete();
  const points = polygons.flat();
  if (points.length === 0) return null;
  const minX = Math.min(...points.map(([x]) => x));
  const maxX = Math.max(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const maxY = Math.max(...points.map(([, y]) => y));
  return {
    name,
    polygons: polygons.map((polygon) => polygon.map(([x, y]) => [x - minX, y - minY] as Vec2)),
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Stacked layers, bottom first, each the part's outline halfway up its layer. */
export function stackedLayers(runtime: ManifoldToplevel, mesh: MeshData, thickness: number): FlatPart[] {
  const solid = solidFrom(runtime, mesh, UP_TO_Z);
  try {
    const { min, max } = solid.boundingBox();
    const count = layerCount(max[2] - min[2], thickness);
    const step = (max[2] - min[2]) / count;
    const parts: FlatPart[] = [];
    for (let index = 0; index < count; index += 1) {
      const section = solid.slice(min[2] + step * (index + 0.5));
      const part = partFrom(`Layer ${index + 1}`, section, thickness * thickness);
      section.delete();
      if (part) parts.push(part);
    }
    return parts;
  } finally {
    solid.delete();
  }
}

/** The bottom and top of a slice's material along an upright line, or null when the line misses it. */
function upright(section: CrossSection, runtime: ManifoldToplevel, at: number, halfWidth: number) {
  const box = section.bounds();
  const strip = runtime.CrossSection.square([halfWidth * 2, box.max[1] - box.min[1] + 2]).translate([at - halfWidth, box.min[1] - 1]);
  const hit = section.intersect(strip);
  const found = hit.isEmpty() ? null : hit.bounds();
  hit.delete();
  strip.delete();
  return found ? { bottom: found.min[1], top: found.max[1] } : null;
}

/**
 * Two sets of upright slices that slot together. Where an across slice meets an
 * along slice, the across one is slotted from the top down to halfway and the along
 * one from the bottom up, so each pushes onto the other.
 */
export function interlockingSlices(runtime: ManifoldToplevel, mesh: MeshData, options: FlatPartsOptions): FlatPart[] {
  const t = options.thickness;
  const across = solidFrom(runtime, mesh, ACROSS_TO_Z);
  const along = solidFrom(runtime, mesh, ALONG_TO_Z);
  try {
    // In world terms: across slices sit at x positions, along slices at z positions.
    const acrossBox = across.boundingBox();
    const alongBox = along.boundingBox();
    const width = acrossBox.max[2] - acrossBox.min[2];
    const depth = alongBox.max[2] - alongBox.min[2];
    const longest = Math.max(width, depth);
    const xs = slicePositions(acrossBox.min[2], acrossBox.max[2], options.across ?? suggestedSlices(width, longest, t));
    const zs = slicePositions(alongBox.min[2], alongBox.max[2], options.along ?? suggestedSlices(depth, longest, t));
    // An across slice's 2D x is minus the world z; an along slice's 2D x is the world x.
    let acrossSections = xs.map((x) => across.slice(x));
    let alongSections = zs.map((z) => along.slice(z));
    const tall = 1e4;
    xs.forEach((x, i) => {
      zs.forEach((z, j) => {
        const meet = upright(acrossSections[i], runtime, -z, t / 2);
        const other = upright(alongSections[j], runtime, x, t / 2);
        if (!meet || !other) return;
        // Only where both have material on that line, and halfway up the part they share.
        const bottom = Math.max(meet.bottom, other.bottom);
        const top = Math.min(meet.top, other.top);
        if (top - bottom < t) return;
        const middle = (bottom + top) / 2;
        const fromTop = runtime.CrossSection.square([t, tall]).translate([-z - t / 2, middle]);
        const fromBottom = runtime.CrossSection.square([t, tall]).translate([x - t / 2, middle - tall]);
        const slottedAcross = acrossSections[i].subtract(fromTop);
        const slottedAlong = alongSections[j].subtract(fromBottom);
        acrossSections[i].delete();
        alongSections[j].delete();
        fromTop.delete();
        fromBottom.delete();
        acrossSections = acrossSections.map((section, index) => (index === i ? slottedAcross : section));
        alongSections = alongSections.map((section, index) => (index === j ? slottedAlong : section));
      });
    });
    const minArea = t * t;
    const parts: FlatPart[] = [];
    acrossSections.forEach((section, index) => {
      const part = partFrom(`Across ${index + 1}`, section, minArea);
      if (part) parts.push(part);
      section.delete();
    });
    alongSections.forEach((section, index) => {
      const part = partFrom(`Along ${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) + 1 : ""}`, section, minArea);
      if (part) parts.push(part);
      section.delete();
    });
    return parts;
  } finally {
    across.delete();
    along.delete();
  }
}

export function flatParts(runtime: ManifoldToplevel, mesh: MeshData, style: FlatPartsStyle, options: FlatPartsOptions): FlatPart[] {
  return style === "stack" ? stackedLayers(runtime, mesh, options.thickness) : interlockingSlices(runtime, mesh, options);
}
