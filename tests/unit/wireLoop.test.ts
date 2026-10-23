import { describe, expect, it } from "vitest";
import { edgePolylinesFromWireframe, orderWireLoop } from "@/lib/wireLoop";

function corners(flat: number[]) {
  const out: Array<[number, number, number]> = [];
  for (let index = 0; index + 2 < flat.length; index += 3) out.push([flat[index], flat[index + 1], flat[index + 2]]);
  return out;
}

describe("orderWireLoop", () => {
  it("chains a box face's edges into one rectangle regardless of edge order or direction", () => {
    // Real occt-wasm output for the x=0 face of a 20mm box: four edges, explorer order, mixed direction.
    const raw = {
      points: Float32Array.from([
        0, 0, 0, 0, 0, 20,
        0, 0, 20, 0, 20, 20,
        0, 20, 0, 0, 20, 20,
        0, 0, 0, 0, 20, 0,
      ]),
      edgeGroups: Int32Array.from([0, 6, 1, 6, 6, 2, 12, 6, 3, 18, 6, 4]),
    };
    const loop = corners(orderWireLoop(edgePolylinesFromWireframe(raw)));
    expect(loop).toHaveLength(4);
    // Every consecutive pair shares exactly one coordinate change of 20mm: an axis-aligned edge, never a diagonal.
    for (let index = 0; index < loop.length; index += 1) {
      const a = loop[index];
      const b = loop[(index + 1) % loop.length];
      const moved = [0, 1, 2].filter((axis) => Math.abs(a[axis] - b[axis]) > 1e-6);
      expect(moved).toHaveLength(1);
      expect(Math.abs(a[moved[0]] - b[moved[0]])).toBeCloseTo(20, 6);
    }
  });

  it("keeps curved edge samples and drops the repeated closing point", () => {
    const arc = [10, 0, 0, 7.07, 7.07, 0, 0, 10, 0];
    const chord = [0, 10, 0, 10, 0, 0];
    const loop = corners(orderWireLoop([chord, arc]));
    expect(loop).toHaveLength(3);
    expect(loop[0]).toEqual([0, 10, 0]);
    expect(loop[1]).toEqual([10, 0, 0]);
    expect(loop[2]).toEqual([7.07, 7.07, 0]);
  });
});
