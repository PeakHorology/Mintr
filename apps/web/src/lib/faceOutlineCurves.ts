import type { FaceVec2 } from "@/lib/faceOutline";
import type { SketchPoint, SketchSegment } from "@/types/sketchforge";

/**
 * A point that turns less than this lies on a sampled curve. The kernel samples face
 * outlines at no more than about 6 degrees a step, and rounded corners use 10, so a real
 * corner (a box's 90, a crescent's tip) sits well above it.
 */
const CURVE_TURN = (14 * Math.PI) / 180;
/** A segment this many times longer than the curve samples beside it is a real straight edge. */
const STRAIGHT_RATIO = 2.5;
/** Fewer curved segments in a row than this is a shallow corner between straight edges, not a curve. */
const MIN_RUN = 3;

type Vec = { x: number; z: number };

function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, z: a.z - b.z };
}

function unit(a: Vec): Vec {
  const length = Math.hypot(a.x, a.z);
  return length > 1e-12 ? { x: a.x / length, z: a.z / length } : { x: 0, z: 0 };
}

function dot(a: Vec, b: Vec) {
  return a.x * b.x + a.z * b.z;
}

/** `t` mirrored across the chord direction `c`: the end tangent of a circular arc, given the other end. */
function mirrorAcross(t: Vec, c: Vec): Vec {
  const along = 2 * dot(t, c);
  return unit({ x: c.x * along - t.x, z: c.z * along - t.z });
}

/**
 * Turns a face outline sampled from a curved edge back into smooth curves.
 * Runs of small, even turns become Bézier segments through the samples, with handles along
 * the curve's tangent, so a fillet, slot end or crescent hollow pads and pockets smooth.
 * Real corners stay sharp, and a long edge between curves stays straight and tangent to them.
 * Returns null when nothing in the loop looks like a sampled curve.
 */
export function smoothFaceLoop(
  loop: readonly FaceVec2[],
  makeId: (kind: "point" | "segment", index: number) => string,
): { points: SketchPoint[]; segments: SketchSegment[] } | null {
  const count = loop.length;
  if (count < 4) return null;
  const at = (index: number) => loop[((index % count) + count) % count];
  const lengths: number[] = [];
  const directions: Vec[] = [];
  for (let index = 0; index < count; index += 1) {
    const step = sub(at(index + 1), at(index));
    lengths.push(Math.hypot(step.x, step.z));
    directions.push(unit(step));
  }
  const wrap = (index: number) => ((index % count) + count) % count;
  // Turn at each point, between the segment arriving and the segment leaving.
  const onCurve = loop.map((_, index) => {
    const before = directions[wrap(index - 1)];
    const after = directions[index];
    if (lengths[wrap(index - 1)] < 1e-9 || lengths[index] < 1e-9) return false;
    const turn = Math.atan2(before.x * after.z - before.z * after.x, dot(before, after));
    return Math.abs(turn) < CURVE_TURN;
  });
  // A segment is part of a curve when a curve point is at either end and it is not much
  // longer than the curve samples on that side.
  let curved = loop.map((_, index) => {
    const beside: number[] = [];
    if (onCurve[index]) beside.push(lengths[wrap(index - 1)]);
    if (onCurve[wrap(index + 1)]) beside.push(lengths[wrap(index + 1)]);
    return beside.length > 0 && lengths[index] <= STRAIGHT_RATIO * Math.min(...beside) && lengths[index] > 1e-9;
  });
  // Keep only runs long enough to be a curve. Joining a run needs a smooth point between segments.
  const runLength = new Array<number>(count).fill(0);
  const visited = new Array<boolean>(count).fill(false);
  for (let start = 0; start < count; start += 1) {
    if (!curved[start] || visited[start]) continue;
    // Walk back to the first segment of this run.
    let first = start;
    let guard = 0;
    while (curved[wrap(first - 1)] && onCurve[first] && guard < count) {
      first = wrap(first - 1);
      guard += 1;
    }
    const members: number[] = [];
    let index = first;
    do {
      members.push(index);
      visited[index] = true;
      const next = wrap(index + 1);
      if (!curved[next] || !onCurve[next] || next === first) break;
      index = next;
    } while (members.length < count);
    members.forEach((member) => {
      runLength[member] = members.length;
    });
  }
  curved = curved.map((value, index) => value && runLength[index] >= MIN_RUN);
  if (!curved.some(Boolean)) return null;

  // Tangent where the curve passes smoothly through a point.
  const tangent: (Vec | null)[] = loop.map((_, index) => {
    const inCurved = curved[wrap(index - 1)];
    const outCurved = curved[index];
    if (!onCurve[index] || (!inCurved && !outCurved)) return null;
    // Next to a straight edge, the curve leaves along that edge.
    if (inCurved && !outCurved) return directions[index];
    if (!inCurved && outCurved) return directions[wrap(index - 1)];
    return unit({
      x: directions[wrap(index - 1)].x + directions[index].x,
      z: directions[wrap(index - 1)].z + directions[index].z,
    });
  });

  const points: SketchPoint[] = loop.map((point, index) => ({
    id: makeId("point", index),
    x: point.x,
    z: point.z,
    mode: tangent[index] ? "smooth" : "corner",
  }));
  const segments: SketchSegment[] = loop.map((_, index) => ({
    id: makeId("segment", index),
    startId: points[index].id,
    endId: points[wrap(index + 1)].id,
    kind: curved[index] ? "bezier" : "line",
  }));
  loop.forEach((_, index) => {
    if (!curved[index]) return;
    const start = at(index);
    const end = at(index + 1);
    const chord = directions[index];
    const third = lengths[index] / 3;
    // At a corner (a crescent's tip) the curve keeps the bend it had, mirrored from the far end.
    const startTangent = tangent[index] ?? (tangent[wrap(index + 1)] ? mirrorAcross(tangent[wrap(index + 1)]!, chord) : chord);
    const endTangent = tangent[wrap(index + 1)] ?? (tangent[index] ? mirrorAcross(tangent[index]!, chord) : chord);
    points[index].handleOut = { x: start.x + startTangent.x * third, z: start.z + startTangent.z * third };
    points[wrap(index + 1)].handleIn = { x: end.x - endTangent.x * third, z: end.z - endTangent.z * third };
  });
  return { points, segments };
}
