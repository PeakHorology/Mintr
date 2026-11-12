"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUpFromLine, ChevronLeft, ChevronRight, Eye, EyeOff, History, Pencil, Power, Search, Trash2, X } from "lucide-react";
import { PartKindGlyph, PartsTreeEmptyGlyph, StepKindGlyph, ToolbarHideSelectedIcon, ToolbarLockShapeIcon, ToolbarUnlockShapeIcon } from "@/components/icons";
import { designTreeAncestors, designTreeGroupLabel, designTreeRows, treeDropFor, type DesignTreeRow, type TreeDrop } from "@/lib/designTree";
import { partFeatureLabel, partFeatureShortLabel } from "@/lib/partFeatures";
import { listedShapeAssets, searchShapeAssets, shapeSectionsFor, type ToolbarShapeAsset } from "@/lib/shapeCatalog";
import { beginShapeAssetDrag, endShapeAssetDrag, applyTransparentDragImage } from "@/lib/shapeAssetDrag";
import { PeakTipButton, usePeakContextHelp } from "@/components/workplane/ToolNameTooltip";
import { TOOL_DESCRIPTIONS } from "@/lib/toolDescriptions";
import type { PartFeature, ShapeAsset, WorkplaneShape } from "@/types/sketchforge";

const SHAPE_DESCRIPTIONS: Record<string, string> = {
  box: TOOL_DESCRIPTIONS.box,
  cylinder: TOOL_DESCRIPTIONS.cylinder,
  thread: TOOL_DESCRIPTIONS.thread,
  gear: TOOL_DESCRIPTIONS.gear,
  loft: TOOL_DESCRIPTIONS.loft,
  "gridfinity-bin": TOOL_DESCRIPTIONS.gridfinityBin,
  "gridfinity-baseplate": TOOL_DESCRIPTIONS.gridfinityBaseplate,
  sphere: TOOL_DESCRIPTIONS.sphere,
  cone: TOOL_DESCRIPTIONS.cone,
  pyramid: TOOL_DESCRIPTIONS.pyramid,
  roof: TOOL_DESCRIPTIONS.roof,
  text: TOOL_DESCRIPTIONS.text,
  "round-roof": TOOL_DESCRIPTIONS.roundRoof,
  "half-sphere": TOOL_DESCRIPTIONS.halfSphere,
  torus: TOOL_DESCRIPTIONS.torus,
  tube: TOOL_DESCRIPTIONS.tube,
  polygon: TOOL_DESCRIPTIONS.shapePolygon,
  wedge: TOOL_DESCRIPTIONS.wedge,
  plate: TOOL_DESCRIPTIONS.plate,
  slot: TOOL_DESCRIPTIONS.slotShape,
  star: TOOL_DESCRIPTIONS.starShape,
  heart: TOOL_DESCRIPTIONS.heart,
  paraboloid: TOOL_DESCRIPTIONS.paraboloid,
  "qr-code": TOOL_DESCRIPTIONS.qrCode,
  "screw-hole": TOOL_DESCRIPTIONS.screwHole,
  "nut-pocket": TOOL_DESCRIPTIONS.nutPocket,
};

function ShapeToolButton({
  shape,
  onAdd,
  touchShapeStartRef,
  suppressNextShapeClickRef,
}: {
  shape: ToolbarShapeAsset;
  onAdd: (shape: ShapeAsset) => void;
  touchShapeStartRef: MutableRefObject<{ id: string; x: number; y: number } | null>;
  suppressNextShapeClickRef: MutableRefObject<boolean>;
}) {
  const description = SHAPE_DESCRIPTIONS[shape.id] ?? `Add a ${shape.name.toLowerCase()} solid.`;
  const { onContextMenu, helpPortal } = usePeakContextHelp(shape.name, description);

  return (
    <button
      className="shape-sidebar-item"
      type="button"
      draggable
      data-lesson-target={shape.generated?.form ?? shape.kind}
      aria-label={`Add ${shape.name}`}
      onContextMenu={onContextMenu}
      onClick={() => {
        if (suppressNextShapeClickRef.current) {
          suppressNextShapeClickRef.current = false;
          return;
        }
        onAdd(shape);
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") {
          touchShapeStartRef.current = { id: shape.id, x: event.clientX, y: event.clientY };
        }
      }}
      onPointerUp={(event) => {
        if (event.pointerType !== "touch") {
          return;
        }
        const start = touchShapeStartRef.current;
        touchShapeStartRef.current = null;
        if (!start || start.id !== shape.id || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
          return;
        }
        event.preventDefault();
        suppressNextShapeClickRef.current = true;
        window.setTimeout(() => {
          suppressNextShapeClickRef.current = false;
        }, 350);
        onAdd(shape);
      }}
      onTouchStart={(event) => {
        const touch = event.changedTouches[0];
        if (touch) {
          touchShapeStartRef.current = { id: shape.id, x: touch.clientX, y: touch.clientY };
        }
      }}
      onTouchEnd={(event) => {
        const touch = event.changedTouches[0];
        const start = touchShapeStartRef.current;
        touchShapeStartRef.current = null;
        if (!touch || !start || start.id !== shape.id || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 8) {
          return;
        }
        event.preventDefault();
        suppressNextShapeClickRef.current = true;
        window.setTimeout(() => {
          suppressNextShapeClickRef.current = false;
        }, 350);
        onAdd(shape);
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-sketchforge-shape", JSON.stringify(shape));
        beginShapeAssetDrag(shape);
        applyTransparentDragImage(event.dataTransfer);
      }}
      onDragEnd={() => {
        endShapeAssetDrag();
      }}
    >
      <img src={shape.menuIcon} alt="" draggable={false} />
      <span>{shape.name}</span>
      {helpPortal}
    </button>
  );
}

