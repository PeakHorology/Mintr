import { describe, expect, it } from "vitest";
import { createThreadShape } from "@/lib/threadShape";
import { findMetricThread, resolveThreadParams } from "@/lib/metricThreads";
import { buildMetricThreadedCylinder } from "@/lib/metricThreadSolid";

function threadBase(threadSpec?: { designation: string; majorDiameter: number; pitch: number }) {
  return {
    id: "thread-1",
    name: "Threads M6",
    color: "#d97813",
    height: 20,
    ...(threadSpec ? { threadSpec } : {}),
  } as Parameters<typeof createThreadShape>[0]["base"];
}

describe("threadShape", () => {
  it("takes diameter and pitch from the designation, not from the previous spec", () => {
    const m8 = findMetricThread("M8")!;

    // What the editor forwards after a size-driven re-designation: the new designation
    // alongside the outgoing M6 measurements.
    const resized = createThreadShape({
      designation: "M8",
      base: threadBase({ designation: "M8", majorDiameter: 6, pitch: 1 }),
    });

    expect(resized.threadSpec?.designation).toBe("M8");
    expect(resized.threadSpec?.majorDiameter).toBeCloseTo(m8.majorDiameter, 6);
    expect(resized.threadSpec?.pitch).toBeCloseTo(m8.pitch, 6);
  });

  it("builds a headed screw taller than the rod, a left-hand thread, and a 1/4-20 inch size", () => {
    const rod = createThreadShape({ designation: "M6", base: threadBase() });
    const screw = createThreadShape({
      designation: "M6",
      base: threadBase({
        designation: "M6",
        majorDiameter: 6,
        pitch: 1,
        role: "screw",
        head: "hex",
      } as never),
    });
    const left = createThreadShape({
      designation: "M6",
      base: threadBase({
        designation: "M6",
        majorDiameter: 6,
        pitch: 1,
        hand: "left",
      } as never),
    });
    const quarter = createThreadShape({
      designation: "1/4-20 UNC",
      base: threadBase({ designation: "1/4-20 UNC", majorDiameter: 6, pitch: 1 }),
    });
    expect(screw.height).toBeGreaterThan(rod.height);
    expect(screw.width).toBeGreaterThan(rod.width);
    expect(rod.threadSpec?.role).toBe("rod");
    expect(rod.height).toBeCloseTo(20, 4);
    const rodPositions = rod.importedMesh?.positions ?? [];
    let rodCenter = false;
    for (let index = 0; index < rodPositions.length; index += 3) {
      const radius = Math.hypot(rodPositions[index], rodPositions[index + 2]);
      const y = rodPositions[index + 1];
      if (radius < 0.05 && (y < 0.05 || y > 19.9)) rodCenter = true;
    }
    expect(rodCenter).toBe(true);
    expect(left.threadSpec?.hand).toBe("left");
    expect(quarter.threadSpec?.pitch).toBeCloseTo(25.4 / 20, 4);
    expect(quarter.width).toBeGreaterThan(6);
    const nut = createThreadShape({
      designation: "M6",
      base: threadBase({
        designation: "M6",
        majorDiameter: 6,
        pitch: 1,
        role: "nut",
      } as never),
    });
    const positions = nut.importedMesh?.positions ?? [];
    let nearest = Infinity;
    for (let index = 0; index < positions.length; index += 3) {
      nearest = Math.min(nearest, Math.hypot(positions[index], positions[index + 2]));
    }
    expect(nut.hole).toBeFalsy();
    expect(nut.width).toBeGreaterThan(8);
    expect(nearest).toBeGreaterThan(1);
    expect(nearest).toBeLessThan(3);
  });

  it("cuts the bottom threads back onto the chamfer instead of leaving them full size", () => {
    const mesh = buildMetricThreadedCylinder(
      resolveThreadParams({ majorDiameter: 6, pitch: 1, length: 20, side: "external" }),
      20,
      { chamfer: 1.2, role: "rod", sides: 32 },
    );
    const shaftR = 3 - 0.541266;
    const chamfer = 1.2;
    const tip = shaftR - chamfer;
    const positions = mesh.positions;
    let seated = false;
    let stillThreaded = false;
    let floating = 0;
    for (let index = 0; index < positions.length; index += 3) {
      const y = positions[index + 1];
      if (y <= 0.2 || y >= chamfer - 0.05) continue;
      const radius = Math.hypot(positions[index], positions[index + 2]);
      const cone = tip + (shaftR - tip) * (y / chamfer);
      const tooth = 3 - shaftR;
      if (radius > cone + tooth + 0.08) floating += 1;
      if (radius < cone + 0.2) seated = true;
      if (radius > cone + 0.25) stillThreaded = true;
    }
    expect(floating).toBe(0);
    expect(seated).toBe(true);
    expect(stillThreaded).toBe(true);
  });
});
