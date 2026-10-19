import { createLocalId } from "@/lib/localIds";
import { loadBrepWithOcct, type Brep, type BrepSolid } from "@/lib/brepKernel";
import { mergeProfileIntoDoc, sketchProfileToDoc } from "@/lib/sketch/migrate";
import {
  placeSketchSweep,
  resolveSketchSweep,
  type PlacedEdge,
  type PlacedLoop,
  type PlacedPoint,
} from "@/lib/sketch/sweepPlan";
import { resolveSketchPlane } from "@/lib/sketchPlane";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { SketchDoc } from "@/lib/sketch/types";
import type { SketchProfile, WorkplaneShape } from "@/types/sketchforge";

export const SWEEP_CROSSES_ITSELF = "This path cuts through itself.";
export const SWEEP_CURVE_FAILED = "Sweep could not follow that curve.";
export const SWEEP_HOLE_FAILED = "Sweep could not cut the hole in this outline.";
export const SWEEP_ONE_HOLE = "Sweep can cut one hole in the outline.";

type SweepSpec = NonNullable<WorkplaneShape["sketchSweep"]>;

export type SweepShapeResult =
  | { ok: true; shape: WorkplaneShape }
  | { ok: false; message: string };

function xyz(point: PlacedPoint): [number, number, number] {
  return [point.x, point.y, point.z];
}

function edgeOf(brep: Brep, edge: PlacedEdge) {
  if (edge.kind === "line") {
    if (Math.hypot(edge.from.x - edge.to.x, edge.from.y - edge.to.y, edge.from.z - edge.to.z) < 1e-6) return null;
    return brep.line(xyz(edge.from), xyz(edge.to));
  }
  if (edge.kind === "arc") return brep.threePointArc(xyz(edge.from), xyz(edge.mid), xyz(edge.to));
  const curve = brep.bezier([xyz(edge.from), xyz(edge.c1), xyz(edge.c2), xyz(edge.to)]);
  return curve.ok ? curve.value : null;
}

function wireOf(brep: Brep, loop: PlacedLoop, closed: boolean) {
  if (loop.circle) {
    const edge = brep.circle(loop.circle.radius, {
      at: xyz(loop.circle.center),
      axis: xyz(loop.circle.axis),
    });
    const looped = brep.wireLoop([edge]);
    if (looped.ok) return looped.value;
    const spine = brep.wire([edge]);
    return spine.ok ? spine.value : null;
  }
  const edges = [];
  for (const edge of loop.edges) {
    const built = edgeOf(brep, edge);
    if (!built) return null;
    edges.push(built);
  }
  if (edges.length < (closed ? 1 : 1)) return null;
  const wire = closed ? brep.wireLoop(edges) : brep.wire(edges);
  return wire.ok ? wire.value : null;
}

function pipeConfig(simple: boolean) {
  return simple
    ? { mode: "simple" as const }
    : { mode: "general" as const, transitionMode: "transformed" as const, forceProfileSpineOthogonality: true };
}

function sweepWires(brep: Brep, profile: PlacedLoop, path: PlacedLoop, pathClosed: boolean, simple: boolean) {
  const section = wireOf(brep, profile, true);
  const spine = wireOf(brep, path, pathClosed);
  if (!section || !spine) return null;
  let swept = brep.sweep(section as never, spine as never, pipeConfig(simple));
  if (!swept.ok && simple) {
    const againSection = wireOf(brep, profile, true);
    const againSpine = wireOf(brep, path, pathClosed);
    if (!againSection || !againSpine) return swept;
    swept = brep.sweep(againSection as never, againSpine as never, pipeConfig(false));
  }
  return swept;
}

