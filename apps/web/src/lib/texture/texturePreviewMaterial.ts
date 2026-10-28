import * as THREE from "three";
import type { SurfaceTexture, SurfaceTextureImage, SurfaceTexturePattern } from "./surfaceTexture";
import { decodeTextureImage } from "./texturePatterns";
import { fittingStamps, stampFrame, type SurfaceTextureLayout } from "./textureApply";
import { MAX_EACH_STAMPS } from "./textureFaces";

/**
 * Draws a texture on the plain body straight away, on the graphics card, while
 * the real textured triangles build in the background. The pattern is read the
 * same way the build reads it (texturePatterns.ts and heightSampler in
 * textureApply.ts); only the shading moves, not the surface.
 */

const PATTERN_CODE: Record<SurfaceTexturePattern, number> = {
  knurl: 0,
  grooves: 1,
  honeycomb: 2,
  bumps: 3,
  fuzzy: 4,
  weave: 5,
  brick: 6,
  diamondPlate: 7,
  leather: 8,
  wood: 9,
  waves: 10,
  image: 11,
};

const PATTERN_GLSL = /* glsl */ `
attribute vec3 texPosed;
attribute vec3 texPosedNormal;
attribute float texSmooth;
`;

const VARYINGS = /* glsl */ `
varying vec3 vTexPosed;
varying vec3 vTexNormal;
varying float vTexSmooth;
`;

