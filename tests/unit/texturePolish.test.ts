import { describe, expect, it } from "vitest";
import { applySurfaceTexture } from "@/lib/texture/textureApply";
import { applySavedTexture, suggestedTextureName } from "@/lib/texture/savedTextures";
import { defaultSurfaceTexture, normalizeSurfaceTexture } from "@/lib/texture/surfaceTexture";
import { facePickFromWorld } from "@/lib/texture/textureFrame";
import { encodeTextureImage } from "@/lib/texture/texturePatterns";
import { fileSizeLabel, textureFileSize } from "@/lib/texture/texturePrint";
import { pointOnStamp, stampSurface, textureFaceOf, textureRegionTriangles } from "@/lib/texture/texturedShape";
import type { WorkplaneShape } from "@/types/sketchforge";

function boxMesh(w: number, h: number, d: number) {
  const x = w / 2;
  const z = d / 2;
  return {
    positions: [-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z, -x, h, -z, x, h, -z, x, h, z, -x, h, z],
    indices: [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2],
  };
}

function part(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "part", name: "Part", kind: "box", color: "#d41721",
    x: 30, z: -12, elevation: 0, size: 20, width: 20, depth: 20, height: 12, rotation: 0,
    ...overrides,
  };
}

const picture = (width: number, height: number) => ({
  name: "Logo", width, height, data: encodeTextureImage(new Uint8Array(width * height).fill(255)), invert: false,
});

describe("texture polish", () => {
  it("reports its progress in order, ending at the finish", async () => {
    const shares: number[] = [];
    await applySurfaceTexture(boxMesh(10, 10, 10), { pattern: "bumps", spacing: 3, depth: 0.4 }, { onProgress: (share) => shares.push(share) });
    expect(shares.length).toBeGreaterThan(3);
    for (let i = 1; i < shares.length; i += 1) expect(shares[i]).toBeGreaterThan(shares[i - 1]);
    expect(shares[shares.length - 1]).toBe(1);
  });

  it("keeps where every point sat before it moved, so the texture can rise into place", async () => {
    const result = await applySurfaceTexture(boxMesh(10, 10, 10), { pattern: "knurl", spacing: 2, depth: 0.5 });
    expect(result.basePositions.length).toBe(result.positions.length);
    let moved = 0;
    let furthest = 0;
    for (let i = 0; i < result.positions.length; i += 3) {
      const d = Math.hypot(
        result.positions[i] - result.basePositions[i],
        result.positions[i + 1] - result.basePositions[i + 1],
        result.positions[i + 2] - result.basePositions[i + 2],
      );
      if (d > 1e-4) moved += 1;
      furthest = Math.max(furthest, d);
    }
    expect(moved).toBeGreaterThan(result.positions.length / 30);
    // A raised texture moves a point by at most its depth, a little more at a corner.
    expect(furthest).toBeLessThan(0.5 * 2.1);
  });

  it("keeps typed text with its picture, and lets text be wider than a picture", () => {
    const texture = normalizeSurfaceTexture({
      pattern: "image",
      image: { ...picture(512, 64), text: { value: "MINTR", font: "Sans" } },
    });
    expect(texture.pattern).toBe("image");
    expect(texture.image?.text).toEqual({ value: "MINTR", font: "Sans" });
    expect(normalizeSurfaceTexture({ pattern: "image", image: picture(513, 4) }).pattern).toBe("knurl");
  });

  it("estimates the export size and says when it is a lot", () => {
    const small = textureFileSize(100_000);
    expect(small.large).toBe(false);
    expect(small.text).toBe("about 5 MB as STL, 1 MB as 3MF");
    expect(textureFileSize(2_000_000, { detail: "fine" }).fix).toMatch(/Normal detail/);
    expect(textureFileSize(2_000_000, { detail: "normal" }).fix).toMatch(/larger pattern/);
    expect(fileSizeLabel(300 * 1024)).toBe("300 KB");
  });

  it("outlines a chosen face, lifted off it", () => {
    const shape = part();
    const top = textureFaceOf(shape, facePickFromWorld(shape, [30, 12, -12], [0, 1, 0]));
    expect(top).not.toBeNull();
    const triangles = textureRegionTriangles(shape, [top!], 0.5);
    expect(triangles.length).toBe(2 * 9);
    for (let i = 1; i < triangles.length; i += 3) expect(triangles[i]).toBeCloseTo(12.5, 4);
  });

  it("knows when the mouse is over the placed picture", () => {
    const shape = part();
    const texture = normalizeSurfaceTexture({
      pattern: "image",
      image: picture(32, 16),
      placement: "once",
      spacing: 8,
      stamp: facePickFromWorld(shape, [30, 6, -2], [0, 0, 1]),
    });
    expect(pointOnStamp(shape, texture, [30, 6, -2])).toBe(true);
    expect(pointOnStamp(shape, texture, [33.5, 7.5, -2])).toBe(true);
    // The picture is 8 mm wide and 4 mm tall.
    expect(pointOnStamp(shape, texture, [30, 8.5, -2])).toBe(false);
    expect(pointOnStamp(shape, texture, [35, 6, -2])).toBe(false);
  });

  it("puts a saved texture on another part, keeping where its picture sits", () => {
    const saved = normalizeSurfaceTexture({ ...defaultSurfaceTexture("leather"), spacing: 9 });
    const stamp = { point: [0, 0.1, 0.5] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
    const current = normalizeSurfaceTexture({ pattern: "image", image: picture(4, 4), placement: "once", stamp });
    expect(applySavedTexture(saved, current).spacing).toBe(9);
    expect(applySavedTexture(normalizeSurfaceTexture({ pattern: "image", image: picture(4, 4), placement: "once" }), current).stamp).toEqual(stamp);
    expect(suggestedTextureName(saved)).toBe("Leather 9 mm");
  });

  it("lays a picture preview on the part, stopping where the part does", () => {
    const shape = part();
    // A 16 mm picture near the corner of the 20 mm front face (x 20 to 40, y 0 to 12).
    const texture = normalizeSurfaceTexture({ pattern: "image", image: picture(32, 32), placement: "once", spacing: 16 });
    const surface = stampSurface(shape, texture, [38, 10, -2], [0, 0, 1], 0.1);
    expect(surface).not.toBeNull();
    for (let i = 0; i < surface!.positions.length; i += 3) {
      expect(surface!.positions[i]).toBeLessThanOrEqual(40 + 1e-6);
      expect(surface!.positions[i + 1]).toBeLessThanOrEqual(12 + 1e-6);
      expect(surface!.positions[i + 2]).toBeCloseTo(-1.9, 4);
    }
    // The picture runs past the corner, so the part's edge falls inside it.
    const us = Array.from(surface!.uvs.filter((_, i) => i % 2 === 0));
    expect(Math.min(...us)).toBeLessThan(0);
  });
});
