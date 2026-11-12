import { describe, expect, it } from "vitest";
import { toStl } from "@/lib/stlExport";
import { importedShapeFromStl } from "@/lib/stlImport";

/** A Mintr (Y up) box 10 wide, 40 tall and 6 deep. */
function tallBox() {
  const w = 10, h = 40, d = 6;
  const vertices: [number, number, number][] = [];
  for (const x of [-w / 2, w / 2]) for (const y of [0, h]) for (const z of [-d / 2, d / 2]) vertices.push([x, y, z]);
  const faces: [number, number, number][] = [
    [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3],
  ];
  return { vertices, faces };
}

describe("STL export then import", () => {
  it("stands a part back up the way it was saved when keeping the file's orientation", () => {
    const bytes = toStl([tallBox() as never]);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const kept = importedShapeFromStl("box.stl", buffer, "keep-orientation");
    expect(kept.width).toBeCloseTo(10, 4);
    expect(kept.height).toBeCloseTo(40, 4);
    expect(kept.depth).toBeCloseTo(6, 4);
  });
});
