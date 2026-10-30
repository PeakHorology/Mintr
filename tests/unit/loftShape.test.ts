import { afterAll, describe, expect, it } from "vitest";
import {
  applyLoftKernelMesh,
  createLoftShape,
  createSketchLoft,
  currentLoftSpan,
  loftBuildPending,
  loftPreviewMesh,
  loftSectionsMm,
  loftShapeKey,
  sampleLoop,
  serializeLoftJob,
  withLoftSettings,
  withLoftStarter,
} from "@/lib/loftShape";
import { toNativeKernelSolid } from "@/lib/nativeKernelProtocol";
import type { WorkplaneShape } from "@/types/sketchforge";
import { hasNativeKernelExe, spawnNativeKernelClient } from "../helpers/nativeKernelChild";
import { hasWasmKernel, startWasmKernel } from "../helpers/wasmKernel";

function volume(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  let sum = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    sum += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return sum / 6;
}

/** Every edge is used once each way round: a closed skin with its faces turned out the same way. */
function isClosed(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  const key = (index: number) => `${positions[index * 3].toFixed(4)},${positions[index * 3 + 1].toFixed(4)},${positions[index * 3 + 2].toFixed(4)}`;
  const edges = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      const from = key(indices[i + k]);
      const to = key(indices[i + ((k + 1) % 3)]);
      if (from === to) continue;
      edges.set(`${from}>${to}`, (edges.get(`${from}>${to}`) ?? 0) + 1);
    }
  }
  for (const [edge, count] of edges) {
    const [from, to] = edge.split(">");
    if (count !== 1 || edges.get(`${to}>${from}`) !== 1) return false;
  }
  return true;
}

function sectionWidthMm(shape: WorkplaneShape, index: number) {
  const section = loftSectionsMm(shape.loftSpec!, currentLoftSpan(shape))[index];
  const xs = sampleLoop(section.loop).map(([x]) => x);
  return Math.max(...xs) - Math.min(...xs);
}

function box(id: string, size: number, elevation: number, x = 0): WorkplaneShape {
  return { id, name: id, kind: "box", color: "#d41721", x, z: 0, elevation, size, width: size, depth: size, height: 2, rotation: 0, locked: false, hidden: false };
}

function cylinder(id: string, size: number, elevation: number): WorkplaneShape {
  return { ...box(id, size, elevation), kind: "cylinder" };
}

