import { createLocalId } from "@/lib/localIds";
import {
  findMetricThread,
  findThreadSize,
  resolveThreadParams,
  type MetricThreadDesignation,
  type ThreadSeries,
} from "@/lib/metricThreads";
import {
  buildMetricThreadedCylinder,
  DEFAULT_THREAD_CLEARANCE,
  DEFAULT_THREAD_SIDES,
  MAX_THREAD_CLEARANCE,
  MAX_THREAD_SIDES,
  MIN_THREAD_CLEARANCE,
  MIN_THREAD_SIDES,
  type ThreadHead,
  type ThreadMeshPart,
  type ThreadProfile,
  type ThreadRole,
} from "@/lib/metricThreadSolid";
import { canonicalizeShape, withHoleMode } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

export const DEFAULT_THREAD_DESIGNATION: MetricThreadDesignation = "M6";
export const DEFAULT_THREAD_HEIGHT = 20;

export type ThreadStyle = "screw" | "hole";

export type ThreadShapeSpec = {
  designation: string;
  majorDiameter: number;
  pitch: number;
  /** screw = solid fastener; hole = clearance cutter for tapping a receiving hole. */
  style?: ThreadStyle;
  /** Radial clearance in mm (applied to nuts and tapped holes). */
  clearance?: number;
  /** After Separate: shaft-only or threads-only piece. */
  part?: ThreadMeshPart;
  role?: ThreadRole;
  head?: ThreadHead;
  hand?: "right" | "left";
  series?: ThreadSeries;
  profile?: ThreadProfile;
  chamfer?: number;
  length?: number;
};

function clampThreadSides(sides?: number) {
  const value = Math.round(sides ?? DEFAULT_THREAD_SIDES);
  return Math.max(MIN_THREAD_SIDES, Math.min(MAX_THREAD_SIDES, value));
}

function clampThreadClearance(clearance?: number) {
  const value = Number.isFinite(clearance) ? Number(clearance) : 0;
  return Math.max(MIN_THREAD_CLEARANCE, Math.min(MAX_THREAD_CLEARANCE, value));
}

export function threadSpecForDesignation(designation: MetricThreadDesignation): ThreadShapeSpec {
  const preset = findMetricThread(designation) ?? findMetricThread(DEFAULT_THREAD_DESIGNATION)!;
  return {
    designation: preset.designation,
    majorDiameter: preset.majorDiameter,
    pitch: preset.pitch,
    style: "screw",
    clearance: 0,
    part: "screw",
  };
}

function normalizeThreadSpec(input?: Partial<ThreadShapeSpec> | WorkplaneShape["threadSpec"] | null): ThreadShapeSpec {
  const requested = input?.designation ?? DEFAULT_THREAD_DESIGNATION;
  const listed = findThreadSize(requested) ?? findThreadSize(DEFAULT_THREAD_DESIGNATION)!;
  const custom = input?.series === "custom" || requested === "Custom";
  const majorDiameter = custom
    ? Math.max(0.8, input?.majorDiameter ?? listed.majorDiameter)
    : listed.majorDiameter;
  const pitch = custom
    ? Math.max(0.15, input?.pitch ?? listed.pitch)
    : listed.pitch;
  const style: ThreadStyle = input?.style === "hole" ? "hole" : "screw";
  const part: ThreadMeshPart =
    input?.part === "shaft" || input?.part === "threads" || input?.part === "screw"
      ? input.part
      : style === "hole"
        ? "threads"
        : "screw";
  const role: ThreadRole = input?.role
    ?? (style === "hole" || part === "threads" ? "bore" : "rod");
  const clearance = clampThreadClearance(
    input?.clearance ?? (role === "bore" || role === "nut" ? DEFAULT_THREAD_CLEARANCE : 0),
  );
  return {
    designation: custom ? "Custom" : listed.id,
    majorDiameter,
    pitch,
    style: role === "bore" ? "hole" : "screw",
    clearance,
    part: role === "bore" ? "threads" : part === "shaft" ? "shaft" : "screw",
    role,
    head: input?.head === "countersunk" || input?.head === "hex" ? input.head : "cylinder",
    hand: input?.hand === "left" ? "left" : "right",
    series: custom ? "custom" : listed.series,
    profile: input?.profile === "trapezoid" || input?.profile === "round" || input?.profile === "whitworth" ? input.profile : "v",
    chamfer: Math.max(0, Math.min(2, input?.chamfer ?? 0.3)),
    length: input?.length,
  };
}

