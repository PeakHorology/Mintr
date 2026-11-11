import * as THREE from "three";
import { assignHatchStyles, buildRegions, joinSegments, measureAt, type SectionBox, type SectionMeasure, type SectionRegion } from "./sectionRegions";

/**
 * X-ray section caps: where the cut plane passes through a solid, the cut face is
 * filled and hatched the way a section drawing shows it, instead of the part looking
 * like a hollow shell.
 *
 * Done with the stencil buffer, so it follows the plane live as it is dragged. For each
 * solid, its back faces add one and its front faces take one away; where the count is
 * left non-zero the plane is inside the solid and the cap is drawn there. The stencil
 * byte is split three ways:
 *   bits 0-5  the inside count for the solid being drawn
 *   bit 6     covered by the part being drawn
 *   bit 7     covered by an earlier part
 * so a spot that two different parts both fill shows as a clash, while the pieces of
 * one part never clash with each other.
 *
 * Alongside, the cut is traced into flat regions on the CPU (see sectionRegions): that
 * gives the outline, which parts meet (so they hatch in different directions), walls too
 * thin to hatch (drawn solid), and the wall or gap under the pointer.
 */

const CAP_ORDER_START = 2000;
/** Hatch lines in screen pixels; the spacing steps in powers of two as you zoom. */
const HATCH_SPACING_PX = 10;
const HATCH_WIDTH_PX = 1.1;
/** Thin dark lines over the part's colour, as an engineering section is drawn. */
const HATCH_INK = new THREE.Color(0x1d1f22);
const HATCH_INK_STRENGTH = 0.85;
/** The cut face keeps the part's colour, a touch flatter than its lit faces. */
const CAP_SHADE = 0.94;
/** The dark line traced round every cut face. */
const OUTLINE_COLOR = 0x16181b;
/** Where two parts fill the same space. */
const CLASH_COLOR = 0xff3b30;
/** A wall narrower than this many hatch gaps cannot show its hatch, so it is filled solid. */
const THIN_WALL_GAPS = 1.5;
const THIN_SHADE = 0.32;
const MEASURE_COLOR = 0x0b6e99;
/**
 * Hatch styles handed out so parts that meet differ, as drawings do: first the other
 * direction, then wider spacing.
 */
const HATCH_STYLES = [
  { angle: 45, scale: 1 },
  { angle: 135, scale: 1 },
  { angle: 45, scale: 1.8 },
  { angle: 135, scale: 1.8 },
] as const;

const COUNT_BITS = 0x3f;
const THIS_PART = 0x40;
const EARLIER_PART = 0x80;

type SharedUniforms = {
  hatchSpacing: { value: number };
  hatchWidth: { value: number };
  sectionSize: { value: number };
};

type CapPart = {
  root: THREE.Object3D;
  sets: CapSet[];
  promote: THREE.Mesh;
  style: number;
  hatchDir: { value: THREE.Vector2 };
  hatchScale: { value: number };
  box: SectionBox | null;
};

type CapSet = {
  source: THREE.Mesh;
  part: CapPart;
  color: THREE.Color;
  back: THREE.Mesh;
  front: THREE.Mesh;
  clash: THREE.Mesh;
  cap: THREE.Mesh;
  outline: THREE.LineSegments;
  /** What the outline was last traced for, so it is only redone when something moved. */
  outlineKey: string;
  regions: SectionRegion[];
  /** Solid fills for regions too thin to hatch, made when first needed. */
  thin: (THREE.Mesh | null)[];
};

type CapLayerData = {
  sets: CapSet[];
  parts: CapPart[];
  plane: THREE.Plane | null;
  size: number;
  uniforms: SharedUniforms;
  /** Styles by part id, kept across rebuilds so a part's hatch does not flip. */
  styles: Map<string, number>;
  thinSpacing: number;
  /** The cut's middle, for judging how far away it is. */
  center: THREE.Vector3 | null;
  measure: THREE.Mesh | null;
};

const capPlaneGeometry = new THREE.PlaneGeometry(1, 1);

function layerData(layer: THREE.Group): CapLayerData {
  if (!layer.userData.sectionCaps) {
    layer.userData.sectionCaps = {
      sets: [],
      parts: [],
      plane: null,
      size: 200,
      uniforms: { hatchSpacing: { value: 1 }, hatchWidth: { value: HATCH_WIDTH_PX }, sectionSize: { value: 200 } },
      styles: new Map(),
      thinSpacing: 0,
      center: null,
      measure: null,
    } satisfies CapLayerData;
  }
  return layer.userData.sectionCaps as CapLayerData;
}

