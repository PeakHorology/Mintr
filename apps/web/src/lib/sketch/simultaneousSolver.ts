import type { SketchConstraint, SketchDimension, SketchDoc, SketchEntity } from "./types";

/**
 * Mintr's simultaneous sketch solver.
 *
 * Every constraint and driving dimension becomes one or more equations in millimetres whose
 * answer is 0. The free numbers are the x and z of every point that is not fixed, and the radius
 * of every circle that is not fixed. All equations are solved together, a damped Gauss–Newton
 * step at a time, taking the smallest move that satisfies them, so geometry nobody asked to move
 * stays where it was drawn.
 *
 * Afterwards the rank of the equations says how many ways the sketch can still move, and which
 * rules repeat or fight each other.
 */

/** An equation is held when it is this close to 0 (mm). */
export const SOLVE_TOLERANCE = 1e-6;
/** Past this a rule counts as not held when the sketch is checked (mm). */
export const HELD_TOLERANCE = 1e-3;

type Equation = {
  /** The constraint or dimension this comes from. */
  ownerId: string;
  /** The variables it reads, by index. */
  vars: number[];
  value: (x: Float64Array) => number;
};

type PointRef = { x: number; z: number };

export type SimultaneousSolve = {
  /** Point positions after solving, by id. */
  points: Map<string, { x: number; z: number; fixed: boolean }>;
  /** Circle radii after solving, by id. */
  radii: Map<string, number>;
  /** How many ways the sketch can still move. */
  dof: number;
  /** Owners of equations that are not held. */
  unsatisfied: string[];
  /** Owners of equations that only repeat others (fine while they hold). */
  redundant: string[];
  /** Largest equation left over (mm). */
  worst: number;
};

export type SimultaneousSolveOptions = {
  /** Points that should move as little as possible, like the one being dragged. */
  holdPointIds?: Iterable<string>;
  iterations?: number;
};

/** Builds the variables and equations of a sketch. */
class SketchSystem {
  readonly values: number[] = [];
  readonly weights: number[] = [];
  readonly equations: Equation[] = [];
  private readonly pointVars = new Map<string, { xi: number; zi: number } | { fixedAt: PointRef }>();
  private readonly radiusVars = new Map<string, number | { fixedAt: number }>();
  private readonly entities = new Map<string, SketchEntity>();

  constructor(private readonly doc: SketchDoc, fixedIds: Set<string>, holdIds: Set<string>, referenceIds: Set<string>) {
    for (const entity of doc.entities) this.entities.set(entity.id, entity);
    for (const entity of doc.entities) {
      if (entity.kind === "point") {
        if (entity.fixed || fixedIds.has(entity.id)) {
          this.pointVars.set(entity.id, { fixedAt: { x: entity.x, z: entity.z } });
        } else {
          const weight = holdIds.has(entity.id) ? 1e4 : referenceIds.has(entity.id) ? 100 : 1;
          this.pointVars.set(entity.id, { xi: this.addVar(entity.x, weight), zi: this.addVar(entity.z, weight) });
        }
      } else if (entity.kind === "circle") {
        if (entity.fixed || fixedIds.has(entity.id)) this.radiusVars.set(entity.id, { fixedAt: entity.radius });
        else this.radiusVars.set(entity.id, this.addVar(entity.radius, 1));
      }
    }
  }

  private addVar(value: number, weight: number) {
    this.values.push(value);
    this.weights.push(weight);
    return this.values.length - 1;
  }

  entity(id: string | undefined) {
    return id ? this.entities.get(id) : undefined;
  }

  /** Reads a point; `vars` collects which variables it used. */
  point(id: string | undefined): { read: (x: Float64Array) => PointRef; vars: number[] } | null {
    const slot = id ? this.pointVars.get(id) : undefined;
    if (!slot) return null;
    if ("fixedAt" in slot) {
      const at = slot.fixedAt;
      return { read: () => at, vars: [] };
    }
    return { read: (x) => ({ x: x[slot.xi], z: x[slot.zi] }), vars: [slot.xi, slot.zi] };
  }

  line(id: string | undefined) {
    const entity = this.entity(id);
    if (!entity || entity.kind !== "line") return null;
    const a = this.point(entity.startId);
    const b = this.point(entity.endId);
    return a && b ? { a, b, vars: [...a.vars, ...b.vars] } : null;
  }

