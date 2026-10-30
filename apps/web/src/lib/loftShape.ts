import * as THREE from "three";
import { createLocalId } from "@/lib/localIds";
import { materialOutlines } from "@/lib/sketch/profiles";
import { meshInLocalFrame, pathArea, serializeSketchLoop } from "@/lib/sketchExtrusionSolid";
import { planeUVToWorld, resolveSketchPlane } from "@/lib/sketchPlane";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type {
  LoftLoop,
  LoftOutline,
  LoftPoint,
  LoftSection,
  LoftSpec,
  LoftStarter,
  LoftStep,
  WorkplaneShape,
} from "@/types/sketchforge";

export const LOFT_COLOR = "#7c5cd6";
export const MIN_LOFT_SECTIONS = 2;
/** Outlines closer than this in height cannot be lofted between. */
const MIN_SECTION_GAP = 0.05;
/** A twist is lofted through an outline every this many degrees, so it turns smoothly. */
const TWIST_STEP_DEGREES = 15;
const RING_POINTS = 96;
const BEZIER_SAMPLES = 24;
const SMOOTH_ROWS_PER_SPAN = 10;
/** Cubic bezier handle length for a quarter circle. */
const KAPPA = 0.5522847498;

export const DEFAULT_LOFT_STARTER: LoftStarter = { bottom: "square", top: "circle", sides: 6, topScale: 60, twist: 0 };

// --------------------------------------------------------------------------------
// Outlines
// --------------------------------------------------------------------------------

/** A circle as four bezier quarters, starting at `startAngle` so it lines up with a square's corners. */
export function circleLoop(cx: number, cz: number, rx: number, rz = rx, startAngle = Math.PI / 4): LoftLoop {
  const at = (angle: number): LoftPoint => [cx + rx * Math.cos(angle), cz + rz * Math.sin(angle)];
  const steps: LoftStep[] = [];
  for (let quarter = 0; quarter < 4; quarter += 1) {
    const a0 = startAngle + (quarter * Math.PI) / 2;
    const a1 = a0 + Math.PI / 2;
    steps.push({
      kind: "bezier",
      c1: [cx + rx * (Math.cos(a0) - KAPPA * Math.sin(a0)), cz + rz * (Math.sin(a0) + KAPPA * Math.cos(a0))],
      c2: [cx + rx * (Math.cos(a1) + KAPPA * Math.sin(a1)), cz + rz * (Math.sin(a1) - KAPPA * Math.cos(a1))],
      to: at(a1),
    });
  }
  return { start: at(startAngle), steps };
}

export function polygonLoop(sides: number, rx: number, rz = rx, startAngle = Math.PI / 2, cx = 0, cz = 0): LoftLoop {
  const count = Math.max(3, Math.round(sides));
  const at = (index: number): LoftPoint => {
    const angle = startAngle + (2 * Math.PI * index) / count;
    return [cx + rx * Math.cos(angle), cz + rz * Math.sin(angle)];
  };
  const steps: LoftStep[] = [];
  for (let index = 1; index <= count; index += 1) steps.push({ kind: "line", to: at(index % count) });
  return { start: at(0), steps };
}

function rectLoop(cx: number, cz: number, halfX: number, halfZ: number): LoftLoop {
  return {
    start: [cx + halfX, cz + halfZ],
    steps: [
      { kind: "line", to: [cx - halfX, cz + halfZ] },
      { kind: "line", to: [cx - halfX, cz - halfZ] },
      { kind: "line", to: [cx + halfX, cz - halfZ] },
      { kind: "line", to: [cx + halfX, cz + halfZ] },
    ],
  };
}

