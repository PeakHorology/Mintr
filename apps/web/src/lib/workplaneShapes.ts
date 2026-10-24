import type { WorkplaneShape } from "@/types/sketchforge";

import { hardwareProfile } from "@/lib/desktopHardware";
import { gearFootprint, gearSpecKey, moduleForSpan, normalizeGearSpec } from "@/lib/gearProfile";
import {
  GRIDFINITY_DOVETAIL_PROTRUSION,
  GRIDFINITY_TAB_LENGTH,
  defaultGridfinityBaseplateSpec,
  defaultGridfinityBinSpec,
  gridfinityBaseplateFootprint,
  gridfinityBaseplateKey,
  gridfinityBaseplateName,
  gridfinityBinFootprint,
  gridfinityBinKey,
  gridfinityBinName,
  gridfinityHeightUnitsForHeight,
  gridfinityUnitsForSpan,
  isDefaultGridfinityName,
  normalizeGridfinityBaseplateSpec,
  normalizeGridfinityBinSpec,
} from "@/lib/gridfinity";

export const MAX_SHAPE_SIDES = hardwareProfile().maxShapeSides;

export function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

export function cleanRotationDegrees(value: number, precision = 1) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = normalizeDegrees(value);
  const rounded = Number(normalized.toFixed(precision));
  const zeroThreshold = precision <= 1 ? 0.5 : 0.05;
  if (rounded < zeroThreshold || rounded >= 360 - zeroThreshold || Object.is(rounded, -0)) {
    return 0;
  }
  return rounded;
}

export function cleanNearZero(value: number, epsilon = 0.005) {
  return Math.abs(value) < epsilon ? 0 : value;
}

export function shapeWidth(shape: Pick<WorkplaneShape, "width" | "size">) {
  return shape.width ?? shape.size;
}

export function shapeDepth(shape: Pick<WorkplaneShape, "depth" | "size">) {
  return shape.depth ?? shape.size;
}

/** Cone base radius in model units (falls back to half the footprint width). */
export function coneBaseRadius(shape: Pick<WorkplaneShape, "baseRadius" | "width" | "size">) {
  return shape.baseRadius ?? shapeWidth(shape) / 2;
}

/** Cone top radius in model units (0 = pointy tip). */
export function coneTopRadius(shape: Pick<WorkplaneShape, "topRadius">) {
  return shape.topRadius ?? 0;
}

/** Larger of the two cone rings — drives the minimum overall footprint. */
export function coneMaxRadius(shape: Pick<WorkplaneShape, "baseRadius" | "topRadius" | "width" | "size">) {
  return Math.max(coneBaseRadius(shape), coneTopRadius(shape));
}

/** Radii of the cone the viewport actually draws, in millimeters. */
export type ConeProfile = {
  baseX: number;
  baseZ: number;
  topX: number;
  topZ: number;
};

/**
 * The base and top sizes after the footprint scale. Stored radii and Length/Width
 * are not those sizes on their own: the larger ring is fitted to the footprint,
 * and the other ring follows.
 */
export function coneVisibleProfile(shape: Pick<WorkplaneShape, "baseRadius" | "topRadius" | "width" | "depth" | "size">): ConeProfile {
  const maxRadius = Math.max(coneMaxRadius(shape), 1e-9);
  const halfWidth = Math.max(0, shapeWidth(shape) / 2);
  const halfDepth = Math.max(0, shapeDepth(shape) / 2);
  const base = Math.max(0, coneBaseRadius(shape)) / maxRadius;
  const top = Math.max(0, coneTopRadius(shape)) / maxRadius;
  return {
    baseX: base * halfWidth,
    baseZ: base * halfDepth,
    topX: top * halfWidth,
    topZ: top * halfDepth,
  };
}

/** A cone with Length and Width, or an older cone that is already oval. */
export function coneIsFreeRange(shape: Pick<WorkplaneShape, "coneFreeRange" | "width" | "depth" | "size">) {
  if (shape.coneFreeRange) return true;
  return Math.abs(shapeWidth(shape) - shapeDepth(shape)) >= 1e-4;
}

/**
 * Unit-frustum top scale for mesh/CSG: larger ring maps to 1, then width/depth
 * scale the overall footprint (same pattern as cylinders).
 */
export function coneUnitTopScale(shape: Pick<WorkplaneShape, "baseRadius" | "topRadius" | "width" | "size">) {
  const maxR = Math.max(0.001, coneMaxRadius(shape));
  return coneTopRadius(shape) / maxR;
}

