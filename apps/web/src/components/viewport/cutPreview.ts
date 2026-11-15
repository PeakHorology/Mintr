import * as THREE from "three";
import { Brush, Evaluator, HOLLOW_INTERSECTION } from "three-bvh-csg";
import { CUT_PREVIEW_TRIANGLE_SKIP, displayTriangleCount } from "@/lib/displayTriangleCount";
import { shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";
import { CUT_PREVIEW_PADDING, MIN_SHAPE_SIZE } from "@/components/viewport/viewportConstants";
import type { CutPreviewShapeFrame, ThreeState } from "@/components/viewport/viewportTypes";
import { findShapeObject } from "@/components/viewport/sceneLookup";
import { disposeObject } from "@/components/viewport/shapeOutlines";
import { applyXrayClipping } from "@/components/viewport/xrayScene";
import { createHoleStripeMaterial } from "@/components/viewport/shapeObjects";

export function shapeCutPreviewFrames(state: ThreeState, shapes: WorkplaneShape[]) {
  return shapes.reduce<Record<string, CutPreviewShapeFrame>>((frames, shape) => {
    const object = findShapeObject(state, shape.id);
    if (!object) {
      return frames;
    }
    object.updateMatrixWorld(true);
    const worldBounds = new THREE.Box3().setFromObject(object);
    if (!worldBounds.isEmpty()) {
      frames[shape.id] = { shape, worldBounds };
    }
    return frames;
  }, {});
}

export type CutPreviewBrushCacheEntry = {
  signature: string;
  brush: Brush;
};

export const cutPreviewBrushCache = new WeakMap<THREE.Object3D, CutPreviewBrushCacheEntry>();
export const cutPreviewEvaluator = new Evaluator();
cutPreviewEvaluator.useGroups = false;
cutPreviewEvaluator.attributes = ["position", "normal"];

export function cutPreviewObjectSignature(root: THREE.Object3D) {
  const parts: string[] = [];
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.visible || !(child.geometry instanceof THREE.BufferGeometry)) {
      return;
    }
    const relativeMatrix = inverseRoot.clone().multiply(child.matrixWorld);
    parts.push(child.geometry.uuid, ...relativeMatrix.elements.map((value) => value.toFixed(5)));
  });
  return parts.join(":");
}

export function cutPreviewBrushFromObject(root: THREE.Object3D) {
  const signature = cutPreviewObjectSignature(root);
  const cached = cutPreviewBrushCache.get(root);
  if (cached?.signature === signature) {
    cached.brush.matrixAutoUpdate = false;
    cached.brush.matrix.copy(root.matrixWorld);
    cached.brush.matrixWorld.copy(root.matrixWorld);
    return cached.brush;
  }

  const positions: number[] = [];
  const point = new THREE.Vector3();
  const inverseRoot = root.matrixWorld.clone().invert();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.visible || !(child.geometry instanceof THREE.BufferGeometry)) {
      return;
    }

    const position = child.geometry.getAttribute("position");
    if (!position) {
      return;
    }
    const index = child.geometry.getIndex();
    const count = index?.count ?? position.count;
    const relativeMatrix = inverseRoot.clone().multiply(child.matrixWorld);
    const mirrored = relativeMatrix.determinant() < 0;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const triangle = [0, 1, 2].map((corner) => {
        const vertexIndex = index ? index.getX(offset + corner) : offset + corner;
        return point
          .set(position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex))
          .applyMatrix4(relativeMatrix)
          .toArray();
      });
      if (mirrored) {
        [triangle[1], triangle[2]] = [triangle[2], triangle[1]];
      }
      positions.push(...triangle[0], ...triangle[1], ...triangle[2]);
    }
  });

  if (positions.length < 9) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const brush = new Brush(geometry);
  brush.matrixAutoUpdate = false;
  brush.matrix.copy(root.matrixWorld);
  brush.matrixWorld.copy(root.matrixWorld);
  if (cached) {
    cached.brush.geometry.dispose();
  }
  cutPreviewBrushCache.set(root, { signature, brush });
  return brush;
}

