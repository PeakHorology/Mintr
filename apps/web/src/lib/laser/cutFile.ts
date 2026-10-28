import type { ManifoldToplevel, SimplePolygon, Vec2 } from "manifold-3d";
import type { MeshData } from "@/lib/editorShapeMesh";
import type { CutFileStyle } from "@/lib/laserMachine";

/**
 * Cut files for a laser: each part's outline as seen from above, marked cut, score
 * or engrave, at true size in millimetres.
 *
 * The outline is the part's silhouette, the union of its upward-facing triangles
 * flattened onto the bed. On a closed solid every point inside the silhouette sits
 * under an upward face, so this is exactly what a cut straight down through the
 * sheet leaves: holes that go all the way through come out as cuts, and pockets
 * that stop part way are not cut at all. It also needs no clean triangles, so cut
 * edges inside a face never show up as lines.
 */

export type LaserJob = "cut" | "score" | "engrave";

export const LASER_JOB_LABEL: Record<LaserJob, string> = {
  cut: "Cut",
  score: "Score",
  engrave: "Engrave",
};

/** What each job looks like in a cut file. LightBurn, xTool and Glowforge all read these. */
export const LASER_JOB_COLOR: Record<LaserJob, string> = {
  cut: "#FF0000",
  score: "#0000FF",
  engrave: "#000000",
};

export type CutPart = { name: string; job: LaserJob; mesh: MeshData };

/** A drawn path, in bed millimetres: x to the right, y toward the front. */
export type CutPath = { points: Vec2[]; closed: boolean };

export type CutLayout = {
  /** Lines to cut through, inside ones first so a part never drops out before its holes are cut. */
  cut: CutPath[];
  score: CutPath[];
  /** Areas to fill, as closed outlines; a hole inside an outline is left unfilled. */
  engrave: Vec2[][];
  /** The area all of it covers. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Total length of the cut and score lines, in millimetres. */
  cutLength: number;
  scoreLength: number;
  /** Parts that left nothing to cut, such as a part seen edge on. */
  skipped: string[];
};

export type CutLayoutOptions = {
  /** Width the beam burns away. Cut lines move out by half of it, so parts come out the size drawn. */
  kerfMm?: number;
};

const UP = 1e-6;
const SNAP = 1000;

function shoelace(points: readonly Vec2[]) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    area += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  return area / 2;
}

/** The part's footprint from above, as flat triangles turned all one way. */
function footprintTriangles(mesh: MeshData): SimplePolygon[] {
  const triangles: SimplePolygon[] = [];
  for (const [a, b, c] of mesh.faces) {
    const pa = mesh.vertices[a];
    const pb = mesh.vertices[b];
    const pc = mesh.vertices[c];
    if (!pa || !pb || !pc) continue;
    // Upward when the normal's y is positive: (b - a) × (c - a), y part.
    const ny = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
    if (ny <= UP) continue;
    const ta: Vec2 = [pa[0], pa[2]];
    const tb: Vec2 = [pb[0], pb[2]];
    const tc: Vec2 = [pc[0], pc[2]];
    // Positive filling counts only counter-clockwise areas, so every triangle is turned that way.
    triangles.push(shoelace([ta, tb, tc]) > 0 ? [ta, tb, tc] : [ta, tc, tb]);
  }
  return triangles;
}

function pathLength(points: readonly Vec2[], closed: boolean) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  if (closed && points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    length += Math.hypot(first[0] - last[0], first[1] - last[1]);
  }
  return length;
}

function key(point: Vec2) {
  return `${Math.round(point[0] * SNAP)},${Math.round(point[1] * SNAP)}`;
}

/**
 * Lines from every outline, each drawn once. Two parts that touch share an edge;
 * cutting it twice burns the edge, so the shared edge is kept once and the rest
 * is joined back into as few paths as it can.
 */
function joinOnce(loops: readonly Vec2[][]): CutPath[] {
  const segments = new Map<string, [Vec2, Vec2]>();
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const ka = key(a);
      const kb = key(b);
      if (ka === kb) continue;
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!segments.has(id)) segments.set(id, [a, b]);
    }
  }
  // Loops that shared nothing come back as they were.
  if (segments.size === loops.reduce((sum, loop) => sum + loop.length, 0)) {
    return loops.map((loop) => ({ points: loop, closed: true }));
  }
  const byPoint = new Map<string, string[]>();
  for (const [id, [a, b]] of segments) {
    for (const k of [key(a), key(b)]) {
      const list = byPoint.get(k);
      if (list) list.push(id);
      else byPoint.set(k, [id]);
    }
  }
  const used = new Set<string>();
  const paths: CutPath[] = [];
  const nextFrom = (point: Vec2) => (byPoint.get(key(point)) ?? []).find((id) => !used.has(id));
  // Start at loose ends first, so open lines are walked end to end.
  const starts = [...segments.keys()].sort((left, right) => {
    const loose = (id: string) => {
      const [a, b] = segments.get(id)!;
      return Math.min(byPoint.get(key(a))!.length, byPoint.get(key(b))!.length) === 1 ? 0 : 1;
    };
    return loose(left) - loose(right);
  });
  for (const start of starts) {
    if (used.has(start)) continue;
    used.add(start);
    const [a, b] = segments.get(start)!;
    const [first, second] = byPoint.get(key(b))!.length === 1 ? [b, a] : [a, b];
    const points: Vec2[] = [first, second];
    let tail = second;
    for (let guard = 0; guard < segments.size; guard += 1) {
      const id = nextFrom(tail);
      if (!id) break;
      used.add(id);
      const [p, q] = segments.get(id)!;
      tail = key(p) === key(tail) ? q : p;
      points.push(tail);
    }
    const closed = points.length > 3 && key(points[0]) === key(points[points.length - 1]);
    paths.push({ points: closed ? points.slice(0, -1) : points, closed });
  }
  return paths;
}

