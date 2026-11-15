import * as THREE from "three";
import { appendOverhangBoundaryLines } from "@/lib/printerBed";
import { runPrintOverlayInWorker } from "@/lib/printOverlayClient";
import type { PrintOverlayMarks } from "@/lib/printOverlayCollect";
import { prefersReducedMotion } from "@/lib/chromePresence";
import type { ThreeState } from "@/components/viewport/viewportTypes";
import { geometryTriangleCount } from "@/components/viewport/meshPick";
import { disposeChildren, disposeObject } from "@/components/viewport/shapeOutlines";

export const OVERHANG_LIFT = 0.35;

export function createOverhangFillMaterial() {
  return new THREE.MeshBasicMaterial({
    color: "#c6a15b",
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthTest: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
}

export function createOverhangLineMaterial() {
  return new THREE.LineBasicMaterial({
    color: "#2aa77e",
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
    toneMapped: false,
  });
}

export function createThinWallFillMaterial() {
  return new THREE.MeshBasicMaterial({
    color: "#2aa77e",
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthTest: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
}

export function createThinWallLineMaterial() {
  return new THREE.LineBasicMaterial({
    color: "#c6a15b",
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
    toneMapped: false,
  });
}

export function createSmallHoleFillMaterial() {
  return new THREE.MeshBasicMaterial({
    color: "#2aa77e",
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthTest: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
}

export function createSmallHoleLineMaterial() {
  return new THREE.LineBasicMaterial({
    color: "#2aa77e",
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
    toneMapped: false,
  });
}

export function createTrappedResinFillMaterial() {
  return new THREE.MeshBasicMaterial({
    color: "#c6a15b",
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthTest: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
}

export function createTrappedResinLineMaterial() {
  return new THREE.LineBasicMaterial({
    color: "#c6a15b",
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
    toneMapped: false,
  });
}

export function printOverlayGroup(parent: THREE.Group, name: string) {
  const existing = parent.getObjectByName(name);
  if (existing instanceof THREE.Group) return existing;
  const group = new THREE.Group();
  group.name = name;
  parent.add(group);
  return group;
}

export function printSceneFingerprint(state: ThreeState) {
  // Overlay triangles are collected in world space, so body placement is part of
  // the geometry key. Camera pose is not — orbit hides marks and skipRebuild keeps
  // the last overlay until the view settles.
  const parts: string[] = [];
  for (const child of state.shapeLayer.children) {
    if (child.userData.hole || child.userData.construction) continue;
    parts.push(
      String(child.userData.shapeId ?? ""),
      child.position.x.toFixed(2),
      child.position.y.toFixed(2),
      child.position.z.toFixed(2),
      child.rotation.x.toFixed(3),
      child.rotation.y.toFixed(3),
      child.rotation.z.toFixed(3),
      String(child.userData.renderFingerprint ?? ""),
    );
  }
  return parts.join("|");
}

export function inflateAlongNormals(positions: Float32Array | number[], normals: Float32Array | number[], lift: number) {
  for (let index = 0; index + 2 < positions.length; index += 3) {
    positions[index] += normals[index] * lift;
    positions[index + 1] += normals[index + 1] * lift;
    positions[index + 2] += normals[index + 2] * lift;
  }
}

export const PRINT_OVERLAY_FADE_MS = 120;

export function cancelPrintOverlayFade(state: ThreeState) {
  const handle = state.printLayer.userData.overlayFadeHandle as number | undefined;
  if (handle) {
    cancelAnimationFrame(handle);
    delete state.printLayer.userData.overlayFadeHandle;
  }
}

export function fadePrintOverlayRootIn(state: ThreeState, root: THREE.Object3D) {
  if (prefersReducedMotion()) {
    state.printLayer.userData.overlayFadedIn = true;
    return;
  }
  const targets: Array<{ material: THREE.Material; opacity: number }> = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line)) return;
    const material = child.material;
    if (!material || Array.isArray(material) || !("opacity" in material) || !material.transparent) return;
    const opacity = typeof material.userData.targetOpacity === "number"
      ? material.userData.targetOpacity
      : (material.opacity > 0 ? material.opacity : 0.5);
    material.userData.targetOpacity = opacity;
    material.opacity = 0;
    targets.push({ material, opacity });
  });
  if (targets.length === 0) return;
  cancelPrintOverlayFade(state);
  state.printLayer.userData.overlayFadedIn = true;
  const started = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - started) / PRINT_OVERLAY_FADE_MS);
    const eased = 1 - (1 - t) ** 3;
    for (const entry of targets) {
      entry.material.opacity = entry.opacity * eased;
    }
    state.needsRender = true;
    if (t < 1) {
      state.printLayer.userData.overlayFadeHandle = requestAnimationFrame(tick);
      return;
    }
    delete state.printLayer.userData.overlayFadeHandle;
  };
  state.printLayer.userData.overlayFadeHandle = requestAnimationFrame(tick);
  state.needsRender = true;
}

export function fadePrintOverlaysIn(state: ThreeState) {
  fadePrintOverlayRootIn(state, state.printLayer);
}

export let printOverlayGeneration = 0;

export function printOverlayJobKey(state: ThreeState) {
  return [
    state.showOverhangStripes ? 1 : 0,
    state.showThinWalls ? 1 : 0,
    state.showSmallHoles ? 1 : 0,
    state.showTrappedResin ? 1 : 0,
    state.printerAngle.toFixed(2),
    state.nozzleMm.toFixed(2),
    printSceneFingerprint(state),
  ].join("|");
}

/**
 * Every visible print body as one flat Float64Array (9 numbers per triangle),
 * written straight from the geometry attributes. Two passes — count, then
 * fill — so no per-triangle objects or growable arrays are allocated; the
 * buffer is then transferred to the overlay worker without a copy.
 */
export function collectAllPrintTriangles(state: ThreeState): Float64Array {
  const meshes: THREE.Mesh[] = [];
  let total = 0;
  for (const child of state.shapeLayer.children) {
    if (child.userData.hole || child.userData.construction) continue;
    forEachPrintBodyMesh(child, (mesh) => {
      meshes.push(mesh);
      total += geometryTriangleCount(mesh.geometry);
    });
  }
  const soup = new Float64Array(total * 9);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let at = 0;
  for (const mesh of meshes) {
    const attribute = mesh.geometry.getAttribute("position");
    if (!attribute) continue;
    const index = mesh.geometry.getIndex();
    const matrix = mesh.matrixWorld;
    const count = index ? index.count : attribute.count;
    for (let triangle = 0; triangle + 2 < count; triangle += 3) {
      const ia = index ? index.getX(triangle) : triangle;
      const ib = index ? index.getX(triangle + 1) : triangle + 1;
      const ic = index ? index.getX(triangle + 2) : triangle + 2;
      a.fromBufferAttribute(attribute, ia).applyMatrix4(matrix);
      b.fromBufferAttribute(attribute, ib).applyMatrix4(matrix);
      c.fromBufferAttribute(attribute, ic).applyMatrix4(matrix);
      soup[at] = a.x; soup[at + 1] = a.y; soup[at + 2] = a.z;
      soup[at + 3] = b.x; soup[at + 4] = b.y; soup[at + 5] = b.z;
      soup[at + 6] = c.x; soup[at + 7] = c.y; soup[at + 8] = c.z;
      at += 9;
    }
  }
  // A ragged attribute (count not a multiple of 3) leaves a short tail; copy so
  // the result still owns its whole buffer and can be transferred.
  return at === soup.length ? soup : soup.slice(0, at);
}

export function applyPrintOverlayMarks(state: ThreeState, marks: PrintOverlayMarks) {
  const apply = (
    enabled: boolean,
    name: string,
    positions: Float32Array | number[],
    normals: Float32Array | number[],
    fillMaterial: THREE.MeshBasicMaterial,
    lineMaterial: THREE.LineBasicMaterial,
    fillName: string,
    lineName: string,
  ) => {
    if (!enabled) {
      const existing = state.printLayer.getObjectByName(name);
      if (existing) {
        state.printLayer.remove(existing);
        disposeObject(existing);
      }
      return;
    }
    addPrintMarkMeshes(
      printOverlayGroup(state.printLayer, name),
      positions,
      normals,
      fillMaterial,
      lineMaterial,
      fillName,
      lineName,
    );
  };
  apply(
    state.showOverhangStripes,
    "OverhangMarks",
    marks.overhangPositions,
    marks.overhangNormals,
    createOverhangFillMaterial(),
    createOverhangLineMaterial(),
    "OverhangFill",
    "OverhangLines",
  );
  apply(
    state.showThinWalls,
    "ThinWallMarks",
    marks.thinPositions,
    marks.thinNormals,
    createThinWallFillMaterial(),
    createThinWallLineMaterial(),
    "ThinWallFill",
    "ThinWallLines",
  );
  apply(
    state.showSmallHoles,
    "SmallHoleMarks",
    marks.holePositions,
    marks.holeNormals,
    createSmallHoleFillMaterial(),
    createSmallHoleLineMaterial(),
    "SmallHoleFill",
    "SmallHoleLines",
  );
  apply(
    state.showTrappedResin,
    "TrappedResinMarks",
    marks.trappedPositions,
    marks.trappedNormals,
    createTrappedResinFillMaterial(),
    createTrappedResinLineMaterial(),
    "TrappedResinFill",
    "TrappedResinLines",
  );
  state.printLayer.visible = true;
  state.needsRender = true;
}

export function rebuildPrintOverlays(state: ThreeState, skipRebuild = false) {
  const showAny = state.showOverhangStripes || state.showThinWalls || state.showSmallHoles || state.showTrappedResin;
  if (state.printLayer.visible !== showAny) {
    state.printLayer.visible = showAny;
    state.needsRender = true;
  }
  if (!showAny) {
    printOverlayGeneration += 1;
    cancelPrintOverlayFade(state);
    if (state.printLayer.children.length > 0) {
      disposeChildren(state.printLayer);
      state.needsRender = true;
    }
    state.printLayer.userData.overlayFadedIn = false;
    state.printLayer.userData.overlayJobKey = "";
    state.overhangKey = "";
    state.thinWallKey = "";
    state.smallHoleKey = "";
    state.trappedResinKey = "";
    return;
  }
  const hadMarks = Boolean(state.overhangKey || state.thinWallKey || state.smallHoleKey || state.trappedResinKey);
  if (skipRebuild && hadMarks) return;
  const key = printOverlayJobKey(state);
  if (key === state.printLayer.userData.overlayJobKey) return;
  const alreadyShown = Boolean(state.printLayer.userData.overlayFadedIn);
  const gen = ++printOverlayGeneration;
  void runPrintOverlayInWorker({
    overhang: state.showOverhangStripes,
    angle: state.printerAngle,
    thinWalls: state.showThinWalls,
    smallHoles: state.showSmallHoles,
    trappedResin: state.showTrappedResin,
    nozzleMm: state.nozzleMm,
    shapes: state.printShapes,
    collectTriangles: () => collectAllPrintTriangles(state),
  }).then((marks) => {
    if (gen !== printOverlayGeneration) return;
    if (!marks) return;
    applyPrintOverlayMarks(state, marks);
    state.printLayer.userData.overlayJobKey = key;
    state.overhangKey = state.showOverhangStripes ? key : "";
    state.thinWallKey = state.showThinWalls ? key : "";
    state.smallHoleKey = state.showSmallHoles ? key : "";
    state.trappedResinKey = state.showTrappedResin ? key : "";
    if (!alreadyShown) fadePrintOverlaysIn(state);
    state.printLayer.userData.overlayFadedIn = true;
  });
}

export function addPrintMarkMeshes(
  group: THREE.Group,
  positions: Float32Array | number[],
  normals: Float32Array | number[],
  fillMaterial: THREE.MeshBasicMaterial,
  lineMaterial: THREE.LineBasicMaterial,
  fillName: string,
  lineName: string,
) {
  disposeChildren(group);
  if (positions.length < 9) return;
  const linePositions: number[] = [];
  appendOverhangBoundaryLines(positions, linePositions, 1000, normals, OVERHANG_LIFT);
  inflateAlongNormals(positions, normals, OVERHANG_LIFT);
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  fillGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  const fill = new THREE.Mesh(fillGeometry, fillMaterial);
  fill.name = fillName;
  fill.renderOrder = 12;
  fill.frustumCulled = false;
  group.add(fill);
  if (linePositions.length >= 6) {
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    lines.name = lineName;
    lines.renderOrder = 13;
    lines.frustumCulled = false;
    group.add(lines);
  }
}

export function forEachPrintBodyMesh(root: THREE.Object3D, use: (mesh: THREE.Mesh) => void) {
  root.updateWorldMatrix(true, true);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || child.userData.printBody !== true) return;
    let node: THREE.Object3D | null = child;
    while (node) {
      if (node.userData.hole || node.userData.construction) return;
      node = node.parent;
    }
    if (!child.geometry.getAttribute("position")) return;
    use(child);
  });
}