export type PartsTreeShapePatch = { name?: string; hidden?: boolean; locked?: boolean };

/** A step the tree is showing the part up to: the steps after it are shown greyed. */
export type ShownStep = { bodyId: string; stepId: string };

type TreeMenuItem =
  | { separator: true }
  | { label: string; onSelect: () => void; disabled?: boolean; title?: string; icon?: ReactNode };

const TREE_DRAG_TYPE = "application/x-mintr-tree-row";

/**
 * A row's key, unique in the tree. A pattern copy of a group, or a part copied before Duplicate
 * gave fresh ids, can hold parts and steps with the same ids as another part's, so nested rows and
 * steps are keyed under the top-level part they belong to.
 */
function rowKey(row: DesignTreeRow): string {
  if (row.kind === "step") return `step:${row.bodyId}:${row.step.id}`;
  return row.depth === 0 ? row.shape.id : `${row.bodyId}/${row.parentId ?? ""}/${row.shape.id}`;
}

/** The right-click menu for a tree row. It sits at the pointer and closes on any outside press, Escape, or scroll. */
function TreeMenu({ x, y, label, items, onClose }: { x: number; y: number; label: string; items: TreeMenuItem[]; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    setPosition({ x: Math.max(8, Math.min(x, maxX)), y: Math.max(8, Math.min(y, maxY)) });
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const onPress = (event: PointerEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      if (buttons.length === 0) return;
      event.preventDefault();
      const index = buttons.findIndex((button) => button === document.activeElement);
      const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
      buttons[next].focus();
    };
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="parts-tree-menu"
      role="menu"
      aria-label={`Options for ${label}`}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="parts-tree-menu-title" aria-hidden="true">{label}</div>
      {items.map((item, index) => (
        "separator" in item
          ? <div key={`sep-${index}`} className="parts-tree-menu-separator" role="separator" />
          : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              <span className="parts-tree-menu-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          )
      ))}
    </div>,
    document.body,
  );
}

/**
 * The Parts tree: every part in the design, newest first, with its steps and the parts inside a
 * group under it at any depth. Click a row to select it, double-click or press F2 to rename a
 * part, double-click or press Enter on a step to open it in its tool. Hover or tab to a row for
 * its buttons; a part inside a group gets Off instead of Hide and Lock, which builds the group
 * without it. Right-click any row for everything it can do. With Pro on, steps can be dragged
 * into a new order, parts can be dragged into and out of groups, and a step can show the part
 * as it was right after it.
 */
