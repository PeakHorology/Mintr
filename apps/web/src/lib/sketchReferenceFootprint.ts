import { createBooleanTextGeometry } from "@/lib/editorShapeMesh";
import { gearPlanLoops, normalizeGearSpec, rackPlanLoop } from "@/lib/gearProfile";
import { polygonFootprint } from "@/lib/polygonFootprint";
import { viewportGroupChildren } from "@/lib/csgTree";
import {
  fallbackSolidColor,
  groupedChildrenDisplayScale,
  mirrorSign,
  resizedImportedMeshPositions,
  shapeDepth,
  shapeWidth,
} from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

/** Hole bodies in the 3D view use this stripe base, not the solid's saved color. */
const HOLE_COLOR = "#d0dae2";
const MESH_FILL_TRIANGLE_CAP = 5000;

export type SketchReferenceNode = {
  x: number;
  z: number;
  rotation: number;
  /** Multiplies with mirror. 1 for a shape sitting in its own frame. */
  scaleX: number;
  scaleZ: number;
  mirrorX: number;
  mirrorZ: number;
  fillD: string | null;
  outlineD: string | null;
  evenOdd: boolean;
  color: string;
  opacity: number;
  imageHref: string | null;
  imageWidth: number;
  imageDepth: number;
  children: SketchReferenceNode[];
};

/**
 * Top-down drawing of one solid, in the same place and color the 3D view uses.
 * Paths are in the shape's local frame (origin at its center). The sketch plate
 * moves that frame onto the shape.
 */
export function sketchReferenceNode(shape: WorkplaneShape, depth = 0): SketchReferenceNode {
  const node = blankNode(shape);
  if (depth > 6) return node;
  const children = viewportGroupChildren(shape);
  if (children.length > 0) {
    const scale = groupedChildrenDisplayScale(shape);
    node.scaleX = scale.x;
    node.scaleZ = scale.z;
    node.children = children.map((child) => {
      const drawn = sketchReferenceNode(child, depth + 1);
      drawn.x += child.x;
      drawn.z += child.z;
      drawn.rotation += child.rotation ?? 0;
      drawn.mirrorX *= mirrorSign(child.mirrorX);
      drawn.mirrorZ *= mirrorSign(child.mirrorZ);
      return drawn;
    });
    return node;
  }
  const drawn = drawShape(shape);
  node.fillD = drawn.fillD;
  node.outlineD = drawn.outlineD;
  node.evenOdd = drawn.evenOdd;
  if (shape.kind === "box" && shape.imagePlate?.dataUrl && !shape.hole) {
    node.imageHref = shape.imagePlate.dataUrl;
    node.imageWidth = shapeWidth(shape);
    node.imageDepth = shapeDepth(shape);
  }
  return node;
}

function blankNode(shape: WorkplaneShape): SketchReferenceNode {
  const hole = Boolean(shape.hole);
  const color = hole ? HOLE_COLOR : (shape.color || fallbackSolidColor(shape));
  return {
    x: 0,
    z: 0,
    rotation: 0,
    scaleX: 1,
    scaleZ: 1,
    mirrorX: 1,
    mirrorZ: 1,
    fillD: null,
    outlineD: null,
    evenOdd: false,
    color,
    opacity: hole ? 0.5 : shape.construction ? 0.28 : 0.78,
    imageHref: null,
    imageWidth: 0,
    imageDepth: 0,
    children: [],
  };
}

function drawShape(shape: WorkplaneShape): { fillD: string | null; outlineD: string | null; evenOdd: boolean } {
  if (shape.importedMesh && (shape.kind === "mesh" || shape.kind === "thread" || shape.kind === "loft" || shape.kind === "gridfinityBin" || shape.kind === "gridfinityBaseplate" || shape.kind === "sketch" || shape.kind === "scribble")) {
    const projected = projectImportedMesh(shape);
    if (projected) return projected;
  }
  if (shape.kind === "text") {
    try {
      const geometry = createBooleanTextGeometry(shape);
      try {
        const projected = projectTriangles(expandedTriangles(geometry), null);
        if (projected.fillD || projected.outlineD) return projected;
      } finally {
        geometry.dispose();
      }
    } catch {
      // A missing font still leaves the colored footprint.
    }
  }
  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const parametric = parametricFootprint(shape, width, depth);
  return { fillD: parametric.fillD, outlineD: parametric.fillD, evenOdd: parametric.evenOdd };
}