/** OpenCascade pipe. The display mesh is a tessellation of this solid. */
export function sweepSolid(
  brep: Brep,
  profile: SketchProfile,
  doc: SketchDoc | null | undefined,
  spec: SweepSpec,
  plane?: SketchProfile["sketchPlane"],
): { ok: true; solid: BrepSolid } | { ok: false; message: string } {
  const resolved = resolveSketchSweep(profile, doc, spec);
  if (!resolved) return { ok: false, message: "That outline or path is no longer on the sheet." };
  if (resolved.outline.holes.length > 1) return { ok: false, message: SWEEP_ONE_HOLE };
  const placed = placeSketchSweep(resolved.outline, resolved.path, plane ?? profile.sketchPlane ?? doc?.plane);
  if (!placed) return { ok: false, message: "Draw the path, then Sweep." };
  try {
    const outer = sweepWires(brep, placed.outer, placed.path, placed.pathClosed, placed.simple || Boolean(placed.outer.circle));
    if (!outer) return { ok: false, message: SWEEP_CURVE_FAILED };
    if (!outer.ok) return { ok: false, message: SWEEP_CROSSES_ITSELF };
    let solid = outer.value as BrepSolid;
    if (placed.hole) {
      const innerSimple = Boolean(placed.hole.circle);
      const inner = sweepWires(brep, placed.hole, placed.path, placed.pathClosed, innerSimple);
      if (!inner) return { ok: false, message: SWEEP_CURVE_FAILED };
      if (!inner.ok) return { ok: false, message: SWEEP_CROSSES_ITSELF };
      const cut = brep.cut(solid as never, inner.value as never);
      if (!cut.ok) return { ok: false, message: SWEEP_HOLE_FAILED };
      solid = cut.value as BrepSolid;
    }
    return { ok: true, solid };
  } catch {
    return { ok: false, message: SWEEP_CROSSES_ITSELF };
  }
}

type Tessellation = {
  vertices?: ArrayLike<number>;
  triangles?: ArrayLike<number>;
  normals?: ArrayLike<number>;
};

function shapeFromSolid(
  brep: Brep,
  solid: BrepSolid,
  profile: SketchProfile,
  doc: SketchDoc | null | undefined,
  spec: SweepSpec,
  existing?: WorkplaneShape | null,
): WorkplaneShape | null {
  const tess = brep.mesh(solid as never) as Tessellation;
  const vertices = tess.vertices;
  const triangles = tess.triangles;
  if (!vertices || vertices.length < 9 || !triangles || triangles.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < vertices.length; index += 3) {
    const x = vertices[index];
    const y = vertices[index + 1];
    const z = vertices[index + 2];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const positions: number[] = [];
  for (let index = 0; index < vertices.length; index += 3) {
    positions.push(vertices[index] - centerX, vertices[index + 1], vertices[index + 2] - centerZ);
  }
  const indices = Array.from(triangles);
  const normals = tess.normals && tess.normals.length === vertices.length ? Array.from(tess.normals) : undefined;
  const width = Math.max(0.01, maxX - minX);
  const depth = Math.max(0.01, maxZ - minZ);
  const height = Math.max(0.01, maxY - minY);
  const sketchDoc = doc ? mergeProfileIntoDoc(doc, profile) : sketchProfileToDoc(profile, existing?.sketchId ?? existing?.sketchDoc?.id);
  return canonicalizeShape({
    id: existing?.id ?? createLocalId("sketch-sweep"),
    name: existing?.name ?? "Sketch sweep",
    kind: "mesh",
    color: existing?.color ?? "#d41721",
    hole: false,
    x: centerX,
    z: centerZ,
    elevation: minY,
    size: Math.max(width, depth),
    width,
    depth,
    height,
    rotation: 0,
    importedMesh: {
      positions,
      indices,
      normals,
      baseWidth: width,
      baseDepth: depth,
      baseHeight: height,
      triangleCount: Math.floor(indices.length / 3),
      sourceFormat: "json",
    },
    sketchProfile: {
      ...profile,
      points: profile.points.map((point) => ({ ...point })),
      segments: profile.segments.map((segment) => ({ ...segment })),
    },
    sketchDoc,
    sketchId: existing?.sketchId ?? sketchDoc.id,
    sketchFinish: "sweep",
    sketchSweep: { ...spec, holeSegmentIds: spec.holeSegmentIds ?? [] },
    sketchPlane: resolveSketchPlane(profile.sketchPlane ?? doc?.plane),
  } satisfies WorkplaneShape);
}

export async function shapeFromSketchSweep(
  profile: SketchProfile,
  doc: SketchDoc | null | undefined,
  spec: SweepSpec,
  existing?: WorkplaneShape | null,
): Promise<SweepShapeResult> {
  const brep = await loadBrepWithOcct();
  const built = sweepSolid(brep, profile, doc, spec);
  if (!built.ok) return built;
  const shape = shapeFromSolid(brep, built.solid, profile, doc, spec, existing);
  if (!shape) return { ok: false, message: SWEEP_CROSSES_ITSELF };
  return { ok: true, shape };
}
