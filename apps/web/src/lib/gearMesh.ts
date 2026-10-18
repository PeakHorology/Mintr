import * as THREE from "three";
import {
  gearHelixTwistRadians,
  gearPlanLoops,
  normalizeGearSpec,
  rackPlanLoop,
  type GearLoop2,
  type GearSpec,
} from "@/lib/gearProfile";
import type { WorkplaneShape } from "@/types/sketchforge";

export type GearIndexedMesh = {
  positions: number[];
  indices: number[];
};

function rotateXZ(point: GearLoop2, angle: number): GearLoop2 {
  if (Math.abs(angle) < 1e-8) return point;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos + point.z * sin,
    z: -point.x * sin + point.z * cos,
  };
}

function twistAt(spec: GearSpec, height: number, t: number) {
  const full = gearHelixTwistRadians(spec, height);
  if (spec.form !== "herringbone") return full * t;
  const half = full / 2;
  return t <= 0.5 ? half * (t / 0.5) : half * (1 - (t - 0.5) / 0.5);
}

function addTriangle(indices: number[], a: number, b: number, c: number) {
  if (a === b || b === c || a === c) return;
  indices.push(a, b, c);
}

function addAligned(indices: number[], positions: number[], a: number, b: number, c: number, outX: number, outZ: number) {
  const ax = positions[a * 3];
  const ay = positions[a * 3 + 1];
  const az = positions[a * 3 + 2];
  const bx = positions[b * 3] - ax;
  const by = positions[b * 3 + 1] - ay;
  const bz = positions[b * 3 + 2] - az;
  const cx = positions[c * 3] - ax;
  const cy = positions[c * 3 + 1] - ay;
  const cz = positions[c * 3 + 2] - az;
  const nx = by * cz - bz * cy;
  const nz = bx * cy - by * cx;
  if (nx * outX + nz * outZ >= 0) addTriangle(indices, a, b, c);
  else addTriangle(indices, a, c, b);
}

function wall(indices: number[], positions: number[], a0: number, b0: number, a1: number, b1: number) {
  const ax = positions[a0 * 3];
  const az = positions[a0 * 3 + 2];
  const outX = positions[b0 * 3 + 2] - az;
  const outZ = ax - positions[b0 * 3];
  addAligned(indices, positions, a0, b0, b1, outX, outZ);
  addAligned(indices, positions, a0, b1, a1, outX, outZ);
}

function span(a: GearLoop2, b: GearLoop2) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function simplifyLoop(loop: GearLoop2[], minSpan: number) {
  if (loop.length < 4) return loop;
  const kept: GearLoop2[] = [];
  for (let index = 0; index < loop.length; index += 1) {
    const point = loop[index];
    const last = kept[kept.length - 1];
    if (last && span(last, point) < minSpan) continue;
    kept.push(point);
  }
  while (kept.length > 4 && span(kept[0], kept[kept.length - 1]) < minSpan) kept.pop();
  return kept;
}

function loftSteps(spec: GearSpec, face: number, loops: GearLoop2[][]) {
  const twist = Math.abs(gearHelixTwistRadians(spec, face));
  if (spec.form === "rack" || twist < 0.02) return 1;
  let tip = 1;
  let shortest = Infinity;
  for (let loopIndex = 0; loopIndex < loops.length; loopIndex += 1) {
    const loop = loops[loopIndex];
    for (let pointIndex = 0; pointIndex < loop.length; pointIndex += 1) {
      const point = loop[pointIndex];
      tip = Math.max(tip, Math.hypot(point.x, point.z));
      const next = loop[(pointIndex + 1) % loop.length];
      const edge = span(point, next);
      if (edge > 1e-4) shortest = Math.min(shortest, edge);
    }
  }
  const stride = Math.max(0.05, (Number.isFinite(shortest) ? shortest : 0.4) * 0.45);
  return Math.min(480, Math.max(8, Math.ceil((tip * twist) / stride)));
}

function cap(indices: number[], positions: number[], layerStart: number, loops: GearLoop2[][], positiveY: boolean) {
  const contour = loops[0];
  const holes = loops.slice(1);
  const faces = THREE.ShapeUtils.triangulateShape(
    contour.map((point) => new THREE.Vector2(point.x, point.z)),
    holes.map((loop) => loop.map((point) => new THREE.Vector2(point.x, point.z))),
  );
  if (faces.length === 0) return;
  const sample = faces[0];
  const ia = layerStart + sample[0];
  const ib = layerStart + sample[1];
  const ic = layerStart + sample[2];
  const abx = positions[ib * 3] - positions[ia * 3];
  const aby = positions[ib * 3 + 1] - positions[ia * 3 + 1];
  const abz = positions[ib * 3 + 2] - positions[ia * 3 + 2];
  const acx = positions[ic * 3] - positions[ia * 3];
  const acy = positions[ic * 3 + 1] - positions[ia * 3 + 1];
  const acz = positions[ic * 3 + 2] - positions[ia * 3 + 2];
  const ny = abz * acx - abx * acz;
  const flip = (ny > 0) !== positiveY;
  for (let i = 0; i < faces.length; i += 1) {
    const [a, b, c] = faces[i];
    if (flip) addTriangle(indices, layerStart + a, layerStart + c, layerStart + b);
    else addTriangle(indices, layerStart + a, layerStart + b, layerStart + c);
  }
}

