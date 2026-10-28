"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  Check,
  Circle,
  Ellipsis,
  Eraser,
  Hexagon,
  Image,
  Minus,
  MousePointer2,
  Plus,
  RectangleHorizontal,
  RotateCw,
  ScanLine,
  Shapes,
  Square,
  Star,
  Spline,
  Triangle,
  X,
} from "lucide-react";
import type { SketchTool } from "@/components/SketchWorkspace";
import {
  SketchConstraintCoincidentIcon,
  SketchConstraintConcentricIcon,
  SketchConstraintEqualIcon,
  SketchConstraintFixIcon,
  SketchConstraintHorizontalIcon,
  SketchConstraintMidpointIcon,
  SketchConstraintParallelIcon,
  SketchConstraintPerpendicularIcon,
  SketchConstraintSymmetryIcon,
  SketchConstraintTangentIcon,
  SketchConstraintVerticalIcon,
  SketchDimensionIcon,
  SketchRectPatternIcon,
  SketchTrimIcon,
  ToolbarChamferIcon,
  ToolbarCircularPatternIcon,
  ToolbarFilletIcon,
  ToolbarMirrorIcon,
} from "@/components/icons";
import { usePeakContextHelp } from "@/components/workplane/ToolNameTooltip";
import { MAX_SKETCH_POLYGON_SIDES, MIN_SKETCH_POLYGON_SIDES } from "@/lib/sketchDrawShapes";
import { TOOL_DESCRIPTIONS } from "@/lib/toolDescriptions";

export type SketchCoachKey = SketchTool | "image";

function SketchStrokeIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="sketch-tool-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const SKETCH_COACH: Partial<Record<SketchCoachKey, { title: string; body: string }>> = {
  line: { title: "Line", body: "Click each corner. Click the first point again to close the shape." },
  bezier: { title: "Curve", body: "Click a point, then drag to bend it. Click the start point to close." },
  smooth: { title: "Smooth", body: "Click a corner to turn the sharp bend into a curve." },
  circle: { title: "Circle", body: "Press and drag from the center out to the edge." },
  ellipse: { title: "Ellipse", body: "Drag across the oval you want." },
  square: { title: "Square", body: "Drag from one corner. Every side stays the same length." },
  rectangle: { title: "Rectangle", body: "Drag from one corner to the opposite corner." },
  roundRect: { title: "Rounded", body: "Drag the box. The corners stay rounded." },
  slot: { title: "Slot", body: "Drag the length of the slot." },
  triangle: { title: "Triangle", body: "Drag to set the size of the triangle." },
  polygon: { title: "Polygon", body: "Drag to set the size. Use Sides to change how many corners." },
  star: { title: "Star", body: "Drag to set the size of the star." },
  arc: { title: "Arc", body: "Click the start, the end, then a point the curve should pass through." },
  offset: { title: "Offset", body: "Select a closed outline and type the distance, or drag an edge. Outside grows it. Inside shrinks it. A single line copies a parallel line." },
  select: { title: "Select", body: "Click inside a closed shape to select the whole outline. Drag it to move it. Click a line when you want that edge only." },
  refine: { title: "Bend", body: "Drag a point to pull the line into a curve." },
  erase: { title: "Erase", body: "Click the line or point you want to remove." },
  trim: { title: "Trim", body: "Click the piece of a line you want to cut off." },
  fillet: { title: "Fillet", body: "Select a corner, or a whole shape, and set the radius. Two lines that meet round at that corner." },
  chamfer: { title: "Chamfer", body: "Select a corner, or a whole shape, and set the distance. Two lines that meet are cut straight." },
  mirror: { title: "Mirror", body: "Click a straight line. The sketch is copied across it." },
  pattern: { title: "Linear pattern", body: "Select what to repeat, then set how many copies." },
  "circular-pattern": { title: "Circular pattern", body: "Select a shape. Copies spin around its middle." },
  stroke: { title: "Lineweight", body: "Set how thick a line is drawn. The shape stays the same." },
  measure: { title: "Measure", body: "Click two points to read the distance between them." },
  dimension: { title: "Dimension", body: "Click a line, then type the length you want it to keep." },
  image: { title: "Image", body: "Add a picture onto the sketch to trace over." },
  "constrain-coincident": { title: "Coincident", body: "Click two points so they stay together." },
  "constrain-h": { title: "Horizontal", body: "Click a line, or two points, to keep them horizontal." },
  "constrain-v": { title: "Vertical", body: "Click a line to keep it vertical." },
  "constrain-equal": { title: "Equal", body: "Click two lines to make them the same length." },
  "constrain-parallel": { title: "Parallel", body: "Click two lines to keep them parallel." },
  "constrain-perp": { title: "Right angle", body: "Click two lines to keep them at a right angle." },
  "constrain-tangent": { title: "Tangent", body: "Click a line, then a circle, so they stay tangent." },
  "constrain-midpoint": { title: "Midpoint", body: "Click a point, then the line it should sit in the middle of." },
  "constrain-concentric": { title: "Concentric", body: "Click two circles so they share a center." },
  "constrain-fix": { title: "Fix", body: "Click a point or line to lock it in place." },
  "constrain-symmetry": { title: "Symmetry", body: "Click two points or lines, then the axis to mirror across." },
};

