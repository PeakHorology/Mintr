"use client";

import { ChevronLeft, ChevronRight, Crosshair, Home, Minus, MousePointer2, Plus, Ruler, ScanEye, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import * as THREE from "three";
import { meshForShape } from "@/lib/editorShapeMesh";
import { gearPatchForFootprint } from "@/lib/gearProfile";
import type { MirrorSide } from "@/lib/mirrorCopy";
import { AlignOverlay, CircularPatternOverlay, MirrorOverlay, type AlignOverlayState, type CircularPatternOverlayState, type MirrorOverlayState } from "@/components/workplane/ActionOverlays";
import { ShapeInspector, SnapGridControl, TYPED_DIMENSION_MAX_MM, type ShapeInspectorUpdateOptions, type SmoothInspectorControls } from "@/components/workplane/ShapeInspector";
import { LaserIcon, ToolbarDropToWorkplaneIcon, ToolbarEraserIcon } from "@/components/icons";
import { objectSnapTolerance, snapAabbFromShape, snapMovingAabb, unionSnapAabbs, type FaceMatePose, type ObjectSnapResult } from "@/lib/objectSnap";
import { PeakTipButton } from "@/components/workplane/ToolNameTooltip";
import { XrayViewPanel } from "@/components/workplane/XrayViewPanel";
import { WorkplaneDimensionsControl } from "@/components/workplane/WorkplaneDimensionsControl";
import { WorkplaneEmptyCoach } from "@/components/workplane/WorkplaneEmptyCoach";
import { WorkspaceSettingsModal } from "@/components/workplane/WorkspaceSettingsModal";
import { HOTKEYS_CHANGED_EVENT, isHotkeyRecordingActive, loadHotkeyBindings, matchHotkeyAction } from "@/lib/hotkeys";
import { defaultSketchPlane, sketchPlaneFromThreeVectors } from "@/lib/sketchPlane";
import {
  captureSketchCameraPose,
  clearSketchOnModel,
  emptySketch3DPointer,
  sketch3DLineKey,
  sketch3DMeasureLabel,
  sketch3DSizeCallouts,
  sketchUvToWorld,
  sketch3DPointerDown,
  sketch3DPointerMove,
  sketch3DPointerUp,
  sketchExtrudePreviewPose,
  syncSketchOnModel,
  type Sketch3DPointerState,
  type SketchCameraPose,
  type SketchOnModelSession,
} from "@/lib/sketch/sketch3d";
import { TOOL_DESCRIPTIONS } from "@/lib/toolDescriptions";
import {
  setActiveDisplayQuality,
} from "@/lib/displayTessellation";
import { isHeavyDisplayScene } from "@/lib/displayTriangleCount";
import { displayToMillimeters } from "@/lib/measurementUnits";
import { bedFitForShapes, normalizePrinterBed } from "@/lib/printerBed";
import { crystalReach, isCrystalDesign, isLaserDesign, laserDesignLabel, sheetThickness } from "@/lib/laserMachine";
import { checkInsideCrystal } from "@/lib/laser/crystal";
import { isConstructionShape } from "@/lib/holeFeature";
import type { SettingsSectionId } from "@/lib/settingGuides";
import { DEFAULT_SNAP_GRID, normalizeSnapGrid, normalizeWorkspaceSettings, saveGlobalWorkspaceDefaults, workplaneSettingsFingerprint, workspaceHydrationSyncDecision } from "@/lib/workplaneSettings";
import { csgTreeContainsId } from "@/lib/csgTree";
import { cleanNearZero, conePatchForFootprint, resizedShapeSize, shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import { roofAnglesFromProfile } from "@/lib/roofGeometry";
import { computeViewNudgeAxes, type ViewNudgeAxes } from "@/lib/viewNudge";
import { xrayAxisBounds, xraySpanCenter, type XrayAxis } from "@/lib/xraySection";
import { clearSectionCaps, measureSectionAt } from "@/lib/xrayCaps";
import {
  clamp,
  previewShapesForDrag,
  projectToScreen,
  projectedScreenYAt,
  projectedScreenYPerWorldUnitAt,
  quaternionForShape,
  resolveRotationAxis,
  rotationPatchForAxis,
  rotationPatchFromQuaternion,
  rotationReadoutAtPointer,
  rotationScreenSign,
  rotationValueForAxis,
  screenAngle,
  shapesInteractionFingerprint,
  snapPositionValue,
  snapStep,
  snapValue,
  unwrapRadians,
} from "@/lib/viewportInteractionMath";
import {
  TransformOverlay,
  getElevationMeasureKey,
  measureKeyForHandle,
  type DimensionMark,
  type EditingDimension,
  type EditingRotation,
  type PinnedRotationWheelView,
  type RotationAxis,
  type RotationReadout,
  ROTATION_SNAP_STEP,
  type TransformHandleKind,
  type TransformOverlayState,
} from "@/components/workplane/TransformOverlay";
import type { AlignAxis, AlignHandleStatus, AlignTarget, GridSize, ShapeAsset, SketchPlane, WorkplaneShape, WorkplaneWorkspaceSettings } from "@/types/sketchforge";
import type { CadModifierEdge, CadPlanarFace } from "@/lib/cadModifierTypes";
import {
  pickPlanarFaceId,
  pushPullChipWorld,
  pushPullDistanceFromDrag,
  type PushPullScreenAxis,
} from "@/lib/pushPullGeometry";
import { prefersReducedMotion } from "@/lib/chromePresence";
import {
  onSurfaceTextureReady,
} from "@/lib/texture/texturedShape";
import { tickTextureRise } from "@/lib/texture/texturePreviewMaterial";
import { textureChosenFacesMesh, textureHoverFace, texturePictureGhost } from "@/lib/texture/textureGuides";
import { pointOnStamp } from "@/lib/texture/texturedShape";
import { normalizeSurfaceTexture } from "@/lib/texture/surfaceTexture";
import { endShapeAssetDrag, getShapeAssetDrag } from "@/lib/shapeAssetDrag";
import {
  UI_THEME_CHANGED_EVENT,
} from "@/lib/uiTheme";
import {
  CAMERA_OVERLAY_SETTLE_FRAMES,
  MAX_ELEVATION,
  MIN_ELEVATION,
  MIN_SHAPE_SIZE,
  WORKSPACE_DEFAULTS_STORAGE_PREFIX,
} from "@/components/viewport/viewportConstants";
import type {
  DragItem,
  DragState,
  MarqueeState,
  ResizeAnchorMemory,
  RulerAttachment,
  RulerCandidate,
  RulerModel,
  RulerOverlayState,
  RulerPoint,
  RulerPointDragState,
  ShapeUpdatePatch,
  SketchFacePickOutcome,
  SmoothEditOverlay,
  SmoothPull,
  ThreeState,
  TransformDragState,
  ViewCubeFace,
  WorkspaceSettings,
} from "@/components/viewport/viewportTypes";
import { parseDroppedShapeAsset, readSavedWorkspaceDefault, worldPoseOfPartInBody } from "@/components/viewport/droppedShapeAsset";
import { formatMeasure } from "@/components/viewport/formatMeasure";
import { findSelectionHelper, findShapeObject } from "@/components/viewport/sceneLookup";
import {
  canvasPx,
  pickModifierEdgeFromScreen,
  pointerWorldRay,
  projectToCanvasPx,
  pushPullDragAxis,
} from "@/components/viewport/screenProjection";
import { hideDragShadows, markShadowsDirty, restoreDragShadows } from "@/components/viewport/shadows";
import { preciseMeshHits, surfaceHits } from "@/components/viewport/meshPick";
import {
  disposeChildren,
  disposeObject,
  refreshSilhouetteOutlines,
  showShapeHoverOutline,
  syncSelectionOutline,
} from "@/components/viewport/shapeOutlines";
import {
  remainingSettleLift,
  settleLiftMm,
} from "@/components/viewport/shapeSettle";
import {
  COMBINE_START_SCALE,
  disposePreviewHold,
  finishEdgeWipe,
  MAX_SETTLE_SHAPES,
  restorePreviewHold,
  SEPARATE_START_SCALE,
  setObjectPickable,
  SKETCH_EXTRUDE_PREVIEW_ID,
  startApplyFlash,
  startEdgeWipe,
  startShapeCombine,
  startShapeSettle,
  startSketchExtrudeRise,
  stashPreviewHold,
  tagEdgeWipeRole,
} from "@/components/viewport/shapeMotion";
import {
  boundsIntersectRect,
  frameLocalPoint,
  localResizePlaneForFrame,
  patchWithResizeAnchor,
  projectedWorldYForScreenY,
  rayPointOnRotationPlane,
  resizeAnchorPointForFrame,
  resizeSelectionFromHandle,
  resizeShapeFromFrameHandle,
  resizeSignsForHandle,
  rotationAxisVectorForFrame,
  selectionFrameForShapes,
  selectionWorldYBounds,
  shapeCenter,
  shapeScreenBounds,
} from "@/components/viewport/selectionFrame";
import { captureSceneImage, captureSceneImagesForThemes } from "@/components/viewport/sceneCapture";
import { applyXrayClipping, stopXraySweep, xraySectionMeasure } from "@/components/viewport/xrayScene";
import {
  addLaserJobMarks,
  applyShapePose,
  createShapeObject,
  setComplexEdgeVisibility,
  shapeGeometryFingerprint,
} from "@/components/viewport/shapeObjects";
import { clearAssetPlacementPreviewObject, syncAssetPlacementPreview } from "@/components/viewport/assetPlacementPreview";
import {
  applyDragItemPreview,
  refreshDragPreviewObjects,
  updateSelectedGroundFootprintPreviews,
} from "@/components/viewport/dragPreview";
import { rebuildPrintOverlays } from "@/components/viewport/printOverlays";
import { rebuildWorkplane, setCrystalWarning } from "@/components/viewport/workplaneScene";
import {
  applyRememberedSketchCamera,
  cameraHoldPoseMoved,
  cancelSketchCameraTween,
  constrainCamera,
  glideCameraHome,
  glideCameraToViewFace,
  orbitCameraByPointerDelta,
  PART_SETTLE_MS,
  rememberCameraHoldPose,
  resetCamera,
  setCameraToViewFace,
  settledPartPose,
  sketch3dHost,
  startCameraTween,
  startSketchCameraTween,
  stopCameraCoast,
  syncViewCube,
  viewCubeFaceFromTarget,
} from "@/components/viewport/camera";
import { createThreeScene } from "@/components/viewport/createThreeScene";
import {
  FACE_SNAP_HOVER_NAME,
  FACE_SNAP_LOCK_NAME,
  faceSnapNormal,
  syncFaceSnapHighlight,
  syncTextureHelper,
  TEXTURE_CHOSEN_NAME,
  TEXTURE_HOVER_NAME,
} from "@/components/viewport/faceSnapHighlight";
import { clearSketchFaceHighlight, raycastSketchFaceHit, syncSketchFaceHighlight } from "@/components/viewport/sketchFaceHighlight";
import {
  cancelScheduledCutPreviewOverlays,
  clearCutPreviewOverlays,
  scheduleCutPreviewOverlays,
  syncCutPreviewOverlays,
} from "@/components/viewport/cutPreview";
import { NO_FACES, NO_IDS, NO_MODIFIER_EDGES, rebuildModifierEdges } from "@/components/viewport/modifierEdges";
import { rebuildPushPullFaces, rebuildPushPullGhost } from "@/components/viewport/pushPullFaces";
import { pickSmoothPoint, rebuildSmoothEditOverlay, smoothPlanePoint, smoothPointsInBox } from "@/components/viewport/smoothEditOverlay";
import {
  pickModelRulerCandidate,
  rulerAttachmentMatchesTopology,
  rulerEdgeMatchesTopology,
  rulerEdgeWorldPoints,
  rulerPointWorld,
  syncRulerOverlay,
} from "@/components/viewport/rulerMeasure";
import { RulerOverlay } from "@/components/viewport/RulerOverlay";
import {
  rebuildSelectionHelpers,
  setSelectionHelpersVisible,
  syncAlignOverlay,
  syncCircularPatternOverlay,
  syncMirrorOverlay,
  syncTransformOverlay,
} from "@/components/viewport/transformOverlaySync";
export { SKETCH_EXTRUDE_PREVIEW_ID } from "@/components/viewport/shapeMotion";
export type { WorkspaceSettings, ViewCubeFace, ThreeState, CaptureSceneImageOptions, ViewportPerfStats, DragState, MarqueeState, RulerPoint, RulerAttachment, RulerEdgeAttachment, RulerSegment, RulerModel, RulerOverlayState, RulerCandidate, RulerPointDragState, RotationHandleSide, RotationHandleSides, ShapeUpdatePatch, ResizeSigns, ResizeAnchorMemory, TransformDragState, TransformDragItem, SelectionFrame, DragItem, SmoothEditOverlay, SmoothPull, RankedRulerPick } from "@/components/viewport/viewportTypes";
/** Last 3D sketch camera, kept when Flat sketch unmounts the viewport so return restores it. */
let rememberedSketchCamera: { planeKey: string; pose: SketchCameraPose } | null = null;

export type WorkplaneViewportProps = {
  shapes: WorkplaneShape[];
  selectedIds: string[];
  alignMode: boolean;
  alignAnchorId: string | null;
  alignHandles: AlignHandleStatus[];
  alignReferenceShapes: WorkplaneShape[];
  mirrorMode: boolean;
  mirrorReferenceShapes: WorkplaneShape[];
  placementRulerMode?: boolean;
  initialSnap?: GridSize;
  initialWorkspace?: WorkplaneWorkspaceSettings;
  workspaceSettingsKey?: string | null;
  onAddShape: (shape: ShapeAsset, point?: { x: number; z: number; elevation?: number }) => void;
  onAlignAnchorChange: (id: string) => void;
  onAlignPreview: (axis: AlignAxis, target: AlignTarget) => void;
  onAlignPreviewClear: () => void;
  onAlignSelection: (axis: AlignAxis, target: AlignTarget) => void;
  onMirrorPreview: (side: MirrorSide) => void;
  onMirrorPreviewClear: () => void;
  onMirrorSelection: (side: MirrorSide) => void;
  circularPatternMode?: boolean;
  circularPatternCenter?: { x: number; z: number } | null;
  circularPatternRadius?: number;
  /** Click on the workplane places the circular pattern center. */
  onCircularPatternCenterPick?: (point: { x: number; z: number }) => void;
  /** Click on a shape during a circular pattern: true when it set the center (its middle). */
  onCircularPatternShapePick?: (shapeId: string) => boolean;
  /** Hide the move/resize handles and size labels, such as while a pattern slider is dragged. */
  transformHandlesHidden?: boolean;
  /** When true, left-click picks a face (or workplane) to start a sketch. */
  sketchFacePickMode?: boolean;
  onSketchPlanePicked?: (plane: SketchPlane) => void;
  /** Called when the user clicks a curved face that cannot host a planar sketch yet. */
  onSketchFacePickRejected?: (reason: string) => void;
  onSketchFacePickCancel?: () => void;
  /** Draw the active sketch on its face while the camera stays free. */
  sketchOnModel?: SketchOnModelSession | null;
  /** Increment to square the camera on the sketch face. */
  sketchFrameRequest?: number;
  /** While an extrude is previewed, the camera swings to a three-quarter view to show its height. */
  sketchExtrudePreview?: { height: number; cut: boolean } | null;
  onSelectShape: (id: string | string[] | null, mode?: "replace" | "toggle") => void;
  onActivatePlacementRuler?: () => void;
  onDeactivatePlacementRuler?: () => void;
  placementRulerCard?: ReactNode;
  onInteractionActiveChange?: (active: boolean) => void;
  /** Fires after the first mesh build, so a project-open wheel can leave the screen. */
  onSceneReady?: () => void;
  onEditSketch?: () => void;
  onEditSketchDimension?: (dimensionId: string, value: number) => void;
  /** Mintr Pro: a top-level part changed in its values or what follows them. */
  onApplyValues?: (nextBody: WorkplaneShape, message: string) => void;
  canSeparateParts?: boolean;
  onSeparateParts?: () => void;
  onMakeMatchingThread?: () => void;
  /** Gridfinity baseplate wider than the printer bed: offer to split it into tabbed pieces. */
  canSplitForPrintBed?: boolean;
  onSplitForPrintBed?: () => void;
  onReduceTriangles?: (keepFraction: number) => void;
  activeFeatureId?: string | null;
  onSelectFeature?: (featureId: string | null) => void;
  modelTreeLocked?: boolean;
  onUpdateFeature?: (featureId: string, patch: ShapeUpdatePatch, options?: ShapeInspectorUpdateOptions) => void;
  onEditPattern?: () => void;
  onDissolvePattern?: () => void;
  onEditEdgeTreatment?: (index: number) => void;
  onRemoveEdgeTreatment?: (index: number) => void;
  onEditPartStep?: (featureId: string, valueMm: number) => void;
  onOpenPartStep?: (featureId: string) => void;
  onTogglePartStep?: (featureId: string) => void;
  onRemovePartStep?: (featureId: string) => void;
  onRemovePartStepsFrom?: (featureId: string) => void;
  laserSource?: { designName: string; missing: boolean; changed: boolean; busy: boolean; onUpdate: () => void } | null;
  /** Smooth card in the inspector, on a Smooth body. */
  smoothControls?: SmoothInspectorControls | null;
  /** Edit points on a Smooth body: the dots to draw and drag. */
  smoothEdit?: SmoothEditOverlay | null;
  onSmoothPointPick?: (index: number | null, additive: boolean) => void;
  onSmoothBoxSelect?: (indices: number[], additive: boolean) => void;
  /** A click on the body while picking a face to keep flat: where, and which way the camera is. */
  onSmoothFacePick?: (spot: [number, number, number], toward: [number, number, number]) => void;
  onSmoothDragStart?: () => void;
  onSmoothDrag?: (delta: SmoothPull) => void;
  onSmoothDragEnd?: (delta: SmoothPull) => void;
  onUpdateShape: (id: string, patch: ShapeUpdatePatch) => void;
  onWorkspaceSettingsChange?: (settings: { workspace: WorkplaneWorkspaceSettings; snap: GridSize }) => void;
  settingsOpen?: boolean;
  /** The Settings tab to open on. */
  settingsSection?: SettingsSectionId;
  onSettingsClose?: () => void;
  /** Machine settings' fit test: adds the comb and key to the design. */
  onAddFitTest?: () => void;
  modifierActive?: boolean;
  /** When true, keep the object selection outline visible while a modifier tool is active. */
  modifierPreserveSelection?: boolean;
  modifierPreviewActive?: boolean;
  modifierEdges?: CadModifierEdge[];
  selectedModifierEdgeIds?: number[];
  onModifierEdgeToggle?: (id: number, singleEdge: boolean) => void;
  pushPullActive?: boolean;
  pushPullFaces?: CadPlanarFace[];
  pushPullHoverFaceId?: number | null;
  pushPullSelectedFaceId?: number | null;
  /** Face tool: faces already set stay highlighted while the next face is chosen. */
  pushPullMarkedFaceIds?: readonly number[];
  pushPullDistance?: number;
  pushPullShowGhost?: boolean;
  pushPullGhostOpacity?: number;
  pushPullChipText?: string | null;
  onPushPullHover?: (faceId: number | null) => void;
  onPushPullDragStart?: (faceId: number, distance: number) => void;
  onPushPullDrag?: (distance: number) => void;
  onPushPullDragEnd?: (distance: number) => void;
  onPushPullDistanceCommit?: (distance: number) => void;
  /** Face tool: a click selects the flat face instead of dragging it. */
  facePickOnly?: boolean;
  onPushPullFacePick?: (faceId: number) => void;
  onPushPullFaceMiss?: () => void;
  viewNudgeAxesRef?: MutableRefObject<ViewNudgeAxes>;
  /** Lets the editor dismiss the degree box (and bake) before toolbar actions. */
  rotationEditApiRef?: MutableRefObject<{ dismiss: () => void } | null>;
  onDropToWorkplane?: () => void;
  dropSurfaceActive?: boolean;
  onDropSurfacePick?: (pick:
    | { kind: "workplane" }
    | { kind: "face"; shapeId: string; point: [number, number, number]; normal: [number, number, number] }
  ) => void;
  sketchGuides?: {
    showGuides: boolean;
    drawAsGuides: boolean;
    onChange: (patch: { showConstruction?: boolean; constructionMode?: boolean }) => void;
  };
  faceSnapActive?: boolean;
  /** The side already chosen. Stays highlighted until the shapes move. */
  faceSnapSource?: { shapeId: string; point: [number, number, number]; normal: [number, number, number] } | null;
  onFaceSnapPick?: (pick: { shapeId: string; point: [number, number, number]; normal: [number, number, number] }) => void;
  /** Move a part into a pose on screen, then call done. Longer moves can rise in an arc on the way. */
  faceSnapMotionRef?: MutableRefObject<((shapeId: string, pose: FaceMatePose, done: () => void, motion?: { durationMs?: number; liftMm?: number }) => void) | null>;
  /**
   * While texturing: the part as it looks with the texture being set up, and what a click on it
   * does. Faces shows the chosen faces and the one under the mouse; place shows a faint copy of
   * the picture where a click would put it, and a drag moves it.
   */
  textureGuide?: { shape: WorkplaneShape; mode: "faces" | "place" } | null;
  /** Scroll over the part while placing a picture. True when it changed the picture, so the view does not zoom. */
  onTextureWheel?: (pick: { shapeId: string; point: [number, number, number]; normal: [number, number, number] }, deltaY: number) => boolean;
  /** Gold plane showing where Split will cut. */
  splitPlane?: {
    origin: [number, number, number];
    normal: [number, number, number];
    width: number;
    height: number;
  } | null;
  /** The part before a Fillet, Chamfer or Push Pull preview, for the inspector's export badge. */
  inspectorBadgeShape?: WorkplaneShape | null;
  /** Floated in the shape-inspector column so width/alignment stay matched. */
  inspectorDock?: ReactNode;
  /** Top of the inspector column (fillet / chamfer panel). */
  inspectorDockTop?: ReactNode;
  /** Pulse mint edges on these bodies after Hollow / Fillet / Boolean apply. */
  applyFlash?: {
    nonce: number;
    ids: string[];
    /** Combine = Group/Tie/Intersect; separate = Ungroup; apply = fillet/hollow. */
    kind?: "apply" | "combine" | "separate";
    edgeWipe?: { polylines: number[][] };
  } | null;
};

export type WorkplaneRotationEditApi = { dismiss: () => void };

export function WorkplaneViewport({
  shapes,
  selectedIds,
  alignMode,
  alignAnchorId,
  alignHandles,
  alignReferenceShapes,
  mirrorMode,
  mirrorReferenceShapes,
  placementRulerMode = false,
  initialSnap,
  initialWorkspace,
  workspaceSettingsKey,
  onAddShape,
  onAlignAnchorChange,
  onAlignPreview,
  onAlignPreviewClear,
  onAlignSelection,
  onMirrorPreview,
  onMirrorPreviewClear,
  onMirrorSelection,
  circularPatternMode = false,
  circularPatternCenter = null,
  circularPatternRadius = 0,
  onCircularPatternCenterPick,
  onCircularPatternShapePick,
  transformHandlesHidden = false,
  sketchFacePickMode = false,
  sketchOnModel = null,
  sketchFrameRequest = 0,
  sketchExtrudePreview = null,
  onSketchPlanePicked,
  onSketchFacePickRejected,
  onSketchFacePickCancel,
  onSelectShape,
  onActivatePlacementRuler,
  onDeactivatePlacementRuler,
  placementRulerCard,
  onInteractionActiveChange,
  onSceneReady,
  onEditSketch,
  onEditSketchDimension,
  onApplyValues,
  canSeparateParts = false,
  onSeparateParts,
  onMakeMatchingThread,
  canSplitForPrintBed = false,
  onSplitForPrintBed,
  onReduceTriangles,
  activeFeatureId = null,
  onSelectFeature,
  modelTreeLocked = false,
  onUpdateFeature,
  onEditPattern,
  onDissolvePattern,
  onEditEdgeTreatment,
  onRemoveEdgeTreatment,
  onEditPartStep,
  onOpenPartStep,
  onTogglePartStep,
  onRemovePartStep,
  onRemovePartStepsFrom,
  laserSource = null,
  smoothControls,
  smoothEdit = null,
  onSmoothPointPick,
  onSmoothBoxSelect,
  onSmoothFacePick,
  onSmoothDragStart,
  onSmoothDrag,
  onSmoothDragEnd,
  onUpdateShape,
  onWorkspaceSettingsChange,
  settingsOpen = false,
  settingsSection,
  onSettingsClose,
  onAddFitTest,
  modifierActive = false,
  modifierPreserveSelection = false,
  modifierPreviewActive = false,
  modifierEdges = NO_MODIFIER_EDGES,
  selectedModifierEdgeIds = NO_IDS,
  onModifierEdgeToggle,
  pushPullActive = false,
  pushPullFaces = NO_FACES,
  pushPullHoverFaceId = null,
  pushPullSelectedFaceId = null,
  pushPullMarkedFaceIds = NO_IDS,
  pushPullDistance = 0,
  pushPullShowGhost = false,
  pushPullGhostOpacity = 1,
  pushPullChipText = null,
  onPushPullHover,
  onPushPullDragStart,
  onPushPullDrag,
  onPushPullDragEnd,
  onPushPullDistanceCommit,
  facePickOnly = false,
  onPushPullFacePick,
  onPushPullFaceMiss,
  viewNudgeAxesRef,
  rotationEditApiRef,
  onDropToWorkplane,
  dropSurfaceActive = false,
  onDropSurfacePick,
  sketchGuides,
  faceSnapActive = false,
  faceSnapSource = null,
  onFaceSnapPick,
  textureGuide = null,
  onTextureWheel,
  splitPlane = null,
  inspectorBadgeShape = null,
  faceSnapMotionRef,
  inspectorDock,
  inspectorDockTop,
  applyFlash = null,
}: WorkplaneViewportProps) {
  const applyFlashRef = useRef(applyFlash);
  applyFlashRef.current = applyFlash;
  const [snapOpen, setSnapOpen] = useState(false);
  const [snap, setSnap] = useState<GridSize>(() => normalizeSnapGrid(initialSnap, DEFAULT_SNAP_GRID));
  const [hotkeys, setHotkeys] = useState(() => loadHotkeyBindings());
  const [workspace, setWorkspace] = useState<WorkspaceSettings>(() => {
    const normalized = normalizeWorkspaceSettings(initialWorkspace);
    setActiveDisplayQuality(normalized.displayQuality);
    return normalized;
  });
  const [transformOverlay, setTransformOverlay] = useState<TransformOverlayState | null>(null);
  const [alignOverlay, setAlignOverlay] = useState<AlignOverlayState | null>(null);
  const [mirrorOverlay, setMirrorOverlay] = useState<MirrorOverlayState | null>(null);
  const [circularPatternOverlay, setCircularPatternOverlay] = useState<CircularPatternOverlayState | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [hoverMeasureKey, setHoverMeasureKey] = useState<string | null>(null);
  const [pinnedMeasureKey, setPinnedMeasureKey] = useState<string | null>(null);
  const [rotationReadout, setRotationReadout] = useState<RotationReadout>(null);
  const [activeRotationWheel, setActiveRotationWheel] = useState(false);
  const [activeTransformKind, setActiveTransformKind] = useState<TransformHandleKind | null>(null);
  const [rotationWheelAxis, setRotationWheelAxis] = useState<RotationAxis>("y");
  const [pinnedRotationWheelView, setPinnedRotationWheelView] = useState<PinnedRotationWheelView | null>(null);
  const [editingDimension, setEditingDimension] = useState<EditingDimension>(null);
  const [editingRotation, setEditingRotation] = useState<EditingRotation>(null);
  const [rulerMode, setRulerMode] = useState(false);
  const [rulerDeleteMode, setRulerDeleteMode] = useState(false);
  const [rulerMoveMode, setRulerMoveMode] = useState(false);
  const [rulerToolsOpen, setRulerToolsOpen] = useState(false);
  const [xrayEnabled, setXrayEnabled] = useState(false);
  const [xrayAxis, setXrayAxis] = useState<XrayAxis>("y");
  const [xrayPosition, setXrayPosition] = useState(10);
  const [xrayKeepLow, setXrayKeepLow] = useState(true);
  // The filled cut shows where the plane is, so the sheet starts hidden.
  const [xrayShowPlane, setXrayShowPlane] = useState(false);
  const [xrayControlsOpen, setXrayControlsOpen] = useState(false);
  const [sectionMeasureLabel, setSectionMeasureLabel] = useState<{ left: number; top: number; text: string } | null>(null);
  const sectionMeasureShownRef = useRef(false);
  const [cameraControlsCollapsed, setCameraControlsCollapsed] = useState(false);
  const [inspectorPanelOpen, setInspectorPanelOpen] = useState(true);
  const [assetDragOver, setAssetDragOver] = useState(false);
  const [rulerModel, setRulerModel] = useState<RulerModel>({ points: [], segments: [], startPointId: null, hover: null });
  const [rulerOverlay, setRulerOverlay] = useState<RulerOverlayState | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<ThreeState | null>(null);
  const onSceneReadyRef = useRef(onSceneReady);
  onSceneReadyRef.current = onSceneReady;
  const orbitingRef = useRef(false);
  const shapeHoverIdRef = useRef<string | null>(null);
  const shapeHoverFrameRef = useRef<number | null>(null);
  const shapeHoverPointRef = useRef({ x: 0, y: 0 });
  const cameraOverlaysHiddenRef = useRef(false);
  const [measurementsConcealed, setMeasurementsConcealed] = useState(false);
  const syncMeasurementsRef = useRef<(() => void) | null>(null);
  const concealMeasurements = useCallback(() => {
    if (cameraOverlaysHiddenRef.current) return;
    cameraOverlaysHiddenRef.current = true;
    flushSync(() => setMeasurementsConcealed(true));
  }, []);
  const revealMeasurements = useCallback(() => {
    const state = threeRef.current;
    if (!state || !cameraOverlaysHiddenRef.current) return;
    stopCameraCoast(state.controls);
    state.camera.updateMatrixWorld();
    cameraOverlaysHiddenRef.current = false;
    state.wasCameraMoving = false;
    state.cameraStillFrames = 0;
    state.cameraOverlayHold = true;
    rememberCameraHoldPose(state);
    flushSync(() => {
      syncMeasurementsRef.current?.();
      setMeasurementsConcealed(false);
    });
    state.needsRender = true;
  }, []);
  const busyLabelRef = useRef<string | null>(null);
  const busyUntilRef = useRef(0);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [gpuFailure, setGpuFailure] = useState<string | null>(null);
  const shapesRef = useRef(shapes);
  const faceSnapActiveRef = useRef(false);
  faceSnapActiveRef.current = faceSnapActive;
  const onFaceSnapPickRef = useRef(onFaceSnapPick);
  onFaceSnapPickRef.current = onFaceSnapPick;
  const dropSurfaceActiveRef = useRef(false);
  dropSurfaceActiveRef.current = dropSurfaceActive;
  const onDropSurfacePickRef = useRef(onDropSurfacePick);
  onDropSurfacePickRef.current = onDropSurfacePick;
  const faceSnapSourceRef = useRef(faceSnapSource);
  faceSnapSourceRef.current = faceSnapSource;
  const textureGuideRef = useRef(textureGuide);
  textureGuideRef.current = textureGuide;
  const onTextureWheelRef = useRef(onTextureWheel);
  onTextureWheelRef.current = onTextureWheel;
  /** The pointer dragging a placed picture, and the last place the mouse was over the view. */
  const textureDragRef = useRef<number | null>(null);
  const textureDragFrameRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const alignReferenceShapesRef = useRef(alignReferenceShapes);
  const mirrorReferenceShapesRef = useRef(mirrorReferenceShapes);
  const selectedIdsRef = useRef(selectedIds);
  const dragRef = useRef<DragState | null>(null);
  const dragMeshFingerprintRef = useRef("");
  const marqueeRef = useRef<MarqueeState | null>(null);
  const transformRef = useRef<TransformDragState | null>(null);
  const lastResizeAnchorRef = useRef<ResizeAnchorMemory | null>(null);
  const lastStackClickRef = useRef<{ time: number; x: number; y: number; selectedId: string; hits: string[] } | null>(null);
  const suppressNextLiftEditRef = useRef(false);
  const suppressNextRotationEditRef = useRef(false);
  const rotationReadoutRef = useRef<RotationReadout>(null);
  /** Shape IDs waiting to bake after a mouse rotate while the degree box is open. */
  const pendingRotationBakeIdsRef = useRef<string[]>([]);
  const pendingRotationBeforeByIdRef = useRef<Record<string, WorkplaneShape>>({});
  const bakePendingRotationsRef = useRef<() => void>(() => {});
  const editingRotationRef = useRef<EditingRotation>(null);
  const snapRef = useRef(snap);
  const workspaceRef = useRef(workspace);
  const workspaceSettingsKeyRef = useRef(workspaceSettingsKey ?? null);
  const lastWorkspaceSettingsSyncRef = useRef("");
  const pendingWorkspaceHydrationFingerprintRef = useRef<string | null>(null);
  const viewCubeRef = useRef<HTMLDivElement | null>(null);
  const viewCubeDragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    dragged: boolean;
    face: ViewCubeFace | null;
    capturer: HTMLElement | null;
  } | null>(null);
  const transformOverlayRef = useRef<TransformOverlayState | null>(null);
  const alignOverlayRef = useRef<AlignOverlayState | null>(null);
  const mirrorOverlayRef = useRef<MirrorOverlayState | null>(null);
  const rulerModeRef = useRef(false);
  const rulerDeleteModeRef = useRef(false);
  const rulerMoveModeRef = useRef(false);
  const rulerPointDragRef = useRef<RulerPointDragState | null>(null);
  const rulerModelRef = useRef(rulerModel);
  const rulerOverlayRef = useRef<RulerOverlayState | null>(null);
  const rulerIdRef = useRef(0);
  const alignModeRef = useRef(alignMode);
  const alignAnchorIdRef = useRef(alignAnchorId);
  const alignHandlesRef = useRef(alignHandles);
  const mirrorModeRef = useRef(mirrorMode);
  const circularPatternModeRef = useRef(circularPatternMode);
  const circularPatternCenterRef = useRef(circularPatternCenter);
  const circularPatternRadiusRef = useRef(circularPatternRadius);
  const onCircularPatternCenterPickRef = useRef(onCircularPatternCenterPick);
  const onCircularPatternShapePickRef = useRef(onCircularPatternShapePick);
  onCircularPatternShapePickRef.current = onCircularPatternShapePick;
  const sketchFacePickModeRef = useRef(sketchFacePickMode);
  const sketchOnModelRef = useRef<SketchOnModelSession | null>(sketchOnModel);
  sketchOnModelRef.current = sketchOnModel;
  const sketch3DPointerRef = useRef<Sketch3DPointerState>(emptySketch3DPointer());
  const [sketchMeasure, setSketchMeasure] = useState<string | null>(null);
  const sketchSizeLayerRef = useRef<HTMLDivElement | null>(null);
  const sketchSizeLive = Boolean(sketchOnModel);
  const publishSketchMeasure = useCallback((session: SketchOnModelSession | null) => {
    const next = session ? sketch3DMeasureLabel(session, sketch3DPointerRef.current) : null;
    setSketchMeasure((current) => (current === next ? current : next));
  }, []);
  useEffect(() => {
    const layer = sketchSizeLayerRef.current;
    if (!sketchSizeLive) {
      if (layer) layer.replaceChildren();
      return;
    }
    let frame = 0;
    const tick = () => {
      frame = window.requestAnimationFrame(tick);
      const host = sketchSizeLayerRef.current;
      const state = threeRef.current;
      const session = sketchOnModelRef.current;
      if (!host || !state || !session) return;
      const callouts = sketch3DSizeCallouts(session, sketch3DPointerRef.current);
      const seen = new Set<string>();
      for (const callout of callouts) {
        seen.add(callout.id);
        const existing = host.querySelector(`[data-callout="${CSS.escape(callout.id)}"]`);
        const node = existing instanceof HTMLDivElement ? existing : document.createElement("div");
        if (!(existing instanceof HTMLDivElement)) {
          node.className = "sketch-size-label";
          node.dataset.callout = callout.id;
          host.appendChild(node);
        }
        if (node.textContent !== callout.text) node.textContent = callout.text;
        const at = projectToCanvasPx(state, sketchUvToWorld(session.plane, callout.u, callout.v));
        const away = projectToCanvasPx(state, sketchUvToWorld(session.plane, callout.u + callout.outU, callout.v + callout.outV));
        let dx = away.x - at.x;
        let dy = away.y - at.y;
        const span = Math.hypot(dx, dy) || 1;
        dx /= span;
        dy /= span;
        node.style.left = `${at.x + dx * 26}px`;
        node.style.top = `${at.y + dy * 18}px`;
      }
      for (const child of [...host.children]) {
        if (!(child instanceof HTMLElement) || !seen.has(child.dataset.callout ?? "")) child.remove();
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      sketchSizeLayerRef.current?.replaceChildren();
    };
  }, [sketchSizeLive]);
  const sketch3DPlaneKeyRef = useRef("");
  const sketchPlaneKeyLiveRef = useRef("");
  const skipSketchFrameOnMountRef = useRef(false);
  const sketchDrawKey = sketchOnModel
    ? [
      sketchOnModel.tool,
      sketchOnModel.activePointId ?? "",
      sketchOnModel.snap,
      sketchOnModel.profile.points.map((point) => `${point.id}:${point.x.toFixed(3)}:${point.z.toFixed(3)}:${point.handleOut?.x ?? ""}`).join(","),
      sketchOnModel.profile.segments.map((segment) => `${segment.id}:${segment.construction ? 1 : 0}:${segment.kind ?? "line"}`).join(","),
      sketchOnModel.profile.faceReferenceLoops?.length ?? 0,
      sketchOnModel.guideGhost?.points.map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`).join(";") ?? "",
      sketchOnModel.offsetGhost?.map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`).join(";") ?? "",
    ].join("|")
    : "";
  const sketchPlaneKey = sketchOnModel
    ? [
      sketchOnModel.plane.origin.x.toFixed(2),
      sketchOnModel.plane.origin.y.toFixed(2),
      sketchOnModel.plane.origin.z.toFixed(2),
      sketchOnModel.plane.normal.x.toFixed(2),
      sketchOnModel.plane.normal.y.toFixed(2),
      sketchOnModel.plane.normal.z.toFixed(2),
      sketchOnModel.plane.surface?.kind ?? "plane",
    ].join("|")
    : "";
  sketchPlaneKeyLiveRef.current = sketchPlaneKey;
  const onSketchPlanePickedRef = useRef(onSketchPlanePicked);
  const onSketchFacePickRejectedRef = useRef(onSketchFacePickRejected);
  const onSketchFacePickCancelRef = useRef(onSketchFacePickCancel);
  const sketchFaceHoverKeyRef = useRef<string | null>(null);
  const [sketchFaceHovering, setSketchFaceHovering] = useState(false);
  const [sketchFaceHoverBlocked, setSketchFaceHoverBlocked] = useState(false);
  const circularPatternOverlayRef = useRef<CircularPatternOverlayState | null>(null);
  const modifierActiveRef = useRef(modifierActive);
  const modifierPreserveSelectionRef = useRef(modifierPreserveSelection);
  const modifierPreviewActiveRef = useRef(modifierPreviewActive);
  modifierPreviewActiveRef.current = modifierPreviewActive;
  const modifierEdgesRef = useRef(modifierEdges);
  const [hoverModifierEdgeId, setHoverModifierEdgeId] = useState<number | null>(null);
  const pushPullActiveRef = useRef(pushPullActive);
  const smoothEditRef = useRef(smoothEdit);
  smoothEditRef.current = smoothEdit;
  const smoothCallbacksRef = useRef({ onSmoothPointPick, onSmoothBoxSelect, onSmoothFacePick, onSmoothDragStart, onSmoothDrag, onSmoothDragEnd });
  smoothCallbacksRef.current = { onSmoothPointPick, onSmoothBoxSelect, onSmoothFacePick, onSmoothDragStart, onSmoothDrag, onSmoothDragEnd };
  const smoothBoxRef = useRef<{ pointerId: number; startX: number; startY: number; currentX: number; currentY: number; additive: boolean } | null>(null);
  const smoothDragRef = useRef<{
    pointerId: number;
    plane: THREE.Plane;
    start: THREE.Vector3;
    /** Set: the pull goes straight in or out along this, measured along `measure`. */
    out: { measure: THREE.Vector3; sign: number } | null;
    delta: SmoothPull;
  } | null>(null);
  const pushPullFacesRef = useRef(pushPullFaces);
  const pushPullSelectedFaceIdRef = useRef(pushPullSelectedFaceId);
  const pushPullDistanceRef = useRef(pushPullDistance);
  const pushPullDragRef = useRef<{
    faceId: number;
    pointerId: number;
    startPx: { x: number; y: number };
    axis: PushPullScreenAxis;
  } | null>(null);
  const onPushPullHoverRef = useRef(onPushPullHover);
  const onPushPullDragStartRef = useRef(onPushPullDragStart);
  const onPushPullDragRef = useRef(onPushPullDrag);
  const onPushPullDragEndRef = useRef(onPushPullDragEnd);
  const facePickOnlyRef = useRef(facePickOnly);
  const onPushPullFacePickRef = useRef(onPushPullFacePick);
  const onPushPullFaceMissRef = useRef(onPushPullFaceMiss);
  const [pushPullChipScreen, setPushPullChipScreen] = useState<{ x: number; y: number } | null>(null);
  const [pushPullChipEditing, setPushPullChipEditing] = useState(false);
  const [pushPullChipDraft, setPushPullChipDraft] = useState("");
  const [pushPullDragging, setPushPullDragging] = useState(false);
  const selectedIdsKeyRef = useRef(selectedIds.join("|"));
  const perfRef = useRef({
    fps: 0,
    frameMs: 0,
    maxFrameMs: 0,
    frames: 0,
    lastSample: 0,
  });

  // During circular pattern, viewport `shapes` are preview instances. Prefer the
  // document shapes so Properties edits resize the real source (preview rebuilds from that).
  const selectedShape = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    const id = selectedIds[0];
    if (circularPatternMode) {
      const documentShape = alignReferenceShapes.find((shape) => shape.id === id);
      if (documentShape) return documentShape;
    }
    return shapes.find((shape) => shape.id === id) ?? null;
  }, [alignReferenceShapes, circularPatternMode, selectedIds, shapes]);
  const renderSelectionIds = useCallback(
    (ids = selectedIdsRef.current) => (
      modifierActiveRef.current && !modifierPreviewActiveRef.current && !modifierPreserveSelectionRef.current
        ? []
        : ids
    ),
    [],
  );

  const cancelActiveInteraction = useCallback(
    (selectionIds = selectedIdsRef.current) => {
      const hadInteraction = Boolean(transformRef.current || dragRef.current || marqueeRef.current);
      const drag = dragRef.current;
      transformRef.current = null;
      dragRef.current = null;
      marqueeRef.current = null;
      rulerPointDragRef.current = null;
      setMarqueeRect(null);
      setActiveTransformKind(null);
      setActiveRotationWheel(false);
      setPinnedRotationWheelView(null);
      setRotationReadout(null);
      const state = threeRef.current;
      if (drag?.shadowsHidden) restoreDragShadows(state, drag);
      if (state) {
        rebuildShapes(state, shapesRef.current, renderSelectionIds(selectionIds));
        setSelectionHelpersVisible(state, true);
        state.controls.enabled = true;
        state.needsRender = true;
      }
      if (hadInteraction) {
        onInteractionActiveChange?.(false);
      }
    },
    [onInteractionActiveChange, renderSelectionIds],
  );

  useEffect(() => {
    modifierEdgesRef.current = modifierEdges;
    if (threeRef.current) {
      threeRef.current.modifierEdgeSource = modifierEdges;
      threeRef.current.modifierEdgeSelectedIds = selectedModifierEdgeIds;
      threeRef.current.modifierEdgeHoverId = hoverModifierEdgeId;
    }
    rebuildModifierEdges(threeRef.current, modifierEdges, selectedModifierEdgeIds, modifierPreviewActive, hoverModifierEdgeId);
  }, [hoverModifierEdgeId, modifierEdges, modifierPreviewActive, selectedModifierEdgeIds]);

  // The editor hands over fresh handler functions on every render. Keeping them in refs
  // here means only real changes to the faces below rebuild anything or redraw the view.
  useEffect(() => {
    onPushPullHoverRef.current = onPushPullHover;
    onPushPullDragStartRef.current = onPushPullDragStart;
    onPushPullDragRef.current = onPushPullDrag;
    onPushPullDragEndRef.current = onPushPullDragEnd;
    onPushPullFacePickRef.current = onPushPullFacePick;
    onPushPullFaceMissRef.current = onPushPullFaceMiss;
  });

  useEffect(() => {
    if (pushPullActive) cancelActiveInteraction();
  }, [cancelActiveInteraction, pushPullActive]);

  useEffect(() => {
    rebuildSmoothEditOverlay(threeRef.current, smoothEdit);
    // The move and resize handles would fight the points, so they hide while editing.
    setSelectionHelpersVisible(threeRef.current, !smoothEdit);
  }, [smoothEdit]);

  useEffect(() => {
    pushPullActiveRef.current = pushPullActive;
    pushPullFacesRef.current = pushPullFaces;
    pushPullSelectedFaceIdRef.current = pushPullSelectedFaceId;
    pushPullDistanceRef.current = pushPullDistance;
    facePickOnlyRef.current = facePickOnly;
    rebuildPushPullFaces(threeRef.current, pushPullFaces, pushPullHoverFaceId, pushPullSelectedFaceId, pushPullMarkedFaceIds);
    rebuildPushPullGhost(threeRef.current, pushPullFaces, pushPullSelectedFaceId, pushPullDistance, pushPullShowGhost, pushPullGhostOpacity);
    const state = threeRef.current;
    const face = pushPullFaces.find((entry) => entry.id === pushPullSelectedFaceId);
    if (state && face && Math.abs(pushPullDistance) > 1e-4) {
      const world = pushPullChipWorld(face, pushPullDistance);
      const screen = projectToScreen(new THREE.Vector3(world.x, world.y, world.z), state);
      setPushPullChipScreen({ x: screen.x, y: screen.y - 18 });
    } else {
      setPushPullChipScreen(null);
    }
    if (state && (pushPullActive || face)) state.needsRender = true;
  }, [facePickOnly, pushPullActive, pushPullDistance, pushPullFaces, pushPullGhostOpacity, pushPullHoverFaceId, pushPullMarkedFaceIds, pushPullSelectedFaceId, pushPullShowGhost]);

  const placementRulerModeRef = useRef(placementRulerMode);
  const [objectSnapGuide, setObjectSnapGuide] = useState<ObjectSnapResult | null>(null);

  const rememberResizeAnchor = useCallback((shapeId: string, kind: TransformHandleKind, handleKey: string) => {
    if (kind === "scale") {
      const signs = resizeSignsForHandle(handleKey);
      if (signs.x || signs.z) {
        lastResizeAnchorRef.current = { shapeId, handleKey, signs, pressedY: null };
      }
      return;
    }
    if (kind === "height") {
      lastResizeAnchorRef.current = {
        shapeId,
        handleKey,
        signs: { x: 0, z: 0 },
        pressedY: handleKey === "bottom-height" ? "bottom" : "top",
      };
    }
  }, []);

  const applyWorkspaceSettings = useCallback((nextWorkspace: WorkplaneWorkspaceSettings, nextSnap = snapRef.current) => {
    const normalizedWorkspace = normalizeWorkspaceSettings(nextWorkspace);
    const normalizedSnap = normalizeSnapGrid(nextSnap, DEFAULT_SNAP_GRID);
    const fingerprint = workplaneSettingsFingerprint(normalizedWorkspace, normalizedSnap);
    const qualityChanged = workspaceRef.current.displayQuality !== normalizedWorkspace.displayQuality;
    pendingWorkspaceHydrationFingerprintRef.current = null;
    lastWorkspaceSettingsSyncRef.current = fingerprint;
    snapRef.current = normalizedSnap;
    workspaceRef.current = normalizedWorkspace;
    setActiveDisplayQuality(normalizedWorkspace.displayQuality);
    if (threeRef.current) {
      rebuildWorkplane(threeRef.current, normalizedWorkspace);
      if (qualityChanged) {
        rebuildShapes(threeRef.current, shapesRef.current, renderSelectionIds(), !transformRef.current && !dragRef.current);
      }
      constrainCamera(threeRef.current, normalizedWorkspace);
      threeRef.current.needsRender = true;
    }
    setSnap((current) => (current === normalizedSnap ? current : normalizedSnap));
    setWorkspace((current) => (
      workplaneSettingsFingerprint(current, normalizedSnap) === fingerprint ? current : normalizedWorkspace
    ));
    // The unsaved editor reloads this blob whenever the viewport remounts (for
    // example after leaving a sketch). Keep the live settings in it.
    if (workspaceSettingsKeyRef.current === "local-workplane") {
      try {
        window.localStorage.setItem(
          `${WORKSPACE_DEFAULTS_STORAGE_PREFIX}local-workplane`,
          JSON.stringify({ workspace: normalizedWorkspace, snap: normalizedSnap }),
        );
      } catch {
        // The in-memory settings still apply until the page reloads.
      }
    }
    onWorkspaceSettingsChange?.({ workspace: normalizedWorkspace, snap: normalizedSnap });
  }, [onWorkspaceSettingsChange]);

  useLayoutEffect(() => {
    const nextKey = workspaceSettingsKey ?? null;
    const keyChanged = workspaceSettingsKeyRef.current !== nextKey;
    if (keyChanged) {
      workspaceSettingsKeyRef.current = nextKey;
      lastWorkspaceSettingsSyncRef.current = "";
    }
    const shouldUseSavedDefault = nextKey === "local-workplane" || (initialSnap === undefined && initialWorkspace === undefined);
    const savedDefault = shouldUseSavedDefault ? readSavedWorkspaceDefault(nextKey) : null;
    const nextSnap = savedDefault?.snap ?? normalizeSnapGrid(initialSnap, DEFAULT_SNAP_GRID);
    const nextWorkspace = savedDefault?.workspace ?? normalizeWorkspaceSettings(initialWorkspace);
    const nextFingerprint = workplaneSettingsFingerprint(nextWorkspace, nextSnap);
    const currentFingerprint = workplaneSettingsFingerprint(workspaceRef.current, snapRef.current);
    // Ignore unchanged prop echoes. Also ignore stale parent props while local
    // settings are ahead (dimension edits used to get wiped on the next parent render).
    if (nextFingerprint === currentFingerprint) {
      lastWorkspaceSettingsSyncRef.current = nextFingerprint;
      pendingWorkspaceHydrationFingerprintRef.current = null;
      return;
    }
    if (!keyChanged && lastWorkspaceSettingsSyncRef.current === currentFingerprint) {
      return;
    }
    // Prop hydration must not echo back to the parent. Parent persistence creates
    // new object references even when the values are unchanged, which previously
    // caused this effect and its callback effect to update each other indefinitely.
    lastWorkspaceSettingsSyncRef.current = nextFingerprint;
    pendingWorkspaceHydrationFingerprintRef.current = nextFingerprint;
    snapRef.current = nextSnap;
    workspaceRef.current = nextWorkspace;
    setActiveDisplayQuality(nextWorkspace.displayQuality);
    if (threeRef.current) {
      rebuildWorkplane(threeRef.current, nextWorkspace);
      rebuildShapes(threeRef.current, shapesRef.current, renderSelectionIds(), !transformRef.current && !dragRef.current);
      constrainCamera(threeRef.current, nextWorkspace);
      threeRef.current.needsRender = true;
    }
    setSnap((current) => (current === nextSnap ? current : nextSnap));
    setWorkspace((current) => (
      workplaneSettingsFingerprint(current, nextSnap) === nextFingerprint ? current : nextWorkspace
    ));
  }, [initialSnap, initialWorkspace, workspaceSettingsKey]);

  useEffect(() => {
    const normalizedWorkspace = normalizeWorkspaceSettings(workspace);
    const normalizedSnap = normalizeSnapGrid(snap, DEFAULT_SNAP_GRID);
    const fingerprint = workplaneSettingsFingerprint(normalizedWorkspace, normalizedSnap);
    const hydrationDecision = workspaceHydrationSyncDecision(pendingWorkspaceHydrationFingerprintRef.current, fingerprint);
    pendingWorkspaceHydrationFingerprintRef.current = hydrationDecision.pendingFingerprint;
    if (!hydrationDecision.shouldSync) {
      return;
    }
    if (lastWorkspaceSettingsSyncRef.current === fingerprint) {
      return;
    }
    lastWorkspaceSettingsSyncRef.current = fingerprint;
    onWorkspaceSettingsChange?.({ workspace: normalizedWorkspace, snap: normalizedSnap });
  }, [onWorkspaceSettingsChange, snap, workspace]);

  const makeWorkspaceDefault = useCallback(() => {
    const normalizedWorkspace = normalizeWorkspaceSettings(workspace);
    const normalizedSnap = normalizeSnapGrid(snap, DEFAULT_SNAP_GRID);
    const key = workspaceSettingsKeyRef.current;
    if (key) {
      try {
        window.localStorage.setItem(
          `${WORKSPACE_DEFAULTS_STORAGE_PREFIX}${key}`,
          JSON.stringify({ workspace: normalizedWorkspace, snap: normalizedSnap }),
        );
      } catch {
        // Project persistence below is still attempted if browser storage is unavailable.
      }
    }
    saveGlobalWorkspaceDefaults(normalizedWorkspace, normalizedSnap);
    applyWorkspaceSettings(normalizedWorkspace, normalizedSnap);
  }, [applyWorkspaceSettings, snap, workspace]);

  useEffect(() => {
    const refreshHotkeys = () => setHotkeys(loadHotkeyBindings());
    window.addEventListener(HOTKEYS_CHANGED_EVENT, refreshHotkeys);
    return () => window.removeEventListener(HOTKEYS_CHANGED_EVENT, refreshHotkeys);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const stored = window.localStorage.getItem("peakcad:shape-inspector-open");
      if (stored === "0") {
        setInspectorPanelOpen(false);
      }
    } catch {
      // Ignore storage read failures.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem("peakcad:shape-inspector-open", inspectorPanelOpen ? "1" : "0");
    } catch {
      // Ignore storage write failures.
    }
  }, [inspectorPanelOpen]);

  useEffect(() => {
    shapesRef.current = shapes;
    const dragging = Boolean(dragRef.current) && !transformRef.current;
    const meshFingerprint = shapesInteractionFingerprint(shapes);
    if (dragging && meshFingerprint === dragMeshFingerprintRef.current) {
      refreshDragPreviewObjects(threeRef.current, dragRef.current);
    } else {
      dragMeshFingerprintRef.current = meshFingerprint;
      const flash = applyFlashRef.current;
      const wipe = flash?.edgeWipe;
      const freshFlash = flash != null && flash.nonce !== consumedFlashNonce && flash.ids.length > 0;
      pendingEdgeWipe = wipe && freshFlash && !prefersReducedMotion()
        ? { ids: new Set(flash.ids), polylines: wipe.polylines }
        : null;
      pendingScaleIntro = freshFlash && (flash.kind === "combine" || flash.kind === "separate") && !wipe && !prefersReducedMotion()
        ? { ids: new Set(flash.ids), startScale: flash.kind === "separate" ? SEPARATE_START_SCALE : COMBINE_START_SCALE }
        : null;
      if (freshFlash) consumedFlashNonce = flash.nonce;
      if (threeRef.current) threeRef.current.modifierPreviewActive = modifierPreviewActiveRef.current;
      rebuildShapes(threeRef.current, shapes, renderSelectionIds(), !transformRef.current && !dragRef.current);
      pendingEdgeWipe = null;
      pendingScaleIntro = null;
      refreshDragPreviewObjects(threeRef.current, dragRef.current);
    }
    if (threeRef.current) {
      syncTransformOverlay(
        threeRef.current,
        previewShapesForDrag(shapes, dragRef.current),
        selectedIdsRef.current,
        transformOverlayRef,
        setTransformOverlay,
        workspaceRef.current,
        Boolean(transformRef.current || dragRef.current),
      );
      syncAlignOverlay(threeRef.current, alignReferenceShapesRef.current, selectedIdsRef.current, alignModeRef.current, alignAnchorIdRef.current, alignHandlesRef.current, alignOverlayRef, setAlignOverlay);
      syncMirrorOverlay(threeRef.current, mirrorReferenceShapesRef.current, selectedIdsRef.current, mirrorModeRef.current, mirrorOverlayRef, setMirrorOverlay);
      threeRef.current.needsRender = true;
    }
  }, [shapes]);

  // Orange wireframe around the active CSG child (Alt-click / Features list).
  useEffect(() => {
    const state = threeRef.current;
    if (!state) return;
    const existing = state.helperLayer.getObjectByName("csg-feature-highlight");
    if (existing) {
      state.helperLayer.remove(existing);
      existing.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          const material = obj.material;
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
          else material.dispose();
        }
      });
    }
    if (!activeFeatureId) {
      state.needsRender = true;
      return;
    }
    // The part may sit at any depth (the Parts tree reaches nested groups), so it is placed in the
    // world the way the group restores it, and holes are outlined like solids.
    const body = shapesRef.current.find((shape) => shape.id !== activeFeatureId && csgTreeContainsId(shape, activeFeatureId));
    const feature = body ? worldPoseOfPartInBody(body, activeFeatureId) : null;
    if (!body || !feature) {
      state.needsRender = true;
      return;
    }
    const width = Math.max(MIN_SHAPE_SIZE, shapeWidth(feature));
    const depth = Math.max(MIN_SHAPE_SIZE, shapeDepth(feature));
    const height = Math.max(MIN_SHAPE_SIZE, feature.height);
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const edges = new THREE.EdgesGeometry(geometry);
    geometry.dispose();
    const material = new THREE.LineBasicMaterial({ color: feature.hole ? 0x8f4a4a : 0xc45c26, transparent: true, opacity: 0.95 });
    const lines = new THREE.LineSegments(edges, material);
    lines.position.set(feature.x, (feature.elevation ?? 0) + height / 2, feature.z);
    lines.rotation.set(
      THREE.MathUtils.degToRad(feature.rotationX ?? 0),
      THREE.MathUtils.degToRad(feature.rotation ?? 0),
      THREE.MathUtils.degToRad(feature.rotationZ ?? 0),
      "XYZ",
    );
    const group = new THREE.Group();
    group.name = "csg-feature-highlight";
    group.add(lines);
    state.helperLayer.add(group);
    state.needsRender = true;
    return () => {
      const current = state.helperLayer.getObjectByName("csg-feature-highlight");
      if (!current) return;
      state.helperLayer.remove(current);
      current.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          const materialEntry = obj.material;
          if (Array.isArray(materialEntry)) materialEntry.forEach((entry) => entry.dispose());
          else materialEntry.dispose();
        }
      });
      state.needsRender = true;
    };
  }, [activeFeatureId, shapes]);

  useEffect(() => {
    alignReferenceShapesRef.current = alignReferenceShapes;
    if (threeRef.current) {
      syncAlignOverlay(threeRef.current, alignReferenceShapes, selectedIdsRef.current, alignModeRef.current, alignAnchorIdRef.current, alignHandlesRef.current, alignOverlayRef, setAlignOverlay);
      threeRef.current.needsRender = true;
    }
  }, [alignReferenceShapes]);

  useEffect(() => {
    mirrorReferenceShapesRef.current = mirrorReferenceShapes;
    if (threeRef.current) {
      syncMirrorOverlay(threeRef.current, mirrorReferenceShapes, selectedIdsRef.current, mirrorModeRef.current, mirrorOverlayRef, setMirrorOverlay);
      threeRef.current.needsRender = true;
    }
  }, [mirrorReferenceShapes]);

  useEffect(() => {
    rotationReadoutRef.current = rotationReadout;
  }, [rotationReadout]);

  useEffect(() => {
    editingRotationRef.current = editingRotation;
  }, [editingRotation]);

  useEffect(() => {
    const nextSelectedIdsKey = selectedIds.join("|");
    if (nextSelectedIdsKey !== selectedIdsKeyRef.current) {
      selectedIdsKeyRef.current = nextSelectedIdsKey;
      lastResizeAnchorRef.current = null;
      setHoverMeasureKey(null);
      setPinnedMeasureKey(null);
      setEditingDimension(null);
      // Bake any deferred post-drag rotation before the degree box goes away with selection.
      bakePendingRotationsRef.current();
      setEditingRotation(null);
      setRotationReadout(null);
      setActiveRotationWheel(false);
      setActiveTransformKind(null);
    }
    if (selectedIds.length === 0 && (transformRef.current || dragRef.current || marqueeRef.current)) {
      cancelActiveInteraction([]);
    }
    selectedIdsRef.current = selectedIds;
    rebuildShapes(threeRef.current, shapesRef.current, renderSelectionIds(selectedIds), !transformRef.current && !dragRef.current);
    if (shapeHoverIdRef.current && selectedIds.includes(shapeHoverIdRef.current)) {
      shapeHoverIdRef.current = null;
    }
    if (threeRef.current) showShapeHoverOutline(threeRef.current, shapeHoverIdRef.current);
    refreshDragPreviewObjects(threeRef.current, dragRef.current);
    if (threeRef.current) {
      syncTransformOverlay(
        threeRef.current,
        previewShapesForDrag(shapesRef.current, dragRef.current),
        selectedIds,
        transformOverlayRef,
        setTransformOverlay,
        workspaceRef.current,
        Boolean(transformRef.current || dragRef.current),
      );
      syncAlignOverlay(threeRef.current, alignReferenceShapesRef.current, selectedIds, alignModeRef.current, alignAnchorIdRef.current, alignHandlesRef.current, alignOverlayRef, setAlignOverlay);
      syncMirrorOverlay(threeRef.current, mirrorReferenceShapesRef.current, selectedIds, mirrorModeRef.current, mirrorOverlayRef, setMirrorOverlay);
      threeRef.current.needsRender = true;
    }
  }, [cancelActiveInteraction, selectedIds]);

  useEffect(() => {
    if (!applyFlash?.ids.length || !threeRef.current) return;
    if (applyFlash.edgeWipe) return;
    startApplyFlash(threeRef.current, applyFlash.ids);
  }, [applyFlash]);

  // A texture finishes building in the background; show it as soon as it is ready.
  useEffect(() => onSurfaceTextureReady(() => {
    rebuildShapes(threeRef.current, shapesRef.current, renderSelectionIds(), !transformRef.current && !dragRef.current);
    if (threeRef.current) threeRef.current.needsRender = true;
  }), [renderSelectionIds]);

  useEffect(() => {
    modifierActiveRef.current = modifierActive;
    modifierPreserveSelectionRef.current = modifierPreserveSelection;
    if (modifierActive) cancelActiveInteraction();
    if (!modifierActive) setHoverModifierEdgeId(null);
    rebuildShapes(threeRef.current, shapesRef.current, renderSelectionIds(), !transformRef.current && !dragRef.current);
    if (threeRef.current) threeRef.current.needsRender = true;
  }, [cancelActiveInteraction, modifierActive, modifierPreserveSelection, renderSelectionIds]);

  useEffect(() => {
    modifierPreviewActiveRef.current = modifierPreviewActive;
    if (threeRef.current) threeRef.current.modifierPreviewActive = modifierPreviewActive;
    rebuildShapes(threeRef.current, shapesRef.current, renderSelectionIds(), !transformRef.current && !dragRef.current);
    if (threeRef.current) threeRef.current.needsRender = true;
  }, [modifierPreviewActive, renderSelectionIds]);

  useEffect(() => {
    if (hoverModifierEdgeId !== null && !modifierEdges.some((edge) => edge.id === hoverModifierEdgeId)) {
      setHoverModifierEdgeId(null);
    }
  }, [hoverModifierEdgeId, modifierEdges]);

  useEffect(() => {
    alignModeRef.current = alignMode;
    alignAnchorIdRef.current = alignAnchorId;
    alignHandlesRef.current = alignHandles;
    if (alignMode) cancelActiveInteraction();
    if (threeRef.current) {
      syncAlignOverlay(threeRef.current, alignReferenceShapesRef.current, selectedIdsRef.current, alignMode, alignAnchorId, alignHandles, alignOverlayRef, setAlignOverlay);
      threeRef.current.needsRender = true;
    }
  }, [alignAnchorId, alignHandles, alignMode, cancelActiveInteraction]);

  useEffect(() => {
    mirrorModeRef.current = mirrorMode;
    if (mirrorMode) cancelActiveInteraction();
    if (threeRef.current) {
      syncMirrorOverlay(threeRef.current, mirrorReferenceShapesRef.current, selectedIdsRef.current, mirrorMode, mirrorOverlayRef, setMirrorOverlay);
      threeRef.current.needsRender = true;
    }
  }, [cancelActiveInteraction, mirrorMode]);

  const wasCircularPatternModeRef = useRef(false);
  useEffect(() => {
    circularPatternModeRef.current = circularPatternMode;
    onCircularPatternCenterPickRef.current = onCircularPatternCenterPick;
    // Cancel only on enter — preview/radius rebuilds must not kill Properties or gizmos.
    if (circularPatternMode && !wasCircularPatternModeRef.current) {
      cancelActiveInteraction();
    }
    wasCircularPatternModeRef.current = circularPatternMode;
  }, [cancelActiveInteraction, circularPatternMode, onCircularPatternCenterPick]);

  useEffect(() => {
    circularPatternCenterRef.current = circularPatternCenter;
    circularPatternRadiusRef.current = circularPatternRadius;
    if (threeRef.current) {
      syncCircularPatternOverlay(
        threeRef.current,
        circularPatternMode,
        circularPatternCenter,
        circularPatternRadius,
        circularPatternOverlayRef,
        setCircularPatternOverlay,
      );
      threeRef.current.needsRender = true;
    }
  }, [circularPatternCenter, circularPatternMode, circularPatternRadius]);

  useEffect(() => {
    onSketchPlanePickedRef.current = onSketchPlanePicked;
    onSketchFacePickRejectedRef.current = onSketchFacePickRejected;
    onSketchFacePickCancelRef.current = onSketchFacePickCancel;
  }, [onSketchFacePickCancel, onSketchFacePickRejected, onSketchPlanePicked]);

  useEffect(() => {
    sketchFacePickModeRef.current = sketchFacePickMode;
    if (sketchFacePickMode) {
      cancelActiveInteraction();
      return;
    }
    sketchFaceHoverKeyRef.current = null;
    setSketchFaceHovering((current) => (current ? false : current));
    setSketchFaceHoverBlocked((current) => (current ? false : current));
    clearSketchFaceHighlight(threeRef.current);
  }, [cancelActiveInteraction, sketchFacePickMode]);

  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  useEffect(() => {
    rulerModeRef.current = rulerMode;
    if (rulerMode) cancelActiveInteraction();
  }, [cancelActiveInteraction, rulerMode]);

  useEffect(() => {
    rulerDeleteModeRef.current = rulerDeleteMode;
  }, [rulerDeleteMode]);

  useEffect(() => {
    rulerMoveModeRef.current = rulerMoveMode;
  }, [rulerMoveMode]);

  useEffect(() => {
    rulerModelRef.current = rulerModel;
    if (threeRef.current) {
      syncRulerOverlay(threeRef.current, rulerModel, rulerOverlayRef, setRulerOverlay, workspaceRef.current);
      threeRef.current.needsRender = true;
    }
  }, [rulerModel]);

  useEffect(() => {
    placementRulerModeRef.current = placementRulerMode;
  }, [placementRulerMode]);

  useEffect(() => {
    workspaceRef.current = workspace;
    const wasLaserDesign = threeRef.current?.laserDesign;
    rebuildWorkplane(threeRef.current, workspace);
    // The job marks belong to each part, so parts redraw when a design becomes laser or print.
    if (threeRef.current && wasLaserDesign !== threeRef.current.laserDesign) {
      rebuildShapes(threeRef.current, shapesRef.current, renderSelectionIds());
    }
    if (threeRef.current) {
      syncTransformOverlay(
        threeRef.current,
        shapesRef.current,
        selectedIdsRef.current,
        transformOverlayRef,
        setTransformOverlay,
        workspace,
        Boolean(transformRef.current || dragRef.current),
      );
      syncRulerOverlay(threeRef.current, rulerModelRef.current, rulerOverlayRef, setRulerOverlay, workspace);
      threeRef.current.needsRender = true;
    }
  }, [workspace]);

  useEffect(() => {
    const onThemeChange = () => {
      rebuildWorkplane(threeRef.current, workspaceRef.current);
      if (threeRef.current) threeRef.current.needsRender = true;
    };
    window.addEventListener(UI_THEME_CHANGED_EVENT, onThemeChange);
    return () => window.removeEventListener(UI_THEME_CHANGED_EVENT, onThemeChange);
  }, []);

  useEffect(() => {
    setSelectionHelpersVisible(threeRef.current, activeTransformKind !== "rotate");
  }, [activeTransformKind]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let state: ThreeState;
    try {
      state = createThreeScene(host);
    } catch (error) {
      // No WebGL (remote desktop, disabled GPU, broken driver). Without this the
      // editor shows a blank panel forever with the error only in the console.
      setGpuFailure(
        error instanceof Error && /webgl|context/i.test(error.message)
          ? "Mintr couldn't start 3D graphics. Check that hardware acceleration is enabled, update your graphics driver, then reopen Mintr."
          : "Mintr couldn't start the 3D viewport. Update your graphics driver and reopen Mintr.",
      );
      return;
    }
    setGpuFailure(null);
    threeRef.current = state;
    const onContextLost = () => {
      setGpuFailure("The graphics driver reset. Save your work, then reopen Mintr to restore the viewport.");
    };
    const onContextRestored = () => setGpuFailure(null);
    state.renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    state.renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);
    rebuildWorkplane(state, workspaceRef.current);
    window.sketchforgeCaptureCanvas = (options) => captureSceneImage(state, options);
    window.sketchforgeCaptureProjectThumbnails = (options) => {
      try {
        return captureSceneImagesForThemes(state, workspaceRef.current.background, options);
      } catch {
        return null;
      }
    };
    window.sketchforgeCaptureView = (face = "current") => {
      if (face === "home") {
        resetCamera(state);
      } else if (face !== "current") {
        setCameraToViewFace(state, face);
      }
      syncViewCube(state, viewCubeRef.current);
      return captureSceneImage(state);
    };
    perfRef.current.lastSample = performance.now();
    const resumeKey = sketchPlaneKeyLiveRef.current;
    const resume = resumeKey && rememberedSketchCamera?.planeKey === resumeKey ? rememberedSketchCamera.pose : null;
    if (resume) {
      applyRememberedSketchCamera(state, resume);
      sketch3DPlaneKeyRef.current = resumeKey;
      skipSketchFrameOnMountRef.current = true;
    } else {
      resetCamera(state);
    }
    if (viewNudgeAxesRef) {
      viewNudgeAxesRef.current = computeViewNudgeAxes(state.camera);
    }
    rebuildShapes(state, shapesRef.current, renderSelectionIds());
    markShadowsDirty(state);
    onSceneReadyRef.current?.();

    const onCameraPointerDown = (event: PointerEvent) => {
      const cameraDrag = event.button === 2 || event.button === 1 || (event.button === 0 && (event.ctrlKey || event.metaKey));
      if (!cameraDrag) return;
      concealMeasurements();
      cancelScheduledCutPreviewOverlays();
      if (state.printLayer.children.length > 0) {
        state.printLayer.visible = false;
        state.needsRender = true;
      }
      if (!isHeavyDisplayScene(shapesRef.current)) return;
      orbitingRef.current = true;
      busyUntilRef.current = performance.now() + 4000;
      if (busyLabelRef.current !== "Moving view…") {
        busyLabelRef.current = "Moving view…";
        setBusyLabel("Moving view…");
      }
    };
    const onCameraPointerUp = (event: PointerEvent) => {
      if (event.button !== 2 && event.button !== 1 && event.button !== 0) return;
      revealMeasurements();
      orbitingRef.current = false;
      busyUntilRef.current = performance.now() + 400;
      const showPrint = state.showOverhangStripes || state.showThinWalls || state.showSmallHoles || state.showTrappedResin;
      if (showPrint && state.printLayer.children.length > 0) {
        state.printLayer.visible = true;
        state.needsRender = true;
      }
    };
    state.renderer.domElement.addEventListener("pointerdown", onCameraPointerDown);
    state.renderer.domElement.addEventListener("pointerup", onCameraPointerUp);

    const animate = () => {
      state.animationId = window.requestAnimationFrame(animate);
      const now = performance.now();
      // The sketch tween owns the camera. OrbitControls.update() would apply leftover
      // spherical delta / damping and yank the pose back toward the pre-sketch orbit.
      const controlsChanged = state.cameraTween ? false : state.controls.update();
      if (tickTextureRise(now)) state.needsRender = true;
      // Stay in the loop for the still frame that republishes the overlays.
      // That frame has no controls change, but the camera move has not been cleared yet.
      if (!controlsChanged && !state.needsRender && !state.wasCameraMoving) {
        if (busyLabelRef.current && !orbitingRef.current && now > busyUntilRef.current) {
          busyLabelRef.current = null;
          setBusyLabel(null);
        }
        return;
      }
      if (!state.cameraTween) constrainCamera(state, workspaceRef.current);
      // Future edits: keep this before any view cube or transform-overlay projection.
      // OrbitControls changes camera position/quaternion, but manual Vector3.project()
      // can read the previous matrix unless we force the matrix world current here.
      // Removing this brings back the one-frame-late handle/line lag during camera motion.
      state.camera.updateMatrixWorld();
      if (controlsChanged || state.needsRender) {
        const skipSilhouette = isHeavyDisplayScene(shapesRef.current)
          && (orbitingRef.current || state.wasCameraMoving);
        if (!skipSilhouette) refreshSilhouetteOutlines(state);
      }
      if (viewNudgeAxesRef) {
        viewNudgeAxesRef.current = computeViewNudgeAxes(state.camera);
      }
      // controls.update() stays true through damping and can flip quiet/changed at the end.
      // Hide measurements for that whole motion. Project them once on the first still frame.
      // A later tick that does not move the pose must not null them or project them again.
      const trailingCameraTick = controlsChanged && state.cameraOverlayHold && !cameraHoldPoseMoved(state);
      if (controlsChanged && !trailingCameraTick) {
        state.cameraStillFrames = 0;
        state.wasCameraMoving = true;
        state.cameraOverlayHold = false;
      } else if (!controlsChanged && state.wasCameraMoving) {
        state.cameraStillFrames += 1;
      }
      const cameraSettled = state.wasCameraMoving && state.cameraStillFrames >= CAMERA_OVERLAY_SETTLE_FRAMES;
      if (now - state.lastViewCubeSync > 48 || cameraSettled || state.needsRender) {
        syncViewCube(state, viewCubeRef.current);
        state.lastViewCubeSync = now;
      }
      const syncMeasurementOverlays = () => {
        const previewShapes = previewShapesForDrag(shapesRef.current, dragRef.current);
        syncTransformOverlay(
          state,
          previewShapes,
          selectedIdsRef.current,
          transformOverlayRef,
          setTransformOverlay,
          workspaceRef.current,
          Boolean(transformRef.current || dragRef.current),
        );
        syncAlignOverlay(state, alignReferenceShapesRef.current, selectedIdsRef.current, alignModeRef.current, alignAnchorIdRef.current, alignHandlesRef.current, alignOverlayRef, setAlignOverlay);
        syncMirrorOverlay(state, mirrorReferenceShapesRef.current, selectedIdsRef.current, mirrorModeRef.current, mirrorOverlayRef, setMirrorOverlay);
        syncCircularPatternOverlay(
          state,
          circularPatternModeRef.current,
          circularPatternCenterRef.current,
          circularPatternRadiusRef.current,
          circularPatternOverlayRef,
          setCircularPatternOverlay,
        );
        syncRulerOverlay(state, rulerModelRef.current, rulerOverlayRef, setRulerOverlay, workspaceRef.current);
        state.lastOverlaySync = now;
      };
      syncMeasurementsRef.current = syncMeasurementOverlays;
      if (!cameraOverlaysHiddenRef.current && !trailingCameraTick && (cameraSettled || state.needsRender || now - state.lastOverlaySync > 96)) {
        if (cameraSettled) {
          state.wasCameraMoving = false;
          state.cameraStillFrames = 0;
          state.cameraOverlayHold = true;
          rememberCameraHoldPose(state);
          refreshSilhouetteOutlines(state);
        }
        syncMeasurementOverlays();
      }
      const renderStart = performance.now();
      try {
        state.renderer.render(state.scene, state.camera);
      } catch (error) {
        console.error("Viewport render failed", error);
      }
      const frameMs = performance.now() - renderStart;
      const perf = perfRef.current;
      perf.frameMs = frameMs;
      perf.maxFrameMs = Math.max(perf.maxFrameMs, frameMs);
      perf.frames += 1;
      if (now - perf.lastSample >= 1000) {
        perf.fps = (perf.frames * 1000) / Math.max(1, now - perf.lastSample);
        perf.frames = 0;
        perf.lastSample = now;
        perf.maxFrameMs = frameMs;
      }
      state.needsRender = false;
      const heavyScene = isHeavyDisplayScene(shapesRef.current);
      if (heavyScene && (orbitingRef.current || frameMs > 90)) {
        busyUntilRef.current = Math.max(busyUntilRef.current, now + 700);
        const nextLabel = orbitingRef.current ? "Moving view…" : "Working…";
        if (busyLabelRef.current !== nextLabel) {
          busyLabelRef.current = nextLabel;
          setBusyLabel(nextLabel);
        }
      } else if (busyLabelRef.current && !orbitingRef.current && now > busyUntilRef.current) {
        busyLabelRef.current = null;
        setBusyLabel(null);
      }
    };

    animate();
    state.resize();
    const resizeObserver = new ResizeObserver(() => {
      state.resize();
    });
    resizeObserver.observe(host);
    window.addEventListener("resize", state.resize);

    return () => {
      if (sketchOnModelRef.current && sketchPlaneKeyLiveRef.current) {
        rememberSketchCamera(state, sketchPlaneKeyLiveRef.current);
      }
      transformRef.current = null;
      dragRef.current = null;
      marqueeRef.current = null;
      rulerPointDragRef.current = null;
      window.cancelAnimationFrame(state.animationId);
      // The cut-preview debounce is module scoped, so a pending one would fire after teardown and
      // rebuild overlays against a scene whose geometries and renderer are already disposed.
      cancelScheduledCutPreviewOverlays();
      resizeObserver.disconnect();
      window.removeEventListener("resize", state.resize);
      state.renderer.domElement.removeEventListener("pointerdown", onCameraPointerDown);
      state.renderer.domElement.removeEventListener("pointerup", onCameraPointerUp);
      state.renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      state.renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      state.disposeInteractionListeners();
      state.controls.dispose();
      disposeChildren(state.workplaneLayer);
      disposeChildren(state.shapeLayer);
      disposeChildren(state.helperLayer);
      disposeChildren(state.modifierLayer);
      stopXraySweep(state);
      disposeChildren(state.xrayLayer);
      clearSectionCaps(state.sectionCapLayer);
      disposeChildren(state.printLayer);
      state.renderer.dispose();
      host.replaceChildren();
      if (window.sketchforgeCaptureCanvas) {
        delete window.sketchforgeCaptureCanvas;
      }
      if (window.sketchforgeCaptureProjectThumbnails) {
        delete window.sketchforgeCaptureProjectThumbnails;
      }
      if (window.sketchforgeCaptureView) {
        delete window.sketchforgeCaptureView;
      }
      threeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const state = threeRef.current;
    const session = sketchOnModelRef.current;
    if (!state) return;
    if (!session || !sketchDrawKey) {
      cancelSketchCameraTween(state);
      if (extrudePreviewSeenRef.current) {
        extrudePreviewSeenRef.current = false;
        if (!prefersReducedMotion()) startCameraTween(state, settledPartPose(state), PART_SETTLE_MS);
      }
      if (sketch3DPlaneKeyRef.current) rememberedSketchCamera = null;
      clearSketchOnModel(state.scene);
      sketch3DPointerRef.current = emptySketch3DPointer();
      sketch3DPlaneKeyRef.current = "";
      setSketchMeasure(null);
      state.needsRender = true;
      return;
    }
    const host = { scene: state.scene, camera: state.camera, domElement: state.renderer.domElement, controls: state.controls };
    if (sketch3DPlaneKeyRef.current !== sketchPlaneKey) {
      sketch3DPlaneKeyRef.current = sketchPlaneKey;
      startSketchCameraTween(state, session);
    }
    syncSketchOnModel(host, session, sketch3DPointerRef.current);
    setSketchMeasure(sketch3DMeasureLabel(session, sketch3DPointerRef.current));
    state.needsRender = true;
  }, [sketchDrawKey, sketchPlaneKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const session = sketchOnModelRef.current;
      const state = threeRef.current;
      if (!session || !state) return;
      if (document.querySelector(".sketch-extrude-prompt-layer")) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const result = sketch3DLineKey(session, sketch3DPointerRef.current, event.key);
      if (result.kind === "ignore") return;
      event.preventDefault();
      event.stopPropagation();
      if (result.kind === "clear") sketch3DPointerRef.current.lineEntry = "";
      else if (result.kind === "edit") sketch3DPointerRef.current.lineEntry = result.lineEntry;
      else if (result.kind === "need-angle") {
        session.onNotice?.("Move the pointer to set the angle, or type 50<30");
      } else {
        sketch3DPointerRef.current.lineEntry = "";
        session.onPlanePoint(result.point);
      }
      const host = { scene: state.scene, camera: state.camera, domElement: state.renderer.domElement, controls: state.controls };
      syncSketchOnModel(host, session, sketch3DPointerRef.current);
      setSketchMeasure(sketch3DMeasureLabel(session, sketch3DPointerRef.current));
      state.needsRender = true;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const sketchExtrudePreviewRef = useRef(sketchExtrudePreview);
  /** Set once an extrude was previewed, so leaving the sketch eases back to show the new part. */
  const extrudePreviewSeenRef = useRef(false);
  sketchExtrudePreviewRef.current = sketchExtrudePreview;
  const extrudePreviewOn = Boolean(sketchExtrudePreview);
  useEffect(() => {
    const preview = sketchExtrudePreviewRef.current;
    const state = threeRef.current;
    const session = sketchOnModelRef.current;
    // Back to the sketch: no settle later. Finishing ends the sketch first, so its settle still runs.
    if (!preview) extrudePreviewSeenRef.current = false;
    if (!preview || !state || !session) return;
    extrudePreviewSeenRef.current = true;
    startCameraTween(state, sketchExtrudePreviewPose(session, preview.height, preview.cut));
    state.needsRender = true;
  }, [extrudePreviewOn]);

  useEffect(() => {
    if (skipSketchFrameOnMountRef.current) {
      skipSketchFrameOnMountRef.current = false;
      return;
    }
    if (!sketchFrameRequest) return;
    const state = threeRef.current;
    const session = sketchOnModelRef.current;
    if (!state || !session) return;
    startSketchCameraTween(state, session);
    sketch3DPlaneKeyRef.current = sketchPlaneKey;
    state.needsRender = true;
  }, [sketchFrameRequest]);

  useEffect(() => {
    window.sketchforgePerf = {
      get: () => {
        const state = threeRef.current;
        const info = state?.renderer.info.render;
        return {
          fps: Number(perfRef.current.fps.toFixed(1)),
          frameMs: Number(perfRef.current.frameMs.toFixed(2)),
          maxFrameMs: Number(perfRef.current.maxFrameMs.toFixed(2)),
          drawCalls: info?.calls ?? 0,
          triangles: info?.triangles ?? 0,
          points: info?.points ?? 0,
          lines: info?.lines ?? 0,
          shapeCount: shapesRef.current.filter((shape) => !shape.hidden).length,
        };
      },
    };
    return () => {
      delete window.sketchforgePerf;
    };
  }, []);

  const toRawPlanePoint = useCallback((clientX: number, clientY: number, plane: THREE.Plane) => {
    const state = threeRef.current;
    if (!state) {
      return null;
    }

    const rect = state.renderer.domElement.getBoundingClientRect();
    state.camera.updateMatrixWorld();
    state.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);

    const hit = new THREE.Vector3();
    if (!state.raycaster.ray.intersectPlane(plane, hit)) {
      return null;
    }

    return hit;
  }, []);

  const toPlanePointAtY = useCallback((clientX: number, clientY: number, planeY = 0) => {
    const state = threeRef.current;
    const hit = toRawPlanePoint(clientX, clientY, planeY === 0 ? state?.dragPlane ?? new THREE.Plane(new THREE.Vector3(0, 1, 0), 0) : new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY));
    if (!state || !hit) {
      return null;
    }

    const step = snapStep(snapRef.current);
    return {
      x: snapValue(hit.x, step),
      z: snapValue(hit.z, step),
    };
  }, [toRawPlanePoint]);
  const toPlanePoint = useCallback((clientX: number, clientY: number) => toPlanePointAtY(clientX, clientY, 0), [toPlanePointAtY]);

  const storeRulerModel = useCallback((next: RulerModel) => {
    rulerModelRef.current = next;
    setRulerModel(next);
  }, []);

  useEffect(() => {
    const current = rulerModelRef.current;
    const shapeById = new Map(shapes.map((shape) => [shape.id, shape]));
    const shapeIds = new Set(shapeById.keys());
    const state = threeRef.current;
    const removedPointIds = new Set<string>();
    let metadataChanged = false;
    const updatedPoints = current.points.map((point) => {
      if (!point.attachment) return point;
      const attachedShape = shapeById.get(point.attachment.shapeId);
      if (!attachedShape || (state && !attachedShape.hidden && !rulerAttachmentMatchesTopology(state, point.attachment))) {
        removedPointIds.add(point.id);
        return point;
      }
      const object = state ? findShapeObject(state, point.attachment.shapeId) : null;
      const topologyKey = object?.userData.rulerTopologyKey as string | undefined;
      if (topologyKey && topologyKey !== point.attachment.topologyKey) {
        metadataChanged = true;
        return { ...point, attachment: { ...point.attachment, topologyKey } };
      }
      return point;
    });
    const invalidEdgeSegments = new Set<string>();
    const updatedSegments = current.segments.map((segment) => {
      if (!segment.edge) return segment;
      const attachedShape = shapeById.get(segment.edge.shapeId);
      if (!attachedShape || (state && !attachedShape.hidden && !rulerEdgeMatchesTopology(state, segment.edge))) {
        invalidEdgeSegments.add(segment.id);
        return segment;
      }
      const object = state ? findShapeObject(state, segment.edge.shapeId) : null;
      const topologyKey = object?.userData.rulerTopologyKey as string | undefined;
      if (topologyKey && topologyKey !== segment.edge.topologyKey) {
        metadataChanged = true;
        return { ...segment, edge: { ...segment.edge, topologyKey } };
      }
      return segment;
    });
    const provisionalSegments = updatedSegments.filter((segment) => (
      !removedPointIds.has(segment.startId)
      && !removedPointIds.has(segment.endId)
      && !invalidEdgeSegments.has(segment.id)
    ));
    current.segments.filter((segment) => invalidEdgeSegments.has(segment.id)).forEach((segment) => {
      [segment.startId, segment.endId].forEach((pointId) => {
        if (!provisionalSegments.some((candidate) => candidate.startId === pointId || candidate.endId === pointId)) removedPointIds.add(pointId);
      });
    });
    const segments = provisionalSegments.filter((segment) => !removedPointIds.has(segment.startId) && !removedPointIds.has(segment.endId));
    const points = updatedPoints.filter((point) => !removedPointIds.has(point.id));
    const hoverRemoved = Boolean(current.hover?.attachment && (
      !shapeIds.has(current.hover.attachment.shapeId)
      || (state && !shapeById.get(current.hover.attachment.shapeId)?.hidden && !rulerAttachmentMatchesTopology(state, current.hover.attachment))
    ));
    if (removedPointIds.size === 0 && invalidEdgeSegments.size === 0 && !hoverRemoved && !metadataChanged) return;
    if (rulerPointDragRef.current && removedPointIds.has(rulerPointDragRef.current.pointId)) rulerPointDragRef.current = null;
    storeRulerModel({
      points,
      segments,
      startPointId: current.startPointId && !removedPointIds.has(current.startPointId) ? current.startPointId : null,
      hover: hoverRemoved ? null : current.hover,
    });
  }, [shapes, storeRulerModel]);

  const setRulerActive = useCallback((active: boolean) => {
    rulerModeRef.current = active;
    setRulerMode(active);
    if (!active) {
      const current = rulerModelRef.current;
      storeRulerModel({ ...current, startPointId: null, hover: null });
    }
  }, [storeRulerModel]);

  const resolveRulerCandidate = useCallback(
    (clientX: number, clientY: number, ignoredPointId?: string): RulerCandidate | null => {
      const state = threeRef.current;
      if (!state) return null;

      const model = rulerModelRef.current;
      const rect = state.renderer.domElement.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const closestPoint = model.points.reduce<{ point: RulerPoint; distance: number } | null>((closest, point) => {
        if (point.id === ignoredPointId) return closest;
        const screen = projectToScreen(rulerPointWorld(state, point), state);
        const distance = Math.hypot(screen.x - localX, screen.y - localY);
        if (distance <= 12 && (!closest || distance < closest.distance)) {
          return { point, distance };
        }
        return closest;
      }, null);
      if (closestPoint) {
        const world = rulerPointWorld(state, closestPoint.point);
        return { x: world.x, y: world.y, z: world.z, pointId: closestPoint.point.id, attachment: closestPoint.point.attachment };
      }

      const closestSegment = model.segments.reduce<{ world: THREE.Vector3; distance: number } | null>((closest, segment) => {
        if (segment.startId === ignoredPointId || segment.endId === ignoredPointId) return closest;
        const start = model.points.find((point) => point.id === segment.startId);
        const end = model.points.find((point) => point.id === segment.endId);
        if (!start || !end) return closest;
        const edgePoints = segment.edge ? rulerEdgeWorldPoints(state, segment.edge) : [];
        const worldPoints = edgePoints.length >= 2 ? edgePoints : [rulerPointWorld(state, start), rulerPointWorld(state, end)];
        for (let index = 0; index + 1 < worldPoints.length; index += 1) {
          const a = projectToScreen(worldPoints[index], state);
          const b = projectToScreen(worldPoints[index + 1], state);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const amount = dx * dx + dy * dy > 0.001 ? clamp(((localX - a.x) * dx + (localY - a.y) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
          const distance = Math.hypot(localX - (a.x + dx * amount), localY - (a.y + dy * amount));
          if (distance <= 10 && (!closest || distance < closest.distance)) {
            closest = { world: worldPoints[index].clone().lerp(worldPoints[index + 1], amount), distance };
          }
        }
        return closest;
      }, null);

      if (closestSegment) {
        const existing = model.points.find((point) => rulerPointWorld(state, point).distanceTo(closestSegment.world) < 0.001);
        return { x: closestSegment.world.x, y: closestSegment.world.y, z: closestSegment.world.z, pointId: existing?.id };
      }

      const targetShapeIds = shapesRef.current.filter((shape) => !shape.hidden).map((shape) => shape.id);
      const seedPoint = (() => {
        if (model.startPointId) return model.points.find((point) => point.id === model.startPointId) ?? null;
        if (ignoredPointId) {
          const segment = model.segments.find((entry) => entry.startId === ignoredPointId || entry.endId === ignoredPointId);
          if (!segment) return null;
          const otherId = segment.startId === ignoredPointId ? segment.endId : segment.startId;
          return model.points.find((point) => point.id === otherId) ?? null;
        }
        return null;
      })();
      const modelCandidate = pickModelRulerCandidate(state, targetShapeIds, clientX, clientY, seedPoint);
      if (modelCandidate) return modelCandidate;

      const raw = toRawPlanePoint(clientX, clientY, state.dragPlane);
      if (!raw) return null;
      const step = snapStep(snapRef.current);
      const bounds = workspaceRef.current;
      const snapped = {
        x: clamp(snapValue(raw.x, step), -bounds.width / 2, bounds.width / 2),
        y: 0,
        z: clamp(snapValue(raw.z, step), -bounds.depth / 2, bounds.depth / 2),
      };
      const existing = model.points.find((point) => Math.hypot(point.x - snapped.x, point.y, point.z - snapped.z) < 0.001 && !point.attachment);
      return { ...snapped, pointId: existing?.id };
    },
    [toRawPlanePoint],
  );

  const selectRulerCandidate = useCallback(
    (candidate: RulerCandidate) => {
      const current = rulerModelRef.current;
      const sameAttachment = (point: RulerPoint, attachment: RulerAttachment | undefined) => Boolean(
        attachment
        && point.attachment?.shapeId === attachment.shapeId
        && Math.hypot(
          point.attachment.normalized[0] - attachment.normalized[0],
          point.attachment.normalized[1] - attachment.normalized[1],
          point.attachment.normalized[2] - attachment.normalized[2],
        ) < 1e-5,
      );
      const findExisting = (value: Pick<RulerCandidate, "x" | "y" | "z" | "pointId" | "attachment">) => value.pointId
        ? current.points.find((point) => point.id === value.pointId)
        : current.points.find((point) => sameAttachment(point, value.attachment) || (!point.attachment && !value.attachment && Math.hypot(point.x - value.x, point.y - value.y, point.z - value.z) < 0.001));
      const makePoint = (value: Pick<RulerCandidate, "x" | "y" | "z" | "pointId" | "attachment">) => findExisting(value) ?? {
        id: `ruler-point-${++rulerIdRef.current}`,
        x: value.x,
        y: value.y,
        z: value.z,
        attachment: value.attachment,
      };

      const existing = findExisting(candidate);
      const point = existing ?? makePoint(candidate);
      const points = existing ? current.points : [...current.points, point];
      if (!current.startPointId) {
        storeRulerModel({ ...current, points, startPointId: point.id, hover: { x: point.x, y: point.y, z: point.z, attachment: point.attachment } });
        return;
      }
      if (current.startPointId === point.id) {
        return;
      }

      const duplicate = current.segments.some(
        (segment) =>
          (segment.startId === current.startPointId && segment.endId === point.id) ||
          (segment.startId === point.id && segment.endId === current.startPointId),
      );
      const segments = duplicate
        ? current.segments
        : [...current.segments, { id: `ruler-segment-${++rulerIdRef.current}`, startId: current.startPointId, endId: point.id }];
      storeRulerModel({ points, segments, startPointId: null, hover: null });
    },
    [storeRulerModel],
  );

  const updateRulerHover = useCallback(
    (clientX: number, clientY: number) => {
      if (!rulerModeRef.current) {
        return;
      }
      const candidate = resolveRulerCandidate(clientX, clientY);
      const current = rulerModelRef.current;
      const hover = candidate;
      if ((!current.hover && !hover) || (current.hover && hover
        && current.hover.edge?.key === hover.edge?.key
        && current.hover.alignHint === hover.alignHint
        && Math.hypot(current.hover.x - hover.x, current.hover.y - hover.y, current.hover.z - hover.z) < 0.0001)) {
        return;
      }
      storeRulerModel({ ...current, hover });
    },
    [resolveRulerCandidate, storeRulerModel],
  );

  const removeRulerSegment = useCallback(
    (segmentId: string) => {
      const current = rulerModelRef.current;
      const segments = current.segments.filter((segment) => segment.id !== segmentId);
      const usedPointIds = new Set(segments.flatMap((segment) => [segment.startId, segment.endId]));
      const points = current.points.filter((point) => usedPointIds.has(point.id) || point.id === current.startPointId);
      storeRulerModel({ ...current, points, segments });
    },
    [storeRulerModel],
  );

  const removeRulerPoint = useCallback(
    (pointId: string) => {
      const current = rulerModelRef.current;
      const segments = current.segments.filter((segment) => segment.startId !== pointId && segment.endId !== pointId);
      const points = current.points.filter((point) => point.id !== pointId);
      storeRulerModel({
        ...current,
        points,
        segments,
        startPointId: current.startPointId === pointId ? null : current.startPointId,
      });
    },
    [storeRulerModel],
  );

  const setMarqueeFromState = useCallback((marquee: MarqueeState | null) => {
    if (!marquee) {
      setMarqueeRect(null);
      return;
    }
    const left = Math.min(marquee.startX, marquee.currentX);
    const top = Math.min(marquee.startY, marquee.currentY);
    setMarqueeRect({
      left,
      top,
      width: Math.abs(marquee.currentX - marquee.startX),
      height: Math.abs(marquee.currentY - marquee.startY),
    });
  }, []);

  const shapesInMarquee = useCallback((rect: { left: number; top: number; right: number; bottom: number }) => {
    const state = threeRef.current;
    if (!state) {
      return [];
    }
    return shapesRef.current
      .filter((shape) => !shape.hidden)
      .filter((shape) => {
        const bounds = shapeScreenBounds(state, shape);
        return bounds ? boundsIntersectRect(bounds, rect) : false;
      })
      .map((shape) => shape.id);
  }, []);

  const beginTransform = useCallback(
    (kind: TransformHandleKind, handleKey: string, event: ReactPointerEvent<Element>) => {
      if (kind === "rotate" && event.button !== 0) {
        return;
      }
      // Closing an open degree box (and baking) before starting another transform.
      bakePendingRotationsRef.current();
      setEditingRotation(null);
      const ids = selectedIdsRef.current;
      const frame = selectionFrameForShapes(shapesRef.current, ids);
      const shape = frame?.singleShape ?? shapesRef.current.find((entry) => entry.id === ids[0]);
      if (!frame || !shape || ids.length === 0 || ids.some((id) => shapesRef.current.find((entry) => entry.id === id)?.locked)) {
        return;
      }

      const resizeHandleKey = handleKey;
      const state = threeRef.current;
      const rotationAxis = resolveRotationAxis(handleKey, state, frame);
      const yBounds = selectionWorldYBounds(frame);
      const handlesLowerSide = handleKey === "bottom-height" || handleKey === "lower-shape";
      const yStart = handlesLowerSide ? yBounds.min : yBounds.max;
      const liftOffset = kind === "lift" ? Math.max(2, yBounds.height * 0.08) * (handlesLowerSide ? -1 : 1) : 0;
      const startWorldY = yStart + liftOffset;
      const overlay = transformOverlayRef.current;
      const wheel = kind === "rotate" ? (overlay?.rotationWheels[rotationAxis] ?? overlay?.rotationWheel ?? undefined) : undefined;
      const rotationPlane = kind === "rotate" ? overlay?.rotationPlanes[rotationAxis] : undefined;
      const rotationPlaneCenterData = kind === "rotate" ? overlay?.rotationPlaneCenters[rotationAxis] : undefined;
      const rotationPlaneCenter = rotationPlaneCenterData
        ? new THREE.Vector3(rotationPlaneCenterData.x, rotationPlaneCenterData.y, rotationPlaneCenterData.z)
        : frame.center.clone();
      const rect = state?.renderer.domElement.getBoundingClientRect();
      const localClientX = rect ? event.clientX - rect.left : event.clientX;
      const localClientY = rect ? event.clientY - rect.top : event.clientY;
      const axisVector = rotationAxisVectorForFrame(handleKey, frame, rotationAxis);
      const pivot = frame.center.clone();
      const rotationCenter = kind === "rotate" ? wheel ?? (state ? projectToScreen(pivot, state) : { x: localClientX, y: localClientY }) : undefined;
      const rotationStartPoint = kind === "rotate" && state ? rayPointOnRotationPlane(state, event.clientX, event.clientY, rotationPlaneCenter, axisVector) : null;
      const rotationStartVector = rotationStartPoint ? rotationStartPoint.sub(rotationPlaneCenter) : undefined;
      const scalePlane = kind === "scale" ? localResizePlaneForFrame(frame) : undefined;
      const scaleStartPoint = scalePlane ? toRawPlanePoint(event.clientX, event.clientY, scalePlane) ?? undefined : undefined;
      const scaleSigns = kind === "scale" ? resizeSignsForHandle(resizeHandleKey) : undefined;
      const scaleAnchorPoint = kind === "scale" && scaleSigns ? resizeAnchorPointForFrame(frame, scaleSigns) : undefined;
      if (kind === "scale" && !scaleStartPoint) {
        return;
      }
      rememberResizeAnchor(shape.id, kind, resizeHandleKey);
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setEditingRotation(null);
      setPinnedMeasureKey(measureKeyForHandle(kind, handleKey, transformOverlayRef.current));
      if (kind === "height") {
        setHoverMeasureKey(null);
      }
      setActiveRotationWheel(kind === "rotate");
      setActiveTransformKind(kind);
      setSelectionHelpersVisible(state ?? null, kind !== "rotate");
      if (kind === "rotate") {
        setRotationWheelAxis(rotationAxis);
        setPinnedRotationWheelView(wheel && rotationPlane ? { axis: rotationAxis, wheel: { ...wheel }, plane: { ...rotationPlane } } : null);
      } else {
        setPinnedRotationWheelView(null);
      }
      transformRef.current = {
        id: shape.id,
        ids: frame.ids,
        kind,
        handleKey: resizeHandleKey,
        rotationAxis,
        pointerId: event.pointerId,
        startShape: { ...shape },
        items: frame.ids
          .map((id) => shapesRef.current.find((entry) => entry.id === id))
          .filter((entry): entry is WorkplaneShape => Boolean(entry))
          .map((entry) => ({
            id: entry.id,
            startShape: { ...entry },
            startCenter: shapeCenter(entry),
            startQuaternion: quaternionForShape(entry),
          })),
        selectionFrame: frame,
        startScreenAngle: rotationCenter ? screenAngle(localClientX, localClientY, rotationCenter) : 0,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startScreenY: state ? projectedScreenYAt(state, frame.center.x, frame.center.z, startWorldY) : event.clientY,
        startWorldY,
        handleWorldOffset: liftOffset,
        screenYPerWorldUnit: state ? projectedScreenYPerWorldUnitAt(state, frame.center.x, frame.center.z, startWorldY) : -3.2,
        scalePlaneY: kind === "scale" ? yBounds.min : 0,
        scalePlane,
        scaleSigns,
        scaleAnchorPoint,
        scaleStartPoint,
        rotationAxisVector: kind === "rotate" ? axisVector : undefined,
        rotationPivot: kind === "rotate" ? pivot : undefined,
        rotationPlaneCenter: kind === "rotate" ? rotationPlaneCenter : undefined,
        rotationStartVector: kind === "rotate" ? rotationStartVector : undefined,
        rotationScreenCenter: rotationCenter,
        rotationScreenSign: kind === "rotate" && state ? rotationScreenSign(axisVector, state.camera) : 1,
        rotationStartQuaternion: kind === "rotate" ? quaternionForShape(shape) : undefined,
        wheelCenter: wheel,
      };
      if (kind === "rotate" && state) {
        const renderRect = state.renderer.domElement.getBoundingClientRect();
        const localX = event.clientX - renderRect.left;
        const localY = event.clientY - renderRect.top;
        setRotationReadout(rotationReadoutAtPointer(wheel, localX, localY, 0));
      } else if (kind === "lift" && state) {
        const renderRect = state.renderer.domElement.getBoundingClientRect();
        setRotationReadout({
          x: event.clientX - renderRect.left + 22,
          y: event.clientY - renderRect.top - 34,
          text: formatMeasure(yBounds.min, workspaceRef.current),
        });
      } else {
        setRotationReadout(null);
      }
      if (state) {
        clearCutPreviewOverlays(state);
        state.needsRender = true;
        state.controls.enabled = false;
      }
      onInteractionActiveChange?.(true);
    },
    [onInteractionActiveChange, rememberResizeAnchor, toRawPlanePoint],
  );

  const updateTransform = useCallback(
    (clientX: number, clientY: number, shiftKey = false, altKey = false) => {
      const transform = transformRef.current;
      if (!transform) {
        return false;
      }
      if (Math.hypot(clientX - transform.startClientX, clientY - transform.startClientY) > 3) {
        transform.hasMoved = true;
      }

      const shape = transform.startShape;
      const step = snapStep(snapRef.current);
      if (transform.kind === "height") {
        const state = threeRef.current;
        const yBounds = selectionWorldYBounds(transform.selectionFrame);
        const draggedWorldY = state
          ? projectedWorldYForScreenY(state, shape, transform.startScreenY + clientY - transform.startClientY, transform.startWorldY)
          : transform.startWorldY + (clientY - transform.startClientY) / transform.screenYPerWorldUnit;
        const resizingFromBottom = transform.handleKey === "bottom-height";
        const rawWorldHeight = resizingFromBottom ? yBounds.max - draggedWorldY : draggedWorldY - yBounds.min;
        const nextWorldHeight = clamp(yBounds.height + snapValue(rawWorldHeight - yBounds.height, step), MIN_SHAPE_SIZE, 180);
        const scaleY = nextWorldHeight / Math.max(MIN_SHAPE_SIZE, yBounds.height);
        transform.items.forEach((item) => {
          const localCenter = frameLocalPoint(transform.selectionFrame, item.startCenter);
          const nextCenterY = resizingFromBottom
            ? transform.selectionFrame.center.y + transform.selectionFrame.height / 2 - (transform.selectionFrame.height / 2 - localCenter.y) * scaleY
            : transform.selectionFrame.center.y - transform.selectionFrame.height / 2 + (localCenter.y + transform.selectionFrame.height / 2) * scaleY;
          const height = clamp(item.startShape.height * scaleY, MIN_SHAPE_SIZE, 180);
          const sizePatch = { height };
          const nextHeight = sizePatch.height ?? height;
          let elevation = nextCenterY - nextHeight / 2;
          if (transform.items.length === 1) {
            const draftShape = { ...item.startShape, ...sizePatch, elevation };
            const draftFrame = selectionFrameForShapes([draftShape], [item.id]);
            if (draftFrame) {
              const draftBounds = selectionWorldYBounds(draftFrame);
              elevation += resizingFromBottom ? yBounds.max - draftBounds.max : yBounds.min - draftBounds.min;
            }
          }
          onUpdateShape(item.id, {
            ...sizePatch,
            elevation: cleanNearZero(clamp(elevation, MIN_ELEVATION, MAX_ELEVATION), 0.0005),
          });
        });
        return true;
      }

      if (transform.kind === "lift") {
        const state = threeRef.current;
        const yBounds = selectionWorldYBounds(transform.selectionFrame);
        const handleWorldY = state
          ? projectedWorldYForScreenY(state, shape, transform.startScreenY + clientY - transform.startClientY, transform.startWorldY)
          : transform.startWorldY + (clientY - transform.startClientY) / transform.screenYPerWorldUnit;
        const handlesLowerSide = transform.handleKey === "lower-shape";
        const rawBottom = handlesLowerSide ? handleWorldY - transform.handleWorldOffset : handleWorldY - yBounds.height - transform.handleWorldOffset;
        const nextBottom = cleanNearZero(
          clamp(yBounds.min + snapValue(rawBottom - yBounds.min, step), MIN_ELEVATION, MAX_ELEVATION),
          0.0005,
        );
        const delta = nextBottom - yBounds.min;
        transform.items.forEach((item) =>
          onUpdateShape(item.id, {
            elevation: cleanNearZero(
              clamp((item.startShape.elevation ?? 0) + delta, MIN_ELEVATION, MAX_ELEVATION),
              0.0005,
            ),
          }),
        );
        if (state) {
          const readoutPoint = projectToScreen(new THREE.Vector3(transform.selectionFrame.center.x, handleWorldY, transform.selectionFrame.center.z), state);
          setRotationReadout({
            x: readoutPoint.x + 28,
            y: readoutPoint.y - 30,
            text: formatMeasure(nextBottom, workspaceRef.current),
          });
        }
        return true;
      }

      if (transform.kind === "scale") {
        const worldPoint = transform.scalePlane ? toRawPlanePoint(clientX, clientY, transform.scalePlane) : null;
        if (!worldPoint) {
          return true;
        }
        if (transform.items.length === 1) {
          const next = resizeShapeFromFrameHandle(transform, worldPoint, transform.handleKey, shiftKey, altKey, step);
          onUpdateShape(transform.id, next);
        } else {
          resizeSelectionFromHandle(transform, worldPoint, transform.handleKey, shiftKey, altKey, step).forEach(({ id, patch }) => onUpdateShape(id, patch));
        }
        return true;
      }

      const point = toPlanePoint(clientX, clientY);
      if (!point && transform.kind !== "rotate") {
        return true;
      }

      const state = threeRef.current;
      const rotationCenter = transform.rotationScreenCenter ?? transform.wheelCenter;
      if (!state || !rotationCenter) {
        return true;
      }
      const rect = state.renderer.domElement.getBoundingClientRect();
      const localClientX = clientX - rect.left;
      const localClientY = clientY - rect.top;
      const axisVector = (transform.rotationAxisVector ?? rotationAxisVectorForFrame(transform.handleKey, transform.selectionFrame, transform.rotationAxis)).clone().normalize();
      const pivot = transform.rotationPivot ?? transform.selectionFrame.center;
      // Screen-space angle around the billboarded wheel so drag matches the ring you see.
      const rawDelta =
        THREE.MathUtils.radToDeg(unwrapRadians(screenAngle(localClientX, localClientY, rotationCenter) - transform.startScreenAngle)) *
        (transform.rotationScreenSign ?? 1);
      const distance = transform.wheelCenter ? Math.hypot(localClientX - transform.wheelCenter.x, localClientY - transform.wheelCenter.y) : Number.POSITIVE_INFINITY;
      const innerRadius = transform.wheelCenter?.innerRadius ?? transform.wheelCenter?.radius ?? 0;
      const inIndexedRing = Boolean(transform.wheelCenter && distance <= innerRadius);
      let delta: number;
      if (shiftKey) {
        delta = Math.round(rawDelta / 45) * 45;
      } else if (inIndexedRing) {
        // Inner circle: snap to indexed steps (22.5°).
        delta = Math.round(rawDelta / ROTATION_SNAP_STEP) * ROTATION_SNAP_STEP;
      } else {
        // Outer free ring (and beyond): 1° increments (finer values via the degree input).
        delta = Math.round(rawDelta);
      }

      const deltaQuaternion = new THREE.Quaternion().setFromAxisAngle(axisVector, THREE.MathUtils.degToRad(delta));
      const rotationDelta = deltaQuaternion.clone();
      if (state) {
        const startPointerAngle = THREE.MathUtils.radToDeg(transform.startScreenAngle) + 90;
        setRotationReadout(rotationReadoutAtPointer(transform.wheelCenter, localClientX, localClientY, delta, startPointerAngle));
      }
      transform.items.forEach((item) => {
        const nextQuaternion = rotationDelta.clone().multiply(item.startQuaternion);
        const patch: Partial<WorkplaneShape> = rotationPatchFromQuaternion(nextQuaternion);
        if (transform.items.length > 1) {
          const nextCenter = pivot.clone().add(item.startCenter.clone().sub(pivot).applyQuaternion(rotationDelta));
          patch.x = snapValue(nextCenter.x, step);
          patch.z = snapValue(nextCenter.z, step);
          patch.elevation = snapPositionValue(nextCenter.y - item.startShape.height / 2, step, MIN_ELEVATION, MAX_ELEVATION);
        }
        onUpdateShape(item.id, patch);
      });
      return true;
    },
    [onUpdateShape, toPlanePoint, toRawPlanePoint],
  );

  const suppressLiftEditAfterDrag = useCallback(() => {
    suppressNextLiftEditRef.current = true;
    window.setTimeout(() => {
      suppressNextLiftEditRef.current = false;
    }, 250);
  }, []);

  const suppressRotationEditAfterDrag = useCallback(() => {
    suppressNextRotationEditRef.current = true;
    window.setTimeout(() => {
      suppressNextRotationEditRef.current = false;
    }, 250);
  }, []);

  const bakePendingRotations = useCallback(() => {
    const ids = pendingRotationBakeIdsRef.current;
    if (ids.length === 0) {
      return;
    }
    pendingRotationBakeIdsRef.current = [];
    pendingRotationBeforeByIdRef.current = {};
    ids.forEach((id) => onUpdateShape(id, { bakeTransform: true }));
  }, [onUpdateShape]);

  bakePendingRotationsRef.current = bakePendingRotations;

  const dismissRotationEdit = useCallback(() => {
    setEditingRotation(null);
    setActiveRotationWheel(false);
    bakePendingRotations();
  }, [bakePendingRotations]);

  useEffect(() => {
    if (!rotationEditApiRef) {
      return;
    }
    rotationEditApiRef.current = { dismiss: dismissRotationEdit };
    return () => {
      rotationEditApiRef.current = null;
    };
  }, [dismissRotationEdit, rotationEditApiRef]);

  const openRotationEditorAfterDrag = useCallback((transform: TransformDragState) => {
    const shape = shapesRef.current.find((entry) => entry.id === transform.id);
    if (!shape) {
      transform.ids.forEach((id) => onUpdateShape(id, { bakeTransform: true }));
      return;
    }
    pendingRotationBakeIdsRef.current = [...transform.ids];
    pendingRotationBeforeByIdRef.current = Object.fromEntries(transform.items.map((item) => [item.id, item.startShape]));
    const axis = transform.rotationAxis ?? resolveRotationAxis(transform.handleKey, threeRef.current, transform.selectionFrame);
    const readout = rotationReadoutRef.current;
    const overlay = transformOverlayRef.current;
    const overlayWidth = overlay?.width ?? 900;
    const overlayHeight = overlay?.height ?? 600;
    const fallbackX = transform.wheelCenter?.x ?? readout?.x ?? 80;
    const fallbackY = transform.wheelCenter ? transform.wheelCenter.y - 92 : readout?.y ?? 80;
    const currentValue = rotationValueForAxis(shape, axis);
    const value = String(Number(currentValue.toFixed(1)));
    setPinnedMeasureKey(transform.handleKey);
    setActiveRotationWheel(false);
    setPinnedRotationWheelView(null);
    setRotationReadout(null);
    setEditingRotation({
      axis,
      handleKey: transform.handleKey,
      x: clamp(fallbackX, 38, Math.max(38, overlayWidth - 38)),
      y: clamp(fallbackY, 38, Math.max(38, overlayHeight - 38)),
      value,
      initialValue: value,
    });
  }, [onUpdateShape]);

  const finishTransform = useCallback((event: ReactPointerEvent<Element>) => {
    const transform = transformRef.current;
    if (!transform) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(transform.pointerId)) {
      event.currentTarget.releasePointerCapture(transform.pointerId);
    }
    const openedRotationEditor = transform.kind === "rotate" && Boolean(transform.hasMoved);
    if (transform.kind === "lift") {
      setPinnedMeasureKey(getElevationMeasureKey(transformOverlayRef.current));
    }
    if (transform.kind === "lift" && transform.hasMoved) {
      suppressLiftEditAfterDrag();
    }
    if (openedRotationEditor) {
      // Keep the degree box; suppress the handle's click so it doesn't reopen.
      suppressRotationEditAfterDrag();
    }
    transformRef.current = null;
    setActiveTransformKind(null);
    if (!openedRotationEditor) {
      setActiveRotationWheel(false);
      setPinnedRotationWheelView(null);
      setRotationReadout(null);
    }
    if (threeRef.current) {
      syncCutPreviewOverlays(threeRef.current, shapesRef.current);
      setSelectionHelpersVisible(threeRef.current, true);
      threeRef.current.controls.enabled = true;
      threeRef.current.needsRender = true;
    }
    onInteractionActiveChange?.(false);
    // Defer bake until the degree box commits, cancels, or is dismissed (e.g. Duplicate).
    // Baking first then committing the pre-bake angle was re-rotating the same object.
    if (openedRotationEditor) {
      openRotationEditorAfterDrag(transform);
    }
  }, [onInteractionActiveChange, openRotationEditorAfterDrag, suppressLiftEditAfterDrag, suppressRotationEditAfterDrag]);

  const beginDimensionEdit = useCallback((mark: DimensionMark) => {
    const id = selectedIdsRef.current[0];
    if (mark.axis === "width" || mark.axis === "depth" || mark.axis === "height") {
      // The label measures the whole selection; typing into it with several
      // shapes selected would silently resize only the first one.
      if (!id || selectedIdsRef.current.length !== 1) return;
      rememberResizeAnchor(id, mark.axis === "height" ? "height" : "scale", mark.handleKey);
    }
    bakePendingRotations();
    setEditingRotation(null);
    setActiveRotationWheel(false);
    setPinnedMeasureKey(mark.handleKey);
    setEditingDimension({ key: mark.key, axis: mark.axis, x: mark.labelX, y: mark.labelY, value: mark.label });
  }, [bakePendingRotations, rememberResizeAnchor]);

  const beginLiftEdit = useCallback((handleKey: string, x: number, y: number) => {
    if (suppressNextLiftEditRef.current) {
      suppressNextLiftEditRef.current = false;
      return;
    }
    const frame = selectionFrameForShapes(shapesRef.current, selectedIdsRef.current);
    if (!frame) {
      return;
    }
    const yBounds = selectionWorldYBounds(frame);
    const elevationMark = Object.values(transformOverlayRef.current?.dimensions ?? {})
      .flat()
      .find((entry) => entry.axis === "elevation");
    const editX = elevationMark?.labelX ?? x;
    const editY = elevationMark?.labelY ?? y;
    setPinnedMeasureKey(elevationMark?.handleKey ?? handleKey);
    setEditingRotation(null);
    setActiveRotationWheel(false);
    setRotationReadout(null);
    setEditingDimension({
      key: "elevation",
      axis: "elevation",
      x: clamp(editX, 44, Math.max(44, (transformOverlayRef.current?.width ?? 900) - 44)),
      y: clamp(editY, 34, Math.max(34, (transformOverlayRef.current?.height ?? 600) - 34)),
      value: formatMeasure(yBounds.min, workspaceRef.current),
    });
  }, []);

  const commitDimensionEdit = useCallback(() => {
    const edit = editingDimension;
    const id = selectedIdsRef.current[0];
    const shape = shapesRef.current.find((entry) => entry.id === id);
    if (!edit || !shape) {
      setEditingDimension(null);
      return;
    }
    const value = displayToMillimeters(Number.parseFloat(edit.value), workspaceRef.current);
    if (edit.axis === "elevation") {
      if (Number.isFinite(value)) {
        const frame = selectionFrameForShapes(shapesRef.current, selectedIdsRef.current);
        const currentMin = frame ? selectionWorldYBounds(frame).min : shape.elevation ?? 0;
        const targetMin = cleanNearZero(clamp(value, MIN_ELEVATION, MAX_ELEVATION), 0.0005);
        const delta = targetMin - currentMin;
        selectedIdsRef.current.forEach((selectedId) => {
          const selectedShape = shapesRef.current.find((entry) => entry.id === selectedId);
          if (selectedShape) {
            onUpdateShape(selectedId, { elevation: cleanNearZero(clamp((selectedShape.elevation ?? 0) + delta, MIN_ELEVATION, MAX_ELEVATION), 0.0005) });
          }
        });
      }
      setEditingDimension(null);
      return;
    }
    // Size labels belong to one shape. With several selected the label shows
    // the selection's extent, so writing it into the first shape would resize
    // the wrong body; only the elevation edit above is a group operation.
    if (selectedIdsRef.current.length !== 1) {
      setEditingDimension(null);
      return;
    }
    if (Number.isFinite(value) && value > 0) {
      const nextValue = clamp(value, MIN_SHAPE_SIZE, TYPED_DIMENSION_MAX_MM);
      if (edit.axis === "width") {
        const patch: Partial<WorkplaneShape> =
          shape.kind === "cone"
            ? conePatchForFootprint(shape, nextValue, shapeDepth(shape))
            : shape.kind === "gear"
              ? gearPatchForFootprint(shape, nextValue, shapeDepth(shape))
              : { width: nextValue, size: resizedShapeSize(nextValue, shapeDepth(shape)) };
        if (shape.kind === "roof") {
          const next = roofAnglesFromProfile(nextValue, shape.height, shape.leftAngle, shape.rightAngle);
          patch.leftAngle = next.leftAngle;
          patch.rightAngle = next.rightAngle;
        }
        onUpdateShape(id, patchWithResizeAnchor(shape, patch, edit.axis, lastResizeAnchorRef.current));
      } else if (edit.axis === "depth") {
        const patch: Partial<WorkplaneShape> =
          shape.kind === "cone"
            ? conePatchForFootprint(shape, shapeWidth(shape), nextValue)
            : shape.kind === "gear"
              ? gearPatchForFootprint(shape, shapeWidth(shape), nextValue)
              : { depth: nextValue, size: resizedShapeSize(shapeWidth(shape), nextValue) };
        onUpdateShape(id, patchWithResizeAnchor(shape, patch, edit.axis, lastResizeAnchorRef.current));
      } else {
        const patch: Partial<WorkplaneShape> = { height: nextValue };
        if (shape.kind === "roof") {
          const next = roofAnglesFromProfile(shapeWidth(shape), nextValue, shape.leftAngle, shape.rightAngle);
          patch.leftAngle = next.leftAngle;
          patch.rightAngle = next.rightAngle;
        }
        onUpdateShape(id, patchWithResizeAnchor(shape, patch, edit.axis, lastResizeAnchorRef.current));
      }
    }
    setEditingDimension(null);
  }, [editingDimension, onUpdateShape]);

  const cancelDimensionEdit = useCallback(() => {
    setEditingDimension(null);
  }, []);

  const beginRotationEdit = useCallback((handleKey: string, x: number, y: number) => {
    if (suppressNextRotationEditRef.current) {
      suppressNextRotationEditRef.current = false;
      return;
    }
    bakePendingRotations();
    const frame = selectionFrameForShapes(shapesRef.current, selectedIdsRef.current);
    const state = threeRef.current;
    const axis = resolveRotationAxis(handleKey, state, frame);
    const shape = selectedIdsRef.current.length === 1 ? shapesRef.current.find((entry) => entry.id === selectedIdsRef.current[0]) : null;
    const currentValue = shape ? rotationValueForAxis(shape, axis) : 0;
    const value = String(Number(currentValue.toFixed(1)));
    setPinnedMeasureKey(handleKey);
    setActiveRotationWheel(true);
    setRotationWheelAxis(axis);
    // Keep the ring live (not pinned) so it stays camera-facing while orbiting during numeric edit.
    setPinnedRotationWheelView(null);
    setRotationReadout(null);
    setEditingRotation({
      axis,
      handleKey,
      x: clamp(x, 38, Math.max(38, (transformOverlayRef.current?.width ?? 900) - 38)),
      y: clamp(y, 38, Math.max(38, (transformOverlayRef.current?.height ?? 600) - 38)),
      value,
      initialValue: value,
    });
  }, [bakePendingRotations]);

  const commitRotationEdit = useCallback(() => {
    const edit = editingRotationRef.current;
    if (!edit) {
      return;
    }
    // Clear first so a blur after Enter cannot double-commit.
    editingRotationRef.current = null;
    setEditingRotation(null);
    setActiveRotationWheel(false);
    const value = Number.parseFloat(edit.value);
    const pendingIds = new Set(pendingRotationBakeIdsRef.current);
    const pendingBefore = pendingRotationBeforeByIdRef.current;
    pendingRotationBakeIdsRef.current = [];
    pendingRotationBeforeByIdRef.current = {};
    if (Number.isFinite(value)) {
      selectedIdsRef.current.forEach((id) => {
        const shape = shapesRef.current.find((entry) => entry.id === id);
        if (!shape) {
          return;
        }
        if (Math.abs(rotationValueForAxis(shape, edit.axis) - value) > 0.0005) {
          onUpdateShape(id, {
            ...rotationPatchForAxis(edit.axis, value),
            bakeTransform: true,
            repeatDeltaBefore: pendingBefore[id],
          });
          pendingIds.delete(id);
          return;
        }
        if (pendingIds.has(id)) {
          onUpdateShape(id, { bakeTransform: true });
          pendingIds.delete(id);
        }
      });
    }
    pendingIds.forEach((id) => onUpdateShape(id, { bakeTransform: true }));
  }, [onUpdateShape]);

  const cancelRotationEdit = useCallback(() => {
    if (!editingRotationRef.current && pendingRotationBakeIdsRef.current.length === 0) {
      return;
    }
    editingRotationRef.current = null;
    setEditingRotation(null);
    setActiveRotationWheel(false);
    bakePendingRotations();
  }, [bakePendingRotations]);

  const pickCacheRef = useRef<{ x: number; y: number; hits: string[] } | null>(null);
  const pickShapesAt = useCallback((clientX: number, clientY: number) => {
    const cached = pickCacheRef.current;
    if (cached && cached.x === clientX && cached.y === clientY) {
      return cached.hits;
    }
    const state = threeRef.current;
    if (!state) {
      return [] as string[];
    }

    const rect = state.renderer.domElement.getBoundingClientRect();
    state.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);

    const hits: string[] = [];
    const seen = new Set<string>();
    try {
    // Closest real surface wins, front to back. A miss is empty space and clears
    // the selection, including the white area around the grid.
    const intersections = preciseMeshHits(state, state.shapeLayer.children);
    intersections.forEach((entry) => {
      if (!(entry.object instanceof THREE.Mesh)) {
        return;
      }
      const id = entry.object.userData.shapeId;
      if (typeof id !== "string" || seen.has(id)) {
        return;
      }
      const shape = shapesRef.current.find((item) => item.id === id);
      if (!shape || shape.hidden) {
        return;
      }
      seen.add(id);
      hits.push(id);
    });
    pickCacheRef.current = { x: clientX, y: clientY, hits };
    return hits;
    } catch (error) {
      console.error("Shape pick failed", error);
      return [];
    }
  }, []);

  const pickShape = useCallback((clientX: number, clientY: number) => pickShapesAt(clientX, clientY)[0] ?? null, [pickShapesAt]);

  /** Alt-click: pick a CSG child feature under a body (Tinkercad-like edit solids). */
  const pickCsgFeatureAt = useCallback((clientX: number, clientY: number): { bodyId: string; featureId: string } | null => {
    const state = threeRef.current;
    if (!state) return null;
    const rect = state.renderer.domElement.getBoundingClientRect();
    state.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const hit = preciseMeshHits(state, state.shapeLayer.children).find((entry) => {
      const id = entry.object.userData.shapeId;
      if (typeof id !== "string") return false;
      const shape = shapesRef.current.find((item) => item.id === id);
      return Boolean(shape && !shape.hidden && shape.groupedShapes?.length);
    });
    if (!hit || typeof hit.object.userData.shapeId !== "string") return null;
    const body = shapesRef.current.find((item) => item.id === hit.object.userData.shapeId);
    if (!body?.groupedShapes?.length) return null;

    const hitPoint = hit.point.clone();
    const inv = new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(body.rotationX ?? 0),
        THREE.MathUtils.degToRad(body.rotation),
        THREE.MathUtils.degToRad(body.rotationZ ?? 0),
        "XYZ",
      ))
      .invert();
    const local = hitPoint
      .clone()
      .sub(new THREE.Vector3(body.x, (body.elevation ?? 0), body.z))
      .applyMatrix4(inv);

    let bestId: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const child of body.groupedShapes) {
      if (child.suppressed || child.csg?.suppressed || child.hidden) continue;
      const hw = shapeWidth(child) / 2;
      const hd = shapeDepth(child) / 2;
      const hh = child.height / 2;
      const cx = child.x;
      const cy = (child.elevation ?? 0) + hh;
      const cz = child.z;
      const dx = Math.max(Math.abs(local.x - cx) - hw, 0);
      const dy = Math.max(Math.abs(local.y - cy) - hh, 0);
      const dz = Math.max(Math.abs(local.z - cz) - hd, 0);
      const outside = Math.hypot(dx, dy, dz);
      const centerDist = Math.hypot(local.x - cx, local.y - cy, local.z - cz);
      const score = outside > 1e-6 ? outside + 0.01 : centerDist * 0.001;
      if (score < bestScore) {
        bestScore = score;
        bestId = child.id;
      }
    }
    return bestId ? { bodyId: body.id, featureId: bestId } : null;
  }, []);

  const pickSketchFaceAt = useCallback((clientX: number, clientY: number): SketchFacePickOutcome | null => {
    const state = threeRef.current;
    if (!state) return null;

    const faceHit = raycastSketchFaceHit(state, shapesRef.current, clientX, clientY);
    if (faceHit) {
      if (faceHit.classification.kind === "curved") {
        return {
          ok: false,
          reason: faceHit.classification.blockedReason
            ?? "That face is curved — pick a flat end, another flat face, or the workplane",
        };
      }
      if (faceHit.classification.plane) {
        return { ok: true, plane: faceHit.classification.plane };
      }
      return {
        ok: true,
        plane: sketchPlaneFromThreeVectors(faceHit.hit.point, faceHit.worldNormal, faceHit.shapeId),
      };
    }

    const plane = defaultSketchPlane();
    plane.origin = { x: 0, y: 0, z: 0 };
    return { ok: true, plane };
  }, []);

  const updateSketchFaceHover = useCallback((clientX: number, clientY: number) => {
    const state = threeRef.current;
    if (!state || !sketchFacePickModeRef.current) return;
    const faceHit = raycastSketchFaceHit(state, shapesRef.current, clientX, clientY);
    sketchFaceHoverKeyRef.current = syncSketchFaceHighlight(state, faceHit, sketchFaceHoverKeyRef.current);
    setSketchFaceHovering(Boolean(faceHit));
    setSketchFaceHoverBlocked(Boolean(faceHit && faceHit.classification.kind === "curved"));
  }, []);

  const clearSketchFaceHover = useCallback(() => {
    sketchFaceHoverKeyRef.current = null;
    setSketchFaceHovering(false);
    setSketchFaceHoverBlocked(false);
    clearSketchFaceHighlight(threeRef.current);
  }, []);

  /** Frontmost hit on a single click; a quick second click cycles through overlapping shapes. */
  const resolveClickSelection = useCallback(
    (clientX: number, clientY: number, additive: boolean, cycle: boolean) => {
      const hits = pickShapesAt(clientX, clientY);
      if (hits.length === 0) {
        return null;
      }
      if (additive || hits.length === 1 || !cycle) {
        return hits[0];
      }
      const selected = selectedIdsRef.current;
      if (selected.length === 1) {
        const index = hits.indexOf(selected[0]);
        if (index >= 0) {
          return hits[(index + 1) % hits.length];
        }
      }
      return hits[0];
    },
    [pickShapesAt],
  );

  const rememberStackClick = useCallback((clientX: number, clientY: number, selectedId: string, hits: string[]) => {
    lastStackClickRef.current = { time: performance.now(), x: clientX, y: clientY, selectedId, hits };
  }, []);

  const noteStackClickAt = useCallback(
    (clientX: number, clientY: number) => {
      const hits = pickShapesAt(clientX, clientY);
      if (hits.length === 0) {
        lastStackClickRef.current = null;
        return;
      }
      const selectedId = selectedIdsRef.current.find((id) => hits.includes(id))
        ?? lastStackClickRef.current?.selectedId
        ?? hits[0];
      rememberStackClick(clientX, clientY, selectedId, hits);
    },
    [pickShapesAt, rememberStackClick],
  );

  /**
   * Pointerdown.detail is not a click count in Chromium, so we detect stack
   * cycling from time + the same hit list ourselves. Must run before handle
   * picking — the first click shows gizmos that would otherwise swallow the second.
   */
  const tryCycleStackedSelection = useCallback(
    (clientX: number, clientY: number) => {
      const picked = pickShapesAt(clientX, clientY);
      // A click on empty space never cycles: it clears the selection, even right after a
      // click on stacked parts (otherwise it kept swapping between them).
      if (picked.length === 0) {
        lastStackClickRef.current = null;
        return false;
      }
      const last = lastStackClickRef.current;
      const hits = picked.length >= 2 ? picked : last?.hits ?? picked;
      const recent = Boolean(last && performance.now() - last.time <= 700);
      const sameStack = Boolean(last && hits.includes(last.selectedId));
      const nearby = Boolean(last && Math.hypot(clientX - last.x, clientY - last.y) <= 48);
      if (hits.length < 2 || !recent || !last || (!sameStack && !nearby)) {
        noteStackClickAt(clientX, clientY);
        return false;
      }
      const index = hits.indexOf(last.selectedId);
      const id = index >= 0 ? hits[(index + 1) % hits.length] : hits[0];
      rememberStackClick(clientX, clientY, id, hits);
      onSelectShape(id);
      return true;
    },
    [noteStackClickAt, onSelectShape, pickShapesAt, rememberStackClick],
  );

  const pickModifierEdge = useCallback((clientX: number, clientY: number) => {
    const state = threeRef.current;
    if (!state) return null;
    return pickModifierEdgeFromScreen(state, modifierEdgesRef.current, clientX, clientY);
  }, []);

  const updateModifierEdgeHover = useCallback((clientX: number, clientY: number) => {
    const edgeId = pickModifierEdge(clientX, clientY);
    setHoverModifierEdgeId((current) => (current === edgeId ? current : edgeId));
  }, [pickModifierEdge]);

  const clearModifierEdgeHover = useCallback(() => {
    setHoverModifierEdgeId((current) => (current === null ? current : null));
  }, []);

  const pickTransformHandle = useCallback((clientX: number, clientY: number) => {
    const state = threeRef.current;
    if (!state || selectedIdsRef.current.length !== 1) {
      return null;
    }

    const rect = state.renderer.domElement.getBoundingClientRect();
    state.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);

    const intersections = state.raycaster.intersectObjects(state.helperLayer.children, true);
    const hit = intersections.find((entry) => typeof entry.object.userData.transformHandle === "string");
    if (!hit) {
      return null;
    }

    return {
      id: hit.object.userData.shapeId as string,
      kind: hit.object.userData.transformHandle as TransformHandleKind,
      handleKey: (hit.object.userData.transformHandleKey as string | undefined) ?? (hit.object.userData.transformHandle as string),
      planeY: typeof hit.object.userData.transformPlaneY === "number" ? (hit.object.userData.transformPlaneY as number) : 0,
    };
  }, []);

  const pickShapeFaceAt = useCallback((clientX: number, clientY: number) => {
    const state = threeRef.current;
    if (!state) return null;
    const rect = state.renderer.domElement.getBoundingClientRect();
    state.camera.updateMatrixWorld();
    state.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const hits = preciseMeshHits(state, state.shapeLayer.children);
    for (const hit of hits) {
      if (!(hit.object instanceof THREE.Mesh)) continue;
      let shapeId: string | null = null;
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        const id = node.userData.shapeId;
        if (typeof id === "string" && shapesRef.current.some((shape) => shape.id === id)) shapeId = id;
        node = node.parent;
      }
      if (!shapeId) continue;
      const shape = shapesRef.current.find((item) => item.id === shapeId);
      if (!shape) continue;
      if (hit.face) {
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        const snapped = faceSnapNormal(normal);
        if (!snapped) continue;
        return {
          shapeId,
          point: [hit.point.x, hit.point.y, hit.point.z] as [number, number, number],
          normal: snapped,
        };
      }
      const box = snapAabbFromShape(shape);
      const sides = [
        { normal: [1, 0, 0] as [number, number, number], distance: Math.abs(hit.point.x - box.maxX) },
        { normal: [-1, 0, 0] as [number, number, number], distance: Math.abs(hit.point.x - box.minX) },
        { normal: [0, 1, 0] as [number, number, number], distance: Math.abs(hit.point.y - box.maxY) },
        { normal: [0, -1, 0] as [number, number, number], distance: Math.abs(hit.point.y - box.minY) },
        { normal: [0, 0, 1] as [number, number, number], distance: Math.abs(hit.point.z - box.maxZ) },
        { normal: [0, 0, -1] as [number, number, number], distance: Math.abs(hit.point.z - box.minZ) },
      ].sort((a, b) => a.distance - b.distance);
      return {
        shapeId,
        point: [hit.point.x, hit.point.y, hit.point.z] as [number, number, number],
        normal: sides[0].normal,
      };
    }
    return null;
  }, []);

  /**
   * Where a shape dragged in from the sidebar lands: on top of the part under the pointer when
   * the pointer is over an upward-facing surface, otherwise on the workplane.
   */
  const dropSpotAt = useCallback((clientX: number, clientY: number) => {
    const state = threeRef.current;
    if (state) {
      const rect = state.renderer.domElement.getBoundingClientRect();
      state.camera.updateMatrixWorld();
      state.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      state.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      state.raycaster.setFromCamera(state.pointer, state.camera);
      try {
        for (const hit of preciseMeshHits(state, state.shapeLayer.children)) {
          if (!(hit.object instanceof THREE.Mesh) || !hit.face) continue;
          let shapeId: string | null = null;
          for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
            const id = node.userData.shapeId;
            if (typeof id === "string") shapeId = id;
          }
          const shape = shapeId ? shapesRef.current.find((item) => item.id === shapeId) : undefined;
          if (!shape || shape.hidden) continue;
          // The first visible part the pointer meets decides: its top lands the shape, a wall does not.
          const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
          if (normal.y < 0.7 || hit.point.y <= 1e-4) break;
          return { x: hit.point.x, z: hit.point.z, elevation: Number(hit.point.y.toFixed(4)) };
        }
      } catch {
        // Fall back to the workplane.
      }
    }
    const point = toPlanePoint(clientX, clientY);
    return { x: point?.x ?? 0, z: point?.z ?? 0, elevation: 0 };
  }, [toPlanePoint]);

  const updateFaceSnapHover = useCallback((clientX: number, clientY: number) => {
    const state = threeRef.current;
    if (!state) return;
    const face = pickShapeFaceAt(clientX, clientY);
    const guide = textureGuideRef.current;
    if (guide) {
      // Texturing shows its own guides on the part, and nothing on other parts.
      syncFaceSnapHighlight(state, FACE_SNAP_HOVER_NAME, null, null, 0);
      const onPart = face && face.shapeId === guide.shape.id ? face : null;
      if (!onPart) {
        syncTextureHelper(state, TEXTURE_HOVER_NAME, null, null);
        return;
      }
      if (guide.mode === "faces") {
        const hover = textureHoverFace(guide.shape, onPart.point, onPart.normal);
        syncTextureHelper(state, TEXTURE_HOVER_NAME, hover?.key ?? null, hover?.build ?? null);
        return;
      }
      const texture = normalizeSurfaceTexture(guide.shape.surfaceTexture);
      // Over the picture already placed, the picture itself shows; a scroll there resizes it.
      if (textureDragRef.current === null && pointOnStamp(guide.shape, texture, onPart.point)) {
        syncTextureHelper(state, TEXTURE_HOVER_NAME, null, null);
        return;
      }
      const key = `ghost|${onPart.point.map((value) => value.toFixed(3)).join(",")}|${onPart.normal.map((value) => value.toFixed(3)).join(",")}|${texture.spacing}|${texture.angle}|${texture.depth}|${texture.image?.data.length ?? 0}`;
      syncTextureHelper(state, TEXTURE_HOVER_NAME, key, () => texturePictureGhost(guide.shape, texture, onPart.point, onPart.normal));
      return;
    }
    const locked = faceSnapSourceRef.current;
    const sameSide = Boolean(face && locked && face.shapeId === locked.shapeId && face.normal.every((value, index) => value === locked.normal[index]));
    const dropBlocked = Boolean(dropSurfaceActiveRef.current && face && selectedIdsRef.current.includes(face.shapeId));
    const highlight = face && !sameSide && !dropBlocked ? face : null;
    const shape = highlight ? shapesRef.current.find((item) => item.id === highlight.shapeId) ?? null : null;
    syncFaceSnapHighlight(state, FACE_SNAP_HOVER_NAME, shape, highlight, 0.28);
  }, [pickShapeFaceAt]);

  const clearFaceSnapHover = useCallback(() => {
    const state = threeRef.current;
    if (!state) return;
    syncFaceSnapHighlight(state, FACE_SNAP_HOVER_NAME, null, null, 0);
    syncTextureHelper(state, TEXTURE_HOVER_NAME, null, null);
  }, []);

  // The faces chosen so far stay tinted, and the guide under the mouse follows each change.
  useEffect(() => {
    const state = threeRef.current;
    if (!state) return;
    const shape = textureGuide?.mode === "faces" ? textureGuide.shape : null;
    const texture = shape ? normalizeSurfaceTexture(shape.surfaceTexture) : null;
    const key = shape && texture
      ? `chosen|${shape.id}|${JSON.stringify(texture.picks)}|${texture.depth}|${texture.direction}|${shape.x},${shape.z},${shape.elevation ?? 0},${shape.rotation},${shape.rotationX ?? 0},${shape.rotationZ ?? 0}`
      : null;
    syncTextureHelper(state, TEXTURE_CHOSEN_NAME, key, shape ? () => textureChosenFacesMesh(shape) : null);
    const pointer = lastPointerRef.current;
    if (textureGuide && pointer) updateFaceSnapHover(pointer.x, pointer.y);
    else syncTextureHelper(state, TEXTURE_HOVER_NAME, null, null);
    state.needsRender = true;
  }, [textureGuide, updateFaceSnapHover]);

  // Scrolling over a placed picture resizes it; anywhere else the view zooms as usual.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (event: WheelEvent) => {
      const guide = textureGuideRef.current;
      if (guide?.mode !== "place" || !onTextureWheelRef.current) return;
      const face = pickShapeFaceAt(event.clientX, event.clientY);
      if (!face || face.shapeId !== guide.shape.id) return;
      if (!onTextureWheelRef.current(face, event.deltaY)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    host.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => host.removeEventListener("wheel", onWheel, { capture: true });
  }, [pickShapeFaceAt]);

  useEffect(() => {
    const state = threeRef.current;
    if (!state) return;
    if (!faceSnapActive) {
      syncFaceSnapHighlight(state, FACE_SNAP_HOVER_NAME, null, null, 0);
      syncFaceSnapHighlight(state, FACE_SNAP_LOCK_NAME, null, null, 0);
      state.needsRender = true;
      return;
    }
    const source = faceSnapSource;
    const shape = source ? shapesRef.current.find((item) => item.id === source.shapeId) ?? null : null;
    syncFaceSnapHighlight(state, FACE_SNAP_LOCK_NAME, shape, source, 0.46);
    state.needsRender = true;
  }, [faceSnapActive, faceSnapSource]);

  useEffect(() => {
    const state = threeRef.current;
    if (!state) return;
    const name = "split-plane-preview";
    const previous = state.scene.getObjectByName(name);
    if (previous) {
      state.scene.remove(previous);
      previous.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((material) => material.dispose());
        }
      });
    }
    if (!splitPlane) {
      state.needsRender = true;
      return;
    }
    const geometry = new THREE.PlaneGeometry(Math.max(8, splitPlane.width), Math.max(8, splitPlane.height));
    const material = new THREE.MeshBasicMaterial({
      color: 0xc6a15b,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.name = name;
    plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...splitPlane.normal).normalize());
    plane.position.set(splitPlane.origin[0], splitPlane.origin[1], splitPlane.origin[2]);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x4a3414 }),
    );
    plane.add(edges);
    state.scene.add(plane);
    state.needsRender = true;
  }, [splitPlane]);

  useEffect(() => {
    if (!faceSnapMotionRef) return;
    faceSnapMotionRef.current = (shapeId, pose, done, motion) => {
      const state = threeRef.current;
      const object = state ? findShapeObject(state, shapeId) : null;
      const shape = shapesRef.current.find((item) => item.id === shapeId);
      if (!state || !object || !shape) {
        done();
        return;
      }
      syncFaceSnapHighlight(state, FACE_SNAP_HOVER_NAME, null, null, 0);
      syncFaceSnapHighlight(state, FACE_SNAP_LOCK_NAME, null, null, 0);
      const start = new THREE.Vector3(shape.x, (shape.elevation ?? 0) + shape.height / 2, shape.z);
      const end = new THREE.Vector3(pose.x, pose.elevation + shape.height / 2, pose.z);
      const startQuaternion = object.quaternion.clone();
      const endQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(pose.rotationX),
        THREE.MathUtils.degToRad(pose.rotation),
        THREE.MathUtils.degToRad(pose.rotationZ),
        "XYZ",
      ));
      const started = performance.now();
      const duration = Math.max(1, motion?.durationMs ?? 180);
      const lift = motion?.liftMm ?? 0;
      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / duration);
        // A quick snap eases out; a longer move eases in and out, and rises over its middle.
        const eased = motion?.durationMs ? (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2) : 1 - (1 - t) ** 3;
        object.position.lerpVectors(start, end, eased);
        if (lift) object.position.y += lift * Math.sin(Math.PI * eased);
        object.quaternion.slerpQuaternions(startQuaternion, endQuaternion, eased);
        object.updateMatrixWorld(true);
        state.needsRender = true;
        if (t < 1) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    };
    return () => {
      faceSnapMotionRef.current = null;
    };
  }, [faceSnapMotionRef]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = threeRef.current;
      if (!state) {
        return;
      }
      if (event.button !== 0 || event.ctrlKey || event.metaKey) {
        return;
      }
      const sketchSession = sketchOnModelRef.current;
      if (sketchSession) {
        event.preventDefault();
        event.stopPropagation();
        sketch3DPointerDown(
          { scene: state.scene, camera: state.camera, domElement: state.renderer.domElement, controls: state.controls },
          sketchSession,
          sketch3DPointerRef.current,
          event.clientX,
          event.clientY,
          event.pointerId,
          event.shiftKey,
        );
        event.currentTarget.setPointerCapture(event.pointerId);
        state.needsRender = true;
        publishSketchMeasure(sketchSession);
        return;
      }
      const host = event.currentTarget;
      // A large STEP import used to await a paint here so the "Selecting…" wheel could
      // show first. That yields the gesture: pointer moves arrive before the drag exists,
      // so the part never follows the mouse. Arrow keys never take this path.
      const heavyPick = isHeavyDisplayScene(shapesRef.current);
      if (heavyPick) {
        busyLabelRef.current = "Selecting…";
        busyUntilRef.current = performance.now() + 4000;
        flushSync(() => setBusyLabel("Selecting…"));
      }
      pickCacheRef.current = null;
      if (dropSurfaceActiveRef.current) {
        event.preventDefault();
        const face = pickShapeFaceAt(event.clientX, event.clientY);
        if (face) {
          onDropSurfacePickRef.current?.({ kind: "face", ...face });
          return;
        }
        if (toPlanePoint(event.clientX, event.clientY)) {
          onDropSurfacePickRef.current?.({ kind: "workplane" });
        }
        return;
      }
      if (faceSnapActiveRef.current) {
        event.preventDefault();
        const face = pickShapeFaceAt(event.clientX, event.clientY);
        if (face) onFaceSnapPickRef.current?.(face);
        // Pressing on the part while placing a picture puts it there, and dragging moves it.
        const guide = textureGuideRef.current;
        if (face && guide?.mode === "place" && face.shapeId === guide.shape.id) {
          textureDragRef.current = event.pointerId;
          host.setPointerCapture(event.pointerId);
          state.controls.enabled = false;
        }
        return;
      }
      const rect = (threeRef.current ?? state).renderer.domElement.getBoundingClientRect();
      try {

      // Alt+click picks a CSG feature inside a grouped body (inspector Features list).
      if (event.altKey && onSelectFeature) {
        const featureHit = pickCsgFeatureAt(event.clientX, event.clientY);
        if (featureHit) {
          event.preventDefault();
          onSelectShape(featureHit.bodyId);
          onSelectFeature(featureHit.featureId);
          return;
        }
      }

      const smoothOverlay = smoothEditRef.current;
      if (smoothOverlay?.pickingFace) {
        // Picking a face to keep flat: a click on the part picks it, a miss leaves the camera free.
        const live = threeRef.current ?? state;
        pointerWorldRay(live, event.clientX, event.clientY);
        const surface = surfaceHits(live)[0];
        if (!surface) return;
        event.preventDefault();
        const eye = live.camera.position;
        const toward = eye.clone().sub(surface.point).normalize();
        smoothCallbacksRef.current.onSmoothFacePick?.([surface.point.x, surface.point.y, surface.point.z], [toward.x, toward.y, toward.z]);
        return;
      }
      if (smoothOverlay) {
        const live = threeRef.current ?? state;
        const hit = pickSmoothPoint(live, smoothOverlay, event.clientX, event.clientY);
        // A miss leaves the camera free to orbit; without Shift it clears the selection.
        if (hit === null) {
          if (event.altKey) {
            // Alt-drag draws a box: every dot inside facing you is picked.
            event.preventDefault();
            const rect = live.renderer.domElement.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            smoothBoxRef.current = { pointerId: event.pointerId, startX: x, startY: y, currentX: x, currentY: y, additive: event.shiftKey };
            event.currentTarget.setPointerCapture?.(event.pointerId);
            live.controls.enabled = false;
            return;
          }
          if (!event.shiftKey) smoothCallbacksRef.current.onSmoothPointPick?.(null, false);
          return;
        }
        event.preventDefault();
        const wasSelected = smoothOverlay.selected.has(hit);
        if (event.shiftKey || !wasSelected) smoothCallbacksRef.current.onSmoothPointPick?.(hit, event.shiftKey);
        if (event.shiftKey && wasSelected) return;
        const dot = new THREE.Vector3(smoothOverlay.points[hit * 3], smoothOverlay.points[hit * 3 + 1], smoothOverlay.points[hit * 3 + 2]);
        const facing = new THREE.Vector3();
        live.camera.getWorldDirection(facing);
        // A drag moves the point across the screen; with Drag set to In and out, or Ctrl held,
        // it pulls straight out of the surface (or pushes in).
        const free = !(smoothOverlay.dragInOut || event.ctrlKey || event.metaKey);
        const normal = new THREE.Vector3(smoothOverlay.normals[hit * 3], smoothOverlay.normals[hit * 3 + 1], smoothOverlay.normals[hit * 3 + 2]);
        let plane = new THREE.Plane().setFromNormalAndCoplanarPoint(facing, dot);
        let out: { measure: THREE.Vector3; sign: number } | null = null;
        if (!free && normal.lengthSq() > 0.5) {
          const side = facing.clone().addScaledVector(normal, -facing.dot(normal));
          if (side.length() > 0.3) {
            // The pointer runs along the line out of the surface, on the plane through it that faces you most.
            plane = new THREE.Plane().setFromNormalAndCoplanarPoint(side.normalize(), dot);
            out = { measure: normal, sign: 1 };
          } else {
            // Looking straight at the surface: dragging up pulls it toward you, down pushes it in.
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(live.camera.quaternion);
            out = { measure: up, sign: normal.dot(facing) < 0 ? 1 : -1 };
          }
        }
        smoothDragRef.current = { pointerId: event.pointerId, plane, start: smoothPlanePoint(live, plane, event.clientX, event.clientY) ?? dot, out, delta: out ? 0 : [0, 0, 0] };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        live.controls.enabled = false;
        smoothCallbacksRef.current.onSmoothDragStart?.();
        return;
      }

      if (pushPullActiveRef.current) {
        event.preventDefault();
        const live = threeRef.current ?? state;
        const ray = pointerWorldRay(live, event.clientX, event.clientY);
        const faceId = pickPlanarFaceId(pushPullFacesRef.current, ray.origin, ray.dir);
        if (facePickOnlyRef.current) {
          if (faceId === null) onPushPullFaceMissRef.current?.();
          else onPushPullFacePickRef.current?.(faceId);
          return;
        }
        if (faceId === null) return;
        const face = pushPullFacesRef.current.find((entry) => entry.id === faceId);
        if (!face) return;
        pushPullDragRef.current = {
          faceId,
          pointerId: event.pointerId,
          startPx: canvasPx(live, event.clientX, event.clientY),
          axis: pushPullDragAxis(live, face),
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        live.controls.enabled = false;
        setPushPullDragging(true);
        onPushPullDragStartRef.current?.(faceId, 0);
        return;
      }

      if (modifierActive) {
        event.preventDefault();
        const edgeId = pickModifierEdge(event.clientX, event.clientY);
        if (edgeId !== null) onModifierEdgeToggle?.(edgeId, event.shiftKey);
        return;
      }

      if (sketchFacePickModeRef.current) {
        event.preventDefault();
        const outcome = pickSketchFaceAt(event.clientX, event.clientY);
        clearSketchFaceHover();
        if (!outcome) return;
        if (outcome.ok) {
          onSketchPlanePickedRef.current?.(outcome.plane);
        } else {
          onSketchFacePickRejectedRef.current?.(outcome.reason);
        }
        return;
      }

      if (circularPatternModeRef.current) {
        const patternHandle = pickTransformHandle(event.clientX, event.clientY);
        if (!patternHandle) {
          event.preventDefault();
          // A shape under the cursor sets the center to its middle; the bare workplane, to the spot.
          const hitId = pickShape(event.clientX, event.clientY);
          if (hitId && onCircularPatternShapePickRef.current?.(hitId)) return;
          const point = toPlanePoint(event.clientX, event.clientY);
          if (point) onCircularPatternCenterPickRef.current?.(point);
          return;
        }
      }

      if (rulerDeleteModeRef.current) {
        event.preventDefault();
        return;
      }

      if (rulerMoveModeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (placementRulerModeRef.current) {
        event.preventDefault();
        const id = pickShape(event.clientX, event.clientY);
        if (id) {
          onSelectShape(id);
        }
        return;
      }

      if (rulerModeRef.current) {
        event.preventDefault();
        const candidate = resolveRulerCandidate(event.clientX, event.clientY);
        if (candidate) {
          selectRulerCandidate(candidate);
        }
        return;
      }

      if (!event.shiftKey && tryCycleStackedSelection(event.clientX, event.clientY)) {
        event.preventDefault();
        return;
      }

      const handle = pickTransformHandle(event.clientX, event.clientY);
      if (handle) {
        const shape = shapesRef.current.find((entry) => entry.id === handle.id);
        const frame = selectionFrameForShapes(shapesRef.current, selectedIdsRef.current);
        const scalePlane = handle.kind === "scale" && frame ? localResizePlaneForFrame(frame) : undefined;
        const scaleStartPoint = scalePlane ? toRawPlanePoint(event.clientX, event.clientY, scalePlane) ?? undefined : undefined;
        const point = scalePlane ? scaleStartPoint : toPlanePoint(event.clientX, event.clientY);
        if (!shape || !frame || shape.locked || (!point && handle.kind !== "height" && handle.kind !== "lift" && handle.kind !== "rotate")) {
          return;
        }
        const yBounds = selectionWorldYBounds(frame);
        const handlesLowerSide = handle.handleKey === "bottom-height" || handle.handleKey === "lower-shape";
        const yStart = handlesLowerSide ? yBounds.min : yBounds.max;
        const liftOffset = handle.kind === "lift" ? Math.max(2, yBounds.height * 0.08) * (handlesLowerSide ? -1 : 1) : 0;
        const startWorldY = yStart + liftOffset;
        const overlay = transformOverlayRef.current;
        const rotationAxis = resolveRotationAxis(handle.handleKey, state, frame);
        const resizeHandleKey = handle.handleKey;
        const scaleSigns = handle.kind === "scale" ? resizeSignsForHandle(resizeHandleKey) : undefined;
        const scaleAnchorPoint = handle.kind === "scale" && scaleSigns ? resizeAnchorPointForFrame(frame, scaleSigns) : undefined;
        const wheel = handle.kind === "rotate" ? (overlay?.rotationWheels[rotationAxis] ?? overlay?.rotationWheel ?? undefined) : undefined;
        const rotationPlane = handle.kind === "rotate" ? overlay?.rotationPlanes[rotationAxis] : undefined;
        const rotationPlaneCenterData = handle.kind === "rotate" ? overlay?.rotationPlaneCenters[rotationAxis] : undefined;
        const rotationPlaneCenter = rotationPlaneCenterData
          ? new THREE.Vector3(rotationPlaneCenterData.x, rotationPlaneCenterData.y, rotationPlaneCenterData.z)
          : frame.center.clone();
        const localClientX = event.clientX - rect.left;
        const localClientY = event.clientY - rect.top;
        const axisVector = rotationAxisVectorForFrame(handle.handleKey, frame, rotationAxis);
        const pivot = frame.center.clone();
        const rotationCenter = handle.kind === "rotate" ? wheel ?? projectToScreen(pivot, state) : undefined;
        const rotationStartPoint = handle.kind === "rotate" ? rayPointOnRotationPlane(state, event.clientX, event.clientY, rotationPlaneCenter, axisVector) : null;
        const rotationStartVector = rotationStartPoint ? rotationStartPoint.sub(rotationPlaneCenter) : undefined;
        rememberResizeAnchor(handle.id, handle.kind, resizeHandleKey);
        event.preventDefault();
        host.setPointerCapture(event.pointerId);
        setEditingRotation(null);
        setPinnedMeasureKey(measureKeyForHandle(handle.kind, handle.handleKey, transformOverlayRef.current));
        if (handle.kind === "height") {
          setHoverMeasureKey(null);
        }
        setActiveRotationWheel(handle.kind === "rotate");
        setActiveTransformKind(handle.kind);
        setSelectionHelpersVisible(state, handle.kind !== "rotate");
        if (handle.kind === "rotate") {
          setRotationWheelAxis(rotationAxis);
          setPinnedRotationWheelView(wheel && rotationPlane ? { axis: rotationAxis, wheel: { ...wheel }, plane: { ...rotationPlane } } : null);
        } else {
          setPinnedRotationWheelView(null);
        }
        transformRef.current = {
          id: handle.id,
          ids: frame.ids,
          kind: handle.kind,
          handleKey: resizeHandleKey,
          rotationAxis,
          pointerId: event.pointerId,
          startShape: { ...shape },
          items: frame.ids
            .map((id) => shapesRef.current.find((entry) => entry.id === id))
            .filter((entry): entry is WorkplaneShape => Boolean(entry))
            .map((entry) => ({
              id: entry.id,
              startShape: { ...entry },
              startCenter: shapeCenter(entry),
              startQuaternion: quaternionForShape(entry),
            })),
          selectionFrame: frame,
          startScreenAngle: rotationCenter ? screenAngle(localClientX, localClientY, rotationCenter) : 0,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startScreenY: projectedScreenYAt(state, frame.center.x, frame.center.z, startWorldY),
          startWorldY,
          handleWorldOffset: liftOffset,
          screenYPerWorldUnit: projectedScreenYPerWorldUnitAt(state, frame.center.x, frame.center.z, startWorldY),
          scalePlaneY: handle.kind === "scale" ? handle.planeY : 0,
          scalePlane,
          scaleSigns,
          scaleAnchorPoint,
          scaleStartPoint,
          rotationAxisVector: handle.kind === "rotate" ? axisVector : undefined,
          rotationPivot: handle.kind === "rotate" ? pivot : undefined,
          rotationPlaneCenter: handle.kind === "rotate" ? rotationPlaneCenter : undefined,
          rotationStartVector: handle.kind === "rotate" ? rotationStartVector : undefined,
          rotationScreenCenter: rotationCenter,
          rotationScreenSign: handle.kind === "rotate" ? rotationScreenSign(axisVector, state.camera) : 1,
          rotationStartQuaternion: handle.kind === "rotate" ? quaternionForShape(shape) : undefined,
          wheelCenter: wheel,
        };
        if (handle.kind === "rotate") {
          const localX = event.clientX - rect.left;
          const localY = event.clientY - rect.top;
          setRotationReadout(rotationReadoutAtPointer(wheel, localX, localY, 0));
        } else if (handle.kind === "lift") {
          setRotationReadout({
            x: event.clientX - rect.left + 22,
            y: event.clientY - rect.top - 34,
            text: formatMeasure(yBounds.min, workspaceRef.current),
          });
        } else {
          setRotationReadout(null);
        }
        clearCutPreviewOverlays(state);
        state.needsRender = true;
        state.controls.enabled = false;
        onInteractionActiveChange?.(true);
        return;
      }

      const additive = event.shiftKey;
      const id = resolveClickSelection(event.clientX, event.clientY, additive, false);
      if (!id) {
        lastStackClickRef.current = null;
        const startX = event.clientX - rect.left;
        const startY = event.clientY - rect.top;
        event.preventDefault();
        setEditingRotation(null);
        setActiveRotationWheel(false);
        host.setPointerCapture(event.pointerId);
        // A still click clears selection on release. The box is drawn only after a real drag.
        marqueeRef.current = {
          pointerId: event.pointerId,
          startX,
          startY,
          currentX: startX,
          currentY: startY,
          additive,
          hasMoved: false,
        };
        state.controls.enabled = false;
        onInteractionActiveChange?.(true);
        return;
      }

      const shape = shapesRef.current.find((entry) => entry.id === id);
      const selectedIdsSnapshot = selectedIdsRef.current;
      if (alignModeRef.current && selectedIdsSnapshot.includes(id)) {
        event.preventDefault();
        onAlignAnchorChange(id);
        return;
      }
      const dragPlaneY = shape ? shape.elevation ?? 0 : 0;
      const point = toPlanePointAtY(event.clientX, event.clientY, dragPlaneY);
      if (!shape) {
        return;
      }
      if (!point) {
        // Side views look level with the shape's base, so the drag plane is out of reach.
        // The click still selects; it just cannot start a move.
        event.preventDefault();
        if (additive) onSelectShape(id, "toggle");
        else if (!selectedIdsSnapshot.includes(id)) onSelectShape(id);
        return;
      }

      event.preventDefault();
      rememberStackClick(event.clientX, event.clientY, id, pickShapesAt(event.clientX, event.clientY));
      const alreadySelected = selectedIdsSnapshot.includes(id);
      if (additive) {
        onSelectShape(id, "toggle");
        return;
      }
      // Keep a multi-selection when clicking a shape that is already part of it.
      // Only replace selection when clicking a shape outside the current set (or cycling).
      if (!alreadySelected) {
        onSelectShape(id);
      }
      if (shape.locked) {
        return;
      }
      setEditingRotation(null);
      setActiveRotationWheel(false);
      host.setPointerCapture(event.pointerId);
      const dragIds = alreadySelected && selectedIdsSnapshot.length > 1 ? selectedIdsSnapshot : [id];
      const items = dragIds
        .map((dragId) => {
          const dragShape = shapesRef.current.find((entry) => entry.id === dragId);
          if (!dragShape || dragShape.locked) {
            return null;
          }
          const helper = findSelectionHelper(state, dragId);
          return {
            id: dragId,
            startX: dragShape.x,
            startZ: dragShape.z,
            nextX: dragShape.x,
            nextZ: dragShape.z,
            visual: findShapeObject(state, dragId),
            helper,
            helperBox: helper ? helper.box.clone() : null,
            hadPreviewSimplified: false,
          };
        })
        .filter((item): item is DragItem => Boolean(item));
      if (items.length === 0) {
        return;
      }
      dragRef.current = {
        primaryId: id,
        offsetX: shape.x - point.x,
        offsetZ: shape.z - point.z,
        planeY: dragPlaneY,
        pointerId: event.pointerId,
        primaryStartX: shape.x,
        primaryStartZ: shape.z,
        items,
      };
      clearCutPreviewOverlays(state);
      state.needsRender = true;
      state.controls.enabled = false;
      onInteractionActiveChange?.(true);
      } finally {
        if (heavyPick) {
          busyLabelRef.current = null;
          busyUntilRef.current = 0;
          setBusyLabel(null);
        }
      }
    },
    [
      modifierActive,
      onAlignAnchorChange,
      onInteractionActiveChange,
      onModifierEdgeToggle,
      onSelectFeature,
      onSelectShape,
      pickCsgFeatureAt,
      pickModifierEdge,
      pickShape,
      pickShapeFaceAt,
      pickShapesAt,
      pickSketchFaceAt,
      clearSketchFaceHover,
      pickTransformHandle,
      rememberStackClick,
      resolveClickSelection,
      resolveRulerCandidate,
      tryCycleStackedSelection,
      selectRulerCandidate,
      toPlanePoint,
      toPlanePointAtY,
      toRawPlanePoint,
      publishSketchMeasure,
    ],
  );

  /** In X-ray, the wall or gap under the pointer on the cut, with its size beside the pointer. */
  const showSectionMeasure = useCallback((state: ThreeState, point: { x: number; y: number } | null) => {
    const result = point ? xraySectionMeasure(state, point.x, point.y) : measureSectionAt(state.sectionCapLayer, null);
    if (!result) {
      if (sectionMeasureShownRef.current) {
        sectionMeasureShownRef.current = false;
        setSectionMeasureLabel(null);
        state.needsRender = true;
      }
      return;
    }
    sectionMeasureShownRef.current = true;
    state.needsRender = true;
    const rect = state.renderer.domElement.getBoundingClientRect();
    setSectionMeasureLabel({
      left: point!.x - rect.left + 16,
      top: point!.y - rect.top + 16,
      text: `${result.kind === "wall" ? "Wall" : "Gap"} ${result.length.toFixed(2)} mm`,
    });
  }, []);

  const scheduleShapeHover = useCallback((clientX: number, clientY: number) => {
    shapeHoverPointRef.current = { x: clientX, y: clientY };
    if (shapeHoverFrameRef.current !== null) return;
    shapeHoverFrameRef.current = window.requestAnimationFrame(() => {
      shapeHoverFrameRef.current = null;
      const state = threeRef.current;
      const point = shapeHoverPointRef.current;
      if (!state || orbitingRef.current || modifierActiveRef.current || pushPullActiveRef.current || rulerModeRef.current || rulerMoveModeRef.current || sketchFacePickModeRef.current || placementRulerModeRef.current || dragRef.current || marqueeRef.current || transformRef.current) {
        if (shapeHoverIdRef.current) {
          shapeHoverIdRef.current = null;
          if (state) showShapeHoverOutline(state, null);
        }
        if (state) showSectionMeasure(state, null);
        return;
      }
      showSectionMeasure(state, point);
      const id = pickShapesAt(point.x, point.y)[0] ?? null;
      const next = id && !selectedIdsRef.current.includes(id) ? id : null;
      if (next === shapeHoverIdRef.current) return;
      shapeHoverIdRef.current = next;
      showShapeHoverOutline(state, next);
    });
  }, [pickShapesAt, showSectionMeasure]);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const sketchSession = sketchOnModelRef.current;
      const sketchState = threeRef.current;
      if (sketchSession && sketchState) {
        sketch3DPointerMove(
          { scene: sketchState.scene, camera: sketchState.camera, domElement: sketchState.renderer.domElement, controls: sketchState.controls },
          sketchSession,
          sketch3DPointerRef.current,
          event.clientX,
          event.clientY,
          event.shiftKey,
        );
        sketchState.needsRender = true;
        publishSketchMeasure(sketchSession);
        return;
      }
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      if (textureDragRef.current === event.pointerId) {
        // Once a frame is plenty: each move rebuilds the picture's preview.
        if (textureDragFrameRef.current === null) {
          const x = event.clientX;
          const y = event.clientY;
          textureDragFrameRef.current = window.requestAnimationFrame(() => {
            textureDragFrameRef.current = null;
            const guide = textureGuideRef.current;
            const face = pickShapeFaceAt(x, y);
            if (guide && face && face.shapeId === guide.shape.id) onFaceSnapPickRef.current?.(face);
          });
        }
      }
      if (faceSnapActiveRef.current) {
        updateFaceSnapHover(event.clientX, event.clientY);
      }
      const smoothBox = smoothBoxRef.current;
      if (smoothBox && event.pointerId === smoothBox.pointerId) {
        const live = threeRef.current;
        if (!live) return;
        const rect = live.renderer.domElement.getBoundingClientRect();
        smoothBox.currentX = event.clientX - rect.left;
        smoothBox.currentY = event.clientY - rect.top;
        setMarqueeRect({
          left: Math.min(smoothBox.startX, smoothBox.currentX),
          top: Math.min(smoothBox.startY, smoothBox.currentY),
          width: Math.abs(smoothBox.currentX - smoothBox.startX),
          height: Math.abs(smoothBox.currentY - smoothBox.startY),
        });
        return;
      }
      const smoothDrag = smoothDragRef.current;
      if (smoothDrag && event.pointerId === smoothDrag.pointerId) {
        const live = threeRef.current;
        const point = live ? smoothPlanePoint(live, smoothDrag.plane, event.clientX, event.clientY) : null;
        if (!point) return;
        const delta: [number, number, number] = [point.x - smoothDrag.start.x, point.y - smoothDrag.start.y, point.z - smoothDrag.start.z];
        if (smoothDrag.out) {
          const { measure, sign } = smoothDrag.out;
          smoothDrag.delta = sign * (delta[0] * measure.x + delta[1] * measure.y + delta[2] * measure.z);
          smoothCallbacksRef.current.onSmoothDrag?.(smoothDrag.delta);
          return;
        }
        // Shift keeps the pull to the one direction it mostly runs in.
        if (event.shiftKey) {
          const axis = [0, 1, 2].reduce((best, k) => (Math.abs(delta[k]) > Math.abs(delta[best]) ? k : best), 0);
          for (let k = 0; k < 3; k += 1) if (k !== axis) delta[k] = 0;
        }
        smoothDrag.delta = delta;
        smoothCallbacksRef.current.onSmoothDrag?.(delta);
        return;
      }
      if (pushPullActiveRef.current) {
        const live = threeRef.current;
        if (!live) return;
        const ray = pointerWorldRay(live, event.clientX, event.clientY);
        const drag = pushPullDragRef.current;
        if (drag) {
          onPushPullDragRef.current?.(pushPullDistanceFromDrag(drag.axis, drag.startPx, canvasPx(live, event.clientX, event.clientY)));
          return;
        }
        const faceId = pickPlanarFaceId(pushPullFacesRef.current, ray.origin, ray.dir);
        onPushPullHoverRef.current?.(faceId);
        return;
      }
      if (modifierActiveRef.current) {
        updateModifierEdgeHover(event.clientX, event.clientY);
        return;
      }
      if (sketchFacePickModeRef.current) {
        updateSketchFaceHover(event.clientX, event.clientY);
        return;
      }
      if (placementRulerModeRef.current) {
        return;
      }
      if (rulerModeRef.current) {
        updateRulerHover(event.clientX, event.clientY);
        return;
      }
      if (rulerMoveModeRef.current) return;
      if (!transformRef.current && !marqueeRef.current && !dragRef.current) {
        scheduleShapeHover(event.clientX, event.clientY);
      } else if (shapeHoverIdRef.current && threeRef.current) {
        shapeHoverIdRef.current = null;
        showShapeHoverOutline(threeRef.current, null);
      }
      const transform = transformRef.current;
      if (transform) {
        updateTransform(event.clientX, event.clientY, event.shiftKey, event.altKey);
        if (threeRef.current) {
          threeRef.current.needsRender = true;
        }
        return;
      }

      const marquee = marqueeRef.current;
      if (marquee) {
        if (event.pointerId !== marquee.pointerId) {
          return;
        }
        const state = threeRef.current;
        if (!state) {
          return;
        }
        const rect = state.renderer.domElement.getBoundingClientRect();
        marquee.currentX = event.clientX - rect.left;
        marquee.currentY = event.clientY - rect.top;
        marquee.hasMoved = marquee.hasMoved || Math.hypot(marquee.currentX - marquee.startX, marquee.currentY - marquee.startY) > 5;
        if (marquee.hasMoved) {
          setMarqueeFromState(marquee);
        }
        return;
      }

      const drag = dragRef.current;
      if (!drag) {
        return;
      }

      const point = toPlanePointAtY(event.clientX, event.clientY, drag.planeY);
      if (!point) {
        return;
      }

      // A pointer that skims the horizon intersects the drag plane kilometres
      // away. Keep the dragged body within a plate-and-a-half of the origin so a
      // slip can't fling it (and the camera framing) out of reach.
      const moveLimit = Math.max(workspaceRef.current.width, workspaceRef.current.depth) * 1.5 + 100;
      const primaryNextX = clamp(point.x + drag.offsetX, -moveLimit, moveLimit);
      const primaryNextZ = clamp(point.z + drag.offsetZ, -moveLimit, moveLimit);
      let deltaX = primaryNextX - drag.primaryStartX;
      let deltaZ = primaryNextZ - drag.primaryStartZ;

      // Shift locks move to one screen axis (horizontal or vertical in the current view).
      if (event.shiftKey) {
        const camera = threeRef.current?.camera;
        if (camera) {
          const axes = computeViewNudgeAxes(camera);
          const alongRight = deltaX * axes.rightX + deltaZ * axes.rightZ;
          const alongUp = deltaX * axes.upX + deltaZ * axes.upZ;
          if (Math.abs(alongRight) >= Math.abs(alongUp)) {
            deltaX = alongRight * axes.rightX;
            deltaZ = alongRight * axes.rightZ;
          } else {
            deltaX = alongUp * axes.upX;
            deltaZ = alongUp * axes.upZ;
          }
        } else if (Math.abs(deltaX) >= Math.abs(deltaZ)) {
          deltaZ = 0;
        } else {
          deltaX = 0;
        }
      }

      if (!event.altKey) {
        const movingIds = new Set(drag.items.map((item) => item.id));
        const movingBoxes = drag.items.flatMap((item) => {
          const shape = shapesRef.current.find((entry) => entry.id === item.id);
          if (!shape || shape.hidden) return [];
          return [snapAabbFromShape({ ...shape, x: item.startX, z: item.startZ })];
        });
        const moving = unionSnapAabbs(movingBoxes);
        const targets = shapesRef.current
          .filter((shape) => !movingIds.has(shape.id) && !shape.hidden && !shape.suppressed && !shape.locked)
          .map(snapAabbFromShape);
        const snapped = moving
          ? snapMovingAabb(moving, targets, { x: deltaX, z: deltaZ }, objectSnapTolerance(snapStep(snapRef.current)))
          : null;
        if (snapped) {
          deltaX = snapped.deltaX;
          deltaZ = snapped.deltaZ;
          setObjectSnapGuide(snapped);
        } else {
          setObjectSnapGuide(null);
        }
      } else {
        setObjectSnapGuide(null);
      }

      drag.items.forEach((item) => {
        item.nextX = item.startX + deltaX;
        item.nextZ = item.startZ + deltaZ;
        if (threeRef.current) applyDragItemPreview(threeRef.current, item);
      });
      if (!drag.shadowsHidden && Math.hypot(deltaX, deltaZ) > 0.4) {
        hideDragShadows(drag);
        if (threeRef.current) markShadowsDirty(threeRef.current);
      }
      if (threeRef.current) {
        const previewShapes = previewShapesForDrag(shapesRef.current, drag);
        updateSelectedGroundFootprintPreviews(threeRef.current, drag);
        const now = performance.now();
        if (now - threeRef.current.lastOverlaySync >= 48) {
          syncTransformOverlay(
            threeRef.current,
            previewShapes,
            selectedIdsRef.current,
            transformOverlayRef,
            setTransformOverlay,
            workspaceRef.current,
            true,
          );
          threeRef.current.lastOverlaySync = now;
        }
        threeRef.current.needsRender = true;
      }
    },
    [publishSketchMeasure, scheduleShapeHover, setMarqueeFromState, toPlanePointAtY, updateModifierEdgeHover, updateRulerHover, updateSketchFaceHover, updateTransform],
  );

  const handlePointerLeave = useCallback(() => {
    lastPointerRef.current = null;
    clearFaceSnapHover();
    if (shapeHoverFrameRef.current !== null) {
      window.cancelAnimationFrame(shapeHoverFrameRef.current);
      shapeHoverFrameRef.current = null;
    }
    if (shapeHoverIdRef.current && threeRef.current) {
      shapeHoverIdRef.current = null;
      showShapeHoverOutline(threeRef.current, null);
    }
    if (threeRef.current) showSectionMeasure(threeRef.current, null);
    if (modifierActiveRef.current) clearModifierEdgeHover();
    if (pushPullActiveRef.current && !pushPullDragRef.current) onPushPullHoverRef.current?.(null);
    if (sketchFacePickModeRef.current) clearSketchFaceHover();
  }, [clearModifierEdgeHover, clearSketchFaceHover, showSectionMeasure]);

  const handleLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (textureDragRef.current === event.pointerId) {
      textureDragRef.current = null;
      if (threeRef.current) threeRef.current.controls.enabled = true;
    }
    const marquee = marqueeRef.current;
    if (marquee) {
      let hostStillCapturing = false;
      try {
        hostStillCapturing = event.currentTarget.hasPointerCapture(marquee.pointerId);
      } catch {
        hostStillCapturing = false;
      }
      // OrbitControls releases the canvas while the workplane host still owns the gesture.
      if (hostStillCapturing) {
        return;
      }
      if (!marquee.hasMoved && !marquee.additive) {
        onSelectShape(null);
      }
    }
    if (transformRef.current || dragRef.current || marqueeRef.current) {
      cancelActiveInteraction();
    }
  }, [cancelActiveInteraction, onSelectShape]);

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (textureDragRef.current === event.pointerId) {
        textureDragRef.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (threeRef.current) threeRef.current.controls.enabled = true;
        return;
      }
      const smoothBox = smoothBoxRef.current;
      if (smoothBox && event.pointerId === smoothBox.pointerId) {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        smoothBoxRef.current = null;
        setMarqueeRect(null);
        const live = threeRef.current;
        const overlay = smoothEditRef.current;
        if (live) live.controls.enabled = true;
        if (live && overlay) {
          const picked = smoothPointsInBox(live, overlay, {
            left: Math.min(smoothBox.startX, smoothBox.currentX),
            top: Math.min(smoothBox.startY, smoothBox.currentY),
            right: Math.max(smoothBox.startX, smoothBox.currentX),
            bottom: Math.max(smoothBox.startY, smoothBox.currentY),
          });
          smoothCallbacksRef.current.onSmoothBoxSelect?.(picked, smoothBox.additive);
        }
        return;
      }
      const smoothDrag = smoothDragRef.current;
      if (smoothDrag && event.pointerId === smoothDrag.pointerId) {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        smoothDragRef.current = null;
        if (threeRef.current) threeRef.current.controls.enabled = true;
        smoothCallbacksRef.current.onSmoothDragEnd?.(smoothDrag.delta);
        return;
      }
      const pushPullDrag = pushPullDragRef.current;
      if (pushPullDrag && event.pointerId === pushPullDrag.pointerId) {
        const live = threeRef.current;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        pushPullDragRef.current = null;
        setPushPullDragging(false);
        if (live) live.controls.enabled = true;
        if (live) {
          onPushPullDragEndRef.current?.(pushPullDistanceFromDrag(pushPullDrag.axis, pushPullDrag.startPx, canvasPx(live, event.clientX, event.clientY)));
        } else {
          onPushPullDragEndRef.current?.(pushPullDistanceRef.current);
        }
        return;
      }
      const sketchSession = sketchOnModelRef.current;
      if (sketchSession && sketch3DPointerRef.current.gesture) {
        sketch3DPointerUp(sketchSession, sketch3DPointerRef.current);
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        const sketchState = threeRef.current;
        if (sketchState) {
          syncSketchOnModel(
            { scene: sketchState.scene, camera: sketchState.camera, domElement: sketchState.renderer.domElement, controls: sketchState.controls },
            sketchSession,
            sketch3DPointerRef.current,
          );
          sketchState.needsRender = true;
        }
        publishSketchMeasure(sketchSession);
        return;
      }
      const state = threeRef.current;
      const transform = transformRef.current;
      if (transform) {
        if (event.currentTarget.hasPointerCapture(transform.pointerId)) {
          event.currentTarget.releasePointerCapture(transform.pointerId);
        }
        if (transform.kind === "lift") {
          setPinnedMeasureKey(getElevationMeasureKey(transformOverlayRef.current));
        }
        if (transform.kind === "lift" && transform.hasMoved) {
          suppressLiftEditAfterDrag();
        }
        const openedRotationEditor = transform.kind === "rotate" && Boolean(transform.hasMoved);
        if (openedRotationEditor) {
          suppressRotationEditAfterDrag();
        }
        transformRef.current = null;
        setActiveTransformKind(null);
        if (!openedRotationEditor) {
          setActiveRotationWheel(false);
          setPinnedRotationWheelView(null);
          setRotationReadout(null);
        }
        if (state) {
          syncCutPreviewOverlays(state, shapesRef.current);
          setSelectionHelpersVisible(state, true);
          state.controls.enabled = true;
          state.needsRender = true;
        }
        onInteractionActiveChange?.(false);
        if (openedRotationEditor) {
          openRotationEditorAfterDrag(transform);
        }
        return;
      }

      const marquee = marqueeRef.current;
      if (marquee) {
        // Apply click vs drag before release. Releasing capture fires lostpointercapture
        // immediately, and that handler used to drop the gesture before selection updated.
        marqueeRef.current = null;
        setMarqueeFromState(null);
        if (marquee.hasMoved) {
          const rect = {
            left: Math.min(marquee.startX, marquee.currentX),
            right: Math.max(marquee.startX, marquee.currentX),
            top: Math.min(marquee.startY, marquee.currentY),
            bottom: Math.max(marquee.startY, marquee.currentY),
          };
          const selected = shapesInMarquee(rect);
          if (marquee.additive) {
            const merged = [...selectedIdsRef.current];
            selected.forEach((id) => {
              if (!merged.includes(id)) {
                merged.push(id);
              }
            });
            onSelectShape(merged);
          } else {
            onSelectShape(selected);
          }
        } else if (!marquee.additive) {
          onSelectShape(null);
        }
        try {
          if (event.currentTarget.hasPointerCapture(marquee.pointerId)) {
            event.currentTarget.releasePointerCapture(marquee.pointerId);
          }
        } catch {
          // Pointer capture can already be gone when the button is released.
        }
        if (state) {
          state.controls.enabled = true;
        }
        onInteractionActiveChange?.(false);
        return;
      }

      const drag = dragRef.current;
      if (!drag) {
        return;
      }

      if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
        event.currentTarget.releasePointerCapture(drag.pointerId);
      }

      let movedShape = false;
      drag.items.forEach((item) => {
        if (item.visual && item.hadPreviewSimplified) {
          setComplexEdgeVisibility(item.visual, true);
        }
        const shape = shapesRef.current.find((entry) => entry.id === item.id);
        if (shape && (shape.x !== item.nextX || shape.z !== item.nextZ)) {
          movedShape = true;
          onUpdateShape(item.id, { x: item.nextX, z: item.nextZ });
        }
        if (item.visual?.userData.pendingSettle && state) startShapeSettle(state, item.visual);
      });

      dragRef.current = null;
      setObjectSnapGuide(null);
      if (drag.shadowsHidden && state) restoreDragShadows(state, drag);
      if (state) {
        // A moved shape triggers the shapes effect, which rebuilds this preview.
        // Running it here as well makes cylinder/hole CSG execute twice on release.
        if (!movedShape) {
          syncCutPreviewOverlays(state, shapesRef.current);
        }
        state.controls.enabled = true;
        state.needsRender = true;
        // One shadow update after the move, not one per pointer event.
        markShadowsDirty(state);
      }
      onInteractionActiveChange?.(false);
    },
    [onInteractionActiveChange, onSelectShape, onUpdateShape, openRotationEditorAfterDrag, publishSketchMeasure, rememberResizeAnchor, setMarqueeFromState, shapesInMarquee, suppressLiftEditAfterDrag, suppressRotationEditAfterDrag],
  );

  const clearAssetPlacementPreview = useCallback(() => {
    const state = threeRef.current;
    if (!state) {
      return;
    }
    clearAssetPlacementPreviewObject(state);
    state.needsRender = true;
  }, []);

  const updateAssetPlacementPreview = useCallback(
    (clientX: number, clientY: number) => {
      const state = threeRef.current;
      const asset = getShapeAssetDrag();
      if (!state || !asset || rulerMoveModeRef.current) {
        return;
      }
      const { x, z, elevation } = dropSpotAt(clientX, clientY);
      syncAssetPlacementPreview(state, asset, x, z, elevation, sheetThickness(workspaceRef.current) ?? undefined);
      state.needsRender = true;
    },
    [dropSpotAt],
  );

  const handleAssetDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!getShapeAssetDrag() && !event.dataTransfer.types.includes("application/x-sketchforge-shape")) {
        return;
      }
      setAssetDragOver(true);
      updateAssetPlacementPreview(event.clientX, event.clientY);
    },
    [updateAssetPlacementPreview],
  );

  const handleAssetDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!getShapeAssetDrag() && !event.dataTransfer.types.includes("application/x-sketchforge-shape")) {
        return;
      }
      setAssetDragOver(true);
      updateAssetPlacementPreview(event.clientX, event.clientY);
    },
    [updateAssetPlacementPreview],
  );

  const handleAssetDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) {
        return;
      }
      setAssetDragOver(false);
      clearAssetPlacementPreview();
    },
    [clearAssetPlacementPreview],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setAssetDragOver(false);
      clearAssetPlacementPreview();
      if (rulerMoveModeRef.current) return;
      const raw = event.dataTransfer.getData("application/x-sketchforge-shape");
      const asset = (raw ? parseDroppedShapeAsset(raw) : null) ?? getShapeAssetDrag();
      endShapeAssetDrag();
      if (!asset) {
        return;
      }
      onAddShape(asset, dropSpotAt(event.clientX, event.clientY));
    },
    [clearAssetPlacementPreview, dropSpotAt, onAddShape],
  );

  useEffect(() => {
    const onDragStart = (event: globalThis.DragEvent) => {
      if (!getShapeAssetDrag()) return;
      updateAssetPlacementPreview(event.clientX, event.clientY);
    };
    const onDragOver = (event: globalThis.DragEvent) => {
      if (!getShapeAssetDrag()) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      updateAssetPlacementPreview(event.clientX, event.clientY);
    };
    const onDragEnd = () => {
      setAssetDragOver(false);
      clearAssetPlacementPreview();
      endShapeAssetDrag();
    };
    window.addEventListener("dragstart", onDragStart);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragend", onDragEnd);
    };
  }, [clearAssetPlacementPreview, updateAssetPlacementPreview]);

  const resetView = useCallback(() => {
    const state = threeRef.current;
    if (state) {
      glideCameraHome(state);
      state.needsRender = true;
    }
  }, []);

  const applyViewCubeFace = useCallback((face: ViewCubeFace) => {
    const state = threeRef.current;
    if (!state) {
      return;
    }
    glideCameraToViewFace(state, face);
    syncViewCube(state, viewCubeRef.current);
  }, []);

  const onViewCubePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    viewCubeDragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      dragged: false,
      face: viewCubeFaceFromTarget(event.target),
      capturer: null,
    };
  }, []);

  const onViewCubePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = viewCubeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const state = threeRef.current;
    if (!state) {
      return;
    }
    const deltaX = event.clientX - drag.lastX;
    const deltaY = event.clientY - drag.lastY;
    if (!drag.dragged) {
      if (Math.hypot(deltaX, deltaY) < 4) {
        return;
      }
      drag.dragged = true;
      drag.capturer = event.currentTarget;
      event.currentTarget.setPointerCapture(event.pointerId);
      concealMeasurements();
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    orbitCameraByPointerDelta(state, deltaX, deltaY);
    syncViewCube(state, viewCubeRef.current);
  }, [concealMeasurements]);

  const onViewCubePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = viewCubeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (drag.capturer?.hasPointerCapture(event.pointerId)) {
      drag.capturer.releasePointerCapture(event.pointerId);
    }
    const face = drag.face;
    const wasDrag = drag.dragged;
    viewCubeDragRef.current = null;
    if (!wasDrag && face) {
      concealMeasurements();
      applyViewCubeFace(face);
      window.requestAnimationFrame(() => revealMeasurements());
      return;
    }
    if (wasDrag) {
      revealMeasurements();
    }
  }, [applyViewCubeFace, concealMeasurements, revealMeasurements]);

  const zoomCamera = useCallback((scale: number) => {
    const state = threeRef.current;
    if (!state) {
      return;
    }

    const offset = state.camera.position.clone().sub(state.controls.target);
    const distance = clamp(offset.length() * scale, 22, 4200);
    offset.setLength(distance);
    state.camera.position.copy(state.controls.target).add(offset);
    state.camera.updateProjectionMatrix();
    state.controls.update();
    state.needsRender = true;
  }, []);

  const closeRulerTools = useCallback(() => {
    setRulerToolsOpen(false);
    setRulerActive(false);
    rulerDeleteModeRef.current = false;
    setRulerDeleteMode(false);
    rulerMoveModeRef.current = false;
    setRulerMoveMode(false);
    rulerPointDragRef.current = null;
    onDeactivatePlacementRuler?.();
  }, [onDeactivatePlacementRuler, setRulerActive]);

  const toggleRulerTools = useCallback(() => {
    if (rulerToolsOpen) {
      closeRulerTools();
      return;
    }
    setRulerToolsOpen(true);
    setXrayControlsOpen(false);
    setRulerActive(false);
    rulerDeleteModeRef.current = false;
    setRulerDeleteMode(false);
    rulerMoveModeRef.current = false;
    setRulerMoveMode(false);
  }, [closeRulerTools, rulerToolsOpen, setRulerActive]);

  const clearMeasurementRulerModes = useCallback(() => {
    setRulerActive(false);
    rulerDeleteModeRef.current = false;
    setRulerDeleteMode(false);
    rulerMoveModeRef.current = false;
    setRulerMoveMode(false);
  }, [setRulerActive]);

  const activateRulerAdd = useCallback(() => {
    onDeactivatePlacementRuler?.();
    const turningOff = rulerModeRef.current;
    rulerDeleteModeRef.current = false;
    setRulerDeleteMode(false);
    rulerMoveModeRef.current = false;
    setRulerMoveMode(false);
    setRulerActive(!turningOff);
  }, [onDeactivatePlacementRuler, setRulerActive]);

  const activateRulerDelete = useCallback(() => {
    onDeactivatePlacementRuler?.();
    const turningOff = rulerDeleteModeRef.current;
    setRulerActive(false);
    rulerMoveModeRef.current = false;
    setRulerMoveMode(false);
    rulerDeleteModeRef.current = !turningOff;
    setRulerDeleteMode(!turningOff);
  }, [onDeactivatePlacementRuler, setRulerActive]);

  const activateRulerMove = useCallback(() => {
    onDeactivatePlacementRuler?.();
    const turningOff = rulerMoveModeRef.current;
    setRulerActive(false);
    rulerDeleteModeRef.current = false;
    setRulerDeleteMode(false);
    rulerMoveModeRef.current = !turningOff;
    setRulerMoveMode(!turningOff);
    if (!turningOff) {
      onSelectShape(null);
    }
  }, [onDeactivatePlacementRuler, onSelectShape, setRulerActive]);

  const activatePlacementRuler = useCallback(() => {
    clearMeasurementRulerModes();
    onActivatePlacementRuler?.();
  }, [clearMeasurementRulerModes, onActivatePlacementRuler]);

  const collapseCameraControls = useCallback(() => {
    setCameraControlsCollapsed(true);
    setXrayControlsOpen(false);
    closeRulerTools();
  }, [closeRulerTools]);

  const xrayBounds = useMemo(
    () => xrayAxisBounds(shapes, xrayAxis, selectedIds),
    [selectedIds, shapes, xrayAxis],
  );
  const xrayPlaneSize = useMemo(() => {
    const spans = (["x", "y", "z"] as const).map((axis) => xrayAxisBounds(shapes, axis, selectedIds));
    const longest = spans.reduce((size, span) => Math.max(size, span.max - span.min), 80);
    return Math.max(longest, 80) * 1.25;
  }, [selectedIds, shapes]);

  useEffect(() => {
    setXrayPosition((current) => {
      if (current < xrayBounds.min || current > xrayBounds.max) return xraySpanCenter(xrayBounds);
      return current;
    });
  }, [xrayBounds.max, xrayBounds.min]);

  useEffect(() => {
    applyXrayClipping(threeRef.current, {
      enabled: xrayEnabled,
      axis: xrayAxis,
      position: xrayPosition,
      keepLow: xrayKeepLow,
      showPlane: xrayShowPlane,
      planeSize: xrayPlaneSize,
      bounds: xrayBounds,
    });
  }, [xrayAxis, xrayBounds, xrayEnabled, xrayKeepLow, xrayPlaneSize, xrayPosition, xrayShowPlane]);

  const openXrayView = useCallback(() => {
    if (xrayControlsOpen) {
      setXrayControlsOpen(false);
      setXrayEnabled(false);
      return;
    }
    setRulerToolsOpen(false);
    setXrayControlsOpen(true);
    if (!xrayEnabled) {
      const bounds = xrayAxisBounds(shapesRef.current, xrayAxis, selectedIdsRef.current);
      setXrayPosition(xraySpanCenter(bounds));
      setXrayEnabled(true);
    }
  }, [xrayAxis, xrayControlsOpen, xrayEnabled]);

  const handleRulerPointPointerDown = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>, pointId: string) => {
      if (event.button !== 0) {
        return;
      }
      if (rulerDeleteModeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        removeRulerPoint(pointId);
        return;
      }
      if (rulerMoveModeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        rulerPointDragRef.current = { pointId, pointerId: event.pointerId };
        return;
      }
      if (!rulerModeRef.current) {
        return;
      }
      const point = rulerModelRef.current.points.find((candidate) => candidate.id === pointId);
      if (!point) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const state = threeRef.current;
      const world = state ? rulerPointWorld(state, point) : new THREE.Vector3(point.x, point.y, point.z);
      selectRulerCandidate({ x: world.x, y: world.y, z: world.z, pointId, attachment: point.attachment });
    },
    [removeRulerPoint, selectRulerCandidate],
  );

  const handleRulerPointPointerMove = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>, pointId: string) => {
      const drag = rulerPointDragRef.current;
      if (!rulerMoveModeRef.current || !drag || drag.pointId !== pointId || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const candidate = resolveRulerCandidate(event.clientX, event.clientY, pointId);
      if (!candidate) return;
      const current = rulerModelRef.current;
      storeRulerModel({
        ...current,
        points: current.points.map((point) => point.id === pointId ? {
          ...point,
          x: candidate.x,
          y: candidate.y,
          z: candidate.z,
          attachment: candidate.attachment,
        } : point),
        segments: current.segments.map((segment) => segment.startId === pointId || segment.endId === pointId ? { ...segment, edge: undefined } : segment),
        hover: candidate,
      });
    },
    [resolveRulerCandidate, storeRulerModel],
  );

  const handleRulerPointPointerUp = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>, pointId: string) => {
      const drag = rulerPointDragRef.current;
      if (!drag || drag.pointId !== pointId || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      rulerPointDragRef.current = null;
      const current = rulerModelRef.current;
      storeRulerModel({ ...current, hover: null });
    },
    [storeRulerModel],
  );

  const handleRulerSegmentPointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, segmentId: string) => {
      if (event.button !== 0) {
        return;
      }
      if (rulerDeleteModeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        removeRulerSegment(segmentId);
        return;
      }
      if (!rulerModeRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const candidate = resolveRulerCandidate(event.clientX, event.clientY);
      if (candidate) {
        selectRulerCandidate(candidate);
      }
    },
    [removeRulerSegment, resolveRulerCandidate, selectRulerCandidate],
  );

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || isHotkeyRecordingActive()) {
        return;
      }

      const action = matchHotkeyAction(event, hotkeys, ["escape", "cameraHome", "zoomIn", "zoomOut"]);
      if (!action) return;

      if (action === "escape" && (sketchFacePickModeRef.current || rulerToolsOpen || xrayControlsOpen || rulerModeRef.current || rulerDeleteModeRef.current || rulerMoveModeRef.current)) {
        event.preventDefault();
        if (sketchFacePickModeRef.current) {
          clearSketchFaceHover();
          onSketchFacePickCancelRef.current?.();
          return;
        }
        setRulerActive(false);
        rulerDeleteModeRef.current = false;
        setRulerDeleteMode(false);
        rulerMoveModeRef.current = false;
        setRulerMoveMode(false);
        rulerPointDragRef.current = null;
        setRulerToolsOpen(false);
        setXrayControlsOpen(false);
        return;
      }
      if (action === "cameraHome") {
        event.preventDefault();
        resetView();
        return;
      }
      if (action === "zoomIn") {
        event.preventDefault();
        zoomCamera(0.72);
        return;
      }
      if (action === "zoomOut") {
        event.preventDefault();
        zoomCamera(1.28);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSketchFaceHover, hotkeys, resetView, rulerToolsOpen, setRulerActive, xrayControlsOpen, zoomCamera]);

  const crystalCheck = useMemo(() => {
    if (!isCrystalDesign(workspace)) return null;
    const parts = shapes.filter((shape) => !shape.hole && !shape.hidden && !isConstructionShape(shape));
    if (parts.length === 0) return null;
    function* points() {
      for (const shape of parts) {
        try {
          yield* meshForShape(shape).vertices;
        } catch {
          // A part with no mesh yet has nothing to check.
        }
      }
    }
    return checkInsideCrystal(points(), workspace.crystal, crystalReach(workspace));
  }, [shapes, workspace]);

  useEffect(() => {
    setCrystalWarning(threeRef.current, Boolean(crystalCheck && crystalCheck.status !== "inside"));
  }, [crystalCheck, workspace]);

  const printerWarning = useMemo(() => {
    if (isCrystalDesign(workspace)) return crystalCheck && crystalCheck.status !== "inside" ? crystalCheck.message : null;
    if (!isLaserDesign(workspace)) return bedFitForShapes(shapes, normalizePrinterBed(workspace)).message;
    // Only the footprint matters on a laser, so the bed is given all the height it could need.
    const fit = bedFitForShapes(shapes, { ...normalizePrinterBed(workspace), width: workspace.laserWidth, depth: workspace.laserDepth, height: Number.MAX_VALUE });
    return fit.pastFootprint ? `Past the ${Math.round(workspace.laserWidth)} × ${Math.round(workspace.laserDepth)} mm laser bed.` : null;
  }, [shapes, workspace]);

  return (
    <main className="workplane-stage">
      <div className="workplane-canvas-host">
      {printerWarning ? <div className="printer-bed-warning" role="status">{printerWarning}</div> : null}
      {isLaserDesign(workspace) ? (
        <button
          type="button"
          className="laser-design-chip"
          title="Change the laser or the sheet"
          onClick={() => window.dispatchEvent(new CustomEvent("sketchforge:open-workspace-settings", { detail: { section: "machines" } }))}
        >
          <LaserIcon size={15} />
          <span>{laserDesignLabel(workspace)}</span>
        </button>
      ) : null}
      <div
        className="view-cube"
        aria-label="View orientation cube — drag to orbit, click a face to snap"
        onPointerDown={onViewCubePointerDown}
        onPointerMove={onViewCubePointerMove}
        onPointerUp={onViewCubePointerUp}
        onPointerCancel={onViewCubePointerUp}
        onClick={(event) => {
          // A pointer click snaps on pointer up. Enter or Space on a focused face sends a click with no pointer.
          if (event.detail !== 0) return;
          const face = viewCubeFaceFromTarget(event.target);
          if (face) applyViewCubeFace(face);
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="view-cube-inner" ref={viewCubeRef}>
          <button type="button" className="cube-face cube-top" data-view-cube-face="bottom" aria-label="Bottom view">BOTTOM</button>
          <button type="button" className="cube-face cube-bottom" data-view-cube-face="top" aria-label="Top view">TOP</button>
          <button type="button" className="cube-face cube-front" data-view-cube-face="front" aria-label="Front view">FRONT</button>
          <button type="button" className="cube-face cube-back" data-view-cube-face="back" aria-label="Back view">BACK</button>
          <button type="button" className="cube-face cube-right" data-view-cube-face="right" aria-label="Right view">RIGHT</button>
          <button type="button" className="cube-face cube-left" data-view-cube-face="left" aria-label="Left view">LEFT</button>
        </div>
      </div>

      <div className={`camera-controls ${cameraControlsCollapsed ? "collapsed" : ""}`} aria-label="Camera controls">
        {cameraControlsCollapsed ? (
          <PeakTipButton className="camera-controls-toggle" label="Show controls" description={TOOL_DESCRIPTIONS.showControls} aria-expanded={false} onClick={() => setCameraControlsCollapsed(false)}>
            <ChevronRight size={24} strokeWidth={2.25} aria-hidden="true" />
          </PeakTipButton>
        ) : (
          <>
            <PeakTipButton className="camera-controls-toggle" label="Hide controls" description={TOOL_DESCRIPTIONS.hideControls} aria-expanded={true} onClick={collapseCameraControls}>
              <ChevronLeft size={24} strokeWidth={2.25} aria-hidden="true" />
            </PeakTipButton>
            <PeakTipButton label="Home" description={TOOL_DESCRIPTIONS.cameraHome} data-sage-key="camera-home" onClick={resetView}>
              <Home size={24} strokeWidth={2.25} />
            </PeakTipButton>
            <PeakTipButton label="Zoom in" description={TOOL_DESCRIPTIONS.zoomIn} onClick={() => zoomCamera(0.7)}>
              <Plus size={28} strokeWidth={2.15} />
            </PeakTipButton>
            <PeakTipButton label="Zoom out" description={TOOL_DESCRIPTIONS.zoomOut} onClick={() => zoomCamera(1.35)}>
              <Minus size={28} strokeWidth={2.15} />
            </PeakTipButton>
            <div className="ruler-control-group">
              <PeakTipButton
                className={`ruler-trigger ${rulerToolsOpen ? "active" : ""}`}
                label="Ruler tools"
                description={TOOL_DESCRIPTIONS.rulerTools}
                aria-expanded={rulerToolsOpen}
                aria-controls="ruler-tool-popover"
                onClick={toggleRulerTools}
              >
                <Ruler size={26} strokeWidth={2.2} aria-hidden="true" />
              </PeakTipButton>
              {rulerToolsOpen ? (
                <div id="ruler-tool-popover" className="ruler-tool-popover" aria-label="Ruler actions">
                  <PeakTipButton className="ruler-tool-popover-close" label="Close ruler tools" description={TOOL_DESCRIPTIONS.closeRulerTools} onClick={closeRulerTools}>
                    <X size={11} strokeWidth={2.6} aria-hidden="true" />
                  </PeakTipButton>
                  <PeakTipButton className={rulerMode ? "active" : ""} label="Add measurement" description={TOOL_DESCRIPTIONS.addMeasurement} aria-pressed={rulerMode} onClick={activateRulerAdd}>
                    <Plus size={21} strokeWidth={2.4} aria-hidden="true" />
                  </PeakTipButton>
                  <PeakTipButton className={rulerMoveMode ? "active" : ""} label="Move measurement points" description={TOOL_DESCRIPTIONS.moveMeasurement} aria-pressed={rulerMoveMode} onClick={activateRulerMove}>
                    <MousePointer2 size={20} strokeWidth={2.25} aria-hidden="true" />
                  </PeakTipButton>
                  {onActivatePlacementRuler ? (
                    <PeakTipButton className={placementRulerMode ? "active" : ""} label="Placement ruler" description={TOOL_DESCRIPTIONS.placementRuler} aria-pressed={placementRulerMode} onClick={activatePlacementRuler}>
                      <Crosshair size={20} strokeWidth={2.25} aria-hidden="true" />
                    </PeakTipButton>
                  ) : null}
                  <PeakTipButton className={`ruler-delete-button ${rulerDeleteMode ? "active" : ""}`} label="Delete measurement part" description={TOOL_DESCRIPTIONS.deleteMeasurement} aria-pressed={rulerDeleteMode} onClick={activateRulerDelete}>
                    <ToolbarEraserIcon aria-hidden="true" />
                  </PeakTipButton>
                </div>
              ) : null}
            </div>
            <div className="xray-control-group">
              <PeakTipButton
                className={`xray-trigger ${xrayEnabled || xrayControlsOpen ? "active" : ""}`}
                label="X-ray view"
                description={TOOL_DESCRIPTIONS.xray}
                aria-pressed={xrayEnabled}
                aria-expanded={xrayControlsOpen}
                aria-controls="xray-tool-popover"
                onClick={openXrayView}
              >
                <ScanEye size={24} strokeWidth={2.2} aria-hidden="true" />
              </PeakTipButton>
              {xrayControlsOpen ? (
                <XrayViewPanel
                  enabled={xrayEnabled}
                  axis={xrayAxis}
                  position={xrayPosition}
                  keepLow={xrayKeepLow}
                  showPlane={xrayShowPlane}
                  bounds={xrayBounds}
                  workspace={workspace}
                  onEnabledChange={setXrayEnabled}
                  onAxisChange={(axis) => {
                    setXrayAxis(axis);
                    setXrayPosition(xraySpanCenter(xrayAxisBounds(shapesRef.current, axis, selectedIdsRef.current)));
                  }}
                  onPositionChange={(position) => {
                    setXrayPosition(Math.min(xrayBounds.max, Math.max(xrayBounds.min, position)));
                  }}
                  onKeepLowChange={setXrayKeepLow}
                  onShowPlaneChange={setXrayShowPlane}
                  onClose={() => {
                    setXrayEnabled(false);
                    setXrayControlsOpen(false);
                  }}
                />
              ) : null}
            </div>
          </>
        )}
      </div>

      <section data-lesson-target={sketchFacePickMode || (pushPullActive && pushPullSelectedFaceId == null) ? "face" : undefined} className={`workplane-wrap ${sketchOnModel ? "sketch-on-model" : ""} ${sketchFacePickMode ? "sketch-face-pick-mode" : ""} ${sketchFacePickMode && sketchFaceHovering ? "sketch-face-hover" : ""} ${sketchFacePickMode && sketchFaceHoverBlocked ? "sketch-face-hover-blocked" : ""} ${rulerMode ? "ruler-mode" : ""} ${rulerDeleteMode ? "ruler-delete-mode" : ""} ${rulerMoveMode ? "ruler-move-mode" : ""} ${placementRulerMode ? "placement-ruler-mode" : ""} ${modifierActive ? "modifier-edge-pick" : ""} ${pushPullActive ? "push-pull-face-pick" : ""} ${pushPullDragging ? "push-pull-dragging" : ""}`} aria-label="Workplane">
        <div className="workplane-plane">
          <div
            className="three-workplane-host"
            ref={hostRef}
            onDragOver={handleAssetDragOver}
            onDragEnter={handleAssetDragEnter}
            onDragLeave={handleAssetDragLeave}
            onDrop={handleDrop}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onPointerLeave={handlePointerLeave}
            onLostPointerCapture={handleLostPointerCapture}
          />
          <div className="sketch-size-layer" ref={sketchSizeLayerRef} />
          {sketchMeasure ? (
            <div className="sketch-3d-measure" role="status">{sketchMeasure}</div>
          ) : null}
          {busyLabel ? (
            <div className="viewport-busy" role="status" aria-live="polite">
              <span className="model-loading-wheel viewport-busy-wheel" aria-hidden="true" />
              <span>{busyLabel}</span>
            </div>
          ) : null}
          {gpuFailure ? (
            <div className="viewport-gpu-failure" role="alert">
              <div>
                <strong>3D viewport unavailable</strong>
                {gpuFailure}
              </div>
            </div>
          ) : null}
          <WorkplaneEmptyCoach
            visible={
              !shapes.some((shape) => !shape.hidden)
              && !assetDragOver
              && !sketchFacePickMode
              && !sketchOnModel
              && !alignMode
              && !mirrorMode
              && !modifierActive
              && !circularPatternMode
              && !rulerMode
              && !rulerDeleteMode
              && !rulerMoveMode
              && !transformOverlay
              && !marqueeRect
            }
          />
          {marqueeRect ? <div className="selection-marquee" style={marqueeRect} /> : null}
          {sectionMeasureLabel && xrayEnabled ? (
            <div className="ruler-label xray-measure-label" style={{ left: sectionMeasureLabel.left, top: sectionMeasureLabel.top }}>
              {sectionMeasureLabel.text}
            </div>
          ) : null}
          {objectSnapGuide && threeRef.current ? (
            <svg className="object-snap-guides" aria-hidden="true">
              {objectSnapGuide.guides.map((guide, index) => {
                const start = projectToScreen(new THREE.Vector3(guide.start.x, guide.start.y, guide.start.z), threeRef.current!);
                const end = projectToScreen(new THREE.Vector3(guide.end.x, guide.end.y, guide.end.z), threeRef.current!);
                return <line key={`${guide.axis}-${index}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />;
              })}
            </svg>
          ) : null}
          {objectSnapGuide && threeRef.current ? (
            <div
              className="object-snap-label"
              style={{
                "--overlay-x": `${projectToScreen(new THREE.Vector3(
                  (objectSnapGuide.guides[0].start.x + objectSnapGuide.guides[0].end.x) / 2,
                  (objectSnapGuide.guides[0].start.y + objectSnapGuide.guides[0].end.y) / 2,
                  (objectSnapGuide.guides[0].start.z + objectSnapGuide.guides[0].end.z) / 2,
                ), threeRef.current).x}px`,
                "--overlay-y": `${projectToScreen(new THREE.Vector3(
                  (objectSnapGuide.guides[0].start.x + objectSnapGuide.guides[0].end.x) / 2,
                  (objectSnapGuide.guides[0].start.y + objectSnapGuide.guides[0].end.y) / 2,
                  (objectSnapGuide.guides[0].start.z + objectSnapGuide.guides[0].end.z) / 2,
                ), threeRef.current).y}px`,
              } as CSSProperties}
            >
              {objectSnapGuide.kind === "edge" ? "Edge" : objectSnapGuide.kind === "mid" ? "Mid" : "Face"}
            </div>
          ) : null}
          <div className={`measurement-fade${measurementsConcealed ? " is-concealed" : ""}`}>
          {pushPullChipText && pushPullChipScreen ? (
            pushPullChipEditing ? (
              <input
                className="dimension-label push-pull-chip"
                style={{ "--overlay-x": `${pushPullChipScreen.x}px`, "--overlay-y": `${pushPullChipScreen.y}px` } as CSSProperties}
                value={pushPullChipDraft}
                inputMode="decimal"
                aria-label="Push Pull distance"
                autoFocus
                onChange={(event) => setPushPullChipDraft(event.currentTarget.value)}
                onBlur={() => {
                  const next = Number(pushPullChipDraft);
                  setPushPullChipEditing(false);
                  if (Number.isFinite(next)) onPushPullDistanceCommit?.(next);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setPushPullChipEditing(false);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="dimension-label push-pull-chip"
                style={{ "--overlay-x": `${pushPullChipScreen.x}px`, "--overlay-y": `${pushPullChipScreen.y}px` } as CSSProperties}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setPushPullChipDraft((pushPullChipText ?? "").replace(/[^\d.+-]/g, ""));
                  setPushPullChipEditing(true);
                }}
              >
                {pushPullChipText}
              </button>
            )
          ) : null}
          {transformOverlay && !transformHandlesHidden && !smoothEdit &&!sketchOnModel && !sketchFacePickMode && !alignMode && !mirrorMode && !rulerMode && !rulerDeleteMode && !rulerMoveMode && !placementRulerMode && !modifierActive && !pushPullActive ? (
            <TransformOverlay
              box={transformOverlay}
              measureKey={pinnedMeasureKey ?? hoverMeasureKey}
              editingDimension={editingDimension}
              editingRotation={editingRotation}
              rotationReadout={rotationReadout}
              showRotationWheel={activeRotationWheel}
              hideSelectionChrome={activeTransformKind === "rotate"}
              hideDimensionMarks={activeTransformKind === "scale" || placementRulerMode}
              rotationWheelAxis={rotationWheelAxis}
              pinnedRotationWheelView={pinnedRotationWheelView}
              onBeginTransform={beginTransform}
              onMoveTransform={updateTransform}
              onFinishTransform={finishTransform}
              onHoverMeasure={setHoverMeasureKey}
              onPinMeasure={setPinnedMeasureKey}
              onBeginDimensionEdit={beginDimensionEdit}
              onBeginLiftEdit={beginLiftEdit}
              onDropSelectionToWorkplane={onDropToWorkplane}
              onEditingDimensionChange={(value) => setEditingDimension((current) => (current ? { ...current, value } : current))}
              onCommitDimensionEdit={commitDimensionEdit}
              onCancelDimensionEdit={cancelDimensionEdit}
              onBeginRotationEdit={beginRotationEdit}
              onEditingRotationChange={(value) => {
                setEditingRotation((current) => {
                  if (!current) {
                    return current;
                  }
                  const next = { ...current, value };
                  editingRotationRef.current = next;
                  return next;
                });
              }}
              onCommitRotationEdit={commitRotationEdit}
              onCancelRotationEdit={cancelRotationEdit}
              onCycleStackedSelection={tryCycleStackedSelection}
            />
          ) : null}
          {alignOverlay ? <AlignOverlay overlay={alignOverlay} onAlign={onAlignSelection} onPreview={onAlignPreview} onPreviewClear={onAlignPreviewClear} /> : null}
          {circularPatternOverlay ? <CircularPatternOverlay overlay={circularPatternOverlay} /> : null}
          {mirrorOverlay ? <MirrorOverlay overlay={mirrorOverlay} onMirror={onMirrorSelection} onPreview={onMirrorPreview} onPreviewClear={onMirrorPreviewClear} /> : null}
          {rulerOverlay && (rulerOverlay.points.length > 0 || rulerOverlay.hover) ? (
            <RulerOverlay
              overlay={rulerOverlay}
              startPointId={rulerModel.startPointId}
              active={rulerMode || rulerMoveMode}
              deleteMode={rulerDeleteMode}
              moveMode={rulerMoveMode}
              onPointPointerDown={handleRulerPointPointerDown}
              onPointPointerMove={handleRulerPointPointerMove}
              onPointPointerUp={handleRulerPointPointerUp}
              onSegmentPointerDown={handleRulerSegmentPointerDown}
            />
          ) : null}
          </div>
        </div>
        {placementRulerCard ? <div className="placement-ruler-canvas-card">{placementRulerCard}</div> : null}
      </section>

      {inspectorDockTop ? <div className="inspector-column-dock inspector-column-dock--top">{inspectorDockTop}</div> : null}
      {inspectorDock ? <div className="inspector-column-dock">{inspectorDock}</div> : null}

      <div className="grid-settings">
        <SnapGridControl snap={snap} snapOpen={snapOpen} onSnapChange={setSnap} onSnapOpenChange={setSnapOpen} />
      </div>

      <div className="workplane-viewport-bar" aria-label="Workplane controls">
        <WorkplaneDimensionsControl workspace={workspace} onChange={applyWorkspaceSettings} />
        {onDropToWorkplane ? (
          <PeakTipButton
            className={`workplane-viewport-bar-snap ${dropSurfaceActive ? "active" : ""} ${selectedIds.length > 0 ? "" : "disabled"}`}
            label="Drop"
            description={TOOL_DESCRIPTIONS.drop}
            disabled={selectedIds.length === 0}
            aria-pressed={dropSurfaceActive}
            onClick={onDropToWorkplane}
          >
            <ToolbarDropToWorkplaneIcon />
          </PeakTipButton>
        ) : null}
      </div>

      {settingsOpen ? (
        <WorkspaceSettingsModal
          workspace={workspace}
          snap={snap}
          onWorkspaceChange={applyWorkspaceSettings}
          onSnapChange={setSnap}
          onMakeDefault={makeWorkspaceDefault}
          onClose={() => onSettingsClose?.()}
          onAddFitTest={onAddFitTest}
          sketchGuides={sketchGuides}
          initialSection={settingsSection}
        />
      ) : null}
      </div>

      {selectedShape && !rulerMode && !rulerDeleteMode && !rulerMoveMode && !placementRulerMode ? (
        <div className={`shape-inspector-shell ${inspectorPanelOpen ? "open" : "collapsed"}`}>
          <PeakTipButton
            className="shape-inspector-tab"
            label={inspectorPanelOpen ? "Hide panel" : "Show panel"}
            description={inspectorPanelOpen ? "Hide the shape settings panel." : "Show the shape settings panel for the selection."}
            aria-label={inspectorPanelOpen ? "Hide shape settings panel" : "Show shape settings panel"}
            aria-expanded={inspectorPanelOpen}
            onClick={() => setInspectorPanelOpen((open) => !open)}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {inspectorPanelOpen ? <ChevronRight size={18} strokeWidth={2.5} aria-hidden="true" /> : <ChevronLeft size={18} strokeWidth={2.5} aria-hidden="true" />}
          </PeakTipButton>
          <ShapeInspector
            shape={selectedShape}
            sceneShapes={shapes}
            badgeShape={inspectorBadgeShape}
            workspace={workspace}
            onUpdate={(patch, options) => onUpdateShape(selectedShape.id, patchWithResizeAnchor(selectedShape, patch, options?.resizeAxis, lastResizeAnchorRef.current))}
            onClose={() => {
              if (activeFeatureId && onSelectFeature) {
                onSelectFeature(null);
                return;
              }
              onSelectShape(null);
            }}
            onEditSketch={onEditSketch}
            onEditSketchDimension={onEditSketchDimension}
            onApplyValues={onApplyValues}
            canSeparateParts={canSeparateParts}
            onSeparateParts={onSeparateParts}
            onMakeMatchingThread={onMakeMatchingThread}
            canSplitForPrintBed={canSplitForPrintBed}
            onSplitForPrintBed={onSplitForPrintBed}
            onReduceTriangles={onReduceTriangles}
            activeFeatureId={activeFeatureId}
            onSelectFeature={onSelectFeature}
            modelTreeLocked={modelTreeLocked}
            onUpdateFeature={onUpdateFeature}
            onEditPattern={onEditPattern}
            onDissolvePattern={onDissolvePattern}
            onEditEdgeTreatment={onEditEdgeTreatment}
            onRemoveEdgeTreatment={onRemoveEdgeTreatment}
            onEditPartStep={onEditPartStep}
            onOpenPartStep={onOpenPartStep}
            onTogglePartStep={onTogglePartStep}
            onRemovePartStep={onRemovePartStep}
            onRemovePartStepsFrom={onRemovePartStepsFrom}
            laserSource={laserSource}
            smoothControls={smoothControls}
            onInteractionActiveChange={onInteractionActiveChange}
          />
        </div>
      ) : null}
    </main>
  );
}

function rememberSketchCamera(state: ThreeState, planeKey: string) {
  if (!planeKey) return;
  rememberedSketchCamera = {
    planeKey,
    pose: captureSketchCameraPose(sketch3dHost(state)),
  };
}

type PendingEdgeWipe = { ids: Set<string>; polylines: number[][] };
type PendingScaleIntro = { ids: Set<string>; startScale: number };
let pendingEdgeWipe: PendingEdgeWipe | null = null;
let pendingScaleIntro: PendingScaleIntro | null = null;
let consumedFlashNonce = -1;

function rebuildShapes(state: ThreeState | null, shapes: WorkplaneShape[], selectedIds: string[], showCutPreviews = true) {
  if (!state) {
    return;
  }
  state.printShapes = shapes;
  if (!state.previewHold) state.previewHold = new Map();

  const selected = new Set(selectedIds);
  const visibleShapes = shapes.filter((shape) => !shape.hidden);
  const existingById = new Map<string, THREE.Object3D>();
  for (const child of [...state.shapeLayer.children]) {
    if (child.userData.edgeWipeRole === "out" || child.userData.previewHold) continue;
    const shapeId = child.userData.shapeId as string | undefined;
    if (shapeId) {
      existingById.set(shapeId, child);
    }
  }

  const previewWasShown = existingById.has(SKETCH_EXTRUDE_PREVIEW_ID);
  const keepIds = new Set<string>();
  const newSolids: THREE.Object3D[] = [];
  const riseSolids: THREE.Object3D[] = [];
  const combineSolids: THREE.Object3D[] = [];
  const carriedSettles: { object: THREE.Object3D; lift: number }[] = [];
  const previewActive = state.modifierPreviewActive;
  visibleShapes.forEach((shape) => {
    const showEdges = selected.has(shape.id);
    const fingerprint = `${shapeGeometryFingerprint(shape)}${state.laserDesign ? `|laser:${shape.laserJob ?? "cut"}` : ""}`;
    const existing = existingById.get(shape.id);
    const wipe = pendingEdgeWipe && pendingEdgeWipe.ids.has(shape.id) ? pendingEdgeWipe : null;
    const held = state.previewHold.get(shape.id) ?? null;

    if (existing && existing.userData.renderFingerprint === fingerprint) {
      applyShapePose(existing, shape);
      existing.userData.showEdges = showEdges;
      syncSelectionOutline(existing, showEdges, state.camera);
      keepIds.add(shape.id);
      if (wipe && held) {
        state.previewHold.delete(shape.id);
        restorePreviewHold(state, held);
        startEdgeWipe(state, held, existing, wipe.polylines);
      } else if (!previewActive && held && !wipe) {
        state.previewHold.delete(shape.id);
        disposePreviewHold(state, held);
      }
      return;
    }

    if (held && held.userData.renderFingerprint === fingerprint && !wipe) {
      if (existing) {
        if (state.edgeWipe?.incoming === existing) finishEdgeWipe(state);
        state.shapeLayer.remove(existing);
        disposeObject(existing);
        existingById.delete(shape.id);
      }
      state.previewHold.delete(shape.id);
      restorePreviewHold(state, held);
      applyShapePose(held, shape);
      held.userData.showEdges = showEdges;
      syncSelectionOutline(held, showEdges, state.camera);
      keepIds.add(shape.id);
      return;
    }

    let outgoing: THREE.Object3D | null = null;
    let settleCarry = 0;
    if (wipe) {
      outgoing = held ?? (existing && existing.userData.renderFingerprint !== fingerprint ? existing : null);
      if (held) {
        state.previewHold.delete(shape.id);
        restorePreviewHold(state, held);
      }
      if (existing && existing !== outgoing) {
        if (state.edgeWipe?.incoming === existing) finishEdgeWipe(state);
        state.shapeLayer.remove(existing);
        disposeObject(existing);
        existingById.delete(shape.id);
      } else if (existing && existing === outgoing) {
        tagEdgeWipeRole(existing, "out");
        setObjectPickable(existing, false);
        existingById.delete(shape.id);
      }
    } else if (existing) {
      settleCarry = remainingSettleLift(existing);
      if (previewActive && !held) {
        stashPreviewHold(state, existing, shape.id);
        existingById.delete(shape.id);
      } else {
        if (state.edgeWipe?.incoming === existing) finishEdgeWipe(state);
        state.shapeLayer.remove(existing);
        disposeObject(existing);
        existingById.delete(shape.id);
      }
    }

    const object = createShapeObject(shape, false, () => {
      state.needsRender = true;
    });
    if (state.laserDesign && !shape.hole && !shape.construction) addLaserJobMarks(object, shape);
    object.userData.renderFingerprint = fingerprint;
    object.userData.showEdges = showEdges;
    syncSelectionOutline(object, showEdges, state.camera);
    state.shapeLayer.add(object);
    keepIds.add(shape.id);
    if (outgoing && wipe) {
      startEdgeWipe(state, outgoing, object, wipe.polylines);
    } else if (!existing && !held && !shape.construction) {
      if (pendingScaleIntro?.ids.has(shape.id)) combineSolids.push(object);
      // A drawn sketch rises out of its outline. Shapes from the menu (a star, a slot) are
      // built from an outline too, but they drop in like every other shape.
      else if ((shape.sketchFinish === "extrude" || shape.sketchFinish === "revolve") && !shape.generated) riseSolids.push(object);
      else if (!shape.hole || shape.id === SKETCH_EXTRUDE_PREVIEW_ID || shape.generated) newSolids.push(object);
    } else if (settleCarry > 0) {
      // Rebuilt part-way through its drop (its exact shape just arrived): finish the drop.
      carriedSettles.push({ object, lift: settleCarry });
    }
  });

  for (const [shapeId, object] of existingById) {
    if (!keepIds.has(shapeId)) {
      if (state.edgeWipe?.incoming === object) finishEdgeWipe(state);
      state.shapeLayer.remove(object);
      disposeObject(object);
    }
  }

  for (const [shapeId, held] of [...state.previewHold]) {
    if (keepIds.has(shapeId) || state.edgeWipe?.outgoing === held) continue;
    state.previewHold.delete(shapeId);
    disposePreviewHold(state, held);
  }

  if (showCutPreviews) {
    scheduleCutPreviewOverlays(state, visibleShapes);
  } else {
    // Cancel pending CSG + remove overlays so hole drags stay as light as solid drags.
    clearCutPreviewOverlays(state);
  }

  rebuildSelectionHelpers(state, shapes, selectedIds);
  rebuildPrintOverlays(state, !showCutPreviews);
  const initialSync = !state.shapeLayer.userData.didInitialShapeSync;
  state.shapeLayer.userData.didInitialShapeSync = true;
  if (!initialSync && newSolids.length > 0 && newSolids.length <= MAX_SETTLE_SHAPES) {
    newSolids.forEach((object) => {
      object.userData.settleRestY = object.position.y;
      object.position.y = object.position.y + settleLiftMm();
      startShapeSettle(state, object);
    });
  }
  carriedSettles.forEach(({ object, lift }) => {
    object.userData.settleRestY = object.position.y;
    startShapeSettle(state, object, lift);
  });
  // When the finished part replaces the extrude preview, it is already standing: no second rise.
  const previewHandoff = previewWasShown && !visibleShapes.some((shape) => shape.id === SKETCH_EXTRUDE_PREVIEW_ID);
  if (!initialSync && !previewHandoff) {
    riseSolids.forEach((object) => startSketchExtrudeRise(state, object));
  }
  const introScale = pendingScaleIntro?.startScale ?? COMBINE_START_SCALE;
  combineSolids.forEach((object) => startShapeCombine(state, object, introScale));
  applyXrayClipping(state);
  // autoUpdate is off, so a fresh scene has no shadow map until this runs.
  // Without it, MeshStandardMaterials stay blank until the first drag ends.
  markShadowsDirty(state);
  state.shapeRevision = (state.shapeRevision ?? 0) + 1;
  if (state.modifierPreviewActive && state.modifierEdgeSource) {
    rebuildModifierEdges(
      state,
      state.modifierEdgeSource,
      state.modifierEdgeSelectedIds ?? [],
      true,
      state.modifierEdgeHoverId ?? null,
    );
  }
}