export function buildGearIndexedMesh(specInput: Partial<GearSpec> | undefined, height: number, barDepth = 0): GearIndexedMesh {
  const spec = normalizeGearSpec(specInput);
  const face = Math.max(0.2, height);
  const plan = spec.form === "rack" ? null : gearPlanLoops(spec);
  const minSpan = Math.max(0.05, spec.module * 0.12);
  const loops = (plan ? [plan.outer, ...plan.holes] : [rackPlanLoop(spec, barDepth)]).map((loop) => simplifyLoop(loop, minSpan));
  const steps = loftSteps(spec, face, loops);
  const perLayer = loops.reduce((sum, loop) => sum + loop.length, 0);
  const positions: number[] = [];
  const layerPoints: GearLoop2[][] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const angle = twistAt(spec, face, t);
    const y = face * t;
    const rotated = loops.map((loop) => loop.map((point) => rotateXZ(point, angle)));
    layerPoints.push(rotated.flat());
    rotated.flat().forEach((point) => {
      positions.push(point.x, y, point.z);
    });
  }
  const indices: number[] = [];
  for (let step = 0; step < steps; step += 1) {
    let cursor = 0;
    for (let loopIndex = 0; loopIndex < loops.length; loopIndex += 1) {
      const count = loops[loopIndex].length;
      for (let i = 0; i < count; i += 1) {
        const a0 = step * perLayer + cursor + i;
        const b0 = step * perLayer + cursor + ((i + 1) % count);
        const a1 = (step + 1) * perLayer + cursor + i;
        const b1 = (step + 1) * perLayer + cursor + ((i + 1) % count);
        wall(indices, positions, a0, b0, a1, b1);
      }
      cursor += count;
    }
  }
  cap(indices, positions, 0, loops, false);
  const topLoops = layerPoints[layerPoints.length - 1];
  let cursor = 0;
  const topGroups: GearLoop2[][] = [];
  for (let loopIndex = 0; loopIndex < loops.length; loopIndex += 1) {
    topGroups.push(topLoops.slice(cursor, cursor + loops[loopIndex].length));
    cursor += loops[loopIndex].length;
  }
  cap(indices, positions, steps * perLayer, topGroups, true);
  return { positions, indices };
}

function faceNormal(src: number[], a: number, b: number, c: number) {
  const ax = src[a * 3];
  const ay = src[a * 3 + 1];
  const az = src[a * 3 + 2];
  const abx = src[b * 3] - ax;
  const aby = src[b * 3 + 1] - ay;
  const abz = src[b * 3 + 2] - az;
  const acx = src[c * 3] - ax;
  const acy = src[c * 3 + 1] - ay;
  const acz = src[c * 3 + 2] - az;
  return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
}

export function createGearGeometry(shape: WorkplaneShape) {
  const mesh = buildGearIndexedMesh(shape.gearSpec, shape.height, shape.depth);
  const src = mesh.positions;
  const indices = mesh.indices;
  const count = src.length / 3;
  const accum = new Float32Array(count * 3);
  const capAt = (index: number) => {
    const y0 = src[indices[index] * 3 + 1];
    return Math.abs(y0 - src[indices[index + 1] * 3 + 1]) < 1e-4
      && Math.abs(y0 - src[indices[index + 2] * 3 + 1]) < 1e-4;
  };
  for (let index = 0; index + 2 < indices.length; index += 3) {
    if (capAt(index)) continue;
    const [nx, ny, nz] = faceNormal(src, indices[index], indices[index + 1], indices[index + 2]);
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = indices[index + corner] * 3;
      accum[vertex] += nx;
      accum[vertex + 1] += ny;
      accum[vertex + 2] += nz;
    }
  }
  const positions: number[] = [];
  const normals: number[] = [];
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const cap = capAt(index);
    const up = cap ? (faceNormal(src, indices[index], indices[index + 1], indices[index + 2])[1] >= 0 ? 1 : -1) : 0;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = indices[index + corner];
      positions.push(src[vertex * 3], src[vertex * 3 + 1], src[vertex * 3 + 2]);
      if (cap) {
        normals.push(0, up, 0);
        continue;
      }
      let nx = accum[vertex * 3];
      let ny = accum[vertex * 3 + 1];
      let nz = accum[vertex * 3 + 2];
      let length = Math.hypot(nx, ny, nz);
      if (length < 1e-8) {
        [nx, ny, nz] = faceNormal(src, indices[index], indices[index + 1], indices[index + 2]);
        length = Math.hypot(nx, ny, nz) || 1;
      }
      normals.push(nx / length, ny / length, nz / length);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  // Caps stay flat. Tooth walls keep the smooth normal the other round shapes use,
  // so the gaps are not flat-black.
  geometry.userData.keepNormals = true;
  return geometry;
}