export function coneUnitBaseScale(shape: Pick<WorkplaneShape, "baseRadius" | "topRadius" | "width" | "size">) {
  const maxR = Math.max(0.001, coneMaxRadius(shape));
  return coneBaseRadius(shape) / maxR;
}

/** @deprecated Width/depth are the overall footprint; prefer shapeWidth/shapeDepth halves. */
export function coneLocalHalfExtents(shape: Pick<WorkplaneShape, "baseRadius" | "topRadius" | "width" | "depth" | "size" | "height">) {
  return {
    x: shapeWidth(shape) / 2,
    y: shape.height / 2,
    z: shapeDepth(shape) / 2,
  };
}

/**
 * Standard cone: the two radii are the solid, and the footprint stays a circle
 * around the larger one.
 */
export function conePatchForRadii(
  _shape: Pick<WorkplaneShape, "baseRadius" | "topRadius" | "width" | "depth" | "size">,
  topRadius: number,
  baseRadius: number,
): Partial<WorkplaneShape> {
  const top = Math.max(0, topRadius);
  const base = Math.max(0.001, baseRadius);
  const footprint = Math.max(top, base) * 2;
  return {
    topRadius: top,
    baseRadius: base,
    width: footprint,
    depth: footprint,
    size: footprint,
  };
}

/** Leave Free range and keep a circle as large as the wider end of each ring. */
export function conePatchForStandardMode(shape: Pick<WorkplaneShape, "baseRadius" | "topRadius" | "width" | "depth" | "size">): Partial<WorkplaneShape> {
  const profile = coneVisibleProfile(shape);
  const base = Math.max(profile.baseX, profile.baseZ, 0.001);
  const top = Math.max(profile.topX, profile.topZ, 0);
  return { ...conePatchForRadii(shape, top, base), coneFreeRange: undefined };
}

/**
 * Outline edit. A standard cone stays circular and the radii follow. Free range
 * keeps the typed length or width and scales the radii with the axis that moved.
 */
export function conePatchForFootprint(
  shape: Pick<WorkplaneShape, "coneFreeRange" | "baseRadius" | "topRadius" | "width" | "depth" | "size" | "height">,
  nextWidth: number,
  nextDepth: number,
): Partial<WorkplaneShape> {
  if (!coneIsFreeRange(shape)) {
    const oldDiameter = Math.max(shapeWidth(shape), shapeDepth(shape), 0.001);
    const widthChanged = Math.abs(nextWidth - shapeWidth(shape));
    const depthChanged = Math.abs(nextDepth - shapeDepth(shape));
    const diameter = Math.max(0.001, widthChanged >= depthChanged ? nextWidth : nextDepth);
    const scale = diameter / oldDiameter;
    return {
      width: diameter,
      depth: diameter,
      size: diameter,
      topRadius: Math.max(0, coneTopRadius(shape) * scale),
      baseRadius: Math.max(0.001, coneBaseRadius(shape) * scale),
    };
  }

  const oldW = Math.max(0.001, shapeWidth(shape));
  const oldD = Math.max(0.001, shapeDepth(shape));
  const width = Math.max(0.001, nextWidth);
  const depth = Math.max(0.001, nextDepth);
  const scaleW = width / oldW;
  const scaleD = depth / oldD;
  const scale = Math.abs(scaleW - 1) >= Math.abs(scaleD - 1) - 1e-12 ? scaleW : scaleD;
  return {
    width,
    depth,
    size: resizedShapeSize(width, depth),
    topRadius: coneTopRadius(shape) * scale,
    baseRadius: coneBaseRadius(shape) * scale,
  };
}

/**
 * Shift-drag uniform scale for a triangle. Height follows the width scale so
 * the stored base angles stay put. Length/depth can still change on their own
 * when the handle only moves that axis.
 */
export function roofPatchForFootprint(
  shape: Pick<WorkplaneShape, "width" | "depth" | "size" | "height" | "leftAngle" | "rightAngle">,
  nextWidth: number,
  nextDepth: number,
): Partial<WorkplaneShape> {
  const oldW = Math.max(0.001, shapeWidth(shape));
  const width = Math.max(0.001, nextWidth);
  const depth = Math.max(0.001, nextDepth);
  const scale = width / oldW;
  const patch: Partial<WorkplaneShape> = {
    width,
    depth,
    size: resizedShapeSize(width, depth),
    height: Math.max(0.001, shape.height * scale),
  };
  if (typeof shape.leftAngle === "number") {
    patch.leftAngle = shape.leftAngle;
  }
  if (typeof shape.rightAngle === "number") {
    patch.rightAngle = shape.rightAngle;
  }
  return patch;
}