  /** A circle or arc: its centre and a reader for its radius. */
  round(id: string | undefined): { center: NonNullable<ReturnType<SketchSystem["point"]>>; radius: (x: Float64Array) => number; vars: number[] } | null {
    const entity = this.entity(id);
    if (entity?.kind === "circle") {
      const center = this.point(entity.centerId);
      const slot = this.radiusVars.get(entity.id);
      if (!center || slot === undefined) return null;
      if (typeof slot === "number") return { center, radius: (x) => x[slot], vars: [...center.vars, slot] };
      const fixed = slot.fixedAt;
      return { center, radius: () => fixed, vars: center.vars };
    }
    if (entity?.kind === "arc") {
      const center = this.point(entity.centerId);
      const start = this.point(entity.startId);
      if (!center || !start) return null;
      return {
        center,
        radius: (x) => distance(center.read(x), start.read(x)),
        vars: [...center.vars, ...start.vars],
      };
    }
    return null;
  }

  add(ownerId: string, vars: number[], value: (x: Float64Array) => number) {
    this.equations.push({ ownerId, vars: [...new Set(vars)], value });
  }

  radiusVar(id: string) {
    return this.radiusVars.get(id);
  }

  pointSlot(id: string) {
    return this.pointVars.get(id);
  }

  get document() {
    return this.doc;
  }
}

function distance(a: PointRef, b: PointRef) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Signed distance from p to the line through a and b. */
function lineDistance(p: PointRef, a: PointRef, b: PointRef) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-12) return distance(p, a);
  return ((p.x - a.x) * dz - (p.z - a.z) * dx) / length;
}

