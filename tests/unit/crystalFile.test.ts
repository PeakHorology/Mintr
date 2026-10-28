import { describe, expect, it } from "vitest";
import { CRYSTAL_TRIANGLE_WARNING, crystalSizeNote, stlMegabytes } from "../../apps/web/src/lib/laser/crystalFile";

describe("crystal file size", () => {
  it("works out a binary STL's size", () => {
    expect(stlMegabytes(306_053)).toBeCloseTo(15.3, 1);
    expect(stlMegabytes(2_000_000)).toBeCloseTo(100, 0);
  });

  it("stays quiet for a detailed watch movement", () => {
    expect(crystalSizeNote(306_053)).toBeNull();
  });

  it("speaks up near xTool Studio's 100 MB", () => {
    expect(CRYSTAL_TRIANGLE_WARNING).toBe(1_600_000);
    expect(crystalSizeNote(CRYSTAL_TRIANGLE_WARNING - 1)).toBeNull();
    expect(crystalSizeNote(1_900_000)).toContain("about 95 MB.");
    expect(crystalSizeNote(1_900_000)).toContain("Reduce File Size");
  });
});