/** Shift-drag height: scale the triangle base with the rise so angles stay put. */
export function roofPatchForHeight(
  shape: Pick<WorkplaneShape, "width" | "depth" | "size" | "height" | "leftAngle" | "rightAngle">,
  nextHeight: number,
): Partial<WorkplaneShape> {
  const oldH = Math.max(0.001, shape.height);
  const height = Math.max(0.001, nextHeight);
  const scale = height / oldH;
  const width = Math.max(0.001, shapeWidth(shape) * scale);
  const depth = shapeDepth(shape);
  const patch: Partial<WorkplaneShape> = {
    width,
    depth,
    size: resizedShapeSize(width, depth),
    height,
  };
  if (typeof shape.leftAngle === "number") {
    patch.leftAngle = shape.leftAngle;
  }
  if (typeof shape.rightAngle === "number") {
    patch.rightAngle = shape.rightAngle;
  }
  return patch;
}

function edgeTreatmentPreserveZone(shape: WorkplaneShape): number {
  const own = Math.max(...(shape.edgeTreatments ?? []).map((feature) => feature.amount), 0);
  const child = Math.max(...(shape.groupedShapes ?? []).map(edgeTreatmentPreserveZone), 0);
  return Math.max(own, child);
}

export function preservesEdgeTreatmentSize(shape: WorkplaneShape) {
  return shape.edgeResizeMode === "preserve" && Boolean(shape.importedMesh && edgeTreatmentPreserveZone(shape) > 0);
}

function edgePreservedCoordinate(value: number, baseSize: number, targetSize: number, centered: boolean, requestedZone: number) {
  const oldMin = centered ? -baseSize / 2 : 0;
  const oldMax = oldMin + baseSize;
  const newMin = centered ? -targetSize / 2 : 0;
  const zone = Math.max(0, Math.min(requestedZone, baseSize / 2, targetSize / 2));
  if (zone <= 1e-6 || Math.abs(baseSize - targetSize) <= 1e-9) {
    return newMin + (value - oldMin) * targetSize / Math.max(0.001, baseSize);
  }
  const distanceFromMin = value - oldMin;
  const distanceFromMax = oldMax - value;
  if (distanceFromMin <= zone) return newMin + distanceFromMin;
  if (distanceFromMax <= zone) return newMin + targetSize - distanceFromMax;
  const oldInterior = Math.max(1e-6, baseSize - zone * 2);
  const newInterior = Math.max(0, targetSize - zone * 2);
  return newMin + zone + (distanceFromMin - zone) * newInterior / oldInterior;
}

export function resizedImportedCoordinates(shape: WorkplaneShape, sourcePositions: number[]) {
  const mesh = shape.importedMesh;
  if (!mesh) return [];
  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const height = shape.height;
  const preserve = preservesEdgeTreatmentSize(shape);
  const zone = preserve ? edgeTreatmentPreserveZone(shape) : 0;
  const positions = new Array<number>(sourcePositions.length);
  for (let index = 0; index + 2 < sourcePositions.length; index += 3) {
    if (preserve) {
      positions[index] = edgePreservedCoordinate(sourcePositions[index], mesh.baseWidth, width, true, zone);
      positions[index + 1] = edgePreservedCoordinate(sourcePositions[index + 1], mesh.baseHeight, height, false, zone);
      positions[index + 2] = edgePreservedCoordinate(sourcePositions[index + 2], mesh.baseDepth, depth, true, zone);
    } else {
      positions[index] = sourcePositions[index] * width / Math.max(0.001, mesh.baseWidth);
      positions[index + 1] = sourcePositions[index + 1] * height / Math.max(0.001, mesh.baseHeight);
      positions[index + 2] = sourcePositions[index + 2] * depth / Math.max(0.001, mesh.baseDepth);
    }
  }
  return positions;
}

export function resizedImportedMeshPositions(shape: WorkplaneShape) {
  return shape.importedMesh ? resizedImportedCoordinates(shape, shape.importedMesh.positions) : [];
}

export function resizedShapeSize(width: number, depth: number) {
  return Math.max(width, depth);
}

/**
 * Scale for live grouped children. Must use the size captured at Group time
 * (`groupedBase*`), not a Three.js wrapper AABB: patterned copies carry yaw,
 * and a sphere-based Box3 is larger than the vertex AABB used to size the
 * group, so fitting to that box pulls every instance toward the group center.
 */
