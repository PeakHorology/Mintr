import * as THREE from "three";
import type { CadPrimitiveFrame, WorkplaneShape } from "@/types/sketchforge";
import type { CadModifierPrimitivePart } from "@/lib/cadModifierTypes";
import { gearPlanLoops, normalizeGearSpec, rackPlanLoop } from "@/lib/gearProfile";
import { roofAnglesFromProfile } from "@/lib/roofGeometry";
import { NATIVE_EXACT_KINDS } from "@/lib/shapeBrep";
import { shapeYawDegrees } from "@/lib/shapeBounds";
import { coneBaseRadius, coneMaxRadius, coneTopRadius, mirrorSign, preservesEdgeTreatmentSize, resizedImportedCoordinates, shapeDepth, shapeWidth } from "@/lib/workplaneShapes";

export type BakedCadMetadataFrame = {
  centerX: number;
  minY: number;
  centerZ: number;
  width: number;
  depth: number;
  height: number;
  yawDegrees: number;
};

export function cadTransformToMatrix(transform: number[] | undefined) {
  if (!transform || transform.length !== 12 || !transform.every(Number.isFinite)) {
    return new THREE.Matrix4();
  }

  return new THREE.Matrix4().set(
    transform[0], transform[1], transform[2], transform[3],
    transform[4], transform[5], transform[6], transform[7],
    transform[8], transform[9], transform[10], transform[11],
    0, 0, 0, 1,
  );
}

export function cadTransformFromMatrix(matrix: THREE.Matrix4) {
  const elements = matrix.elements;
  return [
    elements[0], elements[4], elements[8], elements[12],
    elements[1], elements[5], elements[9], elements[13],
    elements[2], elements[6], elements[10], elements[14],
  ];
}

function isIdentityCadTransform(transform: number[]) {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  return transform.every((value, index) => Math.abs(value - identity[index]) < 1e-9);
}

function allFinitePositive(values: number[]) {
  return values.every((value) => Number.isFinite(value) && value > 0);
}

function analyticPrimitiveTransform(shape: WorkplaneShape, height: number, yawDegrees: number) {
  const centerY = height / 2;
  const matrix = new THREE.Matrix4()
    .makeTranslation(shape.x, (shape.elevation ?? 0) + centerY, shape.z)
    .multiply(new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(shape.rotationX ?? 0),
        THREE.MathUtils.degToRad(yawDegrees),
        THREE.MathUtils.degToRad(shape.rotationZ ?? 0),
        "XYZ",
      ),
    ))
    .multiply(new THREE.Matrix4().makeScale(mirrorSign(shape.mirrorX), mirrorSign(shape.mirrorY), mirrorSign(shape.mirrorZ)))
    .multiply(new THREE.Matrix4().makeTranslation(0, -centerY, 0));
  return cadTransformFromMatrix(matrix);
}

export function cadModifierPrimitiveForAnalyticBox(shape: WorkplaneShape): CadModifierPrimitivePart | null {
  // A display mesh on a box is only a cache. Fillet needs the exact box, not that soup.
  if (shape.kind !== "box" || shape.groupedShapes?.length) {
    return null;
  }

  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const height = shape.height;
  if (!allFinitePositive([width, depth, height])) {
    return null;
  }

  const transform = analyticPrimitiveTransform(shape, height, shape.rotation ?? 0);
  return {
    kind: "box",
    width,
    depth,
    height,
    transform: isIdentityCadTransform(transform) ? undefined : transform,
  };
}

/** Circular native cylinders as exact OCCT solids so Thread can find cylindrical faces. */
export function cadModifierPrimitiveForAnalyticCylinder(shape: WorkplaneShape): CadModifierPrimitivePart | null {
  if (shape.kind !== "cylinder" || shape.groupedShapes?.length || shape.cadBrep || shape.importedMesh) {
    return null;
  }

  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const height = shape.height;
  if (!allFinitePositive([width, depth, height])) {
    return null;
  }
  const elliptical = Math.abs(width - depth) >= 1e-4;
  // Circular cylinders are invariant about yaw; an ellipse has to keep it.
  const transform = analyticPrimitiveTransform(shape, height, elliptical ? (shape.rotation ?? 0) : 0);
  const bakedTransform = isIdentityCadTransform(transform) ? undefined : transform;
  if (!elliptical) {
    return {
      kind: "cylinder",
      radius: width / 2,
      height,
      transform: bakedTransform,
    };
  }
  return {
    kind: "cylinder",
    width,
    depth,
    height,
    transform: bakedTransform,
  };
}

