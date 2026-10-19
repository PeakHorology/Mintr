import { ADDITION, Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import * as THREE from "three";
import { buildMetricThreadedCylinder } from "@/lib/metricThreadSolid";
import { nearestMetricThreadForDiameter, resolveThreadParams } from "@/lib/metricThreads";
import { shapeFromSplitWorld, splitWorldHalves, type SplitAxis, type SplitCut } from "@/lib/splitShape";
import type { WorkplaneShape } from "@/types/sketchforge";

export type CutJoint = "none" | "dovetail" | "plug" | "snap" | "thread";

export type CutToFit = SplitCut & {
  joint: CutJoint;
  /** Extra room around the joint, in millimetres. */
  clearance: number;
};

const JOINTS: CutJoint[] = ["none", "dovetail", "plug", "snap", "thread"];

export function normalizeCutJoint(value: unknown): CutJoint {
  return JOINTS.includes(value as CutJoint) ? (value as CutJoint) : "none";
}

export function clampCutClearance(value: number) {
  if (!Number.isFinite(value)) return 0.2;
  return Math.max(0, Math.min(1.2, value));
}

/**
 * Split a solid. With a joint, one piece grows the plug and the other loses
 * the socket, then both sit on the bed with the cut face down.
 */
export function cutShapeToFit(shape: WorkplaneShape, cut: CutToFit): WorkplaneShape[] {
  const halves = splitWorldHalves(shape, cut);
  if (!halves) return [];
  if (cut.joint === "none") {
    const negative = shapeFromSplitWorld(shape, halves.negative, sideName(cut.axis, false));
    const positive = shapeFromSplitWorld(shape, halves.positive, sideName(cut.axis, true));
    return [negative, positive].filter((part): part is WorkplaneShape => part !== null);
  }

  const frame = cutFrame(halves.frame.origin, halves.frame.normal);
  const size = jointSize(halves.negative, halves.positive, frame.normal);
  const clearance = Math.min(clampCutClearance(cut.clearance), size.radius * 0.45);
  const maleTool = jointSoup(cut.joint, size, 0, true);
  const femaleTool = jointSoup(cut.joint, size, clearance, false);
  const maleWorld = csgSoup(halves.positive, placeSoup(maleTool, frame, 0), ADDITION);
  const femaleWorld = csgSoup(halves.negative, placeSoup(femaleTool, frame, 0.35), SUBTRACTION);
  if (maleWorld.length < 9 || femaleWorld.length < 9) {
    throw new Error("The joint did not fit that cut. Move the line or choose a smaller clearance.");
  }

  const [maleLabel, femaleLabel] = jointLabels(cut.joint);
  const maleFlat = orientCutFaceDown(maleWorld, frame.normal.clone().multiplyScalar(-1));
  const femaleFlat = orientCutFaceDown(femaleWorld, frame.normal);
  const male = shapeFromSplitWorld(shape, maleFlat, maleLabel);
  const female = shapeFromSplitWorld(shape, femaleFlat, femaleLabel);
  if (!male || !female) {
    throw new Error("The joint did not fit that cut. Move the line or choose a smaller clearance.");
  }
  const gap = 8;
  male.x = -(male.width / 2 + gap / 2);
  female.x = female.width / 2 + gap / 2;
  male.z = 0;
  female.z = 0;
  male.elevation = 0;
  female.elevation = 0;
  return [male, female];
}

function sideName(axis: SplitAxis, positive: boolean) {
  if (axis === "x") return positive ? "Right" : "Left";
  if (axis === "y") return positive ? "Top" : "Bottom";
  return positive ? "Back" : "Front";
}

function jointLabels(joint: CutJoint): [string, string] {
  if (joint === "dovetail") return ["tail", "socket"];
  if (joint === "snap") return ["snap", "socket"];
  if (joint === "thread") return ["thread", "socket"];
  return ["plug", "socket"];
}

type Frame = {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  bitangent: THREE.Vector3;
  /** Points from the male piece into the female piece. */
  direction: THREE.Vector3;
};

function cutFrame(origin: [number, number, number], normal: [number, number, number]): Frame {
  const n = new THREE.Vector3(...normal).normalize();
  const helper = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(helper, n).normalize();
  const bitangent = new THREE.Vector3().crossVectors(n, tangent).normalize();
  return {
    origin: new THREE.Vector3(...origin),
    normal: n,
    tangent,
    bitangent,
    direction: n.clone().multiplyScalar(-1),
  };
}

type JointSize = {
  radius: number;
  depth: number;
  embed: number;
  length: number;
};

function jointSize(negative: number[], positive: number[], normal: THREE.Vector3): JointSize {
  const span = (soup: number[], axis: THREE.Vector3) => {
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < soup.length; index += 3) {
      const dot = axis.x * soup[index] + axis.y * soup[index + 1] + axis.z * soup[index + 2];
      min = Math.min(min, dot);
      max = Math.max(max, dot);
    }
    return Math.max(0, max - min);
  };
  const helper = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(helper, normal).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  const face = Math.min(span(positive, tangent), span(positive, bitangent), span(negative, tangent), span(negative, bitangent));
  const room = Math.min(span(positive, normal), span(negative, normal));
  if (face < 6 || room < 4) {
    throw new Error("Move the line. Each side needs room for the joint.");
  }
  return {
    radius: Math.max(1.6, Math.min(10, face * 0.16)),
    depth: Math.max(2.5, Math.min(10, room * 0.45)),
    embed: Math.max(1.2, Math.min(2.5, room * 0.25)),
    length: Math.max(8, Math.min(28, face * 0.5)),
  };
}

