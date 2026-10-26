import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CsgBodyMeta, CsgOp, WorkplaneShape } from "@/types/sketchforge";

const DEGENERATE_AREA_EPS = 1e-12;
const DEFAULT_WELD_TOLERANCE = 1e-4;
/** Dense unions (radial hubs) need a looser weld to fuse coplanar top scars. */
const DENSE_UNION_WELD_TOLERANCE = 0.05;
const DENSE_UNION_TRIANGLE_THRESHOLD = 200;
/**
 * Elevation stagger used during radial unions is ~0.01 mm. Collapse that micro-step
 * on thin solids so the baked mesh does not keep a visible mid-hub ridge.
 */
const THIN_SOLID_PLANARIZE_HEIGHT = 5;
const THIN_SOLID_PLANARIZE_BAND = 0.03;

/** Infer CSG op from an existing group (migration for pre-csg saves). */
export function inferCsgOp(shape: WorkplaneShape): CsgOp | null {
  if (!shape.groupedShapes?.length) return null;
  if (shape.csg?.op) return shape.csg.op;
  const hasHole = shape.groupedShapes.some((child) => child.hole);
  const hasSolid = shape.groupedShapes.some((child) => !child.hole);
  if (hasHole && hasSolid) return "subtract";
  if (shape.importedMesh) return "union";
  return "assemble";
}

export function withCsgMeta(shape: WorkplaneShape, op: CsgOp, version = 1, dirty = false): WorkplaneShape {
  const csg: CsgBodyMeta = { op, version, dirty: dirty || undefined };
  return { ...shape, csg };
}

export function bumpCsgVersion(shape: WorkplaneShape): WorkplaneShape {
  if (!shape.csg) return shape;
  return {
    ...shape,
    csg: {
      ...shape.csg,
      version: shape.csg.version + 1,
      dirty: true,
    },
  };
}

export function markCsgClean(shape: WorkplaneShape): WorkplaneShape {
  if (!shape.csg) return shape;
  return { ...shape, csg: { ...shape.csg, dirty: undefined } };
}

export function isCsgBody(shape: WorkplaneShape): boolean {
  return Boolean(shape.groupedShapes?.length && (shape.csg || inferCsgOp(shape)));
}

export function isEvaluatedCsgBody(shape: WorkplaneShape): boolean {
  const op = shape.csg?.op ?? inferCsgOp(shape);
  return Boolean(op && op !== "assemble" && shape.groupedShapes?.length);
}

function hasUsableImportedMesh(shape: WorkplaneShape): boolean {
  return Boolean(shape.importedMesh && shape.importedMesh.positions.length >= 9);
}

export function hasUsableCsgResultMesh(shape: WorkplaneShape): boolean {
  return hasUsableImportedMesh(shape);
}

/**
 * Children the viewport may draw for a group.
 * A group of only holes stays visible so those cutters can still be edited.
 * An assembly keeps every child, including holes, because nothing was fused.
 * Once shapes are fused with a solid, the cut result is the mesh and the holes leave the scene.
 */
export function viewportGroupChildren(shape: WorkplaneShape): WorkplaneShape[] {
  if (hasUsableImportedMesh(shape)) return [];
  const children = shape.groupedShapes ?? [];
  const op = shape.csg?.op ?? inferCsgOp(shape);
  const showHoles = Boolean(shape.hole) || op === "assemble";
  return children.filter((child) => (
    !child.hidden
    && !child.suppressed
    && !child.csg?.suppressed
    && (showHoles || !child.hole)
  ));
}

/**
 * Whether Group / Intersection should flatten this body into live children.
 * A baked subtract/union/intersect is a finished solid: inner holes must not
 * cut later operands. Assemblies (and CSG bodies with an empty mesh cache)
 * still flatten so children can participate.
 */
export function shouldExpandGroupForBoolean(shape: WorkplaneShape): boolean {
  if (!shape.groupedShapes?.length) return false;
  const op = shape.csg?.op ?? inferCsgOp(shape);
  if (op && op !== "assemble" && hasUsableImportedMesh(shape)) {
    return false;
  }
  return !hasUsableImportedMesh(shape);
}

