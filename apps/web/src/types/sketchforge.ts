import type { SurfaceTexture } from "@/lib/texture/surfaceTexture";
import type { SketchDoc } from "@/lib/sketch/types";
import type { ThreeMfSourcePackage } from "@/lib/threeMfSource";

export type ShapeKind =
  | "box"
  | "cylinder"
  | "sphere"
  | "sketch"
  | "scribble"
  | "cone"
  | "pyramid"
  | "roof"
  | "text"
  | "roundRoof"
  | "halfSphere"
  | "torus"
  | "tube"
  | "ring"
  | "wedge"
  | "polygon"
  | "icosahedron"
  | "mesh"
  | "thread"
  | "gear"
  | "gridfinityBin"
  | "gridfinityBaseplate";

export type GridfinitySide = "left" | "right" | "front" | "back";

/**
 * Gridfinity bin on the 42 mm grid (7 mm height units). The body is built by the
 * CAD kernel from this spec; `importedMesh` and `cadBrep` are its build cache.
 */
export type GridfinityBinSpec = {
  unitsX: number;
  unitsZ: number;
  heightUnits: number;
  stackingLip: boolean;
  wallThickness: number;
  /** Solid floor above the feet, in mm (the spec floor sits at 7 mm → 2.25). */
  floorThickness: number;
  compartmentsX: number;
  compartmentsZ: number;
  magnets: boolean;
  screws: boolean;
  scoop: "none" | GridfinitySide;
  /** 0 = automatic (fills the cavity height). */
  scoopRadius: number;
  openSides: GridfinitySide[];
  /** No cavity — a blank to carve with Push Pull or Hollow. */
  solid: boolean;
};

export type GridfinityConnector = "tab" | "slot" | "dovetail" | "groove";

/** Gridfinity baseplate (the rails bins click into). */
export type GridfinityBaseplateSpec = {
  unitsX: number;
  unitsZ: number;
  padLeft: number;
  padRight: number;
  padFront: number;
  padBack: number;
  /** Drawer inner size that chose the units and padding, or 0 when sized by units. */
  drawerWidth: number;
  drawerLength: number;
  /** 0 = open frame. Magnets or screws need a floor. */
  floorThickness: number;
  magnets: boolean;
  screws: boolean;
  /** Set by Split for print bed: alignment tabs / slots on the cut edges. */
  connectors?: Partial<Record<GridfinitySide, GridfinityConnector>>;
};

export type ShapeAsset = {
  id: string;
  name: string;
  src: string;
  kind: ShapeKind;
  color: string;
  hole?: boolean;
};

export type GridSize = "Off" | "0.1 mm" | "0.25 mm" | "0.5 mm" | "1.0 mm" | "2.0 mm" | "5.0 mm";
export type MeasurementAccuracy = 1 | 2 | 3;
/** Viewport / CSG curve density. Smooth is the default for PeakCAD. */
export type DisplayQuality = "draft" | "standard" | "smooth";

