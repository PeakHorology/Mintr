import { useEffect, useState } from "react";
import { normalizeSurfaceTexture, SURFACE_TEXTURE_LABELS, type SurfaceTexture } from "./surfaceTexture";

/**
 * Textures someone liked enough to keep, to put on any part again in one click.
 * Kept in this copy of Mintr, not in the project, so they carry from design to design.
 */
export type SavedTexture = { id: string; name: string; texture: SurfaceTexture };

const SAVED_TEXTURES_KEY = "mintr:saved-textures";
const SAVED_TEXTURES_EVENT = "mintr:saved-textures-changed";
export const MAX_SAVED_TEXTURES = 24;

/** What carries to another part: everything but where it sat on this one. */
function portable(texture: SurfaceTexture): SurfaceTexture {
  const { stamp: _stamp, ...rest } = normalizeSurfaceTexture(texture);
  // Chosen sides belong to this part; elsewhere the texture starts on every face.
  return normalizeSurfaceTexture({ ...rest, faces: rest.faces === "picked" ? "all" : rest.faces, picks: [], sides: [] });
}

export function readSavedTextures(): SavedTexture[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_TEXTURES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const item = entry as Partial<SavedTexture> | null;
      if (!item || typeof item.id !== "string" || typeof item.name !== "string" || !item.texture) return [];
      return [{ id: item.id, name: item.name.slice(0, 60), texture: portable(item.texture) }];
    }).slice(0, MAX_SAVED_TEXTURES);
  } catch {
    return [];
  }
}

/** False when it could not be kept, e.g. the store is full of large pictures. */
function writeSavedTextures(list: SavedTexture[]): boolean {
  try {
    window.localStorage.setItem(SAVED_TEXTURES_KEY, JSON.stringify(list));
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(SAVED_TEXTURES_EVENT));
  return true;
}

/** A name to start from: the picture or text, or the pattern and its size. */
export function suggestedTextureName(texture: SurfaceTexture): string {
  if (texture.pattern === "image" && texture.image) return texture.image.name;
  return `${SURFACE_TEXTURE_LABELS[texture.pattern]} ${Number(texture.spacing.toFixed(1))} mm`;
}

export function saveTexture(name: string, texture: SurfaceTexture): boolean {
  const list = readSavedTextures();
  const entry: SavedTexture = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim().slice(0, 60) || suggestedTextureName(texture),
    texture: portable(texture),
  };
  // Newest first; the oldest drop off past the limit.
  return writeSavedTextures([entry, ...list].slice(0, MAX_SAVED_TEXTURES));
}

export function removeSavedTexture(id: string) {
  writeSavedTextures(readSavedTextures().filter((entry) => entry.id !== id));
}

/** A saved texture on this part: its settings, keeping where a placed picture already sits. */
export function applySavedTexture(saved: SurfaceTexture, current: SurfaceTexture): SurfaceTexture {
  return normalizeSurfaceTexture({ ...saved, ...(current.stamp ? { stamp: current.stamp } : {}) });
}

/** Follows the saved list live, so a save shows at once in every open panel. */
export function useSavedTextures() {
  const [list, setList] = useState<SavedTexture[]>([]);
  useEffect(() => {
    const sync = () => setList(readSavedTextures());
    sync();
    window.addEventListener(SAVED_TEXTURES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SAVED_TEXTURES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return list;
}
