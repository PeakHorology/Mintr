import { describe, expect, it } from "vitest";
import { STL_HEADER, stlZUp, toStl } from "@/lib/stlExport";
import type { MeshData } from "@/lib/editorShapeMesh";

function readTriangles(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const triangles: { normal: number[]; vertices: number[][] }[] = [];
  let offset = 84;
  const vec = () => {
    const v = [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)];
    offset += 12;
    return v;
  };
  for (let i = 0; i < count; i += 1) {
    const normal = vec();
    const vertices = [vec(), vec(), vec()];
    offset += 2;
    triangles.push({ normal, vertices });
  }
  return { count, triangles };
}

describe("toStl", () => {
  it("writes slicer Z-up like the 3MF exporter: editor height becomes STL Z", () => {
    const mesh: MeshData = {
      name: "Tri",
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 5, 0],
      ],
      faces: [[0, 1, 2]],
    };
    const bytes = toStl([mesh]);
    expect(bytes.byteLength).toBe(84 + 50);
    expect(new TextDecoder().decode(bytes.slice(0, STL_HEADER.length))).toBe(STL_HEADER);
    const { count, triangles } = readTriangles(bytes);
    expect(count).toBe(1);
    // Y-up (0,5,0) → Z-up (0,0,5), same as the 3MF writer.
    expect(triangles[0].vertices[2][0]).toBeCloseTo(0, 6);
    expect(triangles[0].vertices[2][1]).toBeCloseTo(0, 6);
    expect(triangles[0].vertices[2][2]).toBeCloseTo(5, 6);
    expect(stlZUp([1, 2, 3])).toEqual([1, -3, 2]);
  });

  it("keeps triangle normals consistent with the rotated winding", () => {
    // A horizontal triangle wound to face +Y (up) in the editor must face +Z in
    // the file, and its stored normal must agree with its written winding.
    const mesh: MeshData = {
      name: "Top",
      vertices: [
        [0, 0, 0],
        [0, 0, 10],
        [10, 0, 10],
      ],
      faces: [[0, 1, 2]],
    };
    const { triangles } = readTriangles(toStl([mesh]));
    const [nx, ny, nz] = triangles[0].normal;
    expect(nx).toBeCloseTo(0, 6);
    expect(ny).toBeCloseTo(0, 6);
    expect(nz).toBeCloseTo(1, 6);
    const [a, b, c] = triangles[0].vertices;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    expect(Math.sign(cross[2])).toBe(1);
    expect(Math.abs(cross[0])).toBeLessThan(1e-6);
    expect(Math.abs(cross[1])).toBeLessThan(1e-6);
  });

  it("concatenates several bodies into one triangle list", () => {
    const tri = (dx: number): MeshData => ({
      name: `Tri ${dx}`,
      vertices: [[dx, 0, 0], [dx + 1, 0, 0], [dx, 1, 0]],
      faces: [[0, 1, 2]],
    });
    const { count, triangles } = readTriangles(toStl([tri(0), tri(20), tri(40)]));
    expect(count).toBe(3);
    expect(triangles.map((t) => t.vertices[0][0])).toEqual([0, 20, 40]);
  });
});
