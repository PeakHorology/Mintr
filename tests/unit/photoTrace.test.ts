import { describe, expect, it } from "vitest";
import { flattenLoop, joinCurves, traceMask } from "../../apps/web/src/lib/laser/logoTrace";
import {
  applyHomography,
  homographyFrom,
  invertHomography,
  orderCorners,
  paperOrientation,
  scaleFromDpi,
  scaleFromReferences,
  type Point,
} from "../../apps/web/src/lib/photoTrace/geometry";
import { findPaper, type Backdrop } from "../../apps/web/src/lib/photoTrace/paper";
import { pictureDpi, straightenPaper, type Rgba } from "../../apps/web/src/lib/photoTrace/picture";
import { applyStrokes, growMask, maskBounds, segmentByColour, sheetIn } from "../../apps/web/src/lib/photoTrace/segment";
import { tracedLoopToSketch } from "../../apps/web/src/lib/photoTrace/toSketch";

type Colour = [number, number, number];

const LETTER = { width: 215.9, height: 279.4 };
/** Where the sheet's corners land in the photo: tilted and seen a little in perspective. */
const PHOTO_CORNERS: Point[] = [{ x: 150, y: 40 }, { x: 430, y: 60 }, { x: 460, y: 460 }, { x: 120, y: 440 }];
const DISC = { x: 108, y: 140, radius: 30 };

/**
 * A photo of a disc lying on a sheet of Letter paper, on a table. Each photo pixel is
 * mapped back onto the sheet to decide what it shows, as a camera above it would see.
 */
