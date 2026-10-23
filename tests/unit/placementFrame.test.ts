import { describe, expect, it } from "vitest";
import { dropPatchOntoFrame, dropSurfaceY } from "@/lib/placementFrame";

describe("dropPatchOntoFrame", () => {
  it("drops a shape so its mesh bottom sits on Y=0", () => {
    const patch = dropPatchOntoFrame(
      { x: 4, z: -2, elevation: 20 },
      { minX: 0, maxX: 8, minY: 20, maxY: 30, minZ: -6, maxZ: 2 },
    );
    expect(patch).toEqual({ elevation: 0 });
  });

  it("lifts a lower shape onto a higher face", () => {
    const patch = dropPatchOntoFrame(
      { x: 4, z: -2, elevation: 0 },
      { minX: 0, maxX: 8, minY: 0, maxY: 10, minZ: -6, maxZ: 2 },
      12,
    );
    expect(patch).toEqual({ elevation: 12 });
  });

  it("slides onto a clicked face without turning", () => {
    const patch = dropPatchOntoFrame(
      { x: 4, z: -2, elevation: 0 },
      { minX: 0, maxX: 8, minY: 0, maxY: 10, minZ: -6, maxZ: 2 },
      12,
      { x: 10, z: 6 },
    );
    expect(patch).toEqual({ x: 14, z: 4, elevation: 12 });
  });
});

describe("dropSurfaceY", () => {
  it("uses the hit height on an upward face and rejects a wall", () => {
    expect(dropSurfaceY([0, 1, 0], [3, 18, -4])).toBe(18);
    expect(dropSurfaceY([1, 0, 0], [3, 18, -4])).toBeNull();
    expect(dropSurfaceY([0, -1, 0], [3, 18, -4])).toBeNull();
  });
});
