import * as THREE from "three";
import { prefersReducedMotion } from "@/lib/chromePresence";
import type { EdgeWipeState, ThreeState } from "@/components/viewport/viewportTypes";
import { easeOutCubic, easeOutQuint } from "@/components/viewport/easing";
import { findShapeObject } from "@/components/viewport/sceneLookup";
import {
  attachObjectOutline,
  clearNamedOutlines,
  createOutlineLineMaterial,
  disposeObject,
  syncSelectionOutline,
} from "@/components/viewport/shapeOutlines";
import { cancelShapeMotion, clearShapeSettle, NEW_SOLID_SETTLE_MM, NEW_SOLID_SETTLE_MS } from "@/components/viewport/shapeSettle";

export const SKETCH_EXTRUDE_RISE_MS = 420;
export const SKETCH_EXTRUDE_START_SCALE = 0.06;
export const MAX_SETTLE_SHAPES = 6;
/** Group/Tie/Intersect start slightly large and ease in — not the new-solid drop. */
export const COMBINE_START_SCALE = 1.08;
/** Ungroup is the inverse: pieces grow out from a slightly small start. */
export const SEPARATE_START_SCALE = 1 / COMBINE_START_SCALE;
export const COMBINE_MS = 240;
export const APPLY_FLASH_MS = 200;
export const APPLY_FLASH_NAME = "ShapeApplyFlash";
/** Edge-treatment dissolve: short, one curve, nothing flies through the part. */
export const EDGE_WIPE_MS = 520;
export const EDGE_WIPE_TRACE_NAME = "EdgeWipeTrace";
export const EDGE_WIPE_TRACE_COLOR = new THREE.Color("#2aa77e");
/** Peak brightness lift on the treated body; the lift is the body's own colour, not a tint. */
export const EDGE_WIPE_SHEEN_INTENSITY = 0.18;
export const EDGE_WIPE_WHITE = new THREE.Color("#ffffff");

/** Drops a new shape onto its place. `fromLift` picks the drop up part-way, from that height. */
export function startShapeSettle(state: ThreeState, object: THREE.Object3D, fromLift = NEW_SOLID_SETTLE_MM) {
  if (prefersReducedMotion()) {
    if (typeof object.userData.settleRestY === "number") object.position.y = object.userData.settleRestY;
    clearShapeSettle(object);
    object.updateMatrixWorld(true);
    state.needsRender = true;
    return;
  }
  cancelShapeMotion(object);
  const restY = typeof object.userData.settleRestY === "number" ? object.userData.settleRestY : object.position.y;
  delete object.userData.pendingSettle;
  object.userData.settling = true;
  object.userData.settleRestY = restY;
  // Where on the ease-out curve the shape is at that height, so the drop carries on smoothly.
  const lift = Math.max(0, Math.min(NEW_SOLID_SETTLE_MM, fromLift));  const startT = 1 - (lift / NEW_SOLID_SETTLE_MM) ** (1 / 5);
  object.position.y = restY + lift;
  object.updateMatrixWorld(true);
  const started = performance.now() - startT * NEW_SOLID_SETTLE_MS;
  const tick = (now: number) => {
    if (!object.parent) {
      clearShapeSettle(object);
      return;
    }
    const targetY = typeof object.userData.settleRestY === "number" ? object.userData.settleRestY : restY;
    const t = Math.min(1, (now - started) / NEW_SOLID_SETTLE_MS);
    // Quintic ease-out: most of the drop early, then a long soft landing.
    const eased = 1 - (1 - t) ** 5;
    object.position.y = targetY + NEW_SOLID_SETTLE_MM * (1 - eased);
    object.updateMatrixWorld(true);
    state.needsRender = true;
    if (t < 1) {
      object.userData.motionHandle = requestAnimationFrame(tick);
      return;
    }
    object.position.y = targetY;
    object.updateMatrixWorld(true);
    clearShapeSettle(object);
  };
  object.userData.motionHandle = requestAnimationFrame(tick);
  state.needsRender = true;
}

/** The extrude shown before it is made. Even as a hole it rises out of the sketch. */
export const SKETCH_EXTRUDE_PREVIEW_ID = "sketch-extrude-preview";

