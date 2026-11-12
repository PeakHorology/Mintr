import { describe, expect, it } from "vitest";
import { closedProfilesFromLegacy, materialOutlines, orderedSketchPaths } from "@/lib/sketch/profiles";
import type { SketchPoint, SketchProfile, SketchSegment } from "@/types/sketchforge";

type Seg = [id: string, startId: string, endId: string];

function lines(segments: Seg[]): SketchSegment[] {
  return segments.map(([id, startId, endId]) => ({ id, startId, endId, kind: "line" as const }));
}

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

/** Material area: each outline minus its holes, measured on the corner points. */
function materialArea(profile: SketchProfile): number {
  const byId = new Map(profile.points.map((point) => [point.id, point]));
  const area = (ids: string[]) => {
    let twice = 0;
    for (let index = 0; index < ids.length; index += 1) {
      const a = byId.get(ids[index])!;
      const b = byId.get(ids[(index + 1) % ids.length])!;
      twice += a.x * b.z - b.x * a.z;
    }
    return Math.abs(twice) / 2;
  };
  return closedProfilesFromLegacy(profile).reduce(
    (total, entry) => total + area(entry.pointIds) - entry.holePointIdLoops.reduce((sum, hole) => sum + area(hole), 0),
    0,
  );
}

const P = (id: string, x: number, z: number): SketchPoint => ({ id, x, z });

const CASES: Record<string, { points: SketchPoint[]; segments: Seg[]; area: number }> = {
  "rectangle split by a middle line": {
    points: [P("TL", 0, 10), P("TM", 10, 10), P("TR", 20, 10), P("BR", 20, 0), P("BM", 10, 0), P("BL", 0, 0)],
    segments: [["a", "TL", "TM"], ["b", "TM", "TR"], ["c", "TR", "BR"], ["d", "BR", "BM"], ["e", "BM", "BL"], ["f", "BL", "TL"], ["g", "TM", "BM"]],
    area: 200,
  },
  "two squares touching at one corner": {
    points: [P("a", 0, 0), P("b", 10, 0), P("c", 10, 10), P("d", 0, 10), P("e", 20, 10), P("f", 20, 20), P("g", 10, 20)],
    segments: [["1", "a", "b"], ["2", "b", "c"], ["3", "c", "d"], ["4", "d", "a"], ["5", "c", "e"], ["6", "e", "f"], ["7", "f", "g"], ["8", "g", "c"]],
    area: 200,
  },
  "2x2 grid": {
    points: [
      P("00", 0, 0), P("10", 10, 0), P("20", 20, 0),
      P("01", 0, 10), P("11", 10, 10), P("21", 20, 10),
      P("02", 0, 20), P("12", 10, 20), P("22", 20, 20),
    ],
    segments: [
      ["a", "00", "10"], ["b", "10", "20"], ["c", "01", "11"], ["d", "11", "21"], ["e", "02", "12"], ["f", "12", "22"],
      ["g", "00", "01"], ["h", "01", "02"], ["i", "10", "11"], ["j", "11", "12"], ["k", "20", "21"], ["l", "21", "22"],
    ],
    area: 400,
  },
  bowtie: {
    points: [P("A", -10, 0), P("B", -10, 10), P("S", 0, 5), P("C", 10, 10), P("D", 10, 0)],
    segments: [["ab", "A", "B"], ["bs", "B", "S"], ["sc", "S", "C"], ["cd", "C", "D"], ["ds", "D", "S"], ["sa", "S", "A"]],
    area: 100,
  },
  "plate with a hole and a dangling tail": {
    points: [
      P("a", 0, 0), P("b", 30, 0), P("c", 30, 30), P("d", 0, 30),
      P("h1", 10, 10), P("h2", 20, 10), P("h3", 20, 20), P("h4", 10, 20), P("t", -5, -5),
    ],
    segments: [
      ["1", "a", "b"], ["2", "b", "c"], ["3", "c", "d"], ["4", "d", "a"],
      ["5", "h1", "h2"], ["6", "h2", "h3"], ["7", "h3", "h4"], ["8", "h4", "h1"], ["9", "a", "t"],
    ],
    area: 800,
  },
  "split rectangle with a hole in one cell": {
    points: [
      P("TL", 0, 10), P("TM", 10, 10), P("TR", 20, 10), P("BR", 20, 0), P("BM", 10, 0), P("BL", 0, 0),
      P("h1", 2, 2), P("h2", 6, 2), P("h3", 6, 6), P("h4", 2, 6),
    ],
    segments: [
      ["a", "TL", "TM"], ["b", "TM", "TR"], ["c", "TR", "BR"], ["d", "BR", "BM"], ["e", "BM", "BL"], ["f", "BL", "TL"], ["g", "TM", "BM"],
      ["5", "h1", "h2"], ["6", "h2", "h3"], ["7", "h3", "h4"], ["8", "h4", "h1"],
    ],
    area: 184,
  },
};

