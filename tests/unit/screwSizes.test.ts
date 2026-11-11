import { describe, expect, it } from "vitest";
import { createThreadShape, matchingThreadPart } from "@/lib/threadShape";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import { getShapeProperties } from "@/components/workplane/shapeProperties";
import { buildGeneratedShape, latheProfile, nutPocketHeight, screwDimensions, screwHoleDepthMin } from "@/lib/generatedShapes";
import { METRIC_COARSE_THREADS, THREAD_SIZE_OPTIONS } from "@/lib/metricThreads";
import { SCREW_SIZES, type ScrewHead } from "@/types/sketchforge";

describe("screw hole and nut pocket sizes", () => {
  it("offer the same sizes as Threads", () => {
    expect([...SCREW_SIZES]).toEqual(METRIC_COARSE_THREADS.map((thread) => thread.designation));
  });

  it("build every size, with the hole and nut growing with the screw", () => {
    let lastHole = 0;
    let lastNut = 0;
    for (const size of SCREW_SIZES) {
      for (const head of ["none", "counterbore", "countersink"] as ScrewHead[]) {
        const depth = screwHoleDepthMin({ size, head }) + 2;
        const hole = buildGeneratedShape({ form: "screwHole", size, head }, { width: 0, depth: 0, height: depth }, { name: "Hole", color: "#000", hole: true });
        expect(hole, `${size} ${head}`).not.toBeNull();
        if (head === "none") {
          expect(hole!.width).toBeGreaterThan(lastHole);
          lastHole = hole!.width;
        }
      }
      const nut = buildGeneratedShape({ form: "nutPocket", size }, { width: 0, depth: 0, height: nutPocketHeight({ size }) }, { name: "Nut", color: "#000", hole: true });
      expect(nut, size).not.toBeNull();
      expect(nut!.depth).toBeGreaterThan(lastNut);
      lastNut = nut!.depth;
    }
  });

  it("makes a threaded screw hole the same tapped hole Threads makes, and back again", () => {
    const threaded = buildGeneratedShape({ form: "screwHole", size: "M6", head: "counterbore", threaded: true }, { width: 0, depth: 0, height: 12 }, { name: "Screw Hole", color: "#000", hole: true, x: 5, z: -3 })!;
    expect(threaded.kind).toBe("thread");
    expect(threaded.hole).toBe(true);
    expect(threaded.threadSpec).toMatchObject({ designation: "M6", role: "bore", style: "hole", length: 12 });
    expect(threaded.height).toBeCloseTo(12, 6);
    expect(threaded.width).toBeGreaterThan(6);
    expect(threaded.width).toBeLessThan(7);
    expect([threaded.x, threaded.z]).toEqual([5, -3]);
    expect(threaded.name).toBe("Screw Hole");
    expect(threaded.generated).toMatchObject({ form: "screwHole", threaded: true });

    const through = buildGeneratedShape({ form: "screwHole", size: "M6", head: "counterbore", threaded: false }, { width: 0, depth: 0, height: 12 }, threaded)!;
    expect(through.kind).toBe("mesh");
    expect(through.threadSpec).toBeUndefined();
    expect(through.width).toBeCloseTo(10.3, 6);
  });

  it("offers every thread Threads does on a threaded screw hole, and switches back to a plain hole", () => {
    const threaded = buildGeneratedShape({ form: "screwHole", size: "M5", head: "counterbore", threaded: true }, { width: 0, depth: 0, height: 10 }, { name: "Screw Hole", color: "#000", hole: true })!;
    const updates: unknown[] = [];
    const rows = getShapeProperties(threaded, (patch) => updates.push(patch));
    const labels = rows.map((row) => row.label);
    expect(labels).toEqual(expect.arrayContaining(["Hole", "Series", "Size", "Hand", "Profile", "Clearance", "Depth"]));
    expect(labels).not.toContain("Kind");
    const series = rows.find((row) => row.label === "Series") as { options: string[] };
    expect(series.options).toEqual(expect.arrayContaining(["UNC", "UNF"]));

    const hole = rows.find((row) => row.label === "Hole") as { onChange: (value: string) => void };
    hole.onChange("Slides through");
    expect(updates[0]).toEqual({ generated: { form: "screwHole", size: "M5", head: "counterbore", threaded: false } });
  });

  it("keeps a tapped hole's fit when its size changes", () => {
    const first = buildGeneratedShape({ form: "screwHole", size: "M6", head: "none", threaded: true }, { width: 0, depth: 0, height: 10 }, { name: "Screw Hole", color: "#000", hole: true })!;
    const loose = { ...first, threadSpec: { ...first.threadSpec!, clearance: 0.4 } };
    const resized = buildGeneratedShape({ form: "screwHole", size: "M8", head: "none", threaded: true }, { width: 0, depth: 0, height: 10 }, loose)!;
    expect(resized.threadSpec).toMatchObject({ designation: "M8", clearance: 0.4 });
  });

  it("makes plain holes and nut pockets for every thread Threads offers", () => {
    const sizes = [...THREAD_SIZE_OPTIONS.map((entry) => ({ size: entry.id, major: entry.majorDiameter })), { size: "Custom", major: 7.5 }];
    for (const { size, major } of sizes) {
      const diameter = size === "Custom" ? major : undefined;
      for (const head of ["none", "counterbore", "countersink"] as ScrewHead[]) {
        const spec = { form: "screwHole" as const, size, head, diameter };
        const hole = buildGeneratedShape(spec, { width: 0, depth: 0, height: screwHoleDepthMin(spec) + 1 }, { name: "Hole", color: "#000", hole: true });
        expect(hole, `${size} ${head}`).not.toBeNull();
        expect(hole!.width, `${size} ${head}`).toBeGreaterThan(major);
        expect(Number.isFinite(hole!.height)).toBe(true);
      }
      const nutSpec = { form: "nutPocket" as const, size, diameter };
      const nut = buildGeneratedShape(nutSpec, { width: 0, depth: 0, height: nutPocketHeight(nutSpec) }, { name: "Nut", color: "#000", hole: true });
      expect(nut!.depth, size).toBeGreaterThan(major);
    }
  });

  it("sizes inch screws from their standards, with an 82° countersink", () => {
    const quarter = screwDimensions({ size: "1/4-20 UNC" });
    expect(quarter.clearance).toBeCloseTo(0.266 * 25.4, 3);
    expect(quarter.head).toBeCloseTo(0.375 * 25.4, 3);
    expect(quarter.countersinkAngle).toBe(82);
    expect(quarter.proportional).toBe(false);
    expect(screwDimensions({ size: "1/4-28 UNF" })).toEqual(quarter);
    expect(screwDimensions({ size: "G1/4" }).proportional).toBe(true);
    // An 82° cone cuts deeper than a 90° one for the same width.
    const profile = latheProfile({ form: "screwHole", size: "1/4-20 UNC", head: "countersink" }, 0, 20)!;
    const [shaft, seat] = profile[2];
    const [rim] = profile[3];
    expect((20 - seat) / (rim - shaft)).toBeCloseTo(1 / Math.tan((41 * Math.PI) / 180), 6);
  });

  it("keeps an inch or custom thread when a screw hole switches between threaded and plain", () => {
    const threaded = buildGeneratedShape({ form: "screwHole", size: "#10-24 UNC", head: "none", threaded: true }, { width: 0, depth: 0, height: 10 }, { name: "Screw Hole", color: "#000", hole: true })!;
    expect(threaded.threadSpec).toMatchObject({ designation: "#10-24 UNC", series: "unc" });
    const updates: { generated?: unknown }[] = [];
    (getShapeProperties(threaded, (patch) => updates.push(patch)).find((row) => row.label === "Hole") as { onChange: (value: string) => void }).onChange("Slides through");
    expect(updates[0].generated).toMatchObject({ size: "#10-24 UNC", threaded: false });

    const custom = buildGeneratedShape({ form: "screwHole", size: "Custom", head: "none", threaded: true, diameter: 7.5, pitch: 1.1 }, { width: 0, depth: 0, height: 10 }, { name: "Screw Hole", color: "#000", hole: true })!;
    expect(custom.threadSpec).toMatchObject({ designation: "Custom", series: "custom", majorDiameter: 7.5, pitch: 1.1 });
    updates.length = 0;
    (getShapeProperties(custom, (patch) => updates.push(patch)).find((row) => row.label === "Hole") as { onChange: (value: string) => void }).onChange("Slides through");
    expect(updates[0].generated).toMatchObject({ size: "Custom", diameter: 7.5, pitch: 1.1, threaded: false });
  });

  it("offers every series on a plain hole and keeps the nearest size when the series changes", () => {
    const plain = buildGeneratedShape({ form: "screwHole", size: "M6", head: "counterbore" }, { width: 0, depth: 0, height: 10 }, { name: "Screw Hole", color: "#000", hole: true })!;
    const updates: { generated?: unknown }[] = [];
    const rows = getShapeProperties(plain, (patch) => updates.push(patch));
    const series = rows.find((row) => row.label === "Series") as { options: string[]; onChange: (value: string) => void };
    expect(series.options).toEqual(["Metric", "UNC", "UNF", "Pipe (G)", "Custom"]);
    series.onChange("UNC");
    expect(updates[0].generated).toMatchObject({ size: "1/4-20 UNC" });
    series.onChange("Custom");
    expect(updates[1].generated).toMatchObject({ size: "Custom", diameter: 6 });

    const custom = buildGeneratedShape({ form: "nutPocket", size: "Custom", diameter: 9 }, { width: 0, depth: 0, height: 5 }, { name: "Nut", color: "#000", hole: true })!;
    const customRows = getShapeProperties(custom, () => {});
    expect(customRows.map((row) => row.label)).toEqual(expect.arrayContaining(["Series", "Diameter"]));
  });

  it("leaves Threads to rods, screws and nuts, and opens an old tapped hole as a Threaded Hole", () => {
    const rod = createThreadShape({ designation: "M6", height: 20 });
    const kind = getShapeProperties(rod, () => {}).find((row) => row.label === "Kind") as { options: string[] };
    expect(kind.options).toEqual(["Rod", "Screw", "Nut"]);

    const old = createThreadShape({
      designation: "1/4-20 UNC",
      height: 10,
      base: { id: "old", name: "Tapped hole 1/4-20 UNC", color: "#b8c2cc", threadSpec: { designation: "1/4-20 UNC", majorDiameter: 0, pitch: 0, style: "hole", part: "threads", role: "bore", hand: "left" } },
    });
    const opened = canonicalizeShape({ ...old, generated: undefined });
    // A tapped hole had no recess for a head, so it opens without one.
    expect(opened.generated).toEqual({ form: "screwHole", size: "1/4-20 UNC", head: "none", threaded: true });
    expect(opened.threadSpec?.hand).toBe("left");
    const labels = getShapeProperties(opened, () => {}).map((row) => row.label);
    expect(labels[0]).toBe("Hole");
    expect(labels).not.toContain("Kind");

    const screw = createThreadShape({ designation: "M4", height: 12 });
    const mate = matchingThreadPart({ ...screw, threadSpec: { ...screw.threadSpec!, role: "screw" } })!;
    expect(mate.name).toBe("Threaded Hole");
    expect(mate.generated).toMatchObject({ form: "screwHole", size: "M4", threaded: true });
  });

  it("keeps a thread's Exact build through saving, opening, spec changes and matching parts", () => {
    const rod = createThreadShape({ designation: "M6", height: 20 });
    const exact = { ...rod, threadSpec: { ...rod.threadSpec!, exact: true } };
    const reopened = canonicalizeShape(JSON.parse(JSON.stringify(canonicalizeShape(exact))));
    expect(reopened.threadSpec?.exact).toBe(true);
    const longer = createThreadShape({ designation: "M8", height: 30, base: reopened });
    expect(longer.threadSpec?.exact).toBe(true);
    const mate = matchingThreadPart({ ...longer, threadSpec: { ...longer.threadSpec!, role: "screw" } })!;
    expect(mate.threadSpec?.exact).toBe(true);
    expect(canonicalizeShape(JSON.parse(JSON.stringify(rod))).threadSpec?.exact).toBeFalsy();
  });

  it("clears the screw and fits a head and nut wider than it", () => {
    for (const thread of METRIC_COARSE_THREADS) {
      const size = thread.designation;
      const plain = buildGeneratedShape({ form: "screwHole", size, head: "none" }, { width: 0, depth: 0, height: 5 }, { name: "Hole", color: "#000" })!;
      const head = buildGeneratedShape({ form: "screwHole", size, head: "counterbore" }, { width: 0, depth: 0, height: 60 }, { name: "Hole", color: "#000" })!;
      const nut = buildGeneratedShape({ form: "nutPocket", size }, { width: 0, depth: 0, height: 40 }, { name: "Nut", color: "#000" })!;
      expect(plain.width, size).toBeGreaterThan(thread.majorDiameter);
      expect(head.width, size).toBeGreaterThan(plain.width);
      expect(nut.depth, size).toBeGreaterThan(plain.width);
    }
  });
});
