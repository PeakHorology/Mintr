"use client";

import { Download, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { takeCrashRecovery } from "@/lib/desktopWindow";
import { rememberProblem } from "@/lib/problemReport";
import { noteIsFeatured, RELEASE_NOTES, UNRELEASED_NOTES } from "@/lib/releaseNotes";
import { SketchForgeEditor, type EditorLeaveGuard } from "@/components/SketchForgeEditor";
import { prepareCadRuntime } from "@/lib/cadRuntimeWarmup";
import { ShapeModeMark } from "@/components/workplane/ShapeModeMark";
import { toolbarShapeAssets } from "@/lib/shapeCatalog";
import type { EditorHistoryEntry } from "@/lib/editorHistory";
import { DOWNLOAD_FOLDER_STORAGE_KEY } from "@/lib/downloadFile";
import { isDesktopShell } from "@/lib/desktopHardware";
import { createLocalId } from "@/lib/localIds";
import { StartupThemeTabs } from "@/components/workplane/StartupThemeTabs";
import { applyUiTheme, loadUiTheme } from "@/lib/uiTheme";
import {
  DEFAULT_SNAP_GRID,
  DEFAULT_WORKPLANE_WORKSPACE,
  normalizeSnapGrid,
  normalizeWorkspaceSettings,
  workplaneSettingsFingerprint,
} from "@/lib/workplaneSettings";
import type { GridSize, WorkplaneShape, WorkplaneWorkspaceSettings } from "@/types/sketchforge";
import {
  createLessonProjectMeta,
  createLessonShapes,
  LESSON_PROJECT_ID,
  isShippedTutorialId,
  isTutorialCompleted,
  markLessonSeeded,
} from "@/lib/introProject";
import { builtinGuideSession } from "@/lib/builtinGuides";
import {
  guideSessionFor,
  guideStartShapes,
  playbackProjectId,
  readGuideCatalog,
  rememberGuideSession,
  type GuideSession,
} from "@/lib/mintrGuide";
import {
  buildPeakcadDocument,
  peakcadBasename,
  peakcadFilename,
  parsePeakcadDocument,
  serializePeakcadDocument,
  type PeakcadDocument,
  isPackedMintrGuide,
  unpackMintrGuideText,
} from "@/lib/peakcadDocument";
import {
  hasDesktopProjectFiles,
  openPeakcadFileText,
  readPeakcadPathText,
  resolveDesktopPeakcadTextByName,
  revealPeakcadFile,
  savePeakcadTextAs,
  setKnownLegacyProjectPaths,
  subscribePeakcadMenu,
  subscribePeakcadOpenPath,
  subscribePeakcadSaveBeforeClose,
  subscribePeakcadFlushBeforeClose,
  subscribeProjectFilesTransitioned,
  readPendingProjectMoves,
  writeNewDesktopPeakcad,
  writePeakcadText,
} from "@/lib/peakcadFile";
import {
  folderKeepsProjectsInside,
  projectStaysInsideFolder,
  verifyFolderPassword,
  type FolderPasswordLock,
} from "@/lib/folderLock";
import { decryptPeakcadText, encryptPeakcadText, isEncryptedPeakcadText } from "@/lib/peakcadFileLock";
import { serializeStoredProject } from "@/lib/projectStoreClient";
import { designFontLibrary, designFontsNotKeptMessage, installDesignFontsReport } from "@/lib/customFontStore";
import { isCrystalDesign, loadMachineChoice, machineHasLaser, type DesignKind, type MachineChoice } from "@/lib/laserMachine";
import { NewDesignChooser } from "@/components/NewDesignChooser";
import { readTinkercadClipboard, readTinkercadHash, TINKERCAD_HASH_KEY, tinkercadSkippedNotice, tinkercadToShapes, type TinkercadPayload } from "@/lib/tinkercadImport";
import {
  FOLDERS_STORAGE_KEY,
  PROJECT_FILE_WRITE_DELAY_MS,
  PROJECTS_STORAGE_KEY,
  STATIC_EXPORT_BUILD,
  WEB_STORAGE_NOTE_KEY,
} from "@/components/home/dashboardConstants";
import { nextDesignName, nextFolderName } from "@/components/home/dashboardNames";
import type {
  AppView,
  DashboardFolder,
  DashboardOrder,
  DashboardProject,
  DesktopUpdateOffer,
  FolderAccessRequest,
  PendingDiskWrite,
  ProjectShapeCacheEntry,
  StoredDashboardProject,
  ViewMode,
} from "@/components/home/dashboardTypes";
import { deleteProjectShapes, loadProjectShapes, projectShapeCacheEntry, saveProjectShapes } from "@/components/home/projectShapeStore";
import {
  deleteProjectThumbnail,
  downscaleThumbnailDataUrl,
  isInlineThumbnailUrl,
  projectThumbnailApiUrl,
  saveProjectThumbnail,
} from "@/components/home/projectThumbnails";
import {
  applyProjectFolderMap,
  claimPeakcadPath,
  emptyDashboardOrder,
  folderForStorage,
  mergeProjectsForStorage,
  newFolder,
  newProject,
  normalizeDashboardOrder,
  projectMatchesSavedFile,
  projectsInFolder,
  readDashboardOrder,
  readFolders,
  readProjectFolderMap,
  readProjects,
  readStoredProjects,
  seedProjectFolderMap,
  sortByIdOrder,
  syncIdOrder,
  withSavedPeakcadFile,
  withValidFolderHeroes,
  writeDashboardOrder,
  writeProjectFolderMap,
} from "@/components/home/dashboardStorage";
import { desktopUpdateApi, readDismissedUpdateVersion, writeDismissedUpdateVersion } from "@/components/home/desktopUpdate";
import { buildDocumentForProject, peakcadProjectMeta, projectDesignFonts, serializeProjectForDisk } from "@/components/home/projectFiles";
import { Dashboard } from "@/components/home/Dashboard";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [startupReady, setStartupReady] = useState(false);
  const [startupLeaving, setStartupLeaving] = useState(false);
  const [enteredStudio, setEnteredStudio] = useState(() => {
    if (typeof window === "undefined") return false;
    // A design sent over from Tinkercad goes straight in, past the start screen.
    if (window.location.hash.startsWith(`#${TINKERCAD_HASH_KEY}=`)) return true;
    return new URLSearchParams(window.location.search).get("editor") === "1";
  });
  const [updateOffer, setUpdateOffer] = useState<DesktopUpdateOffer | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [startupUpdateBusy, setStartupUpdateBusy] = useState(false);
  const [startupUpdateError, setStartupUpdateError] = useState("");
  const [view, setView] = useState<AppView>("dashboard");
  const [editorStarted, setEditorStarted] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [openSpinner, setOpenSpinner] = useState(false);
  const [viewportReady, setViewportReady] = useState(false);
  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [folders, setFolders] = useState<DashboardFolder[]>([]);
  const [unlockedFolderIds, setUnlockedFolderIds] = useState<string[]>([]);
  const [filePasswordPrompt, setFilePasswordPrompt] = useState<{
    title: string;
    message: string;
    value: string;
    error: string;
    busy: boolean;
    accept: (password: string) => Promise<boolean>;
    resolve: (password: string | null) => void;
  } | null>(null);
  const [folderAccessRequest, setFolderAccessRequest] = useState<FolderAccessRequest | null>(null);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState("custom");
  const [dashboardOrder, setDashboardOrder] = useState<DashboardOrder>(emptyDashboardOrder);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloadFolder, setDownloadFolder] = useState("");
  const [dashboardNotice, setDashboardNotice] = useState("");
  const [guideCatalogTick, setGuideCatalogTick] = useState(0);
  const [editorHostNotice, setEditorHostNotice] = useState<{ seq: number; message: string } | null>(null);
  const notifyEditor = useCallback((message: string) => {
    setEditorHostNotice((current) => ({ seq: (current?.seq ?? 0) + 1, message }));
  }, []);
  const [projectShapesById, setProjectShapesById] = useState<Record<string, ProjectShapeCacheEntry>>({});
  const projectsJsonRef = useRef("");
  /**
   * The list as last taken from another tab. It is not written back: two tabs whose code
   * stores a project slightly differently (an older copy of Mintr still open, say) would
   * otherwise rewrite each other's list without end.
   */
  const projectsFromOtherTabRef = useRef<DashboardProject[] | null>(null);
  const foldersJsonRef = useRef("");
  const nextProjectRevisionRef = useRef(0);
  const projectShapeSaveQueuesRef = useRef<Record<string, Promise<void>>>({});
  const projectsRef = useRef<DashboardProject[]>([]);
  const foldersRef = useRef<DashboardFolder[]>([]);
  const unlockedFolderIdsRef = useRef<Set<string>>(new Set());
  const folderSecretsRef = useRef(new Map<string, string>());
  const projectSecretsRef = useRef(new Map<string, string>());
  const projectShapesByIdRef = useRef<Record<string, ProjectShapeCacheEntry>>({});
  const projectFolderMapRef = useRef<Record<string, string | null>>({});
  const lastDiskRevisionRef = useRef<Record<string, number>>({});
  // The newest autosave not yet written to the .mintr file, per project.
  const pendingDiskWritesRef = useRef<Record<string, PendingDiskWrite>>({});
  const knownFilePathRef = useRef<Record<string, string>>({});
  const dashboardOrderRef = useRef<DashboardOrder>(emptyDashboardOrder());
  const activeProjectIdRef = useRef<string | null>(activeProjectId);
  projectsRef.current = projects;
  foldersRef.current = folders;
  projectShapesByIdRef.current = projectShapesById;
  dashboardOrderRef.current = dashboardOrder;
  activeProjectIdRef.current = activeProjectId;

  useEffect(() => {
    const preview = new URLSearchParams(window.location.search).get("preview-update");
    if (preview) {
      setUpdateChecking(false);
      setUpdateOffer({
        version: "1.2.0",
        current: "1.1.2",
        notes: UNRELEASED_NOTES.length ? UNRELEASED_NOTES : (RELEASE_NOTES[0]?.items ?? []),
        portable: false,
        canInstall: false,
      });
      return;
    }
    const api = desktopUpdateApi();
    if (!api) return;
    let cancel = false;
    const started = performance.now();
    setUpdateChecking(true);
    void (async () => {
      let offer: DesktopUpdateOffer | null = null;
      try {
        offer = await api.check();
      } catch {
        offer = null;
      }
      const remaining = 2000 - (performance.now() - started);
      if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      if (cancel) return;
      // "Later" on a version stays dismissed until a newer version appears.
      if (offer && readDismissedUpdateVersion() === offer.version) offer = null;
      setUpdateOffer(offer);
      setUpdateChecking(false);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    void takeCrashRecovery().then((recovered) => {
      if (recovered) setDashboardNotice("Mintr closed unexpectedly and reopened itself. Your work is back from the last autosave.");
    });
  }, []);

  // In a web browser, designs live in the browser's own storage. Ask it to keep them, and say once
  // that Save as… keeps a copy on the computer, since clearing the browser's data would remove them.
  useEffect(() => {
    if (isDesktopShell()) return;
    void navigator.storage?.persist?.().catch(() => false);
    try {
      if (window.localStorage.getItem(WEB_STORAGE_NOTE_KEY)) return;
      window.localStorage.setItem(WEB_STORAGE_NOTE_KEY, "1");
    } catch {
      return;
    }
    setDashboardNotice("Your designs are kept in this browser. Use Save as… in a design to keep a copy on your computer too.");
  }, []);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      rememberProblem(`window error: ${event.message}`);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? "");
      rememberProblem(`unhandled rejection: ${reason}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const createAndOpenProjectRef = useRef<(name?: string, kind?: DesignKind, shapes?: WorkplaneShape[]) => string | undefined>(() => undefined);
  /** What a design says when it first opens, such as which Tinkercad shapes were left out. */
  const [openingNotice, setOpeningNotice] = useState<{ projectId: string; text: string } | null>(null);
  const startNewDesignRef = useRef<() => void>(() => undefined);

  /** A design sent over by the "Send to Mintr" bookmark opens as a new design of its own. */
  const openTinkercadDesign = useCallback((payload: TinkercadPayload) => {
    const { shapes, skipped } = tinkercadToShapes(payload);
    if (shapes.length === 0) {
      setDashboardNotice(tinkercadSkippedNotice(skipped) ?? "That Tinkercad design has no shapes in it.");
      return;
    }
    const projectId = createAndOpenProjectRef.current(payload.name?.trim() || "Tinkercad design", "print", shapes);
    if (projectId) setOpeningNotice({ projectId, text: tinkercadSkippedNotice(skipped) ?? "Brought the design over from Tinkercad." });
  }, []);

  // The web bookmark opens Mintr with the design in the address. Take it out of the address
  // straight away so a reload or a shared link does not bring it in twice.
  useEffect(() => {
    if (!mounted) return;
    const payload = readTinkercadHash(window.location.hash);
    if (!window.location.hash.startsWith(`#${TINKERCAD_HASH_KEY}=`)) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (payload) openTinkercadDesign(payload);
    else setDashboardNotice("Mintr could not read that Tinkercad design. Click the bookmark on the design again.");
  }, [mounted, openTinkercadDesign]);

  // Ctrl+V on the home screen after the bookmark copied a design (the desktop app's way in).
  useEffect(() => {
    if (view !== "dashboard") return;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const payload = readTinkercadClipboard(event.clipboardData?.getData("text/plain") ?? "");
      if (!payload) return;
      event.preventDefault();
      openTinkercadDesign(payload);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [openTinkercadDesign, view]);
  /** Set while asking whether a new design is printed or laser cut. */
  const [newDesignAsk, setNewDesignAsk] = useState<MachineChoice | null>(null);
  /** Set only while an editor is mounted; asks before leaving a project with unsaved changes. */
  const editorLeaveGuardRef = useRef<EditorLeaveGuard | null>(null);
  const registerEditorLeaveGuard = useCallback((guard: EditorLeaveGuard | null) => {
    editorLeaveGuardRef.current = guard;
  }, []);
  const confirmLeaveEditor = useCallback(
    () => editorLeaveGuardRef.current?.confirmLeave() ?? Promise.resolve(true),
    [],
  );

  const unlockFolderSession = useCallback((folderId: string) => {
    if (unlockedFolderIdsRef.current.has(folderId)) return;
    const next = new Set(unlockedFolderIdsRef.current);
    next.add(folderId);
    unlockedFolderIdsRef.current = next;
    setUnlockedFolderIds([...next]);
  }, []);

  const lockFolderSession = useCallback((folderId: string) => {
    if (!unlockedFolderIdsRef.current.has(folderId)) return;
    const next = new Set(unlockedFolderIdsRef.current);
    next.delete(folderId);
    unlockedFolderIdsRef.current = next;
    setUnlockedFolderIds([...next]);
  }, []);

  const askFilePassword = useCallback((
    title: string,
    message: string,
    accept: (password: string) => Promise<boolean>,
  ) => {
    return new Promise<string | null>((resolve) => {
      setFilePasswordPrompt({ title, message, value: "", error: "", busy: false, accept, resolve });
    });
  }, []);

  const sealPeakcadText = useCallback(async (project: DashboardProject, plain: string, prompt: boolean) => {
    const folder = project.folderId ? foldersRef.current.find((item) => item.id === project.folderId) : undefined;
    let password = project.folderId ? folderSecretsRef.current.get(project.folderId) ?? null : null;
    if (!password && folder?.passwordLock) {
      if (!prompt) return null;
      const entered = await askFilePassword(
        "Password required",
        `Enter the password for ${folder.name} so this file stays protected.`,
        (candidate) => verifyFolderPassword(candidate, folder.passwordLock as FolderPasswordLock),
      );
      if (!entered) throw new Error("Save cancelled.");
      folderSecretsRef.current.set(folder.id, entered);
      password = entered;
    }
    if (!password) password = projectSecretsRef.current.get(project.id) ?? null;
    if (!password) return plain;
    return encryptPeakcadText(plain, password);
  }, [askFilePassword]);

  const rewriteProjectDiskFile = useCallback(async (
    project: DashboardProject,
    nextPassword: string | null,
    previousPassword: string | null,
  ) => {
    if (!project.filePath || !hasDesktopProjectFiles()) return;
    const cached = projectShapesByIdRef.current[project.id];
    let plain: string | null = null;
    if (cached) {
      plain = await serializeProjectForDisk(project, cached);
    } else {
      const existing = await readPeakcadPathText(project.filePath).catch(() => null);
      if (!existing) return;
      plain = isEncryptedPeakcadText(existing.text)
        ? (previousPassword ? await decryptPeakcadText(existing.text, previousPassword) : null)
        : existing.text;
    }
    if (!plain) return;
    const text = nextPassword ? await encryptPeakcadText(plain, nextPassword) : plain;
    await writePeakcadText(project.filePath, text);
    if (nextPassword) projectSecretsRef.current.set(project.id, nextPassword);
    else projectSecretsRef.current.delete(project.id);
  }, []);

  const rewriteFolderProjectFiles = useCallback((folderId: string, nextPassword: string | null, previousPassword: string | null) => {
    const targets = projectsRef.current.filter((project) => project.folderId === folderId && project.filePath);
    if (targets.length === 0) return;
    void Promise.all(targets.map((project) => rewriteProjectDiskFile(project, nextPassword, previousPassword))).catch((error) => {
      setDashboardNotice(error instanceof Error ? error.message : "Could not protect the saved Mintr files.");
    });
  }, [rewriteProjectDiskFile]);

  const setFolderPasswordLock = useCallback((
    folderId: string,
    passwordLock: FolderPasswordLock | null,
    secrets?: { next: string | null; previous: string | null },
  ) => {
    setFolders((current) =>
      current.map((folder) => (folder.id === folderId ? { ...folder, passwordLock, updatedAt: Date.now() } : folder)),
    );
    if (secrets?.next) folderSecretsRef.current.set(folderId, secrets.next);
    else if (secrets) folderSecretsRef.current.delete(folderId);
    if (!passwordLock) lockFolderSession(folderId);
    if (secrets) rewriteFolderProjectFiles(folderId, secrets.next, secrets.previous);
  }, [lockFolderSession, rewriteFolderProjectFiles]);

  const rememberFolderPassword = useCallback((folderId: string, password: string) => {
    folderSecretsRef.current.set(folderId, password);
    rewriteFolderProjectFiles(folderId, password, password);
  }, [rewriteFolderProjectFiles]);

  const openProtectedPeakcad = useCallback(async (raw: string, path: string | null) => {
    // A packed guide is unpacked first; what is inside goes through the same checks as any file.
    const text = isPackedMintrGuide(raw) ? await unpackMintrGuideText(raw) : raw;
    let plain = text;
    if (isEncryptedPeakcadText(text)) {
      let unlocked: string | null = null;
      const password = await askFilePassword(
        "Password required",
        "This Mintr file is password protected.",
        async (candidate) => {
          try {
            unlocked = await decryptPeakcadText(text, candidate);
            return true;
          } catch {
            return false;
          }
        },
      );
      if (!password || unlocked == null) return null;
      plain = unlocked;
      const document = parsePeakcadDocument(plain);
      projectSecretsRef.current.set(document.project.id, password);
      return { document, path };
    }
    return { document: parsePeakcadDocument(plain), path };
  }, [askFilePassword]);

  const projectNeedsFolderPassword = (projectId: string) => {
    const project = projectsRef.current.find((item) => item.id === projectId) ?? readProjects().find((item) => item.id === projectId);
    if (!project?.folderId || !projectStaysInsideFolder(project, foldersRef.current)) return null;
    if (unlockedFolderIdsRef.current.has(project.folderId)) return null;
    return project.folderId;
  };

  useEffect(() => {
    let cancelled = false;
    void prepareCadRuntime().finally(() => {
      if (!cancelled) setStartupReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyUiTheme(loadUiTheme());
    const { projects: storedProjects, legacyShapes } = readStoredProjects();
    const seeded = seedProjectFolderMap(storedProjects, readProjectFolderMap());
    projectFolderMapRef.current = seeded.map;
    if (seeded.changed) {
      writeProjectFolderMap(seeded.map);
    }
    const projectsWithFolders = applyProjectFolderMap(storedProjects, projectFolderMapRef.current);
    const homeProjects = projectsWithFolders;
    const storedFolders = withValidFolderHeroes(readFolders(), homeProjects);
    const folderIds = storedFolders.map((folder) => folder.id);
    const allProjectIds = homeProjects.map((project) => project.id);
    const storedOrder = readDashboardOrder();
    const nextOrder: DashboardOrder = {
      folders: syncIdOrder(storedOrder.folders, folderIds),
      projects: syncIdOrder(storedOrder.projects, allProjectIds),
      byFolder: Object.fromEntries(
        storedFolders.map((folder) => [
          folder.id,
          syncIdOrder(
            storedOrder.byFolder[folder.id] ?? [],
            homeProjects.filter((project) => project.folderId === folder.id).map((project) => project.id),
          ),
        ]),
      ),
    };
    dashboardOrderRef.current = nextOrder;
    setDashboardOrder(nextOrder);
    writeDashboardOrder(nextOrder);
    setProjects(homeProjects);
    setFolders(storedFolders);
    foldersJsonRef.current = JSON.stringify(storedFolders.map(folderForStorage));
    if (STATIC_EXPORT_BUILD) {
      storedProjects.forEach((project) => {
        const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw) as StoredDashboardProject[];
          const stored = parsed.find((entry) => entry.id === project.id);
          const legacyUrl = typeof stored?.thumbnailUrl === "string" ? stored.thumbnailUrl : null;
          if (!legacyUrl || !isInlineThumbnailUrl(legacyUrl)) return;
          const version = project.thumbnailVersion ?? Date.now();
          void downscaleThumbnailDataUrl(legacyUrl)
            .then(async (compact) => {
              await saveProjectThumbnail(project.id, compact, version);
              setProjects((current) =>
                current.map((entry) =>
                  entry.id === project.id
                    ? { ...entry, thumbnailUrl: compact, thumbnailVersion: version }
                    : entry,
                ),
              );
            })
            .catch(() => {
              setDashboardNotice("Could not migrate project thumbnails to larger storage");
            });
        } catch {
          // Legacy thumbnail migration is best-effort.
        }
      });
    }
    if (Object.keys(legacyShapes).length > 0) {
      // Prefer IndexedDB when it already has equal/newer data. Writing equal-revision
      // legacy localStorage shapes used to clobber newer IDB after app updates.
      void (async () => {
        const migrated: Record<string, ProjectShapeCacheEntry> = {};
        for (const [projectId, entry] of Object.entries(legacyShapes)) {
          try {
            const existing = await loadProjectShapes(projectId);
            if (existing && existing.revision >= entry.revision) {
              migrated[projectId] = projectShapeCacheEntry(
                existing.revision,
                existing.shapes ?? [],
                existing.history,
                existing.historyIndex,
              );
              continue;
            }
            await saveProjectShapes(projectId, entry, { fullHistory: true });
            migrated[projectId] = entry;
          } catch {
            setDashboardNotice("Could not migrate project shapes to larger storage");
          }
        }
        if (Object.keys(migrated).length > 0) {
          setProjectShapesById((current) => {
            const next = { ...current };
            for (const [projectId, entry] of Object.entries(migrated)) {
              const existing = next[projectId];
              if (!existing || existing.revision < entry.revision) {
                next[projectId] = entry;
              }
            }
            return next;
          });
        }
        try {
          const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
          if (!raw) return;
          const parsed = JSON.parse(raw) as StoredDashboardProject[];
          if (!Array.isArray(parsed) || !parsed.some((project) => Array.isArray(project.designShapes))) {
            return;
          }
          const cleaned = parsed.map((project) => {
            const { designShapes: _legacy, ...rest } = project;
            return rest;
          });
          window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(cleaned));
        } catch {
          // Stripping legacy designShapes is best-effort.
        }
      })();
    }
    setDownloadFolder(window.localStorage.getItem(DOWNLOAD_FOLDER_STORAGE_KEY) ?? "");

    const params = new URLSearchParams(window.location.search);
    const wantsEditor = params.has("codexBooleanCase") || params.get("editor") === "1";
    const requestedProjectId = params.get("project");
    const requestedProject = requestedProjectId ? homeProjects.find((project) => project.id === requestedProjectId) : null;
    const requestedFolder = requestedProject?.folderId
      ? storedFolders.find((folder) => folder.id === requestedProject.folderId && folder.passwordLock)
      : null;
    if (wantsEditor && requestedFolder && requestedProject) {
      setFolderAccessRequest({ folderId: requestedFolder.id, projectId: requestedProject.id });
      window.history.replaceState(null, "", "/");
    } else if (wantsEditor) {
      if (requestedProjectId && storedProjects.some((project) => project.id === requestedProjectId)) {
        setActiveProjectId(requestedProjectId);
      }
      setEditorStarted(true);
      setView("editor");
    }
    setMounted(true);
  }, []);

  const persistProjectsList = useCallback((nextProjects: DashboardProject[]) => {
    const storageProjects = mergeProjectsForStorage(nextProjects);
    const serialized = JSON.stringify(storageProjects);
    if (projectsJsonRef.current === serialized) {
      return storageProjects;
    }
    try {
      window.localStorage.setItem(PROJECTS_STORAGE_KEY, serialized);
      projectsJsonRef.current = serialized;
    } catch (error) {
      // Freeing the old value can make room for a larger one, but the retry uses the same
      // payload and may fail too — so keep the previous index and put it back if it does.
      // Leaving the key deleted would erase every project on the next load.
      const previous = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
      try {
        window.localStorage.removeItem(PROJECTS_STORAGE_KEY);
        window.localStorage.setItem(PROJECTS_STORAGE_KEY, serialized);
        projectsJsonRef.current = serialized;
      } catch {
        if (previous !== null) {
          try {
            window.localStorage.setItem(PROJECTS_STORAGE_KEY, previous);
          } catch {
            // Best-effort: the quota may no longer admit even the original value.
          }
        }
        setDashboardNotice(error instanceof Error ? error.message : "Could not save project list");
      }
    }
    return storageProjects;
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (projects === projectsFromOtherTabRef.current) return;
    // Write-only: never feed merged storage back into React state. That feedback
    // loop was clobbering in-memory folderId right after drag-move.
    persistProjectsList(projects);
  }, [mounted, persistProjectsList, projects]);

  useLayoutEffect(() => {
    if (!mounted) return;
    const repaired = applyProjectFolderMap(projects, projectFolderMapRef.current);
    if (repaired === projects) return;
    projectsRef.current = repaired;
    setProjects(repaired);
  }, [mounted, projects]);

  useEffect(() => {
    if (!mounted) return;
    const serialized = JSON.stringify(folders.map(folderForStorage));
    if (foldersJsonRef.current === serialized) return;
    try {
      window.localStorage.setItem(FOLDERS_STORAGE_KEY, serialized);
      foldersJsonRef.current = serialized;
    } catch (error) {
      setDashboardNotice(error instanceof Error ? error.message : "Could not save folders");
    }
  }, [folders, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === PROJECTS_STORAGE_KEY) {
        // Ignore echoes of our own writes (some hosts notify the same document).
        if ((event.newValue ?? "[]") === projectsJsonRef.current) {
          return;
        }
        projectsJsonRef.current = event.newValue ?? "[]";
        const stored = readProjects();
        setProjects((current) => {
          const currentById = new Map(current.map((project) => [project.id, project]));
          let keptLocal = false;
          const merged = stored.map((project) => {
            const live = currentById.get(project.id);
            if (!live) return project;
            // Keep newer in-memory folder assignment if storage is behind.
            if ((live.updatedAt ?? 0) >= (project.updatedAt ?? 0)) {
              const folderId = live.folderId ?? null;
              const updatedAt = Math.max(project.updatedAt, live.updatedAt);
              if (folderId !== (project.folderId ?? null) || updatedAt !== project.updatedAt) keptLocal = true;
              return { ...project, folderId, updatedAt };
            }
            return project;
          });
          // The design open in this tab is never dropped by another tab's list: that tab may have
          // written before it saw this design was made. Writing it back puts it on that list too.
          const openId = activeProjectIdRef.current;
          const open = openId ? currentById.get(openId) : undefined;
          if (open && !merged.some((project) => project.id === open.id)) {
            merged.unshift(open);
            keptLocal = true;
          }
          // Only a list that kept something of this tab's is worth writing back.
          projectsFromOtherTabRef.current = keptLocal ? null : merged;
          return merged;
        });
      }
      if (event.key === FOLDERS_STORAGE_KEY) {
        if ((event.newValue ?? "[]") === foldersJsonRef.current) {
          return;
        }
        foldersJsonRef.current = event.newValue ?? "[]";
        setFolders(readFolders());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    setFolders((current) => {
      const next = withValidFolderHeroes(current, projects);
      const unchanged = next.length === current.length && next.every((folder, index) => folder.heroProjectId === current[index]?.heroProjectId);
      return unchanged ? current : next;
    });
  }, [mounted, projects]);

  useEffect(() => {
    if (!activeProjectId) return;
    if (projects.some((project) => project.id === activeProjectId)) return;
    setActiveProjectId(null);
    setView("dashboard");
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/");
    }
  }, [activeProjectId, projects]);

  useEffect(() => {
    if (!mounted || !activeProjectId) return;
    const activeProject = projects.find((project) => project.id === activeProjectId);
    if (!activeProject) return;
    const targetRevision = activeProject.revision ?? 0;
    const cached = projectShapesById[activeProjectId];
    if (cached && cached.revision >= targetRevision) return;

    let canceled = false;
    void loadProjectShapes(activeProjectId)
      .then((record) => {
        if (canceled) return;
        const revision = Math.max(targetRevision, record?.revision ?? 0, Date.now());
        const entry = projectShapeCacheEntry(revision, record?.shapes ?? [], record?.history, record?.historyIndex);
        setProjectShapesById((current) => {
          const existing = current[activeProjectId];
          if (existing && existing.revision >= Math.max(targetRevision, record?.revision ?? 0)) {
            return current;
          }
          return {
            ...current,
            [activeProjectId]: entry,
          };
        });
      })
      .catch((error) => {
        if (canceled) return;
        const detail = error instanceof Error ? error.message : "Could not load project shapes";
        setDashboardNotice(`${detail} — the project was left untouched. Try opening it again.`);
        // Never seed an empty scene for a project whose shapes failed to load:
        // the editor would open blank and the first edit (or autosave) would
        // overwrite the stored project with nothing. Fall back to the dashboard.
        setActiveProjectId(null);
        setOpeningProjectId((current) => (current === activeProjectId ? null : current));
        setView("dashboard");
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", "/");
        }
      });
    return () => {
      canceled = true;
    };
  }, [activeProjectId, mounted, projects]);

  useEffect(() => {
    if (!openingProjectId) return;
    const timer = window.setTimeout(() => setOpenSpinner(true), 120);
    return () => window.clearTimeout(timer);
  }, [openingProjectId]);

  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(DOWNLOAD_FOLDER_STORAGE_KEY, downloadFolder);
    } catch {
      // A full or blocked store must not take the dashboard down; the folder still applies
      // in-memory for this session.
    }
  }, [downloadFolder, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const folderIds = folders.map((folder) => folder.id);
    const allProjectIds = projects.map((project) => project.id);
    setDashboardOrder((current) => {
      const safeCurrent = normalizeDashboardOrder(current);
      const next: DashboardOrder = {
        folders: syncIdOrder(safeCurrent.folders, folderIds),
        projects: syncIdOrder(safeCurrent.projects, allProjectIds),
        byFolder: Object.fromEntries(
          folders.map((folder) => [
            folder.id,
            syncIdOrder(
              safeCurrent.byFolder[folder.id] ?? [],
              projects.filter((project) => project.folderId === folder.id).map((project) => project.id),
            ),
          ]),
        ),
      };
      const unchanged =
        next.folders.length === safeCurrent.folders.length &&
        next.folders.every((id, index) => id === safeCurrent.folders[index]) &&
        next.projects.length === safeCurrent.projects.length &&
        next.projects.every((id, index) => id === safeCurrent.projects[index]) &&
        folders.every((folder) => {
          const a = next.byFolder[folder.id] ?? [];
          const b = safeCurrent.byFolder[folder.id] ?? [];
          return a.length === b.length && a.every((id, index) => id === b[index]);
        });
      if (unchanged) return safeCurrent === current ? current : safeCurrent;
      dashboardOrderRef.current = next;
      writeDashboardOrder(next);
      return next;
    });
  }, [folders, mounted, projects]);

  const updateDashboardOrder = useCallback((updater: (current: DashboardOrder) => DashboardOrder) => {
    setDashboardOrder((current) => {
      const next = normalizeDashboardOrder(updater(normalizeDashboardOrder(current)));
      dashboardOrderRef.current = next;
      writeDashboardOrder(next);
      return next;
    });
    setSortMode("custom");
  }, []);

  const setFolderSectionOrder = useCallback(
    (folderIds: string[]) => {
      updateDashboardOrder((current) => ({
        ...current,
        folders: syncIdOrder(folderIds, current.folders),
      }));
    },
    [updateDashboardOrder],
  );

  const setProjectSectionOrder = useCallback(
    (projectIds: string[]) => {
      updateDashboardOrder((current) => ({
        ...current,
        projects: syncIdOrder(projectIds, current.projects),
      }));
    },
    [updateDashboardOrder],
  );

  const setFolderMemberOrder = useCallback(
    (folderId: string, memberIds: string[]) => {
      updateDashboardOrder((current) => ({
        ...current,
        byFolder: {
          ...current.byFolder,
          [folderId]: syncIdOrder(memberIds, current.byFolder[folderId] ?? memberIds),
        },
      }));
    },
    [updateDashboardOrder],
  );

  const rootFolders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matched = folders.filter((folder) => {
      if (!normalizedQuery) return true;
      if (folder.name.toLowerCase().includes(normalizedQuery)) return true;
      // A passworded folder's projects are not searchable from outside it.
      if (folderKeepsProjectsInside(folder)) return false;
      return projectsInFolder(projects, folder.id).some((project) => project.name.toLowerCase().includes(normalizedQuery));
    });
    if (sortMode === "name") return [...matched].sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === "recent") return [...matched].sort((a, b) => b.updatedAt - a.updatedAt);
    return sortByIdOrder(matched, dashboardOrder.folders);
  }, [dashboardOrder.folders, folders, projects, query, sortMode]);

  const rootProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matched = projects.filter((project) => {
      if (projectStaysInsideFolder(project, folders)) return false;
      if (!normalizedQuery) return true;
      return project.name.toLowerCase().includes(normalizedQuery);
    });
    if (sortMode === "name") return [...matched].sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === "recent") return [...matched].sort((a, b) => b.updatedAt - a.updatedAt);
    return sortByIdOrder(matched, dashboardOrder.projects);
  }, [dashboardOrder.projects, folders, projects, query, sortMode]);

  const openEditor = (projectId: string | null, options: { allowMissingFromStorage?: boolean } = {}) => {
    if (projectId) {
      const lockedFolderId = projectNeedsFolderPassword(projectId);
      if (lockedFolderId) {
        setFolderAccessRequest((current) =>
          current?.folderId === lockedFolderId && current.projectId === projectId && !current.opened
            ? current
            : { folderId: lockedFolderId, projectId },
        );
        return;
      }
    }
    if (projectId && typeof window !== "undefined" && !options.allowMissingFromStorage) {
      const storedProjects = readProjects();
      const storedProject = storedProjects.find((project) => project.id === projectId);
      let missing = false;
      setProjects((current) => {
        const existsInMemory = current.some((project) => project.id === projectId);
        if (!storedProject && !existsInMemory) {
          missing = true;
          return storedProjects;
        }
        // Keep in-memory folder membership; never clobber it with a stale localStorage snapshot.
        const base = current.length > 0 ? current : storedProjects;
        return base.map((project) => (project.id === projectId ? { ...project, updatedAt: Date.now() } : project));
      });
      if (missing) {
        setActiveProjectId(null);
        setView("dashboard");
        window.history.replaceState(null, "", "/");
        return;
      }
    } else if (projectId) {
      setProjects((current) => current.map((project) => (project.id === projectId ? { ...project, updatedAt: Date.now() } : project)));
    }
    setActiveProjectId(projectId);
    setOpeningProjectId(projectId);
    setOpenSpinner(false);
    setViewportReady(false);
    setEditorStarted(true);
    setView("editor");
    if (typeof window !== "undefined") {
      const nextUrl = projectId ? `/?editor=1&project=${encodeURIComponent(projectId)}` : "/?editor=1";
      window.history.replaceState(null, "", nextUrl);
    }
  };

  const applyOpenedDocument = useCallback(
    (opened: { document: PeakcadDocument; path: string | null }, shouldOpen: boolean) => {
      const { document, path } = opened;
      // Fonts the design brought with it join this computer's fonts, so its text looks as it was made.
      const fontWarning = document.fonts?.length
        ? designFontsNotKeptMessage(installDesignFontsReport(document.fonts, document.project.name).failed)
        : null;
      if (fontWarning) {
        if (shouldOpen) notifyEditor(fontWarning);
        else setDashboardNotice(fontWarning);
      }
      if (document.guide && document.history?.length) {
        const id = playbackProjectId(document.project.id);
        const end = Math.min(document.history.length - 1, Math.max(0, document.historyIndex ?? document.history.length - 1));
        const history = document.history.slice(0, end + 1);
        const session: GuideSession = { id, guide: document.guide, history };
        rememberGuideSession(session, path);
        const shapes = guideStartShapes(history, document.guide.steps);
        const now = Date.now();
        const existing = projectsRef.current.find((project) => project.id === id);
        const project: DashboardProject = {
          id,
          name: document.guide.title,
          createdAt: existing?.createdAt ?? document.project.createdAt ?? now,
          updatedAt: now,
          shapes: shapes.length,
          accent: document.project.accent,
          thumbnailUrl: existing?.thumbnailUrl ?? null,
          thumbnailUrlDark: existing?.thumbnailUrlDark ?? null,
          thumbnailVersion: existing?.thumbnailVersion,
          revision: now,
          workspace: document.project.workspace,
          snapGrid: document.project.snapGrid,
          folderId: existing?.folderId ?? null,
          filePath: null,
          savedFileName: null,
        };
        const entry = projectShapeCacheEntry(now, shapes);
        setProjectShapesById((current) => ({ ...current, [project.id]: entry }));
        void saveProjectShapes(project.id, entry, { fullHistory: true }).catch(() => {
          setDashboardNotice("Could not store the tutorial locally.");
        });
        setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
        updateDashboardOrder((current) => ({
          ...current,
          projects: current.projects.includes(project.id) ? current.projects : [...current.projects, project.id],
        }));
        if (shouldOpen) {
          setActiveProjectId(project.id);
          setEditorStarted(true);
          setView("editor");
          if (typeof window !== "undefined") {
            window.history.replaceState(null, "", `/?editor=1&project=${encodeURIComponent(project.id)}`);
          }
        }
        return;
      }
      // The same file opened again replaces its design. A different file of the same design (an
      // older backup, or the file a Save as moved away from) opens as a copy, so it never
      // overwrites the design as it is now.
      const samePath = path != null ? projectsRef.current.find((project) => project.filePath === path) : undefined;
      const sameId = projectsRef.current.find((project) => project.id === document.project.id);
      const opensAsCopy = Boolean(
        !samePath && sameId && (document.project.revision ?? 0) !== (sameId.revision ?? 0),
      );
      const existing = samePath ?? (opensAsCopy ? undefined : sameId);
      if (shouldOpen && existing?.folderId) {
        const folder = foldersRef.current.find((item) => item.id === existing.folderId);
        if (folder?.passwordLock && !unlockedFolderIdsRef.current.has(folder.id)) {
          setFolderAccessRequest({ folderId: folder.id, opened });
          return;
        }
      }
      const project: DashboardProject = {
        id: existing?.id ?? (opensAsCopy ? createLocalId("project") : document.project.id),
        name: opensAsCopy ? `${document.project.name} (opened copy)` : document.project.name,
        createdAt: document.project.createdAt,
        updatedAt: Date.now(),
        shapes: document.shapes.length,
        accent: document.project.accent,
        thumbnailUrl: document.project.thumbnailUrl ?? existing?.thumbnailUrl ?? null,
        thumbnailUrlDark: document.project.thumbnailUrlDark ?? existing?.thumbnailUrlDark ?? null,
        thumbnailVersion: document.project.thumbnailVersion ?? existing?.thumbnailVersion,
        revision: document.project.revision ?? Date.now(),
        workspace: document.project.workspace,
        snapGrid: document.project.snapGrid,
        folderId: existing?.folderId ?? null,
        filePath: path ?? existing?.filePath ?? null,
        savedFileName: path ? peakcadBasename(path) : existing?.savedFileName ?? peakcadFilename(document.project.name),
      };
      const entry = projectShapeCacheEntry(
        project.revision ?? project.updatedAt,
        document.shapes,
        document.history,
        document.historyIndex,
      );
      setProjectShapesById((current) => ({ ...current, [project.id]: entry }));
      void saveProjectShapes(project.id, entry, { fullHistory: true }).catch(() => {
        setDashboardNotice("Could not store the opened project locally.");
      });
      if (document.project.thumbnailUrl) {
        void saveProjectThumbnail(
          project.id,
          document.project.thumbnailUrl,
          project.thumbnailVersion ?? project.updatedAt,
          document.project.thumbnailUrlDark,
        ).catch(() => undefined);
      }
      setProjects((current) => [
        project,
        ...current.filter((item) => item.id !== project.id && (path == null || item.filePath !== path)),
      ]);
      updateDashboardOrder((current) => ({
        ...current,
        projects: current.projects.includes(project.id) ? current.projects : [...current.projects, project.id],
      }));
      if (shouldOpen) {
        setActiveProjectId(project.id);
        setEditorStarted(true);
        setView("editor");
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", `/?editor=1&project=${encodeURIComponent(project.id)}`);
        }
      }
    },
    [notifyEditor, updateDashboardOrder],
  );

  const openSavedGuide = useCallback(async (id: string, restart: boolean) => {
    const card = readGuideCatalog().find((entry) => entry.id === id);
    let session = guideSessionFor(id);
    if (!session && card?.path) {
      try {
        const opened = await readPeakcadPathText(card.path);
        const parsed = await openProtectedPeakcad(opened.text, opened.path);
        if (!parsed?.document.guide || !parsed.document.history?.length) {
          setDashboardNotice("That file is not a Mintr guide.");
          return;
        }
        applyOpenedDocument(parsed, true);
        return;
      } catch (error) {
        setDashboardNotice(error instanceof Error ? error.message : "Could not open that guide.");
        return;
      }
    }
    if (!session) {
      setDashboardNotice("Open the .mintrguide file to start this tutorial.");
      return;
    }
    const existing = projectsRef.current.find((project) => project.id === id);
    if (existing && !restart) {
      setActiveProjectId(id);
      setEditorStarted(true);
      setView("editor");
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `/?editor=1&project=${encodeURIComponent(id)}`);
      }
      return;
    }
    const sourceId = id.startsWith("guide:") ? id.slice("guide:".length) : id;
    const end = session.history.length - 1;
    applyOpenedDocument({
      document: {
        format: "peakcad",
        version: 1,
        savedAt: Date.now(),
        project: {
          id: sourceId,
          name: session.guide.title,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          accent: existing?.accent ?? "cyan",
          shapes: session.history[end]?.shapes.length ?? 0,
          workspace: existing?.workspace,
          snapGrid: existing?.snapGrid,
        },
        shapes: session.history[end]?.shapes ?? [],
        history: session.history,
        historyIndex: end,
        guide: session.guide,
      },
      path: card?.path ?? null,
    }, true);
  }, [applyOpenedDocument, openProtectedPeakcad]);

  const openFromDisk = useCallback(async () => {
    try {
      const opened = await openPeakcadFileText();
      if (!opened) return;
      const document = await openProtectedPeakcad(opened.text, opened.path);
      if (!document) return;
      applyOpenedDocument(document, true);
    } catch (error) {
      setDashboardNotice(error instanceof Error ? error.message : "Could not open that project.");
    }
  }, [applyOpenedDocument, openProtectedPeakcad]);

  const saveProjectToDisk = useCallback(async (
    projectId: string,
    forceSaveAs = false,
    entryOverride?: ProjectShapeCacheEntry,
    { throwOnError = false }: { throwOnError?: boolean } = {},
  ): Promise<boolean> => {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return false;
    let cached = entryOverride ?? projectShapesByIdRef.current[projectId];
    if (!cached) {
      // Not opened yet: save what is stored. Saving an empty entry here used to wipe the design.
      const stored = await loadProjectShapes(projectId).catch(() => null);
      if (!stored) {
        setDashboardNotice(`Could not read ${project.name} to save it. Open it, then save again.`);
        return false;
      }
      cached = projectShapeCacheEntry(stored.revision, stored.shapes ?? [], stored.history, stored.historyIndex);
    }
    try {
      const plain = await serializeProjectForDisk(project, cached);
      const text = await sealPeakcadText(project, plain, true);
      if (!text) return false;
      if (!forceSaveAs && project.filePath && hasDesktopProjectFiles()) {
        // In line with autosave's file writes, so an older autosave still writing can never land
        // after this Save and leave the file behind.
        const filePath = project.filePath;
        const revision = cached.revision;
        const previous = projectShapeSaveQueuesRef.current[projectId] ?? Promise.resolve();
        const write = previous.catch(() => undefined).then(async () => {
          await writePeakcadText(filePath, text);
          lastDiskRevisionRef.current[projectId] = Math.max(lastDiskRevisionRef.current[projectId] ?? 0, revision);
        });
        projectShapeSaveQueuesRef.current[projectId] = write;
        try {
          await write;
        } finally {
          if (projectShapeSaveQueuesRef.current[projectId] === write) delete projectShapeSaveQueuesRef.current[projectId];
        }
        setProjects((current) =>
          current.map((item) => (item.id === projectId ? withSavedPeakcadFile(item, project.filePath) : item)),
        );
        setDashboardNotice(`Saved ${peakcadBasename(project.filePath)}`);
        return true;
      }
      const nextPath = await savePeakcadTextAs(text, project.name);
      if (nextPath) {
        lastDiskRevisionRef.current[projectId] = cached.revision;
        setProjects((current) => claimPeakcadPath(current, projectId, nextPath));
        setDashboardNotice(`Saved ${peakcadBasename(nextPath)}`);
        return true;
      }
      if (!hasDesktopProjectFiles()) {
        setProjects((current) =>
          current.map((item) => (item.id === projectId ? withSavedPeakcadFile(item, null, peakcadFilename(project.name)) : item)),
        );
        setDashboardNotice(`Downloaded ${peakcadFilename(project.name)}`);
        return true;
      }
      return false;
    } catch (error) {
      if (throwOnError) throw error;
      setDashboardNotice(error instanceof Error ? error.message : "Could not save the project.");
      return false;
    }
  }, [sealPeakcadText]);

  const persistCachedProjectFile = useCallback((projectId: string, filePath: string) => {
    if (!hasDesktopProjectFiles()) return;
    const latest = projectsRef.current.find((item) => item.id === projectId);
    const cached = projectShapesByIdRef.current[projectId];
    if (!latest || !cached) return;
    lastDiskRevisionRef.current[projectId] = cached.revision;
    void serializeProjectForDisk({ ...latest, filePath }, cached)
      .then((plain) => sealPeakcadText({ ...latest, filePath }, plain, false))
      .then((text) => {
        if (!text) return;
        return writePeakcadText(filePath, text);
      })
      .catch((error) => {
        setDashboardNotice(error instanceof Error ? error.message : "Could not save the project.");
      });
  }, [sealPeakcadText]);

  useEffect(() => {
    if (!hasDesktopProjectFiles()) return;
    for (const project of projects) {
      if (!project.filePath) continue;
      if (knownFilePathRef.current[project.id] === project.filePath) continue;
      knownFilePathRef.current[project.id] = project.filePath;
      persistCachedProjectFile(project.id, project.filePath);
    }
  }, [persistCachedProjectFile, projects]);

  useEffect(() => {
    setKnownLegacyProjectPaths(
      projects.flatMap((project) => (
        project.filePath && /\.(peakcad|mintr)$/i.test(project.filePath) ? [project.filePath] : []
      )),
    );
  }, [projects]);

  useEffect(() => {
    const retarget = (renames: { from: string; to: string }[]) => {
      const byFrom = new Map(renames.map((item) => [item.from.replaceAll("/", "\\").toLowerCase(), item.to]));
      setProjects((current) => {
        let changed = false;
        const next = current.map((project) => {
          if (!project.filePath) return project;
          const to = byFrom.get(project.filePath.replaceAll("/", "\\").toLowerCase());
          if (!to) return project;
          changed = true;
          knownFilePathRef.current[project.id] = to;
          return withSavedPeakcadFile(project, to);
        });
        return changed ? next : current;
      });
    };
    const pending = readPendingProjectMoves().then((moves) => {
      if (moves.length > 0) retarget(moves);
    }).catch(() => undefined);
    return subscribeProjectFilesTransitioned((renames) => {
      void pending.then(() => retarget(renames));
    });
  }, []);

  const attachMatchingDesktopFile = useCallback(async (projectId: string) => {
    if (!hasDesktopProjectFiles()) return;
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project || project.filePath || projectMatchesSavedFile(project)) return;
    try {
      const opened = await resolveDesktopPeakcadTextByName(project.name);
      if (!opened?.path) return;
      let plain = opened.text;
      if (isEncryptedPeakcadText(plain)) {
        const password = (project.folderId ? folderSecretsRef.current.get(project.folderId) : undefined)
          ?? projectSecretsRef.current.get(project.id)
          ?? null;
        if (!password) return;
        plain = await decryptPeakcadText(plain, password);
      }
      const document = parsePeakcadDocument(plain);
      if (document.project.id !== project.id) return;
      setProjects((current) =>
        current.map((item) => (item.id === projectId ? withSavedPeakcadFile(item, opened.path) : item)),
      );
    } catch {
      // Missing or unreadable files stay on Save as.
    }
  }, []);

  useEffect(() => {
    if (!activeProjectId) return;
    void attachMatchingDesktopFile(activeProjectId);
  }, [activeProjectId, attachMatchingDesktopFile]);

  const updateProjectSnapshot = useCallback((snapshot: {
    image: string;
    imageDark?: string;
    projectId: string;
    shapes: number;
  }) => {
    // Home captures then navigates to the dashboard immediately. Do not abort the
    // async save when view leaves "editor" — that was dropping desktop thumbnails.
    if (!snapshot.image || snapshot.image.length < 100 || !snapshot.projectId) {
      return;
    }
    const version = Date.now();
    if (STATIC_EXPORT_BUILD) {
      setProjects((current) =>
        current.map((project) =>
          project.id === snapshot.projectId
            ? { ...project, shapes: snapshot.shapes, updatedAt: version }
            : project,
        ),
      );
      void Promise.all([
        downscaleThumbnailDataUrl(snapshot.image),
        snapshot.imageDark && snapshot.imageDark.length > 100
          ? downscaleThumbnailDataUrl(snapshot.imageDark)
          : Promise.resolve(null),
      ])
        .then(async ([compact, compactDark]) => {
          await saveProjectThumbnail(snapshot.projectId, compact, version, compactDark);
          setProjects((current) =>
            current.map((project) =>
              project.id === snapshot.projectId
                ? {
                  ...project,
                  shapes: snapshot.shapes,
                  thumbnailUrl: compact,
                  thumbnailUrlDark: compactDark,
                  thumbnailVersion: version,
                  updatedAt: version,
                }
                : project,
            ),
          );
        })
        .catch(() => {
          setDashboardNotice("Could not save project thumbnail");
        });
      return;
    }

    setProjects((current) =>
      current.map((project) => (project.id === snapshot.projectId ? { ...project, shapes: snapshot.shapes, updatedAt: version } : project)),
    );
    void fetch("/api/project-thumbnail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataUrl: snapshot.image,
        dataUrlDark: snapshot.imageDark,
        projectId: snapshot.projectId,
      }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { version?: number } | null) => {
        const nextVersion = payload?.version ?? Date.now();
        const thumbnailUrl = projectThumbnailApiUrl(snapshot.projectId, nextVersion, "light");
        const thumbnailUrlDark = projectThumbnailApiUrl(snapshot.projectId, nextVersion, "dark");
        setProjects((current) =>
          current.map((project) =>
            project.id === snapshot.projectId
              ? {
                ...project,
                shapes: snapshot.shapes,
                thumbnailUrl,
                thumbnailUrlDark,
                thumbnailVersion: nextVersion,
                updatedAt: nextVersion,
              }
              : project,
          ),
        );
      })
      .catch(() => {
        setProjects((current) =>
          current.map((project) => (project.id === snapshot.projectId ? { ...project, shapes: snapshot.shapes, updatedAt: version } : project)),
        );
      });
  }, []);

  // Writes the newest autosave to the project's .mintr file, in the same queue as the
  // store saves so they never cross. Skipped when an explicit Save already wrote it.
  const writePendingProjectFile = useCallback((projectId: string) => {
    const pending = pendingDiskWritesRef.current[projectId];
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    delete pendingDiskWritesRef.current[projectId];
    const previousSave = projectShapeSaveQueuesRef.current[projectId] ?? Promise.resolve();
    const queuedWrite = previousSave.catch(() => undefined).then(async () => {
      const project = projectsRef.current.find((item) => item.id === projectId);
      if (!project?.filePath || !hasDesktopProjectFiles()) return;
      if ((lastDiskRevisionRef.current[projectId] ?? 0) >= pending.revision) return;
      const revision = pending.revision;
      const meta = peakcadProjectMeta({ ...project, updatedAt: revision, revision }, pending.entry.shapes.length);
      const plain = (pending.stored ? await serializeStoredProject(projectId, meta, projectDesignFonts(pending.entry)).catch(() => null) : null)
        ?? serializePeakcadDocument(buildDocumentForProject({ ...project, updatedAt: revision, revision }, pending.entry));
      const text = await sealPeakcadText({ ...project, updatedAt: revision, revision }, plain, false);
      if (text) {
        await writePeakcadText(project.filePath, text);
        lastDiskRevisionRef.current[projectId] = Math.max(lastDiskRevisionRef.current[projectId] ?? 0, revision);
      }
    });
    projectShapeSaveQueuesRef.current[projectId] = queuedWrite;
    void queuedWrite
      .catch((error) => {
        if (projectShapeSaveQueuesRef.current[projectId] === queuedWrite) {
          const message = `Autosave failed: ${error instanceof Error ? error.message : "could not write the project file"}`;
          setDashboardNotice(message);
          notifyEditor(message);
        }
      })
      .finally(() => {
        if (projectShapeSaveQueuesRef.current[projectId] === queuedWrite) {
          delete projectShapeSaveQueuesRef.current[projectId];
        }
      });
  }, [notifyEditor, sealPeakcadText]);

  const updateProjectShapes = useCallback((snapshot: {
    projectId: string;
    shapes: WorkplaneShape[];
    history: EditorHistoryEntry[];
    historyIndex: number;
  }) => {
    // The editor flushes its final snapshot from an unmount cleanup, which runs *after* the view
    // state has already flipped to "dashboard". Gating on the view discarded every edit made since
    // the last 120ms debounce — and all of an in-progress drag, whose only persistence path is that
    // flush. Ordering is enforced by the revision guards below, so all this needs to reject is a
    // snapshot for a project that no longer exists.
    if (!projectsRef.current.some((project) => project.id === snapshot.projectId)) {
      return;
    }
    const revision = Math.max(Date.now(), nextProjectRevisionRef.current + 1);
    nextProjectRevisionRef.current = revision;
    const entry = projectShapeCacheEntry(revision, snapshot.shapes, snapshot.history, snapshot.historyIndex);
    setProjectShapesById((current) => {
      const existing = current[snapshot.projectId];
      if (existing && existing.revision > revision) {
        return current;
      }
      return {
        ...current,
        [snapshot.projectId]: entry,
      };
    });

    const previousSave = projectShapeSaveQueuesRef.current[snapshot.projectId] ?? Promise.resolve();
    const queuedSave = previousSave.catch(() => undefined).then(async () => {
      let storeError: unknown = null;
      const stored = await saveProjectShapes(snapshot.projectId, entry).then(() => true, (error: unknown) => {
        storeError = error;
        return false;
      });
      // The store save above is the instant safety copy. Rewriting the whole .mintr
      // file after every nudge stalled big designs, so the file catches up a few
      // seconds after the last change (and at once on Save, close or leaving the
      // design). A full or broken store still gets the file written: that is the
      // copy people can actually recover.
      const project = projectsRef.current.find((item) => item.id === snapshot.projectId);
      if (project?.filePath && hasDesktopProjectFiles()) {
        const previous = pendingDiskWritesRef.current[snapshot.projectId];
        if (previous?.timer) clearTimeout(previous.timer);
        pendingDiskWritesRef.current[snapshot.projectId] = {
          revision,
          entry,
          stored,
          timer: setTimeout(() => writePendingProjectFile(snapshot.projectId), stored ? PROJECT_FILE_WRITE_DELAY_MS : 0),
        };
      }
      if (!stored) throw storeError instanceof Error ? storeError : new Error("Could not save project shapes");
    });
    projectShapeSaveQueuesRef.current[snapshot.projectId] = queuedSave;

    void queuedSave
      .then(() => {
        setProjects((current) =>
          current.map((project) =>
            project.id === snapshot.projectId && (project.revision ?? 0) <= revision
              ? { ...project, shapes: snapshot.shapes.length, updatedAt: revision, revision }
              : project,
          ),
        );
      })
      .catch((error) => {
        if (projectShapeSaveQueuesRef.current[snapshot.projectId] === queuedSave) {
          const message = `Autosave failed: ${error instanceof Error ? error.message : "could not save project shapes"}`;
          setDashboardNotice(message);
          notifyEditor(message);
        }
      })
      .finally(() => {
        if (projectShapeSaveQueuesRef.current[snapshot.projectId] === queuedSave) {
          delete projectShapeSaveQueuesRef.current[snapshot.projectId];
        }
      });
  }, [notifyEditor, writePendingProjectFile]);

  const updateProjectWorkspace = useCallback((snapshot: { projectId: string; workspace: WorkplaneWorkspaceSettings; snap: GridSize }) => {
    // Same reason as updateProjectShapes: a settings change made just before leaving the editor
    // arrives once the view has already flipped, and gating on that dropped it.
    if (!projectsRef.current.some((project) => project.id === snapshot.projectId)) {
      return;
    }
    const version = Date.now();
    const workspace = normalizeWorkspaceSettings(snapshot.workspace);
    const snapGrid = normalizeSnapGrid(snapshot.snap);
    const nextFingerprint = workplaneSettingsFingerprint(workspace, snapGrid);
    setProjects((current) => {
      let changed = false;
      const next = current.map((project) => {
        if (project.id !== snapshot.projectId) return project;
        const currentFingerprint = workplaneSettingsFingerprint(
          normalizeWorkspaceSettings(project.workspace),
          normalizeSnapGrid(project.snapGrid),
        );
        if (currentFingerprint === nextFingerprint) return project;
        changed = true;
        return {
          ...project,
          workspace,
          snapGrid,
          updatedAt: version,
        };
      });
      return changed ? next : current;
    });
  }, []);

  const createAndOpenProject = (name?: string, kind: DesignKind = "print", shapes: WorkplaneShape[] = []) => {
    const project = newProject(name ?? nextDesignName(projects), projects.length, shapes.length, null, kind);
    const shapeEntry = projectShapeCacheEntry(project.revision ?? project.updatedAt, shapes);
    // Seed shapes + project list before switching views so the editor never mounts
    // against a missing cache entry (that unmount/remount cycle was blanking WebGL).
    setProjectShapesById((current) => ({
      ...current,
      [project.id]: shapeEntry,
    }));
    void saveProjectShapes(project.id, shapeEntry).catch(() => {
      setDashboardNotice("Could not prepare project shape storage");
    });
    updateDashboardOrder((current) => ({
      ...current,
      projects: current.projects.includes(project.id) ? current.projects : [...current.projects, project.id],
    }));
    setProjects((current) => [project, ...current.filter((entry) => entry.id !== project.id)]);
    setActiveProjectId(project.id);
    setEditorStarted(true);
    setView("editor");
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/?editor=1&project=${encodeURIComponent(project.id)}`);
    }
    if (hasDesktopProjectFiles()) {
      void writeNewDesktopPeakcad(buildDocumentForProject(project, shapeEntry), project.name)
        .then((filePath) => {
          if (!filePath) return;
          setProjects((current) => current.map((item) => (item.id === project.id ? withSavedPeakcadFile(item, filePath) : item)));
          persistCachedProjectFile(project.id, filePath);
        })
        .catch(() => {
          setDashboardNotice("Created the design, but could not write a .mintr file yet. Use Save As to pick a folder.");
        });
    }
    return project.id;
  };
  createAndOpenProjectRef.current = createAndOpenProject;

  /** Laser designs to offer in Send to laser, most recent first. */
  const laserDesignChoices = useMemo(
    () => projects
      .filter((project) => project.workspace?.designKind === "laser")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((project) => ({ id: project.id, name: project.name, crystal: isCrystalDesign(project.workspace) })),
    [projects],
  );

  /**
   * Send to laser: the 3D parts go, marked pending, into a new laser design or onto the
   * end of an existing one, which then opens and makes them into sheet parts.
   */
  const sendShapesToLaser = async (target: string, sourceName: string, shapes: WorkplaneShape[]) => {
    if (shapes.length === 0) return;
    if (target === "new") {
      const projectId = createAndOpenProject(`${sourceName} (laser)`, "laser", shapes);
      if (projectId) setOpeningNotice({ projectId, text: `Brought over from ${sourceName}.` });
      return;
    }
    const project = projectsRef.current.find((item) => item.id === target);
    if (!project) {
      setDashboardNotice("That laser design is no longer here.");
      return;
    }
    try {
      const cached = projectShapesById[target];
      const existing = cached ? cached.shapes : (await loadProjectShapes(target))?.shapes ?? [];
      // A fresh history: the parts arrive as the design's newest state.
      const entry = projectShapeCacheEntry(Date.now(), [...existing, ...shapes]);
      setProjectShapesById((current) => ({ ...current, [target]: entry }));
      await saveProjectShapes(target, entry);
      setProjects((current) => current.map((item) => (item.id === target ? { ...item, revision: entry.revision, updatedAt: entry.revision } : item)));
      setOpeningNotice({ projectId: target, text: `Brought over from ${sourceName}.` });
      openEditor(target);
    } catch {
      setDashboardNotice(`Could not add the parts to ${project.name}.`);
    }
  };

  /** A 3D design's parts and revision, for Update from model in a laser design. */
  const loadDesignForLaser = async (designId: string) => {
    const project = projectsRef.current.find((item) => item.id === designId);
    if (!project) return null;
    const cached = projectShapesById[designId];
    if (cached) return { name: project.name, shapes: cached.shapes, revision: cached.revision };
    const record = await loadProjectShapes(designId);
    return record ? { name: project.name, shapes: record.shapes, revision: record.revision ?? project.revision ?? 0 } : null;
  };

  /** How far a design has moved on, so a laser design can say its model has changed. */
  const designRevision = (designId: string) => {
    const project = projects.find((item) => item.id === designId);
    if (!project) return null;
    return Math.max(project.revision ?? 0, projectShapesById[designId]?.revision ?? 0);
  };

  /** People with a laser choose print or laser; everyone else gets a print design at once. */
  const startNewDesign = () => {
    const machines = loadMachineChoice();
    if (machineHasLaser(machines)) setNewDesignAsk(machines);
    else createAndOpenProject();
  };
  startNewDesignRef.current = startNewDesign;

  const openBuiltinGuide = (id: string, restart: boolean) => {
    const session = builtinGuideSession(id);
    if (!session) return;
    const existing = projectsRef.current.find((project) => project.id === id);
    if (existing && !restart) {
      rememberGuideSession(session, null);
      openEditor(id, { allowMissingFromStorage: true });
      return;
    }
    const sourceId = id.startsWith("guide:") ? id.slice("guide:".length) : id;
    const end = session.history.length - 1;
    applyOpenedDocument({
      document: buildPeakcadDocument({
        project: {
          id: sourceId,
          name: session.guide.title,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          accent: existing?.accent ?? "cyan",
          shapes: 0,
          workspace: existing?.workspace,
          snapGrid: existing?.snapGrid,
        },
        shapes: session.history[end]?.shapes ?? [],
        history: session.history,
        historyIndex: end,
        guide: session.guide,
        fonts: designFontLibrary(),
      }),
      path: null,
    }, true);
  };

  const openOrCreateIntro = () => {
    markLessonSeeded();
    const existing = projectsRef.current.find((project) => project.id === LESSON_PROJECT_ID);
    if (existing) {
      openEditor(LESSON_PROJECT_ID, { allowMissingFromStorage: true });
      return;
    }
    const lesson = createLessonProjectMeta();
    const entry = projectShapeCacheEntry(lesson.revision ?? lesson.updatedAt, createLessonShapes());
    setProjectShapesById((current) => ({ ...current, [lesson.id]: entry }));
    void saveProjectShapes(lesson.id, entry).catch(() => {
      setDashboardNotice("Could not prepare the lesson.");
    });
    updateDashboardOrder((current) => ({
      ...current,
      projects: current.projects.includes(lesson.id) ? current.projects : [...current.projects, lesson.id],
    }));
    setProjects((current) => [lesson, ...current.filter((item) => item.id !== lesson.id)]);
    setActiveProjectId(lesson.id);
    setEditorStarted(true);
    setView("editor");
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/?editor=1&project=${encodeURIComponent(lesson.id)}`);
    }
    if (hasDesktopProjectFiles()) {
      void writeNewDesktopPeakcad(buildDocumentForProject(lesson, entry), lesson.name)
        .then((filePath) => {
          if (!filePath) return;
          setProjects((current) => current.map((item) => (item.id === lesson.id ? withSavedPeakcadFile(item, filePath) : item)));
          persistCachedProjectFile(lesson.id, filePath);
        })
        .catch(() => undefined);
    }
  };

  const openDashboard = () => {
    // Leaving a design writes its .mintr file now rather than a few seconds later.
    if (activeProjectId) writePendingProjectFile(activeProjectId);
    setOpeningProjectId(null);
    setOpenSpinner(false);
    setViewportReady(false);
    if (activeProjectId) {
      setProjects((current) => current.map((project) => (project.id === activeProjectId ? { ...project, updatedAt: Date.now() } : project)));
    }
    setView("dashboard");
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/");
    }
  };

  const deleteProject = (projectId: string) => {
    if (Object.prototype.hasOwnProperty.call(projectFolderMapRef.current, projectId)) {
      const nextMap = { ...projectFolderMapRef.current };
      delete nextMap[projectId];
      projectFolderMapRef.current = nextMap;
      writeProjectFolderMap(nextMap);
    }
    setProjects((current) => current.filter((project) => project.id !== projectId));
    setFolders((current) =>
      current.map((folder) =>
        folder.heroProjectId === projectId ? { ...folder, heroProjectId: null, updatedAt: Date.now() } : folder,
      ),
    );
    setProjectShapesById((current) => {
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
    }
    if (!STATIC_EXPORT_BUILD) {
      void fetch(`/api/project-thumbnail?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" });
    } else {
      void deleteProjectThumbnail(projectId).catch(() => {
        setDashboardNotice("Could not delete project thumbnail from local storage");
      });
    }
    // A save queued just before Delete (the editor's unmount flush, or an
    // explicit Save still writing) would otherwise land after the delete and
    // resurrect the record with its mesh blobs — invisible on the dashboard,
    // permanent in storage. Wait for the queue, then delete.
    const queued = projectShapeSaveQueuesRef.current[projectId] ?? Promise.resolve();
    delete projectShapeSaveQueuesRef.current[projectId];
    void queued.catch(() => undefined).then(() => deleteProjectShapes(projectId)).catch(() => {
      setDashboardNotice("Could not delete project shapes from local storage");
    });
  };

  const renameProject = (projectId: string, name: string) => {
    const nextName = name.trim().slice(0, 80);
    if (!nextName) return;
    setProjects((current) =>
      current.map((project) => (project.id === projectId ? { ...project, name: nextName, updatedAt: Date.now() } : project)),
    );
    void attachMatchingDesktopFile(projectId);
  };

  const createFolder = (name?: string) => {
    const folder = newFolder((name?.trim() || nextFolderName(folders)).slice(0, 80));
    updateDashboardOrder((current) => ({
      ...current,
      folders: current.folders.includes(folder.id) ? current.folders : [...current.folders, folder.id],
      byFolder: { ...current.byFolder, [folder.id]: current.byFolder[folder.id] ?? [] },
    }));
    setFolders((current) => [folder, ...current]);
    return folder.id;
  };

  const renameFolder = (folderId: string, name: string) => {
    const nextName = name.trim().slice(0, 80);
    if (!nextName) return;
    setFolders((current) =>
      current.map((folder) => (folder.id === folderId ? { ...folder, name: nextName, updatedAt: Date.now() } : folder)),
    );
  };

  const deleteFolder = (folderId: string) => {
    const now = Date.now();
    const nextMap = { ...projectFolderMapRef.current };
    let mapChanged = false;
    for (const [projectId, mappedFolderId] of Object.entries(nextMap)) {
      if (mappedFolderId === folderId) {
        nextMap[projectId] = null;
        mapChanged = true;
      }
    }
    if (mapChanged) {
      projectFolderMapRef.current = nextMap;
      writeProjectFolderMap(nextMap);
    }
    setProjects((current) =>
      current.map((project) => (project.folderId === folderId ? { ...project, folderId: null, updatedAt: now } : project)),
    );
    setFolders((current) => current.filter((folder) => folder.id !== folderId));
  };

  const moveProjectToFolder = (projectId: string, folderId: string | null) => {
    const now = Date.now();
    const previousFolderId =
      (Object.prototype.hasOwnProperty.call(projectFolderMapRef.current, projectId)
        ? projectFolderMapRef.current[projectId]
        : projectsRef.current.find((entry) => entry.id === projectId)?.folderId) ?? null;
    if (previousFolderId === folderId) {
      return;
    }
    const nextMap = { ...projectFolderMapRef.current, [projectId]: folderId };
    projectFolderMapRef.current = nextMap;
    writeProjectFolderMap(nextMap);
    updateDashboardOrder((current) => {
      const byFolder = Object.fromEntries(
        Object.entries(current.byFolder).map(([id, members]) => [id, members.filter((memberId) => memberId !== projectId)]),
      );
      if (folderId) {
        byFolder[folderId] = [...(byFolder[folderId] ?? []), projectId];
      }
      return {
        ...current,
        projects: current.projects.includes(projectId) ? current.projects : [...current.projects, projectId],
        byFolder,
      };
    });
    setProjects((current) => {
      const project = current.find((entry) => entry.id === projectId);
      if (!project) {
        return current;
      }
      const next = current.map((entry) => (entry.id === projectId ? { ...entry, folderId, updatedAt: now } : entry));
      projectsRef.current = next;
      persistProjectsList(next);
      return next;
    });
    setFolders((current) =>
      current.map((folder) => {
        if (folderId && folder.id === folderId) {
          return {
            ...folder,
            updatedAt: now,
            heroProjectId: folder.heroProjectId ?? projectId,
          };
        }
        if (folder.heroProjectId === projectId && folder.id !== folderId) {
          return { ...folder, heroProjectId: null, updatedAt: now };
        }
        return folder;
      }),
    );
    const moved = projectsRef.current.find((entry) => entry.id === projectId);
    if (moved?.filePath) {
      if (folderId) {
        const secret = folderSecretsRef.current.get(folderId);
        if (secret) void rewriteProjectDiskFile(moved, secret, secret);
      } else if (previousFolderId) {
        const secret = folderSecretsRef.current.get(previousFolderId);
        if (secret) void rewriteProjectDiskFile(moved, null, secret);
      }
    }
  };

  const setFolderHero = (folderId: string, projectId: string) => {
    const now = Date.now();
    setFolders((current) =>
      current.map((folder) => (folder.id === folderId ? { ...folder, heroProjectId: projectId, updatedAt: now } : folder)),
    );
    setProjects((current) =>
      current.map((project) => (project.id === projectId ? { ...project, updatedAt: now } : project)),
    );
  };

  useEffect(() => {
    return subscribePeakcadOpenPath((filePath) => {
      void (async () => {
        if (!(await confirmLeaveEditor())) return;
        try {
          const opened = await readPeakcadPathText(filePath);
          const document = await openProtectedPeakcad(opened.text, opened.path);
          if (!document) return;
          applyOpenedDocument(document, true);
        } catch (error) {
          setDashboardNotice(error instanceof Error ? error.message : "Could not open that project.");
        }
      })();
    });
  }, [applyOpenedDocument, confirmLeaveEditor, openProtectedPeakcad]);

  useEffect(() => {
    return subscribePeakcadMenu((action) => {
      if (action === "new" || action === "open") {
        void (async () => {
          if (!(await confirmLeaveEditor())) return;
          if (action === "new") startNewDesignRef.current();
          else await openFromDisk();
        })();
        return;
      }
      if (action === "settings") {
        if (activeProjectIdRef.current) {
          window.dispatchEvent(new Event("sketchforge:open-workspace-settings"));
        } else {
          setSettingsOpen(true);
        }
        return;
      }
      if (action === "import" || action === "export") {
        editorLeaveGuardRef.current?.command?.(action);
        return;
      }
      if (action !== "save" && action !== "save-as") return;
      const projectId = activeProjectIdRef.current;
      if (!projectId) {
        setDashboardNotice("Open a design to save it.");
        return;
      }
      // The editor's save bakes exact STEP for new imports before writing.
      if (editorLeaveGuardRef.current) {
        void editorLeaveGuardRef.current.save(action);
        return;
      }
      const project = projectsRef.current.find((item) => item.id === projectId);
      void saveProjectToDisk(projectId, action === "save-as" || !projectMatchesSavedFile(project));
    });
  }, [confirmLeaveEditor, openFromDisk, saveProjectToDisk]);

  const awaitProjectSaveQueue = useCallback(async (projectId: string) => {
    // Let the store save in flight finish, then write the file now instead of waiting.
    await projectShapeSaveQueuesRef.current[projectId]?.catch(() => undefined);
    writePendingProjectFile(projectId);
    let queue = projectShapeSaveQueuesRef.current[projectId];
    while (queue) {
      try {
        await queue;
      } catch {
        return false;
      }
      const next = projectShapeSaveQueuesRef.current[projectId];
      if (next === queue) break;
      queue = next;
    }
    return true;
  }, [writePendingProjectFile]);

  useEffect(() => {
    return subscribePeakcadSaveBeforeClose(async () => {
      const projectId = activeProjectIdRef.current;
      const guard = editorLeaveGuardRef.current;
      if (!guard || !projectId) return true;
      if (!(await guard.save("save"))) return false;
      // Explicit save only queues the IndexedDB write; the window is destroyed as soon as this resolves.
      return awaitProjectSaveQueue(projectId);
    });
  }, [awaitProjectSaveQueue]);

  useEffect(() => {
    // The desktop window asks for this before it decides whether to close. The
    // editor's 120 ms debounce and the store worker's in-flight transaction
    // would otherwise be cut off by the renderer going away, losing the last edit.
    return subscribePeakcadFlushBeforeClose(async () => {
      const projectId = activeProjectIdRef.current;
      editorLeaveGuardRef.current?.flush?.();
      if (!projectId) return true;
      return awaitProjectSaveQueue(projectId);
    });
  }, [awaitProjectSaveQueue]);

  useEffect(() => {
    if (view !== "dashboard") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key !== ",") return;
      event.preventDefault();
      setSettingsOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view]);

  if (!mounted) {
    return null;
  }

  const activeProject = activeProjectId ? projects.find((project) => project.id === activeProjectId) ?? null : null;
  const activeProjectShapeEntry = activeProjectId ? projectShapesById[activeProjectId] : null;
  const canRenderEditor = !activeProjectId || (Boolean(activeProject) && Boolean(activeProjectShapeEntry));
  const openingShapes = openingProjectId ? projectShapesById[openingProjectId]?.shapes : undefined;
  let openingTriangles = 0;
  for (const shape of openingShapes ?? []) openingTriangles += shape.importedMesh?.triangleCount ?? 0;
  const openingHeavy = openingTriangles > 80_000;
  const openingName = openingProjectId ? projects.find((project) => project.id === openingProjectId)?.name ?? "Project" : "";
  const showOpeningOverlay = Boolean(
    view === "editor" && openingProjectId && (openSpinner || (openingHeavy && !viewportReady)),
  );

  const projectDebugSummary = projects.map((project) => ({
    id: project.id,
    revision: project.revision,
    shapes: project.shapes,
    designShapes: projectShapesById[project.id]?.shapes.length ?? null,
    thumbnail: Boolean(project.thumbnailUrl),
    workspace: Boolean(project.workspace),
    snapGrid: project.snapGrid ?? null,
  }));

  if (!enteredStudio) {
    return (
      <main className={`startup-screen${startupLeaving ? " is-leaving" : ""}`}>
        <div className="startup-grid" aria-hidden="true" />
        <h1 className="startup-wordmark">
          <img className="startup-wordmark-on-light" src="assets/mintr/mintr-wordmark.png" alt="Mintr" />
          <img className="startup-wordmark-on-dark" src="assets/mintr/mintr-wordmark-on-dark.png" alt="" />
        </h1>
        <p className="startup-tagline">Learn. Model. <span className="mintr-word">Mint.</span></p>
        <p className="startup-note">Your designs, your files.</p>
        <StartupThemeTabs />
        <button
          className="startup-start dashboard-primary"
          type="button"
          disabled={!startupReady || startupLeaving}
          onClick={() => {
            if (!startupReady || startupLeaving) return;
            const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            setStartupLeaving(true);
            window.setTimeout(() => setEnteredStudio(true), reduceMotion ? 0 : 320);
          }}
        >
          {startupReady ? "Start Modeling" : "Getting ready…"}
        </button>
        <div className="startup-update" aria-live="polite">
          {updateChecking ? (
            <p className="startup-update-status">
              <span className="startup-update-cube" aria-hidden="true">
                <span className="startup-update-cube-spin">
                  <span /><span /><span /><span /><span /><span />
                </span>
              </span>
              Checking for updates
            </p>
          ) : null}
          {updateOffer ? (
            <section className="startup-update-card" aria-label={`Mintr ${updateOffer.version} is ready`}>
              <header className="startup-update-head">
                <span className="startup-update-kicker">New build</span>
                <strong>Mintr {updateOffer.version}</strong>
                <span className="startup-update-ready">Ready when you are</span>
              </header>
              <ul>
                {updateOffer.notes.map((note, index) => {
                  const shape = toolbarShapeAssets[index % toolbarShapeAssets.length];
                  const highlight = noteIsFeatured(note);
                  return (
                    <li key={note} className={highlight ? "is-highlight" : undefined}>
                      <ShapeModeMark kind={shape.kind} color={shape.color} />
                      <span>{note}</span>
                    </li>
                  );
                })}
              </ul>
              {startupUpdateError ? <p className="startup-update-error">{startupUpdateError}</p> : null}
              <button
                className="startup-update-download"
                type="button"
                disabled={startupUpdateBusy}
                onClick={() => {
                  const api = desktopUpdateApi();
                  if (!api) return;
                  setStartupUpdateBusy(true);
                  setStartupUpdateError("");
                  const action = updateOffer.canInstall ? api.install() : api.openDownload();
                  void action.then((result) => {
                    // The app is quitting when the install goes ahead; any other
                    // outcome hands the button back.
                    if (result && typeof result === "object" && "quitting" in result && result.quitting) return;
                    setStartupUpdateBusy(false);
                    if (result && typeof result === "object" && "deferred" in result && result.deferred) {
                      setStartupUpdateError("Update downloaded. It installs the next time you close Mintr.");
                    }
                  }).catch((error: unknown) => {
                    setStartupUpdateError(error instanceof Error ? error.message : "Mintr couldn't download the update. Nothing was installed.");
                    setStartupUpdateBusy(false);
                  });
                }}
              >
                <Download size={16} strokeWidth={2.4} aria-hidden="true" />
                {startupUpdateBusy ? "Downloading…" : "Download update"}
              </button>
            </section>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <>
      <pre data-codex-projects hidden>
        {JSON.stringify(projectDebugSummary)}
      </pre>
      {newDesignAsk ? (
        <NewDesignChooser
          machines={newDesignAsk}
          onCancel={() => setNewDesignAsk(null)}
          onChoose={(kind) => {
            setNewDesignAsk(null);
            createAndOpenProject(undefined, kind);
          }}
        />
      ) : null}
      {view === "dashboard" ? (
        <Dashboard
          dashboardNotice={dashboardNotice}
          downloadFolder={downloadFolder}
          folders={folders}
          projects={projects}
          query={query}
          dashboardOrder={dashboardOrder}
          rootFolders={rootFolders}
          rootProjects={rootProjects}
          settingsOpen={settingsOpen}
          sortMode={sortMode}
          viewMode={viewMode}
          guideCatalogTick={guideCatalogTick}
          onCloseSettings={() => setSettingsOpen(false)}
          onCreate={startNewDesign}
          onOpenTutorial={(tutorialId) => {
            if (tutorialId === LESSON_PROJECT_ID) openOrCreateIntro();
            else if (isShippedTutorialId(tutorialId)) openBuiltinGuide(tutorialId, isTutorialCompleted(tutorialId));
            else if (tutorialId.startsWith("guide:")) void openSavedGuide(tutorialId, isTutorialCompleted(tutorialId));
          }}
          onCreateFolder={createFolder}
          onDeleteFolder={deleteFolder}
          onDeleteProject={deleteProject}
          onDownloadFolderChange={setDownloadFolder}
          onMoveProjectToFolder={moveProjectToFolder}
          onOpenFromDisk={() => void openFromDisk()}
          onOpenProject={openEditor}
          onOpenSettings={() => setSettingsOpen(true)}
          onRevealProjectFile={(filePath) => void revealPeakcadFile(filePath).catch((error) => {
            setDashboardNotice(error instanceof Error ? error.message : "Could not show that file.");
          })}
          onSaveProjectToDisk={(projectId, forceSaveAs) => void saveProjectToDisk(projectId, forceSaveAs)}
          onQueryChange={setQuery}
          onRenameFolder={renameFolder}
          onRenameProject={renameProject}
          onSetFolderMemberOrder={setFolderMemberOrder}
          onSetFolderSectionOrder={setFolderSectionOrder}
          onSetProjectSectionOrder={setProjectSectionOrder}
          onSetFolderHero={setFolderHero}
          onSortModeChange={setSortMode}
          onViewModeChange={setViewMode}
          updateOffer={updateOffer}
          onDismissUpdate={() => {
            if (updateOffer) writeDismissedUpdateVersion(updateOffer.version);
            setUpdateOffer(null);
          }}
          unlockedFolderIds={unlockedFolderIds}
          folderAccessRequest={folderAccessRequest}
          onUnlockFolderSession={unlockFolderSession}
          onLockFolderSession={lockFolderSession}
          onSetFolderPassword={setFolderPasswordLock}
          onRememberFolderPassword={rememberFolderPassword}
          onApplyOpenedDocument={(opened) => applyOpenedDocument(opened, true)}
          onFolderAccessRequestHandled={() => setFolderAccessRequest(null)}
        />
      ) : null}
      {showOpeningOverlay ? (
        <div className="project-open-overlay" role="status" aria-live="polite">
          <div className="model-loading-card">
            <span className="model-loading-wheel" aria-hidden="true" />
            <strong>Opening project…</strong>
            <span className="model-loading-file">{openingName}</span>
          </div>
        </div>
      ) : null}
      {view === "editor" && editorStarted && canRenderEditor ? (
        <div className="editor-stage active">
          <SketchForgeEditor
            key={activeProjectId ?? "draft"}
            initialShapes={activeProjectShapeEntry?.shapes ?? []}
            initialHistory={activeProjectShapeEntry?.history}
            initialHistoryIndex={activeProjectShapeEntry?.historyIndex}
            initialSnap={activeProject?.snapGrid ?? DEFAULT_SNAP_GRID}
            initialWorkspace={activeProject?.workspace ?? DEFAULT_WORKPLANE_WORKSPACE}
            openingNotice={openingNotice?.projectId === activeProjectId ? openingNotice.text : null}
            onHome={openDashboard}
            onProjectShapesChange={updateProjectShapes}
            onProjectSnapshot={updateProjectSnapshot}
            onProjectWorkspaceChange={updateProjectWorkspace}
            projectId={activeProjectId}
            projectName={activeProject?.name}
            projectRevision={activeProjectShapeEntry?.revision ?? activeProject?.revision ?? 0}
            onProjectNameChange={(name) => {
              if (activeProjectId) {
                renameProject(activeProjectId, name);
              }
            }}
            laserDesigns={laserDesignChoices.filter((design) => design.id !== activeProjectId)}
            onSendToLaser={sendShapesToLaser}
            onLoadDesignForLaser={loadDesignForLaser}
            designRevision={designRevision}
            hasMatchingSavedFile={projectMatchesSavedFile(activeProject)}
            hostNotice={editorHostNotice}
            guidePlayback={activeProjectId ? (builtinGuideSession(activeProjectId) ?? guideSessionFor(activeProjectId)) : null}
            onGuidePublished={(session, path) => {
              rememberGuideSession(session, path);
              setGuideCatalogTick((tick) => tick + 1);
            }}
            onGuideCompleted={() => {
              setGuideCatalogTick((tick) => tick + 1);
            }}
            onRegisterLeaveGuard={registerEditorLeaveGuard}
            onViewportReady={() => {
              setViewportReady(true);
              setOpeningProjectId(null);
              setOpenSpinner(false);
            }}
            onSaveProject={(snapshot) => {
              const entry = projectShapeCacheEntry(
                Date.now(),
                snapshot.shapes,
                snapshot.history,
                snapshot.historyIndex,
              );
              const project = projectsRef.current.find((item) => item.id === snapshot.projectId);
              return saveProjectToDisk(snapshot.projectId, !projectMatchesSavedFile(project), entry, { throwOnError: true });
            }}
            onSaveProjectAs={(snapshot) => {
              const entry = projectShapeCacheEntry(
                Date.now(),
                snapshot.shapes,
                snapshot.history,
                snapshot.historyIndex,
              );
              return saveProjectToDisk(snapshot.projectId, true, entry, { throwOnError: true });
            }}
          />
        </div>
      ) : null}
      {filePasswordPrompt ? (
        <section className="dashboard-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="file-password-title">
          <form
            className="dashboard-confirm-dialog dashboard-rename-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              if (!filePasswordPrompt || filePasswordPrompt.busy) return;
              const password = filePasswordPrompt.value;
              if (!password.trim()) {
                setFilePasswordPrompt({ ...filePasswordPrompt, error: "Enter a password." });
                return;
              }
              setFilePasswordPrompt({ ...filePasswordPrompt, busy: true, error: "" });
              void filePasswordPrompt.accept(password).then((ok) => {
                if (!ok) {
                  setFilePasswordPrompt((current) => (current ? { ...current, busy: false, error: "Wrong password." } : current));
                  return;
                }
                filePasswordPrompt.resolve(password);
                setFilePasswordPrompt(null);
              }).catch(() => {
                setFilePasswordPrompt((current) => (current ? { ...current, busy: false, error: "Wrong password." } : current));
              });
            }}
          >
            <header>
              <strong id="file-password-title">{filePasswordPrompt.title}</strong>
              <button
                type="button"
                aria-label="Cancel password"
                onClick={() => {
                  filePasswordPrompt.resolve(null);
                  setFilePasswordPrompt(null);
                }}
              >
                <X size={18} />
              </button>
            </header>
            <p>{filePasswordPrompt.message}</p>
            <label>
              <span>Password</span>
              <input
                autoFocus
                type="password"
                autoComplete="current-password"
                spellCheck={false}
                value={filePasswordPrompt.value}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFilePasswordPrompt((current) => (current ? { ...current, value, error: "" } : current));
                }}
                aria-label="Mintr file password"
              />
            </label>
            {filePasswordPrompt.error ? <p className="dashboard-dialog-error" role="alert">{filePasswordPrompt.error}</p> : null}
            <div className="dashboard-confirm-actions">
              <button
                className="dashboard-confirm-cancel"
                type="button"
                onClick={() => {
                  filePasswordPrompt.resolve(null);
                  setFilePasswordPrompt(null);
                }}
              >
                Cancel
              </button>
              <button className="dashboard-confirm-delete" type="submit" disabled={filePasswordPrompt.busy}>
                {filePasswordPrompt.busy ? "Checking…" : "Continue"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
