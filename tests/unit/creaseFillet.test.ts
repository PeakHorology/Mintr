import { afterAll, describe, expect, it } from "vitest";
import { toNativeKernelSolid } from "@/lib/nativeKernelProtocol";
import type { WorkplaneShape } from "@/types/sketchforge";
import { hasNativeKernelExe, spawnNativeKernelClient, type NativeKernelClient } from "../helpers/nativeKernelChild";

const base: WorkplaneShape = { id: "a", name: "a", kind: "box", color: "#d41721", x: 0, z: 0, elevation: 0, size: 20, width: 20, depth: 20, height: 20, rotation: 0, locked: false, hidden: false };
const box = (shape: Partial<WorkplaneShape>) => toNativeKernelSolid({ ...base, id: "box", ...shape });
const cylinder = (shape: Partial<WorkplaneShape>) => toNativeKernelSolid({ ...base, id: "cyl", kind: "cylinder", ...shape });

function meshVolume(p: ArrayLike<number>, ix: ArrayLike<number>) {
  let v = 0;
  for (let i = 0; i + 2 < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return Math.abs(v / 6);
}

/** How many separate pieces a mesh has, and how many of its edges belong to only one triangle (a hole). */
function meshTopology(p: ArrayLike<number>, ix: ArrayLike<number>) {
  const byPosition = new Map<string, number>();
  const corner = new Array<number>(p.length / 3);
  for (let i = 0; i < p.length / 3; i++) {
    const key = `${Math.round(p[i * 3] * 1e4)},${Math.round(p[i * 3 + 1] * 1e4)},${Math.round(p[i * 3 + 2] * 1e4)}`;
    if (!byPosition.has(key)) byPosition.set(key, i);
    corner[i] = byPosition.get(key)!;
  }
  const parent = corner.map((_, i) => i);
  const find = (a: number) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const edgeUse = new Map<string, number>();
  for (let i = 0; i + 2 < ix.length; i += 3) {
    const t = [corner[ix[i]], corner[ix[i + 1]], corner[ix[i + 2]]];
    parent[find(t[0])] = find(t[1]);
    parent[find(t[1])] = find(t[2]);
    for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    }
  }
  const pieces = new Set([...byPosition.values()].map(find)).size;
  let open = 0;
  for (const n of edgeUse.values()) if (n === 1) open++;
  return { pieces, open };
}

type EdgeInfo = { id: number; angle: number; line: boolean; xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number };

function edgeInfo(edge: { id: number; angle?: number; points: number[] }): EdgeInfo {
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  for (let i = 0; i < edge.points.length; i += 3) { xs.push(edge.points[i]); ys.push(edge.points[i + 1]); zs.push(edge.points[i + 2]); }
  return { id: edge.id, angle: edge.angle ?? 90, line: edge.points.length === 6, xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys), zmin: Math.min(...zs), zmax: Math.max(...zs) };
}
const near = (a: number, b: number, tolerance = 0.05) => Math.abs(a - b) < tolerance;
const flatAt = (edge: EdgeInfo, y: number) => near(edge.ymin, y) && near(edge.ymax, y);

type Prepared = { before: number; edges: EdgeInfo[]; all: number[] };

async function prepare(client: NativeKernelClient, id: () => number, job: Record<string, unknown>): Promise<Prepared> {
  const made = await client.request({ id: id(), ...job }, 60000);
  expect(made.ok).toBe(true);
  const requestId = id();
  const prepared = await client.request({ id: requestId, requestId, type: "prepare", sharpAngle: 12, parts: [{ hole: false, brepStep: made.brepStep }] }, 60000);
  const all = prepared.selectableEdgeIds as number[];
  const edges = (prepared.edges as Array<{ id: number; angle?: number; points: number[] }>).filter((edge) => all.includes(edge.id)).map(edgeInfo);
  return { before: meshVolume(made.positions as number[], made.indices as number[]), edges, all };
}

