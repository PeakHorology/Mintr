import { loadBrepWithOcct } from "@/lib/brepKernel";
import {
  defaultGridfinityBaseplateSpec,
  defaultGridfinityBinSpec,
  gridfinityBaseplateName,
  gridfinityBinName,
  gridfinityFootprint,
  gridfinityRecipeForShape,
  gridfinityShapeKey,
  isDefaultGridfinityName,
  normalizeGridfinityBaseplateSpec,
  normalizeGridfinityBinSpec,
  type GridfinityRecipe,
} from "@/lib/gridfinity";
import { createLocalId } from "@/lib/localIds";
import { buildRecipeSolid } from "@/lib/recipeBrep";
import { meshInLocalFrame } from "@/lib/sketchExtrusionSolid";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { GridfinityBaseplateSpec, GridfinityBinSpec, WorkplaneShape } from "@/types/sketchforge";

export const GRIDFINITY_BIN_COLOR = "#2aa77e";
export const GRIDFINITY_BASEPLATE_COLOR = "#655447";

/** Palette drop: a shape with its spec and footprint; the mesh arrives from the kernel. */
export function createGridfinityShape(
  kind: "gridfinityBin" | "gridfinityBaseplate",
  point?: { x: number; z: number; elevation?: number },
  base?: Partial<WorkplaneShape>,
): WorkplaneShape {
  const bin = kind === "gridfinityBin" ? normalizeGridfinityBinSpec(base?.gridfinityBin) : undefined;
  const plate = kind === "gridfinityBaseplate" ? normalizeGridfinityBaseplateSpec(base?.gridfinityBaseplate) : undefined;
  const draft: WorkplaneShape = {
    id: base?.id ?? createLocalId(kind === "gridfinityBin" ? "gridfinity-bin" : "gridfinity-baseplate"),
    name: base?.name ?? (bin ? gridfinityBinName(bin) : gridfinityBaseplateName(plate!)),
    kind,
    color: base?.color ?? (kind === "gridfinityBin" ? GRIDFINITY_BIN_COLOR : GRIDFINITY_BASEPLATE_COLOR),
    x: point?.x ?? base?.x ?? 0,
    z: point?.z ?? base?.z ?? 0,
    elevation: point?.elevation ?? base?.elevation ?? 0,
    size: 42,
    width: 42,
    depth: 42,
    height: 7,
    rotation: base?.rotation ?? 0,
    rotationX: base?.rotationX ?? 0,
    rotationZ: base?.rotationZ ?? 0,
    mirrorX: base?.mirrorX,
    mirrorY: base?.mirrorY,
    mirrorZ: base?.mirrorZ,
    locked: base?.locked ?? false,
    hidden: base?.hidden ?? false,
    gridfinityBin: bin,
    gridfinityBaseplate: plate,
  };
  return withGridfinityFootprint(draft);
}

/** Size, name, and spec object of a Gridfinity shape follow its spec. */
export function withGridfinityFootprint(shape: WorkplaneShape): WorkplaneShape {
  const foot = gridfinityFootprint(shape);
  if (!foot) return shape;
  const next: WorkplaneShape = {
    ...shape,
    width: foot.width,
    depth: foot.depth,
    height: foot.height,
    size: Math.max(foot.width, foot.depth),
  };
  if (shape.kind === "gridfinityBin") {
    const spec = normalizeGridfinityBinSpec(shape.gridfinityBin);
    next.gridfinityBin = spec;
    next.gridfinityBaseplate = undefined;
    if (isDefaultGridfinityName(shape.name)) next.name = gridfinityBinName(spec);
  } else if (shape.kind === "gridfinityBaseplate") {
    const spec = normalizeGridfinityBaseplateSpec(shape.gridfinityBaseplate);
    next.gridfinityBaseplate = spec;
    next.gridfinityBin = undefined;
    if (isDefaultGridfinityName(shape.name)) next.name = gridfinityBaseplateName(spec);
  }
  return next;
}

export function withGridfinityBinSpec(shape: WorkplaneShape, patch: Partial<GridfinityBinSpec>): WorkplaneShape {
  const spec = normalizeGridfinityBinSpec({ ...(shape.gridfinityBin ?? defaultGridfinityBinSpec()), ...patch });
  return withGridfinityFootprint({ ...shape, kind: "gridfinityBin", gridfinityBin: spec });
}

