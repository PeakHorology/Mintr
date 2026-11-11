import { describe, expect, it } from "vitest";
import {
  addAngularDimension,
  addConstraints,
  angleBetweenSketchLines,
  createEmptySketchDoc,
  setDrivingDimensionValue,
  sketchDimensionText,
  solveSketchDoc,
} from "../../apps/web/src/lib/sketch";
import type { SketchDoc, SketchEntity } from "../../apps/web/src/lib/sketch/types";
import { defaultSketchPlane } from "../../apps/web/src/lib/sketchPlane";

function sketch(entities: SketchEntity[]): SketchDoc {
  const doc = createEmptySketchDoc(defaultSketchPlane(), "simultaneous");
  doc.entities = entities;
  return doc;
}

function at(doc: SketchDoc, id: string) {
  const entity = doc.entities.find((entry) => entry.id === id);
  if (!entity || entity.kind !== "point") throw new Error(`no point ${id}`);
  return entity;
}

function gap(doc: SketchDoc, a: string, b: string) {
  const p = at(doc, a);
  const q = at(doc, b);
  return Math.hypot(q.x - p.x, q.z - p.z);
}

/** A slightly crooked four-sided outline, as if drawn by hand. */
function roughRectangle() {
  return sketch([
    { kind: "point", id: "a", x: 0, z: 0 },
    { kind: "point", id: "b", x: 18, z: 0.6 },
    { kind: "point", id: "c", x: 18.5, z: 9 },
    { kind: "point", id: "d", x: -0.4, z: 10.2 },
    { kind: "line", id: "ab", startId: "a", endId: "b" },
    { kind: "line", id: "bc", startId: "b", endId: "c" },
    { kind: "line", id: "cd", startId: "c", endId: "d" },
    { kind: "line", id: "da", startId: "d", endId: "a" },
  ]);
}

function squaredUp(doc: SketchDoc) {
  return addConstraints(doc, [
    { id: "h1", kind: "horizontal", entityIds: ["ab"] },
    { id: "h2", kind: "horizontal", entityIds: ["cd"] },
    { id: "v1", kind: "vertical", entityIds: ["bc"] },
    { id: "v2", kind: "vertical", entityIds: ["da"] },
  ]);
}