function parametricFootprint(shape: WorkplaneShape, width: number, depth: number): { fillD: string; evenOdd: boolean } {
  switch (shape.kind) {
    case "cylinder":
    case "sphere":
    case "cone":
    case "halfSphere":
    case "thread":
      return { fillD: ellipsePath(width / 2, depth / 2), evenOdd: false };
    case "torus":
      return { fillD: torusPath(shape, width, depth), evenOdd: true };
    case "tube":
    case "ring":
      return { fillD: annulusPath(width, depth, shape.bevel ?? 4), evenOdd: true };
    case "polygon":
      return { fillD: loopPath(polygonFootprint(shape.sides ?? 6, width, depth)), evenOdd: false };
    case "pyramid": {
      const sides = Math.max(3, Math.round(shape.sides ?? 4));
      if (sides === 4) return { fillD: rectPath(width, depth), evenOdd: false };
      const span = Math.min(width, depth);
      return { fillD: loopPath(polygonFootprint(sides, span, span)), evenOdd: false };
    }
    case "icosahedron": {
      const radius = Math.min(width, depth) / 2;
      return { fillD: ellipsePath(radius, radius), evenOdd: false };
    }
    case "gear":
      return gearPath(shape);
    case "box":
      if (shape.radius && shape.radius > 0) return { fillD: roundedRectPath(width, depth, shape.radius), evenOdd: false };
      return { fillD: rectPath(width, depth), evenOdd: false };
    default:
      return { fillD: rectPath(width, depth), evenOdd: false };
  }
}

function gearPath(shape: WorkplaneShape): { fillD: string; evenOdd: boolean } {
  const spec = normalizeGearSpec(shape.gearSpec);
  if (spec.form === "rack") {
    return { fillD: loopPath(rackPlanLoop(spec, shapeDepth(shape))), evenOdd: false };
  }
  const plan = gearPlanLoops(spec);
  const fillD = [loopPath(plan.outer), ...plan.holes.map((hole) => loopPath(hole))].join(" ");
  return { fillD, evenOdd: plan.holes.length > 0 };
}

function torusPath(shape: WorkplaneShape, width: number, depth: number) {
  const maxTube = Math.max(0.1, Math.min(width, depth) / 2 - 0.2);
  const tube = clamp(shape.radius ?? shape.height / 2, 0.1, maxTube);
  const major = Math.max(0.2, Math.min(width, depth) / 2 - tube);
  const outerDiameter = (major + tube) * 2;
  const scaleX = width / Math.max(0.001, outerDiameter);
  const scaleZ = depth / Math.max(0.001, outerDiameter);
  const inner = Math.max(0.05, major - tube);
  return `${ellipsePath((major + tube) * scaleX, (major + tube) * scaleZ)} ${ellipsePath(inner * scaleX, inner * scaleZ)}`;
}

function annulusPath(width: number, depth: number, thickness: number) {
  const outerX = width / 2;
  const outerZ = depth / 2;
  const safe = clamp(thickness, 0.1, Math.max(0.1, Math.min(outerX, outerZ) - 0.1));
  return `${ellipsePath(outerX, outerZ)} ${ellipsePath(Math.max(0.1, outerX - safe), Math.max(0.1, outerZ - safe))}`;
}

function projectImportedMesh(shape: WorkplaneShape): { fillD: string | null; outlineD: string | null; evenOdd: boolean } | null {
  const positions = resizedImportedMeshPositions(shape);
  if (positions.length < 9) return null;
  const indices = shape.importedMesh?.indices?.length ? shape.importedMesh.indices : null;
  return { ...projectTriangles(positions, indices), evenOdd: false };
}

