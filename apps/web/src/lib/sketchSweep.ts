import { createLocalId } from "@/lib/localIds";
import { sketchProfileToDoc } from "@/lib/sketch/migrate";
import { findSweepInputs } from "@/lib/sketch/directEdit";
import { buildSweepMesh, type SweepFrame } from "@/lib/sketch/sweepMath";
import { resolveSketchPlane, sketchPlaneVAxis } from "@/lib/sketchPlane";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { SketchProfile, WorkplaneShape } from "@/types/sketchforge";

function frameFor(profile: SketchProfile): SweepFrame {
  const plane = resolveSketchPlane(profile.sketchPlane);
  const vAxis = sketchPlaneVAxis(plane);
  return {
    origin: plane.origin,
    uAxis: plane.uAxis,
    vAxis,
    normal: plane.normal,
  };
}

/** Solid whose section follows a construction path on the same sketch. */
export function shapeFromSketchSweep(
  profile: SketchProfile,
  existing?: WorkplaneShape | null,
): WorkplaneShape | null {
  const inputs = findSweepInputs(profile);
  if (!inputs) return null;
  const mesh = buildSweepMesh(inputs.section, inputs.path, inputs.pathClosed, frameFor(profile));
  if (!mesh || mesh.indices.length < 3) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const x = mesh.positions[index];
    const y = mesh.positions[index + 1];
    const z = mesh.positions[index + 2];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const positions: number[] = [];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    positions.push(mesh.positions[index] - centerX, mesh.positions[index + 1], mesh.positions[index + 2] - centerZ);
  }
  const width = Math.max(0.01, maxX - minX);
  const depth = Math.max(0.01, maxZ - minZ);
  const height = Math.max(0.01, maxY - minY);
  const triangleCount = Math.floor(mesh.indices.length / 3);

  return canonicalizeShape({
    id: existing?.id ?? createLocalId("sketch-sweep"),
    name: existing?.name ?? "Sketch sweep",
    kind: "mesh",
    color: existing?.color ?? "#d41721",
    hole: false,
    x: centerX,
    z: centerZ,
    elevation: minY,
    size: Math.max(width, depth),
    width,
    depth,
    height,
    rotation: 0,
    importedMesh: {
      positions,
      indices: mesh.indices,
      baseWidth: width,
      baseDepth: depth,
      baseHeight: height,
      triangleCount,
      sourceFormat: "json",
    },
    sketchProfile: {
      ...profile,
      points: profile.points.map((point) => ({ ...point })),
      segments: profile.segments.map((segment) => ({ ...segment })),
    },
    sketchDoc: sketchProfileToDoc(profile, existing?.sketchId ?? existing?.sketchDoc?.id),
    sketchId: existing?.sketchId ?? existing?.sketchDoc?.id,
    sketchFinish: "sweep",
  } satisfies WorkplaneShape);
}