function noRaycast() {
  // Caps are drawing only; clicks go to the part.
}

function helperMesh<T extends THREE.Object3D>(object: T, order: number): T {
  object.matrixAutoUpdate = false;
  object.matrixWorldAutoUpdate = false;
  object.frustumCulled = false;
  object.renderOrder = order;
  object.raycast = noRaycast;
  return object;
}

function stencilPass(geometry: THREE.BufferGeometry, plane: THREE.Plane, side: THREE.Side, op: THREE.StencilOp, order: number) {
  const material = new THREE.MeshBasicMaterial({
    side,
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    clippingPlanes: [plane],
    stencilWrite: true,
    stencilWriteMask: COUNT_BITS,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: op,
    stencilZFail: op,
    stencilZPass: op,
  });
  return helperMesh(new THREE.Mesh(geometry, material), order);
}

/** Marks the end of a part: what it covered becomes "covered by an earlier part". */
function promotePass(order: number) {
  const material = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    stencilWrite: true,
    stencilRef: THIS_PART,
    stencilFuncMask: THIS_PART,
    stencilFunc: THREE.EqualStencilFunc,
    stencilWriteMask: THIS_PART | EARLIER_PART,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.InvertStencilOp,
    stencilZPass: THREE.InvertStencilOp,
  });
  return helperMesh(new THREE.Mesh(capPlaneGeometry, material), order);
}

/**
 * The cut face. Hatch lines are laid out on the plane itself, so they turn with the part
 * as you orbit, and kept a steady pixel width so they stay crisp at any zoom.
 */
function capMaterial(color: THREE.Color, part: CapPart, uniforms: SharedUniforms, kind: "cap" | "clash") {
  const hatched = kind === "cap";
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, stencilWrite: true });
  if (hatched) {
    // Fill wherever this solid's count is non-zero; clear the count and mark this part.
    material.stencilRef = THIS_PART;
    material.stencilFuncMask = COUNT_BITS;
    material.stencilFunc = THREE.NotEqualStencilFunc;
    material.stencilWriteMask = COUNT_BITS | THIS_PART;
  } else {
    // Clash: inside this solid and already covered by an earlier part. Clear the count so
    // the ordinary cap skips it.
    material.stencilRef = EARLIER_PART;
    material.stencilFuncMask = COUNT_BITS | EARLIER_PART;
    material.stencilFunc = THREE.LessStencilFunc;
    material.stencilWriteMask = COUNT_BITS;
  }
  material.stencilFail = THREE.KeepStencilOp;
  material.stencilZFail = THREE.ReplaceStencilOp;
  material.stencilZPass = THREE.ReplaceStencilOp;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.hatchSpacing = uniforms.hatchSpacing;
    shader.uniforms.hatchWidth = uniforms.hatchWidth;
    shader.uniforms.sectionSize = uniforms.sectionSize;
    shader.uniforms.hatchDir = part.hatchDir;
    shader.uniforms.hatchScale = part.hatchScale;
    shader.uniforms.hatchInk = { value: HATCH_INK };
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform float sectionSize;\nvarying vec2 vSection;\nvoid main() {")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSection = position.xy * sectionSize;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        "uniform float hatchSpacing;\nuniform float hatchWidth;\nuniform vec2 hatchDir;\nuniform float hatchScale;\nuniform vec3 hatchInk;\nvarying vec2 vSection;\nvoid main() {",
      )
      .replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          // Distance to the nearest line, in line gaps, and how many gaps one pixel spans.
          "float hatchAt = dot(vSection, hatchDir) / (hatchSpacing * hatchScale);",
          "float hatchDistance = abs(fract(hatchAt + 0.5) - 0.5);",
          "float hatchPixel = max(fwidth(hatchAt), 1e-5);",
          "float hatchHalf = hatchWidth * 0.5 * hatchPixel;",
          "float hatchLine = 1.0 - smoothstep(hatchHalf, hatchHalf + hatchPixel, hatchDistance);",
          // A clash is cross-hatched, so it stands out whatever colour the parts are.
          ...(hatched
            ? []
            : [
                "float crossAt = dot(vSection, vec2(-hatchDir.y, hatchDir.x)) / (hatchSpacing * hatchScale);",
                "float crossPixel = max(fwidth(crossAt), 1e-5);",
                "float crossHalf = hatchWidth * 0.5 * crossPixel;",
                "hatchLine = max(hatchLine, 1.0 - smoothstep(crossHalf, crossHalf + crossPixel, abs(fract(crossAt + 0.5) - 0.5)));",
                "hatchPixel = max(hatchPixel, crossPixel);",
              ]),
          // Seen nearly edge-on the lines crowd together; let them fade rather than shimmer.
          "hatchLine *= 1.0 - smoothstep(0.25, 0.5, hatchPixel);",
          `diffuseColor.rgb = mix(diffuseColor.rgb, hatchInk, hatchLine * ${HATCH_INK_STRENGTH.toFixed(2)});`,
        ].join("\n"),
      );
  };
  material.customProgramCacheKey = () => `section-cap-${kind}-v2`;
  return material;
}

