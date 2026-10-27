import { describe, expect, it } from "vitest";
import { shapeFromSketchRevolve } from "@/lib/sketchRevolve";
import type { SketchProfile } from "@/types/sketchforge";

function triangleOnAxis(reversed = false): SketchProfile {
  return {
    points: [
      { id: "a", x: 0, z: -15 },
      { id: "b", x: 20, z: 0 },
      { id: "c", x: 0, z: 15 },
    ],
    segments: reversed
      ? [
        { id: "ac", startId: "a", endId: "c", kind: "line" },
        { id: "cb", startId: "c", endId: "b", kind: "line" },
        { id: "ba", startId: "b", endId: "a", kind: "line" },
      ]
      : [
        { id: "ab", startId: "a", endId: "b", kind: "line" },
        { id: "bc", startId: "b", endId: "c", kind: "line" },
        { id: "ca", startId: "c", endId: "a", kind: "line" },
      ],
  };
}

function rightTriangleCone(): SketchProfile {
  return {
    points: [
      { id: "tip", x: 0, z: 0 },
      { id: "hub", x: 0, z: 40 },
      { id: "rim", x: 30, z: 40 },
    ],
    segments: [
      { id: "axis", startId: "hub", endId: "tip", kind: "line" },
      { id: "slant", startId: "tip", endId: "rim", kind: "line" },
      { id: "disk", startId: "rim", endId: "hub", kind: "line" },
    ],
  };
}

const AXIS = { start: { x: 0, z: -20 }, end: { x: 0, z: 20 } };

function facingCounts(mesh: NonNullable<ReturnType<typeof shapeFromSketchRevolve>>["importedMesh"]) {
  let outward = 0;
  let inward = 0;
  const axisY = mesh!.baseHeight / 2;
  for (let index = 0; index < mesh!.positions.length; index += 9) {
    const cx = (mesh!.positions[index] + mesh!.positions[index + 3] + mesh!.positions[index + 6]) / 3;
    const cy = (mesh!.positions[index + 1] + mesh!.positions[index + 4] + mesh!.positions[index + 7]) / 3;
    const nx = mesh!.normals![index];
    const ny = mesh!.normals![index + 1];
    const away = Math.hypot(cx, cy - axisY);
    if (away < 1) continue;
    const normalLength = Math.hypot(nx, ny, mesh!.normals![index + 2]);
    if (normalLength < 1e-6) continue;
    const dot = (nx * cx + ny * (cy - axisY)) / away;
    if (dot > 0.2) outward += 1;
    else if (dot < -0.2) inward += 1;
  }
  return { outward, inward };
}

