import { useEffect, useState } from "react";

/**
 * Whether Sage is part of Mintr at all: the Sage button, its shortcut, the dashboard bar and the
 * search at the top of Settings. On unless someone switches it off in Settings → Sage.
 * Per viewer; a blocked store simply keeps Sage on.
 */
const SAGE_ENABLED_KEY = "mintr:sage-enabled";
const SAGE_ENABLED_EVENT = "mintr:sage-enabled-changed";

export function readSageEnabled() {
  try {
    return window.localStorage.getItem(SAGE_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeSageEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(SAGE_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // Not remembered this time; the change still applies until Mintr closes.
  }
  window.dispatchEvent(new CustomEvent(SAGE_ENABLED_EVENT, { detail: enabled }));
}

/** Follows the setting live, so every open part of Mintr shows or hides Sage together. */
export function useSageEnabled() {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const sync = (event?: Event) => {
      setEnabled(event instanceof CustomEvent && typeof event.detail === "boolean" ? event.detail : readSageEnabled());
    };
    sync();
    window.addEventListener(SAGE_ENABLED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SAGE_ENABLED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return enabled;
}