const HEIGHT_GLSL = /* glsl */ `
uniform int uTexPattern;
uniform int uTexWrap;
uniform float uTexSpacing;
uniform float uTexDepth;
uniform vec2 uTexTurn;
uniform vec3 uTexCenter;
uniform float uTexRepeats;
uniform float uTexSpacingAround;
uniform int uTexSeed;
uniform sampler2D uTexImage;
uniform float uTexImageTall;
uniform float uTexImageInvert;
uniform int uTexStamp;
uniform int uStampCount;
uniform vec3 uStampCenter[16];
uniform vec3 uStampNormal[16];
uniform vec3 uStampRight[16];
uniform vec3 uStampUp[16];
uniform float uStampTall;
uniform float uTexCut;

float texPeak(float x) { return 1.0 - 2.0 * abs(fract(x) - 0.5); }

float texRoundedPeak(float x) {
  float p = texPeak(x);
  float k = 0.1;
  float flank = p < k ? (p * p) / (2.0 * k) : (p > 1.0 - k ? 1.0 - k - ((1.0 - p) * (1.0 - p)) / (2.0 * k) : p - k / 2.0);
  return flank / (1.0 - k);
}

float texSoftMin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return max(0.0, min(a, b) - (h * h * k) / 4.0);
}

float texHoneycomb(float u, float v) {
  const float SQRT3 = 1.7320508;
  vec2 a = vec2(u - floor(u) - 0.5, (v / SQRT3 - floor(v / SQRT3) - 0.5) * SQRT3);
  float bu = u - 0.5;
  float bv = (v - SQRT3 / 2.0) / SQRT3;
  vec2 b = vec2(bu - floor(bu) - 0.5, (bv - floor(bv) - 0.5) * SQRT3);
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  float x = abs(g.x);
  float y = abs(g.y);
  float hexDistance = max(x, (x + SQRT3 * y) / 2.0);
  return smoothstep(0.0, 0.16, 0.5 - hexDistance);
}

float texBumps(float u, float v) {
  float row = floor(v);
  float shifted = u + (mod(row, 2.0) < 0.5 ? 0.0 : 0.5);
  float x = fract(shifted) - 0.5;
  float y = fract(v) - 0.5;
  float r = sqrt(x * x + y * y) / 0.42;
  return r >= 1.0 ? 0.0 : 0.5 + 0.5 * cos(3.14159265 * r);
}

float texHash(ivec3 c, int seed) {
  uint h = (uint(c.x) * 374761393u) ^ (uint(c.y) * 668265263u) ^ (uint(c.z) * 2147483647u) ^ (uint(seed) * 1274126177u);
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h) / 4294967296.0;
}

float texWeave(float u, float v) {
  float a = fract(u * 2.0);
  float b = fract(v * 2.0);
  bool over = mod(floor(u * 2.0) + floor(v * 2.0), 2.0) < 0.5;
  float across = over ? sin(3.14159265 * b) : sin(3.14159265 * a);
  float along = over ? sin(3.14159265 * a) : sin(3.14159265 * b);
  return sqrt(max(0.0, across)) * (0.55 + 0.45 * along);
}

float texBrick(float u, float v) {
  float row = floor(v * 2.0);
  float x = fract(u + (mod(row, 2.0) < 0.5 ? 0.0 : 0.5));
  float y = fract(v * 2.0);
  float edge = min(min(x, 1.0 - x), min(y / 2.0, (1.0 - y) / 2.0));
  return smoothstep(0.0, 0.07, edge);
}

float texDiamondPlate(float u, float v) {
  float x = fract(u * 2.0) - 0.5;
  float y = fract(v * 2.0) - 0.5;
  float turn = mod(floor(u * 2.0) + floor(v * 2.0), 2.0) < 0.5 ? 1.0 : -1.0;
  float along = (x + turn * y) / 1.4142136;
  float across = (x - turn * y) / 1.4142136;
  float r = length(vec2(along / 0.34, across / 0.08));
  return r >= 1.0 ? 0.0 : sqrt(1.0 - r * r);
}

float texLeather(float u, float v) {
  vec2 p = vec2(u, v) * 4.0;
  vec2 i = floor(p);
  float first = 1e9;
  float second = 1e9;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 c = i + vec2(float(dx), float(dy));
      ivec2 w = ivec2(mod(c, 4.0));
      vec2 q = c + 0.15 + 0.7 * vec2(texHash(ivec3(w, 0), 7), texHash(ivec3(w, 1), 7));
      float d = length(p - q);
      if (d < first) { second = first; first = d; }
      else if (d < second) { second = d; }
    }
  }
  return smoothstep(0.0, 0.35, second - first);
}

float texWood(float u, float v) {
  float line = u + 0.18 * sin(6.2831853 * v * 0.23) + 0.07 * sin(6.2831853 * v * 0.71 + 1.3);
  float h = 0.5 - 0.5 * cos(6.2831853 * line);
  return h * h * h;
}

float texImageHeight(float u, float v) {
  float g = texture2D(uTexImage, vec2(fract(u), 1.0 - fract(v / uTexImageTall))).r;
  return uTexImageInvert > 0.5 ? 1.0 - g : g;
}

float texPattern(float u, float v) {
  float h = 0.0;
  if (uTexPattern == 0) h = texSoftMin(texRoundedPeak(u + v), texRoundedPeak(u - v), 0.1);
  else if (uTexPattern == 1) h = 0.5 - 0.5 * cos(6.2831853 * u);
  else if (uTexPattern == 2) h = texHoneycomb(u, v);
  else if (uTexPattern == 3) h = texBumps(u, v);
  else if (uTexPattern == 5) h = texWeave(u, v);
  else if (uTexPattern == 6) h = texBrick(u, v);
  else if (uTexPattern == 7) h = texDiamondPlate(u, v);
  else if (uTexPattern == 8) h = texLeather(u, v);
  else if (uTexPattern == 9) h = texWood(u, v);
  else if (uTexPattern == 10) h = 0.5 + 0.5 * sin(6.2831853 * (u + 0.25 * sin(3.14159265 * v)));
  else h = texImageHeight(u, v);
  return h;
}

float texTurned(float u, float v) {
  return texPattern(u * uTexTurn.x - v * uTexTurn.y, u * uTexTurn.y + v * uTexTurn.x);
}

float texNoise(vec3 p, int seed) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 s = f * f * (3.0 - 2.0 * f);
  ivec3 c = ivec3(i);
  float x00 = mix(texHash(c, seed), texHash(c + ivec3(1, 0, 0), seed), s.x);
  float x10 = mix(texHash(c + ivec3(0, 1, 0), seed), texHash(c + ivec3(1, 1, 0), seed), s.x);
  float x01 = mix(texHash(c + ivec3(0, 0, 1), seed), texHash(c + ivec3(1, 0, 1), seed), s.x);
  float x11 = mix(texHash(c + ivec3(0, 1, 1), seed), texHash(c + ivec3(1, 1, 1), seed), s.x);
  return mix(mix(x00, x10, s.y), mix(x01, x11, s.y), s.z);
}

float texFuzzy(vec3 p) {
  float coarse = texNoise(p, uTexSeed);
  float fine = texNoise(p * 2.03 + vec3(17.1, 5.3, 11.7), uTexSeed + 1);
  return clamp((coarse * 0.7 + fine * 0.3 - 0.5) * 1.8 + 0.5, 0.0, 1.0);
}

float texStampAt(int i, vec3 p, vec3 n) {
  float outside = uTexCut > 0.5 ? 1.0 : 0.0;
  float h = outside;
  vec3 d = p - uStampCenter[i];
  float u = dot(d, uStampRight[i]) / uTexSpacing + 0.5;
  float v = dot(d, uStampUp[i]) / uTexSpacing + uStampTall / 2.0;
  bool inside = dot(n, uStampNormal[i]) >= 0.2 && abs(dot(d, uStampNormal[i])) <= uTexSpacing * 0.6
    && u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= uStampTall;
  if (inside) {
    float g = texture2D(uTexImage, vec2(clamp(u, 0.0, 1.0), clamp(1.0 - v / uStampTall, 0.0, 1.0))).r;
    if (uTexImageInvert > 0.5) g = 1.0 - g;
    h = uTexCut > 0.5 ? 1.0 - g : g;
  }
  return h;
}

float texStamp(vec3 p, vec3 n) {
  float h = uTexCut > 0.5 ? 1.0 : 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uStampCount) break;
    float s = texStampAt(i, p, n);
    h = uTexCut > 0.5 ? min(h, s) : max(h, s);
  }
  return h;
}

float texHeight(vec3 p, vec3 n) {
  float h = 0.0;
  if (uTexStamp >= 0) {
    h = texStamp(p, n);
  } else if (uTexPattern == 4) {
    h = texFuzzy(p / uTexSpacing);
  } else if (uTexWrap == 0) {
    float cap = smoothstep(0.55, 0.8, abs(n.y));
    float side = 0.0;
    if (cap < 1.0) {
      float theta = atan(p.z - uTexCenter.z, p.x - uTexCenter.x);
      side = texPattern((-theta / 6.2831853) * uTexRepeats, p.y / uTexSpacingAround);
    }
    float top = cap > 0.0 ? texTurned(p.x / uTexSpacing, (n.y >= 0.0 ? -p.z : p.z) / uTexSpacing) : 0.0;
    h = side * (1.0 - cap) + top * cap;
  } else {
    vec3 w = n * n * n * n;
    float sum = max(w.x + w.y + w.z, 1e-6);
    if (w.x > 1e-4) h += (w.x / sum) * texTurned((n.x >= 0.0 ? -p.z : p.z) / uTexSpacing, p.y / uTexSpacing);
    if (w.y > 1e-4) h += (w.y / sum) * texTurned(p.x / uTexSpacing, (n.y >= 0.0 ? -p.z : p.z) / uTexSpacing);
    if (w.z > 1e-4) h += (w.z / sum) * texTurned((n.z >= 0.0 ? p.x : -p.x) / uTexSpacing, p.y / uTexSpacing);
  }
  return h;
}
`;

