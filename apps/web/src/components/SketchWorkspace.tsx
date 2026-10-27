"use client";

import { ChevronUp, Eye, EyeOff, Home, Link, Link2Off, Minus, Plus, Ruler, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { SnapGridControl } from "@/components/workplane/ShapeInspector";
import { ThumbRangeInput } from "@/components/workplane/ThumbRangeInput";
import { InlineValueDialog } from "@/components/workplane/InlineValueDialog";
import { SketchSnapGlyph } from "@/components/workplane/SketchSnapGlyph";
import { PeakTipButton } from "@/components/workplane/ToolNameTooltip";
import { sketchOffsetAt } from "@/lib/sketchDrawShapes";
import { defaultSketchPlane, isDefaultSketchPlane } from "@/lib/sketchPlane";
import { faceReferenceBounds } from "@/lib/sketchFaceReference";
import { closedProfilesFromLegacy, CONSTRAINT_LABELS, curveStandInOwner, parseLineEntry, pointAtLengthAngle, screenAngleDeg, shapeMovePointIds, sketchCenterSnapPoints, sketchCornerMarks, snapHeading, snapSketchPoint, wholeEraseTarget, type SketchConstraint, type SketchDefinitionStatus, type SketchDimension, type SketchEntity, type SketchSnapResult } from "@/lib/sketch";
import { TOOL_DESCRIPTIONS } from "@/lib/toolDescriptions";
import { sketchReferenceNode, type SketchReferenceNode } from "@/lib/sketchReferenceFootprint";
import { mirrorSign } from "@/lib/workplaneShapes";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE, normalizeSnapGrid, normalizeWorkspaceSettings } from "@/lib/workplaneSettings";
import { normalizePrinterBed } from "@/lib/printerBed";
import type { GridSize, SketchImage, SketchPoint, SketchProfile, SketchSegment, WorkplaneShape, WorkplaneWorkspaceSettings } from "@/types/sketchforge";

export type SketchTool =
  | "line"
  | "bezier"
  | "smooth"
  | "circle"
  | "ellipse"
  | "square"
  | "rectangle"
  | "roundRect"
  | "slot"
  | "triangle"
  | "polygon"
  | "star"
  | "arc"
  | "offset"
  | "select"
  | "refine"
  | "erase"
  | "measure"
  | "dimension"
  | "trim"
  | "fillet"
  | "chamfer"
  | "mirror"
  | "pattern"
  | "circular-pattern"
  | "constrain-h"
  | "constrain-v"
  | "constrain-equal"
  | "constrain-parallel"
  | "constrain-perp"
  | "constrain-tangent"
  | "constrain-symmetry"
  | "constrain-coincident"
  | "constrain-midpoint"
  | "constrain-fix"
  | "constrain-concentric"
  | "stroke";
export type SketchSelection =
  | { kind: "point"; id: string }
  | { kind: "segment"; id: string }
  | { kind: "image"; id: string }
  | { kind: "multiple"; pointIds: string[]; segmentIds: string[]; imageIds?: string[] }
  | null;
export type SketchMeasurement = { start: SketchPoint; end: SketchPoint } | null;

type SketchWorkspaceProps = {
  profile: SketchProfile;
  referenceShapes: WorkplaneShape[];
  tool: SketchTool;
  /** Double-clicked Erase: one click removes a whole closed shape or line. */
  eraseWhole?: boolean;
  activePointId: string | null;
  selected: SketchSelection;
  measurement: SketchMeasurement;
  pendingMeasurementStart: SketchPoint | null;
  initialSnap?: GridSize;
  initialWorkspace?: WorkplaneWorkspaceSettings;
  /** Keep project/3D snap in sync when the sketch Snap Grid control changes. */
  onSnapChange?: (snap: GridSize) => void;
  selectedProfileIds?: string[];
  activeSnap?: SketchSnapResult | null;
  showDimensions?: boolean;
  dimensions?: SketchDimension[];
  showConstraints?: boolean;
  constraints?: SketchConstraint[];
  constraintEntities?: SketchEntity[];
  constraintConflicts?: string[];
  solveStatus?: SketchDefinitionStatus;
  solveDof?: number;
  /** Outline and path chosen for Sweep, drawn in mint. */
  sweepMarkIds?: string[];
  onPlanePoint: (point: { x: number; z: number }, handles?: { handleIn: { x: number; z: number }; handleOut: { x: number; z: number } }) => void;
  onDrawCircle: (center: { x: number; z: number }, radius: number) => void;
  onDrawEllipse: (origin: { x: number; z: number }, corner: { x: number; z: number }) => void;
  onDrawSquare: (origin: { x: number; z: number }, corner: { x: number; z: number }) => void;
  onDrawRectangle: (origin: { x: number; z: number }, corner: { x: number; z: number }) => void;
  onDrawRoundRect: (origin: { x: number; z: number }, corner: { x: number; z: number }) => void;
  onDrawSlot: (origin: { x: number; z: number }, corner: { x: number; z: number }) => void;
  onDrawTriangle: (center: { x: number; z: number }, vertex: { x: number; z: number }) => void;
  onDrawPolygon: (center: { x: number; z: number }, vertex: { x: number; z: number }) => void;
  onDrawStar: (center: { x: number; z: number }, tip: { x: number; z: number }) => void;
  onDrawArc: (start: { x: number; z: number }, end: { x: number; z: number }, through: { x: number; z: number }) => void;
  onOffsetSegment: (segmentId: string, toward: { x: number; z: number }) => void;
  /** Clicking a closed outline while Offset is active targets that outline. */
  onBeginOffsetProfile?: (profileId: string) => void;
  /** Preview of a typed offset, in sketch coordinates. */
  offsetGhost?: Array<{ x: number; z: number }> | null;
  polygonSides?: number;
  onPointPress: (id: string, handles?: { handleIn: { x: number; z: number }; handleOut: { x: number; z: number } }) => void;
  onSelectSegment: (id: string, at?: { x: number; z: number }) => void;
  onSelectMany: (pointIds: string[], segmentIds: string[], imageIds: string[]) => void;
  onSelectImage: (id: string) => void;
  onUpdateImage: (id: string, patch: Partial<SketchImage>, message?: string) => void;
  onDeleteImage: (id: string) => void;
  onDeletePoint: (id: string) => void;
  onDeleteSegment: (id: string) => void;
  onEraseEntities: (pointIds: string[], segmentIds: string[]) => void;
  onMovePoint: (id: string, point: { x: number; z: number }, alsoPointIds?: string[]) => void;
  onMoveHandle: (id: string, handle: "in" | "out", point: { x: number; z: number }) => void;
  onInsertPoint: (segmentId: string, point: { x: number; z: number }) => void;
  onSetPointMode: (id: string, mode: "corner" | "smooth" | "split") => void;
  onClearMeasurement: () => void;
  onSelectProfile?: (profileId: string) => void;
  onEditDimension?: (dimensionId: string, value: number) => void;
  onSnapResolved?: (snap: SketchSnapResult | null) => void;
  /** Activate/deactivate the measure tool (lives on the view controls, like 3D ruler). */
  onToolChange?: (tool: SketchTool) => void;
  /** Optional toast/notice for empty-tool feedback (e.g. dimension on empty plate). */
  onNotice?: (message: string) => void;
  showConstruction?: boolean;
  /** Construction lines that live on the sketch document but not yet on the profile. */
  constructionGuides?: Array<{ id: string; x1: number; z1: number; x2: number; z2: number }>;
  onEditSegmentLength?: (segmentId: string, length: number, grow: "end" | "both") => void;
  onEditCornerAngle?: (pointId: string, degrees: number, leg: 0 | 1) => void;
  onEditCircleRadius?: (circleId: string, radius: number) => void;
  /** Stable id for this sketch so Flat pan/zoom can return after 3D sketch. */
  viewKey?: string;
  /** Mint outline from a guide, drawn so the learner can trace it. */
  guideGhost?: { points: { x: number; z: number }[]; segments: { start: number; end: number }[] } | null;
};

type PathStep = { segment: SketchSegment; from: SketchPoint; to: SketchPoint };
type DisplayPath = { id: string; points: SketchPoint[]; steps: PathStep[]; closed: boolean };
type PointerAction =
  | { kind: "bezier"; pointerId: number; origin: { x: number; z: number }; current: { x: number; z: number }; joinPointId?: string }
  | { kind: "circle"; pointerId: number; origin: { x: number; z: number }; current: { x: number; z: number } }
  | { kind: "ellipse"; pointerId: number; origin: { x: number; z: number }; current: { x: number; z: number } }
  | { kind: "square"; pointerId: number; origin: { x: number; z: number }; current: { x: number; z: number } }
  | { kind: "rectangle"; pointerId: number; origin: { x: number; z: number }; current: { x: number; z: number } }
  | { kind: "roundRect"; pointerId: number; origin: { x: number; z: number }; current: { x: number; z: number } }
  | { kind: "slot"; pointerId: number; origin: { x: number; z: number }; current: { x: number; z: number } }
  | { kind: "triangle"; pointerId: number; origin: { x: number; z: number }; current: { x: number; z: number } }
  | { kind: "polygon"; pointerId: number; origin: { x: number; z: number }; current: { x: number; z: number } }
  | { kind: "star"; pointerId: number; origin: { x: number; z: number }; current: { x: number; z: number } }
  | { kind: "offset"; pointerId: number; segmentId: string; current: { x: number; z: number } }
  | { kind: "erase"; pointerId: number; current: { x: number; z: number } }
  | { kind: "move-point"; pointerId: number; pointId: string; current: { x: number; z: number }; alsoPointIds?: string[] }
  | { kind: "move-outline"; pointerId: number; pointIds: string[]; origin: { x: number; z: number }; current: { x: number; z: number } }
  | { kind: "resize-circle"; pointerId: number; circleId: string; center: { x: number; z: number }; radius: number; current: { x: number; z: number } }
  | { kind: "move-handle"; pointerId: number; pointId: string; handle: "in" | "out"; current: { x: number; z: number } }
  | { kind: "pan"; pointerId: number; clientX: number; clientY: number }
  | { kind: "marquee"; pointerId: number; origin: { x: number; z: number }; current: { x: number; z: number } }
  | { kind: "move-image"; pointerId: number; imageId: string; origin: { x: number; z: number }; current: { x: number; z: number }; start: SketchImage }
  | { kind: "resize-image"; pointerId: number; imageId: string; handle: ResizeHandle; current: { x: number; z: number }; start: SketchImage };

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

function snapStep(size: GridSize) {
  if (size === "Off") return 0;
  return Number.parseFloat(size) || 1;
}

function snapValue(value: number, step: number) {
  return step > 0 ? Math.round(value / step) * step : value;
}

/** Last Flat sketch pan/zoom, kept when 3D sketch unmounts the plate so return restores it. */
let rememberedFlatSketchView: { key: string; zoom: number; pan: { x: number; z: number } } | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function resizeSketchImage(start: SketchImage, handle: ResizeHandle, point: { x: number; z: number }): Partial<SketchImage> {
  const minimum = 0.5;
  const startsWest = handle.includes("w");
  const startsEast = handle.includes("e");
  const startsNorth = handle.includes("n");
  const startsSouth = handle.includes("s");
  const minX = start.x - start.width / 2;
  const maxX = start.x + start.width / 2;
  const minZ = start.z - start.depth / 2;
  const maxZ = start.z + start.depth / 2;
  const aspect = start.width / Math.max(minimum, start.depth);

  if (start.lockAspect !== false) {
    if ((startsWest || startsEast) && (startsNorth || startsSouth)) {
      const fixedX = startsWest ? maxX : minX;
      const fixedZ = startsNorth ? maxZ : minZ;
      const widthScale = Math.abs(point.x - fixedX) / Math.max(minimum, start.width);
      const depthScale = Math.abs(point.z - fixedZ) / Math.max(minimum, start.depth);
      const scale = Math.max(minimum / Math.min(start.width, start.depth), widthScale, depthScale);
      const width = Math.max(minimum, start.width * scale);
      const depth = Math.max(minimum, start.depth * scale);
      const xDirection = startsWest ? -1 : 1;
      const zDirection = startsNorth ? -1 : 1;
      return { width, depth, x: fixedX + xDirection * width / 2, z: fixedZ + zDirection * depth / 2 };
    }
    if (startsWest || startsEast) {
      const fixedX = startsWest ? maxX : minX;
      const width = Math.max(minimum, Math.abs(point.x - fixedX));
      return { width, depth: Math.max(minimum, width / aspect), x: fixedX + (startsWest ? -1 : 1) * width / 2 };
    }
    const fixedZ = startsNorth ? maxZ : minZ;
    const depth = Math.max(minimum, Math.abs(point.z - fixedZ));
    return { depth, width: Math.max(minimum, depth * aspect), z: fixedZ + (startsNorth ? -1 : 1) * depth / 2 };
  }

  let nextMinX = minX;
  let nextMaxX = maxX;
  let nextMinZ = minZ;
  let nextMaxZ = maxZ;
  if (startsWest) nextMinX = Math.min(point.x, maxX - minimum);
  if (startsEast) nextMaxX = Math.max(point.x, minX + minimum);
  if (startsNorth) nextMinZ = Math.min(point.z, maxZ - minimum);
  if (startsSouth) nextMaxZ = Math.max(point.z, minZ + minimum);
  return {
    x: (nextMinX + nextMaxX) / 2,
    z: (nextMinZ + nextMaxZ) / 2,
    width: nextMaxX - nextMinX,
    depth: nextMaxZ - nextMinZ,
  };
}

function formatDimension(value: number, accuracy: 1 | 2 | 3) {
  const threshold = 0.5 * 10 ** -accuracy;
  return (Math.abs(value) < threshold ? 0 : value).toFixed(accuracy);
}

const CONSTRAINT_GLYPH: Record<SketchConstraint["kind"], string> = {
  horizontal: "H",
  vertical: "V",
  coincident: "●",
  midpoint: "M",
  parallel: "∥",
  perpendicular: "⊥",
  equal: "=",
  concentric: "◎",
  tangent: "T",
  symmetry: "⇄",
  fix: "🔒",
};

/** The curve a Bézier drag will commit: previous point to the click, pulled by the mirrored handle. */
function bezierDragPreview(
  start: { x: number; z: number; handleOut?: { x: number; z: number } },
  end: { x: number; z: number },
  incoming: { x: number; z: number },
) {
  const leave = start.handleOut ?? start;
  return `M ${start.x} ${start.z} C ${leave.x} ${leave.z} ${incoming.x} ${incoming.z} ${end.x} ${end.z}`;
}

function sketchEntityPointIds(entity: SketchEntity): string[] {
  switch (entity.kind) {
    case "point":
      return [entity.id];
    case "line":
    case "bezier":
    case "smooth":
      return [entity.startId, entity.endId];
    case "arc":
      return [entity.centerId, entity.startId, entity.endId];
    case "circle":
      return [entity.centerId];
    default:
      return [];
  }
}

function constraintGlyphAnchor(
  constraint: SketchConstraint,
  entities: SketchEntity[],
  pointById: Map<string, SketchPoint>,
): { x: number; z: number } | null {
  const centers: Array<{ x: number; z: number }> = [];
  for (const pointId of constraint.pointIds ?? []) {
    const point = pointById.get(pointId);
    if (point) centers.push({ x: point.x, z: point.z });
  }
  for (const entityId of constraint.entityIds) {
    const entity = entities.find((item) => item.id === entityId);
    if (!entity) continue;
    if (entity.kind === "point") {
      centers.push({ x: entity.x, z: entity.z });
      continue;
    }
    const pts = sketchEntityPointIds(entity)
      .map((id) => pointById.get(id))
      .filter((item): item is SketchPoint => Boolean(item));
    if (!pts.length) continue;
    centers.push({
      x: pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
      z: pts.reduce((sum, p) => sum + p.z, 0) / pts.length,
    });
  }
  if (!centers.length) return null;
  return {
    x: centers.reduce((sum, p) => sum + p.x, 0) / centers.length,
    z: centers.reduce((sum, p) => sum + p.z, 0) / centers.length,
  };
}