export function groupedChildrenDisplayScale(shape: Pick<WorkplaneShape, "width" | "depth" | "size" | "height" | "groupedBaseWidth" | "groupedBaseHeight" | "groupedBaseDepth">) {
  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const height = shape.height;
  return {
    x: width / Math.max(0.001, shape.groupedBaseWidth ?? width),
    y: height / Math.max(0.001, shape.groupedBaseHeight ?? height),
    z: depth / Math.max(0.001, shape.groupedBaseDepth ?? depth),
  };
}

export function proportionalResizeScale(startWidth: number, startDepth: number, nextWidth: number, nextDepth: number) {
  const widthScale = nextWidth / Math.max(0.001, startWidth);
  const depthScale = nextDepth / Math.max(0.001, startDepth);
  if (!Number.isFinite(widthScale) || !Number.isFinite(depthScale)) {
    return 1;
  }
  return Math.abs(widthScale - 1) >= Math.abs(depthScale - 1) ? widthScale : depthScale;
}

export function fallbackSolidColor(shape: WorkplaneShape) {
  if (shape.kind === "cylinder" || shape.kind === "thread") return "#d97813";
  if (shape.kind === "gear" || shape.kind === "gridfinityBin") return "#2aa77e";
  if (shape.kind === "gridfinityBaseplate") return "#655447";
  if (shape.kind === "sphere") return "#0098c7";
  if (shape.kind === "cone") return "#6e2786";
  if (shape.kind === "pyramid") return "#f2cf10";
  return "#d41721";
}

const HOLE_DISPLAY_COLOR = "#b8c2cc";

function rememberedSolidColor(shape: WorkplaneShape) {
  if (shape.solidColor && shape.solidColor !== HOLE_DISPLAY_COLOR) return shape.solidColor;
  if (shape.color && shape.color !== HOLE_DISPLAY_COLOR) return shape.color;
  return undefined;
}

export function withHoleMode(shape: WorkplaneShape, hole: boolean, parentColor?: string): WorkplaneShape {
  const solidColor = rememberedSolidColor(shape);
  const explicitColor = parentColor && parentColor !== HOLE_DISPLAY_COLOR ? parentColor : undefined;
  const color = hole ? HOLE_DISPLAY_COLOR : (explicitColor ?? solidColor ?? fallbackSolidColor(shape));
  // Boolean cut / union groups already encode solid vs hole roles on children.
  // Recursing would flip cutter children to solid (or solids to holes) and break re-cuts.
  const isBooleanGroup =
    Boolean(shape.groupedShapes?.length)
    && (
      shape.id.startsWith("grouped-manifold")
      || shape.id.startsWith("grouped-boolean")
      || shape.id.startsWith("grouped-cut")
      || Boolean(shape.importedMesh)
    );
  const next: WorkplaneShape = {
    ...shape,
    hole,
    color,
    ...(solidColor ? { solidColor } : { solidColor: undefined }),
  };
  if (isBooleanGroup) return next;
  return {
    ...next,
    groupedShapes: shape.groupedShapes?.map((child) => withHoleMode(child, hole, parentColor)),
  };
}

export function mirrorSign(value?: boolean) {
  return value ? -1 : 1;
}

export function mirroredAxisCount(shape: WorkplaneShape) {
  return [shape.mirrorX, shape.mirrorY, shape.mirrorZ].filter(Boolean).length;
}

/**
 * A Gridfinity spec edit leaves the previous exact body behind. Keep the mesh as a
 * stand-in until the kernel answers, but never let the old B-Rep reach STEP or a
 * boolean: without cadBrep the kernel rebuilds the body from its recipe instead.
 */
function dropStaleGridfinityBrep(next: WorkplaneShape, key: string) {
  if (!next.cadBrep || !next.gridfinityBuilt || next.gridfinityBuilt === key) return;
  next.cadBrep = undefined;
  next.cadBrepFrame = undefined;
  next.cadDisplayEdges = undefined;
  next.cadDisplayEdgesVersion = undefined;
}

