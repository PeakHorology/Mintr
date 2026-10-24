import type { Brep, BrepSolid } from "@/lib/brepKernel";
import type { GridfinityRecipe, RecipeOp, RecipeSection, RecipeSolid } from "@/lib/gridfinity";

/**
 * brepjs (OCCT WASM) interpreter for generator recipes. Mirrors
 * native/mintr-kernel/src/recipe.cpp — keep the two in step.
 */

const EPS = 1e-6;

type Plane = {
  origin: [number, number, number];
  xDir: [number, number, number];
  yDir: [number, number, number];
  zDir: [number, number, number];
};

/**
 * Plane whose (u, v) are world (x, z) at height y. brepjs lifts 2D curves with
 * gp_Ax3(origin, zDir, xDir), so yDir is always zDir × xDir; the normal has to
 * point -Y for v to land on +Z (extrusion directions are passed explicitly).
 */
function xzPlaneAt(y: number): Plane {
  return { origin: [0, y, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], zDir: [0, -1, 0] };
}

function fail(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return fallback;
}

function sectionsEqual(a: RecipeSection, b: RecipeSection) {
  return Math.abs(a.x0 - b.x0) < EPS
    && Math.abs(a.x1 - b.x1) < EPS
    && Math.abs(a.z0 - b.z0) < EPS
    && Math.abs(a.z1 - b.z1) < EPS
    && a.r.every((r, i) => Math.abs(r - b.r[i]) < EPS);
}

/** Closed rounded-rectangle drawing in (u = x, v = z) with per-corner radii. */
function roundedRectDrawing(brep: Brep, s: RecipeSection) {
  const [r00, r10, r11, r01] = s.r.map((r) => Math.max(0, Math.min(r, (s.x1 - s.x0) / 2 - EPS, (s.z1 - s.z0) / 2 - EPS)));
  const k = Math.SQRT1_2;
  let pen = brep.draw([s.x0 + r00, s.z0]);
  pen = pen.lineTo([s.x1 - r10, s.z0]);
  if (r10 > EPS) pen = pen.threePointsArcTo([s.x1, s.z0 + r10], [s.x1 - r10 + r10 * k, s.z0 + r10 - r10 * k]);
  pen = pen.lineTo([s.x1, s.z1 - r11]);
  if (r11 > EPS) pen = pen.threePointsArcTo([s.x1 - r11, s.z1], [s.x1 - r11 + r11 * k, s.z1 - r11 + r11 * k]);
  pen = pen.lineTo([s.x0 + r01, s.z1]);
  if (r01 > EPS) pen = pen.threePointsArcTo([s.x0, s.z1 - r01], [s.x0 + r01 - r01 * k, s.z1 - r01 + r01 * k]);
  pen = pen.lineTo([s.x0, s.z0 + r00]);
  if (r00 > EPS) pen = pen.threePointsArcTo([s.x0 + r00, s.z0], [s.x0 + r00 - r00 * k, s.z0 + r00 - r00 * k]);
  return pen.close();
}

function buildStack(brep: Brep, sections: RecipeSection[]): BrepSolid {
  const sorted = [...sections].sort((a, b) => a.y - b.y);
  if (sorted.length < 2) throw new Error("stack needs two sections");
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const height = last.y - first.y;
  if (height <= EPS) throw new Error("stack has no height");
  if (sorted.every((s) => sectionsEqual(s, first))) {
    const sketch = brep.drawingToSketchOnPlane(roundedRectDrawing(brep, first), xzPlaneAt(first.y) as never);
    return brep.sketchExtrude(sketch as never, height, { extrusionDirection: [0, 1, 0] }) as unknown as BrepSolid;
  }
  const wires = sorted.map((s) => {
    const sketch = brep.drawingToSketchOnPlane(roundedRectDrawing(brep, s), xzPlaneAt(s.y) as never);
    return brep.sketchWires(sketch as never);
  });
  const lofted = brep.loft(wires as never, { ruled: true });
  if (!lofted.ok) throw new Error(fail(lofted.error, "stack loft failed"));
  return lofted.value as unknown as BrepSolid;
}

