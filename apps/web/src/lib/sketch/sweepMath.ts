export type SweepPoint = { x: number; z: number };

export type SweepFrame = {
  origin: { x: number; y: number; z: number };
  uAxis: { x: number; y: number; z: number };
  vAxis: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
};

export type SweepMesh = {
  positions: number[];
  indices: number[];
};

type Vec3 = { x: number; y: number; z: number };

function add(a: Vec3, b: Vec3, scale = 1): Vec3 {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale };
}

function frameVec(frame: SweepFrame, u: number, v: number, normal = 0): Vec3 {
  return {
    x: frame.origin.x + frame.uAxis.x * u + frame.vAxis.x * v + frame.normal.x * normal,
    y: frame.origin.y + frame.uAxis.y * u + frame.vAxis.y * v + frame.normal.y * normal,
    z: frame.origin.z + frame.uAxis.z * u + frame.vAxis.z * v + frame.normal.z * normal,
  };
}

function dedupe(points: SweepPoint[]) {
  const cleaned: SweepPoint[] = [];
  for (const point of points) {
    const previous = cleaned[cleaned.length - 1];
    if (previous && Math.hypot(previous.x - point.x, previous.z - point.z) < 0.05) continue;
    cleaned.push(point);
  }
  if (cleaned.length > 2) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.hypot(first.x - last.x, first.z - last.z) < 0.05) cleaned.pop();
  }
  return cleaned;
}

/**
 * Sweep a closed section along a flat path.
 * Section X runs across the path. Section Z becomes thickness along the plane normal.
 * The section is centered on the path. Straight corners are mitered.
 */
export function buildSweepMesh(
  section: SweepPoint[],
  path: SweepPoint[],
  pathClosed: boolean,
  frame: SweepFrame,
): SweepMesh | null {
  const loop = dedupe(section);
  const spine = dedupe(path);
  if (loop.length < 3 || spine.length < 2) return null;
  let cx = 0;
  let cz = 0;
  for (const point of loop) {
    cx += point.x;
    cz += point.z;
  }
  cx /= loop.length;
  cz /= loop.length;
  const local = loop.map((point) => ({ u: point.x - cx, v: point.z - cz }));

  const tangents: SweepPoint[] = [];
  for (let index = 0; index < spine.length; index += 1) {
    const previous = spine[index === 0 ? (pathClosed ? spine.length - 1 : 0) : index - 1];
    const next = spine[index === spine.length - 1 ? (pathClosed ? 0 : spine.length - 1) : index + 1];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    tangents.push({ x: dx / length, z: dz / length });
  }

  const acrossAt = (index: number) => {
    const incoming = index === 0 && !pathClosed
      ? null
      : spineDirection(spine, (index - 1 + spine.length) % spine.length, index);
    const outgoing = index === spine.length - 1 && !pathClosed
      ? null
      : spineDirection(spine, index, (index + 1) % spine.length);
    const left = (direction: SweepPoint) => ({ x: -direction.z, z: direction.x });
    const nIn = incoming ? left(incoming) : null;
    const nOut = outgoing ? left(outgoing) : null;
    if (nIn && nOut) {
      let mx = nIn.x + nOut.x;
      let mz = nIn.z + nOut.z;
      const span = Math.hypot(mx, mz);
      if (span > 1e-6) {
        mx /= span;
        mz /= span;
        const denom = mx * nOut.x + mz * nOut.z;
        const scale = Math.min(4, Math.max(0.25, 1 / (Math.abs(denom) < 1e-4 ? 1 : denom)));
        return { x: mx, z: mz, scale: Number.isFinite(scale) ? scale : 1 };
      }
    }
    const single = nOut ?? nIn ?? { x: -tangents[index].z, z: tangents[index].x };
    return { x: single.x, z: single.z, scale: 1 };
  };

  const stationCount = spine.length;
  const sectionCount = local.length;
  const positions: number[] = [];
  for (let station = 0; station < stationCount; station += 1) {
    const across = acrossAt(station);
    const at = spine[station];
    for (const point of local) {
      const u = at.x + across.x * point.u * across.scale;
      const v = at.z + across.z * point.u * across.scale;
      const world = frameVec(frame, u, v, point.v);
      positions.push(world.x, world.y, world.z);
    }
  }

  const indices: number[] = [];
  const at = (station: number, vertex: number) => station * sectionCount + vertex;
  const pairs = pathClosed ? stationCount : stationCount - 1;
  for (let station = 0; station < pairs; station += 1) {
    const next = pathClosed ? (station + 1) % stationCount : station + 1;
    for (let vertex = 0; vertex < sectionCount; vertex += 1) {
      const following = (vertex + 1) % sectionCount;
      indices.push(at(station, vertex), at(station, following), at(next, following));
      indices.push(at(station, vertex), at(next, following), at(next, vertex));
    }
  }
  if (!pathClosed) {
    for (let vertex = 1; vertex < sectionCount - 1; vertex += 1) {
      indices.push(at(0, vertex + 1), at(0, vertex), at(0, 0));
      const end = stationCount - 1;
      indices.push(at(end, 0), at(end, vertex), at(end, vertex + 1));
    }
  }
  return { positions, indices };
}

function spineDirection(spine: SweepPoint[], from: number, to: number): SweepPoint {
  const dx = spine[to].x - spine[from].x;
  const dz = spine[to].z - spine[from].z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

export function sweepMeshOpenEdgeCount(mesh: SweepMesh) {
  const counts = new Map<string, number>();
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = [mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangle[edge];
      const b = triangle[(edge + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const count of counts.values()) if (count !== 2) open += 1;
  return open;
}
