"use client";

import { stlMegabytes } from "@/lib/laser/crystalFile";
import { ChevronDown, ChevronUp, Copy, Split, X } from "lucide-react";
import { isLaserDesign } from "@/lib/laserMachine";
import { LASER_JOB_LABEL, type LaserJob } from "@/lib/laser/cutFile";
import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { ToolbarHideSelectedIcon, ToolbarLockShapeIcon, ToolbarUnlockShapeIcon } from "@/components/icons";
import { ShapeModeMark } from "@/components/workplane/ShapeModeMark";
import { InlineValueDialog } from "@/components/workplane/InlineValueDialog";
import { ThumbRangeInput } from "@/components/workplane/ThumbRangeInput";
import { PeakTipButton, PeakTipLabel } from "@/components/workplane/ToolNameTooltip";
import { useChromePresence } from "@/lib/chromePresence";
import { TOOL_DESCRIPTIONS } from "@/lib/toolDescriptions";
import { displayStepFromMillimeters, displayToMillimeters, formatMeasurementNumber, formatVolumeWithMilliliters, lengthDisplayUnit, millimetersToDisplay } from "@/lib/measurementUnits";
import { partFeatureLabel, partStepSize } from "@/lib/partFeatures";
import {
  clampRoofRidgeX,
  MAX_ROOF_ANGLE,
  MIN_ROOF_ANGLE,
  roofAnglesFromProfile,
  roofAnglesFromRidge,
  roofRidgeXFromLeftAngle,
  roofRidgeXFromRightAngle,
} from "@/lib/roofGeometry";
import {
  DEFAULT_THREAD_SIDES,
  defaultThreadClearance,
  effectiveThreadClearance,
  MAX_THREAD_CLEARANCE,
  MAX_THREAD_SIDES,
  MIN_THREAD_CLEARANCE,
  MIN_THREAD_SIDES,
  threadNutSize,
} from "@/lib/metricThreadSolid";
import { THREAD_SIZE_OPTIONS, type ThreadSeries } from "@/lib/metricThreads";
import { canMakeMatchingTappedHole, threadCanBeHole } from "@/lib/threadShape";
import { resolveShapeSides, resolveShapeSteps } from "@/lib/displayTessellation";
import {
  gearFootprint,
  gearFormFromLabel,
  gearFormLabel,
  gearInspectorHint,
  gearMetrics,
  normalizeGearSpec,
  type GearSpec,
} from "@/lib/gearProfile";
import {
  GRIDFINITY_BIN_CLEARANCE,
  GRIDFINITY_HEIGHT_UNIT,
  GRIDFINITY_LIP_HEIGHT,
  GRIDFINITY_MAX_COMPARTMENTS,
  GRIDFINITY_MAX_HEIGHT_UNITS,
  GRIDFINITY_MAX_PADDING,
  GRIDFINITY_MAX_UNITS,
  GRIDFINITY_PITCH,
  GRIDFINITY_SIDES,
  gridfinityDrawerFit,
  normalizeGridfinityBaseplateSpec,
  normalizeGridfinityBinSpec,
} from "@/lib/gridfinity";
import { withGridfinityBaseplateSpec, withGridfinityBinSpec } from "@/lib/gridfinityShape";
import { loftHasSteps, loftPatch, maxLoftWall, withLoftSettings, withLoftStarter } from "@/lib/loftShape";
import { parseDimensionEntry } from "@/lib/dimensionEntry";
import { uniformScalePatch } from "@/lib/uniformScale";
import { fallbackSolidColor, MAX_SHAPE_SIDES, resizedShapeSize, shapeDepth, shapeWidth, coneBaseRadius, coneIsFreeRange, conePatchForFootprint, conePatchForRadii, conePatchForStandardMode, coneTopRadius, coneVisibleProfile } from "@/lib/workplaneShapes";
import { inferCsgOp, isEvaluatedCsgBody } from "@/lib/csgTree";
import { isConstructionShape } from "@/lib/holeFeature";
import { patternFeatureLabel } from "@/lib/patternFeature";
import {
  shapeExportQualityHint,
  shapeExportQualityHintInScene,
  shapeExportQualityLabel,
  shapeExportQualityTitle,
} from "@/lib/stepQuality";
import { resolveEditableSketchShape } from "@/lib/sketch";
import { DEFAULT_TEXT_FONT, textFontOptions } from "@/lib/textFonts";
import { measureWorkplaneShape, type ShapeMeasure } from "@/lib/shapeMeasure";
import type {
  GridfinityBaseplateSpec,
  GridfinityBinSpec,
  GridfinitySide,
  GridSize,
  LoftOutline,
  MeasurementAccuracy,
  SmoothSpec,
  WorkplaneShape,
  WorkplaneWorkspaceSettings,
} from "@/types/sketchforge";

const MAX_SHAPE_STEPS = 128;

const THREAD_SERIES_OPTIONS = ["Metric", "UNC", "UNF", "Pipe (G)", "Custom"] as const;
const THREAD_ROLE_OPTIONS = ["Rod", "Screw", "Nut", "Tapped hole"] as const;
const THREAD_HEAD_OPTIONS = ["Cylinder", "Countersunk", "Hex"] as const;
const THREAD_HAND_OPTIONS = ["Right", "Left"] as const;
const THREAD_PROFILE_OPTIONS = ["V", "Whitworth", "Trapezoid", "Round"] as const;

function threadSeriesLabel(series: ThreadSeries) {
  if (series === "unc") return "UNC";
  if (series === "unf") return "UNF";
  if (series === "g") return "Pipe (G)";
  if (series === "custom") return "Custom";
  return "Metric";
}

function threadRoleLabel(role: string | undefined, style: string | undefined, part: string | undefined) {
  if (role === "screw") return "Screw";
  if (role === "nut") return "Nut";
  if (role === "bore" || style === "hole" || part === "threads") return "Tapped hole";
  return "Rod";
}

const GRID_SIZES: GridSize[] = ["Off", "0.1 mm", "0.25 mm", "0.5 mm", "1.0 mm", "2.0 mm", "5.0 mm"];
const MIN_SHAPE_SIZE = 0.01;
const SOLID_COLORS = [
  "#d41721",
  "#ff4b4b",
  "#ff7a1a",
  "#d97813",
  "#f6a21a",
  "#f2cf10",
  "#f7e65a",
  "#a8d642",
  "#33983d",
  "#1fb66d",
  "#18b99a",
  "#0098c7",
  "#49c7ef",
  "#3b82f6",
  "#294c93",
  "#5b5ce2",
  "#6e2786",
  "#9b3bd2",
  "#c9009a",
  "#f062b6",
  "#8a5a2b",
  "#b98254",
  "#f2caa0",
  "#ffffff",
  "#cfd8df",
  "#8a98a6",
  "#4b5563",
  "#111111",
];
type RangePropertyConfig = {
  type?: "range";
  label: string;
  value: number;
  min: number;
  max: number;
  /** Typed values may pass the slider. The slider itself stays on min–max. */
  typedMax?: number;
  step?: number;
  hint?: string;
  /** Draw a center mark and snap the thumb to 0. */
  centerDetent?: boolean;
  onChange: (value: number) => void;
};

type TextPropertyConfig = {
  type: "text";
  label: string;
  value: string;
  maxLength?: number;
  onChange: (value: string) => void;
};

type SelectPropertyConfig = {
  type: "select";
  label: string;
  value: string;
  options: string[];
  hint?: string;
  onChange: (value: string) => void;
};

type ShapePropertyConfig = RangePropertyConfig | TextPropertyConfig | SelectPropertyConfig;
export type ShapeInspectorUpdateOptions = { resizeAxis?: "width" | "depth" | "height" };

/** The Smooth card: settings, and Edit points while it is on. */
export type SmoothInspectorControls = {
  editing: boolean;
  preparing: boolean;
  selectedCount: number;
  /** Middle of the selected points, world mm. */
  selectionCenter: [number, number, number] | null;
  /** Size of the blocks inside, before smoothing. */
  blocks: { width: number; depth: number; height: number };
  hasFlatBottom: boolean;
  /** A click on the part picks a face to keep flat. */
  pickingFace: boolean;
  /** Drags pull straight in and out of the surface, rather than moving freely. */
  dragInOut: boolean;
  onDragInOutChange: (inOut: boolean) => void;
  /** Faces kept exactly flat. */
  keptFaces: number;
  /** Some edges between the selected points are smooth, or sharp. */
  canMakeSharp: boolean;
  canMakeSmooth: boolean;
  onChange: (patch: Partial<SmoothSpec>) => void;
  onToggleEdit: () => void;
  onMoveSelection: (axis: 0 | 1 | 2, valueMm: number) => void;
  onPickFace: () => void;
  onMakeSharp: () => void;
  onMakeSmooth: () => void;
  onResetPoints: () => void;
};

const SMOOTH_MIRROR_LABELS = { off: "Off", x: "Left to right", z: "Front to back" } as const;

type ShapeInspectorUpdate = (patch: Partial<WorkplaneShape>, options?: ShapeInspectorUpdateOptions) => void;

/** First row of a part's step list: what the steps were applied to. */
function partStepsStartLabel(shape: WorkplaneShape) {
  if (shape.groupedShapes?.length) return "Combined parts";
  const kind = shape.featureBase?.importedMesh ? "Imported part" : shape.featureBase?.kind ?? shape.kind;
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * A typed value is kept when you click anywhere else, not only on Enter. Clicking the 3D view
 * does not take focus from the field, and the click may deselect the shape and close this panel
 * before the field ever loses focus, so the field lets go of focus as soon as the press starts.
 */
function useBlurOnOutsidePress(inputRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onPress = (event: PointerEvent) => {
      const input = inputRef.current;
      if (!input || document.activeElement !== input) return;
      if (event.target instanceof Node && input.contains(event.target)) return;
      input.blur();
    };
    document.addEventListener("pointerdown", onPress, true);
    return () => document.removeEventListener("pointerdown", onPress, true);
  }, [inputRef]);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Length / Width / Height may be typed past the slider range for large prints,
// but a stray "1e9" must not build a kilometre-scale mesh that freezes the tab.
export const TYPED_DIMENSION_MAX_MM = 2000;

function formatPropertyNumber(value: number, accuracy: MeasurementAccuracy, step: number) {
  if (step >= 1) return String(Math.round(value));
  return formatMeasurementNumber(value, accuracy, step);
}

function isFootprintSize(property: ShapePropertyConfig): property is RangePropertyConfig {
  return !("type" in property) && (property.label === "Length" || property.label === "Width" || property.label === "Height");
}

function propertyUsesLengthUnit(label: string) {
  return /length|width|height|radius|bevel|thickness|clearance|module|backlash|rim|hole|padding/i.test(label);
}

function propertyUsesDegreeUnit(label: string) {
  return label === "Left Angle" || label === "Right Angle" || label === "Pressure angle" || label === "Helix angle" || label === "Twist";
}

const MAX_SHAPE_NAME_LENGTH = 48;