/** A circular arc through `mid`, as bezier pieces of at most a quarter turn each. */
function arcAsBeziers(from: LoftPoint, mid: LoftPoint, to: LoftPoint): LoftStep[] {
  const [ax, az] = from;
  const [bx, bz] = mid;
  const [cx, cz] = to;
  const d = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
  if (Math.abs(d) < 1e-12) return [{ kind: "line", to }];
  const a2 = ax * ax + az * az;
  const b2 = bx * bx + bz * bz;
  const c2 = cx * cx + cz * cz;
  const ox = (a2 * (bz - cz) + b2 * (cz - az) + c2 * (az - bz)) / d;
  const oz = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const r = Math.hypot(ax - ox, az - oz);
  const start = Math.atan2(az - oz, ax - ox);
  const through = Math.atan2(bz - oz, bx - ox);
  const end = Math.atan2(cz - oz, cx - ox);
  const ccw = (d > 0);
  const wrap = (angle: number) => {
    let value = angle - start;
    if (ccw) while (value < 0) value += 2 * Math.PI;
    else while (value > 0) value -= 2 * Math.PI;
    return value;
  };
  let sweep = wrap(end);
  if (Math.abs(sweep) < 1e-9) sweep = ccw ? 2 * Math.PI : -2 * Math.PI;
  if (Math.abs(wrap(through)) > Math.abs(sweep)) sweep = sweep > 0 ? sweep - 2 * Math.PI : sweep + 2 * Math.PI;
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / pieces;
  const handle = (4 / 3) * Math.tan(step / 4) * r;
  const steps: LoftStep[] = [];
  for (let index = 0; index < pieces; index += 1) {
    const a0 = start + step * index;
    const a1 = a0 + step;
    const p1: LoftPoint = index === pieces - 1 ? to : [ox + r * Math.cos(a1), oz + r * Math.sin(a1)];
    steps.push({
      kind: "bezier",
      c1: [ox + r * Math.cos(a0) - handle * Math.sin(a0), oz + r * Math.sin(a0) + handle * Math.cos(a0)],
      c2: [ox + r * Math.cos(a1) + handle * Math.sin(a1), oz + r * Math.sin(a1) - handle * Math.cos(a1)],
      to: p1,
    });
  }
  return steps;
}

type KernelLoop = ReturnType<typeof serializeSketchLoop>;

/** A sketch outline as lines and beziers, so any stretch of it stays exact. */
function loopFromKernelLoop(loop: NonNullable<KernelLoop>): LoftLoop | null {
  if (loop.kind === "circle") return circleLoop(loop.cx, loop.cz, loop.radius);
  const start = loop.start as LoftPoint;
  let current = start;
  const steps: LoftStep[] = [];
  for (const raw of loop.steps) {
    const to = raw.to as LoftPoint;
    if (raw.kind === "arc" && raw.mid) steps.push(...arcAsBeziers(current, raw.mid as LoftPoint, to));
    else if (raw.kind === "bezier" && raw.c1 && raw.c2) steps.push({ kind: "bezier", c1: raw.c1 as LoftPoint, c2: raw.c2 as LoftPoint, to });
    else steps.push({ kind: "line", to });
    current = to;
  }
  if (Math.hypot(current[0] - start[0], current[1] - start[1]) > 1e-9) steps.push({ kind: "line", to: start });
  return steps.length >= 2 ? { start, steps } : null;
}

export function mapLoop(loop: LoftLoop, map: (point: LoftPoint) => LoftPoint): LoftLoop {
  return {
    start: map(loop.start),
    steps: loop.steps.map((step) => (step.kind === "bezier"
      ? { kind: "bezier", c1: map(step.c1), c2: map(step.c2), to: map(step.to) }
      : { kind: "line", to: map(step.to) })),
  };
}

function reverseLoop(loop: LoftLoop): LoftLoop {
  const points: LoftPoint[] = [loop.start, ...loop.steps.map((step) => step.to)];
  const steps: LoftStep[] = [];
  for (let index = loop.steps.length - 1; index >= 0; index -= 1) {
    const step = loop.steps[index];
    const to = points[index];
    steps.push(step.kind === "bezier" ? { kind: "bezier", c1: step.c2, c2: step.c1, to } : { kind: "line", to });
  }
  return { start: points[points.length - 1], steps };
}

/** Points along the outline, closed (the start is not repeated). */
export function sampleLoop(loop: LoftLoop, perBezier = BEZIER_SAMPLES): LoftPoint[] {
  const points: LoftPoint[] = [loop.start];
  let current = loop.start;
  for (const step of loop.steps) {
    if (step.kind === "bezier") {
      for (let index = 1; index <= perBezier; index += 1) {
        const t = index / perBezier;
        const u = 1 - t;
        const w0 = u * u * u;
        const w1 = 3 * u * u * t;
        const w2 = 3 * u * t * t;
        const w3 = t * t * t;
        points.push([
          w0 * current[0] + w1 * step.c1[0] + w2 * step.c2[0] + w3 * step.to[0],
          w0 * current[1] + w1 * step.c1[1] + w2 * step.c2[1] + w3 * step.to[1],
        ]);
      }
    } else {
      points.push(step.to);
    }
    current = step.to;
  }
  const last = points[points.length - 1];
  if (points.length > 1 && Math.hypot(last[0] - loop.start[0], last[1] - loop.start[1]) < 1e-9) points.pop();
  return points;
}

