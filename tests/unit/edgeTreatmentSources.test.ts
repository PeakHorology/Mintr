import { describe, expect, it } from "vitest";
import { cadModifierPrimitiveForAnalyticBox, exactModifierBrep } from "@/lib/cadBakeMetadata";
import { bakedEdgeTreatmentPreview, recutIgnoredThreadsAfterEdgeTreatment } from "@/lib/editorEdgeTreatments";
import { edgeTreatmentSourceParts } from "@/lib/edgeTreatmentSources";
import { isHelicalThreadSolid, threadlessEdgeTreatmentStandIn } from "@/lib/threadShape";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(partial: Partial<WorkplaneShape> & Pick<WorkplaneShape, "id">): WorkplaneShape {
  return {
    name: partial.id,
    kind: "box",
    color: "#d41721",
    x: 0,
    z: 0,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 10,
    height: 4,
    rotation: 0,
    ...partial,
  };
}

describe("edgeTreatmentSourceParts", () => {
  it("rebuilds a slotted plate from the plate and each slot instead of the display mesh", () => {
    const plate = box({ id: "plate", width: 80, depth: 30, height: 6, size: 80 });
    const slots = [0, 1, 2, 3].map((index) => box({
      id: `slot-${index}`,
      name: `Slot ${index}`,
      hole: true,
      x: -30 + index * 12,
      width: 8,
      depth: 34,
      height: 8,
      size: 34,
      importedMesh: {
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
        baseWidth: 8,
        baseDepth: 34,
        baseHeight: 8,
        triangleCount: 1,
        sourceFormat: "json",
      },
    }));
    const group = box({
      id: "rack",
      kind: "mesh",
      width: 80,
      depth: 34,
      height: 8,
      size: 80,
      importedMesh: {
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
        baseWidth: 80,
        baseDepth: 34,
        baseHeight: 8,
        triangleCount: 1,
        sourceFormat: "json",
      },
      groupedShapes: [plate, ...slots].map((shape) => ({
        ...shape,
        x: shape.x,
        z: shape.z,
      })),
      groupedBaseWidth: 80,
      groupedBaseDepth: 34,
      groupedBaseHeight: 8,
    });

    const parts = edgeTreatmentSourceParts(group);
    expect(parts).toHaveLength(5);
    expect(parts.filter((part) => part.hole)).toHaveLength(4);
    expect(parts.filter((part) => !part.hole)).toHaveLength(1);
    expect(parts.every((part) => cadModifierPrimitiveForAnalyticBox(part)?.kind === "box")).toBe(true);
  });

  it("opens a nested group of slots under the plate", () => {
    const plate = box({ id: "plate", width: 80, depth: 30, height: 6, size: 80 });
    const nested = box({
      id: "slots",
      kind: "mesh",
      hole: true,
      x: 0,
      width: 40,
      depth: 30,
      height: 6,
      size: 40,
      groupedShapes: [
        box({ id: "slot-a", hole: true, x: -8, width: 6, depth: 30, height: 8, size: 30 }),
        box({ id: "slot-b", hole: true, x: 8, width: 6, depth: 30, height: 8, size: 30 }),
      ],
    });
    const group = box({
      id: "rack",
      kind: "mesh",
      width: 80,
      depth: 30,
      height: 6,
      size: 80,
      groupedShapes: [plate, nested],
    });

    const parts = edgeTreatmentSourceParts(group);
    expect(parts).toHaveLength(3);
    expect(parts.filter((part) => part.hole)).toHaveLength(2);
    expect(parts.every((part) => cadModifierPrimitiveForAnalyticBox(part)?.kind === "box")).toBe(true);
  });

  it("keeps a finished fillet mesh instead of rebuilding the old slots", () => {
    const finished = box({
      id: "filleted",
      kind: "mesh",
      importedMesh: {
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
        baseWidth: 10,
        baseDepth: 10,
        baseHeight: 4,
        triangleCount: 1,
        sourceFormat: "json",
      },
      groupedShapes: [box({ id: "plate" })],
      edgeTreatments: [{ kind: "fillet", amount: 0.5, edgeCount: 1 }],
    });
    expect(edgeTreatmentSourceParts(finished, { keepResultMesh: true }).map((part) => part.id)).toEqual(["filleted"]);
  });

  it("keeps a fused group as one exact solid instead of opening the children", () => {
    const fused = box({
      id: "fused",
      kind: "mesh",
      width: 40,
      depth: 20,
      height: 20,
      size: 40,
      importedMesh: {
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
        baseWidth: 40,
        baseDepth: 20,
        baseHeight: 20,
        triangleCount: 1,
        sourceFormat: "step",
        brepStep: "ISO-10303-21;",
      },
      groupedShapes: [box({ id: "left" }), box({ id: "right", x: 20 })],
    });
    expect(edgeTreatmentSourceParts(fused).map((part) => part.id)).toEqual(["fused"]);
    expect(exactModifierBrep(fused)).toEqual({ brepStep: "ISO-10303-21;" });
  });
});

