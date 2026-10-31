"use client";

import { Ellipsis } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import {
  ToolbarAlignIcon,
  ToolbarAssemblyIcon,
  ToolbarChamferIcon,
  ToolbarCircularPatternIcon,
  ToolbarCopyIcon,
  ToolbarLinearPatternIcon,
  ToolbarDuplicateIcon,
  ToolbarDuplicateRepeatIcon,
  ToolbarFilletIcon,
  ToolbarHollowIcon,
  ToolbarPushPullIcon,
  ToolbarSplitIcon,
  ToolbarGroupIcon,
  ToolbarHistoryIcon,
  ToolbarIntersectionIcon,
  ToolbarLoftIcon,
  ToolbarShrinkWrapIcon,
  ToolbarSmoothIcon,
  ToolbarMirrorIcon,
  ToolbarPasteIcon,
  ToolbarRedoIcon,
  ToolbarLayFlatIcon,
  ToolbarSnapGridIcon,
  ToolbarTextureIcon,
  ToolbarTrashIcon,
  ToolbarUngroupIcon,
  ToolbarUndoIcon,
  ToolbarBoxMakerIcon,
  ToolbarFlatPartsIcon,
  ToolbarTraceLogoIcon,
  ToolbarFitCrystalIcon,
  ToolbarNestIcon,
} from "@/components/icons";
import { useSageActive } from "@/components/workplane/Sage";
import { PeakTooltip, usePeakContextHelp, usePeakTooltip } from "@/components/workplane/ToolNameTooltip";
import { TOOL_DESCRIPTIONS } from "@/lib/toolDescriptions";
import type { CadModifierKind } from "@/lib/cadModifierTypes";
import { formatHotkeyBinding, HOTKEYS_CHANGED_EVENT, loadHotkeyBindings, type HotkeyActionId, type HotkeyBindings } from "@/lib/hotkeys";
import { useChromePresence } from "@/lib/chromePresence";
import { TOOLBAR_NEED_EVENT } from "@/components/workplane/toolbarFit";

type ToolbarMode = "geometry" | "sketch";

type ToolDef = {
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  iconClassName?: string;
  action: () => void;
  enabled: boolean;
  active?: boolean;
  shortcut?: string;
  disabledReason?: string;
  /** Sage guide key, when the label is shared with another tool. */
  sageKey?: string;
  /**
   * When the toolbar runs short of room, lower numbers move into "More tools" first.
   * 1 = has a shortcut or is rarely used, 5 = core tool. Defaults to 3.
   */
  priority?: number;
};

type ToolSection = {
  title: string;
  accent: "history" | "clipboard" | "combine" | "modify" | "arrange" | "laser";
  tools: ToolDef[];
};

/** Border plus padding around a section's icons. */
const SECTION_CHROME_PX = 8;

type ClusterMetrics = { icon: number; gap: number };

