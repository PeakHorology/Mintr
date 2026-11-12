import type { ManifoldToplevel, Vec2 } from "manifold-3d";
import { meshForShape, type MeshData } from "@/lib/editorShapeMesh";
import { footprintOutline } from "@/lib/laser/cutFile";
import { flatParts } from "@/lib/laser/flatParts";
import { nestOutlines, placePoint } from "@/lib/laser/shapeNest";
import { isConstructionShape } from "@/lib/holeFeature";
import { createLocalId } from "@/lib/localIds";
import { shapeFromSketchProfile } from "@/lib/sketchProfileShape";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { LaserLink, LaserSendMode, SketchProfile, WorkplaneShape } from "@/types/sketchforge";

/**
 * Bringing a 3D model into a laser design. The 3D parts travel as they are, marked
 * pending; the laser design turns them into sheet parts with its own material and bed,
 * and remembers where they came from so Update from model can make them again.
 */

export const LASER_SEND_MODE_LABEL: Record<LaserSendMode, string> = {
  outline: "Outline",
  stack: "Stacked layers",
  interlock: "Slotted slices",
  asis: "As it is",
};

export const LASER_SEND_MODE_HINT: Record<LaserSendMode, string> = {
  outline: "One sheet part in the shape of the model seen from above. Good for signs, plates and anything flat.",
  stack: "Layers as thick as your material, to glue one on another into the full 3D shape.",
  interlock: "Upright slices with slots that push together crosswise.",
  asis: "The 3D part unchanged. The cut file uses its outline from above.",
};

export type LaserSheet = { thickness: number; bedWidth: number; bedDepth: number; gap: number };

export type LaserSendResult = { shapes: WorkplaneShape[]; sheets: number; skipped: string[] };

/** Parts worth sending: what you can see, not holes or guides. Groups go as one part. */
export function sendableShapes(shapes: readonly WorkplaneShape[]) {
  return shapes.filter((shape) => !shape.hole && !shape.hidden && !isConstructionShape(shape));
}

/** The 3D parts as they go into the laser design, waiting to be made into sheet parts. */
export function pendingLaserShapes(
  sources: readonly WorkplaneShape[],
  link: Omit<LaserLink, "sourceIds" | "batch" | "pending" | "sourceId" | "piece">,
): WorkplaneShape[] {
  const batch = createLocalId("laser-batch");
  const sourceIds = sources.map((shape) => shape.id);
  return sources.map((shape) => ({
    ...shape,
    id: createLocalId("laser-source"),
    locked: false,
    laserLink: { ...link, sourceIds, batch, pending: true, sourceId: shape.id },
  }));
}

function boundsOf(loops: readonly (readonly Vec2[])[]) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const loop of loops) for (const [x, z] of loop) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { minX, minZ, maxX, maxZ };
}

function loopArea(loop: readonly Vec2[]) {
  let sum = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const [x0, z0] = loop[i];
    const [x1, z1] = loop[(i + 1) % loop.length];
    sum += x0 * z1 - x1 * z0;
  }
  return Math.abs(sum) / 2;
}

/** -1 outside, 1 inside, 0 on the edge (within tolerance). */
function pointInLoop([px, pz]: Vec2, loop: readonly Vec2[], tolerance: number) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i, i += 1) {
    const [xi, zi] = loop[i];
    const [xj, zj] = loop[j];
    const ex = xi - xj;
    const ez = zi - zj;
    const length = Math.hypot(ex, ez);
    if (length > 0) {
      const t = Math.max(0, Math.min(1, ((px - xj) * ex + (pz - zj) * ez) / (length * length)));
      if (Math.hypot(px - (xj + t * ex), pz - (zj + t * ez)) <= tolerance) return 0;
    }
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside ? 1 : -1;
}

/**
 * Sorts loops that do not cross into solid pieces, each an outer loop with the holes
 * straight inside it, by how deep each loop sits: even depth is material, odd is a
 * hole. So a post inside a ring's hole is a piece of its own, not lost. Returns the
 * loops' indexes per piece, outer loop first; loops with fewer than three points are left out.
 */