function photo(colours: { table: Colour; paper: Colour; object: Colour }): Rgba {
  const width = 600;
  const height = 500;
  const sheetToPhoto = homographyFrom(
    [{ x: 0, y: 0 }, { x: LETTER.width, y: 0 }, { x: LETTER.width, y: LETTER.height }, { x: 0, y: LETTER.height }],
    PHOTO_CORNERS,
  )!;
  const photoToSheet = invertHomography(sheetToPhoto)!;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = applyHomography(photoToSheet, { x: x + 0.5, y: y + 0.5 });
      const onSheet = at.x >= 0 && at.y >= 0 && at.x <= LETTER.width && at.y <= LETTER.height;
      const onDisc = Math.hypot(at.x - DISC.x, at.y - DISC.y) <= DISC.radius;
      const colour = !onSheet ? colours.table : onDisc ? colours.object : colours.paper;
      // A little grain, as a real photo has.
      const grain = ((x * 7919 + y * 104729) % 11) - 5;
      data.set([colour[0] + grain, colour[1] + grain, colour[2] + grain, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function traceDisc(backdrop: Backdrop, colours: { table: Colour; paper: Colour; object: Colour }) {
  const picture = photo(colours);
  const corners = findPaper(picture, backdrop);
  expect(corners).not.toBeNull();
  corners!.forEach((corner, index) => {
    expect(Math.hypot(corner.x - PHOTO_CORNERS[index].x, corner.y - PHOTO_CORNERS[index].y)).toBeLessThan(4);
  });
  const sheet = paperOrientation(corners!, "letter");
  expect(sheet.width).toBeCloseTo(LETTER.width);
  expect(sheet.height).toBeCloseTo(LETTER.height);
  const mmPerPixel = 0.5;
  const straight = straightenPaper(picture, corners!, sheet, mmPerPixel)!;
  const mask = segmentByColour(straight, [{ x: DISC.x / mmPerPixel, y: DISC.y / mmPerPixel, keep: true }], { backdrop, sensitivity: 0.5, ignoreShadows: 0.6 }, "whole");
  const bounds = maskBounds(mask, straight.width)!;
  return { width: bounds.width * mmPerPixel, height: bounds.height * mmPerPixel };
}

describe("trace from photo: paper", () => {
  it("finds white paper and measures the object on it at true size", () => {
    const size = traceDisc("white", { table: [120, 96, 72], paper: [236, 234, 228], object: [60, 64, 70] });
    expect(size.width).toBeGreaterThan(58);
    expect(size.width).toBeLessThan(62);
    expect(size.height).toBeGreaterThan(58);
    expect(size.height).toBeLessThan(62);
  });

  it("finds black paper, with a shiny part bright against it", () => {
    const size = traceDisc("black", { table: [176, 136, 96], paper: [18, 18, 20], object: [205, 206, 212] });
    expect(size.width).toBeGreaterThan(58);
    expect(size.width).toBeLessThan(62);
    expect(size.height).toBeGreaterThan(58);
    expect(size.height).toBeLessThan(62);
  });

  it("puts corners in order whichever way they were found", () => {
    const shuffled = [PHOTO_CORNERS[2], PHOTO_CORNERS[0], PHOTO_CORNERS[3], PHOTO_CORNERS[1]];
    expect(orderCorners(shuffled)).toEqual(PHOTO_CORNERS);
  });

  it("maps the four corners exactly and back again", () => {
    const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const map = homographyFrom(square, PHOTO_CORNERS)!;
    const back = invertHomography(map)!;
    square.forEach((corner, index) => {
      const there = applyHomography(map, corner);
      expect(there.x).toBeCloseTo(PHOTO_CORNERS[index].x, 6);
      expect(there.y).toBeCloseTo(PHOTO_CORNERS[index].y, 6);
      const home = applyHomography(back, there);
      expect(home.x).toBeCloseTo(corner.x, 6);
      expect(home.y).toBeCloseTo(corner.y, 6);
    });
  });

  it("reads the sheet, not the table, as the background when the photo isn't straightened", () => {
    const picture = photo({ table: [150, 100, 55], paper: [236, 234, 228], object: [40, 36, 36] });
    const area = sheetIn(picture, "white");
    expect(Array.isArray(area)).toBe(true);
    const sheetToPhoto = homographyFrom(
      [{ x: 0, y: 0 }, { x: LETTER.width, y: 0 }, { x: LETTER.width, y: LETTER.height }, { x: 0, y: LETTER.height }],
      PHOTO_CORNERS,
    )!;
    const click = applyHomography(sheetToPhoto, DISC);
    const mask = segmentByColour(picture, [{ ...click, keep: true }], { backdrop: "white", sensitivity: 0.5, ignoreShadows: 0.6 }, area);
    // Only the disc, about 60 mm across at roughly 1.3 photo pixels to the millimetre: never the whole sheet.
    const bounds = maskBounds(mask, picture.width)!;
    expect(bounds.width).toBeGreaterThan(60);
    expect(bounds.width).toBeLessThan(110);
    expect(mask[Math.round(click.y) * picture.width + Math.round(click.x)]).toBe(1);
  });
});

describe("trace from photo: typed distances", () => {
  it("uses one distance as one scale", () => {
    const scale = scaleFromReferences([{ a: { x: 0, y: 0 }, b: { x: 300, y: 400 }, mm: 5 }])!;
    expect(scale.across).toBeCloseTo(0.01);
    expect(scale.down).toBeCloseTo(0.01);
  });

  it("corrects a photo stretched differently across and down, and the third distance checks out", () => {
    const across = 0.01;
    const down = 0.0102;
    const pair = (b: Point) => ({ a: { x: 100, y: 100 }, b: { x: 100 + b.x, y: 100 + b.y }, mm: Math.hypot(b.x * across, b.y * down) });
    const scale = scaleFromReferences([pair({ x: 1000, y: 0 }), pair({ x: 0, y: 900 }), pair({ x: 600, y: 600 })])!;
    expect(scale.across).toBeCloseTo(across, 6);
    expect(scale.down).toBeCloseTo(down, 6);
    for (const check of scale.checks) expect(Math.abs(check.percentOff)).toBeLessThan(0.01);
  });

  it("shows when a distance was typed wrong", () => {
    const scale = scaleFromReferences([
      { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, mm: 10 },
      { a: { x: 0, y: 0 }, b: { x: 0, y: 1000 }, mm: 10 },
      { a: { x: 0, y: 0 }, b: { x: 1000, y: 1000 }, mm: 15 },
    ])!;
    expect(Math.max(...scale.checks.map((check) => Math.abs(check.percentOff)))).toBeGreaterThan(2);
  });

  it("ignores a distance with no length", () => {
    expect(scaleFromReferences([{ a: { x: 5, y: 5 }, b: { x: 5, y: 5 }, mm: 3 }])).toBeNull();
  });
});

describe("trace from photo: scans", () => {
  it("reads a PNG's resolution", () => {
    const bytes = new Uint8Array(8 + 25 + 21);
    const view = new DataView(bytes.buffer);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    view.setUint32(8, 13);
    bytes.set([73, 72, 68, 82], 12);
    view.setUint32(33, 9);
    bytes.set([112, 72, 89, 115], 37);
    view.setUint32(41, 47244);
    view.setUint32(45, 47244);
    bytes[49] = 1;
    expect(pictureDpi(bytes)).toBeCloseTo(1200, 0);
  });

  it("reads a JPEG's resolution, and ignores a camera's 72", () => {
    const jpeg = (units: number, density: number) => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 74, 70, 73, 70, 0, 1, 1, units, density >> 8, density & 255, density >> 8, density & 255, 0, 0, 0xff, 0xda, 0, 2]);
      return pictureDpi(bytes);
    };
    expect(jpeg(1, 600)).toBe(600);
    expect(jpeg(0, 1)).toBeNull();
    expect(scaleFromDpi(1200)).toBeCloseTo(0.021167, 5);
  });

  it("knows nothing about other files", () => {
    expect(pictureDpi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]))).toBeNull();
  });
});

