import type { Brep, BrepSolid } from "@/lib/brepKernel";
import { loadBrepWithOcct } from "@/lib/brepKernel";
import { faceHoleOvershootMm } from "@/lib/csgTree";
import { pathContains } from "@/lib/sketchBrep";
import { curveStandInOwner } from "@/lib/sketch/migrate";
import { materialOutlines, type OrderedSketchPath } from "@/lib/sketch/profiles";
import type { SketchDoc } from "@/lib/sketch/types";
import { circleFromClosedPath } from "@/lib/sketchProfileShape";
import { isFaceHostedSketch, resolveSketchPlane, sketchPlaneVAxis } from "@/lib/sketchPlane";
import { isCylinderSketchPlane } from "@/lib/sketchCylinder";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { SketchPlane, WorkplaneShape } from "@/types/sketchforge";

type Xz = { x: number; z: number };

/**
 * Replace a sketch extrusion's triangle mesh with the tessellation of one exact solid.
 * Fillet and chamfer already prefer `cadBrep`, so the click rounds that solid.
 * Circles and arcs stay circles and arcs. Bezier spans stay cubic curves.
 */
export async function withExactSketchExtrusionSolid(
  shape: WorkplaneShape,
  distance: number,
  options?: { cutIntoFace?: boolean },
): Promise<WorkplaneShape> {
  if (shape.kind !== "mesh" || shape.sketchFinish !== "extrude" || !shape.sketchProfile) return shape;
  if (shape.edgeTreatments?.length || shape.cadBrep) return shape;
  const plane = resolveSketchPlane(shape.sketchPlane ?? shape.sketchProfile.sketchPlane);
  if (isCylinderSketchPlane(plane)) return shape;
  const paths = materialOutlines(shape.sketchProfile);
  if (paths.length === 0) return shape;
  const safeDistance = Math.max(0.05, distance);
  const cutIntoFace = options?.cutIntoFace ?? Boolean(
    shape.hole && isFaceHostedSketch(plane, shape.sketchProfile.faceReferenceLoops),
  );

  try {
    const brep = await loadBrepWithOcct();
    const solid = buildExactExtrusion(brep, paths, shape.sketchDoc, plane, safeDistance, cutIntoFace);
    if (!solid || !brep.isValid(solid as never)) return shape;
    const exported = brep.toBREP(solid as never);
    if (!exported.ok || !exported.value.trim()) return shape;
    const meshed = brep.mesh(solid as never, { tolerance: 0.12, angularTolerance: 0.28 });
    const placed = meshInLocalFrame(meshed.vertices, meshed.normals, meshed.triangles);
    if (!placed) return shape;
    return canonicalizeShape({
      ...shape,
      x: placed.centerX,
      z: placed.centerZ,
      elevation: placed.elevation,
      width: placed.width,
      depth: placed.depth,
      height: placed.height,
      size: Math.max(placed.width, placed.depth),
      importedMesh: {
        positions: placed.positions,
        normals: placed.normals,
        indices: placed.indices,
        baseWidth: placed.width,
        baseDepth: placed.depth,
        baseHeight: placed.height,
        triangleCount: Math.floor(placed.indices.length / 3),
        sourceFormat: "json",
      },
      cadBrep: exported.value,
      cadBrepFrame: {
        x: placed.centerX,
        z: placed.centerZ,
        elevation: placed.elevation,
        width: placed.width,
        depth: placed.depth,
        height: placed.height,
      },
    });
  } catch {
    return shape;
  }
}

function buildExactExtrusion(
  brep: Brep,
  paths: OrderedSketchPath[],
  doc: SketchDoc | undefined,
  plane: SketchPlane,
  distance: number,
  cutIntoFace: boolean,
): BrepSolid | null {
  const sorted = [...paths].sort((a, b) => pathArea(b) - pathArea(a));
  let drawing = drawingFromPath(brep, sorted[0], doc);
  if (!drawing) return null;
  for (let index = 1; index < sorted.length; index += 1) {
    const loop = drawingFromPath(brep, sorted[index], doc);
    if (!loop) continue;
    const outer = { points: sorted[index].points.map((point) => ({ x: point.x, z: point.z })) };
    let depth = 0;
    for (let previous = 0; previous < index; previous += 1) {
      if (pathContains({ points: sorted[previous].points }, outer)) depth += 1;
    }
    drawing = depth % 2 === 1 ? brep.drawingCut(drawing, loop) : brep.drawingFuse(drawing, loop);
  }

  const origin = plane.origin;
  const normal = plane.normal;
  const uAxis = plane.uAxis;
  const vAxis = sketchPlaneVAxis(plane);
  const occtPlane = brep.createPlane(
    [origin.x, origin.y, origin.z],
    [uAxis.x, uAxis.y, uAxis.z],
    [normal.x, normal.y, normal.z],
  );
  const sketch = brep.drawingToSketchOnPlane(drawing as never, {
    origin: occtPlane.origin,
    xDir: occtPlane.xDir,
    yDir: [vAxis.x, vAxis.y, vAxis.z],
    zDir: occtPlane.zDir,
  } as never);
  let solid = brep.sketchExtrude(sketch as never, distance, {
    extrusionDirection: [normal.x, normal.y, normal.z],
  }) as unknown as BrepSolid;
  if (cutIntoFace) {
    const overshoot = faceHoleOvershootMm(distance);
    const pull = Math.max(0, distance - overshoot);
    solid = brep.translate(solid, [-normal.x * pull, -normal.y * pull, -normal.z * pull]);
  }
  return solid;
}

