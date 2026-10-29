import { browserMintrKernel } from "@/lib/browserMintrKernel";
import { inferCsgOp } from "@/lib/csgTree";
import { gearPlanLoops, normalizeGearSpec, rackPlanLoop } from "@/lib/gearProfile";
import { gridfinityRecipeForShape, isGridfinityKind, type GridfinityRecipe } from "@/lib/gridfinity";
import { roofAnglesFromProfile } from "@/lib/roofGeometry";
import { NATIVE_EXACT_KINDS } from "@/lib/shapeBrep";
import { shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

export type NativeKernelSolid = {
  hole: boolean;
  kind: string;
  name?: string;
  width: number;
  depth: number;
  height: number;
  x: number;
  z: number;
  elevation: number;
  rotation: number;
  rotationX?: number;
  rotationZ?: number;
  radius?: number;
  baseRadius?: number;
  topRadius?: number;
  sides?: number;
  bevel?: number;
  ridgeX?: number;
  mirrorX?: boolean;
  mirrorY?: boolean;
  mirrorZ?: boolean;
  profileLoops?: { outer: Array<[number, number]>; holes: Array<Array<[number, number]>> };
  /** Spur and ring gears: built with true involute teeth; profileLoops is the fallback. */
  gearSpec?: { form: string; teeth: number; module: number; pressureAngle: number; backlash: number; bore: number; rim: number };
  brepStep?: string;
  cadBrep?: string;
  /**
   * Scale a stored solid so its box matches width/height/depth.
   * False for a fillet or chamfer that has not been resized: the exact solid
   * is already the right size, and fitting it to a tolerance box shrinks it.
   */
  fitScale?: boolean;
  /** A group: its children in the group's own frame, combined by `op`, then the group's pose. */
  op?: "union" | "subtract" | "intersect" | "assemble";
  children?: NativeKernelSolid[];
  /** Generator body (`kind: "recipe"`) the kernel builds from add / cut solids. */
  recipe?: GridfinityRecipe;
};

export type NativeKernelJob =
  | { id: number; type: "ping" }
  | { id: number; type: "boolean"; op: "subtract" | "union" | "intersect"; solids: NativeKernelSolid[]; angularDeflection?: number }
  | { id: number; type: "exportStep"; solids: NativeKernelSolid[] }
  | { id: number; type: "split"; solids: NativeKernelSolid[]; origin: [number, number, number]; normal: [number, number, number]; joint: string; clearance: number; axis: string; angularDeflection?: number }
  | { id: number; type: "printOverlay"; solids: NativeKernelSolid[]; overhang: boolean; angle: number; thinWalls: boolean; smallHoles: boolean; trappedResin: boolean; nozzleMm: number }
  | { id: number; type: "measure"; solids: NativeKernelSolid[] }
  | { id: number; type: "sketchExtrude"; [key: string]: unknown }
  | { id: number; type: "sketchSweep"; [key: string]: unknown }
  | { id: number; type: "importStep"; fileName: string; step: string }
  | { id: number; type: "buildRecipe"; recipe: GridfinityRecipe; name?: string; key?: string }
  | { id: number; requestId: number; type: string; [key: string]: unknown };

export type NativeKernelReply = {
  id?: number;
  ok?: boolean;
  fallback?: boolean;
  message?: string;
  native?: boolean;
  type?: string;
  requestId?: number;
  resetSession?: boolean;
  positions?: number[];
  normals?: number[];
  indices?: number[];
  triangleCount?: number;
  brep?: string;
  cadBrep?: string;
  brepStep?: string;
  quality?: "exact" | "faceted";
  displayEdges?: { points: number[] }[];
  edges?: Array<{
    id: number;
    points: number[];
    display: boolean;
    selectable: boolean;
    angle: number;
    boundary: boolean;
    manifold: boolean;
  }>;
  selectableEdgeIds?: number[];
  cylindricalFaces?: unknown[];
  planarFaces?: unknown[];
  sourceType?: string;
  smooth?: boolean;
  skippedEdgeIds?: number[];
  step?: string;
  bodies?: Array<{
    name: string;
    stepText?: string;
    positions?: number[];
    normals?: number[];
    indices?: number[];
  }>;
  exportedCount?: number;
  exactCount?: number;
  facetedCount?: number;
  skipped?: Array<{ name: string; kind: string; reason: string }>;
  degraded?: Array<{ name: string; kind: string; reason: string }>;
  volume?: number;
  area?: number;
  parts?: Array<{
    name: string;
    positions?: number[];
    normals?: number[];
    brepStep?: string;
    x?: number;
    z?: number;
    elevation?: number;
    width?: number;
    height?: number;
    depth?: number;
  }>;
  overhangPositions?: number[];
  overhangNormals?: number[];
  thinPositions?: number[];
  thinNormals?: number[];
  holePositions?: number[];
  holeNormals?: number[];
  trappedPositions?: number[];
  trappedNormals?: number[];
};

/**
 * The desktop app hands mesh numbers over as typed arrays (fast to pass across). Results
 * that end up saved in a project, or are read as plain lists, get ordinary arrays back.
 */
export function plainNativeReply<T>(value: T): T {
  if (value instanceof Float32Array || value instanceof Uint32Array) return Array.from(value) as T;
  if (Array.isArray(value)) return value.map((item) => plainNativeReply(item)) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = plainNativeReply(item);
  return out as T;
}

type PeakcadKernelApi = {
  ready?: () => Promise<boolean>;
  request?: (job: NativeKernelJob, timeoutMs: number) => Promise<NativeKernelReply | null>;
};

export function nativeKernelWindow(): (Window & { peakcadKernel?: PeakcadKernelApi }) | undefined {
  return (globalThis as { window?: Window & { peakcadKernel?: PeakcadKernelApi } }).window;
}

export function hasNativeOcctKernel() {
  return Boolean(nativeKernelWindow()?.peakcadKernel?.request);
}

/**
 * The Mintr engine: the desktop app's MintrKernel.exe, or in the browser the same C++
 * built to WebAssembly. Undefined once the browser build has failed to load, so callers
 * go straight to the occt-wasm code paths.
 */
export function mintrKernel(): PeakcadKernelApi | undefined {
  const desktop = nativeKernelWindow()?.peakcadKernel;
  if (desktop?.request) return desktop;
  return browserMintrKernel();
}

/** True when the desktop sidecar exe is on disk. Browser and missing-exe Electron still use WASM. */
export async function nativeOcctKernelIsReady() {
  const api = nativeKernelWindow()?.peakcadKernel;
  if (!api?.ready && !api?.request) return false;
  if (!api.ready) return Boolean(api.request);
  try {
    return Boolean(await api.ready());
  } catch {
    return false;
  }
}

/** Spawn MintrKernel.exe before the first CAD job. No-op in the browser. */
export function warmNativeOcctKernel() {
  const api = nativeKernelWindow()?.peakcadKernel;
  if (!api?.request) return;
  void api.request({ id: Date.now(), type: "ping" }, 8000).catch(() => undefined);
}

export async function requestNativeKernelJob(job: NativeKernelJob, timeoutMs = 45_000): Promise<NativeKernelReply | null> {
  const api = nativeKernelWindow()?.peakcadKernel;
  if (!api?.request) return null;
  try {
    return plainNativeReply(await api.request(job, timeoutMs));
  } catch {
    return null;
  }
}

/** A group's child in the group's own frame, stretched with the group when it was resized. */
function localChildFromGroup(group: WorkplaneShape, child: WorkplaneShape): WorkplaneShape {
  const sx = group.groupedBaseWidth ? shapeWidth(group) / Math.max(0.001, group.groupedBaseWidth) : 1;
  const sy = group.groupedBaseHeight ? group.height / Math.max(0.001, group.groupedBaseHeight) : 1;
  const sz = group.groupedBaseDepth ? shapeDepth(group) / Math.max(0.001, group.groupedBaseDepth) : 1;
  const width = shapeWidth(child) * sx;
  const depth = shapeDepth(child) * sz;
  const height = child.height * sy;
  return {
    ...child,
    x: child.x * sx,
    z: child.z * sz,
    elevation: (child.elevation ?? 0) * sy,
    width,
    depth,
    height,
    size: (width + depth) / 2,
  };
}

/** True when the user changed the size after the exact solid was stored. */
function storedSolidWasResized(shape: WorkplaneShape): boolean {
  const frame = shape.cadBrepFrame;
  if (frame) {
    return Math.abs(shapeWidth(shape) - frame.width) > 1e-3
      || Math.abs(shapeDepth(shape) - frame.depth) > 1e-3
      || Math.abs(shape.height - frame.height) > 1e-3;
  }
  const mesh = shape.importedMesh;
  if (!mesh?.baseWidth || !mesh.baseHeight || !mesh.baseDepth) return true;
  return Math.abs(shapeWidth(shape) - mesh.baseWidth) > 1e-3
    || Math.abs(shapeDepth(shape) - mesh.baseDepth) > 1e-3
    || Math.abs(shape.height - mesh.baseHeight) > 1e-3;
}

export function toNativeKernelSolid(shape: WorkplaneShape): NativeKernelSolid | null {
  if (shape.suppressed || shape.csg?.suppressed || shape.construction || shape.hidden) return null;
  const pose = {
    hole: Boolean(shape.hole),
    name: shape.name,
    width: shapeWidth(shape),
    depth: shapeDepth(shape),
    height: shape.height,
    x: shape.x,
    z: shape.z,
    elevation: shape.elevation ?? 0,
    rotation: shape.rotation ?? 0,
    rotationX: shape.rotationX,
    rotationZ: shape.rotationZ,
    radius: shape.radius,
    baseRadius: shape.baseRadius,
    topRadius: shape.topRadius,
    sides: shape.sides,
    bevel: shape.bevel,
    ridgeX: undefined as number | undefined,
    mirrorX: shape.mirrorX,
    mirrorY: shape.mirrorY,
    mirrorZ: shape.mirrorZ,
  };
  if (shape.kind === "roof" || shape.kind === "wedge") {
    pose.ridgeX = roofAnglesFromProfile(pose.width, pose.height, shape.leftAngle, shape.rightAngle).ridgeX;
  }
  const step = shape.importedMesh?.brepStep;
  const storedStep = step ? { ...pose, kind: "step", brepStep: step, fitScale: storedSolidWasResized(shape) } : null;
  // A group's own baked STEP wins over its fillet, as in the browser; on a single
  // shape a newer fillet (cadBrep) wins over a STEP stored before it, and a box
  // or cylinder stays exact even when it still carries a STEP.
  if (storedStep && shape.groupedShapes?.length) return storedStep;
  if (shape.cadBrep) {
    return { ...pose, kind: "brep", cadBrep: shape.cadBrep, fitScale: storedSolidWasResized(shape) };
  }
  if (storedStep && !NATIVE_EXACT_KINDS.has(shape.kind)) return storedStep;
  if (isGridfinityKind(shape.kind)) {
    // Build still pending (no cadBrep yet): the kernel can rebuild the body from its recipe.
    const recipe = gridfinityRecipeForShape(shape);
    return recipe ? { ...pose, kind: "recipe", recipe } : null;
  }
  if (!NATIVE_EXACT_KINDS.has(shape.kind)) return null;
  if (shape.kind === "gear") {
    const spec = normalizeGearSpec(shape.gearSpec);
    if (spec.form === "rack") {
      return {
        ...pose,
        kind: "gear",
        profileLoops: { outer: rackPlanLoop(spec, pose.depth).map((point) => [point.x, point.z]), holes: [] },
      };
    }
    const loops = gearPlanLoops(spec);
    return {
      ...pose,
      kind: "gear",
      gearSpec: { form: spec.form, teeth: spec.teeth, module: spec.module, pressureAngle: spec.pressureAngle, backlash: spec.backlash, bore: spec.bore, rim: spec.rim },
      profileLoops: {
        outer: loops.outer.map((point) => [point.x, point.z]),
        holes: loops.holes.map((hole) => hole.map((point) => [point.x, point.z])),
      },
    };
  }
  return { ...pose, kind: shape.kind, ridgeX: pose.ridgeX };
}

/**
 * One shape for the desktop engine, built the way the browser builds it. A group
 * becomes one node: its children in the group's frame, combined by the group's
 * operation, then the group's full pose. So a hole inside a group cuts only that
 * group, and a tilted or mirrored group comes out tilted or mirrored.
 */
function encodeNativeKernelShape(shape: WorkplaneShape): NativeKernelSolid | null {
  if (shape.importedMesh?.brepStep || shape.cadBrep || !shape.groupedShapes?.length) return toNativeKernelSolid(shape);
  const op = inferCsgOp(shape) ?? "union";
  const children: NativeKernelSolid[] = [];
  for (const child of shape.groupedShapes) {
    // Inside a group only a switched-off feature is left out, as in the browser.
    if (child.suppressed || child.csg?.suppressed) continue;
    const encoded = encodeNativeKernelShape(localChildFromGroup(shape, { ...child, hidden: false, construction: false }));
    if (!encoded) return null;
    children.push(encoded);
  }
  if (children.length === 0) return null;
  return {
    hole: Boolean(shape.hole),
    kind: "group",
    name: shape.name,
    op,
    children,
    width: shapeWidth(shape),
    depth: shapeDepth(shape),
    height: shape.height,
    x: shape.x,
    z: shape.z,
    elevation: shape.elevation ?? 0,
    rotation: shape.rotation ?? 0,
    rotationX: shape.rotationX,
    rotationZ: shape.rotationZ,
    mirrorX: shape.mirrorX,
    mirrorY: shape.mirrorY,
    mirrorZ: shape.mirrorZ,
  };
}

export function toNativeKernelSolids(shapes: WorkplaneShape[]): NativeKernelSolid[] | null {
  const solids: NativeKernelSolid[] = [];
  for (const shape of shapes) {
    if (shape.suppressed || shape.csg?.suppressed || shape.construction || shape.hidden) continue;
    const encoded = encodeNativeKernelShape(shape);
    if (!encoded) return null;
    solids.push(encoded);
  }
  return solids.length > 0 ? solids : null;
}
