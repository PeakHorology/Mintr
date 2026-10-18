import { curveStandInOwner } from "@/lib/sketch/migrate";
import type { SketchDoc } from "@/lib/sketch/types";
import type { SketchPoint, SketchProfile, SketchSegment } from "@/types/sketchforge";

/** Silhouette shown on the extrude Join / Cut buttons. Freehand sketches stay the generic plate. */
export type ExtrudeSilhouette =
  | { kind: "sketch" }
  | { kind: "circle" }
  | { kind: "ellipse" }
  | { kind: "square" }
  | { kind: "rectangle"; tall: boolean }
  | { kind: "roundRect" }
  | { kind: "slot"; tall: boolean }
  | { kind: "triangle" }
  | { kind: "polygon"; sides: number }
  | { kind: "star"; tips: number };

function circlePath(cx: number, cy: number, rx: number, ry = rx) {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
}

function polygonPath(sides: number, radius = 26) {
  const count = Math.max(3, Math.min(12, Math.round(sides) || 6));
  const points = Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    return `${32 + Math.cos(angle) * radius} ${32 + Math.sin(angle) * radius}`;
  });
  return `M ${points.join(" L ")} Z`;
}

function starPath(tips: number) {
  const count = Math.max(3, Math.min(12, Math.round(tips) || 5));
  const outer = 28;
  const inner = outer * 0.42;
  const points = Array.from({ length: count * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / count;
    return `${32 + Math.cos(angle) * radius} ${33 + Math.sin(angle) * radius}`;
  });
  return `M ${points.join(" L ")} Z`;
}

/** Icon path in a 64×64 view box. */
export function extrudeSilhouettePath(silhouette: ExtrudeSilhouette) {
  switch (silhouette.kind) {
    case "circle":
      return circlePath(32, 32, 28);
    case "ellipse":
      return circlePath(32, 32, 28, 18);
    case "square":
      return "M8 8 H56 V56 H8 Z";
    case "rectangle":
      return silhouette.tall ? "M18 4 H46 V60 H18 Z" : "M4 18 H60 V46 H4 Z";
    case "roundRect":
      return "M18 8 H46 Q56 8 56 18 V46 Q56 56 46 56 H18 Q8 56 8 46 V18 Q8 8 18 8 Z";
    case "slot":
      return silhouette.tall
        ? "M14 22 V42 A18 18 0 1 0 50 42 V22 A18 18 0 1 0 14 22 Z"
        : "M22 14 H42 A18 18 0 1 1 42 50 H22 A18 18 0 1 1 22 14 Z";
    case "triangle":
      return "M32 6 L58 56 H6 Z";
    case "polygon":
      return polygonPath(silhouette.sides);
    case "star":
      return starPath(silhouette.tips);
    default:
      return "M6 2 H58 Q62 2 62 6 V58 Q62 62 58 62 H6 Q2 62 2 58 V6 Q2 2 6 2 Z";
  }
}

function nearly(a: number, b: number, ratio = 1.08) {
  const high = Math.max(Math.abs(a), Math.abs(b));
  const low = Math.min(Math.abs(a), Math.abs(b));
  if (high < 1e-6) return true;
  return high / Math.max(low, 1e-6) <= ratio;
}

function ringOf(profile: Pick<SketchProfile, "points" | "segments">, segments: SketchSegment[]) {
  if (segments.length < 3) return null;
  const pointById = new Map(profile.points.map((point) => [point.id, point]));
  const unused = new Map<string, Array<{ to: string; kind: SketchSegment["kind"] }>>();
  const degree = new Map<string, number>();
  const link = (from: string, to: string, kind: SketchSegment["kind"]) => {
    const list = unused.get(from) ?? [];
    list.push({ to, kind });
    unused.set(from, list);
    degree.set(from, (degree.get(from) ?? 0) + 1);
  };
  for (const segment of segments) {
    if (!pointById.has(segment.startId) || !pointById.has(segment.endId)) return null;
    link(segment.startId, segment.endId, segment.kind ?? "line");
    link(segment.endId, segment.startId, segment.kind ?? "line");
  }
  if ([...degree.values()].some((count) => count !== 2)) return null;
  const start = segments[0].startId;
  const points: SketchPoint[] = [];
  const kinds: Array<SketchSegment["kind"]> = [];
  let cursor = start;
  let previous = "";
  for (let guard = 0; guard < segments.length; guard += 1) {
    const point = pointById.get(cursor);
    const step = (unused.get(cursor) ?? []).find((candidate) => candidate.to !== previous);
    if (!point || !step) return null;
    points.push(point);
    kinds.push(step.kind ?? "line");
    previous = cursor;
    cursor = step.to;
    if (cursor === start) break;
  }
  if (cursor !== start || points.length !== segments.length) return null;
  return { points, kinds };
}

