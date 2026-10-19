import { createRequire } from "node:module";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { booleanMeshShape, shapeToManifoldSolid } from "@/lib/editorBoolean";
import { MAX_THREAD_SIDES } from "@/lib/metricThreadSolid";
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
});
