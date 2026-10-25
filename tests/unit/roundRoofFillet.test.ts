import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import type { WorkplaneShape } from "@/types/sketchforge";
import { buildNativeShapeSolid } from "@/lib/shapeBrep";
import { applyRemovingTreatment, collectEdges, reconstructSolid } from "@/workers/cadModifier.worker";

const occtDir = join(process.cwd(), "node_modules", "occt-wasm", "dist");
const { OcctKernel } = await import(pathToFileURL(join(occtDir, "index.js")).href);
const kernel: OcctKernel = await OcctKernel.init({ wasm: join(occtDir, "occt-wasm.wasm") });

function roof(width: number, height: number, depth: number) {
  return reconstructSolid(kernel, {
    hole: false,
    primitive: { kind: "roundRoof", width, depth, height },
  });
}

function span(solid: ShapeHandle) {
  const box = kernel.getBoundingBox(solid, false);
  return {
    width: box.xmax - box.xmin,
    height: box.ymax - box.ymin,
    depth: box.zmax - box.zmin,
  };
}

function selectableEdges(solid: ShapeHandle) {
  const collected = collectEdges(kernel, solid, 12, false, true);
  return collected.selectableEdgeIds.map((id) => collected.handles[id]);
}

describe("round roof fillet after resize", () => {
  it("keeps a tall, flat, and half-circle roof at the requested size", () => {
    const tallSolid = roof(20, 16, 24);
    const tall = span(tallSolid);
    expect(tall.width).toBeCloseTo(20, 1);
    expect(tall.height).toBeCloseTo(16, 1);
    expect(tall.depth).toBeCloseTo(24, 1);
    expect(kernel.getBoundingBox(tallSolid, false).ymin).toBeCloseTo(0, 1);
    const flatSolid = roof(28, 6, 16);
    const flat = span(flatSolid);
    expect(flat.width).toBeCloseTo(28, 1);
    expect(flat.height).toBeCloseTo(6, 1);
    expect(kernel.getBoundingBox(flatSolid, false).ymin).toBeCloseTo(0, 1);
    const halfSolid = roof(20, 10, 20);
    const half = span(halfSolid);
    expect(half.width).toBeCloseTo(20, 1);
    expect(half.height).toBeCloseTo(10, 1);
    expect(kernel.getBoundingBox(halfSolid, false).ymin).toBeCloseTo(0, 1);
  });

  it("fillets and chamfers the long edges of a resized roof", () => {
    for (const [width, height, depth, amount] of [[20, 16, 24, 0.8], [28, 6, 16, 0.4], [20, 10, 20, 0.8]] as const) {
      const solid = roof(width, height, depth);
      const edges = selectableEdges(solid);
      expect(edges.length).toBeGreaterThan(0);
      const before = Math.abs(kernel.getVolume(solid));
      const filleted = applyRemovingTreatment(
        kernel,
        solid,
        edges,
        (target, selected) => kernel.fillet(target, selected, amount),
        "fillet",
        amount,
        45,
      );
      expect(kernel.isValid(filleted)).toBe(true);
      expect(before - Math.abs(kernel.getVolume(filleted))).toBeGreaterThan(0.2);
      const host = roof(width, height, depth);
      const chamfered = applyRemovingTreatment(
        kernel,
        host,
        selectableEdges(host),
        (target, selected) => kernel.chamfer(target, selected, amount),
        "chamfer",
        amount,
        45,
      );
      expect(kernel.isValid(chamfered)).toBe(true);
      expect(Math.abs(kernel.getVolume(host)) - Math.abs(kernel.getVolume(chamfered))).toBeGreaterThan(0.05);
      const after = span(chamfered);
      expect(after.width).toBeGreaterThan(width - amount * 3);
      expect(after.height).toBeGreaterThan(height - amount * 3);
      expect(after.depth).toBeGreaterThan(depth - amount * 3);
      expect(after.width).toBeLessThanOrEqual(width + 0.05);
      expect(after.height).toBeLessThanOrEqual(height + 0.05);
      expect(after.depth).toBeLessThanOrEqual(depth + 0.05);
    }
  });

  it("builds the same sized exact solid for Group and STEP", async () => {
    const brep = await import("brepjs");
    brep.registerKernel("occt-wasm", brep.OcctWasmAdapter.fromKernel(kernel as never));
    const shape = {
      id: "roof",
      name: "Round Roof",
      kind: "roundRoof",
      color: "#67c4ce",
      x: 0,
      z: 0,
      size: 20,
      width: 20,
      depth: 24,
      height: 16,
      rotation: 0,
    } satisfies WorkplaneShape;
    const built = buildNativeShapeSolid(brep, shape);
    expect("solid" in built).toBe(true);
    if (!("solid" in built)) return;
    const mesh = brep.mesh(built.solid as never, { tolerance: 0.2, angularTolerance: 0.4 });
    const positions = mesh?.vertices;
    expect(positions && positions.length).toBeGreaterThan(8);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; positions && i + 2 < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]);
      maxX = Math.max(maxX, positions[i]);
      minY = Math.min(minY, positions[i + 1]);
      maxY = Math.max(maxY, positions[i + 1]);
      minZ = Math.min(minZ, positions[i + 2]);
      maxZ = Math.max(maxZ, positions[i + 2]);
    }
    expect(maxX - minX).toBeCloseTo(20, 0);
    expect(maxY - minY).toBeCloseTo(16, 0);
    expect(maxZ - minZ).toBeCloseTo(24, 0);
  });
});
