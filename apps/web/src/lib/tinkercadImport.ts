import * as THREE from "three";
import { withCsgMeta } from "@/lib/csgTree";
import { cloneAsGroupChild } from "@/lib/editorGroup";
import { boundsForShapes } from "@/lib/editorShapeMesh";
import { isDesktopShell } from "@/lib/desktopHardware";
import { sceneShape } from "@/lib/shapeCatalog";
import type { ShapeKind, WorkplaneShape } from "@/types/sketchforge";

/**
 * Tinkercad designs brought over by the "Send to Mintr" bookmark.
 *
 * The bookmark reads the open design's tree (`rootNode.toJSON()` in Tinkercad's editor, the same
 * format its own copy and paste uses) and hands it to Mintr. Each node carries a 4×4 column-major
 * matrix relative to its parent, in Tinkercad's Z-up world. Presets are built Y-up in their own
 * frame, centred on X and Z with the base at Y = 0, which is exactly how Mintr builds a shape.
 */

export const TINKERCAD_HASH_KEY = "tinkercad";
export const TINKERCAD_CLIPBOARD_PREFIX = "MINTR-TINKERCAD/1\n";

export type TinkercadNode = {
  matrix?: number[];
  dataType?: string | null;
  params?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  children?: TinkercadNode[];
};

export type TinkercadPayload = {
  v: 1;
  name?: string;
  root: TinkercadNode;
};

export type TinkercadImport = {
  shapes: WorkplaneShape[];
  /** Labels of shapes that have no Mintr equivalent yet and were left out. */
  skipped: string[];
};

type PresetMapping = {
  kind: ShapeKind;
  /** The preset's own size before the matrix scales it: X, Y (up), Z. */
  size: [number, number, number];
  /** Settings of the kind, given how much the matrix stretched the preset on X, Y and Z. */
  extra?: (scale: [number, number, number]) => Partial<WorkplaneShape>;
};

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * Tinkercad's presets and the Mintr shape each one becomes. Presets without numbers (roof, wedge,
 * round roof) are Tinkercad's 20 mm defaults. Both apps build these the same way round: roofs
 * and wedges run front to back, polygons point front and back.
 */
function mapPreset(params: Record<string, unknown>): PresetMapping | null {
  switch (params.id) {
    case "box":
      return {
        kind: "box",
        size: [num(params.width, 20), num(params.height, 20), num(params.depth, 20)],
        extra: () => ({ radius: num(params.radius, 0) }),
      };
    case "cylinder": {
      const diameter = num(params.radiusBottom, 10) * 2;
      return { kind: "cylinder", size: [diameter, num(params.height, 20), diameter], extra: () => ({ bevel: 0, segments: 1 }) };
    }
    case "cone": {
      const top = num(params.radiusTop, 0);
      const base = num(params.radiusBottom, 10);
      const widest = Math.max(top, base, 0.001) * 2;
      return {
        kind: "cone",
        size: [widest, num(params.height, 20), widest],
        extra: ([sx, , sz]) => ({
          topRadius: top * sx,
          baseRadius: base * sx,
          ...(Math.abs(sx - sz) > 1e-6 ? { coneFreeRange: true } : {}),
        }),
      };
    }
    case "sphere": {
      const diameter = num(params.radius, 10) * 2;
      return { kind: "sphere", size: [diameter, diameter, diameter] };
    }
    case "halfSphere": {
      const radius = num(params.radius, 10);
      return { kind: "halfSphere", size: [radius * 2, radius, radius * 2] };
    }
    case "polygon":
      return { kind: "polygon", size: [20, num(params.height, 20), 20], extra: () => ({ sides: Math.max(3, Math.round(num(params.radialSegments, 6))) }) };
    case "pyramid":
      return { kind: "pyramid", size: [20, 20, 20], extra: () => ({ sides: Math.max(3, Math.round(num(params.side, 4))) }) };
    case "roof":
      return { kind: "roof", size: [20, 20, 20] };
    case "halfCylinder":
      return { kind: "roundRoof", size: [20, 10, 20] };
    case "wedge":
      return { kind: "wedge", size: [20, 20, 20] };
    case "torus": {
      const tube = num(params.tube, 2.5);
      const diameter = (num(params.radius, 7.5) + tube) * 2;
      // Mintr's torus radius is the tube's: half its height.
      return { kind: "torus", size: [diameter, tube * 2, diameter], extra: ([, sy]) => ({ radius: tube * sy }) };
    }
    case "tube2": {
      const diameter = num(params.radius, 10) * 2;
      const wall = num(params.thickness, 2.5);
      // Mintr's tube keeps its wall thickness in `bevel`.
      return { kind: "tube", size: [diameter, num(params.height, 10), diameter], extra: ([sx, , sz]) => ({ bevel: wall * Math.min(sx, sz) }) };
    }
    default:
      return null;
  }
}

