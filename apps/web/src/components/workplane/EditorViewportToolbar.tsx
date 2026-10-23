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
  ToolbarMirrorIcon,
  ToolbarPasteIcon,
  ToolbarRedoIcon,
  ToolbarLayFlatIcon,
  ToolbarSnapGridIcon,
  ToolbarTrashIcon,
  ToolbarUngroupIcon,
  ToolbarUndoIcon,
} from "@/components/icons";
import { PeakTooltip, usePeakContextHelp, usePeakTooltip } from "@/components/workplane/ToolNameTooltip";
import { TOOL_DESCRIPTIONS } from "@/lib/toolDescriptions";
import type { CadModifierKind } from "@/lib/cadModifierTypes";
import { formatHotkeyBinding, HOTKEYS_CHANGED_EVENT, loadHotkeyBindings, type HotkeyActionId, type HotkeyBindings } from "@/lib/hotkeys";
import { useChromePresence } from "@/lib/chromePresence";

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
};

type ToolSection = {
  title: string;
  accent: "history" | "clipboard" | "combine" | "modify" | "arrange";
  tools: ToolDef[];
};

const ICON_PX = 32;
const SECTION_CHROME_PX = 8;
const SECTION_GAP_PX = 6;
const MORE_SLOT_PX = 32;

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
        open={open}
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

