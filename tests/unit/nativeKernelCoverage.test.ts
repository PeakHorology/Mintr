import { afterAll, describe, expect, it } from "vitest";
import { punchThroughCutter } from "@/lib/editorBoolean";
import { serializeSketchExtrudeJob } from "@/lib/sketchExtrusionSolid";
import { toNativeKernelSolid } from "@/lib/nativeKernelProtocol";
import { NATIVE_EXACT_KINDS } from "@/lib/shapeBrep";
import type { WorkplaneShape } from "@/types/sketchforge";
import { hasNativeKernelExe, spawnNativeKernelClient } from "../helpers/nativeKernelChild";

function box(id: string, extra: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id,
    name: id,
    kind: "box",
    color: "#d41721",
    x: 0,
    z: 0,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
    ...extra,
  };
}

describe("native kernel coverage encoding", () => {
  it("encodes every exact kind including elliptical footprints and gears", () => {
    for (const kind of NATIVE_EXACT_KINDS) {
      const encoded = toNativeKernelSolid(box(kind, {
        kind,
        width: 24,
        depth: 12,
        height: 16,
        sides: 6,
        bevel: 3,
        radius: 2,
        baseRadius: 8,
        topRadius: 2,
        gearSpec: { form: "spur", teeth: 16, module: 1.5, pressureAngle: 20, backlash: 0.1, bore: 4 },
      }));
      expect(encoded?.kind, kind).toBe(kind === "gear" ? "gear" : kind);
      if (kind === "gear") expect(encoded?.profileLoops?.outer.length).toBeGreaterThan(8);
    }
  });

  it("serializes a rectangular sketch extrusion for the sidecar", () => {
    const shape = box("sketch", {
      kind: "mesh",
      sketchFinish: "extrude",
      sketchProfile: {
        points: [
          { id: "p1", x: -5, z: -5 },
          { id: "p2", x: 5, z: -5 },
          { id: "p3", x: 5, z: 5 },
          { id: "p4", x: -5, z: 5 },
        ],
        segments: [
          { id: "s1", startId: "p1", endId: "p2", kind: "line" },
          { id: "s2", startId: "p2", endId: "p3", kind: "line" },
          { id: "s3", startId: "p3", endId: "p4", kind: "line" },
          { id: "s4", startId: "p4", endId: "p1", kind: "line" },
        ],
      },
    });
    const job = serializeSketchExtrudeJob(shape, 8);
    expect(job?.type).toBe("sketchExtrude");
    expect(job?.loops.length).toBe(1);
    expect(job?.loops[0]).toMatchObject({ kind: "wire" });
  });
});

