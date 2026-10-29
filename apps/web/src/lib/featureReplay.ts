import type { CadModifierEdge, CadPlanarFace } from "@/lib/cadModifierTypes";
import { matchRecipeEdgeIds } from "@/lib/edgeTreatmentRematch";
import { fingerprintFromFrame, frameFromFaces, frameFromPoints, fromFrame, shapeBoxFrame } from "@/lib/partFeatures";
import type { PartFeature, PartFeatureFrame, WorkplaneShape } from "@/types/sketchforge";

/**
 * Rebuilds a part from its steps (docs/FEATURE-HISTORY.md, stage 2). Each step runs through
 * the same engine calls the live tool used, on the solid the steps before it produced. Edges
 * and faces are found again by where they sit on the solid, not by number, so a step still
 * lands after the part was moved or resized. A step that no longer fits is marked and skipped,
 * and the rest of the part still rebuilds.
 */

export type ReplayPrepared = {
  edges: CadModifierEdge[];
  planarFaces: CadPlanarFace[];
};

/** The engine calls replay needs. The editor answers them with the live tools' own requests. */
export type ReplayEngine = {
  prepare: (shape: WorkplaneShape, sharpAngle: number) => Promise<ReplayPrepared>;
  edgeTreatment: (
    shape: WorkplaneShape,
    step: {
      kind: "fillet" | "chamfer";
      edgeIds: number[];
      amount: number;
      chamferAngle: number;
      filletProfile: "round" | "cove";
      quality: "draft" | "standard" | "fine" | "ultra";
    },
  ) => Promise<WorkplaneShape>;
  hollow: (
    shape: WorkplaneShape,
    step: { thickness: number; openings: Array<"top" | "bottom" | "front" | "back" | "left" | "right">; corners: "sharp" | "round"; cornerRadius: number },
  ) => Promise<WorkplaneShape>;
  pushPull: (shape: WorkplaneShape, step: { faceId: number; distance: number }) => Promise<WorkplaneShape>;
};

export type ReplayStep = { id: string; ok: boolean; skipped?: boolean; message?: string };

export type ReplayResult = {
  shape: WorkplaneShape;
  /** The steps again, with `failed` set on any that no longer fit and cleared on the rest. */
  features: PartFeature[];
  steps: ReplayStep[];
  /**
   * Where the last step that ran put the part, measured as the recorded world would see it.
   * `placeReplayedShape` uses it to put the rebuilt part where the old one is now.
   */
  lastApplied: { recordedAt: [number, number, number]; drift: [number, number, number] } | null;
};

const PUSH_PULL_PREPARE_ANGLE = 12;

function stepFailure(feature: PartFeature, message: string): PartFeature {
  return { ...feature, failed: message };
}

function stepCleared(feature: PartFeature): PartFeature {
  if (!feature.failed) return feature;
  const next = { ...feature };
  delete next.failed;
  return next;
}

/** Edges the live tool lets a person pick, as `selectableCadModifierEdge`. */
function pickableEdges(edges: readonly CadModifierEdge[], sharpAngle: number) {
  return edges.filter((edge) => edge.display && edge.selectable && edge.manifold && !edge.boundary && edge.angle + 1e-3 >= sharpAngle);
}

/** Edges of the live solid that a stored fillet or chamfer should go on, or null. */
export function edgesForStep(feature: Extract<PartFeature, { kind: "fillet" | "chamfer" }>, prepared: ReplayPrepared): number[] | null {
  const sharpAngle = feature.edges.sharpAngle;
  const pickable = pickableEdges(prepared.edges, sharpAngle);
  if (feature.edges.rule === "allSharp") {
    return pickable.length ? pickable.map((edge) => edge.id) : null;
  }
  const recorded = feature.frame;
  const live = frameFromPoints(prepared.edges.map((edge) => edge.points));
  if (!recorded || !live) return null;
  const fingerprints = feature.edges.fingerprints.map((print) => fingerprintFromFrame(print, recorded, live));
  const ids = matchRecipeEdgeIds({ edgeCount: fingerprints.length, edgeFingerprints: fingerprints }, pickable, sharpAngle);
  return ids.length === fingerprints.length ? ids : null;
}

/** The live flat face a stored push or pull was made on, or null. */
export function faceForStep(feature: Extract<PartFeature, { kind: "pushPull" }>, faces: readonly CadPlanarFace[]): CadPlanarFace | null {
  const recorded = feature.frame;
  const live = frameFromFaces(faces);
  if (!recorded || !live) return null;
  const target = fromFrame(feature.face.origin, recorded, live);
  const [nx, ny, nz] = feature.face.normal;
  const reach = Math.max(1e-3, ...live.size);
  let best: { face: CadPlanarFace; score: number } | null = null;
  let runnerUp = Number.POSITIVE_INFINITY;
  for (const face of faces) {
    const alignment = face.normal.x * nx + face.normal.y * ny + face.normal.z * nz;
    if (alignment < 0.995) continue;
    const dx = face.origin.x - target[0];
    const dy = face.origin.y - target[1];
    const dz = face.origin.z - target[2];
    // Off the stored face's plane counts most; sliding along it (a resized face) counts less.
    const offPlane = Math.abs(dx * face.normal.x + dy * face.normal.y + dz * face.normal.z);
    const along = Math.hypot(dx, dy, dz);
    const score = (offPlane * 4 + along) / reach;
    if (!best || score < best.score) {
      if (best) runnerUp = best.score;
      best = { face, score };
    } else if (score < runnerUp) {
      runnerUp = score;
    }
  }
  if (!best || best.score > 0.5) return null;
  // Two equally good faces (a symmetric part) is a guess, not a match.
  if (Number.isFinite(runnerUp) && runnerUp - best.score < 0.02) return null;
  return best.face;
}