describe("loft shape", () => {
  it("drops a square-to-circle loft whose preview is one closed skin", () => {
    const shape = createLoftShape({ x: 5, z: -3 });
    const mesh = shape.importedMesh!;
    expect(shape.kind).toBe("loft");
    expect(shape.x).toBeCloseTo(5);
    expect(sectionWidthMm(shape, 0)).toBeCloseTo(20, 3);
    expect(isClosed(mesh.positions, mesh.indices!)).toBe(true);
    // Between the 20 mm square's 10000 and the cylinder's 25 * pi * 36 / 4.
    expect(volume(mesh.positions, mesh.indices!)).toBeGreaterThan(5000);
    expect(volume(mesh.positions, mesh.indices!)).toBeLessThan(10000);
  });

  it("makes a hollow preview that is still closed, open at both ends", () => {
    const solid = createLoftShape();
    const hollow = withLoftSettings(solid, { wall: 1.2 });
    const mesh = hollow.importedMesh!;
    expect(isClosed(mesh.positions, mesh.indices!)).toBe(true);
    const shell = volume(mesh.positions, mesh.indices!);
    expect(shell).toBeGreaterThan(0);
    expect(shell).toBeLessThan(volume(solid.importedMesh!.positions, solid.importedMesh!.indices!) * 0.4);
  });

  it("keeps the bottom outline's size when the top changes", () => {
    const shape = createLoftShape();
    const wider = withLoftStarter(shape, { topScale: 150 });
    expect(sectionWidthMm(wider, 0)).toBeCloseTo(20, 2);
    expect(wider.width).toBeGreaterThan(29);
    const twisted = withLoftStarter(withLoftStarter(shape, { top: "square" }), { twist: 90 });
    expect(twisted.loftSpec!.sections.length).toBeGreaterThan(2);
    expect(twisted.loftSpec!.smooth).toBe(true);
    expect(sectionWidthMm(twisted, 0)).toBeCloseTo(20, 2);
    expect(isClosed(twisted.importedMesh!.positions, twisted.importedMesh!.indices!)).toBe(true);
  });

  it("rekeys only when the body would change", () => {
    const shape = createLoftShape();
    const key = loftShapeKey(shape);
    expect(loftShapeKey({ ...shape, x: 40, rotation: 30 })).toBe(key);
    expect(loftShapeKey({ ...shape, width: (shape.width ?? 0) + 5 })).not.toBe(key);
    expect(loftShapeKey(withLoftSettings(shape, { wall: 1 }))).not.toBe(key);
    expect(loftBuildPending(shape)).toBe(true);
    // A stretched loft goes to the kernel as its outlines at the new size.
    const stretched = { ...shape, width: (shape.width ?? 0) * 2 };
    const solid = toNativeKernelSolid(stretched);
    expect(solid?.kind).toBe("loft");
    expect(sectionWidthMm(stretched, 0)).toBeCloseTo(40, 2);
  });

  it("lofts stacked boxes and cylinders from bottom to top", () => {
    const result = createSketchLoft([cylinder("top", 10, 30), box("bottom", 20, 0, 4)]);
    expect("shape" in result).toBe(true);
    if (!("shape" in result)) return;
    const loft = result.shape;
    expect(loft.elevation).toBeCloseTo(0);
    expect(loft.height).toBeCloseTo(30, 1);
    expect(loft.loftSpec!.sources!.map((shape) => shape.id)).toEqual(["bottom", "top"]);
    expect(sectionWidthMm(loft, 0)).toBeCloseTo(20, 2);
    expect(sectionWidthMm(loft, 1)).toBeCloseTo(10, 2);
    expect(isClosed(loft.importedMesh!.positions, loft.importedMesh!.indices!)).toBe(true);
  });

  it("refuses outlines at the same height and single outlines", () => {
    expect(createSketchLoft([box("a", 20, 0), box("b", 10, 0)])).toHaveProperty("error");
    expect(createSketchLoft([box("a", 20, 0)])).toHaveProperty("error");
    expect(createSketchLoft([box("a", 20, 0), { ...box("b", 10, 10), rotationX: 90 }])).toHaveProperty("error");
  });
});

describe.skipIf(!hasNativeKernelExe || !hasWasmKernel)("loft in the Mintr engine", () => {
  const native = spawnNativeKernelClient();
  afterAll(() => native.close());

  it("builds the same exact loft on the desktop and in the browser, matching the preview", async () => {
    const wasm = await startWasmKernel();
    const shapes = [
      createLoftShape(),
      withLoftSettings(createLoftShape(), { wall: 1.2 }),
      withLoftStarter(withLoftStarter(createLoftShape(), { top: "square", topScale: 70 }), { twist: 60 }),
    ];
    for (const shape of shapes) {
      const job = serializeLoftJob(shape)!;
      const [desktop, browser] = await Promise.all([native.request({ id: 1, ...job }), wasm.request({ id: 1, ...job })]);
      expect(desktop.ok, String(desktop.message)).toBe(true);
      expect(browser.ok, String(browser.message)).toBe(true);
      const exact = volume(desktop.positions as number[], desktop.indices as number[]);
      expect(volume(browser.positions as number[], browser.indices as number[])).toBeCloseTo(exact, 1);
      const preview = volume(shape.importedMesh!.positions, shape.importedMesh!.indices!);
      expect(Math.abs(preview - exact) / exact).toBeLessThan(0.03);
      const built = applyLoftKernelMesh(shape, desktop.positions as number[], desktop.normals as number[], desktop.indices as number[], String(desktop.cadBrep), job.key)!;
      expect(built.loftBuilt).toBe(job.key);
      expect(loftBuildPending(built)).toBe(false);
      expect(toNativeKernelSolid(built)?.kind).toBe("brep");
    }
  });

  it("says why a wall is too thick", async () => {
    const shape = withLoftSettings(createLoftShape(), { wall: 9 });
    const reply = await native.request({ id: 2, ...serializeLoftJob(shape)! });
    expect(reply.ok).toBe(false);
    expect(reply.fallback).toBe(false);
    expect(String(reply.message)).toMatch(/wall/i);
  });
});