function signedArea(points: readonly LoftPoint[]) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** Every outline runs the same way round, so the loft does not turn inside out. */
function counterClockwise(loop: LoftLoop): LoftLoop {
  return signedArea(sampleLoop(loop, 8)) < 0 ? reverseLoop(loop) : loop;
}

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

function loopBounds(loop: LoftLoop, into?: Bounds): Bounds {
  const bounds = into ?? { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const [x, z] of sampleLoop(loop)) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  return bounds;
}

/**
 * Fit outlines given in mm into the unit box a loft stores. Returns the box's size and
 * where its centre and floor sat.
 */
export function fitLoftSections(sections: readonly LoftSection[]) {
  const sorted = [...sections].sort((a, b) => a.y - b.y);
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const section of sorted) loopBounds(section.loop, bounds);
  const minY = sorted[0].y;
  const maxY = sorted[sorted.length - 1].y;
  const width = Math.max(0.01, bounds.maxX - bounds.minX);
  const depth = Math.max(0.01, bounds.maxZ - bounds.minZ);
  const height = Math.max(0.01, maxY - minY);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  return {
    sections: sorted.map((section) => ({
      y: (section.y - minY) / height,
      loop: counterClockwise(mapLoop(section.loop, ([x, z]) => [(x - cx) / width, (z - cz) / depth])),
    })),
    span: [width, depth, height] as [number, number, number],
    center: { x: cx, z: cz, elevation: minY },
  };
}

/** The stored unit-box outlines at a size in mm, floor at y = 0. */
export function loftSectionsMm(spec: LoftSpec, span: readonly [number, number, number] = spec.span): LoftSection[] {
  const [width, depth, height] = span;
  return spec.sections.map((section) => ({
    y: section.y * height,
    loop: mapLoop(section.loop, ([x, z]) => [x * width, z * depth]),
  }));
}

// --------------------------------------------------------------------------------
// Palette loft
// --------------------------------------------------------------------------------

export function normalizeLoftStarter(starter?: Partial<LoftStarter>): LoftStarter {
  const outline = (value: unknown, fallback: LoftOutline): LoftOutline =>
    value === "circle" || value === "square" || value === "polygon" ? value : fallback;
  return {
    bottom: outline(starter?.bottom, DEFAULT_LOFT_STARTER.bottom),
    top: outline(starter?.top, DEFAULT_LOFT_STARTER.top),
    sides: Math.min(24, Math.max(3, Math.round(starter?.sides ?? DEFAULT_LOFT_STARTER.sides))),
    topScale: Math.min(400, Math.max(1, starter?.topScale ?? DEFAULT_LOFT_STARTER.topScale)),
    twist: Math.min(360, Math.max(-360, starter?.twist ?? DEFAULT_LOFT_STARTER.twist)),
  };
}

function starterOutline(kind: LoftOutline, sides: number, radius: number, turn: number): LoftLoop {
  if (kind === "circle") return circleLoop(0, 0, radius, radius, Math.PI / 4 + turn);
  if (kind === "square") return polygonLoop(4, radius * Math.SQRT2, radius * Math.SQRT2, Math.PI / 4 + turn);
  return polygonLoop(sides, radius, radius, Math.PI / 2 + turn);
}

/** Outlines for a palette loft, in a box 1 unit tall with the bottom outline 1 unit across. */
export function starterSections(input: LoftStarter): LoftSection[] {
  const starter = normalizeLoftStarter(input);
  const top = starter.topScale / 100;
  const twist = (starter.twist * Math.PI) / 180;
  // Only an outline that keeps its shape can turn through the middle; two different
  // outlines twist on the straight run between them.
  const sameOutline = starter.bottom === starter.top && starter.bottom !== "circle";
  const rows = sameOutline && Math.abs(starter.twist) > 1e-6
    ? Math.min(25, Math.ceil(Math.abs(starter.twist) / TWIST_STEP_DEGREES)) + 1
    : 2;
  const sections: LoftSection[] = [];
  for (let row = 0; row < rows; row += 1) {
    const t = row / (rows - 1);
    const kind = row === rows - 1 ? starter.top : starter.bottom;
    sections.push({ y: t, loop: starterOutline(kind, starter.sides, 0.5 * (1 + (top - 1) * t), twist * t) });
  }
  return sections;
}

