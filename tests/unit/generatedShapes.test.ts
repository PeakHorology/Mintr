import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/brepKernel", async () => {
  const brep = await import("brepjs");
  const { OcctKernel } = await import("occt-wasm");
  const wasm = join(dirname(fileURLToPath(import.meta.resolve("occt-wasm"))), "occt-wasm.wasm");
  // A fresh engine each time: the wasm engine runs out of bounds after a few exact builds under vitest.
  return {
    loadBrepWithOcct: async () => {
      const kernel = await OcctKernel.init({ wasm });
      brep.registerKernel("occt-wasm", brep.OcctWasmAdapter.fromKernel(kernel));
      return brep;
    },
  };
});

import { buildGeneratedShape, defaultGeneratedSize, latheProfile } from "@/lib/generatedShapes";
import { withExactGeneratedRevolveLocal, withExactGeneratedShape } from "@/lib/generatedExact";
import { makeShapeFromAsset, toolbarShapeAssets } from "@/lib/shapeCatalog";
import { sceneShape } from "@/lib/shapeCatalog";
import type { GeneratedSpec, WorkplaneShape } from "@/types/sketchforge";

const SPECS: GeneratedSpec[] = [
  { form: "plate", cornerRadius: 5 },
  { form: "plate", cornerRadius: 0 },
  { form: "slot" },
  { form: "star", points: 5, inner: 0.45 },
  { form: "star", points: 12, inner: 0.8 },
  { form: "heart" },
  { form: "paraboloid" },
  { form: "screwHole", size: "M3", head: "none" },
  { form: "screwHole", size: "M6", head: "counterbore" },
  { form: "screwHole", size: "M8", head: "countersink" },
  { form: "nutPocket", size: "M4" },
  { form: "qr", text: "https://mintr3d.com" },
];

function bounds(shape: WorkplaneShape) {
  const positions = shape.importedMesh?.positions;
  if (!positions) return null;
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis], positions[index + axis]);
      high[axis] = Math.max(high[axis], positions[index + axis]);
    }
  }
  return { size: [high[0] - low[0], high[1] - low[1], high[2] - low[2]], low, high };
}

/** Every edge of a closed solid belongs to exactly two triangles, one each way round. Corners are the same corner by position. */
function isClosed(shape: WorkplaneShape) {
  const mesh = shape.importedMesh;
  if (!mesh) return null;
  const corner = (vertex: number) => [0, 1, 2].map((axis) => Math.round(mesh.positions[vertex * 3 + axis] * 1e3)).join(",");
  const count = mesh.indices ? mesh.indices.length : mesh.positions.length / 3;
  const read = (index: number) => (mesh.indices ? mesh.indices[index] : index);
  const edges = new Map<string, number>();
  for (let index = 0; index < count; index += 3) {
    const corners = [corner(read(index)), corner(read(index + 1)), corner(read(index + 2))];
    corners.forEach((from, step) => {
      const to = corners[(step + 1) % 3];
      edges.set(`${from}|${to}`, (edges.get(`${from}|${to}`) ?? 0) + 1);
    });
  }
  for (const [edge, times] of edges) {
    const [from, to] = edge.split("|");
    if (times !== edges.get(`${to}|${from}`)) return false;
  }
  return true;
}

