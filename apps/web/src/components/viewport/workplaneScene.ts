import * as THREE from "three";
import { normalizePrinterBed, type PrinterBed } from "@/lib/printerBed";
import { isCrystalDesign, isLaserDesign } from "@/lib/laserMachine";
import { interiorWorkplaneGridCoordinates, WORKPLANE_LINE_ELEVATION, workplaneGridPalette } from "@/lib/workplaneGrid";
import { clamp } from "@/lib/viewportInteractionMath";
import type { WorkplaneWorkspaceSettings } from "@/types/sketchforge";
import { resolveViewportBackground, resolveWorkplaneBaseColor } from "@/lib/uiTheme";
import {
  DEFAULT_WORKSPACE,
  MAX_GRID_BLOCK_SIZE,
  MIN_GRID_BLOCK_SIZE,
  WORKPLANE_DEPTH,
  WORKPLANE_WIDTH,
} from "@/components/viewport/viewportConstants";
import type { ThreeState, WorkspaceSettings } from "@/components/viewport/viewportTypes";
import { markShadowsDirty } from "@/components/viewport/shadows";
import { disposeChildren } from "@/components/viewport/shapeOutlines";
import { rebuildPrintOverlays } from "@/components/viewport/printOverlays";

/**
 * The key light's shadow frustum was a fixed ±130 mm box. On a 300 mm plate,
 * or with a part moved toward the edge, shadows were sliced off along a hard
 * line. Size it from the workspace instead; the map resolution stays the same,
 * so small plates keep crisp shadows and large ones stay complete.
 */
export function fitShadowCameraToWorkspace(state: ThreeState, workspace: WorkspaceSettings) {
  const halfExtent = Math.max(130, Math.max(workspace.width, workspace.depth) * 0.5 * 1.35 + 20);
  const camera = state.keyLight.shadow.camera;
  if (camera.left === -halfExtent && camera.right === halfExtent) return;
  camera.left = -halfExtent;
  camera.right = halfExtent;
  camera.top = halfExtent;
  camera.bottom = -halfExtent;
  camera.near = 1;
  camera.far = Math.max(400, halfExtent * 3.2);
  camera.updateProjectionMatrix();
  markShadowsDirty(state);
}