function dimensionPillSize(label: string, screenUnit: number, extra = 24) {
  return {
    width: Math.max(48, label.length * 7.5 + extra) * screenUnit,
    height: 26 * screenUnit,
    radius: 5 * screenUnit,
  };
}

function sideCalloutPill(label: string, screenUnit: number) {
  return {
    width: Math.max(36, label.length * 7.2 + 14) * screenUnit,
    height: 20 * screenUnit,
    radius: 4 * screenUnit,
  };
}

type SideCallout = {
  key: string;
  segmentId: string | null;
  circleId: string | null;
  length: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  nx: number;
  nz: number;
};

/** One straight side, with the direction that points outside its closed shape. */
function lineSideCallout(
  profile: SketchProfile,
  paths: DisplayPath[],
  segmentId: string,
  pointById: Map<string, SketchPoint>,
): SideCallout | null {
  if (!segmentId || curveStandInOwner(segmentId)) return null;
  const segment = profile.segments.find((entry) => entry.id === segmentId);
  if (!segment || segment.construction || (segment.kind && segment.kind !== "line")) return null;
  const dimension = segmentDimension(segment, pointById);
  if (!dimension || !(dimension.length > 1e-6)) return null;
  const path = paths.find((entry) => entry.closed && entry.steps.some((step) => step.segment.id === segment.id));
  const step = path?.steps.find((entry) => entry.segment.id === segment.id);
  const from = step?.from ?? pointById.get(segment.startId);
  const to = step?.to ?? pointById.get(segment.endId);
  if (!from || !to) return null;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const span = Math.hypot(dx, dz) || 1;
  let nx = dz / span;
  let nz = -dx / span;
  if (path && path.points.length >= 3) {
    let area = 0;
    for (let index = 0; index < path.points.length; index += 1) {
      const current = path.points[index];
      const next = path.points[(index + 1) % path.points.length];
      area += current.x * next.z - next.x * current.z;
    }
    if (area < 0) {
      nx = -nx;
      nz = -nz;
    }
  } else if (nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  return {
    key: segment.id,
    segmentId: segment.id,
    circleId: null,
    length: dimension.length,
    ax: from.x,
    az: from.z,
    bx: to.x,
    bz: to.z,
    nx,
    nz,
  };
}

/** Opposite sides of a rectangle share a length. Keep the one that sits below or to the right. */
function dedupeParallelCallouts(callouts: SideCallout[]): SideCallout[] {
  const kept: SideCallout[] = [];
  const score = (item: SideCallout) => item.nz * 2 + item.nx;
  for (const callout of callouts) {
    const dx = callout.bx - callout.ax;
    const dz = callout.bz - callout.az;
    const span = Math.hypot(dx, dz) || 1;
    const match = kept.find((other) => {
      const odx = other.bx - other.ax;
      const odz = other.bz - other.az;
      const ospan = Math.hypot(odx, odz) || 1;
      const parallel = Math.abs((dx * odx + dz * odz) / (span * ospan)) > 0.985;
      return parallel && Math.abs(other.length - callout.length) < 0.05;
    });
    if (!match) {
      kept.push(callout);
      continue;
    }
    if (score(callout) > score(match)) kept[kept.indexOf(match)] = callout;
  }
  return kept;
}

function selectedSideCallouts(
  profile: SketchProfile,
  paths: DisplayPath[],
  selected: SketchSelection,
  pointById: Map<string, SketchPoint>,
  circles: Array<{ id: string; cx: number; cz: number; radius: number; construction?: boolean }>,
): SideCallout[] {
  const segmentIds = selected?.kind === "segment"
    ? [selected.id]
    : selected?.kind === "multiple"
      ? selected.segmentIds
      : [];
  if (!segmentIds.length) return [];
  const lines = segmentIds
    .map((id) => lineSideCallout(profile, paths, id, pointById))
    .filter((entry): entry is SideCallout => entry !== null);
  if (segmentIds.length === 1) return lines;
  if (lines.length) return dedupeParallelCallouts(lines);
  const circleIds = [...new Set(segmentIds.map((id) => curveStandInOwner(id)).filter((id): id is string => Boolean(id)))];
  const circleCallouts = circleIds.flatMap((id) => {
    const circle = circles.find((entry) => entry.id === id && !entry.construction);
    if (!circle || !(circle.radius > 0)) return [];
    return [{
      key: `circle-${circle.id}`,
      segmentId: null,
      circleId: circle.id,
      length: circle.radius * 2,
      ax: circle.cx - circle.radius,
      az: circle.cz + circle.radius,
      bx: circle.cx + circle.radius,
      bz: circle.cz + circle.radius,
      nx: 0,
      nz: 1,
    } satisfies SideCallout];
  });
  if (circleCallouts.length) return circleCallouts;
  if (selected?.kind !== "multiple") return [];
  const points = selected.pointIds.flatMap((id) => {
    const point = pointById.get(id);
    if (!point || curveStandInOwner(point.id)) return [];
    return [point];
  });
  if (points.length < 3) return [];
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));
  const width = maxX - minX;
  const length = maxZ - minZ;
  if (!(width > 1e-6) || !(length > 1e-6)) return [];
  return [
    { key: "width", segmentId: null, circleId: null, length: width, ax: minX, az: maxZ, bx: maxX, bz: maxZ, nx: 0, nz: 1 },
    { key: "length", segmentId: null, circleId: null, length, ax: maxX, az: minZ, bx: maxX, bz: maxZ, nx: 1, nz: 0 },
  ];
}

function cubicPoint(start: SketchPoint, first: { x: number; z: number }, second: { x: number; z: number }, end: SketchPoint, amount: number) {
  const inverse = 1 - amount;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * amount * first.x + 3 * inverse * amount ** 2 * second.x + amount ** 3 * end.x,
    z: inverse ** 3 * start.z + 3 * inverse ** 2 * amount * first.z + 3 * inverse * amount ** 2 * second.z + amount ** 3 * end.z,
  };
}

function distancePointToSegment(point: { x: number; z: number }, start: { x: number; z: number }, end: { x: number; z: number }) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 1e-12) return Math.hypot(point.x - start.x, point.z - start.z);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSq));
  return Math.hypot(point.x - (start.x + dx * t), point.z - (start.z + dz * t));
}

function distanceToSketchSegment(
  point: { x: number; z: number },
  segment: SketchSegment,
  pointById: Map<string, SketchPoint>,
) {
  const start = pointById.get(segment.startId);
  const end = pointById.get(segment.endId);
  if (!start || !end) return Number.POSITIVE_INFINITY;
  const first = start.handleOut;
  const second = end.handleIn;
  if (segment.kind === "line" || !first || !second) {
    return distancePointToSegment(point, start, end);
  }
  let nearest = Number.POSITIVE_INFINITY;
  let previous = start;
  for (let index = 1; index <= 24; index += 1) {
    const sample = cubicPoint(start, first, second, end, index / 24);
    nearest = Math.min(nearest, distancePointToSegment(point, previous, sample));
    previous = sample as SketchPoint;
  }
  return nearest;
}

function collectEraseHits(
  tip: { x: number; z: number },
  radius: number,
  profile: SketchProfile,
  pointById: Map<string, SketchPoint>,
  pointIds: Set<string>,
  segmentIds: Set<string>,
) {
  let changed = false;
  for (const point of profile.points) {
    if (pointIds.has(point.id)) continue;
    if (Math.hypot(point.x - tip.x, point.z - tip.z) <= radius) {
      pointIds.add(point.id);
      changed = true;
      for (const segment of profile.segments) {
        if (segment.startId === point.id || segment.endId === point.id) {
          if (!segmentIds.has(segment.id)) {
            segmentIds.add(segment.id);
          }
        }
      }
    }
  }
  for (const segment of profile.segments) {
    if (segmentIds.has(segment.id)) continue;
    if (distanceToSketchSegment(tip, segment, pointById) <= radius) {
      segmentIds.add(segment.id);
      changed = true;
    }
  }
  return changed;
}

function sampleEraseStroke(from: { x: number; z: number }, to: { x: number; z: number }, step: number) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  if (distance < 1e-6) return [to];
  const count = Math.max(1, Math.ceil(distance / Math.max(step, 0.05)));
  const samples: Array<{ x: number; z: number }> = [];
  for (let index = 1; index <= count; index += 1) {
    const t = index / count;
    samples.push({
      x: from.x + (to.x - from.x) * t,
      z: from.z + (to.z - from.z) * t,
    });
  }
  return samples;
}

function angleArrow(x: number, z: number, dx: number, dz: number, size: number) {
  const length = Math.hypot(dx, dz) || 1;
  const ux = dx / length;
  const uz = dz / length;
  const wing = size * 0.42;
  const backX = x - ux * size;
  const backZ = z - uz * size;
  return `M ${x} ${z} L ${backX - uz * wing} ${backZ + ux * wing} L ${backX + uz * wing} ${backZ - ux * wing} Z`;
}

function segmentDimension(segment: SketchSegment, pointById: Map<string, SketchPoint>) {
  const start = pointById.get(segment.startId);
  const end = pointById.get(segment.endId);
  if (!start || !end) return null;
  const first = start.handleOut;
  const second = end.handleIn;
  if (segment.kind === "line" || !first || !second) {
    return {
      length: Math.hypot(end.x - start.x, end.z - start.z),
      midpoint: { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 },
    };
  }
  let length = 0;
  let previous = start;
  for (let index = 1; index <= 32; index += 1) {
    const point = cubicPoint(start, first, second, end, index / 32);
    length += Math.hypot(point.x - previous.x, point.z - previous.z);
    previous = { ...point, id: "curve-sample" };
  }
  return { length, midpoint: cubicPoint(start, first, second, end, 0.5) };
}

function orderedPaths(profile: SketchProfile): DisplayPath[] {
  const pointById = new Map(profile.points.map((point) => [point.id, point]));
  const adjacency = new Map<string, Array<{ pointId: string; segment: SketchSegment }>>();
  profile.points.forEach((point) => adjacency.set(point.id, []));
  const valid = profile.segments.filter((segment) => {
    if (!pointById.has(segment.startId) || !pointById.has(segment.endId)) return false;
    adjacency.get(segment.startId)?.push({ pointId: segment.endId, segment });
    adjacency.get(segment.endId)?.push({ pointId: segment.startId, segment });
    return true;
  });
  const unvisited = new Set(valid.map((segment) => segment.id));
  const paths: DisplayPath[] = [];
  while (unvisited.size > 0) {
    const seedId = unvisited.values().next().value as string;
    const seed = valid.find((segment) => segment.id === seedId);
    if (!seed) break;
    const component = new Set<string>();
    const queue = [seed.startId, seed.endId];
    while (queue.length) {
      const id = queue.pop();
      if (!id || component.has(id)) continue;
      component.add(id);
      adjacency.get(id)?.forEach((edge) => queue.push(edge.pointId));
    }
    const startId = [...component].find((id) => (adjacency.get(id)?.filter((edge) => unvisited.has(edge.segment.id)).length ?? 0) === 1) ?? seed.startId;
    const first = pointById.get(startId);
    if (!first) break;
    const points = [first];
    const steps: PathStep[] = [];
    let currentId = startId;
    for (let guard = 0; guard <= valid.length; guard += 1) {
      const edge = adjacency.get(currentId)?.find((candidate) => unvisited.has(candidate.segment.id));
      if (!edge) break;
      const from = pointById.get(currentId);
      const to = pointById.get(edge.pointId);
      if (!from || !to) break;
      unvisited.delete(edge.segment.id);
      steps.push({ segment: edge.segment, from, to });
      currentId = to.id;
      if (currentId === startId) break;
      points.push(to);
    }
    paths.push({ id: seed.id, points, steps, closed: currentId === startId && steps.length >= 3 });
  }
  return paths;
}

function curveControls(step: PathStep) {
  const forward = step.segment.startId === step.from.id;
  const rawFirst = forward ? step.from.handleOut : step.from.handleIn;
  const rawSecond = forward ? step.to.handleIn : step.to.handleOut;
  return {
    first: rawFirst ?? step.from,
    second: rawSecond ?? step.to,
    // A line point that was just curved only has handles on that point. The
    // other end still sits on the point, which is a real cubic control.
    curved: step.segment.kind !== "line" && Boolean(rawFirst || rawSecond),
  };
}

function pathData(path: DisplayPath) {
  const first = path.points[0];
  if (!first) return "";
  const commands = [`M ${first.x} ${first.z}`];
  path.steps.forEach((step) => {
    const controls = curveControls(step);
    if (controls.curved) {
      commands.push(`C ${controls.first.x} ${controls.first.z} ${controls.second.x} ${controls.second.z} ${step.to.x} ${step.to.z}`);
    } else {
      commands.push(`L ${step.to.x} ${step.to.z}`);
    }
  });
  if (path.closed) commands.push("Z");
  return commands.join(" ");
}

function lineweightStyle(weight?: number): { strokeWidth: number } | undefined {
  return weight && weight > 0 ? { strokeWidth: weight } : undefined;
}

/** One stroke per run of curve segments, so a point added on a curve does not leave a crease in the line. */
function curveStrokeRuns(path: DisplayPath): Array<{ d: string; weight?: number }> {
  const runs: Array<{ d: string; weight?: number }> = [];
  let commands: string[] = [];
  let weight: number | undefined;
  const flush = () => {
    if (commands.length > 1) runs.push({ d: commands.join(" "), weight });
    commands = [];
    weight = undefined;
  };
  for (const step of path.steps) {
    const controls = curveControls(step);
    if (step.segment.construction || !controls.curved) {
      flush();
      continue;
    }
    const nextWeight = step.segment.weight;
    if (commands.length > 0 && nextWeight !== weight) flush();
    if (commands.length === 0) {
      commands.push(`M ${step.from.x} ${step.from.z}`);
      weight = nextWeight;
    }
    commands.push(`C ${controls.first.x} ${controls.first.z} ${controls.second.x} ${controls.second.z} ${step.to.x} ${step.to.z}`);
  }
  flush();
  return runs;
}

function segmentData(segment: SketchSegment, pointById: Map<string, SketchPoint>) {
  const from = pointById.get(segment.startId);
  const to = pointById.get(segment.endId);
  if (!from || !to) return "";
  const step = { segment, from, to };
  const controls = curveControls(step);
  return controls.curved
    ? `M ${from.x} ${from.z} C ${controls.first.x} ${controls.first.z} ${controls.second.x} ${controls.second.z} ${to.x} ${to.z}`
    : `M ${from.x} ${from.z} L ${to.x} ${to.z}`;
}

function ReferenceMark({ node }: { node: SketchReferenceNode }) {
  return (
    <g transform={`translate(${node.x} ${node.z}) rotate(${node.rotation}) scale(${node.mirrorX} ${node.mirrorZ})`}>
      {node.imageHref ? (
        <image
          href={node.imageHref}
          x={-node.imageWidth / 2}
          y={-node.imageDepth / 2}
          width={node.imageWidth}
          height={node.imageDepth}
          preserveAspectRatio="none"
        />
      ) : node.fillD ? (
        <path
          className="sketch-reference-mesh-face"
          d={node.fillD}
          style={{ fill: node.color, fillOpacity: node.opacity, fillRule: node.evenOdd ? "evenodd" : "nonzero" }}
        />
      ) : null}
      {node.outlineD ? (
        <path
          className="sketch-reference-mesh-outline"
          d={node.outlineD}
          style={{ stroke: node.color }}
        />
      ) : null}
      {node.scaleX !== 1 || node.scaleZ !== 1 ? (
        <g transform={`scale(${node.scaleX} ${node.scaleZ})`}>
          {node.children.map((child, index) => <ReferenceMark key={index} node={child} />)}
        </g>
      ) : node.children.map((child, index) => <ReferenceMark key={index} node={child} />)}
    </g>
  );
}