describe("simultaneous sketch solver", () => {
  it("counts what is still free to move", () => {
    const loose = solveSketchDoc(roughRectangle());
    expect(loose.status).toBe("under-defined");
    expect(loose.dof).toBe(8);

    const square = solveSketchDoc(squaredUp(roughRectangle()));
    // Four corners square: it can still slide two ways and stretch two ways.
    expect(square.dof).toBe(4);
  });

  it("fully defines a rectangle with one corner fixed and two sizes", () => {
    const doc = addConstraints(squaredUp(roughRectangle()), [{ id: "pin", kind: "fix", entityIds: ["a"] }]);
    doc.dimensions = [
      { id: "w", kind: "linear", entityIds: ["ab"], value: 30, driving: true },
      { id: "h", kind: "linear", entityIds: ["da"], value: 12, driving: true },
    ];
    const solved = solveSketchDoc(doc);
    expect(solved.status).toBe("fully-defined");
    expect(solved.dof).toBe(0);
    expect(gap(solved.doc, "a", "b")).toBeCloseTo(30, 6);
    expect(gap(solved.doc, "d", "a")).toBeCloseTo(12, 6);
    expect(gap(solved.doc, "b", "c")).toBeCloseTo(12, 6);
    expect(at(solved.doc, "a").x).toBe(0);
  });

  it("calls two sizes that fight each other too many rules, and names them", () => {
    const doc = squaredUp(roughRectangle());
    doc.dimensions = [
      { id: "top", kind: "linear", entityIds: ["cd"], value: 20, driving: true },
      { id: "bottom", kind: "linear", entityIds: ["ab"], value: 30, driving: true },
    ];
    const solved = solveSketchDoc(doc);
    expect(solved.status).toBe("over-constrained");
    expect(solved.conflicts.some((id) => id === "top" || id === "bottom")).toBe(true);
  });

  it("is fine with a rule that repeats another when both hold", () => {
    const doc = addConstraints(squaredUp(roughRectangle()), [{ id: "same", kind: "parallel", entityIds: ["ab", "cd"] }]);
    const solved = solveSketchDoc(doc);
    expect(solved.status).toBe("under-defined");
    expect(solved.dof).toBe(4);
  });

  it("solves a 3-4-5 triangle that needs every length at once", () => {
    const doc = addConstraints(sketch([
      { kind: "point", id: "a", x: 0, z: 0 },
      { kind: "point", id: "b", x: 5, z: 0.5 },
      { kind: "point", id: "c", x: 1, z: 5 },
      { kind: "line", id: "ab", startId: "a", endId: "b" },
      { kind: "line", id: "bc", startId: "b", endId: "c" },
      { kind: "line", id: "ca", startId: "c", endId: "a" },
    ]), [
      { id: "pin", kind: "fix", entityIds: ["a"] },
      { id: "flat", kind: "horizontal", entityIds: ["ab"] },
    ]);
    doc.dimensions = [
      { id: "d1", kind: "linear", entityIds: ["ab"], value: 40, driving: true },
      { id: "d2", kind: "linear", entityIds: ["bc"], value: 50, driving: true },
      { id: "d3", kind: "linear", entityIds: ["ca"], value: 30, driving: true },
    ];
    const solved = solveSketchDoc(doc);
    expect(gap(solved.doc, "a", "b")).toBeCloseTo(40, 6);
    expect(gap(solved.doc, "b", "c")).toBeCloseTo(50, 6);
    expect(gap(solved.doc, "c", "a")).toBeCloseTo(30, 6);
    expect(solved.status).toBe("fully-defined");
  });

  it("drives the angle between two lines", () => {
    const doc = addConstraints(sketch([
      { kind: "point", id: "o", x: 0, z: 0 },
      { kind: "point", id: "e", x: 10, z: 0 },
      { kind: "point", id: "f", x: 6, z: 8 },
      { kind: "line", id: "base", startId: "o", endId: "e" },
      { kind: "line", id: "arm", startId: "o", endId: "f" },
    ]), [{ id: "flat", kind: "horizontal", entityIds: ["base"] }]);
    doc.dimensions = [{ id: "ang", kind: "angular", entityIds: ["base", "arm"], value: 30, driving: true }];
    const solved = solveSketchDoc(doc);
    const o = at(solved.doc, "o");
    const f = at(solved.doc, "f");
    const e = at(solved.doc, "e");
    const angle = (Math.atan2(f.z - o.z, f.x - o.x) - Math.atan2(e.z - o.z, e.x - o.x)) * (180 / Math.PI);
    expect(angle).toBeCloseTo(30, 4);
  });

  it("keeps an arc's ends on its circle when its radius is set", () => {
    const doc = sketch([
      { kind: "point", id: "c", x: 0, z: 0, fixed: true },
      { kind: "point", id: "s", x: 10, z: 0 },
      { kind: "point", id: "e", x: 0, z: 10 },
      { kind: "arc", id: "arc", centerId: "c", startId: "s", endId: "e", ccw: true },
    ]);
    doc.dimensions = [{ id: "r", kind: "radius", entityIds: ["arc"], value: 15, driving: true }];
    const solved = solveSketchDoc(doc);
    expect(gap(solved.doc, "c", "s")).toBeCloseTo(15, 6);
    expect(gap(solved.doc, "c", "e")).toBeCloseTo(15, 6);
  });

  it("puts a point on a line", () => {
    const doc = addConstraints(sketch([
      { kind: "point", id: "a", x: 0, z: 0, fixed: true },
      { kind: "point", id: "b", x: 20, z: 0, fixed: true },
      { kind: "point", id: "p", x: 7, z: 4 },
      { kind: "line", id: "ab", startId: "a", endId: "b" },
    ]), [{ id: "on", kind: "coincident", entityIds: ["ab"], pointIds: ["p"] }]);
    const solved = solveSketchDoc(doc);
    expect(at(solved.doc, "p").z).toBeCloseTo(0, 6);
    expect(at(solved.doc, "p").x).toBeCloseTo(7, 6);
    expect(solved.dof).toBe(1);
  });

  it("makes two circles the same size", () => {
    const doc = addConstraints(sketch([
      { kind: "point", id: "c1", x: 0, z: 0, fixed: true },
      { kind: "point", id: "c2", x: 30, z: 0, fixed: true },
      { kind: "circle", id: "small", centerId: "c1", radius: 4 },
      { kind: "circle", id: "big", centerId: "c2", radius: 9 },
    ]), [{ id: "eq", kind: "equal", entityIds: ["small", "big"] }]);
    doc.dimensions = [{ id: "dia", kind: "diameter", entityIds: ["small"], value: 12, driving: true }];
    const solved = solveSketchDoc(doc);
    const radius = (id: string) => {
      const entity = solved.doc.entities.find((entry) => entry.id === id);
      return entity?.kind === "circle" ? entity.radius : NaN;
    };
    expect(radius("small")).toBeCloseTo(6, 6);
    expect(radius("big")).toBeCloseTo(6, 6);
    expect(solved.status).toBe("fully-defined");
  });

  it("sets a point's distance from a line", () => {
    const doc = sketch([
      { kind: "point", id: "a", x: 0, z: 0, fixed: true },
      { kind: "point", id: "b", x: 20, z: 0, fixed: true },
      { kind: "point", id: "p", x: 5, z: 3 },
      { kind: "line", id: "ab", startId: "a", endId: "b" },
    ]);
    doc.dimensions = [{ id: "off", kind: "linear", entityIds: ["ab"], pointIds: ["p"], value: 8, driving: true }];
    const solved = solveSketchDoc(doc);
    expect(at(solved.doc, "p").z).toBeCloseTo(8, 6);
  });

  it("keeps a held point where it was dragged", () => {
    const doc = squaredUp(roughRectangle());
    doc.entities = doc.entities.map((entity) => (entity.id === "c" && entity.kind === "point" ? { ...entity, x: 25, z: 14 } : entity));
    const solved = solveSketchDoc(doc, 40, { holdPointIds: ["c"] });
    expect(at(solved.doc, "c").x).toBeCloseTo(25, 6);
    expect(at(solved.doc, "c").z).toBeCloseTo(14, 6);
    expect(at(solved.doc, "b").x).toBeCloseTo(25, 6);
    expect(at(solved.doc, "d").z).toBeCloseTo(14, 6);
  });

  it("sets one circle inside another touching", () => {
    const doc = addConstraints(sketch([
      { kind: "point", id: "c1", x: 0, z: 0, fixed: true },
      { kind: "point", id: "c2", x: 3, z: 1 },
      { kind: "circle", id: "outer", centerId: "c1", radius: 20, fixed: true },
      { kind: "circle", id: "inner", centerId: "c2", radius: 5, fixed: true },
    ]), [{ id: "t", kind: "tangent", entityIds: ["outer", "inner"] }]);
    const solved = solveSketchDoc(doc);
    expect(gap(solved.doc, "c1", "c2")).toBeCloseTo(15, 6);
  });

  it("solves a sketch of many separate parts quickly", () => {
    const entities: SketchEntity[] = [];
    const constraints: Array<{ kind: "horizontal" | "vertical"; entityIds: string[] }> = [];
    for (let index = 0; index < 60; index += 1) {
      const x = index * 30;
      const ids = ["a", "b", "c", "d"].map((corner) => `${corner}${index}`);
      entities.push(
        { kind: "point", id: ids[0], x, z: 0.3 },
        { kind: "point", id: ids[1], x: x + 20, z: 0 },
        { kind: "point", id: ids[2], x: x + 20.4, z: 10 },
        { kind: "point", id: ids[3], x, z: 10.5 },
        { kind: "line", id: `ab${index}`, startId: ids[0], endId: ids[1] },
        { kind: "line", id: `bc${index}`, startId: ids[1], endId: ids[2] },
        { kind: "line", id: `cd${index}`, startId: ids[2], endId: ids[3] },
        { kind: "line", id: `da${index}`, startId: ids[3], endId: ids[0] },
      );
      constraints.push(
        { kind: "horizontal", entityIds: [`ab${index}`] },
        { kind: "vertical", entityIds: [`bc${index}`] },
        { kind: "horizontal", entityIds: [`cd${index}`] },
        { kind: "vertical", entityIds: [`da${index}`] },
      );
    }
    const doc = addConstraints(sketch(entities), constraints);
    const started = performance.now();
    const solved = solveSketchDoc(doc);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(solved.status).toBe("under-defined");
    expect(solved.dof).toBe(240);
  });

  it("reads and drives the angle at a corner where one line ends and the next starts", () => {
    const doc = addConstraints(sketch([
      { kind: "point", id: "a", x: 0, z: 0, fixed: true },
      { kind: "point", id: "b", x: 20, z: 0, fixed: true },
      { kind: "point", id: "c", x: 10, z: 10 },
      { kind: "line", id: "ab", startId: "a", endId: "b" },
      { kind: "line", id: "bc", startId: "b", endId: "c" },
    ]), []);
    // Measured at b, from b back towards a, out to c.
    expect(angleBetweenSketchLines(doc, "ab", "bc")).toBeCloseTo(45, 6);
    const added = addAngularDimension(doc, "ab", "bc", 45);
    expect(at(added.doc, "c").x).toBeCloseTo(10, 6);
    const dimensionId = added.doc.dimensions[0].id;
    const turned = setDrivingDimensionValue(added.doc, dimensionId, 60);
    expect(angleBetweenSketchLines(turned.doc, "ab", "bc")).toBeCloseTo(60, 5);
    // The line keeps its length and stays on the same side.
    expect(gap(turned.doc, "b", "c")).toBeCloseTo(Math.hypot(10, 10), 5);
    expect(at(turned.doc, "c").z).toBeGreaterThan(0);
  });

  it("writes dimensions in plain words", () => {
    expect(sketchDimensionText({ kind: "linear", value: 20, driving: true })).toBe("Length 20.00 mm");
    expect(sketchDimensionText({ kind: "angular", value: 30, driving: true })).toBe("Angle 30.0°");
    expect(sketchDimensionText({ kind: "diameter", value: 8, driving: false })).toBe("Diameter 8.00 mm (measured)");
  });
});

describe("a sketch with no rules", () => {
  it("comes out exactly as drawn, arcs and tiny circles included", () => {
    const entities = [
      { id: "c", kind: "point", x: 0, z: 0 },
      { id: "a", kind: "point", x: 20, z: 0 },
      { id: "b", kind: "point", x: 0, z: 10 },
      { id: "arc", kind: "arc", centerId: "c", startId: "a", endId: "b" },
      { id: "tiny-c", kind: "point", x: 50, z: 50 },
      { id: "tiny", kind: "circle", centerId: "tiny-c", radius: 0.005 },
    ];
    const doc = { ...createEmptySketchDoc(defaultSketchPlane()), entities } as unknown as SketchDoc;
    const solved = solveSketchDoc(doc, undefined, { holdPointIds: ["a"] }).doc;
    expect(solved.entities).toEqual(entities);
  });
});