export function startSketchExtrudeRise(state: ThreeState, object: THREE.Object3D) {
  if (prefersReducedMotion()) {
    clearShapeSettle(object);
    object.updateMatrixWorld(true);
    state.needsRender = true;
    return;
  }
  cancelShapeMotion(object);
  const restPos = object.position.clone();
  const restScale = object.scale.clone();
  const height = typeof object.userData.riseHeight === "number"
    ? object.userData.riseHeight
    : Math.max(object.userData.rulerDimensions?.[1] ?? 1, 1);
  object.userData.rising = true;
  object.userData.riseRestPos = restPos;
  object.userData.riseRestScale = restScale;
  object.userData.riseHeight = height;
  const poseAt = (scaleY: number) => {
    const rest = object.userData.riseRestScale instanceof THREE.Vector3
      ? object.userData.riseRestScale
      : restScale;
    const origin = object.userData.riseRestPos instanceof THREE.Vector3
      ? object.userData.riseRestPos
      : restPos;
    const liveHeight = typeof object.userData.riseHeight === "number" ? object.userData.riseHeight : height;
    object.scale.set(rest.x, rest.y * scaleY, rest.z);
    const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(object.quaternion);
    object.position.copy(origin).addScaledVector(localUp, -(liveHeight / 2) * (1 - scaleY));
  };
  poseAt(SKETCH_EXTRUDE_START_SCALE);
  object.updateMatrixWorld(true);
  const started = performance.now();
  const tick = (now: number) => {
    if (!object.parent || !object.userData.rising) {
      clearShapeSettle(object);
      return;
    }
    const t = Math.min(1, (now - started) / SKETCH_EXTRUDE_RISE_MS);
    const eased = 1 - (1 - t) ** 3;
    const scaleY = SKETCH_EXTRUDE_START_SCALE + (1 - SKETCH_EXTRUDE_START_SCALE) * eased;
    poseAt(scaleY);
    object.updateMatrixWorld(true);
    state.needsRender = true;
    if (t < 1) {
      object.userData.motionHandle = requestAnimationFrame(tick);
      return;
    }
    poseAt(1);
    object.updateMatrixWorld(true);
    clearShapeSettle(object);
  };
  object.userData.motionHandle = requestAnimationFrame(tick);
  state.needsRender = true;
}

export function startShapeCombine(state: ThreeState, object: THREE.Object3D, startScale = COMBINE_START_SCALE) {
  if (prefersReducedMotion()) {
    clearShapeSettle(object);
    object.updateMatrixWorld(true);
    state.needsRender = true;
    return;
  }
  cancelShapeMotion(object);
  const restScale = object.scale.clone();
  object.userData.combining = true;
  object.userData.combineRestScale = restScale;
  object.scale.copy(restScale).multiplyScalar(startScale);
  object.updateMatrixWorld(true);
  const started = performance.now();
  const tick = (now: number) => {
    if (!object.parent || !object.userData.combining) {
      clearShapeSettle(object);
      return;
    }
    const rest = object.userData.combineRestScale instanceof THREE.Vector3
      ? object.userData.combineRestScale
      : restScale;
    const t = Math.min(1, (now - started) / COMBINE_MS);
    const eased = 1 - (1 - t) ** 3;
    const scale = startScale + (1 - startScale) * eased;
    object.scale.copy(rest).multiplyScalar(scale);
    object.updateMatrixWorld(true);
    state.needsRender = true;
    if (t < 1) {
      object.userData.motionHandle = requestAnimationFrame(tick);
      return;
    }
    object.scale.copy(rest);
    object.updateMatrixWorld(true);
    clearShapeSettle(object);
  };
  object.userData.motionHandle = requestAnimationFrame(tick);
  state.needsRender = true;
}

export function tagEdgeWipeRole(object: THREE.Object3D, role: "in" | "out") {
  object.userData.edgeWipeRole = role;
  object.traverse((child) => {
    child.userData.edgeWipeRole = role;
  });
}

export function stashPreviewHold(state: ThreeState, object: THREE.Object3D, shapeId: string) {
  object.userData.previewHold = true;
  object.visible = false;
  setObjectPickable(object, false);
  object.userData.showEdges = false;
  syncSelectionOutline(object, false);
  if (object.parent) object.parent.remove(object);
  state.previewHold.set(shapeId, object);
}

export function restorePreviewHold(state: ThreeState, held: THREE.Object3D) {
  held.userData.previewHold = false;
  delete held.userData.previewHold;
  held.visible = true;
  setObjectPickable(held, true);
  if (!held.parent) state.shapeLayer.add(held);
}