describe("sketch revolve shading", () => {
  it("keeps a sharp profile corner instead of a smooth shell", () => {
    const shape = shapeFromSketchRevolve(triangleOnAxis(), AXIS);
    expect(shape).not.toBeNull();
    const mesh = shape!.importedMesh!;
    expect(mesh.normals?.length).toBe(mesh.positions.length);

    let upper = { x: 0, y: 0, z: 0 };
    let lower = { x: 0, y: 0, z: 0 };
    let upperCount = 0;
    let lowerCount = 0;
    for (let index = 0; index < mesh.positions.length; index += 9) {
      const nx = mesh.normals![index];
      const ny = mesh.normals![index + 1];
      const nz = mesh.normals![index + 2];
      expect(mesh.normals![index + 3]).toBeCloseTo(nx, 5);
      expect(mesh.normals![index + 4]).toBeCloseTo(ny, 5);
      expect(mesh.normals![index + 6]).toBeCloseTo(nx, 5);
      const cz = (mesh.positions[index + 2] + mesh.positions[index + 5] + mesh.positions[index + 8]) / 3;
      const mid = 0;
      // The revolve axis lies on the workplane. The sharp corner is halfway along it.
      if (cz > mid + 1) {
        upper.x += nx;
        upper.y += ny;
        upper.z += nz;
        upperCount += 1;
      } else if (cz < mid - 1) {
        lower.x += nx;
        lower.y += ny;
        lower.z += nz;
        lowerCount += 1;
      }
    }
    expect(upperCount).toBeGreaterThan(0);
    expect(lowerCount).toBeGreaterThan(0);
    const upperLength = Math.hypot(upper.x, upper.y, upper.z) || 1;
    const lowerLength = Math.hypot(lower.x, lower.y, lower.z) || 1;
    const dot = (upper.x * lower.x + upper.y * lower.y + upper.z * lower.z) / (upperLength * lowerLength);
    expect(dot).toBeLessThan(Math.cos((40 * Math.PI) / 180));

    const precision = 10_000;
    const hashPoint = (x: number, y: number, z: number) => `${Math.round(x * precision)},${Math.round(y * precision)},${Math.round(z * precision)}`;
    const edges = new Map<string, number>();
    for (let index = 0; index < mesh.positions.length; index += 9) {
      const corners = [0, 3, 6].map((offset) => hashPoint(
        mesh.positions[index + offset],
        mesh.positions[index + offset + 1],
        mesh.positions[index + offset + 2],
      ));
      if (corners[0] === corners[1] || corners[1] === corners[2] || corners[2] === corners[0]) continue;
      for (let edge = 0; edge < 3; edge += 1) {
        const a = corners[edge];
        const b = corners[(edge + 1) % 3];
        const forward = `${a}_${b}`;
        const back = `${b}_${a}`;
        if (edges.has(back)) edges.delete(back);
        else edges.set(forward, 1);
      }
    }
    expect(edges.size).toBe(0);

    expect(facingCounts(mesh)).toEqual({ outward: expect.any(Number), inward: 0 });
    expect(facingCounts(mesh).outward).toBeGreaterThan(0);
  });

  it("stays outward when the sketch loop is walked the other way", () => {
    const shape = shapeFromSketchRevolve(triangleOnAxis(true), AXIS);
    expect(shape).not.toBeNull();
    const facing = facingCounts(shape!.importedMesh);
    expect(facing.inward).toBe(0);
    expect(facing.outward).toBeGreaterThan(0);
  });

  it("closes the wide end of a cone so the disk faces out", () => {
    const shape = shapeFromSketchRevolve(rightTriangleCone(), {
      start: { x: 0, z: -10 },
      end: { x: 0, z: 50 },
    });
    expect(shape).not.toBeNull();
    const mesh = shape!.importedMesh!;
    const facing = facingCounts(mesh);
    expect(facing.inward).toBe(0);
    expect(facing.outward).toBeGreaterThan(0);

    let cap = 0;
    let capZ = 0;
    for (let index = 0; index < mesh.positions.length; index += 9) {
      const z0 = mesh.positions[index + 2];
      const z1 = mesh.positions[index + 5];
      const z2 = mesh.positions[index + 8];
      if (Math.max(z0, z1, z2) - Math.min(z0, z1, z2) > 0.5) continue;
      const nz = mesh.normals![index + 2];
      if (Math.abs(nz) < 0.7) continue;
      cap += 1;
      capZ += nz;
    }
    expect(cap).toBeGreaterThan(0);
    expect(capZ / cap).toBeGreaterThan(0.5);
  });

  it("points a tube's hole inward and its outside wall outward", () => {
    const shape = shapeFromSketchRevolve({
      points: [
        { id: "a", x: 12, z: -8 },
        { id: "b", x: 22, z: -8 },
        { id: "c", x: 22, z: 8 },
        { id: "d", x: 12, z: 8 },
      ],
      segments: [
        { id: "da", startId: "d", endId: "a", kind: "line" },
        { id: "ab", startId: "a", endId: "b", kind: "line" },
        { id: "bc", startId: "b", endId: "c", kind: "line" },
        { id: "cd", startId: "c", endId: "d", kind: "line" },
      ],
    }, AXIS);
    expect(shape).not.toBeNull();
    const mesh = shape!.importedMesh!;
    const axisY = mesh.baseHeight / 2;
    let hole = 0;
    let shell = 0;
    for (let index = 0; index < mesh.positions.length; index += 9) {
      const cx = (mesh.positions[index] + mesh.positions[index + 3] + mesh.positions[index + 6]) / 3;
      const cy = (mesh.positions[index + 1] + mesh.positions[index + 4] + mesh.positions[index + 7]) / 3;
      const away = Math.hypot(cx, cy - axisY);
      const nx = mesh.normals![index];
      const ny = mesh.normals![index + 1];
      const dot = (nx * cx + ny * (cy - axisY)) / Math.max(away, 1e-6);
      if (away > 18 && dot > 0.2) shell += 1;
      if (away < 16 && away > 8 && dot < -0.2) hole += 1;
    }
    expect(shell).toBeGreaterThan(0);
    expect(hole).toBeGreaterThan(0);
  });
});