describe.skipIf(!hasNativeKernelExe)("MintrKernel.exe job coverage", () => {
  const client = spawnNativeKernelClient();
  afterAll(() => client.close());

  it("pings the native OCCT sidecar", async () => {
    const reply = await client.request({ id: 1, type: "ping" });
    expect(reply).toMatchObject({ ok: true, native: true });
  });

  it("builds every exact primitive as a boolean operand", async () => {
    const kinds = [...NATIVE_EXACT_KINDS];
    for (let index = 0; index < kinds.length; index += 1) {
      const kind = kinds[index];
      const solid = toNativeKernelSolid(box(kind, {
        kind,
        x: index * 40,
        width: kind === "cylinder" || kind === "cone" ? 24 : 20,
        depth: kind === "cylinder" || kind === "cone" ? 12 : 20,
        height: 16,
        sides: 6,
        bevel: 3,
        radius: kind === "torus" ? 3 : 0,
        baseRadius: 8,
        topRadius: 2,
        gearSpec: { form: "spur", teeth: 12, module: 1.25, pressureAngle: 20, backlash: 0.1, bore: 3 },
      }));
      expect(solid, kind).toBeTruthy();
      const reply = await client.request({
        id: 100 + index,
        type: "boolean",
        op: "union",
        solids: [solid],
      });
      expect(reply.ok, `${kind}: ${String(reply.message)}`).toBe(true);
      expect(reply.fallback).not.toBe(true);
      expect(Array.isArray(reply.positions) && (reply.positions as number[]).length >= 9, kind).toBe(true);
      expect(String(reply.brepStep ?? "")).toContain("ISO-10303");
    }
  }, 180000);

  it("fuses nine boxes without falling back", async () => {
    const solids = Array.from({ length: 9 }, (_, i) => toNativeKernelSolid(box(`b${i}`, { x: i * 22 })));
    const reply = await client.request({ id: 2, type: "boolean", op: "union", solids });
    expect(reply.ok).toBe(true);
    expect(Array.isArray(reply.positions) && (reply.positions as number[]).length >= 9).toBe(true);
  });

  it("cuts a flush hole all the way through", async () => {
    const solid = box("block");
    const hole = box("bore", { kind: "cylinder", hole: true, width: 8, depth: 8, size: 8 });
    const cutter = punchThroughCutter(hole, [solid]);
    const reply = await client.request({
      id: 3,
      type: "boolean",
      op: "subtract",
      solids: [toNativeKernelSolid(solid), toNativeKernelSolid(cutter)],
    });
    expect(reply.ok, String(reply.message)).toBe(true);
    const positions = reply.positions as number[];
    expect(positions.length).toBeGreaterThan(9);
    const radius = 8 * 0.45;
    let midBore = 0;
    for (let i = 0; i < positions.length; i += 9) {
      const y = (positions[i + 1] + positions[i + 4] + positions[i + 7]) / 3;
      if (y < 2 || y > 18) continue;
      const x = (positions[i] + positions[i + 3] + positions[i + 6]) / 3;
      const z = (positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3;
      if (x * x + z * z < radius * radius) midBore += 1;
    }
    expect(midBore).toBe(0);
  });

  it("extrudes a sketch rectangle", async () => {
    const shape = box("sketch", {
      kind: "mesh",
      sketchFinish: "extrude",
      sketchProfile: {
        points: [
          { id: "p1", x: -6, z: -4 },
          { id: "p2", x: 6, z: -4 },
          { id: "p3", x: 6, z: 4 },
          { id: "p4", x: -6, z: 4 },
        ],
        segments: [
          { id: "s1", startId: "p1", endId: "p2", kind: "line" },
          { id: "s2", startId: "p2", endId: "p3", kind: "line" },
          { id: "s3", startId: "p3", endId: "p4", kind: "line" },
          { id: "s4", startId: "p4", endId: "p1", kind: "line" },
        ],
      },
    });
    const payload = serializeSketchExtrudeJob(shape, 10);
    expect(payload).toBeTruthy();
    const reply = await client.request({ id: 3, ...payload });
    expect(reply.ok, String(reply.message)).toBe(true);
    expect(String(reply.cadBrep ?? "")).toContain("CASCADE");
  });

  it("sweeps a circle along a line", async () => {
    const reply = await client.request({
      id: 4,
      type: "sketchSweep",
      pathClosed: false,
      outer: { circle: { center: { x: 0, y: 0, z: 0 }, radius: 3, axis: { x: 1, y: 0, z: 0 } }, edges: [] },
      path: {
        edges: [{ kind: "line", from: { x: 0, y: 0, z: 0 }, to: { x: 20, y: 0, z: 0 } }],
      },
    });
    expect(reply.ok, String(reply.message)).toBe(true);
    expect(Array.isArray(reply.positions) && (reply.positions as number[]).length >= 9).toBe(true);
  });

  it("round-trips a box through STEP export and import", async () => {
    const exported = await client.request({
      id: 5,
      type: "exportStep",
      solids: [toNativeKernelSolid(box("step"))],
    });
    expect(exported.ok).toBe(true);
    const step = String(exported.step ?? "");
    expect(step).toContain("ISO-10303");
    const imported = await client.request({
      id: 6,
      type: "importStep",
      fileName: "box.step",
      step,
    });
    expect(imported.ok, String(imported.message)).toBe(true);
    const bodies = imported.bodies as Array<{ stepText?: string; positions?: number[] }>;
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies[0]?.stepText).toContain("ISO-10303");
    expect((bodies[0]?.positions?.length ?? 0) >= 9).toBe(true);
  });

  it("prepares a box, fillets, and hollows it", async () => {
    const prepared = await client.request({
      id: 7,
      requestId: 7,
      type: "prepare",
      sharpAngle: 12,
      parts: [{ hole: false, primitive: { kind: "box", width: 20, depth: 20, height: 20 } }],
    });
    expect(prepared.ok, String(prepared.message)).toBe(true);
    expect(prepared.type).toBe("ready");
    const edgeIds = (prepared.selectableEdgeIds as number[] | undefined) ?? [];
    expect(edgeIds.length).toBeGreaterThan(0);
    const fillet = await client.request({
      id: 8,
      requestId: 8,
      type: "preview",
      kind: "fillet",
      edgeIds: edgeIds.slice(0, 1),
      amount: 1,
      chamferAngle: 45,
    });
    expect(fillet.ok, String(fillet.message)).toBe(true);
    const hollow = await client.request({
      id: 9,
      requestId: 9,
      type: "hollow",
      thickness: 2,
      openings: ["top"],
      corners: "sharp",
      cornerRadius: 1,
    });
    expect(hollow.ok, String(hollow.message)).toBe(true);
    expect(hollow.type).toBe("preview");
    await client.request({ id: 10, requestId: 10, type: "dispose" });
  });

  it("threads a cylinder after prepare", async () => {
    const prepared = await client.request({
      id: 11,
      requestId: 11,
      type: "prepare",
      sharpAngle: 12,
      parts: [{ hole: false, primitive: { kind: "cylinder", radius: 6, height: 20 } }],
    });
    expect(prepared.ok, String(prepared.message)).toBe(true);
    const faces = prepared.cylindricalFaces as Array<{ id: number; radius: number; height: number }> | undefined;
    expect(faces && faces.length > 0).toBe(true);
    const thread = await client.request({
      id: 12,
      requestId: 12,
      type: "previewThread",
      faceId: faces![0].id,
      majorDiameter: faces![0].radius * 2,
      pitch: 1.25,
      length: Math.min(12, faces![0].height),
      depth: 0.6,
      side: "external",
      handedness: "right",
      quality: "standard",
    });
    expect(thread.ok, String(thread.message)).toBe(true);
    await client.request({ id: 13, requestId: 13, type: "dispose" });
  }, 60000);

  it("splits a box with a plug joint and returns two exact halves", async () => {
    const solid = toNativeKernelSolid(box("split-box", { width: 40, depth: 40, height: 40, size: 40 }));
    expect(solid).toBeTruthy();
    const reply = await client.request({
      id: 14,
      type: "split",
      solids: [solid],
      origin: [0, 20, 0],
      normal: [1, 0, 0],
      joint: "plug",
      clearance: 0.2,
      axis: "x",
    });
    expect(reply.ok, String(reply.message)).toBe(true);
    const parts = reply.parts as Array<{ positions?: number[]; brepStep?: string; elevation?: number }>;
    expect(parts).toHaveLength(2);
    expect((parts[0]?.positions?.length ?? 0) >= 9).toBe(true);
    expect((parts[1]?.positions?.length ?? 0) >= 9).toBe(true);
    expect(String(parts[0]?.brepStep ?? "")).toContain("ISO-10303");
    expect(parts[0]?.elevation).toBe(0);
    expect(parts[1]?.elevation).toBe(0);
  }, 60000);

  it("measures volume and area of a 20 mm cube", async () => {
    const solid = toNativeKernelSolid(box("measure-box"));
    expect(solid).toBeTruthy();
    const reply = await client.request({
      id: 15,
      type: "measure",
      solids: [solid],
    });
    expect(reply.ok, String(reply.message)).toBe(true);
    expect(Number(reply.volume)).toBeCloseTo(8000, 0);
    expect(Number(reply.area)).toBeCloseTo(2400, 0);
  });

  it("marks a downward cube face as an overhang from the B-rep", async () => {
    const solid = toNativeKernelSolid(box("print-box", { elevation: 8 }));
    expect(solid).toBeTruthy();
    const reply = await client.request({
      id: 16,
      type: "printOverlay",
      solids: [solid],
      overhang: true,
      angle: 45,
      thinWalls: false,
      smallHoles: false,
      trappedResin: false,
      nozzleMm: 0.4,
    });
    expect(reply.ok, String(reply.message)).toBe(true);
    expect(Array.isArray(reply.overhangPositions) && (reply.overhangPositions as number[]).length >= 9).toBe(true);
  });
});