export function disposePreviewHold(state: ThreeState, held: THREE.Object3D) {
  if (held.parent) held.parent.remove(held);
  disposeObject(held);
}

export function setObjectPickable(object: THREE.Object3D, pickable: boolean) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (!pickable) {
      child.userData.wipePrevRaycast = child.raycast;
      child.raycast = () => undefined;
      return;
    }
    if (typeof child.userData.wipePrevRaycast === "function") {
      child.raycast = child.userData.wipePrevRaycast;
      delete child.userData.wipePrevRaycast;
    }
  });
}

export function edgeTracePositions(polylines: number[][]) {
  const segments: number[] = [];
  for (const points of polylines) {
    const count = Math.floor(points.length / 3);
    for (let index = 0; index + 1 < count; index += 1) {
      const from = index * 3;
      const ax = points[from];
      const ay = points[from + 1];
      const az = points[from + 2];
      const bx = points[from + 3];
      const by = points[from + 4];
      const bz = points[from + 5];
      if (Math.hypot(bx - ax, by - ay, bz - az) < 1e-5) continue;
      segments.push(ax, ay, az, bx, by, bz);
    }
  }
  return new Float32Array(segments.length >= 6 ? segments : [0, 0, 0, 0, 0, 0]);
}

export function setEdgeWipeProgress(wipe: EdgeWipeState, t: number) {
  // The old corners melt away first; the sheen and edge trace linger a little
  // longer so the eye lands on what changed, then everything is at rest.
  const dissolve = easeOutCubic(Math.min(1, t / 0.8));
  const linger = easeOutQuint(t);
  for (const entry of wipe.dissolving) {
    entry.material.opacity = entry.opacity * (1 - dissolve);
  }
  wipe.outgoing.visible = dissolve < 1;
  const sheen = (1 - linger) * EDGE_WIPE_SHEEN_INTENSITY;
  for (const entry of wipe.sheen) {
    entry.material.emissiveIntensity = sheen;
  }
  const traceMaterial = wipe.trace.material as THREE.LineBasicMaterial;
  traceMaterial.opacity = 0.9 * (1 - linger);
}

export function finishEdgeWipe(state: ThreeState) {
  const wipe = state.edgeWipe;
  if (!wipe) return;
  cancelAnimationFrame(wipe.handle);
  for (const entry of wipe.dissolving) {
    entry.material.opacity = entry.opacity;
    if (entry.material.transparent !== entry.transparent) {
      entry.material.transparent = entry.transparent;
      entry.material.needsUpdate = true;
    }
    entry.material.depthWrite = entry.depthWrite;
    entry.material.polygonOffsetFactor = entry.polygonOffsetFactor;
    entry.material.polygonOffsetUnits = entry.polygonOffsetUnits;
  }
  if (wipe.outgoing.parent) {
    wipe.outgoing.parent.remove(wipe.outgoing);
    disposeObject(wipe.outgoing);
  }
  for (const entry of wipe.sheen) {
    entry.material.emissive.copy(entry.emissive);
    entry.material.emissiveIntensity = entry.intensity;
  }
  if (wipe.trace.parent) wipe.trace.parent.remove(wipe.trace);
  disposeObject(wipe.trace);
  wipe.incoming.traverse((child) => {
    delete child.userData.edgeWipeRole;
  });
  delete wipe.incoming.userData.edgeWipeRole;
  state.edgeWipe = null;
  state.needsRender = true;
}

/**
 * Edge-treatment reveal. The untreated body stays in place and dissolves over
 * the treated one, so sharp corners appear to melt into the new fillets while
 * the body carries a brief mint sheen and the treated edges fade out.
 */
