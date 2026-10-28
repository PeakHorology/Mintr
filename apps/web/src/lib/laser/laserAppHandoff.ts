import type { CutFileStyle } from "@/lib/laserMachine";

/** A laser program found on this computer. Keep in sync with electron/slicerCatalog.cjs */
export type LaserApp = { id: "xtool" | "lightburn"; name: string; path: string };

type LaserBridge = {
  detect?: () => Promise<LaserApp[]>;
  open?: (payload: { filename: string; base64: string; exePath: string }) => Promise<{ path: string; name: string }>;
};

function bridge(): LaserBridge | null {
  if (typeof window === "undefined") return null;
  const desktop = (window as Window & { peakcadLaser?: LaserBridge }).peakcadLaser;
  return desktop?.detect ? desktop : null;
}

/** Laser programs on this computer: from the desktop app, or the dev server when Mintr runs in a browser. */
export async function detectLaserApps(): Promise<LaserApp[]> {
  try {
    const desktop = bridge();
    if (desktop?.detect) return await desktop.detect();
    // An older desktop app has the slicer bridge but not this one; it has no dev server to ask either.
    if ((window as Window & { peakcadSlicer?: unknown }).peakcadSlicer) return [];
    const response = await fetch("/api/slicer?kind=laser");
    if (!response.ok) return [];
    const payload = (await response.json()) as { slicers?: LaserApp[] };
    return Array.isArray(payload.slicers) ? payload.slicers : [];
  } catch {
    return [];
  }
}

const APP_FOR_STYLE: Partial<Record<CutFileStyle, LaserApp["id"]>> = { xtool: "xtool", lightburn: "lightburn" };

/** The program a cut file opens in: the one its style is for, else whichever is here. Glowforge is a website, so none. */
export function laserAppFor(style: CutFileStyle, apps: readonly LaserApp[]): LaserApp | null {
  const wanted = APP_FOR_STYLE[style];
  if (!wanted) return null;
  return apps.find((app) => app.id === wanted) ?? apps[0] ?? null;
}

function textToBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Saves the cut file to Downloads and opens it in the laser program. */
export async function openInLaserApp(app: LaserApp, filename: string, svg: string): Promise<{ path: string; name: string }> {
  const payload = { filename, base64: textToBase64(svg), exePath: app.path };
  const desktop = bridge();
  if (desktop?.open) return desktop.open(payload);
  const response = await fetch("/api/slicer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, kind: "laser" }),
  });
  const body = (await response.json().catch(() => null)) as { error?: string; path?: string; name?: string } | null;
  if (!response.ok || !body?.path || !body.name) throw new Error(body?.error ?? `Could not open ${app.name}`);
  return { path: body.path, name: body.name };
}