type PreviewUniforms = {
  uTexPattern: { value: number };
  uTexWrap: { value: number };
  uTexSpacing: { value: number };
  uTexDepth: { value: number };
  uTexTurn: { value: THREE.Vector2 };
  uTexCenter: { value: THREE.Vector3 };
  uTexRepeats: { value: number };
  uTexSpacingAround: { value: number };
  uTexSeed: { value: number };
  uTexImage: { value: THREE.Texture | null };
  uTexImageTall: { value: number };
  uTexImageInvert: { value: number };
  uTexStamp: { value: number };
  uStampCount: { value: number };
  uStampCenter: { value: THREE.Vector3[] };
  uStampNormal: { value: THREE.Vector3[] };
  uStampRight: { value: THREE.Vector3[] };
  uStampUp: { value: THREE.Vector3[] };
  uStampTall: { value: number };
  uTexCut: { value: number };
};

const imageTextures = new Map<string, THREE.DataTexture>();
let blank: THREE.DataTexture | null = null;

function blankImage() {
  if (!blank) {
    blank = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat);
    blank.needsUpdate = true;
  }
  return blank;
}

/** The picture on the graphics card, wrapped at the edges and read smoothly, as the build reads it. */
function imageTexture(image: SurfaceTextureImage): THREE.DataTexture {
  const known = imageTextures.get(image.data);
  if (known) return known;
  const { pixels } = decodeTextureImage(image);
  const map = new THREE.DataTexture(pixels, image.width, image.height, THREE.RedFormat);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearFilter;
  map.unpackAlignment = 1;
  map.needsUpdate = true;
  imageTextures.set(image.data, map);
  while (imageTextures.size > 8) {
    const oldest = imageTextures.keys().next().value;
    if (oldest === undefined) break;
    imageTextures.get(oldest)?.dispose();
    imageTextures.delete(oldest);
  }
  return map;
}