type Outcome = { volume: number; pieces: number; open: number; skipped: number[] };

async function treat(client: NativeKernelClient, id: () => number, kind: string, edgeIds: number[], amount = 2): Promise<Outcome> {
  expect(edgeIds.length).toBeGreaterThan(0);
  const requestId = id();
  const reply = await client.request({ id: requestId, requestId, type: "preview", kind, edgeIds, amount, chamferAngle: 45, filletProfile: "round" }, 120000);
  expect(reply.ok, String(reply.message)).toBe(true);
  const topology = meshTopology(reply.positions as number[], reply.indices as number[]);
  return { volume: meshVolume(reply.positions as number[], reply.indices as number[]), ...topology, skipped: (reply.skippedEdgeIds as number[] | undefined) ?? [] };
}

/** One closed body, every edge treated. */
function expectSound(outcome: Outcome) {
  expect(outcome.pieces).toBe(1);
  expect(outcome.open).toBe(0);
  expect(outcome.skipped).toEqual([]);
}

describe.skipIf(!hasNativeKernelExe)("fillet and chamfer where a round part meets a flat one", { timeout: 180000 }, () => {
  const client = spawnNativeKernelClient();
  afterAll(() => client.close());
  let counter = 1;
  const id = () => counter++;
  const dispose = () => client.request({ id: id(), requestId: counter, type: "dispose" });

  // A box with a wider cylinder joined to one side, as a Tinkercad user builds a part. The
  // box's side faces run into the cylinder at a shallow crease that ends on the top and
  // bottom faces, where the box's top edges and the cylinder's rim meet it.
  async function boxAndCylinder() {
    const prepared = await prepare(client, id, { type: "boolean", op: "union", solids: [box({ x: -10 }), cylinder({ x: 4, width: 24, depth: 24 })] });
    const E = prepared.edges;
    const crease = E.filter((edge) => edge.angle > 1 && edge.angle < 89).map((edge) => edge.id);
    const rails = E.filter((edge) => edge.line && near(Math.abs(edge.zmin), 10) && near(edge.zmax - edge.zmin, 0) && near(edge.ymax - edge.ymin, 0) && edge.xmin < -15).map((edge) => edge.id);
    const topRails = rails.filter((edgeId) => flatAt(E.find((edge) => edge.id === edgeId)!, 20));
    const topArcs = E.filter((edge) => !edge.line && flatAt(edge, 20)).map((edge) => edge.id);
    expect(crease).toHaveLength(2);
    expect(rails).toHaveLength(4);
    expect(topRails).toHaveLength(2);
    expect(topArcs).toHaveLength(2);
    return { ...prepared, crease, rails, topRails, topArcs };
  }

  it.each([["fillet"], ["chamfer"]])("%s fills the crease", async (kind) => {
    const part = await boxAndCylinder();
    const outcome = await treat(client, id, kind, part.crease);
    expectSound(outcome);
    expect(outcome.volume).toBeGreaterThan(part.before);
    await dispose();
  });

  it.each([["fillet"], ["chamfer"]])("%s on every edge of the box and cylinder", async (kind) => {
    const part = await boxAndCylinder();
    const outcome = await treat(client, id, kind, part.all);
    expectSound(outcome);
    expect(outcome.volume).toBeLessThan(part.before);
    await dispose();
  });

  it.each([["fillet"], ["chamfer"]])("%s on the crease and the box edges running into the cylinder", async (kind) => {
    const part = await boxAndCylinder();
    const alone = await treat(client, id, kind, part.rails);
    expectSound(alone);
    const outcome = await treat(client, id, kind, [...part.crease, ...part.rails]);
    expectSound(outcome);
    // The box edges are rounded off and the crease filled; the round then runs over the
    // fill's ends, so a little more than the box edges alone comes off.
    expect(outcome.volume).toBeLessThan(part.before);
    expect(outcome.volume).toBeGreaterThan(alone.volume - 30);
    await dispose();
  });

  it.each([["fillet"], ["chamfer"]])("%s around the crease ends, where the box's top edges and the rim meet it", async (kind) => {
    const part = await boxAndCylinder();
    const outcome = await treat(client, id, kind, [...part.crease, ...part.topRails, ...part.topArcs]);
    expect(outcome.pieces).toBe(1);
    expect(outcome.open).toBe(0);
    expect(outcome.volume).toBeLessThan(part.before);
    await dispose();
  });

  it.each([["fillet"], ["chamfer"]])("%s on the box edges and the rim at one crease end", async (kind) => {
    const part = await boxAndCylinder();
    const outcome = await treat(client, id, kind, [...part.topRails, ...part.topArcs]);
    expect(outcome.pieces).toBe(1);
    expect(outcome.open).toBe(0);
    expect(outcome.volume).toBeLessThan(part.before);
    await dispose();
  });

  // The top outline: the box's three straight top edges and the cylinder's arc, meeting at
  // the inside corners where round meets square. OCCT's chamfer refuses those corners.
  it.each([["fillet"], ["chamfer"]])("%s all round the top outline, round meeting square", async (kind) => {
    const part = await boxAndCylinder();
    const outline = part.edges.filter((edge) => flatAt(edge, 20)).map((edge) => edge.id);
    expect(outline).toHaveLength(5);
    const outcome = await treat(client, id, kind, outline);
    expectSound(outcome);
    // A 2 mm round takes 0.86 mm² off the 95 mm outline; a chamfer takes 2 mm².
    expect(part.before - outcome.volume).toBeGreaterThan(kind === "fillet" ? 60 : 150);
    expect(part.before - outcome.volume).toBeLessThan(kind === "fillet" ? 100 : 220);
    await dispose();
  });

  // The user's own sequence: chamfer the box's edges, apply, then fillet the crease, which
  // the chamfers have split into six pieces. OCCT spins for ever on a tiny trial radius here;
  // the engine must answer within its budget either way.
  it("answers within its time budget on a crease split by applied chamfers", async () => {
    const part = await boxAndCylinder();
    const boxEdges = part.edges.filter((edge) => edge.line && !part.crease.includes(edge.id)).map((edge) => edge.id);
    const chamfered = await treat(client, id, "chamfer", boxEdges);
    expectSound(chamfered);
    const brep = (await client.request({ id: id(), requestId: counter, type: "finalize" }, 60000)).brep as string;
    await dispose();
    const requestId = id();
    const prepared = await client.request({ id: requestId, requestId, type: "prepare", sharpAngle: 12, parts: [{ hole: false, brep }] }, 60000);
    const all = prepared.selectableEdgeIds as number[];
    const pieces = (prepared.edges as Array<{ id: number; angle?: number; points: number[] }>).map(edgeInfo)
      .filter((edge) => all.includes(edge.id) && edge.angle > 31 && edge.angle < 34.5 && !near(edge.ymax - edge.ymin, 0))
      .map((edge) => edge.id);
    expect(pieces).toHaveLength(6);
    const started = Date.now();
    const previewId = id();
    const reply = await client.request({ id: previewId, requestId: previewId, type: "preview", kind: "fillet", edgeIds: pieces, amount: 2, chamferAngle: 45, filletProfile: "round" }, 60000);
    expect(Date.now() - started).toBeLessThan(12000);
    if (reply.ok) {
      const topology = meshTopology(reply.positions as number[], reply.indices as number[]);
      expect(topology.pieces).toBe(1);
      expect(topology.open).toBe(0);
    } else {
      expect(String(reply.message)).toMatch(/too big|too long|invalid/);
    }
    await dispose();
  });

  // The layout the user builds in the app: the cylinder's centre 1 mm across and 6 mm back
  // from the box's, so it bulges out of two box faces and swallows a corner. "All sharp
  // edges" is 15 edges: box edges, the creases, and the rims meeting them at inside corners.
  async function appLayout() {
    const prepared = await prepare(client, id, { type: "boolean", op: "union", solids: [box({ x: 0, z: 0 }), cylinder({ x: 1, z: -6, width: 20, depth: 20 })] });
    expect(prepared.all).toHaveLength(15);
    return prepared;
  }

  // As the app sends it: the group's STEP placed where the design keeps it, with the tiny
  // stretch its rounded width and depth leave against the STEP's exact box. Faces must stay
  // flat and round through that placement, or nothing can be built on them.
  it.each([["fillet"], ["chamfer"]])("%s 1 mm on all sharp edges of the app's box and cylinder, placed as the app places it", async (kind) => {
    const made = await client.request({ id: id(), type: "boolean", op: "union", solids: [box({ x: 0, z: 0 }), cylinder({ x: 1, z: -6, width: 20, depth: 20 })] }, 60000);
    expect(made.ok).toBe(true);
    const requestId = id();
    const brepTransform = [0.9999789634427438, 0, 0, -21.50027912202058, 0, 1, 0, 0, 0, 0, 1.0000162365248366, 2.0002110713958112];
    const prepared = await client.request({ id: requestId, requestId, type: "prepare", sharpAngle: 12, parts: [{ hole: false, brepStep: made.brepStep, brepTransform }] }, 60000);
    const all = prepared.selectableEdgeIds as number[];
    expect(all).toHaveLength(15);
    const before = meshVolume(made.positions as number[], made.indices as number[]);
    const outcome = await treat(client, id, kind, all, 1);
    expectSound(outcome);
    expect(outcome.volume).toBeLessThan(before);
    await dispose();
  });

  it.each([["fillet", 1], ["chamfer", 1], ["fillet", 2], ["chamfer", 2], ["fillet", 0.5], ["chamfer", 3]])("%s %d mm on all sharp edges of the app's box and cylinder", async (kind, amount) => {
    const part = await appLayout();
    const outcome = await treat(client, id, kind, part.all, amount);
    expectSound(outcome);
    expect(outcome.volume).toBeLessThan(part.before);
    await dispose();
  });

  it.each([["fillet", 1], ["chamfer", 1], ["fillet", 3], ["chamfer", 3]])("%s %d mm on all sharp edges of the wider cylinder on a box", async (kind, amount) => {
    const part = await boxAndCylinder();
    const outcome = await treat(client, id, kind, part.all, amount);
    expectSound(outcome);
    expect(outcome.volume).toBeLessThan(part.before);
    await dispose();
  });

  // A block with a square pocket: eight inside edges meeting at four inside corners.
  it.each([["fillet", 1], ["chamfer", 1], ["fillet", 2]])("%s %d mm on all sharp edges of a block with a square pocket", async (kind, amount) => {
    const prepared = await prepare(client, id, { type: "boolean", op: "subtract", solids: [box({ width: 20, depth: 20, height: 20 }), toNativeKernelSolid({ ...base, id: "pocket", hole: true, width: 8, depth: 8, height: 10, elevation: 12 } as WorkplaneShape)] });
    expect(prepared.all).toHaveLength(24);
    const outcome = await treat(client, id, kind, prepared.all, amount);
    expectSound(outcome);
    expect(outcome.volume).toBeLessThan(prepared.before);
    await dispose();
  });

  // A cylinder standing on a box: its base is a square inside corner all the way round.
  async function cylinderOnBox() {
    const prepared = await prepare(client, id, { type: "boolean", op: "union", solids: [box({ width: 40, depth: 40, height: 10 }), cylinder({ width: 20, depth: 20, height: 20, elevation: 10 })] });
    const E = prepared.edges;
    const boxTop = E.filter((edge) => edge.line && flatAt(edge, 10)).map((edge) => edge.id);
    const baseCircle = E.filter((edge) => !edge.line && flatAt(edge, 10)).map((edge) => edge.id);
    const topCircle = E.filter((edge) => !edge.line && flatAt(edge, 30)).map((edge) => edge.id);
    expect(boxTop).toHaveLength(4);
    expect(baseCircle).toHaveLength(1);
    expect(topCircle).toHaveLength(1);
    return { ...prepared, boxTop, baseCircle, topCircle };
  }

  it.each([["fillet"], ["chamfer"]])("%s fills the base of a cylinder standing on a box", async (kind) => {
    const part = await cylinderOnBox();
    const outcome = await treat(client, id, kind, part.baseCircle);
    expectSound(outcome);
    // A 2 mm round fills 2² × (1 − π/4) ≈ 0.86 mm² around the 63 mm rim; a chamfer fills 2 mm².
    expect(outcome.volume - part.before).toBeGreaterThan(kind === "fillet" ? 45 : 110);
    expect(outcome.volume - part.before).toBeLessThan(kind === "fillet" ? 70 : 160);
    await dispose();
  });

  it.each([["fillet"], ["chamfer"]])("%s on the box's top face edges and the cylinder's base", async (kind) => {
    const part = await cylinderOnBox();
    const outcome = await treat(client, id, kind, [...part.boxTop, ...part.baseCircle]);
    expectSound(outcome);
    expect(outcome.volume).toBeLessThan(part.before);
    await dispose();
  });

  it.each([["fillet"], ["chamfer"]])("%s on the cylinder's top rim alone", async (kind) => {
    const part = await cylinderOnBox();
    const outcome = await treat(client, id, kind, part.topCircle);
    expectSound(outcome);
    expect(outcome.volume).toBeLessThan(part.before);
    await dispose();
  });

  it.each([["fillet"], ["chamfer"]])("%s on the cylinder's top rim and base", async (kind) => {
    const part = await cylinderOnBox();
    const outcome = await treat(client, id, kind, [...part.topCircle, ...part.baseCircle]);
    expectSound(outcome);
    await dispose();
  });

  it.each([["fillet"], ["chamfer"]])("%s on every edge of a cylinder standing on a box", async (kind) => {
    const part = await cylinderOnBox();
    const outcome = await treat(client, id, kind, part.all);
    expectSound(outcome);
    expect(outcome.volume).toBeLessThan(part.before);
    await dispose();
  });

  // A plate with a boss sunk into it, off centre.
  async function bossOnPlate() {
    const prepared = await prepare(client, id, { type: "boolean", op: "union", solids: [box({ width: 40, depth: 40, height: 6 }), cylinder({ x: 5, width: 16, depth: 16, height: 10, elevation: 3 })] });
    const E = prepared.edges;
    const plateTop = E.filter((edge) => edge.line && flatAt(edge, 6)).map((edge) => edge.id);
    const baseCircle = E.filter((edge) => !edge.line && flatAt(edge, 6)).map((edge) => edge.id);
    const topCircle = E.filter((edge) => !edge.line && flatAt(edge, 13)).map((edge) => edge.id);
    expect(plateTop).toHaveLength(4);
    expect(baseCircle).toHaveLength(1);
    expect(topCircle).toHaveLength(1);
    return { ...prepared, plateTop, baseCircle, topCircle };
  }

  it.each([["fillet"], ["chamfer"]])("%s fills the base of a boss on a plate", async (kind) => {
    const part = await bossOnPlate();
    const outcome = await treat(client, id, kind, part.baseCircle);
    expectSound(outcome);
    expect(outcome.volume).toBeGreaterThan(part.before);
    await dispose();
  });

  it.each([["fillet"], ["chamfer"]])("%s on both rims of a boss on a plate", async (kind) => {
    const part = await bossOnPlate();
    const outcome = await treat(client, id, kind, [...part.topCircle, ...part.baseCircle]);
    expectSound(outcome);
    await dispose();
  });

  it.each([["fillet"], ["chamfer"]])("%s on the plate's top edges and the boss's base", async (kind) => {
    const part = await bossOnPlate();
    const outcome = await treat(client, id, kind, [...part.plateTop, ...part.baseCircle]);
    expectSound(outcome);
    expect(outcome.volume).toBeLessThan(part.before);
    await dispose();
  });

  // A rounded rectangle extruded: straight edges and round ones share corners all the way round.
  async function roundedRectangle() {
    const r = 5, w = 20, d = 12, s = Math.SQRT1_2 * r;
    const loop = { kind: "wire", start: [-w + r, -d], steps: [
      { kind: "line", to: [w - r, -d] }, { kind: "arc", mid: [w - r + s, -d + r - s], to: [w, -d + r] },
      { kind: "line", to: [w, d - r] }, { kind: "arc", mid: [w - r + s, d - r + s], to: [w - r, d] },
      { kind: "line", to: [-w + r, d] }, { kind: "arc", mid: [-w + r - s, d - r + s], to: [-w, d - r] },
      { kind: "line", to: [-w, -d + r] }, { kind: "arc", mid: [-w + r - s, -d + r - s], to: [-w + r, -d] },
    ] };
    const plane = { origin: [0, 0, 0], normal: [0, 1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, 1] };
    const prepared = await prepare(client, id, { type: "sketchExtrude", distance: 10, plane, loops: [loop] });
    const top = Math.max(...prepared.edges.map((edge) => edge.ymax));
    const outline = prepared.edges.filter((edge) => flatAt(edge, top)).map((edge) => edge.id);
    expect(outline).toHaveLength(8);
    return { ...prepared, outline };
  }

  it.each([["fillet"], ["chamfer"]])("%s on every edge of a rounded rectangle", async (kind) => {
    const part = await roundedRectangle();
    const outcome = await treat(client, id, kind, part.all);
    expectSound(outcome);
    expect(outcome.volume).toBeLessThan(part.before);
    await dispose();
  });

  it.each([["fillet"], ["chamfer"]])("%s on the top outline of a rounded rectangle", async (kind) => {
    const part = await roundedRectangle();
    const outcome = await treat(client, id, kind, part.outline);
    expectSound(outcome);
    expect(outcome.volume).toBeLessThan(part.before);
    await dispose();
  });

  it("rounds the corners of a square hole the usual way, leaving it open", async () => {
    const plate = await client.request({
      id: id(), type: "boolean", op: "subtract",
      solids: [
        toNativeKernelSolid({ ...base, id: "plate", width: 40, depth: 40, height: 10 }),
        toNativeKernelSolid({ ...base, id: "hole", hole: true, width: 12, depth: 12, height: 14, elevation: -2 } as WorkplaneShape),
      ],
    }, 60000);
    const requestId = id();
    const prepared = await client.request({ id: requestId, requestId, type: "prepare", sharpAngle: 12, parts: [{ hole: false, brepStep: plate.brepStep }] }, 60000);
    const points = new Map((prepared.edges as Array<{ id: number; points: number[] }>).map((edge) => [edge.id, edge.points]));
    // The hole's four upright corners: short edges inside the plate's outline.
    const corners = (prepared.selectableEdgeIds as number[]).filter((edgeId) => {
      const p = points.get(edgeId) ?? [];
      const xs = p.filter((_, i) => i % 3 === 0), ys = p.filter((_, i) => i % 3 === 1);
      return Math.max(...xs.map(Math.abs)) < 7 && Math.max(...ys) - Math.min(...ys) > 5;
    });
    expect(corners).toHaveLength(4);
    const before = meshVolume(plate.positions as number[], plate.indices as number[]);
    const outcome = await treat(client, id, "fillet", corners);
    expectSound(outcome);
    // Four corner fills of 2² × (1 − π/4) × 10 ≈ 34 mm³; the hole stays open.
    expect(outcome.volume - before).toBeGreaterThan(20);
    expect(outcome.volume - before).toBeLessThan(50);
    await dispose();
  });
});
