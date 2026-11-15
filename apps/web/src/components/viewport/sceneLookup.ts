import * as THREE from "three";
import type { ThreeState } from "@/components/viewport/viewportTypes";

export function findShapeObject(state: ThreeState, id: string) {
  return state.shapeLayer.children.find((child) => (
    child.userData.shapeId === id
    && child.userData.edgeWipeRole !== "out"
    && !child.userData.previewHold
  )) ?? null;
}

export function findSelectionHelper(state: ThreeState, id: string) {
  const helper = state.helperLayer.children.find((child) => child.userData.shapeId === id);
  return helper instanceof THREE.Box3Helper ? helper : null;
}

export function findSelectedGroundFootprint(state: ThreeState, id: string) {
  return state.helperLayer.children.find((child) => child.name === "SelectedGroundFootprint" && child.userData.shapeId === id) ?? null;
}
