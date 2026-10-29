import { afterAll, describe, expect, it } from "vitest";
import type { CadModifierEdge, CadPlanarFace } from "@/lib/cadModifierTypes";
import { fingerprintsForEdgeIds } from "@/lib/edgeTreatmentRematch";
import { faceForStep, placeReplayedShape, replayPartFeatures, type ReplayEngine, type ReplayPrepared } from "@/lib/featureReplay";
import { edgeTreatmentPartFeature, hollowPartFeature, pushPullPartFeature, resizedFeatureBase, stepsFromSnapshots } from "@/lib/partFeatures";
import type { PartFeature, WorkplaneShape } from "@/types/sketchforge";
import { hasNativeKernelExe, spawnNativeKernelClient, type NativeKernelClient } from "../helpers/nativeKernelChild";
import { hasWasmKernel, startWasmKernel } from "../helpers/wasmKernel";

function box(width = 20, depth = 20, height = 20): WorkplaneShape {
  return { id: "part", name: "Part", kind: "box", color: "#d41721", x: 0, z: 0, elevation: 0, size: Math.max(width, depth), width, depth, height, rotation: 0 };
}

type KernelClient = { request: (job: Record<string, unknown>) => Promise<Record<string, unknown>> };

/** Signed volume of a triangle soup (flat x,y,z per corner). */
function meshVolume(shape: WorkplaneShape) {
  const p = shape.importedMesh?.positions ?? [];
  let volume = 0;
  for (let i = 0; i + 8 < p.length; i += 9) {
    volume += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7])
      - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6])
      + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
  }
  return Math.abs(volume);
}

/** The engine calls a replay makes, answered by the Mintr engine directly, in world space. */
function kernelEngine(client: KernelClient): ReplayEngine {
  let id = 5000;
  const request = (job: Record<string, unknown>) => {
    id += 1;
    return client.request({ id, requestId: id, ...job });
  };
  const part = (shape: WorkplaneShape) => {
    if (shape.cadBrep) return { hole: false, brep: shape.cadBrep };
    if (shape.kind === "cylinder") return { hole: false, primitive: { kind: "cylinder", radius: shape.width / 2, height: shape.height } };
    return { hole: false, primitive: { kind: "box", width: shape.width, depth: shape.depth, height: shape.height } };
  };
  const finish = async (source: WorkplaneShape, reply: Record<string, unknown>): Promise<WorkplaneShape> => {
    if (reply.ok === false) throw new Error(String(reply.message));
    const exact = await request({ type: "finalize" });
    if (exact.ok === false || !exact.brep) throw new Error(String(exact.message ?? "no solid"));
    const positions = reply.positions as number[];
    const indices = reply.indices as number[];
    const soup: number[] = [];
    for (const index of indices) soup.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
    let minX = Infinity; let minY = Infinity; let minZ = Infinity; let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
      minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
      minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
    }
    return {
      ...source,
      kind: "mesh",
      x: (minX + maxX) / 2,
      z: (minZ + maxZ) / 2,
      elevation: minY,
      width: maxX - minX,
      height: maxY - minY,
      depth: maxZ - minZ,
      cadBrep: String(exact.brep),
      importedMesh: { positions: soup, baseWidth: maxX - minX, baseDepth: maxZ - minZ, baseHeight: maxY - minY, triangleCount: indices.length / 3, sourceFormat: "json" },
    };
  };
  return {
    async prepare(shape, sharpAngle) {
      const reply = await request({ type: "prepare", sharpAngle, parts: [part(shape)] });
      if (reply.ok === false) throw new Error(String(reply.message));
      return { edges: reply.edges as CadModifierEdge[], planarFaces: (reply.planarFaces ?? []) as CadPlanarFace[] };
    },
    async edgeTreatment(shape, step) {
      return finish(shape, await request({ type: "preview", ...step }));
    },
    async hollow(shape, step) {
      return finish(shape, await request({ type: "hollow", quality: "standard", ...step }));
    },
    async pushPull(shape, step) {
      return finish(shape, await request({ type: "pushPull", quality: "standard", ...step }));
    },
  };
}

/** The four upright corner edges, picked the way a person would click them. */
function cornerEdgeIds(prepared: ReplayPrepared) {
  return prepared.edges
    .filter((edge) => edge.display && edge.selectable && edge.manifold && !edge.boundary)
    .filter((edge) => {
      const [x, , z] = edge.points;
      for (let i = 0; i + 2 < edge.points.length; i += 3) {
        if (Math.abs(edge.points[i] - x) > 1e-3 || Math.abs(edge.points[i + 2] - z) > 1e-3) return false;
      }
      return true;
    })
    .map((edge) => edge.id);
}

