import { describe, expect, it } from "vitest";
import {
  addConstraints,
  createEmptySketchDoc,
  sketchHasNoRules,
  sketchProfileToDoc,
  solveSketchDoc,
  solveSketchStepwise,
  type SketchDoc,
  type SketchEntity,
} from "@/lib/sketch";
import { solveSimultaneously } from "@/lib/sketch/simultaneousSolver";
import { tracedLoopToSketch } from "@/lib/photoTrace/toSketch";
import { defaultSketchPlane } from "@/lib/sketchPlane";

/**
 * A sketch drawn without Mintr Pro has no rules and no driving sizes. The solver runs for every
 * sketch, so these tests hold it to leaving such a sketch exactly as it was drawn, by the early
 * return and by both solvers underneath it, and to doing so fast enough for a drag.
 */

function docOf(entities: SketchEntity[], id = "fixture"): SketchDoc {
  const doc = createEmptySketchDoc(defaultSketchPlane(), id);
  doc.entities = entities;
  return doc;
}

function rectangle(): SketchDoc {
  return docOf([
    { kind: "point", id: "a", x: 0, z: 0 },
    { kind: "point", id: "b", x: 40.25, z: 0.5 },
    { kind: "point", id: "c", x: 39.75, z: 24.125 },
    { kind: "point", id: "d", x: -0.5, z: 25 },
    { kind: "line", id: "ab", startId: "a", endId: "b" },
    { kind: "line", id: "bc", startId: "b", endId: "c" },
    { kind: "line", id: "cd", startId: "c", endId: "d" },
    { kind: "line", id: "da", startId: "d", endId: "a" },
  ], "rectangle");
}

function circleAndLine(): SketchDoc {
  return docOf([
    { kind: "point", id: "p0", x: 0, z: 0 },
    { kind: "point", id: "p1", x: 20, z: 0.001 },
    { kind: "point", id: "c0", x: 10, z: 8 },
    { kind: "line", id: "l0", startId: "p0", endId: "p1" },
    { kind: "circle", id: "circ0", centerId: "c0", radius: 5.4321 },
    { kind: "circle", id: "tiny", centerId: "p0", radius: 0.004 },
  ], "circle-and-line");
}

/** An arc whose ends are not quite on its circle, as a hand-drawn one can be. */
function looseArc(): SketchDoc {
  return docOf([
    { kind: "point", id: "centre", x: 5, z: 5 },
    { kind: "point", id: "start", x: 15, z: 5 },
    { kind: "point", id: "end", x: 5, z: 14.6 },
    { kind: "arc", id: "arc", centerId: "centre", startId: "start", endId: "end", ccw: true },
    { kind: "point", id: "s0", x: -4, z: 2, handleOut: { x: -2, z: 6 }, mode: "smooth" },
    { kind: "point", id: "s1", x: 3, z: 9, handleIn: { x: 0, z: 9 }, mode: "smooth" },
    { kind: "bezier", id: "curve", startId: "s0", endId: "s1" },
  ], "loose-arc");
}

function fixedAndConstruction(): SketchDoc {
  return docOf([
    { kind: "point", id: "f0", x: 1, z: 1, fixed: true },
    { kind: "point", id: "f1", x: 9, z: 1.2 },
    { kind: "line", id: "guide", startId: "f0", endId: "f1", construction: true },
    { kind: "circle", id: "held", centerId: "f0", radius: 3, fixed: true },
  ], "fixed-and-construction");
}

/** Rules that are switched off and a size that only measures ask nothing of the solver. */
function switchedOffRules(): SketchDoc {
  const doc = rectangle();
  doc.id = "switched-off";
  doc.constraints = [{ id: "h", kind: "horizontal", entityIds: ["ab"], suppressed: true }];
  doc.dimensions = [{ id: "measure", kind: "linear", entityIds: ["ab"], value: 99, driving: false }];
  return doc;
}

/** An outline as Trace from photo makes it: several hundred smooth points round a wobbly blob. */
function tracedOutline(pointCount: number): SketchDoc {
  const at = (index: number) => {
    const angle = (index / pointCount) * Math.PI * 2;
    const radius = 60 + 9 * Math.sin(angle * 7) + 4 * Math.cos(angle * 23);
    return { x: 100 + radius * Math.cos(angle), y: 120 + radius * Math.sin(angle) };
  };
  const pieces = Array.from({ length: pointCount }, (_, index) => {
    const from = at(index);
    const to = at(index + 1);
    return {
      kind: "curve" as const,
      c1: { x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3 + 0.2 },
      c2: { x: from.x + ((to.x - from.x) * 2) / 3, y: from.y + ((to.y - from.y) * 2) / 3 - 0.2 },
      to: index === pointCount - 1 ? at(0) : to,
    };
  });
  let next = 0;
  const made = tracedLoopToSketch({ start: at(0), pieces }, (point) => ({ x: point.x, z: -point.y }), (kind) => `${kind}-${(next += 1)}`, "traced");
  return sketchProfileToDoc({ points: made.points, segments: made.segments, closed: true } as Parameters<typeof sketchProfileToDoc>[0], `traced-${pointCount}`);
}

