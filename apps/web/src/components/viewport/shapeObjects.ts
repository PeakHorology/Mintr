import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { createBooleanTextGeometry } from "@/lib/editorShapeMesh";
import { meshCreaseEdges } from "@/lib/meshCreaseEdges";
import { shapeFromSketchRevolve } from "@/lib/sketchRevolve";
import { createGearGeometry } from "@/lib/gearMesh";
import { gearSpecKey } from "@/lib/gearProfile";
import { isConstantRadiusRoundKind, isRoundMeasureKind } from "@/lib/rulerAlignment";
import { clipPolylineToSurface, indexMeshSurface, SURFACE_LINE_TOLERANCE } from "@/lib/clipEdgesToMesh";
import {
  getActiveDisplayQuality,
  resolveHollowCylinderSegments,
  resolveIcosahedronDetail,
  resolveShapeSides,
  resolveShapeSteps,
  shapeTessellationFingerprint,
} from "@/lib/displayTessellation";
import { displayTriangleCount } from "@/lib/displayTriangleCount";
import { shadeDisplayNormals } from "@/lib/meshShade";
import { LASER_JOB_COLOR } from "@/lib/laser/cutFile";
import { hasUsableCsgResultMesh, viewportCadDisplayEdges, viewportGroupChildren } from "@/lib/csgTree";
import {
  coneUnitBaseScale,
  coneUnitTopScale,
  groupedChildrenDisplayScale,
  mirroredAxisCount,
  mirrorSign,
  preservesEdgeTreatmentSize,
  resizedImportedCoordinates,
  resizedImportedMeshPositions,
  shapeDepth,
  shapeWidth,
} from "@/lib/workplaneShapes";
import { sphereTessellation } from "@/lib/sphereTessellation";
import { roofAnglesFromProfile } from "@/lib/roofGeometry";
import { clamp, rulerShapeTopologyKey } from "@/lib/viewportInteractionMath";
import type { WorkplaneShape } from "@/types/sketchforge";
import { hardwareProfile } from "@/lib/desktopHardware";
import { projectShapesFingerprint } from "@/lib/editorHistory";
import { surfaceTexturePreviewFor, surfaceTextureRiseStart, surfaceTextureState, surfaceTextureVersion } from "@/lib/texture/texturedShape";
import { texturePreviewGeometry, texturePreviewMaterial, textureRiseMaterial } from "@/lib/texture/texturePreviewMaterial";
import { splitCreasesForShading } from "@/lib/texture/textureMesh";
import { CAD_DISPLAY_EDGE_NAME, SHAPE_OUTLINE_BRONZE } from "@/components/viewport/shapeOutlines";
import { settleLiftMm } from "@/components/viewport/shapeSettle";

export const importedGeometryCache = new WeakMap<
  NonNullable<WorkplaneShape["importedMesh"]>,
  { geometry: THREE.BufferGeometry; edges: Map<number, THREE.EdgesGeometry>; welded?: THREE.BufferGeometry }
>();
export const preservedImportedGeometryCache = new WeakMap<WorkplaneShape, THREE.BufferGeometry>();
export const imageTextureLoader = new THREE.TextureLoader();
/**
 * Decoded image-plate textures, keyed by the plate they came from.
 *
 * Shape rebuilds run on every drag, resize and selection change, and each one was decoding the
 * plate's full-resolution data URL again and re-uploading it to the GPU. The plate object identity
 * only changes when the picture does, so it is the right cache key.
 */
export const imagePlateTextureCache = new WeakMap<NonNullable<WorkplaneShape["imagePlate"]>, THREE.Texture>();
export const IMPORTED_SELECTED_EDGE_TRIANGLE_LIMIT = hardwareProfile().importedEdgeTriangleLimit;
export const NORMAL_IMPORTED_SELECTION_EDGE_ANGLE = 20;
/** Feature creases only. Fillet facets sit near 11°, so they stay off this line. */
export const IMPORTED_MESH_EDGE_ANGLE = 20;
export const MODEL_CREASE_COLOR = "#5a6972";
export const HOLE_EDGE_COLOR = "#7d8a94";

export function shapeRenderFingerprint(shape: WorkplaneShape, showEdges: boolean) {
  const quality = getActiveDisplayQuality();
  const texture = shape.surfaceTexture ? `|tex:${surfaceTextureVersion()}` : "";
  return `${projectShapesFingerprint([shape])}|edges:${showEdges ? 1 : 0}${shapeTessellationFingerprint(shape, quality)}${texture}`;
}

/** Pose lives on the Object3D. Selection only changes the outline, not the mesh. */
export function shapeGeometryFingerprint(shape: WorkplaneShape) {
  return shapeRenderFingerprint({
    ...shape,
    x: 0,
    z: 0,
    elevation: 0,
    rotation: 0,
    rotationX: 0,
    rotationZ: 0,
    mirrorX: undefined,
    mirrorY: undefined,
    mirrorZ: undefined,
  }, false);
}

export function applyShapePose(object: THREE.Object3D, shape: WorkplaneShape) {
  const restY = (shape.elevation ?? 0) + shape.height / 2;
  object.position.x = shape.x;
  object.position.z = shape.z;
  if (object.userData.settling || object.userData.pendingSettle) {
    object.userData.settleRestY = restY;
    if (object.userData.pendingSettle) object.position.y = restY + settleLiftMm();
  } else if (object.userData.rising) {
    const restPos = object.userData.riseRestPos;
    if (restPos instanceof THREE.Vector3) restPos.set(shape.x, restY, shape.z);
    else object.userData.riseRestPos = new THREE.Vector3(shape.x, restY, shape.z);
  } else {
    object.position.y = restY;
  }
  object.rotation.set(
    THREE.MathUtils.degToRad(shape.rotationX ?? 0),
    THREE.MathUtils.degToRad(shape.rotation),
    THREE.MathUtils.degToRad(shape.rotationZ ?? 0),
  );
  const restScaleX = mirrorSign(shape.mirrorX);
  const restScaleY = mirrorSign(shape.mirrorY);
  const restScaleZ = mirrorSign(shape.mirrorZ);
  if (object.userData.combining) {
    const rest = object.userData.combineRestScale;
    if (rest instanceof THREE.Vector3) rest.set(restScaleX, restScaleY, restScaleZ);
    else object.userData.combineRestScale = new THREE.Vector3(restScaleX, restScaleY, restScaleZ);
  } else if (object.userData.rising) {
    const rest = object.userData.riseRestScale;
    if (rest instanceof THREE.Vector3) rest.set(restScaleX, restScaleY, restScaleZ);
    else object.userData.riseRestScale = new THREE.Vector3(restScaleX, restScaleY, restScaleZ);
  } else {
    object.scale.set(restScaleX, restScaleY, restScaleZ);
  }
  object.updateMatrixWorld(true);
}