function projectTriangles(positions: number[], indices: number[] | null): { fillD: string | null; outlineD: string | null; evenOdd: boolean } {
  if (positions.length < 9) return { fillD: null, outlineD: null, evenOdd: false };
  let minY = Number.POSITIVE_INFINITY;
  for (let index = 1; index < positions.length; index += 3) minY = Math.min(minY, positions[index]);
  const triangleCount = indices ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);
  const stride = triangleCount > MESH_FILL_TRIANGLE_CAP ? Math.ceil(triangleCount / MESH_FILL_TRIANGLE_CAP) : 1;
  const height = spanOf(positions, 1);
  const bottomTolerance = Math.max(0.025, height * 0.003);
  const areaTolerance = Math.max(0.001, Math.max(spanOf(positions, 0), spanOf(positions, 2)) / 100000);
  const corner = (triangle: number, slot: number) => (indices ? indices[triangle * 3 + slot] : triangle * 3 + slot) * 3;
  const fill: string[] = [];
  const bottomPoints: Array<{ x: number; z: number }> = [];
  const bottomTriangles: number[][] = [];
  const hullPoints: Array<{ x: number; z: number }> = [];

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const projected = [0, 1, 2].map((slot) => {
      const index = corner(triangle, slot);
      return { x: positions[index], y: positions[index + 1], z: positions[index + 2] };
    });
    if (!projected.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))) continue;
    hullPoints.push(...projected);
    if (triangleArea2d(projected[0], projected[1], projected[2]) <= areaTolerance) continue;
    if (triangle % stride === 0) fill.push(trianglePath(projected));
    if (projected.every((point) => point.y <= minY + bottomTolerance)) {
      const offset = bottomPoints.length;
      bottomPoints.push(...projected);
      bottomTriangles.push([offset, offset + 1, offset + 2]);
    }
  }

  const outlineD = bottomTriangles.length > 0
    ? boundaryPath(bottomPoints, bottomTriangles, areaTolerance)
    : null;
  if (fill.length > 0) return { fillD: fill.join(" "), outlineD, evenOdd: false };
  const hull = convexHull(hullPoints);
  if (hull.length < 3) return { fillD: null, outlineD: null, evenOdd: false };
  const hullD = loopPath(hull);
  return { fillD: hullD, outlineD: hullD, evenOdd: false };
}

function expandedTriangles(geometry: { getAttribute: (name: string) => { count: number; getX: (index: number) => number; getY: (index: number) => number; getZ: (index: number) => number } | undefined; getIndex: () => { count: number; getX: (index: number) => number } | null }) {
  const position = geometry.getAttribute("position");
  if (!position) return [];
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const positions: number[] = [];
  for (let cursor = 0; cursor < count; cursor += 1) {
    const vertex = index ? index.getX(cursor) : cursor;
    positions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
  }
  return positions;
}

function spanOf(positions: number[], offset: number) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = offset; index < positions.length; index += 3) {
    min = Math.min(min, positions[index]);
    max = Math.max(max, positions[index]);
  }
  return Number.isFinite(min) ? max - min : 0;
}

function fmt(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function loopPath(points: Array<{ x: number; z: number }>) {
  if (points.length < 3) return "";
  const [first, ...rest] = points;
  return `M ${fmt(first.x)} ${fmt(first.z)} ${rest.map((point) => `L ${fmt(point.x)} ${fmt(point.z)}`).join(" ")} Z`;
}

function rectPath(width: number, depth: number) {
  const x = width / 2;
  const z = depth / 2;
  return loopPath([
    { x: -x, z: -z },
    { x, z: -z },
    { x, z },
    { x: -x, z },
  ]);
}

function roundedRectPath(width: number, depth: number, radius: number) {
  const x = -width / 2;
  const z = -depth / 2;
  const r = Math.min(Math.max(0, radius), width / 2, depth / 2);
  if (r <= 0.05) return rectPath(width, depth);
  const right = x + width;
  const bottom = z + depth;
  return [
    `M ${fmt(x + r)} ${fmt(z)}`,
    `H ${fmt(right - r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(right)} ${fmt(z + r)}`,
    `V ${fmt(bottom - r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(right - r)} ${fmt(bottom)}`,
    `H ${fmt(x + r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x)} ${fmt(bottom - r)}`,
    `V ${fmt(z + r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + r)} ${fmt(z)}`,
    "Z",
  ].join(" ");
}

function ellipsePath(rx: number, rz: number) {
  const x = Math.max(0, rx);
  const z = Math.max(0, rz);
  return `M ${fmt(-x)} 0 A ${fmt(x)} ${fmt(z)} 0 1 0 ${fmt(x)} 0 A ${fmt(x)} ${fmt(z)} 0 1 0 ${fmt(-x)} 0 Z`;
}

function trianglePath(points: Array<{ x: number; z: number }>) {
  return `M ${fmt(points[0].x)} ${fmt(points[0].z)} L ${fmt(points[1].x)} ${fmt(points[1].z)} L ${fmt(points[2].x)} ${fmt(points[2].z)} Z`;
}

function triangleArea2d(a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }) {
  return Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
}