function setHatchStyle(part: CapPart, style: number) {
  part.style = style;
  const { angle, scale } = HATCH_STYLES[style] ?? HATCH_STYLES[0];
  const radians = THREE.MathUtils.degToRad(angle);
  // Lines run along the angle; the coordinate measured is across them.
  part.hatchDir.value.set(-Math.sin(radians), Math.cos(radians));
  part.hatchScale.value = scale;
}

/** Is the object drawn: it and every parent visible, up to the scene. */
function shownInScene(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    if ((current as THREE.Scene).isScene) return true;
    current = current.parent;
  }
  return false;
}

/** A solid that should show a cut face: an opaque part, not a hole or a construction ghost. */
function cappableMesh(object: THREE.Object3D): object is THREE.Mesh {
  if (!(object instanceof THREE.Mesh) || !object.visible) return false;
  const geometry = object.geometry as THREE.BufferGeometry | undefined;
  if (!geometry?.attributes?.position) return false;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  const main = materials[0] as THREE.Material & { color?: THREE.Color };
  if (!main || !main.visible || main.transparent || !main.color) return false;
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData.hole || current.userData.construction) return false;
    current = current.parent;
  }
  return true;
}

function disposeThin(set: CapSet) {
  set.thin.forEach((mesh) => {
    if (!mesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    mesh.removeFromParent();
  });
  set.thin = [];
}

function disposeSet(set: CapSet) {
  for (const mesh of [set.back, set.front, set.clash, set.cap]) (mesh.material as THREE.Material).dispose();
  (set.outline.material as THREE.Material).dispose();
  set.outline.geometry.dispose();
  disposeThin(set);
}

function outlineMesh(order: number) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
  return helperMesh(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: OUTLINE_COLOR })), order);
}

function clearMeasure(data: CapLayerData) {
  if (!data.measure) return;
  data.measure.geometry.dispose();
  (data.measure.material as THREE.Material).dispose();
  data.measure.removeFromParent();
  data.measure = null;
}

/** Removes every cap. Geometry is the parts' own, so only the caps' own pieces are freed. */
export function clearSectionCaps(layer: THREE.Group) {
  const data = layerData(layer);
  data.sets.forEach(disposeSet);
  data.parts.forEach((part) => (part.promote.material as THREE.Material).dispose());
  data.sets = [];
  data.parts = [];
  data.plane = null;
  data.center = null;
  clearMeasure(data);
  layer.clear();
}

/** The part a mesh belongs to: its top-level object under the shapes layer. */
function partRoot(shapes: THREE.Object3D, mesh: THREE.Object3D) {
  let current = mesh;
  while (current.parent && current.parent !== shapes) current = current.parent;
  return current;
}

function partId(root: THREE.Object3D) {
  return String(root.userData.shapeId ?? root.uuid);
}

/**
 * Builds caps for every solid in `shapes`, cut by `plane`; a null plane removes them.
 * Call when the cut turns on or off and whenever the parts are rebuilt.
 */
