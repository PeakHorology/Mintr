import type { CadPlanarFace } from "@/lib/cadModifierTypes";
import type { EdgeFingerprint, EdgeTreatmentFeature, PartFeature, PartFeatureFrame, WorkplaneShape } from "@/types/sketchforge";

/**
 * Steps a part remembers (docs/FEATURE-HISTORY.md). They are written next to the baked
 * result, so recording one never changes the part; `featureReplay.ts` rebuilds from them.
 */

type Vec3 = [number, number, number];

/** Bottom centre and size of the box around some world-space polylines (flat x,y,z lists). */
export function frameFromPoints(lists: ReadonlyArray<ArrayLike<number>>): PartFeatureFrame | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const points of lists) {
    for (let index = 0; index + 2 < points.length; index += 3) {
      minX = Math.min(minX, points[index]);
      minY = Math.min(minY, points[index + 1]);
      minZ = Math.min(minZ, points[index + 2]);
      maxX = Math.max(maxX, points[index]);
      maxY = Math.max(maxY, points[index + 1]);
      maxZ = Math.max(maxZ, points[index + 2]);
    }
  }
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return undefined;
  return {
    origin: [(minX + maxX) / 2, minY, (minZ + maxZ) / 2],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

/** World point to millimetres from the frame's bottom centre. */
export function toFrame(point: Vec3, frame: PartFeatureFrame): Vec3 {
  return [point[0] - frame.origin[0], point[1] - frame.origin[1], point[2] - frame.origin[2]];
}

/**
 * A point measured in `recorded` to the world, for a solid that now sits in `live`. A part
 * that was resized since scales the point along each axis with it.
 */
export function fromFrame(point: Vec3, recorded: PartFeatureFrame, live: PartFeatureFrame): Vec3 {
  const scale = (axis: 0 | 1 | 2) => (recorded.size[axis] > 1e-6 ? live.size[axis] / recorded.size[axis] : 1);
  return [
    live.origin[0] + point[0] * scale(0),
    live.origin[1] + point[1] * scale(1),
    live.origin[2] + point[2] * scale(2),
  ];
}

function fingerprintToFrame(print: EdgeFingerprint, frame: PartFeatureFrame): EdgeFingerprint {
  return {
    ...print,
    mid: toFrame(print.mid, frame),
    ...(print.centroid ? { centroid: toFrame(print.centroid, frame) } : {}),
  };
}

/** A stored edge fingerprint placed back in the world, on the solid now in `live`. */
export function fingerprintFromFrame(print: EdgeFingerprint, recorded: PartFeatureFrame, live: PartFeatureFrame): EdgeFingerprint {
  const lengthScale = recorded.size.some((size) => size > 1e-6)
    ? Math.max(...live.size) / Math.max(1e-6, ...recorded.size)
    : 1;
  return {
    ...print,
    mid: fromFrame(print.mid, recorded, live),
    ...(print.centroid ? { centroid: fromFrame(print.centroid, recorded, live) } : {}),
    length: print.length * lengthScale,
  };
}

/**
 * A fillet or chamfer as a step. `recipe.edgeFingerprints` are in world space, and `solidEdges`
 * are the edges of the solid it was applied to, which place the step on the part.
 */
export function edgeTreatmentPartFeature(
  id: string,
  recipe: EdgeTreatmentFeature,
  solidEdges: ReadonlyArray<{ points: ArrayLike<number> }>,
): PartFeature {
  const prints = recipe.edgeFingerprints ?? [];
  const frame = frameFromPoints(solidEdges.map((edge) => edge.points));
  const sharpAngle = recipe.sharpAngle ?? 25;
  // Picked edges stay picked even when the solid's edges were not to hand: without a frame the
  // step is kept as a record (in world space) but is not replayed.
  const picked = !recipe.allEdges && prints.length > 0;
  return {
    id,
    kind: recipe.kind,
    amount: recipe.amount,
    ...(recipe.kind === "chamfer" && recipe.chamferAngle !== undefined ? { chamferAngle: recipe.chamferAngle } : {}),
    ...(recipe.kind === "fillet" && recipe.filletProfile ? { filletProfile: recipe.filletProfile } : {}),
    edges: picked
      ? { rule: "picked", sharpAngle, fingerprints: frame ? prints.map((print) => fingerprintToFrame(print, frame)) : prints }
      : { rule: "allSharp", sharpAngle },
    ...(frame ? { frame } : {}),
    ...(recipe.quality ? { quality: recipe.quality } : {}),
  };
}

/**
 * Steps for a part saved before steps were recorded, from the copies it kept before each
 * fillet or chamfer: the first copy becomes the base. Only parts whose copies were not turned
 * or mirrored are converted (their box places each step exactly), and only when the copies
 * and the part's fillets and chamfers line up one to one. Others are returned unchanged.
 */
export function stepsFromSnapshots(shape: WorkplaneShape): WorkplaneShape {
  const entries = shape.edgeTreatmentHistory ?? [];
  const treatments = shape.edgeTreatments ?? [];
  if (!entries.length || shape.features?.length || entries.length !== treatments.length) return shape;
  if (entries.some((entry, index) => entry.feature.kind !== treatments[index].kind || Math.abs(entry.feature.amount - treatments[index].amount) > 1e-6)) {
    return shape;
  }
  const square = (before: WorkplaneShape) => !before.rotation && !before.rotationX && !before.rotationZ && !before.mirrorX && !before.mirrorY && !before.mirrorZ;
  if (!entries.every((entry) => square(entry.before))) return shape;
  const features = entries.map((entry): PartFeature => {
    const frame = shapeBoxFrame(entry.before);
    const corners = [
      [frame.origin[0] - frame.size[0] / 2, frame.origin[1], frame.origin[2] - frame.size[2] / 2],
      [frame.origin[0] + frame.size[0] / 2, frame.origin[1] + frame.size[1], frame.origin[2] + frame.size[2] / 2],
    ].flat();
    const step = edgeTreatmentPartFeature(entry.id, entry.feature, [{ points: corners }]);
    const applied = entry.appliedFrame;
    return applied ? { ...step, appliedAt: [applied.x, applied.elevation, applied.z] } : step;
  });
  if (!stepsCanReplay(features)) return shape;
  const next: WorkplaneShape = {
    ...shape,
    features,
    ...(shape.groupedShapes?.length ? {} : { featureBase: featureBaseSnapshot(entries[0].before) }),
  };
  delete next.edgeTreatmentHistory;
  return next;
}

/** `before` is the part that was hollowed; its box places the step. */
export function hollowPartFeature(
  id: string,
  settings: { thickness: number; openings: Array<"top" | "bottom" | "front" | "back" | "left" | "right">; corners: "sharp" | "round"; cornerRadius: number },
  before?: WorkplaneShape,
): PartFeature {
  return {
    id,
    kind: "hollow",
    thickness: settings.thickness,
    openings: [...settings.openings],
    corners: settings.corners,
    cornerRadius: settings.cornerRadius,
    ...(before ? { frame: shapeBoxFrame(before) } : {}),
  };
}

/** The frame of an unturned part from its pose: bottom centre and size. */
export function shapeBoxFrame(shape: WorkplaneShape): PartFeatureFrame {
  return {
    origin: [shape.x, shape.elevation ?? 0, shape.z],
    size: [shape.width, shape.height, shape.depth],
  };
}

/** Frame of a solid from its flat faces, for steps picked on a face. */
export function frameFromFaces(faces: readonly CadPlanarFace[]): PartFeatureFrame | undefined {
  return frameFromPoints(faces.map((face) => face.points));
}

/** `face` is the picked face and `faces` every flat face of the solid, in world space. */
export function pushPullPartFeature(id: string, face: CadPlanarFace, distance: number, faces: readonly CadPlanarFace[]): PartFeature {
  const frame = frameFromFaces(faces) ?? { origin: [0, 0, 0], size: [0, 0, 0] };
  return {
    id,
    kind: "pushPull",
    face: {
      origin: toFrame([face.origin.x, face.origin.y, face.origin.z], frame),
      normal: [face.normal.x, face.normal.y, face.normal.z],
      area: face.area,
    },
    distance,
    frame,
  };
}

/** A copy of `shape` that is only kept to replay steps on: no undo snapshots, no nested base. */
export function featureBaseSnapshot(shape: WorkplaneShape): WorkplaneShape {
  const base: WorkplaneShape = { ...shape };
  delete base.features;
  delete base.featureBase;
  delete base.edgeTreatments;
  delete base.edgeTreatmentHistory;
  delete base.threadHistory;
  return base;
}

/**
 * `shape` with `feature` added after the steps `before` already had. The first step on a
 * part that is not a group keeps `before` as the base to replay on.
 */
export function withPartFeature(shape: WorkplaneShape, before: WorkplaneShape, feature: PartFeature): WorkplaneShape {
  const earlier = before.features ?? [];
  const base = before.featureBase ?? (earlier.length === 0 && !before.groupedShapes?.length ? featureBaseSnapshot(before) : undefined);
  const appliedAt: Vec3 = [shape.x, shape.elevation ?? 0, shape.z];
  return {
    ...shape,
    features: [...earlier, { ...feature, appliedAt }],
    ...(base ? { featureBase: base } : {}),
  };
}

/**
 * The recorded steps for the part's fillets and chamfers, marked as failed, for the recipes at
 * `failedIndexes` in `shape.edgeTreatments`. Parts from before steps were recorded have none.
 */
export function failedEdgeTreatmentFeatures(shape: WorkplaneShape, failedIndexes: readonly number[]): PartFeature[] {
  const recorded = (shape.features ?? []).filter((feature) => feature.kind === "fillet" || feature.kind === "chamfer");
  if (recorded.length !== (shape.edgeTreatments?.length ?? 0)) return [];
  return failedIndexes.flatMap((index) => {
    const feature = recorded[index];
    return feature ? [{ ...feature, failed: "These edges could not be found after the part changed." }] : [];
  });
}

/** Steps other than fillets and chamfers, for re-applying edge treatments without stacking them twice. */
export function withoutEdgeTreatmentFeatures(features: readonly PartFeature[] | undefined): PartFeature[] | undefined {
  const kept = (features ?? []).filter((feature) => feature.kind !== "fillet" && feature.kind !== "chamfer");
  return kept.length ? kept : undefined;
}

/**
 * A part keeps its steps' sizes when it is resized (a 1 mm fillet stays 1 mm, a 1.5 mm wall
 * stays 1.5 mm) unless it was set to stretch with the part.
 */
export function rebuildsOnResize(shape: WorkplaneShape): boolean {
  return Boolean(
    shape.features?.length
      && shape.featureBase
      && !shape.groupedShapes?.length
      // A base that was turned when its first step was made does not grow along the part's axes.
      && !shape.featureBase.rotation && !shape.featureBase.rotationX && !shape.featureBase.rotationZ
      && (shape.edgeResizeMode ?? "preserve") === "preserve"
      && stepsCanReplay(shape.features),
  );
}

/** Size the part had when its steps were last baked, or undefined if it never was. */
export function bakedPartSize(shape: WorkplaneShape): Vec3 | undefined {
  const frame = shape.cadBrepFrame;
  if (frame) return [frame.width, frame.height, frame.depth];
  const mesh = shape.importedMesh;
  return mesh ? [mesh.baseWidth, mesh.baseHeight, mesh.baseDepth] : undefined;
}

/**
 * The base grown by as much as the finished part was: steps add the same amount whatever
 * the part's size, so a 26 mm part (20 mm box + 6 mm pull) resized to 30 mm needs a 24 mm box.
 */
export function resizedFeatureBase(base: WorkplaneShape, baked: Vec3, live: Vec3): WorkplaneShape {
  const grow = (own: number, axis: 0 | 1 | 2) => Math.max(0.1, own + live[axis] - baked[axis]);
  const width = grow(base.width, 0);
  const depth = grow(base.depth, 2);
  return { ...base, width, depth, height: grow(base.height, 1), size: Math.max(width, depth) };
}

/**
 * Every step can be rebuilt from a starting shape (the stored base, or a group's own pieces),
 * so earlier states come from replaying steps and no copy of the part is kept per step.
 */
export function stepsReplaceSnapshots(shape: WorkplaneShape): boolean {
  return Boolean(shape.features?.length && (shape.featureBase || shape.groupedShapes?.length) && stepsCanReplay(shape.features));
}

/** The part has fillets, chamfers or other steps to put back after its pieces are rebuilt. */
export function hasPartSteps(shape: WorkplaneShape): boolean {
  return Boolean(shape.edgeTreatments?.length || shape.features?.length);
}

/** Every step carries what replay needs to find it again (steps from the first 1.1.9.5 builds may not). */
export function stepsCanReplay(features: readonly PartFeature[]): boolean {
  return features.every((feature) => feature.kind === "hollow" || Boolean(feature.frame) || (feature.kind !== "pushPull" && feature.edges.rule === "allSharp"));
}

/**
 * The `edgeTreatments` list guides and older Mintr read, rewritten from the steps: one entry
 * per fillet or chamfer that is on the part. An entry keeps what was stored for its step
 * before (its edge fingerprints) and takes the step's current size.
 */
export function edgeTreatmentsForSteps(features: readonly PartFeature[], previous: WorkplaneShape): EdgeTreatmentFeature[] | undefined {
  const previousTreatments = previous.edgeTreatments ?? [];
  const previousSteps = (previous.features ?? []).filter((feature) => feature.kind === "fillet" || feature.kind === "chamfer");
  const aligned = previousSteps.length === previousTreatments.length;
  const out: EdgeTreatmentFeature[] = [];
  for (const feature of features) {
    if (feature.kind !== "fillet" && feature.kind !== "chamfer") continue;
    if (feature.suppressed || feature.failed) continue;
    const index = aligned ? previousSteps.findIndex((step) => step.id === feature.id) : -1;
    const stored = index >= 0 ? previousTreatments[index] : undefined;
    const edgeCount = feature.edges.rule === "picked" ? feature.edges.fingerprints.length : (stored?.edgeCount ?? 0);
    out.push({
      ...(stored ?? {}),
      kind: feature.kind,
      amount: feature.amount,
      edgeCount,
      sharpAngle: feature.edges.sharpAngle,
      allEdges: feature.edges.rule === "allSharp" || undefined,
      ...(feature.kind === "chamfer" ? { chamferAngle: feature.chamferAngle ?? 45 } : {}),
      ...(feature.kind === "fillet" && feature.filletProfile === "cove" ? { filletProfile: "cove" as const } : {}),
      ...(feature.quality ? { quality: feature.quality } : {}),
    });
  }
  return out.length ? out : undefined;
}

/** The one size a step is edited by: fillet or chamfer amount, wall thickness, or push distance. */
export function partStepSize(feature: PartFeature): number {
  if (feature.kind === "hollow") return feature.thickness;
  if (feature.kind === "pushPull") return feature.distance;
  return feature.amount;
}

export function withPartStepSize(feature: PartFeature, sizeMm: number): PartFeature {
  if (feature.kind === "hollow") return { ...feature, thickness: sizeMm };
  if (feature.kind === "pushPull") return { ...feature, distance: sizeMm };
  return { ...feature, amount: sizeMm };
}

export function partFeatureLabel(feature: PartFeature, formatMm: (mm: number) => string = (mm) => `${Number(mm.toFixed(2))} mm`): string {
  if (feature.kind === "hollow") return `Hollow ${formatMm(feature.thickness)}`;
  if (feature.kind === "pushPull") return `${feature.distance < 0 ? "Push" : "Pull"} ${formatMm(Math.abs(feature.distance))}`;
  const name = feature.kind === "chamfer" ? "Chamfer" : feature.filletProfile === "cove" ? "Concave fillet" : "Fillet";
  const edges = feature.edges.rule === "allSharp"
    ? "all sharp edges"
    : `${feature.edges.fingerprints.length} edge${feature.edges.fingerprints.length === 1 ? "" : "s"}`;
  return `${name} ${formatMm(feature.amount)}, ${edges}`;
}