/**
 * Hole cutter look: frosted glass, like the crystal blank. Faces turned toward the camera stay
 * clear so the part behind shows through; faces seen edge-on frost up, so the hole's outline
 * reads from any angle against the light workplane. A faint 45° hatch keeps the familiar "this
 * is a hole" cue.
 */
export function createHoleStripeMaterial(role: "hole" | "overlap" = "hole") {
  const overlap = role === "overlap";
  const light = new THREE.Color(overlap ? "#c3ced6" : "#a9b8c4");
  const dark = new THREE.Color(overlap ? "#97a5af" : "#93a3b0");
  const frost = new THREE.Color(overlap ? "#d7e0e6" : "#eef3f6");
  const material = new THREE.MeshStandardMaterial({
    color: overlap ? "#a9b5bd" : "#dfe6ea",
    transparent: true,
    opacity: overlap ? 0.5 : 0.5,
    depthTest: true,
    depthWrite: false,
    roughness: 0.3,
    metalness: 0,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: overlap ? -2 : 1,
    polygonOffsetUnits: overlap ? -2 : 1,
  });
  material.userData.holeStripe = role;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.holeStripeLight = { value: light };
    shader.uniforms.holeStripeDark = { value: dark };
    shader.uniforms.holeFrost = { value: frost };
    shader.uniforms.holeStripeScale = { value: overlap ? 0.18 : 0.14 };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vHoleWorldPos;
varying float vHoleGlancing;`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vHoleWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vec3 holeViewNormal = normalize(normalMatrix * objectNormal);
vHoleGlancing = 1.0 - abs(dot(holeViewNormal, normalize(-mvPosition.xyz)));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vHoleWorldPos;
varying float vHoleGlancing;
uniform vec3 holeStripeLight;
uniform vec3 holeStripeDark;
uniform vec3 holeFrost;
uniform float holeStripeScale;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float hatch = fract((vHoleWorldPos.x + vHoleWorldPos.y) * holeStripeScale);
float band = smoothstep(0.28, 0.5, hatch) * (1.0 - smoothstep(0.78, 1.0, hatch));
float rim = pow(clamp(vHoleGlancing, 0.0, 1.0), 2.2);
diffuseColor.rgb = mix(mix(holeStripeLight, holeStripeDark, band * 0.38), holeFrost, rim * 0.7);
diffuseColor.a = clamp(diffuseColor.a * (0.8 + rim * 1.2), 0.0, 0.88);`,
      )
      // Lighting alone turns faces facing the light near-white, lost on the workplane. Blend in
      // the frost colour after lighting so every face of a hole keeps the same body.
      .replace(
        "#include <opaque_fragment>",
        `outgoingLight = mix(outgoingLight, diffuseColor.rgb, 0.55);
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `peakcad-hole-frost-${role}-v10`;
  return material;
}

/** Parts bigger than this skip the job outline; finding their top edges would stall the view. */
export const LASER_MARK_TRIANGLE_LIMIT = 200_000;
/** Engraving shows as the sheet burnt dark. */
export const ENGRAVE_BURN_COLOR = new THREE.Color("#2b211b");

/**
 * Shows a laser part's job as the cut file has it: its top outline in red for cut or
 * blue for score, and an engraved part darkened as if burnt.
 */
export function addLaserJobMarks(object: THREE.Object3D, shape: WorkplaneShape) {
  const job = shape.laserJob ?? "cut";
  const bodies: THREE.Mesh[] = [];
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.userData.printBody) bodies.push(child);
  });
  for (const body of bodies) {
    if (job === "engrave") {
      // A copy, so a material shared with other parts stays as it is.
      const burn = (material: THREE.Material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return material;
        const burnt = material.clone();
        burnt.color.lerp(ENGRAVE_BURN_COLOR, 0.78);
        return burnt;
      };
      body.material = Array.isArray(body.material) ? body.material.map(burn) : burn(body.material);
      continue;
    }
    const geometry = body.geometry;
    const triangles = (geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0) / 3;
    if (triangles === 0 || triangles > LASER_MARK_TRIANGLE_LIMIT) continue;
    geometry.computeBoundingBox();
    const top = geometry.boundingBox?.max.y;
    if (top === undefined) continue;
    // The top face's edges are the part's outline as the laser sees it, holes and all.
    const edges = new THREE.EdgesGeometry(geometry, 30);
    const position = edges.getAttribute("position");
    const kept: number[] = [];
    const near = Math.max(1e-3, (top - (geometry.boundingBox?.min.y ?? top)) * 0.02);
    for (let i = 0; i + 1 < position.count; i += 2) {
      if (top - position.getY(i) > near || top - position.getY(i + 1) > near) continue;
      kept.push(position.getX(i), top, position.getZ(i), position.getX(i + 1), top, position.getZ(i + 1));
    }
    edges.dispose();
    if (kept.length === 0) continue;
    const outline = new THREE.BufferGeometry();
    outline.setAttribute("position", new THREE.Float32BufferAttribute(kept, 3));
    const lines = new THREE.LineSegments(
      outline,
      new THREE.LineBasicMaterial({ color: LASER_JOB_COLOR[job], transparent: true, opacity: 0.95, depthTest: true }),
    );
    lines.name = "laser-job-outline";
    lines.renderOrder = 2;
    // A hair above the top face, so the face never hides it.
    lines.position.y = 0.02;
    lines.raycast = () => {};
    body.add(lines);
  }
}

export function createShapeObject(shape: WorkplaneShape, showEdges = false, onTextureReady?: () => void) {
  const group = new THREE.Group();
  group.name = shape.name;
  group.userData.shapeId = shape.id;
  group.userData.hole = Boolean(shape.hole);
  group.userData.construction = Boolean(shape.construction);
  group.userData.round = isRoundMeasureKind(shape.kind, shape.hole);
  group.userData.radialSnap = isConstantRadiusRoundKind(shape.kind)
    && Math.abs(shapeWidth(shape) - shapeDepth(shape)) <= 0.05;
  group.userData.shapeKind = shape.kind;
  group.userData.sketchFinish = shape.sketchFinish;
  group.userData.riseHeight = shape.height;
  group.userData.showEdges = showEdges;
  group.userData.rulerDimensions = [shapeWidth(shape), shape.height, shapeDepth(shape)] satisfies [number, number, number];
  group.userData.rulerTopologyKey = rulerShapeTopologyKey(shape);
  group.position.set(shape.x, (shape.elevation ?? 0) + shape.height / 2, shape.z);
  group.rotation.set(
    THREE.MathUtils.degToRad(shape.rotationX ?? 0),
    THREE.MathUtils.degToRad(shape.rotation),
    THREE.MathUtils.degToRad(shape.rotationZ ?? 0),
  );
  group.scale.set(mirrorSign(shape.mirrorX), mirrorSign(shape.mirrorY), mirrorSign(shape.mirrorZ));

  if (shape.groupedShapes?.length && !hasUsableCsgResultMesh(shape)) {
    const content = new THREE.Group();
    viewportGroupChildren(shape).forEach((child) => {
      const childShape = child;
      const childObject = createShapeObject(childShape, showEdges, onTextureReady);
      content.add(childObject);
    });
    const displayScale = groupedChildrenDisplayScale(shape);
    content.scale.set(displayScale.x, displayScale.y, displayScale.z);
    content.position.y = -shape.height / 2;
    group.add(content);
    group.traverse((child) => {
      child.userData.shapeId = shape.id;
    });
    return group;
  }

  // Solids use FrontSide so a true CSG cavity shows interior walls (not a see-through shell).
  // DoubleSide only for construction ghosts, odd mirror flips, or open/non-manifold json previews.
  // Sketch extrusions are json meshes, but they are closed solids — DoubleSide + polygon offset
  // pulls far-wall fragments forward so every crease, including hidden ones, shows through.
  const flippedWinding = mirroredAxisCount(shape) % 2 === 1;
  const openJsonPreview = Boolean(
    shape.importedMesh?.sourceFormat === "json"
    && !shape.groupedShapes?.length
    && !shape.hole
    && !shape.sketchFinish
    && !shape.cadBrep,
  );
  const material = shape.hole
    ? createHoleStripeMaterial("hole")
    : new THREE.MeshStandardMaterial({
    color: shape.color,
    roughness: shape.construction ? 0.2 : 0.57,
    metalness: 0.02,
    transparent: Boolean(shape.construction),
    opacity: shape.construction ? 0.28 : 1,
    depthWrite: !shape.construction,
    side: shape.construction || flippedWinding || openJsonPreview ? THREE.DoubleSide : THREE.FrontSide,
    // Push faces slightly back so crease lines stay visible (avoids washed-out coplanar edges).
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  const width = shapeWidth(shape);
  const depth = shapeDepth(shape);
  const size = Math.min(width, depth);
  const height = shape.height;

  // A textured part shows its textured triangles once they are built. Until then the plain body
  // is shaded with the pattern, so a change shows the moment it is made.
  if (!shape.hole && !shape.construction && shape.surfaceTexture) {
    const texture = surfaceTextureState(shape);
    const preview = surfaceTexturePreviewFor(shape);
    if (texture.status === "ready" || preview) {
      group.userData.surfaceTextured = true;
      const body = preview ? texturePreviewDisplayGeometry(group, shape, preview) : null;
      if (texture.status === "ready") {
        // A texture that has just finished rises out of the surface instead of popping in.
        const riseStart = surfaceTextureRiseStart(texture.key);
        addMesh(group, texturedDisplayGeometry(group, shape, texture.key, texture.result), riseStart === null ? material : textureRiseMaterial(material, riseStart), shape);
        const shown = group.children[group.children.length - 1];
        if (body && shown) shown.userData.pickGeometry = body;
      } else if (body && preview) {
        addMesh(group, body, texturePreviewMaterial(material, preview.texture, preview.layout), shape);
      }
      group.traverse((child) => {
        child.userData.shapeId = shape.id;
      });
      return group;
    }
  }

  switch (shape.kind) {
    case "box":
      addMesh(
        group,
        shape.radius && shape.radius > 0
          ? new RoundedBoxGeometry(width, height, depth, Math.max(1, resolveShapeSteps(shape.kind, shape.steps) ?? 16), shape.radius)
          : new THREE.BoxGeometry(width, height, depth),
        shape.imagePlate && !shape.hole ? createImagePlateMaterials(shape, material, onTextureReady) : material,
        shape,
      );
      break;
    case "cylinder":
      addMesh(
        group,
        new THREE.CylinderGeometry(1, 1, height, resolveShapeSides(shape.kind, shape.sides) ?? 192, shape.segments ?? 1),
        material,
        shape,
        undefined,
        undefined,
        new THREE.Vector3(width / 2, 1, depth / 2),
      );
      break;
    case "sphere": {
      const { widthSegments, heightSegments } = sphereTessellation(resolveShapeSteps(shape.kind, shape.steps));
      addMesh(group, new THREE.SphereGeometry(1, widthSegments, heightSegments), material, shape, undefined, undefined, new THREE.Vector3(width / 2, height / 2, depth / 2));
      break;
    }
    case "cone": {
      addMesh(
        group,
        new THREE.CylinderGeometry(coneUnitTopScale(shape), coneUnitBaseScale(shape), height, resolveShapeSides(shape.kind, shape.sides) ?? 192),
        material,
        shape,
        undefined,
        undefined,
        new THREE.Vector3(width / 2, 1, depth / 2),
      );
      break;
    }
    case "pyramid":
      addMesh(group, createPyramidGeometry(width, height, depth, shape.sides ?? 4), material, shape);
      break;
    case "roof":
      addMesh(group, createRoofGeometry(width, height, depth, shape.leftAngle, shape.rightAngle), material, shape);
      break;
    case "roundRoof":
      addMesh(group, createRoundRoofGeometry(width, height, depth, resolveShapeSides(shape.kind, shape.sides) ?? 128), material, shape);
      break;
    case "halfSphere":
      addMesh(group, createHalfSphereGeometry(width, height, depth, resolveShapeSteps(shape.kind, shape.steps) ?? 56), material, shape);
      break;
    case "torus":
      addMesh(group, createTorusGeometry(width, height, depth, shape.radius, resolveShapeSteps(shape.kind, shape.steps) ?? 64), material, shape);
      break;
    case "ring":
      addMesh(group, createHollowCylinderGeometry(width, height, depth, shape.bevel ?? 4, resolveHollowCylinderSegments()), material, shape);
      break;
    case "tube":
      addMesh(group, createHollowCylinderGeometry(width, height, depth, shape.bevel ?? 4, resolveHollowCylinderSegments()), material, shape);
      break;
    case "wedge":
      addMesh(group, createWedgeGeometry(width, height, depth), material, shape);
      break;
    case "polygon":
      addMesh(group, new THREE.CylinderGeometry(1, 1, height, shape.sides ?? 6), material, shape, undefined, undefined, new THREE.Vector3(width / 2, 1, depth / 2));
      break;
    case "gear":
      addMesh(group, createGearGeometry(shape), material, shape);
      break;
    case "icosahedron":
      addMesh(group, new THREE.IcosahedronGeometry(size / 2, resolveIcosahedronDetail()), material, shape);
      break;
    case "text":
      addTextShape(group, material, shape);
      break;
    case "mesh":
    case "thread":
    case "loft":
    case "gridfinityBin":
    case "gridfinityBaseplate":
      // Gridfinity bodies arrive from the kernel asynchronously; until then the
      // footprint box stands in so the shape can be placed and sized.
      if (shape.importedMesh) {
        const preserveEdgeSize = preservesEdgeTreatmentSize(shape);
        const revolveGeometry = shape.sketchFinish === "revolve" ? revolveSolidGeometry(shape) : null;
        addMesh(
          group,
          revolveGeometry ?? (preserveEdgeSize ? getPreservedImportedMeshGeometry(shape) : getImportedMeshGeometry(shape.importedMesh, patternGeometryKey(shape))),
          material,
          shape,
          undefined,
          undefined,
          preserveEdgeSize ? undefined : new THREE.Vector3(
            width / Math.max(0.001, shape.importedMesh.baseWidth),
            height / Math.max(0.001, shape.importedMesh.baseHeight),
            depth / Math.max(0.001, shape.importedMesh.baseDepth),
          ),
        );
      } else if (shape.kind === "thread") {
        addMesh(
          group,
          new THREE.CylinderGeometry(1, 1, height, resolveShapeSides("thread", shape.sides) ?? 128, 1),
          material,
          shape,
          undefined,
          undefined,
          new THREE.Vector3(width / 2, 1, depth / 2),
        );
      } else {
        addMesh(group, new THREE.BoxGeometry(width, height, depth), material, shape);
      }
      break;
    case "scribble":
      addMesh(group, new THREE.TorusKnotGeometry(size * 0.22, size * 0.055, 120, 12), material, shape);
      break;
    case "sketch":
    default:
      addMesh(group, new THREE.BoxGeometry(width, height, depth), material, shape);
      break;
  }

  group.traverse((child) => {
    child.userData.shapeId = shape.id;
  });

  return group;
}

export const texturedGeometryCache = new Map<string, THREE.BufferGeometry>();
export const TEXTURED_GEOMETRY_CACHE_SIZE = 16;

/**
 * Textured triangles come in the part's posed frame (world turn, centred on the part).
 * The group turns and mirrors them again, so undo that here; addMesh then lowers the mesh by
 * half the height, so lift it by the same.
 */
export function texturedDisplayGeometry(
  group: THREE.Group,
  shape: WorkplaneShape,
  key: string,
  result: { positions: Float32Array; indices: Uint32Array; basePositions: Float32Array },
) {
  const cacheKey = `${key}|${group.rotation.x},${group.rotation.y},${group.rotation.z}|${group.scale.x},${group.scale.y},${group.scale.z}|${shape.height}`;
  const cached = texturedGeometryCache.get(cacheKey);
  if (cached) return cached;
  const quaternion = new THREE.Quaternion().setFromEuler(group.rotation);
  const toLocal = new THREE.Matrix4().compose(new THREE.Vector3(), quaternion, group.scale).invert();
  const unturn = quaternion.clone().invert();
  // Sharp edges keep their own facing on each side, so shading does not smear across them.
  const shaded = splitCreasesForShading(result);
  const positions = new Float32Array(shaded.positions.length);
  const normals = new Float32Array(shaded.normals.length);
  const bases = new Float32Array(shaded.positions.length);
  const point = new THREE.Vector3();
  const base = result.basePositions;
  for (let i = 0; i < positions.length; i += 3) {
    point.set(shaded.positions[i], shaded.positions[i + 1], shaded.positions[i + 2]).applyMatrix4(toLocal);
    positions[i] = point.x;
    positions[i + 1] = point.y + shape.height / 2;
    positions[i + 2] = point.z;
    const source = shaded.sources[i / 3] * 3;
    point.set(base[source], base[source + 1], base[source + 2]).applyMatrix4(toLocal);
    bases[i] = point.x;
    bases[i + 1] = point.y + shape.height / 2;
    bases[i + 2] = point.z;
    point.set(shaded.normals[i], shaded.normals[i + 1], shaded.normals[i + 2]).applyQuaternion(unturn).multiply(group.scale);
    normals[i] = point.x;
    normals[i + 1] = point.y;
    normals[i + 2] = point.z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  // Where each point sat before the texture moved it, for the texture rising into place.
  geometry.setAttribute("texBase", new THREE.BufferAttribute(bases, 3));
  // A mirror flips the triangles inside out; turn them back so the outside faces out.
  const flipped = group.scale.x * group.scale.y * group.scale.z < 0;
  const indices = shaded.indices;
  if (flipped) {
    for (let i = 0; i < indices.length; i += 3) {
      const second = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = second;
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.userData.keepNormals = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.cached = true;
  texturedGeometryCache.set(cacheKey, geometry);
  while (texturedGeometryCache.size > TEXTURED_GEOMETRY_CACHE_SIZE) {
    const oldest = texturedGeometryCache.keys().next().value;
    if (oldest === undefined) break;
    texturedGeometryCache.get(oldest)?.dispose();
    texturedGeometryCache.delete(oldest);
  }
  return geometry;
}

/** The plain body for the quick texture preview, in the group's own frame. */
export function texturePreviewDisplayGeometry(
  group: THREE.Group,
  shape: WorkplaneShape,
  preview: { key: string; positions: Float32Array; normals: Float32Array; smooth: Float32Array },
) {
  const cacheKey = `preview|${preview.key}|${group.rotation.x},${group.rotation.y},${group.rotation.z}|${group.scale.x},${group.scale.y},${group.scale.z}|${shape.height}`;
  const cached = texturedGeometryCache.get(cacheKey);
  if (cached) return cached;
  const quaternion = new THREE.Quaternion().setFromEuler(group.rotation);
  const toLocal = new THREE.Matrix4().compose(new THREE.Vector3(), quaternion, group.scale).invert();
  const unturn = quaternion.clone().invert();
  const flipped = group.scale.x * group.scale.y * group.scale.z < 0;
  const count = preview.positions.length / 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const posed = { positions: new Float32Array(count * 3), normals: new Float32Array(count * 3), smooth: new Float32Array(count) };
  const point = new THREE.Vector3();
  for (let corner = 0; corner < count; corner += 1) {
    // A mirror flips the triangles inside out; swapping two corners turns them back.
    const k = corner % 3;
    const from = flipped && k > 0 ? corner - k + (3 - k) : corner;
    point.set(preview.positions[from * 3], preview.positions[from * 3 + 1], preview.positions[from * 3 + 2]).applyMatrix4(toLocal);
    positions[corner * 3] = point.x;
    positions[corner * 3 + 1] = point.y + shape.height / 2;
    positions[corner * 3 + 2] = point.z;
    point.set(preview.normals[from * 3], preview.normals[from * 3 + 1], preview.normals[from * 3 + 2]).applyQuaternion(unturn).multiply(group.scale);
    normals[corner * 3] = point.x;
    normals[corner * 3 + 1] = point.y;
    normals[corner * 3 + 2] = point.z;
    for (let axis = 0; axis < 3; axis += 1) {
      posed.positions[corner * 3 + axis] = preview.positions[from * 3 + axis];
      posed.normals[corner * 3 + axis] = preview.normals[from * 3 + axis];
    }
    posed.smooth[corner] = preview.smooth[from];
  }
  const geometry = texturePreviewGeometry(positions, normals, posed);
  geometry.userData.cached = true;
  texturedGeometryCache.set(cacheKey, geometry);
  while (texturedGeometryCache.size > TEXTURED_GEOMETRY_CACHE_SIZE) {
    const oldest = texturedGeometryCache.keys().next().value;
    if (oldest === undefined) break;
    texturedGeometryCache.get(oldest)?.dispose();
    texturedGeometryCache.delete(oldest);
  }
  return geometry;
}

export function createImagePlateMaterials(shape: WorkplaneShape, sideMaterial: THREE.MeshStandardMaterial, onTextureReady?: () => void) {
  const sideMaterials = Array.from({ length: 5 }, (_, index) => (index === 0 ? sideMaterial : sideMaterial.clone()));
  const topMaterial = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.64,
    metalness: 0,
    transparent: true,
    alphaTest: 0.02,
    side: THREE.FrontSide,
  });

  const plate = shape.imagePlate;
  if (plate?.dataUrl) {
    const cached = imagePlateTextureCache.get(plate);
    if (cached) {
      topMaterial.map = cached;
      topMaterial.needsUpdate = true;
    } else {
      const texture = imageTextureLoader.load(plate.dataUrl, () => {
        texture.needsUpdate = true;
        topMaterial.needsUpdate = true;
        onTextureReady?.();
      });
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = hardwareProfile().maxAnisotropy;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      // Same opt-out convention as cached geometry: shared across rebuilds, so teardown of any one
      // mesh must not dispose it.
      texture.userData.cached = true;
      imagePlateTextureCache.set(plate, texture);
      topMaterial.map = texture;
    }
  }

  return [
    sideMaterials[0],
    sideMaterials[1],
    topMaterial,
    sideMaterials[2],
    sideMaterials[3],
    sideMaterials[4],
  ];
}

export const largePickRay = new THREE.Ray();
export const largePickInverse = new THREE.Matrix4();
export const largePickHit = new THREE.Vector3();
export const LARGE_PICK_TRIANGLE_CAP = 4_000;

/** Precise triangle tests on a reduced watch movement lock the window. The box is enough to select it. */
export function raycastImportedBounds(this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
  const geometry = this.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;
  largePickInverse.copy(this.matrixWorld).invert();
  largePickRay.copy(raycaster.ray).applyMatrix4(largePickInverse);
  if (largePickRay.intersectBox(box, largePickHit) === null) return;
  const point = largePickHit.clone().applyMatrix4(this.matrixWorld);
  const distance = raycaster.ray.origin.distanceTo(point);
  if (distance < raycaster.near || distance > raycaster.far) return;
  intersects.push({ distance, point, object: this });
}

export function addMesh(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  shape: WorkplaneShape,
  position?: THREE.Vector3,
  rotation?: THREE.Euler,
  scale?: THREE.Vector3,
) {
  let prepared = geometry.userData.cached ? geometry : putGeometryOnBase(geometry);
  if (!shape.importedMesh) {
    const key = patternGeometryKey(shape);
    if (key) {
      const existing = patternPrimitiveCache.get(key);
      if (existing && existing !== prepared) {
        if (!prepared.userData.cached) prepared.dispose();
        prepared = existing;
      } else if (!existing) {
        prepared.userData.cached = true;
        patternPrimitiveCache.set(key, prepared);
      }
    }
  }
  const mesh = new THREE.Mesh(prepared, material);
  mesh.userData.printBody = true;
  const importedTriangles = shape.importedMesh?.triangleCount ?? 0;
  const displayTriangles = displayTriangleCount(shape);
  mesh.castShadow = !shape.hole && !shape.construction && displayTriangles <= hardwareProfile().shadowCasterTriangleLimit;
  mesh.receiveShadow = false;
  const texturedTriangles = group.userData.surfaceTextured ? (prepared.index?.count ?? 0) / 3 : 0;
  if (importedTriangles > LARGE_PICK_TRIANGLE_CAP || texturedTriangles > LARGE_PICK_TRIANGLE_CAP) {
    mesh.raycast = raycastImportedBounds;
    mesh.userData.boundsPick = true;
  }
  if (position) {
    mesh.position.copy(position);
  }
  mesh.position.y -= shape.height / 2;
  if (rotation) {
    mesh.rotation.copy(rotation);
  }
  if (scale) {
    mesh.scale.copy(scale);
  }
  // The see-through workplane writes depth; drawn after a far hole it would wash the hole out.
  if (shape.hole) mesh.renderOrder = 3;
  group.add(mesh);
  // Crease lines on a texture would be every bump; the texture shows its own shape.
  if (group.userData.surfaceTextured) return;

  // Sharp solids keep idle edge accents; curved solids only outline when selected so facets stay quiet.
  const curvedSurface =
    shape.kind === "cylinder"
    || shape.kind === "cone"
    || shape.kind === "sphere"
    || shape.kind === "torus"
    || shape.kind === "halfSphere"
    || shape.kind === "roundRoof"
    || shape.kind === "tube"
    || shape.kind === "ring"
    || shape.kind === "thread"
    || shape.kind === "gear";
  const sharpDetailEdges =
    shape.kind === "mesh"
    || ["pyramid", "roof", "wedge"].includes(shape.kind);
  // Flat-faced primitives (box, polygon, …) need quiet crease lines when idle — lighting alone washes them out.
  const roundedBox = shape.kind === "box" && Boolean(shape.radius && shape.radius > 0);
  const facetedSolid = !curvedSurface && !roundedBox && !shape.importedMesh;
  const importedTriangleCount = shape.importedMesh?.triangleCount ?? 0;
  const skipHeavyImportedEdges = Boolean(shape.importedMesh) && importedTriangleCount > Math.min(IMPORTED_SELECTED_EDGE_TRIANGLE_LIMIT, 20_000);
  const showImportedCreases = Boolean(shape.importedMesh) && !shape.hole && !shape.construction && !skipHeavyImportedEdges;
  // Holes keep a quiet outline, like the crystal blank's edges, so the frosted body reads as a shape.
  const holeOutline = Boolean(shape.hole) && !shape.construction && !skipHeavyImportedEdges;
  const showIdleEdges = holeOutline || (!shape.hole && !shape.construction && (showImportedCreases || (!shape.importedMesh && (sharpDetailEdges || facetedSolid))));
  const selectedOutline = Boolean(group.userData.showEdges);
  const creaseEdges = showImportedCreases || sharpDetailEdges || facetedSolid;
  const cadEdgeColor = selectedOutline ? SHAPE_OUTLINE_BRONZE : MODEL_CREASE_COLOR;
  const cadDrawn = Boolean(
    shape.importedMesh
    && shape.cadDisplayEdgesVersion === 2
    && shape.cadDisplayEdges?.length
    && addCadDisplayEdges(group, shape, cadEdgeColor, selectedOutline ? 0.95 : 0.55),
  );
  if (!cadDrawn && (group.userData.showEdges || showIdleEdges) && !skipHeavyImportedEdges) {
    const selectedRoundedBox = selectedOutline && shape.kind === "box" && Boolean(shape.radius && shape.radius > 0);
    const edgeColor = selectedOutline ? SHAPE_OUTLINE_BRONZE : holeOutline ? HOLE_EDGE_COLOR : creaseEdges ? MODEL_CREASE_COLOR : darkenHex(shape.color, 0.55);
    const edgeOpacity = selectedRoundedBox
      ? 0
      : selectedOutline
        ? 0.9
        : holeOutline
          ? 0.7
          : creaseEdges
          ? 0.55
          : shape.kind === "text"
            ? 0.86
            : 0.8;
    const selectedThreshold = shape.importedMesh ? NORMAL_IMPORTED_SELECTION_EDGE_ANGLE : curvedSurface ? 28 : 1;
    // Keep polygon side creases visible even at higher side counts (dihedral ≈ 360/n).
    const polygonSides = shape.kind === "polygon" ? Math.max(3, shape.sides ?? 6) : 0;
    const idleThreshold = shape.importedMesh
      ? IMPORTED_MESH_EDGE_ANGLE
      : sharpDetailEdges
        ? 18
        : polygonSides > 0
          ? Math.max(6, Math.min(20, (360 / polygonSides) * 0.45))
          : 20;
    const edges = new THREE.LineSegments(
      getEdgesGeometry(shape, prepared, selectedOutline ? selectedThreshold : idleThreshold),
      new THREE.LineBasicMaterial({
        color: edgeColor,
        transparent: true,
        opacity: edgeOpacity,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    edges.userData.complexEdge = sharpDetailEdges || curvedSurface || facetedSolid;
    edges.renderOrder = holeOutline ? 4 : selectedOutline ? 2 : 1;
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    edges.scale.copy(mesh.scale);
    group.add(edges);
  }
}

export function addCadDisplayEdges(group: THREE.Group, shape: WorkplaneShape, color: string, opacity: number) {
  if (!shape.cadDisplayEdges?.length || !shape.importedMesh) return false;
  // Compare in the baked mesh frame. Resizing happens once, when the line is drawn.
  const edges = viewportCadDisplayEdges(
    shape.cadDisplayEdges,
    shape.importedMesh.positions,
    shape.importedMesh.indices,
  );
  const surface = edges.length > 0
    ? indexMeshSurface(shape.importedMesh.positions, shape.importedMesh.indices)
    : null;
  const drawn = surface
    ? edges.flatMap((edge) => clipPolylineToSurface(edge.points, surface, SURFACE_LINE_TOLERANCE).map((points) => ({ points })))
    : edges;
  if (drawn.length === 0) return false;
  const material = new THREE.LineBasicMaterial({
    color,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    opacity,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  drawn.forEach((edge) => {
    if (edge.points.length < 6) return;
    const positions = resizedImportedCoordinates(shape, edge.points);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const line = new THREE.Line(geometry, material);
    line.name = CAD_DISPLAY_EDGE_NAME;
    line.position.y -= shape.height / 2;
    line.renderOrder = 2;
    line.userData.complexEdge = true;
    group.add(line);
  });
  return true;
}

export function setFlatTriangleNormals(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  const normals = new Float32Array(position.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let i = 0; i + 2 < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac);
    if (normal.lengthSq() < 1e-12) normal.set(0, 1, 0);
    else normal.normalize();
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = (i + corner) * 3;
      normals[offset] = normal.x;
      normals[offset + 1] = normal.y;
      normals[offset + 2] = normal.z;
    }
  }
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
}

export const patternGeometryCache = new Map<string, { geometry: THREE.BufferGeometry; edges: Map<number, THREE.EdgesGeometry> }>();
export const patternPrimitiveCache = new Map<string, THREE.BufferGeometry>();

export function patternGeometryKey(shape: WorkplaneShape) {
  const feature = shape.patternFeature;
  // A textured copy has its own triangles, posed where it stands.
  if (!feature || shape.surfaceTexture) return null;
  const mesh = shape.importedMesh;
  return [
    feature.sourceId,
    shape.kind,
    shape.width,
    shape.height,
    shape.depth,
    shape.radius ?? "",
    shape.sides ?? "",
    shape.steps ?? "",
    shape.kind === "gear" ? gearSpecKey(shape.gearSpec) : "",
    mesh?.triangleCount ?? 0,
    mesh?.positions.length ?? 0,
  ].join("|");
}

export function getImportedMeshCache(mesh: NonNullable<WorkplaneShape["importedMesh"]>, shareKey?: string | null) {
  if (shareKey) {
    const shared = patternGeometryCache.get(shareKey);
    if (shared) return shared;
  }
  const cached = importedGeometryCache.get(mesh);
  if (cached) {
    if (shareKey) patternGeometryCache.set(shareKey, cached);
    return cached;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
  if (mesh.indices && mesh.indices.length >= 3) {
    geometry.setIndex(mesh.indices);
  }
  const hasNormals = Boolean(mesh.normals && mesh.normals.length === mesh.positions.length);
  const tooBigToWeld = !hasNormals && !(mesh.indices && mesh.indices.length >= 3)
    && Math.floor(mesh.positions.length / 9) > 80_000;
  // Meshes without normals (split pieces, some imports) get creased smooth normals
  // instead of one flat normal per triangle.
  const shaded = tooBigToWeld
    ? null
    : shadeDisplayNormals(mesh.positions, hasNormals ? mesh.normals : undefined, mesh.indices);
  if (shaded) {
    geometry.setAttribute("normal", new THREE.BufferAttribute(shaded, 3));
    geometry.userData.keepNormals = true;
  } else if (!geometry.index && Math.floor(mesh.positions.length / 9) > 80_000) {
    setFlatTriangleNormals(geometry);
    geometry.userData.keepNormals = true;
  } else {
    geometry.computeVertexNormals();
  }
  putGeometryOnBase(geometry);
  geometry.userData.cached = true;
  const next = { geometry, edges: new Map<number, THREE.EdgesGeometry>() };
  importedGeometryCache.set(mesh, next);
  if (shareKey) patternGeometryCache.set(shareKey, next);
  return next;
}

export function getImportedMeshGeometry(mesh: NonNullable<WorkplaneShape["importedMesh"]>, shareKey?: string | null) {
  return getImportedMeshCache(mesh, shareKey).geometry;
}

export function revolveSolidGeometry(shape: WorkplaneShape): THREE.BufferGeometry | null {
  const axis = shape.sketchRevolveAxis;
  const profile = shape.sketchProfile;
  if (!axis || !profile) return null;
  const signature = `${profile.points.length}:${profile.segments.length}:${axis.x1}:${axis.z1}:${axis.x2}:${axis.z2}`;
  const shareKey = `revolve-solid:outward:${shape.id}:${signature}`;
  const cached = patternGeometryCache.get(shareKey);
  if (cached) {
    cached.geometry.userData.useThisForEdges = true;
    return cached.geometry;
  }
  const rebuilt = shapeFromSketchRevolve(profile, {
    start: { x: axis.x1, z: axis.z1 },
    end: { x: axis.x2, z: axis.z2 },
  }, shape);
  if (!rebuilt?.importedMesh) return null;
  const geometry = getImportedMeshGeometry(rebuilt.importedMesh, shareKey);
  geometry.userData.useThisForEdges = true;
  return geometry;
}

export function getPreservedImportedMeshGeometry(shape: WorkplaneShape) {
  const cached = preservedImportedGeometryCache.get(shape);
  if (cached) return cached;
  const positions = resizedImportedMeshPositions(shape);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const indices = shape.importedMesh?.indices;
  if (indices && indices.length >= 3) {
    geometry.setIndex(indices);
  }
  // The fillet zone is held still while the body stretches, so the stored
  // normals no longer match. Rebuild them from the resized surface. A concave
  // groove and a convex round both stay smooth.
  const shaded = shadeDisplayNormals(positions, undefined, indices);
  if (shaded) {
    geometry.setAttribute("normal", new THREE.BufferAttribute(shaded, 3));
    geometry.userData.keepNormals = true;
  } else {
    geometry.computeVertexNormals();
  }
  putGeometryOnBase(geometry);
  geometry.userData.cached = true;
  preservedImportedGeometryCache.set(shape, geometry);
  return geometry;
}

export function getEdgesGeometry(shape: WorkplaneShape, geometry: THREE.BufferGeometry, threshold: number) {
  if (!shape.importedMesh || preservesEdgeTreatmentSize(shape) || geometry.userData.useThisForEdges) {
    return new THREE.EdgesGeometry(geometry, threshold);
  }

  const cache = getImportedMeshCache(shape.importedMesh, patternGeometryKey(shape));
  const cached = cache.edges.get(threshold);
  if (cached) {
    return cached;
  }

  // Not EdgesGeometry: a Split or boolean mesh drew a fan of lines across its flat faces.
  const position = cache.geometry.getAttribute("position");
  const index = cache.geometry.getIndex();
  const edges = new THREE.EdgesGeometry();
  edges.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(meshCreaseEdges(position.array as ArrayLike<number>, index ? (index.array as ArrayLike<number>) : null, threshold), 3),
  );
  edges.userData.cached = true;
  cache.edges.set(threshold, edges);
  return edges;
}

export function setComplexEdgeVisibility(object: THREE.Object3D, visible: boolean) {
  object.traverse((child) => {
    if (child.userData.complexEdge) {
      child.visible = visible;
    }
  });
}

export function addTextShape(group: THREE.Group, material: THREE.MeshStandardMaterial, shape: WorkplaneShape) {
  addMesh(group, createBooleanTextGeometry(shape), material, shape);
}

export function putGeometryOnBase(geometry: THREE.BufferGeometry) {
  if (!geometry.userData.keepNormals) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox?.min.y ?? 0;
  geometry.translate(0, -minY, 0);
  return geometry;
}

export function createRoofGeometry(width: number, height: number, depth: number, leftAngle?: number, rightAngle?: number) {
  const w = width / 2;
  const d = depth / 2;
  const { ridgeX } = roofAnglesFromProfile(width, height, leftAngle, rightAngle);
  const vertices = new Float32Array([
    -w, 0, -d, w, 0, -d, ridgeX, height, -d,
    -w, 0, d, w, 0, d, ridgeX, height, d,
  ]);
  const indices = [
    0, 2, 1,
    3, 4, 5,
    0, 1, 4, 0, 4, 3,
    0, 3, 5, 0, 5, 2,
    1, 2, 5, 1, 5, 4,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return geometry.toNonIndexed();
}

export function createWedgeGeometry(width: number, height: number, depth: number) {
  const w = width / 2;
  const d = depth / 2;
  const vertices = new Float32Array([
    -w, 0, -d, w, 0, -d, w, height, -d,
    -w, 0, d, w, 0, d, w, height, d,
  ]);
  const indices = [
    0, 2, 1,
    3, 4, 5,
    0, 1, 4, 0, 4, 3,
    1, 2, 5, 1, 5, 4,
    0, 3, 5, 0, 5, 2,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return geometry.toNonIndexed();
}

export function createPyramidGeometry(width: number, height: number, depth: number, sides = 4) {
  const count = Math.max(3, Math.round(sides));
  if (count !== 4) {
    const radius = Math.min(width, depth) / 2;
    const geometry = new THREE.ConeGeometry(radius, height, count);
    geometry.translate(0, height / 2, 0);
    return geometry.toNonIndexed();
  }

  const w = width / 2;
  const d = depth / 2;
  const vertices = new Float32Array([
    -w, 0, -d, w, 0, -d, w, 0, d, -w, 0, d,
    0, height, 0,
  ]);
  const indices = [
    0, 1, 2, 0, 2, 3,
    0, 4, 1,
    1, 4, 2,
    2, 4, 3,
    3, 4, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return geometry.toNonIndexed();
}

export function createTorusGeometry(width: number, height: number, depth: number, tubeRadiusOverride?: number, steps = 64) {
  const maxTubeRadius = Math.max(0.1, Math.min(width, depth) / 2 - 0.2);
  const tubeRadius = clamp(tubeRadiusOverride ?? height / 2, 0.1, maxTubeRadius);
  const majorRadius = Math.max(0.2, Math.min(width, depth) / 2 - tubeRadius);
  const radialSegments = Math.max(8, Math.round(steps));
  const tubularSegments = Math.max(24, Math.round(steps) * 4);
  const geometry = new THREE.TorusGeometry(majorRadius, tubeRadius, radialSegments, tubularSegments);
  geometry.rotateX(Math.PI / 2);
  const outerDiameter = (majorRadius + tubeRadius) * 2;
  geometry.scale(
    width / Math.max(0.001, outerDiameter),
    height / Math.max(0.001, tubeRadius * 2),
    depth / Math.max(0.001, outerDiameter),
  );
  return geometry.toNonIndexed();
}

export function createHollowCylinderGeometry(width: number, height: number, depth: number, thickness: number, segments = 256) {
  const outerX = width / 2;
  const outerZ = depth / 2;
  const safeThickness = clamp(thickness, 0.1, Math.max(0.1, Math.min(outerX, outerZ) - 0.1));
  const innerX = Math.max(0.1, outerX - safeThickness);
  const innerZ = Math.max(0.1, outerZ - safeThickness);
  const count = Math.max(12, Math.round(segments));
  const positions: number[] = [];
  const point = (rx: number, rz: number, y: number, index: number): [number, number, number] => {
    const angle = (index / count) * Math.PI * 2;
    return [Math.cos(angle) * rx, y, Math.sin(angle) * rz];
  };
  const addTri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => positions.push(...a, ...b, ...c);
  const addQuad = (a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]) => {
    addTri(a, b, c);
    addTri(a, c, d);
  };

  for (let index = 0; index < count; index += 1) {
    const next = index + 1;
    const ob0 = point(outerX, outerZ, 0, index);
    const ob1 = point(outerX, outerZ, 0, next);
    const ot0 = point(outerX, outerZ, height, index);
    const ot1 = point(outerX, outerZ, height, next);
    const ib0 = point(innerX, innerZ, 0, index);
    const ib1 = point(innerX, innerZ, 0, next);
    const it0 = point(innerX, innerZ, height, index);
    const it1 = point(innerX, innerZ, height, next);

    addQuad(ob0, ot0, ot1, ob1);
    addQuad(ib1, it1, it0, ib0);
    addQuad(ot0, it0, it1, ot1);
    addQuad(ob0, ob1, ib1, ib0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

export function createRoundRoofGeometry(width: number, height: number, depth: number, sides = 128) {
  const radius = width / 2;
  const segments = Math.max(4, Math.round(sides));
  const shape = new THREE.Shape();
  shape.moveTo(-radius, 0);
  shape.absarc(0, 0, radius, Math.PI, 0, true);
  shape.lineTo(-radius, 0);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: segments });
  geometry.translate(0, 0, -depth / 2);
  geometry.scale(1, height / Math.max(0.001, radius), 1);
  return geometry.toNonIndexed();
}

export function createHalfSphereGeometry(width: number, height: number, depth: number, steps = 56) {
  const lon = Math.max(8, Math.round(steps) * 2);
  const lat = Math.max(4, Math.round(steps / 2));
  const rx = width / 2;
  const rz = depth / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const point = (latIndex: number, lonIndex: number): [number, number, number] => {
    const theta = (latIndex / lat) * (Math.PI / 2);
    const phi = ((lonIndex % lon) / lon) * Math.PI * 2;
    const ring = Math.sin(theta);
    return [Math.cos(phi) * rx * ring, Math.cos(theta) * height, Math.sin(phi) * rz * ring];
  };
  const normal = ([x, y, z]: [number, number, number]): [number, number, number] => {
    const vector = new THREE.Vector3(x / Math.max(0.001, rx * rx), y / Math.max(0.001, height * height), z / Math.max(0.001, rz * rz)).normalize();
    return [vector.x, vector.y, vector.z];
  };
  const addTri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    positions.push(...a, ...b, ...c);
    normals.push(...normal(a), ...normal(b), ...normal(c));
  };
  const addCapTri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    positions.push(...a, ...b, ...c);
    normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
  };

  const top: [number, number, number] = [0, height, 0];
  for (let xStep = 0; xStep < lon; xStep += 1) {
    addTri(top, point(1, xStep + 1), point(1, xStep));
  }

  for (let yStep = 1; yStep < lat; yStep += 1) {
    for (let xStep = 0; xStep < lon; xStep += 1) {
      const next = xStep + 1;
      const a = point(yStep, xStep);
      const b = point(yStep, next);
      const c = point(yStep + 1, next);
      const d = point(yStep + 1, xStep);
      addTri(a, c, d);
      addTri(a, b, c);
    }
  }

  const capY = 0;
  const bottomCenter: [number, number, number] = [0, capY, 0];
  const capPoint = (lonIndex: number): [number, number, number] => {
    const phi = ((lonIndex % lon) / lon) * Math.PI * 2;
    return [Math.cos(phi) * rx, capY, Math.sin(phi) * rz];
  };
  for (let xStep = 0; xStep < lon; xStep += 1) {
    addCapTri(bottomCenter, capPoint(xStep), capPoint(xStep + 1));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

export function darkenHex(hex: string, amount: number) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean, 16);
  const r = Math.max(0, Math.floor(((value >> 16) & 255) * (1 - amount)));
  const g = Math.max(0, Math.floor(((value >> 8) & 255) * (1 - amount)));
  const b = Math.max(0, Math.floor((value & 255) * (1 - amount)));
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
