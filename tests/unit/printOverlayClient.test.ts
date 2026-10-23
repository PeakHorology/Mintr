import { describe, expect, it } from "vitest";
import { printOverlayAllCadReady } from "@/lib/printOverlayClient";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(id: string): WorkplaneShape {
  return {
    id,
    name: id,
    kind: "box",
    color: "#d41721",
    x: 0,
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

describe("print overlay CAD-ready path", () => {
  it("treats native boxes as CAD-ready so the mesh worker can stay off", () => {
    expect(printOverlayAllCadReady([box("a"), box("b")])).toBe(true);
  });

  it("does not claim CAD-ready when a mesh-only body is in the scene", () => {
    expect(printOverlayAllCadReady([{ ...box("t"), kind: "text" }])).toBe(false);
    expect(printOverlayAllCadReady([box("a"), { ...box("t"), kind: "text" }])).toBe(false);
  });
});
