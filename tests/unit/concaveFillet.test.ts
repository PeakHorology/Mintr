import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { coveEdges, cutConcaveCorners, edgeIsConcave } from "@/workers/cadModifier.worker";

const occtDir = join(process.cwd(), "node_modules", "occt-wasm", "dist");
const { OcctKernel } = await import(pathToFileURL(join(occtDir, "index.js")).href);

const kernel: OcctKernel = await OcctKernel.init({ wasm: join(occtDir, "occt-wasm.wasm") });

function volume(shape: ShapeHandle) {
  return Math.abs(kernel.getVolume(shape));
}

function cut(solid: ShapeHandle, tool: ShapeHandle) {
  let result = kernel.simplify(kernel.cut(solid, tool));
  if (!kernel.isSolid(result)) {
    const solids = kernel.getSubShapes(result, "solid");
    if (solids.length === 1) result = solids[0];
  }
  return result;
}

function rectangularHole() {
  const plate = kernel.makeBoxFromCorners({ x: -20, y: 0, z: -15 }, { x: 20, y: 10, z: 15 });
  const cutter = kernel.makeBoxFromCorners({ x: -6, y: -1, z: -4 }, { x: 6, y: 12, z: 4 });
  return cut(plate, cutter);
}

function blindRoundHole() {
  const plate = kernel.makeBoxFromCorners({ x: -20, y: 0, z: -20 }, { x: 20, y: 10, z: 20 });
  let hole = kernel.makeCylinder(4, 6);
  hole = kernel.rotate(hole, { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, -Math.PI / 2);
  hole = kernel.translate(hole, 0, 4, 0);
  return cut(plate, hole);
}

function concaveEdges(solid: ShapeHandle) {
  return kernel.getSubShapes(solid, "edge").filter((edge) => edgeIsConcave(kernel, solid, edge));
}

describe("concave fillet", () => {
  it("rounds a rectangular hole corner without filling it", () => {
    const solid = rectangularHole();
    const edges = concaveEdges(solid);
    expect(edges).toHaveLength(4);
    const result = cutConcaveCorners(kernel, kernel.copy(solid), solid, edges, "fillet", 1, 45);
    expect(kernel.isValid(result)).toBe(true);
    expect(volume(result)).toBeCloseTo(11031.416, 2);
  });

  it("fillets the bottom of a blind round hole at a small radius", () => {
    const solid = blindRoundHole();
    const edges = concaveEdges(solid);
    expect(edges).toHaveLength(1);
    expect(kernel.curveType(edges[0])).toBe("circle");
    const before = volume(solid);
    for (const amount of [0.05, 0.2, 0.5]) {
      const result = cutConcaveCorners(kernel, kernel.copy(solid), solid, edges, "fillet", amount, 45);
      expect(kernel.isValid(result)).toBe(true);
      expect(kernel.isSolid(result)).toBe(true);
      const removed = before - volume(result);
      expect(removed).toBeGreaterThan(0);
      expect(removed).toBeLessThan(before * 0.02);
    }
  });

  it("fillets every corner of a slotted plate without a trial fillet per edge", () => {
    let solid = kernel.makeBoxFromCorners({ x: -40, y: 0, z: -20 }, { x: 40, y: 8, z: 20 });
    for (let index = 0; index < 8; index += 1) {
      const z = -16 + index * 4;
      const cutter = kernel.makeBoxFromCorners({ x: -30, y: -1, z }, { x: 30, y: 12, z: z + 1.5 });
      solid = cut(solid, cutter);
    }
    const edges = concaveEdges(solid);
    expect(edges).toHaveLength(32);
    const before = volume(solid);
    const result = cutConcaveCorners(kernel, kernel.copy(solid), solid, edges, "fillet", 0.4, 45);
    expect(kernel.isValid(result)).toBe(true);
    expect(before - volume(result)).toBeGreaterThan(1);
    expect(before - volume(result)).toBeLessThan(80);
  }, 20_000);

  it("rejects a radius that breaks through the blind-hole floor", () => {
    const solid = blindRoundHole();
    const edges = concaveEdges(solid);
    expect(() => cutConcaveCorners(kernel, kernel.copy(solid), solid, edges, "fillet", 5, 45)).toThrow(/smaller fillet/);
  });
});

describe("cove (concave) fillet", () => {
  const edgeMid = (edge: ShapeHandle) => {
    const params = kernel.curveParameters(edge);
    return kernel.curvePointAtParam(edge, (params.first + params.last) / 2);
  };

  it("scoops a quarter-round groove out of one straight box edge", () => {
    const solid = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 20, y: 20, z: 20 });
    // The top-front edge: y = 20, z = 20, running along x.
    const edge = kernel.getSubShapes(solid, "edge").find((candidate) => {
      const mid = edgeMid(candidate);
      return Math.abs(mid.y - 20) < 1e-6 && Math.abs(mid.z - 20) < 1e-6;
    });
    expect(edge).toBeDefined();
    const result = coveEdges(kernel, solid, [edge!], 2);
    expect(kernel.isValid(result)).toBe(true);
    expect(kernel.isSolid(result)).toBe(true);
    // A quarter cylinder of radius 2 along a 20 mm edge is removed; a convex
    // fillet would have removed (r² − πr²/4)·L ≈ 17.2 instead.
    expect(8000 - volume(result)).toBeCloseTo((Math.PI * 4 / 4) * 20, 1);
    // The groove is concave: the old edge line is now empty and a point just
    // inside the groove wall is still material.
    expect(kernel.containsPoint(result, { x: 10, y: 19.5, z: 19.5 }, 1e-6)).toBe(false);
    expect(kernel.containsPoint(result, { x: 10, y: 17.5, z: 17.5 }, 1e-6)).toBe(true);
    // The groove runs out through both end faces. A cutter that stops on the
    // vertex leaves the corner, and a skin across the end of the groove.
    expect(kernel.containsPoint(result, { x: 0, y: 20, z: 20 }, 1e-4)).toBe(false);
    expect(kernel.containsPoint(result, { x: 0.2, y: 19.2, z: 19.2 }, 1e-4)).toBe(false);
    expect(kernel.containsPoint(result, { x: 19.8, y: 19.2, z: 19.2 }, 1e-4)).toBe(false);
    const endMesh = kernel.tessellate(result, { linearDeflection: 0.12, angularDeflection: 0.2 });
    let endCorner = -1;
    for (let index = 0; index < endMesh.positions.length; index += 3) {
      const x = endMesh.positions[index];
      const y = endMesh.positions[index + 1];
      const z = endMesh.positions[index + 2];
      if (x < 1 && y > 18 && z > 18) endCorner = Math.max(endCorner, Math.min(y, z));
    }
    expect(endCorner).toBeLessThan(19);
    // The box outline is untouched away from the groove.
    const box = kernel.getBoundingBox(result, false);
    expect(box.xmax - box.xmin).toBeCloseTo(20, 3);
    expect(box.ymax - box.ymin).toBeCloseTo(20, 3);
  });

  it("coves every edge of a box and blends the corners with a ball", () => {
    const solid = kernel.makeBox(20, 20, 20);
    const edges = kernel.getSubShapes(solid, "edge");
    expect(edges).toHaveLength(12);
    const result = coveEdges(kernel, solid, edges, 1.5);
    expect(kernel.isValid(result)).toBe(true);
    expect(kernel.isSolid(result)).toBe(true);
    const removed = 8000 - volume(result);
    const perEdge = (Math.PI * 1.5 * 1.5 / 4) * 20;
    expect(removed).toBeGreaterThan(perEdge * 12 * 0.8);
    expect(removed).toBeLessThan(perEdge * 12 + 8 * (4 / 3) * Math.PI * 1.5 ** 3);
    // The corner itself is inside the ball, so no spike is left where three grooves meet.
    expect(kernel.containsPoint(result, { x: 0.6, y: 0.6, z: 0.6 }, 1e-6)).toBe(false);
  });

  it("shortens the next edge when a cove is cut on the previous result", () => {
    const solid = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 20, y: 20, z: 20 });
    const top = kernel.getSubShapes(solid, "edge").filter((candidate) => Math.abs(edgeMid(candidate).z - 20) < 1e-6);
    const alongX = top.find((candidate) => Math.abs(edgeMid(candidate).y - 20) < 1e-6);
    expect(alongX).toBeDefined();
    const first = coveEdges(kernel, solid, [alongX!], 3);
    const shortened = kernel.getSubShapes(first, "edge").find((candidate) => {
      const params = kernel.curveParameters(candidate);
      const a = kernel.curvePointAtParam(candidate, params.first);
      const b = kernel.curvePointAtParam(candidate, params.last);
      const mid = edgeMid(candidate);
      const length = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      return Math.abs(mid.x - 20) < 0.2 && Math.abs(mid.z - 20) < 0.2 && length < 19;
    });
    expect(shortened).toBeDefined();
    const params = kernel.curveParameters(shortened!);
    const a = kernel.curvePointAtParam(shortened!, params.first);
    const b = kernel.curvePointAtParam(shortened!, params.last);
    // Radius 3 eats the shared corner, so this edge no longer runs the full 20 mm.
    // A cutter built on it would stop short of the corner.
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeCloseTo(17, 1);
  });

  it("cuts the top loop of a box through the side faces, with no corner peak", () => {
    const solid = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 20, y: 20, z: 20 });
    const edges = kernel.getSubShapes(solid, "edge").filter((candidate) => Math.abs(edgeMid(candidate).z - 20) < 1e-6);
    expect(edges).toHaveLength(4);
    const result = coveEdges(kernel, solid, edges, 3);
    const outside = (point: { x: number; y: number; z: number }) => kernel.containsPoint(result, point, 1e-4) === false;
    // Mid-edge of every top edge is gone, and the side face just under it is gone too.
    expect(outside({ x: 10, y: 20, z: 20 })).toBe(true);
    expect(outside({ x: 10, y: 19.2, z: 20 })).toBe(true);
    expect(outside({ x: 10, y: 20, z: 19.2 })).toBe(true);
    expect(outside({ x: 20, y: 10, z: 20 })).toBe(true);
    expect(outside({ x: 19.2, y: 10, z: 20 })).toBe(true);
    // Corners are cut back, not left as spikes above the groove.
    expect(outside({ x: 20, y: 20, z: 20 })).toBe(true);
    expect(outside({ x: 19.2, y: 19.2, z: 20 })).toBe(true);
    expect(outside({ x: 0.4, y: 0.4, z: 20 })).toBe(true);
    // The middle of the top face is still there.
    expect(kernel.containsPoint(result, { x: 10, y: 10, z: 20 }, 1e-4)).toBe(true);
    const mesh = kernel.tessellate(result, { linearDeflection: 0.16, angularDeflection: 0.32 });
    let cornerZ = -1;
    let lipZ = -1;
    for (let index = 0; index < mesh.positions.length; index += 3) {
      const x = mesh.positions[index];
      const y = mesh.positions[index + 1];
      const z = mesh.positions[index + 2];
      if (x > 18 && y > 18) cornerZ = Math.max(cornerZ, z);
      if (Math.abs(x - 10) < 1 && y > 18.5) lipZ = Math.max(lipZ, z);
    }
    expect(cornerZ).toBeLessThan(18);
    expect(lipZ).toBeLessThan(18);
  });

  it("coves the rim of a cylinder with a torus-shaped groove", () => {
    const solid = kernel.makeCylinder(10, 15);
    const rim = kernel.getSubShapes(solid, "edge").find((edge) => {
      if (kernel.curveType(edge) !== "circle") return false;
      return Math.abs(edgeMid(edge).z - 15) < 1e-6;
    });
    expect(rim).toBeDefined();
    const before = volume(solid);
    const result = coveEdges(kernel, solid, [rim!], 1.5);
    expect(kernel.isValid(result)).toBe(true);
    const removed = before - volume(result);
    const fullTorus = 2 * Math.PI * Math.PI * 10 * 1.5 * 1.5;
    // About a quarter of the torus sits inside the cylinder (a little less, the
    // inner side of the ring is shorter than the centre line).
    expect(removed).toBeGreaterThan(fullTorus * 0.2);
    expect(removed).toBeLessThan(fullTorus * 0.3);
  });
});