export type WorkplaneWorkspaceSettings = {
  width: number;
  depth: number;
  sizePreset: string;
  gridBlockSize: number;
  gridBlockPreset: string;
  background: string;
  showShadows: boolean;
  showGrid: boolean;
  cruiseShapes: boolean;
  zoomSpeed: number;
  units: string;
  scale: string;
  accuracy: MeasurementAccuracy;
  displayQuality: DisplayQuality;
  /**
   * Advanced tools such as sketch constraints. The live value is this
   * computer's global choice; a project file does not turn it on or off.
   */
  peakcadPro: boolean;
  /** Printer preset id. "custom" keeps the three sizes below. */
  printerPreset: string;
  /** Filament or resin. Named presets set this; Custom keeps the last choice. */
  printerKind: "filament" | "resin";
  /** Build-plate width along X, in millimetres. */
  printerWidth: number;
  /** Build-plate depth along Z, in millimetres. */
  printerDepth: number;
  /** Usable height above the bed, in millimetres. */
  printerHeight: number;
  /** Overhang marks start past this many degrees from vertical. */
  overhangAngle: number;
  /** Draw the printer bed frame on the workplane. */
  showPrinterBed: boolean;
  /** Draw overhang marks on faces that lean out past the overhang angle. */
  showOverhangStripes: boolean;
  /** Nozzle diameter in millimetres. Walls thinner than this are marked. */
  nozzleMm: number;
  /** Draw marks on walls thinner than the nozzle. */
  showThinWalls: boolean;
  /** Draw marks on holes and slots narrower than the nozzle. */
  showSmallHoles: boolean;
  /** Draw marks on sealed cavities that cannot drain. */
  showTrappedResin: boolean;
  /** Hide coaching and refusal toasts. A command that fails still shows. */
  failureNoticesOnly: boolean;
  /** Made for a 3D printer, or flat parts cut on a laser. Older files are print designs. */
  designKind: "print" | "laser";
  /** Laser preset id. "custom" keeps the two sizes below. */
  laserPreset: string;
  laserType: "diode" | "co2" | "infrared" | "uv";
  /** Laser work area along X and Z, in millimetres. */
  laserWidth: number;
  laserDepth: number;
  /** Width the beam burns away, in millimetres. */
  kerfMm: number;
  /** Sheet material id. "custom" keeps the thickness below. */
  materialPreset: string;
  materialThickness: number;
  /** The software the cut files are made for. */
  cutFileStyle: "lightburn" | "xtool" | "glowforge";
  /** Draw the laser's work area on the workplane. */
  showLaserBed: boolean;
  /** The K9 crystal blank a crystal design is engraved inside. */
  crystal: {
    shape: "block" | "ball";
    width: number;
    depth: number;
    height: number;
    diameter: number;
    margin: number;
  };
};

export type AlignAxis = "x" | "y" | "z";
export type AlignTarget = "min" | "center" | "max";
export type AlignHandleStatus = {
  axis: AlignAxis;
  target: AlignTarget;
  disabled: boolean;
  aligned: boolean;
  title: string;
};

export type SketchPoint = {
  id: string;
  x: number;
  z: number;
  handleIn?: { x: number; z: number };
  handleOut?: { x: number; z: number };
  mode?: "corner" | "smooth" | "split";
};

export type SketchSegment = {
  id: string;
  startId: string;
  endId: string;
  kind?: "line" | "bezier" | "smooth";
  /** Dashed guide. It snaps, and it is left out of extrude and revolve. */
  construction?: boolean;
  /**
   * Closed loops nest into holes only within one region.
   * An offset copy gets its own region so it stays a separate shape.
   */
  regionId?: string;
  /** Drawn thickness in screen pixels. Absent is the standard line. The shape is unchanged. */
  weight?: number;
};

export type SketchImage = {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  pixelWidth: number;
  pixelHeight: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  opacity?: number;
  lockAspect?: boolean;
};

/**
 * Cylindrical host surface for barrel sketches.
 * UV: U = R·θ (mm arc length from `radial0`), V = height along `axisDir` from mid.
 */
export type SketchCylinderSurface = {
  kind: "cylinder";
  axisOrigin: { x: number; y: number; z: number };
  axisDir: { x: number; y: number; z: number };
  /** World direction of U = 0 (unit, ⊥ axis). */
  radial0: { x: number; y: number; z: number };
  radius: number;
  height: number;
  /** Extra seam offset in radians (usually 0; baked into radial0 on pick). */
  theta0: number;
};

/** World-space frame for a sketch. Profile `x`/`z` are plane-local U/V. */
export type SketchPlane = {
  origin: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  /** In-plane X (U). V = normal × uAxis. */
  uAxis: { x: number; y: number; z: number };
  /** When set, the plane was picked from this shape’s face. */
  hostShapeId?: string;
  /** Present when the sketch is unwrapped onto a cylinder barrel. */
  surface?: SketchCylinderSurface;
};