describe("generated shapes", () => {
  it.each(SPECS.map((spec) => [JSON.stringify(spec), spec] as const))("%s is a closed solid of the size it says", (_, spec) => {
    const size = defaultGeneratedSize(spec);
    const shape = buildGeneratedShape(spec, size, { name: "Test", color: "#000" });
    expect(shape).not.toBeNull();
    expect(shape!.generated).toEqual(spec);
    // A plate with no corners becomes a plain box, which has no mesh to measure.
    if (shape!.kind === "box") return;
    const box = bounds(shape!);
    expect(box).not.toBeNull();
    expect(box!.size[0]).toBeCloseTo(shape!.width ?? 0, 1);
    expect(box!.size[1]).toBeCloseTo(shape!.height, 1);
    expect(box!.size[2]).toBeCloseTo(shape!.depth ?? 0, 1);
    expect(box!.low[1]).toBeCloseTo(0, 3);
    expect(isClosed(shape!)).toBe(true);
  });

  it("winds outward, so a hole cuts and a solid adds", () => {
    const shape = buildGeneratedShape({ form: "paraboloid" }, { width: 20, depth: 20, height: 20 }, { name: "Test", color: "#000" })!;
    const positions = shape.importedMesh!.positions;
    const indices = shape.importedMesh!.indices!;
    let volume = 0;
    for (let index = 0; index < indices.length; index += 3) {
      const [a, b, c] = [indices[index], indices[index + 1], indices[index + 2]].map((vertex) => [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]]);
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    // A paraboloid is half its cylinder: pi r^2 h / 2.
    expect(volume).toBeGreaterThan(0);
    expect(Math.abs(volume - (Math.PI * 100 * 20) / 2)).toBeLessThan(30);
  });

  it("a screw's settings decide its width, whatever is asked for", () => {
    const shape = buildGeneratedShape({ form: "screwHole", size: "M3", head: "none" }, { width: 99, depth: 99, height: 10 }, { name: "Hole", color: "#000", hole: true })!;
    expect(shape.width).toBeCloseTo(3.4);
    expect(shape.depth).toBeCloseTo(3.4);
    expect(shape.hole).toBe(true);
  });

  it("a screw hole's own name follows Threaded or Slides through, and a typed name stays", () => {
    const build = (threaded: boolean, name: string) => buildGeneratedShape(
      { form: "screwHole", size: "M3", head: "none", threaded },
      { width: 3, depth: 3, height: 10 },
      { name, color: "#000", hole: true },
    )!.name;
    expect(build(false, "Threaded Hole")).toBe("Clearance Hole");
    expect(build(false, "Threaded Hole M3")).toBe("Clearance Hole M3");
    expect(build(true, "Clearance Hole")).toBe("Threaded Hole");
    expect(build(true, "Threaded Hole")).toBe("Threaded Hole");
    expect(build(false, "Lid screw")).toBe("Lid screw");
  });

  it("a nut pocket is the nut's width across its flats, plus room", () => {
    const shape = buildGeneratedShape({ form: "nutPocket", size: "M3" }, { width: 0, depth: 0, height: 3 }, { name: "Nut", color: "#000", hole: true })!;
    const box = bounds(shape)!;
    expect(Math.min(box.size[0], box.size[2])).toBeCloseTo(5.8, 1);
  });

  it("a countersink's cone is 90 degrees", () => {
    const profile = latheProfile({ form: "screwHole", size: "M4", head: "countersink" }, 9.3, 10)!;
    const [, , [shaft, seat], [rim, top]] = profile;
    expect(rim - shaft).toBeCloseTo(top - seat);
  });

  it("refuses to make a screw hole shallower than its head", () => {
    const shape = buildGeneratedShape({ form: "screwHole", size: "M6", head: "counterbore" }, { width: 0, depth: 0, height: 1 }, { name: "Hole", color: "#000" })!;
    expect(shape.height).toBeGreaterThanOrEqual(6.5);
  });

  it("keeps where a part is and what it is when it is rebuilt", () => {
    const shape = buildGeneratedShape({ form: "heart" }, { width: 50, depth: 40, height: 3 }, { name: "Mine", color: "#123456", x: 12, z: -8, elevation: 4, rotation: 30, hole: true, laserJob: "score" })!;
    expect(shape).toMatchObject({ name: "Mine", color: "#123456", x: 12, z: -8, elevation: 4, rotation: 30, hole: true, laserJob: "score" });
  });

  it("carries its settings through the paste path", () => {
    const shape = buildGeneratedShape({ form: "star", points: 7, inner: 0.5 }, { width: 30, depth: 30, height: 4 }, { name: "Star", color: "#000" })!;
    expect(sceneShape(shape).generated).toEqual({ form: "star", points: 7, inner: 0.5 });
  });

  it("makes a QR code square, and one no bigger than it can be read", () => {
    const shape = buildGeneratedShape({ form: "qr", text: "hello" }, { width: 30, depth: 80, height: 1 }, { name: "QR", color: "#000" })!;
    expect(shape.depth).toBe(shape.width);
    expect(buildGeneratedShape({ form: "qr", text: "x".repeat(4000) }, { width: 30, depth: 30, height: 1 }, { name: "QR", color: "#000" })).toBeNull();
  });

  it("the menu makes every generated shape, at sheet thickness in a laser design", () => {
    const generated = toolbarShapeAssets.filter((asset) => asset.generated);
    expect(generated.map((asset) => asset.id).sort()).toEqual(["heart", "nut-pocket", "paraboloid", "plate", "qr-code", "screw-hole", "slot", "star"]);
    for (const asset of generated) {
      const shape = makeShapeFromAsset(asset, { x: 5, z: 6 }, "standard", 3);
      expect(shape.generated).toEqual(asset.generated);
      expect(shape.x).toBe(5);
      expect(shape.z).toBe(6);
      if (asset.id !== "screw-hole") expect(shape.height).toBeCloseTo(3);
    }
    expect(makeShapeFromAsset(generated.find((asset) => asset.id === "qr-code")!, undefined, "standard", 3).laserJob).toBe("engrave");
  });

  it.each([
    [{ form: "paraboloid" } as GeneratedSpec, { width: 20, depth: 20, height: 20 }],
    [{ form: "screwHole", size: "M4", head: "counterbore" } as GeneratedSpec, { width: 0, depth: 0, height: 12 }],
    [{ form: "screwHole", size: "M4", head: "countersink" } as GeneratedSpec, { width: 0, depth: 0, height: 12 }],
  ])("turned shape %j gets an exact solid of the same size", async (spec, size) => {
    const mesh = buildGeneratedShape(spec, size, { name: "Exact", color: "#000" })!;
    const exact = await withExactGeneratedRevolveLocal(mesh);
    expect(exact.cadBrep).toBeTruthy();
    const box = bounds(exact)!;
    expect(box.size[0]).toBeCloseTo(mesh.width ?? 0, 1);
    expect(box.size[1]).toBeCloseTo(mesh.height, 1);
    expect(box.size[2]).toBeCloseTo(mesh.depth ?? 0, 1);
  }, 60000);

  it("a stretched paraboloid keeps its size even when the exact solid cannot be made", async () => {
    const mesh = buildGeneratedShape({ form: "paraboloid" }, { width: 30, depth: 16, height: 12 }, { name: "Oval", color: "#000" })!;
    const result = await withExactGeneratedRevolveLocal(mesh);
    const box = bounds(result)!;
    expect(box.size[0]).toBeCloseTo(30, 1);
    expect(box.size[1]).toBeCloseTo(12, 1);
    expect(box.size[2]).toBeCloseTo(16, 1);
  }, 60000);

  it("a resized part that carries a fillet still becomes exact, so the fillet can be rebuilt on it", async () => {
    // Resizing builds the plain outline from the old part, fillet recipe and all; the steps replay after.
    const previous = {
      name: "Slot",
      color: "#000",
      edgeTreatments: [{ kind: "fillet", amount: 1, allEdges: true, sharpAngle: 25 }],
    } as unknown as WorkplaneShape;
    const built = buildGeneratedShape({ form: "slot" }, { width: 40, depth: 12, height: 10 }, previous)!;
    expect(built.edgeTreatments?.length).toBe(1);
    const exact = await withExactGeneratedShape(built);
    expect(exact.cadBrep?.length ?? 0).toBeGreaterThan(0);
    expect(exact.edgeTreatments).toEqual(built.edgeTreatments);
    expect(exact.width).toBe(40);
  }, 60000);
});
