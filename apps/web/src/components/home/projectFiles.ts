import { buildPeakcadDocument, type PeakcadDocument, type PeakcadProjectMeta, serializePeakcadDocument } from "@/lib/peakcadDocument";
import { serializeStoredProject } from "@/lib/projectStoreClient";
import { designFontLibrary, designFontsFor } from "@/lib/customFontStore";
import type { DashboardProject, ProjectShapeCacheEntry } from "@/components/home/dashboardTypes";
import { saveProjectShapes } from "@/components/home/projectShapeStore";

export function peakcadProjectMeta(project: DashboardProject, shapeCount: number): PeakcadProjectMeta {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    accent: project.accent,
    shapes: shapeCount,
    revision: project.revision,
    workspace: project.workspace,
    snapGrid: project.snapGrid,
    thumbnailUrl: project.thumbnailUrl ?? null,
    thumbnailUrlDark: project.thumbnailUrlDark ?? null,
    thumbnailVersion: project.thumbnailVersion,
  };
}

export function buildDocumentForProject(project: DashboardProject, entry: ProjectShapeCacheEntry): PeakcadDocument {
  return buildPeakcadDocument({
    project: peakcadProjectMeta(project, entry.shapes.length),
    shapes: entry.shapes,
    history: entry.history,
    historyIndex: entry.historyIndex,
    fonts: designFontLibrary(),
  });
}

/** The added fonts a project uses, handed to the store worker, which cannot read them itself. */
export function projectDesignFonts(entry: ProjectShapeCacheEntry) {
  return designFontsFor([...entry.shapes, ...(entry.history ?? []).flatMap((step) => step.shapes)], designFontLibrary());
}

/**
 * `.peakcad` text for a project, serialized by the project-store worker from what it has stored
 * (so mesh arrays are never copied into JSON on the main thread). Falls back to in-thread
 * serialization only if the store has no record.
 */
export async function serializeProjectForDisk(project: DashboardProject, entry: ProjectShapeCacheEntry) {
  // The store worker serializes what it has *stored*. If this save fails
  // (quota, private window, a wedged IndexedDB) the worker still holds the
  // previous revision and would hand back stale shapes under a fresh "Saved"
  // notice. Serialize the in-memory entry ourselves in that case.
  const stored = await saveProjectShapes(project.id, entry, { fullHistory: true }).then(() => true, () => false);
  if (!stored) return serializePeakcadDocument(buildDocumentForProject(project, entry));
  const text = await serializeStoredProject(project.id, peakcadProjectMeta(project, entry.shapes.length), projectDesignFonts(entry)).catch(() => null);
  return text ?? serializePeakcadDocument(buildDocumentForProject(project, entry));
}