export function startEdgeWipe(state: ThreeState, outgoing: THREE.Object3D, incoming: THREE.Object3D, polylines: number[][]) {
  if (state.edgeWipe) finishEdgeWipe(state);
  if (prefersReducedMotion()) {
    if (outgoing.parent) {
      outgoing.parent.remove(outgoing);
      disposeObject(outgoing);
    }
    return;
  }
  const trace = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(edgeTracePositions(polylines), 3)),
    new THREE.LineBasicMaterial({
      color: EDGE_WIPE_TRACE_COLOR,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  trace.name = EDGE_WIPE_TRACE_NAME;
  trace.renderOrder = 1006;
  trace.frustumCulled = false;
  trace.raycast = () => undefined;

  outgoing.visible = true;
  delete outgoing.userData.previewHold;
  if (!outgoing.parent) state.shapeLayer.add(outgoing);
  setObjectPickable(outgoing, false);
  outgoing.userData.showEdges = false;
  syncSelectionOutline(outgoing, false);
  tagEdgeWipeRole(incoming, "in");
  tagEdgeWipeRole(outgoing, "out");

  const dissolving: EdgeWipeState["dissolving"] = [];
  outgoing.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material || !("opacity" in material)) continue;
      if (material.userData.shared) {
        // Shared outline/crease materials cannot be faded without touching other shapes.
        child.visible = false;
        continue;
      }
      const target = material as THREE.Material & { opacity: number };
      dissolving.push({
        material: target,
        opacity: target.opacity,
        transparent: target.transparent,
        depthWrite: target.depthWrite,
        polygonOffsetFactor: target.polygonOffsetFactor,
        polygonOffsetUnits: target.polygonOffsetUnits,
      });
      if (!target.transparent) {
        target.transparent = true;
        // Opaque programs force alpha to 1, so the shader must be rebuilt for opacity to show.
        target.needsUpdate = true;
      }
      // Sit a hair behind the treated body so coincident faces resolve to the
      // new surface and only the removed corners show through the fade.
      target.polygonOffset = true;
      target.polygonOffsetFactor += 2;
      target.polygonOffsetUnits += 2;
    }
  });

  // Both bodies catch the same light so the part reads as one object while its
  // corners melt, rather than a bright body wearing a dark frame.
  const sheen: EdgeWipeState["sheen"] = [];
  for (const body of [incoming, outgoing]) {
    body.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial) || material.userData.shared || material.userData.holeStripe) continue;
        sheen.push({ material, emissive: material.emissive.clone(), intensity: material.emissiveIntensity });
        // Lift the body toward white in its own hue: a brief catch of light, not a colour change.
        material.emissive.copy(material.color).lerp(EDGE_WIPE_WHITE, 0.5);
      }
    });
  }

  const wipe: EdgeWipeState = {
    handle: 0,
    outgoing,
    incoming,
    trace,
    dissolving,
    sheen,
    started: performance.now(),
    duration: EDGE_WIPE_MS,
  };
  state.edgeWipe = wipe;
  state.helperLayer.add(trace);
  setEdgeWipeProgress(wipe, 0);
  const tick = (now: number) => {
    if (state.edgeWipe !== wipe || !incoming.parent) {
      if (state.edgeWipe === wipe) finishEdgeWipe(state);
      return;
    }
    const t = Math.min(1, (now - wipe.started) / wipe.duration);
    setEdgeWipeProgress(wipe, t);
    state.needsRender = true;
    if (t < 1) {
      wipe.handle = requestAnimationFrame(tick);
      return;
    }
    finishEdgeWipe(state);
  };
  wipe.handle = requestAnimationFrame(tick);
  state.needsRender = true;
}

export let applyFlashHandle: number | null = null;

export function startApplyFlash(state: ThreeState, ids: string[]) {
  if (applyFlashHandle !== null) {
    cancelAnimationFrame(applyFlashHandle);
    applyFlashHandle = null;
  }
  state.shapeLayer.children.forEach((child) => clearNamedOutlines(child, APPLY_FLASH_NAME));
  if (prefersReducedMotion() || ids.length === 0) {
    state.needsRender = true;
    return;
  }
  const material = createOutlineLineMaterial("#2aa77e", 0);
  material.userData.shared = false;
  let attached = 0;
  for (const id of ids) {
    const object = findShapeObject(state, id);
    if (!object) continue;
    attachObjectOutline(object, APPLY_FLASH_NAME, material, 5, state.camera);
    attached += 1;
  }
  if (attached === 0) {
    material.dispose();
    return;
  }
  const started = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - started) / APPLY_FLASH_MS);
    material.opacity = Math.sin(Math.PI * t);
    state.needsRender = true;
    if (t < 1) {
      applyFlashHandle = requestAnimationFrame(tick);
      return;
    }
    applyFlashHandle = null;
    state.shapeLayer.children.forEach((child) => clearNamedOutlines(child, APPLY_FLASH_NAME));
    material.dispose();
    state.needsRender = true;
  };
  applyFlashHandle = requestAnimationFrame(tick);
  state.needsRender = true;
}
