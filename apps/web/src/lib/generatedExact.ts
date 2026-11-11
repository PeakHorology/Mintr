import type { BrepSolid } from "@/lib/brepKernel";
import { loadBrepWithOcct } from "@/lib/brepKernel";
import { latheProfile } from "@/lib/generatedShapes";
import { applyGeneratedRevolveMesh, generatedRevolveOutline } from "@/lib/generatedRevolve";
import { withExactSketchExtrusionSolid } from "@/lib/sketchExtrusionSolid";
import { shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Swaps a generated part's quick mesh for its exact solid, so fillets, cuts and STEP files get
 * true curves. Keeps the part where it is. A part that cannot be made exact stays as it was.
 */
export async function withExactGeneratedShape(shape: WorkplaneShape): Promise<WorkplaneShape> {
  if (!shape.generated || shape.cadBrep) return shape;
  let exact = shape;
  if (shape.sketchFinish === "extrude") {
    // A rebuilt part is always the plain outline; fillets it carries are replayed on it afterwards,
    // so they must not stop it becoming exact. Without this a filleted part lost its fillet every other resize.
    const solid = await withExactSketchExtrusionSolid({ ...shape, edgeTreatments: undefined }, shape.height);
    exact = solid.cadBrep ? { ...solid, edgeTreatments: shape.edgeTreatments } : shape;
  } else if (latheProfile(shape.generated, shapeWidth(shape), shape.height)) {
    const { runOcctKernelInWorker } = await import("@/lib/occtKernelClient");
    exact = (await runOcctKernelInWorker({ type: "generatedRevolve", shape })) ?? shape;
  }
  if (exact === shape || !exact.cadBrep) return shape;
  return {
    ...exact,
    x: shape.x,
    z: shape.z,
    elevation: shape.elevation,
    rotation: shape.rotation,
    rotationX: shape.rotationX,
    rotationZ: shape.rotationZ,
    // Display rounding must not move a size someone typed.
    width: shape.width,
    depth: shape.depth,
    height: shape.height,
    size: shape.size,
  };
}

/** The turned solid, in the worker: a true curve for the paraboloid, straight lines for a screw hole. */
export async function withExactGeneratedRevolveLocal(shape: WorkplaneShape): Promise<WorkplaneShape> {
  const outline = generatedRevolveOutline(shape);
  if (!outline) return shape;
  try {
    const brep = await loadBrepWithOcct();
    let pen = brep.draw(outline.start);
    for (const step of outline.steps) {
      pen = step.c1 && step.c2 ? pen.cubicBezierCurveTo(step.to, step.c1, step.c2) : pen.lineTo(step.to);
    }
    const sketch = brep.drawingToSketchOnPlane(pen.close(), {
      origin: [0, 0, 0],
      xDir: [1, 0, 0],
      yDir: [0, 1, 0],
      zDir: [0, 0, 1],
    } as never);
    let solid = brep.sketchRevolve(sketch as never, [0, 1, 0], { origin: [0, 0, 0] }) as unknown as BrepSolid;
    if (Math.abs(outline.scaleZ - 1) > 1e-4) {
      const scaled = brep.applyMatrix(solid, { linear: [1, 0, 0, 0, 1, 0, 0, 0, outline.scaleZ], translation: [0, 0, 0] });
      if (!scaled.ok) return shape;
      solid = scaled.value as unknown as BrepSolid;
    }
    if (!brep.isValid(solid as never)) return shape;
    const exported = brep.toBREP(solid as never);
    if (!exported.ok || !exported.value.trim()) return shape;
    const meshed = brep.mesh(solid as never, { tolerance: 0.05, angularTolerance: 0.2 });
    return applyGeneratedRevolveMesh(shape, meshed.vertices, meshed.normals, meshed.triangles, exported.value) ?? shape;
  } catch {
    return shape;
  }
}
