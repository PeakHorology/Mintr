import * as THREE from "three";
import type { ShapeAsset } from "@/types/sketchforge";
import { makeShapeFromAsset } from "@/lib/shapeCatalog";
import { createThreadShape } from "@/lib/threadShape";
import type { ThreeState } from "@/components/viewport/viewportTypes";
import { markShadowsDirty } from "@/components/viewport/shadows";
import { disposeObject } from "@/components/viewport/shapeOutlines";
import { settleLiftMm } from "@/components/viewport/shapeSettle";
import { createShapeObject } from "@/components/viewport/shapeObjects";

export const ASSET_PLACEMENT_PREVIEW_NAME = "AssetPlacementPreview";

export function clearAssetPlacementPreviewObject(state: ThreeState) {
  const existing = state.scene.getObjectByName(ASSET_PLACEMENT_PREVIEW_NAME);
  if (!existing) {
    return;
  }
  state.scene.remove(existing);
  disposeObject(existing);
}

/** Live 3D ghost while dragging a palette shape onto the workplane. */
export function syncAssetPlacementPreview(
  state: ThreeState,
  asset: ShapeAsset,
  x: number,
  z: number,
  elevation: number,
  sheetThickness?: number,
) {
  let preview = state.scene.getObjectByName(ASSET_PLACEMENT_PREVIEW_NAME);
  const needsRebuild =
    !preview
    || preview.userData.sheetThickness !== sheetThickness
    || preview.userData.assetKind !== asset.kind
    || preview.userData.assetId !== asset.id
    || preview.userData.assetColor !== asset.color
    || preview.userData.assetHole !== Boolean(asset.hole);

  if (needsRebuild) {
    clearAssetPlacementPreviewObject(state);
    const draft = asset.kind === "thread"
      ? createThreadShape({
          point: { x, z, elevation },
          base: {
            id: "asset-preview-thread",
            name: asset.name,
            color: asset.color,
          },
        })
      : makeShapeFromAsset(asset, { x, z, elevation }, undefined, sheetThickness);
    preview = createShapeObject(draft, false);
    preview.name = ASSET_PLACEMENT_PREVIEW_NAME;
    preview.userData.sheetThickness = sheetThickness;
    preview.userData.assetKind = asset.kind;
    preview.userData.assetId = asset.id;
    preview.userData.assetColor = asset.color;
    preview.userData.assetHole = Boolean(asset.hole);
    preview.userData.previewHeight = draft.height;
    preview.userData.shapeId = undefined;
    preview.traverse((child) => {
      child.userData.shapeId = undefined;
      if (child instanceof THREE.LineSegments || child instanceof THREE.Line) {
        child.visible = false;
        return;
      }
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material || Array.isArray(material)) {
          return;
        }
        material.transparent = true;
        material.opacity = Math.min(0.82, "opacity" in material && typeof material.opacity === "number" ? material.opacity : 1);
        material.depthWrite = true;
      });
    });
    state.scene.add(preview);
  }
  if (preview) {
    const height = typeof preview.userData.previewHeight === "number" ? preview.userData.previewHeight : 20;
    const lift = asset.hole ? 0 : settleLiftMm();
    preview.position.set(x, elevation + height / 2 + lift, z);
    preview.updateMatrixWorld(true);
  }
  markShadowsDirty(state);
}
