import { describe, expect, it } from "vitest";
import { applySurfaceTexture } from "@/lib/texture/textureApply";
import { faceRegions, holeRegions } from "@/lib/texture/textureFaces";
import { openEdgeCount, weldTriangles, type IndexedMesh } from "@/lib/texture/textureMesh";

function boxMesh(w: number, h: number, d: number) {
  const x = w / 2;
  const z = d / 2;
  const positions = [-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z, -x, h, -z, x, h, -z, x, h, z, -x, h, z];
  const indices = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2];
  return { positions, indices };
}

function cylinderMesh(radius: number, height: number, sides: number) {
  const positions: number[] = [0, 0, 0, 0, height, 0];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2;
    positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius, Math.cos(a) * radius, height, Math.sin(a) * radius);
  }
  const indices: number[] = [];
  for (let i = 0; i < sides; i += 1) {
    const b0 = 2 + i * 2;
    const b1 = 2 + ((i + 1) % sides) * 2;
    indices.push(0, b0, b1, 1, b1 + 1, b0 + 1, b0, b0 + 1, b1 + 1, b0, b1 + 1, b1);
  }
  return { positions, indices };
}

/** A tube on y = 0: outer wall, inner wall (the hole), and two flat rings. */
function tubeMesh(outer: number, inner: number, height: number, sides: number) {
  const positions: number[] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    positions.push(c * outer, 0, s * outer, c * outer, height, s * outer, c * inner, 0, s * inner, c * inner, height, s * inner);
  }
  const indices: number[] = [];
  for (let i = 0; i < sides; i += 1) {
    const o0 = i * 4;
    const o1 = ((i + 1) % sides) * 4;
    // Outer wall faces out, inner wall faces in toward the axis.
    indices.push(o0, o0 + 1, o1 + 1, o0, o1 + 1, o1);
    indices.push(o0 + 2, o1 + 3, o0 + 3, o0 + 2, o1 + 2, o1 + 3);
    // Top ring faces up, bottom ring faces down.
    indices.push(o0 + 1, o0 + 3, o1 + 3, o0 + 1, o1 + 3, o1 + 1);
    indices.push(o0, o1, o1 + 2, o0, o1 + 2, o0 + 2);
  }
  return { positions, indices };
}

function normalsOf(mesh: IndexedMesh) {
  const { positions: p, indices } = mesh;
  const normals = new Float32Array(indices.length);
  const areas = new Float32Array(indices.length / 3);
  for (let t = 0; t < indices.length / 3; t += 1) {
    const [a, b, c] = [indices[t * 3] * 3, indices[t * 3 + 1] * 3, indices[t * 3 + 2] * 3];
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(n[0], n[1], n[2]);
    areas[t] = length / 2;
    for (let k = 0; k < 3; k += 1) normals[t * 3 + k] = n[k] / length;
  }
  return { normals, areas };
}

const welded = (mesh: { positions: number[]; indices: number[] }) => weldTriangles(mesh.positions, mesh.indices);

describe("texture faces", () => {
  it("sees a box as six flat faces and a cylinder as two caps and a wall", () => {
    const box = welded(boxMesh(10, 10, 10));
    const boxFaces = faceRegions(box, normalsOf(box).normals, normalsOf(box).areas);
    expect(boxFaces.count).toBe(6);
    expect(boxFaces.flat.every(Boolean)).toBe(true);
    const cylinder = welded(cylinderMesh(10, 20, 64));
    const { normals, areas } = normalsOf(cylinder);
    const cylinderFaces = faceRegions(cylinder, normals, areas);
    expect(cylinderFaces.count).toBe(3);
    expect(cylinderFaces.flat.filter(Boolean).length).toBe(2);
  });

  it("finds the hole in a tube, not its outside", () => {
    const tube = welded(tubeMesh(10, 4, 12, 48));
    const { normals, areas } = normalsOf(tube);
    const regions = faceRegions(tube, normals, areas);
    expect(regions.count).toBe(4);
    const holes = holeRegions(tube, normals, areas, regions);
    expect(holes.filter(Boolean).length).toBe(1);
    // The hole is the wall whose triangles face the axis.
    const t = Array.from(regions.region).findIndex((r) => holes[r]);
    const p = tube.positions;
    const corner = tube.indices[t * 3] * 3;
    expect(Math.hypot(p[corner], p[corner + 2])).toBeCloseTo(4, 3);
  });

  it("leaves the hole of a tube smooth so a pin still fits", async () => {
    const result = await applySurfaceTexture(tubeMesh(10, 4, 12, 48), { pattern: "bumps", spacing: 2, depth: 0.5 });
    expect(openEdgeCount(result.indices)).toBe(0);
    let innerMin = Infinity;
    for (let i = 0; i < result.positions.length; i += 3) {
      const r = Math.hypot(result.positions[i], result.positions[i + 2]);
      if (r < 7) innerMin = Math.min(innerMin, r);
    }
    // Nothing grows into the hole (a 48-sided wall is a hair inside a true 4 mm circle).
    expect(innerMin).toBeGreaterThan(4 * Math.cos(Math.PI / 48) - 1e-3);
  });

  it("textures only the picked face", async () => {
    const result = await applySurfaceTexture(boxMesh(10, 10, 10), {
      pattern: "bumps", spacing: 2, depth: 0.5, faces: "picked",
      picks: [{ point: [5, 5, 0], normal: [1, 0, 0] }],
    });
    expect(openEdgeCount(result.indices)).toBe(0);
    let raisedOnX = 0;
    for (let i = 0; i < result.positions.length; i += 3) {
      const [x, y, z] = [result.positions[i], result.positions[i + 1], result.positions[i + 2]];
      if (x > 5.01) raisedOnX += 1;
      // Every other face stays on its plane.
      expect(x).toBeGreaterThanOrEqual(-5 - 1e-4);
      expect(y).toBeLessThanOrEqual(10 + 1e-4);
      expect(Math.abs(z)).toBeLessThanOrEqual(5 + 1e-4);
    }
    expect(raisedOnX).toBeGreaterThan(50);
  });

  it("leaves the top smooth with Sides", async () => {
    const result = await applySurfaceTexture(boxMesh(10, 10, 10), { pattern: "knurl", spacing: 2, depth: 0.5, faces: "sides" });
    let maxY = -Infinity;
    for (let i = 1; i < result.positions.length; i += 3) maxY = Math.max(maxY, result.positions[i]);
    expect(maxY).toBeCloseTo(10, 4);
  });

  it("leaves a face pressed against another part smooth", async () => {
    // A plate against the +z face of the box, facing it.
    const plate = new Float32Array([
      -6, -1, 5, 6, 11, 5, 6, -1, 5,
      -6, -1, 5, -6, 11, 5, 6, 11, 5,
    ]);
    const settings = { pattern: "bumps" as const, spacing: 2, depth: 0.5 };
    const touching = await applySurfaceTexture(boxMesh(10, 10, 10), settings, { contacts: plate });
    let maxZ = -Infinity;
    for (let i = 2; i < touching.positions.length; i += 3) maxZ = Math.max(maxZ, touching.positions[i]);
    expect(maxZ).toBeCloseTo(5, 4);
    const free = await applySurfaceTexture(boxMesh(10, 10, 10), { ...settings, smoothContacts: false }, { contacts: plate });
    let freeMaxZ = -Infinity;
    for (let i = 2; i < free.positions.length; i += 3) freeMaxZ = Math.max(freeMaxZ, free.positions[i]);
    expect(freeMaxZ).toBeGreaterThan(5.2);
  });
});