/**
 * Flatten assemblies (and empty CSG caches) recursively so a Group of Groups
 * participates as its sealed bodies — not as a leftover local-frame nest.
 */
export function expandBooleanOperands(
  selection: WorkplaneShape[],
  restore: (shape: WorkplaneShape) => WorkplaneShape[],
): WorkplaneShape[] {
  const out: WorkplaneShape[] = [];
  const seen = new Set<string>();
  const visit = (shape: WorkplaneShape) => {
    if (shape.suppressed || shape.csg?.suppressed) return;
    if (seen.has(shape.id)) return;
    seen.add(shape.id);
    if (shouldExpandGroupForBoolean(shape)) {
      restore(shape).forEach(visit);
      return;
    }
    out.push(shape);
  };
  selection.forEach(visit);
  return out;
}

/** Last-selected group id so Ungroup peels one nested Group at a time. */
export function pickGroupToUngroup(selectedIds: string[], groupIds: string[]): string | null {
  if (groupIds.length === 0) return null;
  const nested = new Set(groupIds);
  for (let index = selectedIds.length - 1; index >= 0; index -= 1) {
    const id = selectedIds[index];
    if (nested.has(id)) return id;
  }
  return groupIds[groupIds.length - 1] ?? null;
}

/**
 * Snap near-top / near-bottom vertices onto the slab extremes.
 * Removes the diametric crease left when coplanar-break elevation stagger
 * survives Manifold simplify on dense radial unions.
 */
export function planarizeThinSolidPositions(positions: number[]): number[] {
  if (positions.length < 9) return positions;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < positions.length; i += 3) {
    const y = positions[i];
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const height = maxY - minY;
  if (!(height > 0) || height > THIN_SOLID_PLANARIZE_HEIGHT) {
    return positions;
  }
  const band = Math.min(THIN_SOLID_PLANARIZE_BAND, height * 0.45);
  // If union stagger left tops at both 1.00 and 1.01, prefer the lower top cluster.
  let topY = maxY;
  for (let i = 1; i < positions.length; i += 3) {
    const y = positions[i];
    if (y >= maxY - band && y < topY) topY = y;
  }
  const out = positions.slice();
  let changed = false;
  for (let i = 1; i < out.length; i += 3) {
    const y = out[i];
    if (y >= topY - band) {
      if (y !== topY) {
        out[i] = topY;
        changed = true;
      }
    } else if (y <= minY + band) {
      if (y !== minY) {
        out[i] = minY;
        changed = true;
      }
    }
  }
  return changed ? out : positions;
}

export type BooleanCleanupOptions = {
  /**
   * Set only for unions built with the 0.01mm elevation stagger (see the union path's
   * `solidsForUnion`). The 0.05mm weld and the thin-solid planarize pass both exist purely to
   * erase that stagger's scars, and both move real vertices — up to 0.05mm, and enough to
   * flatten a shallow engraving on any solid under 5mm tall. Subtractions, intersections and
   * plain mesh bakes never had a stagger applied, so running these on them is pure geometry
   * loss. Defaults to off so an unmapped caller keeps its true geometry.
   */
  staggeredUnion?: boolean;
  /**
   * Looser weld for leftover coplanar seams after a solid-only union (knurls, radial hubs).
   * Does not planarize, so stepped unions keep their real height.
   */
  unifyCoplanar?: boolean;
  /** Native OCCT already produced a display mesh; skip the main-thread weld. */
  skipWeld?: boolean;
};

/**
 * Weld near-duplicates and drop degenerate triangles after a boolean.
 * With `staggeredUnion`, also erases the radial-hub coplanar "crease" scars that the
 * elevation stagger leaves behind on dense unions. `unifyCoplanar` only loosens the
 * weld so leftover same-plane seams fuse — it does not flatten real steps.
 */
