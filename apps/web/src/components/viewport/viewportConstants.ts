import * as THREE from "three";
import { DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";

export const WORKPLANE_WIDTH = 200;
export const WORKPLANE_DEPTH = 140;
export const MIN_GRID_BLOCK_SIZE = 1;
export const MAX_GRID_BLOCK_SIZE = 200;
export const WORKSPACE_DEFAULTS_STORAGE_PREFIX = "sketchForge.workspaceDefault.";
export const DEFAULT_WORKSPACE = DEFAULT_WORKPLANE_WORKSPACE;
export const CAMERA_HOME = new THREE.Vector3(118, 96, 118);
export const CAMERA_TARGET = new THREE.Vector3(0, 0, 0);

export const MIN_SHAPE_SIZE = 0.01;

export const CUT_PREVIEW_PADDING = 0.01;
export const MIN_ELEVATION = -180;
export const MAX_ELEVATION = 220;
export const CAMERA_MIN_TARGET_Y = -70;
export const CAMERA_MAX_TARGET_Y = 120;
/** Quiet frames required before measurement overlays return after a camera move.
 * One still frame is enough: a later update that does not move the camera is ignored. */
export const CAMERA_OVERLAY_SETTLE_FRAMES = 1;
/** Pose change below this is a trailing damping tick, not a new pan. distance² / quaternion epsilon. */
export const CAMERA_OVERLAY_TRAIL_EPS = 1e-4;
