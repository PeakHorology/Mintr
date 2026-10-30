import { faceBlindCutDepthMm, faceHoleCutDepthMm, faceHoleOvershootMm } from "@/lib/csgTree";
import { alignCoordinate, alignmentBounds, alignmentLabel } from "@/lib/editorBoolean";
import type { EditorHistoryEntry } from "@/lib/editorHistory";
import { sameEdgeFingerprints, type EdgeTreatmentFingerprint } from "@/lib/edgeTreatmentRematch";
import { isDefaultSketchPlane } from "@/lib/sketchPlane";
import { shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { AlignAxis, AlignTarget, EdgeTreatmentFeature, PartFeature, SketchPlane, SketchProfile, WorkplaneShape } from "@/types/sketchforge";

/** A checklist row the author keeps or drops. Playback expands a sketch row into several prompts. */
export type GuideStep = {
  historyIndex: number;
  label: string;
  included: boolean;
  cue: string;
  /** Pad/Pocket lessons write these into the prompt. They are not filled in for the learner. */
  insetMm?: number;
  depthMm?: number;
  /** The author's own name for the step, shown above the instruction. */
  name?: string;
  /** A hint shown under the instruction, such as "Hold Shift to keep it square". */
  tip?: string;
  /**
   * Part of the kept step before it: the learner sees one step and it is done when the last
   * folded part is. `false` keeps a step on its own that playback would otherwise fold.
   */
  fold?: boolean;
};

/** The colours people can give their name. Mint is Mintr's own, for the guides Mintr makes. */
export const GUIDE_AUTHOR_COLORS = ["red", "orange", "yellow", "green", "blue", "purple"] as const;
export type GuideAuthorColor = (typeof GUIDE_AUTHOR_COLORS)[number];

export function isGuideAuthorColor(value: unknown): value is GuideAuthorColor {
  return typeof value === "string" && (GUIDE_AUTHOR_COLORS as readonly string[]).includes(value);
}

export type MintrGuide = {
  title: string;
  author: string;
  summary: string;
  steps: GuideStep[];
  /** The author's name colour on the home page. */
  color?: GuideAuthorColor;
  /** A small square profile picture, as a data URL. */
  avatar?: string;
  /** A picture of the finished part for the card, as a data URL. */
  cover?: string;
  /** Rough minutes to follow it. */
  minutes?: number;
  /**
   * Made by Mintr: shown with the Mintr logo and mint. Only the guides that ship with Mintr set
   * this; it is never read from a file, so a guide someone saves cannot claim it.
   */
  official?: boolean;
};

export type GuideGhost = {
  points: { x: number; z: number }[];
  segments: { start: number; end: number }[];
};

export type GuidePrompt = {
  cue: string;
  title: string;
  body: string;
  step: number;
  total: number;
  complete: boolean;
  ghost: GuideGhost | null;
  showGhost: boolean;
  /** The author's name for this step, when they gave one. */
  heading?: string;
  /** The author's tip for this step. */
  tip?: string;
  /** Every step's name, in order, for the checklist. */
  checklist?: string[];
};

export type GuideCatalogEntry = {
  id: string;
  title: string;
  author: string;
  summary: string;
  path: string | null;
  steps: number;
  color?: GuideAuthorColor;
  avatar?: string;
  cover?: string;
  minutes?: number;
  official?: boolean;
};

export type GuideSession = {
  id: string;
  guide: MintrGuide;
  history: EditorHistoryEntry[];
};

const CATALOG_KEY = "peakcad:guideCatalog";
const SESSION_PREFIX = "peakcad:guideSession:";
const MATCH_MM = 1;
const TRACE_MM = 2.5;

const memorySessions = new Map<string, GuideSession>();

const CUE_NAME: Record<string, string> = {
  box: "Box",
  cylinder: "Cylinder",
  roof: "Triangle",
  sphere: "Sphere",
  cone: "Cone",
  pyramid: "Pyramid",
  polygon: "Polygon",
  roundRoof: "Round roof",
  halfSphere: "Half sphere",
  torus: "Torus",
  tube: "Tube",
  wedge: "Wedge",
  text: "Text",
  gear: "Gear",
  thread: "Thread",
  sketch: "Sketch",
  "new-sketch": "New sketch",
  face: "the face",
  line: "Line",
  circle: "Circle",
  rectangle: "Rectangle",
  extrude: "Extrude",
  cut: "Cut into part",
  group: "Group",
  chamfer: "Chamfer",
  fillet: "Fillet",
  "pad/pocket": "Pad/Pocket",
  pushPull: "Push Pull",
};

export function guideCueName(cue: string) {
  return CUE_NAME[cue] ?? cue.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function roundMm(value: number | undefined) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.round(number / MATCH_MM) * MATCH_MM;
}

function shapeSignature(shape: WorkplaneShape): string {
  const sketch = sketchSignature(shape.sketchProfile);
  const children = (shape.groupedShapes ?? []).map(shapeSignature).sort().join("~");
  return [
    shape.kind,
    shape.hole ? "h" : "s",
    roundMm(shape.width),
    roundMm(shape.depth),
    roundMm(shape.height),
    roundMm(shape.x),
    roundMm(shape.z),
    roundMm(shape.elevation),
    roundMm(shape.rotation),
    roundMm(shape.rotationX),
    roundMm(shape.rotationZ),
    sketch,
    treatmentSignature(shape),
    children,
  ].join("|");
}

function treatmentSignature(shape: WorkplaneShape) {
  return (shape.edgeTreatments ?? [])
    .map((feature) => `${feature.kind}:${roundMm(feature.amount)}:${feature.allEdges ? "all" : feature.edgeCount}`)
    .sort()
    .join(",");
}

function sketchSignature(profile: SketchProfile | undefined) {
  if (!profile?.points?.length) return "";
  return profile.points
    .map((point) => `${roundMm(point.x)},${roundMm(point.z)}`)
    .sort()
    .join(";");
}

function sceneSignature(shapes: readonly WorkplaneShape[]) {
  return shapes.map(shapeSignature).sort().join("\n");
}

/** Same solids, within a millimetre. Ids, names, and colors do not count. */
export function sceneMatchesGuide(current: readonly WorkplaneShape[], target: readonly WorkplaneShape[]) {
  return sceneSignature(current) === sceneSignature(target);
}

function walkShapes(shapes: readonly WorkplaneShape[], visit: (shape: WorkplaneShape) => void) {
  for (const shape of shapes) {
    visit(shape);
    if (shape.groupedShapes?.length) walkShapes(shape.groupedShapes, visit);
  }
}

function profilesOf(shapes: readonly WorkplaneShape[]) {
  const found: SketchProfile[] = [];
  walkShapes(shapes, (shape) => {
    if (shape.sketchProfile?.points?.length) found.push(shape.sketchProfile);
  });
  return found;
}

function profileKey(profile: SketchProfile) {
  return sketchSignature(profile);
}

function newSketchProfile(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]) {
  const seen = new Set(profilesOf(prev).map(profileKey));
  return profilesOf(next).find((profile) => !seen.has(profileKey(profile))) ?? null;
}

function groupCount(shapes: readonly WorkplaneShape[]) {
  let count = 0;
  walkShapes(shapes, (shape) => {
    if ((shape.groupedShapes?.length ?? 0) > 1) count += 1;
  });
  return count;
}

function hasHole(shapes: readonly WorkplaneShape[]) {
  let found = false;
  walkShapes(shapes, (shape) => {
    if (shape.hole) found = true;
  });
  return found;
}

export function ghostFromProfile(profile: SketchProfile): GuideGhost {
  const index = new Map(profile.points.map((point, pointIndex) => [point.id, pointIndex]));
  return {
    points: profile.points.map((point) => ({ x: point.x, z: point.z })),
    segments: profile.segments.flatMap((segment) => {
      const start = index.get(segment.startId);
      const end = index.get(segment.endId);
      if (start === undefined || end === undefined) return [];
      return [{ start, end }];
    }),
  };
}

export function guideSketchTool(ghost: GuideGhost): "circle" | "rectangle" | "line" {
  if (ghost.points.length === 4 && ghost.segments.length >= 4) return "rectangle";
  if (ghost.points.length >= 8) {
    const cx = ghost.points.reduce((sum, point) => sum + point.x, 0) / ghost.points.length;
    const cz = ghost.points.reduce((sum, point) => sum + point.z, 0) / ghost.points.length;
    const radii = ghost.points.map((point) => Math.hypot(point.x - cx, point.z - cz));
    const mean = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
    const spread = Math.max(...radii) - Math.min(...radii);
    if (mean > 1 && spread <= mean * 0.2) return "circle";
  }
  return "line";
}

