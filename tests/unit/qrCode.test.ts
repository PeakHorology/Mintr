import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { encodeQr, qrSolid } from "@/lib/qrCode";

/** Reads the squares the way a phone would: from pixels, by a decoder Mintr did not write. */
function scan(squares: boolean[][]) {
  const scale = 4;
  const quiet = 4;
  const size = (squares.length + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  squares.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return;
    for (let py = 0; py < scale; py += 1) {
      for (let px = 0; px < scale; px += 1) {
        const at = (((y + quiet) * scale + py) * size + (x + quiet) * scale + px) * 4;
        pixels[at] = 0;
        pixels[at + 1] = 0;
        pixels[at + 2] = 0;
      }
    }
  }));
  return jsQR(pixels, size, size)?.data ?? null;
}

describe("encodeQr", () => {
  it.each([
    "A",
    "https://mintr3d.com",
    "Hello, Mintr! Ünïcödé ✓",
    "x".repeat(120),
    "y".repeat(400),
    "z".repeat(1200),
  ])("makes a code an independent reader decodes: %s", (text) => {
    const squares = encodeQr(text);
    expect(squares).not.toBeNull();
    expect(scan(squares!)).toBe(text);
  });

  it("uses the smallest code that fits, and refuses what cannot", () => {
    expect(encodeQr("A")!.length).toBe(21);
    expect(encodeQr("")).toBeNull();
    expect(encodeQr("x".repeat(3000))).toBeNull();
  });
});

describe("qrSolid", () => {
  const closed = ({ positions, indices }: { positions: number[]; indices: number[] }) => {
    const edges = new Map<string, number>();
    for (let index = 0; index < indices.length; index += 3) {
      [0, 1, 2].forEach((step) => {
        const edge = `${indices[index + step]}:${indices[index + ((step + 1) % 3)]}`;
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      });
    }
    expect(positions.length).toBeGreaterThan(0);
    for (const [edge, times] of edges) {
      const [from, to] = edge.split(":");
      expect(times).toBe(1);
      expect(edges.get(`${to}:${from}`)).toBe(1);
    }
  };

  it("is closed and faces outward, every edge shared by exactly two triangles", () => {
    const solid = qrSolid(encodeQr("https://mintr3d.com")!, 2);
    closed(solid);
    let volume = 0;
    for (let index = 0; index < solid.indices.length; index += 3) {
      const [a, b, c] = [0, 1, 2].map((step) => {
        const at = solid.indices[index + step] * 3;
        return solid.positions.slice(at, at + 3);
      });
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    const dark = encodeQr("https://mintr3d.com")!.flat().filter(Boolean).length;
    expect(volume).toBeGreaterThan(0);
    expect(Math.abs(volume - dark * 2)).toBeLessThan(dark * 2 * 0.01);
  });

  it("keeps two squares touching at a corner apart", () => {
    const solid = qrSolid([[true, false], [false, true]], 1);
    closed(solid);
    const seen = new Set<string>();
    for (let index = 0; index < solid.positions.length; index += 3) {
      const key = solid.positions.slice(index, index + 3).join(",");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("reads the right way round from above: the first row at the back, the first column on the left", () => {
    const squares = encodeQr("A")!;
    const solid = qrSolid(squares, 1);
    // The top face, drawn back into squares from where its triangles sit.
    const seen = squares.map((row) => row.map(() => false));
    for (let index = 0; index < solid.indices.length; index += 3) {
      const corners = [0, 1, 2].map((step) => solid.positions.slice(solid.indices[index + step] * 3, solid.indices[index + step] * 3 + 3));
      if (!corners.every(([, y]) => y === 1)) continue;
      const x = Math.floor((corners[0][0] + corners[1][0] + corners[2][0]) / 3);
      const z = Math.floor((corners[0][2] + corners[1][2] + corners[2][2]) / 3);
      seen[z][x] = true;
    }
    expect(seen).toEqual(squares);
  });
});
