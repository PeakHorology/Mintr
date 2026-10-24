import * as THREE from "three";
import type { WorkplaneShape } from "@/types/sketchforge";
import { createLocalId } from "@/lib/localIds";
import { loadBrepWithOcct, type Brep } from "@/lib/brepKernel";
import { quaternionToAxisAngleDegrees, seatRotationForIndexedMeshes } from "@/lib/meshSeatOrientation";
import { registerPendingImportedBrep } from "@/lib/importedBrepSource";
import { hasNativeOcctKernel, nativeKernelWindow } from "@/lib/nativeKernelProtocol";
import { cadModifierRequestTimeoutMs } from "@/lib/cadModifierRuntime";

const STEP_EXTENSIONS = new Set(["step", "stp"]);
const MIN_IMPORT_DIMENSION = 0.01;

export function isStepFile(fileName: string): boolean {
  return STEP_EXTENSIONS.has(fileName.split(".").pop()?.toLowerCase() ?? "");
}

type Tessellation = {
  vertices: ArrayLike<number>;
  normals: ArrayLike<number>;
  triangles: ArrayLike<number>;
};

type Bounds = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };

/** One body's indexed display mesh in the seated (Y-up, lay-flat) frame, before recentering. */
type SeatedBody = {
  name: string;
  part: unknown;
  positions: number[];
  normals: number[] | undefined;
  indices: number[];
  bounds: Bounds;
};

function fileStem(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "") || "Imported STEP";
}

function usableTessellation(tess: Tessellation | undefined): tess is Tessellation {
  return Boolean(tess && tess.vertices.length >= 9 && tess.triangles.length >= 3);
}

function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
}

/** Rotate vertices/normals into the seated frame, keeping the tessellation indexed. */
function seatBody(name: string, part: unknown, tess: Tessellation, rotation: THREE.Quaternion | null): SeatedBody {
  const vertexCount = Math.floor(tess.vertices.length / 3);
  const positions = new Array<number>(vertexCount * 3);
  const hasNormals = tess.normals.length === tess.vertices.length;
  const normals = hasNormals ? new Array<number>(vertexCount * 3) : undefined;
  const bounds = emptyBounds();
  const point = new THREE.Vector3();
  for (let v = 0; v < vertexCount; v += 1) {
    const i = v * 3;
    point.set(tess.vertices[i], tess.vertices[i + 1], tess.vertices[i + 2]);
    if (rotation) point.applyQuaternion(rotation);
    positions[i] = point.x;
    positions[i + 1] = point.y;
    positions[i + 2] = point.z;
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxY = Math.max(bounds.maxY, point.y);
    bounds.minZ = Math.min(bounds.minZ, point.z);
    bounds.maxZ = Math.max(bounds.maxZ, point.z);
    if (normals) {
      point.set(tess.normals[i], tess.normals[i + 1], tess.normals[i + 2]);
      if (rotation) point.applyQuaternion(rotation).normalize();
      normals[i] = point.x;
      normals[i + 1] = point.y;
      normals[i + 2] = point.z;
    }
  }
  const usable = tess.triangles.length - (tess.triangles.length % 3);
  const indices = new Array<number>(usable);
  for (let i = 0; i < usable; i += 1) indices[i] = tess.triangles[i];
  return { name, part, positions, normals, indices, bounds };
}

function stepTextFromSolid(brep: Brep, solid: unknown) {
  return async () => {
    const exported = brep.exportSTEP(solid as never);
    if (!exported.ok) return undefined;
    const text = await exported.value.text();
    return text.trim() ? text : undefined;
  };
}

type SeatFrame = { axis: [number, number, number]; angle: number; translation: THREE.Vector3 };

/** Live solid when meshing on this thread, or STEP text captured before a coarser worker mesh. */
type ExactSource =
  | { kind: "solid"; brep: Brep; part: unknown }
  | { kind: "text"; text: string };

export type StepImportProgress = {
  index: number;
  total: number;
  name: string;
  phase: "mesh" | "place";
};

export type StepImportHooks = {
  onProgress?: (progress: StepImportProgress) => void;
  /** Bodies received so far, in their relative layout, before the final lay-flat. */
  onPreview?: (shapes: WorkplaneShape[]) => void;
};

const ZERO_SEAT: SeatFrame = { axis: [1, 0, 0], angle: 0, translation: new THREE.Vector3() };

/**
 * Build the editor shape for one seated body: local mesh XZ-centred with y ≥ 0, placed at
 * x = 10 + cx, z = −10 + cz, elevation = minY in the assembly's floor-seated frame.
 * `exact` is null for a preview that will be replaced by the seated import.
 */
