import { meshForShape, sanitizeName, type MeshData, type Vec3 } from "@/lib/editorShapeMesh";
import { shapeUsesImportedMesh } from "@/lib/gridfinity";
import { meshGeometryKey, textContentKey } from "@/lib/meshContentHash";
import { aabbsOverlap, worldAabb, type Aabb } from "@/lib/shapeBounds";
import type { WorkplaneShape } from "@/types/sketchforge";
import { normalizeSurfaceTexture, SIDE_DIRECTIONS, type SurfaceTexture, type SurfaceTextureFacePick } from "./surfaceTexture";
import { CONTACT_MM, faceRegions, pickedRegions, stampCentre, type FaceRegions } from "./textureFaces";
import { faceNormals, weldTriangles, type IndexedMesh } from "./textureMesh";
import { facePickFromWorld, facePickToPosed, partOrigin } from "./textureFrame";
import { textureSurfaceOffThread } from "./surfaceTextureClient";
import {
  STAMP_FACING,
  STAMP_REACH,
  stampFrame,
  surfaceTexturePreview,
  type SurfaceTexturePreview,
  type SurfaceTextureResult,
} from "./textureApply";

/**
 * The textured triangles of each part, built in the background and kept until
 * the part or its texture changes. The mesh is in the part's posed frame: the
 * world orientation, with the origin moved to the part's centre on the bed
 * (x, elevation + height / 2, z). Moving a part reuses it; turning or resizing
 * it builds a new one, because the bottom that stays smooth depends on pose.
 */
type Entry =
  | { status: "pending"; promise: Promise<SurfaceTextureResult | null> }
  | { status: "ready"; result: SurfaceTextureResult }
  | { status: "failed"; message: string };

const MAX_ENTRIES = 24;
const entries = new Map<string, Entry>();
/** When each build finished, so the view can show a new texture rising into place once. */
const finishedAt = new Map<string, number>();
const RISE_WINDOW_MS = 520;
const listeners = new Set<() => void>();
let readyVersion = 0;
/** How far each running build has got, 0 to 1. */
const progressByKey = new Map<string, number>();
const progressListeners = new Set<() => void>();

/** Called as a build moves on, for a progress bar. Does not redraw the parts. */
export function onSurfaceTextureProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

/** How far the build for this texture has got, 0 to 1, or null when it has not started. */
export function surfaceTextureProgress(key: string): number | null {
  return progressByKey.get(key) ?? null;
}

/** Goes up each time a texture finishes, so a textured part knows to redraw. */
export function surfaceTextureVersion(): number {
  return readyVersion;
}

function announce() {
  readyVersion += 1;
  listeners.forEach((listener) => listener());
}

/** Called when a textured mesh finishes building, so the viewport can show it. */
export function onSurfaceTextureReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function canTextureShape(shape: WorkplaneShape): boolean {
  if (shape.hole || shape.construction) return false;
  if (shape.kind === "sketch") return false;
  return !shape.groupedShapes?.length || shapeUsesImportedMesh(shape);
}

export function hasSurfaceTexture(shape: WorkplaneShape): boolean {
  return Boolean(shape.surfaceTexture) && canTextureShape(shape);
}

/** The plain body in the posed frame, flat arrays for the engine. */
function posedSource(shape: WorkplaneShape) {
  const mesh = meshForShape({ ...shape, surfaceTexture: undefined });
  const [ox, oy, oz] = partOrigin(shape);
  const positions = new Float32Array(mesh.vertices.length * 3);
  mesh.vertices.forEach(([x, y, z], i) => {
    positions[i * 3] = x - ox;
    positions[i * 3 + 1] = y - oy;
    positions[i * 3 + 2] = z - oz;
  });
  const indices = new Uint32Array(mesh.faces.length * 3);
  mesh.faces.forEach(([a, b, c], i) => {
    indices[i * 3] = a;
    indices[i * 3 + 1] = b;
    indices[i * 3 + 2] = c;
  });
  return { positions, indices };
}