function starterSpec(starter: LoftStarter, span: [number, number, number], wall: number): LoftSpec {
  const fitted = fitLoftSections(starterSections(starter));
  const twisted = fitted.sections.length > 2;
  return { sections: fitted.sections, smooth: twisted, wall, span, starter };
}

/** Bottom outline's share of the loft's width and depth. */
function bottomShare(spec: LoftSpec): [number, number] {
  const first = spec.sections[0];
  if (!first) return [1, 1];
  const bounds = loopBounds(first.loop);
  return [Math.max(1e-6, bounds.maxX - bounds.minX), Math.max(1e-6, bounds.maxZ - bounds.minZ)];
}

/** Palette drop: a square-to-circle loft whose preview stands in until the kernel builds it. */
export function createLoftShape(point?: { x: number; z: number; elevation?: number }, base?: Partial<WorkplaneShape>): WorkplaneShape {
  const starter = normalizeLoftStarter(base?.loftSpec?.starter);
  const spec = starterSpec(starter, [20, 20, 25], 0);
  // The bottom outline is 20 mm across; the box around both outlines follows from it.
  const [shareX, shareZ] = bottomShare(spec);
  spec.span = [20 / shareX, 20 / shareZ, 25];
  const draft: WorkplaneShape = {
    id: base?.id ?? createLocalId("loft"),
    name: base?.name ?? "Loft",
    kind: "loft",
    color: base?.color ?? LOFT_COLOR,
    x: point?.x ?? base?.x ?? 0,
    z: point?.z ?? base?.z ?? 0,
    elevation: point?.elevation ?? base?.elevation ?? 0,
    size: Math.max(spec.span[0], spec.span[1]),
    width: spec.span[0],
    depth: spec.span[1],
    height: spec.span[2],
    rotation: base?.rotation ?? 0,
    rotationX: 0,
    rotationZ: 0,
    locked: false,
    hidden: false,
    loftSpec: spec,
  };
  return withLoftPreview(draft);
}

/** Change a palette loft's outlines. The bottom outline keeps its size in mm. */
export function withLoftStarter(shape: WorkplaneShape, patch: Partial<LoftStarter>): WorkplaneShape {
  const spec = shape.loftSpec;
  if (!spec?.starter) return shape;
  const span = currentLoftSpan(shape);
  const [oldX, oldZ] = bottomShare(spec);
  const next = starterSpec(normalizeLoftStarter({ ...spec.starter, ...patch }), span, spec.wall);
  const [newX, newZ] = bottomShare(next);
  next.span = [span[0] * oldX / newX, span[1] * oldZ / newZ, span[2]];
  return withLoftPreview({ ...shape, loftSpec: next });
}

export function withLoftSettings(shape: WorkplaneShape, patch: Partial<Pick<LoftSpec, "smooth" | "wall">>): WorkplaneShape {
  const spec = shape.loftSpec;
  if (!spec) return shape;
  return withLoftPreview({ ...shape, loftSpec: { ...spec, span: currentLoftSpan(shape), ...patch } });
}

/** The fields an outline or setting change replaces, as one shape update. */
export function loftPatch(next: WorkplaneShape): Partial<WorkplaneShape> {
  return {
    loftSpec: next.loftSpec,
    importedMesh: next.importedMesh,
    width: next.width,
    depth: next.depth,
    height: next.height,
    size: next.size,
    cadBrep: undefined,
    cadBrepFrame: undefined,
    cadPrimitiveFrame: undefined,
    cadDisplayEdges: undefined,
    cadDisplayEdgesVersion: undefined,
    loftBuilt: undefined,
  };
}

/** Thickest wall the loft can take: just under half its narrowest outline. */
export function maxLoftWall(shape: WorkplaneShape): number {
  const spec = shape.loftSpec;
  if (!spec) return 0;
  const span = currentLoftSpan(shape);
  let narrowest = Infinity;
  for (const section of spec.sections) {
    const bounds = loopBounds(section.loop);
    narrowest = Math.min(narrowest, (bounds.maxX - bounds.minX) * span[0], (bounds.maxZ - bounds.minZ) * span[1]);
  }
  return Number.isFinite(narrowest) ? Math.max(0, narrowest / 2 - 0.2) : 0;
}

// --------------------------------------------------------------------------------
// Sketch loft
// --------------------------------------------------------------------------------

/** Turn about +Y as the viewport turns a shape (Object3D rotation.y). */
function yawPoint(x: number, z: number, degrees: number): LoftPoint {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos + z * sin, -x * sin + z * cos];
}

