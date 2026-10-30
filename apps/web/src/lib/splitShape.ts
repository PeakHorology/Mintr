import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import * as THREE from "three";
import { meshForShape, shapeAabb, type Cuboid, type MeshData } from "@/lib/editorShapeMesh";
import { createLocalId } from "@/lib/localIds";
import { MIN_SHAPE_DIMENSION, cleanModelDimension } from "@/lib/modelDimension";
import { canonicalizeShape, cleanNearZero } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

export type SplitAxis = "x" | "y" | "z";

export type SplitCut = {
  axis: SplitAxis;
  /** Millimetres from the middle of the shape, along the cut axis. */
  offset: number;
};

const SIDE_NAME: Record<SplitAxis, [string, string]> = {
  x: ["Left", "Right"],
  y: ["Bottom", "Top"],
  z: ["Front", "Back"],
};

export function splitBounds(shape: WorkplaneShape): Cuboid {
  try {
    return boundsOfMesh(meshForShape(shape));
  } catch {
    return shapeAabb(shape);
  }
}

export function splitPlaneFrame(shape: WorkplaneShape, cut: SplitCut, bounds = splitBounds(shape)) {
  const center = axisCenter(bounds, cut.axis);
  const limit = axisHalfSpan(bounds, cut.axis);
  const offset = Math.max(-limit, Math.min(limit, cut.offset));
  const origin: [number, number, number] = [
    cut.axis === "x" ? center + offset : (bounds.minX + bounds.maxX) / 2,
    cut.axis === "y" ? center + offset : (bounds.minY + bounds.maxY) / 2,
    cut.axis === "z" ? center + offset : (bounds.minZ + bounds.maxZ) / 2,
  ];
  const normal: [number, number, number] = cut.axis === "x" ? [1, 0, 0] : cut.axis === "y" ? [0, 1, 0] : [0, 0, 1];
  const xSpan = Math.max(8, bounds.maxX - bounds.minX);
  const ySpan = Math.max(8, bounds.maxY - bounds.minY);
  const zSpan = Math.max(8, bounds.maxZ - bounds.minZ);
  const width = cut.axis === "x" ? zSpan : xSpan;
  const height = cut.axis === "y" ? zSpan : ySpan;
  return { origin, normal, offset, width: width + 8, height: height + 8, limit };
}

export type SplitHalves = {
  /** World-space triangle soup on the negative side of the cut normal. */
  negative: number[];
  /** World-space triangle soup on the positive side of the cut normal. */
  positive: number[];
  /** The whole solid, uncut, as world-space triangle soup. */
  whole: number[];
  frame: ReturnType<typeof splitPlaneFrame>;
};

/** The two closed pieces, still in world space, before they become shapes. */
export function splitWorldHalves(shape: WorkplaneShape, cut: SplitCut): SplitHalves | null {
  const mesh = meshForShape(shape);
  const bounds = boundsOfMesh(mesh);
  const frame = splitPlaneFrame(shape, cut, bounds);
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ, 20) * 4 + 40;
  const origin = new THREE.Vector3(...frame.origin);
  const normal = new THREE.Vector3(...frame.normal);
  const source = meshToGeometry(mesh);
  const positive = subtractHalf(source, origin, normal.clone().multiplyScalar(-1), span);
  const negative = subtractHalf(source, origin, normal, span);
  const flat = source.index ? source.toNonIndexed() : source;
  const whole = Array.from(flat.getAttribute("position").array as ArrayLike<number>);
  if (flat !== source) flat.dispose();
  source.dispose();
  if (negative.length < 9 || positive.length < 9) return null;
  return { negative, positive, whole, frame };
}

/** Cut one solid into the two closed pieces on either side of the plane. */
export function splitShapeWithPlane(shape: WorkplaneShape, cut: SplitCut): WorkplaneShape[] {
  const halves = splitWorldHalves(shape, cut);
  if (!halves) return [];
  const [negativeName, positiveName] = SIDE_NAME[cut.axis];
  return [
    shapeFromSplitWorld(shape, halves.negative, negativeName),
    shapeFromSplitWorld(shape, halves.positive, positiveName),
  ].filter((part): part is WorkplaneShape => part !== null);
}

function axisCenter(bounds: Cuboid, axis: SplitAxis) {
  if (axis === "x") return (bounds.minX + bounds.maxX) / 2;
  if (axis === "y") return (bounds.minY + bounds.maxY) / 2;
  return (bounds.minZ + bounds.maxZ) / 2;
}