/** The settings the engine builds from: clicked faces moved into the posed frame. */
function engineTexture(shape: WorkplaneShape): SurfaceTexture {
  const texture = normalizeSurfaceTexture(shape.surfaceTexture);
  const stamp = texture.stamp ? { stamp: facePickToPosed(shape, texture.stamp) } : {};
  if (texture.faces !== "picked") return { ...texture, picks: [], sides: [], ...stamp };
  return { ...texture, picks: texture.picks.map((pick) => facePickToPosed(shape, pick)), ...stamp };
}

/** The chosen whole sides as facings in the posed frame, so they turn with the part. */
function sideDirectionsFor(shape: WorkplaneShape, texture: SurfaceTexture): [number, number, number][] {
  return texture.sides.map((side) => facePickToPosed(shape, { point: [0, 0, 0], normal: SIDE_DIRECTIONS[side] }).normal);
}

/** The part's six sides as facings in the posed frame. */
function partAxesFor(shape: WorkplaneShape): [number, number, number][] {
  return Object.values(SIDE_DIRECTIONS).map((normal) => facePickToPosed(shape, { point: [0, 0, 0], normal }).normal);
}

/** Other parts' triangles touching each textured part, in that part's posed frame. */
type Contacts = { key: string; triangles: Float32Array };
const contactsByShape = new Map<string, Contacts>();

function contactsFor(shape: WorkplaneShape, texture: SurfaceTexture): Contacts | null {
  return texture.smoothContacts ? contactsByShape.get(shape.id) ?? null : null;
}

function keyFor(shape: WorkplaneShape, source: { positions: Float32Array; indices: Uint32Array }) {
  const texture = engineTexture(shape);
  // A picture is long; its hash stands in for it.
  const settings = JSON.stringify(texture, (name, value) => (name === "data" && typeof value === "string" ? textContentKey(value) : value));
  return `${meshGeometryKey(source)}|${settings}|${contactsFor(shape, texture)?.key ?? ""}`;
}

const grown = (box: Aabb, by: number): Aabb => ({
  min: [box.min[0] - by, box.min[1] - by, box.min[2] - by],
  max: [box.max[0] + by, box.max[1] + by, box.max[2] + by],
});

function touchingTriangles(shape: WorkplaneShape, others: readonly WorkplaneShape[]): Float32Array {
  const box = grown(worldAabb(shape), CONTACT_MM * 2);
  const [ox, oy, oz] = partOrigin(shape);
  const out: number[] = [];
  for (const other of others) {
    if (other.id === shape.id || other.hole || other.construction || other.hidden || other.kind === "sketch") continue;
    if (!aabbsOverlap(box, worldAabb(other))) continue;
    let mesh: MeshData;
    try {
      mesh = meshForShape({ ...other, surfaceTexture: undefined });
    } catch {
      continue;
    }
    for (const [a, b, c] of mesh.faces) {
      const pa = mesh.vertices[a];
      const pb = mesh.vertices[b];
      const pc = mesh.vertices[c];
      let inside = true;
      for (let axis = 0; axis < 3 && inside; axis += 1) {
        const lo = Math.min(pa[axis], pb[axis], pc[axis]);
        const hi = Math.max(pa[axis], pb[axis], pc[axis]);
        inside = hi >= box.min[axis] && lo <= box.max[axis];
      }
      if (!inside) continue;
      out.push(pa[0] - ox, pa[1] - oy, pa[2] - oz, pb[0] - ox, pb[1] - oy, pb[2] - oz, pc[0] - ox, pc[1] - oy, pc[2] - oz);
    }
  }
  return new Float32Array(out);
}

/**
 * Tells textured parts what they touch, so a face pressed against another part stays
 * smooth and the parts still fit. Call when the shapes change; a part whose contacts
 * changed rebuilds its texture.
 */
