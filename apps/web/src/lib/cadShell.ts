import type { OcctKernel, ShapeHandle, Vec3 } from "occt-wasm";
import { SHELL_SIDES, type ShellSide } from "@/lib/shellLimits";

const HASH_UPPER_BOUND = 2_147_483_647;

export type ShellCornerStyle = "sharp" | "round";

const SIDE_AXES: Record<ShellSide, { axis: "x" | "y" | "z"; sign: 1 | -1 }> = {
  top: { axis: "y", sign: 1 },
  bottom: { axis: "y", sign: -1 },
  front: { axis: "z", sign: 1 },
  back: { axis: "z", sign: -1 },
  right: { axis: "x", sign: 1 },
  left: { axis: "x", sign: -1 },
};

function releaseAll(cad: OcctKernel, handles: ShapeHandle[]) {
  handles.forEach((handle) => {
    try {
      cad.release(handle);
    } catch {
      // already released
    }
  });
}

function shapeIsValid(cad: OcctKernel, shape: ShapeHandle) {
  try {
    return Boolean(cad.isValid(shape));
  } catch {
    return false;
  }
}

/** Planar faces on the requested sides that face straight out and sit on the solid's edge. */
export function shellOpeningFaces(cad: OcctKernel, solid: ShapeHandle, faces: ShapeHandle[], openings: readonly ShellSide[]) {
  const wanted = SHELL_SIDES.filter((side) => openings.includes(side));
  const found = new Map<ShellSide, ShapeHandle[]>(wanted.map((side) => [side, []]));
  if (wanted.length === 0) return { faces: [] as ShapeHandle[], missing: null as ShellSide | null };
  const bounds = cad.getBoundingBox(solid, false);
  const extent = {
    x: [bounds.xmin, bounds.xmax],
    y: [bounds.ymin, bounds.ymax],
    z: [bounds.zmin, bounds.zmax],
  } as const;
  faces.forEach((face) => {
    if (cad.surfaceType(face) !== "plane") return;
    const center = cad.getSurfaceCenterOfMass(face);
    const uv = cad.uvFromPoint(face, center);
    const raw = cad.surfaceNormal(face, uv.u, uv.v);
    const length = Math.hypot(raw.x, raw.y, raw.z) || 1;
    wanted.forEach((side) => {
      const { axis, sign } = SIDE_AXES[side];
      const [min, max] = extent[axis];
      const tolerance = Math.max(1e-4, (max - min) * 1e-4);
      const facesOut = (raw[axis] / length) * sign > 0.999;
      const atEdge = Math.abs(center[axis] - (sign > 0 ? max : min)) <= tolerance;
      if (facesOut && atEdge) found.get(side)?.push(face);
    });
  });
  const missing = [...found.entries()].find(([, sideFaces]) => sideFaces.length === 0)?.[0] ?? null;
  return { faces: [...found.values()].flat(), missing };
}

/**
 * Hollow one solid. Walls grow inward, so the outside stays put.
 * Open faces are removed. With every side closed, the cavity is cut from an inward offset.
 * Sharp leaves the inside corners square. Round fillets those inside corners.
 */
export function shellSolid(
  cad: OcctKernel,
  solid: ShapeHandle,
  thickness: number,
  openings: readonly ShellSide[],
  corners: ShellCornerStyle = "sharp",
  cornerRadius = thickness,
) {
  const faces = cad.getSubShapes(solid, "face");
  try {
    const opening = shellOpeningFaces(cad, solid, faces, openings);
    if (opening.missing) {
      throw new Error(`This body has no flat ${opening.missing} face to leave open`);
    }
    const solidVolume = Math.abs(cad.getVolume(solid));
    const accept = (result: ShapeHandle) => {
      const volume = shapeIsValid(cad, result) ? Math.abs(cad.getVolume(result)) : 0;
      if (volume > 0 && volume < solidVolume * (1 - 1e-6)) return true;
      cad.release(result);
      return false;
    };
    let lastError: unknown = null;
    for (const tolerance of [1e-6, 1e-3]) {
      try {
        if (opening.faces.length > 0) {
          const result = cad.shell(solid, opening.faces, thickness, tolerance);
          if (accept(result)) return finishShell(cad, result, corners, cornerRadius, thickness);
        } else {
          const cavity = cad.offset(solid, -thickness, tolerance);
          try {
            const result = cad.cut(solid, cavity);
            if (accept(result)) return finishShell(cad, result, corners, cornerRadius, thickness);
          } finally {
            cad.release(cavity);
          }
        }
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.message.startsWith("These inside")) break;
      }
    }
    if (lastError instanceof Error && (lastError.message.startsWith("This body") || lastError.message.startsWith("These inside"))) throw lastError;
    throw new Error("The walls cannot be this thick for this body. Choose a thinner wall.");
  } finally {
    releaseAll(cad, faces);
  }
}

