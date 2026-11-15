import * as THREE from "three";
import { type XrayAxis, xrayClipping } from "@/lib/xraySection";
import { measureSectionAt, rebuildSectionCaps, sectionCapPlane } from "@/lib/xrayCaps";
import { prefersReducedMotion } from "@/lib/chromePresence";
import type { ThreeState, XraySweep } from "@/components/viewport/viewportTypes";
import { easeOutCubic } from "@/components/viewport/easing";
import { pointerWorldRay } from "@/components/viewport/screenProjection";
import { markShadowsDirty } from "@/components/viewport/shadows";
import { heldInHoleOrGhost, surfaceHits } from "@/components/viewport/meshPick";
import { disposeChildren } from "@/components/viewport/shapeOutlines";

export function applyMaterialClipping(material: THREE.Material | THREE.Material[], planes: THREE.Plane[], enableDoubleSide: boolean) {
  const materials = Array.isArray(material) ? material : [material];
  for (const mat of materials) {
    if (!mat) {
      continue;
    }
    mat.clippingPlanes = planes;
    mat.clipShadows = planes.length > 0;
    if ("side" in mat) {
      const meshMat = mat as THREE.MeshStandardMaterial;
      if (enableDoubleSide) {
        if (meshMat.userData._xrayPrevSide === undefined) {
          meshMat.userData._xrayPrevSide = meshMat.side;
        }
        meshMat.side = THREE.DoubleSide;
      } else if (meshMat.userData._xrayPrevSide !== undefined) {
        meshMat.side = meshMat.userData._xrayPrevSide;
        delete meshMat.userData._xrayPrevSide;
      }
    }
    mat.needsUpdate = true;
  }
}

export function placeXrayPlane(object: THREE.Object3D, axis: XrayAxis, position: number) {
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  if (axis === "x") {
    object.rotation.y = Math.PI / 2;
    object.position.x = position;
    return;
  }
  if (axis === "z") {
    object.position.z = position;
    return;
  }
  object.rotation.x = -Math.PI / 2;
  object.position.y = position;
}

export const XRAY_SWEEP_IN_MS = 720;
export const XRAY_SWEEP_OUT_MS = 460;
export const XRAY_PLANE_FILL_OPACITY = 0.1;
export const XRAY_PLANE_OUTLINE_OPACITY = 0.72;
/** How much brighter the plane fill is at the start of the cut than at rest. */
export const XRAY_PLANE_GLINT = 1.2;

/** Soft start, fast middle, long landing: a blade set against the part, then drawn through. */
export function xraySweepEase(t: number) {
  const s = t * t * (3 - 2 * t);
  return 1 - (1 - s) ** 4;
}

export function xraySweepPosition(sweep: XraySweep) {
  const eased = sweep.kind === "in" ? xraySweepEase(sweep.progress) : easeOutCubic(sweep.progress);
  return sweep.from + (sweep.to - sweep.from) * eased;
}

/** Where the plane rests when the model is uncut: just past the far edge on the hidden side. */
export function xrayRestEdge(state: ThreeState) {
  const { bounds, keepLow } = state.xray;
  const span = Math.max(8, bounds.max - bounds.min);
  const pad = Math.max(2, span * 0.08);
  return keepLow ? bounds.max + pad : bounds.min - pad;
}

export function xrayVisualPosition(state: ThreeState) {
  return state.xraySweep ? xraySweepPosition(state.xraySweep) : state.xray.position;
}

/** Is the clip on screen, including the moments it is gliding out? */
export function xrayCutActive(state: ThreeState) {
  return state.xray.enabled || state.xraySweep?.kind === "out";
}

export function xrayHelperReveal(state: ThreeState) {
  const sweep = state.xraySweep;
  if (!sweep) return { reveal: 1, glint: 0 };
  if (sweep.kind === "out") return { reveal: 1 - easeOutCubic(sweep.progress), glint: 0 };
  return {
    reveal: easeOutCubic(Math.min(1, sweep.progress / 0.25)),
    // The plane is brightest while it is cutting and settles to its resting tint.
    glint: 1 - easeOutCubic(sweep.progress),
  };
}

export function placeXrayHelper(state: ThreeState) {
  const { axis } = state.xray;
  const position = xrayVisualPosition(state);
  const { reveal, glint } = xrayHelperReveal(state);
  for (const child of state.xrayLayer.children) {
    placeXrayPlane(child, axis, position);
    if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments)) continue;
    const material = child.material as THREE.Material & { opacity: number };
    const base = typeof child.userData.baseOpacity === "number" ? child.userData.baseOpacity : material.opacity;
    material.opacity = child.name === "XrayPlaneFill" ? base * reveal * (1 + XRAY_PLANE_GLINT * glint) : base * reveal;
  }
}

export function syncXrayHelper(state: ThreeState) {
  disposeChildren(state.xrayLayer);
  const { showPlane, planeSize } = state.xray;
  if (!xrayCutActive(state) || !showPlane) {
    return;
  }

  const size = Math.max(planeSize, 80);
  const geometry = new THREE.PlaneGeometry(size, size);
  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: "#17b7e5",
      transparent: true,
      opacity: XRAY_PLANE_FILL_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  fill.name = "XrayPlaneFill";
  fill.userData.baseOpacity = XRAY_PLANE_FILL_OPACITY;
  fill.renderOrder = 980;

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: "#079bc6",
      transparent: true,
      opacity: XRAY_PLANE_OUTLINE_OPACITY,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  outline.name = "XrayPlaneOutline";
  outline.userData.baseOpacity = XRAY_PLANE_OUTLINE_OPACITY;
  outline.renderOrder = 981;

  state.xrayLayer.add(fill, outline);
  placeXrayHelper(state);
}