function classifyChange(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]) {
  if (sceneMatchesGuide(prev, next)) {
    return { cue: "model", included: false, label: "Adjust appearance" };
  }
  if (newSketchProfile(prev, next)) {
    return { cue: "sketch", included: true, label: "Sketch on the part" };
  }
  const prevIds = new Set(prev.map((shape) => shape.id));
  const added = next.filter((shape) => !prevIds.has(shape.id));
  const primitive = added.find((shape) => !(shape.groupedShapes?.length) && shape.kind !== "mesh");
  if (primitive) {
    return { cue: primitive.kind, included: true, label: `Add a ${guideCueName(primitive.kind).toLowerCase()}` };
  }
  if (added.some((shape) => (shape.groupedShapes?.length ?? 0) > 1) || groupCount(next) > groupCount(prev)) {
    return { cue: "group", included: true, label: "Group the parts" };
  }
  const treatment = treatmentCue(prev, next);
  if (treatment) {
    return {
      cue: treatment,
      included: true,
      label: treatment === "chamfer" ? "Chamfer the edges" : "Round the edges",
    };
  }
  const pulled = addedPushPull(prev, next);
  if (pulled) {
    return { cue: "pushPull", included: true, label: pulled.step.distance < 0 ? "Push a face in" : "Pull a face out" };
  }
  if (sizeOnlyScene(prev, next)) return { cue: "model", included: true, label: "Change the size" };
  if (rotationOnlyScene(prev, next)) return { cue: "model", included: true, label: "Turn the part" };
  if (somethingMoved(prev, next)) return { cue: "model", included: true, label: "Move a part" };
  return { cue: "model", included: true, label: "Update the model" };
}

function somethingMoved(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]) {
  const before = new Map(prev.map((shape) => [shape.id, shape]));
  return next.some((shape) => {
    const prior = before.get(shape.id);
    return Boolean(prior && shapeRole(prior) === shapeRole(shape) && !poseUntouched(prior, shape));
  });
}

function treatmentCue(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]): "chamfer" | "fillet" | null {
  const before = new Set<string>();
  walkShapes(prev, (shape) => {
    for (const feature of shape.edgeTreatments ?? []) before.add(`${feature.kind}:${roundMm(feature.amount)}`);
  });
  let added: "chamfer" | "fillet" | null = null;
  walkShapes(next, (shape) => {
    for (const feature of shape.edgeTreatments ?? []) {
      const key = `${feature.kind}:${roundMm(feature.amount)}`;
      if (before.has(key)) continue;
      if (feature.kind === "chamfer" || feature.kind === "fillet") added = feature.kind;
    }
  });
  return added;
}

type PushPullStep = Extract<PartFeature, { kind: "pushPull" }>;

/** The push/pull step the change added, and the part that has it. */
function addedPushPull(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]) {
  const before = new Set<string>();
  walkShapes(prev, (shape) => {
    for (const feature of shape.features ?? []) before.add(feature.id);
  });
  let found: { step: PushPullStep; host: WorkplaneShape } | null = null;
  walkShapes(next, (shape) => {
    for (const feature of shape.features ?? []) {
      if (feature.kind === "pushPull" && !before.has(feature.id)) found = { step: feature, host: shape };
    }
  });
  return found as { step: PushPullStep; host: WorkplaneShape } | null;
}

const FACE_NAMES: Array<{ name: string; axis: 0 | 1 | 2; sign: 1 | -1 }> = [
  { name: "top", axis: 1, sign: 1 },
  { name: "bottom", axis: 1, sign: -1 },
  { name: "front", axis: 2, sign: 1 },
  { name: "back", axis: 2, sign: -1 },
  { name: "right", axis: 0, sign: 1 },
  { name: "left", axis: 0, sign: -1 },
];

/** "top", "left" and so on for a face pointing along an axis; null for a slanted face. */
function faceName(normal: readonly [number, number, number]) {
  return FACE_NAMES.find((face) => normal[face.axis] * face.sign > 0.99)?.name ?? null;
}

function sameFaceDirection(left: readonly [number, number, number], right: readonly [number, number, number]) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2] > 0.99;
}

/** The learner's part is the author's size, and has a push/pull of the same face by the same distance. */
function pushPullStepSatisfied(step: GuideStep, history: readonly EditorHistoryEntry[], shapes: readonly WorkplaneShape[]) {
  const prev = history[step.historyIndex - 1]?.shapes ?? [];
  const target = history[step.historyIndex]?.shapes;
  const wanted = target ? addedPushPull(prev, target) : null;
  if (!wanted) return target ? sceneMatchesGuide(shapes, target) : false;
  if (!hostSizeRemains(shapes, [wanted.host])) return false;
  let found = false;
  walkShapes(shapes, (shape) => {
    for (const feature of shape.features ?? []) {
      if (feature.kind !== "pushPull" || feature.suppressed || feature.failed) continue;
      if (Math.abs(feature.distance - wanted.step.distance) <= 0.1 && sameFaceDirection(feature.face.normal, wanted.step.face.normal)) found = true;
    }
  });
  return found;
}

function pushPullWords(step: PushPullStep) {
  const face = faceName(step.face.normal);
  const which = face ? `the ${face} face` : "the face";
  return {
    which,
    title: `${step.distance < 0 ? "Push" : "Pull"} ${which} ${step.distance < 0 ? "in" : "out"} ${formatMm(Math.abs(step.distance))}`,
    distance: formatMm(step.distance),
  };
}

function treatmentAmount(shapes: readonly WorkplaneShape[], kind: "chamfer" | "fillet") {
  let amount: number | null = null;
  walkShapes(shapes, (shape) => {
    for (const feature of shape.edgeTreatments ?? []) {
      if (feature.kind === kind) amount = feature.amount;
    }
  });
  return amount;
}

function withoutTreatments(shapes: readonly WorkplaneShape[]): WorkplaneShape[] {
  return shapes.map((shape) => ({
    ...shape,
    edgeTreatments: undefined,
    groupedShapes: shape.groupedShapes ? withoutTreatments(shape.groupedShapes) : shape.groupedShapes,
  }));
}

function targetTreatment(shapes: readonly WorkplaneShape[], kind: "chamfer" | "fillet"): EdgeTreatmentFeature | null {
  let feature: EdgeTreatmentFeature | null = null;
  walkShapes(shapes, (shape) => {
    for (const entry of shape.edgeTreatments ?? []) {
      if (entry.kind === kind) feature = entry;
    }
  });
  return feature;
}

/** Same distance, and the same choice of every edge or only some. */
function treatmentMatchesGuide(
  current: readonly WorkplaneShape[],
  target: readonly WorkplaneShape[],
  kind: "chamfer" | "fillet",
) {
  const wanted = targetTreatment(target, kind);
  if (!wanted) return false;
  const authorHost = shapeCarrying(target, kind);
  let found = false;
  walkShapes(current, (shape) => {
    for (const feature of shape.edgeTreatments ?? []) {
      if (feature.kind !== kind) continue;
      if (roundMm(feature.amount) !== roundMm(wanted.amount)) continue;
      if (wanted.allEdges) {
        if (!feature.allEdges) continue;
      } else if (feature.allEdges || feature.edgeCount !== wanted.edgeCount) {
        continue;
      }
      if (authorHost && !fingerprintsAgree(authorHost, shape, wanted, feature)) continue;
      found = true;
    }
  });
  return found;
}

function shapeCarrying(shapes: readonly WorkplaneShape[], kind: "chamfer" | "fillet") {
  let found: WorkplaneShape | null = null;
  walkShapes(shapes, (shape) => {
    if ((shape.edgeTreatments ?? []).some((feature) => feature.kind === kind)) found = shape;
  });
  return found;
}

function shapeCenter(shape: WorkplaneShape): [number, number, number] {
  return [shape.x, (shape.elevation ?? 0) + shape.height / 2, shape.z];
}

function shiftFingerprint(print: EdgeTreatmentFingerprint, delta: [number, number, number]): EdgeTreatmentFingerprint {
  const move = (point: [number, number, number]): [number, number, number] => [
    point[0] + delta[0],
    point[1] + delta[1],
    point[2] + delta[2],
  ];
  return {
    ...print,
    mid: move(print.mid),
    ...(print.centroid ? { centroid: move(print.centroid) } : {}),
  };
}

/** Author fingerprints are in the author's placement. Shift them onto the learner's solid. */
function fingerprintsAgree(
  authorHost: WorkplaneShape,
  learnerHost: WorkplaneShape,
  wanted: EdgeTreatmentFeature,
  got: EdgeTreatmentFeature,
) {
  const stored = wanted.edgeFingerprints ?? [];
  if (!stored.length) return true;
  const live = got.edgeFingerprints ?? [];
  const author = shapeCenter(authorHost);
  const learner = shapeCenter(learnerHost);
  const delta: [number, number, number] = [learner[0] - author[0], learner[1] - author[1], learner[2] - author[2]];
  return sameEdgeFingerprints(stored.map((print) => shiftFingerprint(print, delta)), live);
}

/** A pocket of the prompted size. Width and depth may swap with the face axes. */
export function pocketMatches(
  shapes: readonly WorkplaneShape[],
  size: { width: number; depth: number; height: number },
) {
  const spans = [size.width, size.depth].sort((left, right) => left - right);
  let matched = false;
  walkShapes(shapes, (shape) => {
    if (!shape.hole) return;
    const footprint = [shapeWidth(shape), shapeDepth(shape)].sort((left, right) => left - right);
    if (Math.abs(footprint[0] - spans[0]) <= MATCH_MM && Math.abs(footprint[1] - spans[1]) <= MATCH_MM && Math.abs(shape.height - size.height) <= MATCH_MM) {
      matched = true;
    }
  });
  return matched;
}

