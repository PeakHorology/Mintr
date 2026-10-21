"use client";

import { useEffect, useState } from "react";

const DEFAULT_EXIT_MS = 140;

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function exitDuration(ms: number) {
  return prefersReducedMotion() ? 0 : ms;
}

/** Keep chrome mounted through its exit motion so menus and sheets can close the way they opened. */
export function useChromePresence(open: boolean, exitMs = DEFAULT_EXIT_MS) {
  const [state, setState] = useState<"closed" | "open" | "closing">(open ? "open" : "closed");

  useEffect(() => {
    if (open) {
      setState("open");
      return;
    }
    setState((current) => (current === "closed" ? "closed" : "closing"));
  }, [open]);

  useEffect(() => {
    if (state !== "closing") return;
    const timer = window.setTimeout(() => setState("closed"), exitDuration(exitMs));
    return () => window.clearTimeout(timer);
  }, [exitMs, state]);

  return { mounted: state !== "closed", closing: state === "closing" };
}