/** The outline a shape adds to a sketch loft, in world mm at the shape's floor. */
function sectionForShape(shape: WorkplaneShape): LoftSection | string {
  if (Math.abs(shape.rotationX ?? 0) > 0.01 || Math.abs(shape.rotationZ ?? 0) > 0.01) {
    return `${shape.name} is tipped over. Loft works on outlines that lie flat.`;
  }
  const width = shape.width ?? shape.size;
  const depth = shape.depth ?? shape.size;
  let local: LoftLoop | null = null;
  if (shape.sketchProfile) {
    const plane = resolveSketchPlane(shape.sketchPlane ?? shape.sketchProfile.sketchPlane);
    if (Math.abs(plane.normal.y) < 0.999) return `${shape.name} was sketched on a wall. Loft works on outlines that lie flat.`;
    const outlines = materialOutlines(shape.sketchProfile);
    const outer = [...outlines].sort((a, b) => pathArea(b) - pathArea(a))[0];
    const serialized = outer ? serializeSketchLoop(outer, shape.sketchDoc) : null;
    const loop = serialized ? loopFromKernelLoop(serialized) : null;
    if (!loop) return `${shape.name} has no closed outline to loft.`;
    const world = mapLoop(loop, ([u, v]) => {
      const point = planeUVToWorld(plane, u, v);
      return [point.x, point.z];
    });
    // The sketch may have been moved, stretched or turned since it was drawn.
    const bounds = loopBounds(world);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const sx = width / Math.max(1e-6, bounds.maxX - bounds.minX);
    const sz = depth / Math.max(1e-6, bounds.maxZ - bounds.minZ);
    local = mapLoop(world, ([x, z]) => [(x - cx) * sx, (z - cz) * sz]);
  } else if (shape.kind === "box") {
    local = rectLoop(0, 0, width / 2, depth / 2);
  } else if (shape.kind === "cylinder") {
    local = circleLoop(0, 0, width / 2, depth / 2);
  } else if (shape.kind === "polygon") {
    local = polygonLoop(shape.sides ?? 6, width / 2, depth / 2);
  }
  if (!local) return `${shape.name} can't be lofted. Use sketches, boxes, cylinders or polygons.`;
  const yaw = shape.rotation ?? 0;
  const mirrorX = shape.mirrorX ? -1 : 1;
  const mirrorZ = shape.mirrorZ ? -1 : 1;
  return {
    y: shape.elevation ?? 0,
    loop: mapLoop(local, ([x, z]) => {
      const [wx, wz] = yawPoint(x * mirrorX, z * mirrorZ, yaw);
      return [wx + shape.x, wz + shape.z];
    }),
  };
}

export function canLoftShape(shape: WorkplaneShape) {
  if (shape.locked || shape.hole || shape.groupedShapes?.length) return false;
  if (shape.sketchProfile) return true;
  return shape.kind === "box" || shape.kind === "cylinder" || shape.kind === "polygon";
}

/** Loft between the selected outlines, bottom to top. The outlines are kept inside it. */
export function createSketchLoft(shapes: readonly WorkplaneShape[]): { shape: WorkplaneShape } | { error: string } {
  if (shapes.length < MIN_LOFT_SECTIONS) return { error: "Select two or more outlines stacked at different heights to loft between them." };
  const sections: LoftSection[] = [];
  for (const shape of shapes) {
    const section = sectionForShape(shape);
    if (typeof section === "string") return { error: section };
    sections.push(section);
  }
  sections.sort((a, b) => a.y - b.y);
  for (let index = 1; index < sections.length; index += 1) {
    if (sections[index].y - sections[index - 1].y < MIN_SECTION_GAP) {
      return { error: "Two outlines sit at the same height. Raise one so they stack, then loft." };
    }
  }
  const fitted = fitLoftSections(sections);
  const ordered = [...shapes].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
  const draft: WorkplaneShape = {
    id: createLocalId("loft"),
    name: "Loft",
    kind: "loft",
    color: ordered[0].color,
    x: fitted.center.x,
    z: fitted.center.z,
    elevation: fitted.center.elevation,
    size: Math.max(fitted.span[0], fitted.span[1]),
    width: fitted.span[0],
    depth: fitted.span[1],
    height: fitted.span[2],
    rotation: 0,
    rotationX: 0,
    rotationZ: 0,
    locked: false,
    hidden: false,
    loftSpec: {
      sections: fitted.sections,
      smooth: fitted.sections.length > 2,
      wall: 0,
      span: fitted.span,
      sources: ordered.map((shape) => ({ ...shape })),
    },
  };
  // A smooth loft can bulge past its outlines; the shape box follows the body.
  return { shape: withLoftPreview(draft, true) };
}