/** One sentence for the current sketch step. Shared by the flat sketch bar and the 3D chip. */
export function sketchCoach(
  tool: SketchCoachKey,
  closedCount: number,
  drawingGuides: boolean,
  placingPoint: boolean,
  hovering = false,
): { title: string; body: string } {
  if (!hovering && drawingGuides) {
    return {
      title: "Drawing guides",
      body: "These lines will not become a solid. Turn off Draw as guides when you want the real shape.",
    };
  }
  if (!hovering && closedCount > 0 && !placingPoint && (tool === "select" || tool === "line" || tool === "bezier")) {
    return {
      title: "Ready to extrude",
      body: "The shape is closed. Extrude turns it into a solid.",
    };
  }
  const named = SKETCH_COACH[tool];
  if (named) return named;
  if (tool.startsWith("constrain-")) {
    return { title: "Rule", body: "Click the lines this rule should hold in place." };
  }
  return {
    title: "Sketch",
    body: "Pick Line, Curve, Circle, or Rectangle. Close the shape, then Extrude.",
  };
}

export function SketchCoach({
  tool,
  closedCount,
  drawingGuides,
  placingPoint,
  hovering = false,
}: {
  tool: SketchCoachKey;
  closedCount: number;
  drawingGuides: boolean;
  placingPoint: boolean;
  hovering?: boolean;
}) {
  const coach = sketchCoach(tool, closedCount, drawingGuides, placingPoint, hovering);
  const ready = !hovering && coach.title === "Ready to extrude";
  return (
    <div className={`sketch-coach${ready ? " is-ready" : ""}${!hovering && drawingGuides ? " is-guide" : ""}`} role="status">
      <strong>{coach.title}</strong>
      <span>{coach.body}</span>
    </div>
  );
}

function SketchToolButton({
  label,
  description,
  active,
  disabled,
  hoverKey,
  onHoverTool,
  onClick,
  children,
}: {
  label: string;
  description: string;
  active?: boolean;
  disabled?: boolean;
  hoverKey?: SketchCoachKey;
  onHoverTool?: (tool: SketchCoachKey | null) => void;
  onClick: () => void;
  children: ReactNode;
}) {
  const { onContextMenu, helpPortal } = usePeakContextHelp(label, description);
  return (
    <button
      className={`editor-tool-sidebar-item sketch-tool-item ${disabled ? "disabled" : ""} ${active ? "active" : ""}`}
      type="button"
      data-lesson-target={label.toLowerCase()}
      aria-label={label}
      onClick={onClick}
      onContextMenu={onContextMenu}
      disabled={disabled}
      onPointerEnter={() => {
        if (hoverKey) onHoverTool?.(hoverKey);
      }}
      onPointerLeave={() => onHoverTool?.(null)}
    >
      {children}
      <span>{label}</span>
      {helpPortal}
    </button>
  );
}

