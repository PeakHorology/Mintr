import { describe, expect, it } from "vitest";
import { booleanMeshShape, prepareBooleanOperands, punchThroughCutter } from "@/lib/editorBoolean";
import { meshForShape, type MeshData } from "@/lib/editorShapeMesh";
import type { WorkplaneShape } from "@/types/sketchforge";

function shape(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "s1",
    name: "Shape",
    kind: "cylinder",
    color: "#d97813",
    x: 0,
    z: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 8,
    elevation: 0,
    rotation: 0,
    ...overrides,
  };
}

function span(mesh: MeshData, axis: 0 | 1 | 2) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const vertex of mesh.vertices) {
    const value = vertex[axis];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/** Triangles sitting in the bore, away from the wall and the end caps. */
function deepBoreTriangles(mesh: MeshData, hole: WorkplaneShape) {
  const radius = (hole.width ?? hole.size) / 2;
  const minY = (hole.elevation ?? 0) + 0.4;
  const maxY = (hole.elevation ?? 0) + hole.height - 0.4;
  let count = 0;
  for (const [ai, bi, ci] of mesh.faces) {
    const a = mesh.vertices[ai];
    const b = mesh.vertices[bi];
    const c = mesh.vertices[ci];
    const x = (a[0] + b[0] + c[0]) / 3;
    const y = (a[1] + b[1] + c[1]) / 3;
    const z = (a[2] + b[2] + c[2]) / 3;
    if (y <= minY || y >= maxY) continue;
    const dx = x - hole.x;
    const dz = z - hole.z;
    if (dx * dx + dz * dz < (radius * 0.45) ** 2) count += 1;
  }
  return count;
}

describe("punchThroughCutter", () => {
  it("extends a hole whose ends sit on the solid, without widening it", () => {
    const solid = shape({ id: "solid", hole: false });
    const hole = shape({ id: "hole", hole: true, width: 8, depth: 8, size: 8 });
    const punched = punchThroughCutter(hole, [solid]);
    const mesh = meshForShape(punched);
    const y = span(mesh, 1);
    expect(y.min).toBeLessThan(-0.2);
    expect(y.max).toBeGreaterThan(solid.height + 0.2);
    expect(punched.width).toBe(8);
    expect(punched.depth).toBe(8);
  });

  it("leaves a shorter blind hole short of the far face", () => {
    const solid = shape({ id: "solid", kind: "box" });
    const hole = shape({ id: "hole", hole: true, kind: "box", width: 4, depth: 4, size: 4, height: 3 });
    const punched = punchThroughCutter(hole, [solid]);
    const y = span(meshForShape(punched), 1);
    expect(y.min).toBeLessThan(-0.2);
    expect(y.max).toBeCloseTo(3, 1);
  });

  it("does not extend a hole that already clears both faces", () => {
    const solid = shape({ id: "solid" });
    const hole = shape({ id: "hole", hole: true, width: 6, depth: 6, size: 6, height: 12, elevation: -2 });
    expect(punchThroughCutter(hole, [solid])).toBe(hole);
  });

  it("does not extend a hole that only shares the part's height from the side", () => {
    const solid = shape({ id: "solid", kind: "box", width: 10, depth: 10, size: 10 });
    const hole = shape({ id: "hole", hole: true, kind: "box", x: 40, width: 10, depth: 10, size: 10 });
    expect(punchThroughCutter(hole, [solid])).toBe(hole);
  });

  it("extends a tilted hole along its own axis when both ends are flush", () => {
    const solid = shape({ id: "solid", kind: "box", width: 20, depth: 10, height: 20, size: 20 });
    const hole = shape({
      id: "hole",
      hole: true,
      kind: "cylinder",
      width: 4,
      depth: 4,
      size: 4,
      height: 10,
      elevation: 5,
      rotationX: 90,
    });
    const punched = punchThroughCutter(hole, [solid]);
    const z = span(meshForShape(punched), 2);
    expect(z.min).toBeLessThan(-5.2);
    expect(z.max).toBeGreaterThan(5.2);
    expect(punched.width).toBe(4);
  });

  it("grows flush holes before an OCCT subtract and leaves unions alone", () => {
    const solid = shape({ id: "solid", kind: "box", hole: false });
    const hole = shape({ id: "hole", hole: true, width: 8, depth: 8, size: 8 });
    const subtracted = prepareBooleanOperands([solid, hole], "subtract");
    const fused = prepareBooleanOperands([solid, hole], "union");
    expect(subtracted[1]?.height ?? 0).toBeGreaterThan(hole.height);
    expect(subtracted[1]?.elevation ?? 0).toBeLessThan(hole.elevation ?? 0);
    expect(fused[1]).toBe(hole);
  });

  it("cuts a flush cylinder all the way through", () => {
    const solid = shape({ id: "solid", name: "Disk", sides: 48 });
    const hole = shape({ id: "hole", name: "Bore", hole: true, width: 8, depth: 8, size: 8, sides: 48 });
    const group = booleanMeshShape([solid, hole]);
    expect(group?.importedMesh).toBeTruthy();
    const mesh = meshForShape(group!);
    expect(span(mesh, 1).max - span(mesh, 1).min).toBeLessThan(solid.height + 0.2);
    expect(deepBoreTriangles(mesh, hole)).toBe(0);
  });
});