/** The outlines a sketch loft was made from, where they were. */
export function loftSources(shape: WorkplaneShape): WorkplaneShape[] {
  return shape.kind === "loft" ? [...(shape.loftSpec?.sources ?? [])] : [];
}

// --------------------------------------------------------------------------------
// Size and build key
// --------------------------------------------------------------------------------

/** The outline box in mm for the loft as sized now: a resize stretches it from the last build. */
export function currentLoftSpan(shape: WorkplaneShape): [number, number, number] {
  const spec = shape.loftSpec;
  if (!spec) return [shape.width ?? shape.size, shape.depth ?? shape.size, shape.height];
  const mesh = shape.importedMesh;
  if (!mesh?.baseWidth || !mesh.baseDepth || !mesh.baseHeight) return [...spec.span];
  return [
    spec.span[0] * (shape.width ?? shape.size) / mesh.baseWidth,
    spec.span[1] * (shape.depth ?? shape.size) / mesh.baseDepth,
    spec.span[2] * shape.height / mesh.baseHeight,
  ];
}

function hashText(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

const round = (value: number) => Math.round(value * 1e4) / 1e4;

/** Everything the exact body depends on, as a short key. */
export function loftShapeKey(shape: WorkplaneShape): string | null {
  const spec = shape.loftSpec;
  if (shape.kind !== "loft" || !spec || spec.sections.length < MIN_LOFT_SECTIONS) return null;
  const span = currentLoftSpan(shape).map((value) => Math.round(value * 1000) / 1000);
  const sections = spec.sections.map((section) => [round(section.y), round(section.loop.start[0]), round(section.loop.start[1]),
    section.loop.steps.map((step) => (step.kind === "bezier" ? [...step.c1, ...step.c2, ...step.to] : step.to).map(round))]);
  const text = JSON.stringify([sections, spec.smooth, round(spec.wall), span]);
  return `loft-${hashText(text)}-${text.length}`;
}

/** True once a fillet, hollow or other step was applied: the body is then the part, not the outlines. */
export function loftHasSteps(shape: WorkplaneShape) {
  return Boolean(shape.features?.length || shape.edgeTreatments?.length || shape.featureBase);
}

export function loftBuildPending(shape: WorkplaneShape): boolean {
  if (loftHasSteps(shape)) return false;
  const key = loftShapeKey(shape);
  return Boolean(key) && shape.loftBuilt !== key;
}

/** Job payload for the kernel (`type: "buildLoft"`), in mm with the floor at y = 0. */
export function serializeLoftJob(shape: WorkplaneShape) {
  const spec = shape.loftSpec;
  const key = loftShapeKey(shape);
  if (!spec || !key) return null;
  return {
    type: "buildLoft" as const,
    name: shape.name,
    key,
    loft: {
      sections: loftSectionsMm(spec, currentLoftSpan(shape)),
      smooth: spec.smooth,
      wall: Math.max(0, spec.wall),
    },
  };
}

// --------------------------------------------------------------------------------
// Meshes
// --------------------------------------------------------------------------------

function resampleRing(points: readonly LoftPoint[], count: number): LoftPoint[] {
  const lengths = [0];
  for (let index = 1; index <= points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index % points.length];
    lengths.push(lengths[index - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = lengths[lengths.length - 1];
  const ring: LoftPoint[] = [];
  let segment = 0;
  for (let index = 0; index < count; index += 1) {
    const target = (total * index) / count;
    while (segment < points.length - 1 && lengths[segment + 1] < target) segment += 1;
    const a = points[segment];
    const b = points[(segment + 1) % points.length];
    const span = lengths[segment + 1] - lengths[segment];
    const t = span > 1e-12 ? (target - lengths[segment]) / span : 0;
    ring.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return ring;
}

/** Turn a ring's start to the point that best follows the ring below it. */
function alignRing(ring: LoftPoint[], below: readonly LoftPoint[]): LoftPoint[] {
  const centroid = (points: readonly LoftPoint[]) => points.reduce<LoftPoint>((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length], [0, 0]);
  const [ax, az] = centroid(ring);
  const [bx, bz] = centroid(below);
  let best = 0;
  let bestCost = Infinity;
  for (let shift = 0; shift < ring.length; shift += 1) {
    let cost = 0;
    for (let index = 0; index < ring.length && cost < bestCost; index += 1) {
      const p = ring[(index + shift) % ring.length];
      const q = below[index];
      cost += (p[0] - ax - (q[0] - bx)) ** 2 + (p[1] - az - (q[1] - bz)) ** 2;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = shift;
    }
  }
  return ring.map((_, index) => ring[(index + best) % ring.length]);
}

type Row = { y: number; ring: LoftPoint[] };

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function loftRows(sections: readonly LoftSection[], smooth: boolean): Row[] {
  const rows: Row[] = [];
  for (const section of sections) {
    const ring = resampleRing(sampleLoop(section.loop), RING_POINTS);
    rows.push({ y: section.y, ring: rows.length ? alignRing(ring, rows[rows.length - 1].ring) : ring });
  }
  if (!smooth || rows.length < 3) return rows;
  const out: Row[] = [];
  for (let span = 0; span < rows.length - 1; span += 1) {
    const r0 = rows[Math.max(0, span - 1)];
    const r1 = rows[span];
    const r2 = rows[span + 1];
    const r3 = rows[Math.min(rows.length - 1, span + 2)];
    for (let step = 0; step < SMOOTH_ROWS_PER_SPAN; step += 1) {
      const t = step / SMOOTH_ROWS_PER_SPAN;
      out.push({
        y: catmullRom(r0.y, r1.y, r2.y, r3.y, t),
        ring: r1.ring.map((_, index) => [
          catmullRom(r0.ring[index][0], r1.ring[index][0], r2.ring[index][0], r3.ring[index][0], t),
          catmullRom(r0.ring[index][1], r1.ring[index][1], r2.ring[index][1], r3.ring[index][1], t),
        ]),
      });
    }
  }
  out.push(rows[rows.length - 1]);
  return out;
}

function insetRing(ring: readonly LoftPoint[], wall: number): LoftPoint[] {
  return ring.map((point, index) => {
    const prev = ring[(index - 1 + ring.length) % ring.length];
    const next = ring[(index + 1) % ring.length];
    const tx = next[0] - prev[0];
    const tz = next[1] - prev[1];
    const length = Math.hypot(tx, tz) || 1;
    // Counterclockwise in x / z, so the outward side is (tz, -tx).
    return [point[0] - (tz / length) * wall, point[1] + (tx / length) * wall];
  });
}

/**
 * Quick stand-in mesh for the loft while the kernel builds the exact body, in the loft's
 * own frame: outlines centred on x = z = 0, floor at y = 0.
 */
export function loftPreviewMesh(spec: LoftSpec, span: readonly [number, number, number] = spec.span) {
  const rows = loftRows(loftSectionsMm(spec, span), spec.smooth);
  const positions: number[] = [];
  const indices: number[] = [];
  const count = RING_POINTS;
  const addRows = (list: readonly Row[]) => {
    const base = positions.length / 3;
    for (const row of list) for (const [x, z] of row.ring) positions.push(x, row.y, z);
    return base;
  };
  const vertex = (index: number) => [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
  const triangle = (a: number, b: number, c: number, wantY = 0) => {
    if (wantY !== 0) {
      const [ax, , az] = vertex(a);
      const [bx, , bz] = vertex(b);
      const [cx, , cz] = vertex(c);
      // y of (b - a) x (c - a)
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      if (Math.sign(ny) !== Math.sign(wantY)) {
        indices.push(a, c, b);
        return;
      }
    }
    indices.push(a, b, c);
  };
  const side = (base: number, rowCount: number, outward: boolean) => {
    for (let row = 0; row < rowCount - 1; row += 1) {
      for (let index = 0; index < count; index += 1) {
        const a = base + row * count + index;
        const b = base + row * count + ((index + 1) % count);
        const c = b + count;
        const d = a + count;
        if (outward) {
          indices.push(a, c, b, a, d, c);
        } else {
          indices.push(a, b, c, a, c, d);
        }
      }
    }
  };
  const outer = addRows(rows);
  side(outer, rows.length, true);
  const wall = Math.max(0, spec.wall);
  if (wall > 1e-6) {
    const innerRows = rows.map((row) => ({ y: row.y, ring: insetRing(row.ring, wall) }));
    const inner = addRows(innerRows);
    side(inner, innerRows.length, false);
    // Rims between the two walls, wound to match them so the skin stays closed.
    const bottomOuter = outer;
    const bottomInner = inner;
    const topOuter = outer + (rows.length - 1) * count;
    const topInner = inner + (rows.length - 1) * count;
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      indices.push(bottomOuter + index, bottomOuter + next, bottomInner + next, bottomOuter + index, bottomInner + next, bottomInner + index);
      indices.push(topOuter + index, topInner + next, topOuter + next, topOuter + index, topInner + index, topInner + next);
    }
  } else {
    const ends: Array<[number, number]> = [[0, -1], [rows.length - 1, 1]];
    for (const [row, wantY] of ends) {
      const ring = rows[row].ring;
      const base = positions.length / 3;
      for (const [x, z] of ring) positions.push(x, rows[row].y, z);
      const faces = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const [a, b, c] of faces) triangle(base + a, base + b, base + c, wantY);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = Array.from(geometry.getAttribute("normal").array as Float32Array);
  geometry.dispose();
  return { positions, normals, indices };
}

function withLoftMesh(
  shape: WorkplaneShape,
  positions: ArrayLike<number>,
  normals: ArrayLike<number> | undefined,
  indices: ArrayLike<number>,
  span: [number, number, number],
  moveToBody: boolean,
): WorkplaneShape | null {
  const placed = meshInLocalFrame(Float32Array.from(positions), Float32Array.from(normals ?? []), Uint32Array.from(indices));
  if (!placed || !shape.loftSpec) return null;
  // The body can bulge a little past its outlines; on a fresh loft the shape box moves to
  // the body. Later rebuilds keep the shape where the user put it.
  const offset = moveToBody ? yawPoint(placed.centerX, placed.centerZ, shape.rotation ?? 0) : [0, 0];
  return {
    ...shape,
    x: shape.x + offset[0],
    z: shape.z + offset[1],
    width: placed.width,
    depth: placed.depth,
    height: placed.height,
    size: Math.max(placed.width, placed.depth),
    loftSpec: { ...shape.loftSpec, span },
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
  };
}

/** Show the loft's quick preview mesh at its current size. The exact body is rebuilt after. */
export function withLoftPreview(shape: WorkplaneShape, moveToBody = false): WorkplaneShape {
  const spec = shape.loftSpec;
  if (shape.kind !== "loft" || !spec) return shape;
  const span = currentLoftSpan(shape);
  const mesh = loftPreviewMesh(spec, span);
  const next = withLoftMesh(shape, mesh.positions, mesh.normals, mesh.indices, span, moveToBody);
  if (!next) return shape;
  return canonicalizeShape({
    ...next,
    cadBrep: undefined,
    cadBrepFrame: undefined,
    cadPrimitiveFrame: undefined,
    cadDisplayEdges: undefined,
    cadDisplayEdgesVersion: undefined,
    loftBuilt: undefined,
  });
}

/** Attach the kernel's exact loft body; null if it no longer matches the shape. */
export function applyLoftKernelMesh(
  shape: WorkplaneShape,
  positions: ArrayLike<number>,
  normals: ArrayLike<number> | undefined,
  indices: ArrayLike<number>,
  cadBrep: string,
  builtKey: string,
): WorkplaneShape | null {
  if (!cadBrep.trim() || loftShapeKey(shape) !== builtKey) return null;
  const span = currentLoftSpan(shape);
  const next = withLoftMesh(shape, positions, normals, indices, span, false);
  if (!next) return null;
  return canonicalizeShape({
    ...next,
    cadBrep,
    cadBrepFrame: {
      x: next.x,
      z: next.z,
      elevation: next.elevation ?? 0,
      width: next.width ?? next.size,
      depth: next.depth ?? next.size,
      height: next.height,
    },
    cadPrimitiveFrame: undefined,
    cadDisplayEdges: undefined,
    cadDisplayEdgesVersion: undefined,
    loftBuilt: builtKey,
  });
}

/** Build the exact loft body in the kernel worker. */
export async function buildLoftShape(shape: WorkplaneShape): Promise<WorkplaneShape | null> {
  if (typeof window === "undefined") return null;
  const { lastOcctKernelError, runOcctKernelInWorker } = await import("@/lib/occtKernelClient");
  const built = await runOcctKernelInWorker({ type: "loft", shape });
  // A refusal from the engine (outlines it cannot join, a wall too thick) is worth saying.
  const message = built ? null : lastOcctKernelError();
  if (message) throw new Error(message);
  return built;
}
