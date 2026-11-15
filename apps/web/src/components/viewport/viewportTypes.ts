import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CircleFit, MeasureAlignKind } from "@/lib/rulerAlignment";
import type { SketchCameraPose } from "@/lib/sketch/sketch3d";
import type { SketchFaceClassification } from "@/lib/sketchFaceClassify";
import type { XrayAxis, XraySpan } from "@/lib/xraySection";
import type { SketchForgeMcpViewFace } from "@/lib/sketchforgeMcpProtocol";
import type { RotationAxis, RotationWheelView, TransformHandleKind } from "@/components/workplane/TransformOverlay";
import type { SketchPlane, WorkplaneShape, WorkplaneWorkspaceSettings } from "@/types/sketchforge";
import type { CadModifierEdge } from "@/lib/cadModifierTypes";

export type WorkspaceSettings = WorkplaneWorkspaceSettings;
export type ViewCubeFace = "top" | "bottom" | "front" | "back" | "right" | "left";

export type EdgeWipeState = {
  handle: number;
  /** The body before the edge treatment; dissolves away over the new one. */
  outgoing: THREE.Object3D;
  incoming: THREE.Object3D;
  /** The treated edges, drawn in mint and faded out. */
  trace: THREE.LineSegments;
  /** Outgoing materials with the settings to restore if the fade is cut short. */
  dissolving: Array<{
    material: THREE.Material & { opacity: number };
    opacity: number;
    transparent: boolean;
    depthWrite: boolean;
    polygonOffsetFactor: number;
    polygonOffsetUnits: number;
  }>;
  /** Incoming materials that carry the brief mint sheen. */
  sheen: Array<{ material: THREE.MeshStandardMaterial; emissive: THREE.Color; intensity: number }>;
  started: number;
  duration: number;
};

export type ThreeState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  keyLight: THREE.DirectionalLight;
  workplaneLayer: THREE.Group;
  shapeLayer: THREE.Group;
  helperLayer: THREE.Group;
  modifierLayer: THREE.Group;
  xrayLayer: THREE.Group;
  /** X-ray's filled, hatched cut faces. */
  sectionCapLayer: THREE.Group;
  printLayer: THREE.Group;
  printShapes: WorkplaneShape[];
  showPrinterBed: boolean;
  showOverhangStripes: boolean;
  showThinWalls: boolean;
  showSmallHoles: boolean;
  showTrappedResin: boolean;
  /** A laser design: parts show their job, cut, score or engrave, on top. */
  laserDesign: boolean;
  printerAngle: number;
  nozzleMm: number;
  overhangKey: string;
  thinWallKey: string;
  smallHoleKey: string;
  trappedResinKey: string;
  clippingPlane: THREE.Plane;
  edgeWipe: EdgeWipeState | null;
  /** Sharp meshes held while a fillet/chamfer preview is on screen, keyed by shape id. */
  previewHold: Map<string, THREE.Object3D>;
  modifierPreviewActive: boolean;
  /** Bumps whenever the solids are rebuilt, so preview edge lines recut against the new mesh. */
  shapeRevision: number;
  modifierEdgeSource?: CadModifierEdge[];
  modifierEdgeSelectedIds?: number[];
  modifierEdgeHoverId?: number | null;
  xray: {
    enabled: boolean;
    axis: XrayAxis;
    position: number;
    keepLow: boolean;
    showPlane: boolean;
    planeSize: number;
    /** Model extent along the cut axis; the section plane glides in from just past it. */
    bounds: XraySpan;
  };
  xraySweep: XraySweep | null;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  dragPlane: THREE.Plane;
  animationId: number;
  needsRender: boolean;
  cameraTween: {
    handle: number;
    started: number;
    duration: number;
    from: SketchCameraPose;
    to: SketchCameraPose;
  } | null;
  wasCameraMoving: boolean;
  cameraStillFrames: number;
  /** True after measurements were projected from a camera that had finished moving. */
  cameraOverlayHold: boolean;
  cameraHoldPosition: THREE.Vector3;
  cameraHoldTarget: THREE.Vector3;
  cameraHoldQuaternion: THREE.Quaternion;
  lastOverlaySync: number;
  lastViewCubeSync: number;
  rotationHandleSides: RotationHandleSides | null;
  disposeInteractionListeners: () => void;
  resize: () => void;
};

