import * as THREE from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  resolveHollowCylinderSegments,
  resolveIcosahedronDetail,
  resolveShapeSides,
  resolveShapeSteps,
} from "@/lib/displayTessellation";
import { createGearGeometry } from "@/lib/gearMesh";
import { shapeUsesImportedMesh } from "@/lib/gridfinity";
import { roofAnglesFromProfile } from "@/lib/roofGeometry";
import { sphereTessellation } from "@/lib/sphereTessellation";
import { DEFAULT_TEXT_FONT, resolveTextFont, textFontCurveSegments } from "@/lib/textFonts";
import {
  coneUnitBaseScale,
  coneUnitTopScale,
  mirroredAxisCount,
  mirrorSign,
  resizedImportedMeshPositions,
  shapeDepth,
  shapeWidth,
} from "@/lib/workplaneShapes";
import { shapeYawDegrees } from "@/lib/shapeBounds";
import type { WorkplaneShape } from "@/types/sketchforge";

export type Vec3 = [number, number, number];
export type MeshData = { name: string; vertices: Vec3[]; faces: [number, number, number][] };
export type Cuboid = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

export function sanitizeName(name: string) {
  return name.replace(/[^a-z0-9_-]+/gi, "_") || "shape";
}

export function transformMesh(mesh: MeshData, shape: WorkplaneShape): MeshData {
  const centerY = shape.height / 2;
  const matrix = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(shape.rotationX ?? 0),
      THREE.MathUtils.degToRad(shapeYawDegrees(shape)),
      THREE.MathUtils.degToRad(shape.rotationZ ?? 0),
      "XYZ",
    ),
  );
  const mirrorX = mirrorSign(shape.mirrorX);
  const mirrorY = mirrorSign(shape.mirrorY);
  const mirrorZ = mirrorSign(shape.mirrorZ);
  const reversedWinding = mirroredAxisCount(shape) % 2 === 1;
  const vertex = new THREE.Vector3();
  const originY = (shape.elevation ?? 0) + centerY;
  const vertices: Vec3[] = new Array(mesh.vertices.length);
  for (let i = 0; i < mesh.vertices.length; i += 1) {
    const [x, y, z] = mesh.vertices[i];
    vertex.set(x * mirrorX, (y - centerY) * mirrorY, z * mirrorZ).applyMatrix4(matrix);
    vertices[i] = [vertex.x + shape.x, vertex.y + originY, vertex.z + shape.z];
  }
  return {
    ...mesh,
    vertices,
    faces: reversedWinding ? mesh.faces.map(([a, b, c]) => [a, c, b] as [number, number, number]) : mesh.faces,
  };
}

export function boxMesh(shape: WorkplaneShape): MeshData {
  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const height = shape.height;
  const x = width / 2;
  const z = depth / 2;
  return {
    name: sanitizeName(shape.name),
    vertices: [
      [-x, 0, -z],
      [x, 0, -z],
      [x, 0, z],
      [-x, 0, z],
      [-x, height, -z],
      [x, height, -z],
      [x, height, z],
      [-x, height, z],
    ],
    faces: [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7],
    ],
  };
}

/** A cylinder, or a cone when the rings are scaled: each scale is a fraction of the footprint. */
export function cylinderMesh(shape: WorkplaneShape, sides = 96, topRadiusScale = 1, baseRadiusScale = 1): MeshData {
  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const height = shape.height;
  const vertices: Vec3[] = [[0, 0, 0], [0, height, 0]];
  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2;
    vertices.push([(Math.cos(angle) * width * baseRadiusScale) / 2, 0, (Math.sin(angle) * depth * baseRadiusScale) / 2]);
    vertices.push([(Math.cos(angle) * width * topRadiusScale) / 2, height, (Math.sin(angle) * depth * topRadiusScale) / 2]);
  }
  const faces: [number, number, number][] = [];
  for (let i = 0; i < sides; i += 1) {
    const next = (i + 1) % sides;
    const b0 = 2 + i * 2;
    const t0 = b0 + 1;
    const b1 = 2 + next * 2;
    const t1 = b1 + 1;
    if (baseRadiusScale <= 0) {
      // Point at the bottom: a cone standing on its tip.
      faces.push([1, t0, t1], [b0, t1, t0]);
    } else if (topRadiusScale > 0) {
      faces.push([0, b1, b0], [1, t0, t1]);
      faces.push([b0, b1, t1], [b0, t1, t0]);
    } else {
      faces.push([0, b1, b0], [b0, b1, t0]);
    }
  }
  return { name: sanitizeName(shape.name), vertices, faces };
}

