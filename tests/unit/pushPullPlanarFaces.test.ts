import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { OcctKernel } from "occt-wasm";
import { ghostPrismMesh, polylinePoints } from "@/lib/pushPullGeometry";
import { collectPlanarFaces, reconstructSolid } from "@/workers/cadModifier.worker";

const occtDir = join(process.cwd(), "node_modules", "occt-wasm", "dist");
const { OcctKernel } = await import(pathToFileURL(join(occtDir, "index.js")).href);
const kernel: OcctKernel = await OcctKernel.init({ wasm: join(occtDir, "occt-wasm.wasm") });

type Vec2 = { x: number; y: number };

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const orient = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < -1e-9 && o3 * o4 < -1e-9;
}

/** True when the loop is a simple polygon: no non-adjacent edges cross. */
function isSimpleLoop(points: Array<{ x: number; y: number; z: number }>, normal: { x: number; y: number; z: number }) {
  const dropAxis = Math.abs(normal.x) > 0.9 ? "x" : Math.abs(normal.y) > 0.9 ? "y" : "z";
  const flat: Vec2[] = points.map((p) => (dropAxis === "x" ? { x: p.y, y: p.z } : dropAxis === "y" ? { x: p.x, y: p.z } : { x: p.x, y: p.y }));
  const n = flat.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(flat[i], flat[(i + 1) % n], flat[j], flat[(j + 1) % n])) return false;
    }
  }
  return true;
}

function meshVolume(positions: Float32Array, indices: Uint32Array) {
  let volume = 0;
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const a = indices[index] * 3;
    const b = indices[index + 1] * 3;
    const c = indices[index + 2] * 3;
    volume += (
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])
    ) / 6;
  }
  // Signed: a closed, outward-wound prism is positive.
  return volume;
}

describe("Push Pull planar faces from the occt-wasm worker", () => {
  it("returns ordered, simple outlines for every face of an L-shaped fused group", () => {
    // 20×20×20 block with a 10×10×20 step beside it: the z=0 face is an L of area 500.
    const tall = kernel.makeBox(20, 20, 20);
    const low = kernel.translate(kernel.makeBox(10, 10, 20), 20, 0, 0);
    const fused = kernel.unifySameDomain(kernel.fuse(tall, low));
    const { faces, handles } = collectPlanarFaces(kernel, fused);
    expect(faces.length).toBeGreaterThanOrEqual(6);
    for (const face of faces) {
      const loop = polylinePoints(face.points);
      expect(loop.length, `face ${face.id}`).toBeGreaterThanOrEqual(4);
      expect(isSimpleLoop(loop, face.normal), `face ${face.id} outline crosses itself`).toBe(true);
      // Consecutive corners of a box-fused solid never share a diagonal.
      for (let index = 0; index < loop.length; index += 1) {
        const a = loop[index];
        const b = loop[(index + 1) % loop.length];
        const moved = ["x", "y", "z"].filter((axis) => Math.abs(a[axis as "x"] - b[axis as "x"]) > 1e-4);
        expect(moved, `face ${face.id} segment ${index}`).toHaveLength(1);
      }
    }
    // The L-shaped front face (z = 0) has six corners and a ghost prism whose volume is area × distance.
    const front = faces.find((face) => face.normal.z < -0.9 && Math.abs(face.area - 500) < 1e-3);
    expect(front).toBeTruthy();
    expect(polylinePoints(front!.points)).toHaveLength(6);
    const pull = ghostPrismMesh(front!, 4);
    expect(meshVolume(pull.positions, pull.indices)).toBeCloseTo(500 * 4, 1);
    const push = ghostPrismMesh(front!, -4);
    expect(meshVolume(push.positions, push.indices)).toBeCloseTo(500 * 4, 1);
    handles.forEach((handle) => kernel.release(handle));
  });

  it("restores a moved B-Rep body (a dragged Push Pull result) as a valid solid", () => {
    // Pushing a face stores a B-Rep; dragging the shape afterwards sends it back with a translation.
    const pulled = kernel.fuse(kernel.makeBox(20, 20, 20), kernel.translate(kernel.makeBox(10, 10, 5), 5, 20, 5));
    const brep = kernel.toBREP(pulled);
    const moved = reconstructSolid(kernel, { brep, brepTransform: [1, 0, 0, -1, 0, 1, 0, 0, 0, 0, 1, 3], hole: false });
    expect(kernel.isValid(moved)).toBe(true);
    expect(kernel.isSolid(moved)).toBe(true);
    expect(Math.abs(kernel.getVolume(moved))).toBeCloseTo(8000 + 500, 3);
    const box = kernel.getBoundingBox(moved);
    expect(box.xmin).toBeCloseTo(-1, 5);
    expect(box.zmin).toBeCloseTo(3, 5);
    const { faces } = collectPlanarFaces(kernel, moved);
    expect(faces.length).toBeGreaterThanOrEqual(10);
  });

  it("samples a cylinder's flat caps as a closed ring without a seam spike", () => {
    const cylinder = kernel.makeCylinder(8, 12);
    const { faces, handles } = collectPlanarFaces(kernel, cylinder);
    const caps = faces.filter((face) => Math.abs(face.normal.z) > 0.9);
    expect(caps).toHaveLength(2);
    for (const cap of caps) {
      const loop = polylinePoints(cap.points);
      expect(loop.length).toBeGreaterThan(12);
      for (const point of loop) expect(Math.hypot(point.x, point.y)).toBeCloseTo(8, 1);
      const ghost = ghostPrismMesh(cap, 3);
      expect(meshVolume(ghost.positions, ghost.indices)).toBeCloseTo(Math.PI * 64 * 3, -1);
    }
    handles.forEach((handle) => kernel.release(handle));
  });
});