/** Round the corners by hand, then hollow it open at the top (a cup), recording each step as the editor does. */
async function buildByHand(engine: ReplayEngine, base: WorkplaneShape, record: boolean) {
  const features: PartFeature[] = [];
  const prepared = await engine.prepare(base, 25);
  const edgeIds = cornerEdgeIds(prepared);
  expect(edgeIds).toHaveLength(4);
  const recipe = { kind: "fillet" as const, amount: 2, edgeCount: 4, sharpAngle: 25, edgeFingerprints: fingerprintsForEdgeIds(prepared.edges, edgeIds) };
  const filleted = await engine.edgeTreatment(base, { kind: "fillet", edgeIds, amount: 2, chamferAngle: 45, filletProfile: "round", quality: "standard" });
  if (record) features.push({ ...edgeTreatmentPartFeature("f1", recipe, prepared.edges), appliedAt: [filleted.x, filleted.elevation ?? 0, filleted.z] });
  const settings = { thickness: 1.5, openings: ["top"] as Array<"top">, corners: "sharp" as const, cornerRadius: 0 };
  await engine.prepare(filleted, 12);
  const hollowed = await engine.hollow(filleted, settings);
  if (record) features.push({ ...hollowPartFeature("h1", settings, filleted), appliedAt: [hollowed.x, hollowed.elevation ?? 0, hollowed.z] });
  return { shape: hollowed, features };
}

describe("finding a step's face again", () => {
  const face = (id: number, origin: [number, number, number], normal: [number, number, number], area = 400): CadPlanarFace => ({
    id,
    origin: { x: origin[0], y: origin[1], z: origin[2] },
    normal: { x: normal[0], y: normal[1], z: normal[2] },
    points: [origin[0] - 10, origin[1], origin[2] - 10, origin[0] + 10, origin[1], origin[2] + 10],
    area,
  });
  const cube = (size: number, at: [number, number, number] = [0, 0, 0]) => [
    face(1, [at[0], at[1] + size, at[2]], [0, 1, 0]),
    face(2, [at[0], at[1], at[2]], [0, -1, 0]),
    face(3, [at[0] + size / 2, at[1] + size / 2, at[2]], [1, 0, 0]),
    { ...face(4, [at[0] - size / 2, at[1] + size / 2, at[2]], [-1, 0, 0]), points: [at[0] - size / 2, at[1], at[2] - size / 2, at[0] - size / 2, at[1] + size, at[2] + size / 2] },
  ];

  it("finds the top face on the same part, a moved part and a taller part", () => {
    const recordedFaces = cube(20);
    const step = pushPullPartFeature("p", recordedFaces[0], 3, recordedFaces);
    if (step.kind !== "pushPull") throw new Error("expected push/pull");
    expect(faceForStep(step, recordedFaces)?.id).toBe(1);
    expect(faceForStep(step, cube(20, [40, 5, -7]))?.id).toBe(1);
    expect(faceForStep(step, cube(30))?.id).toBe(1);
  });

  it("finds no face when the part no longer has one facing that way", () => {
    const recordedFaces = cube(20);
    const step = pushPullPartFeature("p", recordedFaces[0], 3, recordedFaces);
    if (step.kind !== "pushPull") throw new Error("expected push/pull");
    expect(faceForStep(step, recordedFaces.filter((entry) => entry.id !== 1))).toBeNull();
  });
});

describe("placing a rebuilt part", () => {
  it("follows the part's moves since its last step, and its turn and stretch", () => {
    const rebuilt: WorkplaneShape = { ...box(), kind: "mesh", x: 1, z: 2, elevation: 0, cadBrepFrame: { x: 1, z: 2, elevation: 0, width: 20, depth: 20, height: 20 } };
    const live: WorkplaneShape = { ...box(40, 20, 20), kind: "mesh", x: 51, z: 2, elevation: 3, rotation: 90, cadBrepFrame: { x: 1, z: 2, elevation: 0, width: 20, depth: 20, height: 20 } };
    const placed = placeReplayedShape(rebuilt, live, { recordedAt: [1, 0, 2], drift: [0, 0, 0] });
    expect([placed.x, placed.elevation, placed.z]).toEqual([51, 3, 2]);
    expect(placed.width).toBeCloseTo(40);
    expect(placed.rotation).toBe(90);
  });

  it("accounts for a part that was moved between two steps", () => {
    const rebuilt: WorkplaneShape = { ...box(), kind: "mesh", x: 0, z: 0, elevation: 0 };
    const live: WorkplaneShape = { ...box(), kind: "mesh", x: 50, z: 0, elevation: 0 };
    // The last step was recorded 50 mm along; the replay ran it at the origin, so it drifted -50.
    const placed = placeReplayedShape(rebuilt, live, { recordedAt: [50, 0, 0], drift: [50, 0, 0] });
    expect(placed.x).toBe(50);
  });
});