describe("trace from photo: fit gap and outline", () => {
  const width = 40;
  const square = new Uint8Array(width * width);
  for (let y = 15; y < 25; y += 1) for (let x = 15; x < 25; x += 1) square[y * width + x] = 1;

  it("grows and shrinks an outline by the gap", () => {
    expect(maskBounds(growMask(square, width, width, 2), width)).toEqual({ minX: 13, minY: 13, width: 14, height: 14 });
    expect(maskBounds(growMask(square, width, width, -2), width)).toEqual({ minX: 17, minY: 17, width: 6, height: 6 });
    expect(maskBounds(growMask(square, width, width, 0), width)).toEqual({ minX: 15, minY: 15, width: 10, height: 10 });
  });

  it("traces the outline of a mask", () => {
    const result = traceMask(square, width, width, { speckle: 2, smoothness: 0 });
    expect(result.loops).toHaveLength(1);
    expect(Math.abs(result.loops[0].area)).toBeCloseTo(100, 0);
  });
});

describe("trace from photo: into the sketch", () => {
  let next = 0;
  const makeId = (kind: string) => `${kind}-${(next += 1)}`;
  const place = (point: Point) => ({ x: point.x, z: -point.y });

  it("keeps curves as curves with their handles", () => {
    const made = tracedLoopToSketch(
      {
        start: { x: 0, y: 5 },
        pieces: [
          { kind: "curve", c1: { x: 0, y: 2 }, c2: { x: 2, y: 0 }, to: { x: 5, y: 0 } },
          { kind: "curve", c1: { x: 8, y: 0 }, c2: { x: 10, y: 2 }, to: { x: 10, y: 5 } },
          { kind: "curve", c1: { x: 10, y: 8 }, c2: { x: 8, y: 10 }, to: { x: 5, y: 10 } },
          { kind: "curve", c1: { x: 2, y: 10 }, c2: { x: 0, y: 8 }, to: { x: 0, y: 5 } },
        ],
      },
      place,
      makeId,
      "region",
    );
    expect(made.points).toHaveLength(4);
    expect(made.segments.every((segment) => segment.kind === "bezier" && segment.regionId === "region")).toBe(true);
    expect(made.points.every((point) => point.mode === "smooth")).toBe(true);
    expect(made.points[0].handleOut).toEqual({ x: 0, z: -2 });
    expect(made.points[0].handleIn).toEqual({ x: 0, z: -8 });
  });

  it("leaves out points in the middle of a straight side", () => {
    const made = tracedLoopToSketch(
      {
        start: { x: 5, y: 0 },
        pieces: [
          { kind: "line", to: { x: 10, y: 0 } },
          { kind: "line", to: { x: 10, y: 5 } },
          { kind: "line", to: { x: 10, y: 10 } },
          { kind: "line", to: { x: 5, y: 10 } },
          { kind: "line", to: { x: 0, y: 10 } },
          { kind: "line", to: { x: 0, y: 5 } },
          { kind: "line", to: { x: 0, y: 0 } },
          { kind: "line", to: { x: 5, y: 0 } },
        ],
      },
      place,
      makeId,
    );
    expect(made.points.map((point) => [point.x, -point.z]).sort()).toEqual([[0, 0], [0, 10], [10, 0], [10, 10]]);
    expect(made.segments).toHaveLength(4);
    expect(made.segments.every((segment) => segment.kind === "line")).toBe(true);
  });
});

