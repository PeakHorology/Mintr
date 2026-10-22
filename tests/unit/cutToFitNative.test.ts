import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(): WorkplaneShape {
  return {
    id: "box-1",
    name: "Block",
    kind: "box",
    color: "#336699",
    x: 0,
    z: 0,
    elevation: 0,
    size: 40,
    width: 40,
    depth: 40,
    height: 40,
    rotation: 0,
    locked: false,
    hidden: false,
  };
}

describe("native cut to fit", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("builds two STEP parts from a MintrKernel split reply", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      parts: [
        {
          name: "Left",
          positions: [0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 0, 0, 4, 0, 0, 4, 4],
          brepStep: "ISO-10303-21;LEFT",
          x: -10,
          z: 0,
          elevation: 0,
          width: 20,
          height: 40,
          depth: 40,
        },
        {
          name: "Right",
          positions: [0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 0, 0, 4, 0, 0, 4, 4],
          brepStep: "ISO-10303-21;RIGHT",
          x: 10,
          z: 0,
          elevation: 0,
          width: 20,
          height: 40,
          depth: 40,
        },
      ],
    }));
    vi.stubGlobal("window", { peakcadKernel: { request } });
    const { cutShapeToFitBest } = await import("@/lib/cutToFit");
    const parts = await cutShapeToFitBest(box(), { axis: "x", offset: 0, joint: "none", clearance: 0.2 });
    expect(request).toHaveBeenCalled();
    expect(parts).toHaveLength(2);
    expect(parts[0].importedMesh?.brepStep).toContain("LEFT");
    expect(parts[1].importedMesh?.brepStep).toContain("RIGHT");
    expect(parts[0].x).toBeLessThan(parts[1].x);
  });
});
