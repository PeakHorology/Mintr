import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { coveEdges, cutConcaveCorners, edgeIsConcave } from "@/workers/cadModifier.worker";
import { orientSolidNormals, shadeDisplayNormals } from "@/lib/meshShade";

const occtDir = join(process.cwd(), "node_modules", "occt-wasm", "dist");
const { OcctKernel } = await import(pathToFileURL(join(occtDir, "index.js")).href);
const kernel: OcctKernel = await OcctKernel.init({ wasm: join(occtDir, "occt-wasm.wasm") });

function dot(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalAt(normals: ArrayLike<number>, vertex: number) {
  return [normals[vertex * 3], normals[vertex * 3 + 1], normals[vertex * 3 + 2]];
}

/** Quarter-circle strip. `inward` points the facet normals at the arc center. */
function quarterArc(inward: boolean) {
  const segments = 4;
  const radius = 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const point = (turn: number, x: number) => [x, Math.sin(turn) * radius, Math.cos(turn) * radius] as const;
  const push = (a: readonly number[], b: readonly number[], c: readonly number[]) => {
    const bx = b[0] - a[0];
    const by = b[1] - a[1];
    const bz = b[2] - a[2];
    const cx = c[0] - a[0];
    const cy = c[1] - a[1];
    const cz = c[2] - a[2];
    let nx = by * cz - bz * cy;
    let ny = bz * cx - bx * cz;
    let nz = bx * cy - by * cx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    const radial = [0, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const radialLength = Math.hypot(radial[1], radial[2]) || 1;
    const outward = dot([nx, ny, nz], [0, radial[1] / radialLength, radial[2] / radialLength]) > 0;
    const flip = outward === inward;
    for (const corner of [a, b, c]) {
      positions.push(corner[0], corner[1], corner[2]);
      normals.push(flip ? -nx : nx, flip ? -ny : ny, flip ? -nz : nz);
    }
  };
  for (let step = 0; step < segments; step += 1) {
    const t0 = (step / segments) * (Math.PI / 2);
    const t1 = ((step + 1) / segments) * (Math.PI / 2);
    const a = point(t0, 0);
    const b = point(t1, 0);
    const c = point(t1, 1);
    const d = point(t0, 1);
    push(a, b, c);
    push(a, c, d);
  }
  return { positions, normals };
}

function cut(solid: ShapeHandle, tool: ShapeHandle) {
  let result = kernel.simplify(kernel.cut(solid, tool));
  if (!kernel.isSolid(result)) {
    const solids = kernel.getSubShapes(result, "solid");
    if (solids.length === 1) result = solids[0];
  }
  return result;
}

function meanAlignment(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  accept: (x: number, y: number, z: number, normal: number[]) => [number, number, number] | null,
) {
  let sum = 0;
  let count = 0;
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const normal = normalAt(normals, vertex);
    const expected = accept(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2], normal);
    if (!expected) continue;
    sum += dot(normal, expected);
    count += 1;
  }
  return { sum: count ? sum / count : 0, count };
}

function shownNormals(shape: ShapeHandle, linear: number, angular: number) {
  const mesh = kernel.tessellate(shape, { linearDeflection: linear, angularDeflection: angular });
  const oriented = orientSolidNormals(mesh.positions, mesh.normals, mesh.indices, (x, y, z) => (
    kernel.containsPoint(shape, { x, y, z }, 1e-4)
  ));
  expect(oriented).not.toBeNull();
  const shaded = shadeDisplayNormals(oriented!.positions, oriented!.normals, oriented!.indices);
  expect(shaded).not.toBeNull();
  return { positions: oriented!.positions, normals: shaded! };
}