export type CaptureSceneImageOptions = {
  /** When true (default), hide workplane/helpers for model-only captures (MCP / automation). */
  hideOverlays?: boolean;
};

export type ViewportPerfStats = {
  fps: number;
  frameMs: number;
  maxFrameMs: number;
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  shapeCount: number;
};

declare global {
  interface Window {
    sketchforgePerf?: {
      get: () => ViewportPerfStats;
    };
    sketchforgeCaptureCanvas?: (options?: CaptureSceneImageOptions) => string;
    sketchforgeCaptureView?: (face?: SketchForgeMcpViewFace) => Promise<string> | string;
    sketchforgeCaptureProjectThumbnails?: (options?: CaptureSceneImageOptions) => { light: string; dark: string } | null;
  }
}

export type DragState = {
  primaryId: string;
  offsetX: number;
  offsetZ: number;
  planeY: number;
  pointerId: number;
  primaryStartX: number;
  primaryStartZ: number;
  items: DragItem[];
  shadowsHidden?: boolean;
  shadowCasters?: THREE.Mesh[];
};

export type MarqueeState = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
  hasMoved: boolean;
};

export type RulerPoint = {
  id: string;
  x: number;
  y: number;
  z: number;
  attachment?: RulerAttachment;
};

export type RulerAttachment = {
  shapeId: string;
  normalized: [number, number, number];
  kind?: "vertex" | "edge" | "surface";
  topologyKey?: string;
  /** World-space unit normal of the picked face. */
  normal?: [number, number, number];
  circle?: CircleFit;
};

export type RulerEdgeAttachment = {
  key: string;
  shapeId: string;
  normalizedPoints: Array<[number, number, number]>;
  topologyKey?: string;
  circle?: CircleFit;
};

export type RulerSegment = {
  id: string;
  startId: string;
  endId: string;
  edge?: RulerEdgeAttachment;
};

export type RulerModel = {
  points: RulerPoint[];
  segments: RulerSegment[];
  startPointId: string | null;
  hover: RulerCandidate | null;
};

export type RulerOverlayState = {
  points: Array<RulerPoint & { screenX: number; screenY: number; alignKind?: MeasureAlignKind | null }>;
  segments: Array<RulerSegment & {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    screenPoints?: string;
    labelX: number;
    labelY: number;
    label: string;
    alignKind?: MeasureAlignKind | null;
    ticks?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  }>;
  hover: {
    screenX: number;
    screenY: number;
    edgeScreenPoints?: string;
    alignKind?: MeasureAlignKind | null;
    preview?: {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      ticks?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
      label: string;
      labelX: number;
      labelY: number;
    };
  } | null;
};

export type RulerCandidate = {
  x: number;
  y: number;
  z: number;
  pointId?: string;
  attachment?: RulerAttachment;
  edge?: RulerEdgeAttachment;
  alignHint?: MeasureAlignKind;
};

export type RulerPointDragState = {
  pointId: string;
  pointerId: number;
};