export function withGridfinityBaseplateSpec(shape: WorkplaneShape, patch: Partial<GridfinityBaseplateSpec>): WorkplaneShape {
  const spec = normalizeGridfinityBaseplateSpec({ ...(shape.gridfinityBaseplate ?? defaultGridfinityBaseplateSpec()), ...patch });
  return withGridfinityFootprint({ ...shape, kind: "gridfinityBaseplate", gridfinityBaseplate: spec });
}

/**
 * Attach a kernel-built mesh and exact B-Rep to a Gridfinity shape. The mesh is
 * expected in the recipe frame (footprint centred, resting on y = 0).
 */
export function applyGridfinityKernelMesh(
  shape: WorkplaneShape,
  positions: ArrayLike<number>,
  normals: ArrayLike<number> | undefined,
  indices: ArrayLike<number>,
  cadBrep: string,
  builtKey: string,
): WorkplaneShape | null {
  const placed = meshInLocalFrame(
    Float32Array.from(positions),
    Float32Array.from(normals ?? []),
    Uint32Array.from(indices),
  );
  if (!placed || !cadBrep.trim()) return null;
  const sized = withGridfinityFootprint(shape);
  const width = sized.width ?? placed.width;
  const depth = sized.depth ?? placed.depth;
  const height = sized.height;
  // The recipe is analytic; a mesh more than a hair off means a boolean went wrong.
  if (Math.abs(width - placed.width) > 0.25 || Math.abs(depth - placed.depth) > 0.25 || Math.abs(height - placed.height) > 0.25) {
    return null;
  }
  return canonicalizeShape({
    ...sized,
    importedMesh: {
      positions: placed.positions,
      normals: placed.normals,
      indices: placed.indices,
      baseWidth: width,
      baseDepth: depth,
      baseHeight: height,
      triangleCount: Math.floor(placed.indices.length / 3),
      sourceFormat: "json",
    },
    cadBrep,
    cadBrepFrame: {
      x: sized.x,
      z: sized.z,
      elevation: sized.elevation ?? 0,
      width,
      depth,
      height,
    },
    cadPrimitiveFrame: undefined,
    cadDisplayEdges: undefined,
    cadDisplayEdgesVersion: undefined,
    gridfinityBuilt: builtKey,
  });
}

/** Job payload for the native kernel (`type: "buildRecipe"`). */
export function serializeGridfinityBuildJob(shape: WorkplaneShape): { type: "buildRecipe"; recipe: GridfinityRecipe; name: string; key: string } | null {
  const recipe = gridfinityRecipeForShape(shape);
  const key = gridfinityShapeKey(shape);
  if (!recipe || !key) return null;
  return { type: "buildRecipe", recipe, name: shape.name, key };
}

/**
 * Build the exact body for a Gridfinity shape: MintrKernel.exe when present, the
 * OCCT worker otherwise (and brepjs in-process outside a browser).
 */
export async function buildGridfinityShape(shape: WorkplaneShape): Promise<WorkplaneShape | null> {
  if (typeof window !== "undefined") {
    const { runOcctKernelInWorker } = await import("@/lib/occtKernelClient");
    return runOcctKernelInWorker({ type: "gridfinity", shape });
  }
  return buildGridfinityShapeLocal(shape);
}

/** brepjs fallback used by the OCCT worker (and tests) when MintrKernel.exe is absent. */
export async function buildGridfinityShapeLocal(shape: WorkplaneShape): Promise<WorkplaneShape | null> {
  const recipe = gridfinityRecipeForShape(shape);
  const key = gridfinityShapeKey(shape);
  if (!recipe || !key) return null;
  const brep = await loadBrepWithOcct();
  const solid = buildRecipeSolid(brep, recipe);
  if (!brep.isValid(solid as never)) throw new Error("Gridfinity body failed validation");
  const exported = brep.toBREP(solid as never);
  if (!exported.ok || !exported.value.trim()) throw new Error("Gridfinity B-Rep export failed");
  const meshed = brep.mesh(solid as never, { tolerance: 0.08, angularTolerance: 0.25 });
  return applyGridfinityKernelMesh(shape, meshed.vertices, meshed.normals, meshed.triangles, exported.value, key);
}
