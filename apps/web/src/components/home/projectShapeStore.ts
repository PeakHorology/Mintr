import { type EditorHistoryEntry, hydrateEditorHistoryState, projectShapesFingerprint } from "@/lib/editorHistory";
import type { WorkplaneShape } from "@/types/sketchforge";
import { openProjectStoreDb } from "@/lib/projectStoreOps";
import { deleteStoredProject, loadStoredProject, saveStoredProject } from "@/lib/projectStoreClient";
import type { ProjectShapeCacheEntry, ProjectShapeRecord } from "@/components/home/dashboardTypes";

export function projectShapeCacheEntry(
  revision: number,
  shapes: WorkplaneShape[],
  history?: EditorHistoryEntry[],
  historyIndex?: number,
): ProjectShapeCacheEntry {
  // Keep the live scene meshes. History entries intentionally strip CSG tessellation
  // caches for undo memory; using those as `shapes` made grouped bodies invisible.
  const canonicalShapes = shapes.map((shape) => ({ ...shape }));
  // Autosave path: trust already-compacted editor history instead of rehydrating
  // (re-compacting) every mesh on each debounced save — only when the current
  // scene fingerprint still matches the history cursor entry.
  if (
    Array.isArray(history)
    && history.length > 0
    && typeof historyIndex === "number"
    && history.every((entry) => typeof entry?.fingerprint === "string" && Array.isArray(entry?.shapes))
  ) {
    const index = Math.min(Math.max(0, historyIndex), history.length - 1);
    if (history[index]?.fingerprint === projectShapesFingerprint(canonicalShapes)) {
      return {
        revision,
        shapes: canonicalShapes,
        history,
        historyIndex: index,
      };
    }
  }
  const hydrated = hydrateEditorHistoryState(canonicalShapes, history, historyIndex);
  return {
    revision,
    shapes: canonicalShapes,
    history: hydrated.entries,
    historyIndex: hydrated.index,
  };
}

export function openProjectShapesDb() {
  return openProjectStoreDb(typeof window === "undefined" ? undefined : window.indexedDB);
}

// Shape records (and their deduplicated mesh blobs) are read and written by the project-store worker.
export async function loadProjectShapes(projectId: string): Promise<ProjectShapeRecord | null> {
  const snapshot = await loadStoredProject(projectId);
  if (!snapshot) return null;
  if (snapshot.missing.length > 0) {
    console.warn(`Project ${projectId} references ${snapshot.missing.length} missing mesh blob(s)`);
  }
  return {
    id: projectId,
    revision: snapshot.revision,
    shapes: snapshot.shapes,
    history: snapshot.history,
    historyIndex: snapshot.historyIndex,
    updatedAt: snapshot.revision,
  };
}

export function saveProjectShapes(projectId: string, entry: ProjectShapeCacheEntry, options?: { fullHistory?: boolean }) {
  return saveStoredProject(projectId, entry, options);
}

export function deleteProjectShapes(projectId: string) {
  return deleteStoredProject(projectId);
}
