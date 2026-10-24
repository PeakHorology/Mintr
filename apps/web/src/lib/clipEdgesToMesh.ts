/**
 * Trim a polyline to the stretches that still lie on a triangle mesh.
 * A concave fillet removes the edge it was drawn on, and the old polyline
 * would otherwise hang in the air past the groove and the corner.
 */

const SURFACE_CELL = 4;
const SAMPLE_STEP = 0.5;

/** A line farther than this from the mesh is leftover from before the cut. */
export const SURFACE_LINE_TOLERANCE = 0.4;

export type MeshSurfaceIndex = {
  distanceSq(x: number, y: number, z: number): number;
};

type SurfaceTri = {
  ax: number; ay: number; az: number;
  abx: number; aby: number; abz: number;
  acx: number; acy: number; acz: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
};

function pointTriangleDistanceSq(px: number, py: number, pz: number, tri: SurfaceTri) {
  const { ax, ay, az, abx, aby, abz, acx, acy, acz, bx, by, bz, cx, cy, cz } = tri;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;

  const bpx = px - bx;
  const bpy = py - by;
  const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const dx = ax + abx * v - px;
    const dy = ay + aby * v - py;
    const dz = az + abz * v - pz;
    return dx * dx + dy * dy + dz * dz;
  }

  const cpx = px - cx;
  const cpy = py - cy;
  const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const dx = ax + acx * w - px;
    const dy = ay + acy * w - py;
    const dz = az + acz * w - pz;
    return dx * dx + dy * dy + dz * dz;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const dx = bx + (cx - bx) * w - px;
    const dy = by + (cy - by) * w - py;
    const dz = bz + (cz - bz) * w - pz;
    return dx * dx + dy * dy + dz * dz;
  }

  const denom = va + vb + vc;
  if (!(denom > 1e-20)) return apx * apx + apy * apy + apz * apz;
  const v = vb / denom;
  const w = vc / denom;
  const dx = ax + abx * v + acx * w - px;
  const dy = ay + aby * v + acy * w - py;
  const dz = az + abz * v + acz * w - pz;
  return dx * dx + dy * dy + dz * dz;
}

export function indexMeshSurface(positions: ArrayLike<number>, indices?: ArrayLike<number>): MeshSurfaceIndex {
  const tris: SurfaceTri[] = [];
  const grid = new Map<string, number[]>();
  const push = (ia: number, ib: number, ic: number) => {
    const ax = positions[ia];
    const ay = positions[ia + 1];
    const az = positions[ia + 2];
    const bx = positions[ib];
    const by = positions[ib + 1];
    const bz = positions[ib + 2];
    const cx = positions[ic];
    const cy = positions[ic + 1];
    const cz = positions[ic + 2];
    if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) return;
    const index = tris.length;
    tris.push({
      ax, ay, az, bx, by, bz, cx, cy, cz,
      abx: bx - ax, aby: by - ay, abz: bz - az,
      acx: cx - ax, acy: cy - ay, acz: cz - az,
    });
    const minX = Math.floor(Math.min(ax, bx, cx) / SURFACE_CELL);
    const maxX = Math.floor(Math.max(ax, bx, cx) / SURFACE_CELL);
    const minY = Math.floor(Math.min(ay, by, cy) / SURFACE_CELL);
    const maxY = Math.floor(Math.max(ay, by, cy) / SURFACE_CELL);
    const minZ = Math.floor(Math.min(az, bz, cz) / SURFACE_CELL);
    const maxZ = Math.floor(Math.max(az, bz, cz) / SURFACE_CELL);
    for (let ix = minX; ix <= maxX; ix += 1) {
      for (let iy = minY; iy <= maxY; iy += 1) {
        for (let iz = minZ; iz <= maxZ; iz += 1) {
          const key = `${ix},${iy},${iz}`;
          const bucket = grid.get(key);
          if (bucket) bucket.push(index);
          else grid.set(key, [index]);
        }
      }
    }
  };

  if (indices && indices.length >= 3) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      push(indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3);
    }
  } else {
    for (let i = 0; i + 8 < positions.length; i += 9) push(i, i + 3, i + 6);
  }

  return {
    distanceSq(x, y, z) {
      const cx = Math.floor(x / SURFACE_CELL);
      const cy = Math.floor(y / SURFACE_CELL);
      const cz = Math.floor(z / SURFACE_CELL);
      let best = Number.POSITIVE_INFINITY;
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let oz = -1; oz <= 1; oz += 1) {
            const bucket = grid.get(`${cx + ox},${cy + oy},${cz + oz}`);
            if (!bucket) continue;
            for (const index of bucket) {
              const distance = pointTriangleDistanceSq(x, y, z, tris[index]);
              if (distance < best) best = distance;
            }
          }
        }
      }
      return best;
    },
  };
}

function crossing(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  surface: MeshSurfaceIndex,
  limitSq: number,
  fromOnSurface: boolean,
) {
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 8; step += 1) {
    const mid = (lo + hi) / 2;
    const x = ax + (bx - ax) * mid;
    const y = ay + (by - ay) * mid;
    const z = az + (bz - az) * mid;
    const on = surface.distanceSq(x, y, z) <= limitSq;
    if (on === fromOnSurface) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t];
}

/** Polylines (possibly several, if the line leaves the solid and comes back). */
export function clipPolylineToSurface(points: number[], surface: MeshSurfaceIndex, tolerance: number): number[][] {
  const count = Math.floor(points.length / 3);
  if (count < 2) return [];
  const limitSq = tolerance * tolerance;
  const samples: Array<{ x: number; y: number; z: number; on: boolean }> = [];
  const pushSample = (x: number, y: number, z: number) => {
    const previous = samples[samples.length - 1];
    if (previous && Math.hypot(x - previous.x, y - previous.y, z - previous.z) < 1e-6) return;
    samples.push({ x, y, z, on: surface.distanceSq(x, y, z) <= limitSq });
  };

  for (let index = 0; index + 1 < count; index += 1) {
    const ax = points[index * 3];
    const ay = points[index * 3 + 1];
    const az = points[index * 3 + 2];
    const bx = points[(index + 1) * 3];
    const by = points[(index + 1) * 3 + 1];
    const bz = points[(index + 1) * 3 + 2];
    const length = Math.hypot(bx - ax, by - ay, bz - az);
    const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      pushSample(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
    }
  }

  if (samples.length >= 2 && samples.every((sample) => sample.on)) return [points];

  const runs: number[][] = [];
  let run: number[] | null = null;
  const finish = () => {
    if (run && run.length >= 6) runs.push(run);
    run = null;
  };
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const previous = index > 0 ? samples[index - 1] : null;
    if (sample.on) {
      if (!run) {
        run = previous && !previous.on
          ? crossing(previous.x, previous.y, previous.z, sample.x, sample.y, sample.z, surface, limitSq, false)
          : [];
      }
      run.push(sample.x, sample.y, sample.z);
    } else if (run && previous?.on) {
      run.push(...crossing(previous.x, previous.y, previous.z, sample.x, sample.y, sample.z, surface, limitSq, true));
      finish();
    }
  }
  finish();
  return runs;
}
