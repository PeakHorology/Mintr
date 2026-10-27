import { describe, expect, it } from "vitest";
import { mirrorEntities } from "@/lib/sketch/editOps";
import { createEmptySketchDoc } from "@/lib/sketch/types";

const PLANE = {
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  uAxis: { x: 1, y: 0, z: 0 },
};

function doc() {
  const next = createEmptySketchDoc(PLANE, "sketch-mirror");
  next.entities.push(
    { kind: "point", id: "a", x: 0, z: 0, handleOut: { x: 0, z: 4 } },
    { kind: "point", id: "b", x: 10, z: 0 },
    { kind: "point", id: "c", x: 10, z: 10 },
    { kind: "point", id: "d", x: 0, z: 10 },
    { kind: "line", id: "ab", startId: "a", endId: "b" },
    { kind: "line", id: "bc", startId: "b", endId: "c" },
    { kind: "line", id: "cd", startId: "c", endId: "d" },
    { kind: "line", id: "da", startId: "d", endId: "a" },
    { kind: "point", id: "p", x: 20, z: -5 },
    { kind: "point", id: "q", x: 20, z: 15 },
    { kind: "line", id: "axis", startId: "p", endId: "q" },
    { kind: "point", id: "cc", x: 5, z: 5 },
    { kind: "circle", id: "hole", centerId: "cc", radius: 2 },
  );
  return next;
}

describe("mirrorEntities", () => {
  it("copies a shape across a straight line and keeps curve handles", () => {
    const mirrored = mirrorEntities(doc(), ["a", "b", "c", "d", "ab", "bc", "cd", "da"], "axis");
    const copyA = mirrored.entities.find((entity) => entity.kind === "point" && entity.x === 40 && entity.z === 0 && entity.handleOut);
    expect(copyA && copyA.kind === "point" ? copyA.handleOut : null).toEqual({ x: 40, z: 4 });
    const xs = mirrored.entities.filter((entity) => entity.kind === "point").map((entity) => entity.kind === "point" ? entity.x : 0);
    expect(xs).toEqual(expect.arrayContaining([30, 40]));
    expect(mirrored.entities.filter((entity) => entity.kind === "line")).toHaveLength(9);
    const copied = mirrored.entities.filter((entity) => entity.kind === "line" && entity.regionId);
    expect(new Set(copied.map((entity) => entity.kind === "line" ? entity.regionId : ""))).toHaveLength(1);
  });

  it("copies a circle from its center", () => {
    const mirrored = mirrorEntities(doc(), ["cc"], "axis");
    const circle = mirrored.entities.find((entity) => entity.kind === "circle" && entity.id !== "hole");
    expect(circle && circle.kind === "circle" ? circle.radius : 0).toBe(2);
    const center = mirrored.entities.find((entity) => circle && circle.kind === "circle" && entity.kind === "point" && entity.id === circle.centerId);
    expect(center).toMatchObject({ x: 35, z: 5 });
  });

  it("leaves the sketch alone when the axis is not a straight line", () => {
    const source = doc();
    expect(mirrorEntities(source, ["ab"], "a")).toBe(source);
  });
});
