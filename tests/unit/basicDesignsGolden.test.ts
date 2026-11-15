import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGroupedShapeFromSelection, remeshCsgGroup } from "@/lib/editorBoolean";
import { meshForShape } from "@/lib/editorShapeMesh";
import { shapeExportQualityHint } from "@/lib/stepQuality";
import { tinkercadToShapes, type TinkercadPayload } from "@/lib/tinkercadImport";
import type { WorkplaneShape } from "@/types/sketchforge";
import { cornerEdgeIds, kernelEngine, testBox } from "../helpers/kernelReplayEngine";
import { hasWasmKernel, startWasmKernel, type WasmKernelClient } from "../helpers/wasmKernel";

/**
 * The safety net for designs people already have. Each design here is built the way the app
 * builds it, then measured the way an export sees it. The numbers are stored in
 * __snapshots__/basicDesignsGolden.test.ts.snap. If a change moves one, the part a user gets
 * has changed: look at why before accepting the new numbers with `npx vitest run -u`.
 *
 * Runs on the browser engine (the Mintr engine built to WebAssembly), which is what the web
 * version uses and what the desktop engine is held to. Build it with `npm run build:kernel:wasm`.
 */

type Signature = {
  volume: number;
  area: number;
  min: [number, number, number];
  max: [number, number, number];
  quality: string;
};

const round = (value: number, places: number) => {
  const rounded = Number(value.toFixed(places));
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** Volume, surface area, bounds and export quality of a part as an export sees it. */
function signature(shape: WorkplaneShape): Signature {
  const { vertices, faces } = meshForShape(shape);
  let volume = 0;
  let area = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  for (const [ia, ib, ic] of faces) {
    const a = vertices[ia]; const b = vertices[ib]; const c = vertices[ic];
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return {
    volume: round(Math.abs(volume), 1),
    area: round(area, 1),
    min: min.map((value) => round(value, 2)) as [number, number, number],
    max: max.map((value) => round(value, 2)) as [number, number, number],
    quality: shapeExportQualityHint(shape),
  };
}

let nextId = 0;
function part(kind: WorkplaneShape["kind"], width: number, depth: number, height: number, at: Partial<WorkplaneShape> = {}): WorkplaneShape {
  nextId += 1;
  return {
    id: `golden-${nextId}`, name: `${kind} ${nextId}`, kind, color: "#d41721",
    x: 0, z: 0, elevation: 0, size: Math.max(width, depth), width, depth, height, rotation: 0,
    locked: false, hidden: false, ...at,
  };
}

async function group(parts: WorkplaneShape[]) {
  const built = await buildGroupedShapeFromSelection(parts);
  if (!built.group) throw new Error(`Group did not build: ${built.qualityNotice ?? "no notice"}`);
  return built.group;
}

describe("basic shapes", () => {
  const shapes: Array<[string, WorkplaneShape]> = [
    ["box", part("box", 20, 30, 10)],
    ["cylinder", part("cylinder", 20, 20, 30)],
    ["sphere", part("sphere", 20, 20, 20)],
    ["cone", part("cone", 20, 20, 20)],
    ["pyramid", part("pyramid", 20, 20, 15)],
    ["wedge", part("wedge", 20, 20, 10)],
    ["torus", part("torus", 30, 30, 6, { radius: 3 })],
    ["polygon", part("polygon", 20, 20, 10, { sides: 6 })],
    ["tube", part("tube", 20, 20, 10, { bevel: 2 })],
    ["half sphere", part("halfSphere", 20, 20, 10)],
    ["round roof", part("roundRoof", 20, 20, 10)],
    ["moved and turned box", part("box", 20, 10, 5, { x: 30, z: -12, elevation: 4, rotation: 30 })],
  ];
  for (const [name, shape] of shapes) {
    it(`${name} keeps its shape`, () => {
      expect(signature(shape)).toMatchSnapshot();
    });
  }
});

describe.skipIf(!hasWasmKernel)("designs built on the browser engine", () => {
  let wasm: WasmKernelClient | null = null;
  const kernel = async () => (wasm ??= await startWasmKernel());

  beforeEach(async () => {
    const client = await kernel();
    vi.stubGlobal("window", { peakcadKernel: { request: (job: Record<string, unknown>) => client.request(job) } });
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => { wasm = null; });

  it("a block with a hole through it", async () => {
    const built = await group([
      part("box", 30, 20, 10),
      part("cylinder", 8, 8, 12, { hole: true, elevation: -1 }),
    ]);
    expect(signature(built)).toMatchSnapshot();
  }, 120_000);

  it("a plate with four mounting holes", async () => {
    const holes = [[-15, -10], [15, -10], [-15, 10], [15, 10]].map(([x, z]) => part("cylinder", 4, 4, 5, { x, z, hole: true, elevation: -1 }));
    const built = await group([part("box", 40, 30, 3), ...holes]);
    expect(signature(built)).toMatchSnapshot();
  }, 120_000);

  it("a box and a cylinder joined", async () => {
    const built = await group([part("box", 20, 20, 10), part("cylinder", 12, 12, 20, { x: 10 })]);
    expect(signature(built)).toMatchSnapshot();
  }, 120_000);

  it("a group inside a group", async () => {
    const inner = await group([part("box", 20, 20, 20), part("box", 10, 10, 22, { hole: true, elevation: -1 })]);
    const built = await group([inner, part("box", 40, 40, 2)]);
    expect(signature(built)).toMatchSnapshot();
  }, 120_000);

  it("a filleted, hollowed cup", async () => {
    const engine = kernelEngine(await kernel());
    const base = testBox(30, 30, 20);
    const prepared = await engine.prepare(base, 25);
    const edgeIds = cornerEdgeIds(prepared);
    expect(edgeIds).toHaveLength(4);
    const filleted = await engine.edgeTreatment(base, { kind: "fillet", edgeIds, amount: 3, chamferAngle: 45, filletProfile: "round", quality: "standard" });
    await engine.prepare(filleted, 12);
    const cup = await engine.hollow(filleted, { thickness: 2, openings: ["top"], corners: "sharp", cornerRadius: 0 });
    expect(signature({ ...filleted, ...cup })).toMatchSnapshot();
  }, 120_000);

  const fixtures = ["tinkercad-all-shapes", "tinkercad-basket-cage", "tinkercad-basket-8-quadrant", "tinkercad-working-plate"];
  for (const fixture of fixtures) {
    it(`the Tinkercad design ${fixture}`, async () => {
      const design = JSON.parse(readFileSync(path.join(__dirname, `../fixtures/${fixture}.json`), "utf8")) as TinkercadPayload;
      const { shapes } = tinkercadToShapes(design);
      const measured: Array<{ name: string } & Signature> = [];
      for (const shape of shapes) {
        const built = shape.groupedShapes?.length ? await remeshCsgGroup(shape) : shape;
        if (!built) throw new Error(`${shape.name} did not build`);
        measured.push({ name: shape.name, ...signature(built) });
      }
      expect(measured).toMatchSnapshot();
    }, 300_000);
  }
});
