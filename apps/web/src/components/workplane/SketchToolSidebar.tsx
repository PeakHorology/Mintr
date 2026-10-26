"use client";

import type { ReactNode } from "react";
import {
  Check,
  Circle,
  Eraser,
  Hexagon,
  Image,
  Minus,
  MousePointer2,
  Plus,
  RectangleHorizontal,
  RotateCw,
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
  offset: { title: "Offset", body: "Click a line to copy a parallel line beside it." },
  select: { title: "Select", body: "Click a line or point to move it, or pick a shape tool on the right." },
  refine: { title: "Bend", body: "Drag a point to pull the line into a curve." },
  erase: { title: "Erase", body: "Click the line or point you want to remove." },
  trim: { title: "Trim", body: "Click the piece of a line you want to cut off." },
  fillet: { title: "Fillet", body: "Click two lines that meet to round that corner." },
  chamfer: { title: "Chamfer", body: "Click two lines that meet to cut that corner straight." },
  mirror: { title: "Mirror", body: "Select what to copy, then click the line to flip across." },
  pattern: { title: "Linear pattern", body: "Select what to repeat, then set how many copies." },
  "circular-pattern": { title: "Circular pattern", body: "Select a shape. Copies spin around its middle." },
  stroke: { title: "Lineweight", body: "Give a line thickness so it can extrude as a wall." },
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
            <SketchToolButton label="Curve" description={TOOL_DESCRIPTIONS.bezier} active={sketchTool === "bezier"} hoverKey="bezier" onHoverTool={onHoverTool} onClick={() => onSketchTool("bezier")}>
              <SketchStrokeIcon>
                <path d="M5 18C5 8 11 8 12 12s6 4 7-6" />
                <circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="19" cy="6" r="1.5" fill="currentColor" stroke="none" />
              </SketchStrokeIcon>
            </SketchToolButton>
            <SketchToolButton label="Circle" description={TOOL_DESCRIPTIONS.circle} active={sketchTool === "circle"} hoverKey="circle" onHoverTool={onHoverTool} onClick={() => onSketchTool("circle")}>
              <Circle size={22} strokeWidth={2.2} className="sketch-tool-icon" />
            </SketchToolButton>
            <SketchToolButton label="Rectangle" description={TOOL_DESCRIPTIONS.rect} active={sketchTool === "rectangle"} hoverKey="rectangle" onHoverTool={onHoverTool} onClick={() => onSketchTool("rectangle")}>
              <RectangleHorizontal size={22} strokeWidth={2.2} className="sketch-tool-icon" />
            </SketchToolButton>
            <SketchToolButton label="Arc" description={TOOL_DESCRIPTIONS.arc} active={sketchTool === "arc"} hoverKey="arc" onHoverTool={onHoverTool} onClick={() => onSketchTool("arc")}>
              <SketchStrokeIcon>
                <path d="M5 17a8 8 0 0 1 14 0" />
                <circle cx="5" cy="17" r="1.4" fill="currentColor" stroke="none" />
                <circle cx="19" cy="17" r="1.4" fill="currentColor" stroke="none" />
              </SketchStrokeIcon>
            </SketchToolButton>
            <SketchToolButton label="Ellipse" description={TOOL_DESCRIPTIONS.ellipse} active={sketchTool === "ellipse"} hoverKey="ellipse" onHoverTool={onHoverTool} onClick={() => onSketchTool("ellipse")}>
              <Circle size={22} strokeWidth={2.2} className="sketch-tool-icon sketch-tool-ellipse-icon" />
            </SketchToolButton>
            <SketchToolButton label="Square" description={TOOL_DESCRIPTIONS.square} active={sketchTool === "square"} hoverKey="square" onHoverTool={onHoverTool} onClick={() => onSketchTool("square")}>
              <Square size={22} strokeWidth={2.2} className="sketch-tool-icon" />
            </SketchToolButton>
            <SketchToolButton label="Rounded" description={TOOL_DESCRIPTIONS.roundRect} active={sketchTool === "roundRect"} hoverKey="roundRect" onHoverTool={onHoverTool} onClick={() => onSketchTool("roundRect")}>
              <Square size={22} strokeWidth={2.2} className="sketch-tool-icon sketch-tool-round-rect-icon" />
            </SketchToolButton>
            <SketchToolButton label="Slot" description={TOOL_DESCRIPTIONS.slot} active={sketchTool === "slot"} hoverKey="slot" onHoverTool={onHoverTool} onClick={() => onSketchTool("slot")}>
              <SketchStrokeIcon>
                <rect x="3" y="8" width="18" height="8" rx="4" />
              </SketchStrokeIcon>
            </SketchToolButton>
            <SketchToolButton label="Triangle" description={TOOL_DESCRIPTIONS.triangle} active={sketchTool === "triangle"} hoverKey="triangle" onHoverTool={onHoverTool} onClick={() => onSketchTool("triangle")}>
              <Triangle size={22} strokeWidth={2.2} className="sketch-tool-icon" />
            </SketchToolButton>
            <SketchToolButton label="Polygon" description={TOOL_DESCRIPTIONS.polygon} active={sketchTool === "polygon"} hoverKey="polygon" onHoverTool={onHoverTool} onClick={() => onSketchTool("polygon")}>
              <Hexagon size={22} strokeWidth={2.2} className="sketch-tool-icon" />
            </SketchToolButton>
            <SketchToolButton label="Star" description={TOOL_DESCRIPTIONS.star} active={sketchTool === "star"} hoverKey="star" onHoverTool={onHoverTool} onClick={() => onSketchTool("star")}>
              <Star size={22} strokeWidth={2.2} className="sketch-tool-icon" />
            </SketchToolButton>
            <SketchToolButton label="Offset" description={TOOL_DESCRIPTIONS.offset} active={sketchTool === "offset"} hoverKey="offset" onHoverTool={onHoverTool} onClick={() => onSketchTool("offset")}>
              <SketchStrokeIcon>
                <path d="M4 7c4 0 6 3 10 3" />
                <path d="M4 13c4 0 6 4 12 4" />
                <path d="M15 7v5" />
                <path d="m13.2 10.2 1.8 1.8 1.8-1.8" />
              </SketchStrokeIcon>
            </SketchToolButton>
          </div>
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
      <div className="toolbar-section-label">Next</div>
      <div className="toolbar-section-tools">
        <button className="editor-file-action sketch-finish-action primary" type="button" data-lesson-target="extrude" onClick={onSketchExtrude} onContextMenu={extrudeHelp.onContextMenu}>
          <Check size={15} strokeWidth={2.6} />
          <span>Extrude</span>
          {extrudeHelp.helpPortal}
        </button>
        <button
          className={`editor-file-action sketch-finish-action${revolveDisabled ? " disabled" : ""}`}
          type="button"
          onClick={onSketchRevolve}
          disabled={revolveDisabled}
          title={revolveDisabled ? "Revolve is only available on workplane sketches" : undefined}
          onContextMenu={revolveHelp.onContextMenu}
        >
          <RotateCw size={15} strokeWidth={2.6} />
          <span>Revolve</span>
          {revolveHelp.helpPortal}
        </button>
        <button className="editor-file-action sketch-finish-action" type="button" onClick={onSketchSweep} onContextMenu={sweepHelp.onContextMenu}>
          <Spline size={15} strokeWidth={2.6} />
          <span>Sweep</span>
          {sweepHelp.helpPortal}
        </button>
        <button className="editor-file-action sketch-finish-action cancel" type="button" onClick={onSketchCancel} onContextMenu={cancelHelp.onContextMenu}>
          <X size={15} strokeWidth={2.6} />
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
  return (
    <aside className="editor-tool-sidebar sketch-utility-sidebar" aria-label="Sketch utility tools">
      <div className="editor-tool-sidebar-scroll">
        <section className="editor-tool-sidebar-section">
          <div className="editor-tool-sidebar-header">Select</div>
          <div className="editor-tool-sidebar-list">
            <SketchToolButton label="Select" description={TOOL_DESCRIPTIONS.select} active={sketchTool === "select"} hoverKey="select" onHoverTool={onHoverTool} onClick={() => onSketchTool("select")}>
              <MousePointer2 size={22} strokeWidth={1.75} className="sketch-tool-icon" />
            </SketchToolButton>
            <SketchToolButton label="Image" description={TOOL_DESCRIPTIONS.image} hoverKey="image" onHoverTool={onHoverTool} onClick={onSketchImage}>
              <Image size={22} strokeWidth={1.75} className="sketch-tool-icon" />
            </SketchToolButton>
            <SketchToolButton label="Bend" description={TOOL_DESCRIPTIONS.refine} active={sketchTool === "refine"} hoverKey="refine" onHoverTool={onHoverTool} onClick={() => onSketchTool("refine")}>
              <SketchStrokeIcon>
                <path d="M4 16c4-7 12-7 16 0" />
                <circle cx="4" cy="16" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="12" cy="10.2" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="20" cy="16" r="1.5" fill="currentColor" stroke="none" />
              </SketchStrokeIcon>
            </SketchToolButton>
            <SketchToolButton label="Erase" description={TOOL_DESCRIPTIONS.erase} active={sketchTool === "erase"} hoverKey="erase" onHoverTool={onHoverTool} onClick={() => onSketchTool("erase")}>
              <Eraser size={22} strokeWidth={1.75} className="sketch-tool-icon" />
            </SketchToolButton>
          </div>
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
        <section className="editor-tool-sidebar-section">
          <div className="editor-tool-sidebar-header">Modify</div>
          <div className="editor-tool-sidebar-list">
            <SketchToolButton label="Smooth" description={TOOL_DESCRIPTIONS.smooth} active={sketchTool === "smooth"} hoverKey="smooth" onHoverTool={onHoverTool} onClick={() => onSketchTool("smooth")}>
              <SketchStrokeIcon>
                <path d="M3 16c3.2-8 5.8-8 9 0s5.8 8 9 0" />
              </SketchStrokeIcon>
            </SketchToolButton>
            <SketchToolButton label="Trim" description="Cut off the piece of a line you click." active={sketchTool === "trim"} hoverKey="trim" onHoverTool={onHoverTool} onClick={() => onSketchTool("trim")}>
              <SketchTrimIcon />
            </SketchToolButton>
            <SketchToolButton label="Fillet" description="Round the corner where two lines meet." active={sketchTool === "fillet"} hoverKey="fillet" onHoverTool={onHoverTool} onClick={() => onSketchTool("fillet")}>
              <ToolbarFilletIcon />
            </SketchToolButton>
            <SketchToolButton label="Chamfer" description="Cut the corner where two lines meet." active={sketchTool === "chamfer"} hoverKey="chamfer" onHoverTool={onHoverTool} onClick={() => onSketchTool("chamfer")}>
              <ToolbarChamferIcon />
            </SketchToolButton>
            <SketchToolButton label="Mirror" description="Mirror selection across a line." active={sketchTool === "mirror"} hoverKey="mirror" onHoverTool={onHoverTool} onClick={() => onSketchTool("mirror")}>
              <ToolbarMirrorIcon />
            </SketchToolButton>
            <SketchToolButton label="Linear pattern" description="Repeat the selection in rows." active={sketchTool === "pattern"} hoverKey="pattern" onHoverTool={onHoverTool} onClick={() => onSketchTool("pattern")}>
              <SketchRectPatternIcon />
            </SketchToolButton>
            <SketchToolButton label="Circular pattern" description="Spin copies around the middle of the selection. Works on lines, curves, circles, and arcs." active={sketchTool === "circular-pattern"} hoverKey="circular-pattern" onHoverTool={onHoverTool} onClick={() => onSketchTool("circular-pattern")}>
              <ToolbarCircularPatternIcon />
            </SketchToolButton>
            <SketchToolButton label="Lineweight" description={TOOL_DESCRIPTIONS.stroke} active={sketchTool === "stroke"} hoverKey="stroke" onHoverTool={onHoverTool} onClick={() => onSketchTool("stroke")}>
              <Minus size={22} strokeWidth={1.75} className="sketch-tool-icon" />
            </SketchToolButton>
          </div>
        </section>
      </div>
    </aside>
  );
}
