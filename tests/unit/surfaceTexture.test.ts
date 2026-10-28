import { describe, expect, it } from "vitest";
import { applySurfaceTexture } from "@/lib/texture/textureApply";
import { meshVolume, openEdgeCount, subdivideToEdgeLength, weldTriangles } from "@/lib/texture/textureMesh";
import { fuzzyHeight, PATTERN_HEIGHTS } from "@/lib/texture/texturePatterns";
import { normalizeSurfaceTexture, SURFACE_TEXTURE_LIMITS } from "@/lib/texture/surfaceTexture";

/** A closed box sitting on y = 0, faces wound outward. */
function boxMesh(w: number, h: number, d: number) {
  const x = w / 2;
  const z = d / 2;
  const positions = [
    -x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z,
    -x, h, -z, x, h, -z, x, h, z, -x, h, z,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3, // bottom (faces -y)
    4, 6, 5, 4, 7, 6, // top
    0, 4, 5, 0, 5, 1, // back (-z)
    3, 2, 6, 3, 6, 7, // front (+z)
    0, 3, 7, 0, 7, 4, // left (-x)
    1, 5, 6, 1, 6, 2, // right (+x)
  ];
  return { positions, indices };
}

/** A closed cylinder on y = 0 with flat caps. */
function cylinderMesh(radius: number, height: number, sides: number) {
  const positions: number[] = [0, 0, 0, 0, height, 0];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2;
    positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    positions.push(Math.cos(a) * radius, height, Math.sin(a) * radius);
  }
  const indices: number[] = [];
  for (let i = 0; i < sides; i += 1) {
    const b0 = 2 + i * 2;
    const t0 = b0 + 1;
    const b1 = 2 + ((i + 1) % sides) * 2;
    const t1 = b1 + 1;
    indices.push(0, b0, b1); // bottom
    indices.push(1, t1, t0); // top
    indices.push(b0, t0, t1, b0, t1, b1); // side
  }
  return { positions, indices };
}

const minY = (positions: Float32Array) => {
  let min = Infinity;
  for (let i = 1; i < positions.length; i += 3) min = Math.min(min, positions[i]);
  return min;
};

