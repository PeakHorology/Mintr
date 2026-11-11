import { latheProfile } from "@/lib/generatedShapes";
import { meshInLocalFrame } from "@/lib/sketchExtrusionSolid";
import { canonicalizeShape, shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

type Point = [number, number];

/** One step of a turned outline: a straight line, or a cubic curve through two control points. */
export type RevolveStep = { to: Point; c1?: Point; c2?: Point };

/**
 * The half outline a generated turned shape is spun from, as [radius, height] from the axis at the
 * bottom round to the axis at the top. It closes back down the axis. Both engines build from this,
 * so the browser and the desktop app turn the same solid.
 */
export type RevolveOutline = { start: Point; steps: RevolveStep[]; scaleZ: number };

export function generatedRevolveOutline(shape: WorkplaneShape): RevolveOutline | null {
  if (!shape.generated) return null;
  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const profile = latheProfile(shape.generated, width, shape.height);
  if (!profile || profile.length < 3 || width <= 0) return null;
  const scaleZ = depth / width;
  if (shape.generated.form === "paraboloid") {
    // The curve from rim to tip is exactly one quadratic: its control point is half way in, level with the tip.
    const radius = width / 2;
    const rim: Point = [radius, 0];
    const tip: Point = [0, shape.height];
    const control: Point = [radius / 2, shape.height];
    const third = (from: Point): Point => [from[0] + (2 / 3) * (control[0] - from[0]), from[1] + (2 / 3) * (control[1] - from[1])];
    return { start: profile[0], steps: [{ to: rim }, { to: tip, c1: third(rim), c2: third(tip) }], scaleZ };
  }
  return { start: profile[0], steps: profile.slice(1).map((to) => ({ to })), scaleZ };
}

/** The desktop engine's job for a turned shape. */
export function serializeGeneratedRevolveJob(shape: WorkplaneShape) {
  const outline = generatedRevolveOutline(shape);
  return outline ? { type: "buildRevolve" as const, revolve: outline } : null;
}

/** A turned shape with its exact solid and the mesh made from it, kept where it was. */
export function applyGeneratedRevolveMesh(
  shape: WorkplaneShape,
  positions: ArrayLike<number>,
  normals: ArrayLike<number> | undefined,
  indices: ArrayLike<number>,
  cadBrep: string,
): WorkplaneShape | null {
  if (!cadBrep.trim()) return null;
  const placed = meshInLocalFrame(Float32Array.from(positions), Float32Array.from(normals ?? []), Uint32Array.from(indices));
  if (!placed) return null;
  return canonicalizeShape({
    ...shape,
    importedMesh: {
      positions: placed.positions,
      normals: placed.normals,
      indices: placed.indices,
      baseWidth: placed.width,
      baseDepth: placed.depth,
      baseHeight: placed.height,
      triangleCount: Math.floor(placed.indices.length / 3),
      sourceFormat: "json",
    },
    cadBrep,
    cadBrepFrame: { x: placed.centerX, z: placed.centerZ, elevation: placed.elevation, width: placed.width, depth: placed.depth, height: placed.height },
  });
}
