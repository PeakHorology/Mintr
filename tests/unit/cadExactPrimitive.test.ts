import { describe, expect, it } from "vitest";
import { cadModifierPrimitiveForExactKind } from "@/lib/cadBakeMetadata";
import { NATIVE_EXACT_KINDS } from "@/lib/shapeBrep";
import type { WorkplaneShape } from "@/types/sketchforge";

function shape(kind: WorkplaneShape["kind"], extra: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: kind,
    name: kind,
    kind,
    color: "#3b82f6",
    x: 0,
    z: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 16,
    rotation: 0,
    locked: false,
    hidden: false,
    ...extra,
  };
}

const ENCODED_KINDS: Array<WorkplaneShape["kind"]> = [
  "sphere",
  "pyramid",
  "wedge",
  "roof",
  "roundRoof",
  "halfSphere",
  "torus",
  "tube",
  "ring",
  "gear",
];

describe("cadModifierPrimitiveForExactKind", () => {
  it("encodes every remaining CAD-ready kind Push Pull still needed", () => {
    for (const kind of ENCODED_KINDS) {
      expect(NATIVE_EXACT_KINDS.has(kind), kind).toBe(true);
      const primitive = cadModifierPrimitiveForExactKind(shape(kind, {
        sides: 6,
        bevel: 3,
        radius: 2,
        leftAngle: 70,
        rightAngle: 70,
        gearSpec: { form: "spur", teeth: 16, module: 1.5, pressureAngle: 20, backlash: 0.1, bore: 4 },
      }));
      expect(primitive?.kind, kind).toBe(kind);
    }
  });

  it("keeps pyramid sides, roof ridge, torus tube, and gear loops", () => {
    expect(cadModifierPrimitiveForExactKind(shape("pyramid", { sides: 6 }))).toEqual(expect.objectContaining({
      kind: "pyramid",
      sides: 6,
    }));
    const roof = cadModifierPrimitiveForExactKind(shape("roof", { leftAngle: 60, rightAngle: 80 }));
    expect(roof?.kind).toBe("roof");
    expect(roof && "ridgeX" in roof ? typeof roof.ridgeX : null).toBe("number");
    expect(cadModifierPrimitiveForExactKind(shape("torus", { radius: 3 }))).toEqual(expect.objectContaining({
      kind: "torus",
      radius: 3,
    }));
    const gear = cadModifierPrimitiveForExactKind(shape("gear", {
      gearSpec: { form: "spur", teeth: 12, module: 1.25, pressureAngle: 20, backlash: 0.1, bore: 3 },
    }));
    expect(gear?.kind).toBe("gear");
    expect(gear && "profileLoops" in gear ? gear.profileLoops?.outer.length : 0).toBeGreaterThan(8);
  });

  it("keeps yaw so a turned pyramid stays aligned", () => {
    const primitive = cadModifierPrimitiveForExactKind(shape("pyramid", { rotation: 30, x: 4 }));
    expect(primitive?.kind).toBe("pyramid");
    expect(primitive && "transform" in primitive ? primitive.transform : null).toBeTruthy();
  });

  it("rejects grouped, filleted, or mesh-backed parts", () => {
    expect(cadModifierPrimitiveForExactKind(shape("sphere", { groupedShapes: [shape("sphere", { id: "child" })] }))).toBeNull();
    expect(cadModifierPrimitiveForExactKind(shape("pyramid", { cadBrep: "solid" }))).toBeNull();
    expect(cadModifierPrimitiveForExactKind(shape("wedge", {
      importedMesh: {
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        baseWidth: 20,
        baseDepth: 20,
        baseHeight: 16,
        triangleCount: 1,
        sourceFormat: "stl",
      },
    }))).toBeNull();
    expect(cadModifierPrimitiveForExactKind(shape("box"))).toBeNull();
    expect(cadModifierPrimitiveForExactKind(shape("polygon"))).toBeNull();
  });
});
