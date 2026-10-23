import type { CadPlanarFace } from "@/lib/cadModifierTypes";
import { formatMeasurementNumber } from "@/lib/measurementUnits";
import type { MeasurementAccuracy } from "@/types/sketchforge";

export type Vec3 = { x: number; y: number; z: number };

const EPS = 1e-8;

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(a: Vec3) {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: Vec3): Vec3 {
  const mag = length(a) || 1;
  return { x: a.x / mag, y: a.y / mag, z: a.z / mag };
}

export function orthonormalAxes(normal: Vec3): { u: Vec3; v: Vec3 } {
  const n = normalize(normal);
  const helper = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = normalize(cross(helper, n));
  return { u, v: cross(n, u) };
}

type Vec2 = { x: number; y: number };

/** Face outline as an open loop: consecutive duplicates and a repeated closing point are dropped. */
export function polylinePoints(points: number[]): Vec3[] {
  const out: Vec3[] = [];
  for (let index = 0; index + 2 < points.length; index += 3) {
    const next = { x: points[index], y: points[index + 1], z: points[index + 2] };
    const prev = out[out.length - 1];
    if (prev && Math.hypot(next.x - prev.x, next.y - prev.y, next.z - prev.z) < 1e-5) continue;
    out.push(next);
  }
  while (out.length > 2 && length(sub(out[0], out[out.length - 1])) < 1e-5) out.pop();
  return out;
}

function project2d(point: Vec3, origin: Vec3, u: Vec3, v: Vec3): Vec2 {
  const d = sub(point, origin);
  return { x: dot(d, u), y: dot(d, v) };
}

function cross2(o: Vec2, a: Vec2, b: Vec2) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Even-odd test so L-shaped and other concave faces only hit inside their outline. */
function pointInPolygon(point: Vec2, polygon: Vec2[]) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, prev = polygon.length - 1; index < polygon.length; prev = index, index += 1) {
    const a = polygon[index];
    const b = polygon[prev];
    // On-edge hits count as inside so a click on the outline still picks the face.
    const edgeLength = Math.hypot(b.x - a.x, b.y - a.y);
    if (edgeLength > 1e-9) {
      const t = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (edgeLength * edgeLength);
      if (t >= 0 && t <= 1) {
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        if (Math.hypot(point.x - px, point.y - py) < 1e-6) return true;
      }
    }
    if ((a.y > point.y) !== (b.y > point.y)) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2) {
  const d1 = cross2(a, b, p);
  const d2 = cross2(b, c, p);
  const d3 = cross2(c, a, p);
  const hasNeg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12;
  const hasPos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
  return !(hasNeg && hasPos);
}

