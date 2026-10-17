import { describe, expect, it } from "vitest";
import { createBooleanTextGeometry, matchedTextDepth, withMatchedTextFootprint } from "@/lib/editorShapeMesh";
import type { WorkplaneShape } from "@/types/sketchforge";

function textShape(bend: { textCircumference?: number; textWrap?: number } = {}): WorkplaneShape {
  return {
    id: "text",
    name: "Text",
    kind: "text",
    color: "#cf101b",
    x: 0,
    z: 0,
    rotation: 0,
    size: 80,
    width: 80,
    depth: 20,
    height: 4,
    text: "PEAK",
    font: "Sans",
    ...bend,
  };
}

function span(geometry: { computeBoundingBox: () => void; boundingBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null }, axis: "x" | "y" | "z") {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error("missing bounds");
  return box.max[axis] - box.min[axis];
}

function bowDirection(geometry: { getAttribute: (name: string) => { count: number; getX: (index: number) => number; getZ: (index: number) => number } }) {
  const position = geometry.getAttribute("position");
  let maxX = 0;
  for (let index = 0; index < position.count; index += 1) {
    maxX = Math.max(maxX, Math.abs(position.getX(index)));
  }
  let centerZ = 0;
  let centerCount = 0;
  let endZ = 0;
  let endCount = 0;
  for (let index = 0; index < position.count; index += 1) {
    const x = Math.abs(position.getX(index));
    const z = position.getZ(index);
    if (x < maxX * 0.08) {
      centerZ += z;
      centerCount += 1;
    } else if (x > maxX * 0.92) {
      endZ += z;
      endCount += 1;
    }
  }
  if (!centerCount || !endCount) throw new Error("missing bow samples");
  return centerZ / centerCount - endZ / endCount;
}

function liftDirection(geometry: { getAttribute: (name: string) => { count: number; getX: (index: number) => number; getY: (index: number) => number } }) {
  const position = geometry.getAttribute("position");
  let maxX = 0;
  for (let index = 0; index < position.count; index += 1) {
    maxX = Math.max(maxX, Math.abs(position.getX(index)));
  }
  let centerY = 0;
  let centerCount = 0;
  let endY = 0;
  let endCount = 0;
  for (let index = 0; index < position.count; index += 1) {
    const x = Math.abs(position.getX(index));
    const y = position.getY(index);
    if (x < maxX * 0.08) {
      centerY += y;
      centerCount += 1;
    } else if (x > maxX * 0.92) {
      endY += y;
      endCount += 1;
    }
  }
  if (!centerCount || !endCount) throw new Error("missing lift samples");
  return centerY / centerCount - endY / endCount;
}

function topNormalY(geometry: {
  computeVertexNormals: () => void;
  getAttribute: (name: string) => { count: number; getY: (index: number) => number };
}) {
  geometry.computeVertexNormals();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < position.count; index += 1) {
    maxY = Math.max(maxY, position.getY(index));
  }
  let sum = 0;
  let count = 0;
  for (let index = 0; index < position.count; index += 1) {
    if (position.getY(index) < maxY - 0.35) continue;
    sum += normal.getY(index);
    count += 1;
  }
  if (!count) throw new Error("missing top face");
  return sum / count;
}

/** How far end-letter faces have turned off vertical. A bent rod tilts them. */
function endFaceTilt(geometry: {
  computeVertexNormals: () => void;
  getAttribute: (name: string) => { count: number; getX: (index: number) => number; getY: (index: number) => number };
}) {
  geometry.computeVertexNormals();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  let maxX = 0;
  for (let index = 0; index < position.count; index += 1) {
    maxX = Math.max(maxX, Math.abs(position.getX(index)));
  }
  let sum = 0;
  let count = 0;
  for (let index = 0; index < position.count; index += 1) {
    if (Math.abs(position.getX(index)) < maxX * 0.82) continue;
    if (normal.getY(index) < 0.2 && Math.abs(normal.getX(index)) < 0.2) continue;
    sum += Math.abs(normal.getX(index));
    count += 1;
  }
  if (!count) throw new Error("missing end face");
  return sum / count;
}