export function SketchWorkspace({
  profile,
  referenceShapes,
  tool,
  eraseWhole = false,
  activePointId,
  selected,
  measurement,
  pendingMeasurementStart,
  initialSnap,
  initialWorkspace,
  onSnapChange,
  selectedProfileIds = [],
  activeSnap = null,
  showDimensions = true,
  dimensions = [],
  showConstraints = true,
  constraints = [],
  constraintEntities = [],
  constraintConflicts = [],
  solveStatus = "empty",
  solveDof = 0,
  sweepMarkIds = [],
  onPlanePoint,
  onDrawCircle,
  onDrawEllipse,
  onDrawSquare,
  onDrawRectangle,
  onDrawRoundRect,
  onDrawSlot,
  onDrawTriangle,
  onDrawPolygon,
  onDrawStar,
  onDrawArc,
  onOffsetSegment,
  onBeginOffsetProfile,
  offsetGhost = null,
  polygonSides = 6,
  onPointPress,
  onSelectSegment,
  onSelectMany,
  onSelectImage,
  onUpdateImage,
  onDeleteImage,
  onDeletePoint,
  onDeleteSegment,
  onEraseEntities,
  onMovePoint,
  onMoveHandle,
  onInsertPoint,
  onSetPointMode,
  onClearMeasurement,
  onSelectProfile,
  onEditDimension,
  onSnapResolved,
  onToolChange,
  onNotice,
  showConstruction = true,
  constructionGuides = [],
  onEditSegmentLength,
  onEditCornerAngle,
  onEditCircleRadius,
  viewKey,
  guideGhost = null,
}: SketchWorkspaceProps) {
  const workspace = useMemo(() => normalizeWorkspaceSettings(initialWorkspace, DEFAULT_WORKPLANE_WORKSPACE), [initialWorkspace]);
  const printerBed = useMemo(() => normalizePrinterBed(workspace), [workspace]);
  const showSketchPrinterBed = printerBed.showBed && isDefaultSketchPlane(profile.sketchPlane ?? defaultSketchPlane());
  const [snap, setSnap] = useState<GridSize>(() => normalizeSnapGrid(initialSnap, DEFAULT_SNAP_GRID));
  const [snapOpen, setSnapOpen] = useState(false);
  const [dimensionDialog, setDimensionDialog] = useState<{ id: string; value: number } | null>(null);

  // Stay aligned with the live 3D workplane Snap Grid / workspace settings.
  useEffect(() => {
    setSnap(normalizeSnapGrid(initialSnap, DEFAULT_SNAP_GRID));
  }, [initialSnap]);
  const resumeView = viewKey && rememberedFlatSketchView?.key === viewKey ? rememberedFlatSketchView : null;
  const [showMeasurements, setShowMeasurements] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("mintr.showSketchMeasurements") !== "0";
    } catch {
      return true;
    }
  });
  const [zoom, setZoom] = useState(resumeView?.zoom ?? 1);
  const [pan, setPan] = useState(resumeView?.pan ?? { x: 0, z: 0 });
  const faceFitKeyRef = useRef<string | null>(null);
  const viewKeyLiveRef = useRef(viewKey ?? "");
  viewKeyLiveRef.current = viewKey ?? "";
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  useEffect(() => {
    const loops = profile.faceReferenceLoops ?? [];
    if (loops.length === 0) {
      faceFitKeyRef.current = null;
      return;
    }
    const key = JSON.stringify(loops);
    if (faceFitKeyRef.current === key) return;
    faceFitKeyRef.current = key;
    if (viewKey && rememberedFlatSketchView?.key === viewKey) return;
    const bounds = faceReferenceBounds(loops);
    if (!bounds) return;
    const nextPan = { x: bounds.centerX, z: bounds.centerZ };
    const plate = Math.max(workspace.width, workspace.depth);
    const span = Math.max(bounds.width, bounds.depth, 8);
    const nextZoom = clamp(plate / (span * 1.6), 0.35, 6);
    panRef.current = nextPan;
    zoomRef.current = nextZoom;
    setPan(nextPan);
    setZoom(nextZoom);
  }, [profile.faceReferenceLoops, viewKey, workspace.depth, workspace.width]);

  useEffect(() => {
    return () => {
      const key = viewKeyLiveRef.current;
      if (!key) return;
      rememberedFlatSketchView = {
        key,
        zoom: zoomRef.current,
        pan: panRef.current,
      };
    };
  }, []);
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);
  const [lineEntry, setLineEntry] = useState("");
  const [lengthEdit, setLengthEdit] = useState<{ segmentId: string; value: number; grow: "end" | "both" } | null>(null);
  const [radiusEdit, setRadiusEdit] = useState<{ circleId: string; value: number } | null>(null);
  const [diameterEdit, setDiameterEdit] = useState<{ circleId: string; value: number } | null>(null);
  const [angleEdit, setAngleEdit] = useState<{ pointId: string; value: number; leg: 0 | 1 } | null>(null);
  const [pointerAction, setPointerAction] = useState<PointerAction | null>(null);
  const [arcDraft, setArcDraft] = useState<Array<{ x: number; z: number }>>([]);
  const [erasePreview, setErasePreview] = useState<{ pointIds: string[]; segmentIds: string[] } | null>(null);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const eraseStrokeRef = useRef<{ pointIds: Set<string>; segmentIds: Set<string> } | null>(null);
  const pointClickRef = useRef<{ id: string; at: number } | null>(null);
  const pendingPointDragRef = useRef<{ pointerId: number; pointId: string; x: number; z: number; clientX: number; clientY: number; alsoPointIds?: string[] } | null>(null);
  const plateWidth = workspace.width / zoom;
  const plateDepth = workspace.depth / zoom;
  const viewAspect = svgSize.width > 0 && svgSize.height > 0 ? svgSize.width / svgSize.height : plateWidth / plateDepth;
  const viewWidth = Math.max(plateWidth, plateDepth * viewAspect);
  const viewDepth = Math.max(plateDepth, plateWidth / viewAspect);
  const screenUnit = useMemo(() => {
    const fittedScale = Math.min(
      svgSize.width > 0 ? svgSize.width / viewWidth : 0,
      svgSize.height > 0 ? svgSize.height / viewDepth : 0,
    );
    return fittedScale > 0 ? 1 / fittedScale : Math.max(viewWidth, viewDepth) / 720;
  }, [svgSize.height, svgSize.width, viewDepth, viewWidth]);
  const displayProfile = useMemo(() => {
    if (pointerAction?.kind === "move-point") {
      const source = profile.points.find((point) => point.id === pointerAction.pointId);
      if (!source) return profile;
      const deltaX = pointerAction.current.x - source.x;
      const deltaZ = pointerAction.current.z - source.z;
      const moving = new Set(pointerAction.alsoPointIds && pointerAction.alsoPointIds.length > 1 ? pointerAction.alsoPointIds : [source.id]);
      return {
        ...profile,
        points: profile.points.map((point) => {
          if (!moving.has(point.id)) return point;
          return {
            ...point,
            x: point.id === source.id ? pointerAction.current.x : point.x + deltaX,
            z: point.id === source.id ? pointerAction.current.z : point.z + deltaZ,
            handleIn: point.handleIn ? { x: point.handleIn.x + deltaX, z: point.handleIn.z + deltaZ } : undefined,
            handleOut: point.handleOut ? { x: point.handleOut.x + deltaX, z: point.handleOut.z + deltaZ } : undefined,
          };
        }),
      };
    }
    if (pointerAction?.kind === "move-outline") {
      const deltaX = pointerAction.current.x - pointerAction.origin.x;
      const deltaZ = pointerAction.current.z - pointerAction.origin.z;
      if (deltaX === 0 && deltaZ === 0) return profile;
      const moving = new Set(pointerAction.pointIds);
      return {
        ...profile,
        points: profile.points.map((point) => {
          if (!moving.has(point.id)) return point;
          return {
            ...point,
            x: point.x + deltaX,
            z: point.z + deltaZ,
            handleIn: point.handleIn ? { x: point.handleIn.x + deltaX, z: point.handleIn.z + deltaZ } : undefined,
            handleOut: point.handleOut ? { x: point.handleOut.x + deltaX, z: point.handleOut.z + deltaZ } : undefined,
          };
        }),
      };
    }
    if (pointerAction?.kind === "move-handle") {
      return {
        ...profile,
        points: profile.points.map((point) => {
          if (point.id !== pointerAction.pointId) return point;
          const next = { ...point, handleIn: point.handleIn ? { ...point.handleIn } : undefined, handleOut: point.handleOut ? { ...point.handleOut } : undefined };
          if (pointerAction.handle === "in") next.handleIn = { ...pointerAction.current };
          else next.handleOut = { ...pointerAction.current };
          if (point.mode === "smooth") {
            const opposite = { x: point.x * 2 - pointerAction.current.x, z: point.z * 2 - pointerAction.current.z };
            if (pointerAction.handle === "in") next.handleOut = opposite;
            else next.handleIn = opposite;
          }
          return next;
        }),
      };
    }
    if (erasePreview && (erasePreview.pointIds.length || erasePreview.segmentIds.length)) {
      const removedPoints = new Set(erasePreview.pointIds);
      const removedSegments = new Set(erasePreview.segmentIds);
      return {
        ...profile,
        points: profile.points.filter((point) => !removedPoints.has(point.id)),
        segments: profile.segments.filter(
          (segment) =>
            !removedSegments.has(segment.id)
            && !removedPoints.has(segment.startId)
            && !removedPoints.has(segment.endId),
        ),
      };
    }
    return profile;
  }, [erasePreview, pointerAction, profile]);
  const displayImages = useMemo(() => {
    const images = profile.images ?? [];
    if (pointerAction?.kind === "move-image") {
      const deltaX = pointerAction.current.x - pointerAction.origin.x;
      const deltaZ = pointerAction.current.z - pointerAction.origin.z;
      return images.map((image) => image.id === pointerAction.imageId ? { ...image, x: pointerAction.start.x + deltaX, z: pointerAction.start.z + deltaZ } : image);
    }
    if (pointerAction?.kind === "resize-image") {
      return images.map((image) => image.id === pointerAction.imageId ? { ...image, ...resizeSketchImage(pointerAction.start, pointerAction.handle, pointerAction.current) } : image);
    }
    return images;
  }, [pointerAction, profile.images]);
  const pointById = useMemo(() => new Map(displayProfile.points.map((point) => [point.id, point])), [displayProfile.points]);
  const circleIds = useMemo(() => new Set(
    constraintEntities.flatMap((entity) => entity.kind === "circle" ? [entity.id] : []),
  ), [constraintEntities]);
  const isCircleStandIn = (id: string) => circleIds.has(curveStandInOwner(id) ?? "");
  const drawnCircles = useMemo(() => {
    const centers = new Map(
      constraintEntities.flatMap((entity) => entity.kind === "point" ? [[entity.id, entity] as const] : []),
    );
    return constraintEntities.flatMap((entity) => {
      if (entity.kind !== "circle") return [];
      const docCenter = centers.get(entity.centerId);
      if (!docCenter || docCenter.kind !== "point") return [];
      const live = pointById.get(entity.centerId);
      let cx = live?.x ?? docCenter.x;
      let cz = live?.z ?? docCenter.z;
      let radius = entity.radius;
      if (pointerAction?.kind === "resize-circle" && pointerAction.circleId === entity.id) {
        cx = pointerAction.center.x;
        cz = pointerAction.center.z;
        radius = Math.hypot(pointerAction.current.x - cx, pointerAction.current.z - cz);
      }
      if (!(radius > 0) || erasePreview?.segmentIds.includes(entity.id)) return [];
      return [{ id: entity.id, cx, cz, radius, construction: Boolean(entity.construction), weight: entity.weight }];
    });
  }, [constraintEntities, erasePreview, pointById, pointerAction]);
  const eraseWholePreview = useMemo(() => {
    if (tool !== "erase" || !eraseWhole || !hover) return null;
    const reach = Math.max(1.25, 12 * screenUnit);
    let nearestId: string | null = null;
    let nearest = reach;
    for (const segment of profile.segments) {
      if (curveStandInOwner(segment.id)) continue;
      const distance = distanceToSketchSegment(hover, segment, pointById);
      if (distance <= nearest) {
        nearest = distance;
        nearestId = segment.id;
      }
    }
    for (const circle of drawnCircles) {
      const distance = Math.abs(Math.hypot(hover.x - circle.cx, hover.z - circle.cz) - circle.radius);
      if (distance <= nearest) {
        nearest = distance;
        nearestId = circle.id;
      }
    }
    if (nearestId) return wholeEraseTarget(profile, { segmentId: nearestId }, constraintEntities);
    return wholeEraseTarget(profile, { at: hover }, constraintEntities);
  }, [constraintEntities, drawnCircles, eraseWhole, hover, pointById, profile, screenUnit, tool]);
  const eraseWholeSegmentIds = useMemo(() => new Set(eraseWholePreview?.segmentIds ?? []), [eraseWholePreview]);
  const eraseWholePointIds = useMemo(() => new Set(eraseWholePreview?.pointIds ?? []), [eraseWholePreview]);
  const paths = useMemo(() => orderedPaths(displayProfile), [displayProfile]);
  // Closed-region analysis is the most expensive per-render step on a busy
  // sketch; hover/cursor re-renders don't change the profile, so cache it and
  // pre-resolve each region's SVG path.
  const closedRegionFills = useMemo(
    () =>
      closedProfilesFromLegacy(displayProfile).flatMap((closedProfile) => {
        const path = paths.find((entry) => entry.closed && entry.points.some((point) => point.id === closedProfile.pointIds[0]));
        return path ? [{ closedProfile, d: pathData(path) }] : [];
      }),
    [displayProfile, paths],
  );
  const activePoint = activePointId ? pointById.get(activePointId) ?? null : null;
  const typedPreview = (() => {
    if (tool !== "line" || !activePoint || !lineEntry) return null;
    const parsed = parseLineEntry(lineEntry);
    if (!parsed) return null;
    const angle = parsed.angleDeg ?? (hover ? screenAngleDeg(activePoint, hover) : null);
    if (angle === null) return null;
    return pointAtLengthAngle(activePoint, parsed.length, angle);
  })();
  const rubberEnd = typedPreview ?? hover;
  useEffect(() => {
    if (tool !== "line") setLineEntry("");
  }, [tool]);
  useEffect(() => {
    if (tool !== "line" || !activePointId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        if (!lineEntry) return;
        event.preventDefault();
        setLineEntry("");
        return;
      }
      if (event.key === "Backspace") {
        if (!lineEntry) return;
        event.preventDefault();
        setLineEntry((current) => current.slice(0, -1));
        return;
      }
      if (event.key === "Enter") {
        if (!lineEntry || !activePoint) return;
        const parsed = parseLineEntry(lineEntry);
        if (!parsed) return;
        event.preventDefault();
        const angle = parsed.angleDeg ?? (hover ? screenAngleDeg(activePoint, hover) : null);
        if (angle === null) {
          onNotice?.("Move the pointer to set the angle, or type 50<30");
          return;
        }
        const placed = pointAtLengthAngle(activePoint, parsed.length, angle);
        setLineEntry("");
        onPlanePoint(placed);
        return;
      }
      if (/^[0-9.<+-]$/.test(event.key)) {
        event.preventDefault();
        setLineEntry((current) => `${current}${event.key}`.slice(0, 32));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePoint, activePointId, hover, lineEntry, onNotice, onPlanePoint, tool]);
  const selectedPoint = selected?.kind === "point" ? pointById.get(selected.id) ?? null : null;
  const selectedImage = selected?.kind === "image" ? displayImages.find((image) => image.id === selected.id) ?? null : null;
  const isPointSelected = (id: string) => selected?.kind === "point" ? selected.id === id : selected?.kind === "multiple" ? selected.pointIds.includes(id) : false;
  const isSegmentSelected = (id: string) => selected?.kind === "segment" ? selected.id === id : selected?.kind === "multiple" ? selected.segmentIds.includes(id) : false;
  const sweepMarks = useMemo(() => new Set(sweepMarkIds), [sweepMarkIds]);
  const isSweepMarked = (id: string) => sweepMarks.has(id) || sweepMarks.has(curveStandInOwner(id) ?? "");
  // Prefer Snap Grid spacing when active so the drawn plate matches 3D snap divisions;
  // otherwise fall back to the workplane grid block size.
  const snapGridStep = snapStep(snap);
  const gridStep = snapGridStep > 0
    ? clamp(snapGridStep, 0.1, 200)
    : clamp(workspace.gridBlockSize, 1, 200);
  const majorEvery = snapGridStep > 0
    ? Math.max(1, Math.round(workspace.gridBlockSize / snapGridStep) || 1)
    : 4;
  const verticalLines = useMemo(() => {
    const lines: number[] = [];
    const left = pan.x - viewWidth / 2;
    const right = pan.x + viewWidth / 2;
    const start = Math.ceil(left / gridStep) * gridStep;
    for (let x = start; x <= right + 0.0001; x += gridStep) lines.push(Number(x.toFixed(6)));
    return lines;
  }, [gridStep, pan.x, viewWidth]);
  const horizontalLines = useMemo(() => {
    const lines: number[] = [];
    const top = pan.z - viewDepth / 2;
    const bottom = pan.z + viewDepth / 2;
    const start = Math.ceil(top / gridStep) * gridStep;
    for (let z = start; z <= bottom + 0.0001; z += gridStep) lines.push(Number(z.toFixed(6)));
    return lines;
  }, [gridStep, pan.z, viewDepth]);

  const pointFromEvent = (
    event: { clientX: number; clientY: number; shiftKey?: boolean },
    from?: { x: number; z: number } | null,
    options?: { snap?: boolean; excludePointIds?: readonly string[]; headingStep?: number },
  ) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const screenPoint = svg.createSVGPoint();
    screenPoint.x = event.clientX;
    screenPoint.y = event.clientY;
    const local = screenPoint.matrixTransform(matrix.inverse());
    const step = snapStep(snap);
    const raw = { x: local.x, z: local.y };
    if (options?.snap === false) {
      onSnapResolved?.(null);
      return raw;
    }
    const anchorPoint = activePointId ? profile.points.find((point) => point.id === activePointId) : null;
    const anchor = from ?? (anchorPoint ? { x: anchorPoint.x, z: anchorPoint.z } : null);
    const guidePoints = showConstruction ? constructionGuides.flatMap((guide) => [
      { id: `${guide.id}-a`, x: guide.x1, z: guide.z1 },
      { id: `${guide.id}-b`, x: guide.x2, z: guide.z2 },
    ]) : [];
    const guideSegments = showConstruction ? constructionGuides.map((guide) => ({
      id: guide.id,
      startId: `${guide.id}-a`,
      endId: `${guide.id}-b`,
      kind: "line" as const,
      construction: true,
    })) : [];
    const snapProfile = {
      ...profile,
      points: [...profile.points, ...guidePoints],
      segments: [
        ...profile.segments.filter((segment) => showConstruction || !segment.construction),
        ...guideSegments,
      ],
    };
    const plane = profile.sketchPlane ?? defaultSketchPlane();
    const centers = sketchCenterSnapPoints(referenceShapes, plane).map((point) => (
      isDefaultSketchPlane(plane) ? { x: point.x, z: -point.z } : point
    ));
    const snapResult = snapSketchPoint(snapProfile, {
      cursor: raw,
      from: anchor,
      screenUnit,
      gridStep: step > 0 ? step : undefined,
      excludePointIds: options?.excludePointIds,
      centers,
    });
    const headed = options?.headingStep && anchor && (snapResult.kind === "grid" || snapResult.kind === "horizontal" || snapResult.kind === "vertical")
      ? snapHeading(anchor, snapResult, options.headingStep)
      : null;
    if (headed) {
      onSnapResolved?.(null);
      return { x: headed.x, z: headed.z };
    }
    onSnapResolved?.(snapResult);
    return { x: snapResult.x, z: snapResult.z };
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const updateSize = () => {
      const bounds = svg.getBoundingClientRect();
      setSvgSize({ width: bounds.width, height: bounds.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const beginPan = (event: ReactPointerEvent<SVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    setPointerAction({ kind: "pan", pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY });
  };

  useEffect(() => {
    if (tool !== "arc") {
      setArcDraft([]);
    }
  }, [tool]);

  useEffect(() => {
    if (tool !== "erase") {
      eraseStrokeRef.current = null;
      setErasePreview(null);
    }
  }, [tool]);

  const eraseBrushRadius = Math.max(1.25, 12 * screenUnit);

  const applyEraseTip = (tip: { x: number; z: number }, stroke = eraseStrokeRef.current) => {
    if (!stroke) return;
    const hitMap = new Map(profile.points.map((point) => [point.id, point]));
    const changed = collectEraseHits(tip, eraseBrushRadius, profile, hitMap, stroke.pointIds, stroke.segmentIds);
    for (const id of [...stroke.pointIds]) {
      if (isCircleStandIn(id)) stroke.pointIds.delete(id);
    }
    for (const id of [...stroke.segmentIds]) {
      if (isCircleStandIn(id)) stroke.segmentIds.delete(id);
    }
    let circleHit = false;
    for (const circle of drawnCircles) {
      const distance = Math.abs(Math.hypot(tip.x - circle.cx, tip.z - circle.cz) - circle.radius);
      if (distance <= eraseBrushRadius && !stroke.segmentIds.has(circle.id)) {
        stroke.segmentIds.add(circle.id);
        circleHit = true;
      }
    }
    if (changed || circleHit) {
      setErasePreview({
        pointIds: [...stroke.pointIds],
        segmentIds: [...stroke.segmentIds],
      });
    }
  };

  const beginEraseStroke = (event: ReactPointerEvent<Element>, tip: { x: number; z: number }) => {
    event.preventDefault();
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    const stroke = { pointIds: new Set<string>(), segmentIds: new Set<string>() };
    eraseStrokeRef.current = stroke;
    applyEraseTip(tip, stroke);
    setPointerAction({ kind: "erase", pointerId: event.pointerId, current: tip });
    setHover(tip);
  };

  const finishEraseStroke = () => {
    const stroke = eraseStrokeRef.current;
    eraseStrokeRef.current = null;
    setErasePreview(null);
    setPointerAction(null);
    if (!stroke) return;
    if (stroke.pointIds.size || stroke.segmentIds.size) {
      onEraseEntities([...stroke.pointIds], [...stroke.segmentIds]);
    }
  };

  const handlePlanePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 1) {
      beginPan(event);
      return;
    }
    if (event.button !== 0 || (event.target !== event.currentTarget && (event.target as Element).closest("[data-sketch-entity]"))) return;
    const point = pointFromEvent(event, null, {
      ...(tool === "select" || tool === "dimension" ? { snap: false as const } : {}),
      ...(event.shiftKey && tool === "line" ? { headingStep: 15 } : {}),
    });
    if (!point) return;
    event.preventDefault();
    if (tool === "erase") {
      if (!eraseWhole) beginEraseStroke(event, point);
      return;
    }
    if (tool === "bezier") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that is already gone cannot be captured.
      }
      setPointerAction({ kind: "bezier", pointerId: event.pointerId, origin: point, current: point });
    } else if (
      tool === "circle"
      || tool === "ellipse"
      || tool === "triangle"
      || tool === "polygon"
      || tool === "star"
      || tool === "square"
      || tool === "rectangle"
      || tool === "roundRect"
      || tool === "slot"
    ) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setPointerAction({ kind: tool, pointerId: event.pointerId, origin: point, current: point });
    } else if (tool === "arc") {
      const nextDraft = [...arcDraft, point];
      if (nextDraft.length >= 3) {
        onDrawArc(nextDraft[0], nextDraft[1], nextDraft[2]);
        setArcDraft([]);
      } else {
        setArcDraft(nextDraft);
      }
    } else if (tool === "select") {
      event.currentTarget.setPointerCapture(event.pointerId);
      setPointerAction({ kind: "marquee", pointerId: event.pointerId, origin: point, current: point });
    } else if (tool === "dimension") {
      onNotice?.("Select a segment to add a dimension");
    } else if (tool === "smooth") {
      onNotice?.("Click a point to curve it");
    } else if (tool === "line" || tool === "measure") {
      onPlanePoint(point);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const pendingDrag = pendingPointDragRef.current;
    if (pendingDrag && pendingDrag.pointerId === event.pointerId) {
      const moved = Math.hypot(event.clientX - pendingDrag.clientX, event.clientY - pendingDrag.clientY);
      if (moved >= 4) {
        pendingPointDragRef.current = null;
        pointClickRef.current = null;
        const dragged = pointFromEvent(event, null, { excludePointIds: [pendingDrag.pointId] });
        beginEntityDrag(event, {
          kind: "move-point",
          pointerId: event.pointerId,
          pointId: pendingDrag.pointId,
          current: dragged ?? { x: pendingDrag.x, z: pendingDrag.z },
        });
      }
    }
    if (pointerAction?.kind === "pan") {
      const matrix = svgRef.current?.getScreenCTM();
      const scaleX = matrix ? Math.max(0.0001, Math.hypot(matrix.a, matrix.b)) : 1;
      const scaleY = matrix ? Math.max(0.0001, Math.hypot(matrix.c, matrix.d)) : 1;
      const deltaX = event.clientX - pointerAction.clientX;
      const deltaY = event.clientY - pointerAction.clientY;
      const panLimitX = Math.max(workspace.width, printerBed.width);
      const panLimitZ = Math.max(workspace.depth, printerBed.depth);
      setPan((current) => ({
        x: clamp(current.x - deltaX / scaleX, -panLimitX, panLimitX),
        z: clamp(current.z - deltaY / scaleY, -panLimitZ, panLimitZ),
      }));
      setPointerAction({ ...pointerAction, clientX: event.clientX, clientY: event.clientY });
      return;
    }
    const moveOptions = {
      ...(pointerAction?.kind === "marquee" ? { snap: false as const } : {}),
      ...(pointerAction?.kind === "move-point" ? { excludePointIds: [pointerAction.pointId, ...(pointerAction.alsoPointIds ?? [])] } : {}),
      ...(pointerAction?.kind === "move-outline" ? { excludePointIds: pointerAction.pointIds } : {}),
      ...(event.shiftKey && tool === "line" && pointerAction?.kind !== "marquee" ? { headingStep: 15 } : {}),
    };
    const point = pointFromEvent(event, null, Object.keys(moveOptions).length ? moveOptions : undefined);
    setHover(point);
    if (!point || !pointerAction) return;
    if (pointerAction.kind === "erase") {
      const samples = sampleEraseStroke(pointerAction.current, point, eraseBrushRadius * 0.55);
      for (const sample of samples) applyEraseTip(sample);
      setPointerAction({ ...pointerAction, current: point });
      return;
    }
    setPointerAction({ ...pointerAction, current: point });
  };

  const finishPointerAction = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pendingPointDragRef.current?.pointerId === event.pointerId) pendingPointDragRef.current = null;
    const action = pointerAction;
    if (!action || action.pointerId !== event.pointerId) return;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer was never captured.
    }
    if (action.kind === "pan") {
      setPointerAction(null);
      return;
    }
    if (action.kind === "erase") {
      finishEraseStroke();
      return;
    }
    if (action.kind === "marquee") {
      const minX = Math.min(action.origin.x, action.current.x);
      const maxX = Math.max(action.origin.x, action.current.x);
      const minZ = Math.min(action.origin.z, action.current.z);
      const maxZ = Math.max(action.origin.z, action.current.z);
      const contains = (point: { x: number; z: number }) => point.x >= minX && point.x <= maxX && point.z >= minZ && point.z <= maxZ;
      const pointIds = profile.points.filter((point) => contains(point) && !isCircleStandIn(point.id)).map((point) => point.id);
      const segmentIds = profile.segments.filter((segment) => {
        if (isCircleStandIn(segment.id)) return false;
        const start = pointById.get(segment.startId);
        const end = pointById.get(segment.endId);
        return Boolean(start && end && (contains(start) || contains(end) || contains({ x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 })));
      }).map((segment) => segment.id);
      for (const circle of drawnCircles) {
        if (contains({ x: circle.cx, z: circle.cz })) segmentIds.push(circle.id);
      }
      const imageIds = (profile.images ?? []).filter((image) => {
        const imageMinX = image.x - image.width / 2;
        const imageMaxX = image.x + image.width / 2;
        const imageMinZ = image.z - image.depth / 2;
        const imageMaxZ = image.z + image.depth / 2;
        return imageMaxX >= minX && imageMinX <= maxX && imageMaxZ >= minZ && imageMinZ <= maxZ;
      }).map((image) => image.id);
      onSelectMany(pointIds, segmentIds, imageIds);
      setPointerAction(null);
      return;
    }
    if (action.kind === "bezier") {
      const dx = action.current.x - action.origin.x;
      const dz = action.current.z - action.origin.z;
      const handles = {
        handleIn: { x: action.origin.x - dx, z: action.origin.z - dz },
        handleOut: { x: action.origin.x + dx, z: action.origin.z + dz },
      };
      // A press on an existing point waits for release, so the drag can bend the closing curve.
      if (action.joinPointId) onPointPress(action.joinPointId, Math.hypot(dx, dz) > 0.4 ? handles : undefined);
      else onPlanePoint(action.origin, handles);
    } else if (action.kind === "circle") {
      const radius = Math.hypot(action.current.x - action.origin.x, action.current.z - action.origin.z);
      if (radius >= 0.25) {
        onDrawCircle(action.origin, radius);
      }
    } else if (action.kind === "ellipse") {
      onDrawEllipse(action.origin, action.current);
    } else if (action.kind === "square") {
      onDrawSquare(action.origin, action.current);
    } else if (action.kind === "rectangle" || action.kind === "roundRect" || action.kind === "slot") {
      if (action.kind === "rectangle") onDrawRectangle(action.origin, action.current);
      else if (action.kind === "roundRect") onDrawRoundRect(action.origin, action.current);
      else onDrawSlot(action.origin, action.current);
    } else if (action.kind === "triangle") {
      onDrawTriangle(action.origin, action.current);
    } else if (action.kind === "polygon") {
      onDrawPolygon(action.origin, action.current);
    } else if (action.kind === "star") {
      onDrawStar(action.origin, action.current);
    } else if (action.kind === "offset") {
      onOffsetSegment(action.segmentId, action.current);
    } else if (action.kind === "move-point") {
      onMovePoint(action.pointId, action.current, action.alsoPointIds);
      onSnapResolved?.(null);
    } else if (action.kind === "move-outline") {
      const anchor = profile.points.find((point) => action.pointIds.includes(point.id));
      const deltaX = action.current.x - action.origin.x;
      const deltaZ = action.current.z - action.origin.z;
      if (anchor && Math.hypot(deltaX, deltaZ) >= 0.05) {
        onMovePoint(anchor.id, { x: anchor.x + deltaX, z: anchor.z + deltaZ }, action.pointIds);
      }
    } else if (action.kind === "move-handle") {
      onMoveHandle(action.pointId, action.handle, action.current);
    } else if (action.kind === "move-image") {
      onUpdateImage(action.imageId, {
        x: action.start.x + action.current.x - action.origin.x,
        z: action.start.z + action.current.z - action.origin.z,
      }, "Sketch image moved");
    } else if (action.kind === "resize-image") {
      onUpdateImage(action.imageId, resizeSketchImage(action.start, action.handle, action.current), "Sketch image resized");
    } else if (action.kind === "resize-circle") {
      const radius = Math.hypot(action.current.x - action.center.x, action.current.z - action.center.z);
      if (Math.abs(radius - action.radius) > 0.05) onEditCircleRadius?.(action.circleId, radius);
    }
    setPointerAction(null);
  };

  // Escape while dragging a point, shape, image or marquee abandons the drag;
  // the geometry is only committed on pointer-up, which then finds no action.
  const pointerActionActive = pointerAction !== null;
  useEffect(() => {
    if (!pointerActionActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const action = pointerAction;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        if (svgRef.current?.hasPointerCapture(action.pointerId)) svgRef.current.releasePointerCapture(action.pointerId);
      } catch {
        // The pointer was never captured.
      }
      pendingPointDragRef.current = null;
      eraseStrokeRef.current = null;
      setErasePreview(null);
      setPointerAction(null);
      if (action.kind !== "pan" && action.kind !== "marquee") onNotice?.("Cancelled");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointerActionActive, pointerAction?.pointerId]);

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    setZoom((current) => clamp(current * (event.deltaY > 0 ? 0.88 : 1.14), 0.35, 6));
  };

  const beginEntityDrag = (event: ReactPointerEvent<SVGElement>, action: PointerAction) => {
    // A drag that starts on pointermove reports button -1. The held button is in `buttons`.
    const primaryDown = event.button === 0 || (event.button === -1 && (event.buttons & 1) === 1);
    if (!primaryDown) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      svgRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured.
    }
    setPointerAction(action);
  };

  const measurementLength = measurement ? Math.hypot(measurement.end.x - measurement.start.x, measurement.end.z - measurement.start.z) : 0;
  const measurementLabel = formatDimension(measurementLength, workspace.accuracy);
  const previewLength = activePoint && rubberEnd ? Math.hypot(rubberEnd.x - activePoint.x, rubberEnd.z - activePoint.z) : 0;
  const previewLabel = lineEntry || formatDimension(previewLength, workspace.accuracy);
  const circlePreviewRadius =
    pointerAction?.kind === "circle"
      ? Math.hypot(pointerAction.current.x - pointerAction.origin.x, pointerAction.current.z - pointerAction.origin.z)
      : 0;
  const circlePreviewLabel = `${formatDimension(circlePreviewRadius * 2, workspace.accuracy)} mm across`;
  const radialPreview =
    pointerAction && (pointerAction.kind === "triangle" || pointerAction.kind === "polygon" || pointerAction.kind === "star")
      ? (() => {
          const radius = Math.hypot(pointerAction.current.x - pointerAction.origin.x, pointerAction.current.z - pointerAction.origin.z);
          if (radius < 0.01) return null;
          const startAngle = Math.atan2(pointerAction.current.z - pointerAction.origin.z, pointerAction.current.x - pointerAction.origin.x);
          let pts: Array<{ x: number; z: number }>;
          if (pointerAction.kind === "star") {
            const tips = 5;
            const inner = radius * 0.382;
            pts = Array.from({ length: tips * 2 }, (_, index) => {
              const r = index % 2 === 0 ? radius : inner;
              const angle = startAngle + (index * Math.PI) / tips;
              return {
                x: pointerAction.origin.x + Math.cos(angle) * r,
                z: pointerAction.origin.z + Math.sin(angle) * r,
              };
            });
          } else {
            const sides = pointerAction.kind === "triangle" ? 3 : polygonSides;
            pts = Array.from({ length: sides }, (_, index) => {
              const angle = startAngle + (index * 2 * Math.PI) / sides;
              return {
                x: pointerAction.origin.x + Math.cos(angle) * radius,
                z: pointerAction.origin.z + Math.sin(angle) * radius,
              };
            });
          }
          return {
            radius,
            label: `${formatDimension(radius * 2, workspace.accuracy)} mm across`,
            d: `${pts.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.z}`).join(" ")} Z`,
          };
        })()
      : null;
  const squarePreview =
    pointerAction?.kind === "square"
      ? (() => {
          const dx = pointerAction.current.x - pointerAction.origin.x;
          const dz = pointerAction.current.z - pointerAction.origin.z;
          const side = Math.max(Math.abs(dx), Math.abs(dz));
          if (side < 0.01) return null;
          const sx = Math.sign(dx) || 1;
          const sz = Math.sign(dz) || 1;
          const x = Math.min(pointerAction.origin.x, pointerAction.origin.x + sx * side);
          const z = Math.min(pointerAction.origin.z, pointerAction.origin.z + sz * side);
          return { x, z, side, label: `${formatDimension(side, workspace.accuracy)} mm` };
        })()
      : null;
  const boxPreview =
    pointerAction && (pointerAction.kind === "ellipse" || pointerAction.kind === "rectangle" || pointerAction.kind === "roundRect" || pointerAction.kind === "slot")
      ? (() => {
          const width = Math.abs(pointerAction.current.x - pointerAction.origin.x);
          const height = Math.abs(pointerAction.current.z - pointerAction.origin.z);
          if (width < 0.01 || height < 0.01) return null;
          const x = Math.min(pointerAction.origin.x, pointerAction.current.x);
          const z = Math.min(pointerAction.origin.z, pointerAction.current.z);
          const rx = pointerAction.kind === "roundRect" ? Math.min(width, height) * 0.22 : pointerAction.kind === "slot" ? Math.min(width, height) / 2 : 0;
          return {
            kind: pointerAction.kind,
            x,
            z,
            width,
            height,
            rx,
            label: `${formatDimension(width, workspace.accuracy)} × ${formatDimension(height, workspace.accuracy)} mm`,
          };
        })()
      : null;
  const offsetPreview =
    pointerAction?.kind === "offset"
      ? (() => {
          const offset = sketchOffsetAt(profile, pointerAction.segmentId, pointerAction.current);
          if (!offset || offset === "curve") return null;
          const mid = offset.preview.reduce(
            (sum, point) => ({ x: sum.x + point.x / offset.preview.length, z: sum.z + point.z / offset.preview.length }),
            { x: 0, z: 0 },
          );
          return {
            preview: offset.preview,
            closed: offset.closed,
            label: formatDimension(offset.distance, workspace.accuracy),
            midX: mid.x,
            midZ: mid.z,
          };
        })()
      : null;
  const labelOffset = 22 * screenUnit;
  const sideCallouts = selectedSideCallouts(displayProfile, paths, selected, pointById, drawnCircles);
  const cornerMarks = sketchCornerMarks(displayProfile).filter((mark) => {
    if (isCircleStandIn(mark.pointId)) return false;
    if (showMeasurements) return true;
    if (selected?.kind === "point") return selected.id === mark.pointId;
    if (selected?.kind === "segment") {
      const segment = displayProfile.segments.find((entry) => entry.id === selected.id);
      return segment?.startId === mark.pointId || segment?.endId === mark.pointId;
    }
    if (selected?.kind === "multiple") return selected.pointIds.includes(mark.pointId);
    return false;
  });
  const alignedSegmentIds = new Set<string>();
  if (pointerAction?.kind === "move-point") {
    const moving = pointById.get(pointerAction.pointId);
    if (moving) {
      const tol = 0.05;
      for (const segment of displayProfile.segments) {
        if (segment.construction || (segment.kind && segment.kind !== "line")) continue;
        const otherId = segment.startId === moving.id ? segment.endId : segment.endId === moving.id ? segment.startId : null;
        if (!otherId) continue;
        const other = pointById.get(otherId);
        if (!other) continue;
        const dx = Math.abs(moving.x - other.x);
        const dz = Math.abs(moving.z - other.z);
        if ((dx <= tol && dz > tol) || (dz <= tol && dx > tol)) alignedSegmentIds.add(segment.id);
      }
    }
  }
  const pointRadius = 5 * screenUnit;
  const controlPointRadius = 6 * screenUnit;
  const hoverPointRadius = 5 * screenUnit;
  const handleSize = 12 * screenUnit;
  const handleRadius = 2 * screenUnit;
  const selectedImageBounds = selectedImage ? {
    minX: selectedImage.x - selectedImage.width / 2,
    maxX: selectedImage.x + selectedImage.width / 2,
    minZ: selectedImage.z - selectedImage.depth / 2,
    maxZ: selectedImage.z + selectedImage.depth / 2,
  } : null;
  const imageResizeHandles: Array<{ id: ResizeHandle; x: number; z: number }> = selectedImage && selectedImageBounds ? [
    { id: "nw", x: selectedImageBounds.minX, z: selectedImageBounds.minZ },
    { id: "n", x: selectedImage.x, z: selectedImageBounds.minZ },
    { id: "ne", x: selectedImageBounds.maxX, z: selectedImageBounds.minZ },
    { id: "e", x: selectedImageBounds.maxX, z: selectedImage.z },
    { id: "se", x: selectedImageBounds.maxX, z: selectedImageBounds.maxZ },
    { id: "s", x: selectedImage.x, z: selectedImageBounds.maxZ },
    { id: "sw", x: selectedImageBounds.minX, z: selectedImageBounds.maxZ },
    { id: "w", x: selectedImageBounds.minX, z: selectedImage.z },
  ] : [];
  const referenceNodes = useMemo(
    () => referenceShapes.filter((shape) => !shape.hidden).map((shape) => ({ shape, node: sketchReferenceNode(shape) })),
    [referenceShapes],
  );
  const showReferenceFootprints = isDefaultSketchPlane(profile.sketchPlane);
  const faceReferenceLoops = profile.faceReferenceLoops ?? [];
  const hostShapeName = profile.sketchPlane?.hostShapeId
    ? referenceShapes.find((shape) => shape.id === profile.sketchPlane?.hostShapeId)?.name
    : null;
  const barrelSketch = profile.sketchPlane?.surface?.kind === "cylinder";
  const planeBanner = hostShapeName
    ? barrelSketch
      ? `Unwrapped ${hostShapeName} — up/down = height, left/right = around`
      : `Sketching on ${hostShapeName} face`
    : profile.sketchPlane && !isDefaultSketchPlane(profile.sketchPlane)
      ? barrelSketch
        ? "Unwrapped barrel — up/down = height, left/right = around"
        : "Sketching on selected face"
      : null;

  return (
    <main className="sketch-workspace-stage">
      {solveStatus !== "empty" ? (
        <div
          className={`sketch-solve-strip status-${solveStatus}${constraintConflicts.length ? " has-conflicts" : ""}`}
          aria-live="polite"
        >
          <span className="sketch-solve-status">
            {solveStatus === "fully-defined"
              ? "Fully locked"
              : solveStatus === "over-constrained"
                ? "Too many rules"
                : solveStatus === "unsolved"
                  ? "Needs a fix"
                  : "Still movable"}
          </span>
          <span className="sketch-solve-dof">{solveDof} still free to move</span>
          {constraintConflicts.length > 0 ? (
            <span className="sketch-solve-conflicts">{constraintConflicts.length} conflict{constraintConflicts.length === 1 ? "" : "s"}</span>
          ) : null}
        </div>
      ) : null}
      {planeBanner ? <div className="sketch-plane-banner">{planeBanner}</div> : null}
      <div className="camera-controls sketch-camera-controls" aria-label="Sketch view controls">
        <button aria-label="Reset sketch view" onClick={() => { setZoom(1); setPan({ x: 0, z: 0 }); }}><Home size={28} /></button>
        <button aria-label="Zoom in" onClick={() => setZoom((value) => clamp(value * 1.25, 0.35, 6))}><Plus size={33} /></button>
        <button aria-label="Zoom out" onClick={() => setZoom((value) => clamp(value / 1.25, 0.35, 6))}><Minus size={33} /></button>
        <div className="ruler-control-group">
          <PeakTipButton
            className={tool === "measure" ? "active" : ""}
            label="Measure"
            description={TOOL_DESCRIPTIONS.measure}
            aria-pressed={tool === "measure"}
            onClick={() => {
              if (!onToolChange) return;
              if (tool === "measure") {
                onToolChange("select");
                onClearMeasurement();
                return;
              }
              onToolChange("measure");
            }}
          >
            <Ruler size={26} strokeWidth={2.2} aria-hidden="true" />
          </PeakTipButton>
          <PeakTipButton
            label={showMeasurements ? "Hide measurements" : "Show measurements"}
            description="Show or hide the lengths and corner angles on the sketch."
            aria-pressed={showMeasurements}
            onClick={() => {
              setShowMeasurements((shown) => {
                const next = !shown;
                try {
                  window.localStorage.setItem("mintr.showSketchMeasurements", next ? "1" : "0");
                } catch {
                  // The sketch still toggles for this visit.
                }
                return next;
              });
            }}
          >
            {showMeasurements ? <Eye size={26} strokeWidth={2.2} aria-hidden="true" /> : <EyeOff size={26} strokeWidth={2.2} aria-hidden="true" />}
          </PeakTipButton>
        </div>
      </div>
      <section className="sketch-plate-wrap" aria-label="2D sketch plate">
        <svg
          ref={svgRef}
          className={`sketch-plate tool-${tool}${eraseWhole ? " erase-whole" : ""} ${pointerAction?.kind === "pan" ? "panning" : ""}`}
          viewBox={`${pan.x - viewWidth / 2} ${pan.z - viewDepth / 2} ${viewWidth} ${viewDepth}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={handlePlanePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerAction}
          onPointerCancel={(event) => {
            if (pointerAction?.kind === "erase" && pointerAction.pointerId === event.pointerId) {
              finishEraseStroke();
              return;
            }
            setPointerAction(null);
          }}
          onPointerLeave={() => !pointerAction && setHover(null)}
          onWheel={handleWheel}
        >
          <rect className="sketch-plate-background" x={pan.x - viewWidth / 2} y={pan.z - viewDepth / 2} width={viewWidth} height={viewDepth} />
          {workspace.showGrid ? (
            <g className="sketch-grid" pointerEvents="none">
              {verticalLines.map((x) => {
                const atOrigin = Math.abs(x) < 0.0001;
                const major = !atOrigin && Math.round(Math.abs(x) / gridStep) % majorEvery === 0;
                return <line className={atOrigin ? "axis" : major ? "major" : "minor"} key={`x-${x}`} x1={x} y1={pan.z - viewDepth / 2} x2={x} y2={pan.z + viewDepth / 2} />;
              })}
              {horizontalLines.map((z) => {
                const atOrigin = Math.abs(z) < 0.0001;
                const major = !atOrigin && Math.round(Math.abs(z) / gridStep) % majorEvery === 0;
                return <line className={atOrigin ? "axis" : major ? "major" : "minor"} key={`z-${z}`} x1={pan.x - viewWidth / 2} y1={z} x2={pan.x + viewWidth / 2} y2={z} />;
              })}
            </g>
          ) : null}
          <g className="sketch-reference-images">
            {displayImages.map((image) => (
              <image
                key={image.id}
                data-sketch-entity="image"
                aria-label={image.name}
                href={image.dataUrl}
                x={image.x - image.width / 2}
                y={image.z - image.depth / 2}
                width={image.width}
                height={image.depth}
                opacity={image.opacity ?? 0.55}
                preserveAspectRatio="none"
                pointerEvents={tool === "select" ? "auto" : "none"}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.button === 1) {
                    beginPan(event);
                    return;
                  }
                  if (event.button !== 0 || tool !== "select") return;
                  const point = pointFromEvent(event);
                  if (!point) return;
                  onSelectImage(image.id);
                  beginEntityDrag(event, {
                    kind: "move-image",
                    pointerId: event.pointerId,
                    imageId: image.id,
                    origin: point,
                    current: point,
                    start: { ...image },
                  });
                }}
              />
            ))}
          </g>
          <g className="sketch-reference-shapes" pointerEvents="none">
            {showReferenceFootprints
              ? referenceNodes.map(({ shape, node }) => (
                  <g key={shape.id} transform={`rotate(${shape.rotation ?? 0} ${shape.x} ${shape.z}) translate(${shape.x} ${shape.z}) scale(${mirrorSign(shape.mirrorX)} ${mirrorSign(shape.mirrorZ)})`}>
                    <ReferenceMark node={node} />
                  </g>
                ))
              : null}
          </g>
          {faceReferenceLoops.length > 0 ? (
            <g className="sketch-face-reference" pointerEvents="none">
              {faceReferenceLoops.map((loop, index) => {
                if (loop.length < 2) return null;
                const d = `M ${loop.map((point) => `${point.x} ${point.z}`).join(" L ")} Z`;
                return <path key={`face-ref-${index}`} className="sketch-face-reference-loop" d={d} />;
              })}
              {barrelSketch && faceReferenceLoops[0]?.length >= 4 ? (() => {
                const xs = faceReferenceLoops[0].map((point) => point.x);
                const zs = faceReferenceLoops[0].map((point) => point.z);
                const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
                const midZ = (Math.min(...zs) + Math.max(...zs)) / 2;
                const topZ = Math.min(...zs);
                const rightX = Math.max(...xs);
                const labelSize = Math.max(2.2, Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 0.06);
                return (
                  <g className="sketch-barrel-axis-labels" fontSize={labelSize}>
                    <text x={midX} y={topZ - labelSize * 0.35} textAnchor="middle">height</text>
                    <text x={rightX + labelSize * 0.35} y={midZ} textAnchor="start" dominantBaseline="middle">around</text>
                  </g>
                );
              })() : null}
            </g>
          ) : null}
          <rect className="sketch-plate-border" x={-workspace.width / 2} y={-workspace.depth / 2} width={workspace.width} height={workspace.depth} pointerEvents="none" />
          {showSketchPrinterBed ? (
            <rect
              className="sketch-printer-bed"
              x={-printerBed.width / 2}
              y={-printerBed.depth / 2}
              width={printerBed.width}
              height={printerBed.depth}
              pointerEvents="none"
            >
              <title>Print bed</title>
            </rect>
          ) : null}
          {pointerAction?.kind === "marquee" ? (
            <rect
              className="sketch-selection-marquee"
              x={Math.min(pointerAction.origin.x, pointerAction.current.x)}
              y={Math.min(pointerAction.origin.z, pointerAction.current.z)}
              width={Math.abs(pointerAction.current.x - pointerAction.origin.x)}
              height={Math.abs(pointerAction.current.z - pointerAction.origin.z)}
              pointerEvents="none"
            />
          ) : null}
          <g className="sketch-profile-fills">
            {closedRegionFills.map(({ closedProfile, d }) => {
              const selected = selectedProfileIds.includes(closedProfile.id);
              return (
                <path
                  key={closedProfile.id}
                  className={`${selected ? "selected-profile" : ""} ${closedProfile.pointIds.some((id) => eraseWholePointIds.has(id) || eraseWholeSegmentIds.has(curveStandInOwner(id) ?? "")) ? "is-erase-target" : ""}`.trim()}
                  d={d}
                  pointerEvents="auto"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    if (tool === "erase" && eraseWhole) {
                      event.preventDefault();
                      event.stopPropagation();
                      const point = pointFromEvent(event);
                      if (!point) return;
                      const target = wholeEraseTarget(profile, { at: point }, constraintEntities);
                      if (target && (target.pointIds.length || target.segmentIds.length)) {
                        onEraseEntities(target.pointIds, target.segmentIds);
                      }
                      return;
                    }
                    if (tool === "offset" && onBeginOffsetProfile) {
                      event.preventDefault();
                      event.stopPropagation();
                      onBeginOffsetProfile(closedProfile.id);
                      return;
                    }
                    if ((tool === "pattern" || tool === "circular-pattern" || tool === "stroke") && onSelectProfile) {
                      event.preventDefault();
                      event.stopPropagation();
                      onSelectProfile(closedProfile.id);
                      return;
                    }
                    if (tool !== "select" || !onSelectProfile) return;
                    const point = pointFromEvent(event);
                    const pointIds = shapeMovePointIds(closedProfile, constraintEntities);
                    if (!point || pointIds.length === 0) {
                      event.preventDefault();
                      event.stopPropagation();
                      onSelectProfile(closedProfile.id);
                      return;
                    }
                    onSelectProfile(closedProfile.id);
                    beginEntityDrag(event, {
                      kind: "move-outline",
                      pointerId: event.pointerId,
                      pointIds,
                      origin: point,
                      current: point,
                    });
                  }}
                />
              );
            })}
          </g>
          {guideGhost && guideGhost.segments.length > 0 ? (
            <g className="sketch-guide-ghost" pointerEvents="none">
              {guideGhost.segments.map((segment, index) => {
                const start = guideGhost.points[segment.start];
                const end = guideGhost.points[segment.end];
                if (!start || !end) return null;
                return <path key={`guide-ghost-${index}`} d={`M ${start.x} ${start.z} L ${end.x} ${end.z}`} />;
              })}
            </g>
          ) : null}
          <g className="sketch-segments">
            {paths.flatMap((path, pathIndex) => curveStrokeRuns(path).map((run, runIndex) => (
              <path key={`curve-run-${path.id}-${pathIndex}-${runIndex}`} className="sketch-chain" d={run.d} style={lineweightStyle(run.weight)} />
            )))}
            {displayProfile.segments.map((segment) => {
              if (isCircleStandIn(segment.id)) return null;
              if (!showConstruction && segment.construction) return null;
              const from = pointById.get(segment.startId);
              const to = pointById.get(segment.endId);
              const chained = !segment.construction && Boolean(from && to && curveControls({ segment, from, to }).curved);
              return (
              <path
                data-sketch-entity="segment"
                className={`${isSegmentSelected(segment.id) ? "selected" : ""} ${alignedSegmentIds.has(segment.id) ? "is-aligned" : ""} ${eraseWholeSegmentIds.has(segment.id) ? "is-erase-target" : ""} ${isSweepMarked(segment.id) ? "sweep-mark" : ""} ${segment.construction ? "construction" : ""} ${chained ? "is-chained" : ""}`.trim()}
                key={segment.id}
                d={segmentData(segment, pointById)}
                style={lineweightStyle(segment.weight)}
                onPointerDown={(event) => {
                  const point = pointFromEvent(event);
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.button === 1) beginPan(event);
                  else if (event.button === 0 && tool === "erase" && eraseWhole) {
                    const target = wholeEraseTarget(profile, { segmentId: segment.id }, constraintEntities);
                    if (target && (target.pointIds.length || target.segmentIds.length)) {
                      onEraseEntities(target.pointIds, target.segmentIds);
                    }
                  } else if (event.button === 0 && tool === "erase" && point) beginEraseStroke(event, point);
                  else if (event.button === 0 && tool === "refine" && point) onInsertPoint(segment.id, point);
                  else if (event.button === 0 && tool === "offset" && point) {
                    svgRef.current?.setPointerCapture(event.pointerId);
                    setPointerAction({ kind: "offset", pointerId: event.pointerId, segmentId: segment.id, current: point });
                  } else if (event.button === 0) onSelectSegment(segment.id, point ?? undefined);
                }}
              />
              );
            })}
          </g>
          {drawnCircles.some((circle) => showConstruction || !circle.construction) ? (
            <g className="sketch-analytic-circles">
              {drawnCircles.filter((circle) => showConstruction || !circle.construction).map((circle) => {
                const circleSelected = isSegmentSelected(circle.id)
                  || (selected?.kind === "segment" && curveStandInOwner(selected.id) === circle.id)
                  || (selected?.kind === "multiple" && selected.segmentIds.some((id) => curveStandInOwner(id) === circle.id));
                return (
                  <circle
                    key={circle.id}
                    data-sketch-entity="segment"
                    className={`${circleSelected ? "selected" : ""} ${eraseWholeSegmentIds.has(circle.id) ? "is-erase-target" : ""} ${isSweepMarked(circle.id) ? "sweep-mark" : ""} ${circle.construction ? "construction" : ""}`.trim()}
                    cx={circle.cx}
                    cy={circle.cz}
                    r={circle.radius}
                    style={lineweightStyle(circle.weight)}
                    onPointerDown={(event) => {
                      const point = pointFromEvent(event);
                      event.preventDefault();
                      event.stopPropagation();
                      if (event.button === 1) beginPan(event);
                      else if (event.button === 0 && tool === "erase" && eraseWhole) {
                        onEraseEntities([], [circle.id]);
                      } else if (event.button === 0 && tool === "erase" && point) beginEraseStroke(event, point);
                      else if (event.button === 0 && tool === "select" && point) {
                        onSelectSegment(circle.id, point);
                        beginEntityDrag(event, {
                          kind: "resize-circle",
                          pointerId: event.pointerId,
                          circleId: circle.id,
                          center: { x: circle.cx, z: circle.cz },
                          radius: circle.radius,
                          current: point,
                        });
                      } else if (event.button === 0) onSelectSegment(circle.id, point ?? undefined);
                    }}
                  />
                );
              })}
            </g>
          ) : null}
          {showConstruction && constructionGuides.length > 0 ? (
            <g className="sketch-construction-guides" pointerEvents="none">
              {constructionGuides.filter((guide) => !circleIds.has(guide.id.replace(/-g\d+$/, ""))).map((guide) => (
                <line key={guide.id} x1={guide.x1} y1={guide.z1} x2={guide.x2} y2={guide.z2} />
              ))}
            </g>
          ) : null}
          <g className="sketch-segment-dimensions">
            {showMeasurements ? displayProfile.segments.map((segment) => {
              if (segment.construction || isCircleStandIn(segment.id) || sideCallouts.some((callout) => callout.segmentId === segment.id)) return null;
              const dimension = segmentDimension(segment, pointById);
              if (!dimension) return null;
              const label = formatDimension(dimension.length, workspace.accuracy);
              const pill = dimensionPillSize(label, screenUnit, 18);
              const editable = tool === "select" && Boolean(onEditSegmentLength);
              return (
                <g
                  key={`dimension-${segment.id}`}
                  className={editable ? "editable" : ""}
                  pointerEvents={editable ? "auto" : "none"}
                  transform={`translate(${dimension.midpoint.x} ${dimension.midpoint.z - labelOffset})`}
                  onPointerDown={(event) => {
                    if (!editable || event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setLengthEdit({ segmentId: segment.id, value: dimension.length, grow: "end" });
                  }}
                >
                  <title>{editable ? "Click to type the length" : undefined}</title>
                  <rect x={-pill.width / 2} y={-pill.height / 2} width={pill.width} height={pill.height} rx={pill.radius} />
                  <text y={5 * screenUnit} fontSize={13 * screenUnit}>{label}</text>
                </g>
              );
            }) : null}
            {cornerMarks.map((mark) => {
              const rightAngle = Math.abs(mark.degrees - 90) < 0.8;
              const size = Math.max(4 * screenUnit, Math.min((rightAngle ? 14 : 18) * screenUnit, mark.reach * 0.34));
              const rounded = Math.round(mark.degrees);
              const label = Math.abs(mark.degrees - rounded) < 0.15 ? `${rounded}°` : `${mark.degrees.toFixed(1)}°`;
              const pill = dimensionPillSize(label, screenUnit, 18);
              const labelDistance = size + 16 * screenUnit;
              const labelX = mark.x + mark.bx * labelDistance;
              const labelZ = mark.z + mark.bz * labelDistance;
              const editable = mark.straight && tool === "select" && Boolean(onEditCornerAngle);
              const open = (event: ReactPointerEvent<SVGGElement>) => {
                if (!editable || event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                setAngleEdit({ pointId: mark.pointId, value: mark.degrees, leg: 1 });
              };
              const callout = (
                <g className={editable ? "editable" : ""} pointerEvents={editable ? "auto" : "none"} transform={`translate(${labelX} ${labelZ})`} onPointerDown={open}>
                  <title>{editable ? "Click to type the corner angle" : undefined}</title>
                  <rect x={-pill.width / 2} y={-pill.height / 2} width={pill.width} height={pill.height} rx={pill.radius} />
                  <text y={5 * screenUnit} fontSize={13 * screenUnit}>{label}</text>
                </g>
              );
              if (rightAngle) {
                const ax = mark.x + mark.ux0 * size;
                const az = mark.z + mark.uz0 * size;
                const bx = mark.x + (mark.ux0 + mark.ux1) * size;
                const bz = mark.z + (mark.uz0 + mark.uz1) * size;
                const cx = mark.x + mark.ux1 * size;
                const cz = mark.z + mark.uz1 * size;
                return (
                  <g key={`corner-${mark.pointId}`} className="sketch-angle-callout">
                    <g className="sketch-angle-dimension" pointerEvents="none">
                      <path className="witness" d={`M ${ax} ${az} L ${bx} ${bz} L ${cx} ${cz}`} />
                    </g>
                    {callout}
                  </g>
                );
              }
              const cross = mark.ux0 * mark.uz1 - mark.uz0 * mark.ux1;
              const turn = cross >= 0 ? 1 : -1;
              const startX = mark.x + mark.ux0 * size;
              const startZ = mark.z + mark.uz0 * size;
              const endX = mark.x + mark.ux1 * size;
              const endZ = mark.z + mark.uz1 * size;
              const sweep = turn > 0 ? 1 : 0;
              const travel0x = -turn * mark.uz0;
              const travel0z = turn * mark.ux0;
              const travel1x = -turn * mark.uz1;
              const travel1z = turn * mark.ux1;
              const arrow = 3.6 * screenUnit;
              return (
                <g key={`corner-${mark.pointId}`} className="sketch-angle-callout">
                  <g className="sketch-angle-dimension" pointerEvents="none">
                    <path className="arc" d={`M ${startX} ${startZ} A ${size} ${size} 0 0 ${sweep} ${endX} ${endZ}`} />
                    <path className="arrow" d={angleArrow(startX, startZ, -travel0x, -travel0z, arrow)} />
                    <path className="arrow" d={angleArrow(endX, endZ, travel1x, travel1z, arrow)} />
                  </g>
                  {callout}
                </g>
              );
            })}
            {showDimensions ? drawnCircles.filter((circle) => (showConstruction || !circle.construction) && !dimensions.some((dimension) => (dimension.kind === "radius" || dimension.kind === "diameter") && dimension.entityIds.includes(circle.id))).map((circle) => {
              const label = formatDimension(circle.radius, workspace.accuracy);
              const pill = dimensionPillSize(label, screenUnit, 18);
              const editable = tool === "select" && Boolean(onEditCircleRadius);
              return (
                <g
                  key={`radius-${circle.id}`}
                  className={editable ? "editable" : ""}
                  pointerEvents={editable ? "auto" : "none"}
                  transform={`translate(${circle.cx + circle.radius} ${circle.cz - labelOffset})`}
                  onPointerDown={(event) => {
                    if (!editable || event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setRadiusEdit({ circleId: circle.id, value: circle.radius });
                  }}
                >
                  <title>{editable ? "Click to type the radius" : undefined}</title>
                  <rect x={-pill.width / 2} y={-pill.height / 2} width={pill.width} height={pill.height} rx={pill.radius} />
                  <text y={5 * screenUnit} fontSize={13 * screenUnit}>{label}</text>
                </g>
              );
            }) : null}
          </g>
          {sideCallouts.map((sideCallout) => {
            const gap = 3 * screenUnit;
            const overshoot = 3.5 * screenUnit;
            const label = formatDimension(sideCallout.length, workspace.accuracy);
            const pill = sideCalloutPill(label, screenUnit);
            const offset = Math.abs(sideCallout.nx) * pill.width / 2 + Math.abs(sideCallout.nz) * pill.height / 2 + 8 * screenUnit;
            const shift = (amount: number, x: number, z: number) => ({
              x: x + sideCallout.nx * amount,
              z: z + sideCallout.nz * amount,
            });
            const dimA = shift(offset, sideCallout.ax, sideCallout.az);
            const dimB = shift(offset, sideCallout.bx, sideCallout.bz);
            const witnessA0 = shift(gap, sideCallout.ax, sideCallout.az);
            const witnessA1 = shift(offset + overshoot, sideCallout.ax, sideCallout.az);
            const witnessB0 = shift(gap, sideCallout.bx, sideCallout.bz);
            const witnessB1 = shift(offset + overshoot, sideCallout.bx, sideCallout.bz);
            const editable = tool === "select" && (sideCallout.circleId ? Boolean(onEditCircleRadius) : Boolean(onEditSegmentLength) && Boolean(sideCallout.segmentId));
            return (
              <g key={sideCallout.key} className="sketch-side-callout">
                <g pointerEvents="none">
                  <line className="witness" x1={witnessA0.x} y1={witnessA0.z} x2={witnessA1.x} y2={witnessA1.z} />
                  <line className="witness" x1={witnessB0.x} y1={witnessB0.z} x2={witnessB1.x} y2={witnessB1.z} />
                  <line className="span" x1={dimA.x} y1={dimA.z} x2={dimB.x} y2={dimB.z} />
                </g>
                <g
                  className={editable ? "editable" : ""}
                  pointerEvents={editable ? "auto" : "none"}
                  transform={`translate(${(dimA.x + dimB.x) / 2} ${(dimA.z + dimB.z) / 2})`}
                  onPointerDown={(event) => {
                    if (!editable || event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (sideCallout.circleId) setDiameterEdit({ circleId: sideCallout.circleId, value: sideCallout.length });
                    else if (sideCallout.segmentId) setLengthEdit({ segmentId: sideCallout.segmentId, value: sideCallout.length, grow: "end" });
                  }}
                >
                  <title>{editable ? "Click to type the length" : undefined}</title>
                  <rect x={-pill.width / 2} y={-pill.height / 2} width={pill.width} height={pill.height} rx={pill.radius} />
                  <text y={4 * screenUnit} fontSize={12 * screenUnit}>{label}</text>
                </g>
              </g>
            );
          })}
          {activePoint && rubberEnd && (tool === "line" || (tool === "bezier" && pointerAction?.kind !== "bezier")) ? <line className="sketch-preview-line" x1={activePoint.x} y1={activePoint.z} x2={rubberEnd.x} y2={rubberEnd.z} pointerEvents="none" /> : null}
          {activePoint && rubberEnd && (tool === "line" || (tool === "bezier" && pointerAction?.kind !== "bezier")) ? (
            <g className="sketch-segment-dimensions preview" pointerEvents="none" transform={`translate(${(activePoint.x + rubberEnd.x) / 2} ${(activePoint.z + rubberEnd.z) / 2 - labelOffset})`}>
              {(() => {
                const pill = dimensionPillSize(previewLabel, screenUnit, 18);
                return (
                  <>
                    <rect x={-pill.width / 2} y={-pill.height / 2} width={pill.width} height={pill.height} rx={pill.radius} />
                    <text y={5 * screenUnit} fontSize={13 * screenUnit}>{previewLabel}</text>
                  </>
                );
              })()}
            </g>
          ) : null}
          {pointerAction?.kind === "bezier" ? (
            <g className="sketch-drag-handles" pointerEvents="none">
              {activePoint ? (
                <path
                  className="sketch-preview-line"
                  d={bezierDragPreview(
                    activePoint,
                    pointerAction.origin,
                    {
                      x: pointerAction.origin.x * 2 - pointerAction.current.x,
                      z: pointerAction.origin.z * 2 - pointerAction.current.z,
                    },
                  )}
                />
              ) : null}
              <line x1={pointerAction.origin.x * 2 - pointerAction.current.x} y1={pointerAction.origin.z * 2 - pointerAction.current.z} x2={pointerAction.current.x} y2={pointerAction.current.z} />
              <circle cx={pointerAction.origin.x} cy={pointerAction.origin.z} r={controlPointRadius} />
            </g>
          ) : null}
          {pointerAction?.kind === "circle" && circlePreviewRadius > 0 ? (
            <g className="sketch-circle-preview" pointerEvents="none">
              <line
                className="sketch-preview-line"
                x1={pointerAction.origin.x}
                y1={pointerAction.origin.z}
                x2={pointerAction.current.x}
                y2={pointerAction.current.z}
              />
              <circle
                className="sketch-preview-circle"
                cx={pointerAction.origin.x}
                cy={pointerAction.origin.z}
                r={circlePreviewRadius}
              />
              <circle cx={pointerAction.origin.x} cy={pointerAction.origin.z} r={controlPointRadius} className="sketch-cursor-point" />
              <g
                className="sketch-segment-dimensions preview"
                transform={`translate(${(pointerAction.origin.x + pointerAction.current.x) / 2} ${(pointerAction.origin.z + pointerAction.current.z) / 2 - labelOffset})`}
              >
                {(() => {
                  const pill = dimensionPillSize(circlePreviewLabel, screenUnit, 18);
                  return (
                    <>
                      <rect x={-pill.width / 2} y={-pill.height / 2} width={pill.width} height={pill.height} rx={pill.radius} />
                      <text y={5 * screenUnit} fontSize={13 * screenUnit}>{circlePreviewLabel}</text>
                    </>
                  );
                })()}
              </g>
            </g>
          ) : null}
          {squarePreview ? (
            <g className="sketch-shape-preview" pointerEvents="none">
              <rect className="sketch-preview-circle" x={squarePreview.x} y={squarePreview.z} width={squarePreview.side} height={squarePreview.side} />
              <g className="sketch-segment-dimensions preview" transform={`translate(${squarePreview.x + squarePreview.side / 2} ${squarePreview.z - labelOffset})`}>
                {(() => {
                  const pill = dimensionPillSize(squarePreview.label, screenUnit, 18);
                  return (
                    <>
                      <rect x={-pill.width / 2} y={-pill.height / 2} width={pill.width} height={pill.height} rx={pill.radius} />
                      <text y={5 * screenUnit} fontSize={13 * screenUnit}>{squarePreview.label}</text>
                    </>
                  );
                })()}
              </g>
            </g>
          ) : null}
          {boxPreview ? (
            <g className="sketch-shape-preview" pointerEvents="none">
              {boxPreview.kind === "ellipse" ? (
                <ellipse
                  className="sketch-preview-circle"
                  cx={boxPreview.x + boxPreview.width / 2}
                  cy={boxPreview.z + boxPreview.height / 2}
                  rx={boxPreview.width / 2}
                  ry={boxPreview.height / 2}
                />
              ) : (
                <rect
                  className="sketch-preview-circle"
                  x={boxPreview.x}
                  y={boxPreview.z}
                  width={boxPreview.width}
                  height={boxPreview.height}
                  rx={boxPreview.rx}
                  ry={boxPreview.rx}
                />
              )}
              <g
                className="sketch-segment-dimensions preview"
                transform={`translate(${boxPreview.x + boxPreview.width / 2} ${boxPreview.z - labelOffset})`}
              >
                {(() => {
                  const pill = dimensionPillSize(boxPreview.label, screenUnit, 18);
                  return (
                    <>
                      <rect x={-pill.width / 2} y={-pill.height / 2} width={pill.width} height={pill.height} rx={pill.radius} />
                      <text y={5 * screenUnit} fontSize={13 * screenUnit}>{boxPreview.label}</text>
                    </>
                  );
                })()}
              </g>
            </g>
          ) : null}
          {radialPreview && pointerAction && (pointerAction.kind === "triangle" || pointerAction.kind === "polygon" || pointerAction.kind === "star") ? (
            <g className="sketch-shape-preview" pointerEvents="none">
              <line className="sketch-preview-line" x1={pointerAction.origin.x} y1={pointerAction.origin.z} x2={pointerAction.current.x} y2={pointerAction.current.z} />
              <path className="sketch-preview-circle" d={radialPreview.d} />
              <g
                className="sketch-segment-dimensions preview"
                transform={`translate(${(pointerAction.origin.x + pointerAction.current.x) / 2} ${(pointerAction.origin.z + pointerAction.current.z) / 2 - labelOffset})`}
              >
                {(() => {
                  const pill = dimensionPillSize(radialPreview.label, screenUnit, 18);
                  return (
                    <>
                      <rect x={-pill.width / 2} y={-pill.height / 2} width={pill.width} height={pill.height} rx={pill.radius} />
                      <text y={5 * screenUnit} fontSize={13 * screenUnit}>{radialPreview.label}</text>
                    </>
                  );
                })()}
              </g>
            </g>
          ) : null}
          {offsetGhost && offsetGhost.length >= 3 ? (
            <g className="sketch-shape-preview" pointerEvents="none">
              <polygon className="sketch-preview-line" fill="none" points={offsetGhost.map((point) => `${point.x},${point.z}`).join(" ")} />
            </g>
          ) : null}
          {offsetPreview ? (
            <g className="sketch-shape-preview" pointerEvents="none">
              {offsetPreview.closed ? (
                <polygon className="sketch-preview-line" fill="none" points={offsetPreview.preview.map((point) => `${point.x},${point.z}`).join(" ")} />
              ) : (
                <line className="sketch-preview-line" x1={offsetPreview.preview[0]?.x ?? 0} y1={offsetPreview.preview[0]?.z ?? 0} x2={offsetPreview.preview[1]?.x ?? 0} y2={offsetPreview.preview[1]?.z ?? 0} />
              )}
              <g className="sketch-segment-dimensions preview" transform={`translate(${offsetPreview.midX} ${offsetPreview.midZ - labelOffset})`}>
                {(() => {
                  const pill = dimensionPillSize(offsetPreview.label, screenUnit, 18);
                  return (
                    <>
                      <rect x={-pill.width / 2} y={-pill.height / 2} width={pill.width} height={pill.height} rx={pill.radius} />
                      <text y={5 * screenUnit} fontSize={13 * screenUnit}>{offsetPreview.label}</text>
                    </>
                  );
                })()}
              </g>
            </g>
          ) : null}
          {arcDraft.length > 0 ? (
            <g className="sketch-shape-preview" pointerEvents="none">
              {arcDraft.map((point, index) => (
                <circle key={`arc-draft-${index}`} className="sketch-cursor-point" cx={point.x} cy={point.z} r={controlPointRadius} />
              ))}
              {arcDraft.length === 1 && hover ? (
                <line className="sketch-preview-line" x1={arcDraft[0].x} y1={arcDraft[0].z} x2={hover.x} y2={hover.z} />
              ) : null}
              {arcDraft.length === 2 ? (
                <>
                  <line className="sketch-preview-line" x1={arcDraft[0].x} y1={arcDraft[0].z} x2={arcDraft[1].x} y2={arcDraft[1].z} />
                  {hover ? <circle className="sketch-preview-circle" cx={hover.x} cy={hover.z} r={hoverPointRadius} /> : null}
                </>
              ) : null}
            </g>
          ) : null}
          {measurement ? (
            <g className="sketch-measurement">
              <line x1={measurement.start.x} y1={measurement.start.z} x2={measurement.end.x} y2={measurement.end.z} />
              <circle className="sketch-measurement-point" cx={measurement.start.x} cy={measurement.start.z} r={pointRadius} pointerEvents="none" />
              <circle className="sketch-measurement-point" cx={measurement.end.x} cy={measurement.end.z} r={pointRadius} pointerEvents="none" />
              <g
                className="sketch-measurement-pill"
                role="button"
                tabIndex={0}
                aria-label="Remove measurement"
                transform={`translate(${(measurement.start.x + measurement.end.x) / 2} ${(measurement.start.z + measurement.end.z) / 2 - labelOffset})`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onClearMeasurement();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " " || event.key === "Escape" || event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClearMeasurement();
                  }
                }}
              >
                <rect x={-dimensionPillSize(measurementLabel, screenUnit, 30).width / 2} y={-dimensionPillSize(measurementLabel, screenUnit, 30).height / 2} width={dimensionPillSize(measurementLabel, screenUnit, 30).width} height={dimensionPillSize(measurementLabel, screenUnit, 30).height} rx={dimensionPillSize(measurementLabel, screenUnit, 30).radius} />
                <text x={-5 * screenUnit} y={5 * screenUnit} fontSize={13 * screenUnit}>{measurementLabel}</text>
                <text className="remove" x={dimensionPillSize(measurementLabel, screenUnit, 30).width / 2 - 8 * screenUnit} y={5 * screenUnit} fontSize={14 * screenUnit}>x</text>
              </g>
            </g>
          ) : null}
          {pendingMeasurementStart ? (
            <g className="sketch-measurement pending" pointerEvents="none">
              {hover ? <line x1={pendingMeasurementStart.x} y1={pendingMeasurementStart.z} x2={hover.x} y2={hover.z} /> : null}
              <circle className="sketch-measurement-point pending" cx={pendingMeasurementStart.x} cy={pendingMeasurementStart.z} r={pointRadius} />
              {hover ? <circle className="sketch-measurement-point hover" cx={hover.x} cy={hover.z} r={pointRadius} /> : null}
            </g>
          ) : null}
          {selectedPoint && (selectedPoint.handleIn || selectedPoint.handleOut) ? (
            <g className="sketch-curve-handles">
              {selectedPoint.handleIn ? <><line x1={selectedPoint.x} y1={selectedPoint.z} x2={selectedPoint.handleIn.x} y2={selectedPoint.handleIn.z} /><circle data-sketch-entity="handle" cx={selectedPoint.handleIn.x} cy={selectedPoint.handleIn.z} r={controlPointRadius * 1.8} onPointerDown={(event) => event.button === 1 ? beginPan(event) : beginEntityDrag(event, { kind: "move-handle", pointerId: event.pointerId, pointId: selectedPoint.id, handle: "in", current: selectedPoint.handleIn! })} /></> : null}
              {selectedPoint.handleOut ? <><line x1={selectedPoint.x} y1={selectedPoint.z} x2={selectedPoint.handleOut.x} y2={selectedPoint.handleOut.z} /><circle data-sketch-entity="handle" cx={selectedPoint.handleOut.x} cy={selectedPoint.handleOut.z} r={controlPointRadius * 1.8} onPointerDown={(event) => event.button === 1 ? beginPan(event) : beginEntityDrag(event, { kind: "move-handle", pointerId: event.pointerId, pointId: selectedPoint.id, handle: "out", current: selectedPoint.handleOut! })} /></> : null}
            </g>
          ) : null}
          <g className="sketch-points">
            {displayProfile.points.filter((point) => !isCircleStandIn(point.id)).map((point) => (
              <g key={point.id}>
              <circle
                data-sketch-entity="point"
                className="hit"
                cx={point.x}
                cy={point.z}
                r={Math.max(pointRadius * 2.6, 12 * screenUnit)}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.button === 1) {
                    beginPan(event);
                  } else if (event.button === 0 && tool === "erase" && eraseWhole) {
                    const target = wholeEraseTarget(profile, { pointId: point.id }, constraintEntities);
                    if (target && (target.pointIds.length || target.segmentIds.length)) {
                      onEraseEntities(target.pointIds, target.segmentIds);
                    }
                  } else if (event.button === 0 && tool === "erase") {
                    beginEraseStroke(event, { x: point.x, z: point.z });
                  } else if (tool === "refine") {
                    onDeletePoint(point.id);
                  } else if (event.button === 0 && tool === "bezier") {
                    beginEntityDrag(event, {
                      kind: "bezier",
                      pointerId: event.pointerId,
                      origin: { x: point.x, z: point.z },
                      current: { x: point.x, z: point.z },
                      joinPointId: point.id,
                    });
                  } else if (event.button === 0) {
                    const now = performance.now();
                    const last = pointClickRef.current;
                    const again = tool !== "smooth" && tool !== "fillet" && tool !== "chamfer" && last?.id === point.id && now - last.at < 600;
                    if (again) {
                      pointClickRef.current = null;
                      pendingPointDragRef.current = null;
                      const curved = point.mode === "smooth" || point.mode === "split";
                      onSetPointMode(point.id, curved ? "corner" : "smooth");
                    } else {
                      if (tool !== "smooth") pointClickRef.current = { id: point.id, at: now };
                      if (tool === "select") {
                        onPointPress(point.id);
                        pendingPointDragRef.current = { pointerId: event.pointerId, pointId: point.id, x: point.x, z: point.z, clientX: event.clientX, clientY: event.clientY };
                      } else {
                        onPointPress(point.id);
                      }
                    }
                  }
                }}
              />
              <circle
                className={`mark ${isPointSelected(point.id) ? "selected" : ""} ${activePointId === point.id ? "active" : ""} ${eraseWholePointIds.has(point.id) ? "is-erase-target" : ""}`}
                cx={point.x}
                cy={point.z}
                r={pointRadius}
                pointerEvents="none"
              />
              </g>
            ))}
          </g>
          {selectedImage && selectedImageBounds && tool === "select" ? (
            <g className="sketch-image-selection">
              <rect
                className="sketch-image-selection-box"
                x={selectedImageBounds.minX}
                y={selectedImageBounds.minZ}
                width={selectedImage.width}
                height={selectedImage.depth}
                pointerEvents="none"
              />
              <g className="sketch-image-dimension width" pointerEvents="none" transform={`translate(${selectedImage.x} ${selectedImageBounds.minZ - labelOffset})`}>
                {(() => {
                  const label = formatDimension(selectedImage.width, workspace.accuracy);
                  const pill = dimensionPillSize(label, screenUnit, 18);
                  return (
                    <>
                      <rect x={-pill.width / 2} y={-pill.height / 2} width={pill.width} height={pill.height} rx={pill.radius} />
                      <text y={5 * screenUnit} fontSize={13 * screenUnit}>{label}</text>
                    </>
                  );
                })()}
              </g>
              <g className="sketch-image-dimension depth" pointerEvents="none" transform={`translate(${selectedImageBounds.maxX + 34 * screenUnit} ${selectedImage.z})`}>
                {(() => {
                  const label = formatDimension(selectedImage.depth, workspace.accuracy);
                  const pill = dimensionPillSize(label, screenUnit, 18);
                  return (
                    <>
                      <rect x={-pill.width / 2} y={-pill.height / 2} width={pill.width} height={pill.height} rx={pill.radius} />
                      <text y={5 * screenUnit} fontSize={13 * screenUnit}>{label}</text>
                    </>
                  );
                })()}
              </g>
              {imageResizeHandles.map((handle) => (
                <rect
                  key={handle.id}
                  data-sketch-entity="image-handle"
                  className={`sketch-image-resize-handle handle-${handle.id}`}
                  x={handle.x - handleSize / 2}
                  y={handle.z - handleSize / 2}
                  width={handleSize}
                  height={handleSize}
                  rx={handleRadius}
                  onPointerDown={(event) => {
                    if (event.button === 1) {
                      beginPan(event);
                      return;
                    }
                    if (event.button !== 0) return;
                    const point = pointFromEvent(event);
                    if (!point) return;
                    beginEntityDrag(event, {
                      kind: "resize-image",
                      pointerId: event.pointerId,
                      imageId: selectedImage.id,
                      handle: handle.id,
                      current: point,
                      start: { ...selectedImage },
                    });
                  }}
                />
              ))}
            </g>
          ) : null}
          {hover && ["line", "bezier", "circle", "square", "triangle", "polygon", "arc", "measure"].includes(tool) ? (
            <circle className="sketch-cursor-point" cx={hover.x} cy={hover.z} r={hoverPointRadius} pointerEvents="none" />
          ) : null}
          {tool === "erase" && (hover || (pointerAction?.kind === "erase" ? pointerAction.current : null)) ? (
            (() => {
              const tip = hover ?? (pointerAction?.kind === "erase" ? pointerAction.current : null);
              if (!tip) return null;
              return (
                <g className={`sketch-eraser-tip${eraseWhole ? " is-whole" : ""}`} pointerEvents="none">
                  <circle className="sketch-eraser-brush" cx={tip.x} cy={tip.z} r={eraseBrushRadius} />
                  <g transform={`translate(${tip.x + eraseBrushRadius * 0.35} ${tip.z - eraseBrushRadius * 1.15}) scale(${screenUnit * 1.15})`}>
                    <path
                      className="sketch-eraser-glyph"
                      d="M2 18 L14 6 L20 12 L8 24 Z M14 6 L17 3 L23 9 L20 12 Z"
                    />
                  </g>
                </g>
              );
            })()
          ) : null}
          {activeSnap?.alignTo?.length ? (
            <g className="sketch-align" pointerEvents="none">
              {activeSnap.alignTo.map((point, index) => (
                <g key={`${point.x}-${point.z}-${index}`}>
                  <line className="sketch-align-line" x1={point.x} y1={point.z} x2={activeSnap.x} y2={activeSnap.z} />
                  <circle className="sketch-align-point" cx={point.x} cy={point.z} r={4.5 * screenUnit} />
                </g>
              ))}
            </g>
          ) : null}
          {activeSnap && activeSnap.kind !== "grid" && !activeSnap.alignTo?.length && (
            tool === "line"
            || tool === "bezier"
            || tool === "arc"
            || tool === "measure"
            || tool === "circle"
            || tool === "ellipse"
            || tool === "square"
            || tool === "rectangle"
            || tool === "roundRect"
            || tool === "slot"
            || tool === "triangle"
            || tool === "polygon"
            || tool === "star"
            || pointerAction?.kind === "move-point"
            || pointerAction?.kind === "move-outline"
            || pointerAction?.kind === "resize-circle"
            || pointerAction?.kind === "move-handle"
          ) ? (
            <SketchSnapGlyph
              kind={activeSnap.kind}
              x={activeSnap.x}
              z={activeSnap.z}
              screenUnit={screenUnit}
            />
          ) : null}
          {showDimensions && dimensions.length > 0 ? (
            <g className="sketch-driving-dimensions">
              {dimensions.map((dimension) => {
                const label = `${dimension.value.toFixed(2)}`;
                const pill = dimensionPillSize(label, screenUnit, 18);
                let x = dimension.labelOffset?.x ?? 0;
                let z = dimension.labelOffset?.z ?? 0;
                if (dimension.entityIds[0]) {
                  const segment = displayProfile.segments.find((entry) => entry.id === dimension.entityIds[0]);
                  const dim = segment ? segmentDimension(segment, pointById) : null;
                  if (dim) {
                    x = dim.midpoint.x;
                    z = dim.midpoint.z - labelOffset;
                  }
                }
                if ((dimension.kind === "radius" || dimension.kind === "diameter") && dimension.entityIds[0]) {
                  const circle = drawnCircles.find((entry) => entry.id === dimension.entityIds[0]);
                  if (circle) {
                    x = circle.cx + circle.radius;
                    z = circle.cz - labelOffset;
                  }
                }
                if (dimension.pointIds && dimension.pointIds.length >= 2) {
                  const a = pointById.get(dimension.pointIds[0]);
                  const b = pointById.get(dimension.pointIds[1]);
                  if (a && b) {
                    x = (a.x + b.x) / 2;
                    z = (a.z + b.z) / 2 - labelOffset;
                  }
                }
                return (
                  <g
                    key={dimension.id}
                    className={dimension.driving ? "driving" : "driven"}
                    transform={`translate(${x} ${z})`}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!onEditDimension || !dimension.driving) return;
                      setDimensionDialog({ id: dimension.id, value: dimension.value });
                    }}
                  >
                    <rect x={-pill.width / 2} y={-pill.height / 2} width={pill.width} height={pill.height} rx={pill.radius} />
                    <text y={5 * screenUnit} fontSize={13 * screenUnit}>{label}</text>
                  </g>
                );
              })}
            </g>
          ) : null}
          {showConstraints && constraints.length > 0 ? (
            <g className="sketch-constraint-glyphs" pointerEvents="none">
              {constraints.filter((constraint) => !constraint.suppressed).map((constraint, index) => {
                const anchor = constraintGlyphAnchor(constraint, constraintEntities, pointById);
                if (!anchor) return null;
                const glyph = CONSTRAINT_GLYPH[constraint.kind] ?? CONSTRAINT_LABELS[constraint.kind]?.[0] ?? "?";
                const conflict = constraintConflicts.includes(constraint.id);
                const size = 16 * screenUnit;
                // Fan overlapping glyphs slightly so stacked constraints stay readable.
                const offsetX = (index % 3) * 4 * screenUnit;
                const offsetZ = -18 * screenUnit - Math.floor(index / 3) * 4 * screenUnit;
                return (
                  <g
                    key={constraint.id}
                    className={`sketch-constraint-glyph${conflict ? " conflict" : ""}`}
                    transform={`translate(${anchor.x + offsetX} ${anchor.z + offsetZ})`}
                  >
                    <title>{CONSTRAINT_LABELS[constraint.kind]}{conflict ? " (conflict)" : ""}</title>
                    <circle r={size * 0.55} />
                    <text y={4 * screenUnit} fontSize={11 * screenUnit}>{glyph}</text>
                  </g>
                );
              })}
            </g>
          ) : null}
        </svg>
      </section>
      {selectedImage && tool === "select" ? (
        <SketchImageInspector
          image={selectedImage}
          accuracy={workspace.accuracy}
          onClose={() => onSelectMany([], [], [])}
          onUpdate={(patch, message) => onUpdateImage(selectedImage.id, patch, message)}
          onDelete={() => onDeleteImage(selectedImage.id)}
        />
      ) : null}
      <div className="grid-settings sketch-grid-settings">
        <SnapGridControl
          snap={snap}
          snapOpen={snapOpen}
          onSnapChange={(next) => {
            setSnap(next);
            onSnapChange?.(typeof next === "function" ? next(snap) : next);
          }}
          onSnapOpenChange={setSnapOpen}
        />
      </div>
      {dimensionDialog ? (
        <InlineValueDialog
          title="Edit dimension"
          fields={[{ key: "value", label: "Dimension value", value: String(dimensionDialog.value), unit: "mm", min: 0 }]}
          confirmLabel="Apply"
          onCancel={() => setDimensionDialog(null)}
          onConfirm={(values) => {
            const value = Number.parseFloat(values.value ?? "");
            const { id } = dimensionDialog;
            setDimensionDialog(null);
            if (Number.isFinite(value) && value > 0) onEditDimension?.(id, value);
          }}
        />
      ) : null}
      {lengthEdit ? (
        <InlineValueDialog
          title="Line length"
          fields={[{ key: "value", label: "Length", value: lengthEdit.value.toFixed(2), unit: "mm", min: 0 }]}
          confirmLabel="Apply"
          note={
            <button
              type="button"
              onClick={() => setLengthEdit((current) => current ? { ...current, grow: current.grow === "end" ? "both" : "end" } : current)}
            >
              {lengthEdit.grow === "both" ? "Grows both ways" : "Start stays, far end moves"}
            </button>
          }
          onCancel={() => setLengthEdit(null)}
          onConfirm={(values) => {
            const value = Number.parseFloat(values.value ?? "");
            const edit = lengthEdit;
            setLengthEdit(null);
            if (edit && Number.isFinite(value) && value > 0) onEditSegmentLength?.(edit.segmentId, value, edit.grow);
          }}
        />
      ) : null}
      {angleEdit ? (
        <InlineValueDialog
          title="Corner angle"
          fields={[{ key: "value", label: "Angle", value: angleEdit.value.toFixed(1), unit: "°", min: 1 }]}
          confirmLabel="Apply"
          note={
            <button
              type="button"
              onClick={() => setAngleEdit((current) => current ? { ...current, leg: current.leg === 0 ? 1 : 0 } : current)}
            >
              {angleEdit.leg === 0 ? "Turns the first line" : "Turns the second line"}
            </button>
          }
          onCancel={() => setAngleEdit(null)}
          onConfirm={(values) => {
            const value = Number.parseFloat(values.value ?? "");
            const edit = angleEdit;
            setAngleEdit(null);
            if (edit && Number.isFinite(value)) onEditCornerAngle?.(edit.pointId, value, edit.leg);
          }}
        />
      ) : null}
      {radiusEdit ? (
        <InlineValueDialog
          title="Circle radius"
          fields={[{ key: "value", label: "Radius", value: radiusEdit.value.toFixed(2), unit: "mm", min: 0 }]}
          confirmLabel="Apply"
          onCancel={() => setRadiusEdit(null)}
          onConfirm={(values) => {
            const value = Number.parseFloat(values.value ?? "");
            const edit = radiusEdit;
            setRadiusEdit(null);
            if (edit && Number.isFinite(value) && value > 0.05) onEditCircleRadius?.(edit.circleId, value);
          }}
        />
      ) : null}
      {diameterEdit ? (
        <InlineValueDialog
          title="Diameter"
          fields={[{ key: "value", label: "Diameter", value: diameterEdit.value.toFixed(2), unit: "mm", min: 0 }]}
          confirmLabel="Apply"
          onCancel={() => setDiameterEdit(null)}
          onConfirm={(values) => {
            const value = Number.parseFloat(values.value ?? "");
            const edit = diameterEdit;
            setDiameterEdit(null);
            if (edit && Number.isFinite(value) && value > 0.1) onEditCircleRadius?.(edit.circleId, value / 2);
          }}
        />
      ) : null}
    </main>
  );
}

