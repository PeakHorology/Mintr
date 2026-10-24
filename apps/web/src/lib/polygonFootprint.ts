/**
 * XZ footprint of a polygon prism, in the same place as
 * `CylinderGeometry(1, 1, height, sides).scale(width / 2, 1, depth / 2)`.
 *
 * That geometry puts its first vertex on +Z (`x = sin θ`, `z = cos θ`).
 * Starting at π/2 and walking with `(cos, sin)` lands on the same vertices
 * and stays counterclockwise when viewed from above, so an extrude along +Y
 * keeps a positive volume. A profile that starts on +X sits half a side off,
 * and Push Pull / fillet edges then cut across the faces.
 */
export function polygonFootprint(sides: number, width: number, depth: number) {
  const count = Math.max(3, Math.round(sides));
  const points: Array<{ x: number; z: number }> = [];
  for (let index = 0; index < count; index += 1) {
    const angle = Math.PI / 2 + (2 * Math.PI * index) / count;
    points.push({
      x: Math.cos(angle) * (width / 2),
      z: Math.sin(angle) * (depth / 2),
    });
  }
  return points;
}