function withNameProperty(shape: WorkplaneShape, onUpdate: ShapeInspectorUpdate, properties: ShapePropertyConfig[]): ShapePropertyConfig[] {
  return [
    {
      type: "text",
      label: "Name",
      value: shape.name,
      maxLength: MAX_SHAPE_NAME_LENGTH,
      onChange: (name) => {
        onUpdate({ name: name.replace(/\s+/g, " ").slice(0, MAX_SHAPE_NAME_LENGTH) });
      },
    },
    ...properties,
  ];
}

const ON_OFF = ["On", "Off"] as const;
const onOff = (value: boolean) => (value ? "On" : "Off");
const WALL_OPTIONS = ["Closed", "Open"] as const;
const SCOOP_OPTIONS = ["None", "Front", "Back", "Left", "Right"] as const;
const GRIDFINITY_SIDE_LABELS: Record<GridfinitySide, string> = { left: "Left", right: "Right", front: "Front", back: "Back" };

function gridfinityBinProperties(shape: WorkplaneShape, onUpdate: ShapeInspectorUpdate): ShapePropertyConfig[] {
  const spec = normalizeGridfinityBinSpec(shape.gridfinityBin);
  const apply = (patch: Partial<GridfinityBinSpec>) => {
    const next = withGridfinityBinSpec(shape, patch);
    onUpdate({
      gridfinityBin: next.gridfinityBin,
      width: next.width,
      depth: next.depth,
      height: next.height,
      size: next.size,
      name: next.name,
    });
  };
  const wall = (side: GridfinitySide): SelectPropertyConfig => ({
    type: "select",
    label: `${GRIDFINITY_SIDE_LABELS[side]} wall`,
    value: spec.openSides.includes(side) ? "Open" : "Closed",
    options: [...WALL_OPTIONS],
    onChange: (value) => {
      const open = new Set(spec.openSides);
      if (value === "Open") open.add(side);
      else open.delete(side);
      apply({ openSides: GRIDFINITY_SIDES.filter((entry) => open.has(entry)) });
    },
  });
  const units = (label: string, value: number, key: "unitsX" | "unitsZ"): RangePropertyConfig => ({
    label,
    value,
    min: 1,
    max: GRIDFINITY_MAX_UNITS,
    step: 1,
    hint: `${value * GRIDFINITY_PITCH - GRIDFINITY_BIN_CLEARANCE} mm on the 42 mm grid`,
    onChange: (next) => apply({ [key]: Math.round(next) }),
  });
  return [
    units("Units wide", spec.unitsX, "unitsX"),
    units("Units deep", spec.unitsZ, "unitsZ"),
    {
      label: "Units tall",
      value: spec.heightUnits,
      min: 1,
      max: GRIDFINITY_MAX_HEIGHT_UNITS,
      step: 1,
      hint: `${spec.heightUnits * GRIDFINITY_HEIGHT_UNIT} mm at 7 mm per unit${spec.stackingLip ? `, plus a ${GRIDFINITY_LIP_HEIGHT} mm lip` : ""}`,
      onChange: (heightUnits) => apply({ heightUnits: Math.round(heightUnits) }),
    },
    { type: "select", label: "Stacking lip", value: onOff(spec.stackingLip), options: [...ON_OFF], onChange: (value) => apply({ stackingLip: value === "On" }) },
    { type: "select", label: "Body", value: spec.solid ? "Solid" : "Hollow", options: ["Hollow", "Solid"], onChange: (value) => apply({ solid: value === "Solid" }) },
    ...(spec.solid
      ? []
      : [
        { label: "Wall thickness", value: spec.wallThickness, min: 0.8, max: 3, step: 0.05, onChange: (wallThickness: number) => apply({ wallThickness }) },
        { label: "Floor thickness", value: spec.floorThickness, min: 0.8, max: 10, step: 0.05, hint: "Above the 4.75 mm foot.", onChange: (floorThickness: number) => apply({ floorThickness }) },
        { label: "Compartments across", value: spec.compartmentsX, min: 1, max: GRIDFINITY_MAX_COMPARTMENTS, step: 1, onChange: (compartmentsX: number) => apply({ compartmentsX: Math.round(compartmentsX) }) },
        { label: "Compartments deep", value: spec.compartmentsZ, min: 1, max: GRIDFINITY_MAX_COMPARTMENTS, step: 1, onChange: (compartmentsZ: number) => apply({ compartmentsZ: Math.round(compartmentsZ) }) },
        {
          type: "select" as const,
          label: "Finger scoop",
          value: spec.scoop === "none" ? "None" : GRIDFINITY_SIDE_LABELS[spec.scoop],
          options: SCOOP_OPTIONS.filter((option) => option === "None" || !spec.openSides.includes(option.toLowerCase() as GridfinitySide)),
          onChange: (value: string) => apply({ scoop: value === "None" ? "none" : (value.toLowerCase() as GridfinitySide) }),
        },
        ...(spec.scoop !== "none"
          ? [{ label: "Scoop radius", value: spec.scoopRadius, min: 0, max: 60, step: 0.5, hint: "0 fits the scoop to the compartment.", onChange: (scoopRadius: number) => apply({ scoopRadius }) }]
          : []),
      ]),
    { type: "select", label: "Magnets", value: onOff(spec.magnets), options: [...ON_OFF], onChange: (value) => apply({ magnets: value === "On" }) },
    { type: "select", label: "Screw holes", value: onOff(spec.screws), options: [...ON_OFF], onChange: (value) => apply({ screws: value === "On" }) },
    wall("left"),
    wall("right"),
    wall("front"),
    wall("back"),
  ];
}

function gridfinityBaseplateProperties(shape: WorkplaneShape, onUpdate: ShapeInspectorUpdate): ShapePropertyConfig[] {
  const spec = normalizeGridfinityBaseplateSpec(shape.gridfinityBaseplate);
  const apply = (patch: Partial<GridfinityBaseplateSpec>) => {
    const next = withGridfinityBaseplateSpec(shape, patch);
    onUpdate({
      gridfinityBaseplate: next.gridfinityBaseplate,
      width: next.width,
      depth: next.depth,
      height: next.height,
      size: next.size,
      name: next.name,
    });
  };
  const applySpec = (next: GridfinityBaseplateSpec) => apply({ ...next, connectors: next.connectors });
  const drawer = (label: string, value: number, key: "drawerWidth" | "drawerLength"): RangePropertyConfig => ({
    label,
    value,
    min: 0,
    max: 600,
    step: 0.1,
    hint: key === "drawerWidth" ? "Inside size of the drawer. Set both and the plate fills it with even padding." : undefined,
    onChange: (next) => {
      const drawerWidth = key === "drawerWidth" ? next : spec.drawerWidth;
      const drawerLength = key === "drawerLength" ? next : spec.drawerLength;
      if (drawerWidth > 0 && drawerLength > 0) {
        applySpec(gridfinityDrawerFit(drawerWidth, drawerLength, spec));
      } else {
        apply({ [key]: next });
      }
    },
  });
  const pad = (label: string, key: "padLeft" | "padRight" | "padFront" | "padBack"): RangePropertyConfig => ({
    label,
    value: spec[key],
    min: 0,
    max: GRIDFINITY_MAX_PADDING,
    step: 0.1,
    onChange: (value) => apply({ [key]: value, drawerWidth: 0, drawerLength: 0 }),
  });
  const connector = (side: GridfinitySide): SelectPropertyConfig => ({
    type: "select",
    label: `${GRIDFINITY_SIDE_LABELS[side]} edge`,
    value: spec.connectors?.[side] === "dovetail" ? "Dovetail"
      : spec.connectors?.[side] === "groove" ? "Groove"
        : spec.connectors?.[side] === "tab" ? "Tab"
          : spec.connectors?.[side] === "slot" ? "Slot" : "Plain",
    options: ["Plain", "Tab", "Slot", "Dovetail", "Groove"],
    onChange: (value) => {
      const connectors = { ...(spec.connectors ?? {}) };
      if (value === "Tab") connectors[side] = "tab";
      else if (value === "Slot") connectors[side] = "slot";
      else if (value === "Dovetail") connectors[side] = "dovetail";
      else if (value === "Groove") connectors[side] = "groove";
      else delete connectors[side];
      apply({ connectors: Object.keys(connectors).length ? connectors : undefined });
    },
  });
  return [
    { label: "Units wide", value: spec.unitsX, min: 1, max: GRIDFINITY_MAX_UNITS, step: 1, onChange: (unitsX) => apply({ unitsX: Math.round(unitsX), drawerWidth: 0, drawerLength: 0 }) },
    { label: "Units deep", value: spec.unitsZ, min: 1, max: GRIDFINITY_MAX_UNITS, step: 1, onChange: (unitsZ) => apply({ unitsZ: Math.round(unitsZ), drawerWidth: 0, drawerLength: 0 }) },
    drawer("Drawer width", spec.drawerWidth, "drawerWidth"),
    drawer("Drawer length", spec.drawerLength, "drawerLength"),
    pad("Padding left", "padLeft"),
    pad("Padding right", "padRight"),
    pad("Padding front", "padFront"),
    pad("Padding back", "padBack"),
    {
      label: "Floor thickness",
      value: spec.floorThickness,
      min: 0,
      max: 12,
      step: 0.1,
      hint: spec.floorThickness > 0 ? "Under the sockets." : "0 is an open frame. Magnets, screws and edge tabs add a 3 mm floor.",
      onChange: (floorThickness) => apply({ floorThickness }),
    },
    { type: "select", label: "Magnets", value: onOff(spec.magnets), options: [...ON_OFF], onChange: (value) => apply({ magnets: value === "On" }) },
    { type: "select", label: "Screw holes", value: onOff(spec.screws), options: [...ON_OFF], onChange: (value) => apply({ screws: value === "On" }) },
    connector("left"),
    connector("right"),
    connector("front"),
    connector("back"),
  ];
}

/** Mintr's fonts and the ones added in Settings; a font this computer lacks still shows, so it is not changed by accident. */
function fontChoices(current: string): string[] {
  const options = textFontOptions();
  return options.includes(current) ? options : [...options, current];
}

const LOFT_OUTLINE_LABELS: Record<LoftOutline, string> = { circle: "Circle", square: "Square", polygon: "Polygon" };
const loftOutlineFromLabel = (label: string): LoftOutline => (label === "Circle" ? "circle" : label === "Polygon" ? "polygon" : "square");

/** Below this pitch a filament printer cannot hold the tooth shape. */
const FINE_THREAD_PITCH_FOR_FILAMENT = 0.7;

