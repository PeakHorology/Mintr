import { cadModifierRequestTimeoutMs } from "@/lib/cadModifierRuntime";
import { requestNativeKernelJob, toNativeKernelSolids } from "@/lib/nativeKernelProtocol";
import type { WorkplaneShape } from "@/types/sketchforge";

export type ShapeMeasure = {
  volume: number;
  area: number;
  source: "kernel" | "mesh";
};

function meshMeasure(shape: WorkplaneShape): ShapeMeasure | null {
  const positions = shape.importedMesh?.positions;
  if (!positions || positions.length < 9) return null;
  let volume = 0;
  let area = 0;
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const ax = positions[i];
    const ay = positions[i + 1];
    const az = positions[i + 2];
    const bx = positions[i + 3];
    const by = positions[i + 4];
    const bz = positions[i + 5];
    const cx = positions[i + 6];
    const cy = positions[i + 7];
    const cz = positions[i + 8];
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const mag = Math.hypot(nx, ny, nz);
    if (mag < 1e-12) continue;
    area += mag * 0.5;
    volume += (ax * nx + ay * ny + az * nz) / 6;
  }
  if (!(area > 0)) return null;
  return { volume: Math.abs(volume), area, source: "mesh" };
}

export async function measureWorkplaneShape(shape: WorkplaneShape): Promise<ShapeMeasure | null> {
  const solids = toNativeKernelSolids([shape]);
  if (solids) {
    const reply = await requestNativeKernelJob(
      { id: Date.now(), type: "measure", solids },
      cadModifierRequestTimeoutMs(),
    );
    const volume = Number(reply?.volume);
    const area = Number(reply?.area);
    if (reply?.ok && Number.isFinite(volume) && Number.isFinite(area) && volume > 0 && area > 0) {
      return { volume, area, source: "kernel" };
    }
  }
  return meshMeasure(shape);
}
