import { describe, expect, it } from "vitest";
import { toNativeKernelSolid, toNativeKernelSolids } from "@/lib/nativeKernelProtocol";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(id: string, x = 0): WorkplaneShape {
  return {
    id,
    name: id,
    kind: "box",
    color: "#d41721",
    x,
    z: 0,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
  };
}

describe("native kernel protocol", () => {
  it("encodes exact boxes for the sidecar", () => {
    const encoded = toNativeKernelSolid(box("a", 10));
    expect(encoded).toMatchObject({ kind: "box", width: 20, height: 20, depth: 20, x: 10, hole: false });
  });

  it("encodes elliptical cylinders for the sidecar", () => {
    expect(toNativeKernelSolid({ ...box("c"), kind: "cylinder", width: 20, depth: 10 })).toMatchObject({
      kind: "cylinder",
      width: 20,
      depth: 10,
    });
  });

  it("encodes every exact native kind", () => {
    const kinds = [
      "box", "cylinder", "sphere", "cone", "pyramid", "wedge", "roof", "roundRoof",
      "halfSphere", "torus", "tube", "ring", "polygon", "gear",
    ] as const;
    for (const kind of kinds) {
      expect(toNativeKernelSolid({ ...box(kind), kind, width: 24, depth: 12, height: 16 })).toMatchObject({ kind });
    }
  });

  it("prefers stored STEP over the primitive kind", () => {
    const shape = {
      ...box("s"),
      importedMesh: {
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        triangleCount: 1,
        sourceFormat: "step" as const,
        brepStep: "ISO-10303-21;",
      },
    };
    expect(toNativeKernelSolid(shape)?.kind).toBe("step");
    expect(toNativeKernelSolid(shape)?.brepStep).toContain("ISO-10303");
  });

  it("falls back when a body cannot be expressed natively", () => {
    expect(toNativeKernelSolids([{ ...box("t"), kind: "text" }])).toBeNull();
  });

  it("flattens grouped children into world-space native solids", () => {
    const group: WorkplaneShape = {
      ...box("group"),
      kind: "mesh",
      x: 40,
      z: 10,
      elevation: 5,
      rotation: 90,
      groupedShapes: [box("a", -10), { ...box("b", 10), hole: true }],
    };
    const solids = toNativeKernelSolids([group]);
    expect(solids).toHaveLength(2);
    expect(solids?.[0]).toMatchObject({ kind: "box", hole: false, x: 40, z: 0, elevation: 5 });
    expect(solids?.[1]).toMatchObject({ kind: "box", hole: true, x: 40, z: 20, elevation: 5 });
  });
});