/** A copy of the part's material that shades the texture on. */
export function texturePreviewMaterial(
  base: THREE.MeshStandardMaterial,
  texture: SurfaceTexture,
  layout: SurfaceTextureLayout,
): THREE.MeshStandardMaterial {
  const material = base.clone();
  const angle = (texture.angle * Math.PI) / 180;
  const placed = texture.pattern === "image" && texture.placement !== "tile";
  const stamps = !placed
    ? []
    : texture.placement === "once"
      ? (texture.stamp ? [texture.stamp] : [])
      : fittingStamps(texture, layout.eachFace);
  // Every slot is filled, so the arrays always have their full length.
  const slots = Array.from({ length: MAX_EACH_STAMPS }, (_, i) => stamps[i] ?? { point: [0, 0, 0], normal: [0, 0, 1] });
  const frames = slots.map((stamp) => stampFrame(stamp, texture.angle));
  const uniforms: PreviewUniforms = {
    uTexPattern: { value: PATTERN_CODE[texture.pattern] },
    uTexWrap: { value: layout.wrap === "around" ? 0 : 1 },
    uTexSpacing: { value: texture.spacing },
    uTexDepth: { value: texture.depth },
    uTexTurn: { value: new THREE.Vector2(Math.cos(angle), Math.sin(angle)) },
    uTexCenter: { value: new THREE.Vector3(...layout.center) },
    uTexRepeats: { value: layout.repeatsAround },
    uTexSpacingAround: { value: layout.spacingAround },
    uTexSeed: { value: texture.seed },
    uTexImage: { value: texture.pattern === "image" && texture.image ? imageTexture(texture.image) : blankImage() },
    uTexImageTall: { value: texture.image ? texture.image.height / texture.image.width : 1 },
    uTexImageInvert: { value: texture.image?.invert ? 1 : 0 },
    // -1 tiles the pattern; otherwise the pictures are placed, uStampCount of them.
    uTexStamp: { value: placed ? 1 : -1 },
    uStampCount: { value: Math.min(MAX_EACH_STAMPS, stamps.length) },
    uStampCenter: { value: slots.map((stamp) => new THREE.Vector3(...stamp.point)) },
    uStampNormal: { value: frames.map((frame) => new THREE.Vector3(...frame.normal)) },
    uStampRight: { value: frames.map((frame) => new THREE.Vector3(...frame.right)) },
    uStampUp: { value: frames.map((frame) => new THREE.Vector3(...frame.up)) },
    uStampTall: { value: texture.image ? texture.image.height / texture.image.width : 1 },
    uTexCut: { value: texture.direction === "in" ? 1 : 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = PATTERN_GLSL + VARYINGS + shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      vTexPosed = texPosed;
      vTexNormal = texPosedNormal;
      vTexSmooth = texSmooth;`,
    );
    shader.fragmentShader = VARYINGS + HEIGHT_GLSL + shader.fragmentShader
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        // Raised parts catch the light; valleys sit a little darker, so depth reads at a glance.
        float texWeight = 1.0 - clamp(vTexSmooth, 0.0, 1.0);
        float texRaw = texHeight(vTexPosed, normalize(vTexNormal));
        diffuseColor.rgb *= mix(1.0, mix(0.78, 1.0, texRaw), texWeight);
        float texH = texRaw * texWeight;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          // Tilt the shading normal by the slope of the texture, as if the surface had moved.
          float texMove = texH * uTexDepth;
          vec3 sigmaX = dFdx(-vViewPosition);
          vec3 sigmaY = dFdy(-vViewPosition);
          vec3 r1 = cross(sigmaY, normal);
          vec3 r2 = cross(normal, sigmaX);
          float det = dot(sigmaX, r1) * faceDirection;
          vec2 slope = vec2(dFdx(texMove), dFdy(texMove));
          vec3 grad = sign(det) * (slope.x * r1 + slope.y * r2);
          normal = normalize(abs(det) * normal - grad);
        }`,
      );
  };
  // Every preview shares one compiled program; only the numbers differ.
  material.customProgramCacheKey = () => "surface-texture-preview";
  material.userData.surfaceTexturePreview = true;
  return material;
}