function shapeFromSeatedBody(body: SeatedBody, seat: SeatFrame, exact: ExactSource | null): WorkplaneShape {
  const { bounds } = body;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const local = body.positions;
  for (let i = 0; i < local.length; i += 3) {
    local[i] -= cx;
    local[i + 1] -= bounds.minY;
    local[i + 2] -= cz;
  }
  const width = Math.max(MIN_IMPORT_DIMENSION, bounds.maxX - bounds.minX);
  const height = Math.max(MIN_IMPORT_DIMENSION, bounds.maxY - bounds.minY);
  const depth = Math.max(MIN_IMPORT_DIMENSION, bounds.maxZ - bounds.minZ);
  const placement = {
    x: cx + seat.translation.x,
    y: bounds.minY + seat.translation.y,
    z: cz + seat.translation.z,
  };
  const shape: WorkplaneShape = {
    id: createLocalId("uploaded-mesh"),
    name: body.name,
    kind: "mesh",
    color: "#0098c7",
    x: 10 + placement.x,
    z: -10 + placement.z,
    elevation: placement.y,
    size: Math.max(width, depth),
    width,
    depth,
    height,
    rotation: 0,
    rotationX: 0,
    rotationZ: 0,
    importedMesh: {
      positions: local,
      indices: body.indices,
      normals: body.normals?.length ? body.normals : undefined,
      baseWidth: width,
      baseDepth: depth,
      baseHeight: height,
      triangleCount: Math.floor(body.indices.length / 3),
      sourceFormat: "step",
    },
    locked: false,
    hidden: false,
  };

  if (exact && (exact.kind === "solid" || exact.text) && shape.importedMesh) {
    const recenter: [number, number, number] = [-cx, -bounds.minY, -cz];
    registerPendingImportedBrep(shape.importedMesh, () => bakeExactSource(exact, seat, recenter));
  }
  return shape;
}

function bakeExactSource(exact: ExactSource, seat: SeatFrame, recenter: [number, number, number]) {
  if (exact.kind === "solid") {
    return (async () => {
      let solid = exact.part;
      if (Math.abs(seat.angle) > 1e-6) {
        solid = exact.brep.rotate(solid as never, seat.angle, { axis: seat.axis });
      }
      if (Math.hypot(recenter[0], recenter[1], recenter[2]) > 1e-12) {
        solid = exact.brep.translate(solid as never, recenter);
      }
      return stepTextFromSolid(exact.brep, solid)();
    })();
  }
  // Coarse display meshing can crash a later export of that same solid, so the worker
  // captured this text first. Replaying it uses the window kernel, which did not mesh it.
  return (async () => {
    if (!exact.text) return undefined;
    const brep = await loadBrepWithOcct();
    const imported = await brep.importSTEP(new Blob([exact.text]));
    if (!imported.ok) return undefined;
    let solid: unknown = imported.value;
    if (Math.abs(seat.angle) > 1e-6) {
      solid = brep.rotate(solid as never, seat.angle, { axis: seat.axis });
    }
    if (Math.hypot(recenter[0], recenter[1], recenter[2]) > 1e-12) {
      solid = brep.translate(solid as never, recenter);
    }
    return stepTextFromSolid(brep, solid)();
  })();
}

function assemblyTranslation(bodies: SeatedBody[]) {
  const assembly = emptyBounds();
  for (const { bounds } of bodies) {
    assembly.minX = Math.min(assembly.minX, bounds.minX);
    assembly.maxX = Math.max(assembly.maxX, bounds.maxX);
    assembly.minY = Math.min(assembly.minY, bounds.minY);
    assembly.maxY = Math.max(assembly.maxY, bounds.maxY);
    assembly.minZ = Math.min(assembly.minZ, bounds.minZ);
    assembly.maxZ = Math.max(assembly.maxZ, bounds.maxZ);
  }
  return new THREE.Vector3(
    -(assembly.minX + assembly.maxX) / 2,
    -assembly.minY,
    -(assembly.minZ + assembly.maxZ) / 2,
  );
}

function placeShape(shape: WorkplaneShape, body: SeatedBody, translation: THREE.Vector3): WorkplaneShape {
  const { bounds } = body;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const x = 10 + cx + translation.x;
  const z = -10 + cz + translation.z;
  const elevation = bounds.minY + translation.y;
  if (shape.x === x && shape.z === z && shape.elevation === elevation) return shape;
  return { ...shape, x, z, elevation };
}