export function cleanupBooleanPositions(
  positions: number[],
  weldTolerance = DEFAULT_WELD_TOLERANCE,
  options: BooleanCleanupOptions = {},
): number[] {
  if (positions.length < 9) return positions;
  if (options.skipWeld) return positions;

  const staggeredUnion = options.staggeredUnion === true;
  const unifyCoplanar = options.unifyCoplanar === true;
  const estimatedTris = Math.floor(positions.length / 9);
  const dense = estimatedTris >= DENSE_UNION_TRIANGLE_THRESHOLD;
  const tol = (staggeredUnion && dense) || unifyCoplanar
    ? Math.max(weldTolerance, DENSE_UNION_WELD_TOLERANCE)
    : weldTolerance;

  // Collapse union elevation-stagger scars before welding so top verts fuse. Hub plates are
  // often under the triangle threshold but still show the diametric ridge, so this does not
  // depend on `dense` — only on the stagger actually having been applied.
  const planarized = staggeredUnion ? planarizeThinSolidPositions(positions) : positions;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(planarized, 3));
  let welded: THREE.BufferGeometry = geometry;
  try {
    welded = mergeVertices(geometry, tol);
    if (welded !== geometry) geometry.dispose();
  } catch {
    welded = geometry;
  }

  const position = welded.getAttribute("position");
  if (!position) {
    welded.dispose();
    return planarized;
  }

  const out: number[] = [];
  const read = (index: number, target: THREE.Vector3) => {
    target.fromBufferAttribute(position, index);
    return target;
  };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  const pushTriangle = (ia: number, ib: number, ic: number) => {
    read(ia, a);
    read(ib, b);
    read(ic, c);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const area2 = ab.cross(ac).lengthSq();
    if (area2 <= DEGENERATE_AREA_EPS) return;
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  const index = welded.index;
  if (index) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      pushTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    }
  } else {
    for (let i = 0; i + 2 < position.count; i += 3) {
      pushTriangle(i, i + 1, i + 2);
    }
  }

  welded.dispose();
  if (out.length < 9) return planarized;
  // Second pass catches micro-steps the weld left behind on thin plates.
  return staggeredUnion ? planarizeThinSolidPositions(out) : out;
}

/** Migrate legacy groups so they carry csg metadata without remeshing yet. */
export function migrateShapeCsg(shape: WorkplaneShape): WorkplaneShape {
  const nextChildren = shape.groupedShapes?.map(migrateShapeCsg);
  let next: WorkplaneShape = nextChildren ? { ...shape, groupedShapes: nextChildren } : shape;
  if (!next.groupedShapes?.length) return next;
  if (next.csg?.op) return next;
  const op = inferCsgOp(next);
  if (!op) return next;
  return withCsgMeta(next, op, 1, Boolean(next.importedMesh && op !== "assemble"));
}

export function migrateShapesCsg(shapes: WorkplaneShape[]): WorkplaneShape[] {
  return shapes.map(migrateShapeCsg);
}

/** True when `root` is or contains `leafId` in its CSG child tree. */
export function csgTreeContainsId(root: WorkplaneShape, leafId: string): boolean {
  if (root.id === leafId) return true;
  return (root.groupedShapes ?? []).some((child) => csgTreeContainsId(child, leafId));
}

/**
 * Find the top-level evaluated CSG body in `shapes` that owns `leafId`
 * (as a direct or nested child). Use this when replacing a body in the scene list.
 */
export function findCsgBodyOwningLeaf(
  shapes: readonly WorkplaneShape[],
  leafId: string,
): WorkplaneShape | null {
  for (const shape of shapes) {
    if (!shape.groupedShapes?.length) continue;
    const op = shape.csg?.op ?? inferCsgOp(shape);
    if (!op || op === "assemble") continue;
    if (shape.groupedShapes.some((child) => csgTreeContainsId(child, leafId))) {
      return shape;
    }
  }
  return null;
}

