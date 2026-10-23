import { afterAll, describe, expect, it } from "vitest";
import { punchThroughCutter } from "@/lib/editorBoolean";
import { serializeSketchExtrudeJob } from "@/lib/sketchExtrusionSolid";
import { booleanResultLooksExploded, extentsFromPositions } from "@/lib/stepExport";
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

  it("fuses overlapping boxes one after another without exploding", async () => {
    const solids = Array.from({ length: 5 }, (_, i) => toNativeKernelSolid(box(`k${i}`, { x: i * 12 })));
    const reply = await client.request({ id: 36, type: "boolean", op: "union", solids });
    expect(reply.ok, String(reply.message)).toBe(true);
    const positions = reply.positions as number[];
    expect(positions.length).toBeGreaterThan(9);
    const extents = extentsFromPositions(positions);
    expect(extents).not.toBeNull();
    expect(booleanResultLooksExploded(
      { width: 68, height: 20, depth: 20 },
      extents!,
    )).toBe(false);
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

  it("cuts two flush holes without exploding the host", async () => {
    const solid = box("block", { width: 40, depth: 24, size: 40 });
    const holeA = punchThroughCutter(
      box("bore-a", { kind: "cylinder", hole: true, width: 8, depth: 8, size: 8, x: -10 }),
      [solid],
    );
    const holeB = punchThroughCutter(
      box("bore-b", { kind: "cylinder", hole: true, width: 8, depth: 8, size: 8, x: 10 }),
      [solid],
    );
    const reply = await client.request({
      id: 31,
      type: "boolean",
      op: "subtract",
      solids: [toNativeKernelSolid(solid), toNativeKernelSolid(holeA), toNativeKernelSolid(holeB)],
    });
    expect(reply.ok, String(reply.message)).toBe(true);
    const positions = reply.positions as number[];
    expect(positions.length).toBeGreaterThan(9);
    const extents = extentsFromPositions(positions);
    expect(extents).not.toBeNull();
    expect(booleanResultLooksExploded(
      { width: 40, height: 20, depth: 24 },
      extents!,
    )).toBe(false);
    const radius = 8 * 0.45;
    const emptyBore = (cx: number) => {
      let hits = 0;
      for (let i = 0; i < positions.length; i += 9) {
        const y = (positions[i + 1] + positions[i + 4] + positions[i + 7]) / 3;
        if (y < 2 || y > 18) continue;
        const x = (positions[i] + positions[i + 3] + positions[i + 6]) / 3;
        const z = (positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3;
        if ((x - cx) * (x - cx) + z * z < radius * radius) hits += 1;
      }
      return hits;
    };
    expect(emptyBore(-10)).toBe(0);
    expect(emptyBore(10)).toBe(0);
  });

  it("splits a block with one hole the same way as two", async () => {
    const solid = box("split-one", { width: 40, depth: 24, size: 40 });
    const hole = punchThroughCutter(
      box("bore", { kind: "cylinder", hole: true, width: 8, depth: 8, size: 8 }),
      [solid],
    );
    const reply = await client.request({
      id: 37,
      type: "split",
      solids: [toNativeKernelSolid(solid), toNativeKernelSolid(hole)],
      origin: [0, 20, 0],
      normal: [1, 0, 0],
      joint: "none",
      clearance: 0.2,
      axis: "x",
    });
    expect(reply.ok, String(reply.message)).toBe(true);
    const parts = reply.parts as Array<{ positions?: number[] }>;
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      const positions = part.positions ?? [];
      expect(positions.length).toBeGreaterThan(9);
      const extents = extentsFromPositions(positions);
      expect(extents).not.toBeNull();
      expect(booleanResultLooksExploded(
        { width: 40, height: 20, depth: 24 },
        extents!,
      )).toBe(false);
    }
  }, 60000);

  it("splits a block with two holes without exploding the host", async () => {
    const solid = box("split-block", { width: 40, depth: 24, size: 40 });
    const holeA = punchThroughCutter(
      box("bore-a", { kind: "cylinder", hole: true, width: 8, depth: 8, size: 8, x: -10 }),
      [solid],
    );
    const holeB = punchThroughCutter(
      box("bore-b", { kind: "cylinder", hole: true, width: 8, depth: 8, size: 8, x: 10 }),
      [solid],
    );
    const reply = await client.request({
      id: 32,
      type: "split",
      solids: [toNativeKernelSolid(solid), toNativeKernelSolid(holeA), toNativeKernelSolid(holeB)],
      origin: [0, 20, 0],
      normal: [1, 0, 0],
      joint: "none",
      clearance: 0.2,
      axis: "x",
    });
    expect(reply.ok, String(reply.message)).toBe(true);
    const parts = reply.parts as Array<{ positions?: number[] }>;
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      const positions = part.positions ?? [];
      expect(positions.length).toBeGreaterThan(9);
      const extents = extentsFromPositions(positions);
      expect(extents).not.toBeNull();
      expect(booleanResultLooksExploded(
        { width: 40, height: 20, depth: 24 },
        extents!,
      )).toBe(false);
    }
  }, 60000);

  it("fillets every selectable box edge, retrying one at a time if needed", async () => {
    const prepared = await client.request({
      id: 33,
      requestId: 33,
      type: "prepare",
      sharpAngle: 12,
      parts: [{ hole: false, primitive: { kind: "box", width: 20, depth: 20, height: 20 } }],
    });
    expect(prepared.ok, String(prepared.message)).toBe(true);
    const edgeIds = (prepared.selectableEdgeIds as number[] | undefined) ?? [];
    expect(edgeIds.length).toBeGreaterThan(1);
    const fillet = await client.request({
      id: 34,
      requestId: 34,
      type: "preview",
      kind: "fillet",
      edgeIds,
      amount: 6,
      chamferAngle: 45,
    });
    expect(fillet.ok, String(fillet.message)).toBe(true);
    await client.request({ id: 35, requestId: 35, type: "dispose" });
  }, 60000);

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

  it("pulls and pushes a box face, and rejects a bad push", async () => {
    const prepared = await client.request({
      id: 41,
      requestId: 41,
      type: "prepare",
      sharpAngle: 12,
      parts: [{ hole: false, primitive: { kind: "box", width: 20, depth: 20, height: 20 } }],
    });
    expect(prepared.ok, String(prepared.message)).toBe(true);
    const faces = prepared.planarFaces as Array<{ id: number; normal: { x: number; y: number; z: number }; points: number[] }> | undefined;
    expect(faces && faces.length).toBe(6);
    // Each outline is an ordered open loop of the four corners: no zigzag diagonals, no repeats.
    for (const face of faces!) {
      const corners: number[][] = [];
      for (let index = 0; index + 2 < face.points.length; index += 3) corners.push(face.points.slice(index, index + 3));
      expect(corners, `face ${face.id}`).toHaveLength(4);
      for (let index = 0; index < corners.length; index += 1) {
        const a = corners[index];
        const b = corners[(index + 1) % corners.length];
        const moved = [0, 1, 2].filter((axis) => Math.abs(a[axis] - b[axis]) > 1e-6);
        expect(moved, `face ${face.id} segment ${index} is a diagonal`).toHaveLength(1);
        expect(Math.abs(a[moved[0]] - b[moved[0]])).toBeCloseTo(20, 6);
      }
    }
    const top = faces!.find((face) => face.normal.y > 0.9);
    expect(top).toBeTruthy();
    const pull = await client.request({
      id: 42,
      requestId: 42,
      type: "pushPull",
      faceId: top!.id,
      distance: 5,
      quality: "standard",
    });
    expect(pull.ok, String(pull.message)).toBe(true);
    const pulled = extentsFromPositions((pull.positions as number[] | undefined) ?? []);
    expect(pulled).not.toBeNull();
    expect(pulled!.height).toBeCloseTo(25, 0);

    const preparedAgain = await client.request({
      id: 43,
      requestId: 43,
      type: "prepare",
      sharpAngle: 12,
      parts: [{ hole: false, primitive: { kind: "box", width: 20, depth: 20, height: 20 } }],
    });
    const facesAgain = preparedAgain.planarFaces as Array<{ id: number; normal: { x: number; y: number; z: number } }>;
    const topAgain = facesAgain.find((face) => face.normal.y > 0.9)!;
    const push = await client.request({
      id: 44,
      requestId: 44,
      type: "pushPull",
      faceId: topAgain.id,
      distance: -5,
      quality: "standard",
    });
    expect(push.ok, String(push.message)).toBe(true);
    const pushed = extentsFromPositions((push.positions as number[] | undefined) ?? []);
    expect(pushed).not.toBeNull();
    expect(pushed!.height).toBeCloseTo(15, 0);

    const over = await client.request({
      id: 45,
      requestId: 45,
      type: "pushPull",
      faceId: topAgain.id,
      distance: -40,
      quality: "standard",
    });
    expect(over.ok).toBe(false);
    expect(String(over.message)).toMatch(/smaller distance|flat face/i);

    const missing = await client.request({
      id: 46,
      requestId: 46,
      type: "pushPull",
      faceId: 99,
      distance: 4,
      quality: "standard",
    });
    expect(missing.ok).toBe(false);
    expect(String(missing.message)).toMatch(/flat face/i);
    await client.request({ id: 48, requestId: 48, type: "dispose" });
  }, 60000);

  it("pulls the top of a CAD-ready polygon", async () => {
    const prepared = await client.request({
      id: 61,
      requestId: 61,
      type: "prepare",
      sharpAngle: 12,
      parts: [{ hole: false, primitive: { kind: "polygon", sides: 6, width: 20, depth: 20, height: 20 } }],
    });
    expect(prepared.ok, String(prepared.message)).toBe(true);
    const faces = prepared.planarFaces as Array<{ id: number; area: number; normal: { x: number; y: number; z: number } }> | undefined;
    expect(faces && faces.length).toBeGreaterThanOrEqual(8);
    const top = [...(faces ?? [])]
      .filter((face) => face.normal.y > 0.9)
      .sort((a, b) => b.area - a.area)[0];
    expect(top).toBeTruthy();
    const pull = await client.request({
      id: 62,
      requestId: 62,
      type: "pushPull",
      faceId: top!.id,
      distance: 5,
      quality: "standard",
    });
    expect(pull.ok, String(pull.message)).toBe(true);
    const pulled = extentsFromPositions((pull.positions as number[] | undefined) ?? []);
    expect(pulled).not.toBeNull();
    expect(pulled!.height).toBeCloseTo(25, 0);
    const edges = pull.displayEdges as Array<{ points?: number[] }> | undefined;
    expect(Array.isArray(edges) && edges.length >= 8, "push pull should return CAD display edges").toBe(true);
    await client.request({ id: 63, requestId: 63, type: "dispose" });
  }, 60000);

  it("pulls the top of a pyramid and a roof", async () => {
    const pyramidReady = await client.request({
      id: 71,
      requestId: 71,
      type: "prepare",
      sharpAngle: 12,
      parts: [{ hole: false, primitive: { kind: "pyramid", sides: 4, width: 20, depth: 20, height: 16 } }],
    });
    expect(pyramidReady.ok, String(pyramidReady.message)).toBe(true);
    const pyramidFaces = pyramidReady.planarFaces as Array<{ id: number; area: number; normal: { x: number; y: number; z: number } }> | undefined;
    const pyramidBase = [...(pyramidFaces ?? [])]
      .filter((face) => face.normal.y < -0.9)
      .sort((a, b) => b.area - a.area)[0];
    expect(pyramidBase).toBeTruthy();
    const pyramidPull = await client.request({
      id: 72,
      requestId: 72,
      type: "pushPull",
      faceId: pyramidBase!.id,
      distance: 4,
      quality: "standard",
    });
    expect(pyramidPull.ok, String(pyramidPull.message)).toBe(true);
    const pyramidSize = extentsFromPositions((pyramidPull.positions as number[] | undefined) ?? []);
    expect(pyramidSize).not.toBeNull();
    expect(pyramidSize!.height).toBeCloseTo(20, 0);

    const roofReady = await client.request({
      id: 73,
      requestId: 73,
      type: "prepare",
      sharpAngle: 12,
      parts: [{ hole: false, primitive: { kind: "roof", width: 20, depth: 12, height: 16, ridgeX: 0 } }],
    });
    expect(roofReady.ok, String(roofReady.message)).toBe(true);
    const roofFaces = roofReady.planarFaces as Array<{ id: number; area: number; normal: { x: number; y: number; z: number } }> | undefined;
    const roofEnd = [...(roofFaces ?? [])]
      .filter((face) => Math.abs(face.normal.z) > 0.9)
      .sort((a, b) => b.area - a.area)[0];
    expect(roofEnd).toBeTruthy();
    const roofPull = await client.request({
      id: 74,
      requestId: 74,
      type: "pushPull",
      faceId: roofEnd!.id,
      distance: 5,
      quality: "standard",
    });
    expect(roofPull.ok, String(roofPull.message)).toBe(true);
    const roofSize = extentsFromPositions((roofPull.positions as number[] | undefined) ?? []);
    expect(roofSize).not.toBeNull();
    expect(roofSize!.depth).toBeCloseTo(17, 0);
    await client.request({ id: 75, requestId: 75, type: "dispose" });
  }, 60000);

  it("pulls and pushes a grouped overlapping pair without exploding", async () => {
    const prepared = await client.request({
      id: 51,
      requestId: 51,
      type: "prepare",
      sharpAngle: 12,
      parts: [
        { hole: false, primitive: { kind: "box", width: 20, depth: 20, height: 10 } },
        {
          hole: false,
          primitive: {
            kind: "box",
            width: 10,
            depth: 10,
            height: 10,
            transform: [1, 0, 0, 0, 0, 1, 0, 8, 0, 0, 1, 0],
          },
        },
      ],
    });
    expect(prepared.ok, String(prepared.message)).toBe(true);
    const faces = prepared.planarFaces as Array<{
      id: number;
      area: number;
      origin: { x: number; y: number; z: number };
      normal: { x: number; y: number; z: number };
    }> | undefined;
    expect(faces && faces.length).toBeGreaterThan(6);
    const top = [...(faces ?? [])]
      .filter((face) => face.normal.y > 0.9)
      .sort((a, b) => b.origin.y - a.origin.y || b.area - a.area)[0];
    expect(top).toBeTruthy();
    const pull = await client.request({
      id: 52,
      requestId: 52,
      type: "pushPull",
      faceId: top!.id,
      distance: 5,
      quality: "standard",
    });
    expect(pull.ok, String(pull.message)).toBe(true);
    const pulled = extentsFromPositions((pull.positions as number[] | undefined) ?? []);
    expect(pulled).not.toBeNull();
    expect(pulled!.height).toBeCloseTo(23, 0);
    expect(booleanResultLooksExploded({ width: 20, height: 18, depth: 20 }, pulled!)).toBe(false);

    const preparedAgain = await client.request({
      id: 53,
      requestId: 53,
      type: "prepare",
      sharpAngle: 12,
      parts: [
        { hole: false, primitive: { kind: "box", width: 20, depth: 20, height: 10 } },
        {
          hole: false,
          primitive: {
            kind: "box",
            width: 10,
            depth: 10,
            height: 10,
            transform: [1, 0, 0, 0, 0, 1, 0, 8, 0, 0, 1, 0],
          },
        },
      ],
    });
    const facesAgain = preparedAgain.planarFaces as Array<{
      id: number;
      area: number;
      origin: { x: number; y: number; z: number };
      normal: { x: number; y: number; z: number };
    }>;
    const topAgain = [...facesAgain]
      .filter((face) => face.normal.y > 0.9)
      .sort((a, b) => b.origin.y - a.origin.y || b.area - a.area)[0];
    const push = await client.request({
      id: 54,
      requestId: 54,
      type: "pushPull",
      faceId: topAgain.id,
      distance: -3,
      quality: "standard",
    });
    expect(push.ok, String(push.message)).toBe(true);
    expect(String(push.message ?? "")).not.toMatch(/went through/i);
    const pushed = extentsFromPositions((push.positions as number[] | undefined) ?? []);
    expect(pushed).not.toBeNull();
    expect(pushed!.height).toBeCloseTo(15, 0);
    expect(booleanResultLooksExploded({ width: 20, height: 18, depth: 20 }, pushed!)).toBe(false);
    await client.request({ id: 55, requestId: 55, type: "dispose" });
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

  it("prints marks on a block with one hole and with two holes", async () => {
    const solid = box("print-holes", { width: 40, depth: 24, size: 40, elevation: 8 });
    const holeA = punchThroughCutter(
      box("bore-a", { kind: "cylinder", hole: true, width: 8, depth: 8, size: 8, x: -10 }),
      [solid],
    );
    const holeB = punchThroughCutter(
      box("bore-b", { kind: "cylinder", hole: true, width: 8, depth: 8, size: 8, x: 10 }),
      [solid],
    );
    const job = {
      type: "printOverlay" as const,
      overhang: true,
      angle: 45,
      thinWalls: false,
      smallHoles: false,
      trappedResin: false,
      nozzleMm: 0.4,
    };
    const one = await client.request({
      id: 38,
      ...job,
      solids: [toNativeKernelSolid(solid), toNativeKernelSolid(holeA)],
    });
    expect(one.ok, String(one.message)).toBe(true);
    const two = await client.request({
      id: 39,
      ...job,
      solids: [toNativeKernelSolid(solid), toNativeKernelSolid(holeA), toNativeKernelSolid(holeB)],
    });
    expect(two.ok, String(two.message)).toBe(true);
  }, 60000);
});
