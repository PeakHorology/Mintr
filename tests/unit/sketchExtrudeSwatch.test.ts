import { describe, expect, it } from "vitest";
import {
  ellipseSketchGeometry,
  rectangleSketchGeometry,
  regularPolygonSketchGeometry,
  roundedRectangleSketchGeometry,
  slotSketchGeometry,
  squareSketchGeometry,
  starSketchGeometry,
} from "@/lib/sketchDrawShapes";
import { sketchDocToProfile } from "@/lib/sketch/migrate";
import { createEmptySketchDoc } from "@/lib/sketch/types";
import { classifySketchExtrude } from "@/lib/sketchExtrudeSwatch";

const PLANE = {
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  uAxis: { x: 1, y: 0, z: 0 },
};

const empty = { entities: [] as const };

describe("classifySketchExtrude", () => {
  it("shows a circle for an analytic circle", () => {
    const doc = createEmptySketchDoc(PLANE, "sketch");
    doc.entities.push(
      { kind: "point", id: "c", x: 0, z: 0 },
      { kind: "circle", id: "hole", centerId: "c", radius: 12 },
    );
    expect(classifySketchExtrude(sketchDocToProfile(doc), doc)).toEqual({ kind: "circle" });
  });

  it("shows the draw-tool shape for the other preloaded outlines", () => {
    expect(classifySketchExtrude(squareSketchGeometry({ x: 0, z: 0 }, { x: 20, z: 10 })!, empty)).toEqual({ kind: "square" });
    expect(classifySketchExtrude(rectangleSketchGeometry({ x: 0, z: 0 }, { x: 40, z: 12 })!, empty)).toEqual({ kind: "rectangle", tall: false });
    expect(classifySketchExtrude(rectangleSketchGeometry({ x: 0, z: 0 }, { x: 10, z: 30 })!, empty)).toEqual({ kind: "rectangle", tall: true });
    expect(classifySketchExtrude(ellipseSketchGeometry({ x: 0, z: 0 }, { x: 40, z: 16 })!, empty)).toEqual({ kind: "ellipse" });
    expect(classifySketchExtrude(ellipseSketchGeometry({ x: 0, z: 0 }, { x: 20, z: 20 })!, empty)).toEqual({ kind: "circle" });
    expect(classifySketchExtrude(regularPolygonSketchGeometry({ x: 0, z: 0 }, { x: 10, z: 0 }, 3)!, empty)).toEqual({ kind: "triangle" });
    expect(classifySketchExtrude(regularPolygonSketchGeometry({ x: 0, z: 0 }, { x: 10, z: 0 }, 6)!, empty)).toEqual({ kind: "polygon", sides: 6 });
    expect(classifySketchExtrude(starSketchGeometry({ x: 0, z: 0 }, { x: 12, z: 0 })!, empty)).toEqual({ kind: "star", tips: 5 });
    expect(classifySketchExtrude(roundedRectangleSketchGeometry({ x: 0, z: 0 }, { x: 30, z: 20 })!, empty)).toEqual({ kind: "roundRect" });
    expect(classifySketchExtrude(slotSketchGeometry({ x: 0, z: 0 }, { x: 40, z: 12 })!, empty)).toEqual({ kind: "slot", tall: false });
  });

  it("keeps a freehand outline on the generic plate", () => {
    const profile = {
      points: [
        { id: "a", x: 0, z: 0 },
        { id: "b", x: 18, z: 1 },
        { id: "c", x: 14, z: 9 },
        { id: "d", x: 7, z: 16 },
        { id: "e", x: 1, z: 6 },
      ],
      segments: [
        { id: "ab", startId: "a", endId: "b", kind: "line" as const },
        { id: "bc", startId: "b", endId: "c", kind: "line" as const },
        { id: "cd", startId: "c", endId: "d", kind: "line" as const },
        { id: "de", startId: "d", endId: "e", kind: "line" as const },
        { id: "ea", startId: "e", endId: "a", kind: "line" as const },
      ],
    };
    expect(classifySketchExtrude(profile, empty)).toEqual({ kind: "sketch" });
  });
});
