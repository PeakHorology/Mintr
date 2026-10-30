import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { inferCsgOp } from "@/lib/csgTree";
import { groupPointToWorld, positionsBoundaryEdges, remeshCsgGroup, restoreGroupedChildren, smoothMeshShape, smoothNetForShapes, smoothSpecToWorld } from "@/lib/editorBoolean";
import { toNativeKernelSolids } from "@/lib/nativeKernelProtocol";
import { limitPositions, netEdges } from "@/lib/smoothSubdivision";
import type { WorkplaneShape } from "@/types/sketchforge";

// The app loads Manifold from public/; here it comes from the package, so the joins and cuts run as they do in the app.
vi.mock("@/lib/manifoldRuntime", () => {
  let runtime: Promise<unknown> | null = null;
  return {
    getManifoldRuntime: () => {
      runtime ??= (async () => {
        const require = createRequire(import.meta.url);
        const module = await import("manifold-3d");
        const loaded = await (module.default as unknown as (config: { wasmBinary: Uint8Array }) => Promise<{ setup: () => void }>)({
          wasmBinary: readFileSync(require.resolve("manifold-3d/manifold.wasm")),
        });
        loaded.setup();
        return loaded;
      })();
      return runtime;
    },
    clearManifoldRuntimeCache: () => undefined,
    resetManifoldRuntimeForTests: () => undefined,
  };
});

function box(id: string, x: number, size = 10, extra: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return { id, name: id, kind: "box", color: "#d41721", x, z: 0, elevation: 0, size, width: size, depth: size, height: size, rotation: 0, locked: false, hidden: false, ...extra };
}

function volume(p: ArrayLike<number>) {
  let sum = 0;
  for (let i = 0; i < p.length; i += 9) {
    sum += p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7])
      - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6])
      + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
  }
  return sum / 6;
}

const pair = () => [box("a", -4), box("b", 4)];

