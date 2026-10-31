import { afterAll, describe, expect, it } from "vitest";
import { buildFaceBody } from "@/lib/faceBody";
import type { CadPlanarFace } from "@/lib/cadModifierTypes";
import type { WorkplaneShape } from "@/types/sketchforge";
import { hasNativeKernelExe, spawnNativeKernelClient } from "../helpers/nativeKernelChild";

/** Row-major move by (x, y, z). */
const move = (x: number, y: number, z: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];

describe.skipIf(!hasNativeKernelExe)("face outlines from the Mintr kernel", () => {
  const client = spawnNativeKernelClient();
  afterAll(() => client.close());

  it("samples a crescent's hollow finely enough for Pad/Pocket to build smooth curves", async () => {
    // A 10 mm radius cylinder with an 8 mm cylinder cut through one side: a crescent.
    const prepared = await client.request({
      id: 1,
      requestId: 1,
      type: "prepare",
      sharpAngle: 12,
      parts: [
        { hole: false, primitive: { kind: "cylinder", radius: 10, height: 10 } },
        { hole: true, primitive: { kind: "cylinder", radius: 8, height: 30, transform: move(6, -10, 0) } },
      ],
    }, 60000);
    expect(prepared.ok, String(prepared.message)).toBe(true);
    const faces = prepared.planarFaces as CadPlanarFace[];
    const top = faces.reduce((best, face) => (face.normal.y > 0.9 && face.origin.y > (best?.origin.y ?? -Infinity) ? face : best), undefined as CadPlanarFace | undefined)!;
    expect(top).toBeDefined();
    const loop: { x: number; z: number }[] = [];
    for (let index = 0; index < top.points.length; index += 3) loop.push({ x: top.points[index], z: top.points[index + 2] });
    // Each step along the outline turns only a few degrees, except at the two tips.
    const turns = loop.map((point, index) => {
      const before = loop[(index - 1 + loop.length) % loop.length];
      const after = loop[(index + 1) % loop.length];
      const a = Math.atan2(point.z - before.z, point.x - before.x);
      const b = Math.atan2(after.z - point.z, after.x - point.x);
      let turn = Math.abs(b - a);
      if (turn > Math.PI) turn = Math.PI * 2 - turn;
      return turn;
    });
    const sharp = turns.filter((turn) => turn > (14 * Math.PI) / 180);
    expect(sharp).toHaveLength(2);
    expect(loop.length).toBeGreaterThan(40);

    const host: WorkplaneShape = {
      id: "cyl", name: "Cylinder", kind: "cylinder", color: "#c4a574", x: 0, z: 0, elevation: 0,
      size: 20, width: 20, depth: 20, height: 10, rotation: 0, locked: false, hidden: false,
    };
    const profile = buildFaceBody({ host, face: top, direction: "out", inset: 0, cornerRadius: 0, depth: 2, smooth: true })
      .shape!.sketchProfile!;
    expect(profile.segments.every((segment) => segment.kind === "bezier")).toBe(true);
    expect(profile.points.filter((point) => point.mode === "corner")).toHaveLength(2);
  }, 90000);
});
