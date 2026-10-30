import { describe, expect, it } from "vitest";
import { meshForShape } from "@/lib/editorShapeMesh";
import { defaultSurfaceTexture } from "@/lib/texture/surfaceTexture";
import { openEdgeCount } from "@/lib/texture/textureMesh";
import { ensureSurfaceTexture, printMeshForShape, surfaceTexturesReady } from "@/lib/texture/texturedShape";
import type { WorkplaneShape } from "@/types/sketchforge";

function part(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "part",
    name: "Part",
    kind: "box",
    color: "#d41721",
    x: 30,
    z: -12,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 12,
    rotation: 0,
    ...overrides,
  };
}

const faceList = (mesh: { faces: [number, number, number][] }) => mesh.faces.flat();

describe("textured parts", () => {
  it("export the textured triangles where the part stands, closed and on the bed", async () => {
    const shape = part({ surfaceTexture: defaultSurfaceTexture("knurl") });
    expect(await ensureSurfaceTexture(shape)).not.toBeNull();
    expect(surfaceTexturesReady([shape])).toBe(true);
    const mesh = printMeshForShape(shape);
    expect(mesh.faces.length).toBeGreaterThan(meshForShape(shape).faces.length * 10);
    expect(openEdgeCount(faceList(mesh))).toBe(0);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const v of mesh.vertices) {
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k], v[k]);
        max[k] = Math.max(max[k], v[k]);
      }
    }
    expect(min[1]).toBeCloseTo(0, 4);
    // Centred on the part, a little larger for the raised texture.
    expect((min[0] + max[0]) / 2).toBeCloseTo(30, 0);
    expect((min[2] + max[2]) / 2).toBeCloseTo(-12, 0);
    expect(max[0] - min[0]).toBeGreaterThan(20);
    expect(max[0] - min[0]).toBeLessThan(20 + 2 * 0.6 + 0.01);
  }, 30_000);

  it("reuse the texture when the part only moves", async () => {
    const shape = part({ surfaceTexture: defaultSurfaceTexture("grooves") });
    const first = await ensureSurfaceTexture(shape);
    const moved = await ensureSurfaceTexture({ ...shape, x: -40, z: 7 });
    expect(moved).toBe(first);
  });

  it("leave holes and untextured parts plain", async () => {
    const hole = part({ hole: true, surfaceTexture: defaultSurfaceTexture("knurl") });
    expect(await ensureSurfaceTexture(hole)).toBeNull();
    expect(printMeshForShape(hole).faces.length).toBe(meshForShape(hole).faces.length);
    expect(printMeshForShape(part()).faces.length).toBe(meshForShape(part()).faces.length);
  });
});

describe("texture face picks and printer advice", () => {
  it("keep a clicked face on the same face when the part is turned and mirrored", async () => {
    const { facePickFromWorld, facePickToPosed, partOrigin } = await import("@/lib/texture/textureFrame");
    const shape = part({ rotation: 30, rotationX: 15, mirrorX: true, width: 24 });
    const world: [number, number, number] = [33, 7, -10];
    const pick = facePickFromWorld(shape, world, [0, 0, 1]);
    const posed = facePickToPosed(shape, pick);
    const origin = partOrigin(shape);
    posed.point.forEach((value, axis) => expect(value).toBeCloseTo(world[axis] - origin[axis], 6));
    expect(posed.normal[2]).toBeCloseTo(1, 6);
    // Resizing scales the point with the part.
    const wider = facePickToPosed({ ...shape, rotation: 0, rotationX: 0, mirrorX: false, width: 48 }, { point: [0.5, 0, 0], normal: [1, 0, 0] });
    expect(wider.point[0]).toBeCloseTo(24, 6);
  });

  it("warn when a texture is finer than the nozzle and offer sizes that print", async () => {
    const { texturePrintAdvice } = await import("@/lib/texture/texturePrint");
    const fine = { ...defaultSurfaceTexture("knurl"), spacing: 0.8, depth: 0.1 };
    const advice = texturePrintAdvice(fine, { kind: "filament", nozzleMm: 0.4 });
    expect(advice.notes.length).toBe(2);
    expect(advice.fix).toEqual({ spacing: 1.6, depth: 0.2 });
    expect(texturePrintAdvice(defaultSurfaceTexture("knurl"), { kind: "filament", nozzleMm: 0.4 }).notes).toEqual([]);
    expect(texturePrintAdvice(fine, { kind: "resin", nozzleMm: 0.4 }).fix).toBeNull();
  });

  it("leave the face pressed against another part smooth", async () => {
    const { setSurfaceTextureScene } = await import("@/lib/texture/texturedShape");
    // A block standing against the +x side of the textured part (which ends at x = 40).
    const block = part({ id: "block", name: "Block", x: 50, height: 12 });
    const textured = part({ id: "textured", surfaceTexture: defaultSurfaceTexture("bumps") });
    const maxX = (shape: WorkplaneShape) => printMeshForShape(shape).vertices.reduce((max, vertex) => Math.max(max, vertex[0]), -Infinity);
    setSurfaceTextureScene([block, textured]);
    await ensureSurfaceTexture(textured);
    expect(maxX(textured)).toBeCloseTo(40, 4);
    // Moved away, the side gets its bumps.
    setSurfaceTextureScene([{ ...block, x: 80 }, textured]);
    await ensureSurfaceTexture(textured);
    expect(maxX(textured)).toBeGreaterThan(40.3);
    setSurfaceTextureScene([]);
  });
});

describe("placed pictures", () => {
  it("centre on the face they were placed on", async () => {
    const { centredStamp } = await import("@/lib/texture/texturedShape");
    const { facePickFromWorld, facePickToPosed } = await import("@/lib/texture/textureFrame");
    // The front face of a 20 × 12 × 20 box standing at (30, 0, -12) is at z = -2.
    const shape = part();
    const stamp = facePickFromWorld(shape, [36, 9, -2], [0, 0, 1]);
    const centred = centredStamp(shape, stamp, 0);
    expect(centred).not.toBeNull();
    const posed = facePickToPosed(shape, centred!);
    expect(posed.point[0]).toBeCloseTo(0, 4);
    expect(posed.point[1]).toBeCloseTo(0, 4);
    expect(posed.point[2]).toBeCloseTo(10, 4);
    expect(posed.normal[2]).toBeCloseTo(1, 4);
  });

  it("centre on the side of a cylinder, on its surface", async () => {
    const { centredStamp } = await import("@/lib/texture/texturedShape");
    const { facePickFromWorld, facePickToPosed } = await import("@/lib/texture/textureFrame");
    const shape = part({ kind: "cylinder", x: 0, z: 0, height: 20 });
    const stamp = facePickFromWorld(shape, [10 * Math.cos(-0.3), 15, 10 * Math.sin(-0.3)], [Math.cos(-0.3), 0, Math.sin(-0.3)]);
    const posed = facePickToPosed(shape, centredStamp(shape, stamp, 0)!);
    // Halfway up, and on the wall (a many-sided wall sits a hair inside the true circle).
    expect(posed.point[1]).toBeCloseTo(0, 3);
    expect(Math.hypot(posed.point[0], posed.point[2])).toBeGreaterThan(9.9);
    expect(Math.hypot(posed.point[0], posed.point[2])).toBeLessThan(10.01);
  });
});
