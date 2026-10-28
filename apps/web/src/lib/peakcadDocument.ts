import { hydrateClipboardShape, hydrateHistoryMeshBlob, jsonSafeShape } from "@/lib/shapeJson";
import { normalizeSnapGrid, normalizeWorkspaceSettings } from "@/lib/workplaneSettings";
import type { EditorHistoryEntry, EditorHistoryMeshBlob, EditorHistoryMeshVault } from "@/lib/editorHistory";
import { isGuideAuthorColor, type MintrGuide } from "@/lib/mintrGuide";
import { designFontsFor, normalizeDesignFonts, type DesignFont } from "@/lib/customFontStore";
import { LASER_SETTING_KEYS } from "@/lib/laserMachine";
import type { GridSize, WorkplaneShape, WorkplaneWorkspaceSettings } from "@/types/sketchforge";

/** Inside the file this stays "peakcad". Renaming it would reject every saved project. */
export const PEAKCAD_FORMAT = "peakcad";
export const PEAKCAD_DOCUMENT_VERSION = 1;
export const PEAKCAD_FILE_EXTENSION = ".peakcad";
/** New files and Save As use this. `.peakcad` stays a valid project file. */
export const MINTR_FILE_EXTENSION = ".mintr";
/** A project file plus a tutorial chapter. Format stays "peakcad" version 1. */
export const MINTR_GUIDE_EXTENSION = ".mintrguide";
const PROJECT_FILE_EXTENSIONS = [MINTR_FILE_EXTENSION, PEAKCAD_FILE_EXTENSION] as const;
/** Close to V8's max string length (JSON.stringify fails past it). Keep in sync with electron/peakcadPath.cjs. */
export const PEAKCAD_MAX_BYTES = 512 * 1024 * 1024;

export type PeakcadAccent = "cyan" | "green" | "gold" | "red";

export type PeakcadProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  accent: PeakcadAccent;
  shapes: number;
  revision?: number;
  workspace?: WorkplaneWorkspaceSettings;
  snapGrid?: GridSize;
  thumbnailUrl?: string | null;
  thumbnailUrlDark?: string | null;
  thumbnailVersion?: number;
};

export type PeakcadDocument = {
  format: typeof PEAKCAD_FORMAT;
  version: number;
  savedAt: number;
  project: PeakcadProjectMeta;
  shapes: WorkplaneShape[];
  history?: EditorHistoryEntry[];
  historyIndex?: number;
  /** Present on a .mintrguide. Older Mintr opens the finished part and drops this on save. */
  guide?: MintrGuide;
  /** The added fonts its text uses, so it looks the same on a computer without them. Mintr's own fonts are not written. */
  fonts?: DesignFont[];
};

const ACCENTS = new Set<PeakcadAccent>(["cyan", "green", "gold", "red"]);

function asFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function jsonSafeMeshBlob(blob: EditorHistoryMeshBlob): EditorHistoryMeshBlob {
  const { meshBlobRef: _blobRef, ...rest } = blob as EditorHistoryMeshBlob & { meshBlobRef?: unknown };
  return {
    positions: Array.from(rest.positions),
    ...(rest.indices ? { indices: Array.from(rest.indices) } : {}),
    ...(rest.normals ? { normals: Array.from(rest.normals) } : {}),
    ...(typeof rest.brepStep === "string" ? { brepStep: rest.brepStep } : {}),
  };
}

/**
 * Undo entries shallow-copy shapes, so an imported mesh that never changed is
 * one array referenced by every entry. Writing it per entry made a 20-step
 * history of a dense STL twenty times the size of the mesh. Each distinct
 * array is written once; later entries carry a `sameAs` pointer, which older
 * Mintr builds read as an empty mesh for that undo step and nothing worse.
 */
