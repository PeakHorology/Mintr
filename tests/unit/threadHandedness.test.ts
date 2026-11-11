import { describe, expect, it } from "vitest";
import { buildMetricThreadedCylinder, threadSidesFor } from "@/lib/metricThreadSolid";
import { resolveThreadParams } from "@/lib/metricThreads";

/**
 * Which way the crest climbs: +1 when it rises turning from +X toward -Z, the turn the right-hand
 * rule gives about +Y, so a right-hand thread; -1 when it rises turning toward +Z.
 */
function crestTurn(handedness: "right" | "left") {
  const params = resolveThreadParams({ designation: "M6", handedness });
  const mesh = buildMetricThreadedCylinder(params, 12, { part: "screw", role: "rod", sides: 96 });
  const crest = params.majorDiameter / 2;
  // The crest's height at a few angles just past +X, either way round.
  const heightAt = (target: number) => {
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index + 2 < mesh.positions.length; index += 3) {
      const [x, y, z] = [mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2]];
      if (Math.abs(Math.hypot(x, z) - crest) > 0.02 || y < 4 || y > 4 + params.pitch) continue;
      if (Math.abs(Math.atan2(z, x) - target) > 0.01) continue;
      best = Math.min(best, y);
    }
    return best;
  };
  const step = (Math.PI * 2) / threadSidesFor(params.majorDiameter, 96);
  const towardPlusZ = heightAt(step * 4) - heightAt(0);
  return towardPlusZ > 0 ? -1 : 1;
}

describe("thread hand", () => {
  it("makes a right-hand thread right-handed and a left-hand thread left-handed", () => {
    expect(crestTurn("right")).toBe(1);
    expect(crestTurn("left")).toBe(-1);
  });
});
