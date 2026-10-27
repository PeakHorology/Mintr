import { describe, expect, it } from "vitest";
import { setSketchLineweight } from "@/lib/sketch/editOps";
import { mergeProfileIntoDoc, sketchDocToProfile } from "@/lib/sketch/migrate";
import { createEmptySketchDoc, type SketchDoc } from "@/lib/sketch/types";

const PLANE = {
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  uAxis: { x: 1, y: 0, z: 0 },
};

function squareDoc(): SketchDoc {
  const doc = createEmptySketchDoc(PLANE, "sketch-weight");
  doc.entities.push(
    { kind: "point", id: "a", x: 0, z: 0 },
    { kind: "point", id: "b", x: 20, z: 0 },
    { kind: "point", id: "c", x: 20, z: 10 },
    { kind: "point", id: "d", x: 0, z: 10 },
    { kind: "line", id: "bottom", startId: "a", endId: "b" },
    { kind: "line", id: "right", startId: "b", endId: "c" },
    { kind: "line", id: "top", startId: "c", endId: "d" },
    { kind: "line", id: "left", startId: "d", endId: "a" },
    { kind: "point", id: "cc", x: 10, z: 5 },
    { kind: "circle", id: "hole", centerId: "cc", radius: 2 },
  );
  return doc;
}

describe("setSketchLineweight", () => {
  it("thickens one line and leaves the shape where it is", () => {
    const doc = squareDoc();
    const next = setSketchLineweight(doc, ["bottom"], 6);
    const bottom = next.entities.find((entity) => entity.id === "bottom");
    const right = next.entities.find((entity) => entity.id === "right");
    const corner = next.entities.find((entity) => entity.id === "b");
    expect(bottom?.weight).toBe(6);
    expect(right?.weight).toBeUndefined();
    expect(corner).toMatchObject({ x: 20, z: 0 });
    expect(sketchDocToProfile(next).segments.find((segment) => segment.id === "bottom")?.weight).toBe(6);
  });

  it("uses the standard stroke when the weight is 2.5", () => {
    const weighted = setSketchLineweight(squareDoc(), ["bottom"], 6);
    const cleared = setSketchLineweight(weighted, ["bottom"], 2.5);
    expect(cleared.entities.find((entity) => entity.id === "bottom")?.weight).toBeUndefined();
  });

  it("keeps a circle's weight through the profile round trip without moving it", () => {
    const next = setSketchLineweight(squareDoc(), ["hole"], 4);
    const profile = sketchDocToProfile(next);
    const standIn = profile.segments.find((segment) => segment.id.startsWith("hole-s"));
    expect(standIn?.weight).toBe(4);
    const merged = mergeProfileIntoDoc(next, profile);
    const circle = merged.entities.find((entity) => entity.id === "hole");
    expect(circle).toMatchObject({ kind: "circle", radius: 2, weight: 4 });
  });

  it("applies a clicked circle chord to the circle", () => {
    const profile = sketchDocToProfile(squareDoc());
    const chord = profile.segments.find((segment) => segment.id.startsWith("hole-s"));
    expect(chord).toBeTruthy();
    const next = setSketchLineweight(squareDoc(), [chord!.id], 8);
    expect(next.entities.find((entity) => entity.id === "hole")?.weight).toBe(8);
  });
});