/**
 * Native cones as exact OCCT solids. A display cone is a 128-sided mesh, and
 * filleting that ring of short lines fails. `makeCone` keeps each rim as one
 * circle. An elliptical footprint scales that circle after the cone is built.
 */
/** Regular extruded polygons as exact OCCT solids so Push Pull matches CAD ready. */
export function cadModifierPrimitiveForAnalyticPolygon(shape: WorkplaneShape): CadModifierPrimitivePart | null {
  if (shape.kind !== "polygon" || shape.groupedShapes?.length || shape.cadBrep || shape.importedMesh) {
    return null;
  }

  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const height = shape.height;
  if (!allFinitePositive([width, depth, height])) {
    return null;
  }

  const sides = Math.max(3, Math.round(shape.sides ?? 6));
  const transform = analyticPrimitiveTransform(shape, height, shape.rotation ?? 0);
  return {
    kind: "polygon",
    sides,
    width,
    depth,
    height,
    transform: isIdentityCadTransform(transform) ? undefined : transform,
  };
}

const EXACT_PUSH_PULL_KINDS = new Set<WorkplaneShape["kind"]>([
  "sphere",
  "pyramid",
  "wedge",
  "roof",
  "roundRoof",
  "halfSphere",
  "torus",
  "tube",
  "ring",
  "gear",
]);

/**
 * Remaining CAD-ready kinds the native kernel already knows how to rebuild.
 * Box, circular cylinder, cone, and polygon have dedicated encoders above.
 */
export function cadModifierPrimitiveForExactKind(shape: WorkplaneShape): CadModifierPrimitivePart | null {
  if (!EXACT_PUSH_PULL_KINDS.has(shape.kind) || !NATIVE_EXACT_KINDS.has(shape.kind)) {
    return null;
  }
  if (shape.groupedShapes?.length || shape.cadBrep || shape.importedMesh) {
    return null;
  }

  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const height = shape.height;
  if (!allFinitePositive([width, depth, height])) {
    return null;
  }

  const transform = analyticPrimitiveTransform(shape, height, shape.rotation ?? 0);
  const bakedTransform = isIdentityCadTransform(transform) ? undefined : transform;
  const base = {
    width,
    depth,
    height,
    transform: bakedTransform,
  };

  if (shape.kind === "gear") {
    const spec = normalizeGearSpec(shape.gearSpec);
    if (spec.form === "rack") {
      return {
        kind: "gear",
        ...base,
        profileLoops: { outer: rackPlanLoop(spec, depth).map((point) => [point.x, point.z] as [number, number]), holes: [] },
      };
    }
    const loops = gearPlanLoops(spec);
    return {
      kind: "gear",
      ...base,
      profileLoops: {
        outer: loops.outer.map((point) => [point.x, point.z] as [number, number]),
        holes: loops.holes.map((hole) => hole.map((point) => [point.x, point.z] as [number, number])),
      },
    };
  }

  if (shape.kind === "roof" || shape.kind === "wedge") {
    return {
      kind: shape.kind,
      ...base,
      ridgeX: roofAnglesFromProfile(width, height, shape.leftAngle, shape.rightAngle).ridgeX,
    };
  }

  if (shape.kind === "pyramid") {
    return {
      kind: "pyramid",
      ...base,
      sides: Math.max(3, Math.round(shape.sides ?? 4)),
    };
  }

  if (shape.kind === "torus") {
    return {
      kind: "torus",
      ...base,
      radius: shape.radius,
    };
  }

  if (shape.kind === "tube" || shape.kind === "ring") {
    return {
      kind: shape.kind,
      ...base,
      bevel: shape.bevel,
    };
  }

  return {
    // EXACT_PUSH_PULL_KINDS.has() does not narrow the union for the compiler.
    kind: shape.kind as "sphere" | "pyramid" | "wedge" | "roof" | "roundRoof" | "halfSphere" | "torus" | "tube" | "ring" | "gear",
    ...base,
  };
}