type CollectedBody = { name: string; tess: Tessellation; exact: ExactSource };

function shapesFromCollected(collected: CollectedBody[], hooks?: StepImportHooks): WorkplaneShape[] {
  hooks?.onProgress?.({
    index: collected.length,
    total: collected.length,
    name: "Placing parts…",
    phase: "place",
  });
  const rotation = seatRotationForIndexedMeshes(
    collected.map(({ tess }) => ({ positions: tess.vertices, indices: tess.triangles })),
  );
  const { axis, angle } = quaternionToAxisAngleDegrees(rotation);
  const rotate = Math.abs(angle) > 1e-6 ? rotation : null;
  const bodies = collected.map(({ name, tess }) => seatBody(name, null, tess, rotate));
  const translation = assemblyTranslation(bodies);
  const seat = { axis, angle, translation };
  return bodies.map((body, index) => shapeFromSeatedBody(body, seat, collected[index].exact));
}

type StepWorkerMessage =
  | { type: "progress"; requestId: number; index: number; total: number; name: string }
  | { type: "body"; requestId: number; index: number; total: number; name: string; stepText: string; vertices: Float32Array; normals: Float32Array; triangles: Uint32Array }
  | { type: "done"; requestId: number; total: number }
  | { type: "error"; requestId: number; message: string };

let stepWorker: Worker | null = null;
let stepRequestSerial = 0;
const importListeners = new Map<number, (message: StepWorkerMessage) => void>();

/** Longest silence tolerated from the STEP worker before it is presumed hung. */
const STEP_WORKER_IDLE_TIMEOUT_MS = 120_000;

function failPendingStepWork(message: string) {
  const pending = [...importListeners.values()];
  importListeners.clear();
  for (const listener of pending) listener({ type: "error", requestId: -1, message });
}

/**
 * Drop the worker so the next import starts a fresh WASM heap. An OCCT
 * failure inside WASM often leaves the module unable to read the next file,
 * and a hung import would otherwise block every later one.
 */
function recycleStepWorker(reason: string) {
  const worker = stepWorker;
  stepWorker = null;
  if (worker) {
    try {
      worker.terminate();
    } catch {
      // Already gone.
    }
  }
  failPendingStepWork(reason);
}

function ensureStepWorker(): Worker {
  if (stepWorker) return stepWorker;
  const worker = new Worker(new URL("../workers/stepImport.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<StepWorkerMessage>) => {
    const message = event.data;
    importListeners.get(message.requestId)?.(message);
  };
  worker.onerror = () => {
    if (stepWorker === worker) recycleStepWorker("STEP import stopped unexpectedly");
  };
  stepWorker = worker;
  return worker;
}

function previewCollector(hooks?: StepImportHooks) {
  const bodies: SeatedBody[] = [];
  const shapes: WorkplaneShape[] = [];
  return {
    add(name: string, tess: Tessellation) {
      if (!hooks?.onPreview) return;
      const body = seatBody(name, null, tess, null);
      bodies.push(body);
      shapes.push(shapeFromSeatedBody(body, ZERO_SEAT, null));
      const translation = assemblyTranslation(bodies);
      hooks.onPreview(shapes.map((shape, index) => placeShape(shape, bodies[index], translation)));
    },
  };
}

async function collectedFromWorker(fileName: string, buffer: ArrayBuffer, hooks?: StepImportHooks): Promise<CollectedBody[]> {
  const worker = ensureStepWorker();
  const requestId = ++stepRequestSerial;
  const preview = previewCollector(hooks);
  const collected: CollectedBody[] = [];
  await new Promise<void>((resolve, reject) => {
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      importListeners.delete(requestId);
      if (watchdog !== null) clearTimeout(watchdog);
    };
    const armWatchdog = () => {
      if (watchdog !== null) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (!importListeners.has(requestId)) return;
        recycleStepWorker(`${fileName} took too long to read. The file may be corrupt or far larger than Mintr can open here.`);
      }, STEP_WORKER_IDLE_TIMEOUT_MS);
    };
    importListeners.set(requestId, (message) => {
      if (message.type === "error") {
        finish();
        // A worker-reported error for this file means its WASM heap may be
        // damaged; start the next import on a clean one.
        if (message.requestId === requestId && stepWorker === worker) {
          stepWorker = null;
          try { worker.terminate(); } catch { /* Already gone. */ }
        }
        reject(new Error(message.message));
        return;
      }
      armWatchdog();
      if (message.type === "progress") {
        hooks?.onProgress?.({ index: message.index, total: message.total, name: message.name, phase: "mesh" });
        return;
      }
      if (message.type === "body") {
        const tess = { vertices: message.vertices, normals: message.normals, triangles: message.triangles };
        if (!usableTessellation(tess)) return;
        collected.push({
          name: message.name,
          tess,
          exact: { kind: "text", text: message.stepText.trim() },
        });
        preview.add(message.name, tess);
        return;
      }
      if (message.type === "done") {
        finish();
        resolve();
      }
    });
    armWatchdog();
    worker.postMessage({ type: "import", requestId, fileName, buffer }, [buffer]);
  });
  return collected;
}

