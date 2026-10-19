import { describe, expect, it } from "vitest";
import { cutShapeToFit } from "@/lib/cutToFit";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(): WorkplaneShape {
  return {
    id: "box-1",
    name: "Block",
    kind: "box",
    color: "#336699",
    x: 0,
    z: 0,
    elevation: 0,
    size: 40,
    width: 40,
    depth: 40,
    height: 40,
    rotation: 0,
    locked: false,
    hidden: false,
  };
}

describe("cut to fit", () => {
  it("splits a block into a plug and a socket that sit side by side on the bed", () => {
    const parts = cutShapeToFit(box(), { axis: "x", offset: 0, joint: "plug", clearance: 0.2 });
    expect(parts).toHaveLength(2);
    const [plug, socket] = parts;
    expect(plug.name).toContain("plug");
    expect(socket.name).toContain("socket");
    expect(plug.elevation).toBe(0);
    expect(socket.elevation).toBe(0);
    expect(plug.x + plug.width / 2).toBeLessThan(socket.x - socket.width / 2);
    expect(plug.height).toBeGreaterThan(22);
    expect(socket.height).toBeGreaterThan(18);
    expect(plug.importedMesh?.positions.length ?? 0).toBeGreaterThan(100);
    expect(socket.importedMesh?.positions.length ?? 0).toBeGreaterThan(100);
    expect(plug.color).toBe("#336699");
  }, 20000);

  it("cuts a dovetail without leaving a piece below the bed", () => {
    const parts = cutShapeToFit(box(), { axis: "z", offset: 0, joint: "dovetail", clearance: 0.3 });
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part.elevation).toBe(0);
      const positions = part.importedMesh?.positions ?? [];
      for (let index = 1; index < positions.length; index += 3) {
        expect(positions[index]).toBeGreaterThanOrEqual(-0.05);
      }
    }
  }, 20000);

  it("cuts a thread and a snap that both stay on the bed", () => {
    for (const joint of ["thread", "snap"] as const) {
      const parts = cutShapeToFit(box(), { axis: "x", offset: 0, joint, clearance: 0.2 });
      expect(parts, joint).toHaveLength(2);
      expect(parts[0].elevation).toBe(0);
      expect(parts[1].elevation).toBe(0);
      expect(parts[0].x).toBeLessThan(parts[1].x);
    }
  }, 20000);
});