export function setSurfaceTextureScene(shapes: readonly WorkplaneShape[]) {
  let changed = false;
  const seen = new Set<string>();
  for (const shape of shapes) {
    if (!hasSurfaceTexture(shape) || !normalizeSurfaceTexture(shape.surfaceTexture).smoothContacts) continue;
    seen.add(shape.id);
    const triangles = touchingTriangles(shape, shapes);
    const key = triangles.length ? meshGeometryKey({ positions: triangles }) : "";
    const known = contactsByShape.get(shape.id);
    if ((known?.key ?? "") === key) continue;
    if (key) contactsByShape.set(shape.id, { key, triangles });
    else contactsByShape.delete(shape.id);
    changed = true;
  }
  for (const id of [...contactsByShape.keys()]) {
    if (seen.has(id)) continue;
    contactsByShape.delete(id);
  }
  // Called while the editor draws; let listeners redraw after it.
  if (changed) queueMicrotask(announce);
}

function remember(key: string, entry: Entry) {
  entries.delete(key);
  entries.set(key, entry);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
    finishedAt.delete(oldest);
  }
}

/** When a texture that has just finished started rising, or null once it is in place. */
export function surfaceTextureRiseStart(key: string): number | null {
  const at = finishedAt.get(key);
  if (at === undefined) return null;
  if (performance.now() - at < RISE_WINDOW_MS) return at;
  finishedAt.delete(key);
  return null;
}

type Job = {
  key: string;
  shapeId: string;
  source: { positions: Float32Array; indices: Uint32Array };
  texture: SurfaceTexture;
  contacts: Float32Array | undefined;
  sideDirections: [number, number, number][];
  partAxes: [number, number, number][];
  queuedAt: number;
  resolve: (result: SurfaceTextureResult | null) => void;
};

/**
 * One build at a time. A newer build for the same part replaces one still waiting, and a
 * build waits a moment before it starts, so dragging a slider does not pile up work.
 */
const queue: Job[] = [];
let running = false;
const SETTLE_MS = 200;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function pump() {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const settle = queue[0].queuedAt + SETTLE_MS - Date.now();
    if (settle > 0) {
      await wait(settle);
      continue;
    }
    const job = queue.shift()!;
    const progress = (share: number) => {
      progressByKey.set(job.key, share);
      progressListeners.forEach((listener) => listener());
    };
    progress(0);
    try {
      const result = await textureSurfaceOffThread(job.source.positions, job.source.indices, job.texture, {
        contacts: job.contacts,
        sideDirections: job.sideDirections,
        partAxes: job.partAxes,
        onProgress: progress,
      });
      remember(job.key, { status: "ready", result });
      finishedAt.set(job.key, performance.now());
      job.resolve(result);
    } catch (error: unknown) {
      remember(job.key, { status: "failed", message: error instanceof Error ? error.message : "Texture failed" });
      job.resolve(null);
    }
    progressByKey.delete(job.key);
    announce();
  }
  running = false;
}

function start(key: string, shape: WorkplaneShape, source: { positions: Float32Array; indices: Uint32Array }) {
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    if (queue[i].shapeId !== shape.id) continue;
    const [dropped] = queue.splice(i, 1);
    entries.delete(dropped.key);
    dropped.resolve(null);
  }
  const promise = new Promise<SurfaceTextureResult | null>((resolve) => {
    const texture = engineTexture(shape);
    queue.push({ key, shapeId: shape.id, source, texture, contacts: contactsFor(shape, texture)?.triangles, sideDirections: sideDirectionsFor(shape, texture), partAxes: partAxesFor(shape), queuedAt: Date.now(), resolve });
  });
  remember(key, { status: "pending", promise });
  void pump();
  return promise;
}

export type SurfaceTextureState =
  | { status: "none" }
  | { status: "pending"; key: string }
  | { status: "ready"; key: string; result: SurfaceTextureResult }
  | { status: "failed"; key: string; message: string };

/** What the viewport can show now. Starts the build when nothing is under way. */
export function surfaceTextureState(shape: WorkplaneShape): SurfaceTextureState {
  if (!hasSurfaceTexture(shape)) return { status: "none" };
  let source: ReturnType<typeof posedSource>;
  try {
    source = posedSource(shape);
  } catch {
    return { status: "none" };
  }
  const key = keyFor(shape, source);
  const entry = entries.get(key);
  if (!entry) {
    void start(key, shape, source);
    return { status: "pending", key };
  }
  if (entry.status === "ready") return { status: "ready", key, result: entry.result };
  if (entry.status === "failed") return { status: "failed", key, message: entry.message };
  return { status: "pending", key };
}

