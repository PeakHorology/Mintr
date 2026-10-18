import { describe, expect, it } from "vitest";
import { buildGearIndexedMesh } from "@/lib/gearMesh";
import {
  defaultGearSpec,
  gearCenterDistance,
  gearFootprint,
  gearMetrics,
  gearPlanLoops,
  normalizeGearSpec,
} from "@/lib/gearProfile";

function bounds(mesh: { positions: number[] }) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function openEdges(mesh: { indices: number[] }) {
  const edges = new Map<string, number>();
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const tri = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = tri[edge];
      const b = tri[(edge + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const count of edges.values()) {
    if (count !== 2) open += 1;
  }
  return open;
}

describe("involute gears", () => {
  it("sizes a spur gear from module and tooth count", () => {
    const spec = defaultGearSpec();
    const metrics = gearMetrics(spec);
    expect(metrics.pitchDiameter).toBe(40);
    expect(metrics.outsideDiameter).toBe(44);
    expect(gearFootprint(spec)).toEqual({ width: 44, depth: 44 });
    const mate = normalizeGearSpec({ ...spec, teeth: 30 });
    expect(gearCenterDistance(spec, mate)).toBe(50);
  });

  it("sizes a ring and a rack the way a meshing pair expects", () => {
    const ring = normalizeGearSpec({ form: "ring", teeth: 30, module: 2, rim: 4 });
    expect(gearMetrics(ring).outsideDiameter).toBeCloseTo(2 * (30 + 2.5) + 8, 6);
    const pinion = normalizeGearSpec({ teeth: 12, module: 2 });
    expect(gearCenterDistance(ring, pinion)).toBe(18);
    const rack = normalizeGearSpec({ form: "rack", teeth: 10, module: 2 });
    expect(gearFootprint(rack, 8).width).toBeCloseTo(10 * Math.PI * 2, 6);
    expect(gearFootprint(rack, 2).depth).toBeGreaterThan(2.25 * 2);
  });

  it("builds a closed spur mesh with a bore and the right outside size", () => {
    const spec = defaultGearSpec();
    const mesh = buildGearIndexedMesh(spec, 8);
    const box = bounds(mesh);
    expect(openEdges(mesh)).toBe(0);
    expect(box.maxY - box.minY).toBeCloseTo(8, 4);
    expect(box.maxX - box.minX).toBeCloseTo(44, 0);
    expect(box.maxZ - box.minZ).toBeCloseTo(44, 0);
    const nearAxis = mesh.positions.some((_, index) => {
      if (index % 3 !== 0) return false;
      return Math.hypot(mesh.positions[index], mesh.positions[index + 2]) < 2.5;
    });
    expect(nearAxis).toBe(false);
    const bore = spec.bore / 2;
    let crossing = 0;
    for (let index = 0; index + 2 < mesh.indices.length; index += 3) {
      const ids = [mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]];
      const ys = ids.map((id) => mesh.positions[id * 3 + 1]);
      if (ys.some((y) => Math.abs(y - ys[0]) > 0.01)) continue;
      const cx = ids.reduce((sum, id) => sum + mesh.positions[id * 3], 0) / 3;
      const cz = ids.reduce((sum, id) => sum + mesh.positions[id * 3 + 2], 0) / 3;
      if (Math.hypot(cx, cz) < bore - 0.2) crossing += 1;
    }
    expect(crossing).toBe(0);
    let flippedCaps = 0;
    for (let index = 0; index + 2 < mesh.indices.length; index += 3) {
      const ids = [mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]];
      const point = (id: number) => [mesh.positions[id * 3], mesh.positions[id * 3 + 1], mesh.positions[id * 3 + 2]];
      const [ax, ay, az] = point(ids[0]);
      const [bx, by, bz] = point(ids[1]);
      const [cx, cy, cz] = point(ids[2]);
      if (Math.abs(ay - by) > 0.01 || Math.abs(ay - cy) > 0.01) continue;
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const wantUp = ay > (box.minY + box.maxY) / 2;
      if ((ny > 0) !== wantUp) flippedCaps += 1;
    }
    expect(flippedCaps).toBe(0);
    const outer = gearPlanLoops(spec).outer;
    const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) => {
      const abx = bx - ax;
      const abz = bz - az;
      const cdx = dx - cx;
      const cdz = dz - cz;
      const den = abx * cdz - abz * cdx;
      if (Math.abs(den) < 1e-9) return false;
      const t = ((cx - ax) * cdz - (cz - az) * cdx) / den;
      const u = ((cx - ax) * abz - (cz - az) * abx) / den;
      return t > 0.002 && t < 0.998 && u > 0.002 && u < 0.998;
    };
    let crossings = 0;
    for (let i = 0; i < outer.length; i += 1) {
      const a = outer[i];
      const b = outer[(i + 1) % outer.length];
      for (let j = i + 2; j < outer.length; j += 1) {
        if (i === 0 && j === outer.length - 1) continue;
        const c = outer[j];
        const d = outer[(j + 1) % outer.length];
        if (cross(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z)) crossings += 1;
      }
    }
    expect(crossings).toBe(0);
  });

  it("twists a helical gear and brings a herringbone back together", () => {
    const helical = buildGearIndexedMesh(normalizeGearSpec({ form: "helical", helixAngle: 25, bore: 0 }), 10);
    expect(openEdges(helical)).toBe(0);
    const herringbone = buildGearIndexedMesh(normalizeGearSpec({ form: "herringbone", helixAngle: 25, bore: 0 }), 10);
    expect(openEdges(herringbone)).toBe(0);
  });

  it("keeps a long helical tooth closed instead of opening gaps along the flank", () => {
    const spec = normalizeGearSpec({ form: "helical", helixAngle: 35, teeth: 20, module: 2, bore: 6 });
    const mesh = buildGearIndexedMesh(spec, 60);
    expect(openEdges(mesh)).toBe(0);
    const layers = new Set<number>();
    for (let index = 1; index < mesh.positions.length; index += 3) layers.add(Math.round(mesh.positions[index] * 1000));
    const steps = layers.size - 1;
    const tip = 22;
    const twist = (60 * Math.tan((35 * Math.PI) / 180)) / 20;
    expect((tip * twist) / steps).toBeLessThan(0.2);
  });

  it("closes a ring and a rack", () => {
    expect(openEdges(buildGearIndexedMesh(normalizeGearSpec({ form: "ring", teeth: 24, module: 2, rim: 4 }), 6))).toBe(0);
    const rack = buildGearIndexedMesh(normalizeGearSpec({ form: "rack", teeth: 8, module: 2 }), 6, 10);
    expect(openEdges(rack)).toBe(0);
    const box = bounds(rack);
    expect(box.maxX - box.minX).toBeCloseTo(8 * Math.PI * 2, 1);
  });
});
