import { createLocalId } from "@/lib/localIds";
import { loadGlobalWorkspaceDefaults, normalizeSnapGrid, normalizeWorkspaceSettings } from "@/lib/workplaneSettings";
import type { WorkplaneShape } from "@/types/sketchforge";
import { peakcadBasename, peakcadFilename, peakcadNamesMatch } from "@/lib/peakcadDocument";
import { parseFolderPasswordLock } from "@/lib/folderLock";
import { type DesignKind, laserDesignWorkspace } from "@/lib/laserMachine";
import {
  DASHBOARD_ORDER_KEY,
  FOLDERS_STORAGE_KEY,
  PROJECT_ACCENTS,
  PROJECT_FOLDER_MAP_KEY,
  PROJECTS_STORAGE_KEY,
  STATIC_EXPORT_BUILD,
} from "@/components/home/dashboardConstants";
import type {
  DashboardFolder,
  DashboardOrder,
  DashboardProject,
  ProjectShapeCacheEntry,
  StoredDashboardFolder,
  StoredDashboardProject,
} from "@/components/home/dashboardTypes";
import { projectShapeCacheEntry } from "@/components/home/projectShapeStore";
import { isInlineThumbnailUrl } from "@/components/home/projectThumbnails";

export function readStoredProjects() {
  const legacyShapes: Record<string, ProjectShapeCacheEntry> = {};
  if (typeof window === "undefined") return { projects: [] as DashboardProject[], legacyShapes };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROJECTS_STORAGE_KEY) ?? "[]") as StoredDashboardProject[];
    const projects = parsed
      .filter((project) => typeof project.id === "string" && typeof project.name === "string")
      .map((project, index) => {
        const id = project.id as string;
        const updatedAt = typeof project.updatedAt === "number" ? project.updatedAt : Date.now();
        const revision = typeof project.revision === "number" ? project.revision : updatedAt;
        const designShapes = Array.isArray(project.designShapes) ? (project.designShapes as WorkplaneShape[]) : null;
        if (designShapes) {
          legacyShapes[id] = projectShapeCacheEntry(revision, designShapes);
        }
        return {
          id,
          name: project.name as string,
          createdAt: typeof project.createdAt === "number" ? project.createdAt : Date.now(),
          updatedAt,
          shapes: typeof project.shapes === "number" ? project.shapes : (designShapes?.length ?? 0),
          accent: PROJECT_ACCENTS.includes(project.accent as DashboardProject["accent"]) ? (project.accent as DashboardProject["accent"]) : PROJECT_ACCENTS[index % PROJECT_ACCENTS.length],
          thumbnailUrl:
            STATIC_EXPORT_BUILD && isInlineThumbnailUrl(typeof project.thumbnailUrl === "string" ? project.thumbnailUrl : null)
              ? null
              : typeof project.thumbnailUrl === "string"
                ? project.thumbnailUrl
                : null,
          thumbnailUrlDark:
            STATIC_EXPORT_BUILD && isInlineThumbnailUrl(typeof project.thumbnailUrlDark === "string" ? project.thumbnailUrlDark : null)
              ? null
              : typeof project.thumbnailUrlDark === "string"
                ? project.thumbnailUrlDark
                : null,
          thumbnailVersion: typeof project.thumbnailVersion === "number" ? project.thumbnailVersion : undefined,
          revision,
          workspace: normalizeWorkspaceSettings(project.workspace),
          snapGrid: normalizeSnapGrid(project.snapGrid),
          folderId: typeof project.folderId === "string" ? project.folderId : null,
          filePath: typeof project.filePath === "string" && project.filePath.trim() ? project.filePath : null,
          savedFileName: typeof project.savedFileName === "string" && project.savedFileName.trim()
            ? project.savedFileName.trim()
            : null,
        };
      });
    return { projects, legacyShapes };
  } catch {
    return { projects: [], legacyShapes };
  }
}

export function readFolders(): DashboardFolder[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FOLDERS_STORAGE_KEY) ?? "[]") as StoredDashboardFolder[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((folder) => typeof folder.id === "string" && typeof folder.name === "string")
      .map((folder) => {
        const passwordLock = parseFolderPasswordLock(folder.passwordLock);
        const next: DashboardFolder = {
          id: folder.id as string,
          name: folder.name as string,
          createdAt: typeof folder.createdAt === "number" ? folder.createdAt : Date.now(),
          updatedAt: typeof folder.updatedAt === "number" ? folder.updatedAt : Date.now(),
          heroProjectId: typeof folder.heroProjectId === "string" ? folder.heroProjectId : null,
        };
        if (passwordLock) next.passwordLock = passwordLock;
        return next;
      });
  } catch {
    return [];
  }
}

export function readProjectFolderMap(): Record<string, string | null> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROJECT_FOLDER_MAP_KEY) ?? "{}") as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: Record<string, string | null> = {};
    for (const [projectId, folderId] of Object.entries(parsed)) {
      map[projectId] = typeof folderId === "string" ? folderId : null;
    }
    return map;
  } catch {
    return {};
  }
}

