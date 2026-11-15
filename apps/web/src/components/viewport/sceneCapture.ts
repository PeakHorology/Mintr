import * as THREE from "three";
import { resolveViewportBackground, resolveWorkplaneBaseColor, type UiTheme } from "@/lib/uiTheme";
import type { CaptureSceneImageOptions, ThreeState } from "@/components/viewport/viewportTypes";
import { applyXrayClipping } from "@/components/viewport/xrayScene";

/** Capture the current viewport as a PNG data URL. */
export function captureSceneImage(state: ThreeState, options: CaptureSceneImageOptions = {}) {
  const hideOverlays = options.hideOverlays !== false;
  const overlayLayers = [state.workplaneLayer, state.helperLayer, state.modifierLayer, state.xrayLayer, state.printLayer];
  const previousVisibility = overlayLayers.map((layer) => layer.visible);
  const previousXray = { ...state.xray };
  if (hideOverlays) {
    for (const layer of overlayLayers) {
      layer.visible = false;
    }
  }
  try {
    if (hideOverlays && previousXray.enabled) {
      applyXrayClipping(state, { enabled: false }, { immediate: true });
    }
    state.camera.updateMatrixWorld();
    state.renderer.render(state.scene, state.camera);
    return state.renderer.domElement.toDataURL("image/png");
  } finally {
    if (hideOverlays && previousXray.enabled) {
      applyXrayClipping(state, previousXray, { immediate: true });
    }
    if (hideOverlays) {
      overlayLayers.forEach((layer, index) => {
        layer.visible = previousVisibility[index] ?? true;
      });
    }
    state.needsRender = true;
  }
}

export function applyCaptureThemeLook(state: ThreeState, storedBackground: string, theme: UiTheme) {
  state.scene.background = new THREE.Color(resolveViewportBackground(storedBackground, theme));
  const base = state.workplaneLayer.getObjectByName("WorkplaneBase");
  if (base instanceof THREE.Mesh && base.material instanceof THREE.MeshStandardMaterial) {
    base.material.color.set(resolveWorkplaneBaseColor(theme));
  }
}

/** Capture the same framing once for light and once for dark dashboard tiles. */
export function captureSceneImagesForThemes(
  state: ThreeState,
  storedBackground: string,
  options: CaptureSceneImageOptions = {},
) {
  const previousBackground = state.scene.background;
  const base = state.workplaneLayer.getObjectByName("WorkplaneBase");
  const previousBaseColor =
    base instanceof THREE.Mesh && base.material instanceof THREE.MeshStandardMaterial
      ? base.material.color.clone()
      : null;
  try {
    applyCaptureThemeLook(state, storedBackground, "light");
    const light = captureSceneImage(state, options);
    applyCaptureThemeLook(state, storedBackground, "dark");
    const dark = captureSceneImage(state, options);
    return { light, dark };
  } finally {
    if (previousBackground) {
      state.scene.background = previousBackground;
    }
    if (
      previousBaseColor
      && base instanceof THREE.Mesh
      && base.material instanceof THREE.MeshStandardMaterial
    ) {
      base.material.color.copy(previousBaseColor);
    }
    state.needsRender = true;
  }
}