/** Longest distance from the first vertex to nearby vertices. A rigid letter keeps this. */
function letterReach(geometry: { getAttribute: (name: string) => { count: number; getX: (index: number) => number; getY: (index: number) => number; getZ: (index: number) => number } }) {
  const position = geometry.getAttribute("position");
  const originX = position.getX(0);
  const originY = position.getY(0);
  const originZ = position.getZ(0);
  let reach = 0;
  const limit = Math.min(position.count, 48);
  for (let index = 1; index < limit; index += 1) {
    const dx = position.getX(index) - originX;
    const dy = position.getY(index) - originY;
    const dz = position.getZ(index) - originZ;
    reach = Math.max(reach, Math.hypot(dx, dy, dz));
  }
  return reach;
}

describe("text footprint", () => {
  it("updates letter height to match the shape when the width changes", () => {
    const shape = textShape();
    const wider = withMatchedTextFootprint(shape, { width: 120, size: 120 });
    const narrower = withMatchedTextFootprint(shape, { width: 40, size: 40 });
    expect(wider.depth).toBeCloseTo(matchedTextDepth(shape, 120), 3);
    expect(narrower.depth).toBeCloseTo(wider.depth! * (40 / 120), 2);
    const geometry = createBooleanTextGeometry({ ...shape, width: 120, depth: wider.depth ?? 20, size: 120 });
    expect(span(geometry, "z")).toBeCloseTo(wider.depth ?? 0, 1);
    expect(span(geometry, "y")).toBeCloseTo(shape.height, 1);
  });

  it("leaves extrusion height alone when only the letter height is edited", () => {
    const shape = textShape();
    const taller = withMatchedTextFootprint(shape, { depth: 30 });
    expect(taller.width).toBeGreaterThan(shape.width);
    expect(taller.depth).toBe(30);
    const thickness = withMatchedTextFootprint(shape, { height: 8 });
    expect(thickness).toEqual({ height: 8 });
  });
});

describe("text circumference", () => {
  it("keeps text flat on the workplane when both sliders are unset", () => {
    const geometry = createBooleanTextGeometry(textShape());
    expect(span(geometry, "y")).toBeLessThan(8);
    expect(span(geometry, "z")).toBeGreaterThan(12);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox?.min.y ?? 1).toBeCloseTo(0, 3);
  });

  it("bows face-up letters up and down without stretching them", () => {
    const flat = createBooleanTextGeometry(textShape());
    const outward = createBooleanTextGeometry(textShape({ textCircumference: -40 }));
    const inward = createBooleanTextGeometry(textShape({ textCircumference: 40 }));
    const gentle = createBooleanTextGeometry(textShape({ textCircumference: 8 }));
    expect(span(outward, "y")).toBeLessThan(8);
    expect(topNormalY(outward)).toBeGreaterThan(0.15);
    expect(bowDirection(outward)).toBeGreaterThan(1);
    expect(bowDirection(inward)).toBeLessThan(-1);
    expect(letterReach(outward)).toBeCloseTo(letterReach(flat), 2);
    expect(span(gentle, "x")).toBeGreaterThan(span(flat, "x") * 0.85);
    expect(span(gentle, "z") - span(flat, "z")).toBeGreaterThan(0.4);
    outward.computeBoundingBox();
    expect(outward.boundingBox?.min.y ?? 1).toBeCloseTo(0, 3);
  });

  it("wraps rigid letters around a rod bent in and out", () => {
    const flat = createBooleanTextGeometry(textShape());
    const outward = createBooleanTextGeometry(textShape({ textWrap: -40 }));
    const inward = createBooleanTextGeometry(textShape({ textWrap: 40 }));
    const gentle = createBooleanTextGeometry(textShape({ textWrap: 8 }));
    expect(topNormalY(outward)).toBeGreaterThan(0.5);
    expect(liftDirection(outward)).toBeGreaterThan(1);
    expect(liftDirection(inward)).toBeLessThan(-1);
    expect(endFaceTilt(outward)).toBeGreaterThan(0.35);
    expect(span(outward, "z")).toBeLessThan(span(flat, "z") + 2);
    expect(span(outward, "y")).toBeGreaterThan(span(flat, "y") + 4);
    expect(letterReach(outward)).toBeCloseTo(letterReach(flat), 2);
    expect(span(gentle, "x")).toBeGreaterThan(span(flat, "x") * 0.85);
    expect(span(gentle, "y") - span(flat, "y")).toBeGreaterThan(0.4);
    outward.computeBoundingBox();
    expect(outward.boundingBox?.min.y ?? 1).toBeCloseTo(0, 3);
  });
});