function getShapeProperties(
  shape: WorkplaneShape,
  onUpdate: ShapeInspectorUpdate,
  sceneShapes: readonly WorkplaneShape[] = [],
  printerKind: WorkplaneWorkspaceSettings["printerKind"] = "filament",
): ShapePropertyConfig[] {
  if (shape.kind === "gridfinityBin") return gridfinityBinProperties(shape, onUpdate);
  if (shape.kind === "gridfinityBaseplate") return gridfinityBaseplateProperties(shape, onUpdate);
  if (shape.kind === "gear") {
    const spec = normalizeGearSpec(shape.gearSpec);
    const metrics = gearMetrics(spec);
    const apply = (patch: Partial<GearSpec>) => {
      const next = normalizeGearSpec({ ...spec, ...patch });
      const foot = gearFootprint(next, shape.depth);
      onUpdate({
        gearSpec: next,
        width: foot.width,
        depth: foot.depth,
        size: Math.max(foot.width, foot.depth),
      });
    };
    const helical = spec.form === "helical" || spec.form === "herringbone";
    return [
      {
        type: "select",
        label: "Form",
        value: gearFormLabel(spec.form),
        options: ["Spur", "Helical", "Herringbone", "Ring", "Rack"],
        onChange: (next) => apply({ form: gearFormFromLabel(next) }),
      },
      { label: "Teeth", value: spec.teeth, min: spec.form === "rack" ? 3 : spec.form === "ring" ? 10 : 6, max: spec.form === "rack" ? 48 : 120, step: 1, onChange: (teeth) => apply({ teeth: Math.round(teeth) }) },
      {
        label: "Module",
        value: spec.module,
        min: 0.5,
        max: 8,
        step: 0.1,
        hint: gearInspectorHint(shape, sceneShapes),
        onChange: (module) => apply({ module }),
      },
      { label: "Pressure angle", value: spec.pressureAngle, min: 14.5, max: 25, step: 0.5, onChange: (pressureAngle) => apply({ pressureAngle }) },
      { label: "Backlash", value: spec.backlash, min: 0, max: 1, step: 0.05, hint: "Taken off the pair. Each gear loses half, so a printed pair does not bind.", onChange: (backlash) => apply({ backlash }) },
      ...(spec.form === "ring"
        ? [{ label: "Rim", value: spec.rim, min: 1, max: 20, step: 0.5, onChange: (rim: number) => apply({ rim }) }]
        : []),
      ...(spec.form !== "ring" && spec.form !== "rack"
        ? [{ label: "Center hole", value: spec.bore, min: 0, max: Math.max(0.5, metrics.rootDiameter - 1), step: 0.1, onChange: (bore: number) => apply({ bore }) }]
        : []),
      ...(helical
        ? [{
          label: "Helix angle",
          value: spec.helixAngle,
          min: -45,
          max: 45,
          step: 1,
          centerDetent: true,
          hint: "On the pitch circle. A mate uses the same angle with the opposite sign.",
          onChange: (helixAngle: number) => apply({ helixAngle }),
        }]
        : []),
      { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 80, onChange: (height) => onUpdate({ height }, { resizeAxis: "height" }) },
    ];
  }

  if (shape.kind === "thread") {
    const designation = shape.threadSpec?.designation ?? "M6";
    const series = shape.threadSpec?.series ?? (designation === "Custom" ? "custom" : THREAD_SIZE_OPTIONS.find((entry) => entry.id === designation)?.series ?? "metric");
    const role = threadRoleLabel(shape.threadSpec?.role, shape.threadSpec?.style, shape.threadSpec?.part);
    const head = shape.threadSpec?.head === "countersunk" ? "Countersunk" : shape.threadSpec?.head === "hex" ? "Hex" : "Cylinder";
    const hand = shape.threadSpec?.hand === "left" ? "Left" : "Right";
    const profile = shape.threadSpec?.profile === "whitworth"
      ? "Whitworth"
      : shape.threadSpec?.profile === "trapezoid"
        ? "Trapezoid"
        : shape.threadSpec?.profile === "round"
          ? "Round"
          : "V";
    const sizes = THREAD_SIZE_OPTIONS.filter((entry) => entry.series === (series === "custom" ? "metric" : series)).map((entry) => entry.label);
    const nextSpec = (patch: Partial<NonNullable<WorkplaneShape["threadSpec"]>>) => ({
      designation,
      majorDiameter: shape.threadSpec?.majorDiameter ?? 6,
      pitch: shape.threadSpec?.pitch ?? 1,
      style: shape.threadSpec?.style ?? "screw",
      clearance: shape.threadSpec?.clearance ?? 0,
      part: shape.threadSpec?.part ?? "screw",
      role: shape.threadSpec?.role ?? (role === "Tapped hole" ? "bore" : "rod"),
      head: shape.threadSpec?.head ?? "cylinder",
      hand: shape.threadSpec?.hand ?? "right",
      series,
      profile: shape.threadSpec?.profile ?? "v",
      chamfer: shape.threadSpec?.chamfer ?? 0.3,
      length: shape.threadSpec?.length ?? shape.height,
      ...patch,
    });
    const length = shape.threadSpec?.length ?? shape.height;
    const pitch = shape.threadSpec?.pitch ?? 1;
    const clearance = shape.threadSpec?.clearance ?? defaultThreadClearance(printerKind);
    const heldClearance = effectiveThreadClearance(clearance, pitch, shape.threadSpec?.profile);
    const fineForFilament = printerKind === "filament" && pitch < FINE_THREAD_PITCH_FOR_FILAMENT;
    return [
      {
        type: "select",
        label: "Kind",
        value: role,
        options: [...THREAD_ROLE_OPTIONS],
        onChange: (next) => {
          const tapped = next === "Tapped hole";
          const nut = next === "Nut";
          const screw = next === "Screw";
          const alreadyLoose = shape.threadSpec?.role === "nut" || shape.threadSpec?.role === "bore";
          const major = shape.threadSpec?.majorDiameter ?? 6;
          onUpdate({
            threadSpec: nextSpec({
              role: tapped ? "bore" : nut ? "nut" : screw ? "screw" : "rod",
              style: tapped ? "hole" : "screw",
              part: tapped ? "threads" : "screw",
              clearance: tapped || nut
                ? (alreadyLoose ? clearance : defaultThreadClearance(printerKind))
                : 0,
              length: nut ? threadNutSize(major).height : length,
            }),
            hole: tapped,
            color: tapped ? "#b8c2cc" : fallbackSolidColor(shape),
            height: nut ? threadNutSize(major).height : shape.height,
          });
        },
      },
      ...(role === "Screw"
        ? [{
            type: "select" as const,
            label: "Head",
            value: head,
            options: [...THREAD_HEAD_OPTIONS],
            onChange: (next: string) => onUpdate({
              threadSpec: nextSpec({
                head: next === "Countersunk" ? "countersunk" : next === "Hex" ? "hex" : "cylinder",
              }),
            }),
          }]
        : []),
      {
        type: "select",
        label: "Series",
        value: threadSeriesLabel(series),
        options: [...THREAD_SERIES_OPTIONS],
        onChange: (next) => {
          const nextSeries: ThreadSeries = next === "UNC" ? "unc" : next === "UNF" ? "unf" : next === "Pipe (G)" ? "g" : next === "Custom" ? "custom" : "metric";
          const first = THREAD_SIZE_OPTIONS.find((entry) => entry.series === (nextSeries === "custom" ? "metric" : nextSeries));
          onUpdate({
            threadSpec: nextSpec({
              series: nextSeries,
              designation: nextSeries === "custom" ? "Custom" : first?.id ?? designation,
              majorDiameter: nextSeries === "custom" ? shape.threadSpec?.majorDiameter ?? 6 : first?.majorDiameter,
              pitch: nextSeries === "custom" ? shape.threadSpec?.pitch ?? 1 : first?.pitch,
            }),
          });
        },
      },
      ...(series === "custom"
        ? [
            { label: "Diameter", value: shape.threadSpec?.majorDiameter ?? 6, min: 1, max: 80, step: 0.1, onChange: (majorDiameter: number) => onUpdate({ threadSpec: nextSpec({ series: "custom", designation: "Custom", majorDiameter }) }) },
            { label: "Pitch", value: shape.threadSpec?.pitch ?? 1, min: 0.2, max: 8, step: 0.05, onChange: (pitch: number) => onUpdate({ threadSpec: nextSpec({ series: "custom", designation: "Custom", pitch }) }) },
          ]
        : [{
            type: "select" as const,
            label: "Size",
            value: sizes.includes(designation) ? designation : sizes[0],
            options: sizes,
            onChange: (next: string) => {
              const preset = THREAD_SIZE_OPTIONS.find((entry) => entry.label === next);
              onUpdate({
                threadSpec: nextSpec({
                  designation: preset?.id ?? next,
                  majorDiameter: preset?.majorDiameter,
                  pitch: preset?.pitch,
                  series: preset?.series ?? series,
                }),
              });
            },
          }]),
      {
        type: "select",
        label: "Hand",
        value: hand,
        options: [...THREAD_HAND_OPTIONS],
        onChange: (next) => onUpdate({ threadSpec: nextSpec({ hand: next === "Left" ? "left" : "right" }) }),
      },
      {
        type: "select",
        label: "Profile",
        value: profile,
        options: [...THREAD_PROFILE_OPTIONS],
        onChange: (next) => onUpdate({
          threadSpec: nextSpec({
            profile: next === "Whitworth" ? "whitworth" : next === "Trapezoid" ? "trapezoid" : next === "Round" ? "round" : "v",
          }),
        }),
      },
      ...(role === "Nut" || role === "Tapped hole"
        ? [{
            label: "Clearance",
            value: clearance,
            min: MIN_THREAD_CLEARANCE,
            max: MAX_THREAD_CLEARANCE,
            step: 0.05,
            hint: heldClearance < clearance - 1e-6
              ? `Held to ${heldClearance.toFixed(2)} mm so the thread still grips.`
              : undefined,
            onChange: (clearance: number) => onUpdate({ threadSpec: nextSpec({ clearance }) }),
          }]
        : []),
      {
        label: "Chamfer",
        value: shape.threadSpec?.chamfer ?? 0.3,
        min: 0,
        max: 2,
        step: 0.05,
        onChange: (chamfer) => onUpdate({ threadSpec: nextSpec({ chamfer }) }),
      },
      {
        label: "Sides",
        value: shape.sides ?? DEFAULT_THREAD_SIDES,
        min: MIN_THREAD_SIDES,
        max: MAX_THREAD_SIDES,
        step: 1,
        onChange: (sides) => onUpdate({ sides: Math.round(sides) }),
      },
      {
        label: role === "Nut" ? "Thickness" : "Length",
        value: length,
        min: MIN_SHAPE_SIZE,
        max: 160,
        hint: fineForFilament ? "Threads this fine print poorly on filament. A brass threaded insert holds better." : undefined,
        onChange: (nextLength) => onUpdate({
          height: nextLength,
          threadSpec: nextSpec({ length: nextLength }),
        }),
      },
    ];
  }

  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const setWidth = (value: number) => onUpdate({ width: value, size: resizedShapeSize(value, depth) }, { resizeAxis: "width" });
  const setDepth = (value: number) => onUpdate({ depth: value, size: resizedShapeSize(width, value) }, { resizeAxis: "depth" });
  const setHeight = (height: number) => onUpdate({ height }, { resizeAxis: "height" });

  if (shape.kind === "loft") {
    const sizes: ShapePropertyConfig[] = [
      { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setDepth },
      { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setWidth },
      { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 160, onChange: setHeight },
    ];
    const spec = shape.loftSpec;
    // A fillet or other step makes the body the part; its outlines no longer drive it.
    if (!spec || loftHasSteps(shape)) return sizes;
    const apply = (next: WorkplaneShape) => onUpdate(loftPatch(next));
    const starter = spec.starter;
    const outlineProperties: ShapePropertyConfig[] = [];
    if (starter) {
      const outline = (label: string, key: "bottom" | "top"): SelectPropertyConfig => ({
        type: "select",
        label,
        value: LOFT_OUTLINE_LABELS[starter[key]],
        options: Object.values(LOFT_OUTLINE_LABELS),
        onChange: (value) => apply(withLoftStarter(shape, { [key]: loftOutlineFromLabel(value) })),
      });
      outlineProperties.push(outline("Bottom", "bottom"), outline("Top", "top"));
      if (starter.bottom === "polygon" || starter.top === "polygon") {
        outlineProperties.push({ label: "Sides", value: starter.sides, min: 3, max: 24, step: 1, onChange: (sides) => apply(withLoftStarter(shape, { sides: Math.round(sides) })) });
      }
      outlineProperties.push({
        label: "Top size",
        value: starter.topScale,
        min: 5,
        max: 300,
        step: 1,
        hint: "Percent of the bottom outline.",
        onChange: (topScale) => apply(withLoftStarter(shape, { topScale })),
      });
      if (starter.bottom === starter.top && starter.bottom !== "circle") {
        outlineProperties.push({
          label: "Twist",
          value: starter.twist,
          min: -180,
          max: 180,
          step: 1,
          centerDetent: true,
          hint: "Turns the top against the bottom, smoothly all the way up.",
          onChange: (twist) => apply(withLoftStarter(shape, { twist: Math.round(twist) })),
        });
      }
    } else if (spec.sections.length > 2) {
      outlineProperties.push({
        type: "select",
        label: "Between outlines",
        value: spec.smooth ? "Smooth" : "Straight",
        options: ["Smooth", "Straight"],
        onChange: (value) => apply(withLoftSettings(shape, { smooth: value === "Smooth" })),
      });
    }
    const maxWall = maxLoftWall(shape);
    return [
      ...outlineProperties,
      ...sizes,
      {
        type: "select",
        label: "Body",
        value: spec.wall > 0 ? "Hollow" : "Solid",
        options: ["Solid", "Hollow"],
        onChange: (value) => apply(withLoftSettings(shape, { wall: value === "Hollow" ? Math.min(1.2, maxWall) : 0 })),
      },
      ...(spec.wall > 0
        ? [{
          label: "Wall thickness",
          value: spec.wall,
          min: 0.4,
          max: Math.max(0.5, maxWall),
          step: 0.05,
          hint: "Open at the top and bottom, like a sleeve or a vase without a floor.",
          onChange: (wall: number) => apply(withLoftSettings(shape, { wall })),
        }]
        : []),
    ];
  }

  if (shape.kind === "box") {
    return [
      { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setDepth },
      { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setWidth },
      { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 160, onChange: setHeight },
    ];
  }

  if (shape.kind === "cylinder") {
    return [
      { label: "Sides", value: resolveShapeSides(shape.kind, shape.sides) ?? 192, min: 3, max: MAX_SHAPE_SIDES, step: 1, onChange: (sides) => onUpdate({ sides: Math.round(sides) }) },
      { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setDepth },
      { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setWidth },
      { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 160, onChange: setHeight },
    ];
  }

  if (shape.kind === "sphere") {
    return [
      { label: "Steps", value: resolveShapeSteps(shape.kind, shape.steps) ?? 64, min: 6, max: MAX_SHAPE_STEPS, step: 1, onChange: (steps) => onUpdate({ steps: Math.round(steps) }) },
      { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setDepth },
      { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setWidth },
      { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 160, onChange: setHeight },
    ];
  }

  if (shape.kind === "halfSphere") {
    return [
      { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setDepth },
      { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setWidth },
      { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 160, onChange: setHeight },
    ];
  }

  if (shape.kind === "cone") {
    const freeRange = coneIsFreeRange(shape);
    const profile = coneVisibleProfile(shape);
    const mode: SelectPropertyConfig = {
      type: "select",
      label: "Cone",
      value: freeRange ? "Free range" : "Standard",
      options: ["Standard", "Free range"],
      onChange: (value) => onUpdate(value === "Free range" ? { coneFreeRange: true } : conePatchForStandardMode(shape)),
    };
    const sides = { label: "Sides", value: resolveShapeSides(shape.kind, shape.sides) ?? 192, min: 3, max: MAX_SHAPE_SIDES, step: 1, onChange: (value: number) => onUpdate({ sides: Math.round(value) }) };
    const height = { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 160, onChange: setHeight };
    if (!freeRange) {
      const setBottom = (value: number) => onUpdate(conePatchForRadii(shape, profile.topX, value), { resizeAxis: "width" });
      const setTop = (value: number) => onUpdate(conePatchForRadii(shape, value, profile.baseX), { resizeAxis: "width" });
      return [
        mode,
        { label: "Bottom radius", value: profile.baseX, min: MIN_SHAPE_SIZE / 2, max: 80, onChange: setBottom },
        { label: "Top radius", value: profile.topX, min: 0, max: 80, onChange: setTop },
        height,
        sides,
      ];
    }
    const setConeWidth = (value: number) => onUpdate(conePatchForFootprint(shape, value, depth), { resizeAxis: "width" });
    const setConeDepth = (value: number) => onUpdate(conePatchForFootprint(shape, width, value), { resizeAxis: "depth" });
    const setBaseRadius = (value: number) => onUpdate(conePatchForRadii(shape, coneTopRadius(shape), value), { resizeAxis: "width" });
    const setTopRadius = (value: number) => onUpdate(conePatchForRadii(shape, value, coneBaseRadius(shape)), { resizeAxis: "width" });
    return [
      mode,
      { label: "Top Radius", value: shape.topRadius ?? 0, min: 0, max: 80, onChange: setTopRadius },
      { label: "Base Radius", value: shape.baseRadius ?? width / 2, min: MIN_SHAPE_SIZE / 2, max: 80, onChange: setBaseRadius },
      { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setConeDepth },
      { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setConeWidth },
      height,
      sides,
    ];
  }

  if (shape.kind === "pyramid") {
    return [
      { label: "Sides", value: shape.sides ?? 4, min: 3, max: 24, step: 1, onChange: (sides) => onUpdate({ sides: Math.round(sides) }) },
      { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setDepth },
      { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setWidth },
      { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 160, onChange: setHeight },
    ];
  }

  if (shape.kind === "roof") {
    const angles = roofAnglesFromProfile(width, shape.height, shape.leftAngle, shape.rightAngle);
    // Angle edits slide the peak horizontally; width/height stay put so left/right move in tandem.
    const setLeftAngle = (value: number) => {
      const ridgeX = clampRoofRidgeX(width, shape.height, roofRidgeXFromLeftAngle(width, shape.height, value));
      const next = roofAnglesFromRidge(width, shape.height, ridgeX);
      onUpdate({ leftAngle: next.leftAngle, rightAngle: next.rightAngle });
    };
    const setRightAngle = (value: number) => {
      const ridgeX = clampRoofRidgeX(width, shape.height, roofRidgeXFromRightAngle(width, shape.height, value));
      const next = roofAnglesFromRidge(width, shape.height, ridgeX);
      onUpdate({ leftAngle: next.leftAngle, rightAngle: next.rightAngle });
    };
    const setRoofWidth = (value: number) => {
      const nextWidth = Math.max(MIN_SHAPE_SIZE, value);
      const next = roofAnglesFromProfile(nextWidth, shape.height, angles.leftAngle, angles.rightAngle);
      onUpdate(
        {
          width: nextWidth,
          size: resizedShapeSize(nextWidth, depth),
          leftAngle: next.leftAngle,
          rightAngle: next.rightAngle,
        },
        { resizeAxis: "width" },
      );
    };
    const setRoofHeight = (height: number) => {
      const nextHeight = Math.max(MIN_SHAPE_SIZE, height);
      const next = roofAnglesFromProfile(width, nextHeight, angles.leftAngle, angles.rightAngle);
      onUpdate(
        {
          height: nextHeight,
          leftAngle: next.leftAngle,
          rightAngle: next.rightAngle,
        },
        { resizeAxis: "height" },
      );
    };
    return [
      { label: "Left Angle", value: angles.leftAngle, min: MIN_ROOF_ANGLE, max: MAX_ROOF_ANGLE, step: 0.1, onChange: setLeftAngle },
      { label: "Right Angle", value: angles.rightAngle, min: MIN_ROOF_ANGLE, max: MAX_ROOF_ANGLE, step: 0.1, onChange: setRightAngle },
      { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setDepth },
      { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setRoofWidth },
      { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 160, onChange: setRoofHeight },
    ];
  }

  if (shape.kind === "roundRoof") {
    return [
      { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setDepth },
      { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setWidth },
      { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 160, onChange: setHeight },
    ];
  }

  if (shape.kind === "torus") {
    // Radius = tube cross-section size (donut thickness), not the overall ring size.
    const maxTubeRadius = Math.max(0.1, Math.min(width, depth) / 2 - 0.2);
    const tubeRadius = clamp(shape.radius ?? shape.height / 2, 0.1, maxTubeRadius);
    return [
      {
        label: "Radius",
        value: tubeRadius,
        min: 0.1,
        max: maxTubeRadius,
        onChange: (radius) => {
          const next = clamp(radius, 0.1, maxTubeRadius);
          onUpdate({ radius: next, height: next * 2 }, { resizeAxis: "height" });
        },
      },
      { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setDepth },
      { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setWidth },
      {
        label: "Height",
        value: shape.height,
        min: MIN_SHAPE_SIZE,
        max: 160,
        onChange: (height) => {
          const nextHeight = clamp(height, MIN_SHAPE_SIZE, 160);
          onUpdate({ height: nextHeight, radius: clamp(nextHeight / 2, 0.1, maxTubeRadius) }, { resizeAxis: "height" });
        },
      },
    ];
  }

  if (shape.kind === "tube" || shape.kind === "ring") {
    return [
      { label: "Thickness", value: shape.bevel ?? 4, min: 0.5, max: 20, onChange: (bevel) => onUpdate({ bevel }) },
      { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setDepth },
      { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setWidth },
      { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 160, onChange: setHeight },
    ];
  }

  if (shape.kind === "polygon") {
    return [
      {
        label: "Sides",
        value: shape.sides ?? 6,
        min: 3,
        max: 32,
        typedMax: 1024,
        step: 1,
        hint: "Up to 1024 by typing.",
        onChange: (sides) => onUpdate({ sides: Math.round(sides) }),
      },
      { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setDepth },
      { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setWidth },
      { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 160, onChange: setHeight },
    ];
  }

  if (shape.kind === "icosahedron") {
    return [
      { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setDepth },
      { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setWidth },
      { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 160, onChange: setHeight },
    ];
  }

  if (shape.kind === "text") {
    return [
      {
        type: "text",
        label: "Text",
        value: shape.text ?? "TEXT",
        onChange: (text) => {
          const nextText = text.slice(0, 24) || " ";
          const nextWidth = clamp(Math.max(46, nextText.length * 19), 46, 260);
          onUpdate({ text: nextText, width: nextWidth, size: nextWidth });
        },
      },
      { type: "select", label: "Font", value: shape.font ?? DEFAULT_TEXT_FONT, options: fontChoices(shape.font ?? DEFAULT_TEXT_FONT), onChange: (font) => onUpdate({ font }) },
      { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 40, onChange: setHeight },
      {
        label: "Up/Down",
        value: shape.textCircumference ?? 0,
        min: -100,
        max: 100,
        step: 1,
        centerDetent: true,
        hint: "Bows the line up and down. Letters stay face-up and follow the curve. 0 is flat, 100 is a full circle. Left bows outward, right bows inward.",
        onChange: (textCircumference) => onUpdate({ textCircumference: textCircumference === 0 ? undefined : textCircumference }),
      },
      {
        label: "In/Out",
        value: shape.textWrap ?? 0,
        min: -100,
        max: 100,
        step: 1,
        centerDetent: true,
        hint: "Bends a rod through the letters so the line wraps in and out. Letters stay rigid and turn with the rod. 0 is flat, 100 is a full circle. Left bows outward, right bows inward.",
        onChange: (textWrap) => onUpdate({ textWrap: textWrap === 0 ? undefined : textWrap }),
      },
      { label: "Bevel", value: shape.bevel ?? 0, min: 0, max: 8, onChange: (bevel) => onUpdate({ bevel }) },
      { label: "Segments", value: shape.segments ?? 0, min: 0, max: 24, step: 1, onChange: (segments) => onUpdate({ segments: Math.round(segments) }) },
    ];
  }

  return [
    { label: "Length", value: depth, min: MIN_SHAPE_SIZE, max: 160, onChange: setDepth },
    { label: "Width", value: width, min: MIN_SHAPE_SIZE, max: 160, onChange: setWidth },
    { label: "Height", value: shape.height, min: MIN_SHAPE_SIZE, max: 160, onChange: setHeight },
  ];
}