/** Waits for the textured mesh, for export. Null when the part has no texture or it could not be built. */
export async function ensureSurfaceTexture(shape: WorkplaneShape): Promise<SurfaceTextureResult | null> {
  if (!hasSurfaceTexture(shape)) return null;
  const source = posedSource(shape);
  const key = keyFor(shape, source);
  // A waiting build can be replaced by a newer one for the same part; then start this one again.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const entry = entries.get(key);
    if (entry?.status === "ready") return entry.result;
    if (entry?.status === "failed") return null;
    const result = await (entry?.status === "pending" ? entry.promise : start(key, shape, source));
    if (result) return result;
  }
  return null;
}

/** True when every textured part among the shapes has its texture built. */
export function surfaceTexturesReady(shapes: readonly WorkplaneShape[]): boolean {
  return shapes.every((shape) => {
    const state = surfaceTextureState(shape);
    return state.status !== "pending";
  });
}

/** Builds any textures the shapes still need, so a sync export can read them. */
export async function ensureSurfaceTextures(shapes: readonly WorkplaneShape[]): Promise<void> {
  await Promise.all(shapes.map((shape) => ensureSurfaceTexture(shape)));
}

/** The part's triangles for printing: textured when its texture is ready, plain otherwise. */
export function printMeshForShape(shape: WorkplaneShape): MeshData {
  const state = surfaceTextureState(shape);
  if (state.status !== "ready") return meshForShape(shape);
  const { positions, indices } = state.result;
  const [ox, oy, oz] = partOrigin(shape);
  const vertices: Vec3[] = new Array(positions.length / 3);
  for (let i = 0; i < vertices.length; i += 1) {
    vertices[i] = [positions[i * 3] + ox, positions[i * 3 + 1] + oy, positions[i * 3 + 2] + oz];
  }
  const faces: [number, number, number][] = new Array(indices.length / 3);
  for (let i = 0; i < faces.length; i += 1) faces[i] = [indices[i * 3], indices[i * 3 + 1], indices[i * 3 + 2]];
  return { name: sanitizeName(shape.name), vertices, faces };
}

/** The part's faces, worked out once per shape of body, for telling which face a click landed on. */
let faceIndexCache: { key: string; mesh: IndexedMesh; normals: Float32Array; regions: FaceRegions } | null = null;

function faceIndex(shape: WorkplaneShape) {
  const source = posedSource(shape);
  const key = meshGeometryKey(source);
  if (faceIndexCache?.key !== key) {
    const mesh = weldTriangles(source.positions, source.indices);
    const { normals, areas } = faceNormals(mesh);
    faceIndexCache = { key, mesh, normals, regions: faceRegions(mesh, normals, areas) };
  }
  return faceIndexCache;
}

/** Which of the part's faces a pick lands on, so a second click on the same face can take it off. */
export function textureFaceOf(shape: WorkplaneShape, pick: SurfaceTextureFacePick): number | null {
  try {
    const index = faceIndex(shape);
    const [face] = pickedRegions(index.mesh, index.normals, index.regions, [facePickToPosed(shape, pick)]);
    return face ?? null;
  } catch {
    return null;
  }
}

const PREVIEW_ENTRIES = 8;
const previews = new Map<string, SurfaceTexturePreview>();

/**
 * The plain body ready to be shaded with the pattern, for showing a texture the
 * moment it changes while the real one builds. Quick: no splitting, and size
 * and depth changes reuse the same body.
 */
