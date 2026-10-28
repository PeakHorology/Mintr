import { zipSync, strToU8 } from "fflate";
import { printMeshForShape } from "@/lib/texture/texturedShape";
import { rewrite3mf } from "@/lib/threeMfPackage";
import { lookup3mfPackage } from "@/lib/threeMfSource";
import type { WorkplaneShape } from "@/types/sketchforge";

export type ThreeMfMeshData = {
  name: string;
  vertices: [number, number, number][];
  faces: [number, number, number][];
  /** #RRGGBB. Written as a base material so a slicer can map filaments. */
  color?: string;
};

/** Convert PeakCAD Y-up into 3MF/slicer Z-up (rotate +90° about X). */
function yUpToZUp(x: number, y: number, z: number): [number, number, number] {
  return [x, -z, y];
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeObjectName(name: string, index: number) {
  const cleaned = name.trim().replace(/\s+/g, " ").slice(0, 80);
  return cleaned || `Solid ${index + 1}`;
}

/** #RRGGBB or #RRGGBBAA, upper case, or null when the color is not a hex. */
export function threeMfDisplayColor(color: string | undefined) {
  if (!color) return null;
  const match = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(color.trim());
  if (!match) return null;
  return `#${match[1].toUpperCase()}${match[2] ? match[2].toUpperCase() : "FF"}`;
}

function buildModelXml(meshes: ThreeMfMeshData[]) {
  const materials: { name: string; display: string }[] = [];
  const materialIndex = new Map<string, number>();
  for (const mesh of meshes) {
    const display = threeMfDisplayColor(mesh.color);
    if (!display || materialIndex.has(display)) continue;
    materialIndex.set(display, materials.length);
    materials.push({ name: `Color ${materials.length + 1}`, display });
  }
  const materialId = meshes.length + 1;

  // Single-pass string parts — avoid nested map/join temporaries for large meshes.
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n',
    '  <metadata name="Application">PeakCAD</metadata>\n',
    "  <resources>\n",
  ];

  if (materials.length > 0) {
    parts.push(`      <basematerials id="${materialId}">\n`);
    for (const material of materials) {
      parts.push(`        <base name="${escapeXml(material.name)}" displaycolor="${material.display}" />\n`);
    }
    parts.push("      </basematerials>\n");
  }

  meshes.forEach((mesh, index) => {
    const objectId = index + 1;
    const display = threeMfDisplayColor(mesh.color);
    const pindex = display === null ? null : materialIndex.get(display);
    const property = pindex === undefined || pindex === null ? "" : ` pid="${materialId}" pindex="${pindex}"`;
    const triangleProperty = pindex === undefined || pindex === null ? "" : ` pid="${materialId}" p1="${pindex}"`;
    parts.push(
      `      <object id="${objectId}" name="${escapeXml(sanitizeObjectName(mesh.name, index))}" type="model"${property}>\n`,
      "        <mesh>\n",
      "          <vertices>\n",
    );
    for (const [x, y, z] of mesh.vertices) {
      const [zx, zy, zz] = yUpToZUp(x, y, z);
      parts.push(`          <vertex x="${zx}" y="${zy}" z="${zz}" />\n`);
    }
    parts.push("          </vertices>\n", "          <triangles>\n");
    for (const [a, b, c] of mesh.faces) {
      parts.push(`          <triangle v1="${a}" v2="${b}" v3="${c}"${triangleProperty} />\n`);
    }
    parts.push("          </triangles>\n", "        </mesh>\n", "      </object>\n");
  });

  parts.push("  </resources>\n", "  <build>\n");
  for (let index = 0; index < meshes.length; index += 1) {
    parts.push(`      <item objectid="${index + 1}" />\n`);
  }
  parts.push("  </build>\n", "</model>\n");
  return parts.join("");
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>
`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>
`;

/** Build a Core 3MF package (ZIP) from triangle meshes. Units are millimeters, Z-up. */
export function to3mf(meshes: ThreeMfMeshData[]): Uint8Array {
  const exportable = meshes.filter((mesh) => mesh.vertices.length >= 3 && mesh.faces.length >= 1);
  if (exportable.length === 0) {
    throw new Error("No triangle geometry to export as 3MF");
  }

  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES_XML),
      "_rels/.rels": strToU8(RELS_XML),
      "3D/3dmodel.model": strToU8(buildModelXml(exportable)),
    },
    { level: 6 },
  );
}

function sourceCarrier(shape: WorkplaneShape): WorkplaneShape | null {
  if (shape.source3mf || lookup3mfPackage(shape.source3mfKey)) {
    return shape.source3mf ? shape : { ...shape, source3mf: lookup3mfPackage(shape.source3mfKey) };
  }
  return null;
}

/**
 * Export a 3MF. A shape that was imported from a 3MF is written back into that
 * package so print settings, materials, and other files stay put.
 */
export function to3mfForShapes(shapes: WorkplaneShape[]): { bytes: Uint8Array; preserved: boolean } {
  // A textured part has new triangles, so the imported package no longer matches it.
  const carrier = shapes.length === 1 && !shapes[0].surfaceTexture ? sourceCarrier(shapes[0]) : null;
  if (carrier) {
    const bytes = rewrite3mf(carrier);
    if (bytes) return { bytes, preserved: true };
  }
  return {
    bytes: to3mf(shapes.map((shape) => ({ ...printMeshForShape(shape), color: shape.hole ? undefined : shape.color }))),
    preserved: false,
  };
}