/** Local soup. +Z runs from the male into the female. The male tool starts at z = -embed. */
function jointSoup(joint: CutJoint, size: JointSize, clearance: number, male: boolean): number[] {
  const extra = male ? 0 : clearance;
  const z0 = male ? -size.embed : 0;
  const z1 = size.depth + (male ? 0 : 0.4);
  if (joint === "dovetail") {
    const root = size.radius * 1.5 + extra;
    const tip = root * 1.45 + extra;
    const length = size.length + extra * 2;
    return taperedBox(-length / 2, length / 2, root, tip, z0, z1);
  }
  if (joint === "snap") {
    const shaft = cylinderSoup(size.radius + extra, z0, z0 + (z1 - z0) * 0.72, 20);
    const head = sphereSoup(size.radius * 1.45 + extra, z0 + (z1 - z0) * 0.78, 10, 8);
    return shaft.concat(head);
  }
  if (joint === "thread") {
    return threadSoup(size, extra, z0, z1 - z0);
  }
  return cylinderSoup(size.radius + extra, z0, z1, 24);
}

function threadSoup(size: JointSize, clearance: number, z0: number, length: number): number[] {
  const fit = nearestMetricThreadForDiameter(Math.max(3, size.radius * 2));
  const major = Math.min(fit.majorDiameter, Math.max(3, size.radius * 2));
  const params = resolveThreadParams({
    designation: fit.designation,
    majorDiameter: major,
    pitch: fit.pitch,
    length: Math.max(fit.pitch * 2, length),
    side: clearance > 0 ? "internal" : "external",
  });
  const mesh = buildMetricThreadedCylinder(params, params.length, {
    role: clearance > 0 ? "bore" : "rod",
    sides: 24,
    clearance,
    chamfer: 0.2,
  });
  const soup: number[] = [];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    soup.push(mesh.positions[index], mesh.positions[index + 2], mesh.positions[index + 1] + z0);
  }
  return soup;
}

/**
 * `zShift` moves the local soup along the cut normal before it is placed.
 * Male tools use a positive shift so they start inside the male piece.
 * Female tools use a small negative shift so the cutter opens the cut face.
 */
function placeSoup(local: number[], frame: Frame, zShift: number): number[] {
  const world: number[] = [];
  const point = new THREE.Vector3();
  for (let index = 0; index < local.length; index += 3) {
    point.copy(frame.origin);
    point.addScaledVector(frame.tangent, local[index]);
    point.addScaledVector(frame.bitangent, local[index + 1]);
    point.addScaledVector(frame.normal, zShift);
    point.addScaledVector(frame.direction, local[index + 2]);
    world.push(point.x, point.y, point.z);
  }
  return world;
}

function orientCutFaceDown(world: number[], outward: THREE.Vector3): number[] {
  const from = outward.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(from, new THREE.Vector3(0, -1, 0));
  const point = new THREE.Vector3();
  const turned: number[] = [];
  let minY = Infinity;
  for (let index = 0; index < world.length; index += 3) {
    point.set(world[index], world[index + 1], world[index + 2]).applyQuaternion(quaternion);
    turned.push(point.x, point.y, point.z);
    minY = Math.min(minY, point.y);
  }
  for (let index = 1; index < turned.length; index += 3) turned[index] -= minY;
  return turned;
}

