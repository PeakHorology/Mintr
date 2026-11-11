import { sketchDocToProfile } from "@/lib/sketch";
import type { SketchDoc } from "@/lib/sketch/types";
import { withExactSketchExtrusionSolid } from "@/lib/sketchExtrusionSolid";
import { featureBaseSnapshot } from "@/lib/partFeatures";
import { isFaceHostedSketch } from "@/lib/sketchPlane";
import { shapeFromSketchProfile } from "@/lib/sketchProfileShape";
import { shapeFromSketchRevolve } from "@/lib/sketchRevolve";
import type { WorkplaneShape } from "@/types/sketchforge";

export type SketchRebuild =
  | { ok: true; shape: WorkplaneShape }
  | { ok: false; message: string };

/**
 * A sketched part built again from a changed sketch, the same way it was finished: extruded,
 * or revolved around the same axis. A sweep's path lives on another sheet, so it is changed by
 * opening the sketch. `exact` swaps an extrusion's mesh for its exact solid.
 */
export async function rebuildSketchedShape(
  shape: WorkplaneShape,
  doc: SketchDoc,
  options: { exact?: boolean } = {},
): Promise<SketchRebuild> {
  const profile = sketchDocToProfile(doc);
  profile.sketchPlane = shape.sketchPlane ?? profile.sketchPlane;
  const cutIntoFace = Boolean(shape.hole && isFaceHostedSketch(shape.sketchPlane, shape.sketchProfile?.faceReferenceLoops));

  if (shape.sketchFinish === "sweep") {
    return { ok: false, message: "A sweep's sizes are changed in its sketch. Open the sketch to change them." };
  }

  if (shape.sketchFinish === "revolve") {
    const stored = shape.sketchRevolveAxis;
    if (!stored) return { ok: false, message: "Open the sketch and revolve it again to change its sizes." };
    const axis = { start: { x: stored.x1, z: stored.z1 }, end: { x: stored.x2, z: stored.z2 } };
    const revolved = shapeFromSketchRevolve(profile, axis, shape);
    if (!revolved) return { ok: false, message: "That size makes the outline cross its axis, so it cannot be revolved." };
    const before = shape.sketchDoc ? shapeFromSketchRevolve(sketchDocToProfile(shape.sketchDoc), axis, shape) : null;
    return { ok: true, shape: keepPartState(revolved, shape, before, doc) };
  }

  const existing = { ...shape, sketchDoc: doc, sketchId: shape.sketchId ?? doc.id };
  const rebuilt = shapeFromSketchProfile(profile, shape.height, existing, { cutIntoFace });
  if (!rebuilt) return { ok: false, message: "Could not rebuild the sketch after that change." };
  const before = shape.sketchDoc
    ? shapeFromSketchProfile({ ...sketchDocToProfile(shape.sketchDoc), sketchPlane: profile.sketchPlane }, shape.height, existing, { cutIntoFace })
    : null;
  rebuilt.sketchDoc = doc;
  const built = options.exact ? await withExactSketchExtrusionSolid(rebuilt, shape.height, { cutIntoFace }) : rebuilt;
  return { ok: true, shape: keepPartState(built, shape, before, doc) };
}

/**
 * A new sketch makes a new body, but it is still this part: where it was moved and turned to, its
 * finish and laser job, and its steps, which replay on the new body. `before` is the old sketch
 * built the same way, to tell how far the part has been moved since it was drawn.
 */
function keepPartState(rebuilt: WorkplaneShape, shape: WorkplaneShape, before: WorkplaneShape | null, doc: SketchDoc): WorkplaneShape {
  const moved = before
    ? { x: shape.x - before.x, z: shape.z - before.z, elevation: (shape.elevation ?? 0) - (before.elevation ?? 0) }
    : { x: 0, z: 0, elevation: 0 };
  const placed: WorkplaneShape = {
    ...rebuilt,
    x: rebuilt.x + moved.x,
    z: rebuilt.z + moved.z,
    elevation: (rebuilt.elevation ?? 0) + moved.elevation,
    rotation: shape.rotation,
    rotationX: shape.rotationX,
    rotationZ: shape.rotationZ,
    mirrorX: shape.mirrorX,
    mirrorY: shape.mirrorY,
    mirrorZ: shape.mirrorZ,
    name: shape.name,
    hole: shape.hole,
    color: shape.color,
    solidColor: shape.solidColor,
    locked: shape.locked,
    hidden: shape.hidden,
    laserJob: shape.laserJob,
    surfaceTexture: shape.surfaceTexture,
    sketchDoc: doc,
    sketchPlane: shape.sketchPlane ?? rebuilt.sketchPlane,
    values: shape.values,
    drivenBy: shape.drivenBy,
  };
  if (!shape.features?.length) return placed;
  return {
    ...placed,
    features: shape.features,
    edgeTreatments: shape.edgeTreatments,
    // The steps now start from the new body, not the old one.
    featureBase: featureBaseSnapshot(placed),
  };
}