/** Per-frame part of the sweep: the shared plane and the helper, no material walk. */
export function xraySweepFrame(state: ThreeState) {
  const clip = xrayClipping(state.xray.axis, xrayVisualPosition(state), state.xray.keepLow);
  state.clippingPlane.normal.set(clip.normal[0], clip.normal[1], clip.normal[2]);
  state.clippingPlane.constant = clip.constant;
  placeXrayHelper(state);
  // Shadows are clipped too; without this the hidden half keeps casting one while the plane moves.
  markShadowsDirty(state);
  state.needsRender = true;
}

/** Walk every material so it holds (or drops) the shared clipping plane, then rebuild the helper. */
export function syncXrayCut(state: ThreeState) {
  const active = xrayCutActive(state);
  const clip = xrayClipping(state.xray.axis, xrayVisualPosition(state), state.xray.keepLow);
  state.clippingPlane.normal.set(clip.normal[0], clip.normal[1], clip.normal[2]);
  state.clippingPlane.constant = clip.constant;
  const planes = active ? [state.clippingPlane] : [];

  const applyToLayer = (layer: THREE.Group) => {
    layer.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Line)) {
        return;
      }
      applyMaterialClipping(object.material, planes, active && object instanceof THREE.Mesh);
    });
  };

  applyToLayer(state.shapeLayer);
  applyToLayer(state.helperLayer);
  applyToLayer(state.modifierLayer);
  applyToLayer(state.printLayer);
  syncXrayHelper(state);
  rebuildSectionCaps(state.sectionCapLayer, state.shapeLayer, active ? state.clippingPlane : null, state.xray.planeSize, state.renderer.getPixelRatio());
  markShadowsDirty(state);
  state.needsRender = true;
}

export function stopXraySweep(state: ThreeState) {
  if (!state.xraySweep) return;
  cancelAnimationFrame(state.xraySweep.handle);
  state.xraySweep = null;
}

export function startXraySweep(state: ThreeState, kind: XraySweep["kind"], from: number, to: number) {
  stopXraySweep(state);
  const sweep: XraySweep = {
    kind,
    from,
    to,
    started: performance.now(),
    duration: kind === "in" ? XRAY_SWEEP_IN_MS : XRAY_SWEEP_OUT_MS,
    handle: 0,
    progress: 0,
  };
  state.xraySweep = sweep;
  const tick = (now: number) => {
    if (state.xraySweep !== sweep) return;
    sweep.progress = Math.min(1, (now - sweep.started) / sweep.duration);
    if (sweep.progress < 1) {
      xraySweepFrame(state);
      sweep.handle = requestAnimationFrame(tick);
      return;
    }
    state.xraySweep = null;
    // Lands exactly on the target; for an exit this is also where the clip is released.
    syncXrayCut(state);
  };
  sweep.handle = requestAnimationFrame(tick);
}

export function applyXrayClipping(
  state: ThreeState | null,
  next?: Partial<ThreeState["xray"]>,
  options?: { immediate?: boolean },
) {
  if (!state) {
    return;
  }

  const previous = state.xray;
  const visualBefore = xrayVisualPosition(state);
  state.xray = { ...previous, ...next };
  const { enabled } = state.xray;
  state.needsRender = true;
  // New meshes are created without clipping planes. While the cut stays off,
  // walking every material on each rebuild only repeats that empty assignment.
  if (!enabled && !previous.enabled && !state.xraySweep) {
    return;
  }

  const motion = !options?.immediate && !prefersReducedMotion();
  const sameCut = previous.axis === state.xray.axis && previous.keepLow === state.xray.keepLow;
  if (enabled && !previous.enabled) {
    if (motion) {
      const from = state.xraySweep && sameCut ? visualBefore : xrayRestEdge(state);
      startXraySweep(state, "in", from, state.xray.position);
    } else {
      stopXraySweep(state);
    }
  } else if (!enabled && previous.enabled) {
    if (motion) startXraySweep(state, "out", visualBefore, xrayRestEdge(state));
    else stopXraySweep(state);
  } else if (enabled && !sameCut) {
    // A new axis or side is a fresh cut: glide in from that edge too.
    if (motion) startXraySweep(state, "in", xrayRestEdge(state), state.xray.position);
    else stopXraySweep(state);
  } else if (options?.immediate) {
    stopXraySweep(state);
  } else if (state.xraySweep?.kind === "in" && previous.position !== state.xray.position) {
    // The slider moved while the plane was still gliding in: steer to the new spot.
    state.xraySweep.to = state.xray.position;
  }
  syncXrayCut(state);
}

/** The wall or gap on the X-ray cut under a screen point, unless a part in front hides the cut there. */
export function xraySectionMeasure(state: ThreeState, clientX: number, clientY: number) {
  const layer = state.sectionCapLayer;
  const plane = sectionCapPlane(layer);
  if (!plane || state.xraySweep) return measureSectionAt(layer, null);
  pointerWorldRay(state, clientX, clientY);
  const ray = state.raycaster.ray;
  const onPlane = ray.intersectPlane(plane, new THREE.Vector3());
  if (!onPlane) return measureSectionAt(layer, null);
  const reach = onPlane.distanceTo(ray.origin) - 1e-3;
  // Only what is left after the cut can hide it; the cut-away half is not drawn.
  const hidden = surfaceHits(state).some(
    (hit) => hit.distance < reach && plane.distanceToPoint(hit.point) > 1e-3 && !heldInHoleOrGhost(hit.object),
  );
  return measureSectionAt(layer, hidden ? null : onPlane);
}
