/**
 * The inspector settings of each kind of part, as plain data: label, value, range and what a
 * change does. The inspector draws them; Mintr Pro values drive them by label.
 */
import { stlMegabytes } from "@/lib/laser/crystalFile";
import { isLaserDesign } from "@/lib/laserMachine";
import { LASER_JOB_LABEL, type LaserJob } from "@/lib/laser/cutFile";
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
import { findThreadSize, THREAD_SIZE_OPTIONS, type ThreadSeries } from "@/lib/metricThreads";
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
import { clampPlateRadius, MIN_QR_MM, nutPocketHeight, qrSquareSize, screwDimensions, screwHoleDepthMin } from "@/lib/generatedShapes";
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
import type { GeneratedSpec, ScrewHead } from "@/types/sketchforge";
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

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export const MAX_SHAPE_STEPS = 128;

export const THREAD_SERIES_OPTIONS = ["Metric", "UNC", "UNF", "Pipe (G)", "Custom"] as const;
/** A tapped hole is its own shape now, Threaded Hole, so Threads makes rods, screws and nuts. */
export const THREAD_ROLE_OPTIONS = ["Rod", "Screw", "Nut"] as const;
export const THREAD_HEAD_OPTIONS = ["Cylinder", "Countersunk", "Hex"] as const;
export const THREAD_HAND_OPTIONS = ["Right", "Left"] as const;
export const THREAD_BUILD_PRINT = "Print-ready";
export const THREAD_BUILD_EXACT = "Exact";
export const THREAD_PROFILE_OPTIONS = ["V", "Whitworth", "Trapezoid", "Round"] as const;

export function threadSeriesLabel(series: ThreadSeries) {
  if (series === "unc") return "UNC";
  if (series === "unf") return "UNF";
  if (series === "g") return "Pipe (G)";
  if (series === "custom") return "Custom";
  return "Metric";
}

