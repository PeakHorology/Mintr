import { createRequire } from "node:module";
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel, Vec2 } from "manifold-3d";
import type { MeshData } from "@/lib/editorShapeMesh";
import { interlockingSlices, layerCount, slicePositions, stackedLayers, suggestedSlices, type FlatPart } from "@/lib/laser/flatParts";

let runtime: ManifoldToplevel;

beforeAll(async () => {
  const manifoldMod = await import("manifold-3d");
  const require = createRequire(import.meta.url);
  const wasmBinary = fs.readFileSync(require.resolve("manifold-3d/manifold.wasm"));
  runtime = await (manifoldMod.default as (cfg: { wasmBinary: Uint8Array }) => Promise<ManifoldToplevel>)({ wasmBinary });
  runtime.setup();
});

/** A world-space mesh, y up, from a Manifold solid built z up. */
function meshOf(solid: ReturnType<ManifoldToplevel["Manifold"]["cube"]>): MeshData {
  const turned = solid.rotate([-90, 0, 0]);
  const mesh = turned.getMesh();
  const vertices: [number, number, number][] = [];
  for (let i = 0; i < mesh.numVert; i += 1) {
    vertices.push([mesh.vertProperties[i * mesh.numProp], mesh.vertProperties[i * mesh.numProp + 1], mesh.vertProperties[i * mesh.numProp + 2]]);
  }
  const faces: [number, number, number][] = [];
  for (let i = 0; i < mesh.triVerts.length; i += 3) faces.push([mesh.triVerts[i], mesh.triVerts[i + 1], mesh.triVerts[i + 2]]);
  turned.delete();
  solid.delete();
  return { name: "Part", vertices, faces };
}

function partArea(part: FlatPart) {
  // Outlines run one way and holes the other, so the signed areas add up to the material.
  let total = 0;
  for (const points of part.polygons) {
    let sum = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) sum += points[j][0] * points[i][1] - points[i][0] * points[j][1];
    total += sum / 2;
  }
  return Math.abs(total);
}

function inside(part: FlatPart, u: number, v: number) {
  let hit = false;
  for (const outline of part.polygons) {
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i += 1) {
      const [xi, yi] = outline[i] as Vec2;
      const [xj, yj] = outline[j] as Vec2;
      if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

describe("flat parts from a 3D part", () => {
  it("stacks a block into layers a sheet thick", () => {
    const parts = stackedLayers(runtime, meshOf(runtime.Manifold.cube([30, 20, 12])), 3);
    expect(parts.map((part) => part.name)).toEqual(["Layer 1", "Layer 2", "Layer 3", "Layer 4"]);
    for (const part of parts) {
      expect(part.width).toBeCloseTo(30, 3);
      expect(part.height).toBeCloseTo(20, 3);
      expect(partArea(part)).toBeCloseTo(600, 1);
    }
  });

  it("follows the shape up a cone, with holes kept", () => {
    const cone = runtime.Manifold.cylinder(30, 20, 5, 64);
    const parts = stackedLayers(runtime, meshOf(cone), 3);
    expect(parts).toHaveLength(layerCount(30, 3));
    const widths = parts.map((part) => part.width);
    expect(widths[0]).toBeGreaterThan(widths[widths.length - 1]);
    const ring = runtime.Manifold.cylinder(6, 20, 20, 64).subtract(runtime.Manifold.cylinder(6, 8, 8, 64));
    const [layer] = stackedLayers(runtime, meshOf(ring), 6);
    expect(layer.polygons).toHaveLength(2);
    expect(partArea(layer)).toBeCloseTo(Math.PI * (400 - 64), -1);
  });

  it("slots interlocking slices so they fill each crossing once", () => {
    const t = 3;
    // World x 0..40, z -30..0, y 0..20.
    const parts = interlockingSlices(runtime, meshOf(runtime.Manifold.cube([40, 30, 20])), { thickness: t, across: 2, along: 2 });
    const acrossParts = parts.filter((part) => part.name.startsWith("Across"));
    const alongParts = parts.filter((part) => part.name.startsWith("Along"));
    expect(acrossParts).toHaveLength(2);
    expect(alongParts).toHaveLength(2);
    // Each slice loses two half-height slots, a sheet wide.
    for (const part of acrossParts) expect(partArea(part)).toBeCloseTo(30 * 20 - 2 * t * 10, 1);
    for (const part of alongParts) expect(partArea(part)).toBeCloseTo(40 * 20 - 2 * t * 10, 1);
    const xs = slicePositions(0, 40, 2);
    const zs = slicePositions(-30, 0, 2);
    let wrong = 0;
    for (const x of xs) {
      for (const z of zs) {
        for (let dx = -1.3; dx <= 1.3; dx += 0.65) {
          for (let dz = -1.3; dz <= 1.3; dz += 0.65) {
            for (let y = 0.27; y < 20; y += 0.5) {
              let count = 0;
              acrossParts.forEach((part, i) => {
                if (Math.abs(x + dx - xs[i]) < t / 2 && inside(part, -(z + dz), y)) count += 1;
              });
              alongParts.forEach((part, j) => {
                if (Math.abs(z + dz - zs[j]) < t / 2 && inside(part, x + dx, y)) count += 1;
              });
              if (count !== 1) wrong += 1;
            }
          }
        }
      }
    }
    expect(wrong).toBe(0);
  });

  it("suggests a few slices a side, more on the longer side", () => {
    expect(suggestedSlices(120, 120, 3)).toBe(6);
    expect(suggestedSlices(60, 120, 3)).toBe(3);
    expect(suggestedSlices(10, 10, 3)).toBe(2);
  });
});
