/** App-wide UI theme (chrome + dashboard). Stored in localStorage. */

export const UI_THEME_STORAGE_KEY = "peakcad:uiTheme";
/** Legacy key from an earlier PeakCAD / SketchForge theme path. */
const LEGACY_THEME_STORAGE_KEY = "sketchForge.theme";
export const UI_THEME_CHANGED_EVENT = "peakcad:ui-theme-changed";

export type UiTheme = "light" | "dark";

export const DEFAULT_UI_THEME: UiTheme = "light";
export const DEFAULT_LIGHT_VIEWPORT_BACKGROUND = "#f8fbfc";
export const DEFAULT_DARK_VIEWPORT_BACKGROUND = "#141a18";
const STOCK_LIGHT_VIEWPORT_BACKGROUNDS = new Set(["#f4f1ee", "#f8fbfc"]);

export function isUiTheme(value: unknown): value is UiTheme {
  return value === "light" || value === "dark";
}

export function loadUiTheme(): UiTheme {
  if (typeof window === "undefined") return DEFAULT_UI_THEME;
  try {
    const stored = window.localStorage.getItem(UI_THEME_STORAGE_KEY)
      ?? window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (isUiTheme(stored)) return stored;
  } catch {
    // Storage unavailable — keep light.
  }
  return DEFAULT_UI_THEME;
}

export function saveUiTheme(theme: UiTheme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, theme);
    window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  } catch {
    // Theme still applies in-memory for this session.
  }
}

export function applyUiTheme(theme: UiTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") {
    root.dataset.theme = "dark";
  } else {
    delete root.dataset.theme;
  }
  root.style.colorScheme = theme;
  const desktop = (window as Window & { peakcadWindow?: { setTheme?: (theme: UiTheme) => void } }).peakcadWindow;
  desktop?.setTheme?.(theme);
}

export function setUiTheme(theme: UiTheme) {
  applyUiTheme(theme);
  saveUiTheme(theme);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(UI_THEME_CHANGED_EVENT, { detail: { theme } }));
  }
}

export type ThemeTransitionOrigin = { x: number; y: number };
export type ThemeTransitionKind = "skip" | "instant" | "view-transition";

export function themeTransitionKind(
  current: UiTheme,
  next: UiTheme,
  options: { reducedMotion: boolean; canViewTransition: boolean },
): ThemeTransitionKind {
  if (current === next) return "skip";
  if (options.reducedMotion || !options.canViewTransition) return "instant";
  return "view-transition";
}

export type ThemeWipeDirection = "expand" | "contract";

/**
 * Dark grows out of the control that chose it; light is uncovered as the dark
 * circle shrinks back into the control. Mirrored motions, same origin.
 */
export function themeWipeDirection(next: UiTheme): ThemeWipeDirection {
  return next === "dark" ? "expand" : "contract";
}

/** Circle that just covers the window when it expands from the control. */
export function themeRevealRadius(origin: ThemeTransitionOrigin, width: number, height: number) {
  return Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y));
}

function canStartViewTransition(target: Document): target is Document & {
  startViewTransition: (update: () => void) => { finished: Promise<void> };
} {
  return typeof (target as Document & { startViewTransition?: unknown }).startViewTransition === "function";
}

function prefersReducedThemeMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Apply the theme with an Apple-style circle wipe from the control that chose it. */
export function setUiThemeWithTransition(theme: UiTheme, origin?: ThemeTransitionOrigin) {
  const kind = themeTransitionKind(readAppliedUiTheme(), theme, {
    reducedMotion: prefersReducedThemeMotion(),
    canViewTransition: typeof document !== "undefined" && canStartViewTransition(document),
  });
  if (kind === "skip") {
    saveUiTheme(theme);
    return;
  }
  if (kind === "instant" || typeof document === "undefined" || !canStartViewTransition(document)) {
    setUiTheme(theme);
    return;
  }

  const root = document.documentElement;
  if (origin && typeof window !== "undefined") {
    root.style.setProperty("--theme-origin-x", `${origin.x}px`);
    root.style.setProperty("--theme-origin-y", `${origin.y}px`);
    root.style.setProperty("--theme-spread", `${Math.ceil(themeRevealRadius(origin, window.innerWidth, window.innerHeight))}px`);
  }
  root.classList.add("is-theme-switching");
  root.dataset.themeWipe = themeWipeDirection(theme);
  const transition = document.startViewTransition(() => {
    setUiTheme(theme);
  });
  void transition.finished.finally(() => {
    root.classList.remove("is-theme-switching");
    delete root.dataset.themeWipe;
    root.style.removeProperty("--theme-origin-x");
    root.style.removeProperty("--theme-origin-y");
    root.style.removeProperty("--theme-spread");
  });
}

export function readAppliedUiTheme(): UiTheme {
  if (typeof document === "undefined") return DEFAULT_UI_THEME;
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Use a dark clear color when the project still has the stock light background. */
export function resolveViewportBackground(storedBackground: string, theme: UiTheme = readAppliedUiTheme()): string {
  if (theme === "dark" && (!storedBackground || STOCK_LIGHT_VIEWPORT_BACKGROUNDS.has(storedBackground.toLowerCase()))) {
    return DEFAULT_DARK_VIEWPORT_BACKGROUND;
  }
  return storedBackground || DEFAULT_LIGHT_VIEWPORT_BACKGROUND;
}

/** Sheet colour for the 3D workplane and the sketch plane (`--sketch-plane`). */
export function resolveWorkplaneBaseColor(theme: UiTheme = readAppliedUiTheme()): string {
  return theme === "dark" ? "#243640" : "#ddf8ff";
}
