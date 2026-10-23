/**
 * Orders the sampled edges of a CAD wire into one loop.
 *
 * OCCT wireframe sampling returns each edge as its own polyline, in whatever
 * order the explorer visits them and in the curve's own direction. Drawing
 * those back to back produces diagonals across the face and a ghost prism
 * that does not match it. This chains the edges end to end so a face outline
 * is a real polygon: ordered, deduplicated, and without a repeated closing point.
 */

type Vec3 = { x: number; y: number; z: number };

const JOIN_TOLERANCE = 1e-3;

function toPoints(flat: ArrayLike<number>): Vec3[] {
  const out: Vec3[] = [];
  for (let index = 0; index + 2 < flat.length; index += 3) {
    const next = { x: flat[index], y: flat[index + 1], z: flat[index + 2] };
    const prev = out[out.length - 1];
    if (prev && distance(prev, next) <= JOIN_TOLERANCE) continue;
    out.push(next);
  }
  return out;
}

function distance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Split an occt-wasm `wireframe()` result into one flat polyline per edge. */
export function edgePolylinesFromWireframe(data: {
  points: ArrayLike<number>;
  edgeGroups: ArrayLike<number>;
}): number[][] {
  const polylines: number[][] = [];
  for (let index = 0; index + 1 < data.edgeGroups.length; index += 3) {
    const start = data.edgeGroups[index];
    const count = data.edgeGroups[index + 1];
    if (count < 6) continue;
    const slice: number[] = [];
    for (let cursor = start; cursor < start + count && cursor < data.points.length; cursor += 1) {
      slice.push(data.points[cursor]);
    }
    if (slice.length >= 6) polylines.push(slice);
  }
  if (polylines.length === 0 && data.points.length >= 6) polylines.push(Array.from(data.points));
  return polylines;
}

/**
 * Chain edge polylines into a single ordered loop. Edges are joined at their
 * nearest endpoints and flipped when sampled against the walk direction.
 * Returns a flat xyz array with no repeated closing point.
 */
export function orderWireLoop(polylines: ArrayLike<number>[], tolerance = JOIN_TOLERANCE): number[] {
  const parts = polylines.map(toPoints).filter((part) => part.length >= 2);
  if (parts.length === 0) return [];
  const used = parts.map(() => false);
  const loop: Vec3[] = [...parts[0]];
  used[0] = true;
  let remaining = parts.length - 1;
  while (remaining > 0) {
    const tail = loop[loop.length - 1];
    let bestIndex = -1;
    let bestReverse = false;
    let bestDistance = Infinity;
    for (let index = 0; index < parts.length; index += 1) {
      if (used[index]) continue;
      const part = parts[index];
      const fromHead = distance(tail, part[0]);
      const fromTail = distance(tail, part[part.length - 1]);
      if (fromHead < bestDistance) {
        bestDistance = fromHead;
        bestIndex = index;
        bestReverse = false;
      }
      if (fromTail < bestDistance) {
        bestDistance = fromTail;
        bestIndex = index;
        bestReverse = true;
      }
    }
    if (bestIndex < 0) break;
    used[bestIndex] = true;
    remaining -= 1;
    const segment = bestReverse ? [...parts[bestIndex]].reverse() : parts[bestIndex];
    for (let index = bestDistance <= tolerance ? 1 : 0; index < segment.length; index += 1) {
      loop.push(segment[index]);
    }
  }
  while (loop.length > 2 && distance(loop[0], loop[loop.length - 1]) <= tolerance) loop.pop();
  const flat: number[] = [];
  for (const point of loop) flat.push(point.x, point.y, point.z);
  return flat;
}