export function threadRoleLabel(role: string | undefined, style: string | undefined, part: string | undefined) {
  if (role === "screw") return "Screw";
  if (role === "nut") return "Nut";
  if (role === "bore" || style === "hole" || part === "threads") return "Tapped hole";
  return "Rod";
}
export const MIN_SHAPE_SIZE = 0.01;
export type RangePropertyConfig = {
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

export type TextPropertyConfig = {
  type: "text";
  label: string;
  value: string;
  maxLength?: number;
  onChange: (value: string) => void;
};

export type SelectPropertyConfig = {
  type: "select";
  label: string;
  value: string;
  options: string[];
  hint?: string;
  onChange: (value: string) => void;
};

export type ShapePropertyConfig = RangePropertyConfig | TextPropertyConfig | SelectPropertyConfig;
export type ShapeInspectorUpdateOptions = { resizeAxis?: "width" | "depth" | "height" };
export type ShapeInspectorUpdate = (patch: Partial<WorkplaneShape>, options?: ShapeInspectorUpdateOptions) => void;
export const TYPED_DIMENSION_MAX_MM = 2000;
export const MAX_SHAPE_NAME_LENGTH = 48;

export function withNameProperty(shape: WorkplaneShape, onUpdate: ShapeInspectorUpdate, properties: ShapePropertyConfig[]): ShapePropertyConfig[] {
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

export const ON_OFF = ["On", "Off"] as const;
export const onOff = (value: boolean) => (value ? "On" : "Off");
export const WALL_OPTIONS = ["Closed", "Open"] as const;
export const SCOOP_OPTIONS = ["None", "Front", "Back", "Left", "Right"] as const;
export const GRIDFINITY_SIDE_LABELS: Record<GridfinitySide, string> = { left: "Left", right: "Right", front: "Front", back: "Back" };

export function gridfinityBinProperties(shape: WorkplaneShape, onUpdate: ShapeInspectorUpdate): ShapePropertyConfig[] {
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

export function gridfinityBaseplateProperties(shape: WorkplaneShape, onUpdate: ShapeInspectorUpdate): ShapePropertyConfig[] {
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
export function fontChoices(current: string): string[] {
  const options = textFontOptions();
  return options.includes(current) ? options : [...options, current];
}

export const LOFT_OUTLINE_LABELS: Record<LoftOutline, string> = { circle: "Circle", square: "Square", polygon: "Polygon" };
export const loftOutlineFromLabel = (label: string): LoftOutline => (label === "Circle" ? "circle" : label === "Polygon" ? "polygon" : "square");

/** Below this pitch a filament printer cannot hold the tooth shape. */
export const FINE_THREAD_PITCH_FOR_FILAMENT = 0.7;

const SCREW_HEAD_LABEL: Record<ScrewHead, string> = { none: "Plain", counterbore: "Counterbore", countersink: "Countersink" };
const SCREW_HOLE_THREADED = "Threaded";
const SCREW_HOLE_THROUGH = "Slides through";
const GENERATED_MAX_MM = 300;

/** A generated part's settings. A change rebuilds the part, so these are its true sizes, not a stretch. */
export function generatedShapeProperties(
  shape: WorkplaneShape,
  spec: GeneratedSpec,
  onUpdate: ShapeInspectorUpdate,
  printerKind: WorkplaneWorkspaceSettings["printerKind"] = "filament",
): ShapePropertyConfig[] {
  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const sized = (patch: Partial<WorkplaneShape>, axis: "width" | "depth" | "height") => onUpdate(patch, { resizeAxis: axis });
  const lengthRow: RangePropertyConfig = { label: "Length", value: depth, min: 0.5, max: 160, typedMax: GENERATED_MAX_MM, onChange: (next) => sized({ depth: next, size: Math.max(width, next) }, "depth") };
  const widthRow: RangePropertyConfig = { label: "Width", value: width, min: 0.5, max: 160, typedMax: GENERATED_MAX_MM, onChange: (next) => sized({ width: next, size: Math.max(next, depth) }, "width") };
  const heightRow = (label: string, min: number): RangePropertyConfig => ({ label, value: shape.height, min, max: 100, typedMax: GENERATED_MAX_MM, onChange: (next) => sized({ height: Math.max(min, next) }, "height") });
  const sizeRows = [lengthRow, widthRow, heightRow("Height", 0.1)];
  switch (spec.form) {
    case "plate": {
      const most = Math.max(0.01, Math.min(width, depth) / 2);
      return [
        { label: "Corner radius", value: clampPlateRadius(spec.cornerRadius, width, depth), min: 0, max: most, step: 0.1, hint: "Rounds the four corners. The top and bottom edges stay square.", onChange: (cornerRadius) => onUpdate({ generated: { ...spec, cornerRadius } }) },
        ...sizeRows,
      ];
    }
    case "star":
      return [
        { label: "Points", value: spec.points, min: 3, max: 16, step: 1, onChange: (points) => onUpdate({ generated: { ...spec, points: Math.round(points) } }) },
        { label: "Point depth", value: Math.round((1 - spec.inner) * 100), min: 10, max: 90, step: 1, hint: "How far the points reach in toward the middle, in percent.", onChange: (next) => onUpdate({ generated: { ...spec, inner: 1 - clamp(next, 10, 90) / 100 } }) },
        ...sizeRows,
      ];
    case "screwHole": {
      const pitch = findThreadSize(spec.size)?.pitch ?? spec.pitch ?? 1;
      const tooFineToPrint = spec.threaded && printerKind === "filament" && pitch < FINE_THREAD_PITCH_FOR_FILAMENT;
      return [
        ...screwSizeRows(spec, "Screw", (next) => onUpdate({ generated: next })),
        {
          type: "select",
          label: "Hole",
          value: spec.threaded ? SCREW_HOLE_THREADED : SCREW_HOLE_THROUGH,
          options: [SCREW_HOLE_THREADED, SCREW_HOLE_THROUGH],
          hint: tooFineToPrint
            ? `${spec.size} threads are too fine for most filament printers to hold. Slides through with a nut, or a heat-set insert, holds better.`
            : spec.threaded
              ? "Threaded cuts a thread for the screw to bite into, like a tapped hole."
              : "The screw slides through and is held by a nut or the part below.",
          onChange: (label) => onUpdate({ generated: { ...spec, threaded: label === SCREW_HOLE_THREADED } }),
        },
        ...(spec.threaded
          ? []
          : [{
              type: "select" as const,
              label: "Head",
              value: SCREW_HEAD_LABEL[spec.head],
              options: Object.values(SCREW_HEAD_LABEL),
              hint: "The head sits at the top of the hole. Counterbore fits a socket head, countersink a flat head.",
              onChange: (label: string) => onUpdate({ generated: { ...spec, head: (Object.keys(SCREW_HEAD_LABEL) as ScrewHead[]).find((key) => SCREW_HEAD_LABEL[key] === label) ?? spec.head } }),
            }]),
        heightRow("Depth", screwHoleDepthMin(spec)),
      ];
    }
    case "nutPocket":
      return [
        ...screwSizeRows(spec, "Nut", (next) => onUpdate({
          generated: next,
          // A depth nobody changed follows the nut. One that was typed stays.
          ...(Math.abs(shape.height - nutPocketHeight(spec)) < 0.01 ? { height: nutPocketHeight(next) } : {}),
        }), "Sized to take the nut with a little room."),
        heightRow("Depth", 0.2),
      ];
    case "qr": {
      const square = qrSquareSize(spec, width);
      return [
        { type: "text", label: "Link or text", value: spec.text, maxLength: 500, onChange: (text) => onUpdate({ generated: { ...spec, text: text || " " } }) },
        {
          label: "Size",
          value: width,
          min: MIN_QR_MM,
          max: 160,
          typedMax: GENERATED_MAX_MM,
          hint: square === null ? undefined : `Each square is ${square.toFixed(2)} mm. Phones read them best at 0.5 mm or more, with a clear margin of four squares around the code.`,
          onChange: (next) => sized({ width: next, depth: next, size: next }, "width"),
        },
        heightRow("Height", 0.1),
      ];
    }
    default:
      return sizeRows;
  }
}

export function getShapeProperties(
  shape: WorkplaneShape,
  onUpdate: ShapeInspectorUpdate,
  sceneShapes: readonly WorkplaneShape[] = [],
  printerKind: WorkplaneWorkspaceSettings["printerKind"] = "filament",
): ShapePropertyConfig[] {
  if (shape.generated?.form === "screwHole" && shape.generated.threaded && shape.kind === "thread") {
    return threadedScrewHoleProperties(shape, shape.generated, onUpdate, printerKind);
  }
  if (shape.generated) return generatedShapeProperties(shape, shape.generated, onUpdate, printerKind);
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

  if (shape.kind === "thread") return threadShapeProperties(shape, onUpdate, printerKind);

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

/**
 * Series and size for a plain screw hole or nut pocket, offering every thread Threads does. A
 * change of series keeps the nearest size, so the hole stays about as big as it was.
 */
function screwSizeRows<S extends { size: string; diameter?: number }>(
  spec: S,
  sizeLabel: string,
  onSpec: (next: S) => void,
  hint?: string,
): ShapePropertyConfig[] {
  const listed = findThreadSize(spec.size);
  const series: ThreadSeries = listed?.series ?? "custom";
  const diameter = listed?.majorDiameter ?? spec.diameter ?? 3;
  const proportional = screwDimensions(spec).proportional;
  const sizeHint = proportional
    ? `No screw standard covers this size, so the ${sizeLabel === "Nut" ? "nut" : "hole and head"} follow metric proportions from the diameter.`
    : hint;
  const seriesRow: ShapePropertyConfig = {
    type: "select",
    label: "Series",
    value: threadSeriesLabel(series),
    options: [...THREAD_SERIES_OPTIONS],
    onChange: (label) => {
      const nextSeries: ThreadSeries = label === "UNC" ? "unc" : label === "UNF" ? "unf" : label === "Pipe (G)" ? "g" : label === "Custom" ? "custom" : "metric";
      if (nextSeries === series) return;
      if (nextSeries === "custom") {
        onSpec({ ...spec, size: "Custom", diameter });
        return;
      }
      const nearest = THREAD_SIZE_OPTIONS.filter((entry) => entry.series === nextSeries)
        .reduce((best, entry) => (Math.abs(entry.majorDiameter - diameter) < Math.abs(best.majorDiameter - diameter) ? entry : best));
      onSpec({ ...spec, size: nearest.id, diameter: undefined });
    },
  };
  if (series === "custom") {
    return [
      seriesRow,
      {
        label: "Diameter",
        value: diameter,
        min: 1,
        max: 120,
        step: 0.1,
        hint: sizeHint,
        onChange: (next) => onSpec({ ...spec, size: "Custom", diameter: clamp(next, 0.8, 200) }),
      },
    ];
  }
  const sizes = THREAD_SIZE_OPTIONS.filter((entry) => entry.series === series);
  return [
    seriesRow,
    {
      type: "select",
      label: sizeLabel,
      value: listed?.label ?? sizes[0].label,
      options: sizes.map((entry) => entry.label),
      hint: sizeHint,
      onChange: (label) => {
        const picked = sizes.find((entry) => entry.label === label);
        if (picked) onSpec({ ...spec, size: picked.id, diameter: undefined });
      },
    },
  ];
}

/**
 * A threaded screw hole is a Threads tapped hole, so it offers every thread Threads does: any
 * series and size, either hand, any profile, and the fit. Hole switches it back to a plain hole.
 */
function threadedScrewHoleProperties(
  shape: WorkplaneShape,
  spec: Extract<GeneratedSpec, { form: "screwHole" }>,
  onUpdate: ShapeInspectorUpdate,
  printerKind: WorkplaneWorkspaceSettings["printerKind"],
): ShapePropertyConfig[] {
  const thread = shape.threadSpec;
  const holeRow: ShapePropertyConfig = {
    type: "select",
    label: "Hole",
    value: SCREW_HOLE_THREADED,
    options: [SCREW_HOLE_THREADED, SCREW_HOLE_THROUGH],
    hint: "Threaded cuts a thread for the screw to bite into. Pick the series and size of your screw below.",
    // The plain hole is sized for the same screw, whatever its series.
    onChange: (label) => {
      if (label !== SCREW_HOLE_THROUGH) return;
      const custom = thread?.designation === "Custom" || thread?.series === "custom";
      onUpdate({
        generated: {
          ...spec,
          size: custom ? "Custom" : thread?.designation ?? spec.size,
          ...(custom ? { diameter: thread?.majorDiameter, pitch: thread?.pitch } : {}),
          threaded: false,
        },
      });
    },
  };
  const threadRows = threadShapeProperties(shape, onUpdate, printerKind)
    .filter((row) => row.label !== "Kind")
    .map((row) => (row.label === "Length" ? { ...row, label: "Depth" } : row));
  return [holeRow, ...threadRows];
}

/** Threads' own settings: kind, series, size, hand, profile, fit and length. */
export function threadShapeProperties(
  shape: WorkplaneShape,
  onUpdate: ShapeInspectorUpdate,
  printerKind: WorkplaneWorkspaceSettings["printerKind"] = "filament",
): ShapePropertyConfig[] {
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
    exact: shape.threadSpec?.exact,
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
        const nut = next === "Nut";
        const screw = next === "Screw";
        const alreadyLoose = shape.threadSpec?.role === "nut";
        const major = shape.threadSpec?.majorDiameter ?? 6;
        onUpdate({
          threadSpec: nextSpec({
            role: nut ? "nut" : screw ? "screw" : "rod",
            style: "screw",
            part: "screw",
            clearance: nut ? (alreadyLoose ? clearance : defaultThreadClearance(printerKind)) : 0,
            length: nut ? threadNutSize(major).height : length,
          }),
          hole: false,
          color: fallbackSolidColor(shape),
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
    {
      type: "select",
      label: "Build",
      value: shape.threadSpec?.exact ? THREAD_BUILD_EXACT : THREAD_BUILD_PRINT,
      options: [THREAD_BUILD_PRINT, THREAD_BUILD_EXACT],
      hint: shape.threadSpec?.exact
        ? "Exact makes a true helix when you Group or export STEP, for CAD work and machining. It takes a moment longer to Group."
        : "Print-ready is quick and prints exactly as you see it. Choose Exact for a true helix in STEP files and other CAD apps.",
      onChange: (next) => onUpdate({ threadSpec: nextSpec({ exact: next === THREAD_BUILD_EXACT ? true : undefined }) }),
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