/** Draw tools (right rail while actively sketching). */
export function SketchToolSidebar({
  sketchTool,
  polygonSides,
  onSketchTool,
  onPolygonSidesChange,
  onHoverTool,
}: {
  sketchTool: SketchTool;
  polygonSides: number;
  onSketchTool: (tool: SketchTool) => void;
  onPolygonSidesChange: (sides: number) => void;
  onHoverTool?: (tool: SketchCoachKey | null) => void;
}) {
  const [shapesOpen, setShapesOpen] = useState(false);
  const shapeTools: SketchTool[] = ["bezier", "arc", "ellipse", "square", "roundRect", "slot", "triangle", "polygon", "star"];
  const shapeActive = shapeTools.includes(sketchTool);
  const pickShape = (tool: SketchTool) => {
    onSketchTool(tool);
    setShapesOpen(false);
  };
  return (
    <aside className="editor-tool-sidebar editor-tool-sidebar-right" aria-label="Sketch draw tools">
      <div className="editor-tool-sidebar-scroll">
        <section className="editor-tool-sidebar-section">
          <div className="editor-tool-sidebar-header">Draw</div>
          <div className="editor-tool-sidebar-list">
            <SketchToolButton label="Line" description={TOOL_DESCRIPTIONS.line} active={sketchTool === "line"} hoverKey="line" onHoverTool={onHoverTool} onClick={() => onSketchTool("line")}>
              <SketchStrokeIcon>
                <path d="M7.2 16.8 16.8 7.2" />
                <circle cx="6" cy="18" r="1.7" fill="currentColor" stroke="none" />
                <circle cx="18" cy="6" r="1.7" fill="currentColor" stroke="none" />
              </SketchStrokeIcon>
            </SketchToolButton>
            <SketchToolButton label="Rectangle" description={TOOL_DESCRIPTIONS.rect} active={sketchTool === "rectangle"} hoverKey="rectangle" onHoverTool={onHoverTool} onClick={() => onSketchTool("rectangle")}>
              <RectangleHorizontal size={22} strokeWidth={2.2} className="sketch-tool-icon" />
            </SketchToolButton>
            <SketchToolButton label="Circle" description={TOOL_DESCRIPTIONS.circle} active={sketchTool === "circle"} hoverKey="circle" onHoverTool={onHoverTool} onClick={() => onSketchTool("circle")}>
              <Circle size={22} strokeWidth={2.2} className="sketch-tool-icon" />
            </SketchToolButton>
            <SketchToolButton label="Offset" description={TOOL_DESCRIPTIONS.offset} active={sketchTool === "offset"} hoverKey="offset" onHoverTool={onHoverTool} onClick={() => onSketchTool("offset")}>
              <SketchStrokeIcon>
                <path d="M4 7c4 0 6 3 10 3" />
                <path d="M4 13c4 0 6 4 12 4" />
                <path d="M15 7v5" />
                <path d="m13.2 10.2 1.8 1.8 1.8-1.8" />
              </SketchStrokeIcon>
            </SketchToolButton>
            <SketchToolButton label="Shapes" description="Curve, arc, and the other ready-made outlines." active={shapeActive || shapesOpen} hoverKey={shapeActive ? sketchTool : undefined} onHoverTool={onHoverTool} onClick={() => setShapesOpen((open) => !open)}>
              <Shapes size={22} strokeWidth={2.2} className="sketch-tool-icon" />
            </SketchToolButton>
          </div>
          {shapesOpen ? (
            <div className="sketch-tool-menu" role="group" aria-label="More shapes">
              <SketchToolButton label="Curve" description={TOOL_DESCRIPTIONS.bezier} active={sketchTool === "bezier"} hoverKey="bezier" onHoverTool={onHoverTool} onClick={() => pickShape("bezier")}>
                <SketchStrokeIcon>
                  <path d="M5 18C5 8 11 8 12 12s6 4 7-6" />
                  <circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none" />
                  <circle cx="19" cy="6" r="1.5" fill="currentColor" stroke="none" />
                </SketchStrokeIcon>
              </SketchToolButton>
              <SketchToolButton label="Arc" description={TOOL_DESCRIPTIONS.arc} active={sketchTool === "arc"} hoverKey="arc" onHoverTool={onHoverTool} onClick={() => pickShape("arc")}>
                <SketchStrokeIcon>
                  <path d="M5 17a8 8 0 0 1 14 0" />
                  <circle cx="5" cy="17" r="1.4" fill="currentColor" stroke="none" />
                  <circle cx="19" cy="17" r="1.4" fill="currentColor" stroke="none" />
                </SketchStrokeIcon>
              </SketchToolButton>
              <SketchToolButton label="Ellipse" description={TOOL_DESCRIPTIONS.ellipse} active={sketchTool === "ellipse"} hoverKey="ellipse" onHoverTool={onHoverTool} onClick={() => pickShape("ellipse")}>
                <Circle size={22} strokeWidth={2.2} className="sketch-tool-icon sketch-tool-ellipse-icon" />
              </SketchToolButton>
              <SketchToolButton label="Square" description={TOOL_DESCRIPTIONS.square} active={sketchTool === "square"} hoverKey="square" onHoverTool={onHoverTool} onClick={() => pickShape("square")}>
                <Square size={22} strokeWidth={2.2} className="sketch-tool-icon" />
              </SketchToolButton>
              <SketchToolButton label="Rounded" description={TOOL_DESCRIPTIONS.roundRect} active={sketchTool === "roundRect"} hoverKey="roundRect" onHoverTool={onHoverTool} onClick={() => pickShape("roundRect")}>
                <Square size={22} strokeWidth={2.2} className="sketch-tool-icon sketch-tool-round-rect-icon" />
              </SketchToolButton>
              <SketchToolButton label="Slot" description={TOOL_DESCRIPTIONS.slot} active={sketchTool === "slot"} hoverKey="slot" onHoverTool={onHoverTool} onClick={() => pickShape("slot")}>
                <SketchStrokeIcon>
                  <rect x="3" y="8" width="18" height="8" rx="4" />
                </SketchStrokeIcon>
              </SketchToolButton>
              <SketchToolButton label="Triangle" description={TOOL_DESCRIPTIONS.triangle} active={sketchTool === "triangle"} hoverKey="triangle" onHoverTool={onHoverTool} onClick={() => pickShape("triangle")}>
                <Triangle size={22} strokeWidth={2.2} className="sketch-tool-icon" />
              </SketchToolButton>
              <SketchToolButton label="Polygon" description={TOOL_DESCRIPTIONS.polygon} active={sketchTool === "polygon"} hoverKey="polygon" onHoverTool={onHoverTool} onClick={() => pickShape("polygon")}>
                <Hexagon size={22} strokeWidth={2.2} className="sketch-tool-icon" />
              </SketchToolButton>
              <SketchToolButton label="Star" description={TOOL_DESCRIPTIONS.star} active={sketchTool === "star"} hoverKey="star" onHoverTool={onHoverTool} onClick={() => pickShape("star")}>
                <Star size={22} strokeWidth={2.2} className="sketch-tool-icon" />
              </SketchToolButton>
            </div>
          ) : null}
        </section>
        {sketchTool === "polygon" ? (
          <section className="editor-tool-sidebar-section">
            <div className="editor-tool-sidebar-header">Sides</div>
            <div className="sketch-polygon-sides" aria-label="Polygon side count">
              <button
                type="button"
                aria-label="Fewer sides"
                disabled={polygonSides <= MIN_SKETCH_POLYGON_SIDES}
                onClick={() => onPolygonSidesChange(polygonSides - 1)}
              >
                <Minus size={14} strokeWidth={2.4} />
              </button>
              <span>{polygonSides}</span>
              <button
                type="button"
                aria-label="More sides"
                disabled={polygonSides >= MAX_SKETCH_POLYGON_SIDES}
                onClick={() => onPolygonSidesChange(polygonSides + 1)}
              >
                <Plus size={14} strokeWidth={2.4} />
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

/** Finish actions — Extrude / Revolve / Sweep, in the top bar beside Settings. */
export function SketchFinishToolbar({
  onSketchExtrude,
  onSketchRevolve,
  onSketchSweep,
  onSketchCancel,
  revolveDisabled = false,
}: {
  onSketchExtrude: () => void;
  onSketchRevolve: () => void;
  onSketchSweep: () => void;
  onSketchCancel: () => void;
  revolveDisabled?: boolean;
}) {
  const extrudeHelp = usePeakContextHelp("Extrude", TOOL_DESCRIPTIONS.extrude);
  const revolveHelp = usePeakContextHelp("Revolve", TOOL_DESCRIPTIONS.revolve);
  const sweepHelp = usePeakContextHelp("Sweep", TOOL_DESCRIPTIONS.sweep);
  const cancelHelp = usePeakContextHelp("Cancel", TOOL_DESCRIPTIONS.cancelSketch);

  return (
    <section className="editor-file-group sketch-finish-toolbar" aria-label="Turn the sketch into a solid">
      <div className="toolbar-section-label">Finish</div>
      <div className="toolbar-section-tools">
        <button className="editor-file-action sketch-finish-action primary" type="button" data-lesson-target="extrude" aria-label="Extrude" data-tool-help={TOOL_DESCRIPTIONS.extrude} onClick={onSketchExtrude} onContextMenu={extrudeHelp.onContextMenu}>
          <Check size={16} strokeWidth={2.4} />
          <span>Extrude</span>
          {extrudeHelp.helpPortal}
        </button>
        <button
          className="editor-file-action sketch-finish-action"
          type="button"
          data-lesson-target="revolve"
          aria-label="Revolve"
          data-tool-help={TOOL_DESCRIPTIONS.revolve}
          disabled={revolveDisabled}
          title={revolveDisabled ? "Revolve is only available on workplane sketches" : undefined}
          onClick={onSketchRevolve}
          onContextMenu={revolveHelp.onContextMenu}
        >
          <RotateCw size={16} strokeWidth={2.2} />
          <span>Revolve</span>
          {revolveHelp.helpPortal}
        </button>
        <button className="editor-file-action sketch-finish-action" type="button" data-lesson-target="sweep" aria-label="Sweep" data-tool-help={TOOL_DESCRIPTIONS.sweep} onClick={onSketchSweep} onContextMenu={sweepHelp.onContextMenu}>
          <Spline size={16} strokeWidth={2.2} />
          <span>Sweep</span>
          {sweepHelp.helpPortal}
        </button>
        <button className="editor-file-action sketch-finish-action cancel" type="button" data-lesson-target="cancel" aria-label="Cancel" data-tool-help={TOOL_DESCRIPTIONS.cancelSketch} onClick={onSketchCancel} onContextMenu={cancelHelp.onContextMenu}>
          <X size={16} strokeWidth={2.4} />
          <span>Cancel</span>
          {cancelHelp.helpPortal}
        </button>
      </div>
    </section>
  );
}

const PEAKCAD_PRO_SKETCH_TOOLS = new Set<SketchTool>([
  "dimension",
  "constrain-h",
  "constrain-v",
  "constrain-equal",
  "constrain-parallel",
  "constrain-perp",
  "constrain-tangent",
  "constrain-symmetry",
  "constrain-coincident",
  "constrain-midpoint",
  "constrain-fix",
  "constrain-concentric",
]);

/** Sketch tools that stay hidden until PeakCAD Pro is on. */
export function isPeakcadProSketchTool(tool: SketchTool) {
  return PEAKCAD_PRO_SKETCH_TOOLS.has(tool);
}

/** Left rail while sketching: select, inspect, constrain, modify. */
export function SketchUtilitySidebar({
  sketchTool,
  onSketchTool,
  onSketchImage,
  proEnabled,
  onHoverTool,
}: {
  sketchTool: SketchTool;
  onSketchTool: (tool: SketchTool) => void;
  onSketchImage: () => void;
  proEnabled: boolean;
  onHoverTool?: (tool: SketchCoachKey | null) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTools: SketchTool[] = ["refine", "smooth", "trim", "fillet", "chamfer", "mirror", "pattern", "circular-pattern", "stroke"];
  const moreActive = moreTools.includes(sketchTool);
  const pick = (tool: SketchTool) => {
    onSketchTool(tool);
    setMoreOpen(false);
  };
  return (
    <aside className="editor-tool-sidebar sketch-utility-sidebar" aria-label="Sketch utility tools">
      <div className="editor-tool-sidebar-scroll">
        <section className="editor-tool-sidebar-section">
          <div className="editor-tool-sidebar-header">Select</div>
          <div className="editor-tool-sidebar-list">
            <SketchToolButton label="Select" description={TOOL_DESCRIPTIONS.select} active={sketchTool === "select"} hoverKey="select" onHoverTool={onHoverTool} onClick={() => onSketchTool("select")}>
              <MousePointer2 size={22} strokeWidth={1.75} className="sketch-tool-icon" />
            </SketchToolButton>
            <SketchToolButton label="Erase" description={TOOL_DESCRIPTIONS.erase} active={sketchTool === "erase"} hoverKey="erase" onHoverTool={onHoverTool} onClick={() => onSketchTool("erase")}>
              <Eraser size={22} strokeWidth={1.75} className="sketch-tool-icon" />
            </SketchToolButton>
            <SketchToolButton label="More" description="Bend, trim, fillet, chamfer, mirror, and patterns." active={moreActive || moreOpen} onHoverTool={onHoverTool} onClick={() => setMoreOpen((open) => !open)}>
              <Ellipsis size={22} strokeWidth={1.75} className="sketch-tool-icon" />
            </SketchToolButton>
          </div>
          {moreOpen ? (
            <div className="sketch-tool-menu" role="group" aria-label="More sketch tools">
              <SketchToolButton label="Bend" description={TOOL_DESCRIPTIONS.refine} active={sketchTool === "refine"} hoverKey="refine" onHoverTool={onHoverTool} onClick={() => pick("refine")}>
                <SketchStrokeIcon>
                  <path d="M4 16c4-7 12-7 16 0" />
                  <circle cx="4" cy="16" r="1.5" fill="currentColor" stroke="none" />
                  <circle cx="12" cy="10.2" r="1.5" fill="currentColor" stroke="none" />
                  <circle cx="20" cy="16" r="1.5" fill="currentColor" stroke="none" />
                </SketchStrokeIcon>
              </SketchToolButton>
              <SketchToolButton label="Smooth" description={TOOL_DESCRIPTIONS.smooth} active={sketchTool === "smooth"} hoverKey="smooth" onHoverTool={onHoverTool} onClick={() => pick("smooth")}>
                <SketchStrokeIcon>
                  <path d="M3 16c3.2-8 5.8-8 9 0s5.8 8 9 0" />
                </SketchStrokeIcon>
              </SketchToolButton>
              <SketchToolButton label="Trim" description="Cut off the piece of a line you click." active={sketchTool === "trim"} hoverKey="trim" onHoverTool={onHoverTool} onClick={() => pick("trim")}>
                <SketchTrimIcon />
              </SketchToolButton>
              <SketchToolButton label="Fillet" description="Select a corner or a whole shape, then set the radius." active={sketchTool === "fillet"} hoverKey="fillet" onHoverTool={onHoverTool} onClick={() => pick("fillet")}>
                <ToolbarFilletIcon />
              </SketchToolButton>
              <SketchToolButton label="Chamfer" description="Select a corner or a whole shape, then set the distance." active={sketchTool === "chamfer"} hoverKey="chamfer" onHoverTool={onHoverTool} onClick={() => pick("chamfer")}>
                <ToolbarChamferIcon />
              </SketchToolButton>
              <SketchToolButton label="Mirror" description="Click a straight line. The sketch is copied across it." active={sketchTool === "mirror"} hoverKey="mirror" onHoverTool={onHoverTool} onClick={() => pick("mirror")}>
                <ToolbarMirrorIcon />
              </SketchToolButton>
              <SketchToolButton label="Linear pattern" description="Repeat the selection in rows." active={sketchTool === "pattern"} hoverKey="pattern" onHoverTool={onHoverTool} onClick={() => pick("pattern")}>
                <SketchRectPatternIcon />
              </SketchToolButton>
              <SketchToolButton label="Circular pattern" description="Spin copies around the middle of the selection." active={sketchTool === "circular-pattern"} hoverKey="circular-pattern" onHoverTool={onHoverTool} onClick={() => pick("circular-pattern")}>
                <ToolbarCircularPatternIcon />
              </SketchToolButton>
              <SketchToolButton label="Lineweight" description={TOOL_DESCRIPTIONS.stroke} active={sketchTool === "stroke"} hoverKey="stroke" onHoverTool={onHoverTool} onClick={() => pick("stroke")}>
                <Minus size={22} strokeWidth={1.75} className="sketch-tool-icon" />
              </SketchToolButton>
              <SketchToolButton label="Image" description={TOOL_DESCRIPTIONS.image} hoverKey="image" onHoverTool={onHoverTool} onClick={() => { setMoreOpen(false); onSketchImage(); }}>
                <Image size={22} strokeWidth={1.75} className="sketch-tool-icon" />
              </SketchToolButton>
            </div>
          ) : null}
        </section>
        {proEnabled ? (
        <section className="editor-tool-sidebar-section">
          <div className="editor-tool-sidebar-header">Inspect</div>
          <div className="editor-tool-sidebar-list">
            <SketchToolButton label="Dimension" description="Add a driving length dimension (Fusion D)." active={sketchTool === "dimension"} hoverKey="dimension" onHoverTool={onHoverTool} onClick={() => onSketchTool("dimension")}>
              <SketchDimensionIcon />
            </SketchToolButton>
          </div>
        </section>
        ) : null}
        {proEnabled ? (
        <section className="editor-tool-sidebar-section">
          <div className="editor-tool-sidebar-header">Constraints</div>
          <div className="editor-tool-sidebar-list">
            <SketchToolButton label="Coincident" description="Join two points so they stay together." active={sketchTool === "constrain-coincident"} hoverKey="constrain-coincident" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-coincident")}>
              <SketchConstraintCoincidentIcon />
            </SketchToolButton>
            <SketchToolButton label="Horizontal" description="Make a line, or two points, horizontal." active={sketchTool === "constrain-h"} hoverKey="constrain-h" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-h")}>
              <SketchConstraintHorizontalIcon />
            </SketchToolButton>
            <SketchToolButton label="Vertical" description="Make a line vertical." active={sketchTool === "constrain-v"} hoverKey="constrain-v" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-v")}>
              <SketchConstraintVerticalIcon />
            </SketchToolButton>
            <SketchToolButton label="Equal" description="Make two lines equal length." active={sketchTool === "constrain-equal"} hoverKey="constrain-equal" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-equal")}>
              <SketchConstraintEqualIcon />
            </SketchToolButton>
            <SketchToolButton label="Parallel" description="Make two lines parallel." active={sketchTool === "constrain-parallel"} hoverKey="constrain-parallel" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-parallel")}>
              <SketchConstraintParallelIcon />
            </SketchToolButton>
            <SketchToolButton label="Right angle" description="Make two lines meet at a right angle." active={sketchTool === "constrain-perp"} hoverKey="constrain-perp" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-perp")}>
              <SketchConstraintPerpendicularIcon />
            </SketchToolButton>
            <SketchToolButton label="Tangent" description="Make a line tangent to a circle. Click the line, then the circle." active={sketchTool === "constrain-tangent"} hoverKey="constrain-tangent" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-tangent")}>
              <SketchConstraintTangentIcon />
            </SketchToolButton>
            <SketchToolButton label="Midpoint" description="Lock a point to the middle of a line." active={sketchTool === "constrain-midpoint"} hoverKey="constrain-midpoint" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-midpoint")}>
              <SketchConstraintMidpointIcon />
            </SketchToolButton>
            <SketchToolButton label="Concentric" description="Share a center between two circles." active={sketchTool === "constrain-concentric"} hoverKey="constrain-concentric" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-concentric")}>
              <SketchConstraintConcentricIcon />
            </SketchToolButton>
            <SketchToolButton label="Fix" description="Lock a point or line so the solver cannot move it." active={sketchTool === "constrain-fix"} hoverKey="constrain-fix" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-fix")}>
              <SketchConstraintFixIcon />
            </SketchToolButton>
            <SketchToolButton label="Symmetry" description="Mirror two points or lines across an axis (select pair + axis line)." active={sketchTool === "constrain-symmetry"} hoverKey="constrain-symmetry" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-symmetry")}>
              <SketchConstraintSymmetryIcon />
            </SketchToolButton>
          </div>
        </section>
        ) : null}
      </div>
    </aside>
  );
}

function RibbonTool({
  label,
  description,
  active,
  ready,
  disabled,
  primary,
  cancel,
  lessonTarget,
  armed,
  hoverKey,
  sageKey,
  onHoverTool,
  onClick,
  children,
}: {
  label: string;
  description: string;
  active?: boolean;
  ready?: boolean;
  disabled?: boolean;
  primary?: boolean;
  cancel?: boolean;
  lessonTarget?: string;
  armed?: boolean;
  sageKey?: string;
  hoverKey?: SketchCoachKey;
  onHoverTool?: (tool: SketchCoachKey | null) => void;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  const { onContextMenu, helpPortal } = usePeakContextHelp(label, description);
  return (
    <button
      className={`sketch-ribbon-tool${active ? " active" : ""}${ready && !active ? " is-ready" : ""}${primary ? " primary" : ""}${cancel ? " cancel" : ""}${armed ? " is-erase-all" : ""}`}
      type="button"
      data-lesson-target={lessonTarget ?? label.toLowerCase()}
      aria-label={label}
      data-tool-help={description}
      data-sage-key={sageKey}
      aria-pressed={armed ? true : undefined}
      disabled={disabled}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onPointerEnter={() => {
        if (hoverKey) onHoverTool?.(hoverKey);
      }}
      onPointerLeave={() => onHoverTool?.(null)}
    >
      {children}
      <span>{label}</span>
      {helpPortal}
    </button>
  );
}

const SHAPE_TOOLS: SketchTool[] = ["square", "roundRect", "slot", "triangle", "polygon", "star", "ellipse"];

/** One horizontal strip while a sketch is open. Solid tools return when it closes. */
export function SketchRibbon({
  sketchTool,
  polygonSides,
  hasSelection,
  proEnabled,
  eraseWhole = false,
  onSketchTool,
  onEraseWholeChange,
  onPolygonSidesChange,
  onSketchImage,
  onTracePhoto,
  onHoverTool,
}: {
  sketchTool: SketchTool;
  polygonSides: number;
  hasSelection: boolean;
  proEnabled: boolean;
  eraseWhole?: boolean;
  onSketchTool: (tool: SketchTool) => void;
  onEraseWholeChange?: (whole: boolean) => void;
  onPolygonSidesChange: (sides: number) => void;
  onSketchImage: () => void;
  onTracePhoto?: () => void;
  onHoverTool?: (tool: SketchCoachKey | null) => void;
}) {
  const [shapesOpen, setShapesOpen] = useState(false);
  const shapesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shapesOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && shapesRef.current?.contains(target)) return;
      setShapesOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [shapesOpen]);
  const pickShape = (tool: SketchTool) => {
    onSketchTool(tool);
    setShapesOpen(false);
  };
  const shapeActive = SHAPE_TOOLS.includes(sketchTool);
  return (
    <div className="sketch-ribbon" role="toolbar" aria-label="Sketch">
      <section className="sketch-ribbon-group">
        <span>Select</span>
        <div className="sketch-ribbon-tools">
          <RibbonTool label="Select" description={TOOL_DESCRIPTIONS.select} active={sketchTool === "select"} hoverKey="select" onHoverTool={onHoverTool} onClick={() => onSketchTool("select")}>
            <MousePointer2 size={16} strokeWidth={1.75} />
          </RibbonTool>
        </div>
      </section>
      <section className="sketch-ribbon-group" ref={shapesRef}>
        <span>Draw</span>
        <div className="sketch-ribbon-tools">
          <RibbonTool label="Line" description={TOOL_DESCRIPTIONS.line} active={sketchTool === "line"} hoverKey="line" onHoverTool={onHoverTool} onClick={() => onSketchTool("line")}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M7 17 17 7" /></svg>
          </RibbonTool>
          <RibbonTool label="Arc" description={TOOL_DESCRIPTIONS.arc} active={sketchTool === "arc"} hoverKey="arc" onHoverTool={onHoverTool} onClick={() => onSketchTool("arc")}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M5 17a8 8 0 0 1 14 0" /></svg>
          </RibbonTool>
          <RibbonTool label="Curve" description={TOOL_DESCRIPTIONS.bezier} active={sketchTool === "bezier"} hoverKey="bezier" onHoverTool={onHoverTool} onClick={() => onSketchTool("bezier")}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M5 18C5 8 11 8 12 12s6 4 7-6" /></svg>
          </RibbonTool>
          <RibbonTool label="Rectangle" description={TOOL_DESCRIPTIONS.rect} active={sketchTool === "rectangle"} hoverKey="rectangle" onHoverTool={onHoverTool} onClick={() => onSketchTool("rectangle")}>
            <RectangleHorizontal size={16} strokeWidth={1.75} />
          </RibbonTool>
          <RibbonTool label="Circle" description={TOOL_DESCRIPTIONS.circle} active={sketchTool === "circle"} hoverKey="circle" onHoverTool={onHoverTool} onClick={() => onSketchTool("circle")}>
            <Circle size={16} strokeWidth={1.75} />
          </RibbonTool>
          <RibbonTool label="Shapes" description="Square, rounded, slot, triangle, polygon, star, and ellipse." active={shapeActive || shapesOpen} onHoverTool={onHoverTool} onClick={() => setShapesOpen((open) => !open)}>
            <Shapes size={16} strokeWidth={1.75} />
          </RibbonTool>
          {sketchTool === "polygon" ? (
            <div className="sketch-ribbon-sides" aria-label="Polygon side count">
              <button type="button" aria-label="Fewer sides" disabled={polygonSides <= MIN_SKETCH_POLYGON_SIDES} onClick={() => onPolygonSidesChange(polygonSides - 1)}>
                <Minus size={12} strokeWidth={2.4} />
              </button>
              <span>{polygonSides}</span>
              <button type="button" aria-label="More sides" disabled={polygonSides >= MAX_SKETCH_POLYGON_SIDES} onClick={() => onPolygonSidesChange(polygonSides + 1)}>
                <Plus size={12} strokeWidth={2.4} />
              </button>
            </div>
          ) : null}
        </div>
        {shapesOpen ? (
          <div className="sketch-ribbon-shapes" role="menu" aria-label="Shapes">
            {([
              ["square", "Square"],
              ["roundRect", "Rounded"],
              ["slot", "Slot"],
              ["triangle", "Triangle"],
              ["polygon", "Polygon"],
              ["star", "Star"],
              ["ellipse", "Ellipse"],
            ] as const).map(([tool, label]) => (
              <button
                key={tool}
                type="button"
                role="menuitem"
                className={sketchTool === tool ? "active" : ""}
                data-lesson-target={label.toLowerCase()}
                data-sage-key="sketch-shape"
                onClick={() => pickShape(tool)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </section>
      <section className="sketch-ribbon-group">
        <span>Change</span>
        <div className="sketch-ribbon-tools">
          <RibbonTool label="Offset" description={TOOL_DESCRIPTIONS.offset} active={sketchTool === "offset"} ready={hasSelection} hoverKey="offset" onHoverTool={onHoverTool} onClick={() => onSketchTool("offset")}>
            <Plus size={16} strokeWidth={1.75} />
          </RibbonTool>
          <RibbonTool label="Fillet" sageKey="sketch-fillet" description="Select a corner or a whole shape, then set the radius." active={sketchTool === "fillet"} ready={hasSelection} hoverKey="fillet" onHoverTool={onHoverTool} onClick={() => onSketchTool("fillet")}>
            <ToolbarFilletIcon />
          </RibbonTool>
          <RibbonTool label="Chamfer" sageKey="sketch-chamfer" description="Select a corner or a whole shape, then set the distance." active={sketchTool === "chamfer"} ready={hasSelection} hoverKey="chamfer" onHoverTool={onHoverTool} onClick={() => onSketchTool("chamfer")}>
            <ToolbarChamferIcon />
          </RibbonTool>
          <RibbonTool label="Trim" description="Cut off the piece of a line you click." active={sketchTool === "trim"} ready={hasSelection} hoverKey="trim" onHoverTool={onHoverTool} onClick={() => onSketchTool("trim")}>
            <SketchTrimIcon />
          </RibbonTool>
          <RibbonTool label="Mirror" sageKey="sketch-mirror" description="Click a straight line. The sketch is copied across it." active={sketchTool === "mirror"} ready={hasSelection} hoverKey="mirror" onHoverTool={onHoverTool} onClick={() => onSketchTool("mirror")}>
            <ToolbarMirrorIcon />
          </RibbonTool>
          <RibbonTool
            label="Erase"
            description={TOOL_DESCRIPTIONS.erase}
            active={sketchTool === "erase"}
            armed={eraseWhole}
            ready={hasSelection}
            hoverKey="erase"
            onHoverTool={onHoverTool}
            onClick={(event) => {
              if (event.detail > 1) return;
              if (sketchTool === "erase") onEraseWholeChange?.(!eraseWhole);
              else if (onEraseWholeChange) onEraseWholeChange(false);
              else onSketchTool("erase");
            }}
          >
            <Eraser size={16} strokeWidth={1.75} />
          </RibbonTool>
        </div>
      </section>
      <section className="sketch-ribbon-group">
        <span>Adjust</span>
        <div className="sketch-ribbon-tools">
          <RibbonTool label="Bend" description={TOOL_DESCRIPTIONS.refine} active={sketchTool === "refine"} hoverKey="refine" onHoverTool={onHoverTool} onClick={() => onSketchTool("refine")}>
            <Spline size={16} strokeWidth={1.75} />
          </RibbonTool>
          <RibbonTool label="Smooth" description={TOOL_DESCRIPTIONS.smooth} active={sketchTool === "smooth"} hoverKey="smooth" onHoverTool={onHoverTool} onClick={() => onSketchTool("smooth")}>
            <Spline size={16} strokeWidth={1.75} />
          </RibbonTool>
          <RibbonTool label="Linear" sageKey="sketch-linear" description="Repeat the selection in rows." lessonTarget="linear pattern" active={sketchTool === "pattern"} hoverKey="pattern" onHoverTool={onHoverTool} onClick={() => onSketchTool("pattern")}>
            <SketchRectPatternIcon />
          </RibbonTool>
          <RibbonTool label="Circular" sageKey="sketch-circular" description="Spin copies around the middle of the selection." lessonTarget="circular pattern" active={sketchTool === "circular-pattern"} hoverKey="circular-pattern" onHoverTool={onHoverTool} onClick={() => onSketchTool("circular-pattern")}>
            <ToolbarCircularPatternIcon />
          </RibbonTool>
          <RibbonTool label="Lineweight" description={TOOL_DESCRIPTIONS.stroke} active={sketchTool === "stroke"} hoverKey="stroke" onHoverTool={onHoverTool} onClick={() => onSketchTool("stroke")}>
            <Minus size={16} strokeWidth={1.75} />
          </RibbonTool>
          <RibbonTool label="Image" description={TOOL_DESCRIPTIONS.image} hoverKey="image" onHoverTool={onHoverTool} onClick={onSketchImage}>
            <Image size={16} strokeWidth={1.75} />
          </RibbonTool>
          {onTracePhoto ? (
            <RibbonTool label="Trace photo" sageKey="sketch-trace-photo" description={TOOL_DESCRIPTIONS.tracePhoto} onClick={onTracePhoto}>
              <ScanLine size={16} strokeWidth={1.75} />
            </RibbonTool>
          ) : null}
        </div>
      </section>
      {proEnabled ? (
        <section className="sketch-ribbon-group">
          <span>Rules</span>
          <div className="sketch-ribbon-tools">
            <RibbonTool label="Dimension" description="Add a driving length dimension." active={sketchTool === "dimension"} hoverKey="dimension" onHoverTool={onHoverTool} onClick={() => onSketchTool("dimension")}>
              <SketchDimensionIcon />
            </RibbonTool>
            <RibbonTool label="Coincident" description="Join two points so they stay together." active={sketchTool === "constrain-coincident"} hoverKey="constrain-coincident" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-coincident")}>
              <SketchConstraintCoincidentIcon />
            </RibbonTool>
            <RibbonTool label="Horizontal" description="Make a line, or two points, horizontal." active={sketchTool === "constrain-h"} hoverKey="constrain-h" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-h")}>
              <SketchConstraintHorizontalIcon />
            </RibbonTool>
            <RibbonTool label="Vertical" description="Make a line vertical." active={sketchTool === "constrain-v"} hoverKey="constrain-v" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-v")}>
              <SketchConstraintVerticalIcon />
            </RibbonTool>
            <RibbonTool label="Equal" description="Make two lines equal length." active={sketchTool === "constrain-equal"} hoverKey="constrain-equal" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-equal")}>
              <SketchConstraintEqualIcon />
            </RibbonTool>
            <RibbonTool label="Parallel" description="Make two lines parallel." active={sketchTool === "constrain-parallel"} hoverKey="constrain-parallel" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-parallel")}>
              <SketchConstraintParallelIcon />
            </RibbonTool>
            <RibbonTool label="Right angle" description="Make two lines meet at a right angle." active={sketchTool === "constrain-perp"} hoverKey="constrain-perp" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-perp")}>
              <SketchConstraintPerpendicularIcon />
            </RibbonTool>
            <RibbonTool label="Tangent" description="Make a line tangent to a circle." active={sketchTool === "constrain-tangent"} hoverKey="constrain-tangent" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-tangent")}>
              <SketchConstraintTangentIcon />
            </RibbonTool>
            <RibbonTool label="Midpoint" description="Lock a point to the middle of a line." active={sketchTool === "constrain-midpoint"} hoverKey="constrain-midpoint" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-midpoint")}>
              <SketchConstraintMidpointIcon />
            </RibbonTool>
            <RibbonTool label="Concentric" description="Share a center between two circles." active={sketchTool === "constrain-concentric"} hoverKey="constrain-concentric" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-concentric")}>
              <SketchConstraintConcentricIcon />
            </RibbonTool>
            <RibbonTool label="Fix" description="Lock a point or line so it cannot move." active={sketchTool === "constrain-fix"} hoverKey="constrain-fix" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-fix")}>
              <SketchConstraintFixIcon />
            </RibbonTool>
            <RibbonTool label="Symmetry" description="Mirror two points or lines across an axis." active={sketchTool === "constrain-symmetry"} hoverKey="constrain-symmetry" onHoverTool={onHoverTool} onClick={() => onSketchTool("constrain-symmetry")}>
              <SketchConstraintSymmetryIcon />
            </RibbonTool>
          </div>
        </section>
      ) : null}
    </div>
  );
}
