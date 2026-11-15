import { DEFAULT_SNAP_GRID, normalizeSnapGrid, normalizeWorkspaceSettings } from "@/lib/workplaneSettings";
import { csgTreeContainsId } from "@/lib/csgTree";
import { restoreGroupedChildren } from "@/lib/editorBoolean";
import type { ShapeAsset, WorkplaneShape } from "@/types/sketchforge";
import { WORKSPACE_DEFAULTS_STORAGE_PREFIX } from "@/components/viewport/viewportConstants";

/** A part inside `body`, at any depth, as it sits in the world; null when it is not in the body. */
export function worldPoseOfPartInBody(body: WorkplaneShape, partId: string): WorkplaneShape | null {
  let group = body;
  for (let depth = 0; depth < 32; depth += 1) {
    const children = restoreGroupedChildren(group, { preserveIds: true });
    const direct = children.find((child) => child.id === partId);
    if (direct) return direct;
    const next = children.find((child) => csgTreeContainsId(child, partId));
    if (!next) return null;
    group = next;
  }
  return null;
}
export const SHAPE_KINDS = new Set<ShapeAsset["kind"]>([
  "box",
  "cylinder",
  "sphere",
  "sketch",
  "scribble",
  "cone",
  "pyramid",
  "roof",
  "text",
  "roundRoof",
  "halfSphere",
  "torus",
  "tube",
  "ring",
  "wedge",
  "polygon",
  "icosahedron",
  "mesh",
  "thread",
  "gear",
  "gridfinityBin",
  "gridfinityBaseplate",
  "loft",
]);

export function parseDroppedShapeAsset(raw: string): ShapeAsset | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") {
      return null;
    }
    const asset = value as Partial<ShapeAsset>;
    if (
      typeof asset.id !== "string" ||
      typeof asset.name !== "string" ||
      typeof asset.src !== "string" ||
      typeof asset.color !== "string" ||
      !SHAPE_KINDS.has(asset.kind as ShapeAsset["kind"]) ||
      (asset.hole !== undefined && typeof asset.hole !== "boolean")
    ) {
      return null;
    }
    return {
      id: asset.id,
      name: asset.name,
      src: asset.src,
      kind: asset.kind as ShapeAsset["kind"],
      color: asset.color,
      hole: asset.hole,
      generated: asset.generated,
      toolboxLabel: asset.toolboxLabel === true || undefined,
      pictureKeychain: asset.pictureKeychain === true || undefined,
    };
  } catch {
    return null;
  }
}

export function readSavedWorkspaceDefault(key: string | null) {
  if (!key || typeof window === "undefined") {
    return null;
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${WORKSPACE_DEFAULTS_STORAGE_PREFIX}${key}`) ?? "null") as {
      workspace?: unknown;
      snap?: unknown;
    } | null;
    if (!parsed) {
      return null;
    }
    return {
      workspace: normalizeWorkspaceSettings(parsed.workspace),
      snap: normalizeSnapGrid(parsed.snap, DEFAULT_SNAP_GRID),
    };
  } catch {
    return null;
  }
}