function PartsTree({
  shapes,
  selectedIds,
  activeFeatureId,
  pro,
  stepLabel,
  shownStep,
  onSelectShape,
  onSelectChild,
  onUpdateShape,
  onRenameChild,
  onTurnOff,
  onOpenStep,
  onToggleStep,
  onRemoveStepsFrom,
  onReorderStep,
  onShowUpToStep,
  onMovePart,
  turnOffBlocked,
}: {
  shapes: WorkplaneShape[];
  selectedIds: string[];
  activeFeatureId: string | null;
  pro: boolean;
  stepLabel: (step: PartFeature) => string;
  shownStep: ShownStep | null;
  onSelectShape: (id: string | string[] | null, mode?: "replace" | "toggle") => void;
  onSelectChild?: (bodyId: string, childId: string) => void;
  onUpdateShape?: (id: string, patch: PartsTreeShapePatch) => void;
  onRenameChild?: (bodyId: string, childId: string, name: string) => void;
  onTurnOff?: (bodyId: string, childId: string, off: boolean) => void;
  onOpenStep?: (bodyId: string, stepId: string) => void;
  onToggleStep?: (bodyId: string, stepId: string) => void;
  onRemoveStepsFrom?: (bodyId: string, stepId: string) => void;
  onReorderStep?: (bodyId: string, stepId: string, toIndex: number) => void;
  onShowUpToStep?: (bodyId: string, stepId: string | null) => void;
  onMovePart?: (drop: TreeDrop) => void;
  turnOffBlocked: boolean;
}) {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ key: string | null; upperHalf: boolean; drop: TreeDrop } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const rows = useMemo(() => designTreeRows(shapes, collapsedIds), [shapes, collapsedIds]);
  const rowsByKey = useMemo(() => new Map(rows.map((row) => [rowKey(row), row])), [rows]);
  const focusId = activeFeatureId ?? (selectedIds.length === 1 ? selectedIds[0] : null);
  const shownIndex = shownStep
    ? rows.find((row) => row.kind === "step" && row.bodyId === shownStep.bodyId && row.step.id === shownStep.stepId)
    : null;
  const canDrag = pro && Boolean(onReorderStep || onMovePart) && !turnOffBlocked;

  // A part newly picked inside a group (Alt-click in the view) opens the groups that hold it.
  // Only a new pick does this, so a group can still be closed while a part in it is picked.
  useEffect(() => {
    if (!activeFeatureId) return;
    const ancestors = designTreeAncestors(shapesRef.current, activeFeatureId);
    if (ancestors.length === 0) return;
    setCollapsedIds((current) => {
      if (!ancestors.some((id) => current.has(id))) return current;
      const next = new Set(current);
      ancestors.forEach((id) => next.delete(id));
      return next;
    });
  }, [activeFeatureId]);

  // The selected row comes into view.
  useEffect(() => {
    if (!focusId || !listRef.current || typeof CSS === "undefined") return;
    const row = listRef.current.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(focusId)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [focusId, rows]);

  // A step that is gone (undo, removed) is no longer the active one.
  useEffect(() => {
    if (activeStepId && !rows.some((row) => row.kind === "step" && row.step.id === activeStepId)) setActiveStepId(null);
  }, [activeStepId, rows]);

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commitRename = () => {
    if (!renaming) return;
    const row = rows.find((entry) => entry.kind === "part" && entry.shape.id === renaming.id);
    setRenaming(null);
    const name = renaming.value.trim();
    if (!row || row.kind !== "part" || !name || name === row.shape.name) return;
    if (row.depth === 0) onUpdateShape?.(row.shape.id, { name });
    else onRenameChild?.(row.bodyId, row.shape.id, name);
  };

  const dropAllowed = (drop: TreeDrop) => (drop.kind === "reorder-step" ? Boolean(onReorderStep) : Boolean(onMovePart));

  const dropFor = (event: ReactDragEvent, target: DesignTreeRow | null) => {
    if (!dragKey) return null;
    const dragged = rowsByKey.get(dragKey);
    if (!dragged) return null;
    let upperHalf = false;
    if (target && event.currentTarget instanceof HTMLElement) {
      const rect = event.currentTarget.getBoundingClientRect();
      upperHalf = event.clientY < rect.top + rect.height / 2;
    }
    const drop = treeDropFor(dragged, target, upperHalf);
    return drop && dropAllowed(drop) ? { drop, upperHalf } : null;
  };

  const finishDrop = (drop: TreeDrop) => {
    if (drop.kind === "reorder-step") onReorderStep?.(drop.bodyId, drop.stepId, drop.toIndex);
    else onMovePart?.(drop);
  };

  const endDrag = () => {
    setDragKey(null);
    setDropHint(null);
  };

  const openMenu = (event: ReactMouseEvent, key: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    // A keyboard-opened menu (Shift+F10) has no pointer position; it opens by the row instead.
    const x = event.clientX || (rect ? rect.left + 24 : 0);
    const y = event.clientY || (rect ? rect.bottom : 0);
    setMenu({ key, x, y });
  };

  const blockedTitle = turnOffBlocked ? "Finish the fillet or chamfer first" : undefined;

  const menuItemsFor = (row: DesignTreeRow): TreeMenuItem[] => {
    if (row.kind === "step") {
      const { step } = row;
      const label = stepLabel(step);
      const locked = Boolean(row.shape.locked);
      const blocked = turnOffBlocked || locked;
      const lockedTitle = locked ? `“${row.shape.name}” is locked` : blockedTitle;
      const shown = shownStep?.bodyId === row.bodyId && shownStep.stepId === step.id;
      const items: TreeMenuItem[] = [
        {
          label: step.failed ? "Open this step" : "Edit this step",
          icon: <StepKindGlyph step={step} />,
          onSelect: () => onOpenStep?.(row.bodyId, step.id),
          disabled: blocked || !onOpenStep,
          title: lockedTitle ?? "Open it in its tool with the values it was made with",
        },
        {
          label: step.suppressed ? "Put this step back" : "Leave this step out",
          icon: <Power />,
          onSelect: () => onToggleStep?.(row.bodyId, step.id),
          disabled: blocked || !onToggleStep,
          title: lockedTitle,
        },
        {
          label: row.index === row.count - 1 ? "Remove this step" : "Remove this and later steps",
          icon: <Trash2 />,
          onSelect: () => onRemoveStepsFrom?.(row.bodyId, step.id),
          disabled: blocked || !onRemoveStepsFrom,
          title: lockedTitle ?? `Takes the part back to before ${label}`,
        },
      ];
      if (pro && onShowUpToStep) {
        items.push({ separator: true });
        items.push(shown
          ? { label: "Show all steps", icon: <Eye />, onSelect: () => onShowUpToStep(row.bodyId, null) }
          : {
              label: "Show up to here",
              icon: <History />,
              onSelect: () => onShowUpToStep(row.bodyId, step.id),
              disabled: turnOffBlocked,
              title: blockedTitle ?? "See the part as it was right after this step. Nothing is changed.",
            });
      }
      return items;
    }
    const { shape } = row;
    const name = shape.name || "Untitled";
    const topLevel = row.depth === 0;
    const canRename = Boolean(topLevel ? onUpdateShape : onRenameChild) && !shape.locked;
    const items: TreeMenuItem[] = [
      { label: "Rename", icon: <Pencil />, onSelect: () => setRenaming({ id: shape.id, value: shape.name }), disabled: !canRename, title: shape.locked ? `“${name}” is locked` : undefined },
    ];
    if (topLevel && onUpdateShape) {
      items.push({ label: shape.hidden ? "Show" : "Hide", icon: shape.hidden ? <Eye /> : <EyeOff />, onSelect: () => onUpdateShape(shape.id, { hidden: !shape.hidden }) });
      items.push({ label: shape.locked ? "Unlock" : "Lock", icon: shape.locked ? <ToolbarUnlockShapeIcon /> : <ToolbarLockShapeIcon />, onSelect: () => onUpdateShape(shape.id, { locked: !shape.locked }) });
    }
    if (!topLevel && onTurnOff) {
      items.push({
        label: row.off ? "Turn on" : "Turn off",
        icon: <Power />,
        onSelect: () => onTurnOff(row.bodyId, shape.id, !row.off),
        disabled: turnOffBlocked,
        title: blockedTitle ?? (row.off ? "Put this part back into the group" : "Build the group without this part"),
      });
    }
    if (pro && onMovePart && !topLevel) {
      items.push({ separator: true });
      items.push({
        label: "Move out of the group",
        icon: <ArrowUpFromLine />,
        onSelect: () => onMovePart({ kind: "out-of-group", partId: shape.id, fromBodyId: row.bodyId }),
        disabled: turnOffBlocked || Boolean(shape.locked),
        title: blockedTitle ?? (shape.locked ? `“${name}” is locked` : "Make it a part of its own again, where it is now"),
      });
    }
    if (shownStep?.bodyId === shape.id && pro && onShowUpToStep) {
      items.push({ separator: true });
      items.push({ label: "Show all steps", icon: <Eye />, onSelect: () => onShowUpToStep(shape.id, null) });
    }
    return items;
  };

  const menuRow = menu ? rowsByKey.get(menu.key) ?? null : null;
  const menuLabel = menuRow ? (menuRow.kind === "step" ? stepLabel(menuRow.step) : menuRow.shape.name || "Untitled") : "";

  if (rows.length === 0) {
    return (
      <div className="parts-tree-empty">
        <PartsTreeEmptyGlyph />
        <strong>No parts yet</strong>
        <span>Pick a shape from the Shapes tab, or drag one onto the workplane. It will show up here.</span>
      </div>
    );
  }

  return (
    <div
      className={`parts-tree${dragKey ? " is-dragging" : ""}${dropHint && dropHint.key === null ? " is-drop-root" : ""}`}
      role="tree"
      aria-label="Parts in this design"
      ref={listRef}
      onDragOver={(event) => {
        if (!dragKey) return;
        // Empty space below the rows: a part inside a group comes out to the top level.
        if (event.target !== event.currentTarget) return;
        const result = dropFor(event, null);
        if (!result) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropHint((current) => (current?.key === null ? current : { key: null, upperHalf: false, drop: result.drop }));
      }}
      onDrop={(event) => {
        if (event.target !== event.currentTarget) return;
        const result = dropFor(event, null);
        endDrag();
        if (!result) return;
        event.preventDefault();
        finishDrop(result.drop);
      }}
      onDragLeave={(event) => {
        if (event.target === event.currentTarget && dropHint?.key === null) setDropHint(null);
      }}
    >
      {rows.map((row) => {
        const key = rowKey(row);
        const isDropTarget = dropHint?.key === key;
        const dropClass = isDropTarget
          ? dropHint.drop.kind === "reorder-step"
            ? (dropHint.upperHalf ? " is-drop-before" : " is-drop-after")
            : " is-drop-into"
          : "";
        const dragProps = {
          onDragOver: (event: ReactDragEvent) => {
            if (!dragKey) return;
            const result = dropFor(event, row);
            if (!result) {
              if (isDropTarget) setDropHint(null);
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            setDropHint((current) => (current?.key === key && current.upperHalf === result.upperHalf ? current : { key, upperHalf: result.upperHalf, drop: result.drop }));
          },
          onDragLeave: () => {
            if (isDropTarget) setDropHint(null);
          },
          onDrop: (event: ReactDragEvent) => {
            const result = dropFor(event, row);
            endDrag();
            if (!result) return;
            event.preventDefault();
            event.stopPropagation();
            finishDrop(result.drop);
          },
        };

        if (row.kind === "step") {
          const { step } = row;
          const label = stepLabel(step);
          const name = row.shape.name || "Untitled";
          const selected = activeStepId === step.id && selectedIds.length === 1 && selectedIds[0] === row.bodyId;
          const shown = shownStep?.bodyId === row.bodyId && shownStep.stepId === step.id;
          const later = Boolean(shownIndex && shownIndex.kind === "step" && shownIndex.bodyId === row.bodyId && row.index > shownIndex.index);
          const blocked = turnOffBlocked || Boolean(row.shape.locked);
          const draggable = canDrag && Boolean(onReorderStep) && !row.shape.locked && row.count > 1;
          const open = () => {
            if (!blocked) onOpenStep?.(row.bodyId, step.id);
          };
          return (
            <div
              key={key}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-selected={selected}
              className={`parts-tree-row parts-tree-step${selected ? " selected" : ""}${step.suppressed ? " is-off" : ""}${step.failed ? " is-failed" : ""}${later ? " is-later" : ""}${shown ? " is-shown" : ""}${dragKey === key ? " is-drag-source" : ""}${dropClass}`}
              style={{ "--tree-depth": row.depth } as CSSProperties}
              data-tree-step={step.id}
              title={step.failed ? `Skipped: ${step.failed}` : undefined}
              onContextMenu={(event) => openMenu(event, key)}
              {...dragProps}
            >
              <span className="parts-tree-toggle" aria-hidden="true" />
              <button
                type="button"
                className="parts-tree-name"
                aria-pressed={selected}
                aria-label={`${label}, step ${row.index + 1} of ${row.count} on ${name}`}
                title={`${partFeatureLabel(step)} · double-click to edit${draggable ? ", drag to reorder" : ""}`}
                draggable={draggable}
                onClick={() => {
                  setActiveStepId(step.id);
                  onSelectShape(row.bodyId, "replace");
                }}
                onDoubleClick={open}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    open();
                  }
                }}
                onDragStart={(event) => {
                  if (!draggable) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(TREE_DRAG_TYPE, key);
                  setDragKey(key);
                }}
                onDragEnd={endDrag}
              >
                <span className="parts-tree-glyph parts-tree-glyph-step"><StepKindGlyph step={step} /></span>
                <span className="parts-tree-label">{label}</span>
                {shown ? <span className="parts-tree-badge parts-tree-badge-shown">Shown</span> : null}
                {step.failed ? <span className="parts-tree-badge parts-tree-badge-skipped">Skipped</span> : null}
                {step.suppressed ? <span className="parts-tree-badge parts-tree-badge-off">Off</span> : null}
              </button>
              <div className="parts-tree-actions">
                {onOpenStep ? (
                  <button
                    type="button"
                    className="parts-tree-action parts-tree-off"
                    aria-label={`Edit ${label}`}
                    disabled={blocked}
                    title={blockedTitle ?? "Open this step in its tool"}
                    onClick={open}
                  >
                    Edit
                  </button>
                ) : null}
                {onToggleStep ? (
                  <button
                    type="button"
                    className="parts-tree-action parts-tree-off"
                    aria-label={step.suppressed ? `Put ${label} back` : `Leave ${label} out`}
                    aria-pressed={Boolean(step.suppressed)}
                    disabled={blocked}
                    title={blockedTitle ?? (step.suppressed ? "Put this step back" : "Leave this step out for now")}
                    onClick={() => onToggleStep(row.bodyId, step.id)}
                  >
                    {step.suppressed ? "On" : "Off"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        }

        const { shape } = row;
        const name = shape.name || "Untitled";
        const topLevel = row.depth === 0;
        const bodyName = topLevel ? name : (rows.find((entry) => entry.kind === "part" && entry.shape.id === row.bodyId) as { shape: WorkplaneShape } | undefined)?.shape.name ?? "its group";
        const selected = topLevel ? selectedIds.includes(shape.id) && activeStepId === null : activeFeatureId === shape.id;
        const groupLabel = designTreeGroupLabel(row.op);
        const canRename = Boolean(topLevel ? onUpdateShape : onRenameChild) && !shape.locked;
        const draggable = canDrag && Boolean(onMovePart) && !shape.locked;
        const beginRename = () => {
          if (canRename) setRenaming({ id: shape.id, value: shape.name });
        };
        const pick = (toggle: boolean) => {
          setActiveStepId(null);
          if (topLevel) {
            onSelectShape(shape.id, toggle ? "toggle" : "replace");
          } else if (toggle || !onSelectChild) {
            onSelectShape(row.bodyId, toggle ? "toggle" : "replace");
          } else {
            onSelectChild(row.bodyId, shape.id);
          }
        };
        return (
          <div
            key={key}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-selected={selected}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            className={`parts-tree-row${selected ? " selected" : ""}${shape.hidden ? " is-hidden" : ""}${row.off ? " is-off" : ""}${dragKey === key ? " is-drag-source" : ""}${dropClass}`}
            style={{ "--tree-depth": row.depth } as CSSProperties}
            data-tree-id={shape.id}
            onContextMenu={(event) => openMenu(event, key)}
            {...dragProps}
          >
            {row.hasChildren ? (
              <button
                type="button"
                className={`parts-tree-toggle${row.expanded ? " is-open" : ""}`}
                aria-label={row.expanded ? `Close ${name}` : `Open ${name}`}
                aria-expanded={row.expanded}
                onClick={() => toggleCollapsed(shape.id)}
              >
                <ChevronRight size={14} strokeWidth={2.5} aria-hidden="true" />
              </button>
            ) : (
              <span className="parts-tree-toggle" aria-hidden="true" />
            )}
            {renaming?.id === shape.id ? (
              <input
                className="parts-tree-rename"
                type="text"
                autoFocus
                aria-label={`New name for ${name}`}
                value={renaming.value}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setRenaming({ id: shape.id, value: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setRenaming(null);
                  }
                }}
                onBlur={commitRename}
              />
            ) : (
              <button
                type="button"
                className="parts-tree-name"
                aria-pressed={selected}
                aria-label={`${selected ? "Selected" : "Select"} ${name}${topLevel ? "" : ` in ${bodyName}`}`}
                title={canRename ? `${name} · double-click or press F2 to rename` : name}
                draggable={draggable}
                onClick={(event) => pick(event.shiftKey)}
                onDoubleClick={beginRename}
                onKeyDown={(event) => {
                  if (event.key === "F2") {
                    event.preventDefault();
                    beginRename();
                  }
                }}
                onDragStart={(event) => {
                  if (!draggable) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(TREE_DRAG_TYPE, key);
                  setDragKey(key);
                }}
                onDragEnd={endDrag}
              >
                <span
                  className={`parts-tree-glyph${shape.hole ? " parts-tree-glyph-hole" : ""}`}
                  style={shape.hole ? undefined : { color: shape.color }}
                >
                  <PartKindGlyph shape={shape} op={row.op} />
                </span>
                <span className="parts-tree-label">{name}</span>
                {groupLabel ? <span className="parts-tree-kind">{groupLabel}</span> : null}
                {shape.hole ? <span className="parts-tree-kind">Hole</span> : null}
                {/* Hidden and locked top-level parts keep their eye and lock buttons showing instead of a badge. */}
                {!topLevel && shape.hidden ? <span className="parts-tree-badge">Hidden</span> : null}
                {!topLevel && shape.locked ? <span className="parts-tree-badge">Locked</span> : null}
                {row.off ? <span className="parts-tree-badge parts-tree-badge-off">Off</span> : null}
              </button>
            )}
            <div className="parts-tree-actions">
              {topLevel && onUpdateShape ? (
                <>
                  <button
                    type="button"
                    className={`parts-tree-action${shape.hidden ? " active" : ""}`}
                    aria-label={shape.hidden ? `Show ${name}` : `Hide ${name}`}
                    aria-pressed={Boolean(shape.hidden)}
                    title={shape.hidden ? "Show in the view" : "Hide from the view"}
                    onClick={() => onUpdateShape(shape.id, { hidden: !shape.hidden })}
                  >
                    <ToolbarHideSelectedIcon width={18} height={18} />
                  </button>
                  <button
                    type="button"
                    className={`parts-tree-action${shape.locked ? " active" : ""}`}
                    aria-label={shape.locked ? `Unlock ${name}` : `Lock ${name}`}
                    aria-pressed={Boolean(shape.locked)}
                    title={shape.locked ? "Let it move and change again" : "Keep it from moving or changing"}
                    onClick={() => onUpdateShape(shape.id, { locked: !shape.locked })}
                  >
                    {shape.locked ? <ToolbarLockShapeIcon width={18} height={18} /> : <ToolbarUnlockShapeIcon width={18} height={18} />}
                  </button>
                </>
              ) : null}
              {!topLevel && onTurnOff ? (
                <button
                  type="button"
                  className="parts-tree-action parts-tree-off"
                  aria-label={row.off ? `Turn ${name} back on` : `Turn ${name} off`}
                  aria-pressed={row.off}
                  disabled={turnOffBlocked}
                  title={blockedTitle ?? (row.off ? "Put this part back into the group" : "Build the group without this part")}
                  onClick={() => onTurnOff(row.bodyId, shape.id, !row.off)}
                >
                  {row.off ? "On" : "Off"}
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      {menu && menuRow ? (
        <TreeMenu
          x={menu.x}
          y={menu.y}
          label={menuLabel}
          items={menuItemsFor(menuRow)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

export function ShapeSidebar({
  onAddShape,
  shapes,
  selectedIds,
  onSelectShape,
  collapsed = false,
  onExpand,
  onCollapse,
  laserDesign = false,
  treeOpen = false,
  onTreeOpenChange,
  activeFeatureId = null,
  pro = false,
  stepLabel,
  shownStep = null,
  onSelectChild,
  onUpdateShape,
  onRenameChild,
  onTurnOff,
  onOpenStep,
  onToggleStep,
  onRemoveStepsFrom,
  onReorderStep,
  onShowUpToStep,
  onMovePart,
  turnOffBlocked = false,
}: {
  onAddShape: (shape: ShapeAsset) => void;
  shapes: WorkplaneShape[];
  selectedIds: string[];
  onSelectShape: (id: string | string[] | null, mode?: "replace" | "toggle") => void;
  collapsed?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
  /** A laser design leaves out the print-only parts. */
  laserDesign?: boolean;
  /** The Parts tab is showing instead of the shape catalog. */
  treeOpen?: boolean;
  onTreeOpenChange?: (open: boolean) => void;
  /** The part picked inside a group, as the inspector shows it. */
  activeFeatureId?: string | null;
  /** Pro is on: steps can be reordered, shown up to a point, and parts dragged between groups. */
  pro?: boolean;
  /** The words for a step row, in the design's units. */
  stepLabel?: (step: PartFeature) => string;
  /** The step the view is showing a part up to, if any. */
  shownStep?: ShownStep | null;
  /** Select a part inside a group: its top-level part, with that part picked. */
  onSelectChild?: (bodyId: string, childId: string) => void;
  /** Rename, hide or lock a top-level part. */
  onUpdateShape?: (id: string, patch: PartsTreeShapePatch) => void;
  onRenameChild?: (bodyId: string, childId: string, name: string) => void;
  /** Build the group without this part (or with it again). */
  onTurnOff?: (bodyId: string, childId: string, off: boolean) => void;
  /** Open a step in its tool, with the values it was made with. */
  onOpenStep?: (bodyId: string, stepId: string) => void;
  /** Leave a step out of the part, or put it back. */
  onToggleStep?: (bodyId: string, stepId: string) => void;
  /** Remove a step and every step after it. */
  onRemoveStepsFrom?: (bodyId: string, stepId: string) => void;
  /** Pro: move a step to a new place in its part's steps. */
  onReorderStep?: (bodyId: string, stepId: string, toIndex: number) => void;
  /** Pro: show the part as it was right after a step, or all of it again (null). */
  onShowUpToStep?: (bodyId: string, stepId: string | null) => void;
  /** Pro: move a part into a group or out to the top level. */
  onMovePart?: (drop: TreeDrop) => void;
  /** A fillet or chamfer is open, so the group must not rebuild. */
  turnOffBlocked?: boolean;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const touchShapeStartRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const suppressNextShapeClickRef = useRef(false);

  const addShape = (shape: ShapeAsset) => {
    onAddShape(shape);
  };

  const listed = useMemo(() => listedShapeAssets(laserDesign), [laserDesign]);
  const searching = query.trim().length > 0;
  const matches = useMemo(() => (searching ? searchShapeAssets(listed, query) : listed), [listed, query, searching]);
  const sections = shapeSectionsFor(laserDesign);

  const clearSearch = () => {
    setQuery("");
    searchRef.current?.focus();
  };

  const renderTile = (shape: ToolbarShapeAsset) => (
    <ShapeToolButton
      key={shape.id}
      shape={shape}
      onAdd={addShape}
      touchShapeStartRef={touchShapeStartRef}
      suppressNextShapeClickRef={suppressNextShapeClickRef}
    />
  );

  if (collapsed) {
    return (
      <div className="shape-rail collapsed">
        <PeakTipButton
          className="shape-rail-expand"
          label="Show shapes"
          description="Show the shape catalog and the parts in this design."
          aria-label="Show shapes"
          aria-expanded={false}
          onClick={() => onExpand?.()}
        >
          <ChevronLeft size={18} strokeWidth={2.5} aria-hidden="true" />
        </PeakTipButton>
      </div>
    );
  }

  return (
    <div className={`shape-rail ${treeOpen ? "tree-open" : ""}`}>
      {onCollapse ? (
        <PeakTipButton
          className="shape-rail-collapse"
          label="Hide shapes"
          description="Hide the shape catalog while you edit."
          aria-label="Hide shapes"
          aria-expanded={true}
          onClick={onCollapse}
        >
          <ChevronRight size={18} strokeWidth={2.5} aria-hidden="true" />
        </PeakTipButton>
      ) : null}
      <div className="shape-rail-modes" role="tablist" aria-label="Shapes or parts">
        <button
          type="button"
          role="tab"
          aria-selected={!treeOpen}
          className={treeOpen ? "" : "active"}
          onClick={() => onTreeOpenChange?.(false)}
        >
          Shapes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={treeOpen}
          className={treeOpen ? "active" : ""}
          onClick={() => onTreeOpenChange?.(true)}
        >
          Parts
        </button>
      </div>
      {treeOpen ? null : (
        <div className="shape-search">
          <Search size={15} strokeWidth={2.25} aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            placeholder="Find a shape"
            aria-label="Find a shape"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                if (query) {
                  setQuery("");
                } else {
                  event.currentTarget.blur();
                }
              }
            }}
          />
          {query ? (
            <button type="button" className="shape-search-clear" aria-label="Clear search" onClick={clearSearch}>
              <X size={14} strokeWidth={2.5} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}

      {treeOpen ? (
        <aside className="shape-sidebar" aria-label="Parts">
          <PartsTree
            shapes={shapes}
            selectedIds={selectedIds}
            activeFeatureId={activeFeatureId}
            pro={pro}
            stepLabel={stepLabel ?? defaultStepLabel}
            shownStep={shownStep}
            onSelectShape={onSelectShape}
            onSelectChild={onSelectChild}
            onUpdateShape={onUpdateShape}
            onRenameChild={onRenameChild}
            onTurnOff={onTurnOff}
            onOpenStep={onOpenStep}
            onToggleStep={onToggleStep}
            onRemoveStepsFrom={onRemoveStepsFrom}
            onReorderStep={onReorderStep}
            onShowUpToStep={onShowUpToStep}
            onMovePart={onMovePart}
            turnOffBlocked={turnOffBlocked}
          />
        </aside>
      ) : (
        <aside className="shape-sidebar" aria-label="Shapes">
          <div className="shape-sidebar-list">
            {searching ? (
              matches.length === 0 ? (
                <div className="shape-sidebar-empty">
                  <p>No shape matches “{query.trim()}”.</p>
                  <button type="button" onClick={clearSearch}>Show all shapes</button>
                </div>
              ) : (
                <section className="shape-sidebar-section" aria-label="Matching shapes">
                  {matches.map(renderTile)}
                </section>
              )
            ) : (
              sections.map((section) => {
                const inSection = listed.filter((shape) => shape.section === section);
                if (inSection.length === 0) return null;
                return (
                  <section key={section} className="shape-sidebar-section" aria-label={section}>
                    <h3>{section}</h3>
                    {inSection.map(renderTile)}
                  </section>
                );
              })
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function defaultStepLabel(step: PartFeature): string {
  return partFeatureShortLabel(step);
}
