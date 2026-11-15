import type { DesktopUpdateOffer } from "@/components/home/dashboardTypes";

export const UPDATE_DISMISS_KEY = "peakcad-update-dismissed";

export function readDismissedUpdateVersion() {
  try {
    return window.localStorage.getItem(UPDATE_DISMISS_KEY);
  } catch {
    return null;
  }
}

export function writeDismissedUpdateVersion(version: string) {
  try {
    window.localStorage.setItem(UPDATE_DISMISS_KEY, version);
  } catch {
    // Storage full or blocked: the offer simply shows again next launch.
  }
}

export function desktopUpdateApi() {
  if (typeof window === "undefined") return null;
  return (window as Window & {
    peakcadUpdate?: {
      check: () => Promise<DesktopUpdateOffer | null>;
      openDownload: () => Promise<unknown>;
      install: () => Promise<unknown>;
    };
  }).peakcadUpdate ?? null;
}
