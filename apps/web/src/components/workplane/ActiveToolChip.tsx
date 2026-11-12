"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Where the chip goes so a tool's own panel does not cover it: its usual place, or just below the
 * open panel when the two would meet. Null keeps the place set in the stylesheet.
 */
function chipTopClearOfPanel(chip: HTMLElement, usualTop: number | null): number | null {
  const parent = chip.offsetParent as HTMLElement | null;
  if (!parent) return null;
  const panel = document.querySelector<HTMLElement>(".toolbar-flow:not(.is-closing)");
  if (!panel) return null;
  const parentBox = parent.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  const chipBox = chip.getBoundingClientRect();
  const top = parentBox.top + (usualTop ?? chipBox.top - parentBox.top);
  const meets = box.left < chipBox.right && box.right > chipBox.left && box.top < top + chipBox.height && box.bottom > top;
  return meets ? Math.round(box.bottom - parentBox.top + 10) : null;
}

/** Floating chip that shows the active tool and how to exit it. */
export function ActiveToolChip({
  label,
  hint = "Esc to cancel",
  visible,
}: {
  label: string;
  hint?: string;
  visible: boolean;
}) {
  const chipRef = useRef<HTMLDivElement | null>(null);
  const usualTopRef = useRef<number | null>(null);
  const [top, setTop] = useState<number | null>(null);
  const shown = visible && Boolean(label);

  useLayoutEffect(() => {
    if (!shown) {
      usualTopRef.current = null;
      setTop(null);
      return;
    }
    const place = () => {
      const chip = chipRef.current;
      if (!chip) return;
      // Measure the stylesheet place once, while the chip still sits there.
      if (usualTopRef.current === null && chip.offsetParent) {
        usualTopRef.current = chip.getBoundingClientRect().top - (chip.offsetParent as HTMLElement).getBoundingClientRect().top;
      }
      const next = chipTopClearOfPanel(chip, usualTopRef.current);
      setTop((current) => (current === next ? current : next));
    };
    place();
    // Panels open, close and move without telling the chip, so it checks a few times a second.
    const timer = window.setInterval(place, 300);
    window.addEventListener("resize", place);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", place);
    };
  }, [shown]);

  if (!shown) {
    return null;
  }

  return (
    <div ref={chipRef} className="active-tool-chip" role="status" aria-live="polite" style={top === null ? undefined : { top }}>
      <strong>{label}</strong>
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}