describe("replay without an engine answer", () => {
  it("skips suppressed steps and marks steps that throw, then keeps going", async () => {
    const calls: string[] = [];
    const engine: ReplayEngine = {
      prepare: async () => ({ edges: [], planarFaces: [] }),
      edgeTreatment: async () => { throw new Error("unused"); },
      hollow: async (shape, step) => {
        calls.push(`hollow ${step.thickness}`);
        if (step.thickness > 5) throw new Error("The walls are too thick for this part.");
        return { ...shape, name: `${shape.name}+h${step.thickness}` };
      },
      pushPull: async () => { throw new Error("unused"); },
    };
    const steps: PartFeature[] = [
      hollowPartFeature("a", { thickness: 1, openings: ["top"], corners: "sharp", cornerRadius: 0 }),
      { ...hollowPartFeature("b", { thickness: 2, openings: ["top"], corners: "sharp", cornerRadius: 0 }), suppressed: true },
      hollowPartFeature("c", { thickness: 9, openings: ["top"], corners: "sharp", cornerRadius: 0 }),
      hollowPartFeature("d", { thickness: 3, openings: ["top"], corners: "sharp", cornerRadius: 0 }),
    ];
    const result = await replayPartFeatures(box(), steps, engine);
    expect(calls).toEqual(["hollow 1", "hollow 9", "hollow 3"]);
    expect(result.shape.name).toBe("Part+h1+h3");
    expect(result.steps.map((step) => [step.id, step.ok, step.skipped ?? false])).toEqual([
      ["a", true, false], ["b", true, true], ["c", false, false], ["d", true, false],
    ]);
    expect(result.features[2].failed).toMatch(/too thick/);
    // A step that fits again loses its old failure mark.
    const again = await replayPartFeatures(box(), [{ ...steps[0], failed: "old" }], engine);
    expect(again.features[0].failed).toBeUndefined();
  });
});

const engines: Array<{ name: string; available: boolean; start: () => Promise<KernelClient & { close?: () => void }> }> = [
  { name: "desktop engine", available: hasNativeKernelExe, start: async () => spawnNativeKernelClient() },
  { name: "browser engine (WebAssembly)", available: hasWasmKernel, start: startWasmKernel },
];

