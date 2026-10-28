import { describe, expect, it } from "vitest";
import {
  flattenLoop,
  greyForTracing,
  groupIntoPieces,
  lookAtPicture,
  traceLogo,
  type TracePicture,
} from "../../apps/web/src/lib/laser/logoTrace";

/** A white picture with ink wherever `ink(x, y)` says. */
function picture(width: number, height: number, ink: (x: number, y: number) => boolean, transparentPaper = false): TracePicture {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const dark = ink(x + 0.5, y + 0.5);
      const value = dark ? 20 : 240;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = transparentPaper && !dark ? 0 : 255;
    }
  }
  return { width, height, data };
}

const ring = (x: number, y: number) => {
  const r = Math.hypot(x - 300, y - 300);
  return r < 200 && r > 120;
};
const square = (x: number, y: number) => x > 650 && x < 850 && y > 200 && y < 400;

function trace(source: TracePicture, overrides: Partial<Parameters<typeof traceLogo>[1]> = {}) {
  const grey = greyForTracing(source);
  const look = lookAtPicture(grey);
  const result = traceLogo(grey, { threshold: look.threshold, invert: false, speckle: 20, smoothness: 1, useTransparency: false, ...overrides });
  const flat = result.loops.map((loop) => ({ points: flattenLoop(loop, 0.25), area: loop.area }));
  return { grey, look, result, flat, pieces: groupIntoPieces(flat) };
}

describe("logo tracing", () => {
  it("finds a ring with its hole and a square, as two pieces", () => {
    const { pieces, look } = trace(picture(1000, 600, (x, y) => ring(x, y) || square(x, y)));
    expect(look.looksLikePhoto).toBe(false);
    expect(look.darkBackground).toBe(false);
    expect(pieces).toHaveLength(2);
    const withHole = pieces.find((piece) => piece.holes.length === 1);
    expect(withHole).toBeDefined();
    // The ring's outside stays round: every point is close to radius 200.
    for (const point of withHole!.outer) expect(Math.abs(Math.hypot(point.x - 300, point.y - 300) - 200)).toBeLessThan(1.5);
    for (const point of withHole!.holes[0]) expect(Math.abs(Math.hypot(point.x - 300, point.y - 300) - 120)).toBeLessThan(1.5);
  });

  it("keeps a square's corners sharp and its sides straight", () => {
    const { result } = trace(picture(1000, 600, square));
    expect(result.loops).toHaveLength(1);
    const lines = result.loops[0].pieces.filter((piece) => piece.kind === "line");
    // Four corners, each a pair of straight pieces through the corner.
    expect(lines.length).toBeGreaterThanOrEqual(8);
    const near = (value: number, target: number) => Math.abs(value - target) < 0.2;
    const corners = lines.map((piece) => piece.to).filter((point) => (near(point.x, 650) || near(point.x, 850)) && (near(point.y, 200) || near(point.y, 400)));
    expect(corners).toHaveLength(4);
  });

  it("drops specks of dust but keeps the logo", () => {
    // Little 3-pixel blobs scattered about.
    const dusty = (x: number, y: number) => square(x, y) || (Math.floor(x) % 97 < 3 && Math.floor(y) % 89 < 3);
    expect(trace(picture(1000, 600, dusty)).result.loops).toHaveLength(1);
    expect(trace(picture(1000, 600, dusty), { speckle: 0 }).result.loops.length).toBeGreaterThan(1);
  });

  it("enlarges a small picture and still finds the ring", () => {
    const small = picture(100, 60, (x, y) => ring(x * 10, y * 10));
    const { grey, pieces } = trace(small);
    expect(Math.max(grey.width, grey.height)).toBe(600);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].holes).toHaveLength(1);
  });

  it("uses transparency as the outline when the paper is see-through", () => {
    const { look } = trace(picture(400, 300, (x, y) => x > 100 && x < 300 && y > 100 && y < 200, true));
    expect(look.transparentBackground).toBe(true);
  });

  it("spots a light logo on a dark background, and a photo", () => {
    const negative = picture(800, 600, (x, y) => !square(x + 300, y));
    expect(lookAtPicture(greyForTracing(negative)).darkBackground).toBe(true);
    const width = 400;
    const height = 300;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      const x = index % width;
      const shade = Math.round((x / width) * 255);
      data.set([shade, shade, shade, 255], index * 4);
    }
    expect(lookAtPicture(greyForTracing({ width, height, data })).looksLikePhoto).toBe(true);
  });

  it("joins ink that only touches at a corner", () => {
    // Two squares meeting at one corner trace as a single outline.
    const touching = (x: number, y: number) => (x > 100 && x < 300 && y > 100 && y < 300) || (x > 300 && x < 500 && y > 300 && y < 500);
    const { result } = trace(picture(600, 600, touching), { speckle: 0 });
    expect(result.loops.filter((loop) => loop.area > 0)).toHaveLength(1);
  });
});