/** Ear-clipping triangulation of a simple polygon. Returns index triples into `polygon`. */
export function triangulatePolygon2d(polygon: Vec2[]): number[] {
  const count = polygon.length;
  if (count < 3) return [];
  let signedArea = 0;
  for (let index = 0; index < count; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % count];
    signedArea += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(signedArea) < 1e-12) return [];
  const ccw = signedArea > 0;
  const remaining = polygon.map((_, index) => index);
  const triangles: number[] = [];
  let guard = 0;
  while (remaining.length > 3 && guard < count * count) {
    guard += 1;
    let clipped = false;
    for (let slot = 0; slot < remaining.length; slot += 1) {
      const prevIndex = remaining[(slot + remaining.length - 1) % remaining.length];
      const currIndex = remaining[slot];
      const nextIndex = remaining[(slot + 1) % remaining.length];
      const a = polygon[prevIndex];
      const b = polygon[currIndex];
      const c = polygon[nextIndex];
      const turn = cross2(a, b, c);
      if (ccw ? turn <= 1e-12 : turn >= -1e-12) continue;
      let blocked = false;
      for (const otherIndex of remaining) {
        if (otherIndex === prevIndex || otherIndex === currIndex || otherIndex === nextIndex) continue;
        if (pointInTriangle(polygon[otherIndex], a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      triangles.push(prevIndex, currIndex, nextIndex);
      remaining.splice(slot, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) triangles.push(remaining[0], remaining[1], remaining[2]);
  else if (remaining.length > 3) {
    // Degenerate input (self-touching or unordered): fall back to a fan so the ghost still draws.
    for (let index = 1; index + 1 < remaining.length; index += 1) {
      triangles.push(remaining[0], remaining[index], remaining[index + 1]);
    }
  }
  return triangles;
}

export function intersectRayPlane(origin: Vec3, normal: Vec3, rayOrigin: Vec3, rayDir: Vec3) {
  const denom = dot(rayDir, normal);
  if (Math.abs(denom) < EPS) return null;
  const t = dot(sub(origin, rayOrigin), normal) / denom;
  if (t < 0) return null;
  return add(rayOrigin, scale(rayDir, t));
}

export function pickPlanarFaceId(
  faces: CadPlanarFace[],
  rayOrigin: Vec3,
  rayDir: Vec3,
): number | null {
  let best: { id: number; t: number } | null = null;
  for (const face of faces) {
    const hit = intersectRayPlane(face.origin, face.normal, rayOrigin, rayDir);
    if (!hit) continue;
    const t = length(sub(hit, rayOrigin));
    const { u, v } = orthonormalAxes(face.normal);
    const outline = polylinePoints(face.points).map((point) => project2d(point, face.origin, u, v));
    if (outline.length < 3) continue;
    if (!pointInPolygon(project2d(hit, face.origin, u, v), outline)) continue;
    if (!best || t < best.t) best = { id: face.id, t };
  }
  return best?.id ?? null;
}

/** Distance along the face normal for a pointer ray, using a camera-facing drag plane. */
export function pushPullDistanceFromRay(
  origin: Vec3,
  normal: Vec3,
  rayOrigin: Vec3,
  rayDir: Vec3,
  cameraDir: Vec3,
): number | null {
  const n = normalize(normal);
  // Plane contains the face-normal axis and faces the camera, so the pointer ray hits it.
  let planeNormal = sub(cameraDir, scale(n, dot(cameraDir, n)));
  if (length(planeNormal) < 1e-5) {
    planeNormal = cross(n, { x: 0, y: 1, z: 0 });
  }
  if (length(planeNormal) < 1e-5) {
    planeNormal = cross(n, { x: 1, y: 0, z: 0 });
  }
  planeNormal = normalize(planeNormal);
  const hit = intersectRayPlane(origin, planeNormal, rayOrigin, rayDir);
  if (!hit) return null;
  return dot(sub(hit, origin), n);
}

/**
 * Screen-space drag mapping. The ray/plane version explodes when the face
 * looks at the camera (the drag plane is edge-on), so a 60px drag became
 * 150mm. Here the pointer travel is projected onto the normal's on-screen
 * direction and divided by how many pixels one millimetre along the normal
 * covers, with that rate clamped so a face-on drag still moves at most a few
 * millimetres per pixel.
 */
export type PushPullScreenAxis = {
  /** Unit screen direction of the outward normal (y down). */
  dir: Vec2;
  /** Pixels one millimetre along the normal covers at the face. */
  pxPerMm: number;
};

/** Lowest allowed pixels-per-mm as a fraction of an unforeshortened axis. */
const PUSH_PULL_MIN_AXIS_FRACTION = 0.25;

export function pushPullScreenAxis(
  originPx: Vec2,
  tipPx: Vec2,
  tipMm: number,
  mmPerPixel: number,
): PushPullScreenAxis {
  const dx = tipPx.x - originPx.x;
  const dy = tipPx.y - originPx.y;
  const lengthPx = Math.hypot(dx, dy);
  const fullPxPerMm = mmPerPixel > 1e-9 ? 1 / mmPerPixel : 1;
  const minPxPerMm = fullPxPerMm * PUSH_PULL_MIN_AXIS_FRACTION;
  const rawPxPerMm = tipMm > 1e-9 ? lengthPx / tipMm : 0;
  // A face looking straight at the camera has no on-screen axis; drag up to pull.
  const dir = lengthPx > 1e-6 ? { x: dx / lengthPx, y: dy / lengthPx } : { x: 0, y: -1 };
  return { dir, pxPerMm: Math.max(rawPxPerMm, minPxPerMm) };
}

export function pushPullDistanceFromDrag(axis: PushPullScreenAxis, startPx: Vec2, currentPx: Vec2) {
  const travel = (currentPx.x - startPx.x) * axis.dir.x + (currentPx.y - startPx.y) * axis.dir.y;
  return axis.pxPerMm > 1e-9 ? travel / axis.pxPerMm : 0;
}

export function ghostPrismMesh(face: CadPlanarFace, distance: number) {
  const points = polylinePoints(face.points);
  if (points.length < 2 || Math.abs(distance) < 1e-5) {
    return { positions: new Float32Array(0), indices: new Uint32Array(0) };
  }
  const direction = normalize(face.normal);
  const offset = scale(direction, distance);
  const far = points.map((point) => add(point, offset));
  const positions: number[] = [];
  const indices: number[] = [];
  // Wind every triangle outward from the prism: the outline may run either way
  // around the normal, and a push (negative distance) flips the extrusion side.
  const { u, v } = orthonormalAxes(direction);
  const outline = points.map((point) => project2d(point, face.origin, u, v));
  let signedArea = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const a = outline[index];
    const b = outline[(index + 1) % outline.length];
    signedArea += a.x * b.y - b.x * a.y;
  }
  const outward = (signedArea > 0) === (distance > 0);
  const pushTri = (a: Vec3, b: Vec3, c: Vec3) => {
    const start = positions.length / 3;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    if (outward) indices.push(start, start + 1, start + 2);
    else indices.push(start, start + 2, start + 1);
  };
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = far[(index + 1) % far.length];
    const d = far[index];
    pushTri(a, b, c);
    pushTri(a, c, d);
  }
  // Caps follow the real outline (ear clipping), so concave faces do not get
  // a centroid fan that spills outside the face.
  const capTriangles = triangulatePolygon2d(outline);
  for (let index = 0; index + 2 < capTriangles.length; index += 3) {
    const a = capTriangles[index];
    const b = capTriangles[index + 1];
    const c = capTriangles[index + 2];
    pushTri(points[a], points[c], points[b]);
    pushTri(far[a], far[b], far[c]);
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

export function pushPullChipWorld(face: CadPlanarFace, distance: number): Vec3 {
  return add(face.origin, scale(normalize(face.normal), distance));
}

export function pushPullHistoryLabel(distanceMm: number, accuracy: MeasurementAccuracy = 1) {
  const formatted = formatMeasurementNumber(Math.abs(distanceMm), accuracy);
  return `${distanceMm >= 0 ? "Pulled" : "Pushed"} ${formatted} mm`;
}

export const PUSH_PULL_COMMIT_MS = 160;
export const PUSH_PULL_APPLY_EPSILON = 0.05;
