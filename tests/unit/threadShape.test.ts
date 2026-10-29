import { describe, expect, it } from "vitest";
import { createThreadShape, matchingThreadPart, threadCanBeHole } from "@/lib/threadShape";
import { punchThroughCutter } from "@/lib/editorBoolean";
import { effectiveThreadClearance, threadSidesFor } from "@/lib/metricThreadSolid";
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
    const rootR = 3 - 0.541266;
    const chamfer = 1.2;
    const positions = mesh.positions;
    let poking = 0;
    let fullTooth = false;
    let cutTooth = false;
    for (let index = 0; index < positions.length; index += 3) {
      const y = positions[index + 1];
      const radius = Math.hypot(positions[index], positions[index + 2]);
      // The 45° chamfer runs from just inside the root at the tip, and the teeth stop at it.
      const cone = rootR - chamfer + y;
      if (radius > cone + 1e-3) poking += 1;
      if (y > 0.2 && y < chamfer + 0.4 && radius > rootR + 0.05) cutTooth = true;
      if (y > 3 && radius > 2.999) fullTooth = true;
    }
    expect(poking).toBe(0);
    expect(cutTooth).toBe(true);
    expect(fullTooth).toBe(true);
  });

  it("lengthens a tapped hole that ends on a face without stretching its pitch", () => {
    const tapped = createThreadShape({
      designation: "M6",
      height: 10,
      base: { ...threadBase({ designation: "M6", majorDiameter: 6, pitch: 1, role: "bore", style: "hole", part: "threads" } as never), hole: true },
    });
    const block = { id: "b", name: "Box", kind: "box" as const, color: "#ccc", x: 0, z: 0, elevation: 0, size: 20, width: 20, depth: 20, height: 10, rotation: 0, locked: false, hidden: false };
    const grown = punchThroughCutter(tapped, [block]);
    expect(grown.height).toBeGreaterThan(10);
    expect(grown.threadSpec?.length).toBeCloseTo(grown.height, 6);
    expect(grown.importedMesh?.baseHeight).toBeCloseTo(grown.height, 6);
    expect(grown.threadSpec?.pitch).toBe(1);
  });

  it("makes the same-size tapped hole for a screw and a nut, on the same axis", () => {
    const screw = createThreadShape({
      designation: "M4",
      point: { x: 5, z: 2, elevation: 3 },
      base: threadBase({ designation: "M4", majorDiameter: 4, pitch: 0.7, role: "screw", head: "cylinder", length: 12 } as never),
    });
    const hole = matchingThreadPart(screw, "resin")!;
    expect(hole.hole).toBe(true);
    expect(hole.threadSpec?.role).toBe("bore");
    expect(hole.threadSpec?.designation).toBe("M4");
    expect(hole.threadSpec?.clearance).toBeCloseTo(0.1, 6);
    expect(hole.x).toBeCloseTo(5, 6);
    expect(hole.elevation).toBeCloseTo(3, 6);
    expect(hole.height).toBeCloseTo(12, 6);

    const nut = createThreadShape({
      designation: "M6",
      point: { x: 0, z: 0, elevation: 10 },
      base: threadBase({ designation: "M6", majorDiameter: 6, pitch: 1, role: "nut", length: 4.8 } as never),
    });
    const nutHole = matchingThreadPart(nut)!;
    expect(nutHole.threadSpec?.role).toBe("bore");
    expect(nutHole.threadSpec?.designation).toBe("M6");
    expect((nutHole.elevation ?? 0) + nutHole.height / 2).toBeCloseTo((nut.elevation ?? 0) + nut.height / 2, 6);
    // A tapped hole has no matching tapped hole.
    expect(matchingThreadPart(hole)).toBeNull();
  });

  it("keeps half of each tooth when clearance is large, uses fewer sides on small threads, and lists M1", () => {
    expect(effectiveThreadClearance(0.4, 0.5)).toBeCloseTo(0.541266 * 0.5 * 0.5, 6);
    expect(effectiveThreadClearance(0.2, 1)).toBeCloseTo(0.2, 6);
    expect(threadSidesFor(3, 96)).toBe(48);
    expect(threadSidesFor(20, 96)).toBe(96);
    expect(threadSidesFor(20, 12)).toBe(12);
    const m1 = createThreadShape({ designation: "M1", base: threadBase({ designation: "M1", majorDiameter: 1, pitch: 0.25 }) });
    expect(m1.threadSpec?.designation).toBe("M1");
    expect(m1.threadSpec?.pitch).toBe(0.25);
  });

  it("lets only a tapped hole be a hole", () => {
    const screw = createThreadShape({ designation: "M3", base: threadBase({ designation: "M3", majorDiameter: 3, pitch: 0.5, role: "screw" } as never) });
    expect(threadCanBeHole(screw)).toBe(false);
    expect(threadCanBeHole(screw, "bore")).toBe(true);
    expect(threadCanBeHole(matchingThreadPart(screw)!)).toBe(true);
    expect(threadCanBeHole({ ...screw, kind: "box" })).toBe(true);
  });
});