export function writeProjectFolderMap(map: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROJECT_FOLDER_MAP_KEY, JSON.stringify(map));
  } catch {
    // Folder membership still lives in memory for this session.
  }
}

export function applyProjectFolderMap(projects: DashboardProject[], map: Record<string, string | null>): DashboardProject[] {
  let changed = false;
  const next = projects.map((project) => {
    if (!Object.prototype.hasOwnProperty.call(map, project.id)) {
      return project;
    }
    const folderId = map[project.id] ?? null;
    if ((project.folderId ?? null) === folderId) {
      return project;
    }
    changed = true;
    return { ...project, folderId };
  });
  return changed ? next : projects;
}

export function seedProjectFolderMap(projects: DashboardProject[], existing: Record<string, string | null>) {
  const map = { ...existing };
  let changed = false;
  for (const project of projects) {
    if (Object.prototype.hasOwnProperty.call(map, project.id)) continue;
    if (project.folderId) {
      map[project.id] = project.folderId;
      changed = true;
    }
  }
  return { map, changed };
}

export function emptyDashboardOrder(): DashboardOrder {
  return { folders: [], projects: [], byFolder: {} };
}

export function normalizeDashboardOrder(order: Partial<DashboardOrder> | null | undefined): DashboardOrder {
  const legacyRoot =
    order && Array.isArray((order as { root?: unknown }).root)
      ? ((order as { root: unknown[] }).root.filter((id): id is string => typeof id === "string") as string[])
      : [];
  return {
    folders: Array.isArray(order?.folders) ? order.folders.filter((id): id is string => typeof id === "string") : legacyRoot,
    projects: Array.isArray(order?.projects) ? order.projects.filter((id): id is string => typeof id === "string") : legacyRoot,
    byFolder:
      order?.byFolder && typeof order.byFolder === "object" && !Array.isArray(order.byFolder)
        ? Object.fromEntries(
            Object.entries(order.byFolder).map(([folderId, ids]) => [
              folderId,
              Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [],
            ]),
          )
        : {},
  };
}

export function readDashboardOrder(): DashboardOrder {
  if (typeof window === "undefined") return emptyDashboardOrder();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DASHBOARD_ORDER_KEY) ?? "{}") as Partial<DashboardOrder> & {
      root?: unknown;
    };
    return normalizeDashboardOrder(parsed);
  } catch {
    return emptyDashboardOrder();
  }
}

export function writeDashboardOrder(order: DashboardOrder) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DASHBOARD_ORDER_KEY, JSON.stringify(order));
  } catch {
    // Arrangement still applies for this session.
  }
}

export function syncIdOrder(preferred: string[] | null | undefined, available: string[]) {
  const availableSet = new Set(available);
  const next = (Array.isArray(preferred) ? preferred : []).filter((id) => availableSet.has(id));
  for (const id of available) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

export function moveIdInOrder(order: string[], fromId: string, toId: string) {
  const fromIndex = order.indexOf(fromId);
  const toIndex = order.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return order;
  }
  const next = [...order];
  const [item] = next.splice(fromIndex, 1);
  // After removal, find where the hover target sits and place the dragged
  // tile into that slot so every tile between shifts to fill the gap.
  let insertIndex = next.indexOf(toId);
  if (insertIndex < 0) {
    next.push(item);
    return next;
  }
  if (fromIndex < toIndex) {
    // Moving right: land on/after the hovered tile.
    insertIndex += 1;
  }
  next.splice(insertIndex, 0, item);
  return next;
}