function frameDrift(recorded: PartFeatureFrame | undefined, live: PartFeatureFrame | undefined): [number, number, number] {
  if (!recorded || !live) return [0, 0, 0];
  return [recorded.origin[0] - live.origin[0], recorded.origin[1] - live.origin[1], recorded.origin[2] - live.origin[2]];
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Replay `features` on `base`, in order. Never throws for a step; only a missing engine throws. */
export async function replayPartFeatures(
  base: WorkplaneShape,
  features: readonly PartFeature[],
  engine: ReplayEngine,
): Promise<ReplayResult> {
  let current = base;
  const out: PartFeature[] = [];
  const steps: ReplayStep[] = [];
  let lastApplied: ReplayResult["lastApplied"] = null;

  for (const feature of features) {
    if (feature.suppressed) {
      out.push(stepCleared(feature));
      steps.push({ id: feature.id, ok: true, skipped: true });
      continue;
    }
    try {
      let next: WorkplaneShape;
      let drift: [number, number, number];
      if (feature.kind === "hollow") {
        await engine.prepare(current, PUSH_PULL_PREPARE_ANGLE);
        drift = frameDrift(feature.frame, shapeBoxFrame(current));
        next = await engine.hollow(current, {
          thickness: feature.thickness,
          openings: feature.openings,
          corners: feature.corners,
          cornerRadius: feature.cornerRadius,
        });
      } else if (feature.kind === "pushPull") {
        const prepared = await engine.prepare(current, PUSH_PULL_PREPARE_ANGLE);
        const face = faceForStep(feature, prepared.planarFaces);
        if (!face) {
          out.push(stepFailure(feature, "This face could not be found after the part changed."));
          steps.push({ id: feature.id, ok: false, message: out[out.length - 1].failed });
          continue;
        }
        drift = frameDrift(feature.frame, frameFromFaces(prepared.planarFaces));
        next = await engine.pushPull(current, { faceId: face.id, distance: feature.distance });
      } else {
        const prepared = await engine.prepare(current, feature.edges.sharpAngle);
        const edgeIds = edgesForStep(feature, prepared);
        if (!edgeIds) {
          out.push(stepFailure(feature, "These edges could not be found after the part changed."));
          steps.push({ id: feature.id, ok: false, message: out[out.length - 1].failed });
          continue;
        }
        drift = frameDrift(feature.frame, frameFromPoints(prepared.edges.map((edge) => edge.points)));
        next = await engine.edgeTreatment(current, {
          kind: feature.kind,
          edgeIds,
          amount: feature.amount,
          chamferAngle: feature.chamferAngle ?? 45,
          filletProfile: feature.filletProfile ?? "round",
          quality: feature.quality ?? "standard",
        });
      }
      current = next;
      out.push(stepCleared(feature));
      steps.push({ id: feature.id, ok: true });
      if (feature.appliedAt) lastApplied = { recordedAt: feature.appliedAt, drift };
    } catch (error) {
      const message = errorText(error, "This step could not be applied.");
      out.push(stepFailure(feature, message));
      steps.push({ id: feature.id, ok: false, message });
    }
  }
  return { shape: current, features: out, steps, lastApplied };
}

/**
 * Put a rebuilt part where `live` (the part it replaces) is now: moved by however far the
 * part was moved since its last step, and turned, mirrored and resized like it.
 */
export function placeReplayedShape(rebuilt: WorkplaneShape, live: WorkplaneShape, lastApplied: ReplayResult["lastApplied"]): WorkplaneShape {
  const elevation = rebuilt.elevation ?? 0;
  const shift: [number, number, number] = lastApplied
    ? [
        lastApplied.drift[0] + live.x - lastApplied.recordedAt[0],
        lastApplied.drift[1] + (live.elevation ?? 0) - lastApplied.recordedAt[1],
        lastApplied.drift[2] + live.z - lastApplied.recordedAt[2],
      ]
    : [live.x - rebuilt.x, (live.elevation ?? 0) - elevation, live.z - rebuilt.z];
  // The live part may have been stretched since it was baked; stretch the rebuilt one the same.
  const frame = live.cadBrepFrame;
  const stretch = (size: number, baked: number | undefined, own: number) => (baked && baked > 1e-6 ? own * (size / baked) : own);
  const width = stretch(live.width, frame?.width, rebuilt.width);
  const depth = stretch(live.depth, frame?.depth, rebuilt.depth);
  const height = stretch(live.height, frame?.height, rebuilt.height);
  return {
    ...rebuilt,
    id: live.id,
    name: live.name,
    color: live.color,
    hole: live.hole,
    locked: live.locked,
    hidden: live.hidden,
    x: rebuilt.x + shift[0],
    z: rebuilt.z + shift[2],
    elevation: elevation + shift[1],
    width,
    depth,
    height,
    size: Math.max(width, depth),
    rotation: live.rotation,
    rotationX: live.rotationX,
    rotationZ: live.rotationZ,
    mirrorX: live.mirrorX,
    mirrorY: live.mirrorY,
    mirrorZ: live.mirrorZ,
    ...(rebuilt.cadBrepFrame
      ? { cadBrepFrame: { ...rebuilt.cadBrepFrame, x: rebuilt.x + shift[0], z: rebuilt.z + shift[2], elevation: elevation + shift[1] } }
      : {}),
  };
}