export function loopPieces(loops: readonly (readonly Vec2[])[]): number[][] {
  const usable = loops.map((loop, index) => ({ loop, index, area: loopArea(loop) })).filter((entry) => entry.loop.length >= 3 && entry.area > 0);
  let span = 0;
  for (const { loop } of usable) for (const [x, z] of loop) span = Math.max(span, Math.abs(x), Math.abs(z));
  const tolerance = Math.max(1e-9, span * 1e-9);
  const inside = (inner: (typeof usable)[number], outer: (typeof usable)[number]) => {
    if (inner.area >= outer.area) return false;
    // A point of the inner loop clear of the outer loop's edge tells; loops that do not cross agree at every such point.
    for (const point of inner.loop) {
      const where = pointInLoop(point, outer.loop, tolerance);
      if (where !== 0) return where > 0;
    }
    for (let i = 0; i < inner.loop.length; i += 1) {
      const a = inner.loop[i];
      const b = inner.loop[(i + 1) % inner.loop.length];
      const where = pointInLoop([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], outer.loop, tolerance);
      if (where !== 0) return where > 0;
    }
    return false;
  };
  const parent = new Map<number, number>();
  const depth = new Map<number, number>();
  for (const entry of usable) {
    const holders = usable.filter((other) => other !== entry && inside(entry, other));
    depth.set(entry.index, holders.length);
    const nearest = holders.sort((a, b) => a.area - b.area)[0];
    if (nearest) parent.set(entry.index, nearest.index);
  }
  const pieces = new Map<number, number[]>();
  for (const { index } of usable) if ((depth.get(index) ?? 0) % 2 === 0) pieces.set(index, [index]);
  for (const { index } of usable) {
    if ((depth.get(index) ?? 0) % 2 === 0) continue;
    const holder = parent.get(index);
    if (holder !== undefined) pieces.get(holder)?.push(index);
  }
  return [...pieces.values()];
}

/**
 * A sheet-thick part from outlines in bed millimetres (x right, z toward the front), holes as inner loops.
 * Each solid piece gets its own region, so an island inside a hole stays solid.
 */
export function sheetPartFromLoops(loops: readonly (readonly Vec2[])[], thickness: number, base: Partial<WorkplaneShape> & { name: string; color: string }) {
  const points: SketchProfile["points"] = [];
  const segments: SketchProfile["segments"] = [];
  for (const piece of loopPieces(loops)) {
    const regionId = createLocalId("laser-region");
    for (const index of piece) {
      const loop = loops[index];
      const ids = loop.map(() => createLocalId("laser-point"));
      // A sketch's z runs the other way to the workplane's.
      loop.forEach(([x, z], at) => points.push({ id: ids[at], x, z: -z, mode: "corner" }));
      ids.forEach((id, at) => segments.push({ id: createLocalId("laser-edge"), startId: id, endId: ids[(at + 1) % ids.length], kind: "line", regionId }));
    }
  }
  if (segments.length === 0) return null;
  const shape = shapeFromSketchProfile({ points, segments, images: [] }, thickness);
  return shape ? canonicalizeShape({ ...shape, ...base, id: createLocalId("laser-part") }) : null;
}

/**
 * Turns one send's 3D parts into sheet parts. Outline keeps the parts where they sit
 * relative to each other, centred where they were; flat parts are packed on the bed.
 */