function pocketSizeFor(step: GuideStep, history: readonly EditorHistoryEntry[]) {
  const host = history[step.historyIndex - 1]?.shapes?.[0];
  const inset = step.insetMm ?? 4;
  return {
    width: host ? Math.max(0.5, shapeWidth(host) - inset * 2) : 22,
    depth: host ? Math.max(0.5, shapeDepth(host) - inset * 2) : 32,
    height: step.depthMm ?? 6,
  };
}

function boxOfSize(shapes: readonly WorkplaneShape[], target: WorkplaneShape) {
  let found = false;
  walkShapes(shapes, (shape) => {
    if (shape.hole) return;
    if (
      Math.abs(shapeWidth(shape) - shapeWidth(target)) <= MATCH_MM
      && Math.abs(shapeDepth(shape) - shapeDepth(target)) <= MATCH_MM
      && Math.abs(shape.height - target.height) <= MATCH_MM
    ) found = true;
  });
  return found;
}

/** The chamfered solid is a mesh of the same size. Kind and edge count are not the plate. */
function hostSizeRemains(current: readonly WorkplaneShape[], target: readonly WorkplaneShape[]) {
  return target.every((host) => {
    let found = false;
    walkShapes(current, (shape) => {
      if (
        Math.abs(shapeWidth(shape) - shapeWidth(host)) <= MATCH_MM
        && Math.abs(shapeDepth(shape) - shapeDepth(host)) <= MATCH_MM
        && Math.abs(shape.height - host.height) <= MATCH_MM
      ) found = true;
    });
    return found;
  });
}

function edgeStepSatisfied(
  step: GuideStep,
  history: readonly EditorHistoryEntry[],
  shapes: readonly WorkplaneShape[],
) {
  const target = history[step.historyIndex]?.shapes;
  if (!target) return false;
  if (step.cue !== "chamfer" && step.cue !== "fillet") return false;
  const amount = treatmentAmount(target, step.cue);
  if (amount == null) return sceneMatchesGuide(shapes, target);
  return hostSizeRemains(shapes, target) && treatmentMatchesGuide(shapes, target, step.cue);
}

const STRUCTURAL_CUES = new Set(["model", "sketch", "group", "chamfer", "fillet", "pad/pocket", "pushPull"]);

function addedShapeId(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]) {
  const prevIds = new Set(prev.map((shape) => shape.id));
  const added = next.filter((shape) => !prevIds.has(shape.id));
  return added.length === 1 ? added[0].id : null;
}

function placementUnchanged(prior: WorkplaneShape, shape: WorkplaneShape) {
  return prior.kind === shape.kind
    && roundMm(prior.x) === roundMm(shape.x)
    && roundMm(prior.z) === roundMm(shape.z)
    && roundMm(prior.elevation) === roundMm(shape.elevation)
    && roundMm(prior.rotation) === roundMm(shape.rotation)
    && roundMm(prior.rotationX) === roundMm(shape.rotationX)
    && roundMm(prior.rotationZ) === roundMm(shape.rotationZ)
    && sketchSignature(prior.sketchProfile) === sketchSignature(shape.sketchProfile)
    && treatmentSignature(prior) === treatmentSignature(shape)
    && (prior.groupedShapes?.length ?? 0) === (shape.groupedShapes?.length ?? 0);
}

/** A follow-up that only resizes the new shape, or turns that same shape into a hole. */
function ownedResize(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[], shapeId: string) {
  if (prev.length !== next.length) return false;
  const priorById = new Map(prev.map((shape) => [shape.id, shape]));
  let changed = 0;
  for (const shape of next) {
    const prior = priorById.get(shape.id);
    if (!prior) return false;
    if (shapeSignature(prior) === shapeSignature(shape)) continue;
    const sized = roundMm(shapeWidth(prior)) !== roundMm(shapeWidth(shape))
      || roundMm(shapeDepth(prior)) !== roundMm(shapeDepth(shape))
      || roundMm(prior.height) !== roundMm(shape.height);
    const hole = Boolean(prior.hole) !== Boolean(shape.hole);
    if (shape.id !== shapeId || !placementUnchanged(prior, shape) || (!sized && !hole)) return false;
    changed += 1;
  }
  return changed === 1;
}

/**
 * Size edits made right after a shape is added belong to that shape.
 * The prompt uses the size at the end of the run, and the click position does not count.
 */
function sizeRunFor(history: readonly EditorHistoryEntry[], steps: readonly GuideStep[], step: GuideStep) {
  if (STRUCTURAL_CUES.has(step.cue)) return null;
  const prev = history[step.historyIndex - 1]?.shapes ?? [];
  const next = history[step.historyIndex]?.shapes ?? [];
  const shapeId = addedShapeId(prev, next);
  if (!shapeId) return null;
  let end = step.historyIndex;
  for (const later of steps) {
    if (!later.included || later.historyIndex <= end) continue;
    if (later.historyIndex !== end + 1 || later.cue !== "model" || later.fold === false) break;
    const before = history[later.historyIndex - 1]?.shapes ?? [];
    const after = history[later.historyIndex]?.shapes ?? [];
    if (!ownedResize(before, after, shapeId)) break;
    end = later.historyIndex;
  }
  return { start: step.historyIndex, end, shapeId };
}

function shapeAtRunEnd(history: readonly EditorHistoryEntry[], run: { end: number; shapeId: string }) {
  return history[run.end]?.shapes.find((shape) => shape.id === run.shapeId) ?? null;
}

function sizeRunSatisfied(shapes: readonly WorkplaneShape[], target: WorkplaneShape) {
  return shapes.some((shape) => (
    shape.kind === target.kind
    && Boolean(shape.hole) === Boolean(target.hole)
    && !shape.groupedShapes?.length
    && Math.abs(shapeWidth(shape) - shapeWidth(target)) <= MATCH_MM
    && Math.abs(shapeDepth(shape) - shapeDepth(target)) <= MATCH_MM
    && Math.abs(shape.height - target.height) <= MATCH_MM
  ));
}

function shapeRole(shape: WorkplaneShape) {
  return [
    shape.kind,
    shape.hole ? "h" : "s",
    roundMm(shapeWidth(shape)),
    roundMm(shapeDepth(shape)),
    roundMm(shape.height),
  ].join("|");
}

function childRoles(shape: WorkplaneShape) {
  return (shape.groupedShapes ?? []).map(shapeRole).sort().join("~");
}

function looseSketch(profile: SketchProfile | undefined) {
  if (!profile?.points?.length) return "";
  const cx = profile.points.reduce((sum, point) => sum + point.x, 0) / profile.points.length;
  const cz = profile.points.reduce((sum, point) => sum + point.z, 0) / profile.points.length;
  return profile.points
    .map((point) => `${roundMm(point.x - cx)},${roundMm(point.z - cz)}`)
    .sort()
    .join(";");
}

function looseRole(shape: WorkplaneShape): string {
  const children = (shape.groupedShapes ?? []).map(looseRole).sort().join("~");
  return [
    shapeRole(shape),
    roundMm(shape.rotation),
    roundMm(shape.rotationX),
    roundMm(shape.rotationZ),
    looseSketch(shape.sketchProfile),
    treatmentSignature(shape),
    children,
  ].join("|");
}

/** Same parts and sizes. Where they sit on the grid does not count. */
function looseScene(target: readonly WorkplaneShape[], current: readonly WorkplaneShape[]) {
  if (target.length !== current.length) return false;
  const pool = current.map(looseRole);
  return target.every((shape) => {
    const role = looseRole(shape);
    const index = pool.indexOf(role);
    if (index < 0) return false;
    pool.splice(index, 1);
    return true;
  });
}

function alignValue(shape: WorkplaneShape, axis: AlignAxis, target: AlignTarget = "center") {
  return alignCoordinate(alignmentBounds(shape), axis, target);
}

function axisMoved(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[], axis: AlignAxis) {
  const prior = new Map(prev.map((shape) => [shape.id, shape]));
  return next.some((shape) => {
    const before = prior.get(shape.id);
    return Boolean(before && Math.abs(alignValue(before, axis) - alignValue(shape, axis)) > 0.05);
  });
}

function alignAction(label: string, prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]): { axis: AlignAxis; target: AlignTarget } | null {
  const match = /^Aligned \d+ shapes? (left|right|center|front|back|middle|bottom|top)$/i.exec(label.trim());
  if (!match) return null;
  const word = match[1].toLowerCase();
  if (word === "left") return { axis: "x", target: "min" };
  if (word === "right") return { axis: "x", target: "max" };
  if (word === "center") return { axis: "x", target: "center" };
  if (word === "front") return { axis: "z", target: "min" };
  if (word === "back") return { axis: "z", target: "max" };
  if (word === "bottom") return { axis: "y", target: "min" };
  if (word === "top") return { axis: "y", target: "max" };
  const yMoved = axisMoved(prev, next, "y");
  const zMoved = axisMoved(prev, next, "z");
  if (yMoved && !zMoved) return { axis: "y", target: "center" };
  return { axis: "z", target: "center" };
}

function sharesAlign(shapes: readonly WorkplaneShape[], action: { axis: AlignAxis; target: AlignTarget }) {
  if (shapes.length < 2) return false;
  const values = shapes.map((shape) => alignValue(shape, action.axis, action.target));
  return values.every((value) => Math.abs(value - values[0]) <= 0.05);
}