function pointKey(point: { x: number; z: number }, tolerance: number) {
  return `${Math.round(point.x / tolerance)},${Math.round(point.z / tolerance)}`;
}

function convexHull(points: Array<{ x: number; z: number }>) {
  const unique = new Map<string, { x: number; z: number }>();
  points.forEach((point) => unique.set(pointKey(point, 0.001), point));
  const sorted = [...unique.values()].sort((a, b) => a.x === b.x ? a.z - b.z : a.x - b.x);
  if (sorted.length <= 2) return sorted;
  const cross = (origin: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) =>
    (a.x - origin.x) * (b.z - origin.z) - (a.z - origin.z) * (b.x - origin.x);
  const lower: Array<{ x: number; z: number }> = [];
  sorted.forEach((point) => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  });
  const upper: Array<{ x: number; z: number }> = [];
  [...sorted].reverse().forEach((point) => {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  });
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function boundaryPath(points: Array<{ x: number; z: number }>, triangles: number[][], tolerance: number) {
  const pointByKey = new Map<string, { x: number; z: number }>();
  const edgeCounts = new Map<string, { count: number; a: string; b: string }>();
  const addEdge = (aIndex: number, bIndex: number) => {
    const a = points[aIndex];
    const b = points[bIndex];
    const aKey = pointKey(a, tolerance);
    const bKey = pointKey(b, tolerance);
    pointByKey.set(aKey, a);
    pointByKey.set(bKey, b);
    const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    const current = edgeCounts.get(key);
    edgeCounts.set(key, current ? { ...current, count: current.count + 1 } : { count: 1, a: aKey, b: bKey });
  };
  triangles.forEach(([a, b, c]) => {
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  });
  const boundaryEdges = [...edgeCounts.values()].filter((edge) => edge.count === 1);
  if (boundaryEdges.length === 0) return null;
  const adjacency = new Map<string, string[]>();
  boundaryEdges.forEach(({ a, b }) => {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  });
  const unused = new Set(boundaryEdges.map(({ a, b }) => (a < b ? `${a}|${b}` : `${b}|${a}`)));
  const takeEdge = (a: string, b: string) => unused.delete(a < b ? `${a}|${b}` : `${b}|${a}`);
  const hasEdge = (a: string, b: string) => unused.has(a < b ? `${a}|${b}` : `${b}|${a}`);
  const commands: string[] = [];
  while (unused.size > 0) {
    const firstKey = unused.values().next().value as string;
    const [start, firstNext] = firstKey.split("|");
    const chain = [start, firstNext];
    takeEdge(start, firstNext);
    while (chain.length <= boundaryEdges.length + 1) {
      const current = chain[chain.length - 1];
      const previous = chain[chain.length - 2];
      const next = (adjacency.get(current) ?? []).find((candidate) => candidate !== previous && hasEdge(current, candidate))
        ?? (adjacency.get(current) ?? []).find((candidate) => hasEdge(current, candidate));
      if (!next) break;
      takeEdge(current, next);
      chain.push(next);
      if (next === start) break;
    }
    const startPoint = pointByKey.get(chain[0]);
    if (!startPoint) continue;
    const pointsD = chain
      .slice(1)
      .map((key) => pointByKey.get(key))
      .filter((point): point is { x: number; z: number } => Boolean(point))
      .map((point) => `L ${fmt(point.x)} ${fmt(point.z)}`);
    commands.push(`M ${fmt(startPoint.x)} ${fmt(startPoint.z)} ${pointsD.join(" ")}${chain[chain.length - 1] === chain[0] ? " Z" : ""}`);
  }
  return commands.join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