const fixtures: SketchDoc[] = [
  docOf([], "empty"),
  rectangle(),
  circleAndLine(),
  looseArc(),
  fixedAndConstruction(),
  switchedOffRules(),
  tracedOutline(120),
  tracedOutline(640),
];

function geometry(doc: SketchDoc) {
  return doc.entities.map((entity) => {
    if (entity.kind === "point") return [entity.id, entity.x, entity.z];
    if (entity.kind === "circle") return [entity.id, entity.radius];
    return [entity.id];
  });
}

describe("a sketch with no rules", () => {
  it("makes fixtures of the sizes people draw", () => {
    expect(fixtures.every(sketchHasNoRules)).toBe(true);
    expect(tracedOutline(640).entities.filter((entity) => entity.kind === "point").length).toBeGreaterThan(500);
  });

  for (const fixture of fixtures) {
    it(`comes back exactly as drawn: ${fixture.id}`, () => {
      const before = JSON.stringify(fixture);
      const solved = solveSketchDoc(fixture);
      // The very same points and curves, not copies that happen to match.
      expect(solved.doc.entities).toHaveLength(fixture.entities.length);
      solved.doc.entities.forEach((entity, index) => expect(entity).toBe(fixture.entities[index]));
      expect(solved.doc.dimensions).toEqual(fixture.dimensions);
      expect(solved.doc.constraints).toEqual(fixture.constraints);
      expect(solved.conflicts).toEqual([]);
      // Nothing the caller passed in was touched.
      expect(JSON.stringify(fixture)).toBe(before);
    });

    it(`matches the old step-by-step solver: ${fixture.id}`, () => {
      const stepwise = solveSketchStepwise(fixture, 40);
      expect(geometry(solveSketchDoc(fixture).doc)).toEqual(geometry(stepwise));
    });

    it(`matches the simultaneous solver, and counts the same free moves: ${fixture.id}`, () => {
      const solved = solveSketchDoc(fixture);
      const simultaneous = solveSimultaneously(fixture, { iterations: 60 });
      for (const entity of fixture.entities) {
        if (entity.kind === "point") {
          const point = simultaneous.points.get(entity.id)!;
          expect([point.x, point.z]).toEqual([entity.x, entity.z]);
        } else if (entity.kind === "circle") {
          expect(simultaneous.radii.get(entity.id)).toBe(entity.radius);
        }
      }
      expect(simultaneous.unsatisfied).toEqual([]);
      expect(solved.dof).toBe(simultaneous.dof);
    });
  }

  it("says what it is: empty, movable, or locked when every point is fixed", () => {
    expect(solveSketchDoc(docOf([])).status).toBe("empty");
    expect(solveSketchDoc(rectangle())).toMatchObject({ status: "under-defined", dof: 8 });
    // Two free points and one free radius, with one fixed circle on a fixed point.
    expect(solveSketchDoc(circleAndLine()).dof).toBe(2 * 3 + 2);
    const locked = docOf([
      { kind: "point", id: "a", x: 0, z: 0, fixed: true },
      { kind: "point", id: "b", x: 5, z: 0, fixed: true },
      { kind: "line", id: "ab", startId: "a", endId: "b" },
    ]);
    expect(solveSketchDoc(locked)).toMatchObject({ status: "fully-defined", dof: 0 });
  });

  it("still finds the closed outline to extrude", () => {
    expect(solveSketchDoc(rectangle()).profiles).toHaveLength(1);
  });

  it("keeps holding a dragged point without moving anything", () => {
    const doc = rectangle();
    const solved = solveSketchDoc(doc, undefined, { holdPointIds: ["a", "c"] });
    solved.doc.entities.forEach((entity, index) => expect(entity).toBe(doc.entities[index]));
  });

  it("is solved as before the moment it has a rule", () => {
    const ruled = addConstraints(rectangle(), [{ kind: "horizontal", entityIds: ["ab"] }]);
    expect(sketchHasNoRules(ruled)).toBe(false);
    const solved = solveSketchDoc(ruled);
    const a = solved.doc.entities.find((entity) => entity.id === "a");
    const b = solved.doc.entities.find((entity) => entity.id === "b");
    if (a?.kind !== "point" || b?.kind !== "point") throw new Error("expected points");
    expect(Math.abs(a.z - b.z)).toBeLessThan(1e-6);
    const sized = rectangle();
    sized.dimensions = [{ id: "len", kind: "linear", entityIds: ["ab"], value: 50, driving: true }];
    expect(sketchHasNoRules(sized)).toBe(false);
  });

  it("is quick enough to run on every frame of a drag in a traced sketch", () => {
    const traced = tracedOutline(640);
    solveSketchDoc(traced);
    const runs = 20;
    const started = performance.now();
    for (let run = 0; run < runs; run += 1) solveSketchDoc(traced, undefined, { holdPointIds: ["point-1"] });
    const each = (performance.now() - started) / runs;
    // A frame is 16 ms, and the solve is only one part of what a drag does in it.
    expect(each).toBeLessThan(16);
  });
});