export type SketchProfile = {
  points: SketchPoint[];
  segments: SketchSegment[];
  images?: SketchImage[];
  sketchPlane?: SketchPlane;
  /** UV outline of the host face being sketched on (plane-local x/z). */
  faceReferenceLoops?: Array<Array<{ x: number; z: number }>>;
};

export type EdgeTreatmentFeature = {
  kind: "fillet" | "chamfer";
  amount: number;
  edgeCount: number;
  chamferAngle?: number;
  /** Fillet only. `cove` is a concave groove cut into the edge; absent means the convex round. */
  filletProfile?: "round" | "cove";
  /** Durable recipe so remesh can re-apply after edge IDs change. */
  edgeIds?: number[];
  /** Geometric fingerprints (mid/length/angle) for rematch after remesh. */
  edgeFingerprints?: Array<{
    mid: [number, number, number];
    length: number;
    angle: number;
  }>;
  allEdges?: boolean;
  sharpAngle?: number;
  quality?: "draft" | "standard" | "fine" | "ultra";
};

export type EdgeTreatmentHistoryEntry = {
  id: string;
  createdAt: number;
  feature: EdgeTreatmentFeature;
  before: WorkplaneShape;
  appliedFrame?: {
    x: number;
    z: number;
    elevation: number;
    width: number;
    depth: number;
    height: number;
    rotation: number;
    rotationX: number;
    rotationZ: number;
    mirrorX: boolean;
    mirrorY: boolean;
    mirrorZ: boolean;
  };
};

export type ThreadFeature = {
  side: "external" | "internal";
  /** ISO metric designation when applied from a preset (e.g. "M3"). */
  designation?: string;
  majorDiameter: number;
  pitch: number;
  length: number;
  depth: number;
  handedness: "right" | "left";
  faceId: number;
};

export type ThreadHistoryEntry = {
  id: string;
  createdAt: number;
  feature: ThreadFeature;
  before: WorkplaneShape;
  appliedFrame?: EdgeTreatmentHistoryEntry["appliedFrame"];
};

export type CadDisplayEdge = {
  points: number[];
};

export type CadBrepFrame = {
  x: number;
  z: number;
  elevation: number;
  width: number;
  depth: number;
  height: number;
  sourceTransform?: number[];
};

/**
 * Analytic primitive identity carried through a bake so the body can still export as an exact
 * solid. Cylinders record their diameter in `width`/`depth`; a bake that leaves the two unequal is
 * an elliptic cylinder and no longer qualifies.
 */
export type CadPrimitiveFrame = {
  kind: "box" | "cylinder";
  width: number;
  depth: number;
  height: number;
  frame: CadBrepFrame;
};

/** Live CSG / feature-tree op on a body. Mesh cache is derived; children are truth. */
export type CsgOp = "union" | "subtract" | "intersect" | "assemble";

export type CsgBodyMeta = {
  op: CsgOp;
  /** Bumps when operands change so caches can be invalidated. */
  version: number;
  /** True when importedMesh may not match groupedShapes. */
  dirty?: boolean;
  /** When true, this body/feature is skipped during evaluate and export. */
  suppressed?: boolean;
};

