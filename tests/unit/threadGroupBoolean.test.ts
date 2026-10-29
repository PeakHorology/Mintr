import { createRequire } from "node:module";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { booleanMeshShape, shapeToManifoldSolid } from "@/lib/editorBoolean";
import { MAX_THREAD_SIDES, buildMetricThreadedCylinder, type ThreadMeshOptions } from "@/lib/metricThreadSolid";
import { resolveThreadParams } from "@/lib/metricThreads";
import { createThreadShape, solidThreadShape } from "@/lib/threadShape";
import { withHoleMode } from "@/lib/workplaneShapes";
import type { ManifoldSolid } from "@/components/SketchForgeEditor";
import type { WorkplaneShape } from "@/types/sketchforge";

async function loadManifold() {
  const manifoldMod = await import("manifold-3d");
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve("manifold-3d/manifold.wasm");
  const wasmBinary = fs.readFileSync(wasmPath);
  const runtime = await (manifoldMod.default as (cfg: { wasmBinary: Uint8Array }) => Promise<ManifoldToplevel>)({
    wasmBinary,
  });
  runtime.setup();
  return runtime;
}

function headedScrew(hole: boolean, sides = 96, head: "cylinder" | "hex" | "countersunk" = "cylinder"): WorkplaneShape {
  const shape = createThreadShape({
    designation: "M6",
    base: {
      id: "thread-1",
      name: "Screw",
      color: "#d97813",
      height: 20,
      sides,
      threadSpec: {
        designation: "M6",
        majorDiameter: 6,
        pitch: 1,
        role: "screw",
        head,
        part: "screw",
        style: "screw",
      },
    },
  });
  return hole ? withHoleMode(shape, true) : shape;
}

function boxShape(): WorkplaneShape {
  return {
    id: "box-1",
    name: "Box",
    kind: "box",
    color: "#d41721",
    x: 0,
    z: 0,
    elevation: 0,
    size: 30,
    width: 30,
    depth: 30,
    height: 30,
    rotation: 0,
    locked: false,
    hidden: false,
  };
}

