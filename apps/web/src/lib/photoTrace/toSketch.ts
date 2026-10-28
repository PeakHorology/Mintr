import type { TracePiece, TracePoint } from "@/lib/laser/logoTrace";
import type { SketchPoint, SketchSegment } from "@/types/sketchforge";

/** A closed traced outline: a start point and the curves and lines that run round back to it. */
export type TracedLoop = { start: TracePoint; pieces: TracePiece[] };

/** How far off a straight line, in mm, a point between two lines may sit and still be dropped. */
const STRAIGHT_TOLERANCE = 1e-3;
/** A point where the outline turns less than this is smooth, not a corner. */
const SMOOTH_TURN = (5 * Math.PI) / 180;

/**
 * Turns a traced outline into sketch points and segments: curves stay real curves with
 * their handles, so the outline is smooth and light to edit, and a point in the middle of
 * a straight run is left out. `place` maps a traced point (mm, y down) to the sketch.
 */
export function tracedLoopToSketch(
  loop: TracedLoop,
  place: (point: TracePoint) => { x: number; z: number },
  makeId: (kind: "point" | "edge") => string,
  regionId?: string,
): { points: SketchPoint[]; segments: SketchSegment[] } {
  type Anchor = { at: TracePoint; handleIn?: TracePoint; handleOut?: TracePoint; inCurve: boolean; outCurve: boolean };
  const count = loop.pieces.length;
  if (count < 2) return { points: [], segments: [] };
  // Anchor i starts piece i; the last piece ends back at anchor 0.
  let anchors: Anchor[] = loop.pieces.map((_, index) => ({
    at: index === 0 ? loop.start : loop.pieces[index - 1].to,
    inCurve: false,
    outCurve: false,
  }));
  loop.pieces.forEach((piece, index) => {
    if (piece.kind !== "curve") return;
    const from = anchors[index];
    const to = anchors[(index + 1) % count];
    from.handleOut = piece.c1;
    from.outCurve = true;
    to.handleIn = piece.c2;
    to.inCurve = true;
  });
  // Drop a point in the middle of a straight run: it is only a joint left by the tracer.
  let changed = true;
  while (changed && anchors.length > 3) {
    changed = false;
    for (let index = 0; index < anchors.length && anchors.length > 3; index += 1) {
      const anchor = anchors[index];
      if (anchor.inCurve || anchor.outCurve) continue;
      const before = anchors[(index + anchors.length - 1) % anchors.length].at;
      const after = anchors[(index + 1) % anchors.length].at;
      const length = Math.hypot(after.x - before.x, after.y - before.y);
      if (length === 0) continue;
      const off = Math.abs((anchor.at.x - before.x) * (after.y - before.y) - (anchor.at.y - before.y) * (after.x - before.x)) / length;
      const between = (anchor.at.x - before.x) * (after.x - before.x) + (anchor.at.y - before.y) * (after.y - before.y);
      if (off > STRAIGHT_TOLERANCE || between <= 0 || between >= length * length) continue;
      anchors = anchors.filter((_, other) => other !== index);
      changed = true;
      index -= 1;
    }
  }
  const ids = anchors.map(() => makeId("point"));
  // Smooth where the outline carries straight on through the point, a corner where it turns.
  const smoothAt = (index: number) => {
    const anchor = anchors[index];
    const before = anchor.handleIn ?? anchors[(index + anchors.length - 1) % anchors.length].at;
    const after = anchor.handleOut ?? anchors[(index + 1) % anchors.length].at;
    const inX = anchor.at.x - before.x;
    const inY = anchor.at.y - before.y;
    const outX = after.x - anchor.at.x;
    const outY = after.y - anchor.at.y;
    const lengths = Math.hypot(inX, inY) * Math.hypot(outX, outY);
    return lengths > 0 && (inX * outX + inY * outY) / lengths > Math.cos(SMOOTH_TURN);
  };
  const points: SketchPoint[] = anchors.map((anchor, index) => {
    const at = place(anchor.at);
    const point: SketchPoint = { id: ids[index], x: at.x, z: at.z, mode: (anchor.inCurve || anchor.outCurve) && smoothAt(index) ? "smooth" : "corner" };
    if (anchor.handleIn) point.handleIn = place(anchor.handleIn);
    if (anchor.handleOut) point.handleOut = place(anchor.handleOut);
    return point;
  });
  const segments: SketchSegment[] = anchors.map((anchor, index) => ({
    id: makeId("edge"),
    startId: ids[index],
    endId: ids[(index + 1) % ids.length],
    kind: anchor.outCurve ? "bezier" : "line",
    ...(regionId ? { regionId } : {}),
  }));
  return { points, segments };
}
