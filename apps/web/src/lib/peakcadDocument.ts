import { hydrateClipboardShape, hydrateHistoryMeshBlob, jsonSafeShape } from "@/lib/shapeJson";
import { normalizeSnapGrid, normalizeWorkspaceSettings } from "@/lib/workplaneSettings";
import type { EditorHistoryEntry, EditorHistoryMeshBlob, EditorHistoryMeshVault } from "@/lib/editorHistory";
import type { GridSize, WorkplaneShape, WorkplaneWorkspaceSettings } from "@/types/sketchforge";

/** Inside the file this stays "peakcad". Renaming it would reject every saved project. */
export const PEAKCAD_FORMAT = "peakcad";
export const PEAKCAD_DOCUMENT_VERSION = 1;
export const PEAKCAD_FILE_EXTENSION = ".peakcad";
/** New files and Save As use this. `.peakcad` stays a valid project file. */
export const MINTR_FILE_EXTENSION = ".mintr";
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

function jsonSafeHistoryEntry(entry: EditorHistoryEntry): EditorHistoryEntry {
  const meshVault = entry.meshVault
    ? Object.fromEntries(Object.entries(entry.meshVault).map(([key, blob]) => [key, jsonSafeMeshBlob(blob)]))
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
        Object.entries(entry.meshVault).map(([key, blob]) => [key, hydrateHistoryMeshBlob(blob)]),
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

export function buildPeakcadDocument(input: {
  project: PeakcadProjectMeta;
  shapes: WorkplaneShape[];
  history?: EditorHistoryEntry[];
  historyIndex?: number;
  savedAt?: number;
}): PeakcadDocument {
  const shapes = input.shapes.map(jsonSafeShape);
  return {
    format: PEAKCAD_FORMAT,
    version: PEAKCAD_DOCUMENT_VERSION,
    savedAt: input.savedAt ?? Date.now(),
    project: {
      ...input.project,
      name: input.project.name.trim() || "Untitled design",
      shapes: shapes.length,
      workspace: normalizeWorkspaceSettings(input.project.workspace),
      snapGrid: normalizeSnapGrid(input.project.snapGrid),
    },
    shapes,
    history: input.history?.map(jsonSafeHistoryEntry),
    historyIndex: input.historyIndex,
  };
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
  let lastError: unknown = new Error("This PeakCAD file is too large to save.");
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
  throw lastError instanceof Error ? lastError : new Error("This PeakCAD file is too large to save.");
}

export function parsePeakcadDocument(raw: string): PeakcadDocument {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("This PeakCAD file is empty.");
  }
  if (new TextEncoder().encode(raw).length > PEAKCAD_MAX_BYTES) {
    throw new Error("This PeakCAD file is too large to open.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("This is not a valid PeakCAD file.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("This is not a valid PeakCAD file.");
  }
  const record = parsed as Record<string, unknown>;
  if (record.format !== PEAKCAD_FORMAT) {
    throw new Error("This file is not a PeakCAD project.");
  }
  if (typeof record.lock === "string") {
    throw new Error("This PeakCAD file is password protected.");
  }
  const version = asFiniteNumber(record.version, 0);
  if (version < 1) {
    throw new Error("This PeakCAD file is too old to open.");
  }
  const projectRaw = record.project;
  if (!projectRaw || typeof projectRaw !== "object") {
    throw new Error("This PeakCAD file is missing project data.");
  }
  const project = projectRaw as Record<string, unknown>;
  if (typeof project.id !== "string" || !project.id.trim()) {
    throw new Error("This PeakCAD file is missing a project id.");
  }
  if (typeof project.name !== "string" || !project.name.trim()) {
    throw new Error("This PeakCAD file is missing a project name.");
  }
  if (!Array.isArray(record.shapes)) {
    throw new Error("This PeakCAD file is missing shapes.");
  }
  const accent = ACCENTS.has(project.accent as PeakcadAccent) ? (project.accent as PeakcadAccent) : "cyan";
  const now = Date.now();
  const shapes = (record.shapes as WorkplaneShape[]).map((shape) => hydrateClipboardShape(shape));
  const history = Array.isArray(record.history)
    ? (record.history as EditorHistoryEntry[]).map((entry) => hydrateHistoryEntry(entry))
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
  };
}