function boundsOf(points: readonly Vec2[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** Lays out every part's lines and areas. Needs Manifold for the outlines. */
export function buildCutLayout(runtime: ManifoldToplevel, parts: readonly CutPart[], options: CutLayoutOptions = {}): CutLayout {
  const kerf = Math.max(0, options.kerfMm ?? 0);
  const cutLoops: Vec2[][] = [];
  const scoreLoops: Vec2[][] = [];
  const engraveShapes: SimplePolygon[] = [];
  const skipped: string[] = [];
  for (const part of parts) {
    const triangles = footprintTriangles(part.mesh);
    if (triangles.length === 0) {
      skipped.push(part.name);
      continue;
    }
    let outline = new runtime.CrossSection(triangles, "Positive");
    // Points closer than a hundredth of a millimetre are one point to any laser.
    const simple = outline.simplify(0.005);
    outline.delete();
    outline = simple;
    // Cut lines move out by half the kerf so the part keeps its size. The edge of a hole moves into the hole,
    // so the hole comes out the size drawn too.
    // Round corners are right: that is the path the centre of a round beam takes round a sharp corner.
    if (part.job === "cut" && kerf > 0) {
      const grown = outline.offset(kerf / 2, "Round", 2, 32);
      outline.delete();
      outline = grown;
    }
    const loops = outline.toPolygons().map((loop) => loop.map(([x, y]) => [x, y] as Vec2)).filter((loop) => loop.length >= 3 && Math.abs(shoelace(loop)) > 1e-6);
    outline.delete();
    if (loops.length === 0) {
      skipped.push(part.name);
      continue;
    }
    if (part.job === "cut") cutLoops.push(...loops);
    else if (part.job === "score") scoreLoops.push(...loops);
    else engraveShapes.push(...loops);
  }
  let engrave: Vec2[][] = [];
  if (engraveShapes.length > 0) {
    // Overlapping areas engrave once.
    const merged = new runtime.CrossSection(engraveShapes, "NonZero");
    engrave = merged.toPolygons().map((loop) => loop.map(([x, y]) => [x, y] as Vec2));
    merged.delete();
  }
  // Inside lines first: small outlines before the big ones that hold them.
  const bySize = (left: CutPath, right: CutPath) => {
    const size = (path: CutPath) => {
      const box = boundsOf(path.points);
      return (box.maxX - box.minX) * (box.maxY - box.minY);
    };
    return size(left) - size(right);
  };
  const cut = joinOnce(cutLoops).sort(bySize);
  const score = joinOnce(scoreLoops).sort(bySize);
  const all = [...cut.flatMap((path) => path.points), ...score.flatMap((path) => path.points), ...engrave.flat()];
  return {
    cut,
    score,
    engrave,
    bounds: all.length > 0 ? boundsOf(all) : null,
    cutLength: cut.reduce((sum, path) => sum + pathLength(path.points, path.closed), 0),
    scoreLength: score.reduce((sum, path) => sum + pathLength(path.points, path.closed), 0),
    skipped,
  };
}

const MARGIN_MM = 1;
/** Thin enough that every laser program reads it as a line to follow, not an area to fill. */
const HAIRLINE_MM = 0.1;

function round(value: number) {
  return Number(value.toFixed(3));
}

function escapeXml(text: string) {
  return text.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);
}

function pathData(points: readonly Vec2[], closed: boolean, shiftX: number, shiftY: number) {
  const parts = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${round(x - shiftX)} ${round(y - shiftY)}`);
  return `${parts.join(" ")}${closed ? " Z" : ""}`;
}

const STYLE_NOTE: Record<CutFileStyle, string> = {
  lightburn: "Red cuts, blue scores, black engraves. Each colour opens on its own layer.",
  xtool: "Groups named Cut, Score and Engrave. Click a group to give it its setting.",
  glowforge: "Red cuts, blue scores, black engraves. The Glowforge app makes a step for each colour.",
};

/**
 * The layout as an SVG at true size. Every program reads millimetres from the
 * width and height. The groups are named for the job, and the colours are the
 * ones LightBurn and Glowforge sort by.
 */
export function cutLayoutSvg(layout: CutLayout, options: { title: string; style: CutFileStyle }): string {
  const bounds = layout.bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const shiftX = bounds.minX - MARGIN_MM;
  const shiftY = bounds.minY - MARGIN_MM;
  const width = round(bounds.maxX - bounds.minX + MARGIN_MM * 2);
  const height = round(bounds.maxY - bounds.minY + MARGIN_MM * 2);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- Made in Mintr. ${STYLE_NOTE[options.style]} -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">`,
    `  <title>${escapeXml(options.title)}</title>`,
  ];
  if (layout.engrave.length > 0) {
    const d = layout.engrave.map((loop) => pathData(loop, true, shiftX, shiftY)).join(" ");
    lines.push(`  <g id="Engrave" fill="${LASER_JOB_COLOR.engrave}" stroke="none">`, `    <path fill-rule="evenodd" data-processing-type="${XTOOL_JOB.engrave}" d="${d}"/>`, "  </g>");
  }
  for (const job of ["score", "cut"] as const) {
    const paths = layout[job];
    if (paths.length === 0) continue;
    lines.push(`  <g id="${LASER_JOB_LABEL[job]}" fill="none" stroke="${LASER_JOB_COLOR[job]}" stroke-width="${HAIRLINE_MM}" stroke-linejoin="round" stroke-linecap="round">`);
    for (const path of paths) lines.push(`    <path data-processing-type="${XTOOL_JOB[job]}" d="${pathData(path.points, path.closed, shiftX, shiftY)}"/>`);
    lines.push("  </g>");
  }
  lines.push("</svg>", "");
  return lines.join("\n");
}

