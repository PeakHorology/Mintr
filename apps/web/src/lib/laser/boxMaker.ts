/**
 * A finger-jointed box cut from one sheet: its panels, flat, with the fingers that
 * lock them together.
 *
 * Think of the box as its walls in 3D. Where two walls meet, their slabs overlap in
 * a strip one sheet thick; at each corner three meet in a cube. Every bit of strip
 * and every corner cube is given to exactly one panel, alternating along each edge,
 * so the panels fill the walls with no gap and no overlap. Each panel is then its
 * face, less the bits given to its neighbours: those are its slots, and the bits it
 * keeps are its fingers.
 *
 * Who keeps what: the corner cubes go to the front and back; along the bottom and
 * top edges the side walls keep the even fingers (so their fingers sit at the
 * ends); along the upright edges the front and back keep the even fingers.
 */

export type BoxSpec = {
  /** Outside size in millimetres: left to right, front to back, and up. */
  width: number;
  depth: number;
  height: number;
  /** Sheet thickness. */
  thickness: number;
  /** About how wide each finger is; the real width divides each edge evenly. */
  finger: number;
  /** A lid, or an open top. */
  lid: boolean;
};

export type BoxPanelName = "Bottom" | "Lid" | "Front" | "Back" | "Left side" | "Right side";

/** A flat panel: its outline from its own corner, x across and y up the panel. */
export type BoxPanel = { name: BoxPanelName; width: number; height: number; outline: [number, number][] };

/** How each piece along an edge comes out: kept to the panel's edge, or cut in by the sheet's thickness. */
type EdgePlan = { cornersKept: boolean; keepEven: boolean | null };

/** An odd number of fingers, so both ends of an edge match. One when the edge is too short for three. */
export function fingerCount(length: number, finger: number, thickness: number) {
  const middle = length - 2 * thickness;
  if (middle <= 0) return 1;
  const count = Math.max(1, Math.round(middle / Math.max(finger, thickness)));
  const odd = count % 2 === 1 ? count : count + 1;
  return middle / odd < thickness ? Math.max(1, odd - 2) : odd;
}

/**
 * One edge of a panel as depths along it: [start, end, depth] for each piece, from
 * the corner it starts at. Corners that go to a neighbour are left out; the panel's
 * outline steps round them.
 */
function edgePieces(length: number, spec: BoxSpec, plan: EdgePlan, joined: boolean): [number, number, number][] {
  const t = spec.thickness;
  const pieces: [number, number, number][] = [];
  if (plan.cornersKept) pieces.push([0, t, 0]);
  const count = joined ? fingerCount(length, spec.finger, t) : 1;
  const size = (length - 2 * t) / count;
  for (let index = 0; index < count; index += 1) {
    const kept = !joined || plan.keepEven === null ? true : (index % 2 === 0) === plan.keepEven;
    pieces.push([t + index * size, t + (index + 1) * size, kept ? 0 : t]);
  }
  if (plan.cornersKept) pieces.push([length - t, length, 0]);
  return pieces;
}

/**
 * A panel's outline. Its edges in order: bottom, right, top, left; each says whether
 * it meets another panel and who keeps the even fingers there.
 */
function panelOutline(
  width: number,
  height: number,
  spec: BoxSpec,
  cornersKept: boolean,
  edges: [{ joined: boolean; keepEven: boolean | null }, { joined: boolean; keepEven: boolean | null }, { joined: boolean; keepEven: boolean | null }, { joined: boolean; keepEven: boolean | null }],
): [number, number][] {
  const t = spec.thickness;
  // Along each edge: where it starts, which way it runs, and which way is in.
  const frames: { origin: [number, number]; along: [number, number]; inward: [number, number]; length: number }[] = [
    { origin: [0, 0], along: [1, 0], inward: [0, 1], length: width },
    { origin: [width, 0], along: [0, 1], inward: [-1, 0], length: height },
    { origin: [width, height], along: [-1, 0], inward: [0, -1], length: width },
    { origin: [0, height], along: [0, -1], inward: [1, 0], length: height },
  ];
  const corners: [number, number][] = [[t, t], [width - t, t], [width - t, height - t], [t, height - t]];
  const points: [number, number][] = [];
  frames.forEach((frame, index) => {
    const edge = edges[index];
    // A corner given away is a square notch: the outline passes through its inner point.
    if (!cornersKept) points.push(corners[index]);
    // A free edge keeps its corners only if the panel does; its middle is straight.
    const pieces = edgePieces(frame.length, spec, { cornersKept, keepEven: edge.keepEven }, edge.joined);
    for (const [from, to, depth] of pieces) {
      for (const at of [from, to]) {
        points.push([
          frame.origin[0] + frame.along[0] * at + frame.inward[0] * depth,
          frame.origin[1] + frame.along[1] * at + frame.inward[1] * depth,
        ]);
      }
    }
  });
  return cleanOutline(points);
}

