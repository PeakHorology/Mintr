"use client";

import { useMemo, useRef, useState, type MutableRefObject } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { listedShapeAssets, searchShapeAssets, shapeSectionsFor, type ToolbarShapeAsset } from "@/lib/shapeCatalog";
import { beginShapeAssetDrag, endShapeAssetDrag, applyTransparentDragImage } from "@/lib/shapeAssetDrag";
import { PeakTipButton, usePeakContextHelp } from "@/components/workplane/ToolNameTooltip";
import { TOOL_DESCRIPTIONS } from "@/lib/toolDescriptions";
import type { ShapeAsset, WorkplaneShape } from "@/types/sketchforge";

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

export function ShapeSidebar({
  onAddShape,
  shapes,
  selectedIds,
  onSelectShape,
  collapsed = false,
  onExpand,
  onCollapse,
  laserDesign = false,
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
}) {
  const [objectListOpen, setObjectListOpen] = useState(false);
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

  // Newest objects at the top of the list.
  const objectEntries = [...shapes].reverse();

  if (collapsed) {
    return (
      <div className="shape-rail collapsed">
        <PeakTipButton
          className="shape-rail-expand"
          label="Show shapes"
          description="Show the shape catalog and object list."
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
    <div className={`shape-rail ${objectListOpen ? "object-list-open" : ""}`}>
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
      <div className="shape-rail-modes" role="tablist" aria-label="Shapes or objects">
        <button
          type="button"
          role="tab"
          aria-selected={!objectListOpen}
          className={objectListOpen ? "" : "active"}
          onClick={() => setObjectListOpen(false)}
        >
          Shapes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={objectListOpen}
          className={objectListOpen ? "active" : ""}
          onClick={() => setObjectListOpen(true)}
        >
          Objects
        </button>
      </div>
      {objectListOpen ? null : (
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

      {objectListOpen ? (
        <aside className="shape-sidebar" aria-label="Objects">
          <div className="object-list-items">
            {objectEntries.length === 0 ? <div className="object-list-empty">No objects yet</div> : null}
            {objectEntries.map((shape) => {
              const selected = selectedIds.includes(shape.id);
              const isCsgBody = Boolean(shape.groupedShapes?.length);
              const isAssembly = shape.csg?.op === "assemble" && isCsgBody;
              const children = isAssembly
                ? (shape.groupedShapes ?? []).filter((child) => shape.hole || !child.hole)
                : [];
              return (
                <div key={shape.id} className="object-list-group">
                  <button
                    type="button"
                    className={`object-list-item ${selected ? "selected" : ""} ${shape.hidden ? "is-hidden" : ""} ${shape.locked ? "is-locked" : ""}`}
                    aria-label={`${selected ? "Selected" : "Select"} ${shape.name}`}
                    aria-pressed={selected}
                    onClick={(event) => {
                      onSelectShape(shape.id, event.shiftKey ? "toggle" : "replace");
                    }}
                  >
                    <span className="object-list-swatch" style={{ background: shape.hole ? "transparent" : shape.color }} data-hole={shape.hole ? "true" : undefined} />
                    <span className="object-list-name">{shape.name || "Untitled"}</span>
                    {isAssembly ? <span className="object-list-badge">Tie</span> : isCsgBody ? <span className="object-list-badge">Group</span> : null}
                    {shape.hole ? <span className="object-list-badge">Hole</span> : null}
                    {shape.hidden ? <span className="object-list-badge">Hidden</span> : null}
                    {shape.locked ? <span className="object-list-badge">Locked</span> : null}
                  </button>
                  {children.map((child) => {
                    const childSelected = selectedIds.includes(child.id) || selected;
                    return (
                      <button
                        key={child.id}
                        type="button"
                        className={`object-list-item object-list-child ${childSelected ? "selected" : ""} ${child.hidden ? "is-hidden" : ""} ${child.locked ? "is-locked" : ""}`}
                        aria-label={`${childSelected ? "Selected" : "Select"} ${child.name} in ${shape.name}`}
                        aria-pressed={childSelected}
                        onClick={(event) => {
                          onSelectShape(shape.id, event.shiftKey ? "toggle" : "replace");
                        }}
                      >
                        <span className="object-list-swatch" style={{ background: child.color }} />
                        <span className="object-list-name">{child.name}</span>
                        {child.locked ? <span className="object-list-badge">Locked</span> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
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