function buildPrism(brep: Brep, solid: Extract<RecipeSolid, { kind: "prism" }>): BrepSolid {
  const length = solid.a1 - solid.a0;
  if (length <= EPS) throw new Error("prism has no length");
  let pen = brep.draw(solid.start);
  for (const step of solid.steps) {
    pen = step.kind === "arc" ? pen.threePointsArcTo(step.to, step.mid) : pen.lineTo(step.to);
  }
  const drawing = pen.close();
  // (u, v) = (z, y) for an X-axis prism and (x, y) for a Z-axis prism; see xzPlaneAt
  // for why the normal is chosen so that zDir × xDir = +Y.
  const plane: Plane = solid.axis === "x"
    ? { origin: [solid.a0, 0, 0], xDir: [0, 0, 1], yDir: [0, 1, 0], zDir: [-1, 0, 0] }
    : { origin: [0, 0, solid.a0], xDir: [1, 0, 0], yDir: [0, 1, 0], zDir: [0, 0, 1] };
  const sketch = brep.drawingToSketchOnPlane(drawing, plane as never);
  return brep.sketchExtrude(sketch as never, length, {
    extrusionDirection: solid.axis === "x" ? [1, 0, 0] : [0, 0, 1],
  }) as unknown as BrepSolid;
}

export function buildRecipeSolidPart(brep: Brep, solid: RecipeSolid): BrepSolid {
  switch (solid.kind) {
    case "stack":
      return buildStack(brep, solid.sections);
    case "cylinder": {
      const h = solid.y1 - solid.y0;
      if (h <= EPS || solid.r <= EPS) throw new Error("cylinder is degenerate");
      return brep.cylinder(solid.r, h, { at: [solid.cx, solid.y0, solid.cz], axis: [0, 1, 0] }) as unknown as BrepSolid;
    }
    case "cone": {
      const h = solid.y1 - solid.y0;
      const r0 = Math.max(0, solid.r0);
      const r1 = Math.max(0, solid.r1);
      if (h <= EPS || (r0 <= EPS && r1 <= EPS)) throw new Error("cone is degenerate");
      const at: [number, number, number] = [solid.cx, solid.y0, solid.cz];
      if (Math.abs(r0 - r1) < EPS) return brep.cylinder(r0, h, { at, axis: [0, 1, 0] }) as unknown as BrepSolid;
      return brep.cone(r0, r1, h, { at, axis: [0, 1, 0] }) as unknown as BrepSolid;
    }
    case "box": {
      const w = solid.x1 - solid.x0;
      const h = solid.y1 - solid.y0;
      const d = solid.z1 - solid.z0;
      if (w <= EPS || h <= EPS || d <= EPS) throw new Error("box is degenerate");
      return brep.box(w, h, d, { centered: true, at: [(solid.x0 + solid.x1) / 2, (solid.y0 + solid.y1) / 2, (solid.z0 + solid.z1) / 2] }) as unknown as BrepSolid;
    }
    case "prism":
      return buildPrism(brep, solid);
    default:
      throw new Error("unknown recipe solid");
  }
}

/** Group consecutive ops of the same kind so each boolean runs once per batch. */
function batches(ops: RecipeOp[]): Array<{ op: RecipeOp["op"]; solids: RecipeSolid[] }> {
  const out: Array<{ op: RecipeOp["op"]; solids: RecipeSolid[] }> = [];
  for (const entry of ops) {
    const last = out[out.length - 1];
    if (last && last.op === entry.op) last.solids.push(entry.solid);
    else out.push({ op: entry.op, solids: [entry.solid] });
  }
  return out;
}

/** Build the recipe body in its local frame (resting on y = 0, centred on X/Z). */
export function buildRecipeSolid(brep: Brep, recipe: GridfinityRecipe): BrepSolid {
  if (!recipe.ops.length || recipe.ops[0].op !== "add") throw new Error("recipe must start with a solid");
  let acc: BrepSolid | null = null;
  for (const batch of batches(recipe.ops)) {
    const parts = batch.solids.map((solid) => buildRecipeSolidPart(brep, solid));
    if (!acc) {
      if (batch.op !== "add") throw new Error("recipe must start with a solid");
      const fused = parts.length === 1 ? { ok: true as const, value: parts[0] } : brep.fuseAll(parts as never);
      if (!fused.ok) throw new Error(fail((fused as { error: unknown }).error, "recipe fuse failed"));
      acc = fused.value as unknown as BrepSolid;
      continue;
    }
    if (batch.op === "add") {
      const fused = brep.fuseAll([acc, ...parts] as never);
      if (!fused.ok) throw new Error(fail(fused.error, "recipe fuse failed"));
      acc = fused.value as unknown as BrepSolid;
    } else {
      const cut = brep.cutAll(acc as never, parts as never);
      if (!cut.ok) throw new Error(fail(cut.error, "recipe cut failed"));
      acc = cut.value as unknown as BrepSolid;
    }
  }
  if (!acc) throw new Error("empty recipe");
  return acc;
}