function drawingFromPath(brep: Brep, path: OrderedSketchPath, doc: SketchDoc | undefined) {
  const circleOwner = soleCurve(path);
  const circle = circleOwner ? circleGeometry(doc, circleOwner) : null;
  if (circle) return brep.drawSingleCircle(circle.radius).translate(circle.cx, circle.cz);
  const sampled = circleFromClosedPath(path);
  if (sampled) return brep.drawSingleCircle(sampled.radius).translate(sampled.centerX, sampled.centerZ);
  if (path.steps.length < 3 && path.points.length < 3) return null;

  const start = path.steps[0]?.from ?? path.points[0];
  if (!start) return null;
  let pen = brep.draw([start.x, start.z]);
  for (let index = 0; index < path.steps.length; index += 1) {
    const step = path.steps[index];
    const owner = curveStandInOwner(step.segment.id);
    const arc = owner ? arcGeometry(doc, owner) : null;
    if (arc) {
      let end = step.to;
      while (
        index + 1 < path.steps.length
        && curveStandInOwner(path.steps[index + 1].segment.id) === owner
      ) {
        index += 1;
        end = path.steps[index].to;
      }
      const fromEntityStart = Math.hypot(step.from.x - arc.start.x, step.from.z - arc.start.z)
        <= Math.hypot(step.from.x - arc.end.x, step.from.z - arc.end.z);
      const mid = arcMidpoint(arc.center, step.from, end, fromEntityStart ? arc.ccw : !arc.ccw);
      pen = pen.threePointsArcTo([end.x, end.z], [mid.x, mid.z]);
      continue;
    }
    const forward = step.segment.startId === step.from.id;
    const raw1 = forward ? step.from.handleOut : step.from.handleIn;
    const raw2 = forward ? step.to.handleIn : step.to.handleOut;
    const end: [number, number] = [step.to.x, step.to.z];
    if (step.segment.kind && step.segment.kind !== "line" && (raw1 || raw2)) {
      const c1 = raw1 ?? step.from;
      const c2 = raw2 ?? step.to;
      pen = pen.cubicBezierCurveTo(end, [c1.x, c1.z], [c2.x, c2.z]);
    } else {
      pen = pen.lineTo(end);
    }
  }
  return pen.close();
}

function soleCurve(path: OrderedSketchPath): string | null {
  let owner: string | null = null;
  for (const step of path.steps) {
    const next = curveStandInOwner(step.segment.id);
    if (!next) return null;
    if (owner && owner !== next) return null;
    owner = next;
  }
  return owner;
}

function circleGeometry(doc: SketchDoc | undefined, id: string): { cx: number; cz: number; radius: number } | null {
  const entity = doc?.entities.find((entry) => entry.id === id);
  if (!entity || entity.kind !== "circle") return null;
  const center = doc?.entities.find((entry) => entry.id === entity.centerId && entry.kind === "point");
  if (!center || center.kind !== "point" || !(entity.radius > 0)) return null;
  return { cx: center.x, cz: center.z, radius: entity.radius };
}

function arcGeometry(
  doc: SketchDoc | undefined,
  id: string,
): { center: Xz; start: Xz; end: Xz; ccw: boolean } | null {
  const entity = doc?.entities.find((entry) => entry.id === id);
  if (!entity || entity.kind !== "arc" || !doc) return null;
  const center = doc.entities.find((entry) => entry.id === entity.centerId && entry.kind === "point");
  const start = doc.entities.find((entry) => entry.id === entity.startId && entry.kind === "point");
  const end = doc.entities.find((entry) => entry.id === entity.endId && entry.kind === "point");
  if (!center || center.kind !== "point" || !start || start.kind !== "point" || !end || end.kind !== "point") return null;
  return {
    center: { x: center.x, z: center.z },
    start: { x: start.x, z: start.z },
    end: { x: end.x, z: end.z },
    ccw: entity.ccw !== false,
  };
}

function arcMidpoint(center: Xz, start: Xz, end: Xz, ccw: boolean): Xz {
  let a0 = Math.atan2(start.z - center.z, start.x - center.x);
  let a1 = Math.atan2(end.z - center.z, end.x - center.x);
  if (ccw && a1 <= a0) a1 += Math.PI * 2;
  if (!ccw && a0 <= a1) a0 += Math.PI * 2;
  const angle = (a0 + a1) / 2;
  const radius = Math.hypot(start.x - center.x, start.z - center.z);
  return {
    x: center.x + Math.cos(angle) * radius,
    z: center.z + Math.sin(angle) * radius,
  };
}

function pathArea(path: OrderedSketchPath) {
  const points = path.points;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) * 0.5;
}

function meshInLocalFrame(vertices: Float32Array, normals: Float32Array, triangles: Uint32Array) {
  if (vertices.length < 9 || triangles.length < 3) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index + 2 < vertices.length; index += 3) {
    minX = Math.min(minX, vertices[index]);
    maxX = Math.max(maxX, vertices[index]);
    minY = Math.min(minY, vertices[index + 1]);
    maxY = Math.max(maxY, vertices[index + 1]);
    minZ = Math.min(minZ, vertices[index + 2]);
    maxZ = Math.max(maxZ, vertices[index + 2]);
  }
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return null;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const elevation = minY;
  const width = Math.max(0.01, maxX - minX);
  const depth = Math.max(0.01, maxZ - minZ);
  const height = Math.max(0.01, maxY - minY);
  const positions: number[] = [];
  for (let index = 0; index + 2 < vertices.length; index += 3) {
    positions.push(vertices[index] - centerX, vertices[index + 1] - elevation, vertices[index + 2] - centerZ);
  }
  const normalList = normals.length === vertices.length ? Array.from(normals) : undefined;
  return {
    centerX,
    centerZ,
    elevation,
    width,
    depth,
    height,
    positions,
    normals: normalList,
    indices: Array.from(triangles),
  };
}