export function cadModifierPrimitiveForAnalyticCone(shape: WorkplaneShape): CadModifierPrimitivePart | null {
  if (shape.kind !== "cone" || shape.groupedShapes?.length || shape.cadBrep || shape.importedMesh) {
    return null;
  }

  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const height = shape.height;
  if (!allFinitePositive([width, depth, height])) {
    return null;
  }

  const maxRadius = Math.max(coneMaxRadius(shape), 1e-6);
  const baseRadius = Math.max(0, coneBaseRadius(shape) * (width / 2) / maxRadius);
  const topRadius = Math.max(0, coneTopRadius(shape) * (width / 2) / maxRadius);
  if (baseRadius <= 1e-6 && topRadius <= 1e-6) {
    return null;
  }

  const elliptical = Math.abs(width - depth) >= 1e-4;
  // A circular cone is invariant about yaw. An ellipse has to keep it.
  // The stretch stays off this matrix so a fillet can blend the circle first.
  const transform = analyticPrimitiveTransform(shape, height, elliptical ? (shape.rotation ?? 0) : 0);
  const sectionScale = elliptical ? depth / width : undefined;
  return {
    kind: "cone",
    baseRadius,
    topRadius,
    height,
    transform: isIdentityCadTransform(transform) ? undefined : transform,
    ...(sectionScale ? { sectionScale } : {}),
  };
}

export function cadModifierPrimitiveForBakedShape(shape: WorkplaneShape): CadModifierPrimitivePart | null {
  const primitive = shape.cadPrimitiveFrame;
  const frame = primitive?.frame;
  if (!primitive || !frame) {
    return null;
  }

  if (!allFinitePositive([
    primitive.width,
    primitive.depth,
    primitive.height,
    frame.width,
    frame.depth,
    frame.height,
    shapeWidth(shape),
    shapeDepth(shape),
    shape.height,
  ])) {
    return null;
  }

  const centerY = shape.height / 2;
  const scaleX = shapeWidth(shape) / frame.width;
  const scaleY = shape.height / frame.height;
  const scaleZ = shapeDepth(shape) / frame.depth;
  // A cylinder scaled unevenly across its axes is an ellipse, which no exact cylinder can stand in
  // for. Reporting it as one would put the wrong geometry in the STEP file.
  if (primitive.kind === "cylinder" && Math.abs(scaleX - scaleZ) >= 1e-4) {
    return null;
  }
  const mirrorX = mirrorSign(shape.mirrorX);
  const mirrorY = mirrorSign(shape.mirrorY);
  const mirrorZ = mirrorSign(shape.mirrorZ);
  const matrix = new THREE.Matrix4()
    .makeTranslation(shape.x, (shape.elevation ?? 0) + centerY, shape.z)
    .multiply(new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(shape.rotationX ?? 0),
        THREE.MathUtils.degToRad(shape.rotation ?? 0),
        THREE.MathUtils.degToRad(shape.rotationZ ?? 0),
        "XYZ",
      ),
    ))
    .multiply(new THREE.Matrix4().makeTranslation(0, -mirrorY * centerY, 0))
    .multiply(new THREE.Matrix4().makeScale(mirrorX * scaleX, mirrorY * scaleY, mirrorZ * scaleZ))
    .multiply(new THREE.Matrix4().makeTranslation(-frame.x, -frame.elevation, -frame.z))
    .multiply(cadTransformToMatrix(frame.sourceTransform));

  const transform = cadTransformFromMatrix(matrix);
  const bakedTransform = isIdentityCadTransform(transform) ? undefined : transform;
  if (primitive.kind === "cylinder") {
    return {
      kind: "cylinder",
      radius: primitive.width / 2,
      height: primitive.height,
      transform: bakedTransform,
    };
  }
  return {
    kind: "box",
    width: primitive.width,
    depth: primitive.depth,
    height: primitive.height,
    transform: bakedTransform,
  };
}

/**
 * A resized fillet can keep its chamfer width by stretching only the middle of the
 * display mesh. That stretch is not a scale of the exact solid, so the mesh is the
 * source until the size matches the stored body again.
 */
