import { describe, expect, it } from "vitest";
import type { CadPlanarFace } from "@/lib/cadModifierTypes";
import {
  ghostPrismMesh,
  pickPlanarFaceId,
  pushPullDistanceFromRay,
  pushPullHistoryLabel,
} from "@/lib/pushPullGeometry";

function squareFace(id: number, origin: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }, size = 20): CadPlanarFace {
  const half = size / 2;
  const points = normal.y !== 0
    ? [
      origin.x - half, origin.y, origin.z - half,
      origin.x + half, origin.y, origin.z - half,
      origin.x + half, origin.y, origin.z + half,
      origin.x - half, origin.y, origin.z + half,
    ]
    : [
      origin.x, origin.y - half, origin.z - half,
      origin.x, origin.y + half, origin.z - half,
      origin.x, origin.y + half, origin.z + half,
      origin.x, origin.y - half, origin.z + half,
    ];
  return { id, origin, normal, points, area: size * size };
}

describe("push pull geometry", () => {
  it("picks the face the ray hits", () => {
    const top = squareFace(0, { x: 0, y: 20, z: 0 }, { x: 0, y: 1, z: 0 });
    const side = squareFace(1, { x: 10, y: 10, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(pickPlanarFaceId([top, side], { x: 0, y: 40, z: 0 }, { x: 0, y: -1, z: 0 })).toBe(0);
    expect(pickPlanarFaceId([top, side], { x: 30, y: 10, z: 0 }, { x: -1, y: 0, z: 0 })).toBe(1);
    expect(pickPlanarFaceId([top, side], { x: 0, y: 40, z: 40 }, { x: 0, y: -1, z: 0 })).toBeNull();
  });

  it("reads drag distance along the face normal", () => {
    const origin = { x: 0, y: 20, z: 0 };
    const normal = { x: 0, y: 1, z: 0 };
    const pull = pushPullDistanceFromRay(
      origin,
      normal,
      { x: 40, y: 28, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
    );
    expect(pull).toBeCloseTo(8, 5);
    const push = pushPullDistanceFromRay(
      origin,
      normal,
      { x: 40, y: 12, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
    );
    expect(push).toBeCloseTo(-8, 5);
  });

  it("picks inside a concave L face but not in its notch", () => {
    // L outline on the y = 20 plane: 20×20 square with the +x/+z quadrant removed.
    const face: CadPlanarFace = {
      id: 7,
      origin: { x: 0, y: 20, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      area: 300,
      points: [
        -10, 20, -10,
        10, 20, -10,
        10, 20, 0,
        0, 20, 0,
        0, 20, 10,
        -10, 20, 10,
      ],
    };
    const down = { x: 0, y: -1, z: 0 };
    expect(pickPlanarFaceId([face], { x: -5, y: 40, z: 5 }, down)).toBe(7);
    expect(pickPlanarFaceId([face], { x: 5, y: 40, z: -5 }, down)).toBe(7);
    expect(pickPlanarFaceId([face], { x: 5, y: 40, z: 5 }, down)).toBeNull();
    const ghost = ghostPrismMesh(face, 2);
    // Caps never spill into the notch: no cap vertex lands in the removed quadrant interior.
    for (let index = 0; index + 2 < ghost.positions.length; index += 3) {
      const x = ghost.positions[index];
      const z = ghost.positions[index + 2];
      expect(x > 1e-6 && z > 1e-6).toBe(false);
    }
    expect(ghost.indices.length / 3).toBe(6 * 2 + 4 * 2);
  });

  it("builds a ghost prism and labels history", () => {
    const face = squareFace(0, { x: 0, y: 20, z: 0 }, { x: 0, y: 1, z: 0 });
    const ghost = ghostPrismMesh(face, 4);
    expect(ghost.positions.length).toBeGreaterThan(9);
    expect(ghost.indices.length).toBeGreaterThan(0);
    expect(pushPullHistoryLabel(4, 1)).toBe("Pulled 4.0 mm");
    expect(pushPullHistoryLabel(-2.5, 1)).toBe("Pushed 2.5 mm");
  });
});