function shapeNameForSpec(spec: ThreadShapeSpec, fallback?: string) {
  const keepCustomName = fallback
    && !fallback.startsWith("Threads")
    && !fallback.startsWith("Shaft")
    && !fallback.startsWith("Thread cutter")
    && !fallback.startsWith("Rod ")
    && !fallback.startsWith("Screw ")
    && !fallback.startsWith("Nut ")
    && !fallback.startsWith("Tapped hole ");
  if (keepCustomName) return fallback;
  const size = spec.designation;
  if (spec.part === "shaft") return `Shaft ${size}`;
  if (spec.role === "nut") return `Nut ${size}`;
  if (spec.role === "bore") return `Tapped hole ${size}`;
  if (spec.role === "screw") return `Screw ${size}`;
  return `Rod ${size}`;
}

/** Instant procedural metric screw / shaft / hole-cutter (no WASM). */
export function createThreadShape(options: {
  designation?: string;
  height?: number;
  point?: { x: number; z: number; elevation?: number };
  base?: Partial<WorkplaneShape> & Pick<WorkplaneShape, "id" | "name" | "color">;
}): WorkplaneShape {
  const sides = clampThreadSides(options.base?.sides);
  const prior = options.base?.threadSpec;
  const spec = normalizeThreadSpec({
    designation: options.designation ?? prior?.designation,
    majorDiameter: prior?.majorDiameter,
    pitch: prior?.pitch,
    style: prior?.style,
    clearance: prior?.clearance,
    part: prior?.part,
    role: prior?.role,
    head: prior?.head,
    hand: prior?.hand,
    series: prior?.series,
    profile: prior?.profile,
    chamfer: prior?.chamfer,
    length: prior?.length ?? options.height ?? options.base?.height,
  });
  const length = Math.max(0.5, spec.length ?? options.height ?? options.base?.height ?? DEFAULT_THREAD_HEIGHT);
  const params = resolveThreadParams({
    designation: findMetricThread(spec.designation)?.designation,
    majorDiameter: spec.majorDiameter,
    pitch: spec.pitch,
    length,
    side: spec.role === "bore" || spec.role === "nut" ? "internal" : "external",
    handedness: spec.hand,
  });
  const clearance = spec.role === "bore" || spec.role === "nut" ? clampThreadClearance(spec.clearance) : 0;
  const mesh = buildMetricThreadedCylinder(params, length, {
    sides,
    clearance,
    part: spec.part,
    role: spec.role,
    head: spec.head,
    chamfer: spec.chamfer,
    profile: spec.profile,
  });
  const x = options.point?.x ?? options.base?.x ?? 0;
  const z = options.point?.z ?? options.base?.z ?? 0;
  const elevation = options.point?.elevation ?? options.base?.elevation ?? 0;
  const id = options.base?.id ?? createLocalId("thread");
  const asHole = spec.role === "bore";
  const color = asHole ? "#b8c2cc" : (options.base?.color ?? "#d97813");
  const name = shapeNameForSpec(spec, options.base?.name);

  const shape = canonicalizeShape({
    id,
    name,
    kind: "thread",
    color,
    hole: asHole || undefined,
    x,
    z,
    elevation,
    size: Math.max(mesh.width, mesh.depth),
    width: mesh.width,
    depth: mesh.depth,
    height: mesh.height,
    sides,
    rotation: options.base?.rotation ?? 0,
    rotationX: options.base?.rotationX ?? 0,
    rotationZ: options.base?.rotationZ ?? 0,
    mirrorX: options.base?.mirrorX,
    mirrorY: options.base?.mirrorY,
    mirrorZ: options.base?.mirrorZ,
    locked: options.base?.locked ?? false,
    hidden: options.base?.hidden ?? false,
    threadSpec: {
      designation: spec.designation,
      majorDiameter: spec.majorDiameter,
      pitch: spec.pitch,
      style: spec.style,
      clearance,
      part: spec.part,
      role: spec.role,
      head: spec.head,
      hand: spec.hand,
      series: spec.series,
      profile: spec.profile,
      chamfer: spec.chamfer,
      length,
    },
    importedMesh: {
      positions: Array.from(mesh.positions),
      normals: Array.from(mesh.normals),
      baseWidth: mesh.width,
      baseDepth: mesh.depth,
      baseHeight: mesh.height,
      triangleCount: mesh.triangleCount,
      sourceFormat: "json",
    },
    cadBrep: undefined,
    cadBrepFrame: undefined,
    cadPrimitiveFrame: undefined,
    cadDisplayEdges: undefined,
    cadDisplayEdgesVersion: undefined,
  });

  return asHole ? withHoleMode(shape, true) : shape;
}