/** Deepest evaluated CSG body that owns `leafId` (for nested remesh). */
export function findNearestCsgBodyOwningLeaf(
  shapes: readonly WorkplaneShape[],
  leafId: string,
): WorkplaneShape | null {
  let best: WorkplaneShape | null = null;
  const visit = (shape: WorkplaneShape) => {
    const op = shape.csg?.op ?? inferCsgOp(shape);
    if (!shape.groupedShapes?.length || !op || op === "assemble") return;
    if (!shape.groupedShapes.some((child) => csgTreeContainsId(child, leafId))) return;
    best = shape;
    shape.groupedShapes.forEach(visit);
  };
  shapes.forEach(visit);
  return best;
}

/** Locate a shape by id anywhere in the document tree (bodies + CSG children). */
export function findShapeInTree(
  shapes: readonly WorkplaneShape[],
  id: string,
): WorkplaneShape | null {
  for (const shape of shapes) {
    if (shape.id === id) return shape;
    const nested = shape.groupedShapes?.length
      ? findShapeInTree(shape.groupedShapes, id)
      : null;
    if (nested) return nested;
  }
  return null;
}

/**
 * Replace a leaf (by id) anywhere in a CSG child tree; marks the body dirty by default.
 *
 * Pass `markDirty: false` when the replacement carries no geometry change — attaching a baked
 * B-Rep, say. Marking those dirty was self-defeating: `dirty` makes the export badge report
 * "pending / CSG needs remesh", so recording the exact solid downgraded how the body described
 * itself, and nothing clears the flag until a rebuild the body does not need.
 */
export function replaceLeafInCsgTree(
  root: WorkplaneShape,
  leafId: string,
  nextLeaf: WorkplaneShape,
  options?: { markDirty?: boolean },
): WorkplaneShape {
  if (root.id === leafId) return nextLeaf;
  if (!root.groupedShapes?.length) return root;
  let changed = false;
  const groupedShapes = root.groupedShapes.map((child) => {
    const replaced = replaceLeafInCsgTree(child, leafId, nextLeaf, options);
    if (replaced !== child) changed = true;
    return replaced;
  });
  if (!changed) return root;
  if (options?.markDirty === false) return { ...root, groupedShapes };
  return bumpCsgVersion({ ...root, groupedShapes });
}

/** First sketch feature (extrude/revolve with sketchDoc) under a body, depth-first. */
export function findSketchFeatureInTree(root: WorkplaneShape): WorkplaneShape | null {
  if (root.sketchDoc || root.sketchProfile) return root;
  for (const child of root.groupedShapes ?? []) {
    const found = findSketchFeatureInTree(child);
    if (found) return found;
  }
  return null;
}

/**
 * Face-hole cut-axis overshoot: enough to clear coplanar skins on thin and thick hosts.
 * Exact profile size in-plane; only the cut axis grows.
 */
export function faceHoleOvershootMm(throughDepth: number): number {
  const depth = Math.max(0, throughDepth);
  return Math.max(0.5, depth * 0.02);
}

/**
 * Full cutter length for a through-all face hole: host thickness plus overshoot past
 * BOTH the sketch face and the far face (avoids coplanar skins and short/offset cuts).
 */
export function faceHoleCutDepthMm(throughDepth: number): number {
  const depth = Math.max(0.5, throughDepth);
  return depth + 2 * faceHoleOvershootMm(depth);
}

/**
 * Cutter length for a blind pocket of `pocketDepth` millimetres.
 * The extra length is entrance overshoot only, so the depth into the part
 * is the number that was typed.
 */
export function faceBlindCutDepthMm(pocketDepth: number): number {
  const depth = Math.max(0.5, pocketDepth);
  const withSkin = depth + 0.5;
  if (faceHoleOvershootMm(withSkin) <= 0.5 + 1e-9) return withSkin;
  return depth / 0.98;
}

/**
 * Face-sketch hole cutter. The typed distance is how far the cut goes into the part.
 * Leaving the part thickness (or typing close enough that a skin would remain) punches
 * through. A shorter number is a blind pocket of that depth.
 */