export function rebuildSectionCaps(layer: THREE.Group, shapes: THREE.Object3D, plane: THREE.Plane | null, size: number, pixelRatio = 1) {
  clearSectionCaps(layer);
  if (!plane) return;
  const data = layerData(layer);
  data.plane = plane;
  data.size = Math.max(200, size * 3);
  data.uniforms.sectionSize.value = data.size;
  data.uniforms.hatchWidth.value = HATCH_WIDTH_PX * pixelRatio;
  data.thinSpacing = 0;

  const byRoot = new Map<THREE.Object3D, THREE.Mesh[]>();
  shapes.traverse((object) => {
    if (!cappableMesh(object)) return;
    const root = partRoot(shapes, object);
    const list = byRoot.get(root);
    if (list) list.push(object);
    else byRoot.set(root, [object]);
  });

  let order = CAP_ORDER_START;
  byRoot.forEach((meshes, root) => {
    const part: CapPart = {
      root,
      sets: [],
      promote: promotePass(0),
      style: 0,
      hatchDir: { value: new THREE.Vector2() },
      hatchScale: { value: 1 },
      box: null,
    };
    setHatchStyle(part, data.styles.get(partId(root)) ?? 0);
    for (const source of meshes) {
      const materials = Array.isArray(source.material) ? source.material : [source.material];
      const base = (materials[0] as THREE.Material & { color: THREE.Color }).color;
      const color = base.clone().multiplyScalar(CAP_SHADE);
      const back = stencilPass(source.geometry, plane, THREE.BackSide, THREE.IncrementWrapStencilOp, order++);
      const front = stencilPass(source.geometry, plane, THREE.FrontSide, THREE.DecrementWrapStencilOp, order++);
      const clash = helperMesh(new THREE.Mesh(capPlaneGeometry, capMaterial(new THREE.Color(CLASH_COLOR), part, data.uniforms, "clash")), order++);
      const cap = helperMesh(new THREE.Mesh(capPlaneGeometry, capMaterial(color, part, data.uniforms, "cap")), order++);
      const outline = outlineMesh(order++);
      layer.add(back, front, clash, cap, outline);
      const set: CapSet = { source, part, color: base.clone(), back, front, clash, cap, outline, outlineKey: "", regions: [], thin: [] };
      part.sets.push(set);
      data.sets.push(set);
    }
    part.promote.renderOrder = order++;
    layer.add(part.promote);
    data.parts.push(part);
  });
  updateSectionCaps(layer);
}

const localPlane = new THREE.Plane();
const inverseWorld = new THREE.Matrix4();
const triA = new THREE.Vector3();
const triB = new THREE.Vector3();
const triC = new THREE.Vector3();

/** Same edge, same order, whichever triangle it comes from, so both give the same point. */
function firstOf(a: THREE.Vector3, b: THREE.Vector3) {
  if (a.x !== b.x) return a.x < b.x;
  if (a.y !== b.y) return a.y < b.y;
  return a.z <= b.z;
}

/**
 * Where a part's triangles cross a plane, as line pieces in the part's own space. An edge
 * shared by two triangles gives exactly the same point from both, so the pieces join up.
 */
export function sliceSegments(geometry: THREE.BufferGeometry, plane: THREE.Plane): Float32Array {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const out: number[] = [];
  const { normal, constant } = plane;
  const corners = [triA, triB, triC];
  const distance = [0, 0, 0];
  for (let i = 0; i + 2 < count; i += 3) {
    let above = 0;
    let below = 0;
    for (let k = 0; k < 3; k++) {
      const vertex = index ? index.getX(i + k) : i + k;
      corners[k].fromBufferAttribute(position, vertex);
      const d = normal.dot(corners[k]) + constant;
      distance[k] = d;
      if (d > 0) above++;
      else below++;
    }
    // A triangle wholly on one side does not touch the cut.
    if (above === 0 || below === 0) continue;
    for (let k = 0; k < 3; k++) {
      let a = corners[k];
      let b = corners[(k + 1) % 3];
      let da = distance[k];
      let db = distance[(k + 1) % 3];
      if (da > 0 === db > 0) continue;
      if (!firstOf(a, b)) {
        [a, b] = [b, a];
        [da, db] = [db, da];
      }
      if (da === 0) out.push(a.x, a.y, a.z);
      else if (db === 0) out.push(b.x, b.y, b.z);
      else {
        const t = da / (da - db);
        out.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      }
    }
  }
  return new Float32Array(out);
}

