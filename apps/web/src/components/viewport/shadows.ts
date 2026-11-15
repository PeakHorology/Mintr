import * as THREE from "three";
import type { DragState, ThreeState } from "@/components/viewport/viewportTypes";

/** Force shadow maps to regenerate so contact/WebGL shadows track live drag previews. */
export function markShadowsDirty(state: ThreeState) {
  state.renderer.shadowMap.needsUpdate = true;
  state.keyLight.shadow.needsUpdate = true;
}

export function hideDragShadows(drag: DragState) {
  if (drag.shadowsHidden) return;
  const casters: THREE.Mesh[] = [];
  drag.items.forEach((item) => {
    item.visual?.traverse((child) => {
      if (child instanceof THREE.Mesh && child.castShadow) {
        child.castShadow = false;
        casters.push(child);
      }
    });
  });
  drag.shadowCasters = casters;
  drag.shadowsHidden = true;
}

export function restoreDragShadows(state: ThreeState | null, drag: DragState) {
  drag.shadowCasters?.forEach((mesh) => {
    mesh.castShadow = true;
  });
  drag.shadowCasters = undefined;
  drag.shadowsHidden = false;
  if (state) markShadowsDirty(state);
}