function mirrorAxis(label: string): AlignAxis | null {
  if (!/^Mirrored /i.test(label.trim())) return null;
  if (/front-back/i.test(label)) return "z";
  if (/top-bottom/i.test(label)) return "y";
  return "x";
}

function mirrorFlag(shape: WorkplaneShape, axis: AlignAxis) {
  if (axis === "x") return Boolean(shape.mirrorX);
  if (axis === "z") return Boolean(shape.mirrorZ);
  return Boolean(shape.mirrorY);
}

function pairByRole(target: readonly WorkplaneShape[], current: readonly WorkplaneShape[]) {
  if (target.length !== current.length) return null;
  const pool = current.map((shape) => ({ shape, used: false }));
  const pairs: Array<{ author: WorkplaneShape; learner: WorkplaneShape }> = [];
  for (const author of target) {
    const found = pool.find((entry) => !entry.used && shapeRole(entry.shape) === shapeRole(author));
    if (!found) return null;
    found.used = true;
    pairs.push({ author, learner: found.shape });
  }
  return pairs;
}

function arrangementMatches(target: readonly WorkplaneShape[], current: readonly WorkplaneShape[]) {
  const pairs = pairByRole(target, current);
  if (!pairs) return false;
  const authorOrigin = {
    x: pairs.reduce((sum, pair) => sum + pair.author.x, 0) / pairs.length,
    z: pairs.reduce((sum, pair) => sum + pair.author.z, 0) / pairs.length,
    y: pairs.reduce((sum, pair) => sum + (pair.author.elevation ?? 0), 0) / pairs.length,
  };
  const learnerOrigin = {
    x: pairs.reduce((sum, pair) => sum + pair.learner.x, 0) / pairs.length,
    z: pairs.reduce((sum, pair) => sum + pair.learner.z, 0) / pairs.length,
    y: pairs.reduce((sum, pair) => sum + (pair.learner.elevation ?? 0), 0) / pairs.length,
  };
  return pairs.every(({ author, learner }) => (
    Math.abs((author.x - authorOrigin.x) - (learner.x - learnerOrigin.x)) <= MATCH_MM
    && Math.abs((author.z - authorOrigin.z) - (learner.z - learnerOrigin.z)) <= MATCH_MM
    && Math.abs(((author.elevation ?? 0) - authorOrigin.y) - ((learner.elevation ?? 0) - learnerOrigin.y)) <= MATCH_MM
    && roundMm(author.rotation) === roundMm(learner.rotation)
    && roundMm(author.rotationX) === roundMm(learner.rotationX)
    && roundMm(author.rotationZ) === roundMm(learner.rotationZ)
  ));
}

function groupArrangement(target: readonly WorkplaneShape[], current: readonly WorkplaneShape[]) {
  if (target.length !== current.length) return false;
  const pool = [...current];
  return target.every((author) => {
    const index = pool.findIndex((shape) => shapeRole(shape) === shapeRole(author) && childRoles(shape) === childRoles(author));
    if (index < 0) return false;
    pool.splice(index, 1);
    return true;
  });
}

function poseUntouched(before: WorkplaneShape, after: WorkplaneShape) {
  return roundMm(before.x) === roundMm(after.x)
    && roundMm(before.z) === roundMm(after.z)
    && roundMm(before.elevation) === roundMm(after.elevation)
    && roundMm(before.rotation) === roundMm(after.rotation)
    && roundMm(before.rotationX) === roundMm(after.rotationX)
    && roundMm(before.rotationZ) === roundMm(after.rotationZ);
}

function sizeOnlyScene(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]) {
  if (prev.length !== next.length) return false;
  const prior = new Map(prev.map((shape) => [shape.id, shape]));
  let sized = false;
  for (const shape of next) {
    const before = prior.get(shape.id);
    if (!before || before.kind !== shape.kind || Boolean(before.hole) !== Boolean(shape.hole) || !poseUntouched(before, shape)) return false;
    if (shapeRole(before) !== shapeRole(shape)) sized = true;
  }
  return sized;
}

function rotationOnlyScene(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]) {
  if (prev.length !== next.length) return false;
  const prior = new Map(prev.map((shape) => [shape.id, shape]));
  let turned = false;
  for (const shape of next) {
    const before = prior.get(shape.id);
    if (!before || shapeRole(before) !== shapeRole(shape)) return false;
    if (roundMm(before.x) !== roundMm(shape.x) || roundMm(before.z) !== roundMm(shape.z) || roundMm(before.elevation) !== roundMm(shape.elevation)) return false;
    if (
      roundMm(before.rotation) !== roundMm(shape.rotation)
      || roundMm(before.rotationX) !== roundMm(shape.rotationX)
      || roundMm(before.rotationZ) !== roundMm(shape.rotationZ)
    ) turned = true;
  }
  return turned;
}

function rotationsMatch(target: readonly WorkplaneShape[], current: readonly WorkplaneShape[]) {
  const pairs = pairByRole(target, current);
  if (!pairs) return false;
  return pairs.every(({ author, learner }) => (
    roundMm(author.rotation) === roundMm(learner.rotation)
    && roundMm(author.rotationX) === roundMm(learner.rotationX)
    && roundMm(author.rotationZ) === roundMm(learner.rotationZ)
  ));
}

/** Dragging the only shape to another spot is placement, not a step. */
function soloPlacementStep(step: GuideStep, history: readonly EditorHistoryEntry[]) {
  if (step.cue !== "model" || /^Aligned |^Mirrored /i.test(step.label)) return false;
  const prev = history[step.historyIndex - 1]?.shapes ?? [];
  const next = history[step.historyIndex]?.shapes ?? [];
  if (prev.length !== 1 || next.length !== 1 || prev[0].id !== next[0].id) return false;
  return shapeRole(prev[0]) === shapeRole(next[0]) && !poseUntouched(prev[0], next[0]) && roundMm(prev[0].rotation) === roundMm(next[0].rotation);
}

function pocketCut(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]) {
  const host = [...prev].filter((shape) => !shape.hole).sort((left, right) => (
    shapeWidth(right) * shapeDepth(right) * right.height - shapeWidth(left) * shapeDepth(left) * left.height
  ))[0];
  const holes: WorkplaneShape[] = [];
  walkShapes(next, (shape) => {
    if (shape.hole) holes.push(shape);
  });
  const hole = holes[0];
  if (!host || !hole) return null;
  const insetW = (shapeWidth(host) - shapeWidth(hole)) / 2;
  const insetD = (shapeDepth(host) - shapeDepth(hole)) / 2;
  if (insetW < -MATCH_MM || insetD < -MATCH_MM) return null;
  const inset = Math.abs(insetW - insetD) <= 0.5 ? (insetW + insetD) / 2 : Math.min(Math.max(insetW, 0), Math.max(insetD, 0));
  return { inset, depth: hole.height, host };
}

function recordedPocket(step: GuideStep, history: readonly EditorHistoryEntry[]) {
  if (step.cue === "pad/pocket" || !/pocket/i.test(step.label)) return null;
  const prev = history[step.historyIndex - 1]?.shapes ?? [];
  const next = history[step.historyIndex]?.shapes ?? [];
  return pocketCut(prev, next);
}

function groupedChildMatches(shapes: readonly WorkplaneShape[], sized: WorkplaneShape) {
  let found = false;
  walkShapes(shapes, (shape) => {
    if (!shape.groupedShapes?.length) return;
    if (shape.groupedShapes.some((child) => shapeRole(child) === shapeRole(sized))) found = true;
  });
  return found;
}

function carriedByLaterTreatment(step: GuideStep) {
  return step.cue === "sketch" || !STRUCTURAL_CUES.has(step.cue);
}

