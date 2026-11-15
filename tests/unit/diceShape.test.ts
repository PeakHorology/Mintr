import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DICE_SIDES, diceGeometry, diceNaturalSize, diceSizeForRadius, parseDiceSides } from "@/lib/diceShape";
import { buildGeneratedShape } from "@/lib/generatedShapes";
import { makeShapeFromAsset, searchShapeAssets, toolbarShapeAssets } from "@/lib/shapeCatalog";
import { meshForShape } from "@/lib/editorShapeMesh";
import { tinkercadToShapes } from "@/lib/tinkercadImport";

/** Flat faces: triangles grouped by their outward direction. */
function faceCount(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex()!;
  const normals: THREE.Vector3[] = [];
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let face = 0; face < index.count; face += 3) {
    a.fromBufferAttribute(position, index.getX(face));
    b.fromBufferAttribute(position, index.getX(face + 1));
    c.fromBufferAttribute(position, index.getX(face + 2));
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (!normals.some((seen) => seen.distanceTo(normal) < 1e-4)) normals.push(normal);
  }
  return normals;
}

function signedVolume(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex()!;
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let volume = 0;
  for (let face = 0; face < index.count; face += 3) {
    a.fromBufferAttribute(position, index.getX(face));
    b.fromBufferAttribute(position, index.getX(face + 1));
    c.fromBufferAttribute(position, index.getX(face + 2));
    volume += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
  }
  return volume;
}

describe("Dice", () => {
  for (const sides of DICE_SIDES) {
    it(`a ${sides}-sided die has ${sides} flat faces, sits on one, and fills its box`, () => {
      const size = diceNaturalSize(sides, 20);
      expect(Math.max(size.width, size.depth, size.height)).toBeCloseTo(20, 2);
      const geometry = diceGeometry(sides, size.width, size.depth, size.height);
      const normals = faceCount(geometry);
      expect(normals).toHaveLength(sides);
      expect(normals.some((normal) => normal.y < -0.9999)).toBe(true);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.y).toBeCloseTo(size.height, 2);
      expect(box.max.x - box.min.x).toBeCloseTo(size.width, 2);
      expect(box.max.z - box.min.z).toBeCloseTo(size.depth, 2);
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 6);
      // Faces point outward, so the solid has a positive volume and cuts and joins work.
      expect(signedVolume(geometry)).toBeGreaterThan(0);
    });
  }

  it("a 6 is a 20 mm cube", () => {
    expect(diceNaturalSize(6, 20)).toEqual({ width: 20, depth: 20, height: 20 });
  });

  it("only takes the sides it can make", () => {
    expect(parseDiceSides("12")).toBe(12);
    expect(parseDiceSides(7)).toBe(20);
    expect(parseDiceSides(undefined)).toBe(20);
  });

  it("is on the shapes list, found by its other names, and comes in as a 20", () => {
    const asset = toolbarShapeAssets.find((shape) => shape.id === "dice")!;
    expect(asset.generated).toEqual({ form: "dice", sides: 20 });
    expect(searchShapeAssets(toolbarShapeAssets, "icosahedron").map((shape) => shape.id)).toContain("dice");
    expect(searchShapeAssets(toolbarShapeAssets, "d6").map((shape) => shape.id)).toContain("dice");
    const made = makeShapeFromAsset(asset);
    expect(made).toMatchObject({ kind: "mesh", name: "Dice", generated: { form: "dice", sides: 20 } });
    expect(meshForShape(made).vertices.length).toBe(12);
  });

  it("rebuilds with new sides", () => {
    const made = buildGeneratedShape({ form: "dice", sides: 8 }, diceNaturalSize(8, 30), { name: "Dice", color: "#000" })!;
    expect(meshForShape(made).vertices.length).toBe(6);
  });

  it("a Tinkercad icosahedron comes in as a 20-sided die of the same size", () => {
    const { shapes, skipped } = tinkercadToShapes({
      v: 1,
      root: { children: [{ dataType: "preset", params: { id: "icosahedron", radius: 10 }, matrix: [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1], tags: { label: "Icosahedron" } }] },
    });
    expect(skipped).toEqual([]);
    expect(shapes[0]).toMatchObject({ name: "Icosahedron", kind: "mesh", generated: { form: "dice", sides: 20 }, elevation: 0 });
    const expected = diceSizeForRadius(20, 10);
    expect(shapes[0].height).toBeCloseTo(expected.height, 3);
    // Corners 10 mm out: it stands 15.9 mm, face to face, and is never wider than 20.
    expect(shapes[0].height).toBeCloseTo(15.893, 2);
    expect(Math.max(shapes[0].width ?? 0, shapes[0].depth ?? 0)).toBeLessThanOrEqual(20);
  });
});