export type RotationHandleSide = "near" | "right" | "far" | "left";
export type RotationHandleSides = Record<RotationAxis, RotationHandleSide>;
export type ShapeUpdatePatch = Partial<WorkplaneShape> & { bakeTransform?: boolean; repeatDeltaBefore?: WorkplaneShape };
export type ResizeSigns = { x: number; z: number };
export type ResizeAnchorMemory = {
  shapeId: string;
  handleKey: string;
  signs: ResizeSigns;
  pressedY: "top" | "bottom" | null;
};
export type TransformDragState = {
  id: string;
  ids: string[];
  kind: TransformHandleKind;
  handleKey: string;
  rotationAxis: RotationAxis;
  pointerId: number;
  startShape: WorkplaneShape;
  items: TransformDragItem[];
  selectionFrame: SelectionFrame;
  startScreenAngle: number;
  startClientX: number;
  startClientY: number;
  startScreenY: number;
  startWorldY: number;
  handleWorldOffset: number;
  screenYPerWorldUnit: number;
  scalePlaneY: number;
  scalePlane?: THREE.Plane;
  scaleSigns?: ResizeSigns;
  scaleAnchorPoint?: THREE.Vector3;
  scaleStartPoint?: THREE.Vector3;
  rotationAxisVector?: THREE.Vector3;
  rotationPivot?: THREE.Vector3;
  rotationPlaneCenter?: THREE.Vector3;
  rotationStartVector?: THREE.Vector3;
  rotationScreenCenter?: { x: number; y: number };
  rotationScreenSign?: number;
  rotationStartQuaternion?: THREE.Quaternion;
  wheelCenter?: RotationWheelView;
  hasMoved?: boolean;
};

export type TransformDragItem = {
  id: string;
  startShape: WorkplaneShape;
  startCenter: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
};

export type SelectionFrame = {
  ids: string[];
  center: THREE.Vector3;
  quaternion: THREE.Quaternion;
  xAxis: THREE.Vector3;
  yAxis: THREE.Vector3;
  zAxis: THREE.Vector3;
  width: number;
  height: number;
  depth: number;
  min: THREE.Vector3;
  max: THREE.Vector3;
  singleShape: WorkplaneShape | null;
};

export type DragItem = {
  id: string;
  startX: number;
  startZ: number;
  nextX: number;
  nextZ: number;
  visual: THREE.Object3D | null;
  helper: THREE.Box3Helper | null;
  helperBox: THREE.Box3 | null;
  hadPreviewSimplified: boolean;
};

export type RankedRulerPick = {
  screenDist: number;
  rayDist: number;
  rayT: number;
  candidate: RulerCandidate;
};

export type CutPreviewShapeFrame = {
  shape: WorkplaneShape;
  worldBounds: THREE.Box3;
};

/**
 * X-ray entry and exit. The section plane is not switched on in place: it
 * starts just outside the model on the side that will be hidden and glides in
 * to the chosen position, so the part is seen being cut open; on the way out it
 * glides back past the edge and the clip is released once the model is whole.
 * Only the shared plane constant and the helper move per frame; materials are
 * re-walked at the transitions.
 */
export type XraySweep = {
  kind: "in" | "out";
  from: number;
  to: number;
  started: number;
  duration: number;
  handle: number;
  /** Raw 0..1 time. */
  progress: number;
};

/** Edit points on a Smooth body: dots on the smooth surface, joined by the net's edges. */
export type SmoothEditOverlay = {
  points: Float32Array;
  edges: Uint32Array;
  /** Edges that are sharp, drawn darker. */
  sharpEdges: Uint32Array;
  /** Which way the surface faces at each point. */
  normals: Float32Array;
  selected: ReadonlySet<number>;
  /** Mirror twins of the selected points. */
  twins: ReadonlySet<number>;
  /** Points on a face kept flat (1): drawn grey, and they cannot be picked. */
  locked: Uint8Array;
  /** The first points were already there one detail down; they are drawn larger. */
  coarseCount: number;
  /** A click picks a face of the part to keep flat, instead of a point. */
  pickingFace: boolean;
  /** Drags pull straight in and out of the surface; otherwise Ctrl does. */
  dragInOut: boolean;
};

/** How far a Smooth drag has gone: a move in world mm, or a number for straight out of the surface (negative is in). */
export type SmoothPull = [number, number, number] | number;

export type SketchFacePickOutcome =
  | { ok: true; plane: SketchPlane }
  | { ok: false; reason: string };

export type SketchFaceRaycastHit = {
  hit: THREE.Intersection;
  mesh: THREE.Mesh;
  worldNormal: THREE.Vector3;
  shapeId: string;
  key: string;
  classification: SketchFaceClassification;
};