export function rebuildWorkplane(state: ThreeState | null, workspace: WorkspaceSettings) {
  if (!state) {
    return;
  }

  disposeChildren(state.workplaneLayer);
  state.scene.background = new THREE.Color(resolveViewportBackground(workspace.background));
  state.renderer.shadowMap.enabled = workspace.showShadows;
  state.controls.zoomSpeed = 0.28 + workspace.zoomSpeed * 0.09;
  fitShadowCameraToWorkspace(state, workspace);

  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(workspace.width, workspace.depth),
    new THREE.MeshStandardMaterial({
      color: resolveWorkplaneBaseColor(),
      transparent: true,
      opacity: 0.68,
      roughness: 0.92,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  base.name = "WorkplaneBase";
  base.rotation.x = -Math.PI / 2;
  base.receiveShadow = workspace.showShadows;
  state.workplaneLayer.add(base);

  if (workspace.showGrid) {
    state.workplaneLayer.add(createGridLines(workspace.width, workspace.depth, workspace.gridBlockSize));
  }
  const bed = normalizePrinterBed(workspace);
  // A laser design has a flat work area and no print checks: overhangs and thin walls mean nothing on a sheet.
  const laserDesign = isLaserDesign(workspace);
  state.showPrinterBed = !laserDesign && bed.showBed;
  state.showOverhangStripes = !laserDesign && bed.showStripes;
  state.showThinWalls = !laserDesign && bed.showThinWalls;
  state.showSmallHoles = !laserDesign && bed.showSmallHoles;
  state.showTrappedResin = !laserDesign && bed.showTrappedResin;
  state.laserDesign = laserDesign;
  state.printerAngle = bed.overhangAngle;
  state.nozzleMm = bed.nozzleMm;
  if (state.showPrinterBed) state.workplaneLayer.add(createPrinterFrame(bed));
  if (laserDesign && workspace.showLaserBed) state.workplaneLayer.add(createLaserFrame(workspace.laserWidth, workspace.laserDepth));
  if (isCrystalDesign(workspace)) state.workplaneLayer.add(createCrystalBlank(workspace.crystal));
  rebuildPrintOverlays(state);
}

export function createGridLines(width = WORKPLANE_WIDTH, depth = WORKPLANE_DEPTH, blockSize = DEFAULT_WORKSPACE.gridBlockSize) {
  const group = new THREE.Group();
  const palette = workplaneGridPalette();
  const minor = new THREE.LineBasicMaterial({ ...palette.minor, transparent: true, depthWrite: false });
  const major = new THREE.LineBasicMaterial({ ...palette.major, transparent: true, depthWrite: false });
  const axis = new THREE.LineBasicMaterial({ ...palette.axis, transparent: true, depthWrite: false });
  const minorPoints: number[] = [];
  const majorPoints: number[] = [];
  const axisPoints: number[] = [];
  const borderPoints: number[] = [];
  const pushLine = (points: number[], from: [number, number, number], to: [number, number, number]) => {
    points.push(...from, ...to);
  };
  const step = clamp(blockSize, MIN_GRID_BLOCK_SIZE, MAX_GRID_BLOCK_SIZE);
  const majorEvery = 4;
  for (const { coordinate: centeredX, index } of interiorWorkplaneGridCoordinates(width, step)) {
    const points = centeredX === 0 ? axisPoints : index % majorEvery === 0 ? majorPoints : minorPoints;
    pushLine(points, [centeredX, WORKPLANE_LINE_ELEVATION, -depth / 2], [centeredX, WORKPLANE_LINE_ELEVATION, depth / 2]);
  }

  for (const { coordinate: centeredZ, index } of interiorWorkplaneGridCoordinates(depth, step)) {
    const points = centeredZ === 0 ? axisPoints : index % majorEvery === 0 ? majorPoints : minorPoints;
    pushLine(points, [-width / 2, WORKPLANE_LINE_ELEVATION, centeredZ], [width / 2, WORKPLANE_LINE_ELEVATION, centeredZ]);
  }

  const border = new THREE.LineBasicMaterial({ ...palette.border, transparent: true, depthWrite: false });
  pushLine(borderPoints, [-width / 2, WORKPLANE_LINE_ELEVATION, -depth / 2], [width / 2, WORKPLANE_LINE_ELEVATION, -depth / 2]);
  pushLine(borderPoints, [width / 2, WORKPLANE_LINE_ELEVATION, -depth / 2], [width / 2, WORKPLANE_LINE_ELEVATION, depth / 2]);
  pushLine(borderPoints, [width / 2, WORKPLANE_LINE_ELEVATION, depth / 2], [-width / 2, WORKPLANE_LINE_ELEVATION, depth / 2]);
  pushLine(borderPoints, [-width / 2, WORKPLANE_LINE_ELEVATION, depth / 2], [-width / 2, WORKPLANE_LINE_ELEVATION, -depth / 2]);

  group.add(linesFromPoints(minorPoints, minor));
  group.add(linesFromPoints(majorPoints, major));
  group.add(linesFromPoints(axisPoints, axis));
  group.add(linesFromPoints(borderPoints, border));

  return group;
}

export function linesFromPoints(points: number[], material: THREE.LineBasicMaterial) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 1;
  return lines;
}

/** The laser's work area: a flat outline with corner marks, like the frame on the machine's bed. */
/** Frosted white-grey glass, see-through enough that the model shows inside it. */
export const CRYSTAL_EDGE = "#8f9aa3";
export const CRYSTAL_EDGE_WARNING = "#d83b3b";

/** The K9 crystal blank, sitting on the plate at its middle, frosted so the model shows inside. */
export function createCrystalBlank(blank: WorkplaneWorkspaceSettings["crystal"]) {
  const group = new THREE.Group();
  group.name = "CrystalBlank";
  const glass = new THREE.MeshStandardMaterial({
    color: "#e4e8eb",
    roughness: 0.25,
    metalness: 0,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const edge = new THREE.LineBasicMaterial({ color: CRYSTAL_EDGE, transparent: true, opacity: 0.9, depthWrite: false });
  edge.name = "CrystalEdge";
  let body: THREE.Mesh;
  let lines: THREE.LineSegments;
  if (blank.shape === "ball") {
    const radius = blank.diameter / 2;
    body = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 40), glass);
    body.position.y = radius;
    // Three rings round the ball, so its size reads from any side.
    const ring: number[] = [];
    const steps = 96;
    for (let index = 0; index < steps; index += 1) {
      const a = (index / steps) * Math.PI * 2;
      const b = ((index + 1) / steps) * Math.PI * 2;
      ring.push(Math.cos(a) * radius, radius, Math.sin(a) * radius, Math.cos(b) * radius, radius, Math.sin(b) * radius);
      ring.push(Math.cos(a) * radius, radius + Math.sin(a) * radius, 0, Math.cos(b) * radius, radius + Math.sin(b) * radius, 0);
      ring.push(0, radius + Math.sin(a) * radius, Math.cos(a) * radius, 0, radius + Math.sin(b) * radius, Math.cos(b) * radius);
    }
    lines = linesFromPoints(ring, edge);
  } else {
    const box = new THREE.BoxGeometry(blank.width, blank.height, blank.depth);
    body = new THREE.Mesh(box, glass);
    body.position.y = blank.height / 2;
    lines = new THREE.LineSegments(new THREE.EdgesGeometry(box), edge);
    lines.position.y = blank.height / 2;
  }
  // Drawn after the parts, so they show through the glass.
  body.renderOrder = 10;
  lines.renderOrder = 11;
  body.raycast = () => undefined;
  lines.raycast = () => undefined;
  group.add(body, lines);
  return group;
}

/** Turns the crystal's edges red while the model is too close to its surface or outside it. */
export function setCrystalWarning(state: ThreeState | null, warn: boolean) {
  const blank = state?.workplaneLayer.getObjectByName("CrystalBlank");
  blank?.traverse((child) => {
    const material = (child as THREE.LineSegments).material;
    if (material instanceof THREE.LineBasicMaterial && material.name === "CrystalEdge") material.color.set(warn ? CRYSTAL_EDGE_WARNING : CRYSTAL_EDGE);
  });
}

export function createLaserFrame(width: number, depth: number) {
  const group = new THREE.Group();
  group.name = "LaserBed";
  const y = 0.2;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const outline = new THREE.LineBasicMaterial({ color: "#c8553d", transparent: true, opacity: 0.85, depthWrite: false });
  const marks = new THREE.LineBasicMaterial({ color: "#c8553d", transparent: true, opacity: 1, depthWrite: false });
  const edge: number[] = [];
  const corners: [number, number][] = [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]];
  for (let index = 0; index < 4; index += 1) {
    const [ax, az] = corners[index];
    const [bx, bz] = corners[(index + 1) % 4];
    edge.push(ax, y, az, bx, y, bz);
  }
  group.add(linesFromPoints(edge, outline));
  // Short L marks just outside each corner, so the area reads even with the grid off.
  const reach = Math.min(12, Math.min(width, depth) * 0.06);
  const gap = 1.5;
  const corner: number[] = [];
  for (const [x, z] of corners) {
    const sx = Math.sign(x);
    const sz = Math.sign(z);
    const cx = x + sx * gap;
    const cz = z + sz * gap;
    corner.push(cx, y, cz, cx - sx * reach, y, cz);
    corner.push(cx, y, cz, cx, y, cz - sz * reach);
  }
  group.add(linesFromPoints(corner, marks));
  return group;
}

