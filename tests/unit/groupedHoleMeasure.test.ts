import { describe, expect, it } from "vitest";
import { viewportGroupChildren } from "@/lib/csgTree";
import { drawnAssemblyHalfExtents, groupedShape } from "@/lib/editorGroup";
import type { WorkplaneShape } from "@/types/sketchforge";

function hole(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "hole",
    name: "Hole",
    kind: "cylinder",
    color: "#b8c2cc",
    x: 0,
    z: 0,
    size: 6,
    width: 6,
    depth: 6,
    height: 8,
    elevation: 0,
    rotation: 0,
    hole: true,
    ...overrides,
  };
}

describe("grouped hole measurement", () => {
  it("measures two holes at their real height", () => {
    const group = groupedShape([
      hole({ id: "a", x: -8 }),
      hole({ id: "b", x: 8 }),
    ]);
    expect(group).toBeTruthy();
    const extents = drawnAssemblyHalfExtents(group!, viewportGroupChildren(group!));
    expect(group!.height).toBeCloseTo(8, 2);
    expect(extents.y * 2).toBeCloseTo(8, 2);
  });

  it("uses the taller hole when the two heights differ", () => {
    const group = groupedShape([
      hole({ id: "a", x: -8, height: 5 }),
      hole({ id: "b", x: 8, height: 12 }),
    ]);
    expect(group).toBeTruthy();
    const extents = drawnAssemblyHalfExtents(group!, viewportGroupChildren(group!));
    expect(extents.y * 2).toBeCloseTo(group!.height, 2);
    expect(extents.y * 2).toBeCloseTo(12, 2);
  });

  it("keeps a solid and a hole as separate children of an assembly", () => {
    const group = groupedShape([
      hole({ id: "solid", name: "Block", hole: false, kind: "box", width: 20, depth: 20, size: 20 }),
      hole({ id: "cutter", name: "Bore", x: 4 }),
    ]);
    expect(group?.csg?.op).toBe("assemble");
    expect(group?.importedMesh).toBeUndefined();
    expect(viewportGroupChildren(group!).map((child) => child.name)).toEqual(["Block", "Bore"]);
  });
});