describe("thread group boolean", () => {
  it("stores a headed screw as the same solid Group cuts", async () => {
    const screw = headedScrew(true);
    expect(screw.sides).toBeLessThanOrEqual(MAX_THREAD_SIDES);
    expect(screw.importedMesh?.triangleCount).toBeGreaterThan(100);
    let headClearsTheShank = false;
    const positions = screw.importedMesh?.positions ?? [];
    const shank = screw.threadSpec?.length ?? 20;
    for (let index = 0; index + 2 < positions.length; index += 3) {
      const y = positions[index + 1];
      if (y > shank && Math.hypot(positions[index], positions[index + 2]) > 4) headClearsTheShank = true;
    }
    expect(headClearsTheShank).toBe(true);

    const started = performance.now();
    expect(booleanMeshShape([boxShape(), screw])).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);

    const runtime = await loadManifold();
    const created: ManifoldSolid[] = [];
    const cutter = shapeToManifoldSolid(runtime, screw, created);
    const block = shapeToManifoldSolid(runtime, boxShape(), created);
    expect(cutter?.status()).toBe("NoError");
    expect(block).not.toBeNull();
    const cutStarted = performance.now();
    const cut = block!.subtract(cutter!);
    created.push(cut);
    expect(cut.status()).toBe("NoError");
    expect(cut.numTri()).toBeGreaterThan(100);
    expect(performance.now() - cutStarted).toBeLessThan(1000);
    created.forEach((solid) => solid.delete?.());
  });

  it("keeps hex and countersunk screws as one solid, and stops the sides control past that", async () => {
    const runtime = await loadManifold();
    for (const head of ["hex", "countersunk"] as const) {
      const created: ManifoldSolid[] = [];
      const solid = shapeToManifoldSolid(runtime, headedScrew(true, 96, head), created);
      expect(solid?.status()).toBe("NoError");
      created.forEach((entry) => entry.delete?.());
    }

    const overDetailed = headedScrew(false, 256);
    expect(overDetailed.sides).toBe(MAX_THREAD_SIDES);
    const upgraded = solidThreadShape({ ...headedScrew(true, 96), sides: 256, name: "Kept name" });
    expect(upgraded.sides).toBe(MAX_THREAD_SIDES);
    expect(upgraded.hole).toBe(true);
    expect(upgraded.name).toBe("Kept name");
    expect(upgraded.id).toBe("thread-1");
  });

  it("builds every kind of thread as one closed solid facing outward", async () => {
    const runtime = await loadManifold();
    const cases: Array<[string, number, number, number, ThreadMeshOptions, number]> = [
      ["rod M1", 1, 0.25, 4, { role: "rod", chamfer: 0.1 }, 0],
      ["rod M3", 3, 0.5, 20, { role: "rod", chamfer: 0.3 }, 0],
      ["rod M6 left", 6, 1, 20, { role: "rod", chamfer: 0.3 }, 0],
      ["rod M10 long", 10, 1.5, 80, { role: "rod", chamfer: 0.5 }, 0],
      ["screw cylinder", 3, 0.5, 10, { role: "screw", head: "cylinder", chamfer: 0.3 }, 0],
      ["screw hex", 3, 0.5, 10, { role: "screw", head: "hex", chamfer: 0.3 }, 0],
      ["screw countersunk", 3, 0.5, 10, { role: "screw", head: "countersunk", chamfer: 0.3 }, 0],
      ["nut M3", 3, 0.5, 2.4, { role: "nut", clearance: 0.2, chamfer: 0.3 }, 1],
      ["nut M6 plain", 6, 1, 4.8, { role: "nut", clearance: 0.2 }, 1],
      ["tapped hole M3", 3, 0.5, 5, { role: "bore", part: "threads", clearance: 0.2, chamfer: 0.3 }, 0],
      ["shaft", 6, 1, 20, { part: "shaft", chamfer: 0.3 }, 0],
      ["trapezoid", 12, 3, 20, { role: "rod", profile: "trapezoid" }, 0],
      ["whitworth", 12, 1.8, 20, { role: "rod", profile: "whitworth" }, 0],
      ["round", 12, 2, 20, { role: "rod", profile: "round" }, 0],
      ["low sides", 6, 1, 10, { role: "rod", sides: 8 }, 0],
    ];
    for (const [name, diameter, pitch, length, options, genus] of cases) {
      const params = resolveThreadParams({
        majorDiameter: diameter,
        pitch,
        length,
        side: options.role === "nut" || options.role === "bore" ? "internal" : "external",
        handedness: name.includes("left") ? "left" : "right",
      });
      const mesh = buildMetricThreadedCylinder(params, length, options);
      let signed = 0;
      const p = mesh.positions;
      for (let i = 0; i < p.length; i += 9) {
        signed += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7])
          - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6])
          + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
      }
      expect(signed, name).toBeGreaterThan(0);
      const solid = new runtime.Mesh({ numProp: 3, vertProperties: p, triVerts: mesh.indices });
      solid.merge();
      const manifold = runtime.Manifold.ofMesh(solid);
      expect(manifold.status(), name).toBe("NoError");
      expect(manifold.genus(), name).toBe(genus);
      const pieces = manifold.decompose();
      expect(pieces.length, name).toBe(1);
      pieces.forEach((piece) => piece.delete());
      expect(manifold.volume() / signed, name).toBeCloseTo(1, 3);
      manifold.delete();
    }
  });

  it("cuts a tapped hole that is empty in the middle, and joins a rod that adds to the block", async () => {
    const runtime = await loadManifold();
    const created: ManifoldSolid[] = [];
    const block = shapeToManifoldSolid(runtime, boxShape(), created)!;
    const tapped = createThreadShape({
      designation: "M6",
      height: 20,
      base: {
        id: "tap",
        name: "Tapped hole",
        color: "#b8c2cc",
        height: 20,
        threadSpec: { designation: "M6", majorDiameter: 6, pitch: 1, role: "bore", style: "hole", part: "threads", clearance: 0.2 },
      },
    });
    const cutter = shapeToManifoldSolid(runtime, tapped, created)!;
    expect(cutter.status()).toBe("NoError");
    const cut = block.subtract(cutter);
    created.push(cut);
    expect(cut.volume()).toBeLessThan(block.volume() - cutter.volume() * 0.99);
    expect(cut.volume()).toBeGreaterThan(block.volume() - cutter.volume() * 1.01);
    // Nothing is left inside the hole's root circle.
    const core = runtime.Manifold.cylinder(18, 2.2, 2.2, 48).rotate([-90, 0, 0]).translate([0, 1, 0]);
    created.push(core);
    const left = cut.intersect(core);
    created.push(left);
    expect(left.volume()).toBeLessThan(0.01);
    // And the hole still has material in its teeth for the screw to grip.
    const teeth = runtime.Manifold.cylinder(18, 3, 3, 96).rotate([-90, 0, 0]).translate([0, 1, 0]);
    created.push(teeth);
    const grip = cut.intersect(teeth);
    created.push(grip);
    expect(grip.volume()).toBeGreaterThan(20);

    const rod = shapeToManifoldSolid(runtime, createThreadShape({ designation: "M6", height: 20, point: { x: 0, z: 0, elevation: 25 } }), created)!;
    const joined = block.add(rod);
    created.push(joined);
    expect(joined.volume()).toBeGreaterThan(block.volume() + 100);
    created.forEach((solid) => solid.delete?.());
  });
});
