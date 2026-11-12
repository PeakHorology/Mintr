/**
 * The lines drawn where a mesh part's faces meet at an angle.
 *
 * Three's EdgesGeometry draws every edge that only one triangle uses. A mesh from Split or a
 * boolean often has T-junctions: a corner of one triangle sitting part way along another's
 * edge. Those edges are used once, so a flat face drew a fan of lines across it. Very thin
 * triangles (slivers) did the same: their normal is mostly rounding error.
 *
 * Here an edge used once is matched with the edge it lies along on the other side, and it is
 * drawn only when the faces either side really meet at an angle. A sliver takes the normal of
 * the triangle across its longest edge, which is the face it lies in.
 */

type Vec3 = [number, number, number];

/** Below this, area over longest edge squared, a triangle's own normal is not trusted. */
const SLIVER_QUALITY = 0.01;
/** Open edges above this are drawn as they are; matching them all would be slow. */
const MAX_OPEN_EDGES_TO_MATCH = 6000;

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(a: Vec3) {
  return Math.hypot(a[0], a[1], a[2]);
}

/**
 * Line segments (x, y, z pairs) for the creases of a triangle mesh, at `thresholdDegrees` like
 * EdgesGeometry. `indices` may be omitted for a plain list of triangles.
 */
export function meshCreaseEdges(positions: ArrayLike<number>, indices: ArrayLike<number> | null | undefined, thresholdDegrees: number): Float32Array {
  const vertexCount = Math.floor(positions.length / 3);
  const corner = (vertex: number): Vec3 => [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const triangleCount = Math.floor((indices ? indices.length : vertexCount) / 3);
  const read = (index: number) => (indices ? indices[index] : index);

  // Corners at the same place are the same corner, as EdgesGeometry treats them.
  const ids = new Map<string, number>();
  const points: Vec3[] = [];
  const idOf = (vertex: number) => {
    const point = corner(vertex);
    const key = `${Math.round(point[0] * 1e4)},${Math.round(point[1] * 1e4)},${Math.round(point[2] * 1e4)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = points.length;
      ids.set(key, id);
      points.push(point);
    }
    return id;
  };

  const triangles: Array<{ corners: [number, number, number]; normal: Vec3; sliver: boolean; longest: number }> = [];
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const cornersOf: [number, number, number] = [idOf(read(triangle * 3)), idOf(read(triangle * 3 + 1)), idOf(read(triangle * 3 + 2))];
    if (cornersOf[0] === cornersOf[1] || cornersOf[1] === cornersOf[2] || cornersOf[0] === cornersOf[2]) continue;
    const [a, b, c] = cornersOf.map((id) => points[id]);
    const area = cross(sub(b, a), sub(c, a));
    const size = length(area);
    const sides = [length(sub(b, a)), length(sub(c, b)), length(sub(a, c))];
    const longestSide = Math.max(...sides);
    triangles.push({
      corners: cornersOf,
      normal: size > 0 ? [area[0] / size, area[1] / size, area[2] / size] : [0, 0, 0],
      sliver: size <= 0 || size / (longestSide * longestSide) < SLIVER_QUALITY,
      longest: sides.indexOf(longestSide),
    });
  }

  const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edges = new Map<string, { a: number; b: number; faces: number[] }>();
  triangles.forEach((triangle, index) => {
    for (let side = 0; side < 3; side += 1) {
      const a = triangle.corners[side];
      const b = triangle.corners[(side + 1) % 3];
      const key = edgeKey(a, b);
      const edge = edges.get(key);
      if (edge) edge.faces.push(index);
      else edges.set(key, { a, b, faces: [index] });
    }
  });

  // A sliver lies in the face across its longest edge.
  const normalOf = (index: number, seen = 0): Vec3 => {
    const triangle = triangles[index];
    if (!triangle.sliver || seen > 3) return triangle.normal;
    const a = triangle.corners[triangle.longest];
    const b = triangle.corners[(triangle.longest + 1) % 3];
    const edge = edges.get(edgeKey(a, b));
    const neighbour = edge?.faces.find((face) => face !== index);
    return neighbour === undefined ? triangle.normal : normalOf(neighbour, seen + 1);
  };

  // What lies just across an edge used once: a step off its middle, in its own triangle's plane,
  // away from the triangle. Inside another triangle means the edge is inside a face (a
  // T-junction, or corners that do not quite meet); nothing there means a real opening.
  const open = [...edges.values()].filter((edge) => edge.faces.length === 1);
  const across = new Map<number, number[]>();
  if (open.length > 0 && open.length <= MAX_OPEN_EDGES_TO_MATCH) {
    const low: Vec3 = [Infinity, Infinity, Infinity];
    const high: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const point of points) {
      for (let axis = 0; axis < 3; axis += 1) {
        low[axis] = Math.min(low[axis], point[axis]);
        high[axis] = Math.max(high[axis], point[axis]);
      }
    }
    const extent = Math.max(high[0] - low[0], high[1] - low[1], high[2] - low[2], 1e-6);
    const cell = extent / 32;
    const cellOf = (value: number, axis: number) => Math.floor((value - low[axis]) / cell);
    const grid = new Map<string, number[]>();
    triangles.forEach((triangle, index) => {
      const corners = triangle.corners.map((id) => points[id]);
      const from = [0, 1, 2].map((axis) => cellOf(Math.min(...corners.map((corner) => corner[axis])), axis));
      const to = [0, 1, 2].map((axis) => cellOf(Math.max(...corners.map((corner) => corner[axis])), axis));
      for (let x = from[0]; x <= to[0]; x += 1) {
        for (let y = from[1]; y <= to[1]; y += 1) {
          for (let z = from[2]; z <= to[2]; z += 1) {
            const key = `${x},${y},${z}`;
            const list = grid.get(key);
            if (list) list.push(index);
            else grid.set(key, [index]);
          }
        }
      }
    });
    const contains = (index: number, point: Vec3, tolerance: number) => {
      const [a, b, c] = triangles[index].corners.map((id) => points[id]);
      const normal = triangles[index].normal;
      if (Math.abs(dot(sub(point, a), normal)) > tolerance) return false;
      // Inside all three edges: each test is the distance from that edge's line, times its length.
      return [[a, b], [b, c], [c, a]].every(([from, to]) => dot(cross(sub(to, from), sub(point, from)), normal) >= -tolerance * length(sub(to, from)));
    };
    open.forEach((edge, index) => {
      const owner = edge.faces[0];
      const triangle = triangles[owner];
      const ownNormal = normalOf(owner);
      const a = points[edge.a];
      const b = points[edge.b];
      const span = length(sub(b, a));
      if (span <= 0) return;
      const third = points[triangle.corners.find((id) => id !== edge.a && id !== edge.b)!];
      const middle: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      let outward = cross(sub(b, a), ownNormal);
      if (dot(outward, sub(third, middle)) > 0) outward = [-outward[0], -outward[1], -outward[2]];
      const size = length(outward);
      if (size <= 0) return;
      const step = Math.max(1e-4, Math.min(span, extent) * 1e-3);
      const probe: Vec3 = [middle[0] + (outward[0] / size) * step, middle[1] + (outward[1] / size) * step, middle[2] + (outward[2] / size) * step];
      const candidates = grid.get(`${cellOf(probe[0], 0)},${cellOf(probe[1], 1)},${cellOf(probe[2], 2)}`) ?? [];
      const hits = candidates.filter((other) => other !== owner && !triangles[other].sliver && contains(other, probe, step * 0.5));
      if (hits.length) across.set(index, hits);
    });
  }

  const limit = Math.cos((thresholdDegrees * Math.PI) / 180);
  const creased = (faces: number[]) => {
    const normals = faces.map((face) => normalOf(face));
    for (let i = 0; i < normals.length; i += 1) {
      for (let j = i + 1; j < normals.length; j += 1) {
        if (dot(normals[i], normals[j]) < limit) return true;
      }
    }
    return false;
  };

  const out: number[] = [];
  const push = (edge: { a: number; b: number }) => out.push(...points[edge.a], ...points[edge.b]);
  for (const edge of edges.values()) {
    if (edge.faces.length >= 2 && creased(edge.faces)) push(edge);
  }
  open.forEach((edge, index) => {
    const others = across.get(index);
    // A true opening, or nothing matched: draw it, as before.
    if (!others?.length || creased([edge.faces[0], ...others])) push(edge);
  });
  return new Float32Array(out);
}