describe("fillet shading", () => {
  it("blends a convex round without moving a sharp edge", () => {
    const arc = quarterArc(false);
    const shaded = shadeDisplayNormals(arc.positions, arc.normals);
    expect(shaded).not.toBeNull();
    // The shared step between the first two segments sits at 45° of a 4-step quarter.
    const seamY = Math.sin(Math.PI / 8) * 2;
    const seamZ = Math.cos(Math.PI / 8) * 2;
    const atSeam: number[][] = [];
    for (let vertex = 0; vertex < arc.positions.length / 3; vertex += 1) {
      const y = arc.positions[vertex * 3 + 1];
      const z = arc.positions[vertex * 3 + 2];
      if (Math.abs(y - seamY) < 1e-6 && Math.abs(z - seamZ) < 1e-6 && arc.positions[vertex * 3] === 0) {
        atSeam.push(normalAt(shaded!, vertex));
      }
    }
    expect(atSeam.length).toBeGreaterThan(1);
    expect(dot(atSeam[0], atSeam[1])).toBeGreaterThan(0.999);
    const outward = [0, seamY, seamZ];
    const outwardLength = Math.hypot(outward[1], outward[2]);
    expect(dot(atSeam[0], [0, outward[1] / outwardLength, outward[2] / outwardLength])).toBeGreaterThan(0.9);

    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0];
    const normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    const corner = shadeDisplayNormals(positions, normals);
    const faceA = normalAt(corner!, 0);
    const faceB = normalAt(corner!, 3);
    expect(dot(faceA, faceB)).toBeLessThan(0.2);
    expect(faceA[1]).toBeCloseTo(1, 5);
    expect(faceB[2]).toBeCloseTo(1, 5);
  });

  it("keeps a concave groove pointing into the void", () => {
    const arc = quarterArc(true);
    const shaded = shadeDisplayNormals(arc.positions, arc.normals);
    expect(shaded).not.toBeNull();
    const seamY = Math.sin(Math.PI / 8) * 2;
    const seamZ = Math.cos(Math.PI / 8) * 2;
    let inward = 0;
    let samples = 0;
    for (let vertex = 0; vertex < arc.positions.length / 3; vertex += 1) {
      const y = arc.positions[vertex * 3 + 1];
      const z = arc.positions[vertex * 3 + 2];
      if (Math.abs(y - seamY) > 1e-6 || Math.abs(z - seamZ) > 1e-6) continue;
      const length = Math.hypot(seamY, seamZ);
      inward += dot(normalAt(shaded!, vertex), [0, -seamY / length, -seamZ / length]);
      samples += 1;
    }
    expect(samples).toBeGreaterThan(1);
    expect(inward / samples).toBeGreaterThan(0.9);
  });

  it("leaves surface normals alone, including a concave corner", () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const normals = [0, 0.2, 0.98, -0.1, 0.3, 0.95, 0.1, 0.1, 0.99];
    const shaded = shadeDisplayNormals(positions, normals);
    expect(shaded).not.toBeNull();
    for (let index = 0; index < normals.length; index += 1) {
      expect(shaded![index]).toBeCloseTo(normals[index], 5);
    }
  });

  it("lights a cove and an inside-corner fillet from outside the material", () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 20, y: 20, z: 20 });
    const edge = kernel.getSubShapes(box, "edge").find((candidate) => {
      const mid = kernel.curvePointAtParam(candidate, (kernel.curveParameters(candidate).first + kernel.curveParameters(candidate).last) / 2);
      return Math.abs(mid.y - 20) < 1e-6 && Math.abs(mid.z - 20) < 1e-6;
    });
    expect(edge).toBeDefined();
    const cove = coveEdges(kernel, box, [edge!], 2);
    const coveShown = shownNormals(cove, 0.2, 0.4);
    // The cove is a quarter circle centered on the corner. Its outside points
    // back at that corner. End-cap normals run along the edge and are skipped.
    const coveLit = meanAlignment(coveShown.positions, coveShown.normals, (_x, y, z, normal) => {
      if (Math.abs(normal[0]) > 0.45) return null;
      const dy = 20 - y;
      const dz = 20 - z;
      const radius = Math.hypot(dy, dz);
      if (radius < 1.7 || radius > 2.2 || y > 19.7 || z > 19.7 || y < 17.5 || z < 17.5) return null;
      return [0, dy / radius, dz / radius];
    });
    expect(coveLit.count).toBeGreaterThan(8);
    expect(coveLit.sum).toBeGreaterThan(0.75);

    const convexBox = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 20, y: 20, z: 20 });
    const convexEdge = kernel.getSubShapes(convexBox, "edge").find((candidate) => {
      const mid = kernel.curvePointAtParam(candidate, (kernel.curveParameters(candidate).first + kernel.curveParameters(candidate).last) / 2);
      return Math.abs(mid.y - 20) < 1e-6 && Math.abs(mid.z - 20) < 1e-6;
    });
    const convex = kernel.fillet(convexBox, [convexEdge!], 2);
    const convexShown = shownNormals(convex, 0.2, 0.4);
    const convexLit = meanAlignment(convexShown.positions, convexShown.normals, (_x, y, z, normal) => {
      if (Math.abs(normal[0]) > 0.45) return null;
      const dy = y - 18;
      const dz = z - 18;
      const radius = Math.hypot(dy, dz);
      if (radius < 1.7 || radius > 2.2 || y < 18.3 || z < 18.3 || y > 19.9 || z > 19.9) return null;
      return [0, dy / radius, dz / radius];
    });
    expect(convexLit.count).toBeGreaterThan(8);
    expect(convexLit.sum).toBeGreaterThan(0.75);

    const plate = kernel.makeBoxFromCorners({ x: -20, y: 0, z: -15 }, { x: 20, y: 10, z: 15 });
    const cutter = kernel.makeBoxFromCorners({ x: -6, y: -1, z: -4 }, { x: 6, y: 12, z: 4 });
    const holed = cut(plate, cutter);
    const concaveEdges = kernel.getSubShapes(holed, "edge").filter((candidate) => edgeIsConcave(kernel, holed, candidate));
    const pocket = cutConcaveCorners(kernel, kernel.copy(holed), holed, concaveEdges, "fillet", 1, 45);
    const pocketShown = shownNormals(pocket, 0.15, 0.35);
    const pocketLit = meanAlignment(pocketShown.positions, pocketShown.normals, (x, _y, z, normal) => {
      if (Math.abs(normal[1]) > 0.45) return null;
      const corners = [[6, 4], [6, -4], [-6, 4], [-6, -4]];
      for (const [cx, cz] of corners) {
        const centerX = cx - Math.sign(cx);
        const centerZ = cz - Math.sign(cz);
        const dx = x - centerX;
        const dz = z - centerZ;
        const radius = Math.hypot(dx, dz);
        if (radius < 0.65 || radius > 1.25) continue;
        if (Math.sign(dx) !== Math.sign(cx) || Math.sign(dz) !== Math.sign(cz)) continue;
        return [-dx / radius, 0, -dz / radius];
      }
      return null;
    });
    expect(pocketLit.count).toBeGreaterThan(8);
    expect(pocketLit.sum).toBeGreaterThan(0.7);
  });
});