/** The slice pulled `lift` toward the cut-away side, ready to draw. Exported for tests. */
export function sliceOutline(geometry: THREE.BufferGeometry, plane: THREE.Plane, lift = 0): Float32Array {
  const points = sliceSegments(geometry, plane);
  if (lift === 0) return points;
  for (let i = 0; i < points.length; i += 3) {
    points[i] -= plane.normal.x * lift;
    points[i + 1] -= plane.normal.y * lift;
    points[i + 2] -= plane.normal.z * lift;
  }
  return points;
}

const capQuaternion = new THREE.Quaternion();
const capPosition = new THREE.Vector3();
const capScale = new THREE.Vector3();
const axisU = new THREE.Vector3();
const axisV = new THREE.Vector3();
const FACING = new THREE.Vector3(0, 0, 1);
const scratch = new THREE.Vector3();
const identity = new THREE.Matrix4();

/** Retraces a part's outline and regions if the plane, the part or its shape moved. */
function traceSet(set: CapSet, plane: THREE.Plane, lift: number) {
  const source = set.source;
  const geometry = source.geometry;
  const m = source.matrixWorld.elements;
  const key = `${geometry.uuid}|${(geometry.attributes.position as THREE.BufferAttribute).version}|${plane.normal.x},${plane.normal.y},${plane.normal.z},${plane.constant}|${m.join(",")}`;
  if (key === set.outlineKey) return false;
  set.outlineKey = key;
  inverseWorld.copy(source.matrixWorld).invert();
  localPlane.copy(plane).applyMatrix4(inverseWorld);
  const points = sliceSegments(geometry, localPlane);

  // Flat regions, in the plane's own 2D frame.
  const flat = new Float64Array((points.length / 3) * 2);
  for (let i = 0, j = 0; i < points.length; i += 3, j += 2) {
    scratch.set(points[i], points[i + 1], points[i + 2]).applyMatrix4(source.matrixWorld);
    flat[j] = scratch.dot(axisU);
    flat[j + 1] = scratch.dot(axisV);
  }
  set.regions = buildRegions(joinSegments(flat));

  // The drawn outline sits a hair in front of the cap. The lift is in world millimetres;
  // the part may be scaled.
  const localLift = lift / (source.matrixWorld.getMaxScaleOnAxis() || 1);
  for (let i = 0; i < points.length; i += 3) {
    points[i] -= localPlane.normal.x * localLift;
    points[i + 1] -= localPlane.normal.y * localLift;
    points[i + 2] -= localPlane.normal.z * localLift;
  }
  const lineGeometry = set.outline.geometry;
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  lineGeometry.setDrawRange(0, points.length / 3);
  disposeThin(set);
  return true;
}

function planePoint(x: number, y: number, lift: number, plane: THREE.Plane, target: THREE.Vector3) {
  return target
    .copy(axisU)
    .multiplyScalar(x)
    .addScaledVector(axisV, y)
    .addScaledVector(plane.normal, -plane.constant - lift);
}