export function faceSketchHoleCutterMm(typedMm: number, throughThicknessMm: number): number {
  const typed = Math.max(0.5, typedMm);
  const through = Math.max(0.5, throughThicknessMm);
  if (typed + faceHoleOvershootMm(through) >= through - 1e-6) return faceHoleCutDepthMm(through);
  return faceBlindCutDepthMm(typed);
}

/**
 * Reorder a direct child of a CSG body (feature timeline move).
 *
 * This is a listing order only. A node applies its single op to the whole operand set at once —
 * subtract is every solid minus every hole, union and intersect are commutative — so no arrangement
 * of the children can change the evaluated result. It used to mark the body dirty and trigger a full
 * rebuild that could only reproduce the same mesh, at the risk of an exact body coming back faceted
 * if the exact path failed on that run. Genuine order-dependent history needs per-child ops and
 * sequential evaluation, which this tree does not have.
 */
export function reorderCsgChild(
  body: WorkplaneShape,
  childId: string,
  direction: "up" | "down",
): WorkplaneShape {
  const children = body.groupedShapes ?? [];
  const index = children.findIndex((child) => child.id === childId);
  if (index < 0) return body;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= children.length) return body;
  const next = children.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return { ...body, groupedShapes: next };
}

/** Suppress or restore a direct child feature. */
export function setCsgChildSuppressed(
  body: WorkplaneShape,
  childId: string,
  suppressed: boolean,
): WorkplaneShape {
  if (!body.groupedShapes?.length) return body;
  let changed = false;
  const groupedShapes = body.groupedShapes.map((child) => {
    if (child.id !== childId) return child;
    changed = true;
    if (child.csg) {
      return { ...child, suppressed, csg: { ...child.csg, suppressed: suppressed || undefined } };
    }
    return { ...child, suppressed: suppressed || undefined };
  });
  if (!changed) return body;
  return bumpCsgVersion({ ...body, groupedShapes });
}

export function isShapeSuppressed(shape: WorkplaneShape): boolean {
  return Boolean(shape.suppressed || shape.csg?.suppressed);
}

const COPLANAR_EDGE_DOT = 0.99;
const DISPLAY_EDGE_SNAP = 0.08;
/** A display sample this close to a mesh edge is that edge, not a face interior. */
const DISPLAY_EDGE_MATCH = 0.45;
const DISPLAY_EDGE_CELL = 4;
/** Step off an edge, in the face plane, to see whether the face continues on both sides. */
const COPLANAR_SPAN_OFFSET = 0.85;
const COPLANAR_SPAN_TOL = 0.3;