export function surfaceTexturePreviewFor(shape: WorkplaneShape): (SurfaceTexturePreview & { key: string; texture: SurfaceTexture }) | null {
  if (!hasSurfaceTexture(shape)) return null;
  try {
    const source = posedSource(shape);
    const texture = engineTexture(shape);
    // Only these change which faces are smooth or how the pattern wraps.
    const { faces, picks, sides, smoothHoles, smoothContacts, smoothBottomDeg, wrap, placement } = texture;
    const key = `${meshGeometryKey(source)}|${JSON.stringify({ faces, picks, sides, smoothHoles, smoothContacts, smoothBottomDeg, wrap, placement })}|${contactsFor(shape, texture)?.key ?? ""}`;
    let preview = previews.get(key);
    if (!preview) {
      preview = surfaceTexturePreview(source, texture, {
        contacts: contactsFor(shape, texture)?.triangles,
        sideDirections: sideDirectionsFor(shape, texture),
        partAxes: partAxesFor(shape),
      });
      previews.set(key, preview);
      while (previews.size > PREVIEW_ENTRIES) {
        const oldest = previews.keys().next().value;
        if (oldest === undefined) break;
        previews.delete(oldest);
      }
    }
    // Around a round part the repeats are a whole number, worked out for this size.
    const { circumference } = preview.layout;
    const layout = circumference
      ? (() => {
        const repeatsAround = Math.max(3, Math.round(circumference / texture.spacing));
        return { ...preview.layout, repeatsAround, spacingAround: circumference / repeatsAround };
      })()
      : { ...preview.layout, spacingAround: texture.spacing };
    return { ...preview, layout, key, texture };
  } catch {
    return null;
  }
}

/**
 * Moves a placed picture to the middle of the face it sits on, as seen looking at
 * that face. On a curved face it lands on the surface at the middle.
 */
export function centredStamp(shape: WorkplaneShape, stamp: SurfaceTextureFacePick, angleDeg: number): SurfaceTextureFacePick | null {
  try {
    const { mesh, normals, regions } = faceIndex(shape);
    const posed = facePickToPosed(shape, stamp);
    const [face] = pickedRegions(mesh, normals, regions, [posed]);
    if (face === undefined) return null;
    const n = stampFrame(posed, angleDeg).normal;
    const triangles: number[] = [];
    for (let t = 0; t < mesh.indices.length / 3; t += 1) {
      if (regions.region[t] !== face) continue;
      if (normals[t * 3] * n[0] + normals[t * 3 + 1] * n[1] + normals[t * 3 + 2] * n[2] < STAMP_FACING) continue;
      triangles.push(t);
    }
    const centre = stampCentre(mesh, triangles, n, angleDeg);
    if (!centre) return null;
    const [ox, oy, oz] = partOrigin(shape);
    return facePickFromWorld(shape, [centre.point[0] + ox, centre.point[1] + oy, centre.point[2] + oz], centre.normal);
  } catch {
    return null;
  }
}

/**
 * The triangles of the part's faces with these numbers (from textureFaceOf), in world
 * space and lifted off the surface, for showing which faces are chosen.
 */
export function textureRegionTriangles(shape: WorkplaneShape, faces: readonly number[], lift: number): Float32Array {
  try {
    const { mesh, regions } = faceIndex(shape);
    const wanted = new Set(faces);
    const p = mesh.positions;
    const { normals } = faceNormals(mesh);
    // Each corner moves along the mean facing of the chosen triangles it touches, so a
    // curved face lifts without gaps between its triangles.
    const cornerNormals = new Float32Array(p.length);
    const chosen: number[] = [];
    for (let t = 0; t < mesh.indices.length / 3; t += 1) {
      if (!wanted.has(regions.region[t])) continue;
      chosen.push(t);
      for (let k = 0; k < 3; k += 1) {
        const v = mesh.indices[t * 3 + k];
        for (let axis = 0; axis < 3; axis += 1) cornerNormals[v * 3 + axis] += normals[t * 3 + axis];
      }
    }
    const [ox, oy, oz] = partOrigin(shape);
    const out = new Float32Array(chosen.length * 9);
    chosen.forEach((t, i) => {
      for (let k = 0; k < 3; k += 1) {
        const v = mesh.indices[t * 3 + k];
        const length = Math.hypot(cornerNormals[v * 3], cornerNormals[v * 3 + 1], cornerNormals[v * 3 + 2]) || 1;
        const o = i * 9 + k * 3;
        out[o] = p[v * 3] + ox + (cornerNormals[v * 3] / length) * lift;
        out[o + 1] = p[v * 3 + 1] + oy + (cornerNormals[v * 3 + 1] / length) * lift;
        out[o + 2] = p[v * 3 + 2] + oz + (cornerNormals[v * 3 + 2] / length) * lift;
      }
    });
    return out;
  } catch {
    return new Float32Array(0);
  }
}