export function canonicalizeShape(shape: WorkplaneShape): WorkplaneShape {
  const next: WorkplaneShape = {
    ...shape,
    rotation: cleanRotationDegrees(shape.rotation ?? 0),
    rotationX: cleanRotationDegrees(shape.rotationX ?? 0),
    rotationZ: cleanRotationDegrees(shape.rotationZ ?? 0),
    mirrorX: shape.mirrorX || undefined,
    mirrorY: shape.mirrorY || undefined,
    mirrorZ: shape.mirrorZ || undefined,
  };
  if (shape.kind === "cone") {
    // Grow only when the larger ring fits on neither axis. A Length or Width
    // edit scales the radii and may leave an ellipse; inflating both axes
    // would overwrite the size the user just typed.
    const maxR = coneMaxRadius(next);
    const width = shapeWidth(next);
    const depth = shapeDepth(next);
    const halfW = width / 2;
    const halfD = depth / 2;
    // Free range length and width are the sizes the user typed. Growing both
    // axes here is what made a later width edit rewrite the length.
    if (!coneIsFreeRange(next) && maxR > halfW + 1e-6 && maxR > halfD + 1e-6) {
      const grow = maxR / Math.max(0.001, Math.min(halfW, halfD));
      const nextWidth = width * grow;
      const nextDepth = depth * grow;
      next.width = nextWidth;
      next.depth = nextDepth;
      next.size = resizedShapeSize(nextWidth, nextDepth);
    }
  }
  if (shape.kind === "gear") {
    const spec = normalizeGearSpec(next.gearSpec);
    const width = shapeWidth(next);
    const depth = shapeDepth(next);
    const expected = gearFootprint(spec, depth);
    let resolved = spec;
    if (spec.form === "rack") {
      if (Math.abs(width - expected.width) > 0.02) {
        resolved = normalizeGearSpec({ ...spec, module: moduleForSpan(spec, width) });
      }
    } else if (Math.abs(width - expected.width) > 0.02 || Math.abs(depth - expected.depth) > 0.02) {
      const span = Math.abs(width - expected.width) >= Math.abs(depth - expected.depth) ? width : depth;
      resolved = normalizeGearSpec({ ...spec, module: moduleForSpan(spec, span) });
    }
    const foot = gearFootprint(resolved, spec.form === "rack" ? depth : 0);
    next.gearSpec = resolved;
    next.width = foot.width;
    next.depth = foot.depth;
    next.size = Math.max(foot.width, foot.depth);
  }
  if (shape.kind === "gridfinityBin") {
    // Dragged sizes snap to whole grid / height units; the spec is the source of truth.
    const spec = normalizeGridfinityBinSpec(next.gridfinityBin ?? defaultGridfinityBinSpec());
    const expected = gridfinityBinFootprint(spec);
    const width = shapeWidth(next);
    const depth = shapeDepth(next);
    let resolved = spec;
    if (Math.abs(width - expected.width) > 0.02 || Math.abs(depth - expected.depth) > 0.02 || Math.abs(next.height - expected.height) > 0.02) {
      resolved = normalizeGridfinityBinSpec({
        ...spec,
        unitsX: Math.abs(width - expected.width) > 0.02 ? gridfinityUnitsForSpan(width) : spec.unitsX,
        unitsZ: Math.abs(depth - expected.depth) > 0.02 ? gridfinityUnitsForSpan(depth) : spec.unitsZ,
        heightUnits: Math.abs(next.height - expected.height) > 0.02 ? gridfinityHeightUnitsForHeight(next.height, spec.stackingLip) : spec.heightUnits,
      });
    }
    const foot = gridfinityBinFootprint(resolved);
    next.gridfinityBin = next.gridfinityBin && gridfinityBinKey(next.gridfinityBin) === gridfinityBinKey(resolved) ? next.gridfinityBin : resolved;
    if (isDefaultGridfinityName(next.name) && next.name !== gridfinityBinName(resolved)) next.name = gridfinityBinName(resolved);
    next.width = foot.width;
    next.depth = foot.depth;
    next.height = foot.height;
    next.size = Math.max(foot.width, foot.depth);
    dropStaleGridfinityBrep(next, gridfinityBinKey(resolved));
  }
  if (shape.kind === "gridfinityBaseplate") {
    const spec = normalizeGridfinityBaseplateSpec(next.gridfinityBaseplate ?? defaultGridfinityBaseplateSpec());
    const expected = gridfinityBaseplateFootprint(spec);
    const width = shapeWidth(next);
    const depth = shapeDepth(next);
    let resolved = spec;
    if (Math.abs(width - expected.width) > 0.02 || Math.abs(depth - expected.depth) > 0.02) {
      const tab = (side: "left" | "right" | "front" | "back") => spec.connectors?.[side] === "tab"
        ? GRIDFINITY_TAB_LENGTH
        : spec.connectors?.[side] === "dovetail" ? GRIDFINITY_DOVETAIL_PROTRUSION : 0;
      resolved = normalizeGridfinityBaseplateSpec({
        ...spec,
        unitsX: Math.abs(width - expected.width) > 0.02
          ? gridfinityUnitsForSpan(width, spec.padLeft + spec.padRight + tab("left") + tab("right"))
          : spec.unitsX,
        unitsZ: Math.abs(depth - expected.depth) > 0.02
          ? gridfinityUnitsForSpan(depth, spec.padFront + spec.padBack + tab("front") + tab("back"))
          : spec.unitsZ,
        drawerWidth: 0,
        drawerLength: 0,
      });
    }
    const foot = gridfinityBaseplateFootprint(resolved);
    next.gridfinityBaseplate = next.gridfinityBaseplate && gridfinityBaseplateKey(next.gridfinityBaseplate) === gridfinityBaseplateKey(resolved)
      ? next.gridfinityBaseplate
      : resolved;
    if (isDefaultGridfinityName(next.name) && next.name !== gridfinityBaseplateName(resolved)) next.name = gridfinityBaseplateName(resolved);
    next.width = foot.width;
    next.depth = foot.depth;
    next.height = foot.height;
    next.size = Math.max(foot.width, foot.depth);
    dropStaleGridfinityBrep(next, gridfinityBaseplateKey(resolved));
  }
  if (shape.groupedShapes) {
    next.groupedShapes = shape.groupedShapes.map(canonicalizeShape);
  }
  if (shape.edgeTreatmentHistory) {
    next.edgeTreatmentHistory = shape.edgeTreatmentHistory.map((entry) => ({
      ...entry,
      before: canonicalizeShape(entry.before),
    }));
  }
  return next;
}