function preserveResizeBlocksExactSolid(shape: WorkplaneShape) {
  if (!preservesEdgeTreatmentSize(shape)) return false;
  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const height = shape.height;
  const frame = shape.cadBrepFrame;
  if (frame) {
    return Math.abs(width - frame.width) > 1e-6
      || Math.abs(depth - frame.depth) > 1e-6
      || Math.abs(height - frame.height) > 1e-6;
  }
  const mesh = shape.importedMesh;
  if (!mesh) return false;
  return Math.abs(width - mesh.baseWidth) > 1e-6
    || Math.abs(depth - mesh.baseDepth) > 1e-6
    || Math.abs(height - mesh.baseHeight) > 1e-6;
}

/** Local imported solid (STEP or display mesh) into the shape's current world pose. */
export function importedSolidWorldTransform(shape: WorkplaneShape) {
  const mesh = shape.importedMesh;
  if (!mesh) return undefined;
  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const height = shape.height;
  const scaleX = width / Math.max(0.001, mesh.baseWidth || width);
  const scaleY = height / Math.max(0.001, mesh.baseHeight || height);
  const scaleZ = depth / Math.max(0.001, mesh.baseDepth || depth);
  const centerY = height / 2;
  const matrix = new THREE.Matrix4()
    .makeTranslation(shape.x, (shape.elevation ?? 0) + centerY, shape.z)
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(shape.rotationX ?? 0),
      THREE.MathUtils.degToRad(shapeYawDegrees(shape)),
      THREE.MathUtils.degToRad(shape.rotationZ ?? 0),
      "XYZ",
    )))
    .multiply(new THREE.Matrix4().makeScale(mirrorSign(shape.mirrorX), mirrorSign(shape.mirrorY), mirrorSign(shape.mirrorZ)))
    .multiply(new THREE.Matrix4().makeTranslation(0, -centerY, 0))
    .multiply(new THREE.Matrix4().makeScale(scaleX, scaleY, scaleZ));
  const transform = cadTransformFromMatrix(matrix);
  return isIdentityCadTransform(transform) ? undefined : transform;
}

/**
 * Exact solid for the next fillet, chamfer, or Group. The on-screen triangles are
 * only a picture of this body. Sewing those triangles back in is what makes each
 * later edit denser than the last.
 */
export function exactModifierBrep(shape: WorkplaneShape): { brep: string; brepTransform?: number[] } | { brepStep: string; brepTransform?: number[] } | null {
  if (preserveResizeBlocksExactSolid(shape)) return null;
  const frame = shape.cadBrepFrame;
  if (shape.cadBrep && frame) {
    return { brep: shape.cadBrep, brepTransform: cadBrepTransformForShape(shape) };
  }
  const brepStep = shape.importedMesh?.brepStep;
  if (brepStep) {
    const brepTransform = importedSolidWorldTransform(shape);
    return brepTransform ? { brepStep, brepTransform } : { brepStep };
  }
  return null;
}

export function cadBrepTransformForShape(shape: WorkplaneShape) {
  const frame = shape.cadBrepFrame;
  if (!frame) return undefined;
  const oldCenter = new THREE.Vector3(frame.x, frame.elevation + frame.height / 2, frame.z);
  const currentCenter = new THREE.Vector3(shape.x, (shape.elevation ?? 0) + shape.height / 2, shape.z);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(shape.rotationX ?? 0),
    THREE.MathUtils.degToRad(shape.rotation ?? 0),
    THREE.MathUtils.degToRad(shape.rotationZ ?? 0),
    "XYZ",
  ));
  const scale = new THREE.Vector3(
    shapeWidth(shape) / Math.max(0.001, frame.width) * mirrorSign(shape.mirrorX),
    shape.height / Math.max(0.001, frame.height) * mirrorSign(shape.mirrorY),
    shapeDepth(shape) / Math.max(0.001, frame.depth) * mirrorSign(shape.mirrorZ),
  );
  const matrix = new THREE.Matrix4()
    .compose(currentCenter, rotation, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-oldCenter.x, -oldCenter.y, -oldCenter.z))
    .multiply(cadTransformToMatrix(frame.sourceTransform));
  const result = cadTransformFromMatrix(matrix);
  return isIdentityCadTransform(result) ? undefined : result;
}

