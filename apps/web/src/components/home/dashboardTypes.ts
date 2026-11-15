import type { EditorHistoryEntry } from "@/lib/editorHistory";
import type { GridSize, WorkplaneShape, WorkplaneWorkspaceSettings } from "@/types/sketchforge";
import type { PeakcadDocument } from "@/lib/peakcadDocument";
import type { FolderPasswordLock } from "@/lib/folderLock";

export type AppView = "dashboard" | "editor";
export type ViewMode = "grid" | "list";

export type DashboardProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  shapes: number;
  accent: "cyan" | "green" | "gold" | "red";
  thumbnailUrl?: string | null;
  thumbnailUrlDark?: string | null;
  thumbnailVersion?: number;
  revision?: number;
  workspace?: WorkplaneWorkspaceSettings;
  snapGrid?: GridSize;
  folderId?: string | null;
  filePath?: string | null;
  savedFileName?: string | null;
};

export type DashboardFolder = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  heroProjectId: string | null;
  passwordLock?: FolderPasswordLock | null;
};

export type FolderAccessRequest = {
  folderId: string;
  projectId?: string;
  opened?: { document: PeakcadDocument; path: string | null };
};

export type LockDialogState = {
  mode: "create" | "unlock" | "change" | "remove";
  folderId: string;
  projectId?: string;
  opened?: FolderAccessRequest["opened"];
};

export type StoredDashboardProject = Partial<DashboardProject> & {
  designShapes?: unknown;
};

export type StoredDashboardFolder = Partial<DashboardFolder>;

export type ProjectShapeCacheEntry = {
  revision: number;
  shapes: WorkplaneShape[];
  history: EditorHistoryEntry[];
  historyIndex: number;
};

export type ProjectShapeRecord = {
  id: string;
  revision: number;
  shapes: WorkplaneShape[];
  history?: EditorHistoryEntry[];
  historyIndex?: number;
  updatedAt: number;
};

export type DashboardOrder = {
  folders: string[];
  projects: string[];
  byFolder: Record<string, string[]>;
};

export type ArrangeDragPayload = {
  id: string;
  kind: "project" | "folder";
};

export type ProjectThumbnailRecord = {
  id: string;
  dataUrl: string;
  dataUrlDark?: string;
  version: number;
  updatedAt: number;
};

export type PendingDiskWrite = {
  revision: number;
  entry: ProjectShapeCacheEntry;
  /** False when the store save failed, so the file is built from this entry instead. */
  stored: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

export type DesktopUpdateOffer = {
  version: string;
  current: string;
  notes: string[];
  portable: boolean;
  canInstall: boolean;
};