describe("sketch faces do not depend on drawing order", () => {
  for (const [name, sketch] of Object.entries(CASES)) {
    it(name, () => {
      const random = seeded(7);
      const areas = new Set<number>();
      for (let trial = 0; trial < 200; trial += 1) {
        const order = shuffled(sketch.segments, random).map(
          (segment): Seg => (random() < 0.5 ? segment : [segment[0], segment[2], segment[1]]),
        );
        areas.add(Math.round(materialArea({ points: sketch.points, segments: lines(order) }) * 1e6) / 1e6);
      }
      expect([...areas]).toEqual([sketch.area]);
    });
  }

  it("ignores construction segments when finding faces", () => {
    const sketch = CASES["rectangle split by a middle line"];
    const profile: SketchProfile = {
      points: sketch.points,
      segments: lines(sketch.segments).map((segment) => (segment.id === "g" ? { ...segment, construction: true } : segment)),
    };
    const outlines = materialOutlines(profile);
    expect(outlines).toHaveLength(1);
    expect(outlines[0].steps.map((step) => step.segment.id).sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(materialArea(profile)).toBe(200);
  });

  it("merges the split rectangle into one outline and reports both cells as faces", () => {
    const sketch = CASES["rectangle split by a middle line"];
    const profile = { points: sketch.points, segments: lines(sketch.segments) };
    const faces = orderedSketchPaths(profile).filter((path) => path.closed);
    expect(faces).toHaveLength(2);
    expect(faces.every((face) => face.steps.length === 4)).toBe(true);
    const outlines = materialOutlines(profile);
    expect(outlines).toHaveLength(1);
    expect(outlines[0].steps).toHaveLength(6);
  });

  it("splits at a junction along the curve's tangent, not its chord", () => {
    // A half-disc bulging down from the chord, cut by a line from the chord's middle to the arc's
    // middle. The arc leaves each end heading straight down, which is a different order around the
    // corner than its chord (along the top). Both halves must be found.
    const r = 10;
    const k = (4 / 3) * Math.tan(Math.PI / 8) * r;
    const points: SketchPoint[] = [
      { id: "L", x: -r, z: 0, handleOut: { x: -r, z: -k } },
      { id: "B", x: 0, z: -r, handleIn: { x: -k, z: -r }, handleOut: { x: k, z: -r } },
      { id: "R", x: r, z: 0, handleIn: { x: r, z: -k } },
      { id: "M", x: 0, z: 0 },
    ];
    const segments: SketchSegment[] = [
      { id: "arc1", startId: "L", endId: "B", kind: "bezier" },
      { id: "arc2", startId: "B", endId: "R", kind: "bezier" },
      { id: "top1", startId: "R", endId: "M", kind: "line" },
      { id: "top2", startId: "M", endId: "L", kind: "line" },
      { id: "cut", startId: "M", endId: "B", kind: "line" },
    ];
    const random = seeded(3);
    for (let trial = 0; trial < 50; trial += 1) {
      const profile = { points, segments: shuffled(segments, random) };
      const faces = orderedSketchPaths(profile).filter((path) => path.closed);
      expect(faces).toHaveLength(2);
      const profiles = closedProfilesFromLegacy(profile);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].area / ((Math.PI * r * r) / 2)).toBeGreaterThan(0.99);
    }
  });

  it("keeps a two-point arc-and-line face that hangs off a junction", () => {
    const k = 5;
    const points: SketchPoint[] = [
      { id: "a", x: 0, z: 0, handleOut: { x: 0, z: k } },
      { id: "b", x: 10, z: 0, handleIn: { x: 10, z: k } },
      { id: "c", x: 10, z: -10 },
      { id: "d", x: 0, z: -10 },
    ];
    const segments: SketchSegment[] = [
      { id: "arc", startId: "a", endId: "b", kind: "bezier" },
      { id: "chord", startId: "a", endId: "b", kind: "line" },
      { id: "s2", startId: "b", endId: "c", kind: "line" },
      { id: "s3", startId: "c", endId: "d", kind: "line" },
      { id: "s4", startId: "d", endId: "a", kind: "line" },
    ];
    const faces = orderedSketchPaths({ points, segments }).filter((path) => path.closed);
    expect(faces).toHaveLength(2);
    const outlines = materialOutlines({ points, segments });
    expect(outlines).toHaveLength(1);
    expect(outlines[0].steps.map((step) => step.segment.id).sort()).toEqual(["arc", "s2", "s3", "s4"]);
  });

  it("leaves a line joining two separate squares as an open path", () => {
    const points = [
      P("a", 0, 0), P("b", 10, 0), P("c", 10, 10), P("d", 0, 10),
      P("e", 20, 0), P("f", 30, 0), P("g", 30, 10), P("h", 20, 10),
    ];
    const segments = lines([
      ["1", "a", "b"], ["2", "b", "c"], ["3", "c", "d"], ["4", "d", "a"],
      ["5", "e", "f"], ["6", "f", "g"], ["7", "g", "h"], ["8", "h", "e"], ["bridge", "b", "e"],
    ]);
    const paths = orderedSketchPaths({ points, segments });
    expect(paths.filter((path) => path.closed)).toHaveLength(2);
    expect(paths.filter((path) => !path.closed).map((path) => path.steps.map((step) => step.segment.id))).toEqual([["bridge"]]);
    expect(materialArea({ points, segments })).toBe(200);
  });
});
