import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { OcctKernel } from "occt-wasm";
import { curvedDisplayTessellation } from "@/lib/displayTessellation";

const occtDir = join(process.cwd(), "node_modules", "occt-wasm", "dist");
const { OcctKernel } = await import(pathToFileURL(join(occtDir, "index.js")).href);
const kernel: OcctKernel = await OcctKernel.init({ wasm: join(occtDir, "occt-wasm.wasm") });

function rimSteps(positions: Float32Array, minRadius: number) {
  let best = 0;
  for (const axis of [0, 1, 2] as const) {
    const bins = new Set<number>();
    for (let index = 0; index < positions.length; index += 3) {
      const point = [positions[index], positions[index + 1], positions[index + 2]];
      const radius = Math.hypot(point[(axis + 1) % 3], point[(axis + 2) % 3]);
      if (radius < minRadius) continue;
      const turn = Math.atan2(point[(axis + 2) % 3], point[(axis + 1) % 3]) / (Math.PI * 2);
      bins.add(Math.round(turn * 192));
    }
    best = Math.max(best, bins.size);
  }
  return best;
}

describe("curved fillet display mesh", () => {
  it("keeps a filleted cylinder as round as the smooth viewport", () => {
    const cylinder = kernel.makeCylinder(10, 30);
    const edges = kernel.getSubShapes(cylinder, "edge");
    const top = edges
      .map((edge) => ({ edge, box: kernel.getBoundingBox(edge, false) }))
      .sort((a, b) => b.box.zmax - a.box.zmax)[0];
    const filleted = kernel.fillet(cylinder, [top.edge], 2);
    const smoothOptions = curvedDisplayTessellation(2, 192);
    const smooth = kernel.tessellate(kernel.copy(filleted), smoothOptions);
    const fast = kernel.tessellate(kernel.copy(filleted), { linearDeflection: Math.max(0.16, 2 / 4), angularDeflection: 0.32 });
    const smoothSteps = rimSteps(smooth.positions, 8);
    const fastSteps = rimSteps(fast.positions, 8);
    expect(smoothSteps).toBeGreaterThan(fastSteps + 40);
    kernel.release(cylinder);
    kernel.release(filleted);
  });
});