/** Whether a point on the part (world space) lies on its placed picture. */
export function pointOnStamp(shape: WorkplaneShape, texture: SurfaceTexture, point: [number, number, number]): boolean {
  if (!texture.stamp || !texture.image) return false;
  const posed = facePickToPosed(shape, texture.stamp);
  const { normal: n, right, up } = stampFrame(posed, texture.angle);
  const [ox, oy, oz] = partOrigin(shape);
  const d = [point[0] - ox - posed.point[0], point[1] - oy - posed.point[1], point[2] - oz - posed.point[2]];
  const width = texture.spacing;
  const tall = texture.image.height / texture.image.width;
  const along = (axis: readonly number[]) => d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
  const u = along(right) / width + 0.5;
  const v = along(up) / width + tall / 2;
  return Math.abs(along(n)) <= width * 0.6 && u >= 0 && u <= 1 && v >= 0 && v <= tall;
}

/**
 * The part's own surface under a picture placed at this point (world space): the triangles
 * the picture would land on, lifted off the part, each corner with where it falls in the
 * picture (0 to 1 across and up; outside that is off the picture). So a preview of the
 * picture lies on the part and stops where the part does.
 */
export function stampSurface(
  shape: WorkplaneShape,
  texture: SurfaceTexture,
  point: [number, number, number],
  normal: [number, number, number],
  lift: number,
): { positions: Float32Array; uvs: Float32Array } | null {
  if (!texture.image) return null;
  try {
    const { mesh, normals } = faceIndex(shape);
    const { normal: n, right, up } = stampFrame({ normal }, texture.angle);
    const [ox, oy, oz] = partOrigin(shape);
    const centre = [point[0] - ox, point[1] - oy, point[2] - oz];
    const width = texture.spacing;
    const tall = texture.image.height / texture.image.width;
    const reach = width * STAMP_REACH;
    const p = mesh.positions;
    const positions: number[] = [];
    const uvs: number[] = [];
    const u = [0, 0, 0];
    const v = [0, 0, 0];
    const depth = [0, 0, 0];
    for (let t = 0; t < mesh.indices.length / 3; t += 1) {
      if (normals[t * 3] * n[0] + normals[t * 3 + 1] * n[1] + normals[t * 3 + 2] * n[2] < STAMP_FACING) continue;
      for (let k = 0; k < 3; k += 1) {
        const c = mesh.indices[t * 3 + k] * 3;
        const dx = p[c] - centre[0];
        const dy = p[c + 1] - centre[1];
        const dz = p[c + 2] - centre[2];
        u[k] = (dx * right[0] + dy * right[1] + dz * right[2]) / width + 0.5;
        v[k] = ((dx * up[0] + dy * up[1] + dz * up[2]) / width + tall / 2) / tall;
        depth[k] = dx * n[0] + dy * n[1] + dz * n[2];
      }
      // Wholly to one side of the picture, or too far in front of or behind it.
      if (Math.max(...u) < 0 || Math.min(...u) > 1 || Math.max(...v) < 0 || Math.min(...v) > 1) continue;
      if (Math.min(...depth) > reach || Math.max(...depth) < -reach) continue;
      for (let k = 0; k < 3; k += 1) {
        const c = mesh.indices[t * 3 + k] * 3;
        positions.push(p[c] + ox + n[0] * lift, p[c + 1] + oy + n[1] * lift, p[c + 2] + oz + n[2] * lift);
        uvs.push(u[k], v[k]);
      }
    }
    return positions.length ? { positions: new Float32Array(positions), uvs: new Float32Array(uvs) } : null;
  } catch {
    return null;
  }
}
