import { describe, expect, it } from "vitest";
import { composeSketchProfile, geometryForSketchPart } from "@/lib/sketchDrawShapes";

describe("geometryForSketchPart", () => {
  it("draws a rectangle and a circle the sketch tools would draw", () => {
    const rectangle = geometryForSketchPart({ kind: "rectangle", width: 40, depth: 20 });
    const circle = geometryForSketchPart({ kind: "circle", x: 8, radius: 4 });
    expect(rectangle?.points).toHaveLength(4);
    expect(rectangle?.segments).toHaveLength(4);
    expect(circle?.segments.every((segment) => segment.kind === "bezier")).toBe(true);
    const profile = composeSketchProfile([rectangle!, circle!]);
    expect(profile.points).toHaveLength(8);
    expect(profile.segments).toHaveLength(8);
  });

  it("closes a polyline into a loop", () => {
    const line = geometryForSketchPart({
      kind: "line",
      closed: true,
      points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 10 }],
    });
    expect(line?.segments).toHaveLength(3);
  });
});
