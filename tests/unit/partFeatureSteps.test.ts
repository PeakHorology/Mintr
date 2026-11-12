import { describe, expect, it } from "vitest";
import { edgesForStep } from "@/lib/featureReplay";
import { edgeTreatmentPartFeature, edgeTreatmentsForSteps, failedEdgeTreatmentFeatures } from "@/lib/partFeatures";
import { fingerprintCadEdge } from "@/lib/edgeTreatmentRematch";
import type { PartFeature, WorkplaneShape } from "@/types/sketchforge";

const print = (x: number) => ({ mid: [x, 0, 0] as [number, number, number], length: 10, angle: 90 });
const step = (id: string, extra: Partial<PartFeature> = {}): PartFeature => ({
  id, kind: "fillet", amount: 1,
  edges: { rule: "picked", sharpAngle: 25, fingerprints: [print(1)] },
  frame: { origin: [0, 0, 0], size: [10, 10, 10] }, ...extra,
} as PartFeature);

describe("fillet steps line up with their recipes when one is turned off", () => {
  it("keeps the edges of the step that is on", () => {
    const off = step("A", { suppressed: true });
    const on = step("B");
    const previous = {
      id: "p", features: [off, on],
      edgeTreatments: [{ kind: "fillet", amount: 1, edgeCount: 1, edgeFingerprints: [print(42)] }],
    } as unknown as WorkplaneShape;
    const out = edgeTreatmentsForSteps([off, on], previous)!;
    expect(out).toHaveLength(1);
    expect(out[0].edgeFingerprints?.[0].mid[0]).toBe(42);
  });

  it("marks the right step as failed", () => {
    const shape = {
      id: "p", features: [step("A", { suppressed: true }), step("B")],
      edgeTreatments: [{ kind: "fillet", amount: 1, edgeCount: 1 }],
    } as unknown as WorkplaneShape;
    const failed = failedEdgeTreatmentFeatures(shape, [0]);
    expect(failed.map((feature) => feature.id)).toEqual(["B"]);
  });
});

function boxEdges(w: number, h: number, d: number) {
  const xs = [-w / 2, w / 2], ys = [0, h], zs = [-d / 2, d / 2];
  const edges: number[][] = [];
  for (const y of ys) for (const z of zs) edges.push([xs[0], y, z, xs[1], y, z]);
  for (const x of xs) for (const z of zs) edges.push([x, ys[0], z, x, ys[1], z]);
  for (const x of xs) for (const y of ys) edges.push([x, y, zs[0], x, y, zs[1]]);
  return edges.map((points, id) => ({ id, points, angle: 90, display: true, selectable: true, manifold: true, boundary: false }));
}

describe("a picked fillet edge after the part is widened", () => {
  for (const scale of [2, 4, 6]) {
    it(`still finds an upright edge on a part ${scale}× wider`, () => {
      const recorded = boxEdges(20, 10, 20);
      const picked = edgeTreatmentPartFeature(
        "s",
        { kind: "fillet", amount: 1, edgeCount: 1, edgeFingerprints: [fingerprintCadEdge(recorded[4])!], sharpAngle: 25 } as never,
        recorded as never,
      );
      const ids = edgesForStep(picked as never, { edges: boxEdges(20 * scale, 10, 20) as never, planarFaces: [] });
      expect(ids).toEqual([4]);
    });
  }
});