/** Drops repeated points and points in the middle of a straight run. */
function cleanOutline(points: [number, number][]): [number, number][] {
  const close = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  const unique = points.filter((point, index) => !close(point, points[(index + points.length - 1) % points.length]));
  return unique.filter((point, index) => {
    const before = unique[(index + unique.length - 1) % unique.length];
    const after = unique[(index + 1) % unique.length];
    const cross = (point[0] - before[0]) * (after[1] - point[1]) - (point[1] - before[1]) * (after[0] - point[0]);
    return Math.abs(cross) > 1e-9;
  });
}

export const MIN_BOX_SIDE_SHEETS = 3;

/** Why a box cannot be made, or null when it can. */
export function boxSpecProblem(spec: BoxSpec): string | null {
  const values = [spec.width, spec.depth, spec.height, spec.thickness, spec.finger];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return "Every size needs to be more than 0.";
  const smallest = MIN_BOX_SIDE_SHEETS * spec.thickness;
  if (Math.min(spec.width, spec.depth, spec.height) < smallest) {
    return `Each side needs to be at least ${Number(smallest.toFixed(2))} mm, three times the sheet.`;
  }
  return null;
}

/** The box's flat panels. */
export function boxPanels(spec: BoxSpec): BoxPanel[] {
  const { width: W, depth: D, height: H } = spec;
  const top = spec.lid;
  // Edges in order bottom, right, top, left, as each panel lies flat with its outside up.
  const face = (name: BoxPanelName, width: number, height: number, cornersKept: boolean, edges: Parameters<typeof panelOutline>[4]): BoxPanel => ({
    name,
    width,
    height,
    outline: panelOutline(width, height, spec, cornersKept, edges),
  });
  const joined = (keepEven: boolean) => ({ joined: true, keepEven });
  const free = { joined: false, keepEven: null };
  const wallTop = top ? joined(true) : free;
  // Front and back keep the corners and the even fingers all round.
  const frontBack = (name: BoxPanelName) => face(name, W, H, true, [joined(true), joined(true), wallTop, joined(true)]);
  // The sides keep the even fingers top and bottom, and give the even ones to the front and back.
  const side = (name: BoxPanelName) => face(name, D, H, false, [joined(true), joined(false), wallTop, joined(false)]);
  // Bottom and lid keep the odd fingers all round.
  const plate = (name: BoxPanelName) => face(name, W, D, false, [joined(false), joined(false), joined(false), joined(false)]);
  const panels = [plate("Bottom"), frontBack("Front"), frontBack("Back"), side("Left side"), side("Right side")];
  if (top) panels.splice(1, 0, plate("Lid"));
  return panels;
}

export type PlacedPanel = BoxPanel & { x: number; z: number };

/**
 * The panels laid flat in rows, a gap apart, centred on a point: their outlines in
 * workplane millimetres, x to the right and z toward the front.
 */
export function layOutPanels(panels: readonly BoxPanel[], options: { gap?: number; rowWidth?: number; centerX?: number; centerZ?: number } = {}): PlacedPanel[] {
  const gap = options.gap ?? 5;
  const rowWidth = options.rowWidth ?? Math.max(...panels.map((panel) => panel.width)) * 2 + gap;
  const placed: PlacedPanel[] = [];
  let x = 0;
  let z = 0;
  let rowDepth = 0;
  for (const panel of panels) {
    if (x > 0 && x + panel.width > rowWidth) {
      x = 0;
      z += rowDepth + gap;
      rowDepth = 0;
    }
    placed.push({ ...panel, x: x + panel.width / 2, z: z + panel.height / 2 });
    x += panel.width + gap;
    rowDepth = Math.max(rowDepth, panel.height);
  }
  const maxX = Math.max(...placed.map((panel) => panel.x + panel.width / 2));
  const maxZ = Math.max(...placed.map((panel) => panel.z + panel.height / 2));
  const shiftX = (options.centerX ?? 0) - maxX / 2;
  const shiftZ = (options.centerZ ?? 0) - maxZ / 2;
  return placed.map((panel) => ({ ...panel, x: panel.x + shiftX, z: panel.z + shiftZ }));
}

/** A panel's outline where it lies: centred on its place, with the panel's y running toward the back. */
export function placedOutline(panel: PlacedPanel): [number, number][] {
  return panel.outline.map(([x, y]) => [panel.x - panel.width / 2 + x, panel.z + panel.height / 2 - y]);
}
