import type { ShapeAsset } from "@/types/sketchforge";

/** HTML5 DnD cannot read payload during dragover — keep the active asset here. */
let activeAsset: ShapeAsset | null = null;
let transparentDragImage: HTMLCanvasElement | null = null;

export function beginShapeAssetDrag(asset: ShapeAsset) {
  activeAsset = asset;
}

export function endShapeAssetDrag() {
  activeAsset = null;
}

export function getShapeAssetDrag() {
  return activeAsset;
}

/** Hide the browser's default icon/image ghost so the viewport can show a real solid. */
export function applyTransparentDragImage(dataTransfer: DataTransfer) {
  if (typeof document === "undefined") {
    return;
  }
  if (!transparentDragImage) {
    transparentDragImage = document.createElement("canvas");
    transparentDragImage.width = 1;
    transparentDragImage.height = 1;
    transparentDragImage.style.position = "fixed";
    transparentDragImage.style.left = "-100px";
    transparentDragImage.style.top = "0";
    transparentDragImage.style.pointerEvents = "none";
    document.body.appendChild(transparentDragImage);
  }
  dataTransfer.setDragImage(transparentDragImage, 0, 0);
}
