export type SlicerId = "orca" | "bambu" | "prusa" | "superslicer" | "cura" | "formlabs";
export type SlicerFormat = "3mf" | "stl";

export type DetectedSlicer = {
  id: SlicerId;
  name: string;
  path: string;
  format: SlicerFormat;
};

export type SlicerPreference =
  | { mode: "auto" }
  | { mode: "off" }
  | { mode: "app"; id: SlicerId; name: string; path: string; format: SlicerFormat };

export type SlicerChoice = {
  launch: boolean;
  format: SlicerFormat;
  name: string;
  path: string;
  label: string;
  caption: string;
};

/** Keep in sync with electron/slicerCatalog.cjs */
const BY_EXE: Record<string, { id: SlicerId; name: string; format: SlicerFormat }> = {
  "orca-slicer.exe": { id: "orca", name: "OrcaSlicer", format: "3mf" },
  "bambu-studio.exe": { id: "bambu", name: "Bambu Studio", format: "3mf" },
  "prusa-slicer.exe": { id: "prusa", name: "PrusaSlicer", format: "3mf" },
  "superslicer.exe": { id: "superslicer", name: "SuperSlicer", format: "3mf" },
  "ultimaker-cura.exe": { id: "cura", name: "UltiMaker Cura", format: "stl" },
  "cura.exe": { id: "cura", name: "UltiMaker Cura", format: "stl" },
  "preform.exe": { id: "formlabs", name: "Formlabs PreForm", format: "stl" },
};

export const SLICER_PREFERENCE_KEY = "peakcad:slicer";
export const SLICER_CHANGED_EVENT = "peakcad:slicer-changed";

export function slicerFromExeName(fileName: string) {
  const base = fileName.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  return BY_EXE[base] ?? null;
}

export function loadSlicerPreference(): SlicerPreference {
  if (typeof window === "undefined") return { mode: "auto" };
  try {
    const raw = window.localStorage.getItem(SLICER_PREFERENCE_KEY);
    if (!raw) return { mode: "auto" };
    const parsed = JSON.parse(raw) as Partial<SlicerPreference>;
    if (parsed.mode === "off" || parsed.mode === "auto") return { mode: parsed.mode };
    if (
      parsed.mode === "app"
      && parsed.id
      && parsed.name
      && parsed.path
      && (parsed.format === "3mf" || parsed.format === "stl")
    ) {
      return { mode: "app", id: parsed.id, name: parsed.name, path: parsed.path, format: parsed.format };
    }
  } catch {
    // A bad saved value falls back to the first slicer found.
  }
  return { mode: "auto" };
}

export function saveSlicerPreference(preference: SlicerPreference) {
  window.localStorage.setItem(SLICER_PREFERENCE_KEY, JSON.stringify(preference));
  window.dispatchEvent(new Event(SLICER_CHANGED_EVENT));
}

export function preferenceFromPath(filePath: string): SlicerPreference | null {
  const known = slicerFromExeName(filePath);
  if (!known) return null;
  return { mode: "app", id: known.id, name: known.name, path: filePath.trim(), format: known.format };
}

function captionFor(choice: { launch: boolean; format: SlicerFormat; name: string }) {
  if (!choice.launch) {
    return "No slicer is selected. This downloads a 3MF. Pick a slicer below, or set one in Settings → Printing.";
  }
  if (choice.format === "stl") {
    return `Writes an STL and opens it in ${choice.name}, so it is treated as geometry rather than a slicer project.`;
  }
  return `Writes a 3MF and opens it in ${choice.name}. The printer, filament, and supports stay in the slicer.`;
}

export function resolveSlicerChoice(preference: SlicerPreference, detected: DetectedSlicer[]): SlicerChoice {
  if (preference.mode === "off") {
    return {
      launch: false,
      format: "3mf",
      name: "",
      path: "",
      label: "Download 3MF",
      caption: captionFor({ launch: false, format: "3mf", name: "" }),
    };
  }
  const picked = preference.mode === "app"
    ? detected.find((slicer) => slicer.path === preference.path) ?? {
      id: preference.id,
      name: preference.name,
      path: preference.path,
      format: preference.format,
    }
    : detected[0];
  if (!picked) {
    return {
      launch: false,
      format: "3mf",
      name: "",
      path: "",
      label: "Download 3MF",
      caption: captionFor({ launch: false, format: "3mf", name: "" }),
    };
  }
  return {
    launch: true,
    format: picked.format,
    name: picked.name,
    path: picked.path,
    label: `Open in ${picked.name}`,
    caption: captionFor({ launch: true, format: picked.format, name: picked.name }),
  };
}

type SlicerBridge = {
  detect?: () => Promise<DetectedSlicer[]>;
  open?: (payload: { filename: string; base64: string; exePath: string; folder?: string }) => Promise<{ path: string; name: string }>;
  choose?: () => Promise<DetectedSlicer | null>;
};

function bridge(): SlicerBridge | null {
  if (typeof window === "undefined") return null;
  const desktop = (window as Window & { peakcadSlicer?: SlicerBridge }).peakcadSlicer;
  return desktop?.detect ? desktop : null;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function detectInstalledSlicers(): Promise<DetectedSlicer[]> {
  const desktop = bridge();
  try {
    if (desktop?.detect) return await desktop.detect();
    const response = await fetch("/api/slicer");
    if (!response.ok) return [];
    const payload = (await response.json()) as { slicers?: DetectedSlicer[] };
    return Array.isArray(payload.slicers) ? payload.slicers : [];
  } catch {
    return [];
  }
}

export async function chooseSlicerProgram(): Promise<DetectedSlicer | null> {
  const desktop = bridge();
  if (!desktop?.choose) return null;
  return desktop.choose();
}

export function canChooseSlicerProgram() {
  return Boolean(bridge()?.choose);
}

export async function launchInstalledSlicer(input: {
  filename: string;
  bytes: Uint8Array;
  exePath: string;
  folder?: string;
}): Promise<{ path: string; name: string }> {
  const payload = {
    filename: input.filename,
    base64: bytesToBase64(input.bytes),
    exePath: input.exePath,
    folder: input.folder ?? "",
  };
  const desktop = bridge();
  if (desktop?.open) return desktop.open(payload);
  const response = await fetch("/api/slicer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as { error?: string; path?: string; name?: string } | null;
  if (!response.ok || !body?.path || !body.name) {
    throw new Error(body?.error ?? "Could not open the slicer");
  }
  return { path: body.path, name: body.name };
}
