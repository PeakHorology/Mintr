"use client";

import { useLayoutEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { historyStepLabel, type EditorHistoryEntry } from "@/lib/editorHistory";

type Anchor = { top: number; left: number; caret: number; width: number };

function historyAnchor(): Anchor {
  const button = document.querySelector<HTMLElement>('[data-toolbar-tool="History"]');
  const margin = 12;
  const width = Math.min(460, window.innerWidth - margin * 2);
  if (!button) {
    return { top: 68, left: margin, caret: 48, width };
  }
  const rect = button.getBoundingClientRect();
  const center = rect.left + rect.width / 2;
  let left = center - width / 2;
  left = Math.min(Math.max(margin, left), window.innerWidth - margin - width);
  return {
    top: rect.bottom + 8,
    left,
    caret: center - left,
    width,
  };
}

export function HistoryPanel({
  entries,
  index,
  liveIndex,
  onIndexChange,
  onRestore,
  onClose,
}: {
  entries: EditorHistoryEntry[];
  index: number;
  liveIndex: number;
  onIndexChange: (index: number) => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const max = Math.max(0, entries.length - 1);
  const current = Math.min(Math.max(0, index), max);
  const distance = current - liveIndex;
  const relation = distance === 0
    ? "Current"
    : distance === -1
      ? "1 step before"
      : distance < 0
        ? `${-distance} steps before`
        : distance === 1
          ? "1 step ahead"
          : `${distance} steps ahead`;
  const viewing = entries[current];
  const fill = max === 0 ? 100 : (current / max) * 100;

  useLayoutEffect(() => {
    const place = () => setAnchor(historyAnchor());
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  return (
    <aside
      className="history-scrub"
      aria-label="History"
      style={anchor ? {
        top: anchor.top,
        left: anchor.left,
        width: anchor.width,
        ["--history-caret" as string]: `${anchor.caret}px`,
        ["--history-fill" as string]: `${fill}%`,
      } : { visibility: "hidden" }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <button
        type="button"
        aria-label="Earlier step"
        disabled={current <= 0}
        onClick={() => onIndexChange(current - 1)}
      >
        <ChevronLeft size={18} />
      </button>
      <label className="history-scrub-slider">
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={current}
          aria-valuetext={viewing ? `${historyStepLabel(viewing, current)}, ${relation}` : relation}
          onChange={(event) => onIndexChange(Number(event.currentTarget.value))}
        />
      </label>
      <button
        type="button"
        aria-label="Later step"
        disabled={current >= max}
        onClick={() => onIndexChange(current + 1)}
      >
        <ChevronRight size={18} />
      </button>
      <p className="history-scrub-meta">
        <strong>{current + 1} of {entries.length}</strong>
        <span>{relation}</span>
      </p>
      <button type="button" className="history-scrub-restore" disabled={current === liveIndex} onClick={onRestore}>
        Restore
      </button>
      <button type="button" className="history-scrub-close" aria-label="Close history" onClick={onClose}>
        <X size={16} />
      </button>
    </aside>
  );
}
