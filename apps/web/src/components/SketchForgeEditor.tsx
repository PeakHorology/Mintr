"use client";

import { Download, X } from "lucide-react";
import type { ManifoldToplevel } from "manifold-3d";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { ADDITION, Brush, Evaluator, HOLLOW_INTERSECTION, INTERSECTION, SUBTRACTION, type CSGOperation } from "three-bvh-csg";
import * as THREE from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clearManifoldRuntimeCache, getManifoldRuntime } from "@/lib/manifoldRuntime";
import { simplifiedImportedShapePatch } from "@/lib/meshSimplify";
import {
  curveSidesForShape,
  curvedDisplayTessellation,
  modifierPreviewQualityForDisplay,
  resolveHollowCylinderSegments,
  resolveIcosahedronDetail,
  resolveShapeSides,
  resolveShapeSteps,
  setActiveDisplayQuality,
} from "@/lib/displayTessellation";
import { roofAnglesFromProfile } from "@/lib/roofGeometry";
import { sphereTessellation } from "@/lib/sphereTessellation";
import { DEFAULT_TEXT_FONT, resolveTextFont, textFontCurveSegments } from "@/lib/textFonts";
import {
  ToolbarExportIcon,
  ToolbarImportIcon,
} from "./icons";
import { WorkplaneViewport } from "./WorkplaneViewport";
import { SketchWorkspace, type SketchMeasurement, type SketchSelection, type SketchTool } from "./SketchWorkspace";
import { HistoryPanel } from "./workplane/HistoryPanel";
import { ToolbarFlow } from "./workplane/ToolbarFlow";
import { ShapeModeMark } from "./workplane/ShapeModeMark";
import { classifySketchExtrude } from "@/lib/sketchExtrudeSwatch";
import { EdgeModifierPanel } from "./workplane/EdgeModifierPanel";
import { PushPullPanel } from "./workplane/PushPullPanel";
import { ShellPanel } from "./workplane/ShellPanel";
import { SplitPanel } from "./workplane/SplitPanel";
import { CircularPatternPanel } from "./workplane/CircularPatternPanel";
import { LinearPatternPanel } from "./workplane/LinearPatternPanel";
import { PlacementRulerPanel } from "./workplane/PlacementRulerPanel";
import { ExportSuccessOverlay, type ExportSuccessPayload } from "./workplane/ExportSuccessOverlay";
import { InlineValueDialog } from "./workplane/InlineValueDialog";
import { ActiveToolChip } from "./workplane/ActiveToolChip";
import {
  canonicalizeShape,
  cleanNearZero,
  cleanRotationDegrees,
  fallbackSolidColor,
  mirroredAxisCount,
  mirrorSign,
  normalizeDegrees,
  preservesEdgeTreatmentSize,
  resizedImportedMeshPositions,
  serializeShapesForSync,
  coneUnitBaseScale,
  coneUnitTopScale,
  shapeDepth,
  shapeWidth,
  withHoleMode,
  workplaneShapesEqual,
} from "@/lib/workplaneShapes";
import {
  cloneShapesForPaste,
  readShapeClipboard,
  readSharedClipboard,
  SHARED_CLIPBOARD_STORAGE_KEY,
  writeShapeClipboard,
} from "@/lib/shapeClipboard";
import {
  type BooleanCleanupOptions,
  bumpCsgVersion,
  cleanupBooleanPositions,
  csgTreeContainsId,
  faceHoleCutDepthMm,
  faceHoleOvershootMm,
  findCsgBodyOwningLeaf,
  findShapeInTree,
  inferCsgOp,
  markCsgClean,
  migrateShapesCsg,
  reorderCsgChild,
  replaceLeafInCsgTree,
  setCsgChildSuppressed,
  expandBooleanOperands,
  filterCoplanarDisplayEdges,
  pickGroupToUngroup,
  withCsgMeta,
} from "@/lib/csgTree";
import type { CsgOp } from "@/types/sketchforge";
import { bakeCadMetadataForShapeTransform, cadBrepTransformForShape, cadModifierPrimitiveForAnalyticBox, cadModifierPrimitiveForAnalyticCone, cadModifierPrimitiveForAnalyticCylinder, cadModifierPrimitiveForAnalyticPolygon, cadModifierPrimitiveForBakedShape, cadModifierPrimitiveForExactKind } from "@/lib/cadBakeMetadata";
import { hasOneToOneCadComponentMapping } from "@/lib/cadModifierGroups";
import {
  CAD_MODIFIER_MAX_SHARP_ANGLE,
  cadModifierRequestTimeoutMs,
  cadModifierTimeoutMessage,
  cadModifierWorkerFailureMessage,
  type CadModifierRequestPhase,
} from "@/lib/cadModifierRuntime";
import { cadFailureCopy } from "@/lib/cadFailureCopy";
import { prefersReducedMotion } from "@/lib/chromePresence";
import { PUSH_PULL_APPLY_EPSILON, PUSH_PULL_COMMIT_MS, pushPullHistoryLabel } from "@/lib/pushPullGeometry";
import { createCadPreviewQueue } from "@/lib/cadPreviewQueue";
import { hardwareProfile } from "@/lib/desktopHardware";
import {
  bakeImportedBrepStepsForSave,
  importedBrepStepsAwaitingSave,
  withBakedImportedBrepSteps,
} from "@/lib/importedBrepSource";
import { meshDataToTransfer, runManifoldBooleanInWorker, warmManifoldBooleanWorker } from "@/lib/manifoldBooleanClient";
import { cloneWorkplaneShapeSnapshot, compactEdgeTreatmentHistory, edgeTreatmentAppliedFrame, lastEditableEdgeTreatment, restoreShapeBeforeEdgeTreatment } from "@/lib/edgeTreatmentHistory";
import { appendEditorHistorySnapshot, editorHistoryEntry, expandHistoryShapes, groupingMotionForSceneChange, historyShapeMissingTessellation, historyShapeNeedsRemesh, historyStepLabel, hydrateEditorHistoryState, projectShapesFingerprint, type EditorHistoryEntry, type EditorHistoryState } from "@/lib/editorHistory";
import { faceSampleForSide, faceToFaceMate, layFaceOnWorkplane } from "@/lib/objectSnap";
import { modelActionLabel, modelActionNeedsConsent, modelGrantKey, readModelsEnabled, writeModelsEnabled } from "@/lib/modelBridge";
import { createLocalId } from "@/lib/localIds";
import {
  CIRCULAR_PATTERN_DEFAULT_COUNT,
  circularPatternCopyId,
  circularPatternInstances,
  circularPatternSuggestedRadius,
  circularPatternWouldClamp,
  clampCircularPatternCount,
  clampCircularPatternRadius,
  clampCircularPatternRotation,
  defaultCircularPatternCenter,
  resolveCircularPatternSourceId,
  type CircularPatternCenter,
  type CircularPatternRotationStep,
} from "@/lib/circularPattern";
import {
  LINEAR_PATTERN_DEFAULT_COUNT_X,
  LINEAR_PATTERN_DEFAULT_COUNT_Y,
  LINEAR_PATTERN_DEFAULT_COUNT_Z,
  clampLinearPatternCount,
  clampLinearPatternSpacing,
  linearPatternInstances,
  linearPatternSuggestedSpacing,
  linearPatternWouldClamp,
  resolveLinearPatternSourceId,
} from "@/lib/linearPattern";
import { edgeTreatmentSourceParts } from "@/lib/edgeTreatmentSources";
import { SHELL_SIDES, shellMaxThickness, type ShellSide } from "@/lib/shellLimits";
import { clampCutClearance, cutShapeToFitBest, type CutJoint } from "@/lib/cutToFit";
import { splitPlaneFrame, splitShapeWithPlane, type SplitAxis } from "@/lib/splitShape";
import {
  dissolvePatternFeature,
  findPatternSource,
  patternFeatureId,
  patternMemberIds,
  replacePatternFeature,
  syncLinkedPatternShapes,
  tagCircularPatternInstances,
  tagLinearPatternInstances,
} from "@/lib/patternFeature";
import {
  isConstructionShape,
} from "@/lib/holeFeature";
import { dropPatchOntoFrame, dropSurfaceY } from "@/lib/placementFrame";
import { aabbsOverlap, shapeYawDegrees, worldAabb } from "@/lib/shapeBounds";
import {
  applyPlacementOffsetsToSelection,
  placementOffsetsFromBaseline,
  placementPoseOf,
  recapturePlacementBaseline,
  type PlacementBaseline,
  type PlacementOffsets,
} from "@/lib/placementRuler";
import {
  cloneSketchPlane,
  defaultSketchPlane,
  isDefaultSketchPlane,
  isFaceHostedSketch,
  mergeSketchPlanes,
  resolveSketchPlane,
  sketchBasisMatrix,
} from "@/lib/sketchPlane";
import {
  prepareFaceSketchReference,
  worldTrianglesFromMeshData,
} from "@/lib/sketchFaceReference";
import { barrelFaceLoop, classifySketchFaceHit, discCapFaceLoop } from "@/lib/sketchFaceClassify";
import {
  barrelHoleCutDepthMm,
  barrelThroughDepthMm,
  isCylinderSketchPlane,
  wrapCircleRadialCylinder,
  wrapUvLoopRadialPrism,
} from "@/lib/sketchCylinder";
import { HOTKEYS_CHANGED_EVENT, isHotkeyRecordingActive, loadHotkeyBindings, matchHotkeyAction } from "@/lib/hotkeys";
import {
  arcSketchGeometry,
  composeSketchProfile,
  DEFAULT_SKETCH_POLYGON_SIDES,
  geometryForSketchPart,
  ellipseSketchGeometry,
  MAX_SKETCH_POLYGON_SIDES,
  MIN_SKETCH_POLYGON_SIDES,
  offsetLineSketchGeometry,
  rectangleSketchGeometry,
  regularPolygonSketchGeometry,
  roundedRectangleSketchGeometry,
  slotSketchGeometry,
  squareSketchGeometry,
  starSketchGeometry,
} from "@/lib/sketchDrawShapes";
import { resolveSketchRevolveAxis, shapeFromSketchRevolve, type SketchRevolveAxis } from "@/lib/sketchRevolve";
import { shapeFromSketchSweep } from "@/lib/sketchSweep";
import { planSketchSweep, resolveSketchSweep, sweepChainHit, sweepSpec, type SweepChain } from "@/lib/sketch/sweepPlan";
import {
  buildStepExportPreflight,
  occtMeshFallbackNotice,
  selectionSupportsOcctCsg,
  shapeExportQualityLabel,
  type StepPreflightRow,
} from "@/lib/stepQuality";
import { fingerprintsForEdgeIds, matchRecipeEdgeIds } from "@/lib/edgeTreatmentRematch";
import { densifyClosedPathUv } from "@/lib/sketchBrep";
import { withExactSketchExtrusionSolid } from "@/lib/sketchExtrusionSolid";

import {
  axisAlignedRectFromClosedPath,
  circleFromClosedPath,
  cloneSketchProfile,
  emptySketchProfile,
  orderedSketchPaths,
  pasteSketchClipboardIntoProfile,
  shapeFromSketchProfile,
  settleBezierSegment,
  sketchClipboardFromSelection,
  splitSketchSegmentAt,
  withSketchPointMode,
  withSmoothSketchHandles,
  type SketchClipboard,
} from "@/lib/sketchProfileShape";
import { makeBlockPerfScene, makeHouseScene } from "@/lib/devAutomationScenes";
import { booleanAutomationDynamicScene, booleanAutomationScene } from "@/lib/devBooleanAutomationScenes";
import {
  cadDisplayEdgesAfterTreatment,
  cadDisplayEdgesForShape,
  cadModifierComponentPreviews,
  edgeTreatmentFeatureCount,
  edgeTreatmentHistoryOptions,
  edgeTreatmentLabel,
  groupedShapeWithComponentEdgeTreatment,
  restoreOwnLastEdgeTreatment,
  reversibleEdgeTreatmentCount,
  selectableCadModifierEdge,
  shapeWithEdgeTreatmentRecord,
  tangentCadEdgeChain,
  bakedEdgeTreatmentPreview,
  recutIgnoredThreadsAfterEdgeTreatment,
  shapeFromCadMesh,
} from "@/lib/editorEdgeTreatments";
import { cloneAsGroupChild, groupedShape } from "@/lib/editorGroup";
import {
  type Cuboid,
  type MeshData,
  type Vec3,
  appendMeshData,
  boundsForCuboids,
  boundsForShapes,
  meshAabb,
  meshForShape,
  shapeAabb,
  withMatchedTextFootprint,
} from "@/lib/editorShapeMesh";
import { MIN_SHAPE_DIMENSION, cleanModelDimension } from "@/lib/modelDimension";
import {
  alignedShapesForSelection,
  alignmentLabel,
  alignmentStatuses,
  buildGroupedShapeFromSelection,
  buildIntersectionShapeFromSelection,
  cleanShapePatch,
  effectiveAlignmentAnchorId,
  findOverlappingHostForHole,
  mirrorAxisLabel,
  mirroredShapesForSelection,
  remeshCsgGroup,
  restoreGroupedChildren,
  rewriteSketchHostIds,
  separablePartCount,
  separateShapeParts,
  shapeThicknessInwardFromFace,
  updateCsgLeafAndRemesh,
} from "@/lib/editorBoolean";
export type { Cuboid, MeshData, Vec3 };

import { promoteWorkplaneSketchToPrimitive } from "@/lib/sketchPrimitivePromote";
import {
  addConstraints,
  addLinearDimension,
  addRadiusDimension,
  beginEditSketchSession,
  boxEdgesForProjection,
  cloneSketchDoc,
  closeOpenPathGaps,
  closedProfilesFromLegacy,
  createEmptySketchDoc,
  ensureSketchDocOnShape,
  constructionGuideLines,
  filletCorners,
  chamferCorners,
  mirrorEntities,
  mergeProfileIntoDoc,
  profileWithConstructionGuides,
  projectEdgesOntoSketch,
  rectangularPattern,
  circularPatternSketch,
  patternSelectionCenter,
  removeConstraint,
  resizeSegmentLength,
  resolveEditableSketchShape,
  setCornerAngle,
  setDrivingDimensionValue,
  shapeHasEditableSketch,
  omitCurveStandIns,
  sketchDocToProfile,
  sketchProfileToDoc,
  solveSketchDoc,
  strokeProfile,
  resolveSketchCircle,
  trimClickedSpan,
  type SketchDefinitionStatus,
  type SketchDoc,
  type SketchFocusMode,
  type SketchSnapResult,
} from "@/lib/sketch";
import { SketchPalette } from "@/components/workplane/SketchPalette";
import { WorkspaceSettingsModal } from "@/components/workplane/WorkspaceSettingsModal";
import {
  applyRepeatActionToDuplicate,
  computeShapeRepeatDelta,
  createDuplicateForRepeat,
  DEFAULT_SHAPE_REPEAT_DELTA,
  hasShapeRepeatDelta,
  snapshotShapesForRepeat,
  type ShapeRepeatAction,
  type ShapeRepeatDelta,
} from "@/lib/shapeRepeat";
import { DEFAULT_VIEW_NUDGE_AXES, viewNudgeDelta, type ViewNudgeAxes } from "@/lib/viewNudge";
import { downloadBlobFile, downloadTextFile, DOWNLOAD_FOLDER_STORAGE_KEY, type DownloadResult } from "@/lib/downloadFile";
import { launchInstalledSlicer } from "@/lib/slicerHandoff";
import { useSlicerChoice } from "@/components/workplane/useSlicerChoice";
import { projectExportFileName } from "@/lib/exportNames";
import { makeShapeFromAsset, sceneShape, toolbarShapeAssets } from "@/lib/shapeCatalog";
import { BlueprintExportModal } from "@/components/workplane/BlueprintExportModal";
import { EditorTopBar, SketchFocusTabs } from "@/components/workplane/EditorTopBar";
import type { BlueprintExportFormat } from "@/lib/blueprintExport";
import { EditorModeStrip, EditorViewportToolbar } from "@/components/workplane/EditorViewportToolbar";
import { SketchCreateMenu } from "@/components/workplane/SketchCreateMenu";
import { isPeakcadProSketchTool, SketchCoach, SketchFinishToolbar, SketchToolSidebar, SketchUtilitySidebar, sketchCoach, type SketchCoachKey } from "@/components/workplane/SketchToolSidebar";
import { ShapeSidebar } from "@/components/workplane/ShapeSidebar";
import { importedShapeFromStl, importExtensionSupported } from "@/lib/stlImport";
import type { MeshSeatMode } from "@/lib/meshSeatOrientation";
import { displayToMillimeters, formatMeasurementNumber, lengthDisplayUnit, millimetersToDisplay } from "@/lib/measurementUnits";
import { importedShapeFrom3mf } from "@/lib/threeMfImport";
import { to3mfForShapes } from "@/lib/threeMfExport";
import { importedShapeFromSvg, invalidSvgMeshReason } from "@/lib/svgImport";
import { DEFAULT_SNAP_GRID, normalizeSnapGrid, normalizeWorkspaceSettings, saveGlobalWorkspaceDefaults } from "@/lib/workplaneSettings";
import {
  SKETCHFORGE_MCP_POLL_MS,
  SKETCHFORGE_MCP_POLL_WAIT_MS,
  SKETCHFORGE_MCP_ROUTE,
  type SketchForgeMcpCommand,
  type SketchForgeMcpSceneSummary,
  type SketchForgeMcpShapeSummary,
  type SketchForgeMcpViewFace,
} from "@/lib/sketchforgeMcpProtocol";
import type { CadModifierComponentMesh, CadModifierDisplayEdge, CadModifierEdge, CadModifierKind, CadModifierMeshPart, CadModifierPrimitivePart, CadModifierQuality, CadModifierWorkerRequest, CadModifierWorkerResponse, CadPlanarFace } from "@/lib/cadModifierTypes";
import { takePreloadedCadModifierWorker } from "@/lib/cadModifierPreload";
import {
  mapNativeCadModifierReply,
  nativeCadModifierCanHandle,
  requestNativeCadModifier,
} from "@/lib/nativeCadModifier";
import { nativeOcctKernelIsReady, warmNativeOcctKernel } from "@/lib/nativeKernelProtocol";
import { nearestMetricThreadForDiameter, type MetricThreadDesignation } from "@/lib/metricThreads";
import { canSeparateThreadScrew, containsHelicalThreadSolid, createThreadShape, DEFAULT_THREAD_DESIGNATION, separateThreadScrewParts } from "@/lib/threadShape";
import type { AlignAxis, AlignHandleStatus, AlignTarget, GridSize, ShapeAsset, SketchImage, SketchPlane, SketchPoint, SketchProfile, SketchSegment, WorkplaneShape, WorkplaneWorkspaceSettings } from "@/types/sketchforge";

export { importedShapeFromStl, importedShapeFromSvg, importedShapeFrom3mf };

export type ProjectSaveSnapshot = {
  projectId: string;
  shapes: WorkplaneShape[];
  history: EditorHistoryEntry[];
  historyIndex: number;
};
/** Resolves `false` when the save was cancelled (Save As picker closed) or failed. */
export type ProjectSaveHandler = (snapshot: ProjectSaveSnapshot) => Promise<boolean> | void;
/** Lets the page ask the open editor before leaving it, and route menu Save through the editor. */
export type EditorLeaveGuard = {
  confirmLeave: () => Promise<boolean>;
  save: (mode: "save" | "save-as") => Promise<boolean>;
  command?: (action: "import" | "export") => void;
};
export type TopPanel = "import" | "export" | "tips" | null;
export type ExportFormat = "stl" | "obj" | "3mf";
export type ToolbarMode = "geometry" | "sketch";
export type ValueDialogState =
  | { kind: "sketch-fillet" | "sketch-chamfer"; pointIds: string[] }
  | { kind: "sketch-pattern" | "sketch-circular-pattern"; entityIds: string[] }
  | { kind: "sketch-stroke" }
  | null;

const SKETCH_POINT_CHAIN_TOOLS = new Set<SketchTool>(["line", "bezier"]);
const SKETCH_MULTI_POINT_TOOLS = new Set<SketchTool>([
  "dimension",
  "fillet",
  "chamfer",
  "constrain-h",
  "constrain-v",
  "constrain-coincident",
  "constrain-symmetry",
  "constrain-concentric",
  "constrain-tangent",
  "constrain-midpoint",
]);
const SKETCH_MULTI_SEGMENT_TOOLS = new Set<SketchTool>([
  "constrain-equal",
  "constrain-parallel",
  "constrain-perp",
  "constrain-symmetry",
  "constrain-tangent",
  "constrain-concentric",
  "mirror",
  "pattern",
  "circular-pattern",
]);

/** Click-to-pick for constraint and modify tools. One click replaces; a second click adds. */
function accumulateSketchPick(
  current: SketchSelection,
  tool: SketchTool,
  pick: { pointId?: string; segmentId?: string },
): SketchSelection {
  const chain = SKETCH_MULTI_POINT_TOOLS.has(tool) || SKETCH_MULTI_SEGMENT_TOOLS.has(tool);
  if (!chain) {
    if (pick.pointId) return { kind: "point", id: pick.pointId };
    if (pick.segmentId) return { kind: "segment", id: pick.segmentId };
    return current;
  }
  const pointIds = current?.kind === "multiple" ? [...current.pointIds] : current?.kind === "point" ? [current.id] : [];
  const segmentIds = current?.kind === "multiple" ? [...current.segmentIds] : current?.kind === "segment" ? [current.id] : [];
  if (pick.pointId && !pointIds.includes(pick.pointId)) pointIds.push(pick.pointId);
  if (pick.segmentId && !segmentIds.includes(pick.segmentId)) segmentIds.push(pick.segmentId);
  if (!pointIds.length && segmentIds.length === 1) return { kind: "segment", id: segmentIds[0] };
  if (!segmentIds.length && pointIds.length === 1) return { kind: "point", id: pointIds[0] };
  return { kind: "multiple", pointIds, segmentIds, imageIds: [] };
}

/** Resolves once the browser has painted, so an overlay is on screen before synchronous work blocks the main thread. */
function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    // requestAnimationFrame never fires in a hidden window; don't stall the import on it.
    const fallback = window.setTimeout(resolve, 250);
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        window.clearTimeout(fallback);
        resolve();
      }, 0);
    });
  });
}

/** Routine coaching/status text that shouldn't demand full toast attention. */
function isQuietNotice(message: string): boolean {
  if (!message) return false;
  if (message.startsWith("Tip:")) return true;
  const quietExact = new Set(["Sketch undo", "Sketch redo", "Ready"]);
  if (quietExact.has(message)) return true;
  const quietPrefixes = [
    "Polygon: click the center",
    "Click a face to sketch",
    "Select highlighted edges",
    "Edge treatment preview ready",
    "Sketch selection cleared",
    "Selected ",
    "Sketch image selected",
    "Feature selected",
  ];
  return quietPrefixes.some((prefix) => message.startsWith(prefix));
}
export type ShapeUpdatePatch = Partial<WorkplaneShape> & { bakeTransform?: boolean; repeatDeltaBefore?: WorkplaneShape };
export type WithoutRequestId<T> = T extends unknown ? Omit<T, "requestId"> : never;
export type CadModifierWorkerPayload = WithoutRequestId<CadModifierWorkerRequest>;
export type EdgeModifierSession = {
  kind: CadModifierKind;
  edges: CadModifierEdge[];
  selectedEdgeIds: number[];
  amount: number;
  sharpAngle: number;
  chamferAngle: number;
  quality: CadModifierQuality;
  tangentChain: boolean;
  preserveEdgeSize: boolean;
  busy: boolean;
  prepared: boolean;
  error: string | null;
  preview: WorkplaneShape | null;
  componentPreviews: EdgeModifierComponentPreview[];
  /** Recipe being edited so prepare can reselect the original edges. */
  editRecipe?: NonNullable<WorkplaneShape["edgeTreatments"]>[number];
};

function edgeWipePointsFromSession(session: EdgeModifierSession): { polylines: number[][] } | undefined {
  const selected = new Set(session.selectedEdgeIds);
  const polylines: number[][] = [];
  for (const edge of session.edges) {
    if (!selected.has(edge.id) || edge.points.length < 6) continue;
    polylines.push(edge.points);
  }
  return polylines.length > 0 ? { polylines } : undefined;
}

export type EdgeModifierComponentPreview = {
  owner: number;
  shape: WorkplaneShape;
};
export type CircularPatternSession = {
  sourceIds: string[];
  pivotId: string | null;
  center: CircularPatternCenter | null;
  radius: number;
  count: number;
  rotation: CircularPatternRotationStep;
  preview: WorkplaneShape[] | null;
  featureId?: string;
  editing?: boolean;
};
export type LinearPatternSession = {
  sourceIds: string[];
  countX: number;
  countZ: number;
  countY: number;
  spacingX: number;
  spacingZ: number;
  spacingY: number;
  preview: WorkplaneShape[] | null;
  featureId?: string;
  editing?: boolean;
};
export type PlacementRulerSession = {
  baseline: PlacementBaseline | null;
  baselineId: string | null;
};
export type EdgeFeatureRevertOption = {
  id: string;
  entryId: string;
  path: number[];
  label: string;
  targetName: string;
  createdAt: number;
  removesNewerCount: number;
};
export type ManifoldSolid = ReturnType<ManifoldToplevel["Manifold"]["cube"]>;
export type GroupBuildResult = {
  group: WorkplaneShape | null;
  booleanSelection: WorkplaneShape[];
  hasSolid: boolean;
  hasHole: boolean;
  hasImportedMesh: boolean;
  consumed: boolean;
  failureNotice: string;
  /** Mesh bodies left on the workplane so they do not poison an exact CAD Group. */
  leftOutShapes?: WorkplaneShape[];
  /** Shown when exact OCCT boolean was eligible but mesh fallback was used. */
  qualityNotice?: string;
};
export type IntersectionAttempt =
  | { status: "success"; group: WorkplaneShape }
  | { status: "empty" }
  | { status: "unsupported" };
export type IntersectionBuildResult = {
  group: WorkplaneShape | null;
  empty: boolean;
  failureNotice: string;
};
export type BooleanAutomationMode = "before" | "after" | "ungroup";
export type BooleanAutomationResult = {
  ok: boolean;
  caseId: string;
  label: string;
  mode: BooleanAutomationMode;
  notice: string;
  shapeCount: number;
  selectedCount: number;
  triangleCount?: number;
  groupedCount?: number;
  groupId?: string;
  error?: string;
};
declare global {
  interface Window {
    __sketchforgeBooleanTest?: BooleanAutomationResult;
    __sketchforgeBooleanTestImage?: string;
    sketchforgeCaptureCanvas?: (options?: { hideOverlays?: boolean }) => string;
    sketchforgeCaptureView?: (face?: SketchForgeMcpViewFace) => Promise<string> | string;
    sketchforgeCaptureProjectThumbnails?: (options?: { hideOverlays?: boolean }) => { light: string; dark: string } | null;
  }
}

/** Face-hole cutters overshoot along the cut normal only (not XY grow). */
const MAX_SKETCH_HISTORY_ENTRIES = hardwareProfile().sketchHistoryEntries;
const MIN_EDGE_MODIFIER_AMOUNT = 0.001;




function meshDataToCadTransfer(mesh: MeshData) {
  const positions = new Float32Array(mesh.vertices.length * 3);
  mesh.vertices.forEach((vertex, index) => positions.set(vertex, index * 3));
  const indices = new Uint32Array(mesh.faces.length * 3);
  mesh.faces.forEach((face, index) => indices.set(face, index * 3));
  return { positions, indices };
}



async function restoreEdgeTreatmentInShape(shape: WorkplaneShape, path: number[], entryId: string): Promise<{ shape: WorkplaneShape; label: string } | null> {
  if (path.length === 0) {
    const entry = (shape.edgeTreatmentHistory ?? []).find((candidate) => candidate.id === entryId);
    return entry ? { shape: restoreOwnLastEdgeTreatment(shape, entry), label: edgeTreatmentLabel(entry.feature) } : null;
  }

  if (!shape.groupedShapes?.length) {
    return null;
  }

  const [childIndex, ...restPath] = path;
  const restoredChildren = restoreGroupedChildren(shape);
  const child = restoredChildren[childIndex];
  if (!child) {
    return null;
  }
  const restoredChild = await restoreEdgeTreatmentInShape(child, restPath, entryId);
  if (!restoredChild) {
    return null;
  }

  restoredChildren[childIndex] = restoredChild.shape;
  const rebuilt = await buildGroupedShapeFromSelection(restoredChildren);
  if (!rebuilt.group) {
    return null;
  }

  return {
    shape: canonicalizeShape({
      ...rebuilt.group,
      id: shape.id,
      name: shape.name,
      color: shape.color,
      hole: shape.hole || rebuilt.group.hole,
      locked: shape.locked,
      hidden: shape.hidden,
      edgeResizeMode: shape.edgeResizeMode,
      edgeTreatments: shape.edgeTreatments,
      edgeTreatmentHistory: shape.edgeTreatmentHistory?.length ? compactEdgeTreatmentHistory(shape.edgeTreatmentHistory) : undefined,
    }),
    label: restoredChild.label,
  };
}


function shapeHasTransformToBake(shape: WorkplaneShape) {
  return (
    Math.abs(cleanRotationDegrees(shape.rotation ?? 0, 3)) > 0 ||
    Math.abs(cleanRotationDegrees(shape.rotationX ?? 0, 3)) > 0 ||
    Math.abs(cleanRotationDegrees(shape.rotationZ ?? 0, 3)) > 0 ||
    Boolean(shape.mirrorX || shape.mirrorY || shape.mirrorZ)
  );
}

function cadModifierPrimitiveForShape(shape: WorkplaneShape): CadModifierPrimitivePart | null {
  return cadModifierPrimitiveForBakedShape(shape)
    ?? cadModifierPrimitiveForAnalyticCylinder(shape)
    ?? cadModifierPrimitiveForAnalyticCone(shape)
    ?? cadModifierPrimitiveForAnalyticPolygon(shape)
    ?? cadModifierPrimitiveForExactKind(shape)
    ?? (shapeHasTransformToBake(shape) ? cadModifierPrimitiveForAnalyticBox(shape) : null)
    ?? cadModifierPrimitiveForAnalyticBox(shape);
}

/** True when the stored B-Rep only needs a rigid move (plus uniform scale) to match the shape. */
function cadBrepScaleIsUniform(shape: WorkplaneShape) {
  const frame = shape.cadBrepFrame;
  if (!frame) return false;
  const sx = shapeWidth(shape) / Math.max(0.001, frame.width);
  const sy = shape.height / Math.max(0.001, frame.height);
  const sz = shapeDepth(shape) / Math.max(0.001, frame.depth);
  const tolerance = 1e-4 * Math.max(1, sx);
  return Math.abs(sx - sy) <= tolerance && Math.abs(sx - sz) <= tolerance;
}

/**
 * Parts to prepare for Push Pull. A Group's own B-Rep is what is on screen, so
 * use it whenever the kernel can restore it with a rigid transform; rebuilding
 * from the children is the fallback for a missing or stretched B-Rep.
 */
function pushPullSourceParts(shape: WorkplaneShape): WorkplaneShape[] {
  const parts = edgeTreatmentSourceParts(shape);
  if (!shape.groupedShapes?.length) return parts;
  const brepUsable = parts.length > 0 && parts.every((part) => (
    cadModifierPrimitiveForShape(part) || (part.cadBrep && cadBrepScaleIsUniform(part))
  ));
  if (brepUsable) return parts;
  const children = restoreGroupedChildren(shape).flatMap((child) => edgeTreatmentSourceParts(child));
  const rebuildable = children.filter((child) => cadModifierPrimitiveForShape(child) || child.cadBrep);
  return rebuildable.length >= 2 ? children : parts;
}

function shapeKeepsLiveParameters(shape: WorkplaneShape) {
  if (shape.kind === "mesh") return false;
  if (shape.cadBrep || shape.edgeTreatments?.length) return false;
  if ((shape.importedMesh?.positions.length ?? 0) >= 9) return false;
  return true;
}

function bakeShapeTransformIntoMesh(shape: WorkplaneShape): WorkplaneShape {
  if (!shapeHasTransformToBake(shape)) {
    return shape;
  }
  // A turned group has to keep its children. Baking the angle into one mesh
  // deleted them, so Ungroup had nothing left to open.
  if (shape.groupedShapes?.length) {
    return shape;
  }
  // Pyramids, text, cylinders, and the other live tools store their settings on
  // the shape. Baking a turn into a mesh dropped those controls.
  if (shapeKeepsLiveParameters(shape)) {
    return shape;
  }

  const mesh = meshForShape(shape);
  if (mesh.vertices.length < 3 || mesh.faces.length < 1) {
    return shape;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  mesh.vertices.forEach(([x, y, z]) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  });

  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) {
    return shape;
  }

  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const rawWidth = Math.max(MIN_SHAPE_DIMENSION, maxX - minX);
  const rawHeight = Math.max(MIN_SHAPE_DIMENSION, maxY - minY);
  const rawDepth = Math.max(MIN_SHAPE_DIMENSION, maxZ - minZ);
  const width = cleanModelDimension(rawWidth);
  const height = cleanModelDimension(rawHeight);
  const depth = cleanModelDimension(rawDepth);
  const positions: number[] = [];
  const bakedCadMetadata = bakeCadMetadataForShapeTransform(shape, { centerX, minY, centerZ, width, depth, height, yawDegrees: shapeYawDegrees(shape) });

  mesh.faces.forEach(([ai, bi, ci]) => {
    [mesh.vertices[ai], mesh.vertices[bi], mesh.vertices[ci]].forEach(([x, y, z]) => {
      positions.push(x - centerX, y - minY, z - centerZ);
    });
  });

  return {
    ...shape,
    kind: "mesh",
    x: cleanNearZero(centerX, 0.0005),
    z: cleanNearZero(centerZ, 0.0005),
    elevation: cleanNearZero(minY, 0.0005),
    width,
    depth,
    height,
    size: Math.max(width, depth),
    rotation: 0,
    rotationX: 0,
    rotationZ: 0,
    mirrorX: undefined,
    mirrorY: undefined,
    mirrorZ: undefined,
    importedMesh: {
      positions,
      baseWidth: rawWidth,
      baseDepth: rawDepth,
      baseHeight: rawHeight,
      triangleCount: mesh.faces.length,
      sourceFormat: "json",
    },
    ...bakedCadMetadata,
    imagePlate: undefined,
    groupedShapes: undefined,
    groupedBaseWidth: undefined,
    groupedBaseDepth: undefined,
    groupedBaseHeight: undefined,
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Image could not be read"));
      }
    });
    reader.addEventListener("error", () => reject(new Error("Image could not be read")));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Image could not be decoded")));
    image.src = dataUrl;
  });
}

async function prepareImportedImage(file: File) {
  const sourceUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceUrl);
  const pixelWidth = image.naturalWidth || image.width;
  const pixelHeight = image.naturalHeight || image.height;

  if (!pixelWidth || !pixelHeight) {
    throw new Error("Image has no readable dimensions");
  }

  const maxTextureSide = hardwareProfile().maxTextureSide;
  const textureScale = Math.min(1, maxTextureSide / Math.max(pixelWidth, pixelHeight));
  if (textureScale >= 1) {
    return {
      dataUrl: sourceUrl,
      mimeType: file.type || "image/png",
      pixelWidth,
      pixelHeight,
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(pixelWidth * textureScale));
  canvas.height = Math.max(1, Math.round(pixelHeight * textureScale));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Image could not be prepared");
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const mimeType = file.type === "image/jpeg" || file.type === "image/webp" ? file.type : "image/png";
  return {
    dataUrl: canvas.toDataURL(mimeType, 0.92),
    mimeType,
    pixelWidth,
    pixelHeight,
  };
}

function imagePlateDimensions(pixelWidth: number, pixelHeight: number) {
  const aspect = pixelWidth / Math.max(1, pixelHeight);
  const targetMax = 72;
  const minVisibleSide = 14;
  const maxAllowedSide = 110;
  let width = aspect >= 1 ? targetMax : targetMax * aspect;
  let depth = aspect >= 1 ? targetMax / aspect : targetMax;
  const minSide = Math.min(width, depth);

  if (minSide < minVisibleSide) {
    const boost = minVisibleSide / Math.max(0.001, minSide);
    width *= boost;
    depth *= boost;
  }

  const maxSide = Math.max(width, depth);
  if (maxSide > maxAllowedSide) {
    const shrink = maxAllowedSide / maxSide;
    width *= shrink;
    depth *= shrink;
  }

  return {
    width: Number(width.toFixed(2)),
    depth: Number(depth.toFixed(2)),
    height: 1.6,
  };
}

async function importedShapeFromImage(file: File): Promise<WorkplaneShape> {
  const imagePlate = await prepareImportedImage(file);
  const dimensions = imagePlateDimensions(imagePlate.pixelWidth, imagePlate.pixelHeight);
  return {
    id: createLocalId("uploaded-image"),
    name: file.name.replace(/\.[^.]+$/, "") || "Imported Image",
    kind: "box",
    color: "#f4f7f9",
    x: 10,
    z: -10,
    size: Math.max(dimensions.width, dimensions.depth),
    width: dimensions.width,
    depth: dimensions.depth,
    height: dimensions.height,
    elevation: 0,
    rotation: 0,
    rotationX: 0,
    rotationZ: 0,
    radius: 0,
    steps: 1,
    imagePlate,
    locked: false,
    hidden: false,
  };
}

function normalFor(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

/** Binary STL (little-endian). Much cheaper than ASCII string join for large meshes. */
function toStl(meshes: MeshData[]) {
  let triangleCount = 0;
  for (const mesh of meshes) triangleCount += mesh.faces.length;
  const bytes = new Uint8Array(84 + triangleCount * 50);
  const view = new DataView(bytes.buffer);
  const header = "PeakCAD binary STL";
  for (let i = 0; i < 80; i += 1) {
    bytes[i] = i < header.length ? header.charCodeAt(i) : 0;
  }
  view.setUint32(80, triangleCount, true);
  let offset = 84;
  for (const mesh of meshes) {
    for (const [ai, bi, ci] of mesh.faces) {
      const a = mesh.vertices[ai];
      const b = mesh.vertices[bi];
      const c = mesh.vertices[ci];
      const n = normalFor(a, b, c);
      view.setFloat32(offset, n[0], true); offset += 4;
      view.setFloat32(offset, n[1], true); offset += 4;
      view.setFloat32(offset, n[2], true); offset += 4;
      view.setFloat32(offset, a[0], true); offset += 4;
      view.setFloat32(offset, a[1], true); offset += 4;
      view.setFloat32(offset, a[2], true); offset += 4;
      view.setFloat32(offset, b[0], true); offset += 4;
      view.setFloat32(offset, b[1], true); offset += 4;
      view.setFloat32(offset, b[2], true); offset += 4;
      view.setFloat32(offset, c[0], true); offset += 4;
      view.setFloat32(offset, c[1], true); offset += 4;
      view.setFloat32(offset, c[2], true); offset += 4;
      view.setUint16(offset, 0, true); offset += 2;
    }
  }
  return bytes;
}

function toObj(meshes: MeshData[]) {
  const lines = ["# PeakCAD OBJ export"];
  let offset = 1;
  meshes.forEach((mesh) => {
    lines.push(`o ${mesh.name}`);
    mesh.vertices.forEach(([x, y, z]) => lines.push(`v ${x} ${y} ${z}`));
    mesh.faces.forEach(([a, b, c]) => lines.push(`f ${a + offset} ${b + offset} ${c + offset}`));
    offset += mesh.vertices.length;
  });
  return lines.join("\n");
}



/** Restore mesh caches stripped from compact history snapshots. */
async function remeshDirtyHistoryShapes(shapes: WorkplaneShape[]): Promise<{ shapes: WorkplaneShape[]; failedNames: string[] }> {
  if (!shapes.some(historyShapeNeedsRemesh)) {
    return { shapes, failedNames: [] };
  }
  const next = [...shapes];
  const failedNames: string[] = [];
  for (let index = 0; index < next.length; index += 1) {
    const shape = next[index];
    if (!historyShapeNeedsRemesh(shape)) continue;
    const hadEdgeFeatures = Boolean(shape.edgeTreatments?.length || shape.cadBrep);
    const remeshed = await remeshCsgGroup(shape);
    if (remeshed) {
      let restored = remeshed;
      // Keep recipes; drop only baked BREP/display edges (IDs are invalid until re-apply).
      if (hadEdgeFeatures) {
        restored = {
          ...restored,
          edgeTreatments: shape.edgeTreatments ?? restored.edgeTreatments,
          edgeTreatmentHistory: shape.edgeTreatmentHistory ?? restored.edgeTreatmentHistory,
          edgeResizeMode: shape.edgeResizeMode ?? restored.edgeResizeMode,
          cadBrep: undefined,
          cadBrepFrame: undefined,
          cadDisplayEdges: undefined,
          cadDisplayEdgesVersion: undefined,
        };
      }
      next[index] = restored;
    } else {
      failedNames.push(shape.name || shape.id);
      // Refuse silent stale mesh: mark dirty so UI/export can warn.
      next[index] = {
        ...shape,
        csg: shape.csg
          ? { ...shape.csg, dirty: true }
          : { op: inferCsgOp(shape) ?? "union", version: 1, dirty: true },
      };
    }
  }
  return { shapes: next, failedNames };
}

/** Keep host body id when a cut/union result replaces an existing CSG host. */
function asPreservedCsgBody(host: WorkplaneShape, group: WorkplaneShape): WorkplaneShape {
  // Always preserve the host id so face-sketch links, selection, and Features stay stable
  // when the first cut/join wraps a bare box/cylinder/import into a CSG body.
  const bodyId = host.id;
  const body = bodyId === group.id
    ? { ...group, name: host.name || group.name, color: host.color || group.color }
    : { ...group, id: bodyId, name: host.name, color: host.color };
  return rewriteSketchHostIds(body, host.id, bodyId);
}

/** World triangles for face-sketch outlines — prefer evaluated mesh caches (CSG/import). */
function worldTrianglesForHostShape(host: WorkplaneShape) {
  const mesh = meshForShape(host);
  return worldTrianglesFromMeshData(mesh.vertices, mesh.faces);
}

function debugShapeSummary(shape: WorkplaneShape): Record<string, unknown> {
  return {
    id: shape.id,
    name: shape.name,
    kind: shape.kind,
    hole: Boolean(shape.hole),
    x: Number(shape.x.toFixed(3)),
    z: Number(shape.z.toFixed(3)),
    elevation: Number((shape.elevation ?? 0).toFixed(3)),
    width: Number(shapeWidth(shape).toFixed(3)),
    depth: Number(shapeDepth(shape).toFixed(3)),
    height: Number(shape.height.toFixed(3)),
    rotation: Number(shape.rotation.toFixed(3)),
    rotationX: Number((shape.rotationX ?? 0).toFixed(3)),
    rotationZ: Number((shape.rotationZ ?? 0).toFixed(3)),
    mirrorX: Boolean(shape.mirrorX),
    mirrorY: Boolean(shape.mirrorY),
    mirrorZ: Boolean(shape.mirrorZ),
    importedTriangles: shape.importedMesh?.triangleCount ?? 0,
    imagePlate: shape.imagePlate ? `${shape.imagePlate.pixelWidth}x${shape.imagePlate.pixelHeight}` : null,
    edgeTreatments: shape.edgeTreatments ?? [],
    cadDisplayEdgeCount: shape.cadDisplayEdges?.length ?? null,
    cadDisplayEdgesVersion: shape.cadDisplayEdgesVersion ?? null,
    edgeResizeMode: shape.edgeResizeMode ?? "scale",
    cadBrepLength: shape.cadBrep?.length ?? 0,
    cadPrimitiveKind: shape.cadPrimitiveFrame?.kind ?? null,
    groupedCount: shape.groupedShapes?.length ?? 0,
    children: shape.groupedShapes?.map(debugShapeSummary) ?? [],
  };
}

function compactShapeSummary(shape: WorkplaneShape, index: number) {
  const childSummary = shape.groupedShapes
    ?.map((child) => `${child.kind}${child.hole ? "H" : "S"}${child.importedMesh ? "I" : ""}`)
    .join("+");
  return [
    `${index}:${shape.kind}${shape.hole ? "H" : "S"}${shape.importedMesh ? "I" : ""}${shape.imagePlate ? "P" : ""}`,
    `g${shape.groupedShapes?.length ?? 0}`,
    `tri${shape.importedMesh?.triangleCount ?? 0}`,
    `edge${shape.edgeTreatments?.map((feature) => `${feature.kind}:${feature.amount}:${feature.edgeCount}:${feature.chamferAngle ?? ""}`).join("|") ?? ""}`,
    `viewEdges${shape.cadDisplayEdges?.length ?? "auto"}v${shape.cadDisplayEdgesVersion ?? 0}`,
    `edgeResize${shape.edgeResizeMode ?? "scale"}`,
    `brep${shape.cadBrep?.length ?? 0}`,
    `prim${shape.cadPrimitiveFrame ? `${shape.cadPrimitiveFrame.kind}:${shape.cadPrimitiveFrame.width}:${shape.cadPrimitiveFrame.depth}:${shape.cadPrimitiveFrame.height}` : ""}`,
    `p${Number(shape.x.toFixed(2))},${Number(shape.z.toFixed(2))},${Number((shape.elevation ?? 0).toFixed(2))}`,
    `d${Number(shapeWidth(shape).toFixed(2))}x${Number(shapeDepth(shape).toFixed(2))}x${Number(shape.height.toFixed(2))}`,
    `r${Number((shape.rotationX ?? 0).toFixed(1))},${Number(shape.rotation.toFixed(1))},${Number((shape.rotationZ ?? 0).toFixed(1))}`,
    `m${shape.mirrorX ? "x" : ""}${shape.mirrorY ? "y" : ""}${shape.mirrorZ ? "z" : ""}`,
    childSummary ? `c[${childSummary}]` : "c[]",
  ].join(",");
}

function mcpShapeSummary(shape: WorkplaneShape): SketchForgeMcpShapeSummary {
  return {
    id: shape.id,
    name: shape.name,
    kind: shape.kind,
    color: shape.color,
    hole: Boolean(shape.hole),
    locked: Boolean(shape.locked),
    hidden: Boolean(shape.hidden),
    position: {
      x: shape.x,
      z: shape.z,
      elevation: shape.elevation ?? 0,
    },
    dimensions: {
      width: shapeWidth(shape),
      depth: shapeDepth(shape),
      height: shape.height,
      size: shape.size,
    },
    rotation: {
      x: shape.rotationX ?? 0,
      y: shape.rotation,
      z: shape.rotationZ ?? 0,
    },
    mirror: {
      x: Boolean(shape.mirrorX),
      y: Boolean(shape.mirrorY),
      z: Boolean(shape.mirrorZ),
    },
    edgeTreatments: shape.edgeTreatments ?? [],
    groupedCount: shape.groupedShapes?.length ?? 0,
    importedTriangles: shape.importedMesh?.triangleCount ?? 0,
    cadDisplayEdgeCount: shape.cadDisplayEdges?.length ?? null,
    sketchPointCount: shape.sketchProfile?.points.length ?? 0,
    sketchSegmentCount: shape.sketchProfile?.segments.length ?? 0,
    children: shape.groupedShapes?.map(mcpShapeSummary),
  };
}

function defaultMcpSketchProfile(width: number, depth: number): SketchProfile {
  const halfWidth = Math.max(0.01, width) / 2;
  const halfDepth = Math.max(0.01, depth) / 2;
  const pointIds = ["mcp-sketch-a", "mcp-sketch-b", "mcp-sketch-c", "mcp-sketch-d"].map((prefix) => createLocalId(prefix));
  return {
    points: [
      { id: pointIds[0], x: -halfWidth, z: -halfDepth, mode: "corner" },
      { id: pointIds[1], x: halfWidth, z: -halfDepth, mode: "corner" },
      { id: pointIds[2], x: halfWidth, z: halfDepth, mode: "corner" },
      { id: pointIds[3], x: -halfWidth, z: halfDepth, mode: "corner" },
    ],
    segments: [
      { id: createLocalId("mcp-sketch-segment"), startId: pointIds[0], endId: pointIds[1], kind: "line" },
      { id: createLocalId("mcp-sketch-segment"), startId: pointIds[1], endId: pointIds[2], kind: "line" },
      { id: createLocalId("mcp-sketch-segment"), startId: pointIds[2], endId: pointIds[3], kind: "line" },
      { id: createLocalId("mcp-sketch-segment"), startId: pointIds[3], endId: pointIds[0], kind: "line" },
    ],
    images: [],
  };
}

function mcpNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mcpString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function mcpStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  }
  return typeof value === "string" && value.length > 0 ? [value] : [];
}

function mcpNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === "number" && Number.isInteger(entry)) : [];
}

function mcpFiniteNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry)) : [];
}

function readMcpEditorIdentity() {
  const storageKey = "sketchforge.mcp.editorIdentity";
  try {
    const existing = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null") as { editorId?: unknown; editorNumber?: unknown } | null;
    if (typeof existing?.editorId === "string" && typeof existing.editorNumber === "number") {
      return { editorId: existing.editorId, editorNumber: existing.editorNumber };
    }
  } catch {
    // Session identity is best-effort; fall through and create a new one.
  }

  const randomValues = new Uint32Array(1);
  window.crypto?.getRandomValues?.(randomValues);
  const editorNumber = 10000 + ((randomValues[0] || Math.floor(Math.random() * 90000)) % 90000);
  const editorId = window.crypto?.randomUUID?.() ?? `sketchforge-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const identity = { editorId, editorNumber };
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(identity));
  } catch {
    // Private browsing can block sessionStorage; the in-memory identity is enough for this tab.
  }
  return identity;
}

export function SketchForgeEditor({
  initialShapes = [],
  initialHistory,
  initialHistoryIndex,
  initialSnap,
  initialWorkspace,
  onHome,
  onProjectShapesChange,
  onProjectSnapshot,
  onProjectWorkspaceChange,
  onProjectNameChange,
  onSaveProject,
  onSaveProjectAs,
  onRegisterLeaveGuard,
  hasMatchingSavedFile = false,
  projectId,
  projectName = "PeakCAD design",
  projectRevision = 0,
  onViewportReady,
}: {
  initialShapes?: WorkplaneShape[];
  initialHistory?: EditorHistoryEntry[];
  initialHistoryIndex?: number;
  initialSnap?: GridSize;
  initialWorkspace?: WorkplaneWorkspaceSettings;
  onHome?: () => void;
  onProjectShapesChange?: (snapshot: {
    projectId: string;
    shapes: WorkplaneShape[];
    history: EditorHistoryEntry[];
    historyIndex: number;
  }) => void;
  onProjectSnapshot?: (snapshot: { image: string; imageDark?: string; projectId: string; shapes: number }) => void;
  onProjectWorkspaceChange?: (snapshot: { projectId: string; workspace: WorkplaneWorkspaceSettings; snap: GridSize }) => void;
  onProjectNameChange?: (name: string) => void;
  onSaveProject?: ProjectSaveHandler;
  onSaveProjectAs?: ProjectSaveHandler;
  onRegisterLeaveGuard?: (guard: EditorLeaveGuard | null) => void;
  hasMatchingSavedFile?: boolean;
  projectId?: string | null;
  projectName?: string;
  projectRevision?: number;
  onViewportReady?: () => void;
} = {}) {
  const initialSceneRef = useRef<WorkplaneShape[] | null>(null);
  if (initialSceneRef.current === null) {
    initialSceneRef.current = initialShapes.map(canonicalizeShape);
  }
  const initialHistoryStateRef = useRef<EditorHistoryState | null>(null);
  if (initialHistoryStateRef.current === null) {
    initialHistoryStateRef.current = hydrateEditorHistoryState(initialSceneRef.current, initialHistory, initialHistoryIndex);
  }
  const [shapes, setShapes] = useState<WorkplaneShape[]>(() => initialSceneRef.current as WorkplaneShape[]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<WorkplaneShape[]>([]);
  const [systemClipboardSupported, setSystemClipboardSupported] = useState(false);
  const [history, setHistory] = useState<EditorHistoryEntry[]>(() => (initialHistoryStateRef.current as EditorHistoryState).entries);
  const [historyIndex, setHistoryIndex] = useState(() => (initialHistoryStateRef.current as EditorHistoryState).index);
  const [historyBrowse, setHistoryBrowse] = useState<number | null>(null);
  const historyBrowseRef = useRef<number | null>(null);
  const historyEditNoticeRef = useRef(false);
  historyBrowseRef.current = historyBrowse;
  useEffect(() => {
    historyEditNoticeRef.current = false;
    if (historyBrowse === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setHistoryBrowse(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [historyBrowse]);
  const [importAsHole, setImportAsHole] = useState(false);
  const [stlSeatPrompt, setStlSeatPrompt] = useState<{ name: string; buffer: ArrayBuffer } | null>(null);
  const [modelLoadingName, setModelLoadingName] = useState<string | null>(null);
  const modelLoadingTokenRef = useRef(0);
  const [exactStepSaveProgress, setExactStepSaveProgress] = useState<{ done: number; total: number } | null>(null);
  const [unsavedPrompt, setUnsavedPrompt] = useState<{ saving: boolean } | null>(null);
  const unsavedPromptResolveRef = useRef<((leave: boolean) => void) | null>(null);
  const explicitSaveInFlightRef = useRef(false);
  /** Scene fingerprint at the last explicit save (or at project open); autosave does not move it. */
  const explicitSaveFingerprintRef = useRef<string | null>(null);
  const [placementRuler, setPlacementRuler] = useState<PlacementRulerSession | null>(null);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkplaneWorkspaceSettings>(() => {
    const normalized = normalizeWorkspaceSettings(initialWorkspace);
    setActiveDisplayQuality(normalized.displayQuality);
    return normalized;
  });
  const [snapGrid, setSnapGrid] = useState<GridSize>(() => normalizeSnapGrid(initialSnap, DEFAULT_SNAP_GRID));
  const [menuOpen, setMenuOpen] = useState(false);
  const [topPanel, setTopPanel] = useState<TopPanel>(null);
  const [renderedTopPanel, setRenderedTopPanel] = useState<TopPanel>(null);
  const [topPanelClosing, setTopPanelClosing] = useState(false);
  useEffect(() => {
    if (topPanel) {
      setRenderedTopPanel(topPanel);
      setTopPanelClosing(false);
      return;
    }
    setTopPanelClosing(true);
    const timer = window.setTimeout(() => {
      setRenderedTopPanel(null);
      setTopPanelClosing(false);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [topPanel]);
  const [stepExporting, setStepExporting] = useState(false);
  const slicer = useSlicerChoice();
  const [exportSuccess, setExportSuccess] = useState<ExportSuccessPayload | null>(null);
  const exportSuccessSeqRef = useRef(0);
  const celebrateExport = useCallback((format: string, detail?: string) => {
    exportSuccessSeqRef.current += 1;
    setExportSuccess({ id: exportSuccessSeqRef.current, format, detail });
  }, []);
  const [blueprintExporting, setBlueprintExporting] = useState(false);
  const [blueprintExportOpen, setBlueprintExportOpen] = useState(false);
  const [alignMode, setAlignMode] = useState(false);
  const [faceSnap, setFaceSnap] = useState<{ source: { shapeId: string; point: [number, number, number]; normal: [number, number, number] } | null } | null>(null);
  const [modelPrompt, setModelPrompt] = useState<{ clientName: string; label: string } | null>(null);
  const [modelConnected, setModelConnected] = useState(false);
  const [modelAction, setModelAction] = useState("");
  const modelConsentSettleRef = useRef<((choice: "once" | "project" | "deny") => void) | null>(null);
  const [layFlat, setLayFlat] = useState(false);
  const [dropSurface, setDropSurface] = useState(false);
  const faceSnapMotionRef = useRef<((
    shapeId: string,
    pose: { x: number; z: number; elevation: number; rotationX: number; rotation: number; rotationZ: number },
    done: () => void,
  ) => void) | null>(null);
  const [alignAnchorId, setAlignAnchorId] = useState<string | null>(null);
  const [alignPreview, setAlignPreview] = useState<{ axis: AlignAxis; target: AlignTarget } | null>(null);
  const [mirrorMode, setMirrorMode] = useState(false);
  const [mirrorPreviewAxis, setMirrorPreviewAxis] = useState<AlignAxis | null>(null);
  const [activeMode, setActiveMode] = useState("3D Design");
  const [notice, setNoticeState] = useState("Ready");
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [noticeSeq, setNoticeSeq] = useState(0);
  const [noticeQuiet, setNoticeQuiet] = useState(false);
  const setNotice = useCallback((message: string) => {
    setNoticeState(message);
    setNoticeQuiet(isQuietNotice(message));
    // Bump even when the text is unchanged so a dismissed toast reappears.
    setNoticeSeq((value) => value + 1);
  }, []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sketchImageInputRef = useRef<HTMLInputElement | null>(null);
  const booleanAutomationRunRef = useRef<string | null>(null);
  const projectHydratingRef = useRef(false);
  const projectInteractionActiveRef = useRef(false);
  const pendingProjectShapesRef = useRef<WorkplaneShape[] | null>(null);
  const projectSyncTimerRef = useRef<number | null>(null);
  const lastProjectShapesSyncRef = useRef("");
  const lastProjectShapesEchoRef = useRef<string | null>(null);
  const lastProjectIdRef = useRef<string | null>(null);
  const lastProjectFrameRef = useRef<string | null>(null);
  const shapesRef = useRef(shapes);
  const selectedIdsRef = useRef(selectedIds);
  const workspaceSettingsRef = useRef(workspaceSettings);
  const noticeRef = useRef(notice);
  const projectInfoRef = useRef({ projectId: projectId ?? null, projectName });
  const historyIndexRef = useRef(historyIndex);
  const historyRef = useRef(history);
  /**
   * Depth of nested "apply this without recording a step" sections.
   *
   * Re-applying fillets after an undo runs through the ordinary commit path, and appending to the
   * history truncates everything above the cursor — so undoing a filleted boolean body threw the
   * redo stack away and stacked the re-application on top as undo steps of its own.
   */
  const historyWriteSuspendedRef = useRef(0);
  const interactionHistoryStartRef = useRef("");
  const interactionHistoryChangedRef = useRef(false);
  const interactionHistoryTimerRef = useRef<number | null>(null);
  const interactionStartShapesRef = useRef<Record<string, WorkplaneShape> | null>(null);
  const lastShapeActionRef = useRef<Record<string, ShapeRepeatAction>>({});
  const duplicateRepeatDeltasRef = useRef<Map<string, ShapeRepeatDelta>>(new Map());
  const viewNudgeAxesRef = useRef<ViewNudgeAxes>(DEFAULT_VIEW_NUDGE_AXES);
  const rotationEditApiRef = useRef<{ dismiss: () => void } | null>(null);
  const [projectInteractionActive, setProjectInteractionActive] = useState(false);
  const [toolbarMode, setToolbarMode] = useState<ToolbarMode>("geometry");
  const [shapeRailPinned, setShapeRailPinned] = useState(false);
  const [sketchActive, setSketchActive] = useState(false);
  const beginBlankSketchRef = useRef<() => void>(() => {});
  const [sketchFacePickMode, setSketchFacePickMode] = useState(false);
  const [sketchTool, setSketchTool] = useState<SketchTool>("line");
  const [sketchHoverTool, setSketchHoverTool] = useState<SketchCoachKey | null>(null);
  const sketchPickAtRef = useRef<{ x: number; z: number } | null>(null);
  const [sketchPolygonSides, setSketchPolygonSides] = useState(DEFAULT_SKETCH_POLYGON_SIDES);
  const [polygonSidesPrompt, setPolygonSidesPrompt] = useState<number | null>(null);
  const [extrudeHeightPrompt, setExtrudeHeightPrompt] = useState<number | null>(null);
  const [extrudeAsHole, setExtrudeAsHole] = useState(false);
  const [revolvePrompt, setRevolvePrompt] = useState<null | { phase: "pick" } | { phase: "confirm"; axis: SketchRevolveAxis }>(null);
  const [sweepPrompt, setSweepPrompt] = useState<
    null
    | { phase: "pick-outline" }
    | { phase: "pick-path"; outlineId: string }
    | { phase: "confirm"; spec: NonNullable<WorkplaneShape["sketchSweep"]> }
  >(null);
  const [sweepPreview, setSweepPreview] = useState<WorkplaneShape | null>(null);
  const [sweepBuildError, setSweepBuildError] = useState<string | null>(null);
  const [sketchProfile, setSketchProfile] = useState<SketchProfile>(() => emptySketchProfile());
  const [sketchDoc, setSketchDoc] = useState<SketchDoc>(() => createEmptySketchDoc(defaultSketchPlane()));
  const [sketchFocusMode, setSketchFocusMode] = useState<SketchFocusMode>("2d");
  const [sketchFrameRequest, setSketchFrameRequest] = useState(0);
  const [sketchSolveStatus, setSketchSolveStatus] = useState<SketchDefinitionStatus>("empty");
  const [sketchDof, setSketchDof] = useState(0);
  const [sketchConflicts, setSketchConflicts] = useState<string[]>([]);
  const [sketchHistory, setSketchHistory] = useState<SketchProfile[]>([emptySketchProfile()]);
  const [sketchHistoryIndex, setSketchHistoryIndex] = useState(0);
  const sketchHistoryRef = useRef(sketchHistory);
  const sketchHistoryIndexRef = useRef(sketchHistoryIndex);
  const [sketchActivePointId, setSketchActivePointId] = useState<string | null>(null);
  const [sketchSelection, setSketchSelection] = useState<SketchSelection>(null);
  const [sketchMeasureStart, setSketchMeasureStart] = useState<SketchPoint | null>(null);
  const [sketchMeasurement, setSketchMeasurement] = useState<SketchMeasurement>(null);
  const [sketchClipboard, setSketchClipboard] = useState<SketchClipboard | null>(null);
  const [editingSketchShapeId, setEditingSketchShapeId] = useState<string | null>(null);
  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);
  const [lastSketchSnap, setLastSketchSnap] = useState<SketchSnapResult | null>(null);
  const [edgeModifier, setEdgeModifier] = useState<EdgeModifierSession | null>(null);
  const [shellSession, setShellSession] = useState<{
    thickness: number;
    corners: "sharp" | "round";
    cornerRadius: number;
    openings: Array<"top" | "bottom" | "front" | "back" | "left" | "right">;
    busy: boolean;
    prepared: boolean;
    error: string | null;
    preview: WorkplaneShape | null;
  } | null>(null);
  const shellSessionRef = useRef(shellSession);
  useEffect(() => {
    shellSessionRef.current = shellSession;
  }, [shellSession]);
  const [pushPullSession, setPushPullSession] = useState<{
    faces: CadPlanarFace[];
    selectedFaceId: number | null;
    hoverFaceId: number | null;
    distance: number;
    dragging: boolean;
    settling: boolean;
    ghostOpacity: number;
    busy: boolean;
    prepared: boolean;
    error: string | null;
    preview: WorkplaneShape | null;
  } | null>(null);
  const pushPullSessionRef = useRef(pushPullSession);
  useEffect(() => {
    pushPullSessionRef.current = pushPullSession;
  }, [pushPullSession]);
  const [splitSession, setSplitSession] = useState<{
    shapeId: string;
    axis: SplitAxis;
    offset: number;
    joint: CutJoint;
    clearance: number;
  } | null>(null);
  const edgeModifierRef = useRef<EdgeModifierSession | null>(null);
  const [circularPattern, setCircularPattern] = useState<CircularPatternSession | null>(null);
  const circularPatternRef = useRef<CircularPatternSession | null>(null);
  const [linearPattern, setLinearPattern] = useState<LinearPatternSession | null>(null);
  const linearPatternRef = useRef<LinearPatternSession | null>(null);
  const [valueDialog, setValueDialog] = useState<ValueDialogState>(null);
  const [modeTransitioning, setModeTransitioning] = useState(false);
  const [hotkeys, setHotkeys] = useState(() => loadHotkeyBindings());
  const cadModifierWorkerRef = useRef<Worker | null>(null);
  const cadModifierPendingRef = useRef(new Map<number, {
    resolve: (message: CadModifierWorkerResponse) => void;
    reject: (error: Error) => void;
    timer: number;
    mesh?: Extract<CadModifierWorkerResponse, { type: "preview" }>;
  }>());
  const cadModifierRequestRef = useRef(0);
  const cadModifierPrepareRef = useRef(0);
  const cadModifierLatestPreviewRef = useRef(0);
  const cadPreviewSendRef = useRef<(payload: {
    type: "preview";
    kind: CadModifierKind;
    edgeIds: number[];
    amount: number;
    quality: CadModifierQuality;
    chamferAngle: number;
  }) => number | null>(() => null);
  const cadPreviewQueueRef = useRef(createCadPreviewQueue((payload: {
    type: "preview";
    kind: CadModifierKind;
    edgeIds: number[];
    amount: number;
    quality: CadModifierQuality;
    chamferAngle: number;
  }) => cadPreviewSendRef.current(payload)));
  const cadModifierBaseShapeRef = useRef<WorkplaneShape | null>(null);
  const reapplyEdgeTreatmentsRef = useRef<(shape: WorkplaneShape) => Promise<void>>(async () => {});
  const cadModifierBaseFingerprintRef = useRef("");
  const cadModifierSourcePartsRef = useRef<WorkplaneShape[]>([]);
  const cadModifierEditBeforeRef = useRef<WorkplaneShape | null>(null);
  const edgePreviewShapeRef = useRef<WorkplaneShape | null>(null);
  const edgePreviewSmoothRef = useRef(false);
  const edgeRefineRequestRef = useRef<number | null>(null);
  const cadModifierWatchdogRef = useRef<{ requestId: number; phase: CadModifierRequestPhase; timer: number } | null>(null);
  const cadModifierWorkerRestartRef = useRef<() => Worker | null>(() => null);
  const cadModifierNativeLiveRef = useRef(false);
  const cadModifierDispatchRef = useRef<(message: CadModifierWorkerResponse) => void>(() => {});
  /** Monotonic remesh generation — stale async remesh results are ignored. */
  const remeshGenerationRef = useRef(0);
  /** Debounced CSG remesh while dragging feature property sliders. */
  const featureRemeshTimerRef = useRef<number | null>(null);
  const pendingFeatureRemeshRef = useRef<{ bodyId: string; message: string } | null>(null);
  /** True after a Manifold-only (skipOcct) remesh — flush exact CAD on pointer-up. */
  const featureRemeshNeedsExactRef = useRef(false);
  const lastMcpErrorRef = useRef<string | null>(null);
  const executeMcpCommandRef = useRef<((command: SketchForgeMcpCommand) => Promise<unknown>) | null>(null);

  const clearCadModifierWatchdog = useCallback((requestId?: number) => {
    const active = cadModifierWatchdogRef.current;
    if (!active || (requestId !== undefined && active.requestId !== requestId)) return;
    window.clearTimeout(active.timer);
    cadModifierWatchdogRef.current = null;
  }, []);

  const armCadModifierWatchdog = useCallback((requestId: number, phase: CadModifierRequestPhase) => {
    clearCadModifierWatchdog();
    const timer = window.setTimeout(() => {
      const active = cadModifierWatchdogRef.current;
      if (!active || active.requestId !== requestId) return;
      cadModifierWatchdogRef.current = null;
      cadModifierWorkerRef.current?.terminate();
      cadModifierWorkerRef.current = null;
      cadModifierNativeLiveRef.current = false;
      cadModifierRequestRef.current += 1;
      cadModifierPrepareRef.current = cadModifierRequestRef.current;
      cadModifierWorkerRestartRef.current();
      const message = pushPullSessionRef.current
        ? "Push Pull timed out loading faces. Close it and try again."
        : cadModifierTimeoutMessage(phase);
      setEdgeModifier((current) => current ? {
        ...current,
        busy: false,
        prepared: false,
        preview: null,
        error: message,
      } : current);
      setPushPullSession((current) => current ? {
        ...current,
        busy: false,
        prepared: false,
        preview: null,
        error: message,
      } : current);
      setNotice(message);
    }, hardwareProfile().modifierTimeoutMs || cadModifierRequestTimeoutMs());
    cadModifierWatchdogRef.current = { requestId, phase, timer };
  }, [clearCadModifierWatchdog]);

  useEffect(() => {
    let disposed = false;
    const rejectPendingRequests = (message: string) => {
      cadModifierPendingRef.current.forEach((pending) => {
        window.clearTimeout(pending.timer);
        pending.reject(new Error(message));
      });
      cadModifierPendingRef.current.clear();
    };
    const reportWorkerFailure = (worker: Worker | null, detail?: string) => {
      if (worker && cadModifierWorkerRef.current !== worker) return;
      clearCadModifierWatchdog();
      worker?.terminate();
      cadModifierWorkerRef.current = null;
      rejectPendingRequests(cadModifierWorkerFailureMessage());
      const requestId = cadModifierRequestRef.current + 1;
      cadModifierRequestRef.current = requestId;
      cadModifierPrepareRef.current = requestId;
      cadModifierLatestPreviewRef.current = requestId;
      cadPreviewQueueRef.current.reset();
      if (detail) {
        console.error("[PeakCAD] CAD worker failed to start:", detail);
      }
      if (cadModifierBaseShapeRef.current) {
        // Surfaced by the edge modifier panel's own error state — skip the redundant toast.
        const message = cadModifierWorkerFailureMessage();
        setEdgeModifier((current) => current ? { ...current, busy: false, prepared: false, preview: null, error: message } : current);
      }
    };
    const spareWorkersRef = { current: [] as Worker[] };
    const bindPrimaryWorker = (worker: Worker) => {
      worker.onmessage = handleWorkerMessage;
      worker.onerror = (event) => {
        event.preventDefault();
        const detail = [event.message, event.filename, event.lineno].filter(Boolean).join(" @ ");
        reportWorkerFailure(worker, detail || "worker error event");
      };
      worker.onmessageerror = () => reportWorkerFailure(worker, "worker messageerror");
      return worker;
    };
    const createWorker = () => {
      if (disposed) return null;
      cadModifierWorkerRef.current?.terminate();
      spareWorkersRef.current.forEach((spare) => spare.terminate());
      spareWorkersRef.current = [];
      try {
        // Single primary worker only — a warm spare doubled startup failures and memory
        // without helping the common fillet/chamfer path (OCCT loads lazily on prepare).
        const adopted = takePreloadedCadModifierWorker();
        const worker = bindPrimaryWorker(adopted ?? new Worker(new URL("../workers/cadModifier.worker.ts", import.meta.url), { type: "module" }));
        cadModifierWorkerRef.current = worker;
        return worker;
      } catch (error) {
        reportWorkerFailure(null, error instanceof Error ? error.message : String(error));
        return null;
      }
    };
    function handleWorkerMessage(event: MessageEvent<CadModifierWorkerResponse>) {
      const message = event.data;
      clearCadModifierWatchdog(message.requestId);
      const pending = cadModifierPendingRef.current.get(message.requestId);
      if (pending) {
        window.clearTimeout(pending.timer);
        cadModifierPendingRef.current.delete(message.requestId);
        if (message.type === "error") {
          pending.reject(new Error(message.message));
        } else {
          pending.resolve(message);
        }
        return;
      }
      if (message.type === "ready") {
        if (message.requestId !== cadModifierPrepareRef.current) return;
        if (pushPullSessionRef.current) {
          const faces = message.planarFaces ?? [];
          setPushPullSession((current) => current ? {
            ...current,
            faces,
            prepared: true,
            busy: false,
            error: faces.length > 0 ? null : "Push Pull needs a flat face.",
          } : current);
          return;
        }
        if (shellSessionRef.current) {
          setShellSession((current) => current ? { ...current, prepared: true, busy: true, error: null } : current);
          return;
        }
        setEdgeModifier((current) => {
          if (!current) return current;
          const rematched = current.editRecipe
            ? matchRecipeEdgeIds(current.editRecipe, message.edges, current.sharpAngle)
            : [];
          const selectedEdgeIds = rematched.length > 0 ? rematched : [];
          const hasEdges = selectedEdgeIds.length > 0 || message.selectableEdgeIds.length > 0;
          return {
            ...current,
            edges: message.edges,
            selectedEdgeIds,
            busy: selectedEdgeIds.length > 0,
            prepared: true,
            preview: null,
            componentPreviews: [],
            error: hasEdges
              ? null
              : "No sharp manifold edges were found at this threshold",
          };
        });
        return;
      }
      if (message.type === "preview") {
        const isLatest = message.requestId === cadModifierLatestPreviewRef.current;
        const settled = message.smooth
          ? { status: "idle" as const, requestId: null }
          : cadPreviewQueueRef.current.settle(message.requestId);
        if (!isLatest) return;
        if (pushPullSessionRef.current) {
          const base = cadModifierBaseShapeRef.current;
          const rawPreview = base ? shapeFromCadMesh(base, message.positions, message.normals, message.indices, message.brep, message.step) : null;
          const preview = rawPreview ? {
            ...rawPreview,
            cadDisplayEdges: (message.displayEdges?.length ?? 0) > 0
              ? cadDisplayEdgesForShape(rawPreview, message.displayEdges)
              : (pushPullSessionRef.current.preview?.cadDisplayEdges ?? cadDisplayEdgesForShape(rawPreview, message.displayEdges ?? [])),
            cadDisplayEdgesVersion: 2 as const,
          } : null;
          setPushPullSession((current) => current ? {
            ...current,
            preview,
            busy: false,
            error: preview ? null : cadFailureCopy("That push went through the part. Try a smaller distance.", "pushPull"),
          } : current);
          return;
        }
        if (shellSessionRef.current) {
          const base = cadModifierBaseShapeRef.current;
          const rawPreview = base ? shapeFromCadMesh(base, message.positions, message.normals, message.indices, message.brep, message.step) : null;
          const preview = rawPreview ? {
            ...rawPreview,
            cadDisplayEdges: (message.displayEdges?.length ?? 0) > 0
              ? cadDisplayEdgesForShape(rawPreview, message.displayEdges)
              : (shellSessionRef.current.preview?.cadDisplayEdges ?? cadDisplayEdgesForShape(rawPreview, message.displayEdges ?? [])),
            cadDisplayEdgesVersion: 2 as const,
          } : null;
          setShellSession((current) => current ? {
            ...current,
            preview,
            busy: false,
            error: preview ? null : cadFailureCopy("The CAD kernel returned an empty body", "fillet"),
          } : current);
          if (rawPreview) setNotice("Hollow preview ready");
          return;
        }
        const base = cadModifierBaseShapeRef.current;
        const sourceParts = cadModifierSourcePartsRef.current.length ? cadModifierSourcePartsRef.current : (base ? [base] : []);
        const rawPreview = base ? shapeFromCadMesh(base, message.positions, message.normals, message.indices, message.brep, message.step) : null;
        const preview = rawPreview ? {
          ...rawPreview,
          cadDisplayEdges: message.displayEdges.length
            ? cadDisplayEdgesForShape(rawPreview, message.displayEdges)
            : (edgePreviewShapeRef.current?.cadDisplayEdges ?? cadDisplayEdgesForShape(rawPreview, message.displayEdges)),
          cadDisplayEdgesVersion: 2 as const,
        } : null;
        edgePreviewShapeRef.current = preview;
        edgePreviewSmoothRef.current = Boolean(message.smooth && preview);
        if (message.smooth) edgeRefineRequestRef.current = null;
        const componentPreviews = message.components
          ? cadModifierComponentPreviews(sourceParts, message.components)
          : null;
        setEdgeModifier((current) => current ? {
          ...current,
          preview,
          componentPreviews: componentPreviews ?? current.componentPreviews,
          busy: settled.status === "sent",
          error: preview ? null : "The CAD kernel returned an empty edge treatment",
        } : current);
        if (preview && !message.smooth) setNotice("Edge treatment preview ready");
        if (!message.smooth && settled.status === "idle" && preview && base) {
          const amount = edgeModifierRef.current?.amount ?? 1;
          const tolerances = curvedDisplayTessellation(amount, curveSidesForShape(base));
          const refineId = postCadModifierRequest({ type: "refine", ...tolerances });
          if (refineId !== null && cadModifierLatestPreviewRef.current === message.requestId) {
            edgeRefineRequestRef.current = refineId;
            cadModifierLatestPreviewRef.current = refineId;
          }
        }
        return;
      }
      if (message.type === "previewBrep") {
        if (message.requestId !== cadModifierLatestPreviewRef.current) return;
        setEdgeModifier((current) => {
          if (!current?.preview) return current;
          const componentPreviews = current.componentPreviews.map((component, index) => {
            const brep = message.componentBreps?.[index];
            if (!brep) return component;
            return { ...component, shape: { ...component.shape, cadBrep: brep } };
          });
          return {
            ...current,
            preview: { ...current.preview, cadBrep: message.brep },
            componentPreviews,
          };
        });
        return;
      }
      if (message.type === "error") {
        if (pushPullSessionRef.current) {
          // The panel shows friendly copy; keep the kernel's own words in the console for triage.
          console.warn("[push-pull] kernel error:", message.message);
        }
        if (!message.resetSession && message.requestId === edgeRefineRequestRef.current) {
          edgeRefineRequestRef.current = null;
          setEdgeModifier((current) => current ? { ...current, busy: false } : current);
          return;
        }
        const settled = cadPreviewQueueRef.current.settle(message.requestId);
        if (message.requestId < cadModifierLatestPreviewRef.current) return;
        if (message.resetSession) {
          const requestId = cadModifierRequestRef.current + 1;
          cadModifierRequestRef.current = requestId;
          cadModifierLatestPreviewRef.current = requestId;
          cadPreviewQueueRef.current.reset();
          cadModifierPrepareRef.current = requestId;
          cadModifierBaseShapeRef.current = null;
          cadModifierBaseFingerprintRef.current = "";
          cadModifierSourcePartsRef.current = [];
          cadModifierEditBeforeRef.current = null;
          edgePreviewShapeRef.current = null;
          edgePreviewSmoothRef.current = false;
          edgeRefineRequestRef.current = null;
          setEdgeModifier(null);
          setShellSession(null);
          setPushPullSession(null);
          setNotice(cadFailureCopy(message.message, pushPullSessionRef.current ? "pushPull" : "fillet"));
          return;
        }
        if (pushPullSessionRef.current) {
          setPushPullSession((current) => current ? { ...current, busy: false, preview: null, error: cadFailureCopy(message.message, "pushPull") } : current);
          return;
        }
        if (shellSessionRef.current) {
          setShellSession((current) => current ? { ...current, busy: false, error: cadFailureCopy(message.message, "fillet") } : current);
          return;
        }
        // The edge modifier panel already renders message.message as its error state.
        if (settled.status === "sent") return;
        setEdgeModifier((current) => current ? { ...current, busy: false, error: cadFailureCopy(message.message, current.kind === "chamfer" ? "chamfer" : "fillet") } : current);
      }
    }
    cadModifierDispatchRef.current = (message) => {
      handleWorkerMessage({ data: message } as MessageEvent<CadModifierWorkerResponse>);
    };
    cadModifierWorkerRestartRef.current = createWorker;
    return () => {
      disposed = true;
      clearCadModifierWatchdog();
      cadModifierWorkerRestartRef.current = () => null;
      rejectPendingRequests("The CAD worker was closed");
      cadModifierWorkerRef.current?.terminate();
      cadModifierWorkerRef.current = null;
      spareWorkersRef.current.forEach((spare) => spare.terminate());
      spareWorkersRef.current = [];
    };
  }, [clearCadModifierWatchdog]);

  const invalidateCadModifierSession = useCallback(() => {
    const wasActive = cadModifierBaseShapeRef.current !== null;
    if (!wasActive) return false;
    clearCadModifierWatchdog();
    const requestId = cadModifierRequestRef.current + 1;
    cadModifierRequestRef.current = requestId;
    cadModifierLatestPreviewRef.current = requestId;
    cadPreviewQueueRef.current.reset();
    cadModifierPrepareRef.current = requestId;
    if (cadModifierNativeLiveRef.current) {
      cadModifierNativeLiveRef.current = false;
      void requestNativeCadModifier({ type: "dispose" }, requestId, 4000);
    }
    cadModifierWorkerRef.current?.terminate();
    cadModifierWorkerRef.current = null;
    cadModifierBaseShapeRef.current = null;
    cadModifierBaseFingerprintRef.current = "";
    cadModifierSourcePartsRef.current = [];
    cadModifierEditBeforeRef.current = null;
    edgePreviewShapeRef.current = null;
    edgePreviewSmoothRef.current = false;
    edgeRefineRequestRef.current = null;
    setEdgeModifier(null);
    setShellSession(null);
    setPushPullSession(null);
    return true;
  }, [clearCadModifierWatchdog]);

  const clearEditorToolSessions = useCallback((keep?: "placement" | "align" | "mirror" | "linear" | "circular" | "fillet") => {
    if (keep !== "align") {
      setAlignMode(false);
      setAlignAnchorId(null);
      setAlignPreview(null);
    }
    if (keep !== "mirror") {
      setMirrorMode(false);
      setMirrorPreviewAxis(null);
    }
    if (keep !== "circular") {
      circularPatternRef.current = null;
      setCircularPattern(null);
    }
    if (keep !== "linear") {
      linearPatternRef.current = null;
      setLinearPattern(null);
    }
    if (keep !== "placement") {
      setPlacementRuler(null);
    }
    if (keep !== "fillet") {
      invalidateCadModifierSession();
    }
    setFaceSnap(null);
    setLayFlat(false);
    setDropSurface(false);
  }, [invalidateCadModifierSession]);

  useEffect(() => {
    const warmBooleanRuntime = () => {
      warmManifoldBooleanWorker();
      void getManifoldRuntime().catch(() => {
        // Allow a real grouping action to retry if an idle preload was interrupted.
        clearManifoldRuntimeCache();
      });
      void nativeOcctKernelIsReady().then((native) => {
        if (native) {
          warmNativeOcctKernel();
          return;
        }
        // Browser and kernel-less Electron still lazy-load occt-wasm on first exact job.
        void import("@/lib/brepKernel")
          .then(({ loadBrepWithOcct }) => loadBrepWithOcct())
          .catch(() => undefined);
      });
    };
    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(warmBooleanRuntime, { timeout: 1500 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timer = globalThis.setTimeout(warmBooleanRuntime, 250);
    return () => globalThis.clearTimeout(timer);
  }, []);

  useEffect(() => {
    setSystemClipboardSupported(Boolean(navigator.clipboard));
    void readShapeClipboard().then((stored) => {
      setClipboard(stored.length > 0 ? stored : readSharedClipboard());
    });
    const onStorage = (event: StorageEvent) => {
      if (event.key === SHARED_CLIPBOARD_STORAGE_KEY) {
        void readShapeClipboard().then((stored) => {
          setClipboard(stored.length > 0 ? stored : readSharedClipboard());
        });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
    const currentHistory = historyRef.current;
    const currentIndex = Math.min(historyIndexRef.current, Math.max(0, currentHistory.length - 1));
    const currentEntry = currentHistory[currentIndex];
    if (currentEntry && currentEntry.selectedIds.join("\0") !== selectedIds.join("\0")) {
      const updated = currentHistory.map((entry, index) => index === currentIndex ? { ...entry, selectedIds: [...selectedIds] } : entry);
      historyRef.current = updated;
      setHistory(updated);
    }
  }, [selectedIds]);

  useEffect(() => {
    workspaceSettingsRef.current = workspaceSettings;
    setActiveDisplayQuality(workspaceSettings.displayQuality);
  }, [workspaceSettings]);

  useEffect(() => {
    noticeRef.current = notice;
  }, [notice]);

  useEffect(() => {
    if (!notice || notice === "Ready") {
      setNoticeVisible(false);
      return;
    }
    setNoticeVisible(true);
    const timer = window.setTimeout(() => {
      setNoticeVisible(false);
    }, noticeQuiet ? 2_500 : 10_000);
    return () => window.clearTimeout(timer);
  }, [notice, noticeQuiet, noticeSeq]);

  const dismissNotice = useCallback(() => {
    setNoticeVisible(false);
  }, []);

  useEffect(() => {
    projectInfoRef.current = { projectId: projectId ?? null, projectName };
  }, [projectId, projectName]);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    sketchHistoryRef.current = sketchHistory;
  }, [sketchHistory]);

  useEffect(() => {
    sketchHistoryIndexRef.current = sketchHistoryIndex;
  }, [sketchHistoryIndex]);

  useEffect(() => {
    edgeModifierRef.current = edgeModifier;
  }, [edgeModifier]);

  useEffect(() => {
    circularPatternRef.current = circularPattern;
  }, [circularPattern]);

  useEffect(() => {
    linearPatternRef.current = linearPattern;
  }, [linearPattern]);

  useEffect(() => {
    if (!sketchActive) setSketchHoverTool(null);
  }, [sketchActive]);

  useEffect(() => {
    const refreshHotkeys = () => setHotkeys(loadHotkeyBindings());
    window.addEventListener(HOTKEYS_CHANGED_EVENT, refreshHotkeys);
    return () => window.removeEventListener(HOTKEYS_CHANGED_EVENT, refreshHotkeys);
  }, []);

  useEffect(() => {
    setWorkspaceSettings(() => {
      const normalized = normalizeWorkspaceSettings(initialWorkspace);
      setActiveDisplayQuality(normalized.displayQuality);
      return normalized;
    });
  }, [initialWorkspace]);

  useEffect(() => {
    setSnapGrid(normalizeSnapGrid(initialSnap, DEFAULT_SNAP_GRID));
  }, [initialSnap]);

  const selectedShapes = useMemo(() => shapes.filter((shape) => selectedIds.includes(shape.id)), [selectedIds, shapes]);
  const selectedShape = selectedShapes.at(-1) ?? null;
  const hasSelection = selectedShapes.length > 0;
  useEffect(() => {
    if (!hasSelection) {
      setShapeRailPinned(false);
    }
  }, [hasSelection]);
  // Held as a stable array: the viewport reuses its edge lines while this is the same list, and
  // rebuilding it inline made every pointer move dispose and re-upload one geometry per edge.
  const modifierSelectableEdges = useMemo(
    () => edgeModifier ? edgeModifier.edges.filter((edge) => selectableCadModifierEdge(edge, edgeModifier.sharpAngle)) : [],
    [edgeModifier?.edges, edgeModifier?.sharpAngle],
  );
  const modifierAvailableEdgeIds = useMemo(
    () => modifierSelectableEdges.map((edge) => edge.id),
    [modifierSelectableEdges],
  );
  const edgeModifierMaxAmount = useMemo(() => {
    const source = cadModifierBaseShapeRef.current ?? selectedShape;
    if (!source) return 10;
    const smallestDimension = Math.min(shapeWidth(source), shapeDepth(source), source.height);
    return Math.max(MIN_EDGE_MODIFIER_AMOUNT, smallestDimension * 0.99);
  }, [edgeModifier, selectedShape]);
  const selectedEdgeFeatureCount = useMemo(() => selectedShape ? edgeTreatmentFeatureCount(selectedShape) : 0, [selectedShape]);
  const selectedReversibleEdgeFeatureCount = useMemo(() => selectedShape ? reversibleEdgeTreatmentCount(selectedShape) : 0, [selectedShape]);
  const selectedEdgeHistoryOptions = useMemo(() => selectedShape ? edgeTreatmentHistoryOptions(selectedShape) : [], [selectedShape]);
  const canSeparateSelectedParts = useMemo(
    () => selectedShapes.length === 1 && Boolean(selectedShape && separablePartCount(selectedShape) > 1),
    [selectedShape, selectedShapes.length],
  );
  const canCircularPattern = useMemo(() => selectedShapes.some((shape) => !shape.locked), [selectedShapes]);
  const canLinearPattern = canCircularPattern;
  const circularPatternSources = useMemo(() => {
    if (!circularPattern) return [];
    const sourceIds = new Set(circularPattern.sourceIds);
    return shapes.filter((shape) => sourceIds.has(shape.id));
  }, [circularPattern, shapes]);
  const circularPatternRadius = circularPattern?.radius ?? 0;
  const toggleModifierEdge = useCallback((id: number, singleEdge = false) => {
    setEdgeModifier((current) => {
      // Only the edge list has to exist. Refusing while `busy` swallowed every click made during
      // the preview a previous click kicked off, so picking edges in quick succession dropped most
      // of them with nothing on screen changing. A newer selection just supersedes the request in
      // flight — the worker's reply is discarded unless its id is still the latest.
      if (!current || !current.prepared) return current;
      const allowed = new Set(current.edges.filter((edge) => selectableCadModifierEdge(edge, current.sharpAngle)).map((edge) => edge.id));
      if (!allowed.has(id)) return current;
      const ids = current.tangentChain && !singleEdge ? tangentCadEdgeChain(current.edges, id, allowed) : [id];
      const next = new Set(current.selectedEdgeIds);
      const remove = ids.every((edgeId) => next.has(edgeId));
      ids.forEach((edgeId) => remove ? next.delete(edgeId) : next.add(edgeId));
      // Keep the fillet that is already on screen. Clearing it made the previous
      // edge look erased while the next edge was calculated.
      return { ...current, selectedEdgeIds: [...next], preview: next.size > 0 ? current.preview : null, busy: next.size > 0, error: next.size ? null : "Select at least one highlighted edge" };
    });
  }, []);

  const exportableShapeCount = useMemo(() => (hasSelection ? selectedShapes : shapes).filter((shape) => !shape.hole && !isConstructionShape(shape)).length, [hasSelection, selectedShapes, shapes]);
  const exportScopeLabel = hasSelection ? "selected" : "total";
  const exportPreflight = useMemo(
    () => buildStepExportPreflight(hasSelection ? selectedShapes : shapes),
    [hasSelection, selectedShapes, shapes],
  );
  const effectiveAlignAnchorId = useMemo(
    () => effectiveAlignmentAnchorId(selectedShapes, alignAnchorId),
    [alignAnchorId, selectedShapes],
  );
  const alignHandleStatuses = useMemo(() => (alignMode ? alignmentStatuses(selectedShapes, effectiveAlignAnchorId) : []), [alignMode, effectiveAlignAnchorId, selectedShapes]);
  const activeToolChip = useMemo<{ label: string; hint: string } | null>(() => {
    if (pushPullSession) {
      return { label: "Push Pull", hint: "Drag, type, then Apply" };
    }
    if (edgeModifier) {
      return { label: edgeModifier.kind === "fillet" ? "Fillet" : "Chamfer", hint: "Esc to cancel" };
    }
    if (circularPattern) {
      return { label: "Circular pattern", hint: "Esc to cancel" };
    }
    if (linearPattern) {
      return { label: "Linear pattern", hint: "Esc to cancel" };
    }
    if (placementRuler) {
      return {
        label: "Placement ruler",
        hint: hasSelection ? "Enter X, Y, or Z to move" : "Please select a shape to begin",
      };
    }
    if (alignMode) {
      return { label: "Align", hint: "Esc to cancel" };
    }
    if (mirrorMode) {
      return { label: "Mirror", hint: "Esc to cancel" };
    }
    return null;
  }, [alignMode, circularPattern, edgeModifier, hasSelection, linearPattern, mirrorMode, placementRuler, pushPullSession]);
  const sketchToolChip = useMemo<{ label: string; hint: string } | null>(() => {
    if (!sketchActive) return null;
    const coach = sketchCoach(
      sketchHoverTool ?? sketchTool,
      closedProfilesFromLegacy(sketchProfile).length,
      sketchDoc.settings.constructionMode,
      Boolean(sketchActivePointId),
      Boolean(sketchHoverTool),
    );
    return { label: coach.title, hint: coach.body };
  }, [sketchActive, sketchActivePointId, sketchDoc.settings.constructionMode, sketchHoverTool, sketchProfile, sketchTool]);
  const sweepMarkIds = useMemo(() => {
    if (!sweepPrompt) return [];
    const guided = profileWithConstructionGuides(sketchProfile, sketchDoc);
    const idsOf = (chain: SweepChain) => [...chain.segmentIds, ...(chain.curveId ? [chain.curveId] : [])];
    if (sweepPrompt.phase === "confirm") {
      const resolved = resolveSketchSweep(guided, sketchDoc, sweepPrompt.spec);
      if (!resolved) return [...sweepPrompt.spec.outlineSegmentIds, ...sweepPrompt.spec.holeSegmentIds, ...sweepPrompt.spec.pathSegmentIds];
      return [
        ...idsOf(resolved.outline),
        ...resolved.outline.holes.flatMap(idsOf),
        ...idsOf(resolved.path),
      ];
    }
    if (sweepPrompt.phase === "pick-path") {
      const outline = planSketchSweep(guided, sketchDoc).outlines.find((candidate) => candidate.id === sweepPrompt.outlineId);
      return outline ? [...idsOf(outline), ...outline.holes.flatMap(idsOf)] : [];
    }
    return [];
  }, [sketchDoc, sketchProfile, sweepPrompt]);
  const viewportShapes = useMemo(
    () => {
      if (historyBrowse !== null && historyBrowse !== historyIndex) {
        const entry = history[historyBrowse];
        if (entry) return expandHistoryShapes(entry.shapes, entry.meshVault).map(canonicalizeShape);
      }
      const preview = edgeModifier?.preview ?? pushPullSession?.preview;
      if (preview && cadModifierBaseShapeRef.current) {
        return shapes.map((shape) => shape.id === cadModifierBaseShapeRef.current?.id ? preview : shape);
      }
      if (alignMode && alignPreview) {
        return alignedShapesForSelection(shapes, selectedIds, selectedShapes, effectiveAlignAnchorId, alignPreview.axis, alignPreview.target).nextShapes;
      }
      if (mirrorMode && mirrorPreviewAxis) {
        return mirroredShapesForSelection(shapes, selectedIds, selectedShapes, mirrorPreviewAxis).nextShapes;
      }
      if (circularPattern?.preview) {
        const sourceIds = new Set(circularPattern.sourceIds);
        return shapes.filter((shape) => !sourceIds.has(shape.id)).concat(circularPattern.preview);
      }
      if (linearPattern?.preview) {
        const sourceIds = new Set(linearPattern.sourceIds);
        return shapes.filter((shape) => !sourceIds.has(shape.id)).concat(linearPattern.preview);
      }
      if (sweepPreview) {
        return shapes.filter((shape) => shape.id !== sweepPreview.id).concat(sweepPreview);
      }
      return shapes;
    },
    [alignMode, alignPreview, circularPattern, edgeModifier?.preview, effectiveAlignAnchorId, history, historyBrowse, historyIndex, linearPattern, mirrorMode, mirrorPreviewAxis, pushPullSession?.preview, selectedIds, selectedShapes, shapes, sweepPreview],
  );
  const debugState = useMemo(
    () =>
      JSON.stringify({
        notice,
        selectedIds,
        shapeCount: shapes.length,
        shapes: shapes.map(debugShapeSummary),
      }),
    [notice, selectedIds, shapes],
  );
  const compactDebugState = useMemo(
    () => `notice=${notice};selected=${selectedIds.length};count=${shapes.length};${shapes.map(compactShapeSummary).join(";")}`,
    [notice, selectedIds, shapes],
  );

  const captureProjectPreviewFrame = useCallback(() => {
    if (typeof window === "undefined") {
      return lastProjectFrameRef.current;
    }
    try {
      const image = window.sketchforgeCaptureCanvas?.({ hideOverlays: false });
      if (image && image.length > 100) {
        lastProjectFrameRef.current = image;
        return image;
      }
    } catch {
      // Fall back to the last good geometry-mode frame below.
    }
    return lastProjectFrameRef.current;
  }, []);

  const captureProjectPreviewThemes = useCallback(() => {
    if (typeof window === "undefined") {
      const fallback = lastProjectFrameRef.current;
      return fallback ? { light: fallback, dark: fallback } : null;
    }
    try {
      const themed = window.sketchforgeCaptureProjectThumbnails?.({ hideOverlays: false });
      if (themed?.light && themed.light.length > 100) {
        lastProjectFrameRef.current = themed.light;
        return themed;
      }
    } catch {
      // Fall back to a single-frame capture below.
    }
    const image = captureProjectPreviewFrame();
    return image && image.length > 100 ? { light: image, dark: image } : null;
  }, [captureProjectPreviewFrame]);

  const publishProjectSnapshot = useCallback(() => {
    if (!projectId || !onProjectSnapshot) {
      return;
    }
    const themed = captureProjectPreviewThemes();
    if (themed?.light && themed.light.length > 100) {
      onProjectSnapshot({
        image: themed.light,
        imageDark: themed.dark && themed.dark.length > 100 ? themed.dark : undefined,
        projectId,
        shapes: shapesRef.current.length,
      });
    }
  }, [captureProjectPreviewThemes, onProjectSnapshot, projectId]);

  const changeToolbarMode = useCallback((mode: ToolbarMode) => {
    if (mode === "sketch") {
      // Geometry viewport unmounts in sketch mode — stash the current frame first.
      captureProjectPreviewFrame();
      const workplaneEmpty = shapesRef.current.every((shape) => shape.suppressed);
      if (workplaneEmpty && !sketchActive) {
        setSketchFacePickMode(false);
        setTopPanel(null);
        setMenuOpen(false);
        beginBlankSketchRef.current();
        return;
      }
    }
    setSketchFacePickMode(false);
    setToolbarMode((current) => {
      if (current !== mode) {
        setModeTransitioning(true);
        window.setTimeout(() => setModeTransitioning(false), 180);
      }
      return mode;
    });
    setTopPanel(null);
    setMenuOpen(false);
  }, [captureProjectPreviewFrame, sketchActive]);

  useEffect(() => {
    if (selectedShapes.length < 2) {
      setAlignMode(false);
      setAlignAnchorId(null);
      setAlignPreview(null);
    }
    if (alignAnchorId && !selectedIds.includes(alignAnchorId)) {
      setAlignAnchorId(null);
      setAlignPreview(null);
    }
    if (selectedShapes.length === 0) {
      setMirrorMode(false);
      setMirrorPreviewAxis(null);
    }
  }, [alignAnchorId, selectedIds, selectedShapes.length]);

  const syncProjectShapes = useCallback(
    (nextShapes: WorkplaneShape[]) => {
      if (!projectId || !onProjectShapesChange) {
        return;
      }
      if (projectInteractionActiveRef.current) {
        pendingProjectShapesRef.current = nextShapes.map(canonicalizeShape);
        if (projectSyncTimerRef.current !== null) {
          window.clearTimeout(projectSyncTimerRef.current);
          projectSyncTimerRef.current = null;
        }
        return;
      }
      const canonicalNext = nextShapes.map(canonicalizeShape);
      const serialized = projectShapesFingerprint(canonicalNext);
      if (lastProjectShapesSyncRef.current === serialized) {
        return;
      }
      if (projectSyncTimerRef.current !== null) {
        window.clearTimeout(projectSyncTimerRef.current);
      }
      projectSyncTimerRef.current = window.setTimeout(() => {
        lastProjectShapesSyncRef.current = serialized;
        lastProjectShapesEchoRef.current = serialized;
        onProjectShapesChange({
          projectId,
          shapes: canonicalNext,
          history: historyRef.current,
          historyIndex: historyIndexRef.current,
        });
        projectSyncTimerRef.current = null;
      }, 120);
    },
    [onProjectShapesChange, projectId],
  );

  const flushProjectShapesSync = useCallback(() => {
    if (!projectId || !onProjectShapesChange) {
      return;
    }
    if (projectSyncTimerRef.current !== null) {
      window.clearTimeout(projectSyncTimerRef.current);
      projectSyncTimerRef.current = null;
    }
    const canonicalNext = (pendingProjectShapesRef.current ?? shapesRef.current).map(canonicalizeShape);
    pendingProjectShapesRef.current = null;
    const serialized = projectShapesFingerprint(canonicalNext);
    if (lastProjectShapesSyncRef.current === serialized) {
      return;
    }
    lastProjectShapesSyncRef.current = serialized;
    lastProjectShapesEchoRef.current = serialized;
    onProjectShapesChange({
      projectId,
      shapes: canonicalNext,
      history: historyRef.current,
      historyIndex: historyIndexRef.current,
    });
  }, [onProjectShapesChange, projectId]);

  const appendHistorySnapshot = useCallback((nextShapes: WorkplaneShape[], nextSelection: string[], label?: string) => {
    // Report the change so the project still saves, but leave the timeline (and the redo stack) alone.
    if (historyWriteSuspendedRef.current > 0) return true;
    const entry = editorHistoryEntry(nextShapes, nextSelection, label);
    const result = appendEditorHistorySnapshot(historyRef.current, historyIndexRef.current, entry);
    if (result.entries !== historyRef.current) {
      historyRef.current = result.entries;
      setHistory(result.entries);
    }
    historyIndexRef.current = result.index;
    setHistoryIndex(result.index);
    return result.changed;
  }, []);

  const finalizeInteractionHistory = useCallback(() => {
    const startFingerprint = interactionHistoryStartRef.current;
    const hadChanges = interactionHistoryChangedRef.current;
    const interactionStartShapes = interactionStartShapesRef.current;
    interactionHistoryStartRef.current = "";
    interactionHistoryChangedRef.current = false;
    interactionStartShapesRef.current = null;
    if (!hadChanges) {
      return;
    }

    const canonicalNext = shapesRef.current.map(canonicalizeShape);
    const nextFingerprint = projectShapesFingerprint(canonicalNext);
    if (!startFingerprint || startFingerprint === nextFingerprint) {
      return;
    }

    if (interactionStartShapes) {
      canonicalNext.forEach((shape) => {
        const before = interactionStartShapes[shape.id];
        if (!before) {
          return;
        }
        const delta = computeShapeRepeatDelta(before, shape);
        if (hasShapeRepeatDelta(delta)) {
          lastShapeActionRef.current[shape.id] = { delta, before };
          duplicateRepeatDeltasRef.current = new Map();
        }
      });
    }

    appendHistorySnapshot(canonicalNext, selectedIdsRef.current, "Moved");
  }, [appendHistorySnapshot]);

  useEffect(() => {
    if (projectInteractionActive || !pendingProjectShapesRef.current) {
      return;
    }
    const pendingShapes = pendingProjectShapesRef.current;
    pendingProjectShapesRef.current = null;
    const timer = window.setTimeout(() => syncProjectShapes(pendingShapes), 180);
    return () => window.clearTimeout(timer);
  }, [projectInteractionActive, syncProjectShapes]);

  const flushPendingFeatureRemeshRef = useRef<(options?: { skipOcct?: boolean; deferHistory?: boolean; draft?: boolean }) => Promise<void>>(
    async () => {},
  );

  const updateProjectInteractionActive = useCallback(
    (active: boolean) => {
      if (active) {
        if (interactionHistoryTimerRef.current !== null) {
          window.clearTimeout(interactionHistoryTimerRef.current);
          interactionHistoryTimerRef.current = null;
          finalizeInteractionHistory();
        }
        if (!projectInteractionActiveRef.current) {
          interactionHistoryStartRef.current = projectShapesFingerprint(shapesRef.current);
          interactionHistoryChangedRef.current = false;
          interactionStartShapesRef.current = snapshotShapesForRepeat(shapesRef.current);
        }
        projectInteractionActiveRef.current = true;
        setProjectInteractionActive((current) => (current ? current : true));
        return;
      }

      projectInteractionActiveRef.current = false;
      setProjectInteractionActive((current) => (current ? false : current));
      if (interactionHistoryTimerRef.current !== null) {
        window.clearTimeout(interactionHistoryTimerRef.current);
        interactionHistoryTimerRef.current = null;
      }
      const needsFeatureFlush =
        pendingFeatureRemeshRef.current !== null
        || featureRemeshTimerRef.current !== null
        || featureRemeshNeedsExactRef.current;
      if (needsFeatureFlush) {
        void (async () => {
          flushSync(() => {
            setNotice("Updating group…");
          });
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 0);
          });
          await flushPendingFeatureRemeshRef.current({ skipOcct: false, deferHistory: true, draft: false });
          finalizeInteractionHistory();
        })();
        return;
      }
      finalizeInteractionHistory();
    },
    [finalizeInteractionHistory],
  );

  const updateProjectWorkspaceSettings = useCallback(
    (settings: { workspace: WorkplaneWorkspaceSettings; snap: GridSize }) => {
      setWorkspaceSettings(settings.workspace);
      setSnapGrid(normalizeSnapGrid(settings.snap, DEFAULT_SNAP_GRID));
      if (!projectId || !onProjectWorkspaceChange) {
        return;
      }
      onProjectWorkspaceChange({ projectId, ...settings });
    },
    [onProjectWorkspaceChange, projectId],
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cadApplyFlash, setCadApplyFlash] = useState<{
    nonce: number;
    ids: string[];
    kind?: "apply" | "combine" | "separate";
    edgeWipe?: { polylines: number[][] };
  } | null>(null);
  const patchSketchGuideSettings = useCallback((patch: { showConstruction?: boolean; constructionMode?: boolean }) => {
    setSketchDoc((doc) => ({ ...doc, settings: { ...doc.settings, ...patch } }));
    if (patch.constructionMode !== undefined) {
      setNotice(patch.constructionMode ? "Drawing guides — these lines will not become a solid" : "Drawing the part");
    }
  }, []);
  const makeSketchWorkspaceDefault = useCallback(() => {
    const normalizedWorkspace = normalizeWorkspaceSettings(workspaceSettings);
    const normalizedSnap = normalizeSnapGrid(snapGrid, DEFAULT_SNAP_GRID);
    const key = projectId ?? "local-workplane";
    try {
      window.localStorage.setItem(
        `sketchForge.workspaceDefault.${key}`,
        JSON.stringify({ workspace: normalizedWorkspace, snap: normalizedSnap }),
      );
    } catch {
      // Project persistence below is still attempted if browser storage is unavailable.
    }
    saveGlobalWorkspaceDefaults(normalizedWorkspace, normalizedSnap);
    updateProjectWorkspaceSettings({ workspace: normalizedWorkspace, snap: normalizedSnap });
  }, [projectId, snapGrid, updateProjectWorkspaceSettings, workspaceSettings]);
  useEffect(() => {
    const open = () => setSettingsOpen(true);
    window.addEventListener("sketchforge:open-workspace-settings", open);
    return () => window.removeEventListener("sketchforge:open-workspace-settings", open);
  }, []);

  const commitShapes = useCallback(
    (next: WorkplaneShape[], nextSelection: string | string[] | null = selectedIds, message?: string) => {
      if (historyBrowse !== null) {
        setNotice("Close history before editing");
        return;
      }
      const canonicalNext = migrateShapesCsg(syncLinkedPatternShapes(next).map(canonicalizeShape));
      const requestedSelection = Array.isArray(nextSelection) ? nextSelection : nextSelection ? [nextSelection] : [];
      const validSelection = requestedSelection.filter((id, index) => requestedSelection.indexOf(id) === index && canonicalNext.some((shape) => shape.id === id));
      shapesRef.current = canonicalNext;
      selectedIdsRef.current = validSelection;
      setShapes(canonicalNext);
      setSelectedIds(validSelection);
      const changed = appendHistorySnapshot(canonicalNext, validSelection, message);
      if (message) {
        setNotice(message);
      }
      if (changed) {
        syncProjectShapes(canonicalNext);
      }
    },
    [appendHistorySnapshot, historyBrowse, selectedIds, syncProjectShapes],
  );

  const flashCadApply = useCallback((
    ids: string | string[] | null | undefined,
    edgeWipe?: { polylines: number[][] },
    kind: "apply" | "combine" | "separate" = "apply",
  ) => {
    const list = !ids ? [] : Array.isArray(ids) ? ids : [ids];
    if (list.length === 0) return;
    const polylines = edgeWipe?.polylines.filter((line) => line.length >= 6) ?? [];
    setCadApplyFlash({
      nonce: Date.now(),
      ids: list,
      kind,
      ...(polylines.length > 0 ? { edgeWipe: { polylines } } : {}),
    });
  }, []);

  const persistBakedImportedBrepSteps = useCallback(() => {
    if (historyWriteSuspendedRef.current > 0) return;
    const current = shapesRef.current;
    const baked = withBakedImportedBrepSteps(current);
    if (baked === current) return;
    // Attaching exact text is not a model edit: a scene that matched the last explicit save still does.
    if (explicitSaveFingerprintRef.current === projectShapesFingerprint(current)) {
      explicitSaveFingerprintRef.current = projectShapesFingerprint(baked);
    }
    shapesRef.current = baked;
    setShapes(baked);
    // Same model, now carrying its exact source: rewrite the cursor entry instead of adding an undo step.
    const entries = historyRef.current;
    const index = historyIndexRef.current;
    if (entries[index]) {
      const nextEntries = entries.slice();
      nextEntries[index] = editorHistoryEntry(baked, selectedIdsRef.current);
      historyRef.current = nextEntries;
      setHistory(nextEntries);
    }
    syncProjectShapes(baked);
  }, [syncProjectShapes]);

  const importedBrepBakeInFlightRef = useRef(false);
  const importedBrepBakePromiseRef = useRef<Promise<void> | null>(null);
  const bakeImportedBrepForAutosave = useCallback(async () => {
    if (historyWriteSuspendedRef.current > 0) return;
    if (importedBrepBakePromiseRef.current) return importedBrepBakePromiseRef.current;
    const current = pendingProjectShapesRef.current ?? shapesRef.current;
    if (importedBrepStepsAwaitingSave(current).length === 0) return;
    const run = (async () => {
      importedBrepBakeInFlightRef.current = true;
      try {
        await bakeImportedBrepStepsForSave(pendingProjectShapesRef.current ?? shapesRef.current);
        persistBakedImportedBrepSteps();
      } finally {
        importedBrepBakeInFlightRef.current = false;
        importedBrepBakePromiseRef.current = null;
      }
    })();
    importedBrepBakePromiseRef.current = run;
    return run;
  }, [persistBakedImportedBrepSteps]);

  const flushImportedBrepBake = useCallback(async () => {
    await importedBrepBakePromiseRef.current;
    await bakeImportedBrepForAutosave();
  }, [bakeImportedBrepForAutosave]);

  useEffect(() => {
    if (importedBrepStepsAwaitingSave(shapes).length === 0) return;
    const timer = window.setTimeout(() => {
      void bakeImportedBrepForAutosave();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [bakeImportedBrepForAutosave, shapes]);

  const hasUnsavedProjectChanges = useCallback(() => {
    if (!projectId || !onSaveProject) return false;
    const current = pendingProjectShapesRef.current ?? shapesRef.current;
    if (importedBrepBakeInFlightRef.current || importedBrepStepsAwaitingSave(current).length > 0) return true;
    const baseline = explicitSaveFingerprintRef.current;
    return baseline !== null && projectShapesFingerprint(current) !== baseline;
  }, [onSaveProject, projectId]);

  /**
   * Explicit Save / Save As: bake exact STEP for imported bodies that still have a live kernel
   * solid, attach it to the live shapes, then hand those shapes to the ordinary project save.
   */
  const saveProjectExplicitly = useCallback(async (mode: "save" | "save-as"): Promise<boolean> => {
    const handler = mode === "save-as" ? onSaveProjectAs ?? onSaveProject : onSaveProject;
    if (!projectId || !handler || explicitSaveInFlightRef.current) return false;
    explicitSaveInFlightRef.current = true;
    try {
      await flushImportedBrepBake();
      let bake: { baked: number; failedNames: string[] } = { baked: 0, failedNames: [] };
      const awaiting = importedBrepStepsAwaitingSave(pendingProjectShapesRef.current ?? shapesRef.current);
      if (awaiting.length > 0) {
        flushSync(() => {
          setNotice(`Saving exact STEP for ${awaiting.length} imported ${awaiting.length === 1 ? "body" : "bodies"}…`);
          setExactStepSaveProgress({ done: 0, total: awaiting.length });
        });
        await afterNextPaint();
        let lastPaint = performance.now();
        bake = await bakeImportedBrepStepsForSave(
          pendingProjectShapesRef.current ?? shapesRef.current,
          async (done, total) => {
            setExactStepSaveProgress({ done, total });
            if (done < total && performance.now() - lastPaint > 80) {
              await afterNextPaint();
              lastPaint = performance.now();
            }
          },
        );
        persistBakedImportedBrepSteps();
      }
      const saved = withBakedImportedBrepSteps(pendingProjectShapesRef.current ?? shapesRef.current);
      const snapshot: ProjectSaveSnapshot = {
        projectId,
        shapes: saved.map(canonicalizeShape),
        history: historyRef.current,
        historyIndex: historyIndexRef.current,
      };
      flushProjectShapesSync();
      const ok = await handler(snapshot);
      if (ok === false) return false;
      explicitSaveFingerprintRef.current = projectShapesFingerprint(saved);
      if (bake.failedNames.length > 0) {
        const names = bake.failedNames.slice(0, 4).join(", ");
        const more = bake.failedNames.length > 4 ? ` +${bake.failedNames.length - 4} more` : "";
        setNotice(
          `Saved · ${bake.failedNames.length} imported ${bake.failedNames.length === 1 ? "body" : "bodies"} could not store exact STEP and will export faceted: ${names}${more}`,
        );
      } else if (bake.baked > 0) {
        setNotice(`Saved · exact STEP stored for ${bake.baked} imported ${bake.baked === 1 ? "body" : "bodies"}`);
      }
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the project");
      return false;
    } finally {
      explicitSaveInFlightRef.current = false;
      setExactStepSaveProgress(null);
    }
  }, [flushImportedBrepBake, flushProjectShapesSync, onSaveProject, onSaveProjectAs, persistBakedImportedBrepSteps, projectId, setNotice]);

  const confirmLeaveProject = useCallback(async (): Promise<boolean> => {
    await flushImportedBrepBake();
    if (!hasUnsavedProjectChanges()) return true;
    unsavedPromptResolveRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      unsavedPromptResolveRef.current = resolve;
      setUnsavedPrompt({ saving: false });
    });
  }, [flushImportedBrepBake, hasUnsavedProjectChanges]);

  const settleUnsavedPrompt = useCallback((leave: boolean) => {
    const resolve = unsavedPromptResolveRef.current;
    unsavedPromptResolveRef.current = null;
    setUnsavedPrompt(null);
    resolve?.(leave);
  }, []);

  const saveFromUnsavedPrompt = useCallback(async () => {
    setUnsavedPrompt({ saving: true });
    const ok = await saveProjectExplicitly("save");
    if (ok) {
      settleUnsavedPrompt(true);
      return;
    }
    // Save As picker closed or the write failed: stay in the prompt so Exit to Menu remains.
    setUnsavedPrompt((current) => (current ? { saving: false } : current));
  }, [saveProjectExplicitly, settleUnsavedPrompt]);

  const handleHome = useCallback(async () => {
    if (!(await confirmLeaveProject())) return;
    publishProjectSnapshot();
    onHome?.();
  }, [confirmLeaveProject, onHome, publishProjectSnapshot]);

  useEffect(() => {
    if (!onRegisterLeaveGuard) return;
    onRegisterLeaveGuard({
      confirmLeave: confirmLeaveProject,
      save: saveProjectExplicitly,
      command: (action) => {
        if (action === "import") setTopPanel("import");
        if (action === "export") setTopPanel("export");
      },
    });
    return () => onRegisterLeaveGuard(null);
  }, [confirmLeaveProject, onRegisterLeaveGuard, saveProjectExplicitly]);

  useEffect(() => {
    // Browsers only show their generic prompt here; in-app exits ask to save the design.
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedProjectChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedProjectChanges]);

  useEffect(() => () => unsavedPromptResolveRef.current?.(false), []);

  const flushPendingFeatureRemesh = useCallback(async (options?: { skipOcct?: boolean; deferHistory?: boolean; draft?: boolean }) => {
    if (featureRemeshTimerRef.current !== null) {
      window.clearTimeout(featureRemeshTimerRef.current);
      featureRemeshTimerRef.current = null;
    }
    const pending = pendingFeatureRemeshRef.current;
    if (!pending) {
      featureRemeshNeedsExactRef.current = false;
      return;
    }
    const body = shapesRef.current.find((entry) => entry.id === pending.bodyId);
    if (!body?.groupedShapes?.length) {
      pendingFeatureRemeshRef.current = null;
      featureRemeshNeedsExactRef.current = false;
      return;
    }
    const skipOcct = Boolean(options?.skipOcct) || Boolean(options?.draft);
    const remeshGen = remeshGenerationRef.current + 1;
    remeshGenerationRef.current = remeshGen;
    const remeshed = await remeshCsgGroup(body, { skipOcct, draft: Boolean(options?.draft) });
    if (remeshGen !== remeshGenerationRef.current) return;
    const next = remeshed ?? {
      ...body,
      importedMesh: body.importedMesh,
      csg: { ...(body.csg ?? { op: inferCsgOp(body) ?? "union", version: 1 }), dirty: true },
    };
    const liveOnly = projectInteractionActiveRef.current || Boolean(options?.deferHistory);
    if (liveOnly) {
      if (projectInteractionActiveRef.current) {
        featureRemeshNeedsExactRef.current = skipOcct || featureRemeshNeedsExactRef.current;
      } else {
        pendingFeatureRemeshRef.current = null;
        featureRemeshNeedsExactRef.current = false;
      }
      setShapes((current) => {
        const mapped = current.map((entry) => (entry.id === body.id ? next : entry));
        shapesRef.current = mapped;
        interactionHistoryChangedRef.current = true;
        return mapped;
      });
      if (!projectInteractionActiveRef.current && next.edgeTreatments?.length) {
        await reapplyEdgeTreatmentsRef.current(next);
      }
      return;
    }
    pendingFeatureRemeshRef.current = null;
    featureRemeshNeedsExactRef.current = false;
    commitShapes(
      shapesRef.current.map((entry) => (entry.id === body.id ? next : entry)),
      body.id,
      pending.message,
    );
    if (!remeshed && (body.csg?.op ?? inferCsgOp(body)) !== "assemble") {
      setNotice("Could not rebuild body after feature edit — last good mesh kept. Ungroup then Group to retry.");
    } else if (next.edgeTreatments?.length) {
      await reapplyEdgeTreatmentsRef.current(next);
    } else if (remeshed) {
      const activeChildren = (next.groupedShapes ?? []).filter((child) => (
        !child.suppressed && !child.csg?.suppressed && !child.locked
      ));
      const fallbackNotice = occtMeshFallbackNotice({
        skipOcct,
        occtEligible: selectionSupportsOcctCsg(activeChildren),
        resultHasExactBrep: Boolean(next.importedMesh?.brepStep || next.cadBrep),
        operands: activeChildren,
      });
      if (fallbackNotice) setNotice(fallbackNotice);
    }
  }, [commitShapes]);
  flushPendingFeatureRemeshRef.current = flushPendingFeatureRemesh;

  // First-run CAD path coaching (once per browser).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = "peakcad.cadPathCoach.v1";
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      return;
    }
    const timer = window.setTimeout(() => {
      setNotice("Tip: Box → sketch a hole on a face → Group → Download STEP. Open Tips for the full CAD path.");
      setTopPanel("tips");
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  const removeEdgeTreatment = useCallback(async (optionId: string) => {
    if (!selectedShape) {
      setNotice("Select a shape with an edge feature first");
      return;
    }
    if (selectedShape.locked) {
      setNotice("Unlock the shape before removing an edge feature");
      return;
    }
    const option = selectedEdgeHistoryOptions.find((candidate) => candidate.id === optionId);
    if (!option) {
      setNotice("Choose an edge feature to remove");
      return;
    }
    const sourceFingerprint = projectShapesFingerprint([selectedShape]);
    const sourceProjectId = projectInfoRef.current.projectId;
    const restored = await restoreEdgeTreatmentInShape(selectedShape, option.path, option.entryId);
    if (!restored) {
      setNotice(selectedEdgeFeatureCount > 0 ? "This edge feature has no stored undo history" : "No edge feature to remove");
      return;
    }
    const currentTarget = shapesRef.current.find((shape) => shape.id === selectedShape.id);
    if (projectInfoRef.current.projectId !== sourceProjectId || !currentTarget || projectShapesFingerprint([currentTarget]) !== sourceFingerprint) {
      setNotice("The object changed while removing the edge feature; try again");
      return;
    }
    invalidateCadModifierSession();
    commitShapes(
      shapesRef.current.map((shape) => shape.id === selectedShape.id ? restored.shape : shape),
      restored.shape.id,
      `Removed ${restored.label}`,
    );
    setNotice(`Removed ${restored.label}`);
  }, [commitShapes, invalidateCadModifierSession, selectedEdgeFeatureCount, selectedEdgeHistoryOptions, selectedShape]);

  const commitSketchProfile = useCallback(
    (next: SketchProfile, message?: string, docOverride?: SketchDoc | null) => {
      const snapshot = cloneSketchProfile(next);
      const current = sketchHistoryRef.current;
      const currentIndex = Math.min(sketchHistoryIndexRef.current, Math.max(0, current.length - 1));
      const trimmed = current.slice(0, currentIndex + 1);
      const latest = trimmed.at(-1);
      setSketchProfile(snapshot);
      // Fold the profile back into the live doc rather than rebuilding from it: the profile cannot
      // express construction or projected geometry or analytic curves, so rebuilding destroyed all
      // of it. Host face linkage, constraints and settings ride along on the doc.
      const baseDoc = docOverride ?? mergeProfileIntoDoc(sketchDoc, snapshot);
      const solved = solveSketchDoc(baseDoc);
      setSketchDoc(solved.doc);
      setSketchSolveStatus(solved.status);
      setSketchDof(solved.dof);
      setSketchConflicts(solved.conflicts);
      // If solver moved points, keep profile in sync
      const solvedProfile = sketchDocToProfile(solved.doc);
      if (JSON.stringify(solvedProfile.points) !== JSON.stringify(snapshot.points)) {
        setSketchProfile({ ...snapshot, points: solvedProfile.points, segments: solvedProfile.segments });
      }
      if (latest && JSON.stringify(latest) === JSON.stringify(snapshot)) {
        if (message) setNotice(message);
        return;
      }
      const nextHistory = [...trimmed, cloneSketchProfile(snapshot)].slice(-MAX_SKETCH_HISTORY_ENTRIES);
      sketchHistoryRef.current = nextHistory;
      sketchHistoryIndexRef.current = nextHistory.length - 1;
      setSketchHistory(nextHistory);
      setSketchHistoryIndex(sketchHistoryIndexRef.current);
      if (message) setNotice(message);
    },
    // The whole doc is the merge base now, so a stale closure would silently revert entities.
    [sketchDoc],
  );

  const beginSketch = useCallback((profile?: SketchProfile, editingId: string | null = null, plane?: SketchPlane | null, existingDoc?: SketchDoc | null) => {
    captureProjectPreviewFrame();
    let resolvedPlane = resolveSketchPlane(
      plane
        ?? profile?.sketchPlane
        ?? existingDoc?.plane
        ?? (editingId ? shapesRef.current.find((shape) => shape.id === editingId)?.sketchPlane : null),
    );
    const initial = cloneSketchProfile(profile ?? emptySketchProfile());
    let faceLoops = initial.faceReferenceLoops ?? [];

    // Bind the sketch to the picked host face: recenter UV on that face and show its outline.
    if (resolvedPlane.hostShapeId && faceLoops.length === 0) {
      const host = shapesRef.current.find((shape) => shape.id === resolvedPlane.hostShapeId);
      if (host) {
        const classified = classifySketchFaceHit(host, resolvedPlane.origin, resolvedPlane.normal);
        if (classified.kind === "planar" && classified.analytic?.type === "disc-cap") {
          resolvedPlane = classified.plane ?? resolvedPlane;
          faceLoops = [discCapFaceLoop(classified.analytic.radius)];
        } else if (
          (classified.kind === "cylindrical" || resolvedPlane.surface?.kind === "cylinder")
          && (classified.analytic?.type === "barrel" || resolvedPlane.surface)
        ) {
          const surface = classified.analytic?.type === "barrel"
            ? classified.analytic.surface
            : resolvedPlane.surface!;
          resolvedPlane = classified.plane
            ? cloneSketchPlane(classified.plane)
            : { ...resolvedPlane, surface };
          faceLoops = [barrelFaceLoop(surface.radius, surface.height)];
        } else {
          try {
            const prepared = prepareFaceSketchReference(
              resolvedPlane,
              worldTrianglesForHostShape(host),
            );
            resolvedPlane = prepared.plane;
            faceLoops = prepared.loops;
          } catch {
            // Keep the raw hit plane if mesh projection fails.
          }
        }
      }
    }

    initial.sketchPlane = cloneSketchPlane(resolvedPlane);
    initial.faceReferenceLoops = faceLoops.map((loop) => loop.map((point) => ({ ...point })));
    const shape = editingId ? shapesRef.current.find((entry) => entry.id === editingId) : null;
    const doc = existingDoc
      ? cloneSketchDoc(existingDoc)
      : ensureSketchDocOnShape({
          sketchDoc: shape?.sketchDoc,
          sketchProfile: initial,
          sketchPlane: resolvedPlane,
          sketchId: shape?.sketchId,
        }) ?? sketchProfileToDoc(initial, shape?.sketchId);
    doc.plane = cloneSketchPlane(resolvedPlane);
    doc.faceReferenceLoops = initial.faceReferenceLoops;
    const solved = solveSketchDoc(doc);
    setSketchFacePickMode(false);
    setToolbarMode("sketch");
    setSketchActive(true);
    setSketchFocusMode("3d");
    setRevolvePrompt(null);
    setPolygonSidesPrompt(null);
    setExtrudeHeightPrompt(null);
    setSketchTool(profile?.segments.length || solved.doc.entities.length ? "select" : "line");
    const guided = profileWithConstructionGuides(initial, solved.doc);
    setSketchProfile(guided);
    setSketchDoc(solved.doc);
    setSketchSolveStatus(solved.status);
    setSketchDof(solved.dof);
    setSketchConflicts(solved.conflicts);
    const initialHistory = [cloneSketchProfile(guided)];
    sketchHistoryRef.current = initialHistory;
    sketchHistoryIndexRef.current = 0;
    setSketchHistory(initialHistory);
    setSketchHistoryIndex(0);
    setSketchActivePointId(null);
    setSketchSelection(null);
    setSketchMeasureStart(null);
    setSketchMeasurement(null);
    setEditingSketchShapeId(editingId);
    const hostName = resolvedPlane.hostShapeId
      ? shapesRef.current.find((shapeEntry) => shapeEntry.id === resolvedPlane.hostShapeId)?.name
      : null;
    const barrel = resolvedPlane.surface?.kind === "cylinder";
    setNotice(
      editingId
        ? `Editing sketch — ${solved.status.replace("-", " ")}${solved.dof ? ` (${solved.dof} DOF)` : ""}`
        : hostName
          ? barrel
            ? `Unwrapped ${hostName}: up/down = height, left/right = around — Hole cuts through, Solid joins outward`
            : `Sketching on ${hostName} — Extrude as Hole (cut) or Solid (join)`
          : "Sketch started: place the first point",
    );
  }, [captureProjectPreviewFrame]);
  beginBlankSketchRef.current = () => beginSketch();

  const beginEditSelectedSketch = useCallback(() => {
    const selected = selectedShape;
    const feature = activeFeatureId && selected?.groupedShapes
      ? selected.groupedShapes.find((child) => child.id === activeFeatureId) ?? null
      : null;
    const shape = resolveEditableSketchShape(feature ?? selected, {
      preferredId: activeFeatureId,
      preferFaceFeatures: !activeFeatureId,
    });
    if (!shape || !shapeHasEditableSketch(shape)) {
      setNotice("Select a body with a sketch feature, or Alt-click a feature then Edit sketch");
      return;
    }
    const session = beginEditSketchSession(shape, "3d");
    if (!session?.doc) {
      setNotice("That shape has no editable sketch");
      return;
    }
    const profile = shape.sketchProfile ?? sketchDocToProfile(session.doc);
    beginSketch(profile, shape.id, shape.sketchPlane ?? session.doc.plane, session.doc);
  }, [activeFeatureId, beginSketch, selectedShape]);

  /** Edit a driving sketch dimension from the inspector without entering sketch mode (Fusion-like). */
  const editSelectedSketchDimension = useCallback((dimensionId: string, value: number) => {
    void (async () => {
      const selected = selectedShape;
      const feature = activeFeatureId && selected?.groupedShapes
        ? selected.groupedShapes.find((child) => child.id === activeFeatureId) ?? null
        : null;
      const shape = resolveEditableSketchShape(feature ?? selected);
      if (!shape?.sketchDoc || !shape.sketchProfile) {
        setNotice("Select a sketched solid with dimensions");
        return;
      }
      const solved = setDrivingDimensionValue(shape.sketchDoc, dimensionId, value);
      const profile = sketchDocToProfile(solved.doc);
      profile.sketchPlane = shape.sketchPlane ?? profile.sketchPlane;
      const rebuilt = shapeFromSketchProfile(profile, shape.height, {
        ...shape,
        sketchDoc: solved.doc,
        sketchId: shape.sketchId ?? solved.doc.id,
      }, {
        cutIntoFace: Boolean(shape.hole && isFaceHostedSketch(shape.sketchPlane, shape.sketchProfile?.faceReferenceLoops)),
      });
      if (!rebuilt) {
        setNotice("Could not rebuild sketch after dimension change");
        return;
      }
      rebuilt.sketchDoc = solved.doc;
      rebuilt.hole = shape.hole;
      rebuilt.color = shape.color;
      flushSync(() => {
        setNotice("Building sketch…");
      });
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
      });
      const exact = await withExactSketchExtrusionSolid(rebuilt, shape.height, {
        cutIntoFace: Boolean(shape.hole && isFaceHostedSketch(shape.sketchPlane, shape.sketchProfile?.faceReferenceLoops)),
      });
      const owner = findCsgBodyOwningLeaf(shapesRef.current, exact.id);
      if (owner) {
        const sourceFingerprint = projectShapesFingerprint(shapesRef.current);
        const sourceProjectId = projectInfoRef.current.projectId;
        const remeshGen = remeshGenerationRef.current + 1;
        remeshGenerationRef.current = remeshGen;
        const { body, remeshed } = await updateCsgLeafAndRemesh(owner, shape.id, exact);
        if (remeshGen !== remeshGenerationRef.current) return;
        if (projectInfoRef.current.projectId !== sourceProjectId || projectShapesFingerprint(shapesRef.current) !== sourceFingerprint) {
          setNotice("The scene changed while remeshing; try the dimension edit again");
          return;
        }
        commitShapes(
          shapesRef.current.map((entry) => (entry.id === owner.id ? body : entry)),
          body.id,
          `Sketch dimension → ${value.toFixed(2)} mm`,
        );
        if (remeshed && body.edgeTreatments?.length) {
          await reapplyEdgeTreatmentsRef.current(body);
        }
        if (!remeshed) {
          setNotice("Could not remesh after dimension change — last good mesh kept. Ungroup then Group to retry.");
        }
        return;
      }
      commitShapes(
        shapesRef.current.map((entry) => (entry.id === shape.id ? exact : entry)),
        exact.id,
        `Sketch dimension → ${value.toFixed(2)} mm`,
      );
    })();
  }, [activeFeatureId, commitShapes, selectedShape]);

  const suppressSelectedFeature = useCallback((featureId: string, suppressed: boolean) => {
    if (edgeModifier) {
      setNotice("Cancel the fillet or chamfer before turning a feature off.");
      return;
    }
    void (async () => {
      try {
        const body = selectedShape;
        if (!body?.groupedShapes?.length) return;
        const dirty = setCsgChildSuppressed(body, featureId, suppressed);
        const hadEdgeTreatment = Boolean(dirty.edgeTreatments?.length);
        const remeshGen = remeshGenerationRef.current + 1;
        remeshGenerationRef.current = remeshGen;
        const remeshed = await remeshCsgGroup(dirty);
        if (remeshGen !== remeshGenerationRef.current) return;
        const next = remeshed ?? {
          ...dirty,
          importedMesh: body.importedMesh,
          csg: { ...(dirty.csg ?? { op: inferCsgOp(dirty) ?? "union", version: 1 }), dirty: true },
        };
        // A fillet belongs to the solid that existed when it was applied. Turning a
        // feature off changes that solid, so the old fillet is cleared instead of
        // being run again on edges that may no longer exist.
        const committed = remeshed && hadEdgeTreatment
          ? {
              ...next,
              edgeTreatments: undefined,
              edgeTreatmentHistory: undefined,
              cadBrep: undefined,
              cadBrepFrame: undefined,
              cadDisplayEdges: undefined,
              cadDisplayEdgesVersion: undefined,
            }
          : next;
        commitShapes(
          shapesRef.current.map((entry) => (entry.id === body.id ? committed : entry)),
          body.id,
          !remeshed
            ? "Could not rebuild body after toggling feature — last good mesh kept. Ungroup then Group to retry."
            : hadEdgeTreatment
              ? (suppressed
                ? "Feature off. Fillet cleared — add it again on this body."
                : "Feature on. Fillet cleared — add it again on this body.")
              : (suppressed ? "Feature off — body rebuilt" : "Feature on — body rebuilt"),
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not turn that feature off.");
      }
    })();
  }, [commitShapes, edgeModifier, selectedShape]);

  const reorderSelectedFeature = useCallback((featureId: string, direction: "up" | "down") => {
    const body = selectedShape;
    if (!body?.groupedShapes?.length) return;
    const next = reorderCsgChild(body, featureId, direction);
    if (next === body) return;
    // Every child of a node feeds one op, so the evaluated solid is the same whatever the order.
    // Rebuilding would only spend the wait and risk an exact body returning faceted.
    commitShapes(
      shapesRef.current.map((entry) => (entry.id === body.id ? next : entry)),
      body.id,
      `Reordered feature ${direction}`,
    );
  }, [commitShapes, selectedShape]);

  const updateSelectedFeature = useCallback((featureId: string, patch: ShapeUpdatePatch) => {
    const body = shapesRef.current.find((entry) => entry.id === selectedShape?.id) ?? selectedShape;
    if (!body?.groupedShapes?.length) return;
    const child = body.groupedShapes.find((entry) => entry.id === featureId);
    if (!child) return;
    if (child.locked && !("locked" in patch)) {
      setNotice(`“${child.name}” is locked`);
      return;
    }
    const cleanedPatch = cleanShapePatch(patch);
    const nextChild = canonicalizeShape(
      "hole" in cleanedPatch
        ? withHoleMode(
          { ...child, ...cleanedPatch, color: child.color, solidColor: child.solidColor },
          Boolean(cleanedPatch.hole),
          cleanedPatch.hole ? undefined : cleanedPatch.color,
        )
        : { ...child, ...cleanedPatch },
    );
    const dirty = bumpCsgVersion({
      ...body,
      groupedShapes: body.groupedShapes.map((entry) => (entry.id === featureId ? nextChild : entry)),
    });
    const message = `Edited ${nextChild.name || nextChild.kind}`;
    const op = dirty.csg?.op ?? inferCsgOp(dirty);

    // Apply child params immediately so inspector + assemble previews stay in sync with the slider.
    const applyDirty = (current: WorkplaneShape[]) =>
      current.map((entry) => (entry.id === body.id ? dirty : entry));
    if (projectInteractionActiveRef.current) {
      setShapes((current) => {
        const next = applyDirty(current);
        shapesRef.current = next;
        interactionHistoryChangedRef.current = true;
        return next;
      });
    } else {
      const next = applyDirty(shapesRef.current);
      shapesRef.current = next;
      setShapes(next);
    }

    if (op === "assemble") {
      // Viewport already draws live children for assemble — no boolean remesh.
      const next = markCsgClean({
        ...dirty,
        importedMesh: undefined,
        csg: {
          op: "assemble",
          version: (dirty.csg?.version ?? 0) + 1,
          suppressed: dirty.csg?.suppressed,
        },
      });
      if (projectInteractionActiveRef.current) {
        setShapes((current) => {
          const mapped = current.map((entry) => (entry.id === body.id ? next : entry));
          shapesRef.current = mapped;
          interactionHistoryChangedRef.current = true;
          return mapped;
        });
      } else {
        commitShapes(
          shapesRef.current.map((entry) => (entry.id === body.id ? next : entry)),
          body.id,
          message,
        );
      }
      return;
    }

    pendingFeatureRemeshRef.current = { bodyId: body.id, message };
    if (featureRemeshTimerRef.current !== null) {
      window.clearTimeout(featureRemeshTimerRef.current);
    }
    const dragging = projectInteractionActiveRef.current;
    const delay = dragging ? 200 : 0;
    featureRemeshTimerRef.current = window.setTimeout(() => {
      featureRemeshTimerRef.current = null;
      void flushPendingFeatureRemesh({ skipOcct: true, draft: dragging });
    }, delay);
  }, [commitShapes, flushPendingFeatureRemesh, selectedShape]);

  // Clear in-body feature focus when the top-level selection changes.
  useEffect(() => {
    setActiveFeatureId(null);
  }, [selectedIds.join("|")]);

  const beginSketchFacePick = useCallback(() => {
    clearEditorToolSessions();
    setSketchFacePickMode(true);
    setToolbarMode("geometry");
    setSketchActive(false);
    setEditingSketchShapeId(null);
    setNotice("Click a face to sketch on, or click the workplane");
  }, [clearEditorToolSessions]);

  const cancelSketchFacePick = useCallback(() => {
    setSketchFacePickMode(false);
    setNotice("Sketch cancelled");
  }, []);

  const cancelSketch = useCallback(() => {
    setSketchActive(false);
    setSketchFacePickMode(false);
    setSketchActivePointId(null);
    setSketchSelection(null);
    setSketchMeasureStart(null);
    setSketchMeasurement(null);
    setEditingSketchShapeId(null);
    setRevolvePrompt(null);
    setPolygonSidesPrompt(null);
    setExtrudeHeightPrompt(null);
    setNotice("Sketch cancelled");
  }, []);

  const sketchUndo = useCallback(() => {
    const currentHistory = sketchHistoryRef.current;
    const currentIndex = sketchHistoryIndexRef.current;
    if (currentIndex <= 0) {
      setNotice("Nothing to undo in this sketch");
      return;
    }
    const nextIndex = currentIndex - 1;
    sketchHistoryIndexRef.current = nextIndex;
    setSketchHistoryIndex(nextIndex);
    const restored = cloneSketchProfile(currentHistory[nextIndex] ?? emptySketchProfile());
    // History entries may omit plane — keep the active host link.
    if (!restored.sketchPlane?.hostShapeId && sketchDoc.plane.hostShapeId) {
      restored.sketchPlane = mergeSketchPlanes(restored.sketchPlane, sketchDoc.plane);
    }
    if (!restored.faceReferenceLoops?.length && sketchDoc.faceReferenceLoops?.length) {
      restored.faceReferenceLoops = sketchDoc.faceReferenceLoops.map((loop) => loop.map((point) => ({ ...point })));
    }
    setSketchProfile(restored);
    // Merge rather than rebuild: sketch history stores profiles, which carry no construction or
    // projected geometry and no analytic curves, so rebuilding would drop them on every undo.
    setSketchDoc((doc) => mergeProfileIntoDoc(doc, restored));
    setSketchActivePointId(null);
    setSketchSelection(null);
    setNotice("Sketch undo");
  }, [sketchDoc.faceReferenceLoops, sketchDoc.plane]);

  const sketchRedo = useCallback(() => {
    const currentHistory = sketchHistoryRef.current;
    const currentIndex = sketchHistoryIndexRef.current;
    if (currentIndex >= currentHistory.length - 1) {
      setNotice("Nothing to redo in this sketch");
      return;
    }
    const nextIndex = currentIndex + 1;
    sketchHistoryIndexRef.current = nextIndex;
    setSketchHistoryIndex(nextIndex);
    const restored = cloneSketchProfile(currentHistory[nextIndex] ?? emptySketchProfile());
    if (!restored.sketchPlane?.hostShapeId && sketchDoc.plane.hostShapeId) {
      restored.sketchPlane = mergeSketchPlanes(restored.sketchPlane, sketchDoc.plane);
    }
    if (!restored.faceReferenceLoops?.length && sketchDoc.faceReferenceLoops?.length) {
      restored.faceReferenceLoops = sketchDoc.faceReferenceLoops.map((loop) => loop.map((point) => ({ ...point })));
    }
    setSketchProfile(restored);
    setSketchDoc((doc) => mergeProfileIntoDoc(doc, restored));
    setSketchActivePointId(null);
    setSketchSelection(null);
    setNotice("Sketch redo");
  }, [sketchDoc.faceReferenceLoops, sketchDoc.plane]);

  const setActiveSketchTool = useCallback((tool: SketchTool) => {
    if (!workspaceSettingsRef.current.peakcadPro && isPeakcadProSketchTool(tool)) {
      setNotice("Turn on Mintr Pro in Settings to use sketch constraints.");
      return;
    }
    setSketchTool(tool);
    setSketchActivePointId(null);
    setSketchSelection(null);
    if (tool !== "measure") setSketchMeasureStart(null);
    if (tool === "polygon") {
      setPolygonSidesPrompt(sketchPolygonSides);
    } else {
      setPolygonSidesPrompt(null);
    }
    const messages: Record<SketchTool, string> = {
      line: "Line: click points, type 50<30, or hold Shift for 15° steps",
      bezier: "Bézier: click and drag points to pull curve handles",
      smooth: "Smooth: click each point you want to curve",
      circle: "Circle: click the center, then drag to set the radius",
      ellipse: "Ellipse: click a corner, then drag the opposite corner",
      square: "Square: click a corner, then drag to size",
      rectangle: "Rectangle: click a corner, then drag the opposite corner",
      roundRect: "Rounded rectangle: click a corner, then drag to size",
      slot: "Slot: click a corner, then drag to size the capsule",
      triangle: "Triangle: click the center, then drag to a vertex",
      polygon: "Polygon: choose how many sides, then click the center and drag",
      star: "Star: click the center, then drag to a tip",
      arc: "Arc: click start, end, then a point the arc should pass through",
      offset: "Offset: click a line segment, then drag to set the offset distance",
      select: "Select: edit sketch geometry, pick blue profiles, or edit dimensions",
      refine: "Refine: click a segment to add a point, or a point to remove it",
      erase: "Erase: drag over points and lines to remove them",
      measure: "Measure: choose two points",
      dimension: "Dimension: click a line, a circle, or two points",
      trim: "Trim: click the piece to remove. It cuts at the nearest intersection",
      fillet: "Fillet: click corners, then press Enter",
      chamfer: "Chamfer: click corners, then press Enter",
      stroke: "Lineweight: turn the outline into a wall",
      mirror: "Mirror: select geometry, then a straight axis line",
      pattern: "Linear pattern: select geometry, then confirm spacing",
      "circular-pattern": "Circular pattern: select a shape. Copies spin around its middle",
      "constrain-h": "Horizontal: select a line",
      "constrain-v": "Vertical: select a line",
      "constrain-equal": "Equal: select two lines",
      "constrain-parallel": "Parallel: select two lines",
      "constrain-perp": "Perpendicular: select two lines",
      "constrain-tangent": "Tangent: click a line, then a circle",
      "constrain-symmetry": "Symmetry: click two points or lines, then the axis line",
      "constrain-coincident": "Coincident: click two points to join them",
      "constrain-midpoint": "Midpoint: click a point, then the line it should sit on",
      "constrain-fix": "Fix: click a point or line to lock it",
      "constrain-concentric": "Concentric: click two circles",
    };
    setNotice(messages[tool]);
    if (tool === "stroke") setValueDialog({ kind: "sketch-stroke" });
  }, [sketchPolygonSides]);

  useEffect(() => {
    if (workspaceSettings.peakcadPro || !isPeakcadProSketchTool(sketchTool)) return;
    setSketchTool("select");
    setSketchSelection(null);
  }, [sketchTool, workspaceSettings.peakcadPro]);

  // Apply Fusion-like constraint / modify / dimension tools when the user picks entities.
  useEffect(() => {
    if (!sketchActive || !sketchSelection) return;
    if (!workspaceSettings.peakcadPro && isPeakcadProSketchTool(sketchTool)) return;
    const segmentIds =
      sketchSelection.kind === "segment"
        ? [sketchSelection.id]
        : sketchSelection.kind === "multiple"
          ? sketchSelection.segmentIds
          : [];
    const pointIds =
      sketchSelection.kind === "point"
        ? [sketchSelection.id]
        : sketchSelection.kind === "multiple"
          ? sketchSelection.pointIds
          : [];

    if (sketchTool === "dimension") {
      const circle = resolveSketchCircle(sketchDoc, segmentIds[0], pointIds[0]);
      if (circle) {
        const solved = addRadiusDimension(sketchDoc, circle.id, circle.radius * 2, true);
        setSketchDoc(solved.doc);
        setSketchSolveStatus(solved.status);
        setSketchDof(solved.dof);
        setSketchConflicts(solved.conflicts);
        commitSketchProfile(sketchDocToProfile(solved.doc), `Driving diameter ${ (circle.radius * 2).toFixed(2) } mm`, solved.doc);
        setSketchTool("select");
        setSketchSelection(null);
        return;
      }
      if (pointIds.length >= 2) {
        const a = sketchProfile.points.find((point) => point.id === pointIds[0]);
        const b = sketchProfile.points.find((point) => point.id === pointIds[1]);
        if (!a || !b) return;
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const solved = addLinearDimension(sketchDoc, { pointIds: [a.id, b.id], value: length, driving: true });
        setSketchDoc(solved.doc);
        setSketchSolveStatus(solved.status);
        setSketchDof(solved.dof);
        setSketchConflicts(solved.conflicts);
        commitSketchProfile(sketchDocToProfile(solved.doc), `Driving dimension ${length.toFixed(2)} mm`, solved.doc);
        setSketchTool("select");
        setSketchSelection(null);
        return;
      }
      if (segmentIds[0]) {
        const segment = sketchProfile.segments.find((entry) => entry.id === segmentIds[0]);
        const a = sketchProfile.points.find((point) => point.id === segment?.startId);
        const b = sketchProfile.points.find((point) => point.id === segment?.endId);
        if (!segment || !a || !b) return;
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const solved = addLinearDimension(sketchDoc, { entityId: segment.id, value: length, driving: true });
        setSketchDoc(solved.doc);
        setSketchSolveStatus(solved.status);
        setSketchDof(solved.dof);
        setSketchConflicts(solved.conflicts);
        commitSketchProfile(sketchDocToProfile(solved.doc), `Driving dimension ${length.toFixed(2)} mm`, solved.doc);
        setSketchTool("select");
        setSketchSelection(null);
      }
      return;
    }

    if (sketchTool === "trim" && segmentIds[0]) {
      const at = sketchPickAtRef.current ?? { x: 0, z: 0 };
      const nextDoc = trimClickedSpan(sketchDoc, segmentIds[0], at);
      const solved = solveSketchDoc(nextDoc);
      setSketchDoc(solved.doc);
      commitSketchProfile(sketchDocToProfile(solved.doc), "Trimmed", solved.doc);
      setSketchTool("select");
      setSketchSelection(null);
      return;
    }

    if ((sketchTool === "fillet" || sketchTool === "chamfer") && pointIds.length) {
      return;
    }

    if (sketchTool === "constrain-h" && pointIds.length >= 2 && !segmentIds.length) {
      const solved = solveSketchDoc(addConstraints(sketchDoc, [{ kind: "horizontal", entityIds: [], pointIds: [pointIds[0], pointIds[1]] }]));
      setSketchDoc(solved.doc);
      setSketchSolveStatus(solved.status);
      setSketchDof(solved.dof);
      setSketchConflicts(solved.conflicts);
      commitSketchProfile(sketchDocToProfile(solved.doc), "Horizontal constraint", solved.doc);
      setSketchTool("select");
      setSketchSelection(null);
      return;
    }
    if (sketchTool === "constrain-v" && pointIds.length >= 2 && !segmentIds.length) {
      const solved = solveSketchDoc(addConstraints(sketchDoc, [{ kind: "vertical", entityIds: [], pointIds: [pointIds[0], pointIds[1]] }]));
      setSketchDoc(solved.doc);
      setSketchSolveStatus(solved.status);
      setSketchDof(solved.dof);
      setSketchConflicts(solved.conflicts);
      commitSketchProfile(sketchDocToProfile(solved.doc), "Vertical constraint", solved.doc);
      setSketchTool("select");
      setSketchSelection(null);
      return;
    }
    if (sketchTool === "constrain-coincident" && pointIds.length >= 2) {
      const solved = solveSketchDoc(addConstraints(sketchDoc, [{ kind: "coincident", entityIds: [], pointIds: [pointIds[0], pointIds[1]] }]));
      setSketchDoc(solved.doc);
      setSketchSolveStatus(solved.status);
      setSketchDof(solved.dof);
      setSketchConflicts(solved.conflicts);
      commitSketchProfile(sketchDocToProfile(solved.doc), "Coincident constraint", solved.doc);
      setSketchTool("select");
      setSketchSelection(null);
      return;
    }
    if (sketchTool === "constrain-midpoint" && pointIds[0] && segmentIds[0]) {
      const solved = solveSketchDoc(addConstraints(sketchDoc, [{ kind: "midpoint", entityIds: [segmentIds[0]], pointIds: [pointIds[0]] }]));
      setSketchDoc(solved.doc);
      setSketchSolveStatus(solved.status);
      setSketchDof(solved.dof);
      setSketchConflicts(solved.conflicts);
      commitSketchProfile(sketchDocToProfile(solved.doc), "Midpoint constraint", solved.doc);
      setSketchTool("select");
      setSketchSelection(null);
      return;
    }
    if (sketchTool === "constrain-fix" && (pointIds[0] || segmentIds[0])) {
      const target = pointIds[0] ?? segmentIds[0];
      const line = sketchDoc.entities.find((entity) => entity.id === target && entity.kind === "line");
      const fixedIds = line && line.kind === "line" ? [line.startId, line.endId] : [target];
      const solved = solveSketchDoc(addConstraints(sketchDoc, [{ kind: "fix", entityIds: fixedIds }]));
      setSketchDoc(solved.doc);
      setSketchSolveStatus(solved.status);
      setSketchDof(solved.dof);
      setSketchConflicts(solved.conflicts);
      commitSketchProfile(sketchDocToProfile(solved.doc), "Fixed", solved.doc);
      setSketchTool("select");
      setSketchSelection(null);
      return;
    }
    if (sketchTool === "constrain-concentric") {
      const first = resolveSketchCircle(sketchDoc, segmentIds[0], pointIds[0]);
      const second = resolveSketchCircle(sketchDoc, segmentIds[1], pointIds[1]);
      if (first && second && first.id !== second.id) {
        const solved = solveSketchDoc(addConstraints(sketchDoc, [{ kind: "concentric", entityIds: [first.id, second.id] }]));
        setSketchDoc(solved.doc);
        setSketchSolveStatus(solved.status);
        setSketchDof(solved.dof);
        setSketchConflicts(solved.conflicts);
        commitSketchProfile(sketchDocToProfile(solved.doc), "Concentric constraint", solved.doc);
        setSketchTool("select");
        setSketchSelection(null);
        return;
      }
    }
    if (sketchTool === "constrain-h" && segmentIds[0]) {
      const solved = solveSketchDoc(addConstraints(sketchDoc, [{ kind: "horizontal", entityIds: [segmentIds[0]] }]));
      setSketchDoc(solved.doc);
      setSketchSolveStatus(solved.status);
      setSketchDof(solved.dof);
      setSketchConflicts(solved.conflicts);
      commitSketchProfile(sketchDocToProfile(solved.doc), "Horizontal constraint", solved.doc);
      setSketchTool("select");
      setSketchSelection(null);
      return;
    }
    if (sketchTool === "constrain-v" && segmentIds[0]) {
      const solved = solveSketchDoc(addConstraints(sketchDoc, [{ kind: "vertical", entityIds: [segmentIds[0]] }]));
      setSketchDoc(solved.doc);
      setSketchSolveStatus(solved.status);
      setSketchDof(solved.dof);
      setSketchConflicts(solved.conflicts);
      commitSketchProfile(sketchDocToProfile(solved.doc), "Vertical constraint", solved.doc);
      setSketchTool("select");
      setSketchSelection(null);
      return;
    }
    if ((sketchTool === "constrain-equal" || sketchTool === "constrain-parallel" || sketchTool === "constrain-perp") && segmentIds.length >= 2) {
      const kind = sketchTool === "constrain-equal" ? "equal" : sketchTool === "constrain-parallel" ? "parallel" : "perpendicular";
      const solved = solveSketchDoc(addConstraints(sketchDoc, [{ kind, entityIds: [segmentIds[0], segmentIds[1]] }]));
      setSketchDoc(solved.doc);
      setSketchSolveStatus(solved.status);
      setSketchDof(solved.dof);
      setSketchConflicts(solved.conflicts);
      commitSketchProfile(sketchDocToProfile(solved.doc), `${kind} constraint`, solved.doc);
      setSketchTool("select");
      setSketchSelection(null);
      return;
    }

    if (sketchTool === "constrain-tangent" && (segmentIds.length || pointIds.length)) {
      const circle = resolveSketchCircle(sketchDoc, segmentIds[1], pointIds[0])
        ?? resolveSketchCircle(sketchDoc, segmentIds[0], pointIds[0]);
      const lineId = segmentIds.find((id) => sketchDoc.entities.some((entity) => entity.id === id && entity.kind === "line"));
      if (!circle || !lineId) return;
      const solved = solveSketchDoc(addConstraints(sketchDoc, [{ kind: "tangent", entityIds: [lineId, circle.id] }]));
      setSketchDoc(solved.doc);
      setSketchSolveStatus(solved.status);
      setSketchDof(solved.dof);
      setSketchConflicts(solved.conflicts);
      commitSketchProfile(sketchDocToProfile(solved.doc), "Tangent constraint", solved.doc);
      setSketchTool("select");
      setSketchSelection(null);
      return;
    }

    if (sketchTool === "constrain-symmetry" && sketchSelection.kind === "multiple" && segmentIds.length >= 1) {
      const axisId = segmentIds[segmentIds.length - 1];
      if (pointIds.length >= 2) {
        const solved = solveSketchDoc(addConstraints(sketchDoc, [{
          kind: "symmetry",
          entityIds: [pointIds[0], pointIds[1], axisId],
          pointIds: [pointIds[0], pointIds[1]],
        }]));
        setSketchDoc(solved.doc);
        setSketchSolveStatus(solved.status);
        setSketchDof(solved.dof);
        setSketchConflicts(solved.conflicts);
        commitSketchProfile(sketchDocToProfile(solved.doc), "Symmetry constraint", solved.doc);
        setSketchTool("select");
        setSketchSelection(null);
        return;
      }
      const pairSegments = segmentIds.filter((id) => id !== axisId);
      if (pairSegments.length >= 2) {
        const solved = solveSketchDoc(addConstraints(sketchDoc, [{
          kind: "symmetry",
          entityIds: [pairSegments[0], pairSegments[1], axisId],
        }]));
        setSketchDoc(solved.doc);
        setSketchSolveStatus(solved.status);
        setSketchDof(solved.dof);
        setSketchConflicts(solved.conflicts);
        commitSketchProfile(sketchDocToProfile(solved.doc), "Symmetry constraint", solved.doc);
        setSketchTool("select");
        setSketchSelection(null);
        return;
      }
    }

    if (sketchTool === "mirror" && sketchSelection.kind === "multiple" && segmentIds.length >= 1) {
      const axisId = segmentIds[segmentIds.length - 1];
      const entityIds = [...sketchSelection.pointIds, ...sketchSelection.segmentIds.filter((id) => id !== axisId)];
      if (!entityIds.length) return;
      const nextDoc = mirrorEntities(sketchDoc, entityIds, axisId);
      const solved = solveSketchDoc(nextDoc);
      setSketchDoc(solved.doc);
      commitSketchProfile(sketchDocToProfile(solved.doc), "Mirrored selection", solved.doc);
      setSketchTool("select");
      setSketchSelection(null);
      return;
    }

    if ((sketchTool === "pattern" || sketchTool === "circular-pattern") && (segmentIds.length || pointIds.length)) {
      const entityIds = sketchSelection.kind === "multiple"
        ? [...sketchSelection.pointIds, ...sketchSelection.segmentIds]
        : sketchSelection.kind === "segment"
          ? [sketchSelection.id]
          : sketchSelection.kind === "point"
            ? [sketchSelection.id]
            : [];
      setValueDialog({ kind: sketchTool === "circular-pattern" ? "sketch-circular-pattern" : "sketch-pattern", entityIds });
    }
  }, [commitSketchProfile, sketchActive, sketchDoc, sketchProfile, sketchSelection, sketchTool, workspaceSettings.peakcadPro]);

  const confirmSketchFilletChamferDialog = useCallback((values: Record<string, string>) => {
    if (!valueDialog || (valueDialog.kind !== "sketch-fillet" && valueDialog.kind !== "sketch-chamfer")) return;
    const { kind: dialogKind, pointIds } = valueDialog;
    setValueDialog(null);
    const amount = Number.parseFloat(values.amount ?? "");
    if (!Number.isFinite(amount) || amount <= 0) return;
    const cut = dialogKind === "sketch-fillet"
      ? filletCorners(sketchProfile, pointIds, amount)
      : chamferCorners(sketchProfile, pointIds, amount);
    if (!cut) {
      setNotice("Pick corners where exactly two lines meet");
      setSketchTool("select");
      setSketchSelection(null);
      return;
    }
    const label = dialogKind === "sketch-fillet" ? "Filleted" : "Chamfered";
    commitSketchProfile(cut.profile, `${label} ${cut.applied} corner${cut.applied === 1 ? "" : "s"}`);
    setSketchTool("select");
    setSketchSelection(null);
  }, [commitSketchProfile, sketchProfile, valueDialog]);

  const confirmSketchStrokeDialog = useCallback((values: Record<string, string>) => {
    if (!valueDialog || valueDialog.kind !== "sketch-stroke") return;
    setValueDialog(null);
    const width = Number.parseFloat(values.width ?? "");
    const sideText = (values.side ?? "center").trim().toLowerCase();
    const side = sideText === "inside" || sideText === "outside" || sideText === "center" ? sideText : null;
    if (!side || !Number.isFinite(width) || width <= 0) {
      setNotice("Lineweight needs a width and a side: center, inside, or outside");
      setSketchTool("select");
      return;
    }
    const stroked = strokeProfile(sketchProfile, { width, side });
    if (!stroked) {
      setNotice("Lineweight needs an outline. A closed shape becomes a frame, an open line becomes a stripe");
      setSketchTool("select");
      return;
    }
    commitSketchProfile(stroked, `Lineweight ${width.toFixed(2)} mm ${side}`);
    setSketchTool("select");
    setSketchSelection(null);
  }, [commitSketchProfile, sketchProfile, valueDialog]);

  useEffect(() => {
    if (!sketchActive || (sketchTool !== "fillet" && sketchTool !== "chamfer")) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const pointIds = sketchSelection?.kind === "point"
        ? [sketchSelection.id]
        : sketchSelection?.kind === "multiple"
          ? sketchSelection.pointIds
          : [];
      if (!pointIds.length) return;
      event.preventDefault();
      setValueDialog({ kind: sketchTool === "fillet" ? "sketch-fillet" : "sketch-chamfer", pointIds });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sketchActive, sketchSelection, sketchTool]);

  const editSketchSegmentLength = useCallback((segmentId: string, length: number, grow: "end" | "both") => {
    const next = resizeSegmentLength(sketchProfile, segmentId, length, grow);
    if (!next) {
      setNotice("Type a length on a line");
      return;
    }
    if (workspaceSettings.peakcadPro) {
      const merged = mergeProfileIntoDoc(sketchDoc, next);
      const existing = merged.dimensions.find((dimension) => dimension.kind === "linear" && dimension.driving && dimension.entityIds[0] === segmentId);
      const solved = existing
        ? setDrivingDimensionValue(merged, existing.id, length)
        : addLinearDimension(merged, { entityId: segmentId, value: length, driving: true });
      setSketchDoc(solved.doc);
      setSketchSolveStatus(solved.status);
      setSketchDof(solved.dof);
      setSketchConflicts(solved.conflicts);
      commitSketchProfile(sketchDocToProfile(solved.doc), `Length ${length.toFixed(2)} mm`, solved.doc);
      return;
    }
    commitSketchProfile(next, `Length ${length.toFixed(2)} mm`);
  }, [commitSketchProfile, sketchDoc, sketchProfile, workspaceSettings.peakcadPro]);

  const editSketchCornerAngle = useCallback((pointId: string, degrees: number, leg: 0 | 1) => {
    const next = setCornerAngle(sketchProfile, pointId, degrees, leg);
    if (!next) {
      setNotice("That corner needs two straight lines");
      return;
    }
    commitSketchProfile(next, `Corner ${degrees.toFixed(0)}°`);
  }, [commitSketchProfile, sketchProfile]);

  const confirmSketchPatternDialog = useCallback((values: Record<string, string>) => {
    if (!valueDialog || valueDialog.kind !== "sketch-pattern") return;
    const { entityIds } = valueDialog;
    setValueDialog(null);
    const countX = Math.max(1, Number.parseInt(values.countX ?? "3", 10) || 3);
    const countZ = Math.max(1, Number.parseInt(values.countZ ?? "1", 10) || 1);
    const spacingX = Number.parseFloat(values.spacingX ?? "10") || 10;
    const spacingZ = Number.parseFloat(values.spacingZ ?? "10") || 10;
    const nextDoc = rectangularPattern(sketchDoc, entityIds, countX, countZ, spacingX, spacingZ);
    const solved = solveSketchDoc(nextDoc);
    setSketchDoc(solved.doc);
    commitSketchProfile(sketchDocToProfile(solved.doc), "Linear pattern created", solved.doc);
    setSketchTool("select");
    setSketchSelection(null);
  }, [commitSketchProfile, sketchDoc, valueDialog]);

  const confirmSketchCircularPatternDialog = useCallback((values: Record<string, string>) => {
    if (!valueDialog || valueDialog.kind !== "sketch-circular-pattern") return;
    const { entityIds } = valueDialog;
    setValueDialog(null);
    const count = Math.max(2, Number.parseInt(values.count ?? "6", 10) || 6);
    const center = patternSelectionCenter(sketchDoc, entityIds);
    if (!center) {
      setNotice("Select a shape to copy");
      setSketchTool("select");
      setSketchSelection(null);
      return;
    }
    const nextDoc = circularPatternSketch(sketchDoc, entityIds, center, count);
    const solved = solveSketchDoc(nextDoc);
    setSketchDoc(solved.doc);
    commitSketchProfile(sketchDocToProfile(solved.doc), "Circular pattern created", solved.doc);
    setSketchTool("select");
    setSketchSelection(null);
  }, [commitSketchProfile, sketchDoc, valueDialog]);

  const cancelValueDialog = useCallback(() => {
    setValueDialog(null);
  }, []);

  const setSketchPolygonSideCount = useCallback((sides: number) => {
    const next = Math.max(MIN_SKETCH_POLYGON_SIDES, Math.min(MAX_SKETCH_POLYGON_SIDES, Math.round(sides)));
    setSketchPolygonSides(next);
    setPolygonSidesPrompt((current) => (current === null ? null : next));
    if (sketchTool === "polygon") {
      setNotice(`Polygon: click the center, then drag (${next} sides)`);
    }
  }, [sketchTool]);

  const confirmPolygonSidesPrompt = useCallback(() => {
    if (polygonSidesPrompt === null) return;
    const next = Math.max(MIN_SKETCH_POLYGON_SIDES, Math.min(MAX_SKETCH_POLYGON_SIDES, Math.round(polygonSidesPrompt)));
    setSketchPolygonSides(next);
    setPolygonSidesPrompt(null);
    setSketchTool("polygon");
    setNotice(`Polygon: click the center, then drag (${next} sides)`);
  }, [polygonSidesPrompt]);

  const cancelPolygonSidesPrompt = useCallback(() => {
    setPolygonSidesPrompt(null);
    if (sketchTool === "polygon") {
      setNotice(`Polygon: click the center, then drag (${sketchPolygonSides} sides)`);
    }
  }, [sketchPolygonSides, sketchTool]);

  const measureSketchPoint = useCallback(
    (point: SketchPoint) => {
      if (!sketchMeasureStart) {
        setSketchMeasureStart({ ...point });
        setSketchMeasurement(null);
        setNotice("Choose the second measurement point");
        return;
      }
      const measurement = { start: { ...sketchMeasureStart }, end: { ...point } };
      setSketchMeasurement(measurement);
      setSketchMeasureStart(null);
      setNotice(`Measured ${Number(Math.hypot(measurement.end.x - measurement.start.x, measurement.end.z - measurement.start.z).toFixed(2))} mm`);
    },
    [sketchMeasureStart],
  );

  const clearSketchMeasurement = useCallback(() => {
    setSketchMeasureStart(null);
    setSketchMeasurement(null);
    setNotice("Sketch measurement removed");
  }, []);

  const connectSketchPoint = useCallback(
    (pointId: string, profile = sketchProfile) => {
      if (!["line", "bezier"].includes(sketchTool)) return profile;
      const curveKind = sketchTool as NonNullable<SketchSegment["kind"]>;
      if (!sketchActivePointId) {
        setSketchActivePointId(pointId);
        setSketchSelection({ kind: "point", id: pointId });
        return profile;
      }
      if (sketchActivePointId === pointId) return profile;
      const duplicate = profile.segments.some(
        (segment) =>
          (segment.startId === sketchActivePointId && segment.endId === pointId) ||
          (segment.startId === pointId && segment.endId === sketchActivePointId),
      );
      const next = duplicate
        ? profile
        : {
            ...profile,
            segments: [...profile.segments, { id: createLocalId("sketch-segment"), startId: sketchActivePointId, endId: pointId, kind: curveKind, ...(sketchDoc.settings.constructionMode ? { construction: true as const } : {}) }],
          };
      const smoothed = !duplicate && curveKind === "bezier"
        ? settleBezierSegment(next, sketchActivePointId, pointId)
        : next;
      const closed = orderedSketchPaths(smoothed).some((path) => path.closed && path.steps.some((step) => step.segment.startId === sketchActivePointId || step.segment.endId === sketchActivePointId));
      if (!duplicate) commitSketchProfile(smoothed, closed ? "Profile closed—edit the path or finish the sketch" : "Sketch segment added");
      setSketchActivePointId(closed ? null : pointId);
      setSketchSelection({ kind: "point", id: pointId });
      if (closed) setSketchTool("select");
      return smoothed;
    },
    [commitSketchProfile, sketchActivePointId, sketchDoc.settings.constructionMode, sketchProfile, sketchTool],
  );

  const appendSketchGeometry = useCallback(
    (geometry: Pick<SketchProfile, "points" | "segments"> | null, emptyMessage: string, successMessage: string, selectAfter = true) => {
      if (!geometry) {
        setNotice(emptyMessage);
        return;
      }
      const next: SketchProfile = {
        ...sketchProfile,
        points: [...sketchProfile.points, ...geometry.points],
        segments: [
          ...sketchProfile.segments,
          ...geometry.segments.map((segment) => sketchDoc.settings.constructionMode ? { ...segment, construction: true } : segment),
        ],
      };
      commitSketchProfile(next, successMessage);
      setSketchActivePointId(null);
      setSketchSelection(null);
      if (selectAfter) {
        setSketchTool("select");
      }
      setNotice(successMessage);
    },
    [commitSketchProfile, sketchDoc.settings.constructionMode, sketchProfile],
  );

  const addSketchCircle = useCallback(
    (center: { x: number; z: number }, radius: number) => {
      if (!(radius > 0.05)) {
        setNotice("Circle radius is too small");
        return;
      }
      const doc = cloneSketchDoc(sketchDoc);
      const centerId = createLocalId("sketch-point");
      const circleId = createLocalId("sketch-circle");
      doc.entities.push(
        { kind: "point", id: centerId, x: center.x, z: center.z, construction: sketchDoc.settings.constructionMode || undefined },
        { kind: "circle", id: circleId, centerId, radius, construction: sketchDoc.settings.constructionMode || undefined },
      );
      const expanded = sketchDocToProfile(doc);
      commitSketchProfile(
        {
          ...sketchProfile,
          points: expanded.points,
          segments: expanded.segments,
        },
        "Circle closed—edit the path or finish the sketch",
        doc,
      );
      setSketchActivePointId(null);
      setSketchSelection(null);
      setSketchTool("select");
    },
    [commitSketchProfile, sketchDoc, sketchProfile],
  );

  const addSketchEllipse = useCallback(
    (origin: { x: number; z: number }, corner: { x: number; z: number }) => {
      appendSketchGeometry(ellipseSketchGeometry(origin, corner), "Ellipse is too small", "Ellipse closed—edit the path or finish the sketch");
    },
    [appendSketchGeometry],
  );

  const addSketchSquare = useCallback(
    (origin: { x: number; z: number }, corner: { x: number; z: number }) => {
      appendSketchGeometry(squareSketchGeometry(origin, corner), "Square is too small", "Square closed—edit the path or finish the sketch");
    },
    [appendSketchGeometry],
  );

  const addSketchRectangle = useCallback(
    (origin: { x: number; z: number }, corner: { x: number; z: number }) => {
      appendSketchGeometry(rectangleSketchGeometry(origin, corner), "Rectangle is too small", "Rectangle closed—edit the path or finish the sketch");
    },
    [appendSketchGeometry],
  );

  const addSketchRoundRect = useCallback(
    (origin: { x: number; z: number }, corner: { x: number; z: number }) => {
      appendSketchGeometry(roundedRectangleSketchGeometry(origin, corner), "Rounded rectangle is too small", "Rounded rectangle closed—edit the path or finish the sketch");
    },
    [appendSketchGeometry],
  );

  const addSketchSlot = useCallback(
    (origin: { x: number; z: number }, corner: { x: number; z: number }) => {
      appendSketchGeometry(slotSketchGeometry(origin, corner), "Slot is too small", "Slot closed—edit the path or finish the sketch");
    },
    [appendSketchGeometry],
  );

  const addSketchTriangle = useCallback(
    (center: { x: number; z: number }, vertex: { x: number; z: number }) => {
      appendSketchGeometry(regularPolygonSketchGeometry(center, vertex, 3), "Triangle is too small", "Triangle closed—edit the path or finish the sketch");
    },
    [appendSketchGeometry],
  );

  const addSketchPolygon = useCallback(
    (center: { x: number; z: number }, vertex: { x: number; z: number }) => {
      appendSketchGeometry(
        regularPolygonSketchGeometry(center, vertex, sketchPolygonSides),
        "Polygon is too small",
        `${sketchPolygonSides}-sided polygon closed—edit the path or finish the sketch`,
      );
    },
    [appendSketchGeometry, sketchPolygonSides],
  );

  const addSketchStar = useCallback(
    (center: { x: number; z: number }, tip: { x: number; z: number }) => {
      appendSketchGeometry(starSketchGeometry(center, tip), "Star is too small", "Star closed—edit the path or finish the sketch");
    },
    [appendSketchGeometry],
  );

  const addSketchArc = useCallback(
    (start: { x: number; z: number }, end: { x: number; z: number }, through: { x: number; z: number }) => {
      appendSketchGeometry(arcSketchGeometry(start, end, through), "Could not fit an arc through those points", "Arc added", false);
    },
    [appendSketchGeometry],
  );

  const addSketchOffsetLine = useCallback(
    (segmentId: string, toward: { x: number; z: number }) => {
      const segment = sketchProfile.segments.find((entry) => entry.id === segmentId);
      const start = segment ? sketchProfile.points.find((point) => point.id === segment.startId) : null;
      const end = segment ? sketchProfile.points.find((point) => point.id === segment.endId) : null;
      if (!segment || !start || !end || segment.kind === "bezier" || segment.kind === "smooth") {
        setNotice("Offset works on straight line segments");
        return;
      }
      appendSketchGeometry(offsetLineSketchGeometry(start, end, toward), "Offset distance is too small", "Offset line added", false);
    },
    [appendSketchGeometry, sketchProfile.points, sketchProfile.segments],
  );

  const addSketchPlanePoint = useCallback(
    (position: { x: number; z: number }, handles?: { handleIn: { x: number; z: number }; handleOut: { x: number; z: number } }) => {
      if (sketchTool === "measure") {
        measureSketchPoint({ id: "measure", ...position });
        return;
      }
      if (sketchTool === "smooth") {
        setNotice("Click a point to curve it");
        return;
      }
      if (!["line", "bezier"].includes(sketchTool)) return;
      const curveKind = sketchTool as NonNullable<SketchSegment["kind"]>;
      const existing = sketchProfile.points.find((point) => Math.hypot(point.x - position.x, point.z - position.z) < 0.0001);
      if (existing) {
        connectSketchPoint(existing.id);
        return;
      }
      const point: SketchPoint = {
        id: createLocalId("sketch-point"),
        ...position,
        ...(handles ?? {}),
        mode: sketchTool === "line" ? "corner" : handles ? "smooth" : "corner",
      };
      const segmentId = sketchActivePointId ? createLocalId("sketch-segment") : null;
      const next: SketchProfile = { ...sketchProfile, points: [...sketchProfile.points, point] };
      if (sketchActivePointId && segmentId) {
        next.segments = [...next.segments, { id: segmentId, startId: sketchActivePointId, endId: point.id, kind: curveKind, ...(sketchDoc.settings.constructionMode ? { construction: true as const } : {}) }];
      }
      const prepared = sketchTool === "bezier" && sketchActivePointId && segmentId
        ? settleBezierSegment(next, sketchActivePointId, point.id)
        : next;
      // Persist snap inferences as real constraints (H/V/coincident/midpoint).
      let docOverride: SketchDoc | null = null;
      const snap = lastSketchSnap;
      if (workspaceSettingsRef.current.peakcadPro && snap?.inferredConstraints?.length) {
        const migrated = sketchProfileToDoc(prepared, sketchDoc.id, sketchDoc.plane);
        migrated.constraints = sketchDoc.constraints;
        migrated.dimensions = sketchDoc.dimensions;
        const inferred: Array<{ kind: "coincident" | "horizontal" | "vertical" | "midpoint"; entityIds: string[]; pointIds?: string[] }> = [];
        for (const inf of snap.inferredConstraints) {
          if (inf.kind === "coincident" && inf.pointIds?.[0]) {
            inferred.push({ kind: "coincident", entityIds: [], pointIds: [inf.pointIds[0], point.id] });
          } else if ((inf.kind === "horizontal" || inf.kind === "vertical") && segmentId) {
            inferred.push({ kind: inf.kind, entityIds: [segmentId] });
          } else if (inf.kind === "midpoint" && inf.entityIds?.[0]) {
            inferred.push({ kind: "midpoint", entityIds: [inf.entityIds[0]], pointIds: [point.id] });
          }
        }
        if (inferred.length) docOverride = addConstraints(migrated, inferred);
      }
      commitSketchProfile(
        prepared,
        sketchActivePointId ? "Sketch point and segment added" : "Sketch point added",
        docOverride,
      );
      setSketchActivePointId(point.id);
      setSketchSelection({ kind: "point", id: point.id });
    },
    [commitSketchProfile, connectSketchPoint, lastSketchSnap, measureSketchPoint, sketchActivePointId, sketchDoc, sketchProfile, sketchTool],
  );

  const pressSketchPoint = useCallback(
    (id: string) => {
      const point = sketchProfile.points.find((entry) => entry.id === id);
      if (!point) return;
      if (sketchTool === "measure") {
        measureSketchPoint(point);
        setSketchSelection({ kind: "point", id });
        return;
      }
      if (sketchTool === "smooth") {
        commitSketchProfile(withSketchPointMode(sketchProfile, id, "smooth"), "Point curved");
        setSketchActivePointId(null);
        setSketchSelection({ kind: "point", id });
        return;
      }
      if (SKETCH_POINT_CHAIN_TOOLS.has(sketchTool)) {
        connectSketchPoint(id);
        return;
      }
      setSketchActivePointId(null);
      setSketchSelection((current) => accumulateSketchPick(current, sketchTool, { pointId: id }));
    },
    [commitSketchProfile, connectSketchPoint, measureSketchPoint, sketchProfile, sketchTool],
  );

  const editSketchCircleRadius = useCallback((circleId: string, radius: number) => {
    if (!(radius > 0.05)) return;
    const doc = cloneSketchDoc(sketchDoc);
    const circle = doc.entities.find((entity) => entity.id === circleId && entity.kind === "circle");
    if (!circle || circle.kind !== "circle") return;
    circle.radius = radius;
    const solved = solveSketchDoc(doc);
    commitSketchProfile(sketchDocToProfile(solved.doc), `Circle radius ${radius.toFixed(2)} mm`, solved.doc);
  }, [commitSketchProfile, sketchDoc]);

  const deleteSketchPoint = useCallback(
    (id: string) => {
      const circles = sketchDoc.entities.filter((entity) => entity.kind === "circle" && entity.centerId === id);
      const tiedToOtherGeometry = sketchProfile.segments.some((segment) => {
        if (segment.startId !== id && segment.endId !== id) return false;
        return !circles.some((circle) => segment.id.startsWith(`${circle.id}-s`));
      });
      if (circles.length && !tiedToOtherGeometry) {
        commitSketchProfile(omitCurveStandIns(sketchProfile, circles.map((circle) => circle.id), [id]), "Circle removed");
        if (sketchActivePointId === id) setSketchActivePointId(null);
        setSketchSelection(null);
        return;
      }
      const connected = sketchProfile.segments.filter((segment) => segment.startId === id || segment.endId === id);
      const neighboringIds = connected.map((segment) => segment.startId === id ? segment.endId : segment.startId);
      const remainingSegments = sketchProfile.segments.filter((segment) => segment.startId !== id && segment.endId !== id);
      if (neighboringIds.length === 2 && neighboringIds[0] !== neighboringIds[1]) {
        const duplicate = remainingSegments.some((segment) =>
          (segment.startId === neighboringIds[0] && segment.endId === neighboringIds[1]) ||
          (segment.startId === neighboringIds[1] && segment.endId === neighboringIds[0]),
        );
        if (!duplicate) {
          remainingSegments.push({
            id: createLocalId("sketch-segment"),
            startId: neighboringIds[0],
            endId: neighboringIds[1],
            kind: connected.every((segment) => segment.kind === "line") ? "line" : connected.some((segment) => segment.kind === "smooth") ? "smooth" : "bezier",
          });
        }
      }
      const next = {
        ...sketchProfile,
        points: sketchProfile.points.filter((point) => point.id !== id),
        segments: remainingSegments,
      };
      commitSketchProfile(next.segments.some((segment) => segment.kind === "smooth") ? withSmoothSketchHandles(next) : next, "Sketch point removed");
      if (sketchActivePointId === id) setSketchActivePointId(null);
      setSketchSelection(null);
    },
    [commitSketchProfile, sketchActivePointId, sketchDoc, sketchProfile],
  );

  const deleteSketchSegment = useCallback(
    (id: string) => {
      const circle = sketchDoc.entities.find((entity) => entity.id === id && entity.kind === "circle");
      if (circle && circle.kind === "circle") {
        const centerShared = sketchDoc.entities.some((entity) => entity.kind === "circle" && entity.id !== circle.id && entity.centerId === circle.centerId)
          || sketchProfile.segments.some((segment) => !segment.id.startsWith(`${circle.id}-`) && (segment.startId === circle.centerId || segment.endId === circle.centerId));
        commitSketchProfile(omitCurveStandIns(sketchProfile, [circle.id], centerShared ? [] : [circle.centerId]), "Circle removed");
        setSketchActivePointId(null);
        setSketchSelection(null);
        return;
      }
      commitSketchProfile({ ...sketchProfile, segments: sketchProfile.segments.filter((segment) => segment.id !== id) }, "Sketch line removed");
      setSketchActivePointId(null);
      setSketchSelection(null);
    },
    [commitSketchProfile, sketchDoc, sketchProfile],
  );

  const eraseSketchEntities = useCallback(
    (pointIds: string[], segmentIds: string[]) => {
      if (!pointIds.length && !segmentIds.length) return;
      const circleIds = segmentIds.filter((id) => sketchDoc.entities.some((entity) => entity.id === id && entity.kind === "circle"));
      const circleIdSet = new Set(circleIds);
      const centers = circleIds.flatMap((id) => {
        const circle = sketchDoc.entities.find((entity) => entity.id === id && entity.kind === "circle");
        if (!circle || circle.kind !== "circle") return [];
        const shared = sketchDoc.entities.some((entity) => entity.kind === "circle" && entity.id !== id && entity.centerId === circle.centerId && !circleIdSet.has(entity.id));
        return shared ? [] : [circle.centerId];
      });
      const base = omitCurveStandIns(sketchProfile, circleIds, centers);
      const removedPoints = new Set(pointIds);
      const removedSegments = new Set(segmentIds.filter((id) => !circleIdSet.has(id)));
      const nextSegments = base.segments.filter(
        (segment) =>
          !removedSegments.has(segment.id)
          && !removedPoints.has(segment.startId)
          && !removedPoints.has(segment.endId),
      );
      const connectedPointIds = new Set<string>();
      for (const segment of nextSegments) {
        connectedPointIds.add(segment.startId);
        connectedPointIds.add(segment.endId);
      }
      const nextPoints = base.points.filter((point) => {
        if (removedPoints.has(point.id)) return false;
        // Drop points that no longer belong to any remaining segment.
        if (!connectedPointIds.has(point.id) && base.segments.some((segment) => segment.startId === point.id || segment.endId === point.id)) {
          return false;
        }
        return true;
      });
      const next: SketchProfile = {
        ...base,
        points: nextPoints,
        segments: nextSegments,
      };
      const count = removedPoints.size + removedSegments.size + circleIds.length;
      commitSketchProfile(
        next.segments.some((segment) => segment.kind === "smooth") ? withSmoothSketchHandles(next) : next,
        count === 1 ? "Erased sketch geometry" : `Erased ${count} sketch items`,
      );
      if (sketchActivePointId && removedPoints.has(sketchActivePointId)) setSketchActivePointId(null);
      setSketchSelection(null);
    },
    [commitSketchProfile, sketchActivePointId, sketchDoc, sketchProfile],
  );

  const updateSketchImage = useCallback((id: string, patch: Partial<SketchImage>, message = "Sketch image updated") => {
    const image = (sketchProfile.images ?? []).find((entry) => entry.id === id);
    if (!image) return;
    commitSketchProfile({
      ...sketchProfile,
      images: (sketchProfile.images ?? []).map((entry) => entry.id === id ? { ...entry, ...patch } : entry),
    }, message);
    setSketchSelection({ kind: "image", id });
    setSketchActivePointId(null);
  }, [commitSketchProfile, sketchProfile]);

  const deleteSketchImage = useCallback((id: string) => {
    if (!(sketchProfile.images ?? []).some((image) => image.id === id)) return;
    commitSketchProfile({
      ...sketchProfile,
      images: (sketchProfile.images ?? []).filter((image) => image.id !== id),
    }, "Sketch image removed");
    setSketchSelection(null);
  }, [commitSketchProfile, sketchProfile]);

  const addSketchImageFile = useCallback(async (file: File) => {
    if (!sketchActive || sketchTool !== "select") {
      setNotice("Choose Select before adding a sketch image");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setNotice("Choose a PNG, JPG, WebP, GIF, or other image file");
      return;
    }
    try {
      const prepared = await prepareImportedImage(file);
      const dimensions = imagePlateDimensions(prepared.pixelWidth, prepared.pixelHeight);
      const image: SketchImage = {
        id: createLocalId("sketch-image"),
        name: file.name.replace(/\.[^.]+$/, "") || "Sketch image",
        ...prepared,
        x: 0,
        z: 0,
        width: dimensions.width,
        depth: dimensions.depth,
        opacity: 0.55,
        lockAspect: true,
      };
      commitSketchProfile({ ...sketchProfile, images: [...(sketchProfile.images ?? []), image] }, `Added ${file.name} to the sketch`);
      setSketchSelection({ kind: "image", id: image.id });
      setSketchActivePointId(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The sketch image could not be added");
    }
  }, [commitSketchProfile, sketchActive, sketchProfile, sketchTool]);

  const deleteSelectedSketchEntity = useCallback(() => {
    if (!sketchSelection) {
      setNotice("Select a sketch point or segment to remove it");
      return;
    }
    if (sketchSelection.kind === "point") deleteSketchPoint(sketchSelection.id);
    else if (sketchSelection.kind === "segment") deleteSketchSegment(sketchSelection.id);
    else if (sketchSelection.kind === "image") deleteSketchImage(sketchSelection.id);
    else {
      const pointIds = new Set(sketchSelection.pointIds);
      const segmentIds = new Set(sketchSelection.segmentIds);
      const imageIds = new Set(sketchSelection.imageIds ?? []);
      const circleIds = sketchSelection.segmentIds.filter((id) => sketchDoc.entities.some((entity) => entity.id === id && entity.kind === "circle"));
      const base = omitCurveStandIns(sketchProfile, circleIds);
      commitSketchProfile({
        ...base,
        points: base.points.filter((point) => !pointIds.has(point.id)),
        segments: base.segments.filter((segment) => !segmentIds.has(segment.id) && !pointIds.has(segment.startId) && !pointIds.has(segment.endId)),
        images: (base.images ?? []).filter((image) => !imageIds.has(image.id)),
      }, "Selected sketch geometry removed");
      setSketchActivePointId(null);
      setSketchSelection(null);
    }
  }, [commitSketchProfile, deleteSketchImage, deleteSketchPoint, deleteSketchSegment, sketchDoc, sketchProfile, sketchSelection]);

  const copySelectedSketch = useCallback(() => {
    const clipped = sketchClipboardFromSelection(sketchProfile, sketchSelection);
    if (!clipped) {
      setNotice("Select sketch points, lines, or images to copy");
      return;
    }
    setSketchClipboard(clipped);
    const count = clipped.points.length + clipped.segments.length + clipped.images.length;
    setNotice(`Copied ${count} sketch item${count === 1 ? "" : "s"}`);
  }, [sketchProfile, sketchSelection]);

  const cutSelectedSketch = useCallback(() => {
    const clipped = sketchClipboardFromSelection(sketchProfile, sketchSelection);
    if (!clipped) {
      setNotice("Select sketch points, lines, or images to cut");
      return;
    }
    setSketchClipboard(clipped);
    deleteSelectedSketchEntity();
    const count = clipped.points.length + clipped.segments.length + clipped.images.length;
    setNotice(`Cut ${count} sketch item${count === 1 ? "" : "s"}`);
  }, [deleteSelectedSketchEntity, sketchProfile, sketchSelection]);

  const pasteSelectedSketch = useCallback(() => {
    if (!sketchClipboard) {
      setNotice("Sketch clipboard is empty");
      return;
    }
    const { profile, selection } = pasteSketchClipboardIntoProfile(sketchProfile, sketchClipboard);
    commitSketchProfile(profile, "Sketch pasted");
    setSketchSelection(selection);
    setSketchActivePointId(selection?.kind === "point" ? selection.id : null);
    setSketchTool("select");
  }, [commitSketchProfile, sketchClipboard, sketchProfile]);

  const moveSketchPoint = useCallback((id: string, position: { x: number; z: number }) => {
    const current = sketchProfile.points.find((point) => point.id === id);
    if (!current) return;
    const deltaX = position.x - current.x;
    const deltaZ = position.z - current.z;
    const next = {
      ...sketchProfile,
      points: sketchProfile.points.map((point) => point.id === id ? {
        ...point,
        ...position,
        handleIn: point.handleIn ? { x: point.handleIn.x + deltaX, z: point.handleIn.z + deltaZ } : undefined,
        handleOut: point.handleOut ? { x: point.handleOut.x + deltaX, z: point.handleOut.z + deltaZ } : undefined,
      } : point),
    };
    commitSketchProfile(next, "Sketch point moved");
  }, [commitSketchProfile, sketchProfile]);

  const moveSketchHandle = useCallback((id: string, handle: "in" | "out", position: { x: number; z: number }) => {
    const next = cloneSketchProfile(sketchProfile);
    const point = next.points.find((entry) => entry.id === id);
    if (!point) return;
    if (handle === "in") point.handleIn = { ...position };
    else point.handleOut = { ...position };
    if (point.mode === "smooth") {
      const opposite = { x: point.x * 2 - position.x, z: point.z * 2 - position.z };
      if (handle === "in") point.handleOut = opposite;
      else point.handleIn = opposite;
    }
    commitSketchProfile(next, "Curve handle adjusted");
  }, [commitSketchProfile, sketchProfile]);

  const setSketchPointMode = useCallback((id: string, mode: "corner" | "smooth" | "split") => {
    if (!sketchProfile.points.some((entry) => entry.id === id)) return;
    commitSketchProfile(
      withSketchPointMode(sketchProfile, id, mode),
      mode === "corner" ? "Made corner" : mode === "smooth" ? "Point curved" : "Curve handles freed",
    );
  }, [commitSketchProfile, sketchProfile]);

  const insertSketchPoint = useCallback((segmentId: string, position: { x: number; z: number }) => {
    const inserted = splitSketchSegmentAt(sketchProfile, segmentId, position);
    if (!inserted) {
      setNotice("Click between the points");
      return;
    }
    commitSketchProfile(inserted.profile, "Point added to path");
    setSketchSelection({ kind: "point", id: inserted.pointId });
    setSketchTool("select");
  }, [commitSketchProfile, sketchProfile]);

  const exitSketchMode = useCallback(() => {
    setSketchActive(false);
    setEditingSketchShapeId(null);
    setRevolvePrompt(null);
    setSweepPrompt(null);
    setSweepPreview(null);
    setSweepBuildError(null);
    setPolygonSidesPrompt(null);
    setExtrudeHeightPrompt(null);
    setToolbarMode("geometry");
  }, []);

  const startSketchExtrude = useCallback(() => {
    setRevolvePrompt(null);
    setSweepPrompt(null);
    setSweepPreview(null);
    const closedCount = orderedSketchPaths(closeOpenPathGaps(sketchProfile)).filter((path) => path.closed).length;
    if (closedCount === 0) {
      setNotice("Close at least one profile before extruding");
      return;
    }
    const existing = editingSketchShapeId ? shapes.find((shape) => shape.id === editingSketchShapeId) ?? null : null;
    const plane = mergeSketchPlanes(sketchProfile.sketchPlane, sketchDoc.plane);
    const faceSketch = isFaceHostedSketch(plane, sketchProfile.faceReferenceLoops ?? sketchDoc.faceReferenceLoops);
    const barrel = isCylinderSketchPlane(plane);
    const host = plane.hostShapeId
      ? shapes.find((shape) => shape.id === plane.hostShapeId && !shape.hole && !shape.hidden)
      : null;
    // Face holes default to through-all so the cutter fully punches the 3D part.
    // Barrel holes punch through the diameter (radial), not along a single planar normal.
    const throughDepth = barrel
      ? barrelThroughDepthMm(plane.surface)
      : host
        ? shapeThicknessInwardFromFace(host, plane.origin, plane.normal)
        : null;
    const defaultHeight = existing?.sketchFinish === "revolve"
      ? 10
      : existing?.height
        ?? throughDepth
        ?? 10;
    setExtrudeAsHole(faceSketch || Boolean(existing?.hole));
    setExtrudeHeightPrompt(Math.max(0.5, Number(defaultHeight.toFixed(2))));
    setNotice(faceSketch
      ? (barrel && throughDepth
        ? `Barrel sketch on ${host?.name ?? "cylinder"} — Hole cuts through (${throughDepth.toFixed(1)} mm), Solid joins outward`
        : throughDepth
          ? `Face sketch on ${host?.name ?? "part"} — Hole cuts through (${throughDepth.toFixed(1)} mm), Solid joins onto the face`
          : "Face sketch — Hole cuts into the part, Solid joins onto the face")
      : "Set extrude height, then create a solid or hole");
  }, [editingSketchShapeId, shapes, sketchDoc.faceReferenceLoops, sketchDoc.plane, sketchProfile]);

  const cancelExtrudeHeightPrompt = useCallback(() => {
    setExtrudeHeightPrompt(null);
    setExtrudeAsHole(false);
    setNotice("Extrude cancelled");
  }, []);

  const finishSketchExtrude = useCallback(async (heightMm?: number, asHole = extrudeAsHole) => {
    setRevolvePrompt(null);
    setExtrudeHeightPrompt(null);
    const existing = editingSketchShapeId
      ? findShapeInTree(shapesRef.current, editingSketchShapeId)
      : null;
    const mergedPlane = mergeSketchPlanes(sketchProfile.sketchPlane, sketchDoc.plane);
    const faceLoops = sketchProfile.faceReferenceLoops ?? sketchDoc.faceReferenceLoops;
    const faceSketch = isFaceHostedSketch(mergedPlane, faceLoops);
    const barrel = isCylinderSketchPlane(mergedPlane);
    const hostForDepth = mergedPlane.hostShapeId
      ? shapesRef.current.find((shape) => shape.id === mergedPlane.hostShapeId && !shape.hole && !shape.hidden)
      : null;
    const throughDepth = barrel
      ? barrelThroughDepthMm(mergedPlane.surface)
      : hostForDepth
        ? shapeThicknessInwardFromFace(hostForDepth, mergedPlane.origin, mergedPlane.normal)
        : null;
    const fallbackHeight = existing?.sketchFinish === "revolve"
      ? 10
      : existing?.height
        ?? throughDepth
        ?? 10;
    // Face holes that match the solid size must go fully through — otherwise coplanar
    // side walls leave the cutter sitting on the surface.
    let height = Math.max(0.5, heightMm ?? fallbackHeight);
    if (asHole && faceSketch && throughDepth) {
      // Face cuts are through-all: thickness measured from the sketch face, plus
      // overshoot past both skins so the hole isn't short/offset.
      // Barrel cuts use radial through-diameter (+ overshoot).
      height = barrel
        ? barrelHoleCutDepthMm(mergedPlane.surface)
        : faceHoleCutDepthMm(throughDepth);
    }
    const profileForExtrude = closeOpenPathGaps({
      ...sketchProfile,
      sketchPlane: mergedPlane,
      faceReferenceLoops: faceLoops,
    });
    const seedExisting = existing
      ? {
          ...existing,
          sketchDoc: cloneSketchDoc({ ...sketchDoc, plane: mergedPlane, faceReferenceLoops: faceLoops }),
          sketchId: sketchDoc.id,
          sketchProfileIds: sketchDoc.selectedProfileIds.length ? sketchDoc.selectedProfileIds : existing.sketchProfileIds,
        }
      : null;
    const base = shapeFromSketchProfile(profileForExtrude, height, seedExisting, {
      cutIntoFace: Boolean(asHole && faceSketch),
    });
    if (!base) {
      setNotice("Close at least one profile before extruding");
      return;
    }
    const linkedDoc = mergeProfileIntoDoc(
      cloneSketchDoc({ ...sketchDoc, plane: mergedPlane, faceReferenceLoops: faceLoops }),
      profileForExtrude,
    );
    base.sketchDoc = linkedDoc;
    base.sketchId = sketchDoc.id;
    base.sketchPlane = cloneSketchPlane(mergedPlane);
    if (sketchDoc.selectedProfileIds.length) base.sketchProfileIds = [...sketchDoc.selectedProfileIds];
    let extruded = asHole ? withHoleMode(base, true) : withHoleMode(base, false, existing?.color ?? base.color);

    // Resolve host for cut (hole) or join (solid on a face) — any solid, not only sketched ones.
    const preferredHostId = mergedPlane.hostShapeId ?? null;
    const selectedSolidId = selectedIdsRef.current.find((id) => {
      const shape = shapesRef.current.find((entry) => entry.id === id);
      return Boolean(shape && !shape.hole && !shape.locked && !shape.hidden && shape.id !== extruded.id && shape.id !== existing?.id);
    }) ?? null;
    const wantHost = Boolean(asHole || faceSketch);
    let host = wantHost
      ? findOverlappingHostForHole(extruded, shapesRef.current, preferredHostId ?? selectedSolidId)
      : null;

    // If host was found by selection/overlap after the first build, rebuild through-all
    // along the cut normal (exact profile size — no in-plane inflate).
    if (asHole && host && (!hostForDepth || host.id !== hostForDepth.id) && !barrel) {
      const hostThrough = faceHoleCutDepthMm(
        shapeThicknessInwardFromFace(host, mergedPlane.origin, mergedPlane.normal),
      );
      if (hostThrough > height + 0.05) {
        const rebuilt = shapeFromSketchProfile(profileForExtrude, hostThrough, seedExisting, {
          cutIntoFace: true,
        });
        if (rebuilt) {
          rebuilt.sketchDoc = linkedDoc;
          rebuilt.sketchId = sketchDoc.id;
          rebuilt.sketchPlane = cloneSketchPlane(mergedPlane);
          extruded = withHoleMode(rebuilt, true);
          height = hostThrough;
        }
      }
    }

    flushSync(() => {
      setNotice("Building sketch…");
    });
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    extruded = await withExactSketchExtrusionSolid(extruded, height, {
      cutIntoFace: Boolean(asHole && (faceSketch || host)),
    });

    // Editing a sketch feature already under a CSG body: replace leaf + remesh (no re-nest).
    const existingOwner = existing ? findCsgBodyOwningLeaf(shapesRef.current, existing.id) : null;
    if (existing && existingOwner) {
      const sourceFingerprint = projectShapesFingerprint(shapesRef.current);
      const sourceProjectId = projectInfoRef.current.projectId;
      const remeshGen = remeshGenerationRef.current + 1;
      remeshGenerationRef.current = remeshGen;
      const { body, remeshed } = await updateCsgLeafAndRemesh(existingOwner, existing.id, extruded);
      if (remeshGen !== remeshGenerationRef.current) return;
      if (projectInfoRef.current.projectId === sourceProjectId && projectShapesFingerprint(shapesRef.current) === sourceFingerprint) {
        commitShapes(
          shapesRef.current.map((shape) => (shape.id === existingOwner.id ? body : shape)),
          body.id,
          asHole ? `Sketch hole updated in ${existingOwner.name}` : `Sketch feature updated in ${existingOwner.name}`,
        );
        if (remeshed && body.edgeTreatments?.length) {
          await reapplyEdgeTreatmentsRef.current(body);
        }
        if (!remeshed) {
          setNotice("Could not remesh CSG body after sketch edit — last good mesh kept. Ungroup then Group to retry.");
        }
        exitSketchMode();
        setExtrudeAsHole(false);
        return;
      }
    }

    // Face / selected-solid: cut (hole) or join (solid) immediately into the host body.
    if (host && (asHole || faceSketch)) {
      const operands = asHole
        ? [withHoleMode(host, false), extruded]
        : [withHoleMode(host, false), withHoleMode(extruded, false, extruded.color)];
      const sourceFingerprint = projectShapesFingerprint(shapesRef.current);
      const sourceProjectId = projectInfoRef.current.projectId;
      const result = await buildGroupedShapeFromSelection(operands);
      if (projectInfoRef.current.projectId === sourceProjectId && projectShapesFingerprint(shapesRef.current) === sourceFingerprint) {
        if (result.group) {
          const linkedGroup = asPreservedCsgBody(host, result.group);
          const remaining = shapesRef.current.filter((shape) => shape.id !== host.id && shape.id !== existing?.id);
          commitShapes(
            [...remaining, linkedGroup],
            linkedGroup.id,
            asHole ? `Sketch hole cut into ${host.name}` : `Sketch solid joined to ${host.name}`,
          );
          exitSketchMode();
          setExtrudeAsHole(false);
          return;
        }
        if (result.consumed) {
          const remaining = shapesRef.current.filter((shape) => shape.id !== host.id && shape.id !== existing?.id);
          commitShapes(remaining, null, "Sketch feature consumed the host solid");
          exitSketchMode();
          setExtrudeAsHole(false);
          return;
        }
        setNotice(
          result.failureNotice
            || (asHole
              ? "Could not cut this sketch hole into the 3D part — try a deeper extrude or Group manually"
              : "Could not join this sketch solid to the 3D part — try Group manually"),
        );
      }
    }

    const nextShapes = existing
      ? shapesRef.current.map((shape) => (shape.id === existing.id ? extruded : shape))
      : [...shapesRef.current, extruded];
    commitShapes(
      nextShapes,
      extruded.id,
      asHole
        ? (host
          ? `Sketch hole ready — cut into ${host.name} failed; select the solid and Group to retry`
          : (existing ? "Sketch updated as hole — select a 3D solid and Group to cut" : `Sketch hole ready at ${height.toFixed(1)} mm — select a 3D solid and Group to cut`))
        : (faceSketch && host
          ? `Sketch solid ready — join to ${host.name} failed; select the solid and Group to retry`
          : (existing ? "Sketch updated in 3D" : `Sketch extruded at ${height.toFixed(1)} mm`)),
    );
    exitSketchMode();
    setExtrudeAsHole(false);
  }, [commitShapes, editingSketchShapeId, exitSketchMode, extrudeAsHole, sketchDoc, sketchProfile]);

  const completeSketchRevolve = useCallback((axis: SketchRevolveAxis) => {
    const existing = editingSketchShapeId ? shapes.find((shape) => shape.id === editingSketchShapeId) ?? null : null;
    const revolved = shapeFromSketchRevolve(sketchProfile, axis, existing);
    if (!revolved) {
      setRevolvePrompt({ phase: "pick" });
      setSketchTool("select");
      setNotice("Revolve needs a closed profile that stays on one side of the axis. Pick another axis line.");
      return;
    }
    const nextShapes = existing ? shapes.map((shape) => (shape.id === existing.id ? revolved : shape)) : [...shapes, revolved];
    commitShapes(nextShapes, revolved.id, existing ? "Sketch revolved" : "Sketch revolved around axis");
    exitSketchMode();
  }, [commitShapes, editingSketchShapeId, exitSketchMode, shapes, sketchProfile]);

  const startSketchRevolve = useCallback(() => {
    setSweepPrompt(null);
    setSweepPreview(null);
    if (!isDefaultSketchPlane(sketchProfile.sketchPlane)) {
      setNotice("Revolve is only available on workplane sketches");
      return;
    }
    const closedCount = orderedSketchPaths(sketchProfile).filter((path) => path.closed).length;
    if (closedCount === 0) {
      setNotice("Close a profile first, then click Revolve");
      return;
    }
    setSketchTool("select");
    const selectedAxis = resolveSketchRevolveAxis(sketchProfile, sketchSelection);
    if (selectedAxis) {
      setRevolvePrompt({ phase: "confirm", axis: selectedAxis });
      return;
    }
    setRevolvePrompt({ phase: "pick" });
  }, [sketchProfile, sketchSelection]);

  const commitSweepShape = useCallback((shape: WorkplaneShape) => {
    const existing = editingSketchShapeId ? shapes.find((entry) => entry.id === editingSketchShapeId) ?? null : null;
    const nextShapes = existing
      ? shapes.map((entry) => (entry.id === existing.id ? shape : entry))
      : [...shapes, shape];
    commitShapes(nextShapes, shape.id, existing ? "Sketch swept" : "Sketch swept along the path");
    setSweepPrompt(null);
    setSweepPreview(null);
    exitSketchMode();
  }, [commitShapes, editingSketchShapeId, exitSketchMode, shapes]);

  const startSketchSweep = useCallback(() => {
    setRevolvePrompt(null);
    if (sweepPrompt?.phase === "confirm") {
      if (sweepPreview) commitSweepShape(sweepPreview);
      else setNotice(sweepBuildError ?? "Building sweep…");
      return;
    }
    if (sweepPrompt?.phase === "pick-outline") {
      setNotice("Click the closed outline.");
      return;
    }
    if (sweepPrompt?.phase === "pick-path") {
      setNotice("Click the path.");
      return;
    }
    const guided = profileWithConstructionGuides(sketchProfile, sketchDoc);
    const existing = editingSketchShapeId ? shapes.find((shape) => shape.id === editingSketchShapeId) ?? null : null;
    if (!sweepPrompt && existing?.sketchSweep && resolveSketchSweep(guided, sketchDoc, existing.sketchSweep)) {
      setSketchTool("select");
      setSweepPrompt({ phase: "confirm", spec: existing.sketchSweep });
      return;
    }
    const plan = planSketchSweep(guided, sketchDoc);
    if (plan.outlines.length === 0) {
      setNotice("Close an outline first.");
      return;
    }
    if (plan.paths.length === 0) {
      setNotice("Draw the path, then Sweep.");
      return;
    }
    const openPaths = plan.paths.filter((path) => !path.closed);
    if (plan.outlines.length === 1 && plan.paths.length === 1 && openPaths.length === 1) {
      if (plan.outlines[0].holes.length > 1) {
        setNotice("Sweep can cut one hole in the outline.");
        return;
      }
      setSketchTool("select");
      setSweepPrompt({ phase: "confirm", spec: sweepSpec(plan.outlines[0], openPaths[0]) });
      return;
    }
    setSketchTool("select");
    setSweepPrompt({ phase: "pick-outline" });
    setNotice("Click the outline, then the path.");
  }, [commitSweepShape, editingSketchShapeId, shapes, sketchDoc, sketchProfile, sweepBuildError, sweepPreview, sweepPrompt]);

  const pickSweepSegment = useCallback((segmentId: string) => {
    if (!sweepPrompt || sweepPrompt.phase === "confirm") return false;
    const guided = profileWithConstructionGuides(sketchProfile, sketchDoc);
    const plan = planSketchSweep(guided, sketchDoc);
    const hit = (chain: SweepChain) => sweepChainHit(chain, segmentId);
    if (sweepPrompt.phase === "pick-outline") {
      const outline = plan.outlines.find(hit);
      if (!outline) {
        setNotice("Click the closed outline.");
        return true;
      }
      if (outline.holes.length > 1) {
        setNotice("Sweep can cut one hole in the outline.");
        return true;
      }
      setSweepPrompt({ phase: "pick-path", outlineId: outline.id });
      setNotice("Click the path.");
      return true;
    }
    const outline = plan.outlines.find((candidate) => candidate.id === sweepPrompt.outlineId);
    if (!outline) {
      setSweepPrompt({ phase: "pick-outline" });
      setNotice("Click the closed outline.");
      return true;
    }
    const path = [...plan.paths, ...plan.outlines.filter((candidate) => candidate.id !== outline.id)].find(hit);
    if (!path) {
      setNotice("Click the path.");
      return true;
    }
    setSweepPrompt({ phase: "confirm", spec: sweepSpec(outline, path) });
    return true;
  }, [sketchDoc, sketchProfile, sweepPrompt]);

  useEffect(() => {
    if (!sketchActive) {
      setSweepPrompt(null);
      setSweepPreview(null);
      setSweepBuildError(null);
    }
  }, [sketchActive]);

  useEffect(() => {
    if (sweepPrompt?.phase !== "confirm") {
      setSweepPreview(null);
      setSweepBuildError(null);
      return;
    }
    const spec = sweepPrompt.spec;
    let cancelled = false;
    setSweepPreview(null);
    setSweepBuildError(null);
    setNotice("Building sweep…");
    const guided = profileWithConstructionGuides(sketchProfile, sketchDoc);
    const existing = editingSketchShapeId ? shapesRef.current.find((shape) => shape.id === editingSketchShapeId) ?? null : null;
    void shapeFromSketchSweep(guided, sketchDoc, spec, existing).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setSweepPreview(null);
        setSweepBuildError(cadFailureCopy(result.message, "sweep"));
        setNotice(cadFailureCopy(result.message, "sweep"));
        return;
      }
      setSweepBuildError(null);
      setSweepPreview(result.shape);
      setSketchFocusMode("3d");
      setNotice("Sweep this outline along this path");
    });
    return () => {
      cancelled = true;
    };
  }, [editingSketchShapeId, sketchDoc, sketchProfile, sweepPrompt]);

  useEffect(() => {
    if (!revolvePrompt) return;
    const axis = resolveSketchRevolveAxis(sketchProfile, sketchSelection);
    if (!axis) return;
    if (revolvePrompt.phase === "pick") {
      setRevolvePrompt({ phase: "confirm", axis });
      return;
    }
    const sameAxis =
      Math.hypot(revolvePrompt.axis.start.x - axis.start.x, revolvePrompt.axis.start.z - axis.start.z) < 1e-6
      && Math.hypot(revolvePrompt.axis.end.x - axis.end.x, revolvePrompt.axis.end.z - axis.end.z) < 1e-6;
    const reversedAxis =
      Math.hypot(revolvePrompt.axis.start.x - axis.end.x, revolvePrompt.axis.start.z - axis.end.z) < 1e-6
      && Math.hypot(revolvePrompt.axis.end.x - axis.start.x, revolvePrompt.axis.end.z - axis.start.z) < 1e-6;
    if (!sameAxis && !reversedAxis) {
      setRevolvePrompt({ phase: "confirm", axis });
    }
  }, [revolvePrompt, sketchProfile, sketchSelection]);

  useEffect(() => {
    if (!projectId) {
      lastProjectIdRef.current = null;
      lastProjectShapesSyncRef.current = "";
      lastProjectShapesEchoRef.current = null;
      return;
    }
    if (projectInteractionActiveRef.current) {
      return;
    }
    const projectChanged = lastProjectIdRef.current !== projectId;
    if (projectChanged) {
      lastProjectIdRef.current = projectId;
      lastProjectShapesSyncRef.current = "";
      lastProjectShapesEchoRef.current = null;
    }
    const incoming = initialShapes.map(canonicalizeShape);
    const incomingSerialized = projectShapesFingerprint(incoming);
    // The parent echoes shapes after a local save; rehydrating that echo can reset active transform state.
    if (!projectChanged && lastProjectShapesEchoRef.current !== null && incomingSerialized === lastProjectShapesEchoRef.current) {
      lastProjectShapesSyncRef.current = incomingSerialized;
      return;
    }
    const localSerialized = projectShapesFingerprint(shapesRef.current);
    if (!projectChanged && incomingSerialized === localSerialized) {
      // Seed echo even when shapes already match — otherwise the first drag-end
      // rehydrates stale parent props and snaps the model back.
      lastProjectShapesSyncRef.current = incomingSerialized;
      lastProjectShapesEchoRef.current = incomingSerialized;
      return;
    }
    // Keep in-progress / unsaved local edits. Replacing them with a stale parent
    // snapshot remeshed boolean groups and snapped moved objects back.
    if (
      !projectChanged
      && shapesRef.current.length > 0
      && incomingSerialized !== localSerialized
      && (
        lastProjectShapesEchoRef.current === localSerialized
        || lastProjectShapesSyncRef.current === localSerialized
        || lastProjectShapesEchoRef.current === incomingSerialized
        || pendingProjectShapesRef.current !== null
        || projectSyncTimerRef.current !== null
      )
    ) {
      return;
    }
    if (projectSyncTimerRef.current !== null) {
      window.clearTimeout(projectSyncTimerRef.current);
      projectSyncTimerRef.current = null;
    }
    const hydratedHistory = hydrateEditorHistoryState(incoming, initialHistory, initialHistoryIndex);
    projectHydratingRef.current = true;
    const remeshGen = remeshGenerationRef.current + 1;
    remeshGenerationRef.current = remeshGen;
    void (async () => {
      // Heal CSG bodies that were saved with stripped history mesh caches.
      let migratedIncoming = migrateShapesCsg(incoming.map(canonicalizeShape));
      const needsHeal = migratedIncoming.some(historyShapeMissingTessellation);
      let remeshFailed: string[] = [];
      if (needsHeal) {
        const remeshResult = await remeshDirtyHistoryShapes(migratedIncoming);
        migratedIncoming = remeshResult.shapes;
        remeshFailed = remeshResult.failedNames;
      }
      if (remeshGen !== remeshGenerationRef.current) return;
      const localNow = projectShapesFingerprint(shapesRef.current);
      const incomingNow = projectShapesFingerprint(migratedIncoming);
      if (!projectChanged && localNow !== incomingSerialized && localNow !== incomingNow) {
        // User moved or edited while this heal was in flight.
        projectHydratingRef.current = false;
        return;
      }
      // Treat the hydrated snapshot as our own echo so interaction-end does not
      // wipe local edits with the pre-save parent copy.
      lastProjectShapesSyncRef.current = incomingNow;
      lastProjectShapesEchoRef.current = incomingNow;
      if (projectChanged || explicitSaveFingerprintRef.current === null) {
        explicitSaveFingerprintRef.current = incomingNow;
      }
      const keepSelection = selectedIdsRef.current.filter((id) => migratedIncoming.some((shape) => shape.id === id));
      shapesRef.current = migratedIncoming;
      selectedIdsRef.current = keepSelection;
      historyRef.current = hydratedHistory.entries;
      historyIndexRef.current = hydratedHistory.index;
      setShapes(migratedIncoming);
      setSelectedIds(keepSelection);
      setHistory(hydratedHistory.entries);
      setHistoryIndex(hydratedHistory.index);
      const healNotice = remeshFailed.length
        ? `Project synced · ${remeshFailed.length} group mesh${remeshFailed.length === 1 ? "" : "es"} could not rebuild`
        : needsHeal
          ? "Project synced · rebuilt group meshes"
          : "Project synced";
      setNotice(incoming.length ? healNotice : "Ready");
      if (needsHeal && remeshFailed.length === 0) {
        // Persist healed tessellations so the next load is not empty again.
        syncProjectShapes(migratedIncoming);
      }
    })();
  }, [initialHistory, initialHistoryIndex, initialShapes, projectId, projectInteractionActive, projectRevision, syncProjectShapes]);

  useEffect(() => {
    if (!projectId || !onProjectShapesChange) {
      return;
    }
    if (projectHydratingRef.current) {
      projectHydratingRef.current = false;
      const hydrated = projectShapesFingerprint(shapes);
      lastProjectShapesSyncRef.current = hydrated;
      lastProjectShapesEchoRef.current = hydrated;
      return;
    }
    syncProjectShapes(shapes);
  }, [onProjectShapesChange, projectId, shapes, syncProjectShapes]);

  useEffect(() => {
    const handlePageHide = () => {
      flushProjectShapesSync();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      flushProjectShapesSync();
      if (projectSyncTimerRef.current !== null) {
        window.clearTimeout(projectSyncTimerRef.current);
      }
      if (interactionHistoryTimerRef.current !== null) {
        window.clearTimeout(interactionHistoryTimerRef.current);
      }
    };
  }, [flushProjectShapesSync]);

  const addShape = useCallback(
    (asset: ShapeAsset, point?: { x: number; z: number; elevation?: number }) => {
      const x = point?.x ?? 0;
      const z = point?.z ?? 0;
      const place = { x, z, elevation: point?.elevation ?? 0 };
      if (asset.kind === "thread") {
        try {
          const nextShape = createThreadShape({
            designation: DEFAULT_THREAD_DESIGNATION,
            point: place,
            base: {
              id: createLocalId("thread"),
              name: `Threads ${DEFAULT_THREAD_DESIGNATION}`,
              color: asset.color,
            },
          });
          commitShapes([...shapesRef.current, nextShape], nextShape.id, "Threads added");
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Could not build threads");
        }
        return;
      }
      const nextShape = makeShapeFromAsset(asset, place, workspaceSettingsRef.current.displayQuality);
      commitShapes([...shapesRef.current, nextShape], nextShape.id, `${asset.name} added`);
    },
    [commitShapes],
  );

  const recordShapeRepeatActions = useCallback((entries: Array<{ shapeId: string; delta: ShapeRepeatDelta; before?: WorkplaneShape }>) => {
    let recorded = false;
    entries.forEach(({ shapeId, delta, before }) => {
      if (!hasShapeRepeatDelta(delta)) {
        return;
      }
      const current = shapesRef.current.find((shape) => shape.id === shapeId);
      if (!current) {
        return;
      }
      lastShapeActionRef.current[shapeId] = {
        delta,
        before: before ?? current,
      };
      recorded = true;
    });
    if (recorded) {
      duplicateRepeatDeltasRef.current = new Map();
    }
  }, []);

  const updateShape = useCallback(
    (id: string, patch: ShapeUpdatePatch) => {
      if (historyBrowseRef.current !== null) {
        if (!historyEditNoticeRef.current) {
          historyEditNoticeRef.current = true;
          setNotice("Close history before editing");
        }
        return;
      }
      const bakeTransform = Boolean(patch.bakeTransform);
      const cleanedPatch = cleanShapePatch(patch);
      const previous = shapesRef.current.find((shape) => shape.id === id);

      // Inspector Hole button: face-sketch cutters know their host — cut immediately.
      if (previous && !previous.locked && "hole" in cleanedPatch && cleanedPatch.hole && previous.sketchPlane?.hostShapeId) {
        void (async () => {
          const holeShape = withHoleMode(previous, true, cleanedPatch.color);
          const hostId = previous.sketchPlane?.hostShapeId;
          const host = hostId
            ? shapesRef.current.find((shape) => shape.id === hostId && !shape.hole && !shape.locked && !shape.hidden)
            : null;
          if (!host) {
            commitShapes(
              shapesRef.current.map((shape) => (shape.id === id ? holeShape : shape)),
              selectedIdsRef.current,
              "Changed selection to hole — select a solid and Group to cut",
            );
            return;
          }
          const sourceFingerprint = projectShapesFingerprint(shapesRef.current);
          const sourceProjectId = projectInfoRef.current.projectId;
          const result = await buildGroupedShapeFromSelection([withHoleMode(host, false), holeShape]);
          if (projectInfoRef.current.projectId !== sourceProjectId || projectShapesFingerprint(shapesRef.current) !== sourceFingerprint) {
            setNotice("The scene changed while cutting; try Hole again");
            return;
          }
          if (result.group) {
            const linkedGroup = asPreservedCsgBody(host, result.group);
            commitShapes(
              shapesRef.current.filter((shape) => shape.id !== host.id && shape.id !== id).concat(linkedGroup),
              linkedGroup.id,
              `Cut hole into ${host.name}`,
            );
            return;
          }
          if (result.consumed) {
            commitShapes(
              shapesRef.current.filter((shape) => shape.id !== host.id && shape.id !== id),
              null,
              "Hole consumed the host solid",
            );
            return;
          }
          commitShapes(
            shapesRef.current.map((shape) => (shape.id === id ? holeShape : shape)),
            selectedIdsRef.current,
            result.failureNotice,
          );
        })();
        return;
      }

      if (previous?.kind === "thread") {
        const designationFromPatch = cleanedPatch.threadSpec?.designation as MetricThreadDesignation | undefined;
        const threadSpecDriven = Boolean(cleanedPatch.threadSpec);
        const sizeDriven =
          typeof cleanedPatch.width === "number" ||
          typeof cleanedPatch.depth === "number" ||
          typeof cleanedPatch.size === "number";
        const heightDriven = typeof cleanedPatch.height === "number";
        const sidesDriven = typeof cleanedPatch.sides === "number";
        // Never scale a thread mesh — that squashes pitch. Always regenerate so
        // height changes add/remove turns at the metric pitch. Also regenerate on
        // bakeTransform after gizmo drags that only updated dimensions.
        const meshOutOfSync = Boolean(
          previous.importedMesh
          && (
            Math.abs(previous.height - previous.importedMesh.baseHeight) > 1e-4
            || Math.abs(shapeWidth(previous) - previous.importedMesh.baseWidth) > 1e-4
            || Math.abs(shapeDepth(previous) - previous.importedMesh.baseDepth) > 1e-4
          ),
        );
        const shouldRebuild =
          threadSpecDriven
          || sidesDriven
          || heightDriven
          || sizeDriven
          || (bakeTransform && meshOutOfSync);

        if (shouldRebuild) {
          let designation = (designationFromPatch ?? previous.threadSpec?.designation ?? DEFAULT_THREAD_DESIGNATION) as MetricThreadDesignation;
          if (sizeDriven && !designationFromPatch && (previous.threadSpec?.series ?? "metric") === "metric") {
            designation = nearestMetricThreadForDiameter(
              cleanedPatch.width ?? cleanedPatch.depth ?? cleanedPatch.size ?? shapeWidth(previous),
            ).designation;
          }
          const height = Math.max(0.5, cleanedPatch.height ?? previous.height);
          const previousLength = previous.threadSpec?.length ?? previous.height;
          const requestedLength = Math.max(
            0.5,
            cleanedPatch.threadSpec?.length
              ?? (heightDriven ? previousLength + (height - previous.height) : previousLength),
          );
          try {
            const built = createThreadShape({
              designation,
              height: requestedLength,
              base: {
                ...previous,
                ...cleanedPatch,
                id: previous.id,
                name: previous.name,
                color: cleanedPatch.color ?? previous.color,
                sides: cleanedPatch.sides ?? previous.sides,
                threadSpec: {
                  ...previous.threadSpec,
                  ...cleanedPatch.threadSpec,
                  designation,
                  majorDiameter: cleanedPatch.threadSpec?.majorDiameter ?? previous.threadSpec?.majorDiameter ?? 6,
                  pitch: cleanedPatch.threadSpec?.pitch ?? previous.threadSpec?.pitch ?? 1,
                  length: requestedLength,
                },
              },
            });
            const nextShape = canonicalizeShape({
              ...built,
              x: typeof cleanedPatch.x === "number" ? cleanedPatch.x : previous.x,
              z: typeof cleanedPatch.z === "number" ? cleanedPatch.z : previous.z,
              elevation: typeof cleanedPatch.elevation === "number" ? cleanedPatch.elevation : previous.elevation,
              rotation: typeof cleanedPatch.rotation === "number" ? cleanedPatch.rotation : previous.rotation,
              rotationX: typeof cleanedPatch.rotationX === "number" ? cleanedPatch.rotationX : previous.rotationX,
              rotationZ: typeof cleanedPatch.rotationZ === "number" ? cleanedPatch.rotationZ : previous.rotationZ,
              mirrorX: "mirrorX" in cleanedPatch ? cleanedPatch.mirrorX : previous.mirrorX,
              mirrorY: "mirrorY" in cleanedPatch ? cleanedPatch.mirrorY : previous.mirrorY,
              mirrorZ: "mirrorZ" in cleanedPatch ? cleanedPatch.mirrorZ : previous.mirrorZ,
              color: cleanedPatch.color ?? previous.color,
              hole: "hole" in cleanedPatch ? cleanedPatch.hole : previous.hole,
              locked: "locked" in cleanedPatch ? cleanedPatch.locked : previous.locked,
              hidden: "hidden" in cleanedPatch ? cleanedPatch.hidden : previous.hidden,
            });
            if (projectInteractionActiveRef.current) {
              // Live height/sides edits: update the mesh without a history entry per tick.
              setShapes((current) => {
                const next = current.map((shape) => (shape.id === id ? nextShape : shape));
                interactionHistoryChangedRef.current = true;
                shapesRef.current = next;
                return next;
              });
            } else {
              commitShapes(
                shapesRef.current.map((shape) => (shape.id === id ? nextShape : shape)),
                selectedIds,
                `${designation} threads updated`,
              );
            }
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Could not rebuild threads");
          }
          return;
        }

        // Rotations/mirrors on threads must not bake a scaled mesh into positions.
        if (bakeTransform) {
          const patched = canonicalizeShape({ ...previous, ...cleanedPatch });
          if (!workplaneShapesEqual(previous, patched)) {
            if (projectInteractionActiveRef.current) {
              setShapes((current) => {
                const next = current.map((shape) => (shape.id === id ? patched : shape));
                interactionHistoryChangedRef.current = true;
                shapesRef.current = next;
                return next;
              });
            } else {
              commitShapes(
                shapesRef.current.map((shape) => (shape.id === id ? patched : shape)),
                selectedIds,
              );
            }
          }
          return;
        }
      }

      const applyPatch = (current: WorkplaneShape[]) => {
        let changed = false;
        const next = current.map((shape) => {
          if (shape.id !== id) {
            return shape;
          }

          const patched = { ...shape, ...withMatchedTextFootprint(shape, cleanedPatch) };
          const canonicalBase = canonicalizeShape("hole" in cleanedPatch
            ? withHoleMode(
              { ...patched, color: shape.color, solidColor: shape.solidColor },
              Boolean(cleanedPatch.hole),
              cleanedPatch.hole ? undefined : cleanedPatch.color,
            )
            : patched);
          const canonical = bakeTransform ? canonicalizeShape(bakeShapeTransformIntoMesh(canonicalBase)) : canonicalBase;
          if (workplaneShapesEqual(shape, canonical)) {
            return shape;
          }
          changed = true;
          return canonical;
        });
        return { changed, next };
      };

      if (projectInteractionActiveRef.current) {
        setShapes((current) => {
          const { changed, next } = applyPatch(current);
          if (!changed) {
            return current;
          }
          interactionHistoryChangedRef.current = true;
          shapesRef.current = next;
          return next;
        });
        return;
      }

      const { changed, next } = applyPatch(shapesRef.current);
      if (changed) {
        // Record typed/post-drag rotation (and other numeric edits) for Duplicate & Repeat.
        // Bake-only patches keep whatever finalizeInteractionHistory already stored.
        if (previous) {
          const rotationPatched =
            typeof cleanedPatch.rotation === "number" ||
            typeof cleanedPatch.rotationX === "number" ||
            typeof cleanedPatch.rotationZ === "number";
          if (rotationPatched) {
            // Prefer the pre-drag shape when the degree box commits after a mouse rotate.
            const beforeForDelta = patch.repeatDeltaBefore ?? previous;
            const afterForDelta = canonicalizeShape({ ...previous, ...cleanedPatch });
            const delta = computeShapeRepeatDelta(beforeForDelta, afterForDelta);
            if (hasShapeRepeatDelta(delta)) {
              lastShapeActionRef.current[id] = { delta, before: beforeForDelta };
              duplicateRepeatDeltasRef.current = new Map();
            }
          }
        }
        const holeNotice =
          "hole" in cleanedPatch
            ? cleanedPatch.hole
              ? "Changed to hole — select a solid and Group to cut"
              : "Changed to solid"
            : undefined;
        commitShapes(next, selectedIds, holeNotice);
      }
    },
    [commitShapes, selectedIds],
  );

  const deleteSelected = useCallback(() => {
    if (!hasSelection) {
      setNotice("Select a shape first");
      return;
    }
    const selected = new Set(selectedIds);
    for (const id of selectedIds) {
      const shape = shapes.find((entry) => entry.id === id);
      if (shape?.patternFeature) {
        patternMemberIds(shapes, shape.patternFeature.id).forEach((memberId) => selected.add(memberId));
      }
    }
    const lockedSelected = shapes.filter((shape) => selected.has(shape.id) && shape.locked);
    const removable = shapes.filter((shape) => selected.has(shape.id) && !shape.locked);
    if (removable.length === 0) {
      setNotice(lockedSelected.length ? "Unlock the shape before deleting it" : "Select a shape first");
      return;
    }
    const remaining = shapes.filter((shape) => !selected.has(shape.id) || shape.locked);
    commitShapes(
      remaining,
      [],
      lockedSelected.length
        ? `Deleted ${removable.length} shape${removable.length === 1 ? "" : "s"} (${lockedSelected.length} locked kept)`
        : `Deleted ${removable.length} selected shape${removable.length === 1 ? "" : "s"}`,
    );
  }, [commitShapes, hasSelection, selectedIds, shapes]);

  const duplicateSelected = useCallback(() => {
    // Bake/close any open degree box first so blur doesn't re-apply rotation.
    rotationEditApiRef.current?.dismiss();
    duplicateRepeatDeltasRef.current = new Map();
    if (!hasSelection) {
      setNotice("Select a shape first");
      return;
    }
    // Keep the copy in the same place as the original (TinkerCAD-style).
    const sourceShapes = shapesRef.current.filter((shape) => selectedIdsRef.current.includes(shape.id));
    const duplicates = sourceShapes.map((shape) => createDuplicateForRepeat(shape, createLocalId(`${shape.id}-copy`)));
    commitShapes(
      [...shapesRef.current, ...duplicates],
      duplicates.map((shape) => shape.id),
      `Duplicated ${duplicates.length} shape${duplicates.length === 1 ? "" : "s"}`,
    );
  }, [commitShapes, hasSelection]);

  const duplicateAndRepeatSelected = useCallback(() => {
    // Bake/close any open degree box first so blur doesn't re-apply rotation.
    rotationEditApiRef.current?.dismiss();
    if (!hasSelection) {
      setNotice("Select a shape first");
      return;
    }

    // Workflow: duplicate in place, then apply the last transform (e.g. +10°) to the copy only.
    const sourceShapes = shapesRef.current.filter((shape) => selectedIdsRef.current.includes(shape.id));
    const nextRepeatDeltas = new Map<string, ShapeRepeatDelta>();
    const duplicates = sourceShapes.map((shape) => {
      const storedAction = lastShapeActionRef.current[shape.id];
      const delta =
        duplicateRepeatDeltasRef.current.get(shape.id) ?? storedAction?.delta ?? DEFAULT_SHAPE_REPEAT_DELTA;
      const duplicate = createDuplicateForRepeat(shape, createLocalId(`${shape.id}-repeat`));
      const repeated = hasShapeRepeatDelta(delta)
        ? applyRepeatActionToDuplicate(duplicate, delta, { incremental: true })
        : duplicate;
      nextRepeatDeltas.set(repeated.id, delta);
      if (hasShapeRepeatDelta(delta)) {
        lastShapeActionRef.current[repeated.id] = {
          delta,
          before: shape,
        };
      }
      return repeated;
    });

    duplicateRepeatDeltasRef.current = nextRepeatDeltas;
    commitShapes(
      [...shapesRef.current, ...duplicates],
      duplicates.map((shape) => shape.id),
      `Duplicated and repeated ${duplicates.length} shape${duplicates.length === 1 ? "" : "s"}`,
    );
  }, [commitShapes, hasSelection]);

  const copySelected = useCallback(async () => {
    if (!hasSelection) {
      setNotice("Select a shape first");
      return;
    }
    setClipboard(selectedShapes);
    await writeShapeClipboard(selectedShapes);
    setNotice(`Copied ${selectedShapes.length} shape${selectedShapes.length === 1 ? "" : "s"}`);
  }, [hasSelection, selectedShapes]);

  const pasteShape = useCallback(async () => {
    const sourceProjectId = projectInfoRef.current.projectId;
    const storedClipboard = await readShapeClipboard();
    const sourceClipboard = storedClipboard.length > 0 ? storedClipboard : clipboard;
    if (sourceClipboard.length === 0) {
      setNotice("PeakCAD clipboard is empty");
      return;
    }
    if (projectInfoRef.current.projectId !== sourceProjectId) {
      setNotice("Paste cancelled because the project changed");
      return;
    }
    if (serializeShapesForSync(sourceClipboard) !== serializeShapesForSync(clipboard)) {
      setClipboard(sourceClipboard);
    }
    const pasted = cloneShapesForPaste(sourceClipboard).map((shape) => ({
      ...shape,
      x: Math.min(110, shape.x + 12),
      z: Math.min(110, shape.z + 12),
    }));
    commitShapes([...shapesRef.current, ...pasted], pasted.map((shape) => shape.id), `Pasted ${pasted.length} shape${pasted.length === 1 ? "" : "s"}`);
  }, [clipboard, commitShapes]);

  const restoreHistoryEntry = useCallback(async (nextIndex: number, label: string, modifierCancelled: boolean) => {
    const entry = historyRef.current[nextIndex];
    let nextShapes = expandHistoryShapes(entry?.shapes ?? [], entry?.meshVault).map(canonicalizeShape);
    let remeshWarn = "";
    if (nextShapes.some(historyShapeNeedsRemesh)) {
      const remeshGen = remeshGenerationRef.current + 1;
      remeshGenerationRef.current = remeshGen;
      const remesh = await remeshDirtyHistoryShapes(nextShapes);
      if (remeshGen !== remeshGenerationRef.current) return;
      nextShapes = remesh.shapes;
      remeshWarn = remesh.failedNames.length
        ? ` · ${remesh.failedNames.length} mesh${remesh.failedNames.length === 1 ? "" : "es"} need rebuild`
        : "";
    }
    const nextSelection = (entry?.selectedIds ?? []).filter((id) => nextShapes.some((shape) => shape.id === id));
    const groupingMotion = groupingMotionForSceneChange(shapesRef.current, nextShapes);
    historyIndexRef.current = nextIndex;
    shapesRef.current = nextShapes;
    selectedIdsRef.current = nextSelection;
    setHistoryIndex(nextIndex);
    setShapes(nextShapes);
    setSelectedIds(nextSelection);
    if (groupingMotion) flashCadApply(groupingMotion.ids, undefined, groupingMotion.kind);
    setActiveFeatureId(null);
    setPlacementRuler((current) => {
      if (!current) return current;
      return recapturePlacementBaseline(nextShapes, nextSelection, current.baselineId);
    });
    syncProjectShapes(nextShapes);
    setNotice((modifierCancelled ? `Edge modifier cancelled · ${label}` : label) + remeshWarn);
    const needFillet = nextShapes.filter((shape) => shape.edgeTreatments?.length && !shape.cadBrep);
    if (!needFillet.length) return;
    // Restoring the fillets is part of arriving at this step, not a step of its own.
    historyWriteSuspendedRef.current += 1;
    try {
      for (const shape of needFillet) {
        await reapplyEdgeTreatmentsRef.current(shape);
      }
    } finally {
      historyWriteSuspendedRef.current -= 1;
    }
  }, [flashCadApply, syncProjectShapes]);

  const undo = useCallback(() => {
    void (async () => {
      if (projectInteractionActiveRef.current) {
        setNotice("Finish the current drag or transform before undoing");
        return;
      }
      if (circularPatternRef.current) {
        circularPatternRef.current = null;
        setCircularPattern(null);
        setNotice("Circular pattern cancelled");
        return;
      }
      if (linearPatternRef.current) {
        linearPatternRef.current = null;
        setLinearPattern(null);
        setNotice("Linear pattern cancelled");
        return;
      }
      const pushPullWasActive = Boolean(pushPullSessionRef.current);
      const modifierCancelled = invalidateCadModifierSession();
      const currentIndex = historyIndexRef.current;
      if (currentIndex <= 0) {
        setNotice(modifierCancelled ? (pushPullWasActive ? "Push Pull cancelled" : "Edge modifier cancelled") : "Nothing to undo");
        return;
      }
      setHistoryBrowse(null);
      await restoreHistoryEntry(currentIndex - 1, "Undo", modifierCancelled);
    })();
  }, [invalidateCadModifierSession, restoreHistoryEntry]);

  const redo = useCallback(() => {
    void (async () => {
      if (projectInteractionActiveRef.current) {
        setNotice("Finish the current drag or transform before redoing");
        return;
      }
      if (circularPatternRef.current) {
        circularPatternRef.current = null;
        setCircularPattern(null);
      }
      if (linearPatternRef.current) {
        linearPatternRef.current = null;
        setLinearPattern(null);
      }
      const currentIndex = historyIndexRef.current;
      if (currentIndex >= historyRef.current.length - 1) {
        setNotice("Nothing to redo");
        return;
      }
      setHistoryBrowse(null);
      const modifierCancelled = invalidateCadModifierSession();
      await restoreHistoryEntry(currentIndex + 1, "Redo", modifierCancelled);
    })();
  }, [invalidateCadModifierSession, restoreHistoryEntry]);

  const toggleAlignMode = useCallback(() => {
    if (selectedShapes.length < 2) {
      setNotice("Select at least two shapes to align");
      return;
    }
    setAlignMode((active) => {
      const next = !active;
      setAlignPreview(null);
      if (next) {
        clearEditorToolSessions("align");
      }
      setNotice(next ? "Align: choose a dot, or click a selected shape to anchor it" : "Align cancelled");
      return next;
    });
  }, [clearEditorToolSessions, selectedShapes.length]);

  const chooseAlignAnchor = useCallback(
    (id: string) => {
      if (!selectedIds.includes(id)) {
        return;
      }
      const shape = shapes.find((entry) => entry.id === id);
      const lockedAnchor = selectedShapes.find((entry) => entry.locked);
      if (lockedAnchor && lockedAnchor.id !== id) {
        setNotice(`Align anchor: ${lockedAnchor.name} (locked)`);
        return;
      }
      setAlignAnchorId(id);
      setAlignPreview(null);
      setNotice(shape ? `Align anchor: ${shape.name}` : "Align anchor set");
    },
    [selectedIds, selectedShapes, shapes],
  );

  const alignSelectionTo = useCallback(
    (axis: AlignAxis, target: AlignTarget) => {
      if (selectedShapes.length < 2) {
        setNotice("Select at least two shapes to align");
        return;
      }

      const { nextShapes, moved } = alignedShapesForSelection(shapes, selectedIds, selectedShapes, effectiveAlignAnchorId, axis, target);
      setAlignPreview(null);

      if (moved === 0) {
        setNotice("Already aligned");
        return;
      }

      commitShapes(nextShapes, selectedIds, `Aligned ${moved} shape${moved === 1 ? "" : "s"} ${alignmentLabel(axis, target)}`);
    },
    [commitShapes, effectiveAlignAnchorId, selectedIds, selectedShapes, shapes],
  );

  const previewAlignSelection = useCallback((axis: AlignAxis, target: AlignTarget) => {
    setAlignPreview({ axis, target });
  }, []);

  const clearAlignPreview = useCallback(() => {
    setAlignPreview(null);
  }, []);

  const toggleMirrorMode = useCallback(() => {
    if (!hasSelection) {
      setNotice("Select a shape first");
      return;
    }
    setMirrorMode((active) => {
      const next = !active;
      setMirrorPreviewAxis(null);
      if (next) {
        clearEditorToolSessions("mirror");
      }
      setNotice(next ? "Mirror: choose an axis arrow" : "Mirror cancelled");
      return next;
    });
  }, [clearEditorToolSessions, hasSelection]);

  const mirrorSelectionAcross = useCallback(
    (axis: AlignAxis) => {
      if (!hasSelection) {
        setNotice("Select a shape first");
        return;
      }
      const { nextShapes, moved } = mirroredShapesForSelection(shapes, selectedIds, selectedShapes, axis);
      setMirrorPreviewAxis(null);
      if (moved === 0) {
        setNotice("Nothing to mirror");
        return;
      }
      commitShapes(nextShapes, selectedIds, `Mirrored ${moved} shape${moved === 1 ? "" : "s"} ${mirrorAxisLabel(axis)}`);
    },
    [commitShapes, hasSelection, selectedIds, selectedShapes, shapes],
  );

  const previewMirrorSelection = useCallback((axis: AlignAxis) => {
    setMirrorPreviewAxis(axis);
  }, []);

  const clearMirrorPreview = useCallback(() => {
    setMirrorPreviewAxis(null);
  }, []);

  const rebuildCircularPatternPreview = useCallback(
    (session: CircularPatternSession, sourceShapes: WorkplaneShape[]): WorkplaneShape[] | null => {
      const sourceIds = new Set(session.sourceIds);
      const sources = sourceShapes.filter((shape) => sourceIds.has(shape.id) && !shape.locked);
      if (!session.center || !sources.length || !(session.radius > 0)) return null;
      return circularPatternInstances(sources, session.center, session.count, {
        radius: session.radius,
        rotationOffset: session.rotation,
        createId: circularPatternCopyId,
      });
    },
    [],
  );

  const cancelCircularPattern = useCallback(() => {
    circularPatternRef.current = null;
    setCircularPattern(null);
    setNotice("Circular pattern cancelled");
  }, []);

  const toggleCircularPattern = useCallback(() => {
    if (circularPattern) {
      cancelCircularPattern();
      return;
    }
    const patterned = selectedShapes.find((shape) => shape.patternFeature?.kind === "circular");
    if (patterned?.patternFeature?.circular) {
      const source = findPatternSource(shapesRef.current, patterned) ?? patterned;
      const circular = source.patternFeature?.circular;
      if (circular) {
        clearEditorToolSessions("circular");
        setCircularPattern({
          sourceIds: [source.id],
          pivotId: null,
          center: circular.center,
          radius: circular.radius,
          count: circular.count,
          rotation: clampCircularPatternRotation(circular.rotationOffset),
          preview: null,
          featureId: source.patternFeature?.id,
          editing: true,
        });
        setNotice("Edit circular pattern, then Update");
        return;
      }
    }
    const unlockedSelected = selectedShapes.filter((shape) => !shape.locked && !isConstructionShape(shape));
    if (!unlockedSelected.length) {
      setNotice("Select at least one unlocked shape to pattern");
      return;
    }
    clearEditorToolSessions("circular");
    const center = defaultCircularPatternCenter(unlockedSelected);
    const radius = circularPatternSuggestedRadius(unlockedSelected, center);
    const session: CircularPatternSession = {
      sourceIds: unlockedSelected.map((shape) => shape.id),
      pivotId: null,
      center,
      radius,
      count: CIRCULAR_PATTERN_DEFAULT_COUNT,
      rotation: 0,
      preview: null,
    };
    session.preview = rebuildCircularPatternPreview(session, shapesRef.current);
    setCircularPattern(session);
    setNotice("Circular pattern. Click the workplane to move the center.");
  }, [cancelCircularPattern, circularPattern, clearEditorToolSessions, rebuildCircularPatternPreview, selectedShapes]);

  const setCircularPatternCenter = useCallback(
    (center: CircularPatternCenter) => {
      setCircularPattern((current) => {
        if (!current) return current;
        const sources = shapesRef.current.filter((shape) => current.sourceIds.includes(shape.id) && !shape.locked);
        const radius = circularPatternSuggestedRadius(sources, center);
        const next: CircularPatternSession = {
          ...current,
          pivotId: null,
          center,
          radius,
        };
        return { ...next, preview: rebuildCircularPatternPreview(next, shapesRef.current) };
      });
    },
    [rebuildCircularPatternPreview],
  );

  const patchCircularPatternCount = useCallback(
    (count: number) => {
      setCircularPattern((current) => {
        if (!current) return current;
        const next: CircularPatternSession = { ...current, count: clampCircularPatternCount(count) };
        return { ...next, preview: rebuildCircularPatternPreview(next, shapesRef.current) };
      });
    },
    [rebuildCircularPatternPreview],
  );

  const patchCircularPatternRadius = useCallback(
    (radius: number) => {
      setCircularPattern((current) => {
        if (!current) return current;
        const next: CircularPatternSession = { ...current, radius: clampCircularPatternRadius(radius) };
        return { ...next, preview: rebuildCircularPatternPreview(next, shapesRef.current) };
      });
    },
    [rebuildCircularPatternPreview],
  );

  const patchCircularPatternRotation = useCallback(
    (rotation: CircularPatternRotationStep) => {
      setCircularPattern((current) => {
        if (!current) return current;
        const next: CircularPatternSession = { ...current, rotation: clampCircularPatternRotation(rotation) };
        return { ...next, preview: rebuildCircularPatternPreview(next, shapesRef.current) };
      });
    },
    [rebuildCircularPatternPreview],
  );

  const applyCircularPattern = useCallback(() => {
    if (!circularPattern?.center || !circularPattern.preview?.length) return;
    const sourceIds = new Set(circularPattern.sourceIds);
    const sources = shapes.filter((shape) => sourceIds.has(shape.id));
    const params = {
      count: circularPattern.count,
      center: circularPattern.center,
      radius: circularPattern.radius,
      rotationOffset: circularPattern.rotation,
    };
    let tagged: WorkplaneShape[] = [];
    for (const source of sources) {
      const featureId = circularPattern.featureId ?? patternFeatureId();
      const instances = circularPattern.preview.filter((shape) => (
        shape.id === source.id || shape.id.startsWith(`${source.id}__circular_pattern__`)
      ));
      tagged = tagged.concat(tagCircularPatternInstances(instances.length ? instances : [source], source, params, featureId));
    }
    const nextShapes = circularPattern.editing && circularPattern.featureId
      ? replacePatternFeature(shapes, tagged, circularPattern.featureId)
      : shapes.filter((shape) => !sourceIds.has(shape.id) && shape.patternFeature?.id !== circularPattern.featureId).concat(tagged);
    const wouldClamp = circularPatternWouldClamp(
      circularPattern.center,
      circularPattern.radius,
      circularPattern.count,
    );
    commitShapes(nextShapes, tagged.map((shape) => shape.id), circularPattern.editing ? `Circular pattern updated ×${circularPattern.count}` : `Circular pattern ×${circularPattern.count}`);
    setCircularPattern(null);
    if (wouldClamp) {
      setNotice("Circular pattern clamped some positions to ±110 mm");
    }
  }, [circularPattern, commitShapes, shapes]);

  const rebuildLinearPatternPreview = useCallback((session: LinearPatternSession, sourceShapes: WorkplaneShape[]) => {
    const sourceIds = new Set(session.sourceIds);
    const sources = sourceShapes.filter((shape) => sourceIds.has(shape.id) && !shape.locked);
    if (!sources.length) return null;
    return linearPatternInstances(sources, session, session);
  }, []);

  const cancelLinearPattern = useCallback(() => {
    linearPatternRef.current = null;
    setLinearPattern(null);
    setNotice("Linear pattern cancelled");
  }, []);

  const toggleLinearPattern = useCallback(() => {
    if (linearPattern) {
      cancelLinearPattern();
      return;
    }
    const patterned = selectedShapes.find((shape) => shape.patternFeature?.kind === "linear");
    if (patterned?.patternFeature) {
      const source = findPatternSource(shapesRef.current, patterned) ?? patterned;
      const linear = source.patternFeature?.linear;
      if (linear) {
        clearEditorToolSessions("linear");
        const session: LinearPatternSession = {
          sourceIds: [source.id],
          countX: linear.countX,
          countZ: linear.countZ ?? 1,
          countY: linear.countY ?? 1,
          spacingX: linear.spacingX,
          spacingZ: linear.spacingZ,
          spacingY: linear.spacingY ?? linearPatternSuggestedSpacing([source], "y"),
          preview: null,
          featureId: source.patternFeature?.id,
          editing: true,
        };
        setLinearPattern({ ...session, preview: rebuildLinearPatternPreview(session, shapesRef.current) });
        setNotice("Edit linear pattern, then Update");
        return;
      }
    }
    const unlockedSelected = selectedShapes.filter((shape) => !shape.locked && !isConstructionShape(shape));
    if (!unlockedSelected.length) {
      setNotice("Select at least one unlocked shape for a linear pattern");
      return;
    }
    clearEditorToolSessions("linear");
    const session: LinearPatternSession = {
      sourceIds: unlockedSelected.map((shape) => shape.id),
      countX: LINEAR_PATTERN_DEFAULT_COUNT_X,
      countZ: LINEAR_PATTERN_DEFAULT_COUNT_Z,
      countY: LINEAR_PATTERN_DEFAULT_COUNT_Y,
      spacingX: linearPatternSuggestedSpacing(unlockedSelected, "x"),
      spacingZ: linearPatternSuggestedSpacing(unlockedSelected, "z"),
      spacingY: linearPatternSuggestedSpacing(unlockedSelected, "y"),
      preview: null,
    };
    setLinearPattern({ ...session, preview: rebuildLinearPatternPreview(session, shapesRef.current) });
    setNotice("Linear pattern: set counts and spacing, then Apply");
  }, [cancelLinearPattern, clearEditorToolSessions, linearPattern, rebuildLinearPatternPreview, selectedShapes]);

  const patchLinearPattern = useCallback((patch: Partial<LinearPatternSession>) => {
    setLinearPattern((current) => {
      if (!current) return current;
      const next: LinearPatternSession = {
        ...current,
        ...patch,
        countX: patch.countX !== undefined ? clampLinearPatternCount(patch.countX, LINEAR_PATTERN_DEFAULT_COUNT_X) : current.countX,
        countZ: patch.countZ !== undefined ? clampLinearPatternCount(patch.countZ, LINEAR_PATTERN_DEFAULT_COUNT_Z) : current.countZ,
        countY: patch.countY !== undefined ? clampLinearPatternCount(patch.countY, LINEAR_PATTERN_DEFAULT_COUNT_Y) : current.countY,
        spacingX: patch.spacingX !== undefined ? clampLinearPatternSpacing(patch.spacingX) : current.spacingX,
        spacingZ: patch.spacingZ !== undefined ? clampLinearPatternSpacing(patch.spacingZ) : current.spacingZ,
        spacingY: patch.spacingY !== undefined ? clampLinearPatternSpacing(patch.spacingY) : current.spacingY,
      };
      return { ...next, preview: rebuildLinearPatternPreview(next, shapesRef.current) };
    });
  }, [rebuildLinearPatternPreview]);

  const applyLinearPattern = useCallback(() => {
    if (!linearPattern?.preview?.length) return;
    const sourceIds = new Set(linearPattern.sourceIds);
    const sources = shapes.filter((shape) => sourceIds.has(shape.id));
    const params = {
      countX: linearPattern.countX,
      countZ: linearPattern.countZ,
      countY: linearPattern.countY,
      spacingX: linearPattern.spacingX,
      spacingZ: linearPattern.spacingZ,
      spacingY: linearPattern.spacingY,
    };
    let tagged: WorkplaneShape[] = [];
    for (const source of sources) {
      const featureId = linearPattern.featureId ?? patternFeatureId();
      const instances = linearPattern.preview.filter((shape) => (
        shape.id === source.id || shape.id.startsWith(`${source.id}__linear_pattern__`)
      ));
      tagged = tagged.concat(tagLinearPatternInstances(instances.length ? instances : [source], source, params, featureId));
    }
    const nextShapes = linearPattern.editing && linearPattern.featureId
      ? replacePatternFeature(shapes, tagged, linearPattern.featureId)
      : shapes.filter((shape) => !sourceIds.has(shape.id)).concat(tagged);
    const wouldClamp = linearPatternWouldClamp(sources, linearPattern, linearPattern);
    commitShapes(nextShapes, tagged.map((shape) => shape.id), linearPattern.editing ? `Linear pattern updated ×${tagged.length}` : `Linear pattern ×${tagged.length}`);
    setLinearPattern(null);
    if (wouldClamp) {
      setNotice("Linear pattern clamped some positions to ±110 mm");
    }
  }, [commitShapes, linearPattern, shapes]);

  useEffect(() => {
    if (!linearPattern) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelLinearPattern();
      } else if (event.key === "Enter" && linearPattern.preview?.length) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest("input, select, textarea, button, [contenteditable='true']")) return;
        event.preventDefault();
        applyLinearPattern();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyLinearPattern, cancelLinearPattern, linearPattern]);

  const linearPatternGeometryKey = useMemo(() => {
    if (!linearPattern) return "";
    return linearPattern.sourceIds
      .map((id) => {
        const shape = shapes.find((entry) => entry.id === id);
        if (!shape) return `${id}:gone`;
        return [
          id,
          shape.x,
          shape.z,
          shape.elevation ?? 0,
          shape.width ?? shape.size ?? 0,
          shape.depth ?? shape.size ?? 0,
          shape.height,
          shape.size ?? 0,
          shape.rotation ?? 0,
          shape.rotationX ?? 0,
          shape.rotationZ ?? 0,
        ].join(":");
      })
      .join("|");
  }, [linearPattern, shapes]);

  useEffect(() => {
    if (!linearPattern) return;
    const sourceIds = new Set(linearPattern.sourceIds);
    const sources = shapesRef.current.filter((shape) => sourceIds.has(shape.id));
    if (sources.length !== linearPattern.sourceIds.length || sources.some((shape) => shape.locked)) {
      setLinearPattern(null);
      setNotice("Linear pattern cancelled");
      return;
    }
    setLinearPattern((current) => {
      if (!current) return current;
      const preview = rebuildLinearPatternPreview(current, shapesRef.current);
      const samePreview =
        Boolean(current.preview && preview)
        && current.preview!.length === preview!.length
        && current.preview!.every((shape, index) => {
          const other = preview![index];
          return (
            shape.id === other.id
            && shape.x === other.x
            && shape.z === other.z
            && (shape.elevation ?? 0) === (other.elevation ?? 0)
          );
        });
      if (samePreview) return current;
      return { ...current, preview };
    });
  }, [
    linearPattern?.countX,
    linearPattern?.countY,
    linearPattern?.countZ,
    linearPattern?.sourceIds,
    linearPattern?.spacingX,
    linearPattern?.spacingY,
    linearPattern?.spacingZ,
    linearPatternGeometryKey,
    rebuildLinearPatternPreview,
  ]);

  const circularPatternGeometryKey = useMemo(() => {
    if (!circularPattern) return "";
    const ids = [...circularPattern.sourceIds];
    if (circularPattern.pivotId) ids.push(circularPattern.pivotId);
    return ids
      .map((id) => {
        const shape = shapes.find((entry) => entry.id === id);
        if (!shape) return `${id}:gone`;
        return [
          id,
          shape.x,
          shape.z,
          shape.elevation ?? 0,
          shape.width ?? shape.size ?? 0,
          shape.depth ?? shape.size ?? 0,
          shape.height,
          shape.size ?? 0,
          shape.radius ?? "",
          shape.rotation ?? 0,
          shape.rotationX ?? 0,
          shape.rotationZ ?? 0,
          shape.sides ?? "",
          shape.topRadius ?? "",
          shape.baseRadius ?? "",
        ].join(":");
      })
      .join("|");
  }, [circularPattern, shapes]);

  useEffect(() => {
    if (!circularPattern) return;
    const sourceIds = new Set(circularPattern.sourceIds);
    const sources = shapesRef.current.filter((shape) => sourceIds.has(shape.id));
    if (sources.length !== circularPattern.sourceIds.length || sources.some((shape) => shape.locked)) {
      setCircularPattern(null);
      setNotice("Circular pattern cancelled");
      return;
    }

    let center = circularPattern.center;
    if (!center) return;

    setCircularPattern((current) => {
      if (!current) return current;
      const next: CircularPatternSession = { ...current, center };
      const preview = rebuildCircularPatternPreview(next, shapesRef.current);
      const sameCenter =
        current.center
        && Math.abs(current.center.x - center!.x) < 1e-9
        && Math.abs(current.center.z - center!.z) < 1e-9;
      const samePreview =
        Boolean(current.preview && preview)
        && current.preview!.length === preview!.length
        && current.preview!.every((shape, index) => {
          const other = preview![index];
          return (
            shape.id === other.id
            && shape.x === other.x
            && shape.z === other.z
            && (shape.elevation ?? 0) === (other.elevation ?? 0)
            && (shape.width ?? shape.size) === (other.width ?? other.size)
            && (shape.depth ?? shape.size) === (other.depth ?? other.size)
            && shape.height === other.height
            && (shape.size ?? 0) === (other.size ?? 0)
            && (shape.radius ?? 0) === (other.radius ?? 0)
            && (shape.rotation ?? 0) === (other.rotation ?? 0)
            && (shape.rotationX ?? 0) === (other.rotationX ?? 0)
            && (shape.rotationZ ?? 0) === (other.rotationZ ?? 0)
            && (shape.sides ?? 0) === (other.sides ?? 0)
          );
        });
      if (sameCenter && samePreview) return current;
      // Keep center object identity when values are unchanged so viewport effects stay quiet.
      return {
        ...next,
        center: sameCenter ? current.center : center,
        preview,
      };
    });
  }, [
    circularPattern?.count,
    circularPattern?.radius,
    circularPattern?.rotation,
    circularPattern?.sourceIds,
    circularPatternGeometryKey,
    rebuildCircularPatternPreview,
  ]);

  useEffect(() => {
    if (!circularPattern) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelCircularPattern();
      } else if (event.key === "Enter" && circularPattern.center && circularPattern.preview?.length) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest("input, select, textarea, button, [contenteditable='true']")) return;
        event.preventDefault();
        applyCircularPattern();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyCircularPattern, cancelCircularPattern, circularPattern]);

  useEffect(() => {
    if (!alignMode && !mirrorMode && !faceSnap && !layFlat && !dropSurface) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (alignMode) {
        setAlignMode(false);
        setAlignPreview(null);
        setNotice("Align cancelled");
      }
      if (mirrorMode) {
        setMirrorMode(false);
        setMirrorPreviewAxis(null);
        setNotice("Mirror cancelled");
      }
      if (faceSnap) {
        setFaceSnap(null);
        setNotice("Snap cancelled");
      }
      if (layFlat) {
        setLayFlat(false);
        setNotice("Lay flat cancelled");
      }
      if (dropSurface) {
        setDropSurface(false);
        setNotice("Drop cancelled");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [alignMode, dropSurface, faceSnap, layFlat, mirrorMode]);

  const postToCadModifierWorker = (request: CadModifierWorkerPayload, requestId: number, transfer: Transferable[] = []) => {
    const worker = cadModifierWorkerRef.current ?? cadModifierWorkerRestartRef.current();
    if (!worker) return false;
    try {
      worker.postMessage({ ...request, requestId } as CadModifierWorkerRequest, transfer);
      return true;
    } catch {
      // Do not retry with the same transfer list — ArrayBuffers are neutered after a failed postMessage.
      worker.terminate();
      if (cadModifierWorkerRef.current === worker) cadModifierWorkerRef.current = null;
      return false;
    }
  };

  const sendCadModifierRequest = (request: CadModifierWorkerPayload, requestId: number, transfer: Transferable[] = []) => {
    const shellActive = Boolean(shellSessionRef.current);
    if (!shellActive && nativeCadModifierCanHandle(request, cadModifierNativeLiveRef.current)) {
      void requestNativeCadModifier(request, requestId, cadModifierRequestTimeoutMs()).then((reply) => {
        if (!reply || reply.fallback) {
          if (request.type === "prepare") cadModifierNativeLiveRef.current = false;
          if (!postToCadModifierWorker(request, requestId, transfer)) {
            cadModifierDispatchRef.current({
              type: "error",
              requestId,
              message: cadModifierWorkerFailureMessage(),
              resetSession: true,
            });
          }
          return;
        }
        if (request.type === "prepare") cadModifierNativeLiveRef.current = true;
        if (request.type === "dispose") cadModifierNativeLiveRef.current = false;
        cadModifierDispatchRef.current(mapNativeCadModifierReply(
          reply,
          requestId,
          request.type === "pushPull" ? "pushPull" : "fillet",
        ));
      }).catch(() => {
        cadModifierNativeLiveRef.current = false;
        if (!postToCadModifierWorker(request, requestId, transfer)) {
          cadModifierDispatchRef.current({
            type: "error",
            requestId,
            message: cadModifierWorkerFailureMessage(),
            resetSession: true,
          });
        }
      });
      return true;
    }
    return postToCadModifierWorker(request, requestId, transfer);
  };

  const postCadModifierRequest = useCallback((request: CadModifierWorkerPayload, transfer: Transferable[] = []) => {
    const requestId = cadModifierRequestRef.current + 1;
    cadModifierRequestRef.current = requestId;
    if (!sendCadModifierRequest(request, requestId, transfer)) return null;
    return requestId;
  }, []);

  const postCadModifierRequestAsync = useCallback((request: CadModifierWorkerPayload, transfer: Transferable[] = [], timeoutMs = 20000) => {
    const requestId = cadModifierRequestRef.current + 1;
    cadModifierRequestRef.current = requestId;
    return new Promise<CadModifierWorkerResponse>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (!cadModifierPendingRef.current.has(requestId)) return;
        const pendingRequests = [...cadModifierPendingRef.current.values()];
        cadModifierPendingRef.current.clear();
        pendingRequests.forEach((pending) => window.clearTimeout(pending.timer));
        cadModifierWorkerRef.current?.terminate();
        cadModifierWorkerRef.current = null;
        cadModifierNativeLiveRef.current = false;
        const invalidationId = cadModifierRequestRef.current + 1;
        cadModifierRequestRef.current = invalidationId;
        cadModifierLatestPreviewRef.current = invalidationId;
        cadModifierPrepareRef.current = invalidationId;
        cadModifierBaseShapeRef.current = null;
        cadModifierBaseFingerprintRef.current = "";
        cadModifierSourcePartsRef.current = [];
        cadModifierEditBeforeRef.current = null;
        edgePreviewShapeRef.current = null;
        edgePreviewSmoothRef.current = false;
        edgeRefineRequestRef.current = null;
        setEdgeModifier(null);
        cadModifierWorkerRestartRef.current();
        pendingRequests.forEach((pending) => pending.reject(new Error("Timed out waiting for the CAD worker; the worker was restarted")));
      }, timeoutMs);
      cadModifierPendingRef.current.set(requestId, { resolve, reject, timer });
      if (!sendCadModifierRequest(request, requestId, transfer)) {
        window.clearTimeout(timer);
        cadModifierPendingRef.current.delete(requestId);
        reject(new Error("The CAD worker is not ready"));
      }
    });
  }, []);

  const cancelEdgeModifier = useCallback(() => {
    invalidateCadModifierSession();
    setNotice("Edge modifier cancelled");
  }, [invalidateCadModifierSession]);

  const startEdgeModifier = useCallback(async (kind: CadModifierKind) => {
    if (selectedShapes.length !== 1 || !selectedShape || selectedShape.locked || selectedShape.hole) {
      setNotice(`Select one unlocked solid to ${kind}`);
      return;
    }
    invalidateCadModifierSession();
    const editEntry = lastEditableEdgeTreatment(selectedShape, kind);
    const workingShape = editEntry ? restoreShapeBeforeEdgeTreatment(selectedShape, editEntry) : selectedShape;
    cadModifierEditBeforeRef.current = editEntry ? workingShape : null;
    const appliedEdgeTreatmentCount = edgeTreatmentFeatureCount(workingShape);
    const hasAppliedEdgeTreatment = Boolean(workingShape.importedMesh && workingShape.edgeTreatments?.length);
    const sourceParts = edgeTreatmentSourceParts(workingShape, {
      keepResultMesh: hasAppliedEdgeTreatment,
      ignoreThreads: true,
    });
    const partInputs: Array<{ shape: WorkplaneShape; mesh?: MeshData; brep?: string; brepTransform?: number[]; primitive?: CadModifierPrimitivePart }> = sourceParts.map((shape) => {
      const frame = shape.cadBrepFrame;
      const preserveNeedsRetessellation = preservesEdgeTreatmentSize(shape) && Boolean(frame) && (
        Math.abs(shapeWidth(shape) - (frame?.width ?? shapeWidth(shape))) > 1e-6 ||
        Math.abs(shapeDepth(shape) - (frame?.depth ?? shapeDepth(shape))) > 1e-6 ||
        Math.abs(shape.height - (frame?.height ?? shape.height)) > 1e-6
      );
      const primitive = cadModifierPrimitiveForShape(shape);
      if (primitive) return { shape, primitive };
      return shape.cadBrep && frame && !preserveNeedsRetessellation
        ? { shape, brep: shape.cadBrep, brepTransform: cadBrepTransformForShape(shape) }
        : { shape, mesh: meshForShape(shape) };
    });
    const triangleCount = partInputs.reduce((total, part) => total + (part.mesh?.faces.length ?? 0), 0);
    if (triangleCount === 0 && partInputs.every((part) => !part.brep && !part.primitive)) {
      setNotice("The selected object has no printable surface");
      return;
    }
    if (triangleCount > 180_000) {
      setNotice("This mesh is too dense for interactive edge treatment. Simplify it below 180,000 triangles first.");
      return;
    }
    const defaultAmount = Math.max(MIN_EDGE_MODIFIER_AMOUNT, Math.min(1, shapeWidth(workingShape) / 6, shapeDepth(workingShape) / 6, workingShape.height / 6));
    const editRecipe = editEntry?.feature;
    cadModifierBaseShapeRef.current = selectedShape;
    cadModifierBaseFingerprintRef.current = projectShapesFingerprint([selectedShape]);
    cadModifierSourcePartsRef.current = sourceParts;
    clearEditorToolSessions("fillet");
    flushSync(() => {
      setEdgeModifier({
        kind,
        edges: [],
        selectedEdgeIds: [],
        amount: editRecipe?.amount ?? defaultAmount,
        sharpAngle: editRecipe?.sharpAngle ?? 12,
        chamferAngle: editRecipe?.chamferAngle ?? 45,
        quality: modifierPreviewQualityForDisplay(workspaceSettingsRef.current.displayQuality),
        tangentChain: true,
        preserveEdgeSize: selectedShape.edgeResizeMode === "preserve",
        busy: true,
        prepared: false,
        error: null,
        preview: null,
        componentPreviews: [],
        editRecipe,
      });
      setNotice(editRecipe
        ? `Editing existing ${kind}`
        : containsHelicalThreadSolid(workingShape)
          ? `Preparing ${kind} without thread geometry`
          : `Preparing ${kind} edges in the CAD worker`);
    });
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    const parts: CadModifierMeshPart[] = partInputs.map((part) => {
      if (part.brep) return { brep: part.brep, brepTransform: part.brepTransform, hole: Boolean(part.shape.hole) };
      if (part.primitive) return { primitive: part.primitive, hole: Boolean(part.shape.hole) };
      return { ...meshDataToCadTransfer(part.mesh as MeshData), hole: Boolean(part.shape.hole) };
    });
    const prepareRequestId = postCadModifierRequest({
      type: "prepare",
      parts,
      sharpAngle: 12,
      suppressTreatmentDetailEdges: appliedEdgeTreatmentCount > 0,
    }, parts.flatMap((part) => part.positions && part.indices ? [part.positions.buffer, part.indices.buffer] : []));
    if (prepareRequestId === null) {
      // The edge modifier panel renders this same error — skip the redundant toast.
      const message = cadModifierWorkerFailureMessage();
      setEdgeModifier((current) => current ? { ...current, busy: false, prepared: false, error: message } : current);
      return;
    }
    cadModifierPrepareRef.current = prepareRequestId;
    armCadModifierWatchdog(prepareRequestId, "prepare");
  }, [armCadModifierWatchdog, clearEditorToolSessions, invalidateCadModifierSession, postCadModifierRequest, selectedShape, selectedShapes.length]);

  const startShell = useCallback(() => {
    if (selectedShapes.length !== 1 || !selectedShape || selectedShape.locked || selectedShape.hole) {
      setNotice("Select one unlocked solid to hollow");
      return;
    }
    invalidateCadModifierSession();
    const sourceParts = edgeTreatmentSourceParts(selectedShape);
    const partInputs: Array<{ shape: WorkplaneShape; mesh?: MeshData; brep?: string; brepTransform?: number[]; primitive?: CadModifierPrimitivePart }> = sourceParts.map((shape) => {
      const frame = shape.cadBrepFrame;
      const primitive = cadModifierPrimitiveForShape(shape);
      if (primitive) return { shape, primitive };
      return shape.cadBrep && frame
        ? { shape, brep: shape.cadBrep, brepTransform: cadBrepTransformForShape(shape) }
        : { shape, mesh: meshForShape(shape) };
    });
    const triangleCount = partInputs.reduce((total, part) => total + (part.mesh?.faces.length ?? 0), 0);
    if (triangleCount === 0 && partInputs.every((part) => !part.brep && !part.primitive)) {
      setNotice("The selected object has no printable surface");
      return;
    }
    if (triangleCount > 180_000) {
      setNotice("This mesh is too dense to hollow. Simplify it below 180,000 triangles first.");
      return;
    }
    const maxWall = shellMaxThickness(
      { width: shapeWidth(selectedShape), depth: shapeDepth(selectedShape), height: selectedShape.height },
      ["top"],
    );
    cadModifierBaseShapeRef.current = selectedShape;
    cadModifierBaseFingerprintRef.current = projectShapesFingerprint([selectedShape]);
    cadModifierSourcePartsRef.current = sourceParts;
    clearEditorToolSessions("fillet");
    const session = {
      thickness: Math.min(2, maxWall),
      corners: "sharp" as const,
      cornerRadius: Math.min(2, maxWall),
      openings: ["top"] as Array<"top" | "bottom" | "front" | "back" | "left" | "right">,
      busy: true,
      prepared: false,
      error: null,
      preview: null,
    };
    shellSessionRef.current = session;
    setShellSession(session);
    setNotice("Preparing hollow in the CAD worker");
    const parts: CadModifierMeshPart[] = partInputs.map((part) => {
      if (part.brep) return { brep: part.brep, brepTransform: part.brepTransform, hole: Boolean(part.shape.hole) };
      if (part.primitive) return { primitive: part.primitive, hole: Boolean(part.shape.hole) };
      return { ...meshDataToCadTransfer(part.mesh as MeshData), hole: Boolean(part.shape.hole) };
    });
    const prepareRequestId = postCadModifierRequest({
      type: "prepare",
      parts,
      sharpAngle: 12,
    }, parts.flatMap((part) => part.positions && part.indices ? [part.positions.buffer, part.indices.buffer] : []));
    if (prepareRequestId === null) {
      const message = cadModifierWorkerFailureMessage();
      setShellSession((current) => current ? { ...current, busy: false, prepared: false, error: message } : current);
      return;
    }
    cadModifierPrepareRef.current = prepareRequestId;
    armCadModifierWatchdog(prepareRequestId, "prepare");
  }, [armCadModifierWatchdog, clearEditorToolSessions, invalidateCadModifierSession, postCadModifierRequest, selectedShape, selectedShapes.length]);

  const startPushPull = useCallback(() => {
    if (selectedShapes.length !== 1 || !selectedShape || selectedShape.locked || selectedShape.hole) {
      setNotice("Select one unlocked solid to Push Pull");
      return;
    }
    const sourceParts = pushPullSourceParts(selectedShape);
    const hasCad = sourceParts.some((part) => Boolean(cadModifierPrimitiveForShape(part) || part.cadBrep));
    if (!hasCad) {
      setNotice("Push Pull needs an exact CAD body. Group CAD parts first.");
      return;
    }
    invalidateCadModifierSession();
    const partInputs: Array<{ shape: WorkplaneShape; mesh?: MeshData; brep?: string; brepTransform?: number[]; primitive?: CadModifierPrimitivePart }> = sourceParts.map((shape) => {
      const frame = shape.cadBrepFrame;
      const primitive = cadModifierPrimitiveForShape(shape);
      if (primitive) return { shape, primitive };
      return shape.cadBrep && frame
        ? { shape, brep: shape.cadBrep, brepTransform: cadBrepTransformForShape(shape) }
        : { shape, mesh: meshForShape(shape) };
    });
    const triangleCount = partInputs.reduce((total, part) => total + (part.mesh?.faces.length ?? 0), 0);
    if (triangleCount === 0 && partInputs.every((part) => !part.brep && !part.primitive)) {
      setNotice("The selected object has no printable surface");
      return;
    }
    cadModifierBaseShapeRef.current = selectedShape;
    cadModifierBaseFingerprintRef.current = projectShapesFingerprint([selectedShape]);
    cadModifierSourcePartsRef.current = sourceParts;
    clearEditorToolSessions("fillet");
    const session = {
      faces: [] as CadPlanarFace[],
      selectedFaceId: null as number | null,
      hoverFaceId: null as number | null,
      distance: 0,
      dragging: false,
      settling: false,
      ghostOpacity: 1,
      busy: true,
      prepared: false,
      error: null as string | null,
      preview: null as WorkplaneShape | null,
    };
    pushPullSessionRef.current = session;
    setPushPullSession(session);
    setNotice("Drag a flat face");
    const parts: CadModifierMeshPart[] = partInputs.map((part) => {
      if (part.brep) return { brep: part.brep, brepTransform: part.brepTransform, hole: Boolean(part.shape.hole) };
      if (part.primitive) return { primitive: part.primitive, hole: Boolean(part.shape.hole) };
      return { ...meshDataToCadTransfer(part.mesh as MeshData), hole: Boolean(part.shape.hole) };
    });
    const prepareRequestId = postCadModifierRequest({
      type: "prepare",
      parts,
      sharpAngle: 12,
    }, parts.flatMap((part) => part.positions && part.indices ? [part.positions.buffer, part.indices.buffer] : []));
    if (prepareRequestId === null) {
      const message = cadModifierWorkerFailureMessage();
      setPushPullSession((current) => current ? { ...current, busy: false, prepared: false, error: message } : current);
      return;
    }
    cadModifierPrepareRef.current = prepareRequestId;
    armCadModifierWatchdog(prepareRequestId, "prepare");
  }, [armCadModifierWatchdog, clearEditorToolSessions, invalidateCadModifierSession, postCadModifierRequest, selectedShape, selectedShapes.length]);

  const prepareCadModifierForMcp = useCallback(async (shape: WorkplaneShape, sharpAngle: number) => {
    if (shape.locked || shape.hole) {
      throw new Error("Select one unlocked solid object for edge treatment");
    }
    const appliedEdgeTreatmentCount = edgeTreatmentFeatureCount(shape);
    const hasAppliedEdgeTreatment = Boolean(shape.importedMesh && shape.edgeTreatments?.length);
    const sourceParts = edgeTreatmentSourceParts(shape, {
      keepResultMesh: hasAppliedEdgeTreatment,
      ignoreThreads: true,
    });
    const partInputs: Array<{ shape: WorkplaneShape; mesh?: MeshData; brep?: string; brepTransform?: number[]; primitive?: CadModifierPrimitivePart }> = sourceParts.map((partShape) => {
      const frame = partShape.cadBrepFrame;
      const preserveNeedsRetessellation = preservesEdgeTreatmentSize(partShape) && Boolean(frame) && (
        Math.abs(shapeWidth(partShape) - (frame?.width ?? shapeWidth(partShape))) > 1e-6 ||
        Math.abs(shapeDepth(partShape) - (frame?.depth ?? shapeDepth(partShape))) > 1e-6 ||
        Math.abs(partShape.height - (frame?.height ?? partShape.height)) > 1e-6
      );
      const primitive = cadModifierPrimitiveForShape(partShape);
      if (primitive) return { shape: partShape, primitive };
      return partShape.cadBrep && frame && !preserveNeedsRetessellation
        ? { shape: partShape, brep: partShape.cadBrep, brepTransform: cadBrepTransformForShape(partShape) }
        : { shape: partShape, mesh: meshForShape(partShape) };
    });
    const triangleCount = partInputs.reduce((total, part) => total + (part.mesh?.faces.length ?? 0), 0);
    if (triangleCount === 0 && partInputs.every((part) => !part.brep && !part.primitive)) {
      throw new Error("The selected object has no printable surface");
    }
    if (triangleCount > 180_000) {
      throw new Error("This mesh is too dense for interactive edge treatment. Simplify it below 180,000 triangles first.");
    }
    const parts: CadModifierMeshPart[] = partInputs.map((part) => {
      if (part.brep) return { brep: part.brep, brepTransform: part.brepTransform, hole: Boolean(part.shape.hole) };
      if (part.primitive) return { primitive: part.primitive, hole: Boolean(part.shape.hole) };
      return { ...meshDataToCadTransfer(part.mesh as MeshData), hole: Boolean(part.shape.hole) };
    });
    const transfer = parts.flatMap((part) => part.positions && part.indices ? [part.positions.buffer as Transferable, part.indices.buffer as Transferable] : []);
    const response = await postCadModifierRequestAsync({
      type: "prepare",
      parts,
      sharpAngle,
      suppressTreatmentDetailEdges: appliedEdgeTreatmentCount > 0,
    }, transfer);
    if (response.type !== "ready") {
      throw new Error("The CAD worker did not return an edge list");
    }
    return { response, sourceParts };
  }, [postCadModifierRequestAsync]);

  const applyCadModifierForMcp = useCallback(async (
    shape: WorkplaneShape,
    params: Record<string, unknown>,
  ) => {
    invalidateCadModifierSession();
    const sourceFingerprint = projectShapesFingerprint([shape]);
    const sourceProjectId = projectInfoRef.current.projectId;
    const kind: CadModifierKind = params.kind === "fillet" ? "fillet" : "chamfer";
    const sharpAngle = Math.max(1, Math.min(CAD_MODIFIER_MAX_SHARP_ANGLE, mcpNumber(params.sharpAngle, 25)));
    const amount = Math.max(MIN_EDGE_MODIFIER_AMOUNT, mcpNumber(params.amount, 1));
    const chamferAngle = Math.max(5, Math.min(85, mcpNumber(params.chamferAngle, 45)));
    const quality: CadModifierQuality = params.quality === "draft" || params.quality === "fine" ? params.quality : "standard";
    const preserveEdgeSize = typeof params.preserveEdgeSize === "boolean" ? params.preserveEdgeSize : shape.edgeResizeMode === "preserve";
    const { response, sourceParts } = await prepareCadModifierForMcp(shape, sharpAngle);
    const selectableIds = response.edges.filter((edge) => selectableCadModifierEdge(edge, sharpAngle)).map((edge) => edge.id);
    const requestedIds = mcpNumberArray(params.edgeIds);
    const selectedEdgeIds = params.edgeIds === "all" || params.allEdges === true ? selectableIds : requestedIds.filter((edgeId) => selectableIds.includes(edgeId));
    const missingIds = requestedIds.filter((edgeId) => !selectableIds.includes(edgeId));
    if (selectedEdgeIds.length === 0) {
      throw new Error("Select at least one valid highlighted edge ID");
    }
    if (missingIds.length > 0) {
      throw new Error(`These edge IDs are not selectable at the current threshold: ${missingIds.join(", ")}`);
    }
    const previewResponse = await postCadModifierRequestAsync({
      type: "preview",
      kind,
      edgeIds: selectedEdgeIds,
      amount,
      quality,
      chamferAngle,
    }, [], 30000);
    if (previewResponse.type !== "preview") {
      throw new Error("The CAD worker did not return an edge preview");
    }
    let meshResponse = previewResponse;
    try {
      const refined = await postCadModifierRequestAsync({
        type: "refine",
        ...curvedDisplayTessellation(amount, curveSidesForShape(shape)),
      }, [], 30000);
      if (refined.type === "preview") meshResponse = refined;
    } catch {
      meshResponse = previewResponse;
    }
    let brep = meshResponse.brep || previewResponse.brep;
    if (!brep) {
      const exact = await postCadModifierRequestAsync({ type: "finalize" }, [], 30000);
      if (exact.type === "previewBrep" && exact.brep) brep = exact.brep;
    }
    const rawPreview = shapeFromCadMesh(shape, meshResponse.positions, meshResponse.normals, meshResponse.indices, brep, meshResponse.step ?? previewResponse.step);
    if (!rawPreview) {
      throw new Error("The CAD kernel returned an empty edge treatment");
    }
    const preview = canonicalizeShape({
      ...rawPreview,
      cadDisplayEdges: cadDisplayEdgesForShape(rawPreview, previewResponse.displayEdges),
      cadDisplayEdgesVersion: 2 as const,
    });
    const feature = {
      kind,
      amount,
      edgeCount: selectedEdgeIds.length,
      edgeIds: selectedEdgeIds,
      edgeFingerprints: fingerprintsForEdgeIds(response.edges, selectedEdgeIds),
      allEdges: params.edgeIds === "all" || params.allEdges === true || selectedEdgeIds.length === selectableIds.length,
      sharpAngle,
      quality,
      ...(kind === "chamfer" ? { chamferAngle } : {}),
    } satisfies NonNullable<WorkplaneShape["edgeTreatments"]>[number];
    const session: EdgeModifierSession = {
      kind,
      edges: response.edges,
      selectedEdgeIds,
      amount,
      sharpAngle,
      chamferAngle,
      quality,
      tangentChain: false,
      preserveEdgeSize,
      busy: false,
      prepared: true,
      error: null,
      preview,
      componentPreviews: cadModifierComponentPreviews(sourceParts, previewResponse.components),
    };
    const createdAt = Date.now();
    const groupedModifiedShape = groupedShapeWithComponentEdgeTreatment(shape, preview, sourceParts, session, feature, createdAt);
    const recordedShape = groupedModifiedShape ?? shapeWithEdgeTreatmentRecord(
      bakedEdgeTreatmentPreview(preview, shape),
      shape,
      feature,
      preserveEdgeSize,
      createdAt,
    );
    const modifiedShape = await recutIgnoredThreadsAfterEdgeTreatment(recordedShape, shape);
    const currentTarget = shapesRef.current.find((candidate) => candidate.id === shape.id);
    if (
      projectInfoRef.current.projectId !== sourceProjectId ||
      !currentTarget ||
      projectShapesFingerprint([currentTarget]) !== sourceFingerprint
    ) {
      throw new Error("The target object or project changed while the edge treatment was running; try again");
    }
    commitShapes(
      shapesRef.current.map((candidate) => candidate.id === shape.id ? modifiedShape : candidate),
      modifiedShape.id,
      `${kind === "fillet" ? "Filleted" : "Chamfered"} ${selectedEdgeIds.length} edge${selectedEdgeIds.length === 1 ? "" : "s"} by MCP`,
    );
    flashCadApply(modifiedShape.id, edgeWipePointsFromSession(session));
    return {
      object: mcpShapeSummary(modifiedShape),
      selectedEdgeIds,
      selectableEdgeIds: selectableIds,
    };
  }, [commitShapes, flashCadApply, invalidateCadModifierSession, prepareCadModifierForMcp, postCadModifierRequestAsync]);

  reapplyEdgeTreatmentsRef.current = async (shape: WorkplaneShape) => {
    const recipes = [...(shape.edgeTreatments ?? [])];
    if (recipes.length === 0) return;
    // Strip recipes first so re-apply does not double-stack the same features.
    const stripped: WorkplaneShape = {
      ...shape,
      edgeTreatments: undefined,
      edgeTreatmentHistory: undefined,
      cadBrep: undefined,
      cadBrepFrame: undefined,
      cadDisplayEdges: undefined,
      cadDisplayEdgesVersion: undefined,
    };
    commitShapes(
      shapesRef.current.map((entry) => (entry.id === shape.id ? stripped : entry)),
      shape.id,
    );
    let applied = 0;
    const failed: typeof recipes = [];
    for (const recipe of recipes) {
      const live = shapesRef.current.find((entry) => entry.id === shape.id);
      if (!live) {
        failed.push(recipe);
        continue;
      }
      try {
        const sharpAngle = recipe.sharpAngle ?? 25;
        const { response } = await prepareCadModifierForMcp(live, sharpAngle);
        const edgeIds = matchRecipeEdgeIds(recipe, response.edges, sharpAngle);
        const expectedEdges = recipe.allEdges
          ? edgeIds.length
          : (recipe.edgeFingerprints?.length || recipe.edgeIds?.length || recipe.edgeCount);
        if (edgeIds.length === 0 || edgeIds.length < expectedEdges) {
          failed.push(recipe);
          continue;
        }
        await applyCadModifierForMcp(live, {
          kind: recipe.kind,
          amount: recipe.amount,
          sharpAngle,
          quality: recipe.quality ?? "standard",
          chamferAngle: recipe.chamferAngle ?? 45,
          edgeIds,
          preserveEdgeSize: shape.edgeResizeMode === "preserve",
        });
        applied += 1;
      } catch {
        failed.push(recipe);
      }
    }
    if (failed.length > 0) {
      const live = shapesRef.current.find((entry) => entry.id === shape.id);
      if (live) {
        commitShapes(
          shapesRef.current.map((entry) => (
            entry.id === shape.id
              ? { ...entry, edgeTreatments: [...(entry.edgeTreatments ?? []), ...failed] }
              : entry
          )),
          shape.id,
        );
      }
    }
    if (applied === recipes.length) {
      setNotice(`Re-applied ${applied} edge feature${applied === 1 ? "" : "s"} after remesh`);
    } else if (applied > 0) {
      setNotice(`Re-applied ${applied} of ${recipes.length} edge features after remesh`);
    } else {
      setNotice("Body rebuilt. Could not auto re-apply fillet/chamfer — use Edge tools again.");
    }
  };

  useEffect(() => {
    const base = cadModifierBaseShapeRef.current;
    if (!edgeModifier || !base) return;
    const current = shapes.find((shape) => shape.id === base.id);
    if (current && projectShapesFingerprint([current]) === cadModifierBaseFingerprintRef.current) return;
    invalidateCadModifierSession();
    setNotice("Edge modifier cancelled because the object changed");
  }, [edgeModifier, invalidateCadModifierSession, shapes]);

  useEffect(() => {
    const base = cadModifierBaseShapeRef.current;
    if (!pushPullSession || !base) return;
    const current = shapes.find((shape) => shape.id === base.id);
    if (current && projectShapesFingerprint([current]) === cadModifierBaseFingerprintRef.current) return;
    invalidateCadModifierSession();
    setNotice("Push Pull cancelled because the object changed");
  }, [invalidateCadModifierSession, pushPullSession, shapes]);

  const applyEdgeModifier = useCallback(() => {
    const base = cadModifierBaseShapeRef.current;
    const session = edgeModifier;
    if (!session?.preview || !base) {
      setNotice("Wait for a valid edge preview before applying");
      return;
    }
    void (async () => {
      let previewSource = (edgePreviewSmoothRef.current ? edgePreviewShapeRef.current : null) ?? session.preview;
      if (!previewSource) return;
      if (!edgePreviewSmoothRef.current) {
        try {
          const refined = await postCadModifierRequestAsync({
            type: "refine",
            ...curvedDisplayTessellation(session.amount, curveSidesForShape(base)),
          }, [], 30000);
          if (refined.type === "preview") {
            const raw = shapeFromCadMesh(base, refined.positions, refined.normals, refined.indices, refined.brep || previewSource.cadBrep || "", refined.step);
            if (raw) {
              previewSource = canonicalizeShape({
                ...raw,
                cadDisplayEdges: previewSource.cadDisplayEdges,
                cadDisplayEdgesVersion: 2,
              });
            }
          }
        } catch {
          // The fast preview is still applied if the smooth mesh is not ready.
        }
      }
      if (!previewSource.cadBrep) {
        try {
          const exact = await postCadModifierRequestAsync({ type: "finalize" }, [], 30000);
          if (exact.type === "previewBrep" && exact.brep) {
            previewSource = { ...previewSource, cadBrep: exact.brep };
          }
        } catch {
          // The visible mesh is still applied if the exact solid is not ready.
        }
      }
      const recordBefore = cadModifierEditBeforeRef.current ?? base;
      const label = cadModifierEditBeforeRef.current
        ? (session.kind === "fillet" ? "Updated fillet" : "Updated chamfer")
        : (session.kind === "fillet" ? "Filleted" : "Chamfered");
      const selectableCount = session.edges.filter((edge) => selectableCadModifierEdge(edge, session.sharpAngle)).length;
      const selectedEdgeIds = [...session.selectedEdgeIds];
      const feature = {
        kind: session.kind,
        amount: session.amount,
        edgeCount: selectedEdgeIds.length,
        edgeIds: selectedEdgeIds,
        edgeFingerprints: fingerprintsForEdgeIds(session.edges, selectedEdgeIds),
        allEdges: selectedEdgeIds.length === selectableCount,
        sharpAngle: session.sharpAngle,
        quality: session.quality,
        ...(session.kind === "chamfer" ? { chamferAngle: session.chamferAngle } : {}),
      } satisfies NonNullable<WorkplaneShape["edgeTreatments"]>[number];
      const createdAt = Date.now();
      const previewShape = canonicalizeShape({
        ...previewSource,
        cadDisplayEdges: previewSource.cadDisplayEdges?.length
          ? previewSource.cadDisplayEdges
          : cadDisplayEdgesAfterTreatment(previewSource, session),
        cadDisplayEdgesVersion: 2,
      });
      const groupedModifiedShape = groupedShapeWithComponentEdgeTreatment(
        recordBefore,
        previewShape,
        cadModifierSourcePartsRef.current,
        session,
        feature,
        createdAt,
      );
      const recordedShape = groupedModifiedShape ?? shapeWithEdgeTreatmentRecord(
        bakedEdgeTreatmentPreview(previewShape, recordBefore),
        recordBefore,
        feature,
        session.preserveEdgeSize,
        createdAt,
      );
      const modifiedShape: WorkplaneShape = await recutIgnoredThreadsAfterEdgeTreatment(recordedShape, recordBefore);
      commitShapes(
        shapes.map((shape) => shape.id === base.id ? modifiedShape : shape),
        base.id,
        `${label} ${session.selectedEdgeIds.length} edge${session.selectedEdgeIds.length === 1 ? "" : "s"}`,
      );
      flashCadApply(base.id, edgeWipePointsFromSession(session));
      invalidateCadModifierSession();
    })();
  }, [commitShapes, edgeModifier, flashCadApply, invalidateCadModifierSession, postCadModifierRequestAsync, shapes]);

  useEffect(() => {
    if (!edgeModifier) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelEdgeModifier();
      } else if (event.key === "Enter" && edgeModifier.preview && edgeModifier.selectedEdgeIds.length > 0 && !edgeModifier.busy && !edgeModifier.error) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest("input, select, textarea, button, [contenteditable='true']")) return;
        event.preventDefault();
        applyEdgeModifier();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyEdgeModifier, cancelEdgeModifier, edgeModifier]);

  cadPreviewSendRef.current = (payload) => {
    const requestId = postCadModifierRequest(payload);
    if (requestId === null) return null;
    cadModifierLatestPreviewRef.current = requestId;
    armCadModifierWatchdog(requestId, "preview");
    setEdgeModifier((current) => current ? { ...current, busy: true, error: null } : current);
    return requestId;
  };

  useEffect(() => {
    if (!edgeModifier?.prepared || edgeModifier.selectedEdgeIds.length === 0) return;
    const payload = {
      type: "preview" as const,
      kind: edgeModifier.kind,
      edgeIds: edgeModifier.selectedEdgeIds,
      amount: edgeModifier.amount,
      quality: edgeModifier.quality,
      chamferAngle: edgeModifier.chamferAngle,
    };
    const timer = window.setTimeout(() => {
      const dispatch = cadPreviewQueueRef.current.request(payload);
      if (dispatch.status === "failed") {
        const message = cadModifierWorkerFailureMessage();
        setEdgeModifier((current) => current ? { ...current, busy: false, prepared: false, preview: null, error: message } : current);
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [edgeModifier?.amount, edgeModifier?.chamferAngle, edgeModifier?.kind, edgeModifier?.prepared, edgeModifier?.quality, edgeModifier?.selectedEdgeIds, postCadModifierRequest]);

  useEffect(() => {
    if (!pushPullSession?.prepared || pushPullSession.selectedFaceId === null) return;
    if (Math.abs(pushPullSession.distance) < PUSH_PULL_APPLY_EPSILON) {
      setPushPullSession((current) => current?.preview ? { ...current, preview: null, error: null } : current);
      return;
    }
    const faceId = pushPullSession.selectedFaceId;
    const distance = pushPullSession.distance;
    const timer = window.setTimeout(() => {
      setPushPullSession((current) => current ? { ...current, busy: true, error: null } : current);
      const requestId = postCadModifierRequest({
        type: "pushPull",
        faceId,
        distance,
        quality: modifierPreviewQualityForDisplay(workspaceSettingsRef.current.displayQuality),
      });
      if (requestId === null) {
        setPushPullSession((current) => current ? { ...current, busy: false, error: cadModifierWorkerFailureMessage() } : current);
        return;
      }
      cadModifierLatestPreviewRef.current = requestId;
      armCadModifierWatchdog(requestId, "preview");
    }, pushPullSession.dragging ? 40 : 80);
    return () => window.clearTimeout(timer);
  }, [armCadModifierWatchdog, postCadModifierRequest, pushPullSession?.distance, pushPullSession?.dragging, pushPullSession?.prepared, pushPullSession?.selectedFaceId]);

  const applyShell = useCallback(() => {
    const base = cadModifierBaseShapeRef.current;
    const preview = shellSession?.preview;
    if (!base || !preview) {
      setNotice("Wait for a hollow preview before applying");
      return;
    }
    commitShapes(
      shapes.map((shape) => shape.id === base.id ? preview : shape),
      base.id,
      "Hollowed",
    );
    flashCadApply(base.id);
    invalidateCadModifierSession();
  }, [commitShapes, flashCadApply, invalidateCadModifierSession, shellSession?.preview, shapes]);

  const applyPushPull = useCallback((distanceOverride?: number) => {
    const base = cadModifierBaseShapeRef.current;
    const session = pushPullSessionRef.current;
    const distance = distanceOverride ?? session?.distance ?? 0;
    if (!base || !session) return;
    if (Math.abs(distance) < PUSH_PULL_APPLY_EPSILON) {
      setNotice("Drag a flat face");
      return;
    }
    const preview = session.preview;
    if (!preview) {
      setNotice("Wait for a Push Pull preview before applying");
      return;
    }
    const finish = (exact: WorkplaneShape) => {
      commitShapes(
        shapesRef.current.map((shape) => shape.id === base.id ? exact : shape),
        base.id,
        pushPullHistoryLabel(distance, workspaceSettingsRef.current.accuracy),
      );
      flashCadApply(base.id);
      invalidateCadModifierSession();
    };
    void (async () => {
      let next = preview;
      if (!next.cadBrep) {
        try {
          const exact = await postCadModifierRequestAsync({ type: "finalize" }, [], 30000);
          if (exact.type === "previewBrep" && exact.brep) {
            next = { ...next, cadBrep: exact.brep };
          }
        } catch {
          // The visible mesh is still applied if the exact solid is not ready.
        }
      }
      finish(canonicalizeShape(next));
    })();
  }, [flashCadApply, invalidateCadModifierSession, postCadModifierRequestAsync]);

  const playPushPullSettle = useCallback((distance: number) => {
    const session = pushPullSessionRef.current;
    if (!session?.preview || session.settling) {
      applyPushPull(distance);
      return;
    }
    if (prefersReducedMotion()) {
      applyPushPull(distance);
      return;
    }
    setPushPullSession((current) => current ? { ...current, settling: true, dragging: false, ghostOpacity: 1 } : current);
    const started = performance.now();
    const tick = (now: number) => {
      if (!pushPullSessionRef.current) return;
      const t = Math.min(1, (now - started) / PUSH_PULL_COMMIT_MS);
      const eased = 1 - ((1 - t) ** 3);
      setPushPullSession((current) => current ? { ...current, ghostOpacity: 1 - eased } : current);
      if (t < 1) {
        window.requestAnimationFrame(tick);
        return;
      }
      applyPushPull(distance);
    };
    window.requestAnimationFrame(tick);
  }, [applyPushPull]);

  useEffect(() => {
    if (!pushPullSession) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        invalidateCadModifierSession();
        setNotice("Push Pull cancelled");
      } else if (event.key === "Enter" && pushPullSession.preview && !pushPullSession.busy && !pushPullSession.error) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest("input, select, textarea, button, [contenteditable='true']")) return;
        event.preventDefault();
        playPushPullSettle(pushPullSession.distance);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [invalidateCadModifierSession, playPushPullSettle, pushPullSession]);

  const applySplit = useCallback(() => {
    if (!splitSession) return;
    const session = splitSession;
    const shape = shapesRef.current.find((entry) => entry.id === session.shapeId);
    if (!shape || shape.locked) {
      setSplitSession(null);
      return;
    }
    setNotice("Splitting…");
    void (async () => {
      try {
        const parts = await cutShapeToFitBest(shape, {
          axis: session.axis,
          offset: session.offset,
          joint: session.joint,
          clearance: clampCutClearance(session.clearance),
        });
        if (parts.length < 2) {
          setNotice("Move the line through the object. The cut has to cross it.");
          return;
        }
        commitShapes(
          shapesRef.current.flatMap((entry) => entry.id === shape.id ? parts : [entry]),
          parts.map((part) => part.id),
          session.joint === "none" ? "Split" : "Cut to fit",
        );
        setSplitSession(null);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not split that object");
      }
    })();
  }, [commitShapes, splitSession]);

  const cancelSplit = useCallback(() => {
    setSplitSession(null);
    setNotice("Split cancelled");
  }, []);

  useEffect(() => {
    if (!splitSession) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelSplit();
      } else if (event.key === "Enter") {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest("input, select, textarea, button, [contenteditable='true']")) return;
        event.preventDefault();
        applySplit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applySplit, cancelSplit, splitSession]);

  const splitPlane = useMemo(() => {
    if (!splitSession) return null;
    const shape = shapes.find((entry) => entry.id === splitSession.shapeId);
    if (!shape) return null;
    const frame = splitPlaneFrame(shape, splitSession);
    return {
      origin: frame.origin,
      normal: frame.normal,
      width: frame.width,
      height: frame.height,
      limit: frame.limit,
    };
  }, [shapes, splitSession]);

  useEffect(() => {
    if (!shellSession?.prepared) return;
    const openings = shellSession.openings;
    const thickness = shellSession.thickness;
    const corners = shellSession.corners;
    const cornerRadius = shellSession.cornerRadius;
    const timer = window.setTimeout(() => {
      const requestId = postCadModifierRequest({
        type: "hollow",
        thickness,
        openings,
        corners,
        cornerRadius,
        quality: "standard",
      });
      if (requestId === null) {
        setShellSession((current) => current ? { ...current, busy: false, error: cadModifierWorkerFailureMessage() } : current);
        return;
      }
      cadModifierLatestPreviewRef.current = requestId;
      armCadModifierWatchdog(requestId, "preview");
      setShellSession((current) => current ? { ...current, busy: true, error: null } : current);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [armCadModifierWatchdog, postCadModifierRequest, shellSession?.cornerRadius, shellSession?.corners, shellSession?.openings, shellSession?.prepared, shellSession?.thickness]);

  const snapSelected = useCallback(() => {
    if (faceSnap) {
      setFaceSnap(null);
      setNotice("Snap cancelled");
      return;
    }
    clearEditorToolSessions();
    setFaceSnap({ source: null });
    setNotice("Click the face to move, then the face it should meet");
  }, [clearEditorToolSessions, faceSnap]);

  const laySelectedFace = useCallback(() => {
    if (layFlat) {
      setLayFlat(false);
      setNotice("Lay flat cancelled");
      return;
    }
    clearEditorToolSessions();
    setLayFlat(true);
    setNotice("Click the face that should lie on the workplane");
  }, [clearEditorToolSessions, layFlat]);

  const pickFaceSnap = useCallback((pick: { shapeId: string; point: [number, number, number]; normal: [number, number, number] }) => {
    if (layFlat) {
      const shape = shapesRef.current.find((item) => item.id === pick.shapeId);
      if (!shape || shape.locked) {
        setNotice(shape?.locked ? "That shape is locked" : "Click a shape");
        return;
      }
      const pose = layFaceOnWorkplane(shape, pick);
      if (!pose) {
        setNotice("Could not lay that face down");
        return;
      }
      const finish = () => {
        commitShapes(
          shapesRef.current.map((item) => item.id === shape.id && !item.locked ? { ...item, ...pose } : item),
          [shape.id],
          "Laid face on the workplane",
        );
        setNotice("Laid face on the workplane");
      };
      setLayFlat(false);
      const motion = faceSnapMotionRef.current;
      if (motion) motion(shape.id, pose, finish);
      else finish();
      return;
    }
    if (!faceSnap) return;
    const faceSnapSource = faceSnap.source;
    if (!faceSnapSource) {
      const shape = shapesRef.current.find((item) => item.id === pick.shapeId);
      if (!shape || shape.locked) {
        setNotice(shape?.locked ? "That shape is locked" : "Click a shape");
        return;
      }
      setFaceSnap({ source: pick });
      setNotice("Now click the face it should meet");
      return;
    }
    if (pick.shapeId === faceSnapSource.shapeId) {
      setNotice("Click a face on the other shape");
      return;
    }
    const sourceShape = shapesRef.current.find((item) => item.id === faceSnapSource.shapeId);
    const targetShape = shapesRef.current.find((item) => item.id === pick.shapeId);
    if (!sourceShape || sourceShape.locked || !targetShape) {
      setNotice(sourceShape?.locked ? "That shape is locked" : "Click a shape");
      return;
    }
    const pose = faceToFaceMate(sourceShape, faceSnapSource, targetShape, pick);
    if (!pose) {
      setNotice("Could not snap those faces");
      return;
    }
    const sourceId = sourceShape.id;
    const finish = () => {
      commitShapes(
        shapesRef.current.map((shape) => shape.id === sourceId && !shape.locked
          ? { ...shape, ...pose }
          : shape),
        [sourceId],
        "Snapped faces together",
      );
      setNotice("Snapped faces together");
    };
    setFaceSnap(null);
    const motion = faceSnapMotionRef.current;
    if (motion) motion(sourceId, pose, finish);
    else finish();
  }, [commitShapes, faceSnap, layFlat]);

  const toggleHidden = useCallback(() => {
    if (!hasSelection) {
      setNotice("Select a shape first");
      return;
    }
    const selected = new Set(selectedIds);
    const shouldHide = selectedShapes.some((shape) => !shape.hidden);
    commitShapes(
      shapes.map((shape) => (selected.has(shape.id) && !shape.locked ? { ...shape, hidden: shouldHide } : shape)),
      selectedIds,
      shouldHide ? "Selection hidden" : "Selection visible",
    );
  }, [commitShapes, hasSelection, selectedIds, selectedShapes, shapes]);

  const showHidden = useCallback(() => {
    const hiddenCount = shapes.filter((shape) => shape.hidden).length;
    if (hiddenCount === 0) {
      setNotice("No hidden shapes");
      return;
    }
    commitShapes(
      shapes.map((shape) => ({ ...shape, hidden: false })),
      selectedIds,
      `Showed ${hiddenCount} hidden shape${hiddenCount === 1 ? "" : "s"}`,
    );
  }, [commitShapes, selectedIds, shapes]);

  const toggleLocked = useCallback(() => {
    if (!hasSelection) {
      setNotice("Select a shape first");
      return;
    }
    const selected = new Set(selectedIds);
    const shouldLock = selectedShapes.some((shape) => !shape.locked);
    commitShapes(
      shapes.map((shape) => (selected.has(shape.id) ? { ...shape, locked: shouldLock } : shape)),
      selectedIds,
      shouldLock ? "Selection locked" : "Selection unlocked",
    );
  }, [commitShapes, hasSelection, selectedIds, selectedShapes, shapes]);

  const setSelectionHoleMode = useCallback(
    async (hole: boolean) => {
      if (!hasSelection) {
        setNotice("Select a shape first");
        return;
      }
      const selected = new Set(selectedIds);
      const nextShapes = shapesRef.current.map((shape) =>
        selected.has(shape.id) && !shape.locked ? withHoleMode(shape, hole) : shape,
      );

      if (hole) {
        // Face-sketch holes know their host — cut immediately instead of requiring a manual Group.
        const faceHoles = nextShapes.filter(
          (shape) => selected.has(shape.id) && shape.hole && shape.sketchPlane?.hostShapeId && !shape.locked,
        );
        for (const holeShape of faceHoles) {
          const hostId = holeShape.sketchPlane?.hostShapeId;
          const host = hostId ? nextShapes.find((shape) => shape.id === hostId && !shape.hole && !shape.locked && !shape.hidden) : null;
          if (!host) continue;
          const sourceFingerprint = projectShapesFingerprint(shapesRef.current);
          const sourceProjectId = projectInfoRef.current.projectId;
          const result = await buildGroupedShapeFromSelection([withHoleMode(host, false), holeShape]);
          if (projectInfoRef.current.projectId !== sourceProjectId || projectShapesFingerprint(shapesRef.current) !== sourceFingerprint) {
            setNotice("The scene changed while cutting; try Hole again");
            return;
          }
          if (result.group) {
            const linkedGroup = asPreservedCsgBody(host, result.group);
            commitShapes(
              shapesRef.current.filter((shape) => shape.id !== host.id && shape.id !== holeShape.id).concat(linkedGroup),
              linkedGroup.id,
              `Cut hole into ${host.name}`,
            );
            return;
          }
          if (result.consumed) {
            commitShapes(
              shapesRef.current.filter((shape) => shape.id !== host.id && shape.id !== holeShape.id),
              null,
              "Hole consumed the host solid",
            );
            return;
          }
          setNotice(result.failureNotice);
          return;
        }
      }

      commitShapes(
        nextShapes,
        selectedIds,
        hole
          ? "Changed selection to hole — select a solid and Group to cut"
          : "Changed selection to solid",
      );
    },
    [commitShapes, hasSelection, selectedIds],
  );

  const cutSelected = useCallback(async () => {
    if (!hasSelection) {
      setNotice("Select a shape first");
      return;
    }
    const selected = new Set(selectedIds);
    setClipboard(selectedShapes);
    await writeShapeClipboard(selectedShapes);
    commitShapes(
      shapes.filter((shape) => !selected.has(shape.id)),
      [],
      `Cut ${selectedShapes.length} shape${selectedShapes.length === 1 ? "" : "s"}`,
    );
  }, [commitShapes, hasSelection, selectedIds, selectedShapes, shapes]);

  const raiseSelected = useCallback(
    (delta: number) => {
      if (!hasSelection) {
        return;
      }
      const selected = new Set(selectedIds);
      const repeatEntries: Array<{ shapeId: string; delta: ShapeRepeatDelta }> = [];
      selectedIds.forEach((shapeId) => {
        const shape = shapes.find((entry) => entry.id === shapeId);
        if (shape && !shape.locked) {
          repeatEntries.push({ shapeId, delta: { elevation: delta } });
        }
      });
      recordShapeRepeatActions(repeatEntries);
      commitShapes(
        shapes.map((shape) =>
          selected.has(shape.id) && !shape.locked
            ? {
                ...shape,
                elevation: Math.max(0, Math.min(180, (shape.elevation ?? 0) + delta)),
              }
            : shape,
        ),
        selectedIds,
        delta > 0 ? "Moved selection up" : "Moved selection down",
      );
    },
    [commitShapes, hasSelection, recordShapeRepeatActions, selectedIds, shapes],
  );

  const applyDropOntoSurface = useCallback((
    surfaceY: number,
    shift: { x: number; z: number } | undefined,
    message: string,
  ) => {
    const selected = new Set(selectedIds);
    const moving = shapes.filter((shape) => selected.has(shape.id) && !shape.locked);
    if (moving.length === 0) {
      setNotice("Select a shape first");
      return;
    }
    const patches = new Map(moving.map((shape) => [
      shape.id,
      dropPatchOntoFrame(shape, meshAabb(shape), surfaceY, shift),
    ] as const));
    const finish = () => {
      commitShapes(
        shapesRef.current.map((shape) => {
          const patch = patches.get(shape.id);
          return patch && !shape.locked ? { ...shape, ...patch } : shape;
        }),
        [...selected],
        message,
      );
      setNotice(message);
    };
    setDropSurface(false);
    const primary = moving[0];
    const patch = primary ? patches.get(primary.id) : undefined;
    const motion = moving.length === 1 && primary && patch ? faceSnapMotionRef.current : null;
    if (motion && primary && patch) {
      motion(primary.id, {
        x: patch.x ?? primary.x,
        z: patch.z ?? primary.z,
        elevation: patch.elevation ?? primary.elevation ?? 0,
        rotationX: primary.rotationX ?? 0,
        rotation: primary.rotation,
        rotationZ: primary.rotationZ ?? 0,
      }, finish);
      return;
    }
    finish();
  }, [commitShapes, selectedIds, shapes]);

  const dropSelectedToWorkplane = useCallback(() => {
    if (dropSurface) {
      setDropSurface(false);
      setNotice("Drop cancelled");
      return;
    }
    if (!hasSelection) {
      setNotice("Select a shape first");
      return;
    }
    clearEditorToolSessions();
    setDropSurface(true);
    setNotice("Click the workplane or a flat face to drop onto");
  }, [clearEditorToolSessions, dropSurface, hasSelection]);

  const pickDropSurface = useCallback((pick: {
    kind: "workplane";
  } | {
    kind: "face";
    shapeId: string;
    point: [number, number, number];
    normal: [number, number, number];
  }) => {
    if (!dropSurface) return;
    const selected = new Set(selectedIds);
    const moving = shapes.filter((shape) => selected.has(shape.id) && !shape.locked);
    if (moving.length === 0) {
      setNotice("Select a shape first");
      return;
    }
    if (pick.kind === "workplane") {
      applyDropOntoSurface(0, undefined, "Dropped onto the workplane");
      return;
    }
    if (selected.has(pick.shapeId)) {
      setNotice("Click the workplane or a different shape");
      return;
    }
    const surfaceY = dropSurfaceY(pick.normal, pick.point);
    if (surfaceY === null) {
      setNotice("Click a flat face facing up, or the workplane");
      return;
    }
    const group = boundsForCuboids(moving.map(meshAabb));
    const shift = {
      x: pick.point[0] - (group.minX + group.maxX) / 2,
      z: pick.point[2] - (group.minZ + group.maxZ) / 2,
    };
    applyDropOntoSurface(surfaceY, shift, "Dropped onto the face");
  }, [applyDropOntoSurface, dropSurface, selectedIds, shapes]);

  useEffect(() => {
    if (dropSurface && !hasSelection) setDropSurface(false);
  }, [dropSurface, hasSelection]);

  const togglePlacementRuler = useCallback(() => {
    setPlacementRuler((current) => {
      if (current) {
        setNotice("Placement ruler closed");
        return null;
      }
      clearEditorToolSessions("placement");
      const primary = selectedIds[0] ? shapes.find((shape) => shape.id === selectedIds[0]) : undefined;
      setNotice(primary ? "Enter how far to move in X, Y, or Z" : "Please select a shape to begin");
      return {
        baseline: primary ? placementPoseOf(primary) : null,
        baselineId: primary?.id ?? null,
      };
    });
  }, [clearEditorToolSessions, selectedIds, shapes]);

  const deactivatePlacementRuler = useCallback(() => {
    setPlacementRuler((current) => {
      if (current) setNotice("Placement ruler closed");
      return null;
    });
  }, []);

  const applyPlacementRulerOffset = useCallback((axis: keyof PlacementOffsets, millimeters: number) => {
    if (!hasSelection) {
      setNotice("Please select a shape to begin");
      return;
    }
    const primary = shapes.find((shape) => shape.id === selectedIds[0] && !shape.locked);
    const baseline = placementRuler?.baselineId === selectedIds[0] && placementRuler.baseline
      ? placementRuler.baseline
      : primary
        ? placementPoseOf(primary)
        : null;
    if (!baseline) {
      setNotice("Please select a shape to begin");
      return;
    }
    commitShapes(
      applyPlacementOffsetsToSelection(shapes, selectedIds, baseline, axis, millimeters),
      selectedIds,
      `Moved selection ${axis.toUpperCase()} ${millimeters.toFixed(2)} mm`,
    );
  }, [commitShapes, hasSelection, placementRuler, selectedIds, shapes]);

  useEffect(() => {
    if (!placementRuler) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPlacementRuler(null);
      setNotice("Placement ruler closed");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [placementRuler]);

  useEffect(() => {
    if (!placementRuler) return;
    const id = selectedIds[0] ?? null;
    if (placementRuler.baselineId === id) return;
    const shape = id ? shapes.find((entry) => entry.id === id) : undefined;
    setPlacementRuler((current) => {
      if (!current || current.baselineId === id) return current;
      return {
        ...current,
        baseline: shape ? placementPoseOf(shape) : null,
        baselineId: id,
      };
    });
    if (shape) setNotice("Enter how far to move in X, Y, or Z");
    else setNotice("Please select a shape to begin");
  }, [placementRuler, selectedIds, shapes]);

  const groupSelected = useCallback(async () => {
    const groupable = selectedShapes.filter((shape) => !isConstructionShape(shape));
    if (groupable.length < 2) {
      setNotice("Select at least two solids to group (construction planes stay out of Group)");
      return;
    }

    if (groupable.some((shape) => shape.locked)) {
      setNotice("Unlock every selected shape before grouping");
      return;
    }

    flushSync(() => {
      setNotice(groupable.length >= 8 ? `Grouping ${groupable.length} solids…` : "Grouping…");
    });
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });

    const sourceFingerprint = projectShapesFingerprint(shapesRef.current);
    const sourceProjectId = projectInfoRef.current.projectId;
    const result = await buildGroupedShapeFromSelection(groupable);
    if (projectInfoRef.current.projectId !== sourceProjectId || projectShapesFingerprint(shapesRef.current) !== sourceFingerprint) {
      setNotice("The scene changed while grouping; select the objects and try again");
      return;
    }
    const { group } = result;
    if (!group) {
      if (result.consumed) {
        const selected = new Set(selectedIds);
        commitShapes(shapesRef.current.filter((shape) => !selected.has(shape.id)), null, "Grouped: hole consumed solid");
        return;
      }
      setNotice(result.failureNotice);
      return;
    }
    // Preserve sketch↔host links so later face sketches / re-cuts still find this body.
    let linkedGroup = group;
    for (const solid of selectedShapes.filter((shape) => !shape.hole)) {
      linkedGroup = rewriteSketchHostIds(linkedGroup, solid.id, group.id);
    }
    const leftOutIds = new Set((result.leftOutShapes ?? []).map((shape) => shape.id));
    const groupedIds = new Set(groupable.filter((shape) => !leftOutIds.has(shape.id)).map((shape) => shape.id));
    const kept = shapesRef.current.filter((shape) => !groupedIds.has(shape.id));
    commitShapes([...kept, linkedGroup], linkedGroup.id, `Grouped ${groupedIds.size} shapes`);
    flashCadApply(linkedGroup.id, undefined, "combine");
    setActiveFeatureId(null);
    if (result.qualityNotice) {
      setNotice(result.qualityNotice);
    }
  }, [commitShapes, flashCadApply, selectedIds, selectedShapes]);

  const assembleSelected = useCallback(() => {
    const groupable = selectedShapes.filter((shape) => !isConstructionShape(shape));
    if (groupable.length < 2) {
      setNotice("Select at least two shapes to tie");
      return;
    }
    if (groupable.some((shape) => shape.locked)) {
      setNotice("Unlock every selected shape before tying");
      return;
    }
    const assembly = groupedShape(groupable);
    if (!assembly) {
      setNotice("Could not tie this selection");
      return;
    }
    let linked = assembly;
    groupable.forEach((shape, index) => {
      const child = linked.groupedShapes?.[index];
      if (child) linked = rewriteSketchHostIds(linked, shape.id, child.id);
    });
    const groupedIds = new Set(groupable.map((shape) => shape.id));
    commitShapes(
      [...shapesRef.current.filter((shape) => !groupedIds.has(shape.id)), linked],
      linked.id,
      `Tied ${groupable.length} shapes`,
    );
    flashCadApply(linked.id, undefined, "combine");
    setActiveFeatureId(null);
  }, [commitShapes, flashCadApply, selectedShapes]);

  const intersectSelected = useCallback(async () => {
    const groupable = selectedShapes.filter((shape) => !shape.locked);
    const hasSolid = groupable.some((shape) => !shape.hole);
    const hasHole = groupable.some((shape) => shape.hole);
    if (!hasSolid || !hasHole) {
      setNotice("Select at least one solid and one hole for Intersection");
      return;
    }

    flushSync(() => {
      setNotice("Intersecting…");
    });
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });

    const sourceFingerprint = projectShapesFingerprint(shapesRef.current);
    const sourceProjectId = projectInfoRef.current.projectId;
    const result = await buildIntersectionShapeFromSelection(groupable);
    if (projectInfoRef.current.projectId !== sourceProjectId || projectShapesFingerprint(shapesRef.current) !== sourceFingerprint) {
      setNotice("The scene changed while intersecting; select the objects and try again");
      return;
    }
    if (!result.group && !result.empty) {
      setNotice(result.failureNotice);
      return;
    }

    const operandIds = new Set(groupable.map((shape) => shape.id));
    const remainingShapes = shapesRef.current.filter((shape) => !operandIds.has(shape.id));
    if (result.empty) {
      commitShapes(remainingShapes, null, "Intersection is empty");
      return;
    }

    const intersection = result.group;
    if (!intersection) {
      return;
    }
    commitShapes([...remainingShapes, intersection], intersection.id, `Intersected ${groupable.length} shapes`);
    flashCadApply(intersection.id, undefined, "combine");
    setActiveFeatureId(null);
  }, [commitShapes, flashCadApply, selectedShapes]);

  const ungroupSelected = useCallback(() => {
    const groups = selectedShapes.filter((shape) => shape.groupedShapes?.length);
    if (groups.length === 0) {
      setNotice("Select a group first");
      return;
    }
    const targetId = pickGroupToUngroup(selectedIds, groups.map((group) => group.id));
    const target = groups.find((group) => group.id === targetId) ?? groups[groups.length - 1];
    const restored = restoreGroupedChildren(target);
    commitShapes(
      [...shapes.filter((shape) => shape.id !== target.id), ...restored],
      restored.map((shape) => shape.id),
      "Ungrouped last group",
    );
    flashCadApply(restored.map((shape) => shape.id), undefined, "separate");
  }, [commitShapes, flashCadApply, selectedIds, selectedShapes, shapes]);

  const separateSelectedParts = useCallback(() => {
    if (selectedShapes.length !== 1 || !selectedShape) {
      setNotice("Select one object to separate");
      return;
    }
    if (selectedShape.locked) {
      setNotice("Unlock the object before separating parts");
      return;
    }
    const parts = separateShapeParts(selectedShape);
    if (parts.length <= 1) {
      setNotice("The selected object has only one connected part");
      return;
    }
    const separatedThreads = canSeparateThreadScrew(selectedShape);
    commitShapes(
      [...shapes.filter((shape) => shape.id !== selectedShape.id), ...parts],
      parts.map((shape) => shape.id),
      separatedThreads ? "Separated shaft and thread cutter" : `Separated ${parts.length} parts`,
    );
    if (separatedThreads) {
      setNotice("Shaft kept as solid; thread cutter is a Hole — adjust Clearance, then Group with your part");
    }
  }, [commitShapes, selectedShape, selectedShapes.length, shapes]);

  const reduceSelectedMesh = useCallback(async (keepFraction: number) => {
    if (!selectedShape?.importedMesh) {
      setNotice("Select an imported mesh to reduce");
      return;
    }
    if (selectedShape.locked) {
      setNotice("Unlock the object before reducing triangles");
      return;
    }
    let patch: Partial<WorkplaneShape> | null = null;
    try {
      patch = await simplifiedImportedShapePatch(selectedShape, keepFraction);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not reduce this mesh");
      return;
    }
    if (!patch?.importedMesh) {
      setNotice("Could not reduce this mesh. Try a lower detail setting.");
      return;
    }
    const next = { ...selectedShape, ...patch };
    commitShapes(
      shapesRef.current.map((shape) => (shape.id === selectedShape.id ? next : shape)),
      selectedShape.id,
      `Reduced ${selectedShape.name} to ${patch.importedMesh.triangleCount.toLocaleString()} triangles`,
    );
  }, [commitShapes, selectedShape]);

  const mcpSceneSnapshot = useCallback((includeRawShapes = false): SketchForgeMcpSceneSummary & { rawShapes?: WorkplaneShape[] } => {
    const projectInfo = projectInfoRef.current;
    const currentShapes = shapesRef.current;
    return {
      projectId: projectInfo.projectId,
      projectName: projectInfo.projectName,
      notice: noticeRef.current,
      selectedIds: selectedIdsRef.current,
      shapeCount: currentShapes.length,
      workspace: workspaceSettingsRef.current,
      snap: snapGrid,
      shapes: currentShapes.map(mcpShapeSummary),
      ...(includeRawShapes ? { rawShapes: currentShapes.map((shape) => canonicalizeShape(shape)) } : {}),
    };
  }, [snapGrid]);

  const executeMcpCommand = useCallback(async (command: SketchForgeMcpCommand): Promise<unknown> => {
    const params = command.params ?? {};
    const currentShapes = () => shapesRef.current;
    const findShape = (id: unknown) => (typeof id === "string" ? currentShapes().find((shape) => shape.id === id) ?? null : null);

    try {
      lastMcpErrorRef.current = null;
      if (command.action === "get_scene") {
        return mcpSceneSnapshot(params.includeRawShapes === true);
      }

      if (command.action === "list_objects") {
        return { objects: currentShapes().map(mcpShapeSummary) };
      }

      if (command.action === "select_objects") {
        const requestedIds = mcpStringArray(params.ids ?? params.id);
        const validIds = requestedIds.filter((id) => currentShapes().some((shape) => shape.id === id));
        setSelectedIds(validIds);
        selectedIdsRef.current = validIds;
        setNotice(validIds.length ? `MCP selected ${validIds.length} object${validIds.length === 1 ? "" : "s"}` : "MCP cleared selection");
        return { selectedIds: validIds, objects: currentShapes().filter((shape) => validIds.includes(shape.id)).map(mcpShapeSummary) };
      }

      if (command.action === "delete_objects") {
        const requestedIds = mcpStringArray(params.ids ?? params.id);
        const ids = requestedIds.length ? new Set(requestedIds) : new Set(selectedIdsRef.current);
        const deleted = currentShapes().filter((shape) => ids.has(shape.id));
        if (deleted.length === 0) throw new Error("No matching objects to delete");
        commitShapes(currentShapes().filter((shape) => !ids.has(shape.id)), [], `MCP deleted ${deleted.length} object${deleted.length === 1 ? "" : "s"}`);
        selectedIdsRef.current = [];
        return { deletedIds: deleted.map((shape) => shape.id), deletedCount: deleted.length };
      }

      if (command.action === "create_shape") {
        const rawKind = mcpString(params.kind, "box");
        const kind = rawKind === "cube" ? "box" : rawKind;
        const width = Math.max(MIN_SHAPE_DIMENSION, mcpNumber(params.width ?? params.size, 20));
        const depth = Math.max(MIN_SHAPE_DIMENSION, mcpNumber(params.depth ?? params.size, rawKind === "cube" ? width : 20));
        const height = Math.max(MIN_SHAPE_DIMENSION, mcpNumber(params.height ?? params.size, rawKind === "cube" ? width : 20));
        const x = mcpNumber(params.x, 0);
        const z = mcpNumber(params.z, 0);
        const elevation = mcpNumber(params.elevation, 0);
        const color = mcpString(params.color, kind === "cylinder" ? "#d97813" : "#d41721");
        const name = mcpString(params.name, kind === "cylinder" ? "Cylinder" : kind === "sketch" ? "Sketch extrusion" : rawKind === "cube" ? "Cube" : "Box");
        let shape: WorkplaneShape;
        if (kind === "sketch") {
          const hostShapeId = typeof params.hostShapeId === "string" && params.hostShapeId.trim()
            ? params.hostShapeId.trim()
            : undefined;
          const host = hostShapeId
            ? currentShapes().find((entry) => entry.id === hostShapeId && !entry.hole && !entry.hidden)
            : undefined;
          // Bake on the host top face when hosted so hole auto-cut overlaps the solid.
          const hostPlane = host
            ? {
                ...defaultSketchPlane(),
                origin: {
                  x: host.x,
                  y: (host.elevation ?? 0) + host.height,
                  z: host.z,
                },
                uAxis: { x: 1, y: 0, z: 0 },
                vAxis: { x: 0, y: 0, z: 1 },
                normal: { x: 0, y: 1, z: 0 },
                hostShapeId,
              }
            : undefined;
          const profile = {
            ...defaultMcpSketchProfile(width, depth),
            ...(hostPlane ? { sketchPlane: hostPlane } : {}),
          };
          const extruded = shapeFromSketchProfile(profile, height);
          if (!extruded) throw new Error("Could not create the sketch profile");
          const withHost = hostPlane
            ? {
                ...extruded,
                sketchPlane: hostPlane,
                sketchProfile: extruded.sketchProfile
                  ? { ...extruded.sketchProfile, sketchPlane: hostPlane }
                  : extruded.sketchProfile,
              }
            : extruded;
          shape = canonicalizeShape({
            ...withHost,
            name,
            color,
            x: host ? host.x + x : x,
            z: host ? host.z + z : z,
            elevation: host ? (host.elevation ?? 0) + host.height : elevation,
            rotation: mcpNumber(params.rotation, 0),
            rotationX: mcpNumber(params.rotationX, 0),
            rotationZ: mcpNumber(params.rotationZ, 0),
          });
        } else if (kind === "box" || kind === "cylinder") {
          shape = sceneShape({
            name,
            kind,
            color,
            x,
            z,
            elevation,
            width,
            depth,
            height,
            size: Math.max(width, depth),
            rotation: mcpNumber(params.rotation, 0),
            rotationX: mcpNumber(params.rotationX, 0),
            rotationZ: mcpNumber(params.rotationZ, 0),
            sides: kind === "cylinder" ? Math.max(3, Math.floor(mcpNumber(params.sides, 96))) : undefined,
          });
        } else {
          const asset = toolbarShapeAssets.find((entry) => entry.kind === kind || entry.id === rawKind);
          if (!asset || asset.kind === "thread") {
            throw new Error("create_shape supports box, cube, cylinder, sketch, sphere, cone, pyramid, roof, polygon, roundRoof, halfSphere, torus, tube, gear, and text. Use create_thread for threads.");
          }
          const made = makeShapeFromAsset(asset, { x, z, elevation }, workspaceSettingsRef.current.displayQuality);
          shape = sceneShape({
            ...made,
            name,
            color: mcpString(params.color, asset.color),
            x,
            z,
            elevation,
            width,
            depth,
            height,
            size: Math.max(width, depth),
            rotation: mcpNumber(params.rotation, 0),
            rotationX: mcpNumber(params.rotationX, 0),
            rotationZ: mcpNumber(params.rotationZ, 0),
            ...(typeof params.sides === "number" ? { sides: Math.max(3, Math.floor(params.sides)) } : {}),
            ...(typeof params.text === "string" ? { text: params.text } : {}),
          });
        }
        const committedShape = canonicalizeShape(bakeShapeTransformIntoMesh(shape));
        commitShapes([...currentShapes(), committedShape], committedShape.id, `${committedShape.name} added by MCP`);
        return { object: mcpShapeSummary(committedShape) };
      }

      if (command.action === "import_mesh") {
        const positions = mcpFiniteNumberArray(params.positions);
        const normals = mcpFiniteNumberArray(params.normals);
        if (positions.length < 9 || positions.length % 9 !== 0) {
          throw new Error("import_mesh requires positions as triangle xyz values");
        }
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let minZ = Number.POSITIVE_INFINITY;
        let maxZ = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < positions.length; index += 3) {
          const x = positions[index];
          const y = positions[index + 1];
          const z = positions[index + 2];
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
        const width = Math.max(MIN_SHAPE_DIMENSION, mcpNumber(params.width, maxX - minX));
        const depth = Math.max(MIN_SHAPE_DIMENSION, mcpNumber(params.depth, maxZ - minZ));
        const height = Math.max(MIN_SHAPE_DIMENSION, mcpNumber(params.height, maxY - minY));
        const shape = canonicalizeShape({
          id: createLocalId("mcp-imported-mesh"),
          name: mcpString(params.name, "Imported mesh"),
          kind: "mesh",
          color: mcpString(params.color, "#9bd7f0"),
          x: mcpNumber(params.x, 0),
          z: mcpNumber(params.z, 0),
          elevation: mcpNumber(params.elevation, 0),
          size: Math.max(width, depth),
          width,
          depth,
          height,
          rotation: mcpNumber(params.rotation, 0),
          rotationX: mcpNumber(params.rotationX, 0),
          rotationZ: mcpNumber(params.rotationZ, 0),
          importedMesh: {
            positions,
            normals: normals.length === positions.length ? normals : undefined,
            baseWidth: width,
            baseDepth: depth,
            baseHeight: height,
            triangleCount: Math.floor(positions.length / 9),
            sourceFormat: "json",
          },
          locked: false,
          hidden: false,
        } satisfies WorkplaneShape);
        commitShapes([...currentShapes(), shape], shape.id, `${shape.name} imported by MCP`);
        return { object: mcpShapeSummary(shape) };
      }

      if (command.action === "update_object") {
        const target = findShape(params.id);
        if (!target) throw new Error("Object not found");
        if (target.locked) throw new Error("Unlock the object before updating it");
        const patch: ShapeUpdatePatch = {};
        const rotationWasRequested = [params.rotation, params.rotationX, params.rotationZ].some(
          (value) => typeof value === "number" && Number.isFinite(value),
        );
        (["x", "z", "elevation", "width", "depth", "height", "size", "rotation", "rotationX", "rotationZ"] as const).forEach((key) => {
          if (typeof params[key] === "number" && Number.isFinite(params[key])) {
            patch[key] = params[key];
          }
        });
        if (typeof params.color === "string") patch.color = params.color;
        if (typeof params.name === "string") patch.name = params.name;
        if (typeof params.hole === "boolean") patch.hole = params.hole;

        // Face-sketch cutters: mirror updateShape auto-cut when MCP sets hole:true.
        if (patch.hole && target.sketchPlane?.hostShapeId) {
          const holeShape = withHoleMode(target, true, typeof patch.color === "string" ? patch.color : undefined);
          const hostId = target.sketchPlane.hostShapeId;
          const host = currentShapes().find(
            (shape) => shape.id === hostId && !shape.hole && !shape.locked && !shape.hidden,
          );
          if (!host) {
            const nextShapes = currentShapes().map((shape) => (shape.id === target.id ? holeShape : shape));
            commitShapes(nextShapes, target.id, "MCP changed selection to hole — select a solid and Group to cut");
            return { object: mcpShapeSummary(holeShape), autoCut: false, reason: "host_not_found" };
          }
          const sourceFingerprint = projectShapesFingerprint(currentShapes());
          const sourceProjectId = projectInfoRef.current.projectId;
          const result = await buildGroupedShapeFromSelection([withHoleMode(host, false), holeShape]);
          if (projectInfoRef.current.projectId !== sourceProjectId || projectShapesFingerprint(currentShapes()) !== sourceFingerprint) {
            throw new Error("The scene changed while cutting; run the command again");
          }
          if (result.group) {
            const linkedGroup = asPreservedCsgBody(host, result.group);
            commitShapes(
              currentShapes().filter((shape) => shape.id !== host.id && shape.id !== target.id).concat(linkedGroup),
              linkedGroup.id,
              `MCP cut hole into ${host.name}`,
            );
            return { object: mcpShapeSummary(linkedGroup), autoCut: true };
          }
          if (result.consumed) {
            commitShapes(
              currentShapes().filter((shape) => shape.id !== host.id && shape.id !== target.id),
              null,
              "MCP hole consumed the host solid",
            );
            return { consumed: true, autoCut: true };
          }
          const nextShapes = currentShapes().map((shape) => (shape.id === target.id ? holeShape : shape));
          commitShapes(nextShapes, target.id, result.failureNotice);
          return { object: mcpShapeSummary(holeShape), autoCut: false, reason: result.failureNotice };
        }

        const nextShapes = currentShapes().map((shape) => {
          if (shape.id !== target.id) return shape;
          const patched = { ...shape, ...cleanShapePatch(patch) };
          const width = shapeWidth(patched);
          const depth = shapeDepth(patched);
          const sized = { ...patched, size: Math.max(width, depth) };
          const canonical = canonicalizeShape(
            "hole" in patch ? withHoleMode(sized, Boolean(patch.hole), typeof patch.color === "string" ? patch.color : undefined) : sized,
          );
          return rotationWasRequested ? canonicalizeShape(bakeShapeTransformIntoMesh(canonical)) : canonical;
        });
        const updated = nextShapes.find((shape) => shape.id === target.id) as WorkplaneShape;
        commitShapes(nextShapes, target.id, `${updated.name} updated by MCP`);
        return { object: mcpShapeSummary(updated) };
      }

      if (command.action === "align_objects") {
        const axis = params.axis === "x" || params.axis === "y" || params.axis === "z" ? params.axis : null;
        const target = params.target === "min" || params.target === "center" || params.target === "max" ? params.target : null;
        if (!axis || !target) throw new Error("align_objects requires axis x/y/z and target min/center/max");
        const requestedIds = mcpStringArray(params.ids);
        const ids = requestedIds.length ? requestedIds : selectedIdsRef.current;
        const selectedForAlign = currentShapes().filter((shape) => ids.includes(shape.id));
        if (selectedForAlign.length < 2) throw new Error("Select at least two objects to align");
        const validIds = selectedForAlign.map((shape) => shape.id);
        const requestedAnchorId = typeof params.anchorId === "string" ? params.anchorId : null;
        const anchorId = effectiveAlignmentAnchorId(selectedForAlign, requestedAnchorId);
        const { nextShapes, moved } = alignedShapesForSelection(currentShapes(), validIds, selectedForAlign, anchorId, axis, target);
        if (moved === 0) {
          setSelectedIds(validIds);
          selectedIdsRef.current = validIds;
          setNotice(`MCP alignment already ${alignmentLabel(axis, target)}`);
          return {
            moved,
            selectedIds: validIds,
            anchorId,
            objects: selectedForAlign.map(mcpShapeSummary),
          };
        }
        commitShapes(nextShapes, validIds, `MCP aligned ${moved} object${moved === 1 ? "" : "s"} ${alignmentLabel(axis, target)}`);
        return {
          moved,
          selectedIds: validIds,
          anchorId,
          objects: nextShapes.filter((shape) => validIds.includes(shape.id)).map(mcpShapeSummary),
        };
      }

      if (command.action === "group_objects") {
        const ids = new Set(mcpStringArray(params.ids));
        const groupable = currentShapes().filter((shape) => ids.has(shape.id));
        if (groupable.length < 2) throw new Error("Select at least two objects to group");
        if (groupable.some((shape) => shape.locked)) throw new Error("Unlock every selected object before grouping");
        const sourceFingerprint = projectShapesFingerprint(currentShapes());
        const sourceProjectId = projectInfoRef.current.projectId;
        const result = await buildGroupedShapeFromSelection(groupable);
        if (projectInfoRef.current.projectId !== sourceProjectId || projectShapesFingerprint(currentShapes()) !== sourceFingerprint) {
          throw new Error("The scene changed while grouping; run the command again");
        }
        if (!result.group) {
          if (result.consumed) {
            commitShapes(currentShapes().filter((shape) => !ids.has(shape.id)), null, "MCP group consumed solid");
            return { consumed: true, objects: currentShapes().filter((shape) => !ids.has(shape.id)).map(mcpShapeSummary) };
          }
          throw new Error(result.failureNotice);
        }
        const leftOutIds = new Set((result.leftOutShapes ?? []).map((shape) => shape.id));
        const groupedIds = new Set(groupable.filter((shape) => !leftOutIds.has(shape.id)).map((shape) => shape.id));
        commitShapes([...currentShapes().filter((shape) => !groupedIds.has(shape.id)), result.group], result.group.id, `MCP grouped ${groupedIds.size} objects`);
        flashCadApply(result.group.id, undefined, "combine");
        return { object: mcpShapeSummary(result.group) };
      }

      if (command.action === "ungroup_objects") {
        const requestedIds = mcpStringArray(params.ids ?? params.id);
        const ids = requestedIds.length ? new Set(requestedIds) : new Set(selectedIdsRef.current);
        const groups = currentShapes().filter((shape) => ids.has(shape.id) && shape.groupedShapes?.length);
        if (groups.length === 0) throw new Error("Select at least one group to ungroup");
        const targetId = pickGroupToUngroup(
          requestedIds.length ? requestedIds : selectedIdsRef.current,
          groups.map((group) => group.id),
        );
        const target = groups.find((group) => group.id === targetId) ?? groups[groups.length - 1];
        const restored = restoreGroupedChildren(target);
        commitShapes(
          [...currentShapes().filter((shape) => shape.id !== target.id), ...restored],
          restored.map((shape) => shape.id),
          "MCP ungrouped last group",
        );
        flashCadApply(restored.map((shape) => shape.id), undefined, "separate");
        return { objects: restored.map(mcpShapeSummary) };
      }

      if (command.action === "tie_objects") {
        const ids = new Set(mcpStringArray(params.ids));
        const groupable = currentShapes().filter((shape) => ids.has(shape.id) && !isConstructionShape(shape));
        if (groupable.length < 2) throw new Error("Select at least two objects to tie");
        if (groupable.some((shape) => shape.locked)) throw new Error("Unlock every object before tying");
        const assembly = groupedShape(groupable);
        if (!assembly) throw new Error("Could not tie this selection");
        let linked = assembly;
        groupable.forEach((shape, index) => {
          const child = linked.groupedShapes?.[index];
          if (child) linked = rewriteSketchHostIds(linked, shape.id, child.id);
        });
        commitShapes(
          [...currentShapes().filter((shape) => !ids.has(shape.id)), linked],
          linked.id,
          `Tied ${groupable.length} shapes`,
        );
        flashCadApply(linked.id, undefined, "combine");
        return { object: mcpShapeSummary(linked) };
      }

      if (command.action === "intersect_objects") {
        const ids = new Set(mcpStringArray(params.ids));
        const groupable = currentShapes().filter((shape) => ids.has(shape.id) && !shape.locked);
        if (!groupable.some((shape) => !shape.hole) || !groupable.some((shape) => shape.hole)) {
          throw new Error("Intersect needs at least one solid and one hole");
        }
        const sourceFingerprint = projectShapesFingerprint(currentShapes());
        const sourceProjectId = projectInfoRef.current.projectId;
        const result = await buildIntersectionShapeFromSelection(groupable);
        if (projectInfoRef.current.projectId !== sourceProjectId || projectShapesFingerprint(currentShapes()) !== sourceFingerprint) {
          throw new Error("The scene changed while intersecting; run the command again");
        }
        const remaining = currentShapes().filter((shape) => !ids.has(shape.id));
        if (result.empty || !result.group) {
          if (result.empty) {
            commitShapes(remaining, null, "Intersection is empty");
            return { empty: true };
          }
          throw new Error(result.failureNotice);
        }
        commitShapes([...remaining, result.group], result.group.id, `Intersected ${groupable.length} shapes`);
        flashCadApply(result.group.id, undefined, "combine");
        return { object: mcpShapeSummary(result.group) };
      }

      if (command.action === "mirror_objects") {
        const requested = mcpStringArray(params.ids ?? params.id);
        const chosen = requested.length ? requested : selectedIdsRef.current;
        const axis = params.axis === "y" || params.axis === "z" ? params.axis : "x";
        const chosenShapes = currentShapes().filter((shape) => chosen.includes(shape.id));
        const { nextShapes, moved } = mirroredShapesForSelection(currentShapes(), chosen, chosenShapes, axis);
        if (moved === 0) throw new Error("Nothing to mirror");
        commitShapes(nextShapes, chosen, `Mirrored ${moved} shape${moved === 1 ? "" : "s"}`);
        return { moved, objects: nextShapes.filter((shape) => chosen.includes(shape.id)).map(mcpShapeSummary) };
      }

      if (command.action === "circular_pattern") {
        const ids = mcpStringArray(params.ids ?? params.id);
        const sources = currentShapes().filter((shape) => ids.includes(shape.id) && !shape.locked && !isConstructionShape(shape));
        if (sources.length === 0) throw new Error("Choose at least one unlocked object");
        const center = typeof params.centerX === "number" && typeof params.centerZ === "number"
          ? { x: params.centerX, z: params.centerZ }
          : defaultCircularPatternCenter(sources);
        const radius = clampCircularPatternRadius(mcpNumber(params.radius, circularPatternSuggestedRadius(sources, center)));
        const count = clampCircularPatternCount(mcpNumber(params.count, CIRCULAR_PATTERN_DEFAULT_COUNT));
        const rotation = clampCircularPatternRotation(mcpNumber(params.rotation, 0));
        const preview = circularPatternInstances(sources, center, count, {
          radius,
          rotationOffset: rotation,
          createId: circularPatternCopyId,
        });
        const sourceIds = new Set(sources.map((shape) => shape.id));
        let tagged: WorkplaneShape[] = [];
        for (const source of sources) {
          const instances = preview.filter((shape) => shape.id === source.id || shape.id.startsWith(`${source.id}__circular_pattern__`));
          tagged = tagged.concat(tagCircularPatternInstances(
            instances.length ? instances : [source],
            source,
            { count, center, radius, rotationOffset: rotation },
            patternFeatureId(),
          ));
        }
        commitShapes(
          currentShapes().filter((shape) => !sourceIds.has(shape.id)).concat(tagged),
          tagged.map((shape) => shape.id),
          `Circular pattern ×${count}`,
        );
        return { count, radius, objects: tagged.map(mcpShapeSummary) };
      }

      if (command.action === "linear_pattern") {
        const ids = mcpStringArray(params.ids ?? params.id);
        const sources = currentShapes().filter((shape) => ids.includes(shape.id) && !shape.locked && !isConstructionShape(shape));
        if (sources.length === 0) throw new Error("Choose at least one unlocked object");
        const session = {
          countX: clampLinearPatternCount(mcpNumber(params.countX, LINEAR_PATTERN_DEFAULT_COUNT_X)),
          countZ: clampLinearPatternCount(mcpNumber(params.countZ, LINEAR_PATTERN_DEFAULT_COUNT_Z)),
          countY: clampLinearPatternCount(mcpNumber(params.countY, LINEAR_PATTERN_DEFAULT_COUNT_Y)),
          spacingX: clampLinearPatternSpacing(mcpNumber(params.spacingX, linearPatternSuggestedSpacing(sources, "x"))),
          spacingZ: clampLinearPatternSpacing(mcpNumber(params.spacingZ, linearPatternSuggestedSpacing(sources, "z"))),
          spacingY: clampLinearPatternSpacing(mcpNumber(params.spacingY, linearPatternSuggestedSpacing(sources, "y"))),
        };
        const preview = linearPatternInstances(sources, session, session);
        const sourceIds = new Set(sources.map((shape) => shape.id));
        let tagged: WorkplaneShape[] = [];
        for (const source of sources) {
          const instances = preview.filter((shape) => shape.id === source.id || shape.id.startsWith(`${source.id}__linear_pattern__`));
          tagged = tagged.concat(tagLinearPatternInstances(
            instances.length ? instances : [source],
            source,
            session,
            patternFeatureId(),
          ));
        }
        commitShapes(
          currentShapes().filter((shape) => !sourceIds.has(shape.id)).concat(tagged),
          tagged.map((shape) => shape.id),
          `Linear pattern ×${tagged.length}`,
        );
        return { ...session, objects: tagged.map(mcpShapeSummary) };
      }

      if (command.action === "duplicate_objects") {
        const ids = mcpStringArray(params.ids ?? params.id);
        const sources = currentShapes().filter((shape) => (ids.length ? ids.includes(shape.id) : selectedIdsRef.current.includes(shape.id)));
        if (sources.length === 0) throw new Error("Choose at least one object to duplicate");
        const duplicates = sources.map((shape) => createDuplicateForRepeat(shape, createLocalId(`${shape.id}-copy`)));
        commitShapes(
          [...currentShapes(), ...duplicates],
          duplicates.map((shape) => shape.id),
          `Duplicated ${duplicates.length} shape${duplicates.length === 1 ? "" : "s"}`,
        );
        return { objects: duplicates.map(mcpShapeSummary) };
      }

      if (command.action === "hide_objects") {
        const ids = mcpStringArray(params.ids ?? params.id);
        const chosen = new Set(ids.length ? ids : selectedIdsRef.current);
        if (chosen.size === 0) throw new Error("Choose at least one object");
        const hidden = typeof params.hidden === "boolean" ? params.hidden : true;
        commitShapes(
          currentShapes().map((shape) => chosen.has(shape.id) && !shape.locked ? { ...shape, hidden } : shape),
          [...chosen],
          hidden ? "Hidden by a model" : "Shown by a model",
        );
        return { hidden, ids: [...chosen] };
      }

      if (command.action === "drop_objects") {
        const ids = mcpStringArray(params.ids ?? params.id);
        const chosen = new Set(ids.length ? ids : selectedIdsRef.current);
        if (chosen.size === 0) throw new Error("Choose at least one object");
        commitShapes(
          currentShapes().map((shape) => chosen.has(shape.id) && !shape.locked
            ? { ...shape, ...dropPatchOntoFrame(shape, meshAabb(shape)) }
            : shape),
          [...chosen],
          "Dropped onto the workplane",
        );
        return { ids: [...chosen] };
      }

      if (command.action === "undo" || command.action === "redo") {
        if (projectInteractionActiveRef.current) throw new Error("Finish the current drag before changing history");
        const currentIndex = historyIndexRef.current;
        const nextIndex = command.action === "undo" ? currentIndex - 1 : currentIndex + 1;
        if (nextIndex < 0 || nextIndex >= historyRef.current.length) {
          throw new Error(command.action === "undo" ? "Nothing to undo" : "Nothing to redo");
        }
        await restoreHistoryEntry(nextIndex, command.action === "undo" ? "Undo" : "Redo", false);
        return { historyIndex: nextIndex, shapeCount: shapesRef.current.length };
      }

      if (command.action === "reduce_mesh") {
        const target = findShape(params.id) ?? (selectedIdsRef.current.length === 1 ? findShape(selectedIdsRef.current[0]) : null);
        if (!target?.importedMesh) throw new Error("Choose an imported mesh");
        if (target.locked) throw new Error("Unlock the object before reducing it");
        const patch = await simplifiedImportedShapePatch(target, mcpNumber(params.keepFraction, 0.5));
        if (!patch?.importedMesh) throw new Error("Could not reduce this mesh");
        const next = { ...target, ...patch };
        commitShapes(
          currentShapes().map((shape) => shape.id === target.id ? next : shape),
          next.id,
          `Reduced ${target.name}`,
        );
        return { object: mcpShapeSummary(next), triangleCount: patch.importedMesh.triangleCount };
      }

      if (command.action === "export_model") {
        const format = params.format === "obj" || params.format === "3mf" || params.format === "stl" ? params.format : "stl";
        const ids = mcpStringArray(params.ids ?? params.id);
        const source = (ids.length
          ? currentShapes().filter((shape) => ids.includes(shape.id))
          : selectedIdsRef.current.length
            ? currentShapes().filter((shape) => selectedIdsRef.current.includes(shape.id))
            : currentShapes()
        ).filter((shape) => !shape.hole && !isConstructionShape(shape));
        if (source.length === 0) throw new Error("Nothing to export");
        const fileName = projectExportFileName(projectInfoRef.current.projectName, format);
        if (format === "3mf") {
          const exported = to3mfForShapes(source);
          await downloadBlobFile(fileName, exported.bytes, "model/3mf");
          return { fileName, format, count: source.length };
        }
        const meshes = source.map(meshForShape);
        if (format === "obj") {
          await downloadTextFile(fileName, toObj(meshes), "text/plain");
        } else {
          await downloadBlobFile(fileName, toStl(meshes), "model/stl");
        }
        return { fileName, format, count: source.length };
      }

      if (command.action === "boolean_cut") {
        const solidIds = new Set(mcpStringArray(params.solidIds ?? params.solids));
        const holeIds = new Set(mcpStringArray(params.holeIds ?? params.holes));
        const operandIds = new Set([...solidIds, ...holeIds]);
        const operands = currentShapes()
          .filter((shape) => operandIds.has(shape.id))
          .map((shape) => holeIds.has(shape.id) ? withHoleMode(shape, true) : withHoleMode(shape, false));
        if (!operands.some((shape) => !shape.hole) || !operands.some((shape) => shape.hole)) {
          throw new Error("Provide at least one solidId and one holeId for boolean_cut");
        }
        if (operands.some((shape) => shape.locked)) {
          throw new Error("Unlock every boolean operand before cutting");
        }
        const sourceFingerprint = projectShapesFingerprint(currentShapes());
        const sourceProjectId = projectInfoRef.current.projectId;
        const result = await buildGroupedShapeFromSelection(operands);
        if (projectInfoRef.current.projectId !== sourceProjectId || projectShapesFingerprint(currentShapes()) !== sourceFingerprint) {
          throw new Error("The scene changed while cutting; run the command again");
        }
        const remainingShapes = currentShapes().filter((shape) => !operandIds.has(shape.id));
        if (result.consumed) {
          commitShapes(remainingShapes, null, "MCP cut consumed solid");
          return { consumed: true };
        }
        if (!result.group) {
          throw new Error(result.failureNotice);
        }
        commitShapes([...remainingShapes, result.group], result.group.id, "MCP boolean cut complete");
        flashCadApply(result.group.id, undefined, "combine");
        return { object: mcpShapeSummary(result.group) };
      }

      if (command.action === "separate_parts") {
        const target = findShape(params.id) ?? (selectedIdsRef.current.length === 1 ? findShape(selectedIdsRef.current[0]) : null);
        if (!target) throw new Error("Select one object to separate");
        if (target.locked) throw new Error("Unlock the object before separating parts");
        const parts = separateShapeParts(target);
        if (parts.length <= 1) throw new Error("The selected object has only one connected part");
        commitShapes([...currentShapes().filter((shape) => shape.id !== target.id), ...parts], parts.map((shape) => shape.id), `MCP separated ${parts.length} parts`);
        return { objects: parts.map(mcpShapeSummary) };
      }

      if (command.action === "list_edges") {
        const target = findShape(params.id);
        if (!target) throw new Error("Object not found");
        invalidateCadModifierSession();
        const sharpAngle = Math.max(1, Math.min(CAD_MODIFIER_MAX_SHARP_ANGLE, mcpNumber(params.sharpAngle, 25)));
        const { response } = await prepareCadModifierForMcp(target, sharpAngle);
        const selectableEdgeIds = response.edges.filter((edge) => selectableCadModifierEdge(edge, sharpAngle)).map((edge) => edge.id);
        return { object: mcpShapeSummary(target), sharpAngle, selectableEdgeIds, edges: response.edges };
      }

      if (command.action === "apply_edge_treatment") {
        const target = findShape(params.id);
        if (!target) throw new Error("Object not found");
        return applyCadModifierForMcp(target, params);
      }

      if (command.action === "edit_sketch") {
        const raw = findShape(params.id)
          ?? (typeof params.id === "string" ? findShapeInTree(currentShapes(), params.id) : null)
          ?? (selectedIdsRef.current[0] ? findShape(selectedIdsRef.current[0]) : null);
        const target = resolveEditableSketchShape(raw, { preferFaceFeatures: true });
        if (!target || !shapeHasEditableSketch(target)) throw new Error("edit_sketch requires a sketched solid or face sketch feature id");
        const session = beginEditSketchSession(target, "3d");
        if (!session?.doc) throw new Error("Shape has no editable sketch document");
        const profile = target.sketchProfile ?? sketchDocToProfile(session.doc);
        beginSketch(profile, target.id, target.sketchPlane ?? session.doc.plane, session.doc);
        return {
          editingShapeId: target.id,
          sketchId: session.doc.id,
          status: solveSketchDoc(session.doc).status,
          constraintCount: session.doc.constraints.length,
          dimensionCount: session.doc.dimensions.length,
        };
      }

      if (command.action === "set_sketch_dimension") {
        const raw = findShape(params.id)
          ?? (typeof params.id === "string" ? findShapeInTree(currentShapes(), params.id) : null)
          ?? (selectedIdsRef.current[0] ? findShape(selectedIdsRef.current[0]) : null);
        const target = resolveEditableSketchShape(raw);
        if (!target?.sketchDoc) throw new Error("set_sketch_dimension requires a sketched solid with sketchDoc");
        const dimensionId = typeof params.dimensionId === "string" ? params.dimensionId : target.sketchDoc.dimensions[0]?.id;
        const value = typeof params.value === "number" ? params.value : Number.NaN;
        if (!dimensionId || !Number.isFinite(value) || value <= 0) throw new Error("Provide dimensionId and a positive value");
        const solved = setDrivingDimensionValue(target.sketchDoc, dimensionId, value);
        const profile = sketchDocToProfile(solved.doc);
        profile.sketchPlane = target.sketchPlane ?? profile.sketchPlane;
        const rebuilt = shapeFromSketchProfile(profile, target.height, {
          ...target,
          sketchDoc: solved.doc,
          sketchId: target.sketchId ?? solved.doc.id,
        }, {
          cutIntoFace: Boolean(target.hole && isFaceHostedSketch(target.sketchPlane, target.sketchProfile?.faceReferenceLoops)),
        });
        if (!rebuilt) throw new Error("Could not rebuild sketch after dimension change");
        rebuilt.sketchDoc = solved.doc;
        rebuilt.hole = target.hole;
        rebuilt.color = target.color;
        const owner = findCsgBodyOwningLeaf(currentShapes(), target.id);
        if (owner) {
          const remeshGen = remeshGenerationRef.current + 1;
          remeshGenerationRef.current = remeshGen;
          const { body, remeshed } = await updateCsgLeafAndRemesh(owner, target.id, rebuilt);
          if (remeshGen !== remeshGenerationRef.current) {
            return { object: mcpShapeSummary(owner), dimensionId, value, status: solved.status, dof: solved.dof, remeshed: false, stale: true };
          }
          commitShapes(
            currentShapes().map((shape) => (shape.id === owner.id ? body : shape)),
            body.id,
            `MCP sketch dimension → ${value.toFixed(2)} mm`,
          );
          if (!remeshed) {
            setNotice("Could not remesh after dimension change — last good mesh kept. Ungroup then Group to retry.");
          }
          return {
            object: mcpShapeSummary(body),
            dimensionId,
            value,
            status: solved.status,
            dof: solved.dof,
            remeshed,
          };
        }
        commitShapes(
          currentShapes().map((shape) => (shape.id === target.id ? rebuilt : shape)),
          rebuilt.id,
          `MCP sketch dimension → ${value.toFixed(2)} mm`,
        );
        return {
          object: mcpShapeSummary(rebuilt),
          dimensionId,
          value,
          status: solved.status,
          dof: solved.dof,
        };
      }

      if (command.action === "inspect_errors") {
        return {
          notice: noticeRef.current,
          edgeModifierError: edgeModifierRef.current?.error ?? null,
          lastMcpError: lastMcpErrorRef.current,
        };
      }

      if (command.action === "capture_image") {
        const face = mcpString(params.face, "current") as SketchForgeMcpViewFace;
        const image = await (window.sketchforgeCaptureView?.(face) ?? window.sketchforgeCaptureCanvas?.() ?? "");
        if (!image || image.length < 100) {
          throw new Error("The PeakCAD viewport did not return an image");
        }
        return { face, dataUrl: image, bytesApprox: Math.floor(image.length * 0.75) };
      }

      if (command.action === "hollow") {
        const target = findShape(params.id);
        if (!target) throw new Error("Object not found");
        if (target.locked || target.hole) throw new Error("Select one unlocked solid");
        const openings = (Array.isArray(params.openings) ? params.openings : ["top"]).filter(
          (side): side is ShellSide => typeof side === "string" && (SHELL_SIDES as readonly string[]).includes(side),
        );
        if (openings.length === 0) openings.push("top");
        const maxWall = shellMaxThickness(
          { width: shapeWidth(target), depth: shapeDepth(target), height: target.height },
          openings,
        );
        const thickness = Math.min(Math.max(0.2, mcpNumber(params.thickness, 2)), maxWall);
        const corners = params.corners === "round" ? "round" : "sharp";
        const cornerRadius = Math.min(Math.max(0.2, mcpNumber(params.cornerRadius, thickness)), thickness);
        invalidateCadModifierSession();
        await prepareCadModifierForMcp(target, 12);
        const preview = await postCadModifierRequestAsync({
          type: "hollow",
          thickness,
          openings,
          corners,
          cornerRadius,
          quality: "standard",
        }, [], 60000);
        if (preview.type !== "preview") throw new Error("Could not hollow that object");
        const raw = shapeFromCadMesh(target, preview.positions, preview.normals, preview.indices, preview.brep, preview.step);
        if (!raw) throw new Error("The hollow result was empty");
        const next = canonicalizeShape({
          ...raw,
          cadDisplayEdges: cadDisplayEdgesForShape(raw, preview.displayEdges),
          cadDisplayEdgesVersion: 2 as const,
        });
        commitShapes(
          currentShapes().map((shape) => shape.id === target.id ? next : shape),
          next.id,
          "Hollowed by a model",
        );
        return { object: mcpShapeSummary(next), thickness, openings };
      }

      if (command.action === "split") {
        const target = findShape(params.id);
        if (!target) throw new Error("Object not found");
        if (target.locked) throw new Error("Unlock the object before splitting it");
        const axis = params.axis === "y" || params.axis === "z" ? params.axis : "x";
        const parts = splitShapeWithPlane(target, { axis, offset: mcpNumber(params.offset, 0) });
        if (parts.length < 2) throw new Error("The cut has to cross the object");
        commitShapes(
          currentShapes().flatMap((entry) => entry.id === target.id ? parts : [entry]),
          parts.map((part) => part.id),
          "Split by a model",
        );
        return { objects: parts.map(mcpShapeSummary) };
      }

      if (command.action === "snap_faces" || command.action === "lay_flat") {
        const sideOf = (value: unknown) => {
          const side = typeof value === "string" ? value : "";
          return (SHELL_SIDES as readonly string[]).includes(side) ? side as ShellSide : null;
        };
        if (command.action === "lay_flat") {
          const target = findShape(params.id);
          const faceName = sideOf(params.face);
          if (!target || !faceName) throw new Error("Choose an object and a face");
          if (target.locked) throw new Error("Unlock the object before laying it flat");
          const face = faceSampleForSide(target, faceName);
          const pose = face ? layFaceOnWorkplane(target, face) : null;
          if (!pose) throw new Error("Could not lay that face flat");
          const next = { ...target, ...pose };
          commitShapes(currentShapes().map((shape) => shape.id === target.id ? next : shape), target.id, "Laid flat by a model");
          return { object: mcpShapeSummary(next) };
        }
        const source = findShape(params.sourceId);
        const target = findShape(params.targetId);
        const sourceFaceName = sideOf(params.sourceFace);
        const targetFaceName = sideOf(params.targetFace);
        if (!source || !target || !sourceFaceName || !targetFaceName) throw new Error("Choose two objects and a face on each");
        if (source.locked) throw new Error("Unlock the object before snapping it");
        const sourceFace = faceSampleForSide(source, sourceFaceName);
        const targetFace = faceSampleForSide(target, targetFaceName);
        const pose = sourceFace && targetFace ? faceToFaceMate(source, sourceFace, target, targetFace) : null;
        if (!pose) throw new Error("Could not snap those faces");
        const next = { ...source, ...pose };
        commitShapes(currentShapes().map((shape) => shape.id === source.id ? next : shape), source.id, "Snapped faces by a model");
        return { object: mcpShapeSummary(next) };
      }

      if (command.action === "create_thread") {
        const role = params.role === "screw" || params.role === "nut" || params.role === "bore" ? params.role : "rod";
        const head = params.head === "countersunk" || params.head === "hex" ? params.head : "cylinder";
        const designation = mcpString(params.designation, DEFAULT_THREAD_DESIGNATION);
        const nextShape = createThreadShape({
          designation,
          height: typeof params.length === "number" ? params.length : undefined,
          point: { x: mcpNumber(params.x, 0), z: mcpNumber(params.z, 0), elevation: mcpNumber(params.elevation, 0) },
          base: {
            id: createLocalId("thread"),
            name: typeof params.name === "string" && params.name.trim() ? params.name.trim() : "Threads",
            color: "#d97813",
            threadSpec: {
              designation,
              majorDiameter: 1,
              pitch: 1,
              role,
              head,
              part: role === "rod" ? "shaft" : "screw",
            },
          },
        });
        commitShapes([...currentShapes(), nextShape], nextShape.id, `${nextShape.name} added by a model`);
        return { object: mcpShapeSummary(nextShape) };
      }

      if (command.action === "sketch") {
        const rawShapes = Array.isArray(params.shapes)
          ? params.shapes.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
          : [];
        if (rawShapes.length === 0) throw new Error("sketch needs shapes, such as a rectangle, circle, or line");
        const parts = rawShapes.map((spec) => {
          const geometry = geometryForSketchPart(spec);
          if (!geometry) throw new Error(`Could not draw sketch ${typeof spec.kind === "string" ? spec.kind : "shape"}`);
          return geometry;
        });
        const profile = composeSketchProfile(parts);
        const host = typeof params.hostShapeId === "string"
          ? currentShapes().find((shape) => shape.id === params.hostShapeId && !shape.hole && !shape.hidden)
          : undefined;
        const faceName = typeof params.face === "string" && (SHELL_SIDES as readonly string[]).includes(params.face)
          ? params.face as ShellSide
          : host ? "top" as const : null;
        let plane = {
          ...defaultSketchPlane(host?.id),
          origin: {
            x: mcpNumber(params.x, 0),
            y: mcpNumber(params.elevation, 0),
            z: mcpNumber(params.z, 0),
          },
        };
        if (host && faceName) {
          const sample = faceSampleForSide(host, faceName);
          if (!sample) throw new Error("Could not read that face");
          const normal = new THREE.Vector3(...sample.normal).normalize();
          const helper = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
          const uAxis = new THREE.Vector3().crossVectors(helper, normal);
          if (uAxis.lengthSq() < 1e-8) uAxis.set(1, 0, 0);
          uAxis.normalize();
          plane = {
            origin: { x: sample.point[0], y: sample.point[1], z: sample.point[2] },
            normal: { x: normal.x, y: normal.y, z: normal.z },
            uAxis: { x: uAxis.x, y: uAxis.y, z: uAxis.z },
            hostShapeId: host.id,
          };
        }
        profile.sketchPlane = plane;
        const height = Math.max(0.5, mcpNumber(params.height, 10));
        const asHole = params.hole === true;
        const finish = params.finish === "revolve" ? "revolve" : "extrude";
        let sketched: WorkplaneShape | null;
        if (finish === "revolve") {
          const minX = Math.min(...profile.points.map((point) => point.x));
          const axis: SketchRevolveAxis = {
            start: { x: mcpNumber(params.axisX1, minX), z: mcpNumber(params.axisZ1, -10) },
            end: { x: mcpNumber(params.axisX2, minX), z: mcpNumber(params.axisZ2, 10) },
          };
          sketched = shapeFromSketchRevolve(profile, axis);
        } else {
          sketched = shapeFromSketchProfile(profile, height, null, { cutIntoFace: Boolean(asHole && host) });
        }
        if (!sketched) throw new Error("Close at least one profile before finishing the sketch");
        sketched = canonicalizeShape({
          ...sketched,
          name: mcpString(params.name, finish === "revolve" ? "Sketch revolve" : "Sketch"),
          color: typeof params.color === "string" ? params.color : sketched.color,
        });
        if (asHole) sketched = withHoleMode(sketched, true);
        if (host) {
          const operands = asHole
            ? [withHoleMode(host, false), sketched]
            : [withHoleMode(host, false), withHoleMode(sketched, false, sketched.color)];
          const sourceFingerprint = projectShapesFingerprint(currentShapes());
          const sourceProjectId = projectInfoRef.current.projectId;
          const result = await buildGroupedShapeFromSelection(operands);
          if (projectInfoRef.current.projectId !== sourceProjectId || projectShapesFingerprint(currentShapes()) !== sourceFingerprint) {
            throw new Error("The scene changed while sketching; run the command again");
          }
          if (!result.group) throw new Error(result.failureNotice);
          const linked = asPreservedCsgBody(host, result.group);
          commitShapes(
            currentShapes().filter((shape) => shape.id !== host.id).concat(linked),
            linked.id,
            asHole ? `Sketch hole cut into ${host.name}` : `Sketch joined to ${host.name}`,
          );
          return { object: mcpShapeSummary(linked), finish };
        }
        const placed = canonicalizeShape(bakeShapeTransformIntoMesh(sketched));
        commitShapes([...currentShapes(), placed], placed.id, `${placed.name} sketched`);
        return { object: mcpShapeSummary(placed), finish };
      }

      if (command.action === "export_step") {
        const ids = mcpStringArray(params.ids ?? params.id);
        const source = ids.length
          ? currentShapes().filter((shape) => ids.includes(shape.id))
          : selectedIdsRef.current.length
            ? currentShapes().filter((shape) => selectedIdsRef.current.includes(shape.id))
            : currentShapes();
        if (source.length === 0) throw new Error("Nothing to export");
        const { exportShapesToStep } = await import("@/lib/stepExport");
        const exported = await exportShapesToStep(source);
        const text = await exported.blob.text();
        const fileName = projectExportFileName(projectInfoRef.current.projectName, "step");
        await downloadTextFile(fileName, text, "application/step");
        return {
          fileName,
          exactCount: exported.exactCount,
          facetedCount: exported.facetedCount,
          skipped: exported.skipped,
          degraded: exported.degraded,
          step: text.length > 1_500_000 ? undefined : text,
          stepOmitted: text.length > 1_500_000,
        };
      }

      throw new Error(`Unknown MCP command: ${command.action}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastMcpErrorRef.current = message;
      setNotice(message);
      throw error;
    }
  }, [
    applyCadModifierForMcp,
    beginSketch,
    commitShapes,
    initialSnap,
    invalidateCadModifierSession,
    mcpSceneSnapshot,
    postCadModifierRequestAsync,
    prepareCadModifierForMcp,
    restoreHistoryEntry,
  ]);

  useEffect(() => {
    executeMcpCommandRef.current = executeMcpCommand;
  }, [executeMcpCommand]);

  const stopModels = useCallback(() => {
    writeModelsEnabled(false);
    sessionStorage.removeItem(modelGrantKey(projectInfoRef.current.projectId));
    modelConsentSettleRef.current?.("deny");
    setModelPrompt(null);
    setModelConnected(false);
    setModelAction("");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
      return;
    }

    const identity = readMcpEditorIdentity();
    let stopped = false;
    let polling = false;

    const submitResult = (commandId: string, ok: boolean, data?: unknown, error?: string) => {
      void fetch(SKETCHFORGE_MCP_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "result",
          editorId: identity.editorId,
          result: { commandId, ok, data, error, completedAt: Date.now() },
        }),
      }).catch(() => undefined);
    };

    const poll = async () => {
      if (polling || stopped || document.hidden) return;
      polling = true;
      try {
        const response = await fetch(SKETCHFORGE_MCP_ROUTE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "poll",
            editorId: identity.editorId,
            waitMs: SKETCHFORGE_MCP_POLL_WAIT_MS,
          }),
        });
        const payload = (await response.json().catch(() => null)) as { command?: SketchForgeMcpCommand | null } | null;
        const command = payload?.command;
        if (command) {
          const label = modelActionLabel(command.action);
          setModelAction(label);
          try {
            if (modelActionNeedsConsent(command.action)) {
              const grantKey = modelGrantKey(projectInfoRef.current.projectId);
              if (sessionStorage.getItem(grantKey) !== "project") {
                const choice = await new Promise<"once" | "project" | "deny">((resolve) => {
                  modelConsentSettleRef.current = resolve;
                  setModelPrompt({ clientName: command.clientName || "A model", label });
                });
                modelConsentSettleRef.current = null;
                setModelPrompt(null);
                if (choice === "deny") throw new Error("PeakCAD declined this change");
                if (choice === "project") sessionStorage.setItem(grantKey, "project");
              }
            }
            const data = await executeMcpCommandRef.current?.(command);
            submitResult(command.id, true, data);
          } catch (error) {
            submitResult(command.id, false, undefined, error instanceof Error ? error.message : String(error));
          }
        }
      } catch {
        // The local bridge may not exist while static builds or tests render the editor.
      } finally {
        polling = false;
      }
    };

    let listening = false;
    let loopActive = false;
    const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
    const pollLoop = async () => {
      loopActive = true;
      try {
        while (!stopped && listening) {
          if (document.hidden) {
            await sleep(1000);
            continue;
          }
          await poll();
          if (stopped || !listening) return;
          await sleep(SKETCHFORGE_MCP_POLL_MS);
        }
      } finally {
        loopActive = false;
      }
    };
    const stopPoll = () => {
      listening = false;
    };
    const startPoll = () => {
      listening = true;
      if (loopActive) return;
      void pollLoop();
    };
    const heartbeatAndListen = async () => {
      if (stopped) return;
      try {
        const projectInfo = projectInfoRef.current;
        const currentShapes = shapesRef.current;
        const response = await fetch(SKETCHFORGE_MCP_ROUTE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "heartbeat",
            editor: {
              ...identity,
              projectId: projectInfo.projectId,
              projectName: projectInfo.projectName,
              url: window.location.href,
              focused: document.visibilityState === "visible" && document.hasFocus(),
              shapeCount: currentShapes.length,
              selectedCount: selectedIdsRef.current.length,
              notice: noticeRef.current,
              lastError: edgeModifierRef.current?.error ?? lastMcpErrorRef.current,
              modelsEnabled: readModelsEnabled(),
            },
          }),
        });
        const payload = (await response.json().catch(() => null)) as { listen?: boolean; clientName?: string } | null;
        const connected = Boolean(payload?.listen) && readModelsEnabled();
        setModelConnected(connected);
        if (payload?.clientName) setModelAction((current) => current || payload.clientName || "");
        if (connected) startPoll();
        else stopPoll();
      } catch {
        stopPoll();
      }
    };

    const onWake = () => void heartbeatAndListen();
    void heartbeatAndListen();
    const heartbeatTimer = window.setInterval(onWake, 2000);
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      stopped = true;
      window.clearInterval(heartbeatTimer);
      stopPoll();
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") {
      return;
    }
    if (!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const caseId = params.get("codexBooleanCase");
    if (!caseId) {
      return;
    }

    const modeParam = params.get("codexBooleanMode");
    const mode: BooleanAutomationMode = modeParam === "before" || modeParam === "ungroup" ? modeParam : "after";
    const runKey = `${caseId}:${mode}`;
    if (booleanAutomationRunRef.current === runKey) {
      return;
    }
    booleanAutomationRunRef.current = runKey;
    document.body.dataset.codexBooleanTestDone = "running";
    delete document.body.dataset.codexBooleanTestResult;
    delete document.body.dataset.codexBooleanTestImageReady;
    delete document.body.dataset.codexBooleanTestScreenshotPath;

    const finish = (detail: BooleanAutomationResult) => {
      window.__sketchforgeBooleanTest = detail;
      const captureCanvas = () => {
        try {
          const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
          const image = window.sketchforgeCaptureCanvas?.() ?? canvas?.toDataURL("image/png") ?? "";
          if (image.length > 100) {
            window.__sketchforgeBooleanTestImage = image;
            document.body.dataset.codexBooleanTestImageReady = "true";
            void fetch("/api/codex-screenshot", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: `boolean-${detail.caseId}-${detail.mode}.png`, dataUrl: image }),
            })
              .then((response) => (response.ok ? response.json() : null))
              .then((payload: { path?: string } | null) => {
                if (payload?.path) {
                  document.body.dataset.codexBooleanTestScreenshotPath = payload.path;
                }
              })
              .catch(() => {
                document.body.dataset.codexBooleanTestImageReady = "false";
              });
          }
        } catch {
          document.body.dataset.codexBooleanTestImageReady = "false";
        }
      };
      const publish = () => {
        document.body.dataset.codexBooleanTestDone = detail.ok ? "true" : "false";
        document.body.dataset.codexBooleanTestResult = JSON.stringify(detail);
        window.dispatchEvent(new CustomEvent("sketchforge:boolean-test-done", { detail }));
      };
      publish();
      window.setTimeout(publish, 100);
      window.setTimeout(captureCanvas, 1000);
      window.setTimeout(captureCanvas, 1800);
    };

    const run = async () => {
      const testCase = booleanAutomationScene(caseId);
      if (!testCase) {
        finish({
          ok: false,
          caseId,
          label: "Unknown boolean test",
          mode,
          notice: "Unknown boolean automation case",
          shapeCount: 0,
          selectedCount: 0,
          error: `Unknown boolean automation case: ${caseId}`,
        });
        return;
      }

      const ids = testCase.shapes.map((shape) => shape.id);
      if (mode === "before") {
        const noticeText = `Boolean test before: ${testCase.label}`;
        commitShapes(testCase.shapes, ids, noticeText);
        finish({
          ok: true,
          caseId,
          label: testCase.label,
          mode,
          notice: noticeText,
          shapeCount: testCase.shapes.length,
          selectedCount: ids.length,
        });
        return;
      }

      const result = await buildGroupedShapeFromSelection(testCase.shapes);
      if (!result.group) {
        const noticeText = result.consumed ? "Grouped: hole consumed solid" : result.failureNotice;
        commitShapes(result.consumed ? [] : testCase.shapes, result.consumed ? [] : ids, noticeText);
        finish({
          ok: result.consumed,
          caseId,
          label: testCase.label,
          mode,
          notice: noticeText,
          shapeCount: result.consumed ? 0 : testCase.shapes.length,
          selectedCount: result.consumed ? 0 : ids.length,
          error: result.consumed ? undefined : result.failureNotice,
        });
        return;
      }

      const triangleCount = result.group.importedMesh?.triangleCount ?? meshForShape(result.group).faces.length;
      const groupedCount = result.group.groupedShapes?.length ?? 0;
      if (mode === "ungroup") {
        const restored = restoreGroupedChildren(result.group);
        const noticeText = `Boolean test ungrouped: ${testCase.label}`;
        commitShapes(restored, restored.map((shape) => shape.id), noticeText);
        finish({
          ok: restored.length === groupedCount,
          caseId,
          label: testCase.label,
          mode,
          notice: noticeText,
          shapeCount: restored.length,
          selectedCount: restored.length,
          triangleCount,
          groupedCount,
          groupId: result.group.id,
        });
        return;
      }

      const noticeText = `Boolean test after: ${testCase.label}`;
      commitShapes([result.group], result.group.id, noticeText);
      finish({
        ok: true,
        caseId,
        label: testCase.label,
        mode,
        notice: noticeText,
        shapeCount: 1,
        selectedCount: 1,
        triangleCount,
        groupedCount,
        groupId: result.group.id,
      });
    };

    void run();
  }, [commitShapes]);

  const exportDesign = useCallback((format: ExportFormat) => {
    const sourceShapes = hasSelection ? selectedShapes : shapes;
    const exportable = sourceShapes.filter((shape) => !shape.hole);
    if (exportable.length === 0) {
      setNotice(hasSelection ? "Select at least one solid shape before exporting" : "Add a solid shape before exporting");
      return;
    }
    const invalidSvg = exportable.map(invalidSvgMeshReason).find((reason): reason is string => Boolean(reason));
    if (invalidSvg) {
      setNotice(`${invalidSvg}. Re-import the source SVG after fixing its contours`);
      return;
    }
    const selectedNotice = `Exported ${exportable.length} selected shape${exportable.length === 1 ? "" : "s"}`;
    const finishNotice = (label: string, result: DownloadResult) => {
      celebrateExport(label, `${exportable.length} solid${exportable.length === 1 ? "" : "s"}`);
      if (result.mode === "folder") {
        setNotice(`Saved ${label} to ${result.path}`);
        return;
      }
      setNotice(hasSelection ? `${selectedNotice} as ${label}` : `Exported ${label}`);
    };
    const failNotice = (label: string, error: unknown) => {
      setNotice(error instanceof Error ? error.message : `Could not export ${label}`);
    };
    if (format === "stl") {
      const meshes = exportable.map(meshForShape);
      void downloadBlobFile(projectExportFileName(projectName, "stl"), toStl(meshes), "model/stl")
        .then((result) => finishNotice("STL", result))
        .catch((error: unknown) => failNotice("STL", error));
      return;
    }
    if (format === "3mf") {
      try {
        const exported = to3mfForShapes(exportable);
        const label = exported.preserved
          ? "3MF. The model was updated and the file’s other settings were kept"
          : "3MF";
        void downloadBlobFile(projectExportFileName(projectName, "3mf"), exported.bytes, "model/3mf")
          .then((result) => finishNotice(label, result))
          .catch((error: unknown) => failNotice("3MF", error));
      } catch (error: unknown) {
        failNotice("3MF", error);
      }
      return;
    }
    const meshes = exportable.map(meshForShape);
    void downloadTextFile(projectExportFileName(projectName, "obj"), toObj(meshes), "text/plain")
      .then((result) => finishNotice("OBJ", result))
      .catch((error: unknown) => failNotice("OBJ", error));
  }, [celebrateExport, hasSelection, projectName, selectedShapes, shapes]);

  const openInSlicer = useCallback(() => {
    if (slicer.busy) return;
    const sourceShapes = hasSelection ? selectedShapes : shapes;
    const exportable = sourceShapes.filter((shape) => !shape.hole);
    if (exportable.length === 0) {
      setNotice(hasSelection ? "Select at least one solid shape before exporting" : "Add a solid shape before exporting");
      return;
    }
    const invalidSvg = exportable.map(invalidSvgMeshReason).find((reason): reason is string => Boolean(reason));
    if (invalidSvg) {
      setNotice(`${invalidSvg}. Re-import the source SVG after fixing its contours`);
      return;
    }
    if (!slicer.choice.launch) {
      exportDesign("3mf");
      return;
    }
    const format = slicer.choice.format;
    const filename = projectExportFileName(projectName, format);
    let bytes: Uint8Array;
    try {
      bytes = format === "stl" ? toStl(exportable.map(meshForShape)) : to3mfForShapes(exportable).bytes;
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Could not open the slicer");
      return;
    }
    const folder = window.localStorage.getItem(DOWNLOAD_FOLDER_STORAGE_KEY)?.trim() ?? "";
    slicer.setBusy(true);
    void launchInstalledSlicer({ filename, bytes, exePath: slicer.choice.path, folder })
      .then((result) => {
        celebrateExport(format === "stl" ? "STL" : "3MF", slicer.choice.name);
        setNotice(`Opened ${result.path} in ${result.name}`);
      })
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Could not open the slicer");
      })
      .finally(() => slicer.setBusy(false));
  }, [celebrateExport, exportDesign, hasSelection, projectName, selectedShapes, shapes, slicer]);

  const exportStepDesign = useCallback(async () => {
    if (stepExporting) {
      return;
    }
    const sourceShapes = hasSelection ? selectedShapes : shapes;
    if (sourceShapes.some((shape) => shape.hole) && !sourceShapes.some((shape) => !shape.hole)) {
      setNotice("Select at least one solid shape before exporting STEP");
      return;
    }
    const preflight = buildStepExportPreflight(sourceShapes);
    const pending = preflight.filter((row) => row.quality === "pending");
    const facetedPreview = preflight.filter((row) => row.quality === "faceted").length;
    const exactPreview = preflight.filter((row) => row.quality === "exact").length;
    if (pending.length > 0) {
      setNotice(
        `STEP preflight: ${exactPreview} exact · ${facetedPreview} faceted · ${pending.length} pending (${pending.map((row) => row.name).join(", ")}). Building anyway…`,
      );
    } else {
      setNotice(
        `STEP preflight: ${exactPreview} exact · ${facetedPreview} faceted. Building…`,
      );
    }
    setStepExporting(true);
    try {
      const { exportShapesToStep } = await import("@/lib/stepExport");
      const { blob, exportedCount, exactCount, facetedCount, skipped, degraded } = await exportShapesToStep(sourceShapes);
      persistBakedImportedBrepSteps();
      const text = await blob.text();
      const result = await downloadTextFile(projectExportFileName(projectName, "step"), text, "application/step");
      const qualityNote = `Exported ${exactCount} exact · ${facetedCount} faceted solid${exportedCount === 1 ? "" : "s"}`;
      const facetTip = facetedCount > 0
        ? " Faceted STEP is mesh-based CAD interchange, not feature-editable B-Rep."
        : "";
      const skipNote = skipped.length > 0
        ? ` Skipped ${skipped.length} empty/degenerate shape${skipped.length === 1 ? "" : "s"}.`
        : "";
      // Name the affected bodies: this is the one outcome where the file looks fine but the part
      // is wrong, so a bare count is not enough to keep someone from machining solid stock.
      const degradedNote = degraded.length > 0
        ? ` WARNING — ${degraded.length} body${degraded.length === 1 ? "" : "s"} exported with missing cuts: ${degraded.map((entry) => `${entry.name} (${entry.reason})`).join("; ")}.`
        : "";
      celebrateExport("STEP", `${exactCount} exact · ${facetedCount} faceted`);
      if (result.mode === "folder") {
        setNotice(`Saved STEP to ${result.path}. ${qualityNote}.${facetTip}${skipNote}${degradedNote}`);
      } else {
        setNotice(`${qualityNote}.${facetTip}${skipNote}${degradedNote}`);
      }
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Could not export STEP");
    } finally {
      setStepExporting(false);
    }
  }, [celebrateExport, hasSelection, persistBakedImportedBrepSteps, projectName, selectedShapes, shapes, stepExporting]);

  const exportBlueprint = useCallback(async (formats: BlueprintExportFormat[]) => {
    if (blueprintExporting || formats.length === 0) {
      return;
    }
    const sourceShapes = (hasSelection ? selectedShapes : shapes).filter((shape) => !shape.hole && !shape.hidden && !isConstructionShape(shape));
    if (sourceShapes.length === 0) {
      setNotice(hasSelection ? "Select at least one solid shape before exporting a blueprint" : "Add a solid shape before exporting a blueprint");
      return;
    }
    setBlueprintExporting(true);
    const formatLabels = formats.map((format) => format.toUpperCase()).join(" + ");
    setNotice(`Building 2D blueprint (${formatLabels})…`);
    try {
      const { blueprintPartFrame, buildBlueprintDrawing, writeBlueprintDxf, writeBlueprintPdf, writeBlueprintSvg } = await import("@/lib/blueprintExport");
      const parts = sourceShapes.map((shape) => {
        const mesh = meshForShape(shape);
        const frame = blueprintPartFrame(mesh.vertices, {
          width: shapeWidth(shape),
          depth: shapeDepth(shape),
          height: shape.height,
          elevation: shape.elevation ?? 0,
          x: shape.x,
          z: shape.z,
        });
        return {
          name: shape.name,
          kind: shape.kind,
          vertices: mesh.vertices,
          faces: mesh.faces,
          sides: shape.sides,
          leftAngle: shape.leftAngle,
          rightAngle: shape.rightAngle,
          topRadius: shape.topRadius ?? shape.groupedShapes?.find((child) => child.kind === "cone" && !child.hole)?.topRadius,
          baseRadius: shape.baseRadius ?? shape.groupedShapes?.find((child) => child.kind === "cone" && !child.hole)?.baseRadius,
          color: shape.color,
          ...frame,
        };
      });
      const drawing = buildBlueprintDrawing({
        projectName,
        parts,
        workspace: workspaceSettings,
      });

      const savedPaths: string[] = [];
      for (const format of formats) {
        let result: DownloadResult;
        if (format === "pdf") {
          result = await downloadBlobFile(projectExportFileName(projectName, "pdf"), writeBlueprintPdf(drawing), "application/pdf");
        } else if (format === "dxf") {
          result = await downloadTextFile(projectExportFileName(projectName, "dxf"), writeBlueprintDxf(drawing), "application/dxf");
        } else {
          result = await downloadTextFile(projectExportFileName(projectName, "svg"), writeBlueprintSvg(drawing), "image/svg+xml");
        }
        if (result.mode === "folder") {
          savedPaths.push(result.path);
        }
      }

      celebrateExport(`Blueprint ${formatLabels}`, `${parts.length} part${parts.length === 1 ? "" : "s"}`);
      setBlueprintExportOpen(false);
      if (savedPaths.length > 0) {
        setNotice(`Saved blueprint ${formatLabels} to ${savedPaths.join(", ")}`);
      } else {
        setNotice(hasSelection
          ? `Exported blueprint ${formatLabels} for ${parts.length} selected shape${parts.length === 1 ? "" : "s"}`
          : `Exported blueprint ${formatLabels} (${parts.length} part${parts.length === 1 ? "" : "s"})`);
      }
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Could not export blueprint");
    } finally {
      setBlueprintExporting(false);
    }
  }, [blueprintExporting, celebrateExport, hasSelection, projectName, selectedShapes, shapes, workspaceSettings]);

  const openBlueprintExport = useCallback(() => {
    const sourceShapes = (hasSelection ? selectedShapes : shapes).filter((shape) => !shape.hole && !shape.hidden && !isConstructionShape(shape));
    if (sourceShapes.length === 0) {
      setNotice(hasSelection ? "Select at least one solid shape before exporting a blueprint" : "Add a solid shape before exporting a blueprint");
      return;
    }
    setBlueprintExportOpen(true);
  }, [hasSelection, selectedShapes, shapes]);

  const clearDesign = useCallback(() => {
    commitShapes([], [], "New empty design");
    setClipboard([]);
    setMenuOpen(false);
    setTopPanel(null);
  }, [commitShapes]);

  const createHouseScene = useCallback(
    (replace = true) => {
      const house = makeHouseScene();
      const next = replace ? house : [...shapes, ...house];
      commitShapes(next, house.map((shape) => shape.id), "House scene created");
      setMenuOpen(false);
      setTopPanel(null);
      return house;
    },
    [commitShapes, shapes],
  );

  const createPerfScene = useCallback(
    (count = 500) => {
      const scene = makeBlockPerfScene(count);
      commitShapes(scene, [], `Performance scene: ${scene.length} blocks`);
      setMenuOpen(false);
      setTopPanel(null);
      return scene;
    },
    [commitShapes],
  );

  const saveDesign = useCallback(() => {
    setNotice(`Saved design with ${shapes.length} shape${shapes.length === 1 ? "" : "s"}`);
    setMenuOpen(false);
  }, [shapes.length]);

  const makeCopy = useCallback(() => {
    if (shapes.length === 0) {
      setNotice("Nothing to copy yet");
      setMenuOpen(false);
      return;
    }
    const copies = shapes.map((shape) => ({
      ...shape,
      id: createLocalId(`${shape.id}-copy`),
      x: Math.min(110, shape.x + 12),
      z: Math.min(110, shape.z + 12),
    }));
    commitShapes([...shapes, ...copies], copies.map((shape) => shape.id), "Made a copy of the design");
    setMenuOpen(false);
  }, [commitShapes, shapes]);

  // The wheel is painted before import work starts. STEP meshing runs off this thread and
  // reports each body; only the latest import's token may clear the wheel.
  const showModelLoading = useCallback(async (fileName: string, message?: string) => {
    const token = ++modelLoadingTokenRef.current;
    flushSync(() => {
      if (message) setNotice(message);
      setModelLoadingName(fileName);
    });
    await afterNextPaint();
    return token;
  }, [setNotice]);

  // Waits for the frame that shows the new shapes: the viewport builds their meshes after
  // commit, and that freeze should still show the wheel.
  const hideModelLoading = useCallback(async (token: number) => {
    await afterNextPaint();
    if (modelLoadingTokenRef.current === token) setModelLoadingName(null);
  }, []);

  const selectFile = useCallback(async (file: File) => {
    const isStep = /\.(step|stp)$/i.test(file.name);
    const isSvg = /\.svg$/i.test(file.name) || file.type === "image/svg+xml";
    const is3mf = /\.3mf$/i.test(file.name);
    if (!isStep && !isSvg && !importExtensionSupported(file.name)) {
      setNotice("Unsupported file type. Use STL, STEP, SVG, or 3MF.");
      return;
    }

    const sourceProjectId = projectInfoRef.current.projectId;
    const loadingNotice = isStep
      ? "Reading STEP…"
      : isSvg ? `Importing SVG (${file.name})…` : undefined;
    const loadingToken = isStep || isSvg || is3mf ? await showModelLoading(file.name, loadingNotice) : 0;
    let stepBase: WorkplaneShape[] | null = null;
    try {
      let nextShapes: WorkplaneShape[];
      const importWarnings: string[] = [];
      if (isStep) {
        const { importedShapesFromStep } = await import("@/lib/stepImport");
        stepBase = shapesRef.current.slice();
        nextShapes = await importedShapesFromStep(file.name, await file.arrayBuffer(), {
          onProgress: (progress) => {
            const label = progress.phase === "place"
              ? "Placing parts…"
              : `Meshing ${progress.index} of ${progress.total} — ${progress.name}`;
            flushSync(() => {
              setNotice(label);
              setModelLoadingName(label);
            });
          },
          onPreview: (preview) => {
            const visible = [...stepBase!, ...preview];
            flushSync(() => {
              shapesRef.current = visible;
              setShapes(visible);
            });
          },
        });
      } else if (isSvg) {
        nextShapes = [importedShapeFromSvg(file.name, await file.text(), (warning) => importWarnings.push(warning))];
      } else if (is3mf) {
        nextShapes = [importedShapeFrom3mf(file.name, await file.arrayBuffer())];
      } else {
        setStlSeatPrompt({ name: file.name, buffer: await file.arrayBuffer() });
        setTopPanel("import");
        setNotice(`${file.name} is ready. Lay it flat, or keep the file’s orientation and sit it on the floor.`);
        return;
      }
      if (projectInfoRef.current.projectId !== sourceProjectId) {
        if (stepBase) {
          shapesRef.current = stepBase;
          setShapes(stepBase);
        }
        setNotice(`Import of ${file.name} cancelled because the project changed`);
        return;
      }
      const imported = nextShapes.map((shape) => importAsHole ? withHoleMode(shape, true) : shape);
      setStlSeatPrompt(null);
      const preserved3mf = is3mf && imported.some((shape) => shape.source3mf);
      const label = preserved3mf
        ? `Imported ${file.name}. Exporting 3MF keeps this file’s other settings.`
        : imported.length === 1
          ? (importAsHole ? `Imported ${file.name} as a hole` : `Imported ${file.name}`)
          : `Imported ${imported.length} bodies from ${file.name}`;
      commitShapes([...(stepBase ?? shapesRef.current), ...imported], imported.map((shape) => shape.id), label);
      if (isStep) void bakeImportedBrepForAutosave();
      setTopPanel(null);
      // Overrides the commit notice on purpose: a partial import needs to be seen.
      if (importWarnings.length > 0) setNotice(`Imported ${file.name} — ${importWarnings.join(" ")}`);
    } catch (error) {
      if (stepBase) {
        shapesRef.current = stepBase;
        setShapes(stepBase);
      }
      setNotice(error instanceof Error ? error.message : `Could not import ${file.name}`);
    } finally {
      if (loadingToken) void hideModelLoading(loadingToken);
    }
  }, [bakeImportedBrepForAutosave, commitShapes, hideModelLoading, importAsHole, showModelLoading]);

  const placeStlImport = useCallback(async (mode: MeshSeatMode) => {
    const prompt = stlSeatPrompt;
    if (!prompt) return;
    // Cleared up front so a second click can't import the same file twice while it loads.
    setStlSeatPrompt(null);
    const loadingToken = await showModelLoading(prompt.name);
    try {
      const shape = importedShapeFromStl(prompt.name, prompt.buffer, mode, workspaceSettings);
      const imported = importAsHole ? withHoleMode(shape, true) : shape;
      const label = importAsHole
        ? `Imported ${prompt.name} as a hole`
        : mode === "keep-orientation"
          ? `Imported ${prompt.name} in its file orientation`
          : `Imported ${prompt.name} laid flat`;
      commitShapes([...shapesRef.current, imported], [imported.id], label);
      setTopPanel(null);
    } catch (error) {
      setStlSeatPrompt((current) => current ?? prompt);
      setNotice(error instanceof Error ? error.message : `Could not import ${prompt.name}`);
    } finally {
      void hideModelLoading(loadingToken);
    }
  }, [commitShapes, hideModelLoading, importAsHole, showModelLoading, stlSeatPrompt, workspaceSettings]);

  const selectFiles = useCallback(
    (files: FileList | File[]) => {
      const file = Array.from(files)[0];
      if (file) {
        void selectFile(file);
      }
    },
    [selectFile],
  );

  const selectShape = useCallback((id: string | string[] | null, mode: "replace" | "toggle" = "replace") => {
    const resolveId = (pickId: string) => {
      if (circularPattern) {
        return resolveCircularPatternSourceId(pickId, circularPattern) ?? pickId;
      }
      if (linearPattern) {
        return resolveLinearPatternSourceId(pickId, linearPattern) ?? pickId;
      }
      return pickId;
    };
    setSelectedIds((current) => {
      if (Array.isArray(id)) {
        const unique = id.map(resolveId).filter((entry, index, list) => list.indexOf(entry) === index);
        return mode === "toggle" ? unique.reduce((next, entry) => (next.includes(entry) ? next.filter((selected) => selected !== entry) : [...next, entry]), current) : unique;
      }
      if (!id) {
        return mode === "toggle" ? current : [];
      }
      const resolved = resolveId(id);
      if (mode === "toggle") {
        return current.includes(resolved) ? current.filter((entry) => entry !== resolved) : [...current, resolved];
      }
      return [resolved];
    });
  }, [circularPattern, linearPattern]);

  const nudgeSelected = useCallback(
    (deltaX: number, deltaZ: number, gridStep = 0) => {
      if (!hasSelection) {
        return;
      }
      const snapCoord = (value: number, delta: number) => {
        const next = value + delta;
        if (gridStep <= 0) return Math.max(-110, Math.min(110, next));
        // Land on the grid cell in the nudge direction (no diagonal / half-step drift).
        const snapped = Math.round(next / gridStep) * gridStep;
        return Math.max(-110, Math.min(110, Number(snapped.toFixed(6))));
      };
      const selected = new Set(selectedIds);
      const repeatEntries: Array<{ shapeId: string; delta: ShapeRepeatDelta }> = [];
      const nextShapes = shapes.map((shape) => {
        if (!selected.has(shape.id) || shape.locked) return shape;
        const x = snapCoord(shape.x, deltaX);
        const z = snapCoord(shape.z, deltaZ);
        repeatEntries.push({ shapeId: shape.id, delta: { x: x - shape.x, z: z - shape.z } });
        return { ...shape, x, z };
      });
      recordShapeRepeatActions(repeatEntries);
      commitShapes(
        nextShapes,
        selectedIds,
        `Moved ${selectedShapes.length} shape${selectedShapes.length === 1 ? "" : "s"}`,
      );
    },
    [commitShapes, hasSelection, recordShapeRepeatActions, selectedIds, selectedShapes.length, shapes],
  );

  const nudgeSelectedByView = useCallback(
    (screenRight: number, screenUp: number, step: number) => {
      const { deltaX, deltaZ } = viewNudgeDelta(viewNudgeAxesRef.current, screenRight, screenUp, step);
      nudgeSelected(deltaX, deltaZ, step);
    },
    [nudgeSelected],
  );

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isHotkeyRecordingActive()) {
        return;
      }

      if (!isTypingTarget(event.target) && (event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key === ",") {
          event.preventDefault();
          setSettingsOpen(true);
          return;
        }
        if (event.key === "s" || event.key === "S") {
          event.preventDefault();
          void saveProjectExplicitly(event.shiftKey ? "save-as" : "save");
          return;
        }
        if ((event.key === "e" || event.key === "E") && !event.shiftKey) {
          event.preventDefault();
          setTopPanel("export");
          return;
        }
      }

      const action = matchHotkeyAction(
        event,
        hotkeys,
        undefined,
        sketchActive && toolbarMode === "sketch" ? { preferCategory: "Sketch" } : undefined,
      );

      // Inspector / overlay fields steal focus when a shape is selected. Still allow
      // undo/redo so Ctrl+Z is not trapped in a dimension box.
      if (isTypingTarget(event.target)) {
        if (action === "undo" || action === "redo") {
          const target = event.target;
          const inCadField = target instanceof HTMLElement && Boolean(
            target.closest(".shape-inspector, .edge-modifier-panel, .transform-overlay, .placement-ruler-overlay, .dimension-input"),
          );
          if (inCadField) {
            event.preventDefault();
            if (sketchActive && toolbarMode === "sketch") {
              if (action === "undo") sketchUndo();
              else sketchRedo();
            } else if (action === "undo") {
              undo();
            } else {
              redo();
            }
          }
        }
        return;
      }

      if (!action) return;

      const snapGridStep = (() => {
        if (snapGrid === "Off") return 0;
        return Number.parseFloat(snapGrid) || 1;
      })();
      const unit = snapGridStep > 0 ? snapGridStep : 0.01;
      const step = event.shiftKey ? unit * 5 : unit;

      if (sketchActive && toolbarMode === "sketch") {
        if (action === "escape") {
          event.preventDefault();
          if (polygonSidesPrompt !== null) {
            cancelPolygonSidesPrompt();
            return;
          }
          if (extrudeHeightPrompt !== null) {
            cancelExtrudeHeightPrompt();
            return;
          }
          setSketchActivePointId(null);
          setSketchSelection(null);
          setRevolvePrompt(null);
          setSweepPrompt(null);
          setSweepPreview(null);
          setSweepBuildError(null);
          setNotice("Current sketch chain cleared");
          return;
        }
        if (action === "delete") {
          event.preventDefault();
          if (sketchSelection) deleteSelectedSketchEntity();
          else if (sketchMeasurement) clearSketchMeasurement();
          else {
            // Never wipe the whole sketch on Delete with an empty selection.
            setNotice("Nothing selected to delete");
          }
          return;
        }
        if (action === "undo") {
          event.preventDefault();
          sketchUndo();
          return;
        }
        if (action === "redo") {
          event.preventDefault();
          sketchRedo();
          return;
        }
        if (action === "copy") {
          event.preventDefault();
          copySelectedSketch();
          return;
        }
        if (action === "cut") {
          event.preventDefault();
          cutSelectedSketch();
          return;
        }
        if (action === "paste") {
          event.preventDefault();
          pasteSelectedSketch();
          return;
        }
        if (action === "selectAll") {
          event.preventDefault();
          const pointIds = sketchProfile.points.map((point) => point.id);
          const segmentIds = sketchProfile.segments.map((segment) => segment.id);
          const imageIds = (sketchProfile.images ?? []).map((image) => image.id);
          if (!pointIds.length && !segmentIds.length && !imageIds.length) {
            setNotice("Sketch is empty");
            return;
          }
          setSketchSelection({ kind: "multiple", pointIds, segmentIds, imageIds });
          setSketchActivePointId(null);
          setNotice(`Selected all sketch items (${pointIds.length + segmentIds.length + imageIds.length})`);
          return;
        }
        if (action === "nudgeLeft" || action === "nudgeRight" || action === "nudgeUp" || action === "nudgeDown") {
          const pointIds =
            sketchSelection?.kind === "point"
              ? [sketchSelection.id]
              : sketchSelection?.kind === "multiple"
                ? sketchSelection.pointIds
                : [];
          if (!pointIds.length) {
            setNotice("Select sketch points to nudge");
            return;
          }
          event.preventDefault();
          const deltaX = action === "nudgeLeft" ? -step : action === "nudgeRight" ? step : 0;
          const deltaZ = action === "nudgeUp" ? -step : action === "nudgeDown" ? step : 0;
          const idSet = new Set(pointIds);
          const next = {
            ...sketchProfile,
            points: sketchProfile.points.map((point) => {
              if (!idSet.has(point.id)) return point;
              return {
                ...point,
                x: point.x + deltaX,
                z: point.z + deltaZ,
                handleIn: point.handleIn
                  ? { x: point.handleIn.x + deltaX, z: point.handleIn.z + deltaZ }
                  : undefined,
                handleOut: point.handleOut
                  ? { x: point.handleOut.x + deltaX, z: point.handleOut.z + deltaZ }
                  : undefined,
              };
            }),
          };
          commitSketchProfile(next, "Sketch points nudged");
          return;
        }
        if (action === "sketchLine") {
          event.preventDefault();
          setActiveSketchTool("line");
          return;
        }
        if (action === "sketchCircle") {
          event.preventDefault();
          setActiveSketchTool("circle");
          return;
        }
        if (action === "sketchRectangle") {
          event.preventDefault();
          setActiveSketchTool("rectangle");
          return;
        }
        if (action === "sketchDimension") {
          event.preventDefault();
          setActiveSketchTool("dimension");
          return;
        }
        if (action === "sketchExtrude") {
          event.preventDefault();
          startSketchExtrude();
          return;
        }
        if (action === "sketchFocusToggle") {
          // Only toggle 2D/3D when focus is on the sketch surface (or loose body focus),
          // so Tab can still move through inspector/tool UI controls.
          const target = event.target as HTMLElement | null;
          const onSketchSurface = Boolean(target?.closest?.(".sketch-plate, .sketch-plate-wrap"));
          const looseFocus =
            !target
            || target === document.body
            || target === document.documentElement
            || target.classList?.contains("peakcad-editor");
          if (!onSketchSurface && !looseFocus) {
            return;
          }
          event.preventDefault();
          setSketchFocusMode((mode) => {
            const next = mode === "2d" ? "3d" : "2d";
            if (next === "2d") setSketchFrameRequest(0);
            return next;
          });
          return;
        }
        if (action === "holeMode") {
          event.preventDefault();
          setNotice("Hole mode applies in 3D — finish or exit the sketch first");
          return;
        }
        if (action === "solidMode") {
          event.preventDefault();
          setActiveSketchTool("select");
          return;
        }
        return;
      }

      switch (action) {
        case "escape":
          event.preventDefault();
          if (sketchFacePickMode) {
            cancelSketchFacePick();
            break;
          }
          if (edgeModifier) {
            cancelEdgeModifier();
            break;
          }
          if (pushPullSession) {
            invalidateCadModifierSession();
            setNotice("Push Pull cancelled");
            break;
          }
          if (linearPattern) {
            cancelLinearPattern();
            break;
          }
          if (circularPattern) {
            cancelCircularPattern();
            break;
          }
          if (placementRuler) {
            setPlacementRuler(null);
            setNotice("Placement ruler closed");
            break;
          }
          if (alignMode) {
            setAlignMode(false);
            setAlignPreview(null);
            setNotice("Align cancelled");
            break;
          }
          if (mirrorMode) {
            setMirrorMode(false);
            setMirrorPreviewAxis(null);
            setNotice("Mirror cancelled");
            break;
          }
          setSelectedIds([]);
          setNotice("Selection cleared");
          break;
        case "delete":
          event.preventDefault();
          deleteSelected();
          break;
        case "undo":
          event.preventDefault();
          undo();
          break;
        case "redo":
          event.preventDefault();
          redo();
          break;
        case "copy":
          event.preventDefault();
          copySelected();
          break;
        case "cut":
          event.preventDefault();
          cutSelected();
          break;
        case "paste":
          event.preventDefault();
          pasteShape();
          break;
        case "duplicate":
          event.preventDefault();
          duplicateSelected();
          break;
        case "duplicateRepeat":
          event.preventDefault();
          duplicateAndRepeatSelected();
          break;
        case "selectAll":
          event.preventDefault();
          setSelectedIds(shapes.filter((shape) => !shape.hidden).map((shape) => shape.id));
          setNotice("Selected all visible shapes");
          break;
        case "group":
          event.preventDefault();
          groupSelected();
          break;
        case "ungroup":
          event.preventDefault();
          ungroupSelected();
          break;
        case "toggleLocked":
          event.preventDefault();
          toggleLocked();
          break;
        case "toggleHidden":
          event.preventDefault();
          toggleHidden();
          break;
        case "showHidden":
          event.preventDefault();
          showHidden();
          break;
        case "raise":
          event.preventDefault();
          raiseSelected(step);
          break;
        case "lower":
          event.preventDefault();
          raiseSelected(-step);
          break;
        case "nudgeLeft":
          event.preventDefault();
          nudgeSelectedByView(-1, 0, step);
          break;
        case "nudgeRight":
          event.preventDefault();
          nudgeSelectedByView(1, 0, step);
          break;
        case "nudgeUp":
          event.preventDefault();
          nudgeSelectedByView(0, 1, step);
          break;
        case "nudgeDown":
          event.preventDefault();
          nudgeSelectedByView(0, -1, step);
          break;
        case "dropToWorkplane":
          if (!hasSelection) return;
          event.preventDefault();
          dropSelectedToWorkplane();
          break;
        case "holeMode":
          event.preventDefault();
          if (extrudeHeightPrompt !== null) {
            setExtrudeAsHole(true);
            break;
          }
          setSelectionHoleMode(true);
          break;
        case "solidMode":
          event.preventDefault();
          if (extrudeHeightPrompt !== null) {
            setExtrudeAsHole(false);
            break;
          }
          setSelectionHoleMode(false);
          break;
        case "align":
          event.preventDefault();
          toggleAlignMode();
          break;
        case "mirror":
          event.preventDefault();
          toggleMirrorMode();
          break;
        case "pattern":
          event.preventDefault();
          toggleCircularPattern();
          break;
        case "chamfer":
          event.preventDefault();
          if (edgeModifier?.kind === "chamfer") cancelEdgeModifier();
          else startEdgeModifier("chamfer");
          break;
        case "fillet":
          event.preventDefault();
          if (edgeModifier?.kind === "fillet") cancelEdgeModifier();
          else startEdgeModifier("fillet");
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    cancelEdgeModifier,
    cancelExtrudeHeightPrompt,
    cancelPolygonSidesPrompt,
    cancelCircularPattern,
    cancelLinearPattern,
    cancelSketchFacePick,
    clearSketchMeasurement,
    commitSketchProfile,
    copySelected,
    copySelectedSketch,
    cutSelected,
    cutSelectedSketch,
    deleteSelected,
    deleteSelectedSketchEntity,
    dropSelectedToWorkplane,
    duplicateAndRepeatSelected,
    duplicateSelected,
    edgeModifier,
    alignMode,
    circularPattern,
    linearPattern,
    mirrorMode,
    placementRuler,
    groupSelected,
    hasSelection,
    hotkeys,
    nudgeSelectedByView,
    pasteSelectedSketch,
    pasteShape,
    polygonSidesPrompt,
    extrudeHeightPrompt,
    raiseSelected,
    redo,
    saveProjectExplicitly,
    shapes,
    sketchActive,
    sketchFacePickMode,
    sketchMeasurement,
    sketchProfile,
    sketchRedo,
    sketchSelection,
    sketchUndo,
    setActiveSketchTool,
    setSelectionHoleMode,
    showHidden,
    snapGrid,
    startEdgeModifier,
    startSketchExtrude,
    toggleAlignMode,
    toggleCircularPattern,
    toggleLinearPattern,
    toggleHidden,
    toggleLocked,
    toggleMirrorMode,
    toolbarMode,
    undo,
    ungroupSelected,
  ]);

  const geometryToolbarProps = {
    canUndo: historyIndex > 0 || Boolean(edgeModifier) || Boolean(pushPullSession) || Boolean(circularPattern) || Boolean(linearPattern),
    canRedo: historyIndex < history.length - 1,
    hasClipboard: clipboard.length > 0 || systemClipboardSupported,
    hasSelection,
    canGroup: selectedShapes.filter((shape) => !isConstructionShape(shape)).length > 1 && selectedShapes.every((shape) => !shape.locked),
    canIntersect: selectedShapes.some((shape) => !shape.locked && !shape.hole && !isConstructionShape(shape)) && selectedShapes.some((shape) => !shape.locked && Boolean(shape.hole)),
    canUngroup: selectedShapes.some((shape) => Boolean(shape.groupedShapes?.length)),
    alignMode,
    snapActive: faceSnap !== null,
    layFlatActive: layFlat,
    canAlign: selectedShapes.length > 1,
    canEdgeModify: selectedShapes.length === 1 && Boolean(selectedShape && !selectedShape.locked && !selectedShape.hole),
    edgeModifierKind: edgeModifier?.kind ?? null,
    circularPatternActive: Boolean(circularPattern),
    canCircularPattern,
    linearPatternActive: Boolean(linearPattern),
    canLinearPattern,
    mirrorMode,
    onCopy: copySelected,
    onPaste: pasteShape,
    onDuplicate: duplicateSelected,
    onDuplicateAndRepeat: duplicateAndRepeatSelected,
    onDelete: deleteSelected,
    onUndo: undo,
    onHistory: () => setHistoryBrowse((current) => current === null ? historyIndexRef.current : null),
    onRedo: redo,
    historyActive: historyBrowse !== null,
    onGroup: groupSelected,
    onAssemble: assembleSelected,
    onUngroup: ungroupSelected,
    onIntersect: intersectSelected,
    onAlign: toggleAlignMode,
    onSnap: snapSelected,
    onLayFlat: laySelectedFace,
    onMirror: toggleMirrorMode,
    onCircularPattern: toggleCircularPattern,
    onLinearPattern: toggleLinearPattern,
    onChamfer: () => edgeModifier?.kind === "chamfer" ? cancelEdgeModifier() : startEdgeModifier("chamfer"),
    onFillet: () => edgeModifier?.kind === "fillet" ? cancelEdgeModifier() : startEdgeModifier("fillet"),
    onPushPull: () => pushPullSession ? invalidateCadModifierSession() : startPushPull(),
    pushPullActive: Boolean(pushPullSession),
    onHollow: () => shellSession ? invalidateCadModifierSession() : startShell(),
    hollowActive: Boolean(shellSession),
    onSplit: () => {
      if (splitSession) {
        setSplitSession(null);
        setNotice("Split cancelled");
        return;
      }
      if (!selectedShape || selectedShape.locked) return;
      if (edgeModifier) cancelEdgeModifier();
      if (shellSession || pushPullSession) invalidateCadModifierSession();
      setSplitSession({ shapeId: selectedShape.id, axis: "x", offset: 0, joint: "none", clearance: 0.2 });
    },
    splitActive: Boolean(splitSession),
  };

  const sweepDialog = sweepPrompt ? (
    <div className={`sketch-revolve-prompt phase-${sweepPrompt.phase === "confirm" ? "confirm" : "pick"}`} role="dialog" aria-live="polite" aria-label="Sweep">
      {sweepPrompt.phase === "pick-outline" ? (
        <>
          <div className="sketch-revolve-prompt-copy">
            <strong>Sweep: choose the outline</strong>
            <span>Click the closed shape you want to carry.</span>
          </div>
          <div className="sketch-revolve-prompt-actions">
            <button type="button" className="cancel" onClick={() => setSweepPrompt(null)}>Cancel</button>
          </div>
        </>
      ) : null}
      {sweepPrompt.phase === "pick-path" ? (
        <>
          <div className="sketch-revolve-prompt-copy">
            <strong>Sweep: choose the path</strong>
            <span>Click the line the outline should follow.</span>
          </div>
          <div className="sketch-revolve-prompt-actions">
            <button type="button" onClick={() => setSweepPrompt({ phase: "pick-outline" })}>Pick the outline again</button>
            <button type="button" className="cancel" onClick={() => setSweepPrompt(null)}>Cancel</button>
          </div>
        </>
      ) : null}
      {sweepPrompt.phase === "confirm" ? (
        <>
          <div className="sketch-revolve-prompt-copy">
            <strong>{sweepPreview ? "Sweep this outline along this path?" : sweepBuildError ? "Sweep stopped" : "Building sweep…"}</strong>
            <span>{sweepBuildError ?? "The outline is the cross-section. It sits on the start of the path."}</span>
          </div>
          <div className="sketch-revolve-prompt-actions">
            <button type="button" className="primary" disabled={!sweepPreview} onClick={() => sweepPreview && commitSweepShape(sweepPreview)}>
              Sweep
            </button>
            <button type="button" onClick={() => { setSweepPrompt({ phase: "pick-outline" }); setSweepPreview(null); }}>
              Pick again
            </button>
            <button type="button" className="cancel" onClick={() => { setSweepPrompt(null); setSweepPreview(null); }}>Cancel</button>
          </div>
        </>
      ) : null}
    </div>
  ) : null;

  const sketchFocusTabs = (
    <SketchFocusTabs
      focusMode={sketchFocusMode}
      onFocusModeChange={(mode) => {
        setSketchFocusMode(mode);
        if (mode === "2d") setSketchFrameRequest(0);
      }}
      onReframe3d={() => setSketchFrameRequest((count) => count + 1)}
    />
  );

  return (
    <div className="peakcad-editor">
      <EditorTopBar
        projectName={projectName}
        onProjectNameChange={onProjectNameChange}
        chromeBusy={
          exactStepSaveProgress
            ? { progress: exactStepSaveProgress.done / Math.max(1, exactStepSaveProgress.total) }
            : (shellSession?.busy || edgeModifier?.busy || stepExporting || Boolean(modelLoadingName))
              ? {}
              : null
        }
        onHome={onHome ? () => void handleHome() : undefined}
        onImport={() => {
          setTopPanel("import");
          setMenuOpen(false);
        }}
        onSaveProject={projectId && onSaveProject ? () => void saveProjectExplicitly("save") : undefined}
        onSaveProjectAs={projectId && onSaveProjectAs ? () => void saveProjectExplicitly("save-as") : undefined}
        hasMatchingSavedFile={hasMatchingSavedFile}
        onExport={() => {
          setTopPanel("export");
          setMenuOpen(false);
        }}
        toolbarMode={toolbarMode}
        onToolbarModeChange={changeToolbarMode}
        leftTools={
          toolbarMode === "sketch" && sketchActive ? (
            <EditorModeStrip
              canUndo={sketchHistoryIndex > 0}
              canRedo={sketchHistoryIndex < sketchHistory.length - 1}
              canCopy={Boolean(sketchSelection)}
              canPaste={Boolean(sketchClipboard)}
              onUndo={sketchUndo}
              onRedo={sketchRedo}
              onCopy={copySelectedSketch}
              onPaste={pasteSelectedSketch}
            />
          ) : toolbarMode === "geometry" ? (
            <EditorViewportToolbar cluster="edit" {...geometryToolbarProps} />
          ) : null
        }
        rightTools={
          toolbarMode === "geometry" ? (
            <EditorViewportToolbar cluster="modify" {...geometryToolbarProps} />
          ) : sketchActive ? (
            <SketchFinishToolbar
              onSketchExtrude={startSketchExtrude}
              onSketchRevolve={startSketchRevolve}
              onSketchSweep={startSketchSweep}
              onSketchCancel={cancelSketch}
              revolveDisabled={!isDefaultSketchPlane(sketchProfile.sketchPlane)}
            />
          ) : null
        }
      />
      {modelConnected ? (
        <div className="model-bridge-bar" role="status">
          <span>{modelAction ? modelAction : "A model is connected"}</span>
          <button type="button" onClick={stopModels}>Stop</button>
        </div>
      ) : null}
      {modelPrompt ? (
        <section className="dashboard-confirm-overlay editor-unsaved-overlay" role="dialog" aria-modal="true" aria-labelledby="model-allow-title">
          <div className="dashboard-confirm-dialog">
            <header>
              <strong id="model-allow-title">{modelPrompt.clientName} wants to change this project</strong>
            </header>
            <p>{modelPrompt.label}. You can undo it from History.</p>
            <div className="dashboard-confirm-actions">
              <button type="button" className="dashboard-confirm-cancel" onClick={() => modelConsentSettleRef.current?.("deny")}>Deny</button>
              <button type="button" className="dashboard-confirm-cancel" onClick={() => modelConsentSettleRef.current?.("once")}>Allow once</button>
              <button type="button" className="dashboard-confirm-save" onClick={() => modelConsentSettleRef.current?.("project")}>Allow while this project is open</button>
            </div>
          </div>
        </section>
      ) : null}
      {unsavedPrompt ? (
        <section
          className="dashboard-confirm-overlay editor-unsaved-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="editor-unsaved-title"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape" && !unsavedPrompt.saving) settleUnsavedPrompt(false);
          }}
        >
          <div className="dashboard-confirm-dialog">
            <header>
              <strong id="editor-unsaved-title">Save this design?</strong>
              <button
                type="button"
                aria-label="Stay in this project"
                disabled={unsavedPrompt.saving}
                onClick={() => settleUnsavedPrompt(false)}
              >
                <X size={18} />
              </button>
            </header>
            <p>
              {unsavedPrompt.saving
                ? exactStepSaveProgress
                  ? `Saving exact STEP… ${exactStepSaveProgress.done} / ${exactStepSaveProgress.total} imported ${exactStepSaveProgress.total === 1 ? "body" : "bodies"}`
                  : "Saving…"
                : (
                  <>
                    <span>{projectName}</span> is already kept in Mintr. A new file is saved as .mintr. An open .peakcad file keeps that name.
                  </>
                )}
            </p>
            <div className="dashboard-confirm-actions">
              <button
                className="dashboard-confirm-cancel editor-unsaved-discard"
                type="button"
                disabled={unsavedPrompt.saving}
                onClick={() => settleUnsavedPrompt(true)}
              >
                Exit to Menu
              </button>
              <button
                className="dashboard-confirm-save"
                type="button"
                autoFocus
                disabled={unsavedPrompt.saving}
                onClick={() => void saveFromUnsavedPrompt()}
              >
                {unsavedPrompt.saving ? "Saving…" : "Save file"}
              </button>
            </div>
          </div>
        </section>
      ) : null}
      {blueprintExportOpen ? (
        <BlueprintExportModal
          exporting={blueprintExporting}
          onClose={() => {
            if (!blueprintExporting) {
              setBlueprintExportOpen(false);
            }
          }}
          onExport={(formats) => {
            void exportBlueprint(formats);
          }}
        />
      ) : null}
      <div className={`editor-body${modeTransitioning ? " mode-transitioning" : ""}`}>
        {toolbarMode === "sketch" && sketchActive && sketchFocusMode === "2d" ? (
          <>
          <SketchUtilitySidebar
            sketchTool={sketchTool}
            proEnabled={workspaceSettings.peakcadPro}
            onSketchTool={setActiveSketchTool}
            onHoverTool={setSketchHoverTool}
            onSketchImage={() => {
              if (sketchTool !== "select") {
                setNotice("Choose Select before adding a sketch image");
                return;
              }
              sketchImageInputRef.current?.click();
            }}
          />
          <div className="editor-sketch-area">
            {polygonSidesPrompt !== null ? (
              <>
                <div className="sketch-tool-prompt-backdrop" aria-hidden onPointerDown={(event) => event.preventDefault()} />
                <div className="sketch-revolve-prompt phase-pick" role="dialog" aria-modal="true" aria-label="Polygon sides">
                  <div className="sketch-revolve-prompt-copy">
                    <strong>Polygon: how many sides?</strong>
                    <span>Choose a side count, then confirm to start drawing.</span>
                  </div>
                  <div className="sketch-polygon-sides-prompt" aria-label="Polygon side count">
                    <button
                      type="button"
                      aria-label="Fewer sides"
                      disabled={polygonSidesPrompt <= MIN_SKETCH_POLYGON_SIDES}
                      onClick={() => setPolygonSidesPrompt((sides) => Math.max(MIN_SKETCH_POLYGON_SIDES, (sides ?? MIN_SKETCH_POLYGON_SIDES) - 1))}
                    >
                      −
                    </button>
                    <span>{polygonSidesPrompt}</span>
                    <button
                      type="button"
                      aria-label="More sides"
                      disabled={polygonSidesPrompt >= MAX_SKETCH_POLYGON_SIDES}
                      onClick={() => setPolygonSidesPrompt((sides) => Math.min(MAX_SKETCH_POLYGON_SIDES, (sides ?? MAX_SKETCH_POLYGON_SIDES) + 1))}
                    >
                      +
                    </button>
                  </div>
                  <div className="sketch-polygon-sides-presets" aria-label="Common side counts">
                    {[3, 4, 5, 6, 8, 12].map((sides) => (
                      <button
                        key={sides}
                        type="button"
                        className={polygonSidesPrompt === sides ? "active" : ""}
                        onClick={() => setPolygonSidesPrompt(sides)}
                      >
                        {sides}
                      </button>
                    ))}
                  </div>
                  <div className="sketch-revolve-prompt-actions">
                    <button type="button" className="primary" onClick={confirmPolygonSidesPrompt}>
                      Draw polygon
                    </button>
                    <button type="button" className="cancel" onClick={cancelPolygonSidesPrompt}>
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            {revolvePrompt ? (
              <div className={`sketch-revolve-prompt phase-${revolvePrompt.phase}`} role="dialog" aria-live="polite" aria-label="Revolve axis">
                {revolvePrompt.phase === "pick" ? (
                  <>
                    <div className="sketch-revolve-prompt-copy">
                      <strong>Revolve: choose an axis</strong>
                      <span>Click a straight line in the sketch to revolve around.</span>
                    </div>
                    <div className="sketch-revolve-prompt-actions">
                      <button type="button" className="cancel" onClick={() => setRevolvePrompt(null)}>Cancel revolve</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="sketch-revolve-prompt-copy">
                      <strong>Use this line as the revolve axis?</strong>
                      <span>Confirm to create the solid, or click a different straight line.</span>
                    </div>
                    <div className="sketch-revolve-prompt-actions">
                      <button type="button" className="primary" onClick={() => completeSketchRevolve(revolvePrompt.axis)}>
                        Confirm axis
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSketchSelection(null);
                          setRevolvePrompt({ phase: "pick" });
                        }}
                      >
                        Pick another
                      </button>
                      <button type="button" className="cancel" onClick={() => setRevolvePrompt(null)}>Cancel</button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
            {sweepDialog}
            <SketchPalette
              doc={sketchDoc}
              status={sketchSolveStatus}
              dof={sketchDof}
              conflicts={sketchConflicts}
              selectedProfileCount={sketchDoc.selectedProfileIds.length || closedProfilesFromLegacy(sketchProfile).length}
              proEnabled={workspaceSettings.peakcadPro}
              onPatchSettings={(patch) => {
                setSketchDoc((doc) => ({ ...doc, settings: { ...doc.settings, ...patch } }));
              }}
              onRemoveConstraint={(constraintId) => {
                const nextDoc = removeConstraint(sketchDoc, constraintId);
                const solved = solveSketchDoc(nextDoc);
                setSketchDoc(solved.doc);
                setSketchSolveStatus(solved.status);
                setSketchDof(solved.dof);
                setSketchConflicts(solved.conflicts);
                setSketchProfile(sketchDocToProfile(solved.doc));
                setNotice("Constraint removed");
              }}
            />
            {sketchDoc.plane.hostShapeId ? (
              <div className="sketch-project-actions">
                <button
                  type="button"
                  className="sketch-project-edges-button"
                  onClick={() => {
                    const hostId = sketchDoc.plane.hostShapeId;
                    const host = hostId ? shapes.find((shape) => shape.id === hostId) : null;
                    if (!host) {
                      setNotice("Sketch on a face of a part first, then you can copy its edges");
                      return;
                    }
                    const edges = boxEdgesForProjection(
                      host.id,
                      { x: host.x, y: (host.elevation ?? 0) + host.height / 2, z: host.z },
                      { width: host.width, height: host.height, depth: host.depth },
                      sketchDoc.plane,
                    );
                    const projected = projectEdgesOntoSketch(sketchDoc, edges.slice(0, 4));
                    const solved = solveSketchDoc(projected.doc);
                    setSketchDoc(solved.doc);
                    setSketchSolveStatus(solved.status);
                    setSketchDof(solved.dof);
                    setSketchConflicts(solved.conflicts);
                    commitSketchProfile(sketchDocToProfile(solved.doc), `Projected ${projected.addedEntityIds.length} reference entities`, solved.doc);
                  }}
                >
                  Copy the part&apos;s edges
                </button>
              </div>
            ) : null}
            <div className="sketch-stage-footer">
              <SketchCoach
                tool={sketchHoverTool ?? sketchTool}
                closedCount={closedProfilesFromLegacy(sketchProfile).length}
                drawingGuides={sketchDoc.settings.constructionMode}
                placingPoint={Boolean(sketchActivePointId)}
                hovering={Boolean(sketchHoverTool)}
              />
              {sketchFocusTabs}
            </div>
            <SketchWorkspace
              profile={sketchProfile}
              viewKey={sketchDoc.id}
              referenceShapes={shapes.filter((shape) => shape.id !== editingSketchShapeId)}
              tool={sketchTool}
              activePointId={sketchActivePointId}
              selected={sketchSelection}
              measurement={sketchMeasurement}
              pendingMeasurementStart={sketchMeasureStart}
              initialSnap={snapGrid}
              initialWorkspace={workspaceSettings}
              onSnapChange={(nextSnap) => {
                updateProjectWorkspaceSettings({ workspace: workspaceSettings, snap: nextSnap });
              }}
              polygonSides={sketchPolygonSides}
              selectedProfileIds={sketchDoc.selectedProfileIds}
              activeSnap={lastSketchSnap}
              showDimensions={workspaceSettings.peakcadPro && sketchDoc.settings.showDimensions}
              dimensions={sketchDoc.dimensions}
              showConstraints={workspaceSettings.peakcadPro && sketchDoc.settings.showConstraints}
              constraints={sketchDoc.constraints}
              constraintEntities={sketchDoc.entities}
              constraintConflicts={sketchConflicts}
              solveStatus={workspaceSettings.peakcadPro ? sketchSolveStatus : "empty"}
              solveDof={workspaceSettings.peakcadPro ? sketchDof : 0}
              sweepMarkIds={sweepMarkIds}
              onPlanePoint={addSketchPlanePoint}
              onDrawCircle={addSketchCircle}
              onDrawEllipse={addSketchEllipse}
              onDrawSquare={addSketchSquare}
              onDrawRectangle={addSketchRectangle}
              onDrawRoundRect={addSketchRoundRect}
              onDrawSlot={addSketchSlot}
              onDrawTriangle={addSketchTriangle}
              onDrawPolygon={addSketchPolygon}
              onDrawStar={addSketchStar}
              onDrawArc={addSketchArc}
              onOffsetSegment={addSketchOffsetLine}
              onPointPress={pressSketchPoint}
              onSelectSegment={(id, at) => {
                if (pickSweepSegment(id)) return;
                if (sketchTool === "smooth") {
                  const segment = sketchProfile.segments.find((entry) => entry.id === id);
                  if (!segment) {
                    setNotice("Click a point to curve it");
                    return;
                  }
                  const next = withSketchPointMode(withSketchPointMode(sketchProfile, segment.startId, "smooth"), segment.endId, "smooth");
                  commitSketchProfile(next, "Point curved");
                  setSketchActivePointId(null);
                  setSketchSelection({ kind: "point", id: segment.endId });
                  return;
                }
                sketchPickAtRef.current = at ?? null;
                setSketchActivePointId(null);
                setSketchSelection((current) => accumulateSketchPick(current, sketchTool, { segmentId: id }));
                if (revolvePrompt) {
                  const axis = resolveSketchRevolveAxis(sketchProfile, { kind: "segment", id });
                  if (!axis) {
                    setNotice("That isn’t a straight axis line. Click a straight segment to revolve around.");
                  }
                }
              }}
              onSelectMany={(pointIds, segmentIds, imageIds) => {
                setSketchSelection(pointIds.length || segmentIds.length || imageIds.length ? { kind: "multiple", pointIds, segmentIds, imageIds } : null);
                setSketchActivePointId(null);
                const count = pointIds.length + segmentIds.length + imageIds.length;
                setNotice(count ? `Selected ${count} sketch item${count === 1 ? "" : "s"}` : "Sketch selection cleared");
              }}
              onSelectImage={(id) => {
                setSketchSelection({ kind: "image", id });
                setSketchActivePointId(null);
                setNotice("Sketch image selected");
              }}
              onUpdateImage={updateSketchImage}
              onDeleteImage={deleteSketchImage}
              onDeletePoint={deleteSketchPoint}
              onDeleteSegment={deleteSketchSegment}
              onEraseEntities={eraseSketchEntities}
              onMovePoint={moveSketchPoint}
              onMoveHandle={moveSketchHandle}
              onInsertPoint={insertSketchPoint}
              onSetPointMode={setSketchPointMode}
              onClearMeasurement={clearSketchMeasurement}
              onSelectProfile={(profileId) => {
                setSketchDoc((doc) => {
                  const selected = new Set(doc.selectedProfileIds);
                  if (selected.has(profileId)) selected.delete(profileId);
                  else selected.add(profileId);
                  return { ...doc, selectedProfileIds: [...selected] };
                });
              }}
              onEditDimension={(dimensionId, value) => {
                const solved = setDrivingDimensionValue(sketchDoc, dimensionId, value);
                setSketchDoc(solved.doc);
                setSketchSolveStatus(solved.status);
                setSketchDof(solved.dof);
                setSketchConflicts(solved.conflicts);
                commitSketchProfile(sketchDocToProfile(solved.doc), `Dimension → ${value.toFixed(2)}`, solved.doc);
              }}
              onSnapResolved={setLastSketchSnap}
              onToolChange={setActiveSketchTool}
              onNotice={setNotice}
              showConstruction={sketchDoc.settings.showConstruction}
              constructionGuides={constructionGuideLines(sketchDoc, sketchProfile)}
              onEditSegmentLength={editSketchSegmentLength}
              onEditCornerAngle={editSketchCornerAngle}
              onEditCircleRadius={editSketchCircleRadius}
            />
          </div>
          <SketchToolSidebar
            sketchTool={sketchTool}
            polygonSides={sketchPolygonSides}
            onSketchTool={setActiveSketchTool}
            onHoverTool={setSketchHoverTool}
            onPolygonSidesChange={setSketchPolygonSideCount}
          />
          </>
        ) : (
          <>
          {sketchActive && sketchFocusMode === "3d" ? (
            <SketchUtilitySidebar
              sketchTool={sketchTool}
              proEnabled={workspaceSettings.peakcadPro}
              onSketchTool={setActiveSketchTool}
              onHoverTool={setSketchHoverTool}
              onSketchImage={() => {
                setSketchFocusMode("2d");
                setSketchFrameRequest(0);
                setNotice("Choose Select on the flat sheet, then add the image");
              }}
            />
          ) : null}
          <div className="editor-canvas-area">
            <ActiveToolChip
              visible={Boolean(sketchActive && sketchFocusMode === "3d" ? sketchToolChip : activeToolChip)}
              label={(sketchActive && sketchFocusMode === "3d" ? sketchToolChip : activeToolChip)?.label ?? ""}
              hint={(sketchActive && sketchFocusMode === "3d" ? sketchToolChip : activeToolChip)?.hint}
            />
            {toolbarMode === "sketch" && !sketchActive ? (
              <SketchCreateMenu
                canEditSketch={shapeHasEditableSketch(selectedShape)}
                onNewSketch={beginSketchFacePick}
                onEditSketch={beginEditSelectedSketch}
              />
            ) : null}
            {sketchActive && sketchFocusMode === "3d" ? (
              <>
                {sweepDialog}
                <SketchPalette
                  doc={sketchDoc}
                  status={sketchSolveStatus}
                  dof={sketchDof}
                  conflicts={sketchConflicts}
                  selectedProfileCount={sketchDoc.selectedProfileIds.length || closedProfilesFromLegacy(sketchProfile).length}
                  proEnabled={workspaceSettings.peakcadPro}
                  onPatchSettings={(patch) => {
                    setSketchDoc((doc) => ({ ...doc, settings: { ...doc.settings, ...patch } }));
                  }}
                  onRemoveConstraint={(constraintId) => {
                    const nextDoc = removeConstraint(sketchDoc, constraintId);
                    const solved = solveSketchDoc(nextDoc);
                    setSketchDoc(solved.doc);
                    setSketchSolveStatus(solved.status);
                    setSketchDof(solved.dof);
                    setSketchConflicts(solved.conflicts);
                    setSketchProfile(sketchDocToProfile(solved.doc));
                    setNotice("Constraint removed");
                  }}
                />
                <div className="sketch-stage-footer">
                  <div className="sketch-3d-hint">
                    <span>Orbit to check the sketch on the part. Draw when the face is toward you.</span>
                  </div>
                  {sketchFocusTabs}
                </div>
              </>
            ) : null}
          <WorkplaneViewport
          settingsOpen={settingsOpen && !(toolbarMode === "sketch" && sketchActive && sketchFocusMode === "2d")}
          onSettingsClose={() => setSettingsOpen(false)}
          applyFlash={cadApplyFlash}
          sketchGuides={sketchActive ? {
            showGuides: sketchDoc.settings.showConstruction,
            drawAsGuides: sketchDoc.settings.constructionMode,
            onChange: patchSketchGuideSettings,
          } : undefined}
          sketchFrameRequest={sketchFrameRequest}
          sketchOnModel={sketchActive && sketchFocusMode === "3d" ? {
            plane: sketchProfile.sketchPlane ?? sketchDoc.plane,
            profile: sketchProfile,
            tool: sketchTool,
            snap: snapGrid,
            activePointId: sketchActivePointId,
            onPlanePoint: addSketchPlanePoint,
            onDrawCircle: addSketchCircle,
            onDrawEllipse: addSketchEllipse,
            onDrawSquare: addSketchSquare,
            onDrawRectangle: addSketchRectangle,
            onDrawRoundRect: addSketchRoundRect,
            onDrawSlot: addSketchSlot,
            onDrawTriangle: addSketchTriangle,
            onDrawPolygon: addSketchPolygon,
            onDrawStar: addSketchStar,
            onDrawArc: addSketchArc,
            onOffsetSegment: addSketchOffsetLine,
            onPointPress: pressSketchPoint,
            onSelectSegment: (id, at) => {
              if (pickSweepSegment(id)) return;
              sketchPickAtRef.current = at ?? null;
              setSketchActivePointId(null);
              setSketchSelection((current) => accumulateSketchPick(current, sketchTool, { segmentId: id }));
            },
            onSelectMany: (pointIds, segmentIds, imageIds) => {
              setSketchSelection(pointIds.length || segmentIds.length || imageIds.length ? { kind: "multiple", pointIds, segmentIds, imageIds } : null);
              setSketchActivePointId(null);
            },
            onMovePoint: moveSketchPoint,
            onEraseEntities: eraseSketchEntities,
            onNotice: setNotice,
          } : null}
          shapes={viewportShapes}
          selectedIds={historyBrowse !== null && historyBrowse !== historyIndex ? (history[historyBrowse]?.selectedIds ?? []) : selectedIds}
          alignMode={alignMode}
          alignAnchorId={effectiveAlignAnchorId}
          alignHandles={alignHandleStatuses}
          alignReferenceShapes={shapes}
          mirrorMode={mirrorMode}
          mirrorReferenceShapes={shapes}
          circularPatternMode={Boolean(circularPattern)}
          circularPatternCenter={circularPattern?.center ?? null}
          circularPatternRadius={circularPatternRadius}
          onCircularPatternCenterPick={setCircularPatternCenter}
          sketchFacePickMode={sketchFacePickMode}
          onSketchPlanePicked={(plane) => {
            beginSketch(undefined, null, plane);
          }}
          onSketchFacePickRejected={(reason) => setNotice(reason)}
          onSketchFacePickCancel={cancelSketchFacePick}
          placementRulerMode={Boolean(placementRuler)}
          onActivatePlacementRuler={togglePlacementRuler}
          onDeactivatePlacementRuler={deactivatePlacementRuler}
          initialSnap={initialSnap}
          initialWorkspace={initialWorkspace}
          workspaceSettingsKey={projectId ?? "local-workplane"}
          onSceneReady={onViewportReady}
          onAddShape={addShape}
          onAlignAnchorChange={chooseAlignAnchor}
          onAlignPreview={previewAlignSelection}
          onAlignPreviewClear={clearAlignPreview}
          onAlignSelection={alignSelectionTo}
          onMirrorPreview={previewMirrorSelection}
          onMirrorPreviewClear={clearMirrorPreview}
          onMirrorSelection={mirrorSelectionAcross}
          onSelectShape={historyBrowse !== null && historyBrowse !== historyIndex ? () => undefined : selectShape}
          onInteractionActiveChange={updateProjectInteractionActive}
          onEditSketch={shapeHasEditableSketch(selectedShape) ? beginEditSelectedSketch : undefined}
          onEditSketchDimension={resolveEditableSketchShape(
            activeFeatureId && selectedShape?.groupedShapes
              ? selectedShape.groupedShapes.find((child) => child.id === activeFeatureId) ?? selectedShape
              : selectedShape,
          )?.sketchDoc?.dimensions?.length ? editSelectedSketchDimension : undefined}
          canSeparateParts={canSeparateSelectedParts}
          onSeparateParts={separateSelectedParts}
          onReduceTriangles={reduceSelectedMesh}
          activeFeatureId={activeFeatureId}
          onSelectFeature={(featureId) => {
            setActiveFeatureId(featureId);
            if (featureId) {
              const body = selectedShape?.groupedShapes?.length
                ? selectedShape
                : shapes.find((shape) => shape.groupedShapes?.some((child) => child.id === featureId));
              const feature = body?.groupedShapes?.find((child) => child.id === featureId);
              setNotice(feature ? `Feature selected: ${feature.name || feature.kind}` : "Feature selected");
            }
          }}
          onSuppressFeature={selectedShape?.groupedShapes?.length ? suppressSelectedFeature : undefined}
          modelTreeLocked={Boolean(edgeModifier)}
          onReorderFeature={selectedShape?.groupedShapes?.length ? reorderSelectedFeature : undefined}
          onUpdateFeature={selectedShape?.groupedShapes?.length ? updateSelectedFeature : undefined}
          onEditPattern={selectedShape?.patternFeature ? () => {
            if (selectedShape.patternFeature?.kind === "linear") toggleLinearPattern();
            else toggleCircularPattern();
          } : undefined}
          onDissolvePattern={selectedShape?.patternFeature ? () => {
            const featureId = selectedShape.patternFeature?.id;
            if (!featureId) return;
            commitShapes(dissolvePatternFeature(shapesRef.current, featureId), selectedIds, "Pattern dissolved — copies are independent");
          } : undefined}
          onUpdateShape={updateShape}
          onWorkspaceSettingsChange={updateProjectWorkspaceSettings}
          modifierActive={Boolean(edgeModifier)}
          modifierPreserveSelection={false}
          modifierPreviewActive={Boolean(edgeModifier?.preview || pushPullSession?.preview)}
          modifierEdges={modifierSelectableEdges}
          selectedModifierEdgeIds={edgeModifier ? edgeModifier.selectedEdgeIds : []}
          onModifierEdgeToggle={toggleModifierEdge}
          pushPullActive={Boolean(pushPullSession)}
          pushPullFaces={pushPullSession?.faces ?? []}
          pushPullHoverFaceId={pushPullSession?.hoverFaceId ?? null}
          pushPullSelectedFaceId={pushPullSession?.selectedFaceId ?? null}
          pushPullDistance={pushPullSession?.distance ?? 0}
          pushPullShowGhost={Boolean(
            pushPullSession
            && pushPullSession.selectedFaceId !== null
            && Math.abs(pushPullSession.distance) > 1e-4
            && (pushPullSession.dragging || pushPullSession.settling || !pushPullSession.preview),
          )}
          pushPullGhostOpacity={pushPullSession?.ghostOpacity ?? 1}
          pushPullChipText={pushPullSession && Math.abs(pushPullSession.distance) > 1e-3
            ? `${formatMeasurementNumber(millimetersToDisplay(pushPullSession.distance, workspaceSettings), workspaceSettings.accuracy)} ${lengthDisplayUnit(workspaceSettings).label}`
            : null}
          onPushPullHover={(faceId) => setPushPullSession((current) => current ? { ...current, hoverFaceId: faceId } : current)}
          onPushPullDragStart={(faceId, distance) => setPushPullSession((current) => current?.prepared ? {
            ...current,
            selectedFaceId: faceId,
            distance,
            dragging: true,
            settling: false,
            ghostOpacity: 1,
            error: null,
          } : current)}
          onPushPullDrag={(distance) => setPushPullSession((current) => current?.prepared ? {
            ...current,
            distance,
            dragging: true,
            error: null,
          } : current)}
          onPushPullDragEnd={(distance) => {
            const session = pushPullSessionRef.current;
            if (!session?.prepared) return;
            if (Math.abs(distance) < PUSH_PULL_APPLY_EPSILON) {
              setPushPullSession({ ...session, distance: 0, dragging: false, preview: null, error: null });
              return;
            }
            setPushPullSession({ ...session, distance, dragging: false });
          }}
          onPushPullDistanceCommit={(distance) => {
            const millimeters = displayToMillimeters(distance, workspaceSettingsRef.current);
            setPushPullSession((current) => current?.prepared ? { ...current, distance: millimeters, dragging: false } : current);
          }}
          viewNudgeAxesRef={viewNudgeAxesRef}
          rotationEditApiRef={rotationEditApiRef}
          onDropToWorkplane={dropSelectedToWorkplane}
          dropSurfaceActive={dropSurface}
          onDropSurfacePick={pickDropSurface}
          faceSnapActive={faceSnap !== null || layFlat || dropSurface}
          faceSnapSource={faceSnap?.source ?? null}
          faceSnapMotionRef={faceSnapMotionRef}
          onFaceSnapPick={pickFaceSnap}
          splitPlane={splitPlane}
          inspectorDockTop={
            splitSession && selectedShape && selectedShape.id === splitSession.shapeId ? (
              <ToolbarFlow tool="Split" label="Split">
                <SplitPanel
                  targetName={selectedShape.name}
                  axis={splitSession.axis}
                  offset={splitSession.offset}
                  limit={splitPlane?.limit ?? 10}
                  joint={splitSession.joint}
                  clearance={splitSession.clearance}
                  workspace={workspaceSettings}
                  busy={false}
                  onAxisChange={(axis) => setSplitSession((current) => current ? { ...current, axis, offset: 0 } : current)}
                  onOffsetChange={(offset) => setSplitSession((current) => current ? { ...current, offset } : current)}
                  onJointChange={(joint) => setSplitSession((current) => current ? { ...current, joint } : current)}
                  onClearanceChange={(clearance) => setSplitSession((current) => current ? { ...current, clearance } : current)}
                  onApply={applySplit}
                  onCancel={cancelSplit}
                />
              </ToolbarFlow>
            ) : pushPullSession && selectedShape ? (
              <ToolbarFlow tool="Push Pull" label="Push Pull">
                <PushPullPanel
                  targetName={selectedShape.name}
                  distance={pushPullSession.distance}
                  maxDistance={Math.max(shapeWidth(selectedShape), shapeDepth(selectedShape), selectedShape.height) * 2}
                  workspace={workspaceSettings}
                  busy={pushPullSession.busy || pushPullSession.settling}
                  prepared={pushPullSession.prepared}
                  error={pushPullSession.error}
                  onDistanceChange={(distance) => setPushPullSession((current) => current?.prepared ? {
                    ...current,
                    selectedFaceId: current.selectedFaceId ?? current.faces[0]?.id ?? null,
                    distance,
                    preview: null,
                    error: null,
                  } : current)}
                  onApply={() => playPushPullSettle(pushPullSession.distance)}
                  onCancel={() => {
                    invalidateCadModifierSession();
                    setNotice("Push Pull cancelled");
                  }}
                />
              </ToolbarFlow>
            ) : shellSession && selectedShape ? (
              <ToolbarFlow tool="Hollow" label="Hollow">
              <ShellPanel
                targetName={selectedShape.name}
                thickness={shellSession.thickness}
                maxThickness={shellMaxThickness(
                  { width: shapeWidth(selectedShape), depth: shapeDepth(selectedShape), height: selectedShape.height },
                  shellSession.openings,
                )}
                openings={shellSession.openings}
                corners={shellSession.corners}
                cornerRadius={shellSession.cornerRadius}
                workspace={workspaceSettings}
                busy={shellSession.busy}
                prepared={shellSession.prepared}
                error={shellSession.error}
                onThicknessChange={(thickness) => setShellSession((current) => current ? {
                  ...current,
                  thickness,
                  cornerRadius: Math.min(current.cornerRadius, thickness),
                  preview: null,
                } : current)}
                onCornersChange={(corners) => setShellSession((current) => current ? { ...current, corners, preview: null } : current)}
                onCornerRadiusChange={(cornerRadius) => setShellSession((current) => current ? { ...current, cornerRadius, preview: null } : current)}
                onOpeningsChange={(openings) => setShellSession((current) => current ? { ...current, openings, preview: null } : current)}
                onApply={applyShell}
                onCancel={() => {
                  invalidateCadModifierSession();
                  setNotice("Hollow cancelled");
                }}
              />
              </ToolbarFlow>
            ) : edgeModifier ? (
              <ToolbarFlow tool={edgeModifier.kind === "fillet" ? "Fillet" : "Chamfer"} label={edgeModifier.kind === "fillet" ? "Fillet" : "Chamfer"}>
              <EdgeModifierPanel
                kind={edgeModifier.kind}
                editing={Boolean(edgeModifier.editRecipe)}
                amount={edgeModifier.amount}
                maxAmount={edgeModifierMaxAmount}
                chamferAngle={edgeModifier.chamferAngle}
                quality={edgeModifier.quality}
                sharpAngle={edgeModifier.sharpAngle}
                workspace={workspaceSettings}
                tangentChain={edgeModifier.tangentChain}
                preserveEdgeSize={edgeModifier.preserveEdgeSize}
                targetName={selectedShape?.name ?? "Object"}
                groupedCount={selectedShape?.groupedShapes?.length ?? 0}
                appliedFeatureCount={selectedEdgeFeatureCount}
                reversibleFeatureCount={selectedReversibleEdgeFeatureCount}
                historyOptions={selectedEdgeHistoryOptions}
                selectedCount={edgeModifier.selectedEdgeIds.length}
                availableCount={modifierAvailableEdgeIds.length}
                busy={edgeModifier.busy}
                prepared={edgeModifier.prepared}
                error={edgeModifier.error}
                onAmountChange={(value) => setEdgeModifier((current) => current?.prepared ? { ...current, amount: Math.max(MIN_EDGE_MODIFIER_AMOUNT, Math.min(edgeModifierMaxAmount, value)), preview: null, busy: true, error: null } : current)}
                onChamferAngleChange={(value) => setEdgeModifier((current) => current?.prepared ? { ...current, chamferAngle: Math.max(5, Math.min(85, value)), preview: null, busy: true, error: null } : current)}
                onQualityChange={(quality) => setEdgeModifier((current) => current?.prepared ? { ...current, quality, preview: null, busy: true, error: null } : current)}
                onSharpAngleChange={(sharpAngle) => setEdgeModifier((current) => {
                  if (!current?.prepared) return current;
                  const nextAngle = Math.max(1, Math.min(CAD_MODIFIER_MAX_SHARP_ANGLE, sharpAngle));
                  const availableIds = new Set(current.edges
                    .filter((edge) => selectableCadModifierEdge(edge, nextAngle))
                    .map((edge) => edge.id));
                  const selectedEdgeIds = current.selectedEdgeIds.filter((edgeId) => availableIds.has(edgeId));
                  return {
                    ...current,
                    sharpAngle: nextAngle,
                    selectedEdgeIds,
                    preview: null,
                    busy: selectedEdgeIds.length > 0,
                    error: availableIds.size === 0 ? "No sharp edges match this threshold" : selectedEdgeIds.length ? null : "Select at least one highlighted edge",
                  };
                })}
                onTangentChainChange={(tangentChain) => setEdgeModifier((current) => current?.prepared ? { ...current, tangentChain } : current)}
                onPreserveEdgeSizeChange={(preserveEdgeSize) => setEdgeModifier((current) => current?.prepared ? { ...current, preserveEdgeSize } : current)}
                onSelectAll={() => setEdgeModifier((current) => current?.prepared ? { ...current, selectedEdgeIds: modifierAvailableEdgeIds, preview: null, busy: modifierAvailableEdgeIds.length > 0, error: modifierAvailableEdgeIds.length ? null : current.error } : current)}
                onClear={() => setEdgeModifier((current) => current?.prepared ? { ...current, selectedEdgeIds: [], preview: null, busy: false, error: "Select at least one highlighted edge" } : current)}
                onRemoveFeature={removeEdgeTreatment}
                onApply={applyEdgeModifier}
                onCancel={cancelEdgeModifier}
              />
              </ToolbarFlow>
            ) : null
          }
          inspectorDock={
            placementRuler && hasSelection ? (
              <PlacementRulerPanel
                offsets={placementRuler.baseline && selectedShape && selectedShape.id === placementRuler.baselineId
                  ? placementOffsetsFromBaseline(selectedShape, placementRuler.baseline)
                  : { x: 0, y: 0, z: 0 }}
                workspace={workspaceSettings}
                autoFocusFirst
                onOffsetChange={applyPlacementRulerOffset}
                onCancel={() => {
                  setPlacementRuler(null);
                  setNotice("Placement ruler closed");
                }}
              />
            ) : linearPattern ? (
              <ToolbarFlow tool="Linear pattern" label="Linear pattern">
              <LinearPatternPanel
                sourceCount={linearPattern.sourceIds.length}
                countX={linearPattern.countX}
                countZ={linearPattern.countZ}
                countY={linearPattern.countY}
                spacingX={linearPattern.spacingX}
                spacingZ={linearPattern.spacingZ}
                spacingY={linearPattern.spacingY}
                canApply={Boolean(linearPattern.preview?.length)}
                workspace={workspaceSettings}
                onCountXChange={(countX) => patchLinearPattern({ countX })}
                onCountZChange={(countZ) => patchLinearPattern({ countZ })}
                onCountYChange={(countY) => patchLinearPattern({ countY })}
                onSpacingXChange={(spacingX) => patchLinearPattern({ spacingX })}
                onSpacingZChange={(spacingZ) => patchLinearPattern({ spacingZ })}
                onSpacingYChange={(spacingY) => patchLinearPattern({ spacingY })}
                onApply={applyLinearPattern}
                onCancel={cancelLinearPattern}
                applyLabel={linearPattern.editing ? "Update" : "Apply"}
                editing={Boolean(linearPattern.editing)}
                positionClampWarning={linearPatternWouldClamp(
                  shapes.filter((shape) => linearPattern.sourceIds.includes(shape.id)),
                  linearPattern,
                  linearPattern,
                )}
              />
              </ToolbarFlow>
            ) : circularPattern ? (
              <ToolbarFlow tool="Circular pattern" label="Circular pattern">
              <CircularPatternPanel
                sourceCount={circularPatternSources.length}
                count={circularPattern.count}
                radiusMm={circularPatternRadius}
                rotationDeg={circularPattern.rotation}
                canApply={Boolean(circularPattern.center && circularPattern.preview?.length)}
                workspace={workspaceSettings}
                onCountChange={patchCircularPatternCount}
                onRadiusChange={patchCircularPatternRadius}
                onRotationChange={patchCircularPatternRotation}
                onApply={applyCircularPattern}
                onCancel={cancelCircularPattern}
                applyLabel={circularPattern.editing ? "Update" : "Apply"}
                editing={Boolean(circularPattern.editing)}
                positionClampWarning={Boolean(
                  circularPattern.center
                  && circularPatternWouldClamp(circularPattern.center, circularPattern.radius, circularPattern.count),
                )}
              />
              </ToolbarFlow>
            ) : null
          }
          />
          {modelLoadingName || exactStepSaveProgress ? (
            <div className="model-loading-overlay" role="status" aria-live="polite">
              <div className="model-loading-card">
                <span className="model-loading-wheel" aria-hidden="true" />
                <strong>{exactStepSaveProgress ? "Saving exact STEP…" : "Loading model…"}</strong>
                <span className="model-loading-file">
                  {exactStepSaveProgress
                    ? `${exactStepSaveProgress.done} / ${exactStepSaveProgress.total} imported ${exactStepSaveProgress.total === 1 ? "body" : "bodies"}`
                    : modelLoadingName}
                </span>
              </div>
            </div>
          ) : null}
          {historyBrowse !== null ? (
            <HistoryPanel
              entries={history}
              index={historyBrowse}
              liveIndex={historyIndex}
              onIndexChange={(index) => {
                const max = Math.max(0, history.length - 1);
                setHistoryBrowse(Math.min(max, Math.max(0, index)));
              }}
              onRestore={() => {
                const next = historyBrowse;
                void restoreHistoryEntry(next, "Restored", false).then(() => setHistoryBrowse(null));
              }}
              onClose={() => setHistoryBrowse(null)}
            />
          ) : null}
          </div>
          {sketchActive && sketchFocusMode === "3d" ? (
            <SketchToolSidebar
              sketchTool={sketchTool}
              polygonSides={sketchPolygonSides}
              onSketchTool={setActiveSketchTool}
              onHoverTool={setSketchHoverTool}
              onPolygonSidesChange={setSketchPolygonSideCount}
            />
          ) : null}
          {toolbarMode === "geometry" ? (
            <ShapeSidebar
              shapes={historyBrowse !== null && historyBrowse !== historyIndex ? viewportShapes : shapes}
              selectedIds={historyBrowse !== null && historyBrowse !== historyIndex ? (history[historyBrowse]?.selectedIds ?? []) : selectedIds}
              collapsed={hasSelection && !shapeRailPinned}
              onExpand={() => setShapeRailPinned(true)}
              onCollapse={hasSelection ? () => setShapeRailPinned(false) : undefined}
              onSelectShape={historyBrowse !== null && historyBrowse !== historyIndex ? () => undefined : selectShape}
              onAddShape={(shape) => {
                addShape(shape);
                setTopPanel(null);
                setMenuOpen(false);
              }}
            />
          ) : null}
          </>
        )}
        {sketchActive && extrudeHeightPrompt !== null ? (
          <div className="sketch-extrude-prompt-layer">
            <div className="sketch-tool-prompt-backdrop" aria-hidden onPointerDown={(event) => event.preventDefault()} />
            <div className="sketch-revolve-prompt phase-confirm" role="dialog" aria-modal="true" aria-label="Extrude height">
              <div className="sketch-revolve-prompt-copy">
                <strong>Extrude to 3D</strong>
                <span>
                  {extrudeAsHole
                    ? (isDefaultSketchPlane(sketchProfile.sketchPlane)
                      ? "Create a hole cutter, then select it with a solid and Group to cut."
                      : "Cut into the face you sketched on (through depth by default).")
                    : (isDefaultSketchPlane(sketchProfile.sketchPlane)
                      ? "Create a solid you can move and edit like any other object."
                      : "Join onto the face you sketched on (Fusion-style Extrude → Join).")}
                </span>
              </div>
              <div className="shape-state-card sketch-extrude-mode" role="group" aria-label="Extrude as solid or hole">
                <button
                  type="button"
                  className={!extrudeAsHole ? "active solid-choice" : "solid-choice"}
                  aria-pressed={!extrudeAsHole}
                  aria-label="Extrude as solid"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setExtrudeAsHole(false);
                  }}
                >
                  <ShapeModeMark kind="sketch" color="#d41721" silhouette={classifySketchExtrude(sketchProfile, sketchDoc)} />
                  <span>{isDefaultSketchPlane(sketchProfile.sketchPlane) ? "Solid" : "Join"}</span>
                </button>
                <button
                  type="button"
                  className={extrudeAsHole ? "active hole-choice" : "hole-choice"}
                  aria-pressed={extrudeAsHole}
                  aria-label="Extrude as hole"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setExtrudeAsHole(true);
                  }}
                >
                  <ShapeModeMark kind="sketch" hole silhouette={classifySketchExtrude(sketchProfile, sketchDoc)} />
                  <span>{isDefaultSketchPlane(sketchProfile.sketchPlane) ? "Hole" : "Cut"}</span>
                </button>
              </div>
              <div className="sketch-extrude-height-prompt" aria-label="Extrude height">
                <button
                  type="button"
                  aria-label="Decrease height"
                  onClick={() => setExtrudeHeightPrompt((value) => Math.max(0.5, Number(((value ?? 10) - 1).toFixed(2))))}
                >
                  −
                </button>
                <label className="sketch-extrude-height-field">
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={extrudeHeightPrompt}
                    onChange={(event) => {
                      const next = Number.parseFloat(event.target.value);
                      if (Number.isFinite(next)) setExtrudeHeightPrompt(Math.max(0.5, next));
                    }}
                  />
                  <span>mm</span>
                </label>
                <button
                  type="button"
                  aria-label="Increase height"
                  onClick={() => setExtrudeHeightPrompt((value) => Number(((value ?? 10) + 1).toFixed(2)))}
                >
                  +
                </button>
              </div>
              <div className="sketch-revolve-prompt-actions">
                <button type="button" className="primary" onClick={() => finishSketchExtrude(extrudeHeightPrompt, extrudeAsHole)}>
                  {extrudeAsHole
                    ? (isDefaultSketchPlane(sketchProfile.sketchPlane) ? "Create hole" : "Cut into part")
                    : (isDefaultSketchPlane(sketchProfile.sketchPlane) ? "Create solid" : "Join to part")}
                </button>
                <button type="button" className="cancel" onClick={cancelExtrudeHeightPrompt}>Cancel</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {renderedTopPanel ? (
        <TopActionPanel
          panel={renderedTopPanel}
          closing={topPanelClosing}
          shapeCount={exportableShapeCount}
          scopeLabel={exportScopeLabel}
          stepPreflight={exportPreflight}
          onClose={() => {
            setStlSeatPrompt(null);
            setTopPanel(null);
          }}
          onExport={exportDesign}
          onOpenSlicer={openInSlicer}
          slicerLabel={slicer.choice.label}
          slicerCaption={slicer.choice.caption}
          slicerBusy={slicer.busy}
          slicerOptions={slicer.options}
          slicerListOpen={slicer.listOpen}
          onToggleSlicerList={() => slicer.setListOpen((open) => !open)}
          onSelectSlicer={(key) => {
            slicer.selectKey(key);
            slicer.setListOpen(false);
          }}
          onExportStep={exportStepDesign}
          onExportBlueprint={() => {
            setTopPanel(null);
            openBlueprintExport();
          }}
          blueprintExporting={blueprintExporting}
          stepExporting={stepExporting}
          onImportFiles={selectFiles}
          onPickFile={() => fileInputRef.current?.click()}
          importAsHole={importAsHole}
          onImportAsHoleChange={setImportAsHole}
          stlSeatFileName={stlSeatPrompt?.name ?? null}
          stlSeatUnitLabel={lengthDisplayUnit(workspaceSettings).label}
          onLayStlFlat={() => void placeStlImport("lay-flat")}
          onKeepStlOrientation={() => void placeStlImport("keep-orientation")}
        />
      ) : null}
      <input
        ref={sketchImageInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void addSketchImageFile(file);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        className="hidden-file-input"
        type="file"
        accept=".stl,.step,.stp,.svg,.3mf,image/svg+xml"
        onChange={(event) => {
          if (event.currentTarget.files) {
            selectFiles(event.currentTarget.files);
          }
          event.currentTarget.value = "";
        }}
      />
      <ExportSuccessOverlay event={exportSuccess} />
      {valueDialog?.kind === "sketch-fillet" || valueDialog?.kind === "sketch-chamfer" ? (
        <InlineValueDialog
          title={valueDialog.kind === "sketch-fillet" ? "Fillet corners" : "Chamfer corners"}
          fields={[
            {
              key: "amount",
              label: valueDialog.kind === "sketch-fillet" ? "Fillet radius" : "Chamfer distance",
              value: "2",
              unit: "mm",
              min: 0,
            },
          ]}
          note={`${valueDialog.pointIds.length} corner${valueDialog.pointIds.length === 1 ? "" : "s"}. Each shared edge keeps at most 45%.`}
          confirmLabel={valueDialog.kind === "sketch-fillet" ? "Fillet" : "Chamfer"}
          onCancel={cancelValueDialog}
          onConfirm={confirmSketchFilletChamferDialog}
        />
      ) : null}
      {valueDialog?.kind === "sketch-stroke" ? (
        <InlineValueDialog
          title="Lineweight"
          fields={[
            { key: "width", label: "Wall width", value: "2", unit: "mm", min: 0.1 },
            { key: "side", label: "Side", value: "center" },
          ]}
          note="center, inside, or outside. A closed outline becomes a frame. An open line becomes a stripe."
          confirmLabel="Lineweight"
          onCancel={() => {
            cancelValueDialog();
            setSketchTool("select");
          }}
          onConfirm={confirmSketchStrokeDialog}
        />
      ) : null}
      {valueDialog?.kind === "sketch-pattern" ? (
        <InlineValueDialog
          title="Linear pattern"
          fields={[
            { key: "countX", label: "Count X", value: "3", inputMode: "numeric", min: 1, step: "1" },
            { key: "countZ", label: "Count Z", value: "1", inputMode: "numeric", min: 1, step: "1" },
            { key: "spacingX", label: "Spacing X", value: "10", unit: "mm" },
            { key: "spacingZ", label: "Spacing Z", value: "10", unit: "mm" },
          ]}
          confirmLabel="Create pattern"
          onCancel={cancelValueDialog}
          onConfirm={confirmSketchPatternDialog}
        />
      ) : null}
      {settingsOpen && sketchActive && sketchFocusMode === "2d" && toolbarMode === "sketch" ? (
        <WorkspaceSettingsModal
          workspace={workspaceSettings}
          snap={snapGrid}
          onWorkspaceChange={(workspace) => updateProjectWorkspaceSettings({ workspace, snap: snapGrid })}
          onSnapChange={(snap) => updateProjectWorkspaceSettings({ workspace: workspaceSettings, snap })}
          onMakeDefault={makeSketchWorkspaceDefault}
          onClose={() => setSettingsOpen(false)}
          sketchGuides={{
            showGuides: sketchDoc.settings.showConstruction,
            drawAsGuides: sketchDoc.settings.constructionMode,
            onChange: patchSketchGuideSettings,
          }}
        />
      ) : null}
      {valueDialog?.kind === "sketch-circular-pattern" ? (
        <InlineValueDialog
          title="Circular pattern"
          fields={[
            { key: "count", label: "Copies", value: "6", inputMode: "numeric", min: 2, step: "1" },
          ]}
          note="Copies spin around the middle of what you selected. Lines, curves, circles, and arcs all copy."
          confirmLabel="Create pattern"
          onCancel={() => {
            cancelValueDialog();
            setSketchTool("select");
          }}
          onConfirm={confirmSketchCircularPatternDialog}
        />
      ) : null}
      <div
        className={`editor-toast${noticeVisible ? " visible" : ""}${noticeQuiet ? " editor-toast--quiet" : ""}`}
        role="status"
        aria-live="polite"
      >
        <span className="editor-toast-message">{notice}</span>
        {noticeVisible ? (
          <button
            className="editor-toast-dismiss"
            type="button"
            aria-label="Dismiss message"
            onClick={dismissNotice}
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        ) : null}
      </div>
      <pre data-codex-state hidden>
        {debugState}
      </pre>
      <pre data-codex-summary hidden>
        {compactDebugState}
      </pre>
    </div>
  );
}

function TopActionPanel({
  panel,
  closing = false,
  shapeCount,
  scopeLabel,
  stepPreflight,
  onClose,
  onExport,
  onOpenSlicer,
  slicerLabel,
  slicerCaption,
  slicerBusy,
  slicerOptions,
  slicerListOpen,
  onToggleSlicerList,
  onSelectSlicer,
  onExportStep,
  onExportBlueprint,
  blueprintExporting = false,
  stepExporting,
  onImportFiles,
  onPickFile,
  importAsHole = false,
  onImportAsHoleChange,
  stlSeatFileName = null,
  stlSeatUnitLabel = "mm",
  onLayStlFlat,
  onKeepStlOrientation,
}: {
  panel: Exclude<TopPanel, null>;
  closing?: boolean;
  shapeCount: number;
  scopeLabel: "selected" | "total";
  stepPreflight: StepPreflightRow[];
  onClose: () => void;
  onExport: (format: ExportFormat) => void;
  onOpenSlicer: () => void;
  slicerLabel: string;
  slicerCaption: string;
  slicerBusy: boolean;
  slicerOptions: { key: string; label: string; selected: boolean }[];
  slicerListOpen: boolean;
  onToggleSlicerList: () => void;
  onSelectSlicer: (key: string) => void;
  onExportStep: () => void;
  onExportBlueprint?: () => void;
  blueprintExporting?: boolean;
  stepExporting: boolean;
  onImportFiles: (files: FileList | File[]) => void;
  onPickFile: () => void;
  importAsHole?: boolean;
  onImportAsHoleChange?: (hole: boolean) => void;
  stlSeatFileName?: string | null;
  stlSeatUnitLabel?: string;
  onLayStlFlat?: () => void;
  onKeepStlOrientation?: () => void;
}) {
  const title =
    panel === "tips"
      ? "Tips"
      : panel === "export"
        ? "Export"
        : "Import";
  const anchored = panel === "import" || panel === "export";
  const [anchor, setAnchor] = useState<{ top: number; left: number; caret: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchored) {
      setAnchor(null);
      return;
    }
    const place = () => {
      const button = document.querySelector<HTMLElement>(`[data-toolbar-tool="${title}"]`);
      const width = 322;
      const margin = 12;
      if (!button) {
        setAnchor(null);
        return;
      }
      const rect = button.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      let left = center - 36;
      left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - margin - width));
      setAnchor({
        top: rect.bottom + 8,
        left,
        caret: Math.max(16, center - left),
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchored, title]);

  return (
    <div
      className={`top-action-anchor${anchored && anchor ? " is-anchored" : ""}${closing ? " is-closing" : ""}`}
      style={anchored
        ? anchor
          ? {
            top: anchor.top,
            left: anchor.left,
            right: "auto",
            ["--toolbar-caret" as string]: `${anchor.caret}px`,
          }
          : { visibility: "hidden" }
        : undefined}
    >
    <div className="top-action-panel" role="dialog" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <button aria-label={`Close ${title}`} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {panel === "import" ? (
        <div className="top-action-body">
          <button
            className="import-drop-zone"
            onClick={onPickFile}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (event.dataTransfer.files.length > 0) {
                onImportFiles(event.dataTransfer.files);
              }
            }}
          >
            <ToolbarImportIcon />
            <strong>Drop STL, STEP, SVG, or 3MF files</strong>
            <span>or click to choose from your computer</span>
          </button>
          <label className="import-as-hole">
            <input
              type="checkbox"
              checked={importAsHole}
              onChange={(event) => onImportAsHoleChange?.(event.currentTarget.checked)}
            />
            Import as hole
          </label>
          {stlSeatFileName ? (
            <div className="import-seat-choice">
              <p>{stlSeatFileName} is ready. Choose how it should sit.</p>
              <p>1 file unit imports as 1 {stlSeatUnitLabel}, the workplane unit.</p>
              <button type="button" className="export-primary" onClick={onLayStlFlat}>
                Lay flat
              </button>
              <button type="button" onClick={onKeepStlOrientation}>
                Keep orientation
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {panel === "export" ? (
        <div className="top-action-body export-panel-body">
          <p>{shapeCount} {scopeLabel} solid shape{shapeCount === 1 ? "" : "s"} ready to print.</p>
          <button className="export-primary" type="button" onClick={onOpenSlicer} disabled={slicerBusy}>
            <ToolbarExportIcon />
            {slicerBusy ? "Opening…" : slicerLabel}
          </button>
          <p className="export-step-note">{slicerCaption}</p>
          <div className="export-mesh-actions export-mesh-actions--pair">
            <button type="button" onClick={() => onExport("3mf")}>
              <Download size={18} />
              Download 3MF
            </button>
            <button type="button" onClick={() => onExport("stl")}>
              <Download size={18} />
              Download STL
            </button>
          </div>
          <div className="export-mesh-actions">
            <button type="button" onClick={onExportStep} disabled={stepExporting}>
              <ToolbarExportIcon />
              {stepExporting ? "Building STEP…" : "Download STEP"}
            </button>
            <button type="button" onClick={() => onExport("obj")}>
              <ToolbarExportIcon />
              Download OBJ
            </button>
            {onExportBlueprint ? (
              <button type="button" onClick={onExportBlueprint} disabled={blueprintExporting} aria-busy={blueprintExporting}>
                <ToolbarExportIcon />
                {blueprintExporting ? "Building blueprint…" : "Download blueprint"}
              </button>
            ) : null}
            <button type="button" onClick={onToggleSlicerList} aria-expanded={slicerListOpen}>
              {slicerListOpen ? "Hide slicers" : "Change slicer"}
            </button>
          </div>
          {slicerListOpen ? (
            <div className="export-slicer-list" role="listbox" aria-label="Slicer">
              {slicerOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="option"
                  aria-selected={option.selected}
                  aria-current={option.selected ? "true" : undefined}
                  onClick={() => onSelectSlicer(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          {stepPreflight.length > 0 ? (
            <ul className="export-body-list" aria-label="STEP quality by body">
              {stepPreflight.map((row, index) => (
                <li key={`${row.name}-${row.kind}-${index}`} className="export-body-row">
                  <span className="export-body-row-name">{row.name || "Untitled"}</span>
                  <span
                    className={`cad-ready-badge${row.quality === "faceted" ? " cad-ready-badge--mesh" : ""}${row.quality === "pending" || row.quality === "unsupported" ? " cad-ready-badge--pending" : ""}`}
                    title={row.detail}
                  >
                    {shapeExportQualityLabel(row.quality)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {panel === "tips" ? (
        <div className="top-action-body">
          <p><strong>CAD path (30 seconds)</strong></p>
          <p>1. Drop a Box. 2. Sketch on a face → draw a circle → Extrude as Hole. 3. Group. 4. Download STEP — look for Exact vs Faceted.</p>
          <p>Round cylinders and boxes export as true CAD. Stretch a cylinder oval and it still exports exact (elliptical). STL imports stay faceted mesh STEP.</p>
          <p>Click a shape to select it. Use the inspector Model tree for suppress/reorder, and the Edge tools for fillet/chamfer.</p>
          <p><strong>Beta tip</strong></p>
          <p>PeakCAD is local-first — no account. Assemblies (Group without holes) export multi-solid STEP. Sketch H/V/coincident and driving dims stick hard; fillet recipes re-apply after remesh when topology allows.</p>
        </div>
      ) : null}
    </div>
    </div>
  );
}