const LASER_JOBS: readonly LaserJob[] = ["cut", "score", "engrave"];

const LASER_JOB_HINT: Record<LaserJob, string> = {
  cut: "The laser cuts all the way round it, through the sheet.",
  score: "The laser draws its outline without cutting through, for a fold or a line.",
  engrave: "The laser fills its shape, marking the surface. Good for text and logos.",
};

export function ShapeInspector({
  shape,
  workspace,
  onUpdate,
  onClose,
  onEditSketch,
  onEditSketchDimension,
  canSeparateParts = false,
  onSeparateParts,
  onMakeMatchingThread,
  canSplitForPrintBed = false,
  onSplitForPrintBed,
  onReduceTriangles,
  onInteractionActiveChange,
  activeFeatureId = null,
  onSelectFeature,
  onSuppressFeature,
  modelTreeLocked = false,
  onReorderFeature,
  onUpdateFeature,
  sceneShapes,
  onEditPattern,
  onDissolvePattern,
  onEditEdgeTreatment,
  onRemoveEdgeTreatment,
  onEditPartStep,
  onTogglePartStep,
  onRemovePartStep,
  smoothControls,
}: {
  shape: WorkplaneShape;
  workspace: WorkplaneWorkspaceSettings;
  onUpdate: ShapeInspectorUpdate;
  onClose: () => void;
  onEditSketch?: () => void;
  onEditSketchDimension?: (dimensionId: string, value: number) => void;
  canSeparateParts?: boolean;
  onSeparateParts?: () => void;
  /** Add the tapped hole of the same thread size, on the same axis. */
  onMakeMatchingThread?: () => void;
  /** Gridfinity baseplate larger than the printer bed. */
  canSplitForPrintBed?: boolean;
  onSplitForPrintBed?: () => void;
  onReduceTriangles?: (keepFraction: number) => void;
  onInteractionActiveChange?: (active: boolean) => void;
  /** In-body feature selection (CSG child id). */
  activeFeatureId?: string | null;
  onSelectFeature?: (featureId: string | null) => void;
  onSuppressFeature?: (featureId: string, suppressed: boolean) => void;
  /** Fillet/chamfer is open, so the model tree must not rebuild the body. */
  modelTreeLocked?: boolean;
  onReorderFeature?: (featureId: string, direction: "up" | "down") => void;
  /** Patch a CSG child selected in the model tree (rebuilds the body). */
  onUpdateFeature?: (featureId: string, patch: Partial<WorkplaneShape>, options?: ShapeInspectorUpdateOptions) => void;
  /** Whole scene, so the export badge can account for loose cutters that will reach this body. */
  sceneShapes?: readonly WorkplaneShape[];
  onEditPattern?: () => void;
  onDissolvePattern?: () => void;
  /** Open the fillet or chamfer tool on this feature of the selected shape. */
  onEditEdgeTreatment?: (index: number) => void;
  /** Change a recorded step's size (fillet amount, wall thickness, push distance), in mm. */
  onEditPartStep?: (featureId: string, valueMm: number) => void;
  onTogglePartStep?: (featureId: string) => void;
  onRemovePartStep?: (featureId: string) => void;
  /** Restore the shape to before this feature. Newer features on top of it go with it. */
  onRemoveEdgeTreatment?: (index: number) => void;
  /** Present on a Smooth body. */
  smoothControls?: SmoothInspectorControls | null;
}) {
  const feature =
    activeFeatureId
      ? shape.groupedShapes?.find((child) => child.id === activeFeatureId) ?? null
      : null;
  const inspectTarget = feature ?? shape;
  const solidColor = inspectTarget.hole ? fallbackSolidColor(inspectTarget) : inspectTarget.color;
  const locked = Boolean(inspectTarget.locked);
  const [keepProportions, setKeepProportions] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("mintr.keepProportions") === "1";
    } catch {
      return false;
    }
  });
  const [scalePercent, setScalePercent] = useState("100");
  const coupledKind = inspectTarget.kind === "cone"
    || inspectTarget.kind === "torus"
    || inspectTarget.kind === "tube"
    || inspectTarget.kind === "ring"
    || inspectTarget.kind === "roof"
    || inspectTarget.kind === "thread"
    || inspectTarget.kind === "text"
    || inspectTarget.kind === "gear"
    || inspectTarget.kind === "gridfinityBin"
    || inspectTarget.kind === "gridfinityBaseplate";
  const canScale = inspectTarget.kind !== "thread"
    && inspectTarget.kind !== "text"
    && inspectTarget.kind !== "gear"
    && inspectTarget.kind !== "gridfinityBin"
    && inspectTarget.kind !== "gridfinityBaseplate";
  const coupledNote = inspectTarget.kind === "cone"
    ? "The radii set the width. Scale % changes length, width, and height together."
    : inspectTarget.kind === "torus"
      ? "Height follows the tube radius."
      : inspectTarget.kind === "tube" || inspectTarget.kind === "ring"
        ? "Thickness is the wall. Scale % changes the overall size and the wall together."
        : inspectTarget.kind === "roof"
          ? "The roof angles stay put. Scale % changes length, width, and height together."
          : null;
  const updateInspectTarget: ShapeInspectorUpdate = (patch, options) => {
    if (feature && onUpdateFeature) {
      onUpdateFeature(feature.id, patch, options);
      return;
    }
    onUpdate(patch, options);
  };
  const properties = withNameProperty(inspectTarget, updateInspectTarget, getShapeProperties(inspectTarget, updateInspectTarget, sceneShapes ?? [], workspace.printerKind));
  const sizeProperties = properties.filter(isFootprintSize);
  const detailProperties = properties.filter((property) => !isFootprintSize(property));
  const sketchFeature = resolveEditableSketchShape(
    feature ?? shape,
    { preferredId: activeFeatureId, preferFaceFeatures: !activeFeatureId },
  );
  const sketchDimensions = sketchFeature?.sketchDoc?.dimensions;
  const csgChildren = shape.groupedShapes ?? [];
  const csgOp = shape.csg?.op ?? inferCsgOp(shape);
  const showFeatureTree = Boolean(csgChildren.length && (isEvaluatedCsgBody(shape) || csgOp));
  const pattern = shape.patternFeature;
  const holeSpec = shape.holeSpec ?? inspectTarget.holeSpec;
  const partSteps = onEditPartStep ? shape.features ?? [] : [];
  const showShallowFeatures = Boolean(pattern || (shape.edgeTreatments?.length ?? 0) > 0 || partSteps.length > 0 || holeSpec || shape.construction);
  const sourceTriangleCount = inspectTarget.groupedShapes?.length
    ? inspectTarget.groupedShapes.reduce((total, child) => total + (child.importedMesh?.triangleCount ?? 0), 0) || (inspectTarget.importedMesh?.triangleCount ?? 0)
    : (inspectTarget.importedMesh?.triangleCount ?? 0);
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const [colorOpen, setColorOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(true);
  const [stepDraft, setStepDraft] = useState<{ id: string; value: string } | null>(null);
  const [dimensionDialog, setDimensionDialog] = useState<{ id: string; value: number } | null>(null);
  const [reduceOpen, setReduceOpen] = useState(false);
  const [keepPercent, setKeepPercent] = useState(50);
  const [reducing, setReducing] = useState(false);
  const [draftColor, setDraftColor] = useState(solidColor);
  const [measure, setMeasure] = useState<ShapeMeasure | null>(null);
  const colorPickingRef = useRef(false);

  // Do not call onInteractionActiveChange(false) on unmount — switching selection
  // while a viewport drag is starting would cancel the drag and rehydrate the project.

  useEffect(() => {
    if (!colorPickingRef.current) {
      setDraftColor(solidColor);
    }
  }, [solidColor]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void measureWorkplaneShape(inspectTarget).then((value) => {
        if (!cancelled) setMeasure(value);
      });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    inspectTarget.id,
    inspectTarget.kind,
    inspectTarget.width,
    inspectTarget.depth,
    inspectTarget.height,
    inspectTarget.importedMesh?.brepStep,
    inspectTarget.cadBrep,
  ]);

  const renderProperty = (property: ShapePropertyConfig) => {
    if (property.type === "text") {
      return <TextProperty key={property.label} {...property} disabled={locked} />;
    }
    if (property.type === "select") {
      return <SelectProperty key={property.label} {...property} disabled={locked} />;
    }
    const sizeLabel = property.label === "Length" || property.label === "Width" || property.label === "Height";
    const { onChange: propertyOnChange, ...propertyRest } = property;
    const onChange = keepProportions && !coupledKind && sizeLabel
      ? (next: number) => {
          const current = property.label === "Length"
            ? shapeDepth(inspectTarget)
            : property.label === "Width"
              ? shapeWidth(inspectTarget)
              : inspectTarget.height;
          if (!(current > 1e-6)) return;
          const patch = uniformScalePatch(inspectTarget, next / current);
          if (!patch) return;
          const axis = property.label === "Length" ? "depth" : property.label === "Width" ? "width" : "height";
          updateInspectTarget(patch, { resizeAxis: axis });
        }
      : propertyOnChange;
    return <RangeProperty key={property.label} {...propertyRest} onChange={onChange} workspace={workspace} disabled={locked} onInteractionActiveChange={onInteractionActiveChange} />;
  };

  return (
    <aside className="shape-inspector" aria-label={`${inspectTarget.name} shape settings`} onPointerDown={(event) => event.stopPropagation()}>
      <div className="shape-inspector-header">
        <PeakTipButton className="inspector-header-icon" label="Close shape settings" onClick={onClose}>
          <X size={22} strokeWidth={2.6} />
        </PeakTipButton>
        <strong>{feature ? `${shape.name} · ${inspectTarget.name}` : shape.name}</strong>
        {(() => {
          const quality = sceneShapes
            ? shapeExportQualityHintInScene(inspectTarget, sceneShapes)
            : shapeExportQualityHint(inspectTarget);
          return (
            <span
              className={`cad-ready-badge${quality === "faceted" ? " cad-ready-badge--mesh" : ""}${quality === "pending" || quality === "unsupported" ? " cad-ready-badge--pending" : ""}`}
              title={shapeExportQualityTitle(quality)}
            >
              {shapeExportQualityLabel(quality)}
            </span>
          );
        })()}
        <div className="inspector-header-actions">
          <PeakTipButton
            className={locked ? "inspector-header-icon active" : "inspector-header-icon"}
            label={locked ? "Unlock shape" : "Lock shape"}
            onClick={() => updateInspectTarget({ locked: !locked })}
          >
            {locked ? <ToolbarLockShapeIcon /> : <ToolbarUnlockShapeIcon />}
          </PeakTipButton>
          <PeakTipButton
            className={inspectTarget.hidden ? "inspector-header-icon active" : "inspector-header-icon"}
            label={inspectTarget.hidden ? "Show shape" : "Hide shape"}
            onClick={() => updateInspectTarget({ hidden: !inspectTarget.hidden })}
          >
            <ToolbarHideSelectedIcon />
          </PeakTipButton>
        </div>
      </div>

      {/* A thread's Kind decides solid or hole. Older files that made a screw a hole can still turn it back. */}
      {inspectTarget.kind !== "thread" || (inspectTarget.hole && !threadCanBeHole(inspectTarget)) ? (
      <div className="shape-state-card" role="group" aria-label="Shape mode">
        <button
          className={!inspectTarget.hole ? "active solid-choice" : "solid-choice"}
          onClick={() => {
            const wasHole = Boolean(inspectTarget.hole);
            updateInspectTarget(wasHole ? { hole: false } : { hole: false, color: solidColor });
            setColorOpen((open) => (wasHole ? false : !open));
          }}
          disabled={locked}
          aria-pressed={!inspectTarget.hole}
          aria-expanded={colorOpen}
        >
          <ShapeModeMark kind={inspectTarget.kind} color={solidColor} sides={inspectTarget.sides} />
          <span>Solid</span>
        </button>
        <button
          data-lesson-target="hole"
          className={inspectTarget.hole ? "active hole-choice" : "hole-choice"}
          onClick={() => {
            updateInspectTarget({ hole: true });
            setColorOpen(false);
          }}
          disabled={locked}
          aria-pressed={inspectTarget.hole}
        >
          <ShapeModeMark kind={inspectTarget.kind} hole sides={inspectTarget.sides} />
          <span>Hole</span>
        </button>
      </div>
      ) : null}

      {isLaserDesign(workspace) && !inspectTarget.hole ? (
        <div className="laser-job-card">
          <div className="laser-job-choices" role="radiogroup" aria-label="What the laser does">
            {LASER_JOBS.map((job) => {
              const active = (inspectTarget.laserJob ?? "cut") === job;
              return (
                <button
                  key={job}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`laser-job-${job}${active ? " active" : ""}`}
                  data-sage-key="laser-job"
                  disabled={locked}
                  onClick={() => updateInspectTarget({ laserJob: job === "cut" ? undefined : job })}
                >
                  <span className="laser-job-swatch" aria-hidden="true" />
                  {LASER_JOB_LABEL[job]}
                </button>
              );
            })}
          </div>
          <p>{LASER_JOB_HINT[inspectTarget.laserJob ?? "cut"]}</p>
        </div>
      ) : null}

      {colorOpen ? (
        <div className="color-card" aria-label="Shape color">
          <div className="color-card-header">
            <span>Color</span>
            <span className="color-value">{draftColor.toUpperCase()}</span>
          </div>
          <div className="color-grid">
            {SOLID_COLORS.map((color) => (
              <PeakTipButton
                key={color}
                className={solidColor.toLowerCase() === color.toLowerCase() && !inspectTarget.hole ? "selected" : ""}
                label={color.toUpperCase()}
                aria-label={`Set color ${color}`}
                style={{ "--shape-swatch": color } as CSSProperties}
                disabled={locked}
                onClick={() => {
                  updateInspectTarget({ color, hole: false });
                  setColorOpen(false);
                }}
              />
            ))}
            <PeakTipLabel className={locked ? "custom-color disabled" : "custom-color"} label="Custom color">
              <input
                type="color"
                value={draftColor}
                disabled={locked}
                onFocus={() => {
                  colorPickingRef.current = true;
                  onInteractionActiveChange?.(true);
                }}
                onBlur={() => {
                  colorPickingRef.current = false;
                  onInteractionActiveChange?.(false);
                }}
                onInput={(event) => {
                  const next = event.currentTarget.value;
                  setDraftColor(next);
                  updateInspectTarget({ color: next, hole: false });
                }}
                onChange={(event) => {
                  // Commit on change, but keep the color card mounted so the native
                  // picker is not torn down while dragging through the spectrum.
                  const next = event.currentTarget.value;
                  setDraftColor(next);
                  updateInspectTarget({ color: next, hole: false });
                }}
              />
              <span>Custom</span>
            </PeakTipLabel>
          </div>
        </div>
      ) : null}

      {sizeProperties.length > 0 || canScale ? (
        <div className="property-card shape-size-card" aria-label="Size">
          <div className="property-list">
            {sizeProperties.map(renderProperty)}
            {canScale ? (
              <div className="proportion-row">
                {coupledKind ? null : (
                  <button
                    type="button"
                    className={keepProportions ? "active" : ""}
                    aria-pressed={keepProportions}
                    disabled={locked}
                    onClick={() => {
                      setKeepProportions((on) => {
                        const next = !on;
                        try {
                          window.localStorage.setItem("mintr.keepProportions", next ? "1" : "0");
                        } catch {
                          // The lock still applies for this visit.
                        }
                        return next;
                      });
                    }}
                  >
                    Keep proportions
                  </button>
                )}
                <label>
                  Scale
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    step={1}
                    value={scalePercent}
                    disabled={locked}
                    aria-label="Scale by percent"
                    onChange={(event) => setScalePercent(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                  %
                </label>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    const ratio = Number(scalePercent) / 100;
                    const patch = uniformScalePatch(inspectTarget, ratio);
                    if (!patch) return;
                    updateInspectTarget(patch, { resizeAxis: "height" });
                  }}
                >
                  Apply
                </button>
              </div>
            ) : null}
            {coupledNote ? <p className="proportion-note">{coupledNote}</p> : null}
          </div>
        </div>
      ) : null}

      {smoothControls && shape.smooth && !feature ? (
        <SmoothCard spec={shape.smooth} controls={smoothControls} locked={locked} workspace={workspace} renderProperty={renderProperty} />
      ) : null}

      {onEditSketch ? (
        <button className="edit-sketch-button" type="button" disabled={locked} onClick={onEditSketch}>
          Edit sketch
        </button>
      ) : null}

      {sketchDimensions?.length ? (
        <div className="sketch-inspector-dimensions" aria-label="Sketch dimensions">
          <strong>Sketch dimensions</strong>
          {sketchDimensions.map((dimension) => (
            <button
              key={dimension.id}
              type="button"
              disabled={locked || !dimension.driving || !onEditSketchDimension}
              onClick={() => {
                if (!onEditSketchDimension || !dimension.driving) return;
                setDimensionDialog({ id: dimension.id, value: dimension.value });
              }}
            >
              {dimension.kind} {dimension.value.toFixed(2)} mm{dimension.driving ? "" : " (driven)"}
            </button>
          ))}
        </div>
      ) : null}

      {inspectTarget.importedMesh && inspectTarget.kind !== "loft" && !feature && onReduceTriangles ? (
        <div className="mesh-reduce">
          <p className="mesh-reduce-count">
            Triangles: {(inspectTarget.importedMesh.triangleCount || sourceTriangleCount).toLocaleString()}
            <span className="mesh-reduce-size"> · about {Math.max(0.1, Number(stlMegabytes(inspectTarget.importedMesh.triangleCount || sourceTriangleCount).toFixed(1)))} MB as an STL</span>
          </p>
          {reduceOpen ? (
            <>
              <label className="mesh-reduce-slider">
                <span>Keep {keepPercent}% detail</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={keepPercent}
                  disabled={locked || reducing}
                  onChange={(event) => setKeepPercent(Number(event.currentTarget.value))}
                />
              </label>
              <p className="mesh-reduce-note">
                Target {Math.max(12, Math.round(sourceTriangleCount * keepPercent / 100)).toLocaleString()} triangles. Large faces become large triangles so the file shrinks. Small parts and sharp edges stay so the engraving still reads as the movement.
                {inspectTarget.importedMesh.brepStep ? " Exact STEP export still uses the saved solid." : ""}
              </p>
              <button
                className="inspector-action-button"
                type="button"
                disabled={locked || reducing || keepPercent >= 100}
                onClick={() => {
                  setReducing(true);
                  void Promise.resolve(onReduceTriangles(keepPercent / 100)).finally(() => {
                    setReducing(false);
                    setReduceOpen(false);
                  });
                }}
              >
                <span>{reducing ? "Reducing…" : "Apply"}</span>
              </button>
              <button className="inspector-action-button" type="button" disabled={reducing} onClick={() => setReduceOpen(false)}>
                <span>Cancel</span>
              </button>
            </>
          ) : (
            <>
            <PeakTipButton
              className="inspector-action-button"
              label="Reduce File Size"
              description={TOOL_DESCRIPTIONS.reduceFileSize}
              disabled={locked}
              onClick={() => setReduceOpen(true)}
            >
              <span>Reduce File Size</span>
            </PeakTipButton>
              <p className="mesh-reduce-scope">(For STL exports only)</p>
            </>
          )}
        </div>
      ) : null}

      {measure ? (
        <div className="mesh-reduce" aria-label="Solid volume and area">
          <p className="mesh-reduce-count">
            {formatVolumeWithMilliliters(measure.volume, workspace.accuracy)}
            {" · "}
            Area {formatMeasurementNumber(measure.area, workspace.accuracy)} mm²
          </p>
        </div>
      ) : null}

      {canSeparateParts && onSeparateParts ? (
        <button className="inspector-action-button" type="button" disabled={locked} onClick={onSeparateParts}>
          <Split size={17} strokeWidth={2.5} />
          <span>Separate Parts</span>
        </button>
      ) : null}

      {onMakeMatchingThread && canMakeMatchingTappedHole(shape) ? (
        <button className="inspector-action-button" type="button" onClick={onMakeMatchingThread}>
          <Copy size={17} strokeWidth={2.5} />
          <span>Make matching tapped hole</span>
        </button>
      ) : null}

      {canSplitForPrintBed && onSplitForPrintBed && shape.kind === "gridfinityBaseplate" ? (
        <PeakTipButton
          className="inspector-action-button"
          type="button"
          label="Split for print bed"
          description={TOOL_DESCRIPTIONS.gridfinitySplit}
          disabled={locked}
          onClick={onSplitForPrintBed}
        >
          <Split size={17} strokeWidth={2.5} />
          <span>Split for Print Bed</span>
        </PeakTipButton>
      ) : null}

      <div className="property-card">
        <button
          className="property-card-header"
          type="button"
          aria-expanded={propertiesOpen}
          aria-controls={`properties-${shape.id}`}
          onClick={() => setPropertiesOpen((open) => !open)}
        >
          <span>Properties</span>
          <ChevronUp className={propertiesOpen ? "" : "collapsed"} size={25} strokeWidth={2.8} />
        </button>
        {propertiesOpen ? (
          <div className="property-list" id={`properties-${shape.id}`}>
            {detailProperties.map(renderProperty)}
          </div>
        ) : null}
      </div>

      {showShallowFeatures ? (
        <div className="property-card csg-feature-tree" aria-label="Features">
          <button
            className="property-card-header"
            type="button"
            aria-expanded={featuresOpen}
            aria-controls={`cad-features-${shape.id}`}
            onClick={() => setFeaturesOpen((open) => !open)}
          >
            <span>Features</span>
            <ChevronUp className={featuresOpen ? "" : "collapsed"} size={25} strokeWidth={2.8} />
          </button>
          {featuresOpen ? (
            <div className="csg-feature-list" id={`cad-features-${shape.id}`}>
              <div className="csg-feature-row">
                <span className="csg-feature-name">{isConstructionShape(shape) ? "Construction plane" : partSteps.length > 0 ? partStepsStartLabel(shape) : inspectTarget.kind}</span>
              </div>
              {partSteps.length > 0 ? partSteps.map((step) => {
                const blocked = locked || modelTreeLocked;
                const size = partStepSize(step);
                const unit = lengthDisplayUnit(workspace).label;
                const editing = stepDraft?.id === step.id;
                const commitDraft = () => {
                  const typed = Number(stepDraft?.value);
                  setStepDraft(null);
                  if (!Number.isFinite(typed)) return;
                  const mm = displayToMillimeters(typed, workspace);
                  if (Math.abs(mm - size) > 1e-6) onEditPartStep?.(step.id, mm);
                };
                const label = partFeatureLabel(step, (mm) => `${formatMeasurementNumber(millimetersToDisplay(mm, workspace), workspace.accuracy)} ${unit}`);
                return (
                  <div
                    key={step.id}
                    className={`csg-feature-row${step.suppressed ? " suppressed" : ""}${step.failed ? " failed" : ""}`}
                    title={step.failed ? `Skipped: ${step.failed}` : undefined}
                  >
                    {editing ? (
                      <input
                        className="csg-feature-input"
                        type="number"
                        step="any"
                        autoFocus
                        aria-label={`New size for ${label}`}
                        value={stepDraft.value}
                        onChange={(event) => setStepDraft({ id: step.id, value: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitDraft();
                          if (event.key === "Escape") setStepDraft(null);
                        }}
                        onBlur={commitDraft}
                      />
                    ) : (
                      <span className="csg-feature-name">
                        {label}
                        {step.failed ? <span className="csg-feature-note"> · skipped</span> : null}
                      </span>
                    )}
                    <div className="csg-feature-actions">
                      <button
                        type="button"
                        disabled={blocked || editing}
                        title="Change the size of this step"
                        onClick={() => setStepDraft({ id: step.id, value: formatMeasurementNumber(millimetersToDisplay(size, workspace), workspace.accuracy) })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={blocked || !onTogglePartStep}
                        title={step.suppressed ? "Put this step back" : "Leave this step out for now"}
                        onClick={() => onTogglePartStep?.(step.id)}
                      >
                        {step.suppressed ? "On" : "Off"}
                      </button>
                      <button
                        type="button"
                        disabled={blocked || !onRemovePartStep}
                        title="Remove only this step; the steps after it stay"
                        onClick={() => onRemovePartStep?.(step.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              }) : null}
              {partSteps.length > 0 ? null : (shape.edgeTreatments ?? []).map((feature, index) => {
                const entry = shape.edgeTreatmentHistory?.[index];
                const canChange = Boolean(entry && entry.feature.kind === feature.kind);
                const newer = Math.max(0, (shape.edgeTreatments?.length ?? 0) - index - 1);
                const newerNote = newer > 0
                  ? `Also removes ${newer} newer edge feature${newer === 1 ? "" : "s"}`
                  : undefined;
                const blocked = locked || modelTreeLocked || !canChange;
                const name = feature.kind === "fillet"
                  ? (feature.filletProfile === "cove" ? "Concave fillet" : "Fillet")
                  : "Chamfer";
                return (
                  <div key={`edge-${index}`} className="csg-feature-row">
                    <span className="csg-feature-name">
                      {name} {feature.amount} mm
                      {feature.edgeCount ? ` · ${feature.edgeCount} edges` : ""}
                    </span>
                    <div className="csg-feature-actions">
                      <button
                        type="button"
                        disabled={blocked || !onEditEdgeTreatment}
                        title={canChange ? (newerNote ?? `Edit this ${name.toLowerCase()}`) : "This edge feature has no stored edit history"}
                        onClick={() => onEditEdgeTreatment?.(index)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={blocked || !onRemoveEdgeTreatment}
                        title={canChange ? (newerNote ?? `Remove this ${name.toLowerCase()}`) : "This edge feature has no stored edit history"}
                        onClick={() => onRemoveEdgeTreatment?.(index)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
              {holeSpec ? (
                <div className="csg-feature-row">
                  <span className="csg-feature-name">
                    Hole ⌀{holeSpec.diameter}
                    {holeSpec.depthMode === "through" ? " through" : ` × ${holeSpec.depth}`}
                    {holeSpec.style === "counterbore" ? " · C’bore" : holeSpec.style === "countersink" ? " · C’sink" : ""}
                  </span>
                </div>
              ) : null}
              {pattern ? (
                <div className="csg-feature-row active">
                  <span className="csg-feature-name">{patternFeatureLabel(pattern)}</span>
                  <div className="csg-feature-reorder">
                    {onEditPattern ? (
                      <button type="button" disabled={locked} onClick={onEditPattern}>
                        Edit
                      </button>
                    ) : null}
                    {onDissolvePattern ? (
                      <button type="button" disabled={locked} onClick={onDissolvePattern}>
                        Dissolve
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {showFeatureTree ? (
        <div className="property-card csg-feature-tree" aria-label="Model tree">
          <button
            className="property-card-header"
            type="button"
            aria-expanded={featuresOpen}
            aria-controls={`features-${shape.id}`}
            onClick={() => setFeaturesOpen((open) => !open)}
          >
            <span>Model tree</span>
            <ChevronUp className={featuresOpen ? "" : "collapsed"} size={25} strokeWidth={2.8} />
          </button>
          {featuresOpen ? (
            <div className="csg-feature-list" id={`features-${shape.id}`}>
              <div className="csg-feature-meta">
                <span className="csg-feature-op">
                  {csgOp === "assemble" ? "tie" : csgOp === "subtract" ? "cut" : csgOp === "union" ? "union" : csgOp === "intersect" ? "intersect" : csgOp === "hull" ? "shrink wrap" : csgOp === "smooth" ? "smooth" : "group"}
                </span>
                <span className="csg-feature-tip">
                  {csgOp === "assemble"
                    ? "Select a part to edit its properties"
                    : "Select a feature to edit · Alt-click in view"}
                </span>
              </div>
              {csgChildren.map((child, index) => {
                const suppressed = Boolean(child.suppressed || child.csg?.suppressed);
                const active = activeFeatureId === child.id;
                const childQuality = shapeExportQualityHint(child);
                return (
                  <div
                    key={child.id}
                    className={`csg-feature-row${active ? " active" : ""}${suppressed ? " suppressed" : ""}`}
                  >
                    <button
                      type="button"
                      className="csg-feature-select"
                      disabled={locked}
                      onClick={() => onSelectFeature?.(active ? null : child.id)}
                      title="Select feature for edit"
                    >
                      <span className={`csg-feature-role ${child.hole ? "cut" : "join"}`}>{child.hole ? "−" : "+"}</span>
                      <span className="csg-feature-name">{child.name || child.kind}</span>
                      <span
                        className={`csg-feature-quality csg-feature-quality--${childQuality}`}
                        title={shapeExportQualityTitle(childQuality)}
                      >
                        {childQuality === "exact"
                          ? "exact"
                          : childQuality === "faceted"
                            ? "mesh"
                            : childQuality === "unsupported"
                              ? "n/a"
                              : "…"}
                      </span>
                    </button>
                    <label className="csg-feature-suppress" title={modelTreeLocked ? "Cancel the fillet or chamfer before turning a feature off" : "Suppress feature"}>
                      <input
                        type="checkbox"
                        checked={suppressed}
                        disabled={locked || !onSuppressFeature || modelTreeLocked}
                        onChange={(event) => onSuppressFeature?.(child.id, event.target.checked)}
                      />
                      <span>Off</span>
                    </label>
                    <div className="csg-feature-reorder">
                      <button
                        type="button"
                        disabled={locked || index === 0 || !onReorderFeature}
                        onClick={() => onReorderFeature?.(child.id, "up")}
                        aria-label="Move feature up"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={locked || index >= csgChildren.length - 1 || !onReorderFeature}
                        onClick={() => onReorderFeature?.(child.id, "down")}
                        aria-label="Move feature down"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      {dimensionDialog ? (
        <InlineValueDialog
          title="Edit sketch dimension"
          fields={[{ key: "value", label: "Dimension value", value: String(dimensionDialog.value), unit: "mm", min: 0 }]}
          confirmLabel="Apply"
          onCancel={() => setDimensionDialog(null)}
          onConfirm={(values) => {
            const value = Number.parseFloat(values.value ?? "");
            const { id } = dimensionDialog;
            setDimensionDialog(null);
            if (Number.isFinite(value) && value > 0) onEditSketchDimension?.(id, value);
          }}
        />
      ) : null}
    </aside>
  );
}

export function SnapGridControl({
  snap,
  snapOpen,
  onSnapChange,
  onSnapOpenChange,
}: {
  snap: GridSize;
  snapOpen: boolean;
  onSnapChange: Dispatch<SetStateAction<GridSize>>;
  onSnapOpenChange: Dispatch<SetStateAction<boolean>>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuPresence = useChromePresence(snapOpen);

  useEffect(() => {
    if (!snapOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      onSnapOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onSnapOpenChange(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onSnapOpenChange, snapOpen]);

  return (
    <div className="snap-row" ref={rootRef}>
      <span>Snap Grid</span>
      <button
        type="button"
        className="snap-select"
        aria-haspopup="listbox"
        aria-expanded={snapOpen}
        onClick={() => onSnapOpenChange((value) => !value)}
      >
        {snap}
        <ChevronDown size={12} fill="currentColor" />
      </button>
      {menuPresence.mounted ? (
        <div className={`snap-menu${menuPresence.closing ? " is-closing" : ""}`} role="listbox" aria-label="Snap grid size">
          {GRID_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              role="option"
              aria-selected={size === snap}
              className={size === snap ? "selected" : ""}
              onClick={() => {
                onSnapChange(size);
                onSnapOpenChange(false);
              }}
            >
              {size}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RangeProperty({
  label,
  value,
  min,
  max,
  typedMax,
  step = 0.01,
  hint,
  centerDetent,
  workspace,
  disabled,
  onChange,
  onInteractionActiveChange,
}: RangePropertyConfig & { workspace: WorkplaneWorkspaceSettings; disabled?: boolean; onInteractionActiveChange?: (active: boolean) => void }) {
  const allowsAboveSliderMax = label === "Length" || label === "Width" || label === "Height";
  const typedCeiling = typedMax ?? (allowsAboveSliderMax ? TYPED_DIMENSION_MAX_MM : max);
  const isLength = propertyUsesLengthUnit(label);
  const isAngle = propertyUsesDegreeUnit(label);
  const accuracy = workspace.accuracy;
  const actualValue = Math.max(min, Number.isFinite(value) ? value : min);
  const controlValue = isLength ? millimetersToDisplay(actualValue, workspace) : actualValue;
  const controlMin = isLength ? millimetersToDisplay(min, workspace) : min;
  const controlMax = isLength ? millimetersToDisplay(max, workspace) : max;
  const controlStep = isLength ? displayStepFromMillimeters(step, workspace) : step;
  const sliderValue = clamp(controlValue, controlMin, controlMax);
  const position = ((sliderValue - controlMin) / Math.max(Number.EPSILON, controlMax - controlMin)) * 100;
  const [editing, setEditing] = useState(false);
  const displayText = formatPropertyNumber(controlValue, accuracy, controlStep);
  const [draft, setDraft] = useState(displayText);
  // Text shown when the field took focus. Tabbing through must not commit the
  // rounded display value (0.79 in → 20.066 mm) or push a history entry.
  const focusTextRef = useRef(displayText);
  const cancelCommitRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useBlurOnOutsidePress(inputRef);
  const unit = isLength ? lengthDisplayUnit(workspace).label : isAngle ? "°" : null;
  useEffect(() => {
    if (!editing) {
      setDraft(displayText);
    }
  }, [displayText, editing]);
  const toModelValue = (nextValue: number) => isLength ? displayToMillimeters(nextValue, workspace) : nextValue;
  const boundTyped = (nextValue: number) => clamp(nextValue, min, typedCeiling);
  const withCenterDetent = (nextValue: number) => {
    const bounded = clamp(nextValue, min, max);
    return centerDetent && Math.abs(bounded) <= 3 ? 0 : bounded;
  };
  const commitDraft = () => {
    setEditing(false);
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      return;
    }
    const text = draft.trim();
    // Blank or unparsable text (cleared field, "10 mm", "12,5") reverts instead
    // of collapsing the shape to the minimum; unchanged text is not a change.
    if (text === "" || text === focusTextRef.current) return;
    const next = parseDimensionEntry(text, controlValue);
    if (next === null || !Number.isFinite(next)) return;
    onChange(boundTyped(toModelValue(next)));
  };
  const handleSliderChange = (nextValue: number) => {
    const next = clamp(Number.isFinite(nextValue) ? nextValue : controlMin, controlMin, controlMax);
    const modelValue = withCenterDetent(toModelValue(next));
    onChange(modelValue);
    setDraft(formatPropertyNumber(isLength ? millimetersToDisplay(modelValue, workspace) : modelValue, accuracy, controlStep));
  };
  return (
    <label
      className="range-property"
      data-lesson-target={label === "Width" || label === "Length" ? "size" : undefined}
      style={{ "--slider-pos": `${position}%` } as CSSProperties}
    >
      <span className="range-property-header">
        <span className="range-property-name">{label}</span>
        <span className="range-value-control">
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={editing ? draft : formatPropertyNumber(controlValue, accuracy, controlStep)}
            disabled={disabled}
            onFocus={() => {
              focusTextRef.current = displayText;
              cancelCommitRef.current = false;
              setDraft(displayText);
              setEditing(true);
            }}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                cancelCommitRef.current = true;
                setDraft(displayText);
                event.currentTarget.blur();
              }
            }}
          />
          {unit ? <span className="range-value-unit">{unit}</span> : null}
        </span>
      </span>
      <div className={`range-control${centerDetent ? " has-center-index" : ""}`}>
        <ThumbRangeInput
          min={controlMin}
          max={controlMax}
          step={isAngle ? "any" : controlStep}
          value={sliderValue}
          disabled={disabled}
          onDragActiveChange={onInteractionActiveChange}
          onValueChange={handleSliderChange}
        />
      </div>
      {hint ? <span className="range-property-hint">{hint}</span> : null}
    </label>
  );
}

function SmoothCard({
  spec,
  controls,
  locked,
  workspace,
  renderProperty,
}: {
  spec: SmoothSpec;
  controls: SmoothInspectorControls;
  locked: boolean;
  workspace: WorkplaneWorkspaceSettings;
  renderProperty: (property: ShapePropertyConfig) => ReactNode;
}) {
  const unit = lengthDisplayUnit(workspace);
  const size = (mm: number) => formatMeasurementNumber(millimetersToDisplay(mm, workspace), workspace.accuracy);
  const settings: ShapePropertyConfig[] = [
    {
      type: "select",
      label: "Smoothness",
      // Each step up is finer and has more points to pull; the pulls already made stay.
      value: String(Math.max(0, Math.min(2, spec.detail ?? 0)) + 1),
      options: ["1", "2", "3"],
      onChange: (value) => controls.onChange({ detail: Number(value) - 1, level: 3 }),
    },
    {
      type: "select",
      label: "Start from",
      // The exact shape keeps its edges sharp, so nothing moves until a point is pulled.
      value: spec.keepEdges ? "Exact shape" : "Rounded",
      options: ["Exact shape", "Rounded"],
      onChange: (value) => controls.onChange({ keepEdges: value === "Exact shape" }),
    },
    ...(controls.hasFlatBottom && !spec.keepEdges
      ? [{
        type: "select" as const,
        label: "Bottom",
        value: spec.keepBottomFlat === false ? "Rounded" : "Flat on the bed",
        options: ["Flat on the bed", "Rounded"],
        onChange: (value: string) => controls.onChange({ keepBottomFlat: value !== "Rounded" }),
      }]
      : []),
    {
      label: "Soft radius",
      value: spec.softRadius ?? 0,
      min: 0,
      max: 60,
      step: 0.5,
      hint: "Pulling a point also pulls the points this close to it, fading out. 0 moves only the points you picked.",
      onChange: (softRadius) => controls.onChange({ softRadius }),
    },
    {
      type: "select",
      label: "Mirror",
      value: SMOOTH_MIRROR_LABELS[spec.mirror ?? "off"],
      options: Object.values(SMOOTH_MIRROR_LABELS),
      onChange: (value) => controls.onChange({ mirror: value === SMOOTH_MIRROR_LABELS.x ? "x" : value === SMOOTH_MIRROR_LABELS.z ? "z" : undefined }),
    },
  ];
  const center = controls.selectionCenter;
  const axisNames = ["X", "Y", "Z"] as const;
  return (
    <div className="property-card smooth-card" aria-label="Smooth">
      {settings.map(renderProperty)}
      <p className="smooth-card-hint">
        Smoothed. The blocks inside are {size(controls.blocks.width)} × {size(controls.blocks.depth)} × {size(controls.blocks.height)} {unit.label}.
      </p>
      <button className="inspector-action-button" type="button" disabled={locked || controls.preparing} onClick={controls.onToggleEdit}>
        {controls.preparing ? "Preparing points…" : controls.editing ? "Done editing points" : "Edit points"}
      </button>
      {controls.editing ? (
        <>
          <p className="smooth-card-hint">
            {controls.pickingFace
              ? "Click a flat face of the part to keep it exactly as it is, or a kept face to free it. Esc cancels."
              : controls.selectedCount === 0
                ? "Click a point, Shift-click several, or Alt-drag a box around them, then drag. Hold Shift while dragging to keep to one direction."
                : `${controls.selectedCount} ${controls.selectedCount === 1 ? "point" : "points"} selected. Drag to pull, or type where ${controls.selectedCount === 1 ? "it goes" : "their middle goes"}.`}
          </p>
          {renderProperty({
            type: "select",
            label: "Drag",
            value: controls.dragInOut ? "In and out" : "Free",
            options: ["Free", "In and out"],
            hint: controls.dragInOut
              ? "Points move straight out of the surface or push in."
              : "Points move freely. Hold Ctrl while dragging to pull straight in and out.",
            onChange: (value) => controls.onDragInOutChange(value === "In and out"),
          })}
          {center
            ? axisNames.map((name, axis) => renderProperty({
              type: "text",
              label: `Point ${name}`,
              value: formatMeasurementNumber(millimetersToDisplay(center[axis], workspace), workspace.accuracy),
              maxLength: 12,
              onChange: (value) => {
                const typed = Number(value);
                if (Number.isFinite(typed)) controls.onMoveSelection(axis as 0 | 1 | 2, displayToMillimeters(typed, workspace));
              },
            }))
            : null}
          {controls.canMakeSharp || controls.canMakeSmooth ? (
            <div className="smooth-card-row">
              <button className="inspector-action-button" type="button" disabled={locked || !controls.canMakeSharp} onClick={controls.onMakeSharp}>
                Make edge sharp
              </button>
              <button className="inspector-action-button" type="button" disabled={locked || !controls.canMakeSmooth} onClick={controls.onMakeSmooth}>
                Make edge smooth
              </button>
            </div>
          ) : null}
          <button className="inspector-action-button" type="button" disabled={locked} aria-pressed={controls.pickingFace} onClick={controls.onPickFace}>
            {controls.pickingFace ? "Cancel" : controls.keptFaces > 0 ? `Keep a face flat (${controls.keptFaces} kept)` : "Keep a face flat"}
          </button>
          {(spec.tugs?.length ?? 0) > 0 || (spec.creases?.length ?? 0) > 0 ? (
            <button className="inspector-action-button" type="button" disabled={locked} onClick={controls.onResetPoints}>
              Reset points
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function TextProperty({
  label,
  value,
  maxLength = 24,
  disabled,
  onChange,
}: TextPropertyConfig & { disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  const cancelRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useBlurOnOutsidePress(inputRef);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Commit once per edit, not per keystroke: typing "Bracket" used to record
  // seven undo steps and seven autosaves.
  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      setDraft(value);
      return;
    }
    const committed = draft.replace(/\s+/g, " ").trim();
    if (!committed) {
      const fallback = value.trim() || (label === "Name" ? "Shape" : draft);
      setDraft(fallback);
      if (fallback !== value) {
        onChange(fallback);
      }
      return;
    }
    if (committed !== draft) {
      setDraft(committed);
    }
    if (committed !== value) {
      onChange(committed);
    }
  };

  return (
    <label className="text-property">
      <span>{label}</span>
      <input
        ref={inputRef}
        type="text"
        value={draft}
        disabled={disabled}
        maxLength={maxLength}
        spellCheck={false}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancelRef.current = true;
            event.currentTarget.blur();
          }
        }}
        onChange={(event) => {
          setDraft(event.currentTarget.value.slice(0, maxLength));
        }}
      />
    </label>
  );
}

function SelectProperty({ label, value, options, hint, disabled, onChange }: SelectPropertyConfig & { disabled?: boolean }) {
  return (
    <label className="select-property">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {hint ? <span className="range-property-hint">{hint}</span> : null}
    </label>
  );
}
