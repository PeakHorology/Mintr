import * as THREE from "three";
import { withCsgMeta } from "@/lib/csgTree";
import { createLocalId } from "@/lib/localIds";
import { boundsForShapes } from "@/lib/editorShapeMesh";
import { MIN_SHAPE_DIMENSION, cleanModelDimension } from "@/lib/modelDimension";
import { groupedChildrenDisplayScale, shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

export function cloneAsGroupChild(shape: WorkplaneShape, centerX: number, centerZ: number, minY: number, preserveId = false): WorkplaneShape {
  return {
    ...shape,
    id: preserveId ? shape.id : createLocalId(`${shape.id}-group-child`),
    x: shape.x - centerX,
    z: shape.z - centerZ,
    elevation: (shape.elevation ?? 0) - minY,
  };
}

/**
 * Parts on their way back into the group they came from keep the values they are stored with.
 * Taking a group's parts out to world space hands each one a copy of the group's values it uses
 * (so Ungroup leaves nothing dangling). Put back with those copies, a part would stop following
 * the group's values the first time the group was rebuilt. Parts without values are untouched.
 */
export function keepStoredChildValues(worldChildren: WorkplaneShape[], stored: readonly WorkplaneShape[] | undefined): WorkplaneShape[] {
  if (!stored?.some((child) => child.values?.length) && !worldChildren.some((child) => child.values?.length)) return worldChildren;
  const byId = new Map((stored ?? []).map((child) => [child.id, child]));
  return worldChildren.map((child) => {
    const original = byId.get(child.id);
    if (!original || original.values === child.values) return child;
    const { values: _copied, ...rest } = child;
    return original.values ? { ...rest, values: original.values } : rest;
  });
}

/**
 * Half-size of a hole assembly around the group center.
 * Child x/z are centered. Elevation is measured up from the bottom, so it must
 * not be treated as a center offset — that doubled the height readout.
 */
export function drawnAssemblyHalfExtents(shape: WorkplaneShape, children: WorkplaneShape[]) {
  const scale = groupedChildrenDisplayScale(shape);
  let maxX = 0;
  let maxY = 0;
  let maxZ = 0;
  const corner = new THREE.Vector3();
  for (const child of children) {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(child.rotationX ?? 0),
      THREE.MathUtils.degToRad(child.rotation),
      THREE.MathUtils.degToRad(child.rotationZ ?? 0),
      "XYZ",
    ));
    const origin = new THREE.Vector3(
      child.x * scale.x,
      -shape.height / 2 + ((child.elevation ?? 0) + child.height / 2) * scale.y,
      child.z * scale.z,
    );
    const halfX = shapeWidth(child) / 2;
    const halfY = child.height / 2;
    const halfZ = shapeDepth(child) / 2;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          corner.set(sx * halfX, sy * halfY, sz * halfZ).applyQuaternion(quaternion);
          corner.x = origin.x + corner.x * scale.x;
          corner.y = origin.y + corner.y * scale.y;
          corner.z = origin.z + corner.z * scale.z;
          maxX = Math.max(maxX, Math.abs(corner.x));
          maxY = Math.max(maxY, Math.abs(corner.y));
          maxZ = Math.max(maxZ, Math.abs(corner.z));
        }
      }
    }
  }
  return { x: maxX, y: maxY, z: maxZ };
}

export function groupedShape(selection: WorkplaneShape[]): WorkplaneShape | null {
  const groupable = selection.filter((shape) => !shape.locked);
  if (groupable.length < 2) {
    return null;
  }

  const groupBounds = boundsForShapes(groupable);
  const minX = groupBounds.minX;
  const maxX = groupBounds.maxX;
  const minY = groupBounds.minY;
  const maxY = groupBounds.maxY;
  const minZ = groupBounds.minZ;
  const maxZ = groupBounds.maxZ;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const width = cleanModelDimension(Math.max(MIN_SHAPE_DIMENSION, maxX - minX));
  const depth = cleanModelDimension(Math.max(MIN_SHAPE_DIMENSION, maxZ - minZ));
  const height = cleanModelDimension(Math.max(MIN_SHAPE_DIMENSION, maxY - minY));
  const firstSolid = groupable.find((shape) => !shape.hole) ?? groupable[0];
  const holeOnly = groupable.every((shape) => shape.hole);

  return withCsgMeta({
    id: createLocalId("group"),
    name: "Tie",
    kind: "mesh",
    color: firstSolid.color,
    hole: holeOnly,
    x: centerX,
    z: centerZ,
    elevation: minY,
    size: Math.max(width, depth),
    width,
    depth,
    height,
    rotation: 0,
    groupedBaseWidth: width,
    groupedBaseDepth: depth,
    groupedBaseHeight: height,
    groupedShapes: groupable.map((shape) => cloneAsGroupChild(shape, centerX, centerZ, minY)),
    locked: false,
    hidden: false,
  }, "assemble", 1, false);
}