describe("smooth", () => {
  it("rounds two overlapping boxes into one closed soft body", async () => {
    const body = (await smoothMeshShape(pair(), { level: 2 }))!;
    expect(body).not.toBeNull();
    expect(inferCsgOp(body)).toBe("smooth");
    expect(body.name).toBe("Smooth");
    const p = body.importedMesh!.positions;
    expect(positionsBoundaryEdges(p)).toHaveLength(0);
    // The union is 18 x 10 x 10.
    expect(volume(p)).toBeGreaterThan(0.4 * 1800);
    expect(volume(p)).toBeLessThan(1800);
    expect(body.width).toBeLessThan(18);
    expect(body.groupedShapes?.map((child) => child.name)).toEqual(["a", "b"]);
    // The bottom stays flat on the bed by default.
    expect(body.elevation).toBeCloseTo(0, 6);
    let onBed = 0;
    for (let i = 1; i < p.length; i += 3) if (Math.abs(p[i]) < 1e-6) onBed += 1;
    expect(onBed).toBeGreaterThan(20);
  });

  it("makes four times the triangles a level up", async () => {
    const one = (await smoothMeshShape(pair(), { level: 1 }))!;
    const two = (await smoothMeshShape(pair(), { level: 2 }))!;
    expect(two.importedMesh!.positions.length).toBe(one.importedMesh!.positions.length * 4);
  });

  it("cuts holes after smoothing so they stay their size", async () => {
    const plain = (await smoothMeshShape(pair(), { level: 2 }))!;
    const hole = box("hole", 0, 3, { hole: true, height: 30, elevation: -5 });
    const cut = (await smoothMeshShape([...pair(), hole], { level: 2 }))!;
    expect(inferCsgOp(cut)).toBe("smooth");
    const removed = volume(plain.importedMesh!.positions) - volume(cut.importedMesh!.positions);
    // A 3 mm square hole right through a body about 10 mm tall at its middle.
    expect(removed).toBeGreaterThan(9 * 8);
    expect(removed).toBeLessThan(9 * 10.5);
    expect(cut.groupedShapes).toHaveLength(3);
  });

  it("rebuilds as a smooth body after a part moves, and stays off the exact engines", async () => {
    const body = (await smoothMeshShape(pair(), { level: 2 }))!;
    const moved = { ...body, groupedShapes: body.groupedShapes!.map((child) => (child.name === "b" ? { ...child, x: child.x + 6 } : child)) };
    const remeshed = (await remeshCsgGroup(moved))!;
    expect(inferCsgOp(remeshed)).toBe("smooth");
    expect(remeshed.width).toBeGreaterThan(body.width + 4);
    expect(remeshed.smooth?.level).toBe(2);
    expect(toNativeKernelSolids([remeshed])).toBeNull();
  });

  it("keeps a pulled point where it was put, through a rebuild and a move of the far part", async () => {
    const parts = [box("a", -10), box("b", 10)];
    const net = (await smoothNetForShapes(parts, { level: 2 }))!;
    // The net point furthest out on -x: the far corner region of box a.
    let best = 0;
    for (let v = 0; v < net.smooth.keys.length / 3; v += 1) if (net.smooth.keys[v * 3] < net.smooth.keys[best * 3]) best = v;
    const at: [number, number, number] = [net.smooth.keys[best * 3], net.smooth.keys[best * 3 + 1], net.smooth.keys[best * 3 + 2]];
    const to: [number, number, number] = [at[0] - 5, at[1] + 2, at[2]];
    const body = (await smoothMeshShape(parts, { level: 2, tugs: [{ detail: 0, at, to }] }))!;
    expect(body.smooth?.tugs).toHaveLength(1);
    expect(body.x - body.width / 2).toBeLessThan(at[0] - 2);

    // Move box b; box a's corner is untouched, so the pull stays.
    const moved = { ...body, groupedShapes: body.groupedShapes!.map((child) => (child.name === "b" ? { ...child, x: child.x + 3 } : child)) };
    const remeshed = (await remeshCsgGroup(moved))!;
    expect(remeshed.smooth?.tugs).toHaveLength(1);
    const world = smoothSpecToWorld(remeshed).tugs![0];
    for (let k = 0; k < 3; k += 1) expect(world.to[k]).toBeCloseTo(to[k], 3);
    const again = (await smoothNetForShapes(restoreGroupedChildren(remeshed, { preserveIds: true }), smoothSpecToWorld(remeshed)))!;
    const limit = limitPositions(again.smooth.net, again.smooth.tags);
    let closest = Infinity;
    for (let v = 0; v < limit.length / 3; v += 1) {
      closest = Math.min(closest, Math.hypot(limit[v * 3] - to[0], limit[v * 3 + 1] - to[1], limit[v * 3 + 2] - to[2]));
    }
    expect(closest).toBeLessThan(1e-4);
  });

  it("drops a pull whose point is gone and says so", async () => {
    const notices: string[] = [];
    const body = (await smoothMeshShape(pair(), { level: 1, tugs: [{ detail: 0, at: [99, 99, 99], to: [0, 0, 0] }] }, { onNotice: (m) => notices.push(m) }))!;
    expect(body.smooth?.tugs).toHaveLength(0);
    expect(notices.join(" ")).toMatch(/1 pulled point no longer fits/);
  });

  it("maps its frame back to world space", async () => {
    const body = (await smoothMeshShape(pair(), { level: 1 }))!;
    const [x, y, z] = groupPointToWorld(body, [0, 0, 0]);
    expect(x).toBeCloseTo(body.x);
    expect(y).toBeCloseTo(body.elevation ?? 0);
    expect(z).toBeCloseTo(body.z);
  });

  it("starts with a soft radius a quarter of the part's size", async () => {
    const body = (await smoothMeshShape(pair(), { level: 1 }))!;
    // The joined boxes are 18 long; the net is a little smaller.
    expect(body.smooth?.softRadius).toBeGreaterThan(3);
    expect(body.smooth?.softRadius).toBeLessThan(5);
    expect((body.smooth!.softRadius! * 2) % 1).toBe(0);
  });

  it("keeps sharp edges and finer pulls through a move of the body", async () => {
    const net = (await smoothNetForShapes(pair(), { level: 1, detail: 1 }))!;
    const k = net.smooth.keys;
    const [i, j] = netEdges(net.smooth.net);
    const crease = { detail: 1, a: [k[i * 3], k[i * 3 + 1], k[i * 3 + 2]] as [number, number, number], b: [k[j * 3], k[j * 3 + 1], k[j * 3 + 2]] as [number, number, number] };
    const body = (await smoothMeshShape(pair(), { level: 1, detail: 1, creases: [crease] }))!;
    const moved = { ...body, x: body.x + 20, groupedShapes: body.groupedShapes };
    expect(body.smooth?.creases).toHaveLength(1);
    const world = smoothSpecToWorld(moved);
    expect(world.creases![0].a[0]).toBeCloseTo(smoothSpecToWorld(body).creases![0].a[0] + 20, 6);
  });

  it("starts on the exact shape when its edges are kept", async () => {
    const exact = (await smoothMeshShape([box("a", 0, 20)], { level: 3, keepEdges: true }))!;
    // A 20 mm cube stays a 20 mm cube until a point is pulled.
    expect(volume(exact.importedMesh!.positions)).toBeCloseTo(8000, 0);
    expect(exact.width).toBeCloseTo(20, 3);
    const round = (await smoothMeshShape([box("a", 0, 20)], { level: 3 }))!;
    expect(volume(round.importedMesh!.positions)).toBeLessThan(0.9 * 8000);
    // Smoothing one of its edges rounds that edge off, and only a little of the cube goes.
    const spec = smoothSpecToWorld(exact);
    const built = (await smoothNetForShapes(restoreGroupedChildren(exact, { preserveIds: true }), spec))!;
    const { keys, net, tags } = built.smooth;
    const edges = netEdges(net);
    const nv = keys.length / 3;
    const top = (v: number) => keys[v * 3 + 1] > 19.99;
    let pick = -1;
    for (let i = 0; i < edges.length; i += 2) {
      const [a, b] = [edges[i], edges[i + 1]];
      if (top(a) && top(b) && tags.crease.has(a < b ? a * nv + b : b * nv + a)) { pick = i; break; }
    }
    expect(pick).toBeGreaterThanOrEqual(0);
    const at = (v: number) => [keys[v * 3], keys[v * 3 + 1], keys[v * 3 + 2]] as [number, number, number];
    const softened = (await smoothMeshShape([box("a", 0, 20)], { level: 3, keepEdges: true, creases: [{ detail: 0, a: at(edges[pick]), b: at(edges[pick + 1]), smooth: true }] }))!;
    const v = volume(softened.importedMesh!.positions);
    expect(v).toBeLessThan(8000 - 1);
    expect(v).toBeGreaterThan(0.95 * 8000);
  });

  it("gives back the original boxes on Ungroup", async () => {
    const body = (await smoothMeshShape(pair(), { level: 2 }))!;
    const restored = restoreGroupedChildren(body);
    expect(restored.map((shape) => shape.x).sort((a, b) => a - b)).toEqual([-4, 4].map((x) => expect.closeTo(x, 3)));
    for (const shape of restored) {
      expect(shape.width).toBeCloseTo(10, 3);
      expect(shape.elevation ?? 0).toBeCloseTo(0, 3);
    }
  });
});