for (const { name, available, start } of engines) {
  describe.skipIf(!available)(`replaying steps on the ${name}`, () => {
    let client: (KernelClient & { close?: () => void }) | null = null;
    const engine = () => kernelEngine({ request: async (job) => (client ??= await start()).request(job) });
    afterAll(() => (client as NativeKernelClient | null)?.close?.());

    it("rebuilds a filleted, hollowed box exactly as it was made by hand", async () => {
      const made = await buildByHand(engine(), box(), true);
      const replayed = await replayPartFeatures(box(), made.features, engine());
      expect(replayed.steps.every((step) => step.ok), JSON.stringify(replayed.steps)).toBe(true);
      expect(meshVolume(replayed.shape)).toBeCloseTo(meshVolume(made.shape), 1);
    }, 60000);

    it("keeps the fillet size and wall thickness when the starting box is resized", async () => {
      const made = await buildByHand(engine(), box(), true);
      const bigger = box(30, 24, 26);
      const replayed = await replayPartFeatures(bigger, made.features, engine());
      expect(replayed.steps.every((step) => step.ok), JSON.stringify(replayed.steps)).toBe(true);
      // The same steps applied by hand to the bigger box give the same solid.
      const byHand = await buildByHand(engine(), bigger, false);
      expect(meshVolume(replayed.shape)).toBeCloseTo(meshVolume(byHand.shape), 1);
      expect(replayed.shape.height).toBeCloseTo(26, 3);
    }, 60000);

    it("rebuilds a pulled face on a taller part", async () => {
      const e = engine();
      const prepared = await e.prepare(box(), 12);
      const top = prepared.planarFaces.find((face) => face.normal.y > 0.9)!;
      const pulled = await e.pushPull(box(), { faceId: top.id, distance: 5 });
      const step: PartFeature = { ...pushPullPartFeature("p1", top, 5, prepared.planarFaces), appliedAt: [pulled.x, pulled.elevation ?? 0, pulled.z] };
      expect(pulled.height).toBeCloseTo(25, 3);
      const replayed = await replayPartFeatures(box(20, 20, 30), [step], engine());
      expect(replayed.steps[0].ok, JSON.stringify(replayed.steps)).toBe(true);
      expect(replayed.shape.height).toBeCloseTo(35, 3);
    }, 60000);

    it("resizes a pulled part to the exact size asked for, keeping the pull", async () => {
      const e = engine();
      const prepared = await e.prepare(box(), 12);
      const top = prepared.planarFaces.find((face) => face.normal.y > 0.9)!;
      const pulled = await e.pushPull(box(), { faceId: top.id, distance: 6 });
      const step: PartFeature = { ...pushPullPartFeature("p1", top, 6, prepared.planarFaces), appliedAt: [pulled.x, pulled.elevation ?? 0, pulled.z] };
      // The 26 mm part is made 30 wide and 32 tall: the box grows to 30 x 26, the pull stays 6.
      const base = resizedFeatureBase(box(), [20, 26, 20], [30, 32, 20]);
      expect([base.width, base.height, base.depth]).toEqual([30, 26, 20]);
      const replayed = await replayPartFeatures(base, [step], engine());
      expect(replayed.steps[0].ok, JSON.stringify(replayed.steps)).toBe(true);
      expect(replayed.shape.width).toBeCloseTo(30, 3);
      expect(replayed.shape.height).toBeCloseTo(32, 3);
      expect(meshVolume(replayed.shape)).toBeCloseTo(30 * 20 * 32, 0);
    }, 60000);

    it("rebuilds a part from an older file, converted from the copy it kept before its fillet", async () => {
      const e = engine();
      const prepared = await e.prepare(box(), 25);
      const edgeIds = cornerEdgeIds(prepared);
      const recipe = { kind: "fillet" as const, amount: 2, edgeCount: 4, sharpAngle: 25, edgeFingerprints: fingerprintsForEdgeIds(prepared.edges, edgeIds) };
      const filleted = await e.edgeTreatment(box(), { kind: "fillet", edgeIds, amount: 2, chamferAngle: 45, filletProfile: "round", quality: "standard" });
      const saved: WorkplaneShape = {
        ...filleted,
        edgeTreatments: [recipe],
        edgeTreatmentHistory: [{
          id: "old-1",
          createdAt: 0,
          feature: recipe,
          before: box(),
          appliedFrame: { x: filleted.x, z: filleted.z, elevation: filleted.elevation ?? 0, width: filleted.width, depth: filleted.depth, height: filleted.height, rotation: 0, rotationX: 0, rotationZ: 0, mirrorX: false, mirrorY: false, mirrorZ: false },
        }],
      };
      const converted = stepsFromSnapshots(saved);
      expect(converted.edgeTreatmentHistory).toBeUndefined();
      expect(converted.features?.map((step) => step.id)).toEqual(["old-1"]);
      const replayed = await replayPartFeatures(converted.featureBase!, converted.features!, engine());
      expect(replayed.steps.every((step) => step.ok), JSON.stringify(replayed.steps)).toBe(true);
      expect(meshVolume(replayed.shape)).toBeCloseTo(meshVolume(filleted), 1);
    }, 60000);

    it("marks a fillet whose edges are gone and still runs the steps after it", async () => {
      const made = await buildByHand(engine(), box(), true);
      // A round part has no upright corners for the fillet, but it can still be hollowed.
      const cylinder: WorkplaneShape = { ...box(), kind: "cylinder" };
      const replayed = await replayPartFeatures(cylinder, made.features, engine());
      expect(replayed.steps.map((step) => step.ok)).toEqual([false, true]);
      expect(replayed.features[0].failed).toBeTruthy();
      expect(meshVolume(replayed.shape)).toBeLessThan(Math.PI * 100 * 20 * 0.5);
    }, 60000);
  });
}
