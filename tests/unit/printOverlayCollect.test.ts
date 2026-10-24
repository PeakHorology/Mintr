import { describe, expect, it } from "vitest";
import { collectPrintOverlayMarks, printOverlayMarkBuffers } from "@/lib/printOverlayCollect";

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

  it("accepts a flat soup and returns transferable typed arrays", () => {
    const soup = new Float64Array([0, 10, 0, 4, 10, 0, 0, 10, 4]);
    const marks = collectPrintOverlayMarks({
      triangles: soup,
      overhang: true,
      angle: 45,
      thinWalls: false,
      smallHoles: false,
      trappedResin: false,
      nozzleMm: 0.4,
    });
    expect(marks.overhangPositions).toBeInstanceOf(Float32Array);
    expect(Array.from(marks.overhangPositions)).toEqual(Array.from(soup));
    const buffers = printOverlayMarkBuffers(marks);
    expect(buffers).toHaveLength(8);
    expect(new Set(buffers).size).toBe(8);
  });
});