export function createPrinterFrame(bed: PrinterBed) {
  const group = new THREE.Group();
  group.name = "PrinterBed";
  const y = 0.2;
  const halfWidth = bed.width / 2;
  const halfDepth = bed.depth / 2;
  const height = bed.height;
  const footprint = new THREE.LineBasicMaterial({ color: "#c6a15b", transparent: true, opacity: 0.95, depthWrite: false });
  const cage = new THREE.LineBasicMaterial({ color: "#c6a15b", transparent: true, opacity: 0.28, depthWrite: false });
  const push = (points: number[], from: [number, number, number], to: [number, number, number]) => {
    points.push(...from, ...to);
  };
  const foot: number[] = [];
  push(foot, [-halfWidth, y, -halfDepth], [halfWidth, y, -halfDepth]);
  push(foot, [halfWidth, y, -halfDepth], [halfWidth, y, halfDepth]);
  push(foot, [halfWidth, y, halfDepth], [-halfWidth, y, halfDepth]);
  push(foot, [-halfWidth, y, halfDepth], [-halfWidth, y, -halfDepth]);
  group.add(linesFromPoints(foot, footprint));
  const cagePoints: number[] = [];
  const corners: [number, number][] = [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]];
  for (const [x, z] of corners) push(cagePoints, [x, y, z], [x, height, z]);
  push(cagePoints, [-halfWidth, height, -halfDepth], [halfWidth, height, -halfDepth]);
  push(cagePoints, [halfWidth, height, -halfDepth], [halfWidth, height, halfDepth]);
  push(cagePoints, [halfWidth, height, halfDepth], [-halfWidth, height, halfDepth]);
  push(cagePoints, [-halfWidth, height, halfDepth], [-halfWidth, height, -halfDepth]);
  group.add(linesFromPoints(cagePoints, cage));
  return group;
}