function quantizeDisplayVertex(x: number, y: number, z: number) {
  const q = 1 / DISPLAY_EDGE_SNAP;
  return `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
}

function undirectedDisplayEdgeKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function displayEdgeCell(x: number, y: number, z: number) {
  return `${Math.floor(x / DISPLAY_EDGE_CELL)},${Math.floor(y / DISPLAY_EDGE_CELL)},${Math.floor(z / DISPLAY_EDGE_CELL)}`;
}

function pointSegmentDistanceSq(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  let t = abLenSq > 1e-12 ? ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / abLenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = ax + abx * t - px;
  const dy = ay + aby * t - py;
  const dz = az + abz * t - pz;
  return dx * dx + dy * dy + dz * dz;
}

type MeshEdgeRecord = {
  nx: number;
  ny: number;
  nz: number;
  sharp: boolean;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
};

type DisplayTri = {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
  nx: number;
  ny: number;
  nz: number;
  d: number;
};

function pointOnDisplayTri(px: number, py: number, pz: number, tri: DisplayTri, normalX: number, normalY: number, normalZ: number) {
  if (Math.abs(tri.nx * normalX + tri.ny * normalY + tri.nz * normalZ) < COPLANAR_EDGE_DOT) return false;
  const plane = tri.nx * px + tri.ny * py + tri.nz * pz - tri.d;
  if (Math.abs(plane) > COPLANAR_SPAN_TOL) return false;
  const qx = px - tri.nx * plane;
  const qy = py - tri.ny * plane;
  const qz = pz - tri.nz * plane;
  const v0x = tri.cx - tri.ax;
  const v0y = tri.cy - tri.ay;
  const v0z = tri.cz - tri.az;
  const v1x = tri.bx - tri.ax;
  const v1y = tri.by - tri.ay;
  const v1z = tri.bz - tri.az;
  const v2x = qx - tri.ax;
  const v2y = qy - tri.ay;
  const v2z = qz - tri.az;
  const dot00 = v0x * v0x + v0y * v0y + v0z * v0z;
  const dot01 = v0x * v1x + v0y * v1y + v0z * v1z;
  const dot02 = v0x * v2x + v0y * v2y + v0z * v2z;
  const dot11 = v1x * v1x + v1y * v1y + v1z * v1z;
  const dot12 = v1x * v2x + v1y * v2y + v1z * v2z;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-12) return false;
  const inv = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  if (u >= -1e-4 && v >= -1e-4 && u + v <= 1 + 1e-4) return true;
  const cu = Math.max(0, Math.min(1, u));
  const cv = Math.max(0, Math.min(1 - cu, v));
  const cx = tri.ax + v1x * cv + v0x * cu;
  const cy = tri.ay + v1y * cv + v0y * cu;
  const cz = tri.az + v1z * cv + v0z * cu;
  const dx = cx - qx;
  const dy = cy - qy;
  const dz = cz - qz;
  return dx * dx + dy * dy + dz * dz <= 0.04 * 0.04;
}

/**
 * Drop leftover same-plane splits (the diametric knurl seam, or the part of a
 * cylinder circle that runs across a merged top) while keeping real creases.
 * One CAD edge can be sharp for only part of its length, so the polyline is split.
 */
export function filterCoplanarDisplayEdges(
  edges: Array<{ points: number[] }>,
  meshPositions: ArrayLike<number>,
  meshIndices?: ArrayLike<number>,
): Array<{ points: number[] }> {
  if (edges.length === 0 || meshPositions.length < 9) return edges;

  const records = new Map<string, MeshEdgeRecord>();
  const grid = new Map<string, MeshEdgeRecord[]>();
  const triangles: DisplayTri[] = [];
  const triangleGrid = new Map<string, number[]>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();

  const indexEdge = (record: MeshEdgeRecord) => {
    const length = Math.hypot(record.bx - record.ax, record.by - record.ay, record.bz - record.az);
    const steps = Math.max(1, Math.ceil(length / DISPLAY_EDGE_CELL));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const key = displayEdgeCell(
        record.ax + (record.bx - record.ax) * t,
        record.ay + (record.by - record.ay) * t,
        record.az + (record.bz - record.az) * t,
      );
      const bucket = grid.get(key);
      if (bucket) {
        if (!bucket.includes(record)) bucket.push(record);
      } else {
        grid.set(key, [record]);
      }
    }
  };

  const markTriangle = (ia: number, ib: number, ic: number) => {
    a.fromArray(meshPositions as number[], ia);
    b.fromArray(meshPositions as number[], ib);
    c.fromArray(meshPositions as number[], ic);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.copy(ab).cross(ac);
    if (normal.lengthSq() <= 1e-14) return;
    normal.normalize();
    const triIndex = triangles.length;
    triangles.push({
      ax: a.x, ay: a.y, az: a.z,
      bx: b.x, by: b.y, bz: b.z,
      cx: c.x, cy: c.y, cz: c.z,
      nx: normal.x, ny: normal.y, nz: normal.z,
      d: normal.x * a.x + normal.y * a.y + normal.z * a.z,
    });
    const minX = Math.min(a.x, b.x, c.x);
    const maxX = Math.max(a.x, b.x, c.x);
    const minY = Math.min(a.y, b.y, c.y);
    const maxY = Math.max(a.y, b.y, c.y);
    const minZ = Math.min(a.z, b.z, c.z);
    const maxZ = Math.max(a.z, b.z, c.z);
    for (let ix = Math.floor(minX / DISPLAY_EDGE_CELL); ix <= Math.floor(maxX / DISPLAY_EDGE_CELL); ix += 1) {
      for (let iy = Math.floor(minY / DISPLAY_EDGE_CELL); iy <= Math.floor(maxY / DISPLAY_EDGE_CELL); iy += 1) {
        for (let iz = Math.floor(minZ / DISPLAY_EDGE_CELL); iz <= Math.floor(maxZ / DISPLAY_EDGE_CELL); iz += 1) {
          const key = `${ix},${iy},${iz}`;
          const bucket = triangleGrid.get(key);
          if (bucket) bucket.push(triIndex);
          else triangleGrid.set(key, [triIndex]);
        }
      }
    }
    const corners = [
      { x: a.x, y: a.y, z: a.z },
      { x: b.x, y: b.y, z: b.z },
      { x: c.x, y: c.y, z: c.z },
    ];
    const keys = corners.map((corner) => quantizeDisplayVertex(corner.x, corner.y, corner.z));
    for (let i = 0; i < 3; i += 1) {
      const edgeKey = undirectedDisplayEdgeKey(keys[i], keys[(i + 1) % 3]);
      const prev = records.get(edgeKey);
      if (!prev) {
        const start = corners[i];
        const end = corners[(i + 1) % 3];
        const record = {
          nx: normal.x,
          ny: normal.y,
          nz: normal.z,
          sharp: false,
          ax: start.x,
          ay: start.y,
          az: start.z,
          bx: end.x,
          by: end.y,
          bz: end.z,
        };
        records.set(edgeKey, record);
        indexEdge(record);
        continue;
      }
      const dot = Math.abs(prev.nx * normal.x + prev.ny * normal.y + prev.nz * normal.z);
      if (dot < COPLANAR_EDGE_DOT) prev.sharp = true;
    }
  };

  if (meshIndices && meshIndices.length >= 3) {
    for (let i = 0; i + 2 < meshIndices.length; i += 3) {
      markTriangle(meshIndices[i] * 3, meshIndices[i + 1] * 3, meshIndices[i + 2] * 3);
    }
  } else {
    for (let i = 0; i + 8 < meshPositions.length; i += 9) {
      markTriangle(i, i + 3, i + 6);
    }
  }

  const matchLimitSq = DISPLAY_EDGE_MATCH * DISPLAY_EDGE_MATCH;
  const segmentIsSharp = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const mz = (z0 + z1) / 2;
    const cx = Math.floor(mx / DISPLAY_EDGE_CELL);
    const cy = Math.floor(my / DISPLAY_EDGE_CELL);
    const cz = Math.floor(mz / DISPLAY_EDGE_CELL);
    let best = Number.POSITIVE_INFINITY;
    let sharp = false;
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          const bucket = grid.get(`${cx + ox},${cy + oy},${cz + oz}`);
          if (!bucket) continue;
          for (const record of bucket) {
            const distanceSq = pointSegmentDistanceSq(mx, my, mz, record.ax, record.ay, record.az, record.bx, record.by, record.bz);
            if (distanceSq < best) {
              best = distanceSq;
              sharp = record.sharp;
            }
          }
        }
      }
    }
    return best <= matchLimitSq && sharp;
  };

  const onFace = (px: number, py: number, pz: number, nx: number, ny: number, nz: number) => {
    const cx = Math.floor(px / DISPLAY_EDGE_CELL);
    const cy = Math.floor(py / DISPLAY_EDGE_CELL);
    const cz = Math.floor(pz / DISPLAY_EDGE_CELL);
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          const bucket = triangleGrid.get(`${cx + ox},${cy + oy},${cz + oz}`);
          if (!bucket) continue;
          for (const index of bucket) {
            if (pointOnDisplayTri(px, py, pz, triangles[index], nx, ny, nz)) return true;
          }
        }
      }
    }
    return false;
  };

  // A union keeps the cylinder's original circle as one edge. The stretch that
  // runs across the box top has the same flat face on both sides, which is the
  // line other CAD programs delete. A real rim has air, or a different face, on one side.
  const segmentCrossesOpenFace = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const mz = (z0 + z1) / 2;
    const tx = x1 - x0;
    const ty = y1 - y0;
    const tz = z1 - z0;
    const cx = Math.floor(mx / DISPLAY_EDGE_CELL);
    const cy = Math.floor(my / DISPLAY_EDGE_CELL);
    const cz = Math.floor(mz / DISPLAY_EDGE_CELL);
    const seen: Array<[number, number, number]> = [];
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          const bucket = triangleGrid.get(`${cx + ox},${cy + oy},${cz + oz}`);
          if (!bucket) continue;
          for (const index of bucket) {
            const tri = triangles[index];
            if (Math.abs(tri.nx * mx + tri.ny * my + tri.nz * mz - tri.d) > COPLANAR_SPAN_TOL) continue;
            if (seen.some(([nx, ny, nz]) => Math.abs(nx * tri.nx + ny * tri.ny + nz * tri.nz) >= COPLANAR_EDGE_DOT)) continue;
            seen.push([tri.nx, tri.ny, tri.nz]);
            const px = tri.ny * tz - tri.nz * ty;
            const py = tri.nz * tx - tri.nx * tz;
            const pz = tri.nx * ty - tri.ny * tx;
            const plen = Math.hypot(px, py, pz);
            if (plen < 1e-8) continue;
            const scale = COPLANAR_SPAN_OFFSET / plen;
            const oxp = px * scale;
            const oyp = py * scale;
            const ozp = pz * scale;
            if (
              onFace(mx + oxp, my + oyp, mz + ozp, tri.nx, tri.ny, tri.nz)
              && onFace(mx - oxp, my - oyp, mz - ozp, tri.nx, tri.ny, tri.nz)
            ) return true;
          }
        }
      }
    }
    return false;
  };

  const kept: Array<{ points: number[] }> = [];
  for (const edge of edges) {
    if (edge.points.length < 6) continue;
    let run: number[] | null = null;
    const segments = Math.floor(edge.points.length / 3) - 1;
    const finish = () => {
      if (run && run.length >= 6) {
        const unchanged = run.length === edge.points.length && run.every((value, index) => value === edge.points[index]);
        kept.push(unchanged ? edge : { points: run });
      }
      run = null;
    };
    for (let i = 0; i < segments; i += 1) {
      const x0 = edge.points[i * 3];
      const y0 = edge.points[i * 3 + 1];
      const z0 = edge.points[i * 3 + 2];
      const x1 = edge.points[i * 3 + 3];
      const y1 = edge.points[i * 3 + 4];
      const z1 = edge.points[i * 3 + 5];
      if (Math.hypot(x1 - x0, y1 - y0, z1 - z0) < 1e-6) continue;
      if (segmentIsSharp(x0, y0, z0, x1, y1, z1) && !segmentCrossesOpenFace(x0, y0, z0, x1, y1, z1)) {
        if (!run) run = [x0, y0, z0];
        run.push(x1, y1, z1);
      } else {
        finish();
      }
    }
    finish();
  }
  return kept;
}

/**
 * Push Pull / fillet previews are triangle soups. Matching kernel outlines to
 * those unique-vertex triangles often marks every crease as unsharp, so the
 * viewport would drop the CAD edges and draw every mesh diagonal instead.
 * Keep the kernel outlines when the filter cannot prove a crease.
 */
export function viewportCadDisplayEdges(
  edges: Array<{ points: number[] }> | undefined,
  meshPositions?: ArrayLike<number>,
  meshIndices?: ArrayLike<number>,
) {
  if (!edges?.length) return [];
  if (!meshPositions || meshPositions.length < 9) return edges;
  const filtered = filterCoplanarDisplayEdges(edges, meshPositions, meshIndices);
  return filtered.length > 0 ? filtered : edges;
}
