import { describe, expect, it } from "vitest";
import { FontLoader, type FontData } from "three/examples/jsm/loaders/FontLoader.js";
import helvetikerBold from "three/examples/fonts/helvetiker_bold.typeface.json";
import { normalizeGlyphOutline, normalizeTypefaceWinding } from "@/lib/fontOutlineWinding";

// The B from Falcon Punch, a font drawn counter-clockwise: its top hole used to fill in.
const FALCON_B = "m 136 0 l 956 0 q 1013 15 985 0 q 1065 53 1040 29 q 1110 106 1090 76 q 1142 168 1129 136 l 1142 168 l 1217 365 q 1225 404 1225 386 l 1225 404 q 1220 443 1225 424 q 1200 478 1215 463 l 1200 478 q 1225 506 1210 493 q 1256 533 1240 519 q 1285 560 1271 546 q 1306 590 1299 574 l 1306 590 l 1379 785 q 1396 864 1396 826 l 1396 864 q 1378 927 1396 901 q 1321 953 1360 953 l 1321 953 l 550 953 q 456 938 490 953 q 406 883 421 924 l 406 883 l 113 118 q 90 36 90 69 l 90 36 q 136 0 90 0 l 136 0 z m 843 239 l 478 239 q 467 261 467 239 l 467 261 q 474 299 467 274 l 474 299 q 495 336 481 317 q 522 356 510 356 l 522 356 l 865 356 q 913 332 913 356 l 913 332 q 912 328 913 332 q 910 318 911 325 l 910 318 q 899 293 906 307 q 883 267 892 279 q 863 247 874 256 q 843 239 853 239 l 843 239 z m 981 596 l 615 596 q 606 603 608 596 q 604 619 604 610 l 604 619 q 606 639 604 629 q 610 656 607 649 l 610 656 q 632 693 617 674 q 660 713 647 713 l 660 713 l 1003 713 q 1050 688 1050 713 l 1050 688 q 1049 685 1050 689 q 1047 675 1049 682 l 1047 675 q 1035 650 1043 664 q 1019 624 1028 636 q 1000 604 1010 613 q 981 596 990 596 l 981 596 z ";
// A plain square drawn with a cubic curve on one side, outside counter-clockwise, with a square hole.
const CUBIC_O = "m 0 0 l 100 0 b 100 100 130 30 130 70 l 0 100 z m 30 30 l 70 30 l 70 70 l 30 70 z ";

const fontWith = (glyphs: Record<string, string>) =>
  new FontLoader().parse({ resolution: 1000, familyName: "t", boundingBox: { yMin: 0, yMax: 1000 }, underlineThickness: 0, glyphs: Object.fromEntries(Object.entries(glyphs).map(([char, o]) => [char, { ha: 1000, x_min: 0, x_max: 1000, o }])) } as unknown as FontData);

describe("letters from fonts drawn either way round keep their holes", () => {
  it("the B of a counter-clockwise font keeps both holes", () => {
    expect(fontWith({ B: FALCON_B }).generateShapes("B", 100).map((shape) => shape.holes.length)).toEqual([1, 0]);
    const fixed = normalizeTypefaceWinding({ glyphs: { B: { ha: 1144, o: FALCON_B } } });
    const shapes = fontWith({ B: fixed.glyphs.B.o }).generateShapes("B", 100);
    expect(shapes.map((shape) => shape.holes.length)).toEqual([2]);
    expect(fixed.glyphs.B.ha).toBe(1144);
  });

  it("turns curves the right way round too, and still reads a hole", () => {
    const shapes = fontWith({ O: normalizeGlyphOutline(CUBIC_O) }).generateShapes("O", 100);
    expect(shapes.map((shape) => shape.holes.length)).toEqual([1]);
    // The cubic side still bulges out to the right: the shape is as wide as before.
    const xs = shapes[0].getPoints(12).map((point) => point.x);
    expect(Math.max(...xs)).toBeGreaterThan(11);
  });

  it("leaves a font that is already the right way round exactly as it is", () => {
    const glyphs = (helvetikerBold as unknown as { glyphs: Record<string, { o?: string }> }).glyphs;
    for (const char of ["B", "O", "A", "8", "e", "%"]) {
      expect(normalizeGlyphOutline(glyphs[char].o!)).toBe(glyphs[char].o);
    }
  });

  it("leaves outlines it cannot read alone", () => {
    expect(normalizeGlyphOutline("")).toBe("");
    expect(normalizeGlyphOutline("m 0 x l 1 1")).toBe("m 0 x l 1 1");
  });
});