/**
 * xTool Studio sorts an imported SVG only by filled or not, so every line would come
 * in as the same job. It does read a data-processing-type on each shape, which sets
 * that shape's job; other programs ignore the attribute.
 */
const XTOOL_JOB: Record<LaserJob, string> = {
  cut: "VECTOR_CUTTING",
  score: "VECTOR_ENGRAVING",
  engrave: "FILL_VECTOR_ENGRAVING",
};

/** AutoCAD colour numbers: 1 red, 5 blue, 7 black (white on a dark screen). */
const DXF_COLOR: Record<LaserJob, number> = { cut: 1, score: 5, engrave: 7 };

/**
 * The layout as a DXF (the plain R12 kind every laser program opens), one layer
 * per job. DXF counts y upward, so the front of the bed is at the bottom.
 */
export function cutLayoutDxf(layout: CutLayout): string {
  const bounds = layout.bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const out: string[] = [];
  const pair = (code: number, value: string | number) => out.push(String(code), String(value));
  pair(0, "SECTION");
  pair(2, "HEADER");
  pair(9, "$INSUNITS");
  pair(70, 4);
  pair(0, "ENDSEC");
  pair(0, "SECTION");
  pair(2, "TABLES");
  pair(0, "TABLE");
  pair(2, "LAYER");
  pair(70, 3);
  for (const job of ["cut", "score", "engrave"] as const) {
    pair(0, "LAYER");
    pair(2, LASER_JOB_LABEL[job].toUpperCase());
    pair(70, 0);
    pair(62, DXF_COLOR[job]);
    pair(6, "CONTINUOUS");
  }
  pair(0, "ENDTAB");
  pair(0, "ENDSEC");
  pair(0, "SECTION");
  pair(2, "ENTITIES");
  const polyline = (job: LaserJob, points: readonly Vec2[], closed: boolean) => {
    pair(0, "POLYLINE");
    pair(8, LASER_JOB_LABEL[job].toUpperCase());
    pair(62, DXF_COLOR[job]);
    pair(66, 1);
    pair(70, closed ? 1 : 0);
    for (const [x, y] of points) {
      pair(0, "VERTEX");
      pair(8, LASER_JOB_LABEL[job].toUpperCase());
      pair(10, round(x - bounds.minX));
      pair(20, round(bounds.maxY - y));
      pair(30, 0);
    }
    pair(0, "SEQEND");
    pair(8, LASER_JOB_LABEL[job].toUpperCase());
  };
  for (const loop of layout.engrave) polyline("engrave", loop, true);
  for (const path of layout.score) polyline("score", path.points, path.closed);
  for (const path of layout.cut) polyline("cut", path.points, path.closed);
  pair(0, "ENDSEC");
  pair(0, "EOF");
  return `${out.join("\n")}\n`;
}

/** "1.24 m of cutting", for the export panel. */
export function lengthLabel(mm: number) {
  if (mm >= 1000) return `${Number((mm / 1000).toFixed(2))} m`;
  if (mm >= 100) return `${Math.round(mm / 10)} cm`;
  return `${Math.round(mm)} mm`;
}
