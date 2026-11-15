"use client";

import {
  ArrowLeft,
  CircleArrowUp,
  EllipsisVertical,
  FolderOpen,
  FolderPlus,
  Grid3X3,
  KeyRound,
  List,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { type CSSProperties, type DragEvent as ReactDragEvent, useEffect, useMemo, useRef, useState } from "react";
import { noteIsFeatured } from "@/lib/releaseNotes";
import { WorkspaceSettingsModal } from "@/components/workplane/WorkspaceSettingsModal";
import { FullscreenButton } from "@/components/workplane/FullscreenButton";
import { loadGlobalWorkspaceDefaults, saveGlobalWorkspaceDefaults } from "@/lib/workplaneSettings";
import type { GridSize, WorkplaneWorkspaceSettings } from "@/types/sketchforge";
import {
  completedTutorialIds,
  isSampleProjectId,
  isShippedTutorialId,
  isTutorialCompleted,
  tutorialsAreHidden,
  tutorialsOnHome,
} from "@/lib/introProject";
import { type GuideCatalogEntry, readGuideCatalog } from "@/lib/mintrGuide";
import { peakcadBasename } from "@/lib/peakcadDocument";
import {
  folderKeepsProjectsInside,
  type FolderPasswordLock,
  hashFolderPassword,
  projectStaysInsideFolder,
  verifyFolderPassword,
} from "@/lib/folderLock";
import { SageHomePanel } from "@/components/SageHomePanel";
import { GuideAuthorBadge } from "@/components/GuideAuthorBadge";
import {
  ARRANGE_DRAG_MIME,
  EDITOR_FADE_MS,
  FOLDER_PUSH_MS,
  PROJECT_DRAG_MIME,
  RECENT_PROJECT_COUNT,
} from "@/components/home/dashboardConstants";
import { formatUpdated, nextFolderName } from "@/components/home/dashboardNames";
import type {
  ArrangeDragPayload,
  DashboardFolder,
  DashboardOrder,
  DashboardProject,
  DesktopUpdateOffer,
  FolderAccessRequest,
  LockDialogState,
  ViewMode,
} from "@/components/home/dashboardTypes";
import {
  moveIdInOrder,
  projectMatchesSavedFile,
  projectsInFolder,
  resolveFolderHero,
  sortByIdOrder,
} from "@/components/home/dashboardStorage";
import { desktopUpdateApi } from "@/components/home/desktopUpdate";
import { ProjectPreview } from "@/components/home/ProjectPreview";

export function FolderGlyph({ locked }: { locked?: boolean; opened?: boolean }) {
  return (
    <svg
      className={`folder-glyph-svg${locked ? " is-locked" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="folder-glyph-body"
        d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
      />
      {locked ? (
        <g className="folder-glyph-lock">
          <rect x="8.4" y="13.15" width="7.2" height="5.05" rx="1.1" />
          <path d="M10.05 13.15v-1.45a1.95 1.95 0 0 1 3.9 0v1.45" />
        </g>
      ) : null}
    </svg>
  );
}

export function Dashboard({
  dashboardNotice,
  dashboardOrder,
  downloadFolder,
  folders,
  projects,
  query,
  rootFolders,
  rootProjects,
  settingsOpen,
  sortMode,
  viewMode,
  guideCatalogTick = 0,
  onCloseSettings,
  onCreate,
  onOpenTutorial,
  onCreateFolder,
  onDeleteFolder,
  onDeleteProject,
  onDownloadFolderChange,
  onMoveProjectToFolder,
  onOpenFromDisk,
  onOpenProject,
  onOpenSettings,
  onRevealProjectFile,
  onSaveProjectToDisk,
  onQueryChange,
  onRenameFolder,
  onRenameProject,
  onSetFolderMemberOrder,
  onSetFolderSectionOrder,
  onSetProjectSectionOrder,
  onSetFolderHero,
  onSortModeChange,
  onViewModeChange,
  updateOffer,
  onDismissUpdate,
  unlockedFolderIds,
  folderAccessRequest,
  onUnlockFolderSession,
  onLockFolderSession,
  onSetFolderPassword,
  onRememberFolderPassword,
  onApplyOpenedDocument,
  onFolderAccessRequestHandled,
}: {
  dashboardNotice: string;
  dashboardOrder: DashboardOrder;
  downloadFolder: string;
  folders: DashboardFolder[];
  projects: DashboardProject[];
  query: string;
  rootFolders: DashboardFolder[];
  rootProjects: DashboardProject[];
  settingsOpen: boolean;
  sortMode: string;
  viewMode: ViewMode;
  guideCatalogTick?: number;
  onCloseSettings: () => void;
  onCreate: () => void;
  onOpenTutorial: (tutorialId: string) => void;
  onCreateFolder: (name?: string) => string;
  onDeleteFolder: (folderId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onDownloadFolderChange: (value: string) => void;
  onMoveProjectToFolder: (projectId: string, folderId: string | null) => void;
  onOpenFromDisk: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenSettings: () => void;
  onRevealProjectFile: (filePath: string) => void;
  onSaveProjectToDisk: (projectId: string, forceSaveAs?: boolean) => void;
  onQueryChange: (value: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onRenameProject: (projectId: string, name: string) => void;
  onSetFolderMemberOrder: (folderId: string, memberIds: string[]) => void;
  onSetFolderSectionOrder: (folderIds: string[]) => void;
  onSetProjectSectionOrder: (projectIds: string[]) => void;
  onSetFolderHero: (folderId: string, projectId: string) => void;
  onSortModeChange: (value: string) => void;
  onViewModeChange: (value: ViewMode) => void;
  updateOffer: DesktopUpdateOffer | null;
  onDismissUpdate: () => void;
  unlockedFolderIds: readonly string[];
  folderAccessRequest: FolderAccessRequest | null;
  onUnlockFolderSession: (folderId: string) => void;
  onLockFolderSession: (folderId: string) => void;
  onSetFolderPassword: (
    folderId: string,
    passwordLock: FolderPasswordLock | null,
    secrets?: { next: string | null; previous: string | null },
  ) => void;
  onRememberFolderPassword: (folderId: string, password: string) => void;
  onApplyOpenedDocument: (opened: NonNullable<FolderAccessRequest["opened"]>) => void;
  onFolderAccessRequestHandled: () => void;
}) {
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [folderPush, setFolderPush] = useState<"in" | "out" | null>(null);
  const [leavingToEditor, setLeavingToEditor] = useState(false);
  const folderPushTimerRef = useRef<number | null>(null);
  const leaveEditorTimerRef = useRef<number | null>(null);
  const [appWorkspace, setAppWorkspace] = useState<WorkplaneWorkspaceSettings>(() => loadGlobalWorkspaceDefaults().workspace);
  const [appSnap, setAppSnap] = useState<GridSize>(() => loadGlobalWorkspaceDefaults().snap);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [hideTutorials, setHideTutorials] = useState(false);
  const [finishedTutorialIds, setFinishedTutorialIds] = useState<readonly string[]>([]);
  const [guideCards, setGuideCards] = useState<GuideCatalogEntry[]>([]);

  useEffect(() => {
    setHideTutorials(tutorialsAreHidden());
    setFinishedTutorialIds(completedTutorialIds());
    setGuideCards(readGuideCatalog());
  }, [guideCatalogTick, projects]);

  useEffect(() => {
    if (!settingsOpen) return;
    const defaults = loadGlobalWorkspaceDefaults();
    setAppWorkspace(defaults.workspace);
    setAppSnap(defaults.snap);
  }, [settingsOpen]);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [arrangeTargetId, setArrangeTargetId] = useState<string | null>(null);
  const [arrangePreviewOrder, setArrangePreviewOrder] = useState<string[] | null>(null);
  const [arrangeScope, setArrangeScope] = useState<"folders" | "projects" | "folderMembers" | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const draggingItemRef = useRef<ArrangeDragPayload | null>(null);
  const arrangePreviewOrderRef = useRef<string[] | null>(null);
  const arrangeScopeRef = useRef<"folders" | "projects" | "folderMembers" | null>(null);
  const arrangeCommittedRef = useRef(false);
  const suppressProjectOpenRef = useRef(false);
  const suppressProjectOpenTimerRef = useRef<number | null>(null);
  const [projectPendingDeleteId, setProjectPendingDeleteId] = useState<string | null>(null);
  const [projectPendingRenameId, setProjectPendingRenameId] = useState<string | null>(null);
  const [folderPendingDeleteId, setFolderPendingDeleteId] = useState<string | null>(null);
  const [folderPendingRenameId, setFolderPendingRenameId] = useState<string | null>(null);
  const [folderCreateOpen, setFolderCreateOpen] = useState(false);
  const [moveProjectId, setMoveProjectId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [lockDialog, setLockDialog] = useState<LockDialogState | null>(null);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [lockError, setLockError] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const [deletePasswordDraft, setDeletePasswordDraft] = useState("");
  const [deleteLockError, setDeleteLockError] = useState("");
  const [deleteLockBusy, setDeleteLockBusy] = useState(false);
  const sessionUnlockedRef = useRef(new Set(unlockedFolderIds));

  const projectPendingDelete = projects.find((project) => project.id === projectPendingDeleteId) ?? null;
  const projectPendingRename = projects.find((project) => project.id === projectPendingRenameId) ?? null;
  const folderPendingDelete = folders.find((folder) => folder.id === folderPendingDeleteId) ?? null;
  const folderPendingRename = folders.find((folder) => folder.id === folderPendingRenameId) ?? null;
  const moveProject = projects.find((project) => project.id === moveProjectId) ?? null;
  const openFolder = openFolderId ? folders.find((folder) => folder.id === openFolderId) ?? null : null;
  const normalizedQuery = query.trim().toLowerCase();
  const folderMembers = openFolder
    ? (() => {
        const members = projectsInFolder(projects, openFolder.id).filter(
          (project) => !normalizedQuery || project.name.toLowerCase().includes(normalizedQuery),
        );
        if (sortMode === "name") return [...members].sort((a, b) => a.name.localeCompare(b.name));
        if (sortMode === "recent") return [...members].sort((a, b) => b.updatedAt - a.updatedAt);
        return sortByIdOrder(members, dashboardOrder.byFolder[openFolder.id] ?? []);
      })()
    : [];

  const showHomeOverview = !openFolder && !normalizedQuery;
  const tutorials = openFolder ? [] : tutorialsOnHome(query, { hidden: hideTutorials, completedIds: finishedTutorialIds });
  const guideTutorials = openFolder || hideTutorials ? [] : guideCards.filter((guide) => {
    if (isShippedTutorialId(guide.id) || isTutorialCompleted(guide.id)) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${guide.title} ${guide.author} ${guide.summary}`.toLowerCase().includes(needle);
  });
  const recentProjects = showHomeOverview
    ? [...projects]
        .filter((project) => !projectStaysInsideFolder(project, folders))
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, RECENT_PROJECT_COUNT)
    : [];
  const recentIdSet = new Set(recentProjects.map((project) => project.id));
  const libraryProjects = showHomeOverview
    ? rootProjects.filter((project) => !recentIdSet.has(project.id))
    : rootProjects;
  const folderArrangeIds = rootFolders.map((folder) => folder.id);
  const projectArrangeIds = openFolder
    ? folderMembers.map((project) => project.id)
    : rootProjects.map((project) => project.id);
  const currentArrangeIds = arrangeScope === "folders" ? folderArrangeIds : projectArrangeIds;
  const arrangeOrderRank = useMemo(() => {
    const order = arrangePreviewOrder ?? currentArrangeIds;
    return new Map(order.map((id, index) => [id, index]));
  }, [arrangePreviewOrder, currentArrangeIds]);
  const folderCount = rootFolders.length;
  const projectVisibleCount = openFolder ? folderMembers.length : rootProjects.length;
  const libraryGridClass = viewMode === "grid" ? "project-grid project-grid-home" : "project-list";

  useEffect(() => {
    if (!folderPush) return;
    if (folderPushTimerRef.current !== null) window.clearTimeout(folderPushTimerRef.current);
    folderPushTimerRef.current = window.setTimeout(() => {
      folderPushTimerRef.current = null;
      setFolderPush(null);
    }, FOLDER_PUSH_MS);
    return () => {
      if (folderPushTimerRef.current !== null) window.clearTimeout(folderPushTimerRef.current);
    };
  }, [folderPush]);

  useEffect(() => () => {
    if (leaveEditorTimerRef.current !== null) window.clearTimeout(leaveEditorTimerRef.current);
  }, []);

  useEffect(() => {
    setOpenProjectMenuId(null);
    setOpenFolderMenuId(null);
  }, [query, sortMode, viewMode, openFolderId]);

  useEffect(() => {
    if (!projectPendingDeleteId) return;
    if (projects.some((project) => project.id === projectPendingDeleteId)) return;
    setProjectPendingDeleteId(null);
  }, [projectPendingDeleteId, projects]);

  useEffect(() => {
    if (!folderPendingDeleteId) return;
    if (folders.some((folder) => folder.id === folderPendingDeleteId)) return;
    setFolderPendingDeleteId(null);
  }, [folderPendingDeleteId, folders]);

  useEffect(() => {
    sessionUnlockedRef.current = new Set(unlockedFolderIds);
  }, [unlockedFolderIds]);

  useEffect(() => {
    if (!openFolderId) return;
    const folder = folders.find((item) => item.id === openFolderId);
    const unlocked = unlockedFolderIds.includes(openFolderId) || sessionUnlockedRef.current.has(openFolderId);
    if (!folder || (folder.passwordLock && !unlocked)) {
      setOpenFolderId(null);
    }
  }, [openFolderId, folders, unlockedFolderIds]);

  useEffect(() => {
    if (!folderAccessRequest) return;
    setLockDialog({
      mode: "unlock",
      folderId: folderAccessRequest.folderId,
      projectId: folderAccessRequest.projectId,
      opened: folderAccessRequest.opened,
    });
    setPasswordDraft("");
    setPasswordConfirm("");
    setPasswordCurrent("");
    setLockError("");
    setLockBusy(false);
  }, [folderAccessRequest]);

  const closeMenus = () => {
    setOpenProjectMenuId(null);
    setOpenFolderMenuId(null);
  };

  const confirmProjectDelete = () => {
    if (!projectPendingDelete) return;
    onDeleteProject(projectPendingDelete.id);
    setProjectPendingDeleteId(null);
  };

  const startProjectRename = (project: DashboardProject) => {
    closeMenus();
    setProjectPendingRenameId(project.id);
    setNameDraft(project.name);
  };

  const closeNameDialogs = () => {
    setProjectPendingRenameId(null);
    setFolderPendingRenameId(null);
    setFolderCreateOpen(false);
    setNameDraft("");
  };

  const confirmProjectRename = () => {
    if (!projectPendingRename || !nameDraft.trim()) return;
    onRenameProject(projectPendingRename.id, nameDraft);
    closeNameDialogs();
  };

  const startFolderRename = (folder: DashboardFolder) => {
    closeMenus();
    setFolderPendingRenameId(folder.id);
    setNameDraft(folder.name);
  };

  const confirmFolderRename = () => {
    if (!folderPendingRename || !nameDraft.trim()) return;
    onRenameFolder(folderPendingRename.id, nameDraft);
    closeNameDialogs();
  };

  const confirmFolderCreate = () => {
    onCreateFolder(nameDraft.trim() || undefined);
    closeNameDialogs();
  };

  const folderSessionUnlocked = (folderId: string) =>
    unlockedFolderIds.includes(folderId) || sessionUnlockedRef.current.has(folderId);

  const clearLockFields = () => {
    setPasswordDraft("");
    setPasswordConfirm("");
    setPasswordCurrent("");
    setLockError("");
    setLockBusy(false);
  };

  const closeLockDialog = () => {
    setLockDialog(null);
    clearLockFields();
    onFolderAccessRequestHandled();
  };

  const startFolderLockDialog = (folder: DashboardFolder, mode: LockDialogState["mode"]) => {
    closeMenus();
    onFolderAccessRequestHandled();
    setLockDialog({ mode, folderId: folder.id });
    clearLockFields();
  };

  const finishUnlock = (folderId: string, dialog: LockDialogState, password?: string) => {
    sessionUnlockedRef.current.add(folderId);
    onUnlockFolderSession(folderId);
    if (password?.trim()) onRememberFolderPassword(folderId, password);
    setLockDialog(null);
    clearLockFields();
    onFolderAccessRequestHandled();
    if (dialog.opened) {
      onApplyOpenedDocument(dialog.opened);
      return;
    }
    if (dialog.projectId) {
      onOpenProject(dialog.projectId);
      return;
    }
    setOpenFolderId(folderId);
  };

  const submitLockDialog = async () => {
    if (!lockDialog || lockBusy) return;
    const folder = folders.find((item) => item.id === lockDialog.folderId);
    if (!folder) {
      closeLockDialog();
      return;
    }
    setLockError("");
    if (lockDialog.mode === "create") {
      if (!passwordDraft.trim() || !passwordConfirm.trim()) {
        setLockError("Enter a password.");
        return;
      }
      if (passwordDraft !== passwordConfirm) {
        setLockError("Those passwords do not match.");
        return;
      }
      setLockBusy(true);
      try {
        const lock = await hashFolderPassword(passwordDraft);
        onSetFolderPassword(folder.id, lock, { next: passwordDraft, previous: null });
        closeLockDialog();
      } catch {
        setLockError("Could not save that password.");
        setLockBusy(false);
      }
      return;
    }
    if (lockDialog.mode === "unlock") {
      if (!passwordDraft.trim()) {
        setLockError("Enter a password.");
        return;
      }
      if (!folder.passwordLock) {
        finishUnlock(folder.id, lockDialog, passwordDraft);
        return;
      }
      setLockBusy(true);
      try {
        const matches = await verifyFolderPassword(passwordDraft, folder.passwordLock);
        if (!matches) {
          setLockError("Wrong password.");
          setLockBusy(false);
          return;
        }
        finishUnlock(folder.id, lockDialog, passwordDraft);
      } catch {
        setLockError("Could not check that password.");
        setLockBusy(false);
      }
      return;
    }
    if (!folder.passwordLock) {
      closeLockDialog();
      return;
    }
    if (!passwordCurrent.trim()) {
      setLockError("Enter the current password.");
      return;
    }
    setLockBusy(true);
    try {
      const matches = await verifyFolderPassword(passwordCurrent, folder.passwordLock);
      if (!matches) {
        setLockError("Wrong password.");
        setLockBusy(false);
        return;
      }
      if (lockDialog.mode === "remove") {
        onSetFolderPassword(folder.id, null, { next: null, previous: passwordCurrent });
        closeLockDialog();
        return;
      }
      if (!passwordDraft.trim() || !passwordConfirm.trim()) {
        setLockError("Enter a new password.");
        setLockBusy(false);
        return;
      }
      if (passwordDraft !== passwordConfirm) {
        setLockError("Those passwords do not match.");
        setLockBusy(false);
        return;
      }
      const lock = await hashFolderPassword(passwordDraft);
      onSetFolderPassword(folder.id, lock, { next: passwordDraft, previous: passwordCurrent });
      closeLockDialog();
    } catch {
      setLockError("Could not update that password.");
      setLockBusy(false);
    }
  };

  const confirmFolderDelete = async () => {
    if (!folderPendingDelete || deleteLockBusy) return;
    const needsPassword = Boolean(folderPendingDelete.passwordLock && !folderSessionUnlocked(folderPendingDelete.id));
    if (needsPassword) {
      if (!deletePasswordDraft.trim()) {
        setDeleteLockError("Enter the password.");
        return;
      }
      setDeleteLockBusy(true);
      try {
        const matches = await verifyFolderPassword(deletePasswordDraft, folderPendingDelete.passwordLock as FolderPasswordLock);
        if (!matches) {
          setDeleteLockError("Wrong password.");
          setDeleteLockBusy(false);
          return;
        }
      } catch {
        setDeleteLockError("Could not check that password.");
        setDeleteLockBusy(false);
        return;
      }
    }
    onDeleteFolder(folderPendingDelete.id);
    setFolderPendingDeleteId(null);
    setDeletePasswordDraft("");
    setDeleteLockError("");
    setDeleteLockBusy(false);
    if (openFolderId === folderPendingDelete.id) {
      setOpenFolderId(null);
    }
  };

  const openFolderView = (folderId: string) => {
    closeMenus();
    const folder = folders.find((item) => item.id === folderId);
    if (folder?.passwordLock && !folderSessionUnlocked(folderId)) {
      startFolderLockDialog(folder, "unlock");
      return;
    }
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setFolderPush(null);
      setOpenFolderId(folderId);
      return;
    }
    setFolderPush("in");
    setOpenFolderId(folderId);
  };

  const closeFolderView = () => {
    closeMenus();
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setFolderPush(null);
      setOpenFolderId(null);
      return;
    }
    setFolderPush("out");
    setOpenFolderId(null);
  };

  const commitArrangePreview = () => {
    if (arrangeCommittedRef.current) return;
    const preview = arrangePreviewOrderRef.current;
    const scope = arrangeScopeRef.current;
    if (!preview || preview.length === 0 || !scope) return;
    const baseline = scope === "folders" ? folderArrangeIds : projectArrangeIds;
    if (preview.length === baseline.length && preview.every((id, index) => id === baseline[index])) {
      return;
    }
    arrangeCommittedRef.current = true;
    if (scope === "folders") {
      onSetFolderSectionOrder(preview);
    } else if (scope === "folderMembers" && openFolder) {
      onSetFolderMemberOrder(openFolder.id, preview);
    } else {
      onSetProjectSectionOrder(preview);
    }
  };

  const beginArrangeDrag = (event: ReactDragEvent, payload: ArrangeDragPayload) => {
    event.stopPropagation();
    if (suppressProjectOpenTimerRef.current !== null) {
      window.clearTimeout(suppressProjectOpenTimerRef.current);
      suppressProjectOpenTimerRef.current = null;
    }
    suppressProjectOpenRef.current = true;
    arrangeCommittedRef.current = false;
    draggingItemRef.current = payload;
    const scope: "folders" | "projects" | "folderMembers" = openFolder
      ? "folderMembers"
      : payload.kind === "folder"
        ? "folders"
        : "projects";
    arrangeScopeRef.current = scope;
    setArrangeScope(scope);
    setDraggingItemId(payload.id);
    setArrangeTargetId(null);
    const baseline = scope === "folders" ? folderArrangeIds : projectArrangeIds;
    arrangePreviewOrderRef.current = baseline;
    setArrangePreviewOrder(baseline);
    setDropTargetFolderId(null);
    event.dataTransfer.setData(ARRANGE_DRAG_MIME, JSON.stringify(payload));
    if (payload.kind === "project") {
      event.dataTransfer.setData(PROJECT_DRAG_MIME, payload.id);
    }
    event.dataTransfer.setData("text/plain", payload.id);
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setDragImage(event.currentTarget as Element, 28, 28);
    } catch {
      // Some hosts reject custom drag images; native preview is fine.
    }
  };

  const beginProjectMoveDrag = (event: ReactDragEvent, projectId: string) => {
    event.stopPropagation();
    if (suppressProjectOpenTimerRef.current !== null) {
      window.clearTimeout(suppressProjectOpenTimerRef.current);
      suppressProjectOpenTimerRef.current = null;
    }
    suppressProjectOpenRef.current = true;
    arrangeCommittedRef.current = true;
    draggingItemRef.current = { id: projectId, kind: "project" };
    arrangeScopeRef.current = null;
    setArrangeScope(null);
    setDraggingItemId(projectId);
    setArrangeTargetId(null);
    arrangePreviewOrderRef.current = null;
    setArrangePreviewOrder(null);
    setDropTargetFolderId(null);
    event.dataTransfer.setData(PROJECT_DRAG_MIME, projectId);
    event.dataTransfer.setData("text/plain", projectId);
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setDragImage(event.currentTarget as Element, 28, 28);
    } catch {
      // Some hosts reject custom drag images; native preview is fine.
    }
  };

  const endArrangeDrag = (options?: { commit?: boolean }) => {
    const shouldCommit = options?.commit ?? true;
    // HTML5 DnD often drops onto the dragged tile after CSS `order` shifts,
    // so persist the preview here as well as in the drop handler.
    if (shouldCommit) {
      commitArrangePreview();
    } else {
      arrangeCommittedRef.current = true;
    }
    draggingItemRef.current = null;
    arrangePreviewOrderRef.current = null;
    arrangeScopeRef.current = null;
    setArrangeScope(null);
    setDraggingItemId(null);
    setArrangeTargetId(null);
    setArrangePreviewOrder(null);
    setDropTargetFolderId(null);
    if (suppressProjectOpenTimerRef.current !== null) {
      window.clearTimeout(suppressProjectOpenTimerRef.current);
    }
    suppressProjectOpenTimerRef.current = window.setTimeout(() => {
      suppressProjectOpenRef.current = false;
      suppressProjectOpenTimerRef.current = null;
    }, 200);
  };

  const readArrangePayload = (event: ReactDragEvent): ArrangeDragPayload | null => {
    if (draggingItemRef.current) return draggingItemRef.current;
    const raw = event.dataTransfer.getData(ARRANGE_DRAG_MIME);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ArrangeDragPayload;
        if (parsed && typeof parsed.id === "string" && (parsed.kind === "project" || parsed.kind === "folder")) {
          return parsed;
        }
      } catch {
        // Fall through to project mime.
      }
    }
    const projectId = event.dataTransfer.getData(PROJECT_DRAG_MIME) || event.dataTransfer.getData("text/plain");
    return projectId ? { id: projectId, kind: "project" } : null;
  };

  const handleFolderDragOver = (event: ReactDragEvent, folderId: string) => {
    const payload = draggingItemRef.current;
    if (!payload || payload.kind !== "project" || payload.id === folderId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTargetFolderId(folderId);
    setArrangeTargetId(null);
  };

  const handleFolderDrop = (event: ReactDragEvent, folderId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const payload = readArrangePayload(event);
    suppressProjectOpenRef.current = true;
    endArrangeDrag({ commit: false });
    if (payload?.kind === "project" && payload.id !== folderId) {
      onMoveProjectToFolder(payload.id, folderId);
    }
  };

  const handleArrangeDragOver = (event: ReactDragEvent, targetId: string) => {
    const payload = draggingItemRef.current;
    if (!payload || payload.id === targetId) {
      return;
    }
    // Projects dropped on folders move into the folder instead of rearranging.
    if (payload.kind === "project" && folders.some((folder) => folder.id === targetId) && !openFolder) {
      return;
    }
    const scope = arrangeScopeRef.current;
    const baseline = scope === "folders" ? folderArrangeIds : projectArrangeIds;
    if (!baseline.includes(targetId) || !baseline.includes(payload.id)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setArrangeTargetId(targetId);
    setDropTargetFolderId(null);
    const nextPreview = moveIdInOrder(baseline, payload.id, targetId);
    arrangePreviewOrderRef.current = nextPreview;
    setArrangePreviewOrder(nextPreview);
  };

  const handleArrangeDrop = (event: ReactDragEvent, targetId: string) => {
    const payload = readArrangePayload(event);
    if (payload?.kind === "project" && folders.some((folder) => folder.id === targetId) && !openFolder) {
      return;
    }
    const scope = arrangeScopeRef.current;
    const baseline = scope === "folders" ? folderArrangeIds : projectArrangeIds;
    if (payload && (!baseline.includes(targetId) || !baseline.includes(payload.id))) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    suppressProjectOpenRef.current = true;
    // Prefer the live preview order; fall back to computing from the drop target.
    if (!arrangePreviewOrderRef.current && payload && payload.id !== targetId) {
      const nextPreview = moveIdInOrder(baseline, payload.id, targetId);
      arrangePreviewOrderRef.current = nextPreview;
      setArrangePreviewOrder(nextPreview);
    }
    endArrangeDrag();
  };

  const tileArrangeStyle = (id: string): CSSProperties | undefined => {
    if (!arrangePreviewOrder || !arrangeScope) return undefined;
    const inFolderSection = arrangeScope === "folders" && folderArrangeIds.includes(id);
    const inProjectSection =
      (arrangeScope === "projects" || arrangeScope === "folderMembers") && projectArrangeIds.includes(id);
    if (!inFolderSection && !inProjectSection) return undefined;
    const rank = arrangeOrderRank.get(id);
    if (rank === undefined) return undefined;
    return { order: rank };
  };

  const openProjectFromCard = (projectId: string) => {
    if (suppressProjectOpenRef.current || draggingItemRef.current || leavingToEditor) {
      return;
    }
    const project = projects.find((item) => item.id === projectId);
    const folder = project?.folderId ? folders.find((item) => item.id === project.folderId) ?? null : null;
    if (folder?.passwordLock && !folderSessionUnlocked(folder.id)) {
      closeMenus();
      onFolderAccessRequestHandled();
      setLockDialog({ mode: "unlock", folderId: folder.id, projectId });
      clearLockFields();
      return;
    }
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onOpenProject(projectId);
      return;
    }
    setLeavingToEditor(true);
    if (leaveEditorTimerRef.current !== null) window.clearTimeout(leaveEditorTimerRef.current);
    leaveEditorTimerRef.current = window.setTimeout(() => {
      leaveEditorTimerRef.current = null;
      onOpenProject(projectId);
    }, EDITOR_FADE_MS);
  };

  const arrangeHandlers = (targetId: string) => ({
    onDragEnter: (event: ReactDragEvent) => handleArrangeDragOver(event, targetId),
    onDragOver: (event: ReactDragEvent) => handleArrangeDragOver(event, targetId),
    onDrop: (event: ReactDragEvent) => handleArrangeDrop(event, targetId),
  });

  const renderProjectCard = (
    project: DashboardProject,
    options: { inFolder?: DashboardFolder | null; recent?: boolean } = {},
  ) => {
    const inFolder = options.inFolder ?? null;
    const containingFolder =
      inFolder ?? (project.folderId ? folders.find((folder) => folder.id === project.folderId) ?? null : null);
    const isRecent = Boolean(options.recent);
    const isHero = Boolean(containingFolder && containingFolder.heroProjectId === project.id);
    return (
      <article
        className={`project-card${isRecent ? " project-card-recent" : ""}${draggingItemId === project.id ? " is-dragging" : ""}${!isRecent && arrangeTargetId === project.id ? " arrange-target" : ""}${openProjectMenuId === project.id ? " menu-open" : ""}`}
        key={isRecent ? `recent-${project.id}` : project.id}
        draggable
        style={isRecent ? undefined : tileArrangeStyle(project.id)}
        onDragStart={(event) => {
          if (isRecent) {
            beginProjectMoveDrag(event, project.id);
            return;
          }
          beginArrangeDrag(event, { id: project.id, kind: "project" });
        }}
        onDragEnd={() => endArrangeDrag()}
        {...(isRecent ? {} : arrangeHandlers(project.id))}
      >
        <div
          className="project-card-open"
          role="button"
          tabIndex={0}
          onClick={() => openProjectFromCard(project.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openProjectFromCard(project.id);
            }
          }}
        >
          <span className="project-card-cover">
            <ProjectPreview
              accent={project.accent}
              projectId={project.id}
              thumbnailUrl={project.thumbnailUrl}
              thumbnailUrlDark={project.thumbnailUrlDark}
              thumbnailVersion={project.thumbnailVersion}
            />
          </span>
          <span className="project-card-caption">
            <span className="project-card-title">
              {isHero ? <Star className="project-hero-star" size={14} strokeWidth={2.4} fill="currentColor" /> : null}
              {isSampleProjectId(project.id) ? <span className="mintr-guide-mark">Mintr guide</span> : null}
              {project.workspace?.designKind === "laser" ? <span className="laser-design-mark">Laser</span> : null}
              {project.name}
            </span>
            <span className="project-card-meta">
              {formatUpdated(project.updatedAt)} - {project.shapes} {project.shapes === 1 ? "shape" : "shapes"}
              {containingFolder && !inFolder ? ` · ${containingFolder.name}` : ""}
              {project.filePath ? ` · ${peakcadBasename(project.filePath)}` : ""}
            </span>
          </span>
        </div>
        <button
          className="project-menu-trigger"
          type="button"
          draggable={false}
          aria-label={`Project options for ${project.name}`}
          aria-expanded={openProjectMenuId === project.id}
          title="Project options"
          onClick={() => {
            setOpenFolderMenuId(null);
            setOpenProjectMenuId((current) => (current === project.id ? null : project.id));
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <EllipsisVertical size={19} strokeWidth={2.5} />
        </button>
        {openProjectMenuId === project.id ? (
          <div className="project-card-menu" role="menu" aria-label={`Options for ${project.name}`}>
            <button type="button" role="menuitem" onClick={() => startProjectRename(project)}>
              <Pencil size={16} />
              <span>Rename</span>
            </button>
            {containingFolder ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  onSetFolderHero(containingFolder.id, project.id);
                }}
              >
                <Star size={16} />
                <span>{isHero ? "Hero project" : "Star as hero"}</span>
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenus();
                onSaveProjectToDisk(project.id, !projectMatchesSavedFile(project));
              }}
            >
              <span>{projectMatchesSavedFile(project) ? "Save" : "Save as…"}</span>
            </button>
            {projectMatchesSavedFile(project) ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  onSaveProjectToDisk(project.id, true);
                }}
              >
                <span>Save as…</span>
              </button>
            ) : null}
            {project.filePath ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  onRevealProjectFile(project.filePath as string);
                }}
              >
                <span>Show in folder</span>
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenus();
                setMoveProjectId(project.id);
              }}
            >
              <FolderPlus size={16} />
              <span>Move to folder…</span>
            </button>
            {containingFolder ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  onMoveProjectToFolder(project.id, null);
                }}
              >
                <span>Remove from folder</span>
              </button>
            ) : null}
            <button
              className="delete"
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenus();
                setProjectPendingDeleteId(project.id);
              }}
            >
              <Trash2 size={16} />
              <span>Delete</span>
            </button>
          </div>
        ) : null}
      </article>
    );
  };

  const folderDropHandlers = (folderId: string) => ({
    onDragEnter: (event: ReactDragEvent) => {
      const payload = draggingItemRef.current;
      if (payload?.kind === "folder") {
        handleArrangeDragOver(event, folderId);
        return;
      }
      handleFolderDragOver(event, folderId);
    },
    onDragOver: (event: ReactDragEvent) => {
      const payload = draggingItemRef.current;
      if (payload?.kind === "folder") {
        handleArrangeDragOver(event, folderId);
        return;
      }
      handleFolderDragOver(event, folderId);
    },
    onDragLeave: (event: ReactDragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setDropTargetFolderId((current) => (current === folderId ? null : current));
        setArrangeTargetId((current) => (current === folderId ? null : current));
      }
    },
    onDrop: (event: ReactDragEvent) => {
      const payload = draggingItemRef.current ?? readArrangePayload(event);
      if (payload?.kind === "folder") {
        handleArrangeDrop(event, folderId);
        return;
      }
      handleFolderDrop(event, folderId);
    },
  });

  const renderFolderCard = (folder: DashboardFolder) => {
    const members = projectsInFolder(projects, folder.id);
    const protectedFolder = folderKeepsProjectsInside(folder);
    const sessionUnlocked = protectedFolder && folderSessionUnlocked(folder.id);
    const showLocked = protectedFolder && !sessionUnlocked;
    const hero = protectedFolder ? null : resolveFolderHero(folder, projects);
    const isDropTarget = dropTargetFolderId === folder.id;
    const isArrangeTarget = arrangeTargetId === folder.id;

    return (
      <article
        key={folder.id}
        className={`folder-card${showLocked ? " is-locked" : ""}${sessionUnlocked ? " is-unlocked" : ""}${isDropTarget ? " drop-target" : ""}${isArrangeTarget ? " arrange-target" : ""}${draggingItemId === folder.id ? " is-dragging" : ""}${openFolderMenuId === folder.id ? " menu-open" : ""}`}
        draggable
        style={tileArrangeStyle(folder.id)}
        onDragStart={(event) => beginArrangeDrag(event, { id: folder.id, kind: "folder" })}
        onDragEnd={() => endArrangeDrag()}
        {...folderDropHandlers(folder.id)}
      >
        <button
          className="folder-card-open"
          type="button"
          aria-label={showLocked ? `${folder.name}, locked folder` : folder.name}
          onClick={(event) => {
            if (suppressProjectOpenRef.current) {
              return;
            }
            openFolderView(folder.id);
          }}
        >
          <span className="project-card-cover folder-card-cover">
            <span className="folder-glyph">
              <FolderGlyph locked={showLocked} opened={Boolean(sessionUnlocked)} />
            </span>
          </span>
          <span className="project-card-caption">
            <span className="project-card-title" title={folder.name}>
              {folder.name}
            </span>
            <span className="project-card-meta">
              {protectedFolder
                ? showLocked
                  ? "Locked"
                  : "Unlocked"
                : `${members.length} ${members.length === 1 ? "project" : "projects"}${hero ? ` · ${hero.name}` : ""}`}
            </span>
          </span>
        </button>
        <button
          className="project-menu-trigger"
          type="button"
          aria-label={`Folder options for ${folder.name}`}
          aria-expanded={openFolderMenuId === folder.id}
          title="Folder options"
          onClick={() => {
            setOpenProjectMenuId(null);
            setOpenFolderMenuId((current) => (current === folder.id ? null : folder.id));
          }}
        >
          <EllipsisVertical size={19} strokeWidth={2.5} />
        </button>
        {openFolderMenuId === folder.id ? (
          <div className="project-card-menu folder-card-menu" role="menu" aria-label={`Options for ${folder.name}`}>
            <button type="button" role="menuitem" onClick={() => startFolderRename(folder)}>
              <Pencil size={16} />
              <span>Rename</span>
            </button>
            {protectedFolder ? (
              sessionUnlocked ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenus();
                    sessionUnlockedRef.current.delete(folder.id);
                    onLockFolderSession(folder.id);
                    if (openFolderId === folder.id) setOpenFolderId(null);
                  }}
                >
                  <Lock size={16} />
                  <span>Lock folder</span>
                </button>
              ) : (
                <button type="button" role="menuitem" onClick={() => startFolderLockDialog(folder, "unlock")}>
                  <LockOpen size={16} />
                  <span>Unlock…</span>
                </button>
              )
            ) : (
              <button type="button" role="menuitem" onClick={() => startFolderLockDialog(folder, "create")}>
                <Lock size={16} />
                <span>Lock with password…</span>
              </button>
            )}
            {protectedFolder ? (
              <button type="button" role="menuitem" onClick={() => startFolderLockDialog(folder, "change")}>
                <KeyRound size={16} />
                <span>Change password…</span>
              </button>
            ) : null}
            {protectedFolder ? (
              <button type="button" role="menuitem" onClick={() => startFolderLockDialog(folder, "remove")}>
                <LockOpen size={16} />
                <span>Remove password…</span>
              </button>
            ) : null}
            <button
              className="delete"
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenus();
                setDeletePasswordDraft("");
                setDeleteLockError("");
                setDeleteLockBusy(false);
                setFolderPendingDeleteId(folder.id);
              }}
            >
              <Trash2 size={16} />
              <span>Delete folder</span>
            </button>
          </div>
        ) : null}
      </article>
    );
  };

  return (
    <main className={`dashboard-shell${leavingToEditor ? " is-leaving" : ""}`}>
      <div className="dashboard-atmosphere" aria-hidden="true" />
      <header className="dashboard-topbar">
        <button
          className="dashboard-brand"
          type="button"
          aria-label="Mintr home"
          onClick={() => {
            if (openFolder) closeFolderView();
          }}
        >
          <img className="peakcad-logo" src="assets/mintr/mintr-square.png" alt="" />
          <span className="dashboard-brand-lockup">
            <span className="dashboard-brand-name">Mintr</span>
            <span className="dashboard-brand-mark">By Peak Horology</span>
          </span>
        </button>
        <div className="dashboard-topbar-tools">
          <div className="dashboard-search">
            <Search size={18} strokeWidth={2.4} />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              placeholder={openFolder ? "Search in folder" : "Search designs"}
              aria-label={openFolder ? "Search in folder" : "Search designs"}
            />
          </div>
          <button className="dashboard-secondary" type="button" onClick={onOpenFromDisk}>
            <FolderOpen size={18} strokeWidth={2.4} />
            <span>Open</span>
          </button>
          {!openFolder ? (
            <button
              className="dashboard-secondary"
              type="button"
              onClick={() => {
                closeMenus();
                setFolderCreateOpen(true);
                setNameDraft(nextFolderName(folders));
              }}
            >
              <FolderPlus size={18} strokeWidth={2.4} />
              <span>New folder</span>
            </button>
          ) : null}
          <button className="dashboard-primary" type="button" onClick={onCreate}>
            <Plus size={20} strokeWidth={2.6} />
            <span>New design</span>
          </button>
          {updateOffer ? (
            <div className="dashboard-update">
              <button
                className="dashboard-update-button"
                type="button"
                aria-label={`Mintr ${updateOffer.version} is ready`}
                aria-expanded={updateOpen}
                title={`Mintr ${updateOffer.version} is ready`}
                onClick={() => setUpdateOpen((open) => !open)}
              >
                <CircleArrowUp size={20} strokeWidth={2.4} />
              </button>
              {updateOpen ? (
                <div className="dashboard-update-panel" role="dialog" aria-label={`Update to Mintr ${updateOffer.version}`}>
                  <strong>Mintr {updateOffer.version} is ready</strong>
                  <ul>
                    {updateOffer.notes.map((note) => (
                      <li key={note} className={noteIsFeatured(note) ? "is-highlight" : undefined}>{note}</li>
                    ))}
                  </ul>
                  {updateError ? <p className="dashboard-update-error">{updateError}</p> : null}
                  <div className="dashboard-update-actions">
                    <button
                      type="button"
                      onClick={() => {
                        onDismissUpdate();
                        setUpdateOpen(false);
                      }}
                    >
                      Later
                    </button>
                    <button
                      type="button"
                      disabled={updateBusy}
                      onClick={() => {
                        const api = desktopUpdateApi();
                        if (!api) return;
                        setUpdateBusy(true);
                        setUpdateError("");
                        const action = updateOffer.canInstall ? api.install() : api.openDownload();
                        void action.then((result) => {
                          if (result && typeof result === "object" && "quitting" in result && result.quitting) return;
                          setUpdateBusy(false);
                          if (result && typeof result === "object" && "deferred" in result && result.deferred) {
                            setUpdateError("Update downloaded. It installs the next time you close Mintr.");
                            return;
                          }
                          if (!updateOffer.canInstall) setUpdateOpen(false);
                        }).catch((error: unknown) => {
                          setUpdateError(error instanceof Error ? error.message : "Mintr couldn't download the update. Nothing was installed.");
                          setUpdateBusy(false);
                        });
                      }}
                    >
                      {updateBusy ? "Downloading…" : updateOffer.canInstall ? "Download and install" : "Download"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <FullscreenButton variant="dashboard" />
          {!settingsOpen ? (
            <button className="dashboard-topbar-settings" type="button" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
              <Settings size={20} strokeWidth={2.4} />
            </button>
          ) : (
            <span className="dashboard-topbar-settings" aria-hidden="true" />
          )}
        </div>
      </header>

      <div className="dashboard-layout">
        <section
          key={openFolder?.id ?? "library"}
          className={`dashboard-main${openFolder ? " folder-open" : ""}${folderPush === "in" ? " is-push-in" : folderPush === "out" ? " is-push-out" : ""}`}
          aria-label={openFolder ? `Folder ${openFolder.name}` : "Dashboard"}
          {...(openFolder ? folderDropHandlers(openFolder.id) : {})}
        >
          {dashboardNotice ? (
            <div className="dashboard-import-notice visible" role="status">
              {dashboardNotice}
            </div>
          ) : (
            <div className="dashboard-import-notice" role="status" />
          )}

          <div className="dashboard-section-header">
            <div>
              {openFolder ? (
                <div className="folder-view-heading">
                  <button className="folder-back-button" type="button" onClick={closeFolderView}>
                    <ArrowLeft size={18} strokeWidth={2.4} />
                    <span>Projects</span>
                  </button>
                  <nav className="folder-breadcrumb" aria-label="Folder location">
                    <button type="button" onClick={closeFolderView}>
                      Projects
                    </button>
                    <span aria-hidden="true">/</span>
                    <span>{openFolder.name}</span>
                  </nav>
                  <h1>{openFolder.name}</h1>
                  {openFolder.passwordLock ? (
                    <button
                      className="folder-session-lock"
                      type="button"
                      onClick={() => {
                        sessionUnlockedRef.current.delete(openFolder.id);
                        onLockFolderSession(openFolder.id);
                        closeFolderView();
                      }}
                    >
                      <Lock size={16} strokeWidth={2.4} />
                      <span>Lock folder</span>
                    </button>
                  ) : null}
                  <span className="dashboard-count">
                    {projectVisibleCount === 0
                      ? "0 projects"
                      : `${projectVisibleCount} ${projectVisibleCount === 1 ? "project" : "projects"}`}
                  </span>
                </div>
              ) : (
                <>
                  <h1>{normalizedQuery ? "Search" : "Projects"}</h1>
                  {normalizedQuery ? (
                    <span className="dashboard-count">
                      {folderCount + rootProjects.length === 0
                        ? "0 matches"
                        : `${rootProjects.length} ${rootProjects.length === 1 ? "design" : "designs"}${
                            folderCount > 0 ? ` · ${folderCount} ${folderCount === 1 ? "folder" : "folders"}` : ""
                          }`}
                    </span>
                  ) : (
                    <p className="dashboard-lede">
                      <span className="dashboard-kicker">Learn. Model. <span className="mintr-word">Mint.</span></span>
                      <span className="dashboard-lede-dot" aria-hidden="true">·</span>
                      <span className="dashboard-count">
                        {rootProjects.length === 0 && folderCount === 0
                          ? "0 items"
                          : `${rootProjects.length} ${rootProjects.length === 1 ? "design" : "designs"}${
                              folderCount > 0 ? ` · ${folderCount} ${folderCount === 1 ? "folder" : "folders"}` : ""
                            }`}
                      </span>
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="dashboard-controls">
              <label className="dashboard-select">
                <SlidersHorizontal size={17} />
                <select value={sortMode} onChange={(event) => onSortModeChange(event.currentTarget.value)} aria-label="Sort projects">
                  <option value="custom">Custom order</option>
                  <option value="recent">Recent</option>
                  <option value="name">Name</option>
                </select>
              </label>
              <div className="dashboard-segmented" aria-label="Project view">
                <button className={viewMode === "grid" ? "active" : ""} type="button" aria-label="Grid view" onClick={() => onViewModeChange("grid")}>
                  <Grid3X3 size={17} />
                </button>
                <button className={viewMode === "list" ? "active" : ""} type="button" aria-label="List view" onClick={() => onViewModeChange("list")}>
                  <List size={18} />
                </button>
              </div>
            </div>
          </div>

          {openFolder ? (
            <>
              {dropTargetFolderId === openFolder.id ? (
                <div className="folder-drop-banner" role="status">
                  Drop to add to {openFolder.name}
                </div>
              ) : null}
              {folderMembers.length > 0 ? (
                <div className="dashboard-home-section dashboard-home-section-folder">
                  <div className={libraryGridClass} aria-label={`${openFolder.name} projects`}>
                    {folderMembers.map((project) => renderProjectCard(project, { inFolder: openFolder }))}
                  </div>
                </div>
              ) : (
                <div className="project-empty">
                  <strong>Empty folder</strong>
                  <span>Drag a project here or use Move to folder…</span>
                </div>
              )}
            </>
          ) : (
            <div className="dashboard-home-sections">
              {tutorials.length > 0 || guideTutorials.length > 0 ? (
                <section className="dashboard-home-section" aria-label="Tutorials">
                  <div className="dashboard-subsection-header">
                    <h2>Tutorials</h2>
                    <span>Guided modeling</span>
                  </div>
                  <div className="tutorial-row">
                    {tutorials.map((tutorial) => {
                      const started = projects.some((project) => project.id === tutorial.id);
                      return (
                        <article className="tutorial-card" key={tutorial.id}>
                          <header>
                            <h3>{tutorial.title}</h3>
                            <span>{tutorial.length}</span>
                          </header>
                          <p className="tutorial-card-meta"><GuideAuthorBadge author="Mintr" official size="sm" /></p>
                          <p>{tutorial.summary}</p>
                          <div className="tutorial-card-actions">
                            <button className="dashboard-primary" type="button" onClick={() => onOpenTutorial(tutorial.id)}>
                              {started ? "Continue" : "Start"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    {guideTutorials.map((guide) => {
                      const started = projects.some((project) => project.id === guide.id);
                      return (
                        <article className="tutorial-card" key={guide.id}>
                          {guide.cover ? <img className="tutorial-card-cover" src={guide.cover} alt="" /> : null}
                          <header>
                            <h3>{guide.title}</h3>
                            <span>
                              {guide.steps} {guide.steps === 1 ? "step" : "steps"}
                              {guide.minutes ? ` · ${guide.minutes} min` : ""}
                            </span>
                          </header>
                          <p className="tutorial-card-meta">
                            <GuideAuthorBadge author={guide.author} color={guide.color} avatar={guide.avatar} official={guide.official} size="sm" />
                          </p>
                          {guide.summary && guide.summary !== `A guide by ${guide.author}.` ? <p>{guide.summary}</p> : null}
                          <div className="tutorial-card-actions">
                            <button className="dashboard-primary" type="button" onClick={() => onOpenTutorial(guide.id)}>
                              {started ? "Continue" : "Start"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {recentProjects.length > 0 ? (
                <section className="dashboard-home-section" aria-label="Recents">
                  <div className="dashboard-subsection-header">
                    <h2>Recents</h2>
                  </div>
                  <div className={`${libraryGridClass} project-grid-recents`} aria-label="Recent designs">
                    {recentProjects.map((project) => renderProjectCard(project, { recent: true }))}
                  </div>
                </section>
              ) : null}

              {/* Sage sits below the work itself: easy to find, not in the way. */}
              {normalizedQuery ? null : <SageHomePanel />}

              {rootFolders.length > 0 || libraryProjects.length > 0 ? (
                <section className="dashboard-home-section" aria-label={normalizedQuery ? "Results" : "Library"}>
                  {rootFolders.length > 0 ? (
                    <div className="library-band">
                      <div className="dashboard-subsection-header">
                        <h2>Folders</h2>
                        <span>
                          {folderCount} {folderCount === 1 ? "folder" : "folders"}
                        </span>
                      </div>
                      <div className={`${libraryGridClass} project-grid-folders`} aria-label="Folders">
                        {rootFolders.map((folder) => renderFolderCard(folder))}
                      </div>
                    </div>
                  ) : null}
                  {rootFolders.length > 0 && libraryProjects.length > 0 ? (
                    <div className="library-band-rule" role="separator" aria-hidden="true" />
                  ) : null}
                  {libraryProjects.length > 0 ? (
                    <div className="library-band">
                      <div className="dashboard-subsection-header">
                        <h2>All Designs</h2>
                        <span>
                          {libraryProjects.length} {libraryProjects.length === 1 ? "design" : "designs"}
                        </span>
                      </div>
                      <div className={`${libraryGridClass} project-grid-projects`} aria-label="All Designs">
                        {libraryProjects.map((project) => renderProjectCard(project))}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : recentProjects.length === 0 ? (
                <section className="dashboard-home-section" aria-label="Library">
                  <div className="project-empty">
                    <strong>{normalizedQuery ? "No matches" : "No designs yet"}</strong>
                    <span>
                      {normalizedQuery
                        ? "Try a different name, or create a new design."
                        : "New design starts a blank file. Tutorials walk through the tools."}
                    </span>
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {projectPendingDelete ? (
        <section className="dashboard-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
          <div className="dashboard-confirm-dialog">
            <header>
              <strong id="delete-project-title">Delete project?</strong>
              <button type="button" aria-label="Cancel project deletion" onClick={() => setProjectPendingDeleteId(null)}>
                <X size={18} />
              </button>
            </header>
            <p>
              Do you actually want the project <span>{projectPendingDelete.name}</span> to be deleted?
              {projectPendingDelete.filePath
                ? ` The file ${peakcadBasename(projectPendingDelete.filePath)} stays on disk.`
                : ""}
            </p>
            <div className="dashboard-confirm-actions">
              <button className="dashboard-confirm-cancel" type="button" onClick={() => setProjectPendingDeleteId(null)}>
                Cancel
              </button>
              <button className="dashboard-confirm-delete" type="button" onClick={confirmProjectDelete}>
                Delete
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {folderPendingDelete ? (
        <section className="dashboard-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-folder-title">
          <form
            className={`dashboard-confirm-dialog${folderPendingDelete.passwordLock && !folderSessionUnlocked(folderPendingDelete.id) ? " dashboard-rename-dialog" : ""}`}
            onSubmit={(event) => {
              event.preventDefault();
              void confirmFolderDelete();
            }}
          >
            <header>
              <strong id="delete-folder-title">Delete folder?</strong>
              <button
                type="button"
                aria-label="Cancel folder deletion"
                onClick={() => {
                  setFolderPendingDeleteId(null);
                  setDeletePasswordDraft("");
                  setDeleteLockError("");
                  setDeleteLockBusy(false);
                }}
              >
                <X size={18} />
              </button>
            </header>
            <p>
              Delete <span>{folderPendingDelete.name}</span>? Projects inside return to home.
            </p>
            {folderPendingDelete.passwordLock && !folderSessionUnlocked(folderPendingDelete.id) ? (
              <label>
                <span>Password</span>
                <input
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  spellCheck={false}
                  value={deletePasswordDraft}
                  onChange={(event) => {
                    setDeletePasswordDraft(event.currentTarget.value);
                    setDeleteLockError("");
                  }}
                  aria-label="Folder password"
                />
              </label>
            ) : null}
            {deleteLockError ? (
              <p className="dashboard-dialog-error" role="alert">
                {deleteLockError}
              </p>
            ) : null}
            <div className="dashboard-confirm-actions">
              <button
                className="dashboard-confirm-cancel"
                type="button"
                onClick={() => {
                  setFolderPendingDeleteId(null);
                  setDeletePasswordDraft("");
                  setDeleteLockError("");
                  setDeleteLockBusy(false);
                }}
              >
                Cancel
              </button>
              <button
                className="dashboard-confirm-delete"
                type="submit"
                disabled={
                  deleteLockBusy
                  || (Boolean(folderPendingDelete.passwordLock && !folderSessionUnlocked(folderPendingDelete.id)) && !deletePasswordDraft.trim())
                }
              >
                {deleteLockBusy ? "Checking…" : "Delete folder"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {projectPendingRename ? (
        <section className="dashboard-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="rename-project-title">
          <form
            className="dashboard-confirm-dialog dashboard-rename-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              confirmProjectRename();
            }}
          >
            <header>
              <strong id="rename-project-title">Rename project</strong>
              <button type="button" aria-label="Cancel project rename" onClick={closeNameDialogs}>
                <X size={18} />
              </button>
            </header>
            <label>
              <span>Project name</span>
              <input
                autoFocus
                maxLength={80}
                value={nameDraft}
                onChange={(event) => setNameDraft(event.currentTarget.value)}
                aria-label="Project name"
              />
            </label>
            <div className="dashboard-confirm-actions">
              <button className="dashboard-confirm-cancel" type="button" onClick={closeNameDialogs}>
                Cancel
              </button>
              <button className="dashboard-confirm-save" type="submit" disabled={!nameDraft.trim()}>
                Save
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {folderPendingRename ? (
        <section className="dashboard-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="rename-folder-title">
          <form
            className="dashboard-confirm-dialog dashboard-rename-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              confirmFolderRename();
            }}
          >
            <header>
              <strong id="rename-folder-title">Rename folder</strong>
              <button type="button" aria-label="Cancel folder rename" onClick={closeNameDialogs}>
                <X size={18} />
              </button>
            </header>
            <label>
              <span>Folder name</span>
              <input
                autoFocus
                maxLength={80}
                value={nameDraft}
                onChange={(event) => setNameDraft(event.currentTarget.value)}
                aria-label="Folder name"
              />
            </label>
            <div className="dashboard-confirm-actions">
              <button className="dashboard-confirm-cancel" type="button" onClick={closeNameDialogs}>
                Cancel
              </button>
              <button className="dashboard-confirm-save" type="submit" disabled={!nameDraft.trim()}>
                Save
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {folderCreateOpen ? (
        <section className="dashboard-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="create-folder-title">
          <form
            className="dashboard-confirm-dialog dashboard-rename-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              confirmFolderCreate();
            }}
          >
            <header>
              <strong id="create-folder-title">New folder</strong>
              <button type="button" aria-label="Cancel folder creation" onClick={closeNameDialogs}>
                <X size={18} />
              </button>
            </header>
            <label>
              <span>Folder name</span>
              <input
                autoFocus
                maxLength={80}
                value={nameDraft}
                onChange={(event) => setNameDraft(event.currentTarget.value)}
                aria-label="Folder name"
              />
            </label>
            <div className="dashboard-confirm-actions">
              <button className="dashboard-confirm-cancel" type="button" onClick={closeNameDialogs}>
                Cancel
              </button>
              <button className="dashboard-confirm-save" type="submit" disabled={!nameDraft.trim()}>
                Create
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {moveProject ? (
        <section className="dashboard-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="move-project-title">
          <div className="dashboard-confirm-dialog dashboard-move-dialog">
            <header>
              <strong id="move-project-title">Move “{moveProject.name}”</strong>
              <button type="button" aria-label="Cancel move" onClick={() => setMoveProjectId(null)}>
                <X size={18} />
              </button>
            </header>
            <div className="dashboard-move-list">
              <button
                type="button"
                className={!moveProject.folderId ? "active" : ""}
                onClick={() => {
                  onMoveProjectToFolder(moveProject.id, null);
                  setMoveProjectId(null);
                }}
              >
                Home
              </button>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className={moveProject.folderId === folder.id ? "active" : ""}
                  title={folder.passwordLock ? "Projects in this folder stay inside it" : undefined}
                  onClick={() => {
                    onMoveProjectToFolder(moveProject.id, folder.id);
                    setMoveProjectId(null);
                    if (folder.passwordLock && !folderSessionUnlocked(folder.id)) return;
                    openFolderView(folder.id);
                  }}
                >
                  {folder.passwordLock ? <Lock size={14} /> : null}
                  <span>{folder.name}</span>
                </button>
              ))}
            </div>
            {folders.length === 0 ? <p className="dashboard-move-empty">Create a folder first, then move projects into it.</p> : null}
            <div className="dashboard-confirm-actions">
              <button className="dashboard-confirm-cancel" type="button" onClick={() => setMoveProjectId(null)}>
                Close
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {lockDialog ? (
        <section className="dashboard-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="folder-lock-title">
          <form
            className="dashboard-confirm-dialog dashboard-rename-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void submitLockDialog();
            }}
          >
            <header>
              <strong id="folder-lock-title">
                {lockDialog.mode === "create"
                  ? "Lock with password"
                  : lockDialog.mode === "unlock"
                    ? "Unlock folder"
                    : lockDialog.mode === "change"
                      ? "Change password"
                      : "Remove password"}
              </strong>
              <button type="button" aria-label="Cancel folder password" onClick={closeLockDialog}>
                <X size={18} />
              </button>
            </header>
            <p>
              {lockDialog.mode === "create" ? (
                <>
                  Projects in <span>{folders.find((folder) => folder.id === lockDialog.folderId)?.name}</span> stay inside this folder. Do not use a password you already use for other accounts.
                </>
              ) : lockDialog.mode === "unlock" ? (
                <>
                  Enter the password for <span>{folders.find((folder) => folder.id === lockDialog.folderId)?.name}</span>.
                </>
              ) : lockDialog.mode === "change" ? (
                <>Enter the current password, then choose a new one. Do not use a password you already use for other accounts.</>
              ) : (
                <>
                  Enter the current password. Projects in <span>{folders.find((folder) => folder.id === lockDialog.folderId)?.name}</span> will show in the project lists again.
                </>
              )}
            </p>
            {lockDialog.mode === "change" || lockDialog.mode === "remove" ? (
              <label>
                <span>Current password</span>
                <input
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  spellCheck={false}
                  value={passwordCurrent}
                  onChange={(event) => {
                    setPasswordCurrent(event.currentTarget.value);
                    setLockError("");
                  }}
                  aria-label="Current folder password"
                />
              </label>
            ) : null}
            {lockDialog.mode === "unlock" ? (
              <label>
                <span>Password</span>
                <input
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  spellCheck={false}
                  value={passwordDraft}
                  onChange={(event) => {
                    setPasswordDraft(event.currentTarget.value);
                    setLockError("");
                  }}
                  aria-label="Folder password"
                />
              </label>
            ) : null}
            {lockDialog.mode === "create" || lockDialog.mode === "change" ? (
              <>
                <label>
                  <span>{lockDialog.mode === "change" ? "New password" : "Password"}</span>
                  <input
                    autoFocus={lockDialog.mode === "create"}
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    value={passwordDraft}
                    onChange={(event) => {
                      setPasswordDraft(event.currentTarget.value);
                      setLockError("");
                    }}
                    aria-label={lockDialog.mode === "change" ? "New folder password" : "Folder password"}
                  />
                </label>
                <label>
                  <span>Confirm password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    value={passwordConfirm}
                    onChange={(event) => {
                      setPasswordConfirm(event.currentTarget.value);
                      setLockError("");
                    }}
                    aria-label="Confirm folder password"
                  />
                </label>
              </>
            ) : null}
            {lockError ? (
              <p className="dashboard-dialog-error" role="alert">
                {lockError}
              </p>
            ) : null}
            <div className="dashboard-confirm-actions">
              <button className="dashboard-confirm-cancel" type="button" onClick={closeLockDialog}>
                Cancel
              </button>
              <button
                className={lockDialog.mode === "remove" ? "dashboard-confirm-delete" : "dashboard-confirm-save"}
                type="submit"
                disabled={
                  lockBusy
                  || (lockDialog.mode === "unlock" && !passwordDraft.trim())
                  || (lockDialog.mode === "create" && (!passwordDraft.trim() || !passwordConfirm.trim()))
                  || (lockDialog.mode === "change" && (!passwordCurrent.trim() || !passwordDraft.trim() || !passwordConfirm.trim()))
                  || (lockDialog.mode === "remove" && !passwordCurrent.trim())
                }
              >
                {lockBusy
                  ? "Checking…"
                  : lockDialog.mode === "create"
                    ? "Lock folder"
                    : lockDialog.mode === "unlock"
                      ? "Unlock"
                      : lockDialog.mode === "change"
                        ? "Save"
                        : "Remove password"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {settingsOpen ? (
        <div className="dashboard-settings-overlay">
          <WorkspaceSettingsModal
            context="app"
            workspace={appWorkspace}
            snap={appSnap}
            downloadFolder={downloadFolder}
            onDownloadFolderChange={onDownloadFolderChange}
            onWorkspaceChange={(next) => {
              setAppWorkspace(next);
              saveGlobalWorkspaceDefaults(next, appSnap);
            }}
            onSnapChange={(next) => {
              setAppSnap(next);
              saveGlobalWorkspaceDefaults(appWorkspace, next);
            }}
            onMakeDefault={() => {
              saveGlobalWorkspaceDefaults(appWorkspace, appSnap);
            }}
            tutorialsHidden={hideTutorials}
            onTutorialsHiddenChange={setHideTutorials}
            onOpenTutorial={(tutorialId) => {
              onCloseSettings();
              onOpenTutorial(tutorialId);
            }}
            onClose={onCloseSettings}
          />
        </div>
      ) : null}
    </main>
  );
}