export function cutPreviewActualIntersectionGeometry(state: ThreeState, solid: WorkplaneShape, hole: WorkplaneShape) {
  if (displayTriangleCount(solid) + displayTriangleCount(hole) > CUT_PREVIEW_TRIANGLE_SKIP) {
    return null;
  }
  const solidObject = findShapeObject(state, solid.id);
  const holeObject = findShapeObject(state, hole.id);
  if (!solidObject || !holeObject) {
    return null;
  }

  const solidBrush = cutPreviewBrushFromObject(solidObject);
  const holeBrush = cutPreviewBrushFromObject(holeObject);
  if (!solidBrush || !holeBrush) {
    return null;
  }

  // Equal-height cylinders have coplanar caps. Feeding those surfaces directly
  // to three-bvh-csg can turn a few hundred input triangles into hundreds of
  // thousands of preview triangles. A tiny local expansion preserves the
  // visible cut while keeping the preview topology bounded.
  const holeScale = new THREE.Matrix4().makeScale(
    (shapeWidth(hole) + CUT_PREVIEW_PADDING * 2) / Math.max(MIN_SHAPE_SIZE, shapeWidth(hole)),
    (hole.height + CUT_PREVIEW_PADDING * 2) / Math.max(MIN_SHAPE_SIZE, hole.height),
    (shapeDepth(hole) + CUT_PREVIEW_PADDING * 2) / Math.max(MIN_SHAPE_SIZE, shapeDepth(hole)),
  );
  const paddedHoleMatrix = holeBrush.matrix.clone().multiply(holeScale);
  // Never mutate the WeakMap-cached brush matrix — padding would accumulate across previews.
  const savedMatrix = holeBrush.matrix.clone();
  const savedMatrixWorld = holeBrush.matrixWorld.clone();
  holeBrush.matrix.copy(paddedHoleMatrix);
  holeBrush.matrixWorld.copy(paddedHoleMatrix);

  try {
    const result = cutPreviewEvaluator.evaluate(solidBrush, holeBrush, HOLLOW_INTERSECTION);
    const position = result.geometry.getAttribute("position");
    if (!position || position.count < 3) {
      result.geometry.dispose();
      return null;
    }
    const geometry = result.geometry.clone();
    geometry.applyMatrix4(result.matrixWorld);
    result.geometry.dispose();
    geometry.computeVertexNormals();
    return geometry;
  } catch {
    return null;
  } finally {
    holeBrush.matrix.copy(savedMatrix);
    holeBrush.matrixWorld.copy(savedMatrixWorld);
  }
}

export function addCutPreviewOverlays(state: ThreeState, holeFrame: CutPreviewShapeFrame, solidFrames: CutPreviewShapeFrame[]) {
  solidFrames.forEach((solidFrame) => {
    if (!holeFrame.worldBounds.intersectsBox(solidFrame.worldBounds)) {
      return;
    }

    const geometry = cutPreviewActualIntersectionGeometry(state, solidFrame.shape, holeFrame.shape);
    if (!geometry) {
      return;
    }
    const preview = new THREE.Mesh(geometry, createHoleStripeMaterial("overlap"));
    preview.name = "CutPreviewOverlay";
    preview.renderOrder = 8;
    preview.userData.cutPreview = true;
    preview.raycast = () => undefined;
    state.shapeLayer.add(preview);
  });
}

export let cutPreviewSyncTimer: ReturnType<typeof setTimeout> | null = null;
export let cutPreviewSyncGeneration = 0;

/** Drop any pending CSG cut-preview so it cannot hitch a drag/transform frame. */
export function cancelScheduledCutPreviewOverlays() {
  cutPreviewSyncGeneration += 1;
  if (cutPreviewSyncTimer !== null) {
    clearTimeout(cutPreviewSyncTimer);
    cutPreviewSyncTimer = null;
  }
}

export function clearCutPreviewOverlays(state: ThreeState) {
  cancelScheduledCutPreviewOverlays();
  const overlays: THREE.Object3D[] = [];
  state.shapeLayer.traverse((child) => {
    if (child.userData.cutPreview) {
      overlays.push(child);
    }
  });
  overlays.forEach((overlay) => {
    overlay.parent?.remove(overlay);
    disposeObject(overlay);
  });
}

export function syncCutPreviewOverlays(state: ThreeState, shapes: WorkplaneShape[]) {
  // Drop any pending debounce, then rebuild overlays now.
  cancelScheduledCutPreviewOverlays();
  const overlays: THREE.Object3D[] = [];
  state.shapeLayer.traverse((child) => {
    if (child.userData.cutPreview) {
      overlays.push(child);
    }
  });
  overlays.forEach((overlay) => {
    overlay.parent?.remove(overlay);
    disposeObject(overlay);
  });
  const visibleShapes = shapes.filter((shape) => !shape.hidden);
  const holeCount = visibleShapes.reduce((count, shape) => count + (shape.hole ? 1 : 0), 0);
  if (holeCount === 0) {
    applyXrayClipping(state);
    return;
  }
  const cutFrames = shapeCutPreviewFrames(state, visibleShapes);
  const solidFrames = visibleShapes
    .filter((shape) => !shape.hole)
    .map((shape) => cutFrames[shape.id])
    .filter((frame): frame is CutPreviewShapeFrame => Boolean(frame));

  if (solidFrames.length === 0) {
    applyXrayClipping(state);
    return;
  }

  visibleShapes.forEach((shape) => {
    if (!shape.hole) {
      return;
    }
    const holeFrame = cutFrames[shape.id];
    if (holeFrame) {
      addCutPreviewOverlays(state, holeFrame, solidFrames);
    }
  });
  applyXrayClipping(state);
}

/** Debounce CSG cut-preview so fingerprint rebuilds don't hitch the main thread. */
export function scheduleCutPreviewOverlays(state: ThreeState, shapes: WorkplaneShape[]) {
  const generation = ++cutPreviewSyncGeneration;
  if (cutPreviewSyncTimer !== null) {
    clearTimeout(cutPreviewSyncTimer);
  }
  cutPreviewSyncTimer = setTimeout(() => {
    cutPreviewSyncTimer = null;
    if (generation !== cutPreviewSyncGeneration) return;
    syncCutPreviewOverlays(state, shapes);
    state.needsRender = true;
  }, 48);
}
