"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";

type Anchor = { top: number; left: number; caret: number; width: number };

const TOOL_SECTION: Record<string, string> = {
  History: "History",
  Fillet: "Modify",
  Chamfer: "Modify",
  Hollow: "Modify",
  Split: "Modify",
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
  return section?.parentElement?.querySelector<HTMLElement>('[aria-label="More tools"]') ?? section;
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
  return {
    top: rect.bottom + 8,
    left,
    caret: center - left,
    width: panelWidth,
  };
}

/** A tool menu that opens under its toolbar button, the same way History does. */
export function ToolbarFlow({
  tool,
  label,
  children,
  width = 340,
}: {
  tool: string;
  label: string;
  children: ReactNode;
  width?: number;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  useLayoutEffect(() => {
    const place = () => setAnchor(toolbarAnchor(tool, width));
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [tool, width]);

  return (
    <div
      className="toolbar-flow"
      role="dialog"
      aria-label={label}
      style={anchor ? {
        top: anchor.top,
        left: anchor.left,
        width: anchor.width,
        ["--toolbar-caret" as string]: `${anchor.caret}px`,
      } : { visibility: "hidden" }}
    >
      {children}
    </div>
  );
}