function finishShell(
  cad: OcctKernel,
  shelled: ShapeHandle,
  corners: ShellCornerStyle,
  cornerRadius: number,
  thickness: number,
) {
  if (corners !== "round") return shelled;
  const radius = Math.min(Math.max(cornerRadius, 0.05), Math.max(thickness, 0.05));
  const rounded = roundInteriorCorners(cad, shelled, radius);
  if (rounded === "unchanged") return shelled;
  if (rounded) {
    cad.release(shelled);
    return rounded;
  }
  cad.release(shelled);
  throw new Error("These inside corners cannot be rounded at this size. Try a smaller radius.");
}

function parseEdgeFaceMap(values: number[]) {
  const map = new Map<number, number[]>();
  for (let index = 0; index + 1 < values.length;) {
    const edgeHash = values[index++];
    const count = values[index++];
    const faces = values.slice(index, index + count);
    index += count;
    const current = map.get(edgeHash) ?? [];
    faces.forEach((hash) => {
      if (!current.includes(hash)) current.push(hash);
    });
    map.set(edgeHash, current);
  }
  return map;
}

function scaleVec(v: Vec3, scale: number): Vec3 {
  return { x: v.x * scale, y: v.y * scale, z: v.z * scale };
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/**
 * A pocket corner has material on the long side of the edge. Sampling a ring
 * around the edge avoids the face-order flip that left one corner square.
 */
function edgeIsInteriorCorner(
  cad: OcctKernel,
  solid: ShapeHandle,
  edge: ShapeHandle,
  faceByHash: Map<number, ShapeHandle>,
  adjacent: Map<number, number[]>,
) {
  const hashes = adjacent.get(cad.hashCode(edge, HASH_UPPER_BOUND)) ?? [];
  const faceA = faceByHash.get(hashes[0]);
  const faceB = faceByHash.get(hashes[1]);
  if (!faceA || !faceB) return false;
  const params = cad.curveParameters(edge);
  const span = params.last - params.first;
  const sampleParam = cad.curveIsClosed(edge) ? params.first + span * 0.37 : params.first + span * 0.5;
  const sample = cad.curvePointAtParam(edge, sampleParam);
  const tangent = unit(cad.curveTangent(edge, sampleParam));
  const helper = Math.abs(tangent.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const across = unit(cross(tangent, helper));
  const around = cross(tangent, across);
  const steps = 16;
  const reach = 0.08;
  let inside = 0;
  for (let step = 0; step < steps; step += 1) {
    const angle = ((step + 0.5) / steps) * Math.PI * 2;
    const offset = addVec(scaleVec(across, Math.cos(angle) * reach), scaleVec(around, Math.sin(angle) * reach));
    if (cad.containsPoint(solid, addVec(sample, offset), 1e-5)) inside += 1;
  }
  return inside >= 10;
}

/**
 * Fillet the cavity corners. The outside edges stay sharp.
 * Returns the rounded solid, "unchanged" when the cavity has no corners, or null when the fillet fails.
 */
function roundInteriorCorners(cad: OcctKernel, solid: ShapeHandle, radius: number): ShapeHandle | "unchanged" | null {
  const faces = cad.getSubShapes(solid, "face");
  const edges = cad.getSubShapes(solid, "edge");
  const concave: ShapeHandle[] = [];
  try {
    const faceByHash = new Map(faces.map((face) => [cad.hashCode(face, HASH_UPPER_BOUND), face]));
    const adjacent = parseEdgeFaceMap(cad.edgeToFaceMap(solid, HASH_UPPER_BOUND));
    edges.forEach((edge) => {
      try {
        if (cad.curveLength(edge) < 0.05) return;
        if (edgeIsInteriorCorner(cad, solid, edge, faceByHash, adjacent)) concave.push(edge);
      } catch {
        // A seam that cannot be measured is not a corner to round.
      }
    });
    if (concave.length === 0) return "unchanged";
    const before = Math.abs(cad.getVolume(solid));
    let result: ShapeHandle | null = null;
    try {
      result = cad.fillet(solid, concave, radius);
    } catch {
      return null;
    }
    const volume = shapeIsValid(cad, result) ? Math.abs(cad.getVolume(result)) : 0;
    if (volume > before && volume < before * 1.5) return result;
    cad.release(result);
    return null;
  } finally {
    releaseAll(cad, faces);
    releaseAll(cad, edges);
  }
}