async function collectedOnMain(fileName: string, buffer: ArrayBuffer, hooks?: StepImportHooks): Promise<CollectedBody[]> {
  const brep = await loadBrepWithOcct();
  const imported = await brep.importSTEP(new Blob([buffer]));
  if (!imported.ok) {
    throw new Error(`Could not read STEP: ${String(imported.error.message ?? imported.error)}`);
  }
  const flipped = brep.rotate(imported.value, -90, { axis: [1, 0, 0] });
  const solids = brep.getSolids(flipped as never);
  const stem = fileStem(fileName);
  const parts: Array<{ name: string; part: unknown }> = solids.length > 1
    ? solids.map((part, index) => ({ name: `${stem} ${index + 1}`, part }))
    : [{ name: stem, part: flipped }];
  const preview = previewCollector(hooks);
  const collected: CollectedBody[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const { name, part } = parts[index];
    hooks?.onProgress?.({ index: index + 1, total: parts.length, name, phase: "mesh" });
    if (hooks?.onProgress || hooks?.onPreview) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    // Default mesh quality on this thread. A coarser chord corrupts later exports in the same
    // kernel; the browser worker captures exact STEP first, then meshes more coarsely.
    const tess = brep.mesh(part as never) as Tessellation;
    if (!usableTessellation(tess)) continue;
    collected.push({ name, tess, exact: { kind: "solid", brep, part } });
    preview.add(name, tess);
  }
  return collected;
}

async function finishImport(collected: CollectedBody[], hooks?: StepImportHooks) {
  if (collected.length === 0) {
    throw new Error("STEP file has no solid geometry to import");
  }
  return shapesFromCollected(collected, hooks);
}

async function collectedFromNative(fileName: string, buffer: ArrayBuffer, hooks?: StepImportHooks): Promise<CollectedBody[] | null> {
  const api = nativeKernelWindow()?.peakcadKernel;
  if (!api?.request) return null;
  const step = new TextDecoder("latin1").decode(new Uint8Array(buffer));
  try {
    const reply = await api.request({ id: Date.now(), type: "importStep", fileName, step }, cadModifierRequestTimeoutMs());
    if (!reply || reply.ok === false || reply.fallback || !reply.bodies?.length) return null;
    const preview = previewCollector(hooks);
    const collected: CollectedBody[] = [];
    for (const body of reply.bodies) {
      const vertices = Float32Array.from(body.positions ?? []);
      const triangles = Uint32Array.from(body.indices ?? []);
      const normals = Float32Array.from(body.normals ?? []);
      const tess = { vertices, normals, triangles };
      if (!usableTessellation(tess) || !body.stepText?.trim()) continue;
      collected.push({
        name: body.name,
        tess,
        exact: { kind: "text", text: body.stepText.trim() },
      });
      preview.add(body.name, tess);
    }
    return collected.length > 0 ? collected : null;
  } catch {
    return null;
  }
}

export async function importedShapesFromStep(
  fileName: string,
  buffer: ArrayBuffer,
  hooks?: StepImportHooks,
): Promise<WorkplaneShape[]> {
  if (hasNativeOcctKernel()) {
    const native = await collectedFromNative(fileName, buffer, hooks);
    if (native) return finishImport(native, hooks);
  }
  // Tests and any environment without a window mesh on this thread. The browser hands each
  // body to a worker so the window can keep drawing parts as they finish.
  if (typeof window !== "undefined" && typeof Worker !== "undefined") {
    try {
      ensureStepWorker();
    } catch {
      return finishImport(await collectedOnMain(fileName, buffer, hooks), hooks);
    }
    return finishImport(await collectedFromWorker(fileName, buffer, hooks), hooks);
  }
  return finishImport(await collectedOnMain(fileName, buffer, hooks), hooks);
}

export async function importedShapeFromStep(fileName: string, buffer: ArrayBuffer): Promise<WorkplaneShape> {
  const shapes = await importedShapesFromStep(fileName, buffer);
  return shapes[0];
}