function edge(from: SketchPoint, to: SketchPoint) {
  return { x: to.x - from.x, z: to.z - from.z, length: Math.hypot(to.x - from.x, to.z - from.z) };
}

function perpendicular(points: SketchPoint[]) {
  for (let index = 0; index < points.length; index += 1) {
    const a = edge(points[index], points[(index + 1) % points.length]);
    const b = edge(points[(index + 1) % points.length], points[(index + 2) % points.length]);
    const dot = Math.abs(a.x * b.x + a.z * b.z);
    if (dot > 0.12 * a.length * b.length) return false;
  }
  return true;
}

function similarLengths(points: SketchPoint[]) {
  const lengths = points.map((point, index) => edge(point, points[(index + 1) % points.length]).length);
  return lengths.every((length) => nearly(length, lengths[0]));
}

function radii(points: SketchPoint[]) {
  const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cz = points.reduce((sum, point) => sum + point.z, 0) / points.length;
  return points.map((point) => Math.hypot(point.x - cx, point.z - cz));
}

function alternatingStar(points: SketchPoint[]) {
  if (points.length < 6 || points.length % 2 !== 0) return null;
  const distance = radii(points);
  const even = distance.filter((_, index) => index % 2 === 0);
  const odd = distance.filter((_, index) => index % 2 === 1);
  const evenSame = even.every((value) => nearly(value, even[0], 1.15));
  const oddSame = odd.every((value) => nearly(value, odd[0], 1.15));
  if (!evenSame || !oddSame) return null;
  const high = Math.max(even[0], odd[0]);
  const low = Math.min(even[0], odd[0]);
  if (high < 1e-6 || low / high > 0.75) return null;
  return points.length / 2;
}

function bounds(points: SketchPoint[]) {
  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...zs) - Math.min(...zs),
  };
}

function kindPattern(kinds: Array<SketchSegment["kind"]>) {
  return kinds.map((kind) => (kind === "line" ? "L" : "B")).join("");
}

/** Pick the draw-tool silhouette when the sketch is still that one shape. */
export function classifySketchExtrude(
  profile: Pick<SketchProfile, "points" | "segments">,
  doc: Pick<SketchDoc, "entities"> | null | undefined,
): ExtrudeSilhouette {
  const circleIds = new Set(
    (doc?.entities ?? [])
      .filter((entity) => entity.kind === "circle" && !entity.construction)
      .map((entity) => entity.id),
  );
  const solid = profile.segments.filter((segment) => {
    if (segment.construction) return false;
    const owner = curveStandInOwner(segment.id);
    return !(owner && circleIds.has(owner));
  });
  if (circleIds.size === 1 && solid.length === 0) return { kind: "circle" };
  if (circleIds.size > 0) return { kind: "sketch" };

  const ring = ringOf(profile, solid);
  if (!ring) return { kind: "sketch" };
  const { points, kinds } = ring;
  const pattern = kindPattern(kinds);
  const lines = kinds.filter((kind) => (kind ?? "line") === "line").length;
  const curves = kinds.length - lines;

  if (lines === 0 && points.length === 4) {
    const box = bounds(points);
    return nearly(box.width, box.depth, 1.12) ? { kind: "circle" } : { kind: "ellipse" };
  }
  if (curves === 0 && lines === 3) return { kind: "triangle" };
  if (curves === 0 && lines === 4 && perpendicular(points)) {
    return similarLengths(points)
      ? { kind: "square" }
      : { kind: "rectangle", tall: bounds(points).depth > bounds(points).width };
  }
  if (curves === 0 && lines >= 5) {
    const tips = alternatingStar(points);
    if (tips) return { kind: "star", tips };
    if (similarLengths(points) && radii(points).every((radius, _, all) => nearly(radius, all[0], 1.12))) {
      return { kind: "polygon", sides: lines };
    }
  }
  if (pattern === "LBLBLBLB" || pattern === "BLBLBLBL") return { kind: "roundRect" };
  if (pattern === "LBBBLB" || pattern === "BBBLBB" || pattern === "LBBLBB") {
    return { kind: "slot", tall: bounds(points).depth > bounds(points).width };
  }
  return { kind: "sketch" };
}