function guideStepSatisfied(
  step: GuideStep,
  history: readonly EditorHistoryEntry[],
  shapes: readonly WorkplaneShape[],
  steps: readonly GuideStep[],
) {
  if (step.cue === "chamfer" || step.cue === "fillet") return edgeStepSatisfied(step, history, shapes);
  if (step.cue === "pushPull") return pushPullStepSatisfied(step, history, shapes);
  // A chamfer turns a sketch or a new solid into a mesh. Align and Group still have to happen.
  if (carriedByLaterTreatment(step) && steps.some((later) => later.included
    && later.historyIndex > step.historyIndex
    && (later.cue === "chamfer" || later.cue === "fillet")
    && edgeStepSatisfied(later, history, shapes))) {
    return true;
  }
  const pocketStep = steps.find((entry) => entry.included && entry.cue === "pad/pocket");
  if (step.cue === "pad/pocket") return pocketMatches(shapes, pocketSizeFor(step, history));
  const recorded = recordedPocket(step, history);
  if (recorded) {
    return pocketMatches(shapes, {
      width: Math.max(0.5, shapeWidth(recorded.host) - recorded.inset * 2),
      depth: Math.max(0.5, shapeDepth(recorded.host) - recorded.inset * 2),
      height: recorded.depth,
    });
  }
  if (pocketStep && step.cue === "box") {
    const target = history[step.historyIndex]?.shapes?.[0];
    return pocketMatches(shapes, pocketSizeFor(pocketStep, history)) || (target ? boxOfSize(shapes, target) : false);
  }
  const run = sizeRunFor(history, steps, step);
  if (run) {
    const sized = shapeAtRunEnd(history, run);
    if (!sized) return false;
    return sizeRunSatisfied(shapes, sized) || groupedChildMatches(shapes, sized);
  }
  const prev = history[step.historyIndex - 1]?.shapes ?? [];
  const target = history[step.historyIndex]?.shapes;
  if (!target) return false;
  if (step.cue === "sketch") return looseScene(withoutTreatments(target), withoutTreatments(shapes));
  if (step.cue === "group") return groupArrangement(target, shapes);
  if (soloPlacementStep(step, history)) return true;
  const align = step.cue === "model" ? alignAction(step.label, prev, target) : null;
  if (align) {
    const candidates = [
      shapes,
      ...shapes.flatMap((shape) => (shape.groupedShapes?.length ? [shape.groupedShapes] : [])),
    ];
    return candidates.some((candidate) => {
      const pairs = pairByRole(target, candidate);
      return Boolean(pairs && sharesAlign(pairs.map((pair) => pair.learner), align));
    });
  }
  const mirror = step.cue === "model" ? mirrorAxis(step.label) : null;
  if (mirror) {
    const pairs = pairByRole(target, shapes);
    return Boolean(pairs && pairs.every(({ author, learner }) => mirrorFlag(author, mirror) === mirrorFlag(learner, mirror)) && arrangementMatches(target, shapes));
  }
  if (step.cue === "model" && sizeOnlyScene(prev, target)) return Boolean(pairByRole(target, shapes));
  if (step.cue === "model" && rotationOnlyScene(prev, target)) return rotationsMatch(target, shapes);
  if (step.cue === "model" && target.length > 1 && pairByRole(target, target)) {
    const moved = target.some((shape) => {
      const before = prev.find((entry) => entry.id === shape.id);
      return Boolean(before && (roundMm(before.x) !== roundMm(shape.x) || roundMm(before.z) !== roundMm(shape.z) || roundMm(before.elevation) !== roundMm(shape.elevation)));
    });
    if (moved && target.every((shape) => prev.some((entry) => entry.id === shape.id && shapeRole(entry) === shapeRole(shape)))) {
      return arrangementMatches(target, shapes);
    }
  }
  return sceneMatchesGuide(withoutTreatments(shapes), withoutTreatments(target));
}

/**
 * Steps from the history the author kept. Entries after `historyIndex` were undone
 * and never redone, so they are left out. Color and name changes start unchecked.
 */
export function proposeGuideSteps(history: readonly EditorHistoryEntry[], historyIndex: number): GuideStep[] {
  if (history.length < 2) return [];
  const end = Math.min(Math.max(0, Math.floor(historyIndex)), history.length - 1);
  const steps: GuideStep[] = [];
  const seen = new Set<string>([sceneSignature(history[0]?.shapes ?? [])]);
  for (let index = 1; index <= end; index += 1) {
    const prev = history[index - 1]?.shapes ?? [];
    const next = history[index]?.shapes ?? [];
    const change = classifyChange(prev, next);
    const recorded = history[index]?.label?.trim();
    const cut = recorded && /pocket/i.test(recorded) ? pocketCut(prev, next) : null;
    const signature = sceneSignature(next);
    // Mintr's own names read better than editor notices ("Box added", "Moved"). A recorded notice is
    // kept where playback reads it (Align, Mirror, a pocket), or when there is nothing clearer.
    const recordedMatters = Boolean(recorded && (/^(aligned |mirrored )/i.test(recorded) || /pocket/i.test(recorded)));
    const label = change.cue === "sketch"
      ? change.label
      : recordedMatters
        ? recorded!
        : change.label !== "Update the model" && change.label !== "Adjust appearance" ? change.label : (recorded || change.label);
    const step: GuideStep = {
      historyIndex: index,
      label,
      included: change.included,
      cue: cut ? "pad/pocket" : change.cue,
      ...(cut ? { insetMm: Math.round(cut.inset * 100) / 100, depthMm: Math.round(cut.depth * 100) / 100 } : {}),
    };
    // Nothing for a learner to do: hiding or showing a part, dragging the only part about,
    // or a change that puts the model back the way it already was.
    if (/^(selection hidden|selection visible|showed )/i.test(step.label)) step.included = false;
    else if (soloPlacementStep(step, history)) step.included = false;
    else if (seen.has(signature) && step.cue === "model") step.included = false;
    seen.add(signature);
    steps.push(step);
  }
  // Size edits straight after adding a shape belong to that shape.
  for (const step of steps) {
    const run = sizeRunFor(history, steps, step);
    if (!run) continue;
    for (const member of steps) {
      if (member.historyIndex > run.start && member.historyIndex <= run.end) member.fold = true;
    }
  }
  return steps;
}

/** Why a step starts skipped or folded, for the author to read in the builder. */
export function guideStepDefaultReason(step: GuideStep, history: readonly EditorHistoryEntry[]): string | null {
  if (step.fold) {
    const prev = history[step.historyIndex - 1]?.shapes ?? [];
    const next = history[step.historyIndex]?.shapes ?? [];
    return sizeOnlyScene(prev, next)
      ? "Folded: a size change right after adding the shape."
      : "Folded: the learner does this and the step above as one step.";
  }
  if (step.included) return null;
  if (sceneMatchesGuide(history[step.historyIndex - 1]?.shapes ?? [], history[step.historyIndex]?.shapes ?? [])) {
    return "Skipped: only the colour or name changed.";
  }
  if (/^(selection hidden|selection visible|showed )/i.test(step.label)) return "Skipped: only hid or showed a part.";
  if (soloPlacementStep(step, history)) return "Skipped: just moved the only part.";
  return "Skipped: the model went back to how it already was.";
}

/**
 * The steps the learner sees, in order. Each group is one learner step: a kept step plus any
 * steps folded into it. Dragging the only part about and size edits that belong to a new shape
 * are not steps of their own.
 */
export function guideLessonGroups(guide: MintrGuide, history: readonly EditorHistoryEntry[]): GuideStep[][] {
  const included = guide.steps.filter((step) => step.included);
  const groups: GuideStep[][] = [];
  for (const step of included) {
    if (soloPlacementStep(step, history)) continue;
    const ownedBySizeRun = included.some((candidate) => {
      if (candidate.historyIndex >= step.historyIndex) return false;
      const run = sizeRunFor(history, included, candidate);
      return Boolean(run && step.historyIndex <= run.end);
    });
    if (ownedBySizeRun) continue;
    if (step.fold && groups.length) {
      groups[groups.length - 1].push(step);
      continue;
    }
    groups.push([step]);
  }
  return groups;
}

export function guideStepCount(guide: MintrGuide, history: readonly EditorHistoryEntry[]) {
  return guideLessonGroups(guide, history).length;
}

/** About how long the guide takes: a minute a step, three for a sketch. */
export function guideMinutes(guide: MintrGuide, history: readonly EditorHistoryEntry[]) {
  const groups = guideLessonGroups(guide, history);
  const minutes = groups.reduce((total, group) => total + (group.some((step) => step.cue === "sketch") ? 3 : 1), 0);
  return Math.max(1, minutes);
}

function measureList(shape: WorkplaneShape) {
  return `${formatMm(shapeWidth(shape)).replace(" mm", "")} × ${formatMm(shapeDepth(shape)).replace(" mm", "")} × ${formatMm(shape.height)}`;
}

/**
 * What a step is, in plain words with its real numbers, and what the learner will be told.
 * The builder shows both so the author can judge every step before saving.
 */