/** Live hotkey bindings so toolbar tooltips reflect any user remaps. */
function useHotkeyBindings(): HotkeyBindings {
  const [bindings, setBindings] = useState<HotkeyBindings>(() => loadHotkeyBindings());
  useEffect(() => {
    const refresh = () => setBindings(loadHotkeyBindings());
    window.addEventListener(HOTKEYS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(HOTKEYS_CHANGED_EVENT, refresh);
  }, []);
  return bindings;
}

function shortcutLabel(bindings: HotkeyBindings, actionId: HotkeyActionId) {
  const label = formatHotkeyBinding(bindings[actionId] ?? []);
  return label === "None" ? undefined : label;
}

function ToolbarButton({ tool }: { tool: ToolDef }) {
  const Icon = tool.icon;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sage = useSageActive();
  const hasDescription = Boolean(tool.description && tool.description.trim() && tool.description.trim() !== tool.label);
  const disabledHint = !tool.enabled ? tool.disabledReason : undefined;
  const { open, tooltipProps, hide } = usePeakTooltip(tool.shortcut || hasDescription || disabledHint ? 500 : undefined);
  const { onContextMenu, helpPortal } = usePeakContextHelp(tool.label, tool.description);

  return (
    <button
      ref={buttonRef}
      className={`toolbar-icon ${tool.enabled ? "" : "disabled"} ${tool.active ? "active" : ""}`}
      type="button"
      aria-label={tool.label}
      aria-disabled={!tool.enabled}
      data-toolbar-tool={tool.label}
      data-sage-key={tool.sageKey}
      data-tool-help={tool.description}
      data-tool-shortcut={tool.shortcut}
      data-lesson-target={tool.label.toLowerCase()}
      {...tooltipProps}
      onMouseDown={(event) => {
        event.preventDefault();
        hide();
      }}
      onContextMenu={onContextMenu}
      onClick={() => {
        if (!tool.enabled) return;
        tool.action();
      }}
    >
      <Icon className={tool.iconClassName} />
      <PeakTooltip
        label={tool.label}
        open={open && !sage}
        anchorRef={buttonRef}
        shortcut={tool.enabled ? tool.shortcut : undefined}
        hint={disabledHint ?? (hasDescription ? "Right-click for help" : undefined)}
      />
      {helpPortal}
    </button>
  );
}

function sectionLabelWidth(host: HTMLElement, title: string): number {
  const probe = document.createElement("div");
  probe.className = "toolbar-section-label";
  probe.textContent = title;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.width = "max-content";
  probe.style.flex = "none";
  host.appendChild(probe);
  const width = Math.ceil(probe.getBoundingClientRect().width) + 2;
  probe.remove();
  return width;
}

function clusterWidth(
  sections: ToolSection[],
  visible: Set<string>,
  labelWidth: (title: string) => number,
  includeMore: boolean,
  metrics: ClusterMetrics,
): number {
  let width = 0;
  let groups = 0;
  let shown = 0;
  let total = 0;
  for (const section of sections) {
    total += section.tools.length;
    const count = section.tools.filter((tool) => visible.has(tool.label)).length;
    shown += count;
    if (count === 0) continue;
    const icons = SECTION_CHROME_PX + count * metrics.icon;
    width += Math.max(icons, labelWidth(section.title));
    groups += 1;
  }
  if (groups > 1) width += (groups - 1) * metrics.gap;
  if (includeMore && shown < total) width += (groups > 0 ? metrics.gap : 0) + metrics.icon;
  return width;
}

/** Room left in the toolbar column after the logo, file, and settings groups. */
function availableClusterWidth(host: HTMLElement): number {
  const column = host.closest(".editor-top-bar-left, .editor-top-bar-right");
  if (!(column instanceof HTMLElement)) return host.clientWidth;
  const style = getComputedStyle(column);
  const gap = Number.parseFloat(style.columnGap || style.gap) || 0;
  let used = 0;
  for (const child of Array.from(column.children)) {
    if (!(child instanceof HTMLElement) || child === host || child.contains(host)) continue;
    used += child.getBoundingClientRect().width;
  }
  const gapCount = Math.max(0, column.children.length - 1);
  return Math.max(0, column.clientWidth - used - gap * gapCount);
}

/** Icon and gap sizes as drawn, so the compact top bar is measured as it really is. */
function clusterMetrics(host: HTMLElement): ClusterMetrics {
  const icon = host.querySelector<HTMLElement>(".toolbar-icon")?.getBoundingClientRect().width;
  const style = getComputedStyle(host);
  return {
    icon: icon && icon > 0 ? icon : 42,
    gap: Number.parseFloat(style.columnGap || style.gap) || 6,
  };
}

function pickVisibleLabels(
  sections: ToolSection[],
  availablePx: number,
  labelWidth: (title: string) => number,
  metrics: ClusterMetrics,
): string[] {
  const tools = sections.flatMap((section) => section.tools);
  const labels = tools.map((tool) => tool.label);
  const visible = new Set(labels);
  // A pixel of slack for rounding, so a tool is never pushed out by a fraction.
  availablePx += 1;
  if (clusterWidth(sections, visible, labelWidth, false, metrics) <= availablePx) {
    return labels;
  }
  // Lowest priority goes first; among equals, the later tool. A tool in use stays out as long as it can.
  const dropOrder = tools
    .map((tool, index) => ({ tool, index }))
    .sort((a, b) =>
      Number(Boolean(a.tool.active)) - Number(Boolean(b.tool.active))
      || (a.tool.priority ?? 3) - (b.tool.priority ?? 3)
      || b.index - a.index);
  for (const { tool } of dropOrder) {
    if (clusterWidth(sections, visible, labelWidth, true, metrics) <= availablePx) break;
    visible.delete(tool.label);
  }
  return labels.filter((label) => visible.has(label));
}

function OverflowToolRow({
  sections,
  align = "start",
}: {
  sections: ToolSection[];
  align?: "start" | "end";
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tools = sections.flatMap((section) => section.tools);
  const [visibleLabels, setVisibleLabels] = useState<string[]>(() => tools.map((tool) => tool.label));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuPresence = useChromePresence(menuOpen);

  const toolFingerprint = tools.map((tool) => `${tool.label}:${tool.active ? "1" : "0"}`).join("|");

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const labelCache = new Map<string, number>();
    const labelWidth = (title: string) => {
      let width = labelCache.get(title);
      if (width === undefined) {
        width = sectionLabelWidth(host, title);
        labelCache.set(title, width);
      }
      return width;
    };
    const measure = () => {
      const metrics = clusterMetrics(host);
      const all = new Set(tools.map((tool) => tool.label));
      // Tell the top bar how much room every tool would take, so it can tighten up or share space.
      const need = String(Math.ceil(clusterWidth(sections, all, labelWidth, false, metrics)));
      const key = tools.map((tool) => tool.label).join("|");
      if (host.dataset.need !== need || host.dataset.key !== key) {
        host.dataset.need = need;
        host.dataset.key = key;
        host.dispatchEvent(new Event(TOOLBAR_NEED_EVENT, { bubbles: true }));
      }
      const next = pickVisibleLabels(sections, availableClusterWidth(host), labelWidth, metrics);
      setVisibleLabels((current) => (current.length === next.length && current.every((label, index) => label === next[index]) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    const column = host.closest(".editor-top-bar-left, .editor-top-bar-right");
    if (column instanceof HTMLElement && column !== host) {
      observer.observe(column);
      // The File group and the others beside the tools change size too (Save as, the tighter top bar).
      for (const child of Array.from(column.children)) {
        if (child instanceof HTMLElement && !child.contains(host)) observer.observe(child);
      }
    }
    return () => observer.disconnect();
    // tools is rebuilt each render; fingerprint captures layout-relevant changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolFingerprint]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (hostRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const visible = new Set(visibleLabels);
  const overflow = tools.filter((tool) => !visible.has(tool.label));
  const overflowActive = overflow.some((tool) => tool.active);

  return (
    <div ref={hostRef} className={`toolbar-overflow-cluster toolbar-overflow-cluster--${align}`}>
      {sections.map((section) => {
        const shown = section.tools.filter((tool) => visible.has(tool.label));
        if (shown.length === 0) {
          return null;
        }
        return (
          <div key={section.title} className={`toolbar-section compact toolbar-group-${section.accent}`} aria-label={section.title}>
            <div className="toolbar-section-label">{section.title}</div>
            <div className="toolbar-section-tools">
              {shown.map((tool) => (
                <ToolbarButton key={tool.label} tool={tool} />
              ))}
            </div>
          </div>
        );
      })}
      {overflow.length > 0 ? (
        <div className="toolbar-overflow-more">
          <button
            className={`toolbar-icon ${overflowActive || menuOpen ? "active" : ""}`}
            type="button"
            aria-label="More tools"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Ellipsis size={26} strokeWidth={2.2} aria-hidden="true" />
          </button>
          {menuPresence.mounted ? (
            <div
              ref={menuRef}
              className={`toolbar-overflow-menu${menuPresence.closing ? " is-closing" : ""}`}
              role="menu"
              aria-label="More tools"
            >
              {sections.map((section) => {
                const hidden = section.tools.filter((tool) => !visible.has(tool.label));
                if (hidden.length === 0) return null;
                return (
                  <div key={section.title} className="toolbar-overflow-menu-group" role="group" aria-label={section.title}>
                    <div className={`toolbar-overflow-menu-label toolbar-group-${section.accent}`}>{section.title}</div>
                    {hidden.map((tool) => {
                      const Icon = tool.icon;
                      return (
                        <button
                          key={tool.label}
                          type="button"
                          role="menuitem"
                          className={`${tool.enabled ? "" : "disabled"} ${tool.active ? "active" : ""}`}
                          aria-disabled={!tool.enabled}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            if (!tool.enabled) {
                              return;
                            }
                            tool.action();
                            setMenuOpen(false);
                          }}
                        >
                          <Icon className={tool.iconClassName} />
                          <span>{tool.label}</span>
                          {tool.shortcut ? <span className="menu-shortcut">{tool.shortcut}</span> : <span />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function EditorModeStrip({
  canUndo,
  canRedo,
  canCopy,
  canPaste,
  onUndo,
  onRedo,
  onCopy,
  onPaste,
}: {
  toolbarMode?: ToolbarMode;
  onToolbarModeChange?: (mode: ToolbarMode) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  canCopy?: boolean;
  canPaste?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
}) {
  const hotkeys = useHotkeyBindings();
  if (!onUndo || !onRedo) {
    return null;
  }
  return (
    <OverflowToolRow
      sections={[
        {
          title: "History",
          accent: "history",
          tools: [
            { label: "Undo", priority: 5, description: TOOL_DESCRIPTIONS.undo, icon: ToolbarUndoIcon, action: onUndo, enabled: Boolean(canUndo), shortcut: shortcutLabel(hotkeys, "undo") },
            { label: "Redo", priority: 5, description: TOOL_DESCRIPTIONS.redo, icon: ToolbarRedoIcon, action: onRedo, enabled: Boolean(canRedo), shortcut: shortcutLabel(hotkeys, "redo") },
          ],
        },
        ...((onCopy || onPaste)
          ? [{
            title: "Clipboard",
            accent: "clipboard" as const,
            tools: [
              ...(onCopy
                ? [{ label: "Copy", priority: 1, description: TOOL_DESCRIPTIONS.copy, icon: ToolbarCopyIcon, action: onCopy, enabled: Boolean(canCopy), shortcut: shortcutLabel(hotkeys, "copy") }]
                : []),
              ...(onPaste
                ? [{ label: "Paste", priority: 1, description: TOOL_DESCRIPTIONS.paste, icon: ToolbarPasteIcon, action: onPaste, enabled: Boolean(canPaste), shortcut: shortcutLabel(hotkeys, "paste") }]
                : []),
            ],
          }]
          : []),
      ]}
    />
  );
}

export function EditorViewportToolbar({
  cluster = "all",
  canUndo,
  canRedo,
  historyActive,
  hasClipboard,
  hasSelection,
  canGroup,
  canIntersect,
  canShrinkWrap,
  canSmooth,
  canLoft,
  canUngroup,
  alignMode,
  snapActive,
  layFlatActive,
  canAlign,
  canEdgeModify,
  canSplit,
  textureActive,
  onTexture,
  faceActive,
  pushPullActive,
  splitActive,
  edgeModifierKind,
  circularPatternActive,
  canCircularPattern,
  linearPatternActive,
  canLinearPattern,
  mirrorMode,
  onCopy,
  onPaste,
  onDuplicate,
  onDuplicateAndRepeat,
  onDelete,
  onUndo,
  onHistory,
  onRedo,
  onGroup,
  onAssemble,
  onUngroup,
  onIntersect,
  onShrinkWrap,
  onSmooth,
  onLoft,
  onAlign,
  onSnap,
  onLayFlat,
  onMirror,
  onCircularPattern,
  onLinearPattern,
  onChamfer,
  onFillet,
  onPushPull,
  onFace,
  onSplit,
  laserTools = null,
}: {
  cluster?: "all" | "edit" | "modify";
  toolbarMode?: ToolbarMode;
  onToolbarModeChange?: (mode: ToolbarMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  historyActive: boolean;
  hasClipboard: boolean;
  hasSelection: boolean;
  canGroup: boolean;
  canIntersect: boolean;
  canShrinkWrap: boolean;
  canSmooth: boolean;
  canLoft: boolean;
  canUngroup: boolean;
  alignMode: boolean;
  snapActive: boolean;
  layFlatActive: boolean;
  canAlign: boolean;
  canEdgeModify: boolean;
  canSplit: boolean;
  textureActive: boolean;
  onTexture: () => void;
  faceActive: boolean;
  pushPullActive: boolean;
  splitActive: boolean;
  edgeModifierKind: CadModifierKind | null;
  circularPatternActive: boolean;
  canCircularPattern: boolean;
  linearPatternActive: boolean;
  canLinearPattern: boolean;
  mirrorMode: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onDuplicateAndRepeat: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onHistory: () => void;
  onRedo: () => void;
  onGroup: () => void;
  onAssemble: () => void;
  onUngroup: () => void;
  onIntersect: () => void;
  onShrinkWrap: () => void;
  onSmooth: () => void;
  onLoft: () => void;
  onAlign: () => void;
  onSnap: () => void;
  onLayFlat: () => void;
  onMirror: () => void;
  onCircularPattern: () => void;
  onLinearPattern: () => void;
  onChamfer: () => void;
  onFillet: () => void;
  onPushPull: () => void;
  onFace: () => void;
  onSplit: () => void;
  /** Set in a laser design: tools for flat parts cut from a sheet. */
  laserTools?: {
    onBoxMaker: () => void;
    onNest: () => void;
    canNest: boolean;
    onFlatParts: () => void;
    canFlatParts: boolean;
    onTraceLogo: () => void;
    /** Engraving inside a K9 crystal: the sheet tools give way to Fit in crystal. */
    crystal: boolean;
    onFitCrystal: () => void;
    canFitCrystal: boolean;
  } | null;
}) {
  const hotkeys = useHotkeyBindings();

  const historySection: ToolSection = {
    title: "History",
    accent: "history",
    tools: [
      { label: "Undo", priority: 5, description: TOOL_DESCRIPTIONS.undo, icon: ToolbarUndoIcon, action: onUndo, enabled: canUndo, shortcut: shortcutLabel(hotkeys, "undo"), disabledReason: "Nothing to undo" },
      { label: "History", priority: 4, description: TOOL_DESCRIPTIONS.history, icon: ToolbarHistoryIcon, action: onHistory, enabled: true, active: historyActive },
      { label: "Redo", priority: 5, description: TOOL_DESCRIPTIONS.redo, icon: ToolbarRedoIcon, action: onRedo, enabled: canRedo, shortcut: shortcutLabel(hotkeys, "redo"), disabledReason: "Nothing to redo" },
    ],
  };
  const clipboardSection: ToolSection = {
    title: "Clipboard",
    accent: "clipboard",
    tools: [
      { label: "Copy", priority: 1, description: TOOL_DESCRIPTIONS.copy, icon: ToolbarCopyIcon, action: onCopy, enabled: hasSelection, shortcut: shortcutLabel(hotkeys, "copy"), disabledReason: "Select a shape first" },
      { label: "Paste", priority: 1, description: TOOL_DESCRIPTIONS.paste, icon: ToolbarPasteIcon, action: onPaste, enabled: hasClipboard, shortcut: shortcutLabel(hotkeys, "paste"), disabledReason: "Nothing to paste" },
      { label: "Duplicate", priority: 2, description: TOOL_DESCRIPTIONS.duplicate, icon: ToolbarDuplicateIcon, action: onDuplicate, enabled: hasSelection, shortcut: shortcutLabel(hotkeys, "duplicate"), disabledReason: "Select a shape first" },
      { label: "Duplicate and repeat", priority: 2, description: TOOL_DESCRIPTIONS.duplicateRepeat, icon: ToolbarDuplicateRepeatIcon, action: onDuplicateAndRepeat, enabled: hasSelection, shortcut: shortcutLabel(hotkeys, "duplicateRepeat"), disabledReason: "Select a shape first" },
      { label: "Delete", priority: 1, description: TOOL_DESCRIPTIONS.delete, icon: ToolbarTrashIcon, action: onDelete, enabled: hasSelection, shortcut: shortcutLabel(hotkeys, "delete"), disabledReason: "Select a shape first" },
    ],
  };
  const combineSection: ToolSection = {
    title: "Combine",
    accent: "combine",
    tools: [
      { label: "Group", priority: 5, description: TOOL_DESCRIPTIONS.group, icon: ToolbarGroupIcon, action: onGroup, enabled: canGroup, shortcut: shortcutLabel(hotkeys, "group"), disabledReason: "Select two or more shapes to group" },
      { label: "Tie", priority: 2, description: TOOL_DESCRIPTIONS.assembly, icon: ToolbarAssemblyIcon, action: onAssemble, enabled: canGroup, disabledReason: "Select two or more shapes to tie together" },
      { label: "Ungroup", priority: 3, description: TOOL_DESCRIPTIONS.ungroup, icon: ToolbarUngroupIcon, action: onUngroup, enabled: canUngroup, shortcut: shortcutLabel(hotkeys, "ungroup"), disabledReason: "Select a grouped shape to ungroup" },
      { label: "Intersect", priority: 3, description: TOOL_DESCRIPTIONS.intersect, icon: ToolbarIntersectionIcon, action: onIntersect, enabled: canIntersect, disabledReason: "Select two or more overlapping shapes" },
      { label: "Shrink Wrap", priority: 1, description: TOOL_DESCRIPTIONS.shrinkWrap, icon: ToolbarShrinkWrapIcon, action: onShrinkWrap, enabled: canShrinkWrap, disabledReason: "Select two or more solids to wrap" },
      // A loft is printed, so laser designs leave it out.
      ...(laserTools ? [] : [{ label: "Loft", priority: 1, description: TOOL_DESCRIPTIONS.loftSketches, icon: ToolbarLoftIcon, action: onLoft, enabled: canLoft, disabledReason: "Select two or more flat outlines stacked at different heights" }]),
    ],
  };
  const modifySection: ToolSection = {
    title: "Modify",
    accent: "modify",
    tools: [
      { label: "Chamfer", priority: 5, description: TOOL_DESCRIPTIONS.chamfer, icon: ToolbarChamferIcon, action: onChamfer, enabled: canEdgeModify, active: edgeModifierKind === "chamfer", shortcut: shortcutLabel(hotkeys, "chamfer"), disabledReason: "Select a single unlocked shape first" },
      { label: "Fillet", priority: 5, description: TOOL_DESCRIPTIONS.fillet, icon: ToolbarFilletIcon, action: onFillet, enabled: canEdgeModify, active: edgeModifierKind === "fillet", shortcut: shortcutLabel(hotkeys, "fillet"), disabledReason: "Select a single unlocked shape first" },
      { label: "Push Pull", priority: 4, description: TOOL_DESCRIPTIONS.pushPull, icon: ToolbarPushPullIcon, action: onPushPull, enabled: canEdgeModify, active: pushPullActive, disabledReason: "Select a single unlocked shape first" },
      { label: "Pad/Pocket", priority: 3, description: TOOL_DESCRIPTIONS.face, icon: ToolbarHollowIcon, action: onFace, enabled: canEdgeModify, active: faceActive, disabledReason: "Select a single unlocked shape first" },
      { label: "Split", priority: 3, description: TOOL_DESCRIPTIONS.split, icon: ToolbarSplitIcon, action: onSplit, enabled: canSplit || splitActive, active: splitActive, disabledReason: canEdgeModify ? "Gridfinity bins stay in one piece" : "Select a single unlocked shape first" },
      { label: "Smooth", priority: 2, description: TOOL_DESCRIPTIONS.smoothBody, icon: ToolbarSmoothIcon, action: onSmooth, enabled: canSmooth, disabledReason: "Select an unlocked solid to smooth", sageKey: "smooth shape" },
      // Works with nothing selected: click Texture, then the part. A printed finish, so not in laser designs.
      ...(laserTools ? [] : [{ label: "Texture", priority: 1, description: TOOL_DESCRIPTIONS.texture, icon: ToolbarTextureIcon, action: onTexture, enabled: true, active: textureActive }]),
    ],
  };
  const arrangeSection: ToolSection = {
    title: "Arrange",
    accent: "arrange",
    tools: [
      { label: "Align", priority: 5, description: TOOL_DESCRIPTIONS.align, icon: ToolbarAlignIcon, action: onAlign, enabled: canAlign, active: alignMode, shortcut: shortcutLabel(hotkeys, "align"), disabledReason: "Select two or more shapes to align" },
      { label: "Snap", priority: 3, description: TOOL_DESCRIPTIONS.snap, icon: ToolbarSnapGridIcon, action: onSnap, enabled: true, active: snapActive },
      { label: "Lay flat", priority: 3, description: TOOL_DESCRIPTIONS.layFlat, icon: ToolbarLayFlatIcon, action: onLayFlat, enabled: true, active: layFlatActive },
      { label: "Mirror", priority: 5, description: TOOL_DESCRIPTIONS.mirror, icon: ToolbarMirrorIcon, action: onMirror, enabled: hasSelection, active: mirrorMode, shortcut: shortcutLabel(hotkeys, "mirror"), disabledReason: "Select a shape first" },
      { label: "Circular pattern", priority: 4, description: TOOL_DESCRIPTIONS.pattern, icon: ToolbarCircularPatternIcon, action: onCircularPattern, enabled: canCircularPattern || circularPatternActive, active: circularPatternActive, shortcut: shortcutLabel(hotkeys, "pattern"), disabledReason: "Select an unlocked shape first" },
      { label: "Linear pattern", priority: 3, description: TOOL_DESCRIPTIONS.linearPattern, icon: ToolbarLinearPatternIcon, action: onLinearPattern, enabled: canLinearPattern || linearPatternActive, active: linearPatternActive, disabledReason: "Select an unlocked shape first" },
    ],
  };

  const laserSection: ToolSection | null = laserTools
    ? {
      title: "Laser",
      accent: "laser",
      tools: laserTools.crystal
        ? [
          { label: "Fit in crystal", priority: 5, description: TOOL_DESCRIPTIONS.fitCrystal, icon: ToolbarFitCrystalIcon, action: laserTools.onFitCrystal, enabled: laserTools.canFitCrystal, disabledReason: "Add a model first" },
          { label: "Trace logo", priority: 3, description: TOOL_DESCRIPTIONS.traceLogo, icon: ToolbarTraceLogoIcon, action: laserTools.onTraceLogo, enabled: true },
        ]
        : [
          { label: "Box maker", priority: 3, description: TOOL_DESCRIPTIONS.boxMaker, icon: ToolbarBoxMakerIcon, action: laserTools.onBoxMaker, enabled: true },
          { label: "Trace logo", priority: 3, description: TOOL_DESCRIPTIONS.traceLogo, icon: ToolbarTraceLogoIcon, action: laserTools.onTraceLogo, enabled: true },
          { label: "Flat parts", priority: 4, description: TOOL_DESCRIPTIONS.flatParts, icon: ToolbarFlatPartsIcon, action: laserTools.onFlatParts, enabled: laserTools.canFlatParts, disabledReason: "Select one 3D part" },
          { label: "Nest", priority: 4, description: TOOL_DESCRIPTIONS.nest, icon: ToolbarNestIcon, action: laserTools.onNest, enabled: laserTools.canNest, disabledReason: "Add a part to cut first" },
        ],
    }
    : null;
  const modifyCluster = [combineSection, modifySection, arrangeSection, ...(laserSection ? [laserSection] : [])];
  const sections =
    cluster === "edit" ? [historySection, clipboardSection]
      : cluster === "modify" ? modifyCluster
        : [historySection, clipboardSection, ...modifyCluster];

  return <OverflowToolRow sections={sections} align={cluster === "modify" ? "end" : "start"} />;
}