function colorHex(tags: Record<string, unknown> | undefined) {
  const material = tags?.renderingMaterial as { color?: unknown } | undefined;
  const color = typeof material?.color === "number" ? material.color : 0xd41721;
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

function nodeLabel(node: TinkercadNode, fallback: string) {
  const label = node.tags?.label;
  return typeof label === "string" && label.trim() ? label.trim() : fallback;
}

const isHole = (node: TinkercadNode) => node.tags?.volumePolarity === -1;
const isHidden = (node: TinkercadNode) => node.tags?.hidden === true || node.tags?.isHidden === true;

/** Tinkercad's Z-up world into Mintr's Y-up world: (x, y, z) → (x, z, −y). */
const TO_MINTR = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1,
);

function nodeMatrix(node: TinkercadNode) {
  const matrix = new THREE.Matrix4();
  if (Array.isArray(node.matrix) && node.matrix.length === 16 && node.matrix.every((value) => Number.isFinite(value))) {
    matrix.fromArray(node.matrix);
  }
  return matrix;
}

const DEGREES = 180 / Math.PI;
/** Matrix noise (2.8e-16 and the like) and float drift should not reach the inspector. */
const tidy = (value: number) => {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** A preset with its full Tinkercad world matrix as a Mintr shape, placed in Mintr's world. */
function leafShape(node: TinkercadNode, world: THREE.Matrix4, preset: PresetMapping): WorkplaneShape {
  const mintr = TO_MINTR.clone().multiply(world);
  const e = mintr.elements;
  const columns = [0, 1, 2].map((axis) => new THREE.Vector3(e[axis * 4], e[axis * 4 + 1], e[axis * 4 + 2]));
  const scale = columns.map((column) => column.length() || 1);
  // A mirrored part turns up as a negative determinant: Mintr mirrors on X before rotating.
  const mirrored = mintr.determinant() < 0;
  const rotation = new THREE.Matrix4().makeBasis(
    columns[0].clone().divideScalar(scale[0] * (mirrored ? -1 : 1)),
    columns[1].clone().divideScalar(scale[1]),
    columns[2].clone().divideScalar(scale[2]),
  );
  const euler = new THREE.Euler().setFromRotationMatrix(rotation, "XYZ");
  const width = preset.size[0] * scale[0];
  const height = preset.size[1] * scale[1];
  const depth = preset.size[2] * scale[2];
  // Mintr turns a shape about its centre: the preset's local centre, carried into the world.
  const center = new THREE.Vector3(0, preset.size[1] / 2, 0).applyMatrix4(mintr);
  const color = colorHex(node.tags);
  const hole = isHole(node);
  return sceneShape({
    name: nodeLabel(node, preset.kind),
    kind: preset.kind,
    color,
    ...(hole ? { hole: true, solidColor: color } : {}),
    ...preset.extra?.([scale[0], scale[1], scale[2]]),
    x: tidy(center.x),
    z: tidy(center.z),
    elevation: tidy(center.y - height / 2),
    width: tidy(width),
    depth: tidy(depth),
    height: tidy(height),
    size: tidy(Math.max(width, depth)),
    rotationX: tidy(euler.x * DEGREES),
    rotation: tidy(euler.y * DEGREES),
    rotationZ: tidy(euler.z * DEGREES),
    ...(mirrored ? { mirrorX: true } : {}),
    hidden: isHidden(node),
  });
}

/** Every plain shape inside a converted shape, in world space, for sizing its group. */
function worldLeaves(shape: WorkplaneShape, leaves: Map<string, WorkplaneShape[]>): WorkplaneShape[] {
  return leaves.get(shape.id) ?? [shape];
}

/**
 * A Tinkercad group as a Mintr group. Children are stored in the group's frame and the group is
 * marked dirty, so Mintr builds the finished shape itself when the design opens. Each part keeps
 * its own solid or hole setting: a hole group cuts its parent, but its own parts still combine
 * among themselves.
 */
function groupShape(node: TinkercadNode, children: WorkplaneShape[], leaves: Map<string, WorkplaneShape[]>): WorkplaneShape {
  const all = children.flatMap((child) => worldLeaves(child, leaves));
  const bounds = boundsForShapes(all);
  const x = (bounds.minX + bounds.maxX) / 2;
  const z = (bounds.minZ + bounds.maxZ) / 2;
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const height = bounds.maxY - bounds.minY;
  const hasHole = children.some((child) => child.hole);
  const multicolor = node.tags?.isMulticolor === true;
  // A bundle group keeps its parts apart and moves them together: Mintr's Tie.
  const bundle = node.params?.isRigidMultiBody === true || node.params?.groupType === 0;
  const op = bundle ? "assemble" : hasHole ? "subtract" : multicolor ? "assemble" : "union";
  const color = colorHex(node.tags);
  const hole = isHole(node);
  const group = withCsgMeta(
    sceneShape({
      name: nodeLabel(node, bundle ? "Tie" : "Group"),
      kind: "mesh",
      color,
      ...(hole ? { hole: true, solidColor: color } : {}),
      x: tidy(x),
      z: tidy(z),
      elevation: tidy(bounds.minY),
      width: tidy(width),
      depth: tidy(depth),
      height: tidy(height),
      size: tidy(Math.max(width, depth)),
      groupedBaseWidth: tidy(width),
      groupedBaseDepth: tidy(depth),
      groupedBaseHeight: tidy(height),
      groupedShapes: children.map((child) => cloneAsGroupChild(child, x, z, bounds.minY, true)),
      hidden: isHidden(node),
    }),
    op,
    1,
    true,
  );
  leaves.set(group.id, all);
  return group;
}

function convertNode(
  node: TinkercadNode,
  parent: THREE.Matrix4,
  leaves: Map<string, WorkplaneShape[]>,
  skipped: string[],
): WorkplaneShape | null {
  const world = parent.clone().multiply(nodeMatrix(node));
  if (node.dataType === "csg" || (Array.isArray(node.children) && node.children.length > 0 && node.dataType !== "preset")) {
    const children = (node.children ?? [])
      .map((child) => convertNode(child, world, leaves, skipped))
      .filter((child): child is WorkplaneShape => child !== null);
    if (children.length === 0) return null;
    if (children.length === 1 && node.dataType !== "csg") return children[0];
    return groupShape(node, children, leaves);
  }
  const preset = node.dataType === "preset" && node.params ? mapPreset(node.params) : null;
  if (!preset) {
    skipped.push(nodeLabel(node, typeof node.params?.id === "string" ? node.params.id : "Shape"));
    return null;
  }
  return leafShape(node, world, preset);
}

/** The design's top-level shapes as Mintr shapes, with anything Mintr cannot make yet listed. */
export function tinkercadToShapes(payload: TinkercadPayload): TinkercadImport {
  const leaves = new Map<string, WorkplaneShape[]>();
  const skipped: string[] = [];
  const rootMatrix = nodeMatrix(payload.root);
  const shapes = (payload.root.children ?? [])
    .map((node) => convertNode(node, rootMatrix, leaves, skipped))
    .filter((shape): shape is WorkplaneShape => shape !== null);
  return { shapes, skipped };
}

/** What to say after a Tinkercad design comes in, or null when everything made it. */
export function tinkercadSkippedNotice(skipped: string[]) {
  if (skipped.length === 0) return null;
  const names = [...new Set(skipped)];
  const listed = names.slice(0, 3).join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "");
  return `Brought the Tinkercad design over. ${skipped.length} shape${skipped.length === 1 ? "" : "s"} Mintr cannot make yet ${skipped.length === 1 ? "was" : "were"} left out: ${listed}.`;
}