export function sphereMesh(shape: WorkplaneShape): MeshData {
  const { widthSegments: lon, heightSegments: lat } = sphereTessellation(shape.steps);
  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const height = shape.height;
  const vertices: Vec3[] = [];
  for (let yStep = 0; yStep <= lat; yStep += 1) {
    const theta = (yStep / lat) * Math.PI;
    const y = height / 2 + Math.cos(theta) * (height / 2);
    const ring = Math.sin(theta);
    for (let xStep = 0; xStep < lon; xStep += 1) {
      const phi = (xStep / lon) * Math.PI * 2;
      vertices.push([(Math.cos(phi) * width * ring) / 2, y, (Math.sin(phi) * depth * ring) / 2]);
    }
  }
  const faces: [number, number, number][] = [];
  for (let yStep = 0; yStep < lat; yStep += 1) {
    for (let xStep = 0; xStep < lon; xStep += 1) {
      const next = (xStep + 1) % lon;
      const a = yStep * lon + xStep;
      const b = yStep * lon + next;
      const c = (yStep + 1) * lon + next;
      const d = (yStep + 1) * lon + xStep;
      faces.push([a, d, c], [a, c, b]);
    }
  }
  return { name: sanitizeName(shape.name), vertices, faces };
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function bufferGeometryToMeshData(name: string, geometry: THREE.BufferGeometry): MeshData {
  const prepared = geometry.index ? geometry.toNonIndexed() : geometry;
  prepared.computeVertexNormals();
  prepared.computeBoundingBox();
  const minY = prepared.boundingBox?.min.y ?? 0;
  if (Math.abs(minY) > 0.000001) {
    prepared.translate(0, -minY, 0);
    prepared.computeBoundingBox();
  }

  const position = prepared.getAttribute("position");
  const vertices: Vec3[] = [];
  const faces: [number, number, number][] = [];
  for (let i = 0; i < position.count; i += 1) {
    vertices.push([position.getX(i), position.getY(i), position.getZ(i)]);
  }
  for (let i = 0; i + 2 < position.count; i += 3) {
    faces.push([i, i + 1, i + 2]);
  }

  if (prepared !== geometry) {
    prepared.dispose();
  }
  geometry.dispose();
  return { name, vertices, faces };
}

export function createBooleanRoofGeometry(width: number, height: number, depth: number, leftAngle?: number, rightAngle?: number) {
  const w = width / 2;
  const d = depth / 2;
  const { ridgeX } = roofAnglesFromProfile(width, height, leftAngle, rightAngle);
  const vertices = new Float32Array([
    -w, 0, -d, w, 0, -d, ridgeX, height, -d,
    -w, 0, d, w, 0, d, ridgeX, height, d,
  ]);
  const indices = [
    0, 2, 1,
    3, 4, 5,
    0, 1, 4, 0, 4, 3,
    0, 3, 5, 0, 5, 2,
    1, 2, 5, 1, 5, 4,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return geometry;
}

export function createBooleanWedgeGeometry(width: number, height: number, depth: number) {
  const w = width / 2;
  const d = depth / 2;
  const vertices = new Float32Array([
    -w, 0, -d, w, 0, -d, w, height, -d,
    -w, 0, d, w, 0, d, w, height, d,
  ]);
  const indices = [
    0, 2, 1,
    3, 4, 5,
    0, 1, 4, 0, 4, 3,
    1, 2, 5, 1, 5, 4,
    0, 3, 5, 0, 5, 2,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return geometry;
}

export function createBooleanPyramidGeometry(width: number, height: number, depth: number, sides = 4) {
  const count = Math.max(3, Math.round(sides));
  if (count !== 4) {
    const radius = Math.min(width, depth) / 2;
    const geometry = new THREE.ConeGeometry(radius, height, count);
    geometry.translate(0, height / 2, 0);
    return geometry;
  }

  const w = width / 2;
  const d = depth / 2;
  const vertices = new Float32Array([
    -w, 0, -d, w, 0, -d, w, 0, d, -w, 0, d,
    0, height, 0,
  ]);
  const indices = [
    0, 1, 2, 0, 2, 3,
    0, 4, 1,
    1, 4, 2,
    2, 4, 3,
    3, 4, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return geometry;
}

export function createBooleanRoundRoofGeometry(width: number, height: number, depth: number, sides = 64) {
  const radius = width / 2;
  const segments = Math.max(4, Math.round(sides));
  const shape = new THREE.Shape();
  shape.moveTo(-radius, 0);
  shape.absarc(0, 0, radius, Math.PI, 0, true);
  shape.lineTo(-radius, 0);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: segments });
  geometry.translate(0, 0, -depth / 2);
  geometry.scale(1, height / Math.max(0.001, radius), 1);
  return geometry;
}

export function createBooleanHalfSphereGeometry(width: number, height: number, depth: number, steps = 32) {
  const lon = Math.max(8, Math.round(steps) * 2);
  const lat = Math.max(4, Math.round(steps / 2));
  const rx = width / 2;
  const rz = depth / 2;
  const positions: number[] = [];
  const point = (latIndex: number, lonIndex: number): Vec3 => {
    const theta = (latIndex / lat) * (Math.PI / 2);
    const phi = ((lonIndex % lon) / lon) * Math.PI * 2;
    const ring = Math.sin(theta);
    return [Math.cos(phi) * rx * ring, Math.cos(theta) * height, Math.sin(phi) * rz * ring];
  };
  const addTri = (a: Vec3, b: Vec3, c: Vec3) => positions.push(...a, ...b, ...c);

  const top: Vec3 = [0, height, 0];
  for (let xStep = 0; xStep < lon; xStep += 1) {
    addTri(top, point(1, xStep + 1), point(1, xStep));
  }

  for (let yStep = 1; yStep < lat; yStep += 1) {
    for (let xStep = 0; xStep < lon; xStep += 1) {
      const next = xStep + 1;
      const a = point(yStep, xStep);
      const b = point(yStep, next);
      const c = point(yStep + 1, next);
      const d = point(yStep + 1, xStep);
      addTri(a, c, d);
      addTri(a, b, c);
    }
  }

  const bottomCenter: Vec3 = [0, 0, 0];
  const capPoint = (lonIndex: number): Vec3 => {
    const phi = ((lonIndex % lon) / lon) * Math.PI * 2;
    return [Math.cos(phi) * rx, 0, Math.sin(phi) * rz];
  };
  for (let xStep = 0; xStep < lon; xStep += 1) {
    addTri(bottomCenter, capPoint(xStep), capPoint(xStep + 1));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function createBooleanTorusGeometry(width: number, height: number, depth: number, tubeRadiusOverride?: number, steps = 24) {
  const maxTubeRadius = Math.max(0.1, Math.min(width, depth) / 2 - 0.2);
  const tubeRadius = clampNumber(tubeRadiusOverride ?? height / 2, 0.1, maxTubeRadius);
  const majorRadius = Math.max(0.2, Math.min(width, depth) / 2 - tubeRadius);
  const radialSegments = Math.max(8, Math.round(steps));
  const tubularSegments = Math.max(24, Math.round(steps) * 4);
  const geometry = new THREE.TorusGeometry(majorRadius, tubeRadius, radialSegments, tubularSegments);
  geometry.rotateX(Math.PI / 2);
  const outerDiameter = (majorRadius + tubeRadius) * 2;
  geometry.scale(
    width / Math.max(0.001, outerDiameter),
    height / Math.max(0.001, tubeRadius * 2),
    depth / Math.max(0.001, outerDiameter),
  );
  return geometry;
}

export function createBooleanHollowCylinderGeometry(width: number, height: number, depth: number, thickness: number, segments = 96) {
  const outerX = width / 2;
  const outerZ = depth / 2;
  const safeThickness = clampNumber(thickness, 0.1, Math.max(0.1, Math.min(outerX, outerZ) - 0.1));
  const innerX = Math.max(0.1, outerX - safeThickness);
  const innerZ = Math.max(0.1, outerZ - safeThickness);
  const count = Math.max(12, Math.round(segments));
  const positions: number[] = [];
  const point = (rx: number, rz: number, y: number, index: number): Vec3 => {
    const angle = (index / count) * Math.PI * 2;
    return [Math.cos(angle) * rx, y, Math.sin(angle) * rz];
  };
  const addTri = (a: Vec3, b: Vec3, c: Vec3) => positions.push(...a, ...b, ...c);
  const addQuad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    addTri(a, b, c);
    addTri(a, c, d);
  };

  for (let index = 0; index < count; index += 1) {
    const next = index + 1;
    const ob0 = point(outerX, outerZ, 0, index);
    const ob1 = point(outerX, outerZ, 0, next);
    const ot0 = point(outerX, outerZ, height, index);
    const ot1 = point(outerX, outerZ, height, next);
    const ib0 = point(innerX, innerZ, 0, index);
    const ib1 = point(innerX, innerZ, 0, next);
    const it0 = point(innerX, innerZ, height, index);
    const it1 = point(innerX, innerZ, height, next);

    addQuad(ob0, ot0, ot1, ob1);
    addQuad(ib1, it1, it0, ib0);
    addQuad(ot0, it0, it1, ot1);
    addQuad(ob0, ob1, ib1, ib0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

const TEXT_LAYOUT_SIZE = 20;
const textLayoutCache = new Map<string, { laidWidth: number; inkHeight: number }>();

function layoutTextGlyphs(shape: Pick<WorkplaneShape, "text" | "font" | "bevel" | "segments">, extrusion: number) {
  const text = (shape.text ?? "TEXT").trim() || " ";
  const bevel = clampNumber(shape.bevel ?? 0, 0, 8);
  const fontName = shape.font ?? DEFAULT_TEXT_FONT;
  const font = resolveTextFont(fontName);
  const curveSegments = textFontCurveSegments(fontName);
  const glyphs = font.data.glyphs as Record<string, { ha?: number; o?: string } | undefined>;
  const layoutScale = TEXT_LAYOUT_SIZE / font.data.resolution;
  const chars = Array.from(text);
  const pieces: { geometry: THREE.BufferGeometry; center: number }[] = [];
  let cursor = 0;
  let inkHeight = 1;

  chars.forEach((char) => {
    const glyph = glyphs[char] ?? glyphs["?"];
    const advance = (glyph?.ha ?? font.data.resolution) * layoutScale;
    if (char !== " " && glyph?.o) {
      const geometry = new TextGeometry(char, {
        font,
        size: TEXT_LAYOUT_SIZE,
        depth: extrusion,
        curveSegments,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel * 0.22,
        bevelSize: bevel * 0.16,
        bevelSegments: Math.max(1, shape.segments ?? 0),
      });
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (box && geometry.getAttribute("position")?.count) {
        inkHeight = Math.max(inkHeight, box.max.y - box.min.y);
        pieces.push({ geometry, center: cursor + (box.min.x + box.max.x) / 2 });
      } else {
        geometry.dispose();
      }
    }
    cursor += advance;
  });

  return { laidWidth: Math.max(1, cursor), inkHeight, pieces };
}

/** Advance width and cap height of the text, in the same units the mesh is fitted with. */
export function textLayoutMetrics(shape: Pick<WorkplaneShape, "text" | "font" | "bevel" | "segments">) {
  const bevel = clampNumber(shape.bevel ?? 0, 0, 8);
  const key = `${shape.font ?? DEFAULT_TEXT_FONT}|${bevel}|${shape.segments ?? 0}|${(shape.text ?? "TEXT").trim() || " "}`;
  const cached = textLayoutCache.get(key);
  if (cached) return cached;
  const layout = layoutTextGlyphs(shape, 1);
  layout.pieces.forEach((piece) => piece.geometry.dispose());
  const metrics = { laidWidth: layout.laidWidth, inkHeight: layout.inkHeight };
  textLayoutCache.set(key, metrics);
  return metrics;
}

function roundTextSize(value: number) {
  return Math.max(0.01, Number(value.toFixed(3)));
}

/** Letter height that fills the shape when the line is `width` long. */
export function matchedTextDepth(shape: Pick<WorkplaneShape, "text" | "font" | "bevel" | "segments">, width: number) {
  const { laidWidth, inkHeight } = textLayoutMetrics(shape);
  return roundTextSize((width * inkHeight) / laidWidth);
}

/** Line length that fills the shape when the letters are `depth` tall. */
export function matchedTextWidth(shape: Pick<WorkplaneShape, "text" | "font" | "bevel" | "segments">, depth: number) {
  const { laidWidth, inkHeight } = textLayoutMetrics(shape);
  return roundTextSize((depth * laidWidth) / Math.max(0.001, inkHeight));
}

/**
 * Keep text letters undistorted. Changing the width updates the letter height
 * so the glyphs fill the shape, and changing the letter height updates the width.
 */
export function withMatchedTextFootprint(shape: WorkplaneShape, patch: Partial<WorkplaneShape>): Partial<WorkplaneShape> {
  if (shape.kind !== "text") return patch;
  const next = { ...shape, ...patch };
  const previousWidth = shapeWidth(shape);
  const previousDepth = shapeDepth(shape);
  const nextWidth = shapeWidth(next);
  const nextDepth = shapeDepth(next);
  const contentChanged = patch.text !== undefined || patch.font !== undefined || patch.bevel !== undefined;
  const widthMoved = Math.abs(nextWidth - previousWidth) > 1e-4 || contentChanged;
  const depthMoved = Math.abs(nextDepth - previousDepth) > 1e-4;
  if (!widthMoved && !depthMoved) return patch;

  const widthScale = nextWidth / Math.max(0.001, previousWidth);
  const depthScale = nextDepth / Math.max(0.001, previousDepth);
  const driveFromWidth = !depthMoved || (widthMoved && Math.abs(widthScale - 1) >= Math.abs(depthScale - 1));
  const width = driveFromWidth ? nextWidth : matchedTextWidth(next, nextDepth);
  const depth = driveFromWidth ? matchedTextDepth(next, width) : nextDepth;
  return {
    ...patch,
    width,
    depth,
    size: roundTextSize(Math.max(width, depth)),
  };
}

export function createBooleanTextGeometry(shape: WorkplaneShape) {
  const { laidWidth, inkHeight, pieces } = layoutTextGlyphs(shape, shape.height);

  if (!pieces.length) {
    const blank = new THREE.BufferGeometry();
    blank.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    return blank;
  }

  const fit = Math.min(shapeWidth(shape) / laidWidth, shapeDepth(shape) / inkHeight);
  const textWidth = laidWidth * fit;
  const mid = laidWidth / 2;
  const upDown = shape.textCircumference ?? 0;
  const wrap = shape.textWrap ?? 0;

  const geometries = pieces.map((piece) => {
    const geometry = piece.geometry;
    geometry.scale(fit, fit, 1);
    layTextFaceUp(geometry);
    poseGlyph(geometry, (piece.center - mid) * fit, textWidth, upDown, wrap);
    return geometry;
  });

  const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
  if (!merged) return geometries[0];
  if (merged !== geometries[0]) {
    geometries.forEach((geometry) => geometry.dispose());
  }
  seatGeometry(merged, { centerX: true, minY: true, centerZ: true });
  merged.computeVertexNormals();
  return merged;
}

/** Lay one extruded glyph face-up, centered, with its back on the workplane. */
function layTextFaceUp(geometry: THREE.BufferGeometry) {
  geometry.rotateX(-Math.PI / 2);
  seatGeometry(geometry, { centerX: true, minY: true, centerZ: true });
}

function seatGeometry(
  geometry: THREE.BufferGeometry,
  mode: { centerX?: boolean; minY?: boolean; centerZ?: boolean; minZ?: boolean },
) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;
  geometry.translate(
    mode.centerX ? -(box.min.x + box.max.x) / 2 : 0,
    mode.minY ? -box.min.y : 0,
    mode.minZ ? -box.min.z : mode.centerZ ? -(box.min.z + box.max.z) / 2 : 0,
  );
}

/**
 * Move a whole letter onto the curve. Vertices stay rigid, so strokes do not stretch.
 * Up/down bows the line across the page. Letters stay face-up and yaw to follow it.
 * In/out bends a rod run through the letters, so they turn with the rod as it wraps.
 */
function poseGlyph(
  geometry: THREE.BufferGeometry,
  along: number,
  textWidth: number,
  upDown: number,
  wrap: number,
) {
  const upTurn = Math.min(100, Math.abs(upDown)) / 100;
  const wrapTurn = Math.min(100, Math.abs(wrap)) / 100;
  const upInward = upDown > 0;
  const wrapInward = wrap > 0;
  const upRadius = upTurn > 0 ? textWidth / (upTurn * Math.PI * 2) : 0;
  const wrapRadius = wrapTurn > 0 ? textWidth / (wrapTurn * Math.PI * 2) : 0;
  const upAngle = upRadius ? along / upRadius : 0;
  const wrapAngle = wrapRadius ? along / wrapRadius : 0;

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const pivotY = box ? (box.min.y + box.max.y) / 2 : 0;
  let x = along;
  let y = 0;
  let z = 0;

  if (upTurn > 0) {
    geometry.rotateY(upInward ? -upAngle : upAngle);
    x = Math.sin(upAngle) * upRadius;
    z = upInward ? upRadius * (1 - Math.cos(upAngle)) : upRadius * (Math.cos(upAngle) - 1);
  }
  if (wrapTurn > 0) {
    const bend = wrapInward ? wrapAngle : -wrapAngle;
    geometry.translate(0, -pivotY, 0);
    geometry.rotateZ(bend);
    geometry.translate(0, pivotY, 0);
    x = Math.sin(wrapAngle) * wrapRadius;
    y = wrapInward ? wrapRadius * (1 - Math.cos(wrapAngle)) : wrapRadius * (Math.cos(wrapAngle) - 1);
  }
  geometry.translate(x, y, z);
}

export function geometryMeshForShape(shape: WorkplaneShape): MeshData | null {
  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const height = shape.height;
  const size = Math.min(width, depth);
  let geometry: THREE.BufferGeometry | null = null;

  switch (shape.kind) {
    case "box":
      geometry = shape.radius && shape.radius > 0
        ? new RoundedBoxGeometry(width, height, depth, Math.max(1, resolveShapeSteps(shape.kind, shape.steps) ?? 16), shape.radius)
        : new THREE.BoxGeometry(width, height, depth);
      break;
    case "cylinder":
    case "thread":
      geometry = new THREE.CylinderGeometry(1, 1, height, resolveShapeSides(shape.kind, shape.sides) ?? 192, shape.segments ?? 1);
      geometry.scale(width / 2, 1, depth / 2);
      break;
    case "sphere":
      const tessellation = sphereTessellation(resolveShapeSteps(shape.kind, shape.steps));
      geometry = new THREE.SphereGeometry(1, tessellation.widthSegments, tessellation.heightSegments);
      geometry.scale(width / 2, height / 2, depth / 2);
      break;
    case "cone": {
      geometry = new THREE.CylinderGeometry(coneUnitTopScale(shape), coneUnitBaseScale(shape), height, resolveShapeSides(shape.kind, shape.sides) ?? 192);
      geometry.scale(width / 2, 1, depth / 2);
      break;
    }
    case "pyramid":
      geometry = createBooleanPyramidGeometry(width, height, depth, shape.sides ?? 4);
      break;
    case "roof":
      geometry = createBooleanRoofGeometry(width, height, depth, shape.leftAngle, shape.rightAngle);
      break;
    case "roundRoof":
      geometry = createBooleanRoundRoofGeometry(width, height, depth, resolveShapeSides(shape.kind, shape.sides) ?? 128);
      break;
    case "halfSphere":
      geometry = createBooleanHalfSphereGeometry(width, height, depth, resolveShapeSteps(shape.kind, shape.steps) ?? 56);
      break;
    case "torus":
      geometry = createBooleanTorusGeometry(width, height, depth, shape.radius, resolveShapeSteps(shape.kind, shape.steps) ?? 64);
      break;
    case "ring":
    case "tube":
      geometry = createBooleanHollowCylinderGeometry(width, height, depth, shape.bevel ?? 4, resolveHollowCylinderSegments());
      break;
    case "wedge":
      geometry = createBooleanWedgeGeometry(width, height, depth);
      break;
    case "polygon":
      geometry = new THREE.CylinderGeometry(1, 1, height, shape.sides ?? 6);
      geometry.scale(width / 2, 1, depth / 2);
      break;
    case "gear":
      geometry = createGearGeometry(shape);
      break;
    case "icosahedron":
      geometry = new THREE.IcosahedronGeometry(size / 2, resolveIcosahedronDetail());
      geometry.translate(0, height / 2, 0);
      break;
    case "text":
      geometry = createBooleanTextGeometry(shape);
      break;
    case "scribble":
      geometry = new THREE.TorusKnotGeometry(size * 0.22, size * 0.055, 120, 12);
      geometry.translate(0, height / 2, 0);
      break;
    case "gridfinityBin":
    case "gridfinityBaseplate":
    case "loft":
      // Kernel mesh not built yet: the footprint box matches the viewport stand-in.
      geometry = new THREE.BoxGeometry(width, height, depth);
      break;
    case "sketch":
    default:
      geometry = new THREE.BoxGeometry(size, Math.max(3, height * 0.35), size * 0.72);
      break;
  }

  return geometry ? bufferGeometryToMeshData(sanitizeName(shape.name), geometry) : null;
}

export function meshForShape(shape: WorkplaneShape): MeshData {
  if (shapeUsesImportedMesh(shape)) {
    return importedMeshForShape(shape);
  }

  if (shape.groupedShapes?.length) {
    const vertices: Vec3[] = [];
    const faces: [number, number, number][] = [];
    shape.groupedShapes.filter((child) => !child.hidden).forEach((child) => {
      const childMesh = meshForShape(child);
      appendMeshData(vertices, faces, childMesh);
    });
    return transformMesh({ name: sanitizeName(shape.name), vertices, faces }, shape);
  }

  const raw =
    geometryMeshForShape(shape) ??
    (shape.kind === "cylinder" || shape.kind === "tube" || shape.kind === "ring" || shape.kind === "torus"
      ? cylinderMesh(shape, resolveShapeSides(shape.kind === "torus" ? "cylinder" : shape.kind, shape.sides) ?? 192)
      : shape.kind === "cone"
        ? cylinderMesh(shape, resolveShapeSides(shape.kind, shape.sides) ?? 192, coneUnitTopScale(shape), coneUnitBaseScale(shape))
        : shape.kind === "sphere" || shape.kind === "halfSphere"
          ? sphereMesh(shape)
          : shape.kind === "pyramid"
            ? cylinderMesh(shape, shape.sides ?? 4, 0)
            : boxMesh(shape));
  return transformMesh(raw, shape);
}

export function appendMeshData(vertices: Vec3[], faces: [number, number, number][], mesh: MeshData) {
  const offset = vertices.length;
  for (let i = 0; i < mesh.vertices.length; i += 1) {
    vertices.push(mesh.vertices[i]);
  }
  for (let i = 0; i < mesh.faces.length; i += 1) {
    const [a, b, c] = mesh.faces[i];
    faces.push([a + offset, b + offset, c + offset]);
  }
}

export function importedMeshForShape(shape: WorkplaneShape): MeshData {
  const mesh = shape.importedMesh;
  if (!mesh || mesh.positions.length < 9) {
    // Dirty/empty CSG caches must not silently become bounding boxes — that poisons
    // later Group/Export as if a real solid existed.
    throw new Error(`“${shape.name}” has no usable mesh. Remesh or rebuild the boolean body.`);
  }

  const resizedPositions = resizedImportedMeshPositions(shape);
  const vertices: Vec3[] = [];
  for (let i = 0; i < resizedPositions.length; i += 3) {
    vertices.push([resizedPositions[i], resizedPositions[i + 1], resizedPositions[i + 2]]);
  }

  const faces: [number, number, number][] = [];
  if (mesh.indices && mesh.indices.length >= 3) {
    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
      const a = mesh.indices[i];
      const b = mesh.indices[i + 1];
      const c = mesh.indices[i + 2];
      if (a < vertices.length && b < vertices.length && c < vertices.length) {
        faces.push([a, b, c]);
      }
    }
  } else {
    for (let i = 0; i + 2 < vertices.length; i += 3) {
      faces.push([i, i + 1, i + 2]);
    }
  }

  return transformMesh({ name: sanitizeName(shape.name), vertices, faces }, shape);
}

export function shapeAabb(shape: WorkplaneShape): Cuboid {
  const halfWidth = shapeWidth(shape) / 2;
  const halfDepth = shapeDepth(shape) / 2;
  return {
    minX: shape.x - halfWidth,
    maxX: shape.x + halfWidth,
    minY: shape.elevation ?? 0,
    maxY: (shape.elevation ?? 0) + shape.height,
    minZ: shape.z - halfDepth,
    maxZ: shape.z + halfDepth,
  };
}

export function boundsForShapes(shapes: WorkplaneShape[]): Cuboid {
  const bounds = shapes.map(meshAabb);
  return boundsForCuboids(bounds);
}

export function boundsForCuboids(bounds: Cuboid[]): Cuboid {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < bounds.length; i += 1) {
    const box = bounds[i];
    if (box.minX < minX) minX = box.minX;
    if (box.maxX > maxX) maxX = box.maxX;
    if (box.minY < minY) minY = box.minY;
    if (box.maxY > maxY) maxY = box.maxY;
    if (box.minZ < minZ) minZ = box.minZ;
    if (box.maxZ > maxZ) maxZ = box.maxZ;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

export function dropPatchForShape(shape: WorkplaneShape, targetY: number): Partial<WorkplaneShape> {
  const bounds = meshAabb(shape);
  const delta = targetY - bounds.minY;
  const nextElevation = (shape.elevation ?? 0) + delta;
  return { elevation: Math.abs(nextElevation) < 0.0005 ? 0 : Number(nextElevation.toFixed(4)) };
}

/** Bounds per shape object. Booleans ask for a cutter's bounds once per triangle of the part. */
const meshAabbCache = new WeakMap<WorkplaneShape, Cuboid>();

export function meshAabb(shape: WorkplaneShape): Cuboid {
  const cached = meshAabbCache.get(shape);
  if (cached) return { ...cached };
  const bounds = uncachedMeshAabb(shape);
  meshAabbCache.set(shape, bounds);
  return { ...bounds };
}

function uncachedMeshAabb(shape: WorkplaneShape): Cuboid {
  const mesh = meshForShape(shape);
  if (mesh.vertices.length === 0) {
    return shapeAabb(shape);
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  mesh.vertices.forEach(([x, y, z]) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  });

  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) {
    return shapeAabb(shape);
  }

  return { minX, maxX, minY, maxY, minZ, maxZ };
}