function clusterWidth(sections: ToolSection[], visible: Set<string>, labelWidth: (title: string) => number, includeMore: boolean): number {
  let width = 0;
  let groups = 0;
  let shown = 0;
  let total = 0;
  for (const section of sections) {
    total += section.tools.length;
    const count = section.tools.filter((tool) => visible.has(tool.label)).length;
    shown += count;
    if (count === 0) continue;
    const icons = SECTION_CHROME_PX + count * ICON_PX;
    width += Math.max(icons, labelWidth(section.title));
    groups += 1;
  }
  if (groups > 1) width += (groups - 1) * SECTION_GAP_PX;
  if (includeMore && shown < total) width += (groups > 0 ? SECTION_GAP_PX : 0) + MORE_SLOT_PX;
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

function pickVisibleLabels(sections: ToolSection[], availablePx: number, labelWidth: (title: string) => number): string[] {
  const tools = sections.flatMap((section) => section.tools);
  const labels = tools.map((tool) => tool.label);
  const all = new Set(labels);
  if (clusterWidth(sections, all, labelWidth, false) <= availablePx) {
    return labels;
  }
  const visible = new Set(labels);
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    if (clusterWidth(sections, visible, labelWidth, true) <= availablePx) break;
    if (tools[index]?.active) continue;
    visible.delete(labels[index]);
  }
  for (let index = labels.length - 1; index >= 0 && clusterWidth(sections, visible, labelWidth, true) > availablePx; index -= 1) {
    visible.delete(labels[index]);
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
    const measure = () => {
      const labelWidth = (title: string) => sectionLabelWidth(host, title);
      const next = pickVisibleLabels(sections, availableClusterWidth(host), labelWidth);
      setVisibleLabels((current) => (current.length === next.length && current.every((label, index) => label === next[index]) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    const column = host.closest(".editor-top-bar-left, .editor-top-bar-right");
    if (column instanceof HTMLElement && column !== host) observer.observe(column);
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
            <Ellipsis size={22} strokeWidth={2.2} aria-hidden="true" />
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
            { label: "Undo", description: TOOL_DESCRIPTIONS.undo, icon: ToolbarUndoIcon, action: onUndo, enabled: Boolean(canUndo), shortcut: shortcutLabel(hotkeys, "undo") },
            { label: "Redo", description: TOOL_DESCRIPTIONS.redo, icon: ToolbarRedoIcon, action: onRedo, enabled: Boolean(canRedo), shortcut: shortcutLabel(hotkeys, "redo") },
          ],
        },
        ...((onCopy || onPaste)
          ? [{
            title: "Clipboard",
            accent: "clipboard" as const,
            tools: [
              ...(onCopy
                ? [{ label: "Copy", description: TOOL_DESCRIPTIONS.copy, icon: ToolbarCopyIcon, action: onCopy, enabled: Boolean(canCopy), shortcut: shortcutLabel(hotkeys, "copy") }]
                : []),
              ...(onPaste
                ? [{ label: "Paste", description: TOOL_DESCRIPTIONS.paste, icon: ToolbarPasteIcon, action: onPaste, enabled: Boolean(canPaste), shortcut: shortcutLabel(hotkeys, "paste") }]
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
  canUngroup,
  alignMode,
  snapActive,
  layFlatActive,
  canAlign,
  canEdgeModify,
  hollowActive,
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
  onAlign,
  onSnap,
  onLayFlat,
  onMirror,
  onCircularPattern,
  onLinearPattern,
  onChamfer,
  onFillet,
  onPushPull,
  onHollow,
  onSplit,
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
  canUngroup: boolean;
  alignMode: boolean;
  snapActive: boolean;
  layFlatActive: boolean;
  canAlign: boolean;
  canEdgeModify: boolean;
  hollowActive: boolean;
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
  onAlign: () => void;
  onSnap: () => void;
  onLayFlat: () => void;
  onMirror: () => void;
  onCircularPattern: () => void;
  onLinearPattern: () => void;
  onChamfer: () => void;
  onFillet: () => void;
  onPushPull: () => void;
  onHollow: () => void;
  onSplit: () => void;
}) {
  const hotkeys = useHotkeyBindings();

  const historySection: ToolSection = {
    title: "History",
    accent: "history",
    tools: [
      { label: "Undo", description: TOOL_DESCRIPTIONS.undo, icon: ToolbarUndoIcon, action: onUndo, enabled: canUndo, shortcut: shortcutLabel(hotkeys, "undo"), disabledReason: "Nothing to undo" },
      { label: "History", description: TOOL_DESCRIPTIONS.history, icon: ToolbarHistoryIcon, action: onHistory, enabled: true, active: historyActive },
      { label: "Redo", description: TOOL_DESCRIPTIONS.redo, icon: ToolbarRedoIcon, action: onRedo, enabled: canRedo, shortcut: shortcutLabel(hotkeys, "redo"), disabledReason: "Nothing to redo" },
    ],
  };
  const clipboardSection: ToolSection = {
    title: "Clipboard",
    accent: "clipboard",
    tools: [
      { label: "Copy", description: TOOL_DESCRIPTIONS.copy, icon: ToolbarCopyIcon, action: onCopy, enabled: hasSelection, shortcut: shortcutLabel(hotkeys, "copy"), disabledReason: "Select a shape first" },
      { label: "Paste", description: TOOL_DESCRIPTIONS.paste, icon: ToolbarPasteIcon, action: onPaste, enabled: hasClipboard, shortcut: shortcutLabel(hotkeys, "paste"), disabledReason: "Nothing to paste" },
      { label: "Duplicate", description: TOOL_DESCRIPTIONS.duplicate, icon: ToolbarDuplicateIcon, action: onDuplicate, enabled: hasSelection, shortcut: shortcutLabel(hotkeys, "duplicate"), disabledReason: "Select a shape first" },
      { label: "Duplicate and repeat", description: TOOL_DESCRIPTIONS.duplicateRepeat, icon: ToolbarDuplicateRepeatIcon, action: onDuplicateAndRepeat, enabled: hasSelection, shortcut: shortcutLabel(hotkeys, "duplicateRepeat"), disabledReason: "Select a shape first" },
      { label: "Delete", description: TOOL_DESCRIPTIONS.delete, icon: ToolbarTrashIcon, action: onDelete, enabled: hasSelection, shortcut: shortcutLabel(hotkeys, "delete"), disabledReason: "Select a shape first" },
    ],
  };
  const combineSection: ToolSection = {
    title: "Combine",
    accent: "combine",
    tools: [
      { label: "Group", description: TOOL_DESCRIPTIONS.group, icon: ToolbarGroupIcon, action: onGroup, enabled: canGroup, shortcut: shortcutLabel(hotkeys, "group"), disabledReason: "Select two or more shapes to group" },
      { label: "Tie", description: TOOL_DESCRIPTIONS.assembly, icon: ToolbarAssemblyIcon, action: onAssemble, enabled: canGroup, disabledReason: "Select two or more shapes to tie together" },
      { label: "Ungroup", description: TOOL_DESCRIPTIONS.ungroup, icon: ToolbarUngroupIcon, action: onUngroup, enabled: canUngroup, shortcut: shortcutLabel(hotkeys, "ungroup"), disabledReason: "Select a grouped shape to ungroup" },
      { label: "Intersect", description: TOOL_DESCRIPTIONS.intersect, icon: ToolbarIntersectionIcon, action: onIntersect, enabled: canIntersect, disabledReason: "Select a solid and a hole shape" },
    ],
  };
  const modifySection: ToolSection = {
    title: "Modify",
    accent: "modify",
    tools: [
      { label: "Chamfer", description: TOOL_DESCRIPTIONS.chamfer, icon: ToolbarChamferIcon, action: onChamfer, enabled: canEdgeModify, active: edgeModifierKind === "chamfer", shortcut: shortcutLabel(hotkeys, "chamfer"), disabledReason: "Select a single unlocked shape first" },
      { label: "Fillet", description: TOOL_DESCRIPTIONS.fillet, icon: ToolbarFilletIcon, action: onFillet, enabled: canEdgeModify, active: edgeModifierKind === "fillet", shortcut: shortcutLabel(hotkeys, "fillet"), disabledReason: "Select a single unlocked shape first" },
      { label: "Push Pull", description: TOOL_DESCRIPTIONS.pushPull, icon: ToolbarPushPullIcon, action: onPushPull, enabled: canEdgeModify, active: pushPullActive, disabledReason: "Select a single unlocked shape first" },
      { label: "Hollow", description: TOOL_DESCRIPTIONS.hollow, icon: ToolbarHollowIcon, action: onHollow, enabled: canEdgeModify, active: hollowActive, disabledReason: "Select a single unlocked shape first" },
      { label: "Split", description: TOOL_DESCRIPTIONS.split, icon: ToolbarSplitIcon, action: onSplit, enabled: canEdgeModify || splitActive, active: splitActive, disabledReason: "Select a single unlocked shape first" },
    ],
  };
  const arrangeSection: ToolSection = {
    title: "Arrange",
    accent: "arrange",
    tools: [
      { label: "Align", description: TOOL_DESCRIPTIONS.align, icon: ToolbarAlignIcon, action: onAlign, enabled: canAlign, active: alignMode, shortcut: shortcutLabel(hotkeys, "align"), disabledReason: "Select two or more shapes to align" },
      { label: "Snap", description: TOOL_DESCRIPTIONS.snap, icon: ToolbarSnapGridIcon, action: onSnap, enabled: true, active: snapActive },
      { label: "Lay flat", description: TOOL_DESCRIPTIONS.layFlat, icon: ToolbarLayFlatIcon, action: onLayFlat, enabled: true, active: layFlatActive },
      { label: "Mirror", description: TOOL_DESCRIPTIONS.mirror, icon: ToolbarMirrorIcon, action: onMirror, enabled: hasSelection, active: mirrorMode, shortcut: shortcutLabel(hotkeys, "mirror"), disabledReason: "Select a shape first" },
      { label: "Circular pattern", description: TOOL_DESCRIPTIONS.pattern, icon: ToolbarCircularPatternIcon, action: onCircularPattern, enabled: canCircularPattern || circularPatternActive, active: circularPatternActive, shortcut: shortcutLabel(hotkeys, "pattern"), disabledReason: "Select an unlocked shape first" },
      { label: "Linear pattern", description: TOOL_DESCRIPTIONS.linearPattern, icon: ToolbarLinearPatternIcon, action: onLinearPattern, enabled: canLinearPattern || linearPatternActive, active: linearPatternActive, disabledReason: "Select an unlocked shape first" },
    ],
  };

  const sections =
    cluster === "edit" ? [historySection, clipboardSection]
      : cluster === "modify" ? [combineSection, modifySection, arrangeSection]
        : [historySection, clipboardSection, combineSection, modifySection, arrangeSection];

  return <OverflowToolRow sections={sections} align={cluster === "modify" ? "end" : "start"} />;
}