/** The points of a constraint: its point ids, and any entity ids that are points. */
function constraintPointIds(system: SketchSystem, constraint: { entityIds: string[]; pointIds?: string[] }) {
  const ids = [...(constraint.pointIds ?? [])];
  for (const id of constraint.entityIds) {
    if (system.entity(id)?.kind === "point" && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function addConstraint(system: SketchSystem, constraint: SketchConstraint, start: Float64Array) {
  const id = constraint.id;
  switch (constraint.kind) {
    case "fix":
      return;
    case "coincident": {
      const pointIds = constraintPointIds(system, constraint);
      const curve = constraint.entityIds.map((entityId) => system.entity(entityId)).find((entity) => entity && entity.kind !== "point");
      if (pointIds.length >= 2) {
        const first = system.point(pointIds[0]);
        if (!first) return;
        for (const otherId of pointIds.slice(1)) {
          const other = system.point(otherId);
          if (!other) continue;
          system.add(id, [...first.vars, ...other.vars], (x) => other.read(x).x - first.read(x).x);
          system.add(id, [...first.vars, ...other.vars], (x) => other.read(x).z - first.read(x).z);
        }
        return;
      }
      // A point on a line or a curve.
      const point = system.point(pointIds[0]);
      if (!point || !curve) return;
      const line = system.line(curve.id);
      if (line) {
        system.add(id, [...point.vars, ...line.vars], (x) => lineDistance(point.read(x), line.a.read(x), line.b.read(x)));
        return;
      }
      const round = system.round(curve.id);
      if (round) {
        system.add(id, [...point.vars, ...round.vars], (x) => distance(point.read(x), round.center.read(x)) - round.radius(x));
      }
      return;
    }
    case "horizontal":
    case "vertical": {
      const line = system.line(constraint.entityIds[0]);
      const pair = line
        ? { a: line.a, b: line.b }
        : constraint.pointIds && constraint.pointIds.length >= 2
          ? { a: system.point(constraint.pointIds[0]), b: system.point(constraint.pointIds[1]) }
          : null;
      if (!pair?.a || !pair.b) return;
      const { a, b } = pair as { a: NonNullable<typeof pair.a>; b: NonNullable<typeof pair.b> };
      system.add(id, [...a.vars, ...b.vars], constraint.kind === "horizontal"
        ? (x) => b.read(x).z - a.read(x).z
        : (x) => b.read(x).x - a.read(x).x);
      return;
    }
    case "parallel":
    case "perpendicular": {
      const first = system.line(constraint.entityIds[0]);
      const second = system.line(constraint.entityIds[1]);
      if (!first || !second) return;
      const parallel = constraint.kind === "parallel";
      system.add(id, [...first.vars, ...second.vars], (x) => {
        const a1 = first.a.read(x);
        const b1 = first.b.read(x);
        const a2 = second.a.read(x);
        const b2 = second.b.read(x);
        const ux = b1.x - a1.x;
        const uz = b1.z - a1.z;
        const vx = b2.x - a2.x;
        const vz = b2.z - a2.z;
        const length = Math.hypot(ux, uz) || 1e-12;
        // How far the second line's end is off the wanted direction, in mm.
        return (parallel ? ux * vz - uz * vx : ux * vx + uz * vz) / length;
      });
      return;
    }
    case "equal": {
      const firstLine = system.line(constraint.entityIds[0]);
      const secondLine = system.line(constraint.entityIds[1]);
      if (firstLine && secondLine) {
        system.add(id, [...firstLine.vars, ...secondLine.vars], (x) =>
          distance(secondLine.a.read(x), secondLine.b.read(x)) - distance(firstLine.a.read(x), firstLine.b.read(x)));
        return;
      }
      const firstRound = system.round(constraint.entityIds[0]);
      const secondRound = system.round(constraint.entityIds[1]);
      if (firstRound && secondRound) {
        system.add(id, [...firstRound.vars, ...secondRound.vars], (x) => secondRound.radius(x) - firstRound.radius(x));
      }
      return;
    }
    case "midpoint": {
      const line = system.line(constraint.entityIds[0]);
      const middle = system.point(constraint.pointIds?.[0]);
      if (!line || !middle) return;
      const vars = [...line.vars, ...middle.vars];
      system.add(id, vars, (x) => middle.read(x).x - (line.a.read(x).x + line.b.read(x).x) / 2);
      system.add(id, vars, (x) => middle.read(x).z - (line.a.read(x).z + line.b.read(x).z) / 2);
      return;
    }
    case "concentric": {
      const centers = constraint.entityIds
        .map((entityId) => {
          const entity = system.entity(entityId);
          return entity && (entity.kind === "circle" || entity.kind === "arc") ? entity.centerId : entityId;
        })
        .map((pointId) => system.point(pointId))
        .filter((point): point is NonNullable<typeof point> => Boolean(point));
      if (centers.length < 2) return;
      const [a, b] = centers;
      system.add(id, [...a.vars, ...b.vars], (x) => b.read(x).x - a.read(x).x);
      system.add(id, [...a.vars, ...b.vars], (x) => b.read(x).z - a.read(x).z);
      return;
    }
    case "tangent": {
      const lineId = constraint.entityIds.find((entityId) => system.entity(entityId)?.kind === "line");
      const roundIds = constraint.entityIds.filter((entityId) => {
        const kind = system.entity(entityId)?.kind;
        return kind === "circle" || kind === "arc";
      });
      const line = system.line(lineId);
      if (line && roundIds[0]) {
        const round = system.round(roundIds[0]);
        if (!round) return;
        system.add(id, [...line.vars, ...round.vars], (x) =>
          Math.abs(lineDistance(round.center.read(x), line.a.read(x), line.b.read(x))) - round.radius(x));
        return;
      }
      if (roundIds.length >= 2) {
        const first = system.round(roundIds[0]);
        const second = system.round(roundIds[1]);
        if (!first || !second) return;
        // Touching from outside, or one inside the other, whichever the drawing is nearer.
        const gap = distance(first.center.read(start), second.center.read(start));
        const r1 = first.radius(start);
        const r2 = second.radius(start);
        const inside = Math.abs(gap - Math.abs(r1 - r2)) < Math.abs(gap - (r1 + r2));
        system.add(id, [...first.vars, ...second.vars], (x) => {
          const between = distance(first.center.read(x), second.center.read(x));
          return inside ? between - Math.abs(first.radius(x) - second.radius(x)) : between - (first.radius(x) + second.radius(x));
        });
      }
      return;
    }
    case "symmetry": {
      const axis = system.line(constraint.entityIds[constraint.entityIds.length - 1]);
      if (!axis) return;
      const pairIds = constraint.pointIds && constraint.pointIds.length >= 2 ? constraint.pointIds.slice(0, 2) : constraint.entityIds.slice(0, 2);
      const mirrorPair = (a: NonNullable<ReturnType<SketchSystem["point"]>>, b: NonNullable<ReturnType<SketchSystem["point"]>>) => {
        const vars = [...a.vars, ...b.vars, ...axis.vars];
        // The middle of the pair sits on the axis, and the pair is square to it.
        system.add(id, vars, (x) => {
          const p = a.read(x);
          const q = b.read(x);
          return lineDistance({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }, axis.a.read(x), axis.b.read(x));
        });
        system.add(id, vars, (x) => {
          const p = a.read(x);
          const q = b.read(x);
          const s = axis.a.read(x);
          const e = axis.b.read(x);
          const length = Math.hypot(e.x - s.x, e.z - s.z) || 1e-12;
          return ((q.x - p.x) * (e.x - s.x) + (q.z - p.z) * (e.z - s.z)) / length;
        });
      };
      const centreOf = (entityId: string) => {
        const entity = system.entity(entityId);
        return system.point(entity && (entity.kind === "circle" || entity.kind === "arc") ? entity.centerId : entityId);
      };
      const a = centreOf(pairIds[0]);
      const b = centreOf(pairIds[1]);
      if (a && b) {
        mirrorPair(a, b);
        return;
      }
      const first = system.line(pairIds[0]);
      const second = system.line(pairIds[1]);
      if (!first || !second) return;
      mirrorPair(first.a, second.a);
      mirrorPair(first.b, second.b);
      return;
    }
    default:
      return;
  }
}

function addDimension(system: SketchSystem, dimension: SketchDimension) {
  const id = dimension.id;
  if (dimension.kind === "linear") {
    const pointIds = dimension.pointIds ?? [];
    if (pointIds.length >= 2) {
      const a = system.point(pointIds[0]);
      const b = system.point(pointIds[1]);
      if (a && b) system.add(id, [...a.vars, ...b.vars], (x) => distance(a.read(x), b.read(x)) - dimension.value);
      return;
    }
    const line = system.line(dimension.entityIds[0]);
    if (!line) return;
    const point = system.point(pointIds[0]);
    if (point) {
      // A point's distance from a line.
      system.add(id, [...point.vars, ...line.vars], (x) => Math.abs(lineDistance(point.read(x), line.a.read(x), line.b.read(x))) - dimension.value);
      return;
    }
    system.add(id, line.vars, (x) => distance(line.a.read(x), line.b.read(x)) - dimension.value);
    return;
  }
  if (dimension.kind === "radius" || dimension.kind === "diameter") {
    const round = system.round(dimension.entityIds[0]);
    const target = dimension.kind === "diameter" ? dimension.value / 2 : dimension.value;
    if (!round || !Number.isFinite(target) || target <= 0) return;
    system.add(id, round.vars, (x) => round.radius(x) - target);
    return;
  }
  if (dimension.kind === "angular" && dimension.entityIds.length >= 2) {
    const first = system.line(dimension.entityIds[0]);
    const second = system.line(dimension.entityIds[1]);
    const firstEntity = system.entity(dimension.entityIds[0]);
    const secondEntity = system.entity(dimension.entityIds[1]);
    if (!first || !second || firstEntity?.kind !== "line" || secondEntity?.kind !== "line") return;
    // Lines that meet are measured from their shared corner outwards, the way the angle reads.
    const firstFlip = firstEntity.endId === secondEntity.startId || firstEntity.endId === secondEntity.endId ? -1 : 1;
    const secondFlip = secondEntity.endId === firstEntity.startId || secondEntity.endId === firstEntity.endId ? -1 : 1;
    const target = (Math.abs(dimension.value) * Math.PI) / 180;
    system.add(id, [...first.vars, ...second.vars], (x) => {
      const a1 = first.a.read(x);
      const b1 = first.b.read(x);
      const a2 = second.a.read(x);
      const b2 = second.b.read(x);
      const ux = (b1.x - a1.x) * firstFlip;
      const uz = (b1.z - a1.z) * firstFlip;
      const vx = (b2.x - a2.x) * secondFlip;
      const vz = (b2.z - a2.z) * secondFlip;
      const angle = Math.abs(Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz));
      // The miss as a distance at the second line's end, in mm.
      return (angle - target) * Math.hypot(vx, vz);
    });
  }
}

/**
 * An angle is reached by swinging the second line round the corner, keeping its length, rather
 * than by the shortest move, which would shorten it. Start the solve from the swung line.
 */
function swingToAngles(system: SketchSystem, x: Float64Array) {
  for (const dimension of system.document.dimensions) {
    if (!dimension.driving || dimension.kind !== "angular" || dimension.entityIds.length < 2) continue;
    const first = system.entity(dimension.entityIds[0]);
    const second = system.entity(dimension.entityIds[1]);
    if (first?.kind !== "line" || second?.kind !== "line") continue;
    const sharedId = [first.startId, first.endId].find((id) => id === second.startId || id === second.endId);
    const pivotId = sharedId ?? second.startId;
    const farId = pivotId === second.startId ? second.endId : second.startId;
    const firstFrom = sharedId === first.endId ? first.endId : first.startId;
    const firstTo = firstFrom === first.startId ? first.endId : first.startId;
    const slots = [pivotId, farId, firstFrom, firstTo].map((id) => system.pointSlot(id));
    if (slots.some((slot) => !slot)) continue;
    const [pivot, far, from, to] = slots as Array<NonNullable<(typeof slots)[number]>>;
    if ("fixedAt" in far) continue;
    const read = (slot: typeof pivot) => ("fixedAt" in slot ? slot.fixedAt : { x: x[slot.xi], z: x[slot.zi] });
    const p = read(pivot);
    const q = read(far);
    const a = read(from);
    const b = read(to);
    const base = Math.atan2(b.z - a.z, b.x - a.x);
    const current = Math.atan2(q.z - p.z, q.x - p.x);
    const length = Math.hypot(q.x - p.x, q.z - p.z);
    if (length < 1e-9) continue;
    let turn = current - base;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    const target = base + (turn < 0 ? -1 : 1) * (Math.abs(dimension.value) * Math.PI) / 180;
    x[far.xi] = p.x + Math.cos(target) * length;
    x[far.zi] = p.z + Math.sin(target) * length;
  }
}

/** A line that has collapsed to a point has no direction to grow along; give it one first. */
function openCollapsedDimensions(system: SketchSystem, x: Float64Array) {
  for (const dimension of system.document.dimensions) {
    if (!dimension.driving || dimension.kind !== "linear" || !(dimension.value > 0)) continue;
    let startId: string | undefined;
    let endId: string | undefined;
    if (dimension.pointIds && dimension.pointIds.length >= 2) [startId, endId] = dimension.pointIds;
    else {
      const line = system.entity(dimension.entityIds[0]);
      if (line?.kind === "line") {
        startId = line.startId;
        endId = line.endId;
      }
    }
    if (!startId || !endId) continue;
    const a = system.pointSlot(startId);
    const b = system.pointSlot(endId);
    if (!a || !b) continue;
    const read = (slot: typeof a) => ("fixedAt" in slot ? slot.fixedAt : { x: x[slot.xi], z: x[slot.zi] });
    if (distance(read(a), read(b)) > 1e-9) continue;
    if (!("fixedAt" in b)) x[b.xi] = read(a).x + dimension.value;
    else if (!("fixedAt" in a)) x[a.xi] = read(b).x - dimension.value;
  }
}

function residuals(equations: readonly Equation[], x: Float64Array) {
  const r = new Float64Array(equations.length);
  for (let i = 0; i < equations.length; i += 1) r[i] = equations[i].value(x);
  return r;
}

function norm(values: Float64Array) {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum);
}

/** The sparse Jacobian as rows of (variable, slope), by central differences. */
function jacobian(equations: readonly Equation[], x: Float64Array) {
  return equations.map((equation) => equation.vars.map((index) => {
    const keep = x[index];
    const step = 1e-7 * Math.max(1, Math.abs(keep));
    x[index] = keep + step;
    const up = equation.value(x);
    x[index] = keep - step;
    const down = equation.value(x);
    x[index] = keep;
    return { index, slope: (up - down) / (2 * step) };
  }));
}

type SparseRow = Array<{ index: number; slope: number }>;

/** Solves the symmetric positive system A y = b in place by Cholesky; false when it is not. */
function choleskySolve(a: Float64Array, b: Float64Array, n: number) {
  for (let j = 0; j < n; j += 1) {
    let diagonal = a[j * n + j];
    for (let k = 0; k < j; k += 1) diagonal -= a[j * n + k] * a[j * n + k];
    if (!(diagonal > 0)) return false;
    const root = Math.sqrt(diagonal);
    a[j * n + j] = root;
    for (let i = j + 1; i < n; i += 1) {
      let value = a[i * n + j];
      for (let k = 0; k < j; k += 1) value -= a[i * n + k] * a[j * n + k];
      a[i * n + j] = value / root;
    }
  }
  for (let i = 0; i < n; i += 1) {
    let value = b[i];
    for (let k = 0; k < i; k += 1) value -= a[i * n + k] * b[k];
    b[i] = value / a[i * n + i];
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    let value = b[i];
    for (let k = i + 1; k < n; k += 1) value -= a[k * n + i] * b[k];
    b[i] = value / a[i * n + i];
  }
  return true;
}

/**
 * The smallest weighted move that cancels the residuals to first order:
 * dx = -W⁻¹ Jᵀ (J W⁻¹ Jᵀ + μ I)⁻¹ r.
 */
function minimumMove(rows: SparseRow[], r: Float64Array, inverseWeights: Float64Array, damping: number, variableCount: number) {
  const m = rows.length;
  const gram = new Float64Array(m * m);
  // Rows only meet where they share a variable.
  const byVariable = new Map<number, Array<{ row: number; slope: number }>>();
  rows.forEach((row, rowIndex) => row.forEach(({ index, slope }) => {
    if (slope === 0) return;
    const list = byVariable.get(index) ?? [];
    list.push({ row: rowIndex, slope });
    byVariable.set(index, list);
  }));
  for (const [index, list] of byVariable) {
    const w = inverseWeights[index];
    for (const first of list) {
      for (const second of list) gram[first.row * m + second.row] += first.slope * second.slope * w;
    }
  }
  for (let i = 0; i < m; i += 1) gram[i * m + i] += damping;
  const y = Float64Array.from(r);
  if (!choleskySolve(gram, y, m)) return null;
  const move = new Float64Array(variableCount);
  rows.forEach((row, rowIndex) => row.forEach(({ index, slope }) => {
    move[index] -= inverseWeights[index] * slope * y[rowIndex];
  }));
  return move;
}

/** Groups equations that share variables, so each part of a sketch solves on its own. */
function connectedGroups(equations: readonly Equation[]) {
  const parent = new Map<number, number>();
  const find = (value: number): number => {
    let root = value;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(value, root);
    return root;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  for (const equation of equations) {
    for (const index of equation.vars) if (!parent.has(index)) parent.set(index, index);
    for (let i = 1; i < equation.vars.length; i += 1) union(equation.vars[0], equation.vars[i]);
  }
  const groups = new Map<number | string, Equation[]>();
  equations.forEach((equation, order) => {
    const key = equation.vars.length ? find(equation.vars[0]) : `fixed-${order}`;
    const list = groups.get(key) ?? [];
    list.push(equation);
    groups.set(key, list);
  });
  return [...groups.values()];
}

function solveGroup(equations: Equation[], x: Float64Array, inverseWeights: Float64Array, iterations: number) {
  let r = residuals(equations, x);
  let size = norm(r);
  let damping = 1e-10;
  for (let iteration = 0; iteration < iterations && size > SOLVE_TOLERANCE * 1e-2; iteration += 1) {
    const rows = jacobian(equations, x);
    let improved = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const move = minimumMove(rows, r, inverseWeights, damping, x.length);
      if (!move) {
        damping = Math.max(damping * 100, 1e-8);
        continue;
      }
      const trial = Float64Array.from(x);
      for (const equation of equations) for (const index of equation.vars) trial[index] = x[index] + move[index];
      const trialR = residuals(equations, trial);
      const trialSize = norm(trialR);
      if (trialSize < size) {
        for (const equation of equations) for (const index of equation.vars) x[index] = trial[index];
        r = trialR;
        size = trialSize;
        damping = Math.max(damping / 10, 1e-12);
        improved = true;
        break;
      }
      damping *= 10;
    }
    if (!improved) break;
  }
}

/**
 * The rank of the equations at the answer, by elimination with column pivoting, and the
 * equations that add nothing to the ones before them.
 */
function rankOf(equations: readonly Equation[], x: Float64Array, inverseWeights: Float64Array) {
  const rows = jacobian(equations, x);
  const basis: Array<Map<number, number>> = [];
  const pivots: number[] = [];
  const dependent: number[] = [];
  rows.forEach((row, rowIndex) => {
    // Scaled so a heavy point does not hide a dependence.
    const vector = new Map<number, number>();
    for (const { index, slope } of row) if (slope !== 0) vector.set(index, slope * Math.sqrt(inverseWeights[index]));
    const scale = Math.max(1e-12, ...[...vector.values()].map(Math.abs));
    basis.forEach((pivotRow, k) => {
      const factor = vector.get(pivots[k]);
      if (!factor) return;
      for (const [index, value] of pivotRow) vector.set(index, (vector.get(index) ?? 0) - factor * value);
    });
    let pivot = -1;
    let largest = 0;
    for (const [index, value] of vector) {
      if (Math.abs(value) > largest) {
        largest = Math.abs(value);
        pivot = index;
      }
    }
    if (pivot < 0 || largest < 1e-7 * scale) {
      dependent.push(rowIndex);
      return;
    }
    const normalised = new Map<number, number>();
    for (const [index, value] of vector) if (Math.abs(value) > 1e-14) normalised.set(index, value / vector.get(pivot)!);
    // Keep the basis reduced so later rows eliminate in one pass.
    basis.forEach((pivotRow) => {
      const factor = pivotRow.get(pivot);
      if (!factor) return;
      for (const [index, value] of normalised) pivotRow.set(index, (pivotRow.get(index) ?? 0) - factor * value);
    });
    basis.push(normalised);
    pivots.push(pivot);
  });
  return { rank: basis.length, dependent };
}

/**
 * Points of the geometry a rule measures from, which should move less than the geometry it
 * moves: the first line of a parallel, square, equal or angle; a symmetry axis; the line a
 * midpoint or tangent circle sits on.
 */
/** Every entity a rule or driving size names, with the points of the lines and arcs among them. */
function pointsUnderRules(doc: SketchDoc, constraints: readonly SketchConstraint[]) {
  const byId = new Map(doc.entities.map((entity) => [entity.id, entity]));
  const ids = new Set<string>();
  const add = (id: string) => {
    ids.add(id);
    const entity = byId.get(id);
    if (entity?.kind === "line") {
      ids.add(entity.startId);
      ids.add(entity.endId);
    } else if (entity?.kind === "arc") {
      ids.add(entity.centerId);
      ids.add(entity.startId);
      ids.add(entity.endId);
    } else if (entity?.kind === "circle") {
      ids.add(entity.centerId);
    }
  };
  for (const rule of [...constraints, ...doc.dimensions.filter((dimension) => dimension.driving)]) {
    rule.entityIds.forEach(add);
    rule.pointIds?.forEach(add);
  }
  return ids;
}

function referencePointIds(doc: SketchDoc, constraints: readonly SketchConstraint[]) {
  const byId = new Map(doc.entities.map((entity) => [entity.id, entity]));
  const ids = new Set<string>();
  const addLine = (id: string | undefined) => {
    const entity = id ? byId.get(id) : undefined;
    if (entity?.kind === "line") {
      ids.add(entity.startId);
      ids.add(entity.endId);
    }
  };
  for (const constraint of constraints) {
    if (constraint.kind === "parallel" || constraint.kind === "perpendicular" || constraint.kind === "equal") addLine(constraint.entityIds[0]);
    else if (constraint.kind === "symmetry") addLine(constraint.entityIds[constraint.entityIds.length - 1]);
    else if (constraint.kind === "midpoint" || constraint.kind === "tangent") constraint.entityIds.forEach(addLine);
  }
  for (const dimension of doc.dimensions) {
    if (dimension.driving && dimension.kind === "angular") addLine(dimension.entityIds[0]);
  }
  return ids;
}

/**
 * Solves a sketch's constraints and driving dimensions all together. The geometry rules measure
 * from, and any held point, first stay exactly still; only when the rules cannot all hold that way
 * may they move too, as little as possible.
 */
export function solveSimultaneously(doc: SketchDoc, options: SimultaneousSolveOptions = {}): SimultaneousSolve {
  const active = doc.constraints.filter((constraint) => !constraint.suppressed);
  const still = new Set([...referencePointIds(doc, active), ...(options.holdPointIds ?? [])]);
  if ((options.iterations ?? 60) > 0 && still.size) {
    const pinned: SketchDoc = {
      ...doc,
      entities: doc.entities.map((entity) => (entity.kind === "point" && still.has(entity.id) && !entity.fixed ? { ...entity, fixed: true } : entity)),
    };
    const first = solveCore(pinned, options);
    if (!first.unsatisfied.length) {
      // Count what can still move with nothing pinned.
      const settled: SketchDoc = {
        ...doc,
        entities: doc.entities.map((entity) => {
          if (entity.kind === "point") {
            const point = first.points.get(entity.id);
            return point ? { ...entity, x: point.x, z: point.z } : entity;
          }
          if (entity.kind === "circle") return { ...entity, radius: first.radii.get(entity.id) ?? entity.radius };
          return entity;
        }),
      };
      return solveCore(settled, { ...options, iterations: 0 });
    }
  }
  return solveCore(doc, options);
}

function solveCore(doc: SketchDoc, options: SimultaneousSolveOptions): SimultaneousSolve {
  const active = doc.constraints.filter((constraint) => !constraint.suppressed);
  const fixedIds = new Set<string>();
  for (const constraint of active) {
    if (constraint.kind !== "fix") continue;
    for (const id of [...constraint.entityIds, ...(constraint.pointIds ?? [])]) {
      fixedIds.add(id);
      const entity = doc.entities.find((entry) => entry.id === id);
      if (entity?.kind === "circle" || entity?.kind === "arc") fixedIds.add(entity.centerId);
      if (entity?.kind === "line" || entity?.kind === "arc") {
        fixedIds.add(entity.startId);
        fixedIds.add(entity.endId);
      }
    }
  }
  const system = new SketchSystem(doc, fixedIds, new Set(options.holdPointIds ?? []), referencePointIds(doc, active));
  const x = Float64Array.from(system.values);
  const start = Float64Array.from(x);
  const inverseWeights = Float64Array.from(system.weights, (weight) => 1 / weight);

  // An arc's ends stay on its circle, once a rule can move them. Nothing else may disturb an arc:
  // a sketch with no rules comes out exactly as it was drawn.
  const ruled = pointsUnderRules(doc, active);
  for (const entity of doc.entities) {
    if (entity.kind !== "arc") continue;
    if (!ruled.has(entity.id) && !ruled.has(entity.centerId) && !ruled.has(entity.startId) && !ruled.has(entity.endId)) continue;
    const center = system.point(entity.centerId);
    const a = system.point(entity.startId);
    const b = system.point(entity.endId);
    if (!center || !a || !b || !(center.vars.length + a.vars.length + b.vars.length)) continue;
    system.add(entity.id, [...center.vars, ...a.vars, ...b.vars], (values) =>
      distance(center.read(values), b.read(values)) - distance(center.read(values), a.read(values)));
  }
  for (const constraint of active) addConstraint(system, constraint, start);
  for (const dimension of doc.dimensions) if (dimension.driving) addDimension(system, dimension);

  const iterations = options.iterations ?? 60;
  if (iterations > 0) {
    openCollapsedDimensions(system, x);
    swingToAngles(system, x);
  }
  const groups = connectedGroups(system.equations);
  for (const group of groups) solveGroup(group, x, inverseWeights, iterations);

  let rank = 0;
  const redundantOwners = new Set<string>();
  for (const group of groups) {
    const result = rankOf(group, x, inverseWeights);
    rank += result.rank;
    for (const row of result.dependent) if (group[row].vars.length) redundantOwners.add(group[row].ownerId);
  }

  const unsatisfied = new Set<string>();
  let worst = 0;
  for (const equation of system.equations) {
    const miss = Math.abs(equation.value(x));
    worst = Math.max(worst, miss);
    if (miss > HELD_TOLERANCE) unsatisfied.add(equation.ownerId);
  }

  const points = new Map<string, { x: number; z: number; fixed: boolean }>();
  const radii = new Map<string, number>();
  for (const entity of doc.entities) {
    if (entity.kind === "point") {
      const slot = system.pointSlot(entity.id);
      if (!slot) continue;
      points.set(entity.id, "fixedAt" in slot
        ? { x: entity.x, z: entity.z, fixed: true }
        : { x: x[slot.xi], z: x[slot.zi], fixed: false });
    } else if (entity.kind === "circle") {
      const slot = system.radiusVar(entity.id);
      // Only a radius a rule changed is held above zero.
      radii.set(entity.id, typeof slot === "number" && x[slot] !== start[slot] ? Math.max(0.01, x[slot]) : entity.radius);
    }
  }

  return {
    points,
    radii,
    dof: Math.max(0, x.length - rank),
    unsatisfied: [...unsatisfied],
    redundant: [...redundantOwners],
    worst,
  };
}
