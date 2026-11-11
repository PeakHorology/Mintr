import { afterAll, describe, expect, it } from "vitest";
import { buildMetricThreadedCylinder, exactThreadPlan, type ThreadMeshOptions, type ThreadProfile } from "@/lib/metricThreadSolid";
import { findThreadSize, resolveThreadParams } from "@/lib/metricThreads";
import { buildGeneratedShape } from "@/lib/generatedShapes";
import { toNativeKernelSolid } from "@/lib/nativeKernelProtocol";
import { shapeHasExactBrepSource } from "@/lib/stepQuality";
import type { WorkplaneShape } from "@/types/sketchforge";
import { hasNativeKernelExe, spawnNativeKernelClient } from "../helpers/nativeKernelChild";

function meshVolume(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  let volume = 0;
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const [a, b, c] = [indices[index], indices[index + 1], indices[index + 2]].map((vertex) => [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]]);
    volume += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return Math.abs(volume / 6);
}

function extents(positions: ArrayLike<number>) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index + 2 < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  return { min, max };
}

/**
 * Along a right-hand crest, height / pitch + angle / 2pi stays the same (angle from +X toward +Z),
 * so crest points bunch up at one phase; with the wrong sign they spread all round.
 */
function bunching(positions: ArrayLike<number>, crestR: number, pitch: number, sign: number) {
  return phaseOf(positions, crestR, pitch, sign).strength;
}

/** How tightly crest points bunch at one phase, and which phase that is (radians). */
function phaseOf(positions: ArrayLike<number>, crestR: number, pitch: number, sign: number) {
  let c = 0;
  let s = 0;
  let n = 0;
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const [x, y, z] = [positions[index], positions[index + 1], positions[index + 2]];
    if (Math.hypot(x, z) < crestR - 0.05 || y < 1 || y > 7) continue;
    const phase = 2 * Math.PI * (y / pitch + (sign * Math.atan2(z, x)) / (2 * Math.PI));
    c += Math.cos(phase);
    s += Math.sin(phase);
    n += 1;
  }
  return { strength: n ? Math.hypot(c, s) / n : 0, angle: Math.atan2(s, c) };
}

