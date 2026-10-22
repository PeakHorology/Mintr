import { describe, expect, it } from "vitest";
import { collectPrintOverlayMarks } from "@/lib/printOverlayCollect";

describe("print overlay collection", () => {
  it("marks a downward face as an overhang without touching the window", () => {
    const marks = collectPrintOverlayMarks({
      triangles: [{
        ax: 0, ay: 10, az: 0,
        bx: 4, by: 10, bz: 0,
        cx: 0, cy: 10, cz: 4,
      }],
      overhang: true,
      angle: 45,
      thinWalls: false,
      smallHoles: false,
      trappedResin: false,
      nozzleMm: 0.4,
    });
    expect(marks.overhangPositions.length).toBeGreaterThanOrEqual(9);
    expect(marks.thinPositions).toHaveLength(0);
  });
});