function axisHalfSpan(bounds: Cuboid, axis: SplitAxis) {
  if (axis === "x") return Math.max(0, (bounds.maxX - bounds.minX) / 2);
  if (axis === "y") return Math.max(0, (bounds.maxY - bounds.minY) / 2);
  return Math.max(0, (bounds.maxZ - bounds.minZ) / 2);
}

function boundsOfMesh(mesh: MeshData): Cuboid {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const [x, y, z] of mesh.vertices) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function meshToGeometry(mesh: MeshData) {
  const positions = new Float32Array(mesh.faces.length * 9);
  let offset = 0;
  for (const [a, b, c] of mesh.faces) {
    for (const index of [a, b, c]) {
      const vertex = mesh.vertices[index];
      positions[offset] = vertex[0];
      positions[offset + 1] = vertex[1];
      positions[offset + 2] = vertex[2];
      offset += 3;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function subtractHalf(source: THREE.BufferGeometry, origin: THREE.Vector3, discardNormal: THREE.Vector3, span: number) {
  const solid = new Brush(source.clone());
  solid.updateMatrixWorld();
  const cutterGeometry = new THREE.BoxGeometry(span, span, span);
  cutterGeometry.translate(0, 0, span / 2 - 0.02);
  cutterGeometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), discardNormal.clone().normalize()));
  cutterGeometry.translate(origin.x, origin.y, origin.z);
  cutterGeometry.computeVertexNormals();
  const cutter = new Brush(cutterGeometry);
  cutter.updateMatrixWorld();
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal"];
  evaluator.useGroups = false;
  try {
    const result = evaluator.evaluate(solid, cutter, SUBTRACTION);
    const positions = worldPositions(result);
    result.geometry.dispose();
    return positions;
  } finally {
    solid.geometry.dispose();
    cutter.geometry.dispose();
  }
}

function worldPositions(brush: Brush) {
  const geometry = brush.geometry.clone();
  geometry.applyMatrix4(brush.matrixWorld);
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const values: number[] = [];
  if (!position) {
    geometry.dispose();
    return values;
  }
  if (index) {
    for (let i = 0; i < index.count; i += 1) {
      const vertex = index.getX(i);
      values.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
    }
  } else {
    for (let i = 0; i < position.count; i += 1) {
      values.push(position.getX(i), position.getY(i), position.getZ(i));
    }
  }
  geometry.dispose();
  return values;
}

export function shapeFromSplitWorld(source: WorkplaneShape, world: number[], side: string): WorkplaneShape | null {
  if (world.length < 9) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < world.length; index += 3) {
    const x = world[index];
    const y = world[index + 1];
    const z = world[index + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const rawWidth = maxX - minX;
  const rawHeight = maxY - minY;
  const rawDepth = maxZ - minZ;
  if (rawWidth < 0.05 && rawHeight < 0.05 && rawDepth < 0.05) return null;
  const width = cleanModelDimension(Math.max(MIN_SHAPE_DIMENSION, rawWidth));
  const height = cleanModelDimension(Math.max(MIN_SHAPE_DIMENSION, rawHeight));
  const depth = cleanModelDimension(Math.max(MIN_SHAPE_DIMENSION, rawDepth));
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const positions = world.map((value, index) => {
    const place = index % 3;
    if (place === 0) return value - centerX;
    if (place === 1) return value - minY;
    return value - centerZ;
  });
  return canonicalizeShape({
    id: createLocalId(`${source.id}-split`),
    name: `${source.name} ${side}`,
    kind: "mesh",
    color: source.color,
    hole: source.hole || undefined,
    x: cleanNearZero(centerX, 0.0005),
    z: cleanNearZero(centerZ, 0.0005),
    elevation: cleanNearZero(minY, 0.0005),
    size: Math.max(width, depth),
    width,
    depth,
    height,
    rotation: 0,
    rotationX: 0,
    rotationZ: 0,
    importedMesh: {
      positions,
      baseWidth: Math.max(rawWidth, 0.001),
      baseDepth: Math.max(rawDepth, 0.001),
      baseHeight: Math.max(rawHeight, 0.001),
      triangleCount: Math.floor(positions.length / 9),
      sourceFormat: "json",
    },
    locked: false,
    hidden: false,
  });
}