function dedupeHistoryMeshVaults(history: EditorHistoryEntry[]): EditorHistoryEntry[] {
  const firstSeen = new Map<ArrayLike<number>, string>();
  return history.map((entry, entryIndex) => {
    if (!entry.meshVault) return entry;
    let changed = false;
    const meshVault: EditorHistoryMeshVault = {};
    for (const [path, blob] of Object.entries(entry.meshVault)) {
      const existing = firstSeen.get(blob.positions);
      if (existing) {
        meshVault[path] = { positions: [], sameAs: existing };
        changed = true;
      } else {
        firstSeen.set(blob.positions, `${entryIndex}/${path}`);
        meshVault[path] = blob;
      }
    }
    return changed ? { ...entry, meshVault } : entry;
  });
}

/** Inverse of dedupeHistoryMeshVaults: point every `sameAs` blob at the blob it names. */
function resolveHistoryMeshVaults(history: EditorHistoryEntry[]): EditorHistoryEntry[] {
  const resolved = history.map((entry) => (entry.meshVault ? { ...entry, meshVault: { ...entry.meshVault } } : entry));
  for (const entry of resolved) {
    if (!entry.meshVault) continue;
    for (const [path, blob] of Object.entries(entry.meshVault)) {
      if (typeof blob.sameAs !== "string") continue;
      const slash = blob.sameAs.indexOf("/");
      const sourceIndex = Number(blob.sameAs.slice(0, slash));
      const sourcePath = blob.sameAs.slice(slash + 1);
      const source = Number.isInteger(sourceIndex) ? resolved[sourceIndex]?.meshVault?.[sourcePath] : undefined;
      // A dangling pointer leaves the entry with an empty mesh, as an old build would.
      entry.meshVault[path] = source && typeof source.sameAs !== "string" ? source : { positions: [] };
    }
  }
  return resolved;
}

function jsonSafeHistoryEntry(entry: EditorHistoryEntry): EditorHistoryEntry {
  const meshVault = entry.meshVault
    ? Object.fromEntries(Object.entries(entry.meshVault).map(([key, blob]) => [
        key,
        typeof blob.sameAs === "string" ? { positions: [], sameAs: blob.sameAs } : jsonSafeMeshBlob(blob),
      ]))
    : undefined;
  const label = typeof entry.label === "string" ? entry.label.trim() : "";
  return {
    ...entry,
    shapes: entry.shapes.map(jsonSafeShape),
    selectedIds: Array.isArray(entry.selectedIds) ? entry.selectedIds.filter((id): id is string => typeof id === "string") : [],
    fingerprint: typeof entry.fingerprint === "string" ? entry.fingerprint : "",
    estimatedBytes: asFiniteNumber(entry.estimatedBytes, 0),
    meshVault: meshVault && Object.keys(meshVault).length ? meshVault : undefined,
    label: label || undefined,
  };
}

function hydrateHistoryEntry(entry: EditorHistoryEntry): EditorHistoryEntry {
  const meshVault = entry.meshVault
    ? Object.fromEntries(
        Object.entries(entry.meshVault).map(([key, blob]) => [
          key,
          blob && typeof (blob as { sameAs?: unknown }).sameAs === "string"
            ? { positions: [], sameAs: (blob as { sameAs: string }).sameAs }
            : hydrateHistoryMeshBlob(blob),
        ]),
      )
    : undefined;
  return {
    ...entry,
    shapes: Array.isArray(entry.shapes) ? entry.shapes.map((shape) => hydrateClipboardShape(shape)) : [],
    selectedIds: Array.isArray(entry.selectedIds) ? entry.selectedIds.filter((id): id is string => typeof id === "string") : [],
    fingerprint: typeof entry.fingerprint === "string" ? entry.fingerprint : "",
    estimatedBytes: asFiniteNumber(entry.estimatedBytes, 0),
    ...(meshVault && Object.keys(meshVault).length ? { meshVault } : {}),
    ...(typeof entry.label === "string" && entry.label.trim() ? { label: entry.label.trim() } : {}),
  };
}