/** The preview body as a mesh geometry, with the posed points and facings the pattern is read from. */
export function texturePreviewGeometry(
  localPositions: Float32Array,
  localNormals: Float32Array,
  posed: { positions: Float32Array; normals: Float32Array; smooth: Float32Array },
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(localPositions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(localNormals, 3));
  geometry.setAttribute("texPosed", new THREE.BufferAttribute(posed.positions, 3));
  geometry.setAttribute("texPosedNormal", new THREE.BufferAttribute(posed.normals, 3));
  geometry.setAttribute("texSmooth", new THREE.BufferAttribute(posed.smooth, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** How long a finished texture takes to rise out of the surface. */
export const TEXTURE_RISE_MS = 520;

const rising = new Set<{ start: number; uniform: { value: number } }>();

/**
 * A copy of the part's material that grows the texture out of the plain surface,
 * starting at `start`. The shading already has the texture's slopes, so the first
 * frame matches the quick preview and the bumps then rise into place.
 */
export function textureRiseMaterial(base: THREE.MeshStandardMaterial, start: number): THREE.MeshStandardMaterial {
  const material = base.clone();
  const entry = { start, uniform: { value: 0 } };
  rising.add(entry);
  tickTextureRise(performance.now());
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTexRise = entry.uniform;
    shader.vertexShader = `attribute vec3 texBase;\nuniform float uTexRise;\n${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      transformed = mix(texBase, transformed, uTexRise);`,
    );
  };
  material.customProgramCacheKey = () => "surface-texture-rise";
  return material;
}

/** Moves every rising texture on; true while any is still rising, so the view keeps drawing. */
export function tickTextureRise(now: number): boolean {
  if (rising.size === 0) return false;
  rising.forEach((entry) => {
    const t = Math.min(1, Math.max(0, (now - entry.start) / TEXTURE_RISE_MS));
    entry.uniform.value = 1 - (1 - t) ** 3;
    if (t >= 1) rising.delete(entry);
  });
  return true;
}