export function describeGuideStep(
  step: GuideStep,
  history: readonly EditorHistoryEntry[],
  steps: readonly GuideStep[],
): { title: string; body: string } {
  const prev = history[step.historyIndex - 1]?.shapes ?? [];
  const next = history[step.historyIndex]?.shapes ?? [];
  if (sceneMatchesGuide(prev, next)) return { title: "Change the colour or name", body: "Nothing for the learner to do." };
  if (step.cue === "sketch") {
    const profile = newSketchProfile(prev, next);
    const ghost = profile ? ghostFromProfile(profile) : null;
    const tool = ghost ? guideSketchTool(ghost) : "line";
    const distance = profile ? extrudeDistanceMm(prev, next, profile) : null;
    const cuts = hasHole(next) && !hasHole(prev);
    const onPart = profileWantsFace(profile);
    const xs = ghost?.points.map((point) => point.x) ?? [0];
    const zs = ghost?.points.map((point) => point.z) ?? [0];
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanZ = Math.max(...zs) - Math.min(...zs);
    const shape = tool === "circle"
      ? `a circle ${formatMm(Math.max(spanX, spanZ))} across`
      : tool === "rectangle"
        ? `a rectangle ${formatMm(spanX)} by ${formatMm(spanZ)}`
        : `a shape ${formatMm(spanX)} by ${formatMm(spanZ)}`;
    const how = distance == null ? "" : cuts ? `, cut ${formatMm(distance)} into the part` : `, extruded ${formatMm(distance)}`;
    return {
      title: `Sketch ${shape}${onPart ? " on the part" : ""}${how}`,
      body: `${onPart ? "Click Sketch, then the face. " : "Click Sketch. "}${ghost ? outlineSentence(ghost, tool) : "Draw the outline."}${distance == null ? "" : cuts ? ` Then Extrude, type ${formatMm(distance)}, click Preview in 3D, and Cut into part.` : ` Then Extrude, type ${formatMm(distance)}, and click Preview in 3D.`}`,
    };
  }
  if (step.cue === "chamfer" || step.cue === "fillet") {
    const amount = treatmentAmount(next, step.cue);
    const wanted = targetTreatment(next, step.cue);
    const name = step.cue === "chamfer" ? "Chamfer" : "Fillet";
    const edges = wanted?.allEdges ? "every sharp edge" : wanted?.edgeCount === 1 ? "1 edge" : `${wanted?.edgeCount ?? 0} edges`;
    const size = amount == null ? "" : `, ${formatMm(amount)}`;
    return {
      title: `${step.cue === "chamfer" ? "Chamfer" : "Round"} ${edges}${size}`,
      body: `Click ${name}, set the ${step.cue === "chamfer" ? "distance" : "radius"}${amount == null ? "" : ` to ${formatMm(amount)}`}, select ${edges}, then Apply.`,
    };
  }
  const pulled = step.cue === "pushPull" ? addedPushPull(prev, next) : null;
  if (pulled) {
    const words = pushPullWords(pulled.step);
    return {
      title: words.title,
      body: `Click Push Pull, click ${words.which}, type ${words.distance} for Distance, then Apply.`,
    };
  }
  const pocket = step.cue === "pad/pocket"
    ? { inset: step.insetMm ?? 4, depth: step.depthMm ?? 6 }
    : recordedPocket(step, history);
  if (pocket) {
    return {
      title: `Cut a pocket, ${formatMm(pocket.inset)} in and ${formatMm(pocket.depth)} deep`,
      body: `Click Pad/Pocket, click the top face, choose In, set Inset to ${formatMm(pocket.inset)} and Depth to ${formatMm(pocket.depth)}, then Create.`,
    };
  }
  if (step.cue === "group") return { title: "Group the parts", body: "Select the parts, then click Group." };
  if (step.cue === "model") {
    const align = alignAction(step.label, prev, next);
    if (align) {
      const name = alignmentLabel(align.axis, align.target);
      return { title: `Align ${name}`, body: `Select the parts, click Align, then ${name}.` };
    }
    const mirror = mirrorAxis(step.label);
    if (mirror) {
      const name = mirror === "x" ? "left-right" : mirror === "z" ? "front-back" : "top-bottom";
      return { title: `Mirror ${name}`, body: `Select the parts, click Mirror, then ${name}.` };
    }
    if (rotationOnlyScene(prev, next)) return { title: step.label, body: rotationSentence(prev, next) };
    const moved = relativeMoveSentence(prev, next);
    if (moved) return { title: step.label, body: moved };
    return { title: step.label, body: changedMeasurement(prev, next) };
  }
  const addedIds = new Set(prev.map((shape) => shape.id));
  const added = next.find((shape) => !addedIds.has(shape.id) && shape.kind === step.cue);
  const run = sizeRunFor(history, steps, step);
  const sized = (run ? shapeAtRunEnd(history, run) : null) ?? added;
  const name = guideCueName(step.cue);
  if (!sized) return { title: step.label, body: `Click ${name}.` };
  return {
    title: `Add a ${name.toLowerCase()} ${measureList(sized)}${sized.hole ? ", as a hole" : ""}`,
    body: `Click ${name}. ${sizeSentence(sized)}${sized.hole ? " Then click Hole." : ""}`,
  };
}

export function guideStartIndex(history: readonly EditorHistoryEntry[], steps: readonly GuideStep[]) {
  const first = steps.find((step) => step.included);
  if (!first) return Math.max(0, history.length - 1);
  return Math.max(0, Math.min(first.historyIndex - 1, history.length - 1));
}

export function guideStartShapes(history: readonly EditorHistoryEntry[], steps: readonly GuideStep[]) {
  return history[guideStartIndex(history, steps)]?.shapes ?? [];
}

export function sketchTracesGhost(points: readonly { x: number; z: number }[], ghost: GuideGhost, tolerance = TRACE_MM) {
  if (!ghost.points.length || points.length < ghost.points.length) return false;
  return ghost.points.every((target) => points.some((point) => Math.hypot(point.x - target.x, point.z - target.z) <= tolerance));
}

function profileWantsFace(profile: SketchProfile | null) {
  if (!profile) return false;
  if ((profile.faceReferenceLoops?.length ?? 0) > 0) return true;
  return Boolean(profile.sketchPlane && !isDefaultSketchPlane(profile.sketchPlane));
}