function projectFileExtension(name: string) {
  const lower = name.trim().toLowerCase();
  return PROJECT_FILE_EXTENSIONS.find((ext) => lower.endsWith(ext)) ?? null;
}

/** Design title with either project extension removed, so old and new files share one name. */
export function projectFileStem(name: string) {
  const trimmed = name.trim();
  const ext = projectFileExtension(trimmed);
  return (ext ? trimmed.slice(0, -ext.length) : trimmed).trim();
}

export function peakcadFilename(name: string) {
  const safe = projectFileStem(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  const base = (safe || "Untitled design").slice(0, 80);
  return `${base}${MINTR_FILE_EXTENSION}`;
}

export function peakcadBasename(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

export function peakcadNormalizedName(name: string) {
  return projectFileStem(name).toLowerCase();
}

export function peakcadNamesMatch(left: string, right: string) {
  return peakcadNormalizedName(left) === peakcadNormalizedName(right);
}

/**
 * A print design's file leaves out the laser settings: it never uses them, and it opens
 * with the standard ones. Its file stays as it was before Mintr knew about lasers.
 */
function workspaceForFile(workspace: WorkplaneWorkspaceSettings): WorkplaneWorkspaceSettings {
  if (workspace.designKind === "laser") return workspace;
  const printOnly: Partial<WorkplaneWorkspaceSettings> = { ...workspace };
  for (const key of LASER_SETTING_KEYS) delete printOnly[key];
  return printOnly as WorkplaneWorkspaceSettings;
}

export function buildPeakcadDocument(input: {
  project: PeakcadProjectMeta;
  shapes: WorkplaneShape[];
  history?: EditorHistoryEntry[];
  historyIndex?: number;
  savedAt?: number;
  guide?: MintrGuide;
  /** The fonts this computer has added; only the ones the design uses are written. */
  fonts?: readonly DesignFont[];
}): PeakcadDocument {
  const shapes = input.shapes.map(jsonSafeShape);
  const fonts = input.fonts?.length
    ? designFontsFor([...input.shapes, ...(input.history ?? []).flatMap((entry) => entry.shapes)], input.fonts)
    : [];
  return {
    format: PEAKCAD_FORMAT,
    version: PEAKCAD_DOCUMENT_VERSION,
    savedAt: input.savedAt ?? Date.now(),
    project: {
      ...input.project,
      name: input.project.name.trim() || "Untitled design",
      shapes: shapes.length,
      workspace: workspaceForFile(normalizeWorkspaceSettings(input.project.workspace)),
      snapGrid: normalizeSnapGrid(input.project.snapGrid),
    },
    shapes,
    history: input.history ? dedupeHistoryMeshVaults(input.history).map(jsonSafeHistoryEntry) : undefined,
    historyIndex: input.historyIndex,
    guide: input.guide,
    ...(fonts.length ? { fonts } : {}),
  };
}

export function guideFilename(name: string) {
  const trimmed = name.trim().replace(/\.mintrguide$/i, "");
  const safe = projectFileStem(trimmed).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  const base = (safe || "Untitled guide").slice(0, 80);
  return `${base}${MINTR_GUIDE_EXTENSION}`;
}

function encodePeakcadJson(document: PeakcadDocument) {
  return `${JSON.stringify(document)}\n`;
}

function peakcadByteLength(text: string) {
  return new TextEncoder().encode(text).length;
}

/** Drop remesh caches on grouped / CSG bodies. Children stay; the file can remesh on open. */
function stripDerivedMeshCaches(shapes: WorkplaneShape[]): WorkplaneShape[] {
  return shapes.map((shape) => {
    if (!shape.groupedShapes?.length) return shape;
    return {
      ...shape,
      importedMesh: undefined,
      cadDisplayEdges: undefined,
      csg: shape.csg ? { ...shape.csg, dirty: true } : shape.csg,
      groupedShapes: stripDerivedMeshCaches(shape.groupedShapes),
    };
  });
}

function shapeAtHistoryPath(shapes: WorkplaneShape[], path: string): WorkplaneShape | undefined {
  const parts = path.split("/").filter(Boolean);
  let list: WorkplaneShape[] | undefined = shapes;
  let current: WorkplaneShape | undefined;
  for (const part of parts) {
    if (part === "edgeBefore" || !list) return undefined;
    current = list.find((shape) => shape.id === part) ?? list[Number(part)];
    if (!current) return undefined;
    list = current.groupedShapes;
  }
  return current;
}

function historyShapeCanRemesh(shape: WorkplaneShape | undefined) {
  const op = shape?.csg?.op;
  return Boolean(shape?.groupedShapes?.length && op && op !== "assemble");
}

/** Keep every undo step; drop CSG tessellation that can remesh from children. Import meshes stay. */
function compactHistoryMeshes(document: PeakcadDocument): PeakcadDocument {
  if (!document.history?.length) return document;
  return {
    ...document,
    history: document.history.map((entry) => {
      const nextShapes = stripDerivedMeshCaches(entry.shapes);
      if (!entry.meshVault) return { ...entry, shapes: nextShapes };
      const keep: EditorHistoryMeshVault = {};
      for (const [path, blob] of Object.entries(entry.meshVault)) {
        if (!historyShapeCanRemesh(shapeAtHistoryPath(entry.shapes, path))) keep[path] = blob;
      }
      return {
        ...entry,
        shapes: nextShapes,
        meshVault: Object.keys(keep).length ? keep : undefined,
      };
    }),
  };
}

function dropFarthestHistory(document: PeakcadDocument, count: number): PeakcadDocument {
  const history = document.history;
  if (!history?.length || count <= 0) return { ...document, history: undefined, historyIndex: undefined };
  if (history.length <= count) return { ...document, history: undefined, historyIndex: undefined };
  const index = Math.min(Math.max(0, document.historyIndex ?? history.length - 1), history.length - 1);
  if (index > 0) {
    const drop = Math.min(count, index);
    return { ...document, history: history.slice(drop), historyIndex: index - drop };
  }
  const drop = Math.min(count, history.length - 1);
  return { ...document, history: history.slice(0, history.length - drop), historyIndex: 0 };
}

function* peakcadSaveAttempts(document: PeakcadDocument): Generator<PeakcadDocument> {
  yield document;
  const compacted = compactHistoryMeshes(document);
  yield compacted;
  let current = compacted;
  while (current.history && current.history.length > 1) {
    const drop = Math.max(1, Math.floor(current.history.length * 0.25));
    current = dropFarthestHistory(current, drop);
    yield current;
  }
  const withoutHistory = { ...document, history: undefined, historyIndex: undefined };
  yield withoutHistory;
  const withoutThumbs = {
    ...withoutHistory,
    project: { ...document.project, thumbnailUrl: null, thumbnailUrlDark: null },
  };
  yield withoutThumbs;
  yield { ...withoutThumbs, shapes: stripDerivedMeshCaches(document.shapes) };
}

export function serializePeakcadDocument(document: PeakcadDocument) {
  let lastError: unknown = new Error("This Mintr file is too large to save.");
  for (const attempt of peakcadSaveAttempts(document)) {
    try {
      const text = encodePeakcadJson(buildPeakcadDocument(attempt));
      if (peakcadByteLength(text) <= PEAKCAD_MAX_BYTES) {
        return text;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("This Mintr file is too large to save.");
}

/** A guide is useless without its history, so this does not drop steps to fit. */
export function serializeMintrGuide(document: PeakcadDocument) {
  let lastError: unknown = new Error("This guide is too large to save. Shorten the model and try again.");
  for (const attempt of [document, compactHistoryMeshes(document)]) {
    try {
      const text = encodePeakcadJson(buildPeakcadDocument(attempt));
      if (peakcadByteLength(text) <= PEAKCAD_MAX_BYTES) return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("This guide is too large to save. Shorten the model and try again.");
}

/**
 * Guides are written packed: the document gzipped, as base64, inside a small labelled wrapper, so
 * the file stays text like every Mintr file and opens through the same path. Typically 5-10x smaller.
 */
const PACKED_GUIDE_FORMAT = "mintrguide-packed";

export function isPackedMintrGuide(text: string) {
  return text.trimStart().startsWith(`{"format":"${PACKED_GUIDE_FORMAT}"`);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(text: string) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function streamThrough(bytes: Uint8Array, transform: CompressionStream | DecompressionStream) {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function packMintrGuideText(text: string): Promise<string> {
  const packed = await streamThrough(new TextEncoder().encode(text), new CompressionStream("gzip"));
  return `${JSON.stringify({ format: PACKED_GUIDE_FORMAT, version: 1, encoding: "gzip+base64", data: bytesToBase64(packed) })}\n`;
}

export async function unpackMintrGuideText(text: string): Promise<string> {
  let wrapper: { format?: unknown; encoding?: unknown; data?: unknown };
  try {
    wrapper = JSON.parse(text) as typeof wrapper;
  } catch {
    throw new Error("This guide file is damaged.");
  }
  if (wrapper.format !== PACKED_GUIDE_FORMAT || wrapper.encoding !== "gzip+base64" || typeof wrapper.data !== "string") {
    throw new Error("This guide was made by a newer Mintr. Update Mintr to open it.");
  }
  try {
    const plain = await streamThrough(base64ToBytes(wrapper.data), new DecompressionStream("gzip"));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("This guide file is damaged.");
  }
}

export function parsePeakcadDocument(raw: string): PeakcadDocument {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("This Mintr file is empty.");
  }
  if (new TextEncoder().encode(raw).length > PEAKCAD_MAX_BYTES) {
    throw new Error("This Mintr file is too large to open.");
  }
  let parsed: unknown;
  try {
    // Notepad and some sync tools re-save JSON with a UTF-8 BOM, which JSON.parse rejects.
    parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    throw new Error("This is not a valid Mintr file.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("This is not a valid Mintr file.");
  }
  const record = parsed as Record<string, unknown>;
  if (record.format !== PEAKCAD_FORMAT) {
    throw new Error("This file is not a Mintr project.");
  }
  if (typeof record.lock === "string") {
    throw new Error("This Mintr file is password protected.");
  }
  const version = asFiniteNumber(record.version, 0);
  if (version < 1) {
    throw new Error("This Mintr file is too old to open.");
  }
  if (version > PEAKCAD_DOCUMENT_VERSION) {
    // Loading it would drop whatever the newer format added, and the next
    // autosave would overwrite the file with the downgraded copy.
    throw new Error("This file was saved by a newer Mintr. Update Mintr to open it.");
  }
  const projectRaw = record.project;
  if (!projectRaw || typeof projectRaw !== "object") {
    throw new Error("This Mintr file is missing project data.");
  }
  const project = projectRaw as Record<string, unknown>;
  if (typeof project.id !== "string" || !project.id.trim()) {
    throw new Error("This Mintr file is missing a project id.");
  }
  if (typeof project.name !== "string" || !project.name.trim()) {
    throw new Error("This Mintr file is missing a project name.");
  }
  if (!Array.isArray(record.shapes)) {
    throw new Error("This Mintr file is missing shapes.");
  }
  const accent = ACCENTS.has(project.accent as PeakcadAccent) ? (project.accent as PeakcadAccent) : "cyan";
  const now = Date.now();
  const shapes = (record.shapes as WorkplaneShape[]).map((shape) => hydrateClipboardShape(shape));
  const fonts = normalizeDesignFonts(record.fonts);
  const history = Array.isArray(record.history)
    ? resolveHistoryMeshVaults((record.history as EditorHistoryEntry[]).map((entry) => hydrateHistoryEntry(entry)))
    : undefined;
  return {
    format: PEAKCAD_FORMAT,
    version,
    savedAt: asFiniteNumber(record.savedAt, now),
    project: {
      id: project.id,
      name: project.name.trim(),
      createdAt: asFiniteNumber(project.createdAt, now),
      updatedAt: asFiniteNumber(project.updatedAt, now),
      accent,
      shapes: shapes.length,
      revision: typeof project.revision === "number" ? project.revision : undefined,
      workspace: normalizeWorkspaceSettings(project.workspace),
      snapGrid: normalizeSnapGrid(project.snapGrid),
      thumbnailUrl: typeof project.thumbnailUrl === "string" ? project.thumbnailUrl : null,
      thumbnailUrlDark: typeof project.thumbnailUrlDark === "string" ? project.thumbnailUrlDark : null,
      thumbnailVersion: typeof project.thumbnailVersion === "number" ? project.thumbnailVersion : undefined,
    },
    shapes,
    history,
    historyIndex: typeof record.historyIndex === "number" ? record.historyIndex : undefined,
    guide: parseMintrGuide(record.guide),
    ...(fonts.length ? { fonts } : {}),
  };
}

function parseMintrGuide(raw: unknown): MintrGuide | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const guide = raw as Record<string, unknown>;
  if (typeof guide.title !== "string" || !guide.title.trim()) return undefined;
  if (typeof guide.author !== "string" || !guide.author.trim()) return undefined;
  if (!Array.isArray(guide.steps)) return undefined;
  const steps = guide.steps.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const step = item as Record<string, unknown>;
    if (typeof step.historyIndex !== "number" || !Number.isFinite(step.historyIndex)) return [];
    if (typeof step.label !== "string" || !step.label.trim()) return [];
    if (typeof step.cue !== "string" || !step.cue.trim()) return [];
    const text = (value: unknown, limit: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : undefined);
    const millimetres = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);
    const name = text(step.name, 80);
    const tip = text(step.tip, 240);
    const insetMm = millimetres(step.insetMm);
    const depthMm = millimetres(step.depthMm);
    return [{
      historyIndex: step.historyIndex,
      label: step.label.trim(),
      included: step.included !== false,
      cue: step.cue.trim(),
      // Pad/Pocket sizes: without these a saved pocket step reloaded with the 4 mm / 6 mm defaults.
      ...(insetMm !== undefined ? { insetMm } : {}),
      ...(depthMm !== undefined ? { depthMm } : {}),
      ...(name ? { name } : {}),
      ...(tip ? { tip } : {}),
      ...(typeof step.fold === "boolean" ? { fold: step.fold } : {}),
    }];
  });
  if (!steps.length) return undefined;
  // Pictures stay small; anything else is dropped rather than trusted.
  const picture = (value: unknown, maxChars: number) => (
    typeof value === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(value) && value.length <= maxChars ? value : undefined
  );
  const avatar = picture(guide.avatar, 200_000);
  const cover = picture(guide.cover, 600_000);
  const minutes = typeof guide.minutes === "number" && Number.isFinite(guide.minutes) && guide.minutes > 0 ? Math.round(guide.minutes) : undefined;
  // `official` is never read from a file: only guides that ship with Mintr carry the Mintr look.
  return {
    title: guide.title.trim(),
    author: guide.author.trim(),
    summary: typeof guide.summary === "string" && guide.summary.trim() ? guide.summary.trim() : `A guide by ${guide.author.trim()}.`,
    steps,
    ...(isGuideAuthorColor(guide.color) ? { color: guide.color } : {}),
    ...(avatar ? { avatar } : {}),
    ...(cover ? { cover } : {}),
    ...(minutes ? { minutes } : {}),
  };
}