function threadHole(id: string): WorkplaneShape {
  return {
    id,
    name: "Tapped hole M6",
    kind: "thread",
    color: "#b8c2cc",
    hole: true,
    x: 0,
    z: 0,
    elevation: 0,
    size: 6,
    width: 6,
    depth: 6,
    height: 20,
    rotation: 0,
    threadSpec: {
      designation: "M6",
      majorDiameter: 6,
      pitch: 1,
      style: "hole",
      part: "threads",
      role: "bore",
    },
    importedMesh: {
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
      baseWidth: 6,
      baseDepth: 6,
      baseHeight: 20,
      triangleCount: 1,
      sourceFormat: "json",
    },
  };
}

describe("edgeTreatmentSourceParts ignoreThreads", () => {
  it("omits a tapped-hole cutter so fillet rebuilds the host only", () => {
    const plate = box({ id: "plate", width: 30, depth: 30, height: 10, size: 30 });
    const cutter = threadHole("tapped");
    const group = box({
      id: "block",
      kind: "mesh",
      width: 30,
      depth: 30,
      height: 10,
      size: 30,
      cadBrep: "helix-group-brep",
      groupedShapes: [plate, cutter],
    });

    const withThreads = edgeTreatmentSourceParts(group);
    expect(withThreads).toHaveLength(1);
    expect(withThreads[0].id).toBe("block");

    const ignored = edgeTreatmentSourceParts(group, { ignoreThreads: true });
    expect(ignored).toHaveLength(1);
    expect(ignored[0].kind).toBe("box");
    expect(ignored.every((part) => part.kind !== "thread")).toBe(true);
    expect(ignored.every((part) => cadModifierPrimitiveForAnalyticBox(part)?.kind === "box")).toBe(true);
  });

  it("still includes thread cutters when threads are not ignored", () => {
    const plate = box({ id: "plate" });
    const group = box({
      id: "block",
      kind: "mesh",
      groupedShapes: [plate, threadHole("tapped")],
    });
    expect(edgeTreatmentSourceParts(group).some((part) => part.kind === "thread")).toBe(true);
  });

  it("keeps a filleted host brep instead of reopening the original helix recipe", () => {
    const finished = box({
      id: "filleted",
      kind: "mesh",
      cadBrep: "fillet-without-helix",
      importedMesh: {
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
        baseWidth: 30,
        baseDepth: 30,
        baseHeight: 10,
        triangleCount: 1,
        sourceFormat: "json",
      },
      groupedShapes: [box({ id: "plate" }), threadHole("tapped")],
      edgeTreatments: [{ kind: "fillet", amount: 0.5, edgeCount: 1 }],
    });
    expect(edgeTreatmentSourceParts(finished, {
      keepResultMesh: true,
      ignoreThreads: true,
    }).map((part) => part.id)).toEqual(["filleted"]);
  });

  it("stands a lone screw in as a smooth cylinder", () => {
    const screw = threadHole("screw");
    const standIn = threadlessEdgeTreatmentStandIn({
      ...screw,
      hole: undefined,
      threadSpec: { ...screw.threadSpec!, style: "screw", part: "screw", role: "screw" },
    });
    expect(isHelicalThreadSolid(screw)).toBe(true);
    expect(standIn.kind).toBe("cylinder");
    expect(standIn.importedMesh).toBeUndefined();
    expect(edgeTreatmentSourceParts({
      ...screw,
      hole: undefined,
      threadSpec: { ...screw.threadSpec!, style: "screw", part: "screw", role: "screw" },
    }, { ignoreThreads: true })[0].kind).toBe("cylinder");
  });

  it("leaves a part without threads unchanged", async () => {
    const plate = box({ id: "plate" });
    const recut = await recutIgnoredThreadsAfterEdgeTreatment(plate, plate);
    expect(recut.id).toBe("plate");
    expect(recut.groupedShapes).toBeUndefined();
  });

  it("keeps thread children attached to the filleted mesh", () => {
    const original = box({
      id: "block",
      kind: "mesh",
      groupedShapes: [box({ id: "plate" }), threadHole("tapped")],
    });
    const treated = box({
      id: "block",
      kind: "mesh",
      cadBrep: "fillet-without-helix",
    });
    const baked = bakedEdgeTreatmentPreview(treated, original);
    expect(baked.cadBrep).toBe("fillet-without-helix");
    expect(baked.groupedShapes?.some((child) => child.kind === "thread")).toBe(true);
  });
});
