import { describe, expect, it } from "vitest";
import {
  applyTugs,
  buildSmoothNet,
  ccStep,
  clampSmoothLevel,
  emptyTags,
  finishSmooth,
  findMirrorPartners,
  nearestFlatFace,
  netStencil,
  planSmooth,
  runSmoothPlan,
  limitPositions,
  mirrorPartners,
  netEdges,
  polygonize,
  softWeights,
  type Vec3,
} from "@/lib/smoothSubdivision";

/** A cube from 0 to `s` as 12 triangles, diagonals running different ways on different faces. */
function cubeSoup(s = 10): number[] {
  const v: Vec3[] = [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [0, 4, 7, 3], [1, 2, 6, 5]];
  const soup: number[] = [];
  quads.forEach(([a, b, c, d], i) => {
    const tris = i % 2 === 0 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
    for (const tri of tris) for (const k of tri) soup.push(...v[k]);
  });
  return soup;
}

function volume(p: ArrayLike<number>) {
  let sum = 0;
  for (let i = 0; i < p.length; i += 9) {
    sum += p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7])
      - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6])
      + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
  }
  return sum / 6;
}

function closed(p: ArrayLike<number>) {
  const key = (i: number) => `${p[i].toFixed(5)},${p[i + 1].toFixed(5)},${p[i + 2].toFixed(5)}`;
  const edges = new Map<string, number>();
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k += 1) {
      const e = `${key(i + k * 3)}>${key(i + ((k + 1) % 3) * 3)}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  for (const [edge, count] of edges) {
    const [a, b] = edge.split(">");
    if (count !== 1 || edges.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
}

describe("smooth subdivision", () => {
  it("merges a cube's triangles back into six squares", () => {
    const mesh = polygonize(cubeSoup())!;
    expect(mesh.positions.length / 3).toBe(8);
    expect(mesh.faceStart.length - 1).toBe(6);
    expect(mesh.faceVerts.length).toBe(24);
  });

  it("turns a cube into 24 quads that round it off, closed and inside the cube", () => {
    const cube = polygonize(cubeSoup())!;
    const { mesh } = ccStep(cube, emptyTags(cube));
    expect(mesh.faceStart.length - 1).toBe(24);
    expect(mesh.positions.length / 3).toBe(26);
    const level1 = finishSmooth(mesh, emptyTags(mesh), 1).positions;
    const level2 = finishSmooth(mesh, emptyTags(mesh), 2).positions;
    expect(level2.length).toBe(level1.length * 4);
    expect(closed(level2)).toBe(true);
    const v = volume(level2);
    // The limit of a cube is a rounded blob of about 30 % of its volume.
    expect(v).toBeGreaterThan(250);
    expect(v).toBeLessThan(1000);
  });

  it("keeps the bottom flat on the bed when asked", () => {
    const cube = polygonize(cubeSoup())!;
    const smooth = buildSmoothNet(cube, { keepBottomFlat: true, detail: 0, tugs: [] });
    const p = finishSmooth(smooth.net, smooth.tags, 3).positions;
    let minY = Infinity;
    let onBed = 0;
    for (let i = 1; i < p.length; i += 3) {
      minY = Math.min(minY, p[i]);
      if (Math.abs(p[i]) < 1e-9) onBed += 1;
    }
    expect(minY).toBeCloseTo(0, 9);
    expect(onBed).toBeGreaterThan(50);
    expect(closed(p)).toBe(true);
    // Rounder than plain smoothing would leave it: more of the cube survives.
    const free = buildSmoothNet(cube, { keepBottomFlat: false, detail: 0, tugs: [] });
    expect(volume(p)).toBeGreaterThan(volume(finishSmooth(free.net, free.tags, 3).positions));
  });

  it("puts a pulled point exactly where it was dropped", () => {
    const cube = polygonize(cubeSoup())!;
    const { mesh, tags } = ccStep(cube, emptyTags(cube));
    const before = limitPositions(mesh, tags);
    const target: Vec3 = [before[6 * 3] + 2, before[6 * 3 + 1] + 3, before[6 * 3 + 2] - 1];
    const pulled = applyTugs(mesh, tags, new Map([[6, target]]));
    const after = limitPositions(pulled, tags);
    for (let k = 0; k < 3; k += 1) expect(after[6 * 3 + k]).toBeCloseTo(target[k], 6);
    // Its neighbours come along a little, not all the way.
    const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
    expect(moved).toBeLessThan(0.6 * Math.hypot(2, 3, 1));
  });

  it("hits two neighbouring pulls at once", () => {
    const cube = polygonize(cubeSoup())!;
    const { mesh, tags } = ccStep(cube, emptyTags(cube));
    const before = limitPositions(mesh, tags);
    const ta: Vec3 = [before[6 * 3] + 3, before[6 * 3 + 1], before[6 * 3 + 2]];
    const tb: Vec3 = [before[7 * 3], before[7 * 3 + 1] + 3, before[7 * 3 + 2]];
    const after = limitPositions(applyTugs(mesh, tags, new Map([[6, ta], [7, tb]])), tags);
    for (let k = 0; k < 3; k += 1) {
      expect(after[6 * 3 + k]).toBeCloseTo(ta[k], 5);
      expect(after[7 * 3 + k]).toBeCloseTo(tb[k], 5);
    }
  });

  it("keeps a stored pull through a rebuild and drops one whose point is gone", () => {
    const cube = polygonize(cubeSoup())!;
    const first = buildSmoothNet(cube, { keepBottomFlat: false, detail: 0, tugs: [] });
    const at: Vec3 = [first.keys[6 * 3], first.keys[6 * 3 + 1], first.keys[6 * 3 + 2]];
    const to: Vec3 = [at[0] + 4, at[1] + 4, at[2] + 4];
    const rebuilt = buildSmoothNet(cube, { keepBottomFlat: false, detail: 0, tugs: [{ detail: 0, at, to }, { detail: 0, at: [99, 99, 99], to: [0, 0, 0] }] });
    expect(rebuilt.applied).toHaveLength(1);
    expect(rebuilt.dropped).toBe(1);
    const limit = limitPositions(rebuilt.net, rebuilt.tags);
    for (let k = 0; k < 3; k += 1) expect(limit[6 * 3 + k]).toBeCloseTo(to[k], 5);
  });

  it("keeps the rough pulls when the detail goes up, and rests the fine ones when it comes down", () => {
    const cube = polygonize(cubeSoup())!;
    const rough = buildSmoothNet(cube, { keepBottomFlat: false, detail: 0, tugs: [] });
    const at: Vec3 = [rough.keys[6 * 3], rough.keys[6 * 3 + 1], rough.keys[6 * 3 + 2]];
    const to: Vec3 = [at[0] + 3, at[1] + 3, at[2] + 3];
    const finer = buildSmoothNet(cube, { keepBottomFlat: false, detail: 1, tugs: [{ detail: 0, at, to }] });
    expect(finer.applied).toHaveLength(1);
    expect(finer.dropped).toBe(0);
    // The finer net still bulges where the rough pull put it.
    const reach = (net: typeof finer) => {
      const limit = limitPositions(net.net, net.tags);
      let best = Infinity;
      for (let v = 0; v < limit.length / 3; v += 1) best = Math.min(best, Math.hypot(limit[v * 3] - to[0], limit[v * 3 + 1] - to[1], limit[v * 3 + 2] - to[2]));
      return best;
    };
    expect(reach(finer)).toBeLessThan(1);
    const fine = { detail: 1, at: [finer.keys[0], finer.keys[1], finer.keys[2]] as Vec3, to: [0, 0, -5] as Vec3 };
    const lowered = buildSmoothNet(cube, { keepBottomFlat: false, detail: 0, tugs: [{ detail: 0, at, to }, fine] });
    expect(lowered.resting).toEqual([fine]);
    expect(lowered.dropped).toBe(0);
    const raised = buildSmoothNet(cube, { keepBottomFlat: false, detail: 1, tugs: [{ detail: 0, at, to }, fine] });
    expect(raised.applied).toHaveLength(2);
  });

  it("lets a finer pull ride along when the rough shape is pulled again", () => {
    const cube = polygonize(cubeSoup())!;
    const rough = buildSmoothNet(cube, { keepBottomFlat: false, detail: 1, tugs: [] });
    // A fine point near the top, pulled out 2 along x.
    let v = 0;
    for (let i = 0; i < rough.keys.length / 3; i += 1) if (rough.keys[i * 3 + 1] > rough.keys[v * 3 + 1]) v = i;
    const from: Vec3 = [rough.before[v * 3], rough.before[v * 3 + 1], rough.before[v * 3 + 2]];
    const fine = { detail: 1, at: [rough.keys[v * 3], rough.keys[v * 3 + 1], rough.keys[v * 3 + 2]] as Vec3, from, to: [from[0] + 2, from[1], from[2]] as Vec3 };
    // Then the whole top is lifted by a rough pull on a top corner.
    const coarse = buildSmoothNet(cube, { keepBottomFlat: false, detail: 0, tugs: [] });
    const corner = 6;
    const lift = { detail: 0, at: [coarse.keys[corner * 3], coarse.keys[corner * 3 + 1], coarse.keys[corner * 3 + 2]] as Vec3, to: [coarse.keys[corner * 3], coarse.keys[corner * 3 + 1] + 6, coarse.keys[corner * 3 + 2]] as Vec3 };
    const both = buildSmoothNet(cube, { keepBottomFlat: false, detail: 1, tugs: [lift, fine] });
    expect(both.applied).toHaveLength(2);
    expect(both.dropped).toBe(0);
    const limit = limitPositions(both.net, both.tags);
    // The fine point keeps its 2 along x from wherever the lifted surface now is.
    for (let k = 0; k < 3; k += 1) expect(limit[v * 3 + k]).toBeCloseTo(both.before[v * 3 + k] + (k === 0 ? 2 : 0), 5);
  });

  it("makes a hand-picked edge sharp", () => {
    const cube = polygonize(cubeSoup())!;
    const plain = buildSmoothNet(cube, { keepBottomFlat: false, detail: 0, tugs: [] });
    const edges = netEdges(plain.net);
    const [a, b] = [edges[0], edges[1]];
    const crease = { detail: 0, a: [plain.keys[a * 3], plain.keys[a * 3 + 1], plain.keys[a * 3 + 2]] as Vec3, b: [plain.keys[b * 3], plain.keys[b * 3 + 1], plain.keys[b * 3 + 2]] as Vec3 };
    const sharp = buildSmoothNet(cube, { keepBottomFlat: false, detail: 0, tugs: [], creases: [crease] });
    expect(sharp.creasesApplied).toHaveLength(1);
    expect(sharp.creaseEnds).toEqual([[a, b]]);
    // A sharp edge keeps more of the cube there than the round one.
    expect(volume(finishSmooth(sharp.net, sharp.tags, 2).positions)).toBeGreaterThan(volume(finishSmooth(plain.net, plain.tags, 2).positions));
    // Two points that are not neighbours make no edge.
    const c = [...Array(plain.keys.length / 3).keys()].find((v) => v !== a && ![...edges].some((_, i) => i % 2 === 0 && ((edges[i] === a && edges[i + 1] === v) || (edges[i] === v && edges[i + 1] === a))))!;
    const far = { detail: 0, a: crease.a, b: [plain.keys[c * 3], plain.keys[c * 3 + 1], plain.keys[c * 3 + 2]] as Vec3 };
    expect(buildSmoothNet(cube, { keepBottomFlat: false, detail: 0, tugs: [], creases: [far] }).creasesApplied).toHaveLength(0);
  });

  it("finds each point's twin across the middle", () => {
    const cube = polygonize(cubeSoup())!;
    const { keys } = buildSmoothNet(cube, { keepBottomFlat: true, detail: 1, tugs: [] });
    const twins = mirrorPartners(keys, [1, 0, 0], 1e-6);
    for (let v = 0; v < keys.length / 3; v += 1) {
      const t = twins[v];
      expect(t).toBeGreaterThanOrEqual(0);
      expect(keys[t * 3]).toBeCloseTo(10 - keys[v * 3], 6);
      expect(keys[t * 3 + 1]).toBeCloseTo(keys[v * 3 + 1], 6);
      expect(twins[t]).toBe(v);
    }
  });

  it("mirrors a turned part across its own sides", () => {
    const cube = polygonize(cubeSoup())!;
    const { keys } = buildSmoothNet(cube, { keepBottomFlat: true, detail: 1, tugs: [] });
    // Turn the points 30 degrees about the vertical, as a part turned on the grid.
    const turned = new Float64Array(keys.length);
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    for (let v = 0; v < keys.length / 3; v += 1) {
      turned[v * 3] = keys[v * 3] * c + keys[v * 3 + 2] * s;
      turned[v * 3 + 1] = keys[v * 3 + 1];
      turned[v * 3 + 2] = -keys[v * 3] * s + keys[v * 3 + 2] * c;
    }
    // The grid's own left-to-right line pairs almost nothing here.
    expect([...mirrorPartners(turned, [1, 0, 0], 1e-6)].filter((t) => t >= 0).length).toBeLessThan(keys.length / 6);
    const { normal, twins } = findMirrorPartners(turned, 0, [30], 1e-6);
    expect(Math.abs(normal[0])).toBeCloseTo(c, 6);
    expect([...twins].every((t) => t >= 0)).toBe(true);
    // Left to right picks the side nearest the grid's left to right, front to back the other.
    const back = findMirrorPartners(turned, 2, [30], 1e-6);
    expect(Math.abs(back.normal[2])).toBeCloseTo(c, 6);
  });

  it("adds more points with detail", () => {
    const cube = polygonize(cubeSoup())!;
    const basic = buildSmoothNet(cube, { keepBottomFlat: false, detail: 0, tugs: [] });
    const more = buildSmoothNet(cube, { keepBottomFlat: false, detail: 1, tugs: [] });
    expect(more.net.positions.length / 3).toBeGreaterThan(basic.net.positions.length / 3);
    expect(volume(finishSmooth(more.net, more.tags, 1).positions)).toBeGreaterThan(volume(finishSmooth(basic.net, basic.tags, 1).positions));
  });

  it("fades a soft pull out along the surface", () => {
    const cube = polygonize(cubeSoup())!;
    const { mesh } = ccStep(cube, emptyTags(cube));
    const weights = softWeights(mesh, [6], 6);
    expect(weights.get(6)).toBe(1);
    for (const [v, w] of weights) {
      if (v === 6) continue;
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThan(1);
    }
    expect(weights.size).toBeLessThan(mesh.positions.length / 3);
  });

  it("lowers the level to stay under the triangle cap", () => {
    const cube = polygonize(cubeSoup())!;
    const { mesh } = ccStep(cube, emptyTags(cube));
    expect(clampSmoothLevel(mesh, 3, 1_000_000)).toBe(3);
    expect(clampSmoothLevel(mesh, 3, 400)).toBe(2);
    expect(clampSmoothLevel(mesh, 3, 10)).toBe(1);
  });

  it("finishes a dragged net from a plan made once, the same as from scratch", () => {
    const { net, tags } = buildSmoothNet(polygonize(cubeSoup())!, { keepBottomFlat: true, detail: 1, tugs: [] });
    const plan = planSmooth(net, tags, 3);
    const stencil = netStencil(net, tags);
    for (const lift of [2, -1.5]) {
      const pulled = applyTugs(net, tags, new Map([[3, [5, 10 + lift, 5] as Vec3]]), stencil);
      const fresh = finishSmooth(pulled, tags, 3);
      const planned = runSmoothPlan(plan, pulled.positions);
      expect(planned.positions.length).toBe(fresh.positions.length);
      planned.positions.forEach((value, i) => expect(value).toBeCloseTo(fresh.positions[i], 9));
      planned.normals.forEach((value, i) => expect(value).toBeCloseTo(fresh.normals[i], 9));
    }
  });

  it("keeps a picked face exactly flat and full size, and pulls leave it alone", () => {
    const base = polygonize(cubeSoup())!;
    const top = nearestFlatFace(base, [5, 9, 5], [0, 1, 0])!;
    expect(top.at[1]).toBeCloseTo(10, 9);
    expect(top.faces).toHaveLength(1);
    const plain = buildSmoothNet(base, { keepBottomFlat: true, detail: 0, tugs: [] });
    const kept = buildSmoothNet(base, { keepBottomFlat: true, detail: 0, tugs: [], keepFaces: [top.at] });
    const corners = (p: ArrayLike<number>) => {
      let atTop = 0;
      for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 1] - 10) < 1e-9) atTop += 1;
      return atTop;
    };
    // Rounded, the top domes over; kept, its four corners and the whole face stay at the top.
    const plainTop = finishSmooth(plain.net, plain.tags, 2).positions;
    const keptTop = finishSmooth(kept.net, kept.tags, 2).positions;
    expect(Math.max(...plainTop.filter((_, i) => i % 3 === 0 && Math.abs(plainTop[i + 1] - 10) < 1e-9))).toBeLessThan(10 - 1e-6);
    expect(corners(keptTop)).toBeGreaterThan(corners(plainTop));
    let reach = 0;
    for (let i = 0; i < keptTop.length; i += 3) if (Math.abs(keptTop[i + 1] - 10) < 1e-9) reach = Math.max(reach, keptTop[i]);
    expect(reach).toBeCloseTo(10, 9);
    for (let i = 1; i < keptTop.length; i += 3) expect(keptTop[i]).toBeLessThanOrEqual(10 + 1e-9);
    // Its points are locked, and a pull stored on one of them is dropped.
    const onTop = [...kept.locked.keys()].find((v) => kept.locked[v] && Math.abs(kept.keys[v * 3 + 1] - 10) < 1e-9)!;
    expect(onTop).toBeDefined();
    const at: Vec3 = [kept.keys[onTop * 3], kept.keys[onTop * 3 + 1], kept.keys[onTop * 3 + 2]];
    const tugged = buildSmoothNet(base, { keepBottomFlat: true, detail: 0, tugs: [{ detail: 0, at, to: [at[0], 14, at[2]] }], keepFaces: [top.at] });
    expect(tugged.heldBack).toBe(1);
    expect(tugged.applied).toHaveLength(0);
  });
});
