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
  brepStep?: string;
  cadBrep?: string;
  /** Generator body (`kind: "recipe"`) the kernel builds from add / cut solids. */
  recipe?: GridfinityRecipe;
};

export type NativeKernelJob =
  | { id: number; type: "ping" }
  | { id: number; type: "boolean"; op: "subtract" | "union" | "intersect"; solids: NativeKernelSolid[] }
  | { id: number; type: "exportStep"; solids: NativeKernelSolid[] }
  | { id: number; type: "split"; solids: NativeKernelSolid[]; origin: [number, number, number]; normal: [number, number, number]; joint: string; clearance: number; axis: string }
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
    return await api.request(job, timeoutMs);
  } catch {
    return null;
  }
}

function worldChildFromGroup(group: WorkplaneShape, child: WorkplaneShape): WorkplaneShape {
  const yaw = ((group.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const sx = group.groupedBaseWidth ? shapeWidth(group) / Math.max(0.001, group.groupedBaseWidth) : 1;
  const sy = group.groupedBaseHeight ? group.height / Math.max(0.001, group.groupedBaseHeight) : 1;
  const sz = group.groupedBaseDepth ? shapeDepth(group) / Math.max(0.001, group.groupedBaseDepth) : 1;
  const width = shapeWidth(child) * sx;
  const depth = shapeDepth(child) * sz;
  const height = child.height * sy;
  const lx = child.x * sx;
  const lz = child.z * sz;
  return {
    ...child,
    x: group.x + lx * cos - lz * sin,
    z: group.z + lx * sin + lz * cos,
    elevation: (group.elevation ?? 0) + (child.elevation ?? 0) * sy,
    width,
    depth,
    height,
    size: (width + depth) / 2,
    rotation: (group.rotation ?? 0) + (child.rotation ?? 0),
    hidden: group.hidden ? true : child.hidden,
  };
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
  if (shape.importedMesh?.brepStep) {
    return { ...pose, kind: "step", brepStep: shape.importedMesh.brepStep };
  }
  if (shape.cadBrep) {
    return { ...pose, kind: "brep", cadBrep: shape.cadBrep };
  }
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
      profileLoops: {
        outer: loops.outer.map((point) => [point.x, point.z]),
        holes: loops.holes.map((hole) => hole.map((point) => [point.x, point.z])),
      },
    };
  }
  return { ...pose, kind: shape.kind, ridgeX: pose.ridgeX };
}

function collectNativeKernelSolids(shape: WorkplaneShape, solids: NativeKernelSolid[]): boolean {
  if (shape.suppressed || shape.csg?.suppressed || shape.construction || shape.hidden) return true;
  if (shape.importedMesh?.brepStep || shape.cadBrep) {
    const encoded = toNativeKernelSolid(shape);
    if (!encoded) return false;
    solids.push(encoded);
    return true;
  }
  if (shape.groupedShapes?.length) {
    for (const child of shape.groupedShapes) {
      if (!collectNativeKernelSolids(worldChildFromGroup(shape, child), solids)) return false;
    }
    return true;
  }
  const encoded = toNativeKernelSolid(shape);
  if (!encoded) return false;
  solids.push(encoded);
  return true;
}

export function toNativeKernelSolids(shapes: WorkplaneShape[]): NativeKernelSolid[] | null {
  const solids: NativeKernelSolid[] = [];
  for (const shape of shapes) {
    if (shape.suppressed || shape.csg?.suppressed || shape.construction || shape.hidden) continue;
    if (!collectNativeKernelSolids(shape, solids)) return null;
  }
  return solids.length > 0 ? solids : null;
}