function bakeCadDisplayEdgesForShape(shape: WorkplaneShape, frame: BakedCadMetadataFrame) {
  if (!shape.cadDisplayEdges?.length) {
    return undefined;
  }

  const centerY = shape.height / 2;
  const matrix = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(shape.rotationX ?? 0),
      THREE.MathUtils.degToRad(frame.yawDegrees),
      THREE.MathUtils.degToRad(shape.rotationZ ?? 0),
      "XYZ",
    ),
  );
  const xMirror = mirrorSign(shape.mirrorX);
  const yMirror = mirrorSign(shape.mirrorY);
  const zMirror = mirrorSign(shape.mirrorZ);
  const bakedEdges = shape.cadDisplayEdges.flatMap((edge) => {
    if (edge.points.length < 6) {
      return [];
    }

    const resizedPoints = resizedImportedCoordinates(shape, edge.points);
    const points: number[] = [];
    for (let index = 0; index + 2 < resizedPoints.length; index += 3) {
      const vertex = new THREE.Vector3(
        resizedPoints[index] * xMirror,
        (resizedPoints[index + 1] - centerY) * yMirror,
        resizedPoints[index + 2] * zMirror,
      ).applyMatrix4(matrix);
      const x = vertex.x + shape.x - frame.centerX;
      const y = vertex.y + (shape.elevation ?? 0) + centerY - frame.minY;
      const z = vertex.z + shape.z - frame.centerZ;
      if ([x, y, z].every(Number.isFinite)) {
        points.push(x, y, z);
      }
    }

    return points.length >= 6 ? [{ points }] : [];
  });

  return bakedEdges.length > 0 ? bakedEdges : undefined;
}

function bakeCadPrimitiveFrameForShapeTransform(shape: WorkplaneShape, frame: BakedCadMetadataFrame): CadPrimitiveFrame | undefined {
  // Cylinders were left out here, so baking a transform silently cost a cylinder its exact identity
  // and it exported faceted while an equivalent box stayed exact. A cone needs two radii, which
  // this frame cannot store, so it stays out and the live cone path keeps the exact solid.
  const primitive = cadModifierPrimitiveForBakedShape(shape)
    ?? cadModifierPrimitiveForAnalyticBox(shape)
    ?? cadModifierPrimitiveForAnalyticCylinder(shape);
  if (!primitive || (primitive.kind !== "box" && primitive.kind !== "cylinder")) {
    return undefined;
  }
  if (primitive.kind === "cylinder" && !(typeof primitive.radius === "number" && primitive.radius > 0)) {
    return undefined;
  }

  // Diameter is stored in width/depth so the frame stays one shape for both kinds.
  const diameter = primitive.kind === "cylinder" && typeof primitive.radius === "number" ? primitive.radius * 2 : 0;
  return {
    kind: primitive.kind,
    width: primitive.kind === "cylinder" ? diameter : primitive.width,
    depth: primitive.kind === "cylinder" ? diameter : primitive.depth,
    height: primitive.height,
    frame: {
      x: frame.centerX,
      z: frame.centerZ,
      elevation: frame.minY,
      width: frame.width,
      depth: frame.depth,
      height: frame.height,
      ...(primitive.transform ? { sourceTransform: primitive.transform } : {}),
    },
  };
}

export function bakeCadMetadataForShapeTransform(shape: WorkplaneShape, frame: BakedCadMetadataFrame) {
  const cadDisplayEdges = bakeCadDisplayEdgesForShape(shape, frame);
  const sourceTransform = cadBrepTransformForShape(shape);
  const cadPrimitiveFrame = bakeCadPrimitiveFrameForShapeTransform(shape, frame);
  const cadBrepFrame = shape.cadBrep && shape.cadBrepFrame
    ? {
        x: frame.centerX,
        z: frame.centerZ,
        elevation: frame.minY,
        width: frame.width,
        depth: frame.depth,
        height: frame.height,
        ...(sourceTransform ? { sourceTransform } : {}),
      }
    : undefined;
  return {
    cadDisplayEdges,
    cadDisplayEdgesVersion: cadDisplayEdges ? (2 as const) : undefined,
    cadBrep: cadBrepFrame ? shape.cadBrep : undefined,
    cadBrepFrame,
    cadPrimitiveFrame,
  };
}