export function sortByIdOrder<T extends { id: string }>(items: T[], order: string[] | null | undefined) {
  const safeOrder = Array.isArray(order) ? order : [];
  const rank = new Map(safeOrder.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

export function folderForStorage(folder: DashboardFolder): DashboardFolder {
  const stored: DashboardFolder = {
    id: folder.id,
    name: folder.name,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    heroProjectId: folder.heroProjectId,
  };
  if (folder.passwordLock) {
    stored.passwordLock = {
      algorithm: folder.passwordLock.algorithm,
      iterations: folder.passwordLock.iterations,
      salt: folder.passwordLock.salt,
      hash: folder.passwordLock.hash,
    };
  }
  return stored;
}

export function newFolder(name: string): DashboardFolder {
  const now = Date.now();
  return {
    id: createLocalId("folder"),
    name,
    createdAt: now,
    updatedAt: now,
    heroProjectId: null,
  };
}

export function projectsInFolder(projects: DashboardProject[], folderId: string) {
  return projects.filter((project) => project.folderId === folderId);
}

export function resolveFolderHero(folder: DashboardFolder, projects: DashboardProject[]) {
  const members = projectsInFolder(projects, folder.id);
  if (members.length === 0) return null;
  if (folder.heroProjectId && members.some((project) => project.id === folder.heroProjectId)) {
    return members.find((project) => project.id === folder.heroProjectId) ?? null;
  }
  return members[0] ?? null;
}

export function withValidFolderHeroes(folders: DashboardFolder[], projects: DashboardProject[]) {
  return folders.map((folder) => {
    const hero = resolveFolderHero(folder, projects);
    const nextHeroId = hero?.id ?? null;
    return nextHeroId === folder.heroProjectId ? folder : { ...folder, heroProjectId: nextHeroId };
  });
}

export function readProjects() {
  return readStoredProjects().projects;
}

export function mergeProjectForStorage(project: DashboardProject, storedProject?: DashboardProject) {
  if (!storedProject) {
    return project;
  }
  const projectRevision = project.revision ?? 0;
  const storedRevision = storedProject.revision ?? 0;
  // Folder membership is updated without bumping revision, so prefer the newer updatedAt.
  const folderId =
    (project.updatedAt ?? 0) >= (storedProject.updatedAt ?? 0)
      ? (project.folderId ?? null)
      : (storedProject.folderId ?? project.folderId ?? null);
  if (storedRevision <= projectRevision) {
    return {
      ...project,
      folderId,
      filePath: project.filePath ?? storedProject.filePath ?? null,
      savedFileName: project.savedFileName ?? storedProject.savedFileName ?? null,
    };
  }
  return {
    ...project,
    revision: storedProject.revision,
    shapes: storedProject.shapes || project.shapes,
    thumbnailUrl: project.thumbnailUrl ?? storedProject.thumbnailUrl,
    thumbnailUrlDark: project.thumbnailUrlDark ?? storedProject.thumbnailUrlDark,
    thumbnailVersion: project.thumbnailVersion ?? storedProject.thumbnailVersion,
    updatedAt: Math.max(project.updatedAt, storedProject.updatedAt),
    workspace: project.workspace ?? storedProject.workspace,
    snapGrid: project.snapGrid ?? storedProject.snapGrid,
    folderId,
    filePath: project.filePath ?? storedProject.filePath ?? null,
    savedFileName: project.savedFileName ?? storedProject.savedFileName ?? null,
  };
}

export function projectForStorage(project: DashboardProject): DashboardProject {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    shapes: project.shapes,
    accent: project.accent,
    thumbnailUrl: STATIC_EXPORT_BUILD ? null : (project.thumbnailUrl ?? null),
    thumbnailUrlDark: STATIC_EXPORT_BUILD ? null : (project.thumbnailUrlDark ?? null),
    thumbnailVersion: project.thumbnailVersion,
    revision: project.revision,
    workspace: normalizeWorkspaceSettings(project.workspace),
    snapGrid: normalizeSnapGrid(project.snapGrid),
    folderId: project.folderId ?? null,
    filePath: project.filePath ?? null,
    savedFileName: project.savedFileName ?? (project.filePath ? peakcadBasename(project.filePath) : null),
  };
}

export function projectSavedFileName(project: Pick<DashboardProject, "filePath" | "savedFileName">) {
  if (project.filePath) return peakcadBasename(project.filePath);
  const saved = project.savedFileName?.trim();
  return saved || null;
}

export function projectMatchesSavedFile(project: Pick<DashboardProject, "name" | "filePath" | "savedFileName"> | null | undefined) {
  if (!project) return false;
  const saved = projectSavedFileName(project);
  return Boolean(saved && peakcadNamesMatch(saved, project.name));
}

export function withSavedPeakcadFile(project: DashboardProject, filePath?: string | null, fileName?: string | null): DashboardProject {
  const savedFileName = filePath
    ? peakcadBasename(filePath)
    : (fileName?.trim() || peakcadFilename(project.name));
  return {
    ...project,
    filePath: filePath ?? project.filePath ?? null,
    savedFileName,
  };
}

export function samePeakcadPath(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * After Save As onto a path another project already points at, that other
 * project would silently overwrite this one on its next autosave. Detach it.
 */
export function claimPeakcadPath(projects: DashboardProject[], projectId: string, filePath: string) {
  return projects.map((item) => {
    if (item.id === projectId) return withSavedPeakcadFile(item, filePath);
    if (samePeakcadPath(item.filePath, filePath)) return { ...item, filePath: null };
    return item;
  });
}

export function mergeProjectsForStorage(projects: DashboardProject[]) {
  const storedProjects = readProjects();
  const storedById = new Map(storedProjects.map((project) => [project.id, project]));
  return projects.map((project) => projectForStorage(mergeProjectForStorage(project, storedById.get(project.id))));
}

export function newProject(name: string, index: number, shapeCount = 0, folderId: string | null = null, kind: DesignKind = "print"): DashboardProject {
  const defaults = loadGlobalWorkspaceDefaults();
  const now = Date.now();
  return {
    id: createLocalId("project"),
    name,
    createdAt: now,
    updatedAt: now,
    shapes: shapeCount,
    accent: PROJECT_ACCENTS[index % PROJECT_ACCENTS.length],
    revision: now,
    workspace: kind === "laser" ? laserDesignWorkspace(defaults.workspace) : { ...defaults.workspace, designKind: "print" },
    snapGrid: defaults.snap,
    folderId,
  };
}