/** True when a Threads screw can be split into shaft + thread cutter. */
export function canSeparateThreadScrew(shape: WorkplaneShape) {
  if (shape.kind !== "thread" || shape.locked || shape.hole) return false;
  const role = shape.threadSpec?.role;
  if (role === "nut" || role === "bore" || role === "screw") return false;
  const part = shape.threadSpec?.part ?? "screw";
  const style = shape.threadSpec?.style ?? "screw";
  return part === "screw" && style === "screw";
}

/**
 * Split a screw into a solid shaft and a hole-ready thread cutter (with clearance).
 */
export function separateThreadScrewParts(shape: WorkplaneShape): WorkplaneShape[] {
  if (!canSeparateThreadScrew(shape)) return [];
  const designation = shape.threadSpec?.designation ?? DEFAULT_THREAD_DESIGNATION;
  const clearance = clampThreadClearance(shape.threadSpec?.clearance || DEFAULT_THREAD_CLEARANCE);
  const length = shape.threadSpec?.length ?? shape.height;
  const shared = {
    height: length,
    point: { x: shape.x, z: shape.z, elevation: shape.elevation },
  };
  const carried = {
    designation,
    majorDiameter: shape.threadSpec?.majorDiameter ?? 6,
    pitch: shape.threadSpec?.pitch ?? 1,
    hand: shape.threadSpec?.hand,
    series: shape.threadSpec?.series,
    profile: shape.threadSpec?.profile,
    chamfer: shape.threadSpec?.chamfer,
    length,
  };

  const shaft = createThreadShape({
    ...shared,
    designation,
    base: {
      id: createLocalId("thread-shaft"),
      name: `Shaft ${designation}`,
      color: shape.color,
      sides: shape.sides,
      rotation: shape.rotation,
      rotationX: shape.rotationX,
      rotationZ: shape.rotationZ,
      mirrorX: shape.mirrorX,
      mirrorY: shape.mirrorY,
      mirrorZ: shape.mirrorZ,
      threadSpec: {
        ...carried,
        style: "screw",
        clearance: 0,
        part: "shaft",
        role: "rod",
      },
      hole: false,
    },
  });

  const cutter = createThreadShape({
    ...shared,
    designation,
    base: {
      id: createLocalId("thread-cutter"),
      name: `Thread cutter ${designation}`,
      color: "#b8c2cc",
      sides: shape.sides,
      rotation: shape.rotation,
      rotationX: shape.rotationX,
      rotationZ: shape.rotationZ,
      mirrorX: shape.mirrorX,
      mirrorY: shape.mirrorY,
      mirrorZ: shape.mirrorZ,
      threadSpec: {
        ...carried,
        style: "hole",
        clearance,
        part: "threads",
        role: "bore",
      },
      hole: true,
    },
  });

  // Nudge the cutter slightly so both remain selectable after split.
  return [
    shaft,
    canonicalizeShape({ ...cutter, x: cutter.x + 0.01 }),
  ];
}