describe("concave fillet corners", () => {
  it("leaves no point of material where three grooves meet at a corner", () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 20, y: 20, z: 20 });
    const result = coveEdges(kernel, box, kernel.getSubShapes(box, "edge"), 4);
    expect(kernel.isValid(result)).toBe(true);
    expect(kernel.isSolid(result)).toBe(true);
    // The grooves alone would leave material out to here along the corner's diagonal.
    const t = 4 / Math.SQRT2 + 0.05;
    const probe = kernel.translate(kernel.makeSphere(0.02), t, t, t);
    expect(volume(kernel.common(result, probe))).toBeLessThan(1e-7);
  });

  it("keeps the plain ball where an edge at the corner stays sharp", () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 20, y: 20, z: 20 });
    const top = kernel.getSubShapes(box, "edge").filter((edge) => {
      const params = kernel.curveParameters(edge);
      return Math.abs(kernel.curvePointAtParam(edge, (params.first + params.last) / 2).z - 20) < 1e-6;
    });
    const result = coveEdges(kernel, box, top, 4);
    // Just below the groove on the sharp vertical edge, the part is untouched.
    const probe = kernel.translate(kernel.makeSphere(0.05), 0.3, 0.3, 20 - 4 - 0.5);
    expect(volume(kernel.common(result, probe))).toBeGreaterThan(1e-6);
  });
});
