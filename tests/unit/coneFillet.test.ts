import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { cadModifierPrimitiveForAnalyticCone } from "@/lib/cadBakeMetadata";
import type { WorkplaneShape } from "@/types/sketchforge";
import { cadTransformIsSimilarity, collectEdges, placementWithSectionScale, reconstructSolid } from "@/workers/cadModifier.worker";

const occtDir = join(process.cwd(), "node_modules", "occt-wasm", "dist");
const { OcctKernel } = await import(pathToFileURL(join(occtDir, "index.js")).href);
const kernel: OcctKernel = await OcctKernel.init({ wasm: join(occtDir, "occt-wasm.wasm") });

function volume(shape: ShapeHandle) {
  return Math.abs(kernel.getVolume(shape));
}

function coneSolid(baseRadius: number, topRadius: number, height: number) {
  return reconstructSolid(kernel, {
    hole: false,
    primitive: { kind: "cone", baseRadius, topRadius, height },
  });
}

function selectableEdges(solid: ShapeHandle) {
  const collected = collectEdges(kernel, solid, 12, false, true);
  return collected.selectableEdgeIds.map((id) => collected.handles[id]);
}

describe("cone fillet and chamfer", () => {
  it("sends a stretched cone through the general transform", () => {
    expect(cadTransformIsSimilarity([1, 0, 0, 4, 0, 1, 0, 0, 0, 0, 1, -3])).toBe(true);
    expect(cadTransformIsSimilarity([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.6, 0])).toBe(false);
  });

  it("fillets and chamfers the base circle of a pointed cone", () => {
    const solid = coneSolid(10, 0, 20);
    expect(volume(solid)).toBeCloseTo((Math.PI * 100 * 20) / 3, 1);
    const edges = selectableEdges(solid);
    expect(edges).toHaveLength(1);
    expect(kernel.curveType(edges[0])).toBe("circle");
    const base = kernel.getBoundingBox(edges[0], false);
    expect((base.ymin + base.ymax) / 2).toBeCloseTo(0, 3);

    const before = volume(solid);
    const filleted = kernel.fillet(solid, edges, 1);
    expect(kernel.isValid(filleted)).toBe(true);
    expect(before - volume(filleted)).toBeGreaterThan(1);

    const chamferTarget = coneSolid(10, 0, 20);
    const chamfered = kernel.chamfer(chamferTarget, selectableEdges(chamferTarget), 1);
    expect(kernel.isValid(chamfered)).toBe(true);
    expect(before - volume(chamfered)).toBeGreaterThan(1);
  });

  it("fillets and chamfers both circles of a truncated cone", () => {
    const solid = coneSolid(10, 4, 20);
    const exact = (Math.PI * 20 * (100 + 40 + 16)) / 3;
    expect(volume(solid)).toBeCloseTo(exact, 1);
    const edges = selectableEdges(solid);
    expect(edges).toHaveLength(2);
    expect(edges.every((edge) => kernel.curveType(edge) === "circle")).toBe(true);
    const heights = edges.map((edge) => {
      const box = kernel.getBoundingBox(edge, false);
      return (box.ymin + box.ymax) / 2;
    }).sort((left, right) => left - right);
    expect(heights[0]).toBeCloseTo(0, 3);
    expect(heights[1]).toBeCloseTo(20, 3);

    const before = volume(solid);
    const filleted = kernel.fillet(solid, edges, 1);
    expect(kernel.isValid(filleted)).toBe(true);
    expect(before - volume(filleted)).toBeGreaterThan(1);

    const fresh = coneSolid(10, 4, 20);
    const chamfered = kernel.chamfer(fresh, selectableEdges(fresh), 1);
    expect(kernel.isValid(chamfered)).toBe(true);
    expect(volume(fresh) - volume(chamfered)).toBeGreaterThan(1);
  });

  it("fillets and chamfers the rim of an elliptical cone", () => {
    const shape = {
      id: "cone-ellipse",
      name: "Cone",
      kind: "cone",
      color: "#6e2786",
      x: 0,
      z: 0,
      size: 30,
      width: 30,
      depth: 18,
      height: 20,
      rotation: 0,
      topRadius: 0,
      baseRadius: 10,
      locked: false,
      hidden: false,
    } as WorkplaneShape;
    const primitive = cadModifierPrimitiveForAnalyticCone(shape);
    expect(primitive?.kind).toBe("cone");
    const solid = reconstructSolid(kernel, { hole: false, primitive: primitive! });
    const box = kernel.getBoundingBox(solid, false);
    expect(box.xmax - box.xmin).toBeCloseTo(30, 1);
    expect(box.zmax - box.zmin).toBeCloseTo(18, 1);
    expect(box.ymax - box.ymin).toBeCloseTo(20, 1);
    const hostPrimitive = primitive?.kind === "cone" ? { ...primitive, sectionScale: undefined } : primitive!;
    const host = reconstructSolid(kernel, { hole: false, primitive: hostPrimitive });
    const hostEdges = selectableEdges(host);
    expect(hostEdges).toHaveLength(1);
    expect(kernel.curveType(hostEdges[0])).toBe("circle");
    const placement = placementWithSectionScale(undefined, primitive?.kind === "cone" ? primitive.sectionScale ?? 1 : 1);
    const filleted = kernel.generalTransform(kernel.fillet(host, hostEdges, 1), placement);
    expect(kernel.isValid(filleted)).toBe(true);
    expect(volume(solid) - volume(filleted)).toBeGreaterThan(0.5);
    const filletedBox = kernel.getBoundingBox(filleted, false);
    expect(filletedBox.xmax - filletedBox.xmin).toBeGreaterThan((filletedBox.zmax - filletedBox.zmin) * 1.4);

    const chamferHost = reconstructSolid(kernel, { hole: false, primitive: hostPrimitive });
    const chamfered = kernel.generalTransform(kernel.chamfer(chamferHost, selectableEdges(chamferHost), 1), placement);
    expect(kernel.isValid(chamfered)).toBe(true);
    expect(volume(solid) - volume(chamfered)).toBeGreaterThan(0.5);
    const chamferedBox = kernel.getBoundingBox(chamfered, false);
    expect(chamferedBox.xmax - chamferedBox.xmin).toBeGreaterThan((chamferedBox.zmax - chamferedBox.zmin) * 1.4);
  });
});