describe("surface texture engine", () => {
  it("test meshes face outward", () => {
    expect(meshVolume(weldTriangles(boxMesh(10, 10, 10).positions, boxMesh(10, 10, 10).indices))).toBeCloseTo(1000, 3);
    const cylinder = cylinderMesh(10, 20, 64);
    expect(meshVolume(weldTriangles(cylinder.positions, cylinder.indices))).toBeGreaterThan(0);
  });

  it("splits long edges and stays closed", () => {
    const box = weldTriangles(boxMesh(20, 10, 15).positions, boxMesh(20, 10, 15).indices);
    const refined = subdivideToEdgeLength(box, 1, 1_000_000);
    expect(refined.capped).toBe(false);
    expect(openEdgeCount(refined.indices)).toBe(0);
    expect(refined.parents.length).toBe(refined.indices.length / 3);
    for (let t = 0; t < refined.indices.length; t += 3) {
      for (let k = 0; k < 3; k += 1) {
        const a = refined.indices[t + k] * 3;
        const b = refined.indices[t + ((k + 1) % 3)] * 3;
        const length = Math.hypot(
          refined.positions[a] - refined.positions[b],
          refined.positions[a + 1] - refined.positions[b + 1],
          refined.positions[a + 2] - refined.positions[b + 2],
        );
        expect(length).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
    expect(meshVolume(refined)).toBeCloseTo(3000, 2);
  });

  it("stops splitting at the triangle cap", () => {
    const box = weldTriangles(boxMesh(20, 10, 15).positions, boxMesh(20, 10, 15).indices);
    const refined = subdivideToEdgeLength(box, 0.1, 5000);
    expect(refined.capped).toBe(true);
    expect(refined.indices.length / 3).toBeLessThanOrEqual(5000);
    expect(openEdgeCount(refined.indices)).toBe(0);
  });

  it("knurls a box, keeps it closed, and leaves the bottom flat on the bed", async () => {
    const result = await applySurfaceTexture(boxMesh(20, 12, 16), { pattern: "knurl", spacing: 3, depth: 0.5 });
    expect(result.stats.wrap).toBe("allRound");
    expect(openEdgeCount(result.indices)).toBe(0);
    expect(minY(result.positions)).toBeCloseTo(0, 5);
    // The texture is raised, so the part grows.
    expect(meshVolume(result)).toBeGreaterThan(20 * 12 * 16);
    // Every point at the bottom stays inside the original footprint.
    for (let i = 0; i < result.positions.length; i += 3) {
      if (result.positions[i + 1] < 1e-6) {
        expect(Math.abs(result.positions[i])).toBeLessThanOrEqual(10 + 1e-4);
        expect(Math.abs(result.positions[i + 2])).toBeLessThanOrEqual(8 + 1e-4);
      }
    }
  });

  it("cut-in texture keeps the part within its size", async () => {
    const result = await applySurfaceTexture(boxMesh(20, 12, 16), { pattern: "grooves", spacing: 2, depth: 0.4, direction: "in" });
    expect(openEdgeCount(result.indices)).toBe(0);
    expect(meshVolume(result)).toBeLessThan(20 * 12 * 16);
    for (let i = 0; i < result.positions.length; i += 3) {
      expect(Math.abs(result.positions[i])).toBeLessThanOrEqual(10 + 1e-3);
      expect(result.positions[i + 1]).toBeLessThanOrEqual(12 + 1e-3);
      expect(Math.abs(result.positions[i + 2])).toBeLessThanOrEqual(8 + 1e-3);
    }
  });

  it("wraps a round part with a whole number of repeats, so there is no seam", async () => {
    const result = await applySurfaceTexture(cylinderMesh(10, 20, 96), { pattern: "knurl", spacing: 3, depth: 0.4 });
    expect(result.stats.wrap).toBe("around");
    expect(Number.isInteger(result.stats.repeatsAround)).toBe(true);
    // Radius of the 96-sided walls is just under 10, so about 21 repeats of ~3 mm.
    expect(result.stats.repeatsAround).toBeGreaterThanOrEqual(20);
    expect(result.stats.repeatsAround).toBeLessThanOrEqual(22);
    expect(Math.abs((result.stats.spacingAround ?? 0) - 3)).toBeLessThan(0.15);
    expect(openEdgeCount(result.indices)).toBe(0);
    expect(minY(result.positions)).toBeCloseTo(0, 5);
  });

  it("gives every pattern a closed result", async () => {
    for (const pattern of ["honeycomb", "bumps", "fuzzy", "weave", "brick", "diamondPlate", "leather", "wood", "waves"] as const) {
      const result = await applySurfaceTexture(boxMesh(14, 10, 14), { pattern, depth: 0.4 });
      expect(openEdgeCount(result.indices), pattern).toBe(0);
      expect(Number.isFinite(meshVolume(result)), pattern).toBe(true);
    }
  });

  it("textures the bottom too when smooth bottom is off", async () => {
    const result = await applySurfaceTexture(boxMesh(10, 10, 10), {
      pattern: "bumps", spacing: 3, depth: 0.5, smoothBottomDeg: 0, direction: "in",
    });
    let below = 0;
    for (let i = 1; i < result.positions.length; i += 3) if (result.positions[i] > 1e-3 && result.positions[i] < 0.6) below += 1;
    expect(below).toBeGreaterThan(0);
  });

  it("trims to the triangle budget and stays closed", async () => {
    const result = await applySurfaceTexture(boxMesh(20, 12, 16), { pattern: "knurl", spacing: 3, depth: 0.5 }, { maxTriangles: 20_000 });
    expect(result.stats.triangles).toBeLessThanOrEqual(20_000);
    expect(openEdgeCount(result.indices)).toBe(0);
  });

  it("lowers the detail on a part too big for the working budget", async () => {
    const result = await applySurfaceTexture(boxMesh(200, 100, 200), { pattern: "fuzzy", spacing: 0.5 }, { workingTriangles: 50_000 });
    expect(result.stats.coarser).toBe(true);
    expect(openEdgeCount(result.indices)).toBe(0);
  });
});

describe("surface texture patterns", () => {
  it("stay between 0 and 1", () => {
    for (const [name, height] of Object.entries(PATTERN_HEIGHTS)) {
      for (let i = 0; i < 400; i += 1) {
        const u = (i * 0.137) % 7 - 3;
        const v = (i * 0.291) % 5 - 2;
        const h = height(u, v);
        expect(h, name).toBeGreaterThanOrEqual(0);
        expect(h, name).toBeLessThanOrEqual(1);
      }
    }
    for (let i = 0; i < 200; i += 1) {
      const h = fuzzyHeight(i * 0.31, i * 0.17, i * 0.07, 3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });

  it("repeat every whole step along u, so a wrap meets itself", () => {
    for (const [name, height] of Object.entries(PATTERN_HEIGHTS)) {
      for (const v of [0.13, 0.5, 1.77]) {
        expect(height(0.21, v), name).toBeCloseTo(height(5.21, v), 6);
      }
    }
  });

  it("knurl peaks inside a diamond and is 0 on its edges", () => {
    // The crest is rounded a little, as a real knurl wheel leaves it.
    expect(PATTERN_HEIGHTS.knurl(0.5, 0)).toBeGreaterThan(0.95);
    expect(PATTERN_HEIGHTS.knurl(0, 0)).toBeCloseTo(0, 6);
  });

  it("honeycomb is raised in a cell and low on the walls", () => {
    expect(PATTERN_HEIGHTS.honeycomb(0.5, Math.sqrt(3) / 2)).toBeCloseTo(1, 6);
    expect(PATTERN_HEIGHTS.honeycomb(1, Math.sqrt(3) / 2)).toBeLessThan(0.05);
  });
});

describe("surface texture settings", () => {
  it("fill gaps and clamp numbers from a file", () => {
    const texture = normalizeSurfaceTexture({ pattern: "honeycomb", depth: 99, spacing: Number.NaN, direction: "sideways" as never });
    expect(texture.pattern).toBe("honeycomb");
    expect(texture.depth).toBe(SURFACE_TEXTURE_LIMITS.depth.max);
    expect(texture.spacing).toBe(5);
    expect(texture.direction).toBe("out");
    expect(normalizeSurfaceTexture(null).pattern).toBe("knurl");
  });
});

describe("picture textures", () => {
  it("read a picture smoothly, wrap at its sides, and keep its shape", async () => {
    const { decodeTextureImage, encodeTextureImage, imageHeight } = await import("@/lib/texture/texturePatterns");
    // 4 × 2 pixels: the left half white, the right half black.
    const pixels = new Uint8Array([255, 255, 0, 0, 255, 255, 0, 0]);
    const image = { name: "Test", width: 4, height: 2, data: encodeTextureImage(pixels), invert: false };
    expect(normalizeSurfaceTexture({ pattern: "image", image }).image?.width).toBe(4);
    const height = imageHeight(decodeTextureImage(image));
    expect(height(0.25, 0.25)).toBeCloseTo(1, 6);
    expect(height(0.75, 0.25)).toBeCloseTo(0, 6);
    expect(height(0.25, 0.1)).toBeCloseTo(height(1.25, 0.1), 6);
    // One repeat is the picture's width; it is half as tall, so it repeats every half step up.
    expect(height(0.3, 0.1)).toBeCloseTo(height(0.3, 0.6), 6);
    expect(imageHeight(decodeTextureImage({ ...image, invert: true }))(0.25, 0.25)).toBeCloseTo(0, 6);
  });

  it("fall back to knurl when the picture is missing or broken", () => {
    expect(normalizeSurfaceTexture({ pattern: "image" }).pattern).toBe("knurl");
    expect(normalizeSurfaceTexture({ pattern: "image", image: { name: "x", width: 4, height: 2, data: "AAA", invert: false } }).pattern).toBe("knurl");
  });

  it("build a closed part from a picture", async () => {
    const { encodeTextureImage } = await import("@/lib/texture/texturePatterns");
    const pixels = new Uint8Array(16 * 16).map((_, i) => ((i % 16) < 8 ? 255 : 0));
    const image = { name: "Stripes", width: 16, height: 16, data: encodeTextureImage(pixels), invert: false };
    const result = await applySurfaceTexture(boxMesh(12, 10, 12), { pattern: "image", image, spacing: 6, depth: 0.4 });
    expect(openEdgeCount(result.indices)).toBe(0);
    expect(meshVolume(result)).toBeGreaterThan(12 * 10 * 12);
  });
});

describe("pictures read the right way round", () => {
  it("seen from outside every face, and around a round part", async () => {
    const { heightSampler } = await import("@/lib/texture/textureApply");
    const { encodeTextureImage } = await import("@/lib/texture/texturePatterns");
    // 16 × 16: brighter to the right, and brighter toward the top.
    const pixels = new Uint8Array(256).map((_, i) => (i % 16) * 8 + (15 - Math.floor(i / 16)) * 4);
    const image = { name: "Ramp", width: 16, height: 16, data: encodeTextureImage(pixels), invert: false };
    const texture = normalizeSurfaceTexture({ pattern: "image", image, spacing: 10 });
    const flat = heightSampler(texture, "allRound", [0, 0, 0], 1, 10);
    // For each face: its facing, a point on it, and which way is right and up for someone looking at it.
    const faces: { n: [number, number, number]; right: [number, number, number]; up: [number, number, number] }[] = [
      { n: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
      { n: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
      { n: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
      { n: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
      // From above, with the front of the part toward you.
      { n: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
    ];
    for (const face of faces) {
      // Both points sit inside one picture, away from its edges.
      const at = (r: number, u: number) => {
        const p = [0, 1, 2].map((k) => face.right[k] * r + face.up[k] * u + face.n[k] * 0.001);
        return flat(p[0], p[1], p[2], ...face.n);
      };
      expect(at(6, 3), `right on ${face.n}`).toBeGreaterThan(at(3, 3));
      expect(at(3, 6), `up on ${face.n}`).toBeGreaterThan(at(3, 3));
    }
    // Around a cylinder, seen from outside at +x: right is toward -z.
    const around = heightSampler(texture, "around", [0, 0, 0], 6, 10);
    const side = (angle: number, y: number) => around(10 * Math.cos(angle), y, 10 * Math.sin(angle), Math.cos(angle), 0, Math.sin(angle));
    expect(side(-0.5, 3)).toBeGreaterThan(side(-0.2, 3));
    expect(side(-0.3, 6)).toBeGreaterThan(side(-0.3, 3));
  });
});

describe("picture detail and placing a picture once", () => {
  const halves = async (width: number) => {
    const { encodeTextureImage } = await import("@/lib/texture/texturePatterns");
    // White on the left half, black on the right.
    const pixels = new Uint8Array(width * width).map((_, i) => ((i % width) < width / 2 ? 255 : 0));
    return { name: "Halves", width, height: width, data: encodeTextureImage(pixels), invert: false };
  };

  it("places a picture once, the right way round, and nowhere else", async () => {
    const image = await halves(32);
    const result = await applySurfaceTexture(boxMesh(12, 10, 12), {
      pattern: "image", image, placement: "once", spacing: 8, depth: 0.5,
      stamp: { point: [0, 5, 6], normal: [0, 0, 1] },
    });
    expect(openEdgeCount(result.indices)).toBe(0);
    let raised = 0;
    for (let i = 0; i < result.positions.length; i += 3) {
      const [x, y, z] = [result.positions[i], result.positions[i + 1], result.positions[i + 2]];
      // Nothing moves on any other face.
      expect(Math.abs(x)).toBeLessThanOrEqual(6 + 1e-4);
      expect(y).toBeLessThanOrEqual(10 + 1e-4);
      expect(z).toBeGreaterThanOrEqual(-6 - 1e-4);
      if (z > 6.25) {
        raised += 1;
        // Seen from the front, the white half is on the left, and all of it inside the 8 mm picture.
        expect(x).toBeLessThan(0.3);
        expect(x).toBeGreaterThan(-4.3);
        expect(Math.abs(y - 5)).toBeLessThan(4.3);
      }
    }
    expect(raised).toBeGreaterThan(50);
  });

  it("leaves the part as it is until the picture is placed", async () => {
    const image = await halves(16);
    const result = await applySurfaceTexture(boxMesh(10, 10, 10), { pattern: "image", image, placement: "once", spacing: 8 });
    for (let i = 0; i < result.positions.length; i += 3) {
      expect(Math.abs(result.positions[i])).toBeLessThanOrEqual(5 + 1e-4);
      expect(Math.abs(result.positions[i + 2])).toBeLessThanOrEqual(5 + 1e-4);
    }
  });

  it("traces a picture's edges down to about one pixel", async () => {
    const image = await halves(64);
    const result = await applySurfaceTexture(boxMesh(12, 10, 12), { pattern: "image", image, spacing: 6, depth: 0.4 });
    let shortest = Infinity;
    for (let t = 0; t < result.indices.length; t += 3) {
      for (let k = 0; k < 3; k += 1) {
        const a = result.indices[t + k] * 3;
        const b = result.indices[t + ((k + 1) % 3)] * 3;
        shortest = Math.min(shortest, Math.hypot(result.positions[a] - result.positions[b], result.positions[a + 1] - result.positions[b + 1], result.positions[a + 2] - result.positions[b + 2]));
      }
    }
    // One pixel is 6 / 64 ≈ 0.094 mm; the old limit was a sixteenth of the picture, 0.375 mm.
    expect(shortest).toBeLessThan(0.2);
  });

  it("builds finer at a finer detail level", async () => {
    const normal = await applySurfaceTexture(boxMesh(12, 10, 12), { pattern: "knurl", spacing: 3, depth: 0.5 });
    const finest = await applySurfaceTexture(boxMesh(12, 10, 12), { pattern: "knurl", spacing: 3, depth: 0.5, detail: "finest" });
    expect(finest.stats.triangles).toBeGreaterThan(normal.stats.triangles * 1.5);
    expect(openEdgeCount(finest.indices)).toBe(0);
  });
});
