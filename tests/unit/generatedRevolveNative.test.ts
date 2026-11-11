import { afterAll, describe, expect, it } from "vitest";
import { buildGeneratedShape } from "@/lib/generatedShapes";
import { applyGeneratedRevolveMesh, generatedRevolveOutline, serializeGeneratedRevolveJob } from "@/lib/generatedRevolve";
import type { GeneratedSpec } from "@/types/sketchforge";
import { hasNativeKernelExe, spawnNativeKernelClient } from "../helpers/nativeKernelChild";

function made(spec: GeneratedSpec, height: number, width = 0) {
  return buildGeneratedShape(spec, { width, depth: width, height }, { name: "Part", color: "#000", hole: true })!;
}

/** Enclosed volume of a closed triangle mesh. */
function meshVolume(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  let volume = 0;
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const [a, b, c] = [indices[index], indices[index + 1], indices[index + 2]].map((vertex) => [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]]);
    volume += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return Math.abs(volume / 6);
}

describe("generated turned shapes", () => {
  it("describe the paraboloid with one true curve and screw holes with straight steps", () => {
    const paraboloid = generatedRevolveOutline(made({ form: "paraboloid" }, 20, 20))!;
    expect(paraboloid.steps).toHaveLength(2);
    expect(paraboloid.steps[1].c1).toBeDefined();
    const hole = generatedRevolveOutline(made({ form: "screwHole", size: "M4", head: "counterbore" }, 10))!;
    expect(hole.steps.every((step) => !step.c1)).toBe(true);
    expect(hole.scaleZ).toBeCloseTo(1, 9);
    // A threaded hole is a thread, not a turned shape.
    expect(serializeGeneratedRevolveJob(made({ form: "screwHole", size: "M4", head: "none", threaded: true }, 10))).toBeNull();
  });
});

describe.skipIf(!hasNativeKernelExe)("desktop engine turns generated shapes", () => {
  const client = spawnNativeKernelClient();
  afterAll(() => client.close());
  let id = 1;

  async function turn(spec: GeneratedSpec, height: number, width = 0) {
    const shape = made(spec, height, width);
    const job = serializeGeneratedRevolveJob(shape)!;
    const reply = await client.request({ id: id++, ...job }, 60000);
    expect(reply.ok, String(reply.message)).toBe(true);
    const positions = reply.positions as number[];
    const indices = reply.indices as number[];
    const exact = applyGeneratedRevolveMesh(shape, positions, reply.normals as number[], indices, String(reply.cadBrep))!;
    expect(exact.cadBrep).toContain("CASCADE Topology");
    return { shape, exact, volume: meshVolume(positions, indices) };
  }

  it("matches a counterbored metric hole's exact volume and size", async () => {
    const { shape, exact, volume } = await turn({ form: "screwHole", size: "M4", head: "counterbore" }, 10);
    // M4: 4.5 mm clearance, 7 mm head + 0.3 mm room, 4 mm deep.
    const expected = Math.PI * (2.25 ** 2 * 6 + 3.65 ** 2 * 4);
    expect(volume).toBeCloseTo(expected, 0);
    expect(exact.cadBrepFrame!.width).toBeCloseTo(shape.width!, 2);
    expect(exact.cadBrepFrame!.height).toBeCloseTo(10, 4);
  });

  it("turns an inch countersink at 82° and a paraboloid on its true curve", async () => {
    const countersink = await turn({ form: "screwHole", size: "1/4-20 UNC", head: "countersink" }, 15);
    expect(countersink.volume).toBeGreaterThan(Math.PI * (0.266 * 25.4 / 2) ** 2 * 15);
    const paraboloid = await turn({ form: "paraboloid" }, 20, 20);
    // A paraboloid fills exactly half its cylinder.
    // The mesh sits just inside the true curve, so it reads a little under.
    const half = (Math.PI * 100 * 20) / 2;
    expect(paraboloid.volume / half).toBeGreaterThan(0.98);
    expect(paraboloid.volume / half).toBeLessThanOrEqual(1.0001);
  });

  it("stretches to an oval footprint", async () => {
    const shape = buildGeneratedShape({ form: "paraboloid" }, { width: 20, depth: 10, height: 8 }, { name: "Part", color: "#000" })!;
    const reply = await client.request({ id: id++, ...serializeGeneratedRevolveJob(shape)! }, 60000);
    const exact = applyGeneratedRevolveMesh(shape, reply.positions as number[], reply.normals as number[], reply.indices as number[], String(reply.cadBrep))!;
    expect(exact.cadBrepFrame!.width).toBeCloseTo(20, 2);
    expect(exact.cadBrepFrame!.depth).toBeCloseTo(10, 2);
  });
});

describe("engine time allowed for Exact threads", () => {
  it("gives a job with an Exact thread longer, and leaves other jobs alone", async () => {
    const { nativeJobTimeoutMs } = await import("@/lib/occtKernelClient");
    const box = { hole: false, kind: "box", width: 10, depth: 10, height: 10, x: 0, z: 0, elevation: 0, rotation: 0 };
    expect(nativeJobTimeoutMs({ id: 1, type: "boolean", op: "union", solids: [box] } as never, 30_000)).toBe(30_000);
    expect(nativeJobTimeoutMs({ id: 2, type: "boolean", op: "subtract", solids: [box, { ...box, hole: true, kind: "thread" }] } as never, 30_000)).toBe(120_000);
    expect(nativeJobTimeoutMs({ id: 3, type: "exportStep", solids: [{ ...box, kind: "thread" }] } as never, 45_000)).toBe(180_000);
  });
});
