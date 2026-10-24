"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadUiTheme,
  readAppliedUiTheme,
  setUiThemeWithTransition,
  UI_THEME_CHANGED_EVENT,
  type UiTheme,
} from "@/lib/uiTheme";

/** Center of the whole pill, so both wipes start in the same place. */
function originOfPill(pill: HTMLElement) {
  const rect = pill.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function StartupThemeTabs() {
  const [theme, setTheme] = useState<UiTheme>(() => loadUiTheme());
  const pillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setTheme(readAppliedUiTheme());
    window.addEventListener(UI_THEME_CHANGED_EVENT, sync);
    return () => window.removeEventListener(UI_THEME_CHANGED_EVENT, sync);
  }, []);

  const choose = (next: UiTheme) => {
    if (next === theme) return;
    setTheme(next);
    const pill = pillRef.current;
    setUiThemeWithTransition(next, pill ? originOfPill(pill) : undefined);
  };

  return (
    <div ref={pillRef} className="startup-theme-tabs" data-mode={theme} role="tablist" aria-label="Appearance">
      <div className="startup-theme-tabs-pill" aria-hidden="true" />
      <button
        className={theme === "light" ? "active" : ""}
        type="button"
        role="tab"
        aria-selected={theme === "light"}
        onClick={() => choose("light")}
      >
        Light
      </button>
      <button
        className={theme === "dark" ? "active" : ""}
        type="button"
        role="tab"
        aria-selected={theme === "dark"}
        onClick={() => choose("dark")}
      >
        Dark
      </button>
    </div>
  );
}