function csgSoup(source: number[], tool: number[], operation: typeof ADDITION | typeof SUBTRACTION) {
  const sourceGeometry = soupGeometry(source);
  const toolGeometry = soupGeometry(tool);
  const solid = new Brush(sourceGeometry);
  const cutter = new Brush(toolGeometry);
  solid.updateMatrixWorld();
  cutter.updateMatrixWorld();
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal"];
  evaluator.useGroups = false;
  try {
    const result = evaluator.evaluate(solid, cutter, operation);
    return brushSoup(result);
  } finally {
    sourceGeometry.dispose();
    toolGeometry.dispose();
    solid.geometry.dispose();
    cutter.geometry.dispose();
  }
}

function soupGeometry(soup: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(soup), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function brushSoup(brush: Brush) {
  const geometry = brush.geometry.clone();
  geometry.applyMatrix4(brush.matrixWorld);
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const values: number[] = [];
  if (position) {
    if (index) {
      for (let i = 0; i < index.count; i += 1) {
        const vertex = index.getX(i);
        values.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      }
    } else {
      for (let i = 0; i < position.count; i += 1) {
        values.push(position.getX(i), position.getY(i), position.getZ(i));
      }
    }
  }
  geometry.dispose();
  brush.geometry.dispose();
  return values;
}

function pushTri(soup: number[], a: [number, number, number], b: [number, number, number], c: [number, number, number]) {
  soup.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

function pushQuad(
  soup: number[],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
) {
  pushTri(soup, a, b, c);
  pushTri(soup, a, c, d);
}

function taperedBox(u0: number, u1: number, root: number, tip: number, z0: number, z1: number) {
  const soup: number[] = [];
  const vr = root / 2;
  const vt = tip / 2;
  const p0: [number, number, number] = [u0, -vr, z0];
  const p1: [number, number, number] = [u1, -vr, z0];
  const p2: [number, number, number] = [u1, vr, z0];
  const p3: [number, number, number] = [u0, vr, z0];
  const p4: [number, number, number] = [u0, -vt, z1];
  const p5: [number, number, number] = [u1, -vt, z1];
  const p6: [number, number, number] = [u1, vt, z1];
  const p7: [number, number, number] = [u0, vt, z1];
  pushQuad(soup, p0, p3, p2, p1);
  pushQuad(soup, p4, p5, p6, p7);
  pushQuad(soup, p0, p1, p5, p4);
  pushQuad(soup, p3, p7, p6, p2);
  pushQuad(soup, p0, p4, p7, p3);
  pushQuad(soup, p1, p2, p6, p5);
  return soup;
}

function cylinderSoup(radius: number, z0: number, z1: number, segments: number) {
  const soup: number[] = [];
  const sides = Math.max(8, segments);
  for (let index = 0; index < sides; index += 1) {
    const a0 = (index / sides) * Math.PI * 2;
    const a1 = ((index + 1) / sides) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius;
    const y0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius;
    const y1 = Math.sin(a1) * radius;
    pushQuad(soup, [x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1]);
    pushTri(soup, [0, 0, z0], [x1, y1, z0], [x0, y0, z0]);
    pushTri(soup, [0, 0, z1], [x0, y0, z1], [x1, y1, z1]);
  }
  return soup;
}

function sphereSoup(radius: number, zCenter: number, stacks: number, slices: number) {
  const soup: number[] = [];
  const point = (stack: number, slice: number): [number, number, number] => {
    const v = (stack / stacks) * Math.PI;
    const u = (slice / slices) * Math.PI * 2;
    return [
      Math.sin(v) * Math.cos(u) * radius,
      Math.sin(v) * Math.sin(u) * radius,
      Math.cos(v) * radius + zCenter,
    ];
  };
  for (let stack = 0; stack < stacks; stack += 1) {
    for (let slice = 0; slice < slices; slice += 1) {
      const a = point(stack, slice);
      const b = point(stack + 1, slice);
      const c = point(stack + 1, slice + 1);
      const d = point(stack, slice + 1);
      if (stack === 0) pushTri(soup, a, c, b);
      else if (stack === stacks - 1) pushTri(soup, a, d, b);
      else pushQuad(soup, a, d, c, b);
    }
  }
  return soup;
}
