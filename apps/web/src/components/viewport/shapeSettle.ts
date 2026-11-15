import * as THREE from "three";
import { prefersReducedMotion } from "@/lib/chromePresence";

/** A new part drops this far onto the bed and lands softly: enough to read as arriving, not falling. */
export const NEW_SOLID_SETTLE_MM = 6;
export const NEW_SOLID_SETTLE_MS = 320;

export function cancelShapeMotion(object: THREE.Object3D) {
  const handle = object.userData.motionHandle as number | undefined;
  if (handle) cancelAnimationFrame(handle);
  delete object.userData.motionHandle;
  delete object.userData.settling;
}

export function clearShapeSettle(object: THREE.Object3D) {
  cancelShapeMotion(object);
  delete object.userData.pendingSettle;
  delete object.userData.settleRestY;
  delete object.userData.combining;
  delete object.userData.combineRestScale;
  delete object.userData.rising;
  delete object.userData.riseRestPos;
  delete object.userData.riseHeight;
  delete object.userData.riseRestScale;
}

export function settleLiftMm() {
  return prefersReducedMotion() ? 0 : NEW_SOLID_SETTLE_MM;
}

export function pauseShapeSettle(object: THREE.Object3D) {
  if (object.userData.combining) {
    const rest = object.userData.combineRestScale;
    if (rest instanceof THREE.Vector3) object.scale.copy(rest);
    clearShapeSettle(object);
    object.updateMatrixWorld(true);
    return;
  }
  if (object.userData.rising) {
    const rest = object.userData.riseRestScale;
    const origin = object.userData.riseRestPos;
    if (rest instanceof THREE.Vector3) object.scale.copy(rest);
    if (origin instanceof THREE.Vector3) object.position.copy(origin);
    clearShapeSettle(object);
    object.updateMatrixWorld(true);
    return;
  }
  const restY = typeof object.userData.settleRestY === "number"
    ? object.userData.settleRestY
    : object.position.y - NEW_SOLID_SETTLE_MM;
  const shouldResume = Boolean(object.userData.settling || object.userData.pendingSettle);
  cancelShapeMotion(object);
  if (!shouldResume || prefersReducedMotion()) {
    delete object.userData.pendingSettle;
    delete object.userData.settleRestY;
    return;
  }
  object.userData.pendingSettle = true;
  object.userData.settleRestY = restY;
  object.position.y = restY + NEW_SOLID_SETTLE_MM;
}

/** How far above its resting place a dropping shape still is, or 0 if it is not dropping. */
export function remainingSettleLift(object: THREE.Object3D) {
  if (!object.userData.settling && !object.userData.pendingSettle) return 0;
  const restY = object.userData.settleRestY;
  if (typeof restY !== "number") return 0;
  const lift = object.position.y - restY;
  return lift > 0.01 ? Math.min(lift, NEW_SOLID_SETTLE_MM) : 0;
}
