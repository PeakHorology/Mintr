import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * The Dice shape: the five regular solids plus the ten-sided die, every face flat. It rests on a
 * face, so it prints without supports, and its size boxes read its true size.
 */

export const DICE_SIDES = [4, 6, 8, 10, 12, 20] as const;
export type DiceSides = (typeof DICE_SIDES)[number];
export const DEFAULT_DICE_SIDES: DiceSides = 20;

export function parseDiceSides(value: unknown): DiceSides {
  const sides = Math.round(Number(value));
  return (DICE_SIDES as readonly number[]).includes(sides) ? (sides as DiceSides) : DEFAULT_DICE_SIDES;
}

const PHI = (1 + Math.sqrt(5)) / 2;

/** The corners of each solid, centred on the origin. */
function corners(sides: DiceSides): THREE.Vector3[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const signs = [1, -1];
  switch (sides) {
    case 4:
      return [v(1, 1, 1), v(1, -1, -1), v(-1, 1, -1), v(-1, -1, 1)];
    case 6:
      return signs.flatMap((x) => signs.flatMap((y) => signs.map((z) => v(x, y, z))));
    case 8:
      return [v(1, 0, 0), v(-1, 0, 0), v(0, 1, 0), v(0, -1, 0), v(0, 0, 1), v(0, 0, -1)];
    case 10: {
      // Two caps of five kites. The rings sit just off the middle so each kite is flat.
      const c = Math.cos(Math.PI / 5);
      const ring = (1 - c) / (1 + c);
      const points = [v(0, 1, 0), v(0, -1, 0)];
      for (let step = 0; step < 10; step += 1) {
        const angle = (step * Math.PI) / 5;
        points.push(v(Math.cos(angle), step % 2 === 0 ? ring : -ring, Math.sin(angle)));
      }
      return points;
    }
    case 12: {
      const points = signs.flatMap((x) => signs.flatMap((y) => signs.map((z) => v(x, y, z))));
      for (const a of signs) {
        for (const b of signs) {
          points.push(v(0, a / PHI, b * PHI), v(a / PHI, b * PHI, 0), v(a * PHI, 0, b / PHI));
        }
      }
      return points;
    }
    case 20: {
      const points: THREE.Vector3[] = [];
      for (const a of signs) {
        for (const b of signs) {
          points.push(v(0, a, b * PHI), v(a, b * PHI, 0), v(a * PHI, 0, b));
        }
      }
      return points;
    }
  }
}

/** The solid at its natural proportions, turned so a face lies flat on the workplane, base at y = 0. */
function restingSolid(sides: DiceSides) {
  const hull = new ConvexGeometry(corners(sides));
  hull.deleteAttribute("normal");
  hull.deleteAttribute("uv");
  const solid = mergeVertices(hull, 1e-6);
  hull.dispose();
  // Turn the face pointing most nearly down so it points straight down.
  const position = solid.getAttribute("position");
  const index = solid.getIndex()!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let lowest = new THREE.Vector3(0, -1, 0);
  let best = Infinity;
  for (let face = 0; face < index.count; face += 3) {
    a.fromBufferAttribute(position, index.getX(face));
    b.fromBufferAttribute(position, index.getX(face + 1));
    c.fromBufferAttribute(position, index.getX(face + 2));
    const normal = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    if (normal.y < best - 1e-9) {
      best = normal.y;
      lowest = normal;
    }
  }
  solid.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(lowest, new THREE.Vector3(0, -1, 0)));
  // Then turn it to its tidiest angle, the smallest footprint, so the size boxes read its true size.
  const points = Array.from({ length: position.count }, (_, at) => new THREE.Vector3().fromBufferAttribute(position, at));
  let tidiest = 0;
  let smallest = Infinity;
  for (let step = 0; step < 360; step += 1) {
    const angle = (step * Math.PI) / 360;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const xs = points.map((p) => p.x * cos + p.z * sin);
    const zs = points.map((p) => p.z * cos - p.x * sin);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
    if (area < smallest - 1e-9) {
      smallest = area;
      tidiest = angle;
    }
  }
  solid.rotateY(tidiest);
  solid.computeBoundingBox();
  const box = solid.boundingBox!;
  solid.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  solid.computeBoundingBox();
  return solid;
}

/** How wide, deep and tall the die is for its largest size, keeping its own proportions. */
export function diceNaturalSize(sides: DiceSides, largest: number) {
  const solid = restingSolid(sides);
  const size = solid.boundingBox!.getSize(new THREE.Vector3());
  solid.dispose();
  const scale = largest / Math.max(size.x, size.y, size.z);
  const round = (value: number) => Math.round(value * scale * 1000) / 1000;
  return { width: round(size.x), depth: round(size.z), height: round(size.y) };
}

/** The die filling width × height × depth, centred, base at y = 0. Indexed, so the viewport creases its edges. */
export function diceGeometry(sides: DiceSides, width: number, depth: number, height: number) {
  const solid = restingSolid(sides);
  const size = solid.boundingBox!.getSize(new THREE.Vector3());
  solid.scale(width / Math.max(size.x, 1e-9), height / Math.max(size.y, 1e-9), depth / Math.max(size.z, 1e-9));
  return solid;
}

/** How wide, deep and tall the die is when its corners sit `radius` from its middle. */
export function diceSizeForRadius(sides: DiceSides, radius: number) {
  const farthest = Math.max(...corners(sides).map((corner) => corner.length()));
  const solid = restingSolid(sides);
  const size = solid.boundingBox!.getSize(new THREE.Vector3());
  solid.dispose();
  const scale = radius / farthest;
  return { width: size.x * scale, depth: size.z * scale, height: size.y * scale };
}