export function isTinkercadPayload(value: unknown): value is TinkercadPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<TinkercadPayload>;
  return payload.v === 1 && Boolean(payload.root) && typeof payload.root === "object";
}

/** The payload from `#tinkercad=…` in Mintr's address, or null. */
export function readTinkercadHash(hash: string): TinkercadPayload | null {
  const prefix = `#${TINKERCAD_HASH_KEY}=`;
  if (!hash.startsWith(prefix)) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(hash.slice(prefix.length))) as unknown;
    return isTinkercadPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A design the bookmark left on the system clipboard, or null (also when reading is refused). */
export async function readTinkercadSystemClipboard(): Promise<TinkercadPayload | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return null;
  try {
    // A browser asks before a page reads the clipboard. Every Ctrl+V asking would be worse than
    // this route, which the web version hardly needs: its bookmark opens the design in a tab.
    if (!isDesktopShell()) {
      const permission = await navigator.permissions?.query({ name: "clipboard-read" as PermissionName }).catch(() => null);
      if (permission?.state !== "granted") return null;
    }
    return readTinkercadClipboard(await navigator.clipboard.readText());
  } catch {
    return null;
  }
}

/** The payload from text pasted into Mintr after the bookmark put it on the clipboard, or null. */
export function readTinkercadClipboard(text: string): TinkercadPayload | null {
  if (!text.startsWith(TINKERCAD_CLIPBOARD_PREFIX)) return null;
  try {
    const parsed = JSON.parse(text.slice(TINKERCAD_CLIPBOARD_PREFIX.length)) as unknown;
    return isTinkercadPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