function formatMm(value: number) {
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${text} mm`;
}

function sizeSentence(shape: WorkplaneShape) {
  return `Set Length to ${formatMm(shapeDepth(shape))}, Width to ${formatMm(shapeWidth(shape))}, and Height to ${formatMm(shape.height)}.`;
}

function findShape(shapes: readonly WorkplaneShape[], id: string): WorkplaneShape | null {
  let found: WorkplaneShape | null = null;
  walkShapes(shapes, (shape) => {
    if (shape.id === id) found = shape;
  });
  return found;
}

function findProfileShape(shapes: readonly WorkplaneShape[], profile: SketchProfile): WorkplaneShape | null {
  const key = profileKey(profile);
  const matches: WorkplaneShape[] = [];
  walkShapes(shapes, (shape) => {
    if (shape.sketchProfile && profileKey(shape.sketchProfile) === key) matches.push(shape);
  });
  return matches[0] ?? null;
}

function axisThickness(shape: WorkplaneShape, normal: { x: number; y: number; z: number }) {
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  if (ay >= ax && ay >= az) return shape.height;
  if (ax >= az) return shapeWidth(shape);
  return shapeDepth(shape);
}

/** The number to type. A through cut stores a longer cutter than the part is thick. */
function typedCutDepth(cutter: number, through: number) {
  if (Math.abs(cutter - faceHoleCutDepthMm(through)) <= 0.25) return through;
  const skin = cutter - 0.5;
  if (skin >= 0.5 && faceHoleOvershootMm(cutter) <= 0.5 + 1e-6 && Math.abs(faceBlindCutDepthMm(skin) - cutter) <= 0.15) {
    return skin;
  }
  const scaled = cutter * 0.98;
  if (scaled >= 0.5 && Math.abs(faceBlindCutDepthMm(scaled) - cutter) <= 0.15) return scaled;
  return cutter;
}

function throughDepthFor(profile: SketchProfile, prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]) {
  const plane: SketchPlane | undefined = profile.sketchPlane;
  const hostId = plane?.hostShapeId;
  if (!hostId || !plane) return null;
  const host = findShape(prev, hostId) ?? findShape(next, hostId);
  if (!host) return null;
  if (plane.surface?.kind === "cylinder") return Math.max(0.5, plane.surface.radius * 2);
  return axisThickness(host, plane.normal);
}

function extrudeDistanceMm(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[], profile: SketchProfile) {
  const made = findProfileShape(next, profile);
  if (!made) return null;
  const height = made.height;
  if (!profileWantsFace(profile) || !made.hole) return height;
  const through = throughDepthFor(profile, prev, next);
  if (through == null) return height;
  return typedCutDepth(height, through);
}

function outlineSentence(ghost: GuideGhost, tool: "circle" | "rectangle" | "line") {
  const xs = ghost.points.map((point) => point.x);
  const zs = ghost.points.map((point) => point.z);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanZ = Math.max(...zs) - Math.min(...zs);
  if (tool === "circle") return `Draw a circle ${formatMm(Math.max(spanX, spanZ))} across. Trace the mint outline.`;
  if (tool === "rectangle") return `Draw a rectangle ${formatMm(spanX)} by ${formatMm(spanZ)}. Trace the mint outline.`;
  return `Trace the mint outline. It is ${formatMm(spanX)} by ${formatMm(spanZ)}.`;
}

function rotationSentence(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]) {
  const before = new Map(prev.map((shape) => [shape.id, shape]));
  const lines: string[] = [];
  for (const shape of next) {
    const prior = before.get(shape.id);
    if (!prior) continue;
    const turns: string[] = [];
    if (Math.abs((prior.rotationX ?? 0) - (shape.rotationX ?? 0)) >= 0.5) turns.push(`${Math.round(shape.rotationX ?? 0)} degrees on Width`);
    if (Math.abs(prior.rotation - shape.rotation) >= 0.5) turns.push(`${Math.round(shape.rotation)} degrees`);
    if (Math.abs((prior.rotationZ ?? 0) - (shape.rotationZ ?? 0)) >= 0.5) turns.push(`${Math.round(shape.rotationZ ?? 0)} degrees on Length`);
    if (turns.length) lines.push(`Turn it to ${turns.join(" and ")}.`);
  }
  return lines.join(" ") || "Turn the part to the angle in this step.";
}

function relativeMoveSentence(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]) {
  if (prev.length < 2 || next.length < 2) return null;
  const before = new Map(prev.map((shape) => [shape.id, shape]));
  const moved = next.filter((shape) => {
    const prior = before.get(shape.id);
    return Boolean(prior && shapeRole(prior) === shapeRole(shape) && (
      roundMm(prior.x) !== roundMm(shape.x) || roundMm(prior.z) !== roundMm(shape.z) || roundMm(prior.elevation) !== roundMm(shape.elevation)
    ));
  });
  const still = next.filter((shape) => !moved.includes(shape) && before.has(shape.id));
  if (!moved.length || !still.length) return null;
  const anchor = still[0];
  const shape = moved[0];
  const prior = before.get(shape.id);
  if (!prior) return null;
  const depth = shape.z - anchor.z;
  const width = shape.x - anchor.x;
  const height = (shape.elevation ?? 0) - (anchor.elevation ?? 0);
  const parts: string[] = [];
  if (Math.abs(depth - (prior.z - anchor.z)) >= 0.5) parts.push(`${formatMm(depth)} on Length`);
  if (Math.abs(width - (prior.x - anchor.x)) >= 0.5) parts.push(`${formatMm(width)} on Width`);
  if (Math.abs(height - ((prior.elevation ?? 0) - (anchor.elevation ?? 0))) >= 0.5) parts.push(`${formatMm(height)} up`);
  if (!parts.length) return null;
  return `Move it to ${parts.join(" and ")} from the other part.`;
}

function changedMeasurement(prev: readonly WorkplaneShape[], next: readonly WorkplaneShape[]) {
  const before = new Map(prev.map((shape) => [shape.id, shape]));
  const lines: string[] = [];
  for (const shape of next) {
    const prior = before.get(shape.id);
    if (!prior) continue;
    const changes: string[] = [];
    if (Math.abs(shapeDepth(prior) - shapeDepth(shape)) >= 0.5) changes.push(`Length to ${formatMm(shapeDepth(shape))}`);
    if (Math.abs(shapeWidth(prior) - shapeWidth(shape)) >= 0.5) changes.push(`Width to ${formatMm(shapeWidth(shape))}`);
    if (Math.abs(prior.height - shape.height) >= 0.5) changes.push(`Height to ${formatMm(shape.height)}`);
    if (changes.length) lines.push(`Set ${changes.join(", ")}.`);
  }
  if (lines.length) return lines.join(" ");
  return "Change the model until it matches this step.";
}

export function guidePrompt(input: {
  guide: MintrGuide;
  history: readonly EditorHistoryEntry[];
  shapes: readonly WorkplaneShape[];
  sketchMode: boolean;
  pickingFace: boolean;
  sketching: boolean;
  sketchingOffPart: boolean;
  sketchClosed: boolean;
  extrudeOpen: boolean;
  sketchPoints: readonly { x: number; z: number }[];
  faceTool?: boolean;
  faceChosen?: boolean;
  faceDirection?: "out" | "in" | null;
  /** Chamfer or fillet panel is open. */
  edgeKind?: "chamfer" | "fillet" | null;
  /** Distance or radius currently in that panel, in millimetres. */
  edgeAmount?: number | null;
  /** Push Pull is open; the face picked in it points along this normal, and its distance in millimetres. */
  pushPullOpen?: boolean;
  pushPullFaceNormal?: [number, number, number] | null;
  pushPullDistance?: number | null;
  /** Every sharp edge the open tool can take is selected. */
  allEdgesSelected?: boolean;
  /** How many edges are selected in the open chamfer or fillet tool. */
  edgeSelectedCount?: number;
  /** Fingerprints of the edges selected in the open chamfer or fillet tool. */
  edgeFingerprints?: EdgeTreatmentFingerprint[];
  alignMode?: boolean;
  mirrorMode?: boolean;
}): GuidePrompt | null {
  const included = input.guide.steps.filter((step) => step.included);
  const groups = guideLessonGroups(input.guide, input.history);
  if (!groups.length) return null;
  const done = (step: GuideStep) => guideStepSatisfied(step, input.history, input.shapes, included);
  // A group is done when its last part is; earlier parts may no longer match once later ones change the model.
  const activeIndex = groups.findIndex((group) => !done(group[group.length - 1]));
  const total = groups.length;
  const checklist = groups.map((group) => group[0].name?.trim() || describeGuideStep(group[0], input.history, included).title);
  if (activeIndex < 0) {
    return {
      cue: "",
      title: "Tutorial complete",
      body: "You built the same part. It now leaves the home page and keeps its check in Settings.",
      step: total,
      total,
      complete: true,
      ghost: null,
      showGhost: false,
      checklist,
    };
  }
  const group = groups[activeIndex];
  let lastDone = -1;
  for (let index = group.length - 1; index >= 0; index -= 1) {
    if (done(group[index])) {
      lastDone = index;
      break;
    }
  }
  const step = group[Math.min(lastDone + 1, group.length - 1)];
  const tips = group.map((member) => member.tip?.trim()).filter((tip): tip is string => Boolean(tip));
  const prev = input.history[step.historyIndex - 1]?.shapes ?? [];
  const next = input.history[step.historyIndex]?.shapes ?? [];
  const profile = step.cue === "sketch" ? newSketchProfile(prev, next) : null;
  const ghost = profile ? ghostFromProfile(profile) : null;
  const base = {
    step: activeIndex + 1,
    total,
    complete: false,
    ghost,
    showGhost: false,
    heading: group[0].name?.trim() || undefined,
    tip: tips.length ? tips.join(" ") : undefined,
    checklist,
  };
  if (step.cue === "sketch") {
    const tool = ghost ? guideSketchTool(ghost) : "line";
    const face = profileWantsFace(profile);
    const traced = ghost ? sketchTracesGhost(input.sketchPoints, ghost) : input.sketchClosed;
    const cuts = hasHole(next) && !hasHole(prev);
    const distance = profile ? extrudeDistanceMm(prev, next, profile) : null;
    const distanceText = distance == null ? null : formatMm(distance);
    if (!input.sketching && !input.sketchMode && !input.pickingFace) {
      return { ...base, cue: "sketch", title: "Sketch", body: "Click Sketch." };
    }
    if (input.sketchingOffPart && face) {
      return { ...base, cue: "face", title: "Sketch on the part", body: "This sketch is on the empty grid. Click Cancel, then New sketch, and click the face." };
    }
    if (input.pickingFace || (input.sketchMode && face && !input.sketching)) {
      return {
        ...base,
        cue: input.pickingFace ? "face" : "new-sketch",
        title: input.pickingFace ? (face ? "Click the face" : "New sketch") : "New sketch",
        body: input.pickingFace
          ? (face ? "Click the face this sketch belongs on." : "Click the workplane.")
          : "Click New sketch, then the face.",
      };
    }
    if (!input.sketching && !traced) {
      return { ...base, cue: "new-sketch", title: "New sketch", body: "Click New sketch, then draw the mint outline." };
    }
    if (!traced) {
      return {
        ...base,
        cue: tool,
        title: `Draw with ${guideCueName(tool)}`,
        body: ghost ? outlineSentence(ghost, tool) : "Trace the mint outline.",
        showGhost: true,
      };
    }
    if (!input.extrudeOpen) {
      return {
        ...base,
        cue: "extrude",
        title: "Extrude",
        body: distanceText ? `Click Extrude. Type ${distanceText}.` : "Click Extrude.",
        showGhost: true,
      };
    }
    return {
      ...base,
      cue: "cut",
      title: cuts ? "Cut into the part" : "Finish the solid",
      body: distanceText
        ? (cuts ? `Type ${distanceText}, click Preview in 3D, then Cut into part.` : `Type ${distanceText}, click Preview in 3D, then the green button.`)
        : (cuts ? "Click Preview in 3D, then Cut into part." : "Click Preview in 3D, then the green button to finish this solid."),
      showGhost: false,
    };
  }
  if (step.cue === "chamfer" || step.cue === "fillet") {
    const amount = treatmentAmount(next, step.cue);
    const name = step.cue === "chamfer" ? "Chamfer" : "Fillet";
    const measure = step.cue === "chamfer" ? "distance" : "radius";
    const title = step.cue === "chamfer" ? "Chamfer the edges" : "Round the edges";
    if (input.edgeKind !== step.cue) {
      return { ...base, cue: step.cue, title, body: `Click ${name}.` };
    }
    const distanceReady = amount == null
      || (typeof input.edgeAmount === "number" && Math.abs(input.edgeAmount - amount) <= 0.05);
    if (!distanceReady) {
      return {
        ...base,
        cue: "edge-distance",
        title: step.cue === "chamfer" ? "Distance" : "Radius",
        body: `Set the ${measure} to ${formatMm(amount ?? 0)}.`,
      };
    }
    const wanted = targetTreatment(next, step.cue);
    if (wanted?.allEdges) {
      if (!input.allEdgesSelected) {
        return { ...base, cue: "all-sharp-edges", title: "All sharp edges", body: "Click All sharp edges." };
      }
      return { ...base, cue: "edge-apply", title: "Apply", body: "Click Apply." };
    }
    const edgeCount = wanted?.edgeCount ?? 0;
    const selected = input.edgeSelectedCount ?? 0;
    const authorHost = shapeCarrying(next, step.cue);
    const learnerHost = authorHost ? (input.shapes.find((shape) => shapeRole(shape) === shapeRole(authorHost)) ?? input.shapes[0]) : null;
    const printsReady = !wanted?.edgeFingerprints?.length || !authorHost || !learnerHost
      ? !wanted?.edgeFingerprints?.length
      : sameEdgeFingerprints(
        wanted.edgeFingerprints.map((print) => {
          const author = shapeCenter(authorHost);
          const learner = shapeCenter(learnerHost);
          return shiftFingerprint(print, [learner[0] - author[0], learner[1] - author[1], learner[2] - author[2]]);
        }),
        input.edgeFingerprints ?? [],
      );
    const selectionReady = edgeCount > 0 && selected === edgeCount && !input.allEdgesSelected && printsReady;
    if (!selectionReady) {
      const edges = edgeCount === 1 ? "1 edge" : `${edgeCount} edges`;
      return {
        ...base,
        cue: "model",
        title: "Choose the edges",
        body: edgeCount > 0
          ? `Select ${edges}. Leave the others sharp.`
          : `Select only the edges from this guide, not every edge.`,
      };
    }
    return { ...base, cue: "edge-apply", title: "Apply", body: "Click Apply." };
  }
  const pulled = step.cue === "pushPull" ? addedPushPull(prev, next) : null;
  if (pulled) {
    const words = pushPullWords(pulled.step);
    const title = pulled.step.distance < 0 ? "Push the face in" : "Pull the face out";
    if (!input.pushPullOpen) return { ...base, cue: "push pull", title, body: "Click Push Pull." };
    if (!input.pushPullFaceNormal) return { ...base, cue: "face", title, body: `Click ${words.which}.` };
    if (!sameFaceDirection(input.pushPullFaceNormal, pulled.step.face.normal)) {
      return { ...base, cue: "face", title, body: `Click ${words.which} instead.` };
    }
    if (typeof input.pushPullDistance !== "number" || Math.abs(input.pushPullDistance - pulled.step.distance) > 0.1) {
      return { ...base, cue: "push-pull-distance", title: "Distance", body: `Type ${words.distance} for Distance.` };
    }
    return { ...base, cue: "push-pull-apply", title: "Apply", body: "Click Apply." };
  }
  if (step.cue === "pad/pocket") {
    const inset = formatMm(step.insetMm ?? 4);
    const depth = formatMm(step.depthMm ?? 6);
    if (!input.faceTool) {
      return { ...base, cue: "pad/pocket", title: "Cut a pocket", body: "Click Pad/Pocket." };
    }
    if (!input.faceChosen) {
      return { ...base, cue: "face", title: "Click the top face", body: "Click the top face of the box." };
    }
    if (input.faceDirection !== "in") {
      return { ...base, cue: "pocket-in", title: "Cut inward", body: "Click In: cut a pocket." };
    }
    return {
      ...base,
      cue: "create",
      title: "Cut the pocket",
      body: `Set Inset to ${inset} and Depth to ${depth}. Then click Create.`,
    };
  }
  const recordedCut = recordedPocket(step, input.history);
  if (recordedCut) {
    const inset = formatMm(recordedCut.inset);
    const depth = formatMm(recordedCut.depth);
    if (!input.faceTool) {
      return { ...base, cue: "pad/pocket", title: "Cut a pocket", body: "Click Pad/Pocket." };
    }
    if (!input.faceChosen) {
      return { ...base, cue: "face", title: "Click the top face", body: "Click the top face of the box." };
    }
    if (input.faceDirection !== "in") {
      return { ...base, cue: "pocket-in", title: "Cut inward", body: "Click In: cut a pocket." };
    }
    return {
      ...base,
      cue: "create",
      title: "Cut the pocket",
      body: `Set Inset to ${inset} and Depth to ${depth}. Then click Create.`,
    };
  }
  if (step.cue === "group") {
    return { ...base, cue: "group", title: step.label, body: "Select the parts, then click Group." };
  }
  if (step.cue === "model") {
    const align = alignAction(step.label, prev, next);
    if (align) {
      const name = alignmentLabel(align.axis, align.target);
      const titled = name.charAt(0).toUpperCase() + name.slice(1);
      if (!input.alignMode) {
        return { ...base, cue: "align", title: step.label, body: "Select the parts, then click Align." };
      }
      return { ...base, cue: `align-${name}`, title: `Align ${name}`, body: `Click ${titled}.` };
    }
    const mirror = mirrorAxis(step.label);
    if (mirror) {
      const name = mirror === "x" ? "left-right" : mirror === "z" ? "front-back" : "top-bottom";
      if (!input.mirrorMode) {
        return { ...base, cue: "mirror", title: step.label, body: "Select the parts, then click Mirror." };
      }
      return { ...base, cue: `mirror-${name}`, title: step.label, body: `Click ${name}.` };
    }
    if (rotationOnlyScene(prev, next)) {
      return { ...base, cue: "model", title: step.label, body: rotationSentence(prev, next) };
    }
    const moved = relativeMoveSentence(prev, next);
    if (moved) return { ...base, cue: "model", title: step.label, body: moved };
    return { ...base, cue: "model", title: step.label, body: changedMeasurement(prev, next) };
  }
  const name = guideCueName(step.cue);
  const addedIds = new Set(prev.map((shape) => shape.id));
  const added = next.find((shape) => !addedIds.has(shape.id) && shape.kind === step.cue);
  const run = sizeRunFor(input.history, included, step);
  const sized = (run ? shapeAtRunEnd(input.history, run) : null) ?? added;
  if (sized?.hole && input.shapes.some((shape) => (
    shape.kind === sized.kind
    && !shape.hole
    && !shape.groupedShapes?.length
    && Math.abs(shapeWidth(shape) - shapeWidth(sized)) <= MATCH_MM
    && Math.abs(shapeDepth(shape) - shapeDepth(sized)) <= MATCH_MM
    && Math.abs(shape.height - sized.height) <= MATCH_MM
  ))) {
    return { ...base, cue: "hole", title: "Make it a hole", body: "Click Hole." };
  }
  return {
    ...base,
    cue: step.cue,
    // Older guides stored the editor's notice ("Box added") as the label.
    title: `Add a ${name.toLowerCase()}`,
    body: sized ? `Click ${name}. ${sizeSentence(sized)}` : `Click ${name}.`,
  };
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function slimShape(shape: WorkplaneShape): WorkplaneShape {
  const next: WorkplaneShape = { ...shape, importedMesh: undefined, cadDisplayEdges: undefined };
  if (shape.groupedShapes?.length) next.groupedShapes = shape.groupedShapes.map(slimShape);
  return next;
}

function slimHistory(history: readonly EditorHistoryEntry[]): EditorHistoryEntry[] {
  return history.map((entry) => ({
    shapes: entry.shapes.map(slimShape),
    selectedIds: entry.selectedIds,
    fingerprint: entry.fingerprint,
    estimatedBytes: entry.estimatedBytes,
    label: entry.label,
  }));
}

export function readGuideCatalog(): GuideCatalogEntry[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(CATALOG_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Partial<GuideCatalogEntry>;
      if (typeof record.id !== "string" || typeof record.title !== "string" || typeof record.author !== "string") return [];
      return [{
        id: record.id,
        title: record.title,
        author: record.author,
        summary: typeof record.summary === "string" ? record.summary : `A guide by ${record.author}.`,
        path: typeof record.path === "string" ? record.path : null,
        steps: typeof record.steps === "number" ? record.steps : 0,
        ...(isGuideAuthorColor(record.color) ? { color: record.color } : {}),
        ...(typeof record.avatar === "string" && record.avatar.startsWith("data:image/") ? { avatar: record.avatar } : {}),
        ...(typeof record.cover === "string" && record.cover.startsWith("data:image/") ? { cover: record.cover } : {}),
        ...(typeof record.minutes === "number" && record.minutes > 0 ? { minutes: record.minutes } : {}),
      }];
    });
  } catch {
    return [];
  }
}

export function guideSessionFor(id: string): GuideSession | null {
  const cached = memorySessions.get(id);
  if (cached) return cached;
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(`${SESSION_PREFIX}${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { guide?: MintrGuide; history?: EditorHistoryEntry[] };
    if (!parsed?.guide || !Array.isArray(parsed.history)) return null;
    const session = { id, guide: parsed.guide, history: parsed.history };
    memorySessions.set(id, session);
    return session;
  } catch {
    return null;
  }
}