export function makeLaserParts(
  runtime: ManifoldToplevel,
  sources: readonly WorkplaneShape[],
  sheet: LaserSheet,
  options: { color: string; meshOf?: (shape: WorkplaneShape) => MeshData; previous?: readonly WorkplaneShape[] },
): LaserSendResult {
  const meshOf = options.meshOf ?? meshForShape;
  const skipped: string[] = [];
  const link = sources[0]?.laserLink;
  if (!link) return { shapes: [], sheets: 0, skipped: sources.map((shape) => shape.name) };
  const { pending: _pending, ...finished } = link;
  void _pending;
  // Each part remembers the 3D part and piece it came from; a copy of an older link from another part must not be kept.
  const { sourceId: _sourceId, piece: _piece, ...shared } = finished;
  void _sourceId;
  void _piece;
  const sourceIdOf = (source: WorkplaneShape, index: number) => {
    // An update passes the 3D parts themselves; a send passes copies that name their 3D part.
    if (link.sourceIds.includes(source.id)) return source.id;
    return source.laserLink?.sourceId ?? link.sourceIds[index] ?? source.id;
  };
  const linkFor = (sourceId: string, piece: number): LaserLink => ({ ...shared, sourceId, piece });
  // What the user chose for each earlier part, such as engrave, carries over by the 3D part and piece it
  // came from; by name only for older parts that do not say, and only when that name is not shared.
  const previous = options.previous ?? [];
  const jobByOrigin = new Map<string, WorkplaneShape["laserJob"]>();
  const nameCount = new Map<string, number>();
  const jobByName = new Map<string, WorkplaneShape["laserJob"]>();
  for (const shape of previous) {
    const origin = shape.laserLink;
    nameCount.set(shape.name, (nameCount.get(shape.name) ?? 0) + 1);
    if (origin?.sourceId !== undefined) jobByOrigin.set(`${origin.sourceId}\u0000${origin.piece ?? 0}`, shape.laserJob);
    else jobByName.set(shape.name, shape.laserJob);
  }
  const jobFor = (sourceId: string, piece: number, name: string, fallback?: WorkplaneShape["laserJob"]) => {
    const key = `${sourceId}\u0000${piece}`;
    if (jobByOrigin.has(key)) return jobByOrigin.get(key);
    if (nameCount.get(name) === 1 && jobByName.has(name)) return jobByName.get(name);
    return fallback;
  };

  if (link.mode === "asis") {
    return {
      shapes: sources.map((shape, index) => {
        const sourceId = sourceIdOf(shape, index);
        return { ...shape, id: createLocalId("laser-part"), laserLink: linkFor(sourceId, 0), laserJob: jobFor(sourceId, 0, shape.name) ?? shape.laserJob };
      }),
      sheets: 1,
      skipped,
    };
  }

  if (link.mode === "outline") {
    const made: WorkplaneShape[] = [];
    for (const [index, source] of sources.entries()) {
      const sourceId = sourceIdOf(source, index);
      let loops: Vec2[][] = [];
      try {
        loops = footprintOutline(runtime, meshOf(source));
      } catch {
        loops = [];
      }
      if (loops.length === 0) {
        skipped.push(source.name);
        continue;
      }
      const part = sheetPartFromLoops(loops, sheet.thickness, {
        name: source.name,
        color: options.color,
        laserLink: linkFor(sourceId, 0),
        laserJob: jobFor(sourceId, 0, source.name),
      });
      if (part) made.push(part);
      else skipped.push(source.name);
    }
    return { shapes: made, sheets: made.length > 0 ? 1 : 0, skipped };
  }

  // Flat parts: each one lies with its top toward the back, then they are packed by outline.
  type Piece = { name: string; loops: Vec2[][]; sourceId: string; piece: number };
  const pieces: Piece[] = [];
  for (const [index, source] of sources.entries()) {
    const sourceId = sourceIdOf(source, index);
    try {
      const parts = flatParts(runtime, meshOf(source), link.mode, { thickness: sheet.thickness, across: link.across, along: link.along });
      if (parts.length === 0) skipped.push(source.name);
      for (const [piece, part] of parts.entries()) {
        pieces.push({
          sourceId,
          piece,
          name: sources.length > 1 || parts.length > 1 ? `${source.name} · ${part.name}` : source.name,
          loops: part.polygons.map((polygon) => polygon.map(([u, v]) => [u, part.height - v] as Vec2)),
        });
      }
    } catch {
      skipped.push(source.name);
    }
  }
  if (pieces.length === 0) return { shapes: [], sheets: 0, skipped };
  const nest = nestOutlines(runtime, pieces.map((piece, index) => ({ id: String(index), loops: piece.loops })), { width: sheet.bedWidth, depth: sheet.bedDepth }, sheet.gap);
  const made: WorkplaneShape[] = [];
  for (const placement of nest.placements) {
    const piece = pieces[Number(placement.id)];
    const loops = piece.loops.map((loop) => loop.map((point) => placePoint(point, placement)));
    const part = sheetPartFromLoops(loops, sheet.thickness, { name: piece.name, color: options.color, laserLink: linkFor(piece.sourceId, piece.piece), laserJob: jobFor(piece.sourceId, piece.piece, piece.name) });
    if (part) made.push(part);
  }
  return { shapes: made, sheets: nest.sheets, skipped };
}

/** Moves parts so the middle of their outline from above lands at (x, z). */
export function centreShapesAt(shapes: readonly WorkplaneShape[], x: number, z: number) {
  if (shapes.length === 0) return [...shapes];
  const loops = shapes.map((shape) => [[shape.x - shape.width / 2, shape.z - shape.depth / 2], [shape.x + shape.width / 2, shape.z + shape.depth / 2]] as Vec2[]);
  const box = boundsOf(loops);
  const dx = x - (box.minX + box.maxX) / 2;
  const dz = z - (box.minZ + box.maxZ) / 2;
  return shapes.map((shape) => ({ ...shape, x: shape.x + dx, z: shape.z + dz }));
}

/** The middle of a set of parts from above, for keeping an updated batch where the old one was. */
export function shapesCentre(shapes: readonly WorkplaneShape[]) {
  const loops = shapes.map((shape) => [[shape.x - shape.width / 2, shape.z - shape.depth / 2], [shape.x + shape.width / 2, shape.z + shape.depth / 2]] as Vec2[]);
  const box = boundsOf(loops);
  return { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
}

/** Groups a laser design's linked parts by send, for Update from model. */
export function laserBatches(shapes: readonly WorkplaneShape[]) {
  const batches = new Map<string, WorkplaneShape[]>();
  for (const shape of shapes) {
    const batch = shape.laserLink?.batch;
    if (!batch) continue;
    batches.set(batch, [...(batches.get(batch) ?? []), shape]);
  }
  return batches;
}

/** Which of the 3D design's parts to make the batch from again; missing ones are reported. */
export function sourcesForUpdate(link: LaserLink, designShapes: readonly WorkplaneShape[]) {
  const byId = new Map(designShapes.map((shape) => [shape.id, shape]));
  const found = link.sourceIds.map((id) => byId.get(id)).filter((shape): shape is WorkplaneShape => Boolean(shape));
  return { found, missing: link.sourceIds.length - found.length };
}
