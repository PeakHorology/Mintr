import {
  MINTR_FILE_EXTENSION,
  MINTR_GUIDE_EXTENSION,
  PEAKCAD_FILE_EXTENSION,
  guideFilename,
  peakcadFilename,
  serializePeakcadDocument,
  parsePeakcadDocument,
  type PeakcadDocument,
} from "@/lib/peakcadDocument";
import { downloadTextFile } from "@/lib/downloadFile";

export type PeakcadFileApi = {
  isDesktop?: boolean;
  defaultDir?: () => Promise<string | null>;
  open?: () => Promise<{ path: string; text: string } | null>;
  read?: (filePath: string) => Promise<{ path: string; text: string }>;
  write?: (payload: { path: string; text: string }) => Promise<{ path: string }>;
  saveAs?: (payload: { text: string; defaultName: string; kind?: "guide" }) => Promise<{ path: string } | null>;
  writeNew?: (payload: { text: string; defaultName: string }) => Promise<{ path: string } | null>;
  resolveName?: (defaultName: string) => Promise<{ path: string; text: string } | null>;
  transitionLegacy?: (extraPaths: string[]) => Promise<ProjectFileTransition>;
  pendingMoves?: () => Promise<ProjectFileRename[]>;
  reveal?: (filePath: string) => Promise<void>;
  onOpenPath?: (listener: (filePath: string) => void) => () => void;
  onMenu?: (listener: (action: PeakcadMenuAction) => void) => () => void;
  onSaveBeforeClose?: (handler: () => Promise<boolean>) => () => void;
  onFlushBeforeClose?: (handler: () => Promise<boolean>) => () => void;
};

export type PeakcadMenuAction = "new" | "open" | "save" | "save-as" | "import" | "export" | "settings";

export type ProjectFileRename = { from: string; to: string };

export type ProjectFileTransition = {
  renamed: ProjectFileRename[];
  already: ProjectFileRename[];
  failed: { from: string; message: string }[];
};

const PROJECT_FILES_TRANSITIONED_EVENT = "mintr:project-files-transitioned";
let knownLegacyProjectPaths: string[] = [];

/** Library paths outside the Mintr folder that a settings transition should rename too. */
export function setKnownLegacyProjectPaths(paths: string[]) {
  knownLegacyProjectPaths = paths.filter((filePath) => {
    const lower = filePath.toLowerCase();
    return lower.endsWith(".peakcad") || lower.endsWith(".mintr");
  });
}

export type OpenedPeakcadFile = {
  document: PeakcadDocument;
  path: string | null;
};

function fileApi(): PeakcadFileApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { peakcadFile?: PeakcadFileApi }).peakcadFile;
}

export function hasDesktopProjectFiles() {
  return Boolean(fileApi()?.isDesktop && fileApi()?.open && fileApi()?.write);
}

const FRIENDLY_FS_ERRORS: Array<[RegExp, string]> = [
  [/\bENOENT\b/, "That folder is no longer there. Pick a new place to save with Save As."],
  [/\bEBUSY\b|\bEPERM\b|\bEACCES\b/, "The file is locked or read-only (a sync tool or another program may have it open). Close it and try again, or use Save As."],
  [/\bENOSPC\b/, "The drive is full. Free some space or save somewhere else."],
  [/\bEROFS\b/, "That drive is read-only. Save somewhere else."],
  [/\bENAMETOOLONG\b/, "That file name or folder path is too long for Windows."],
];

/**
 * Electron wraps renderer-facing rejections as
 * "Error invoking remote method 'peakcad:file-write': Error: <message>", and
 * Node file errors arrive as "ENOENT: no such file or directory, open 'E:\…'".
 * People should see the message, not the plumbing.
 */
export function friendlyProjectFileError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  let message = raw.replace(/^Error invoking remote method '[^']*':\s*/i, "").replace(/^Error:\s*/i, "").trim();
  for (const [pattern, text] of FRIENDLY_FS_ERRORS) {
    if (pattern.test(message)) {
      message = text;
      break;
    }
  }
  return new Error(message || "Could not access the project file.");
}

async function desktopCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw friendlyProjectFileError(error);
  }
}