export function rememberGuideSession(session: GuideSession, path: string | null) {
  memorySessions.set(session.id, session);
  const store = storage();
  if (!store) return;
  // The count a learner will see, after folding, not the number of rows the author kept.
  const steps = guideStepCount(session.guide, session.history);
  const catalog = readGuideCatalog().filter((entry) => entry.id !== session.id);
  catalog.unshift({
    id: session.id,
    title: session.guide.title,
    author: session.guide.author,
    summary: session.guide.summary || `A guide by ${session.guide.author}.`,
    path,
    steps,
    ...(session.guide.color ? { color: session.guide.color } : {}),
    ...(session.guide.avatar ? { avatar: session.guide.avatar } : {}),
    ...(session.guide.cover ? { cover: session.guide.cover } : {}),
    minutes: session.guide.minutes ?? guideMinutes(session.guide, session.history),
  });
  try {
    store.setItem(CATALOG_KEY, JSON.stringify(catalog));
  } catch {
    // The tutorial still runs for this session.
  }
  try {
    store.setItem(`${SESSION_PREFIX}${session.id}`, JSON.stringify({ guide: session.guide, history: slimHistory(session.history) }));
  } catch {
    // A large model stays in memory. Opening the .mintrguide file starts it again.
  }
}

export function playbackProjectId(sourceProjectId: string) {
  return sourceProjectId.startsWith("guide:") ? sourceProjectId : `guide:${sourceProjectId}`;
}