/** A solid dark fill for a region too thin to show its hatch. */
function thinFill(region: SectionRegion, color: THREE.Color, plane: THREE.Plane, lift: number, order: number) {
  const contour = region.outer.points.map((p) => new THREE.Vector2(p.x, p.y));
  const holes = region.holes.map((hole) => hole.points.map((p) => new THREE.Vector2(p.x, p.y)));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);
  const all = [...contour, ...holes.flat()];
  const positions = new Float32Array(all.length * 3);
  all.forEach((p, i) => {
    planePoint(p.x, p.y, lift, plane, scratch);
    positions[i * 3] = scratch.x;
    positions[i * 3 + 1] = scratch.y;
    positions[i * 3 + 2] = scratch.z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(triangles.flat());
  const material = new THREE.MeshBasicMaterial({
    color: color.clone().multiplyScalar(THIN_SHADE),
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  const mesh = helperMesh(new THREE.Mesh(geometry, material), order);
  mesh.matrixWorld.copy(identity);
  return mesh;
}

/** How many millimetres one screen pixel covers at a point. */
function mmPerDevicePixel(camera: THREE.Camera, renderer: THREE.WebGLRenderer, at: THREE.Vector3) {
  const height = renderer.domElement.clientHeight * renderer.getPixelRatio();
  if (height < 1) return null;
  if (camera instanceof THREE.PerspectiveCamera) {
    const distance = camera.position.distanceTo(at);
    return (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / camera.zoom / height;
  }
  if (camera instanceof THREE.OrthographicCamera) return (camera.top - camera.bottom) / camera.zoom / height;
  return null;
}

/**
 * Before each frame: each part's passes follow the part as it moves or animates, a part
 * that is hidden hides its cap, the caps sit on the plane where it is now, and the hatch
 * spacing suits the zoom.
 */
export function updateSectionCaps(layer: THREE.Group, camera?: THREE.Camera, renderer?: THREE.WebGLRenderer) {
  const data = layerData(layer);
  const plane = data.plane;
  if (!plane || data.sets.length === 0) return;
  plane.coplanarPoint(capPosition);
  capQuaternion.setFromUnitVectors(FACING, plane.normal);
  axisU.set(1, 0, 0).applyQuaternion(capQuaternion);
  axisV.set(0, 1, 0).applyQuaternion(capQuaternion);
  capScale.set(data.size, data.size, 1);
  // Just enough to keep lines in front of the cap without them drifting off the edge.
  const lift = data.size * 2e-5;
  let traced = false;
  for (const set of data.sets) {
    const shown = shownInScene(set.source);
    for (const mesh of [set.back, set.front, set.clash, set.cap, set.outline]) mesh.visible = shown;
    set.thin.forEach((mesh) => mesh && (mesh.visible = shown && mesh.userData.wanted === true));
    if (!shown) continue;
    // A part rebuilt in place may have swapped its geometry.
    if (set.back.geometry !== set.source.geometry) {
      set.back.geometry = set.source.geometry;
      set.front.geometry = set.source.geometry;
    }
    set.back.matrixWorld.copy(set.source.matrixWorld);
    set.front.matrixWorld.copy(set.source.matrixWorld);
    set.clash.matrixWorld.compose(capPosition, capQuaternion, capScale);
    set.cap.matrixWorld.copy(set.clash.matrixWorld);
    set.outline.matrixWorld.copy(set.source.matrixWorld);
    if (traceSet(set, plane, lift)) traced = true;
  }
  for (const part of data.parts) part.promote.matrixWorld.compose(capPosition, capQuaternion, capScale);

  if (traced) {
    clearMeasure(data);
    restyleParts(data);
  }

  if (camera && renderer) {
    data.uniforms.hatchWidth.value = HATCH_WIDTH_PX * renderer.getPixelRatio();
    const perPixel = mmPerDevicePixel(camera, renderer, data.center ?? capPosition);
    if (perPixel) {
      const wanted = HATCH_SPACING_PX * renderer.getPixelRatio() * perPixel;
      const current = data.uniforms.hatchSpacing.value;
      // Powers of two, with some slack so it does not flick back and forth at a boundary.
      if (!(wanted < current * 1.45 && wanted > current / 1.45)) {
        data.uniforms.hatchSpacing.value = 2 ** Math.round(Math.log2(wanted));
      }
    }
  }
  if (traced || data.thinSpacing !== data.uniforms.hatchSpacing.value) {
    data.thinSpacing = data.uniforms.hatchSpacing.value;
    markThinWalls(layer, data, lift);
  }
}

/** Parts that meet get different hatch styles. */
function restyleParts(data: CapLayerData) {
  const boxes = data.parts.map((part) => {
    let box: SectionBox | null = null;
    for (const set of part.sets) {
      if (!set.cap.visible) continue;
      for (const region of set.regions) {
        box = box
          ? {
              minX: Math.min(box.minX, region.box.minX),
              minY: Math.min(box.minY, region.box.minY),
              maxX: Math.max(box.maxX, region.box.maxX),
              maxY: Math.max(box.maxY, region.box.maxY),
            }
          : { ...region.box };
      }
    }
    part.box = box;
    return box;
  });
  const reach = Math.max(0.5, data.uniforms.hatchSpacing.value);
  const styles = assignHatchStyles(
    boxes,
    data.parts.map((part) => data.styles.get(partId(part.root))),
    HATCH_STYLES.length,
    reach,
  );
  data.parts.forEach((part, i) => {
    setHatchStyle(part, styles[i]);
    if (part.box) data.styles.set(partId(part.root), styles[i]);
  });
  // The middle of the whole cut, for judging zoom.
  const all = boxes.filter((box): box is SectionBox => box !== null);
  if (all.length === 0) {
    data.center = null;
    return;
  }
  const midX = (Math.min(...all.map((b) => b.minX)) + Math.max(...all.map((b) => b.maxX))) / 2;
  const midY = (Math.min(...all.map((b) => b.minY)) + Math.max(...all.map((b) => b.maxY))) / 2;
  data.center = planePoint(midX, midY, 0, data.plane!, new THREE.Vector3());
}

/** Fills walls too thin to show their hatch at this zoom with solid dark, as drawings do. */
function markThinWalls(layer: THREE.Group, data: CapLayerData, lift: number) {
  const plane = data.plane;
  if (!plane) return;
  const limit = data.uniforms.hatchSpacing.value * THIN_WALL_GAPS;
  for (const set of data.sets) {
    const shown = set.cap.visible;
    set.regions.forEach((region, i) => {
      const wanted = shown && region.thickness < limit * set.part.hatchScale.value;
      let mesh = set.thin[i] ?? null;
      if (wanted && !mesh) {
        mesh = thinFill(region, set.color, plane, lift, set.outline.renderOrder);
        set.thin[i] = mesh;
        layer.add(mesh);
      }
      if (mesh) {
        mesh.userData.wanted = wanted;
        mesh.visible = wanted;
      }
    });
  }
}

export type SectionMeasureResult = SectionMeasure & {
  /** The ends of the measure, in the world. */
  fromWorld: THREE.Vector3;
  toWorld: THREE.Vector3;
};

/**
 * The wall or gap under a point on the cut plane, measured straight across, with a
 * line drawn to show it. Returns null, and clears the line, when there is nothing to
 * measure there.
 */
export function measureSectionAt(layer: THREE.Group, world: THREE.Vector3 | null): SectionMeasureResult | null {
  const data = layerData(layer);
  clearMeasure(data);
  const plane = data.plane;
  if (!plane || !world) return null;
  const regions = data.sets.filter((set) => set.cap.visible).flatMap((set) => set.regions);
  const measure = measureAt(regions, { x: world.dot(axisU), y: world.dot(axisV) });
  if (!measure) return null;
  const lift = data.size * 4e-5;
  const fromWorld = planePoint(measure.from.x, measure.from.y, lift, plane, new THREE.Vector3());
  const toWorld = planePoint(measure.to.x, measure.to.y, lift, plane, new THREE.Vector3());
  data.measure = measureLine(measure, plane, data.uniforms.hatchSpacing.value, lift);
  layer.add(data.measure);
  return { ...measure, fromWorld, toWorld };
}

/** A dimension line with end ticks, as a thin ribbon so it reads at any zoom. */
function measureLine(measure: SectionMeasure, plane: THREE.Plane, spacing: number, lift: number) {
  const dx = measure.to.x - measure.from.x;
  const dy = measure.to.y - measure.from.y;
  const length = Math.hypot(dx, dy) || 1;
  const along = { x: dx / length, y: dy / length };
  const across = { x: -along.y, y: along.x };
  const half = spacing * 0.13;
  const tick = spacing * 0.7;
  const bars: [number, number, number, number][] = [
    [measure.from.x, measure.from.y, measure.to.x, measure.to.y],
    [measure.from.x - across.x * tick, measure.from.y - across.y * tick, measure.from.x + across.x * tick, measure.from.y + across.y * tick],
    [measure.to.x - across.x * tick, measure.to.y - across.y * tick, measure.to.x + across.x * tick, measure.to.y + across.y * tick],
  ];
  const positions: number[] = [];
  for (const [ax, ay, bx, by] of bars) {
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / len) * half;
    const ny = ((bx - ax) / len) * half;
    const corners = [
      [ax + nx, ay + ny],
      [bx + nx, by + ny],
      [bx - nx, by - ny],
      [ax - nx, ay - ny],
    ].map(([x, y]) => planePoint(x, y, lift, plane, new THREE.Vector3()));
    for (const k of [0, 1, 2, 0, 2, 3]) positions.push(corners[k].x, corners[k].y, corners[k].z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  const material = new THREE.MeshBasicMaterial({ color: MEASURE_COLOR, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  const mesh = helperMesh(new THREE.Mesh(geometry, material), 1_000_000);
  mesh.matrixWorld.copy(identity);
  return mesh;
}

/** The cut plane the caps are on, or null when X-ray is off. */
export function sectionCapPlane(layer: THREE.Group) {
  return layerData(layer).plane;
}