function pickBrowserFile() {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `${MINTR_FILE_EXTENSION},${MINTR_GUIDE_EXTENSION},${PEAKCAD_FILE_EXTENSION},application/json`;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

export async function openPeakcadFileText(): Promise<{ text: string; path: string | null } | null> {
  const desktop = fileApi();
  if (desktop?.open) {
    const result = await desktopCall(() => desktop.open!());
    if (!result) return null;
    return { text: result.text, path: result.path };
  }
  const file = await pickBrowserFile();
  if (!file) return null;
  return { text: await file.text(), path: null };
}

export async function openPeakcadFile(): Promise<OpenedPeakcadFile | null> {
  const opened = await openPeakcadFileText();
  if (!opened) return null;
  return { document: parsePeakcadDocument(opened.text), path: opened.path };
}

export async function readPeakcadPathText(filePath: string): Promise<{ text: string; path: string }> {
  const desktop = fileApi();
  if (!desktop?.read) {
    throw new Error("Opening a file path is only available in the Mintr desktop app.");
  }
  const result = await desktopCall(() => desktop.read!(filePath));
  return { text: result.text, path: result.path };
}

export async function readPeakcadPath(filePath: string): Promise<OpenedPeakcadFile> {
  const result = await readPeakcadPathText(filePath);
  return { document: parsePeakcadDocument(result.text), path: result.path };
}

export async function writePeakcadPath(filePath: string, document: PeakcadDocument) {
  await writePeakcadText(filePath, serializePeakcadDocument(document));
}

/** Write already-serialized project text (see serializePeakcadDocument). */
export async function writePeakcadText(filePath: string, text: string) {
  const desktop = fileApi();
  if (!desktop?.write) {
    throw new Error("Saving to a file path is only available in the Mintr desktop app.");
  }
  await desktopCall(() => desktop.write!({ path: filePath, text }));
}

export async function savePeakcadAs(document: PeakcadDocument, suggestedName: string): Promise<string | null> {
  return savePeakcadTextAs(serializePeakcadDocument(document), suggestedName);
}

export async function savePeakcadTextAs(text: string, suggestedName: string): Promise<string | null> {
  const defaultName = peakcadFilename(suggestedName);
  const desktop = fileApi();
  if (desktop?.saveAs) {
    const result = await desktopCall(() => desktop.saveAs!({ text, defaultName }));
    return result?.path ?? null;
  }
  await downloadTextFile(defaultName, text, "application/json");
  return null;
}

export async function saveGuideTextAs(text: string, suggestedName: string): Promise<string | null> {
  const defaultName = guideFilename(suggestedName);
  const desktop = fileApi();
  if (desktop?.saveAs) {
    const result = await desktopCall(() => desktop.saveAs!({ text, defaultName, kind: "guide" }));
    return result?.path ?? null;
  }
  await downloadTextFile(defaultName, text, "application/json");
  return null;
}

export async function resolveDesktopPeakcadTextByName(suggestedName: string): Promise<{ path: string; text: string } | null> {
  const desktop = fileApi();
  if (!desktop?.resolveName) return null;
  const result = await desktopCall(() => desktop.resolveName!(peakcadFilename(suggestedName)));
  if (!result) return null;
  return { path: result.path, text: result.text };
}

export async function resolveDesktopPeakcadByName(suggestedName: string): Promise<OpenedPeakcadFile | null> {
  const result = await resolveDesktopPeakcadTextByName(suggestedName);
  if (!result) return null;
  return { document: parsePeakcadDocument(result.text), path: result.path };
}

export async function writeNewDesktopPeakcad(document: PeakcadDocument, suggestedName: string): Promise<string | null> {
  const desktop = fileApi();
  if (!desktop?.writeNew) return null;
  const result = await desktop.writeNew({
    text: serializePeakcadDocument(document),
    defaultName: peakcadFilename(suggestedName),
  });
  return result?.path ?? null;
}

export async function readPendingProjectMoves(): Promise<ProjectFileRename[]> {
  const desktop = fileApi();
  if (!desktop?.pendingMoves) return [];
  const moves = await desktop.pendingMoves();
  return Array.isArray(moves) ? moves : [];
}

export async function transitionDesktopPeakcadFiles(): Promise<ProjectFileTransition> {
  const desktop = fileApi();
  if (!desktop?.transitionLegacy) {
    throw new Error("Restart Mintr to change .peakcad files to .mintr.");
  }
  const result = await desktop.transitionLegacy(knownLegacyProjectPaths);
  if (result.renamed.length > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ProjectFileRename[]>(PROJECT_FILES_TRANSITIONED_EVENT, { detail: result.renamed }));
  }
  return result;
}

export function subscribeProjectFilesTransitioned(listener: (renames: ProjectFileRename[]) => void) {
  if (typeof window === "undefined") return () => undefined;
  const wrapped = (event: Event) => {
    const detail = (event as CustomEvent<ProjectFileRename[]>).detail;
    if (Array.isArray(detail)) listener(detail);
  };
  window.addEventListener(PROJECT_FILES_TRANSITIONED_EVENT, wrapped);
  return () => window.removeEventListener(PROJECT_FILES_TRANSITIONED_EVENT, wrapped);
}

export async function revealPeakcadFile(filePath: string) {
  const desktop = fileApi();
  if (!desktop?.reveal) return;
  await desktop.reveal(filePath);
}

export function subscribePeakcadOpenPath(listener: (filePath: string) => void) {
  return fileApi()?.onOpenPath?.(listener);
}

export function subscribePeakcadMenu(listener: (action: PeakcadMenuAction) => void) {
  return fileApi()?.onMenu?.(listener);
}

/** Desktop window close chose Save: the window closes only if `handler` resolves true. */
export function subscribePeakcadSaveBeforeClose(handler: () => Promise<boolean>) {
  return fileApi()?.onSaveBeforeClose?.(handler);
}

/** Desktop window is about to close: flush debounced edits to the store and wait for the write. */
export function subscribePeakcadFlushBeforeClose(handler: () => Promise<boolean>) {
  return fileApi()?.onFlushBeforeClose?.(handler);
}
