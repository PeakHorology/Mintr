import type { MeshData, Vec3 } from "@/lib/editorShapeMesh";

export const STL_HEADER = "PeakCAD binary STL";

function normalFor(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

/** Editor Y-up → slicer Z-up (rotate +90° about X), the same frame 3MF and STEP exports use. */
export function stlZUp(p: readonly number[]): Vec3 {
  return [p[0], -p[2], p[1]];
}

/**
 * Binary STL (little-endian). Much cheaper than ASCII string join for large meshes.
 *
 * Written in slicer Z-up like the 3MF and STEP exporters. Slicers assume Z-up,
 * so a Y-up STL lands on its side in Cura / PreForm / Bambu — the model's
 * height became its depth. A proper rotation keeps triangle winding intact.
 */
export function toStl(meshes: readonly MeshData[]): Uint8Array {
  let triangleCount = 0;
  for (const mesh of meshes) triangleCount += mesh.faces.length;
  const bytes = new Uint8Array(84 + triangleCount * 50);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 80; i += 1) {
    bytes[i] = i < STL_HEADER.length ? STL_HEADER.charCodeAt(i) : 0;
  }
  view.setUint32(80, triangleCount, true);
  let offset = 84;
  const write = (p: readonly number[]) => {
    const [x, y, z] = stlZUp(p);
    view.setFloat32(offset, x, true); offset += 4;
    view.setFloat32(offset, y, true); offset += 4;
    view.setFloat32(offset, z, true); offset += 4;
  };
  for (const mesh of meshes) {
    for (const [ai, bi, ci] of mesh.faces) {
      const a = mesh.vertices[ai];
      const b = mesh.vertices[bi];
      const c = mesh.vertices[ci];
      write(normalFor(a, b, c));
      write(a);
      write(b);
      write(c);
      view.setUint16(offset, 0, true); offset += 2;
    }
  }
  return bytes;
}
