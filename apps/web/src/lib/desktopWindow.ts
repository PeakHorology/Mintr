export type DesktopWindowApi = {
  setTheme: (theme: "light" | "dark") => void;
  toggleFullScreen: () => Promise<boolean>;
  isFullScreen: () => Promise<boolean>;
  onFullScreen: (listener: (full: boolean) => void) => () => void;
};

export function desktopWindow(): DesktopWindowApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as Window & { peakcadWindow?: DesktopWindowApi }).peakcadWindow;
  return api?.toggleFullScreen ? api : null;
}

/** Cover the screen. The desktop app uses the window; a browser uses the page. */
export async function toggleAppFullscreen(): Promise<boolean> {
  const desktop = desktopWindow();
  if (desktop) return desktop.toggleFullScreen();
  if (typeof document === "undefined") return false;
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return false;
  }
  await document.documentElement.requestFullscreen();
  return true;
}

export function subscribeAppFullscreen(listener: (full: boolean) => void): () => void {
  const desktop = desktopWindow();
  if (desktop) {
    void desktop.isFullScreen().then(listener).catch(() => listener(false));
    return desktop.onFullScreen(listener);
  }
  if (typeof document === "undefined") return () => {};
  const onChange = () => listener(Boolean(document.fullscreenElement));
  document.addEventListener("fullscreenchange", onChange);
  onChange();
  return () => document.removeEventListener("fullscreenchange", onChange);
}