export function workplaneShapesEqual(a: WorkplaneShape, b: WorkplaneShape) {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.kind === b.kind &&
    a.color === b.color &&
    a.hole === b.hole &&
    a.x === b.x &&
    a.z === b.z &&
    a.elevation === b.elevation &&
    a.size === b.size &&
    a.width === b.width &&
    a.depth === b.depth &&
    a.height === b.height &&
    a.rotation === b.rotation &&
    a.rotationX === b.rotationX &&
    a.rotationZ === b.rotationZ &&
    a.mirrorX === b.mirrorX &&
    a.mirrorY === b.mirrorY &&
    a.mirrorZ === b.mirrorZ &&
    a.radius === b.radius &&
    a.steps === b.steps &&
    a.sides === b.sides &&
    a.bevel === b.bevel &&
    a.segments === b.segments &&
    a.topRadius === b.topRadius &&
    a.baseRadius === b.baseRadius &&
    a.coneFreeRange === b.coneFreeRange &&
    a.leftAngle === b.leftAngle &&
    a.rightAngle === b.rightAngle &&
    a.text === b.text &&
    a.font === b.font &&
    a.textCircumference === b.textCircumference &&
    a.textWrap === b.textWrap &&
    a.importedMesh === b.importedMesh &&
    a.imagePlate === b.imagePlate &&
    a.sketchProfile === b.sketchProfile &&
    a.edgeTreatments === b.edgeTreatments &&
    a.edgeTreatmentHistory === b.edgeTreatmentHistory &&
    a.cadDisplayEdges === b.cadDisplayEdges &&
    a.cadDisplayEdgesVersion === b.cadDisplayEdgesVersion &&
    a.edgeResizeMode === b.edgeResizeMode &&
    a.cadBrep === b.cadBrep &&
    a.cadBrepFrame === b.cadBrepFrame &&
    a.cadPrimitiveFrame === b.cadPrimitiveFrame &&
    a.groupedShapes === b.groupedShapes &&
    a.groupedBaseWidth === b.groupedBaseWidth &&
    a.groupedBaseDepth === b.groupedBaseDepth &&
    a.groupedBaseHeight === b.groupedBaseHeight &&
    a.locked === b.locked &&
    a.hidden === b.hidden &&
    a.construction === b.construction &&
    a.patternFeature === b.patternFeature &&
    a.holeSpec === b.holeSpec &&
    a.gridfinityBin === b.gridfinityBin &&
    a.gridfinityBaseplate === b.gridfinityBaseplate &&
    a.gridfinityBuilt === b.gridfinityBuilt &&
    (a.kind === "gear" ? gearSpecKey(a.gearSpec) === gearSpecKey(b.gearSpec) : true)
  );
}

export function serializeShapesForSync(shapes: WorkplaneShape[]) {
  return JSON.stringify(shapes.map(canonicalizeShape));
}