describe("chosen sides", () => {
  it("textures only the sides turned on", async () => {
    const result = await applySurfaceTexture(boxMesh(10, 10, 10), {
      pattern: "bumps", spacing: 2, depth: 0.5, faces: "picked", sides: ["front", "right"],
    });
    expect(openEdgeCount(result.indices)).toBe(0);
    let front = 0;
    let right = 0;
    for (let i = 0; i < result.positions.length; i += 3) {
      const [x, y, z] = [result.positions[i], result.positions[i + 1], result.positions[i + 2]];
      if (z > 5.05) front += 1;
      if (x > 5.05) right += 1;
      expect(x).toBeGreaterThanOrEqual(-5 - 1e-4);
      expect(z).toBeGreaterThanOrEqual(-5 - 1e-4);
      expect(y).toBeLessThanOrEqual(10 + 1e-4);
    }
    expect(front).toBeGreaterThan(30);
    expect(right).toBeGreaterThan(30);
  });
});

describe("a picture on each face", () => {
  const halves = async () => {
    const { encodeTextureImage } = await import("@/lib/texture/texturePatterns");
    const pixels = new Uint8Array(32 * 32).map((_, i) => ((i % 32) < 16 ? 255 : 0));
    return { name: "Halves", width: 32, height: 32, data: encodeTextureImage(pixels), invert: false };
  };

  it("centres one on each chosen side, the right way round", async () => {
    const image = await halves();
    const result = await applySurfaceTexture(boxMesh(12, 12, 12), {
      pattern: "image", image, placement: "each", spacing: 8, depth: 0.5, faces: "picked", sides: ["front", "right"],
    });
    expect(openEdgeCount(result.indices)).toBe(0);
    let front = 0;
    let right = 0;
    for (let i = 0; i < result.positions.length; i += 3) {
      const [x, y, z] = [result.positions[i], result.positions[i + 1], result.positions[i + 2]];
      if (z > 6.25) {
        front += 1;
        // Front: white half on the viewer's left (-x), centred on the face.
        expect(x).toBeLessThan(0.3);
        expect(x).toBeGreaterThan(-4.3);
        expect(Math.abs(y - 6)).toBeLessThan(4.3);
      }
      if (x > 6.25) {
        right += 1;
        // Right side seen from the right: the viewer's left is +z.
        expect(z).toBeGreaterThan(-0.3);
        expect(z).toBeLessThan(4.3);
      }
      expect(x).toBeGreaterThanOrEqual(-6 - 1e-4);
      expect(z).toBeGreaterThanOrEqual(-6 - 1e-4);
    }
    expect(front).toBeGreaterThan(30);
    expect(right).toBeGreaterThan(30);
  });

  it("puts four round the wall of a cylinder with Walls, and skips faces too small", async () => {
    const { eachFaceStamps } = await import("@/lib/texture/textureFaces");
    const { fittingStamps } = await import("@/lib/texture/textureApply");
    const { normalizeSurfaceTexture } = await import("@/lib/texture/surfaceTexture");
    const cylinder = welded(cylinderMesh(10, 20, 64));
    const { normals, areas } = normalsOf(cylinder);
    const axes: [number, number, number][] = [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [-1, 0, 0], [1, 0, 0]];
    const walls = eachFaceStamps(cylinder, normals, areas, { faces: "sides", picks: [], directions: [], axes });
    expect(walls.length).toBe(4);
    walls.forEach((stamp) => {
      expect(Math.hypot(stamp.point[0], stamp.point[2])).toBeGreaterThan(9.9);
      expect(stamp.point[1]).toBeCloseTo(10, 3);
    });
    const image = await halves();
    // A 30 mm picture is too big for the 14 mm wide part of the wall each side faces.
    expect(fittingStamps(normalizeSurfaceTexture({ pattern: "image", image, spacing: 30 }), walls).length).toBe(0);
  });
});