describe.skipIf(!hasNativeKernelExe)("exact threads in the engine", { timeout: 120000 }, () => {
  const client = spawnNativeKernelClient();
  afterAll(() => client.close());
  let id = 1;

  async function compare(designation: string | { majorDiameter: number; pitch: number }, height: number, options: ThreadMeshOptions, handedness: "right" | "left" = "right") {
    const size = typeof designation === "string" ? findThreadSize(designation) : designation;
    const params = resolveThreadParams({
      designation: typeof designation === "string" ? designation : null,
      majorDiameter: size?.majorDiameter,
      pitch: size?.pitch,
      length: height,
      side: options.role === "bore" || options.role === "nut" ? "internal" : "external",
      handedness,
    });
    const print = buildMetricThreadedCylinder(params, height, { sides: 96, ...options });
    const plan = exactThreadPlan(params, height, options);
    const started = Date.now();
    const reply = await client.request({ id: id++, type: "buildThread", thread: plan, mesh: true }, 120000);
    const seconds = (Date.now() - started) / 1000;
    expect(reply.ok, String(reply.message)).toBe(true);
    const positions = reply.positions as number[];
    const indices = reply.indices as number[];
    return {
      plan,
      print,
      exactVolume: meshVolume(positions, indices),
      printVolume: meshVolume(print.positions, print.indices),
      box: extents(positions),
      seconds,
      positions,
    };
  }

  for (const profile of ["v", "trapezoid", "whitworth", "round"] as ThreadProfile[]) {
    it(`builds an M6 ${profile} rod as the print mesh has it`, async () => {
      const { exactVolume, printVolume, box, plan } = await compare("M6", 12, { part: "screw", role: "rod", profile, chamfer: 0.5 });
      expect(exactVolume / printVolume).toBeGreaterThan(0.97);
      expect(exactVolume / printVolume).toBeLessThan(1.03);
      expect(box.max[1] - box.min[1]).toBeCloseTo(plan.height, 2);
      expect((box.max[0] - box.min[0]) / 2).toBeLessThanOrEqual(plan.majorR + 1e-3);
    });
  }

  it("builds a screw with each head, a nut and a tapped-hole cutter", async () => {
    for (const head of ["cylinder", "countersunk", "hex"] as const) {
      const screw = await compare("M5", 10, { part: "screw", role: "screw", head, chamfer: 0.4 });
      expect(screw.exactVolume / screw.printVolume, head).toBeGreaterThan(0.96);
      expect(screw.exactVolume / screw.printVolume, head).toBeLessThan(1.04);
      expect(screw.box.max[1] - screw.box.min[1], head).toBeCloseTo(screw.plan.height, 2);
    }
    const nut = await compare("M8", 6.4, { part: "screw", role: "nut", clearance: 0.2, chamfer: 0.3 });
    expect(nut.exactVolume / nut.printVolume).toBeGreaterThan(0.96);
    expect(nut.exactVolume / nut.printVolume).toBeLessThan(1.04);
    const bore = await compare("M6", 10, { part: "threads", role: "bore", clearance: 0.2, chamfer: 0.3 });
    expect(bore.exactVolume / bore.printVolume).toBeGreaterThan(0.97);
    expect(bore.exactVolume / bore.printVolume).toBeLessThan(1.03);
    // The default Threaded Hole: a fine pitch, where the tooth once failed to join its core.
    const fine = await compare("M3", 15, { part: "threads", role: "bore", clearance: 0.2, chamfer: 0.3 });
    expect(fine.exactVolume / fine.printVolume).toBeGreaterThan(0.97);
    expect(fine.exactVolume / fine.printVolume).toBeLessThan(1.03);
  });

  it("turns the same way as the print mesh, either hand", async () => {
    for (const hand of ["right", "left"] as const) {
      const { positions, print, plan } = await compare("M6", 8, { part: "screw", role: "rod" }, hand);
      const sign = hand === "right" ? 1 : -1;
      for (const [name, mesh] of [["exact", positions], ["print", print.positions]] as const) {
        expect(bunching(mesh, plan.majorR, plan.pitch, sign), `${hand} ${name}`).toBeGreaterThan(0.8);
        expect(bunching(mesh, plan.majorR, plan.pitch, -sign), `${hand} ${name}`).toBeLessThan(0.3);
      }
    }
  });

  it("puts the exact teeth where the print mesh has them", async () => {
    for (const profile of ["v", "round"] as ThreadProfile[]) {
      const { positions, print, plan } = await compare("M6", 8, { part: "screw", role: "rod", profile });
      const exact = phaseOf(positions, plan.majorR, plan.pitch, 1).angle;
      const printed = phaseOf(print.positions, plan.majorR, plan.pitch, 1).angle;
      const apart = Math.abs(Math.atan2(Math.sin(exact - printed), Math.cos(exact - printed)));
      // A tenth of a turn is a tenth of a pitch along the axis.
      expect(apart, profile).toBeLessThan((2 * Math.PI) / 10);
    }
  });

  it("shades the inside of a hole and both of two separate parts the right way", async () => {
    const block: WorkplaneShape = { id: "block", name: "Block", kind: "box", color: "#d41721", x: 0, z: 0, elevation: 0, size: 20, width: 20, depth: 20, height: 10, rotation: 0, locked: false, hidden: false };
    const bore: WorkplaneShape = { ...block, id: "bore", name: "Bore", kind: "cylinder", width: 8, depth: 8, size: 8, height: 14, elevation: -2, hole: true };
    const hollow = await client.request({ id: id++, type: "boolean", op: "subtract", solids: [toNativeKernelSolid(block), toNativeKernelSolid(bore)] }, 120000);
    expect(hollow.ok, String(hollow.message)).toBe(true);
    const positions = hollow.positions as number[];
    const normals = hollow.normals as number[];
    const corners = (hollow.indices as number[] | undefined) ?? Array.from({ length: positions.length / 3 }, (_, index) => index);
    let wall = 0;
    for (let index = 0; index + 2 < corners.length; index += 3) {
      const tri = [corners[index], corners[index + 1], corners[index + 2]];
      const centre = [0, 1, 2].map((axis) => tri.reduce((sum, vertex) => sum + positions[vertex * 3 + axis], 0) / 3);
      const radius = Math.hypot(centre[0], centre[2]);
      if (radius > 4.05) continue;
      wall += 1;
      // The hole's wall faces the empty middle.
      for (const vertex of tri) {
        expect(normals[vertex * 3] * positions[vertex * 3] + normals[vertex * 3 + 2] * positions[vertex * 3 + 2]).toBeLessThan(0);
      }
    }
    expect(wall).toBeGreaterThan(10);
    const left: WorkplaneShape = { ...block, id: "left", width: 6, depth: 6, size: 6, height: 6, x: -10 };
    const right: WorkplaneShape = { ...left, id: "right", x: 10 };
    const pair = await client.request({ id: id++, type: "boolean", op: "union", solids: [toNativeKernelSolid(left), toNativeKernelSolid(right)] }, 120000);
    expect(pair.ok, String(pair.message)).toBe(true);
    const at = pair.positions as number[];
    const facing = pair.normals as number[];
    for (let index = 0; index + 2 < at.length; index += 3) {
      const centre = at[index] < 0 ? -10 : 10;
      const out = facing[index] * (at[index] - centre) + facing[index + 1] * (at[index + 1] - 3) + facing[index + 2] * at[index + 2];
      expect(out).toBeGreaterThan(0);
    }
  });

  it("builds awkward sizes: inch, pipe, odd custom pitches", async () => {
    // Each of these once failed: the tooth and core never joined, or joined into garbage.
    const cases: Array<[Parameters<typeof compare>[0], number, ThreadMeshOptions]> = [
      ["1-12 UNF", 12, { part: "screw", role: "rod", chamfer: 1 }],
      ["G4", 30, { part: "threads", role: "bore", clearance: 0.2, chamfer: 1 }],
      [{ majorDiameter: 2.2, pitch: 0.15 }, 3, { part: "screw", role: "rod" }],
      [{ majorDiameter: 7.3, pitch: 0.77 }, 9, { part: "screw", role: "screw", head: "hex", chamfer: 0.4 }],
      ["G2-1/2", 12.7, { part: "screw", role: "rod", chamfer: 1 }],
    ];
    for (const [size, height, options] of cases) {
      const { exactVolume, printVolume } = await compare(size, height, options);
      const name = typeof size === "string" ? size : `${size.majorDiameter} x ${size.pitch}`;
      expect(exactVolume / printVolume, name).toBeGreaterThan(0.96);
      expect(exactVolume / printVolume, name).toBeLessThan(1.04);
    }
  });

  it("keeps a long fine thread quick enough to use", async () => {
    const { seconds, exactVolume, printVolume } = await compare("M3", 30, { part: "screw", role: "rod" });
    expect(exactVolume / printVolume).toBeGreaterThan(0.97);
    // Generous, so a busy machine does not fail it; it was over two minutes before slicing.
    expect(seconds).toBeLessThan(30);
  });

  it("cuts an Exact Threaded Hole into a part as one exact solid", async () => {
    const made = buildGeneratedShape({ form: "screwHole", size: "M6", head: "none", threaded: true }, { width: 0, depth: 0, height: 12 }, { name: "Threaded Hole", color: "#000", hole: true, elevation: -1 })!;
    const hole: WorkplaneShape = { ...made, threadSpec: { ...made.threadSpec!, exact: true } };
    const printHole: WorkplaneShape = { ...made };
    expect(shapeHasExactBrepSource(hole)).toBe(true);
    expect(shapeHasExactBrepSource(printHole)).toBe(false);
    const cutter = toNativeKernelSolid(hole)!;
    expect(cutter.kind).toBe("thread");
    expect(toNativeKernelSolid(printHole)).toBeNull();
    const block: WorkplaneShape = { id: "block", name: "Block", kind: "box", color: "#d41721", x: 0, z: 0, elevation: 0, size: 20, width: 20, depth: 20, height: 10, rotation: 0, locked: false, hidden: false };
    const reply = await client.request({ id: id++, type: "boolean", op: "subtract", solids: [toNativeKernelSolid(block), cutter] }, 120000);
    expect(reply.ok, String(reply.message)).toBe(true);
    expect(reply.fallback).not.toBe(true);
    expect(String(reply.brepStep ?? "")).toContain("ISO-10303");
    const removed = 4000 - meshVolume(reply.positions as number[], (reply.indices as number[] | undefined) ?? Array.from({ length: (reply.positions as number[]).length / 3 }, (_, index) => index));
    const plan = cutter.thread!;
    expect(removed).toBeGreaterThan(Math.PI * plan.minorR ** 2 * 10);
    expect(removed).toBeLessThan(Math.PI * (plan.majorR + plan.mouth) ** 2 * 10);
  });

  it("exports an Exact thread to STEP as an exact solid", async () => {
    const params = resolveThreadParams({ designation: "M4" });
    const plan = exactThreadPlan(params, 8, { part: "screw", role: "screw", head: "hex", chamfer: 0.3 });
    const reply = await client.request({ id: id++, type: "exportStep", solids: [{ hole: false, kind: "thread", name: "Screw", width: 8, depth: 8, height: plan.height, x: 0, z: 0, elevation: 0, rotation: 0, thread: plan }] }, 120000);
    expect(reply.ok, String(reply.message)).toBe(true);
    expect(reply.exactCount).toBe(1);
    expect(String(reply.step)).toContain("ISO-10303");
  });
});
