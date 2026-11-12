"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";

type Anchor = { top: number; left: number; caret: number; width: number };

const TOOL_SECTION: Record<string, string> = {
  History: "History",
  Fillet: "Modify",
  Chamfer: "Modify",
  Hollow: "Modify",
  "Pad/Pocket": "Modify",
  "Push Pull": "Modify",
  Split: "Modify",
  Texture: "Modify",
  Align: "Arrange",
  Snap: "Arrange",
  "Lay flat": "Arrange",
  Mirror: "Arrange",
  "Circular pattern": "Arrange",
  "Linear pattern": "Arrange",
};

function anchorElement(tool: string) {
  const direct = document.querySelector<HTMLElement>(`[data-toolbar-tool="${tool}"]`);
  if (direct) return direct;
  const sectionName = TOOL_SECTION[tool];
  const section = sectionName
    ? document.querySelector<HTMLElement>(`.toolbar-section[aria-label="${sectionName}"]`)
    : null;
  const more = section?.parentElement?.querySelector<HTMLElement>('[aria-label="More tools"]');
  if (more || section) return more ?? section;
  // The whole section went into "More tools" on a narrow screen.
  return document.querySelector<HTMLElement>('.editor-top-bar-tools--modify button[aria-label="More tools"]');
}
function toolbarAnchor(tool: string, width: number): Anchor {
  const margin = 12;
  const panelWidth = Math.min(width, window.innerWidth - margin * 2);
  const button = anchorElement(tool);
  if (!button) {
    return { top: 68, left: margin, caret: 28, width: panelWidth };
  }
  const rect = button.getBoundingClientRect();
  const center = rect.left + rect.width / 2;
  let left = center - 36;
  left = Math.min(Math.max(margin, left), window.innerWidth - margin - panelWidth);
  // Keep clear of the open shape inspector (it moves left when the Parts tree is open),
  // so the tool card never sits half over it. Only when there is room beside it.
  const inspector = document.querySelector<HTMLElement>(".shape-inspector");
  const box = inspector?.getBoundingClientRect();
  if (box && box.width > 0 && left + panelWidth > box.left && left < box.right) {
    const beside = box.left - margin - panelWidth;
    if (beside >= margin) left = beside;
  }
  // Moved under the Geometry / Sketch switch: drop below it so the card's title stays visible.
  let top = rect.bottom + 8;
  const notch = document.querySelector<HTMLElement>(".editor-mode-notch")?.getBoundingClientRect();
  if (notch && notch.width > 0 && left < notch.right && left + panelWidth > notch.left && top < notch.bottom) {
    top = notch.bottom + 8;
  }
  return {
    top,
    left,
    // A card moved down or aside no longer points at its button.
    caret: top === rect.bottom + 8 ? center - left : -1,
    width: panelWidth,
  };
}

function sameAnchor(a: Anchor | null, b: Anchor) {
  return Boolean(a) && a!.top === b.top && a!.left === b.left && a!.caret === b.caret && a!.width === b.width;
}

/** A tool menu that opens under its toolbar button, the same way History does. */
export function ToolbarFlow({
  tool,
  label,
  children,
  width = 340,
  closing = false,
}: {
  tool: string;
  label: string;
  children: ReactNode;
  width?: number;
  closing?: boolean;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const next = toolbarAnchor(tool, width);
      setAnchor((current) => (sameAnchor(current, next) ? current : next));
    };
    place();
    window.addEventListener("resize", place);
    // The inspector opens, closes and moves with the selection; follow it.
    const follow = window.setInterval(place, 400);
    return () => {
      window.removeEventListener("resize", place);
      window.clearInterval(follow);
    };
  }, [tool, width]);
  const caretShown = anchor ? anchor.caret >= 14 && anchor.caret <= anchor.width - 14 : true;

  return (
    <div
      className={`toolbar-flow${closing ? " is-closing" : ""}${caretShown ? "" : " toolbar-flow--no-caret"}`}
      role="dialog"
      aria-label={label}
      style={anchor ? {
        top: anchor.top,
        left: anchor.left,
        width: anchor.width,
        ["--toolbar-caret" as string]: `${anchor.caret}px`,
        ["--toolbar-flow-top" as string]: `${anchor.top}px`,
      } : { visibility: "hidden" }}
    >
      {children}
    </div>
  );
}