describe("trace from photo: fewer points", () => {
  it("joins a traced circle's many small curves into a few, staying on the circle", () => {
    const size = 400;
    const mask = new Uint8Array(size * size);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (Math.hypot(x + 0.5 - 200, y + 0.5 - 200) <= 150) mask[y * size + x] = 1;
    const [loop] = traceMask(mask, size, size, { speckle: 4, smoothness: 1 }).loops;
    const joined = joinCurves(loop, 0.75);
    expect(joined.pieces.length).toBeLessThan(loop.pieces.length / 3);
    expect(joined.pieces.length).toBeLessThanOrEqual(8);
    for (const point of flattenLoop(joined, 0.05)) expect(Math.abs(Math.hypot(point.x - 200, point.y - 200) - 150)).toBeLessThan(1.2);
  });

  it("gives a slightly rough, slightly tilted block four sides", () => {
    const width = 600;
    const height = 400;
    const mask = new Uint8Array(width * height);
    const rough = (x: number, y: number) => (((x * 7919 + y * 104729) % 13) / 13 - 0.5) * 1.2;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x > 100 + rough(x, y) && x < 500 && y > 100 + 0.03 * (x - 100) && y < 300 + rough(x, y)) mask[y * width + x] = 1;
      }
    }
    const [loop] = traceMask(mask, width, height, { speckle: 14, smoothness: 1 }).loops;
    expect(joinCurves(loop, 1.25).pieces.length).toBeLessThanOrEqual(5);
  });

  it("finds the corners of a block whose corners the photo softened", () => {
    const width = 600;
    const height = 400;
    const mask = new Uint8Array(width * height);
    // A 300 × 160 block with corners rounded off by 3 pixels, as a slightly blurry photo gives.
    const soft = (x: number, y: number) => Math.hypot(Math.max(Math.abs(x - 300) - 147, 0), Math.max(Math.abs(y - 200) - 77, 0)) <= 3;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (soft(x + 0.5, y + 0.5)) mask[y * width + x] = 1;
    const [loop] = traceMask(mask, width, height, { speckle: 14, smoothness: 1.33 }).loops;
    const joined = joinCurves(loop, 1.25);
    expect(loop.pieces.every((piece) => piece.kind === "curve")).toBe(true);
    expect(joined.pieces.filter((piece) => piece.kind === "line")).toHaveLength(4);
    expect(joined.pieces.length).toBeLessThanOrEqual(8);
  });

  it("keeps a square's corners sharp", () => {
    const size = 100;
    const mask = new Uint8Array(size * size);
    for (let y = 20; y < 80; y += 1) for (let x = 20; x < 80; x += 1) mask[y * size + x] = 1;
    const [loop] = traceMask(mask, size, size, { speckle: 4, smoothness: 1 }).loops;
    const joined = joinCurves(loop, 0.75);
    expect(joined.pieces).toHaveLength(4);
    expect(joined.pieces.every((piece) => piece.kind === "line")).toBe(true);
    const points = flattenLoop(joined, 0.05);
    for (const corner of [[20, 20], [80, 20], [80, 80], [20, 80]]) {
      expect(Math.min(...points.map((point) => Math.hypot(point.x - corner[0], point.y - corner[1])))).toBeLessThan(0.5);
    }
  });
});

describe("trace from photo: clean-up", () => {
  it("paints in and erases in the order the strokes were drawn", () => {
    const width = 40;
    const height = 20;
    const mask = new Uint8Array(width * height);
    for (let y = 5; y < 15; y += 1) for (let x = 5; x < 15; x += 1) mask[y * width + x] = 1;
    const result = applyStrokes(mask, width, height, [
      // A straight line from the square out to the right fills a band two pixels either side.
      { erase: false, radius: 2, points: [{ x: 10, y: 10 }, { x: 35, y: 10 }] },
      // Then the square's top-left corner is rubbed out.
      { erase: true, radius: 3, points: [{ x: 6, y: 6 }] },
    ]);
    expect(result[10 * width + 30]).toBe(1);
    expect(result[13 * width + 30]).toBe(0);
    expect(result[6 * width + 6]).toBe(0);
    expect(result[12 * width + 12]).toBe(1);
    // The trace itself is left alone, so a re-trace can be painted over again.
    expect(mask[6 * width + 6]).toBe(1);
  });

  it("draws on an empty picture when nothing has been clicked yet", () => {
    const result = applyStrokes(null, 10, 10, [{ erase: false, radius: 1.5, points: [{ x: 5, y: 5 }] }]);
    expect(maskBounds(result, 10)).toEqual({ minX: 4, minY: 4, width: 2, height: 2 });
  });
});
