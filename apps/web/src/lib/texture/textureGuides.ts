import * as THREE from "three";
import type { WorkplaneShape } from "@/types/sketchforge";
import { normalizeSurfaceTexture, type SurfaceTexture, type SurfaceTextureImage } from "./surfaceTexture";
import { decodeTextureImage } from "./texturePatterns";
import { facePickFromWorld } from "./textureFrame";
import { stampSurface, textureFaceOf, textureRegionTriangles } from "./texturedShape";

/**
 * What the view shows while a texture is set up: the faces chosen so far, the face
 * under the mouse, and a faint copy of a picture where a click would put it.
 */

const GUIDE_COLOR = "#2aa77e";

/** Far enough off the surface to sit above the texture, so it is not hidden by it. */
export function textureGuideLift(texture: SurfaceTexture): number {
  return (texture.direction === "out" ? texture.depth : 0) + 0.06;
}

function guideMaterial(opacity: number) {
  return new THREE.MeshBasicMaterial({
    color: GUIDE_COLOR,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/** The chosen faces as a tint, or null when none are chosen. */
export function textureChosenFacesMesh(shape: WorkplaneShape): THREE.Mesh | null {
  const texture = normalizeSurfaceTexture(shape.surfaceTexture);
  if (texture.faces !== "picked" || texture.picks.length === 0) return null;
  const faces = texture.picks.map((pick) => textureFaceOf(shape, pick)).filter((face): face is number => face !== null);
  const positions = textureRegionTriangles(shape, faces, textureGuideLift(texture));
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geometry, guideMaterial(0.2));
  mesh.renderOrder = 4;
  return mesh;
}

/** The face under the mouse, a little stronger than the chosen ones. Its key changes only when the face does. */
export function textureHoverFace(
  shape: WorkplaneShape,
  point: [number, number, number],
  normal: [number, number, number],
): { key: string; build: () => THREE.Mesh | null } | null {
  const face = textureFaceOf(shape, facePickFromWorld(shape, point, normal));
  if (face === null) return null;
  const texture = normalizeSurfaceTexture(shape.surfaceTexture);
  const lift = textureGuideLift(texture);
  return {
    key: `face|${shape.id}|${face}|${lift}`,
    build: () => {
      const positions = textureRegionTriangles(shape, [face], lift + 0.01);
      if (positions.length === 0) return null;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const mesh = new THREE.Mesh(geometry, guideMaterial(0.3));
      mesh.renderOrder = 5;
      return mesh;
    },
  };
}

const ghostTextures = new Map<string, THREE.CanvasTexture>();
/** Light grey, so the picture reads on any colour of part without looking like a choice. */
const GHOST_FILL = [232, 235, 239] as const;
const GHOST_EDGE = "rgba(120, 128, 138, 0.95)";
/** Clear pixels round the picture: past them the texture is clamped, so nothing shows off the picture. */
const GHOST_PAD = 2;

/** The picture as a see-through grey with a thin outline, padded with clear pixels. */
function ghostTexture(image: SurfaceTextureImage): THREE.CanvasTexture | null {
  const key = `${image.data.length}|${image.data.slice(0, 48)}|${image.data.slice(-48)}|${image.invert}`;
  const known = ghostTextures.get(key);
  if (known) return known;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = image.width + GHOST_PAD * 2;
  canvas.height = image.height + GHOST_PAD * 2;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const { pixels } = decodeTextureImage({ ...image, invert: false });
  const out = context.createImageData(image.width, image.height);
  for (let i = 0; i < pixels.length; i += 1) {
    const high = image.invert ? 255 - pixels[i] : pixels[i];
    out.data[i * 4] = GHOST_FILL[0];
    out.data[i * 4 + 1] = GHOST_FILL[1];
    out.data[i * 4 + 2] = GHOST_FILL[2];
    out.data[i * 4 + 3] = 30 + (high / 255) * 200;
  }
  context.putImageData(out, GHOST_PAD, GHOST_PAD);
  // The edge of the picture, drawn on the part's surface with it.
  const line = Math.max(1, Math.round(Math.max(image.width, image.height) / 120));
  context.strokeStyle = GHOST_EDGE;
  context.lineWidth = line;
  context.strokeRect(GHOST_PAD + line / 2, GHOST_PAD + line / 2, image.width - line, image.height - line);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  ghostTextures.set(key, texture);
  while (ghostTextures.size > 6) {
    const oldest = ghostTextures.keys().next().value;
    if (oldest === undefined) break;
    ghostTextures.get(oldest)?.dispose();
    ghostTextures.delete(oldest);
  }
  return texture;
}

/**
 * A faint copy of the picture where a click would put it, the size and turn it will
 * have. It lies on the part's own surface, so it stops where the part does.
 */
export function texturePictureGhost(
  shape: WorkplaneShape,
  texture: SurfaceTexture,
  point: [number, number, number],
  normal: [number, number, number],
): THREE.Mesh | null {
  if (!texture.image) return null;
  const map = ghostTexture(texture.image);
  if (!map) return null;
  const surface = stampSurface(shape, texture, point, normal, textureGuideLift(texture) + 0.02);
  if (!surface) return null;
  // Where each corner falls in the picture, moved inside the clear padding.
  const w = texture.image.width;
  const h = texture.image.height;
  const uvs = new Float32Array(surface.uvs.length);
  for (let i = 0; i < uvs.length; i += 2) {
    uvs[i] = (surface.uvs[i] * w + GHOST_PAD) / (w + GHOST_PAD * 2);
    uvs[i + 1] = (surface.uvs[i + 1] * h + GHOST_PAD) / (h + GHOST_PAD * 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(surface.positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  }));
  mesh.renderOrder = 6;
  return mesh;
}