function SketchImageInspector({
  image,
  accuracy,
  onClose,
  onUpdate,
  onDelete,
}: {
  image: SketchImage;
  accuracy: 1 | 2 | 3;
  onClose: () => void;
  onUpdate: (patch: Partial<SketchImage>, message?: string) => void;
  onDelete: () => void;
}) {
  const aspect = image.width / Math.max(0.5, image.depth);
  const updateWidth = (width: number) => onUpdate({
    width,
    ...(image.lockAspect !== false ? { depth: Math.max(0.5, width / aspect) } : {}),
  }, "Sketch image width updated");
  const updateDepth = (depth: number) => onUpdate({
    depth,
    ...(image.lockAspect !== false ? { width: Math.max(0.5, depth * aspect) } : {}),
  }, "Sketch image height updated");

  return (
    <aside className="shape-inspector sketch-image-inspector" aria-label={`${image.name} image settings`} onPointerDown={(event) => event.stopPropagation()}>
      <div className="shape-inspector-header">
        <PeakTipButton className="inspector-header-icon" label="Close image settings" onClick={onClose}>
          <ChevronUp size={26} strokeWidth={2.8} />
        </PeakTipButton>
        <strong>{image.name}</strong>
        <div className="inspector-header-actions">
          <PeakTipButton className="inspector-header-icon danger" label="Delete image" onClick={onDelete}>
            <Trash2 size={25} strokeWidth={2.2} />
          </PeakTipButton>
        </div>
      </div>
      <div className="sketch-image-preview-card">
        <img src={image.dataUrl} alt="" />
        <span>{image.pixelWidth} × {image.pixelHeight} px</span>
      </div>
      <div className="property-card">
        <div className="property-card-header static"><span>Properties</span></div>
        <div className="property-list">
          <SketchImageRange label="Width" value={image.width} min={0.5} max={200} accuracy={accuracy} onChange={updateWidth} />
          <SketchImageRange label="Height" value={image.depth} min={0.5} max={200} accuracy={accuracy} onChange={updateDepth} />
          <SketchImageRange label="Opacity" value={(image.opacity ?? 0.55) * 100} min={5} max={100} accuracy={1} suffix="%" onChange={(opacity) => onUpdate({ opacity: opacity / 100 }, "Sketch image opacity updated")} />
          <SketchImagePosition
            label="Position X"
            value={image.x}
            accuracy={accuracy}
            onCommit={(x) => onUpdate({ x }, "Sketch image moved")}
          />
          <SketchImagePosition
            label="Position Y"
            value={image.z}
            accuracy={accuracy}
            onCommit={(z) => onUpdate({ z }, "Sketch image moved")}
          />
          <button className={`sketch-image-aspect-toggle ${image.lockAspect !== false ? "active" : ""}`} type="button" onClick={() => onUpdate({ lockAspect: image.lockAspect === false }, "Image aspect ratio setting updated")}>
            {image.lockAspect !== false ? <Link size={17} /> : <Link2Off size={17} />}
            <span>{image.lockAspect !== false ? "Aspect ratio locked" : "Aspect ratio unlocked"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * Position entry that commits on blur rather than on every keystroke.
 *
 * Writing straight through on change meant a half-typed value was parsed and echoed back: a leading
 * minus or a trailing decimal point evaluated to NaN or a truncated number, so the field snapped
 * back and negative and sub-accuracy positions could not be typed at all.
 */
function SketchImagePosition({
  label,
  value,
  accuracy,
  onCommit,
}: {
  label: string;
  value: number;
  accuracy: 1 | 2 | 3;
  onCommit: (value: number) => void;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const [draft, setDraft] = useState(formatDimension(safeValue, accuracy));
  useEffect(() => setDraft(formatDimension(safeValue, accuracy)), [accuracy, safeValue]);
  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(formatDimension(safeValue, accuracy));
  };
  return (
    <label className="sketch-image-position-field">
      <span>{label}</span>
      <input
        type="number"
        step={accuracy === 1 ? 0.1 : 0.01}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(formatDimension(safeValue, accuracy));
        }}
      />
    </label>
  );
}

function SketchImageRange({
  label,
  value,
  min,
  max,
  accuracy,
  suffix = "mm",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  accuracy: 1 | 2 | 3;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const safeValue = clamp(Number.isFinite(value) ? value : min, min, max);
  const [draft, setDraft] = useState(formatDimension(safeValue, accuracy));
  useEffect(() => setDraft(formatDimension(safeValue, accuracy)), [accuracy, safeValue]);
  const commit = () => {
    const parsed = Number(draft);
    onChange(clamp(Number.isFinite(parsed) ? parsed : safeValue, min, max));
  };
  const position = ((safeValue - min) / Math.max(0.001, max - min)) * 100;
  return (
    <label className="range-property sketch-image-range" style={{ "--slider-pos": `${position}%` } as CSSProperties}>
      <span>{label}</span>
      <div className="sketch-image-range-row">
        <input
          className="sketch-image-number-input"
          type="number"
          min={min}
          max={max}
          step={accuracy === 1 ? 0.1 : 0.01}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
        <span>{suffix}</span>
      </div>
      <ThumbRangeInput min={min} max={max} step={accuracy === 1 ? 0.1 : 0.01} value={safeValue} onValueChange={onChange} />
    </label>
  );
}