export type WorkplaneShape = {
  id: string;
  name: string;
  kind: ShapeKind;
  color: string;
  hole?: boolean;
  /** Color to restore when a hole is toggled back to a solid. */
  solidColor?: string;
  x: number;
  z: number;
  elevation?: number;
  size: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  rotationX?: number;
  rotationZ?: number;
  mirrorX?: boolean;
  mirrorY?: boolean;
  mirrorZ?: boolean;
  radius?: number;
  steps?: number;
  sides?: number;
  bevel?: number;
  segments?: number;
  topRadius?: number;
  baseRadius?: number;
  /** When set, a cone keeps Length and Width as well as the two radii. */
  coneFreeRange?: boolean;
  /** Triangle/roof left slope angle in degrees from horizontal. */
  leftAngle?: number;
  /** Triangle/roof right slope angle in degrees from horizontal. */
  rightAngle?: number;
  text?: string;
  font?: string;
  /** Face-up bow across the page. 0 is flat, ±100 is a full circle. Negative bows outward, positive bows inward. */
  textCircumference?: number;
  /** Rod bent through the letters. 0 is flat, ±100 is a full circle. Letters turn with the rod. Negative bows outward, positive bows inward. */
  textWrap?: number;
  importedMesh?: {
    positions: number[];
    /** Optional indexed triangles into `positions` (shared verts). Prefer when present. */
    indices?: number[];
    normals?: number[];
    baseWidth: number;
    baseDepth: number;
    baseHeight: number;
    triangleCount: number;
    sourceFormat: "stl" | "obj" | "svg" | "json" | "step" | "3mf";
    // Exact OpenCascade B-Rep of the body (single-shape STEP text) in the same
    // local frame as `positions`. Set for STEP imports, sketch OCCT bakes, and
    // CSG boolean bakes so the exporter can re-emit analytic geometry.
    brepStep?: string;
  };
  imagePlate?: {
    dataUrl: string;
    mimeType: string;
    pixelWidth: number;
    pixelHeight: number;
  };
  sketchProfile?: SketchProfile;
  /**
   * Parametric sketch document (Fusion-like). When present, preferred over
   * reconstructing from `sketchProfile` alone. Kept in sync on finish/edit.
   */
  sketchDoc?: SketchDoc;
  /** Stable id linking Extrude/Revolve features back to a sketch document. */
  sketchId?: string;
  /** Closed profile ids from the sketch that were used for this feature. */
  sketchProfileIds?: string[];
  /** Plane the sketch was drawn on (defaults to workplane when missing). */
  sketchPlane?: SketchPlane;
  /** How the stored sketch profile was turned into this solid. */
  sketchFinish?: "extrude" | "revolve" | "sweep";
  /** Axis used for `sketchFinish: "revolve"` (sketch-plane XZ coordinates). */
  sketchRevolveAxis?: { x1: number; z1: number; x2: number; z2: number };
  /**
   * Outline and path chosen for `sketchFinish: "sweep"`.
   * Stored so a later edit cannot silently switch to a different chain.
   */
  sketchSweep?: {
    outlineSegmentIds: string[];
    holeSegmentIds: string[];
    pathSegmentIds: string[];
    outlineCurveId?: string;
    holeCurveId?: string;
    pathCurveId?: string;
    pathClosed: boolean;
    /**
     * Profile drawn on a sheet of its own. When set, the outline ids above point into this sketch,
     * not the path sheet. A flat profile (the Sweep steps) is stood up on the path start, centred
     * on it and resting on the sheet. `standing` means it was drawn on the sheet standing across
     * the path start (see sweepSectionPlane) and is used exactly where it was drawn.
     * Absent: the older one-sheet sweep.
     */
    section?: { profile: SketchProfile; doc?: SketchDoc; standing?: boolean };
  };
  edgeTreatments?: EdgeTreatmentFeature[];
  /** A finish on the part: the body stays exact, and the textured triangles are rebuilt from it. */
  surfaceTexture?: SurfaceTexture;
  /** In a laser design, what the laser does along this part: cut through (the default), score a line, or engrave its area. */
  laserJob?: "cut" | "score" | "engrave";
  edgeTreatmentHistory?: EdgeTreatmentHistoryEntry[];
  /**
   * Involute gear. Size follows the module and tooth count.
   * Spur and ring are exact solids. Helical, herringbone, and rack use the same tooth.
   */
  gearSpec?: {
    form?: "spur" | "helical" | "herringbone" | "ring" | "rack";
    teeth?: number;
    module?: number;
    pressureAngle?: number;
    backlash?: number;
    bore?: number;
    helixAngle?: number;
    rim?: number;
  };
  /** Metric coarse size / style for `kind: "thread"` solids. */
  threadSpec?: {
    designation: string;
    majorDiameter: number;
    pitch: number;
    /** screw = fastener; hole = clearance cutter for a receiving hole. */
    style?: "screw" | "hole";
    /** Radial clearance in mm for nuts and tapped holes. */
    clearance?: number;
    /** screw | shaft | threads after Separate. */
    part?: "screw" | "shaft" | "threads";
    /** rod, headed screw, nut, or tapped hole. */
    role?: "rod" | "screw" | "nut" | "bore";
    head?: "cylinder" | "countersunk" | "hex";
    hand?: "right" | "left";
    series?: "metric" | "unc" | "unf" | "g" | "custom";
    profile?: "v" | "whitworth" | "trapezoid" | "round";
    /** 45° chamfer at the thread ends, in mm. */
    chamfer?: number;
    /** Threaded length, or nut thickness. The shape height includes a screw head. */
    length?: number;
  };
  threadFeatures?: ThreadFeature[];
  threadHistory?: ThreadHistoryEntry[];
  /** `kind: "gridfinityBin"` parameters. */
  gridfinityBin?: GridfinityBinSpec;
  /** `kind: "gridfinityBaseplate"` parameters. */
  gridfinityBaseplate?: GridfinityBaseplateSpec;
  /**
   * Spec key the stored Gridfinity mesh / B-Rep was built from. A mismatch with
   * the current spec means the kernel build is still pending.
   */
  gridfinityBuilt?: string;
  cadDisplayEdges?: CadDisplayEdge[];
  cadDisplayEdgesVersion?: 2;
  edgeResizeMode?: "scale" | "preserve";
  cadBrep?: string;
  cadBrepFrame?: CadBrepFrame;
  cadPrimitiveFrame?: CadPrimitiveFrame;
  /**
   * Live CSG body metadata. When present with `groupedShapes`, children are the
   * source of truth and `importedMesh` is an evaluation cache.
   */
  csg?: CsgBodyMeta;
  groupedShapes?: WorkplaneShape[];
  groupedBaseWidth?: number;
  groupedBaseDepth?: number;
  groupedBaseHeight?: number;
  locked?: boolean;
  hidden?: boolean;
  /** When true, skipped during CSG evaluate / STEP (feature suppress). */
  suppressed?: boolean;
  /**
   * Linked linear/circular pattern. The source keeps this feature; copies are
   * regenerated when count/spacing (or the source) changes.
   */
  patternFeature?: PatternFeature;
  /** Thin reference plane — sketched on, skipped in export/Group. */
  construction?: boolean;
  /** Parametric hole cutter (diameter / through / counterbore). */
  holeSpec?: HoleSpec;
  /**
   * Original 3MF package, minus the triangle mesh. Export writes the edited
   * model back into this package and leaves the other files alone.
   */
  source3mf?: ThreeMfSourcePackage;
  /** Short id used to reattach `source3mf` after undo, without copying the package into every history step. */
  source3mfKey?: string;
};

export type LinearPatternFeatureParams = {
  countX: number;
  countZ: number;
  countY?: number;
  spacingX: number;
  spacingZ: number;
  spacingY?: number;
};

export type CircularPatternFeatureParams = {
  count: number;
  center: { x: number; z: number };
  radius: number;
  rotationOffset: number;
  seatElevation?: number;
};

export type PatternFeature = {
  id: string;
  kind: "linear" | "circular";
  role: "source" | "instance";
  sourceId: string;
  instanceIndex?: number;
  linear?: LinearPatternFeatureParams;
  circular?: CircularPatternFeatureParams;
};

export type HoleStyle = "simple" | "counterbore" | "countersink";
export type HoleDepthMode = "through" | "blind";

export type HoleSpec = {
  diameter: number;
  depth: number;
  depthMode: HoleDepthMode;
  style: HoleStyle;
  counterboreDiameter?: number;
  counterboreDepth?: number;
  countersinkDiameter?: number;
  countersinkAngle?: number;
};
