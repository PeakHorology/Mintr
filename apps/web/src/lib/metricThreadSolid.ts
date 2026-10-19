import { metricThreadDepth, type ResolvedThreadParams } from "@/lib/metricThreads";

export const DEFAULT_THREAD_SIDES = 96;
export const MIN_THREAD_SIDES = 8;
/** Past this the helix stops being a closed solid, so the sides control stops here. */
export const MAX_THREAD_SIDES = 96;
export const DEFAULT_THREAD_CLEARANCE = 0.2;
export const MIN_THREAD_CLEARANCE = 0;
export const MAX_THREAD_CLEARANCE = 2;

export type MetricThreadSolidMesh = {
  /** Non-indexed triangle soup (9 floats per triangle), editor Y-up, base at y = 0. */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
  brep: string;
  step?: string;
  width: number;
  depth: number;
  height: number;
};

export type ThreadMeshPart = "screw" | "shaft" | "threads";
export type ThreadRole = "rod" | "screw" | "nut" | "bore";
export type ThreadHead = "cylinder" | "countersunk" | "hex";
export type ThreadProfile = "v" | "whitworth" | "trapezoid" | "round";

export type ThreadMeshOptions = {
  /** Radial segments around the shaft / helix (higher = rounder). */
  sides?: number;
  /** Extra radial clearance (mm) for hole cutters / loose fit. */
  clearance?: number;
  /** Which solid to build. */
  part?: ThreadMeshPart;
  role?: ThreadRole;
  head?: ThreadHead;
  /** 45° end chamfer length in mm. */
  chamfer?: number;
  profile?: ThreadProfile;
};

type Vec3 = [number, number, number];

function pushTriangle(positions: number[], normals: number[], a: Vec3, b: Vec3, c: Vec3) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  let nx = aby * acz - abz * acy;
  let ny = abz * acx - abx * acz;
  let nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
}

function pushQuad(positions: number[], normals: number[], a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
  pushTriangle(positions, normals, a, b, c);
  pushTriangle(positions, normals, a, c, d);
}

function pushCylinder(positions: number[], normals: number[], radius: number, height: number, radialSegs: number) {
  for (let i = 0; i < radialSegs; i += 1) {
    const a0 = (i / radialSegs) * Math.PI * 2;
    const a1 = ((i + 1) / radialSegs) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const b0: Vec3 = [c0 * radius, 0, s0 * radius];
    const b1: Vec3 = [c1 * radius, 0, s1 * radius];
    const t0: Vec3 = [c0 * radius, height, s0 * radius];
    const t1: Vec3 = [c1 * radius, height, s1 * radius];
    pushQuad(positions, normals, b0, b1, t1, t0);
    pushTriangle(positions, normals, [0, 0, 0], b1, b0);
    pushTriangle(positions, normals, [0, height, 0], t0, t1);
  }
}

/** Smooth 0→1 ease used for thread runout at each end of the blank. */
function smoothstep01(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Tooth height scale along the blank: full in the middle, gently folds to 0
 * over roughly one pitch at each end so the helix runs out into the shaft.
 */
function threadRunoutScale(y: number, height: number, pitch: number) {
  const runout = Math.min(pitch * 1.15, height * 0.4);
  if (runout <= 1e-6) return 1;
  return Math.min(smoothstep01(y / runout), smoothstep01((height - y) / runout));
}

function pushAnnulus(
  positions: number[],
  normals: number[],
  innerRadius: number,
  outerRadius: number,
  y: number,
  radialSegs: number,
) {
  for (let i = 0; i < radialSegs; i += 1) {
    const a0 = (i / radialSegs) * Math.PI * 2;
    const a1 = ((i + 1) / radialSegs) * Math.PI * 2;
    const inner0: Vec3 = [Math.cos(a0) * innerRadius, y, Math.sin(a0) * innerRadius];
    const inner1: Vec3 = [Math.cos(a1) * innerRadius, y, Math.sin(a1) * innerRadius];
    const outer0: Vec3 = [Math.cos(a0) * outerRadius, y, Math.sin(a0) * outerRadius];
    const outer1: Vec3 = [Math.cos(a1) * outerRadius, y, Math.sin(a1) * outerRadius];
    pushQuad(positions, normals, inner0, inner1, outer1, outer0);
  }
}

function pushDisk(
  positions: number[],
  normals: number[],
  radius: number,
  y: number,
  radialSegs: number,
  facingUp: boolean,
) {
  const center: Vec3 = [0, y, 0];
  for (let i = 0; i < radialSegs; i += 1) {
    const a0 = (i / radialSegs) * Math.PI * 2;
    const a1 = ((i + 1) / radialSegs) * Math.PI * 2;
    const p0: Vec3 = [Math.cos(a0) * radius, y, Math.sin(a0) * radius];
    const p1: Vec3 = [Math.cos(a1) * radius, y, Math.sin(a1) * radius];
    if (facingUp) pushTriangle(positions, normals, center, p0, p1);
    else pushTriangle(positions, normals, center, p1, p0);
  }
}

function pushFrustum(
  positions: number[],
  normals: number[],
  radius0: number,
  radius1: number,
  y0: number,
  y1: number,
  radialSegs: number,
) {
  for (let i = 0; i < radialSegs; i += 1) {
    const a0 = (i / radialSegs) * Math.PI * 2;
    const a1 = ((i + 1) / radialSegs) * Math.PI * 2;
    const p0: Vec3 = [Math.cos(a0) * radius0, y0, Math.sin(a0) * radius0];
    const p1: Vec3 = [Math.cos(a1) * radius0, y0, Math.sin(a1) * radius0];
    const q0: Vec3 = [Math.cos(a0) * radius1, y1, Math.sin(a0) * radius1];
    const q1: Vec3 = [Math.cos(a1) * radius1, y1, Math.sin(a1) * radius1];
    pushQuad(positions, normals, p0, p1, q1, q0);
  }
}

function hexPoint(acrossFlats: number, index: number, y: number): Vec3 {
  const radius = acrossFlats / Math.sqrt(3);
  const angle = Math.PI / 6 + (index * Math.PI) / 3;
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
}

function hexRadiusAt(acrossFlats: number, angle: number) {
  const sector = Math.PI / 3;
  const local = ((angle - Math.PI / 6) % sector + sector) % sector;
  return (acrossFlats / 2) / Math.cos(local - sector / 2);
}

/** Hex body with a round hole. The bore wall is drawn separately so the hole stays open. */
function pushHexNut(
  positions: number[],
  normals: number[],
  acrossFlats: number,
  holeRadius: number,
  height: number,
  radialSegs: number,
) {
  const bottom = Array.from({ length: 6 }, (_, index) => hexPoint(acrossFlats, index, 0));
  const top = Array.from({ length: 6 }, (_, index) => hexPoint(acrossFlats, index, height));
  for (let index = 0; index < 6; index += 1) {
    const next = (index + 1) % 6;
    pushQuad(positions, normals, bottom[index], bottom[next], top[next], top[index]);
  }
  for (let i = 0; i < radialSegs; i += 1) {
    const a0 = (i / radialSegs) * Math.PI * 2;
    const a1 = ((i + 1) / radialSegs) * Math.PI * 2;
    const outer0 = hexRadiusAt(acrossFlats, a0);
    const outer1 = hexRadiusAt(acrossFlats, a1);
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const topOuter0: Vec3 = [c0 * outer0, height, s0 * outer0];
    const topOuter1: Vec3 = [c1 * outer1, height, s1 * outer1];
    const topInner0: Vec3 = [c0 * holeRadius, height, s0 * holeRadius];
    const topInner1: Vec3 = [c1 * holeRadius, height, s1 * holeRadius];
    pushQuad(positions, normals, topOuter0, topOuter1, topInner1, topInner0);
    const botOuter0: Vec3 = [c0 * outer0, 0, s0 * outer0];
    const botOuter1: Vec3 = [c1 * outer1, 0, s1 * outer1];
    const botInner0: Vec3 = [c0 * holeRadius, 0, s0 * holeRadius];
    const botInner1: Vec3 = [c1 * holeRadius, 0, s1 * holeRadius];
    pushQuad(positions, normals, botOuter0, botInner0, botInner1, botOuter1);
  }
}

function profileHalfWidth(profile: ThreadProfile, pitch: number) {
  if (profile === "trapezoid") return pitch * 0.36;
  if (profile === "round") return pitch * 0.3;
  if (profile === "whitworth") return pitch * 0.27;
  return pitch * 0.22;
}

/** Radius of the shaft skin at y. A 45° chamfer pulls that skin inward at the ends. */
function chamferedShaftRadius(
  y: number,
  length: number,
  radius: number,
  bottomChamfer: number,
  topChamfer: number,
) {
  let skin = radius;
  if (bottomChamfer > 0.05 && y < bottomChamfer) {
    const tip = Math.max(0.05, radius - bottomChamfer);
    skin = Math.min(skin, tip + (radius - tip) * (y / bottomChamfer));
  }
  if (topChamfer > 0.05 && y > length - topChamfer) {
    const tip = Math.max(0.05, radius - topChamfer);
    const fromEnd = length - y;
    skin = Math.min(skin, tip + (radius - tip) * (fromEnd / topChamfer));
  }
  return skin;
}

function pushHelicalThreads(
  positions: number[],
  normals: number[],
  options: {
    majorR: number;
    toothRootR: number;
    shaftR: number;
    pitch: number;
    height: number;
    halfWidth: number;
    lefthand: number;
    helixSegs: number;
    /** Axial length of the 45° chamfer at the start (y = 0) and at the tip. */
    bottomChamfer?: number;
    topChamfer?: number;
  },
) {
  const {
    majorR,
    toothRootR,
    shaftR,
    pitch,
    height: h,
    halfWidth,
    lefthand,
    helixSegs,
    bottomChamfer = 0,
    topChamfer = 0,
  } = options;
  const sections: Array<{ rootA: Vec3; crest: Vec3; rootB: Vec3; scale: number }> = [];
  for (let i = 0; i <= helixSegs; i += 1) {
    const t = i / helixSegs;
    const y = t * h;
    const scale = threadRunoutScale(y, h, pitch);
    const angle = lefthand * (y / pitch) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const drop = Math.max(0, shaftR - chamferedShaftRadius(y, h, shaftR, bottomChamfer, topChamfer));
    const crestR = Math.max(0.05, toothRootR + (majorR - toothRootR) * scale - drop);
    const rootR = Math.max(0.05, toothRootR - drop);
    const sectionHalf = halfWidth * (0.35 + 0.65 * scale);
    const crest: Vec3 = [cos * crestR, y, sin * crestR];
    const rootA: Vec3 = [cos * rootR, Math.max(0, Math.min(h, y - sectionHalf)), sin * rootR];
    const rootB: Vec3 = [cos * rootR, Math.max(0, Math.min(h, y + sectionHalf)), sin * rootR];
    sections.push({ rootA, crest, rootB, scale });
  }

  for (let i = 1; i < sections.length; i += 1) {
    const prev = sections[i - 1];
    const curr = sections[i];
    if (prev.scale < 1e-3 && curr.scale < 1e-3) continue;
    pushQuad(positions, normals, prev.rootA, prev.crest, curr.crest, curr.rootA);
    pushQuad(positions, normals, prev.crest, prev.rootB, curr.rootB, curr.crest);
    pushQuad(positions, normals, prev.rootA, curr.rootA, curr.rootB, prev.rootB);
  }
}

/**
 * Fast procedural metric screw / shaft / thread-cutter mesh.
 * Pure JS — no OCCT/WASM — so inserting/updating stays interactive.
 */
export function threadHeadSize(majorDiameter: number, head: ThreadHead) {
  const diameter = Math.max(1, majorDiameter);
  if (head === "countersunk") return { across: diameter * 2, height: diameter * 0.6 };
  if (head === "hex") return { across: diameter * 1.6, height: diameter * 0.7 };
  return { across: diameter * 1.7, height: diameter };
}

export function threadNutSize(majorDiameter: number) {
  const diameter = Math.max(1, majorDiameter);
  return { across: diameter * 1.6, height: diameter * 0.8 };
}

/**
 * Fast procedural thread mesh: rod, headed screw, nut, or tapped-hole cutter.
 * Pure JS — no OCCT/WASM — so inserting/updating stays interactive.
 */
export function buildMetricThreadedCylinder(
  params: ResolvedThreadParams,
  height: number,
  options: ThreadMeshOptions = {},
): MetricThreadSolidMesh {
  const clearance = Math.max(MIN_THREAD_CLEARANCE, Math.min(MAX_THREAD_CLEARANCE, options.clearance ?? 0));
  const part: ThreadMeshPart = options.part ?? "screw";
  const role: ThreadRole = options.role
    ?? (part === "shaft" ? "rod" : part === "threads" ? "bore" : "rod");
  const head: ThreadHead = options.head ?? "cylinder";
  const profile: ThreadProfile = options.profile ?? "v";
  const nominalR = Math.max(0.35, params.majorDiameter / 2);
  const majorR = role === "bore" || role === "nut" ? nominalR + clearance : Math.max(0.35, nominalR - clearance);
  const pitch = Math.max(0.15, params.pitch);
  const depth = Math.min(params.depth || metricThreadDepth(pitch), Math.max(0.08, majorR * 0.45));
  const rootR = Math.max(0.2, majorR - depth);
  const shaftR = rootR;
  const shank = Math.max(pitch * 1.05, height);
  const lefthand = params.handedness === "left" ? -1 : 1;
  const chamfer = Math.max(0, Math.min(options.chamfer ?? 0, shank * 0.3, shaftR * 0.8));

  const radialSegs = Math.max(
    MIN_THREAD_SIDES,
    Math.min(MAX_THREAD_SIDES, Math.round(options.sides ?? DEFAULT_THREAD_SIDES)),
  );
  const segsPerTurn = Math.max(8, Math.round(radialSegs * 0.45));
  const helixSegs = Math.max(8, Math.ceil((shank / pitch) * segsPerTurn));
  const halfWidth = Math.min(profileHalfWidth(profile, pitch), shank * 0.45);
  const embed = Math.min(depth * 0.35, shaftR * 0.2);
  const toothRootR = Math.max(0.12, shaftR - embed);
  const headSize = threadHeadSize(params.majorDiameter, head);
  const nutSize = threadNutSize(params.majorDiameter);

  const positions: number[] = [];
  const normals: number[] = [];

  const pushShaft = (y0: number, y1: number, radius: number, capTop = true) => {
    if (y1 - y0 <= 0.05) return;
    const c = chamfer <= 0.05 ? 0 : Math.min(chamfer, (y1 - y0) * 0.3, radius * 0.8);
    const tip = Math.max(0.05, radius - c);
    if (c <= 0.05) {
      pushFrustum(positions, normals, radius, radius, y0, y1, radialSegs);
      pushDisk(positions, normals, radius, y0, radialSegs, false);
      if (capTop) pushDisk(positions, normals, radius, y1, radialSegs, true);
      return;
    }
    pushFrustum(positions, normals, tip, radius, y0, y0 + c, radialSegs);
    if (capTop) {
      pushFrustum(positions, normals, radius, radius, y0 + c, y1 - c, radialSegs);
      pushFrustum(positions, normals, radius, tip, y1 - c, y1, radialSegs);
      pushDisk(positions, normals, tip, y1, radialSegs, true);
    } else {
      pushFrustum(positions, normals, radius, radius, y0 + c, y1, radialSegs);
    }
    pushDisk(positions, normals, tip, y0, radialSegs, false);
  };

  if (role === "nut") {
    const nutHeight = Math.max(pitch, height);
    const wallR = majorR;
    const tipR = Math.max(0.15, wallR - depth);
    const mouth = Math.min(chamfer, nutHeight * 0.3, wallR * 0.45);
    const capHole = mouth > 0.05 ? wallR + mouth : wallR;
    pushHexNut(positions, normals, nutSize.across, capHole, nutHeight, radialSegs);
    if (mouth > 0.05) {
      pushFrustum(positions, normals, capHole, wallR, 0, mouth, radialSegs);
      pushFrustum(positions, normals, wallR, wallR, mouth, nutHeight - mouth, radialSegs);
      pushFrustum(positions, normals, wallR, capHole, nutHeight - mouth, nutHeight, radialSegs);
    } else {
      pushFrustum(positions, normals, wallR, wallR, 0, nutHeight, radialSegs);
    }
    pushHelicalThreads(positions, normals, {
      majorR: tipR,
      toothRootR: Math.max(tipR + 0.02, wallR - 0.02),
      shaftR: wallR,
      pitch,
      height: nutHeight,
      halfWidth,
      lefthand,
      helixSegs: Math.max(8, Math.ceil((nutHeight / pitch) * segsPerTurn)),
    });
  } else if (part === "shaft") {
    pushShaft(0, shank, shaftR);
  } else {
    const endChamfer = chamfer <= 0.05 ? 0 : Math.min(chamfer, shank * 0.3, shaftR * 0.8);
    pushShaft(0, shank, shaftR, role !== "screw");
    pushHelicalThreads(positions, normals, {
      majorR,
      toothRootR,
      shaftR,
      pitch,
      height: shank,
      halfWidth,
      lefthand,
      helixSegs,
      bottomChamfer: endChamfer,
      topChamfer: role === "screw" ? 0 : endChamfer,
    });
  }

  if (role === "screw") {
    // The shank is open at the top. The head continues that same rim, so the
    // screw is one closed shell rather than a head sitting on an open shaft.
    const y0 = shank;
    const y1 = shank + headSize.height;
    const headR = headSize.across / 2;
    if (head === "hex") {
      for (let i = 0; i < radialSegs; i += 1) {
        const a0 = (i / radialSegs) * Math.PI * 2;
        const a1 = ((i + 1) / radialSegs) * Math.PI * 2;
        const r0 = hexRadiusAt(headSize.across, a0);
        const r1 = hexRadiusAt(headSize.across, a1);
        const shoulder0: Vec3 = [Math.cos(a0) * shaftR, y0, Math.sin(a0) * shaftR];
        const shoulder1: Vec3 = [Math.cos(a1) * shaftR, y0, Math.sin(a1) * shaftR];
        const hex0: Vec3 = [Math.cos(a0) * r0, y0, Math.sin(a0) * r0];
        const hex1: Vec3 = [Math.cos(a1) * r1, y0, Math.sin(a1) * r1];
        const top0: Vec3 = [Math.cos(a0) * r0, y1, Math.sin(a0) * r0];
        const top1: Vec3 = [Math.cos(a1) * r1, y1, Math.sin(a1) * r1];
        pushQuad(positions, normals, shoulder0, shoulder1, hex1, hex0);
        pushQuad(positions, normals, hex0, hex1, top1, top0);
      }
      const center: Vec3 = [0, y1, 0];
      for (let i = 0; i < radialSegs; i += 1) {
        const a0 = (i / radialSegs) * Math.PI * 2;
        const a1 = ((i + 1) / radialSegs) * Math.PI * 2;
        const r0 = hexRadiusAt(headSize.across, a0);
        const r1 = hexRadiusAt(headSize.across, a1);
        const p0: Vec3 = [Math.cos(a0) * r0, y1, Math.sin(a0) * r0];
        const p1: Vec3 = [Math.cos(a1) * r1, y1, Math.sin(a1) * r1];
        pushTriangle(positions, normals, center, p0, p1);
      }
    } else if (head === "countersunk") {
      pushFrustum(positions, normals, shaftR, headR, y0, y1, radialSegs);
      pushDisk(positions, normals, headR, y1, radialSegs, true);
    } else {
      pushAnnulus(positions, normals, shaftR, headR, y0, radialSegs);
      pushFrustum(positions, normals, headR, headR, y0, y1, radialSegs);
      pushDisk(positions, normals, headR, y1, radialSegs, true);
    }
  }

  const pos = new Float32Array(positions);
  const nor = new Float32Array(normals);
  const triangleCount = Math.floor(pos.length / 9);
  const indices = new Uint32Array(triangleCount * 3);
  for (let i = 0; i < indices.length; i += 1) indices[i] = i;

  const hexSpan = (across: number) => (across / Math.sqrt(3)) * 2;
  const outer = role === "nut"
    ? hexSpan(nutSize.across)
    : role === "screw"
      ? Math.max(majorR * 2, head === "hex" ? hexSpan(headSize.across) : headSize.across)
      : (part === "shaft" ? shaftR : majorR) * 2;
  const totalHeight = role === "nut" ? Math.max(pitch, height) : role === "screw" ? shank + headSize.height : shank;

  return {
    positions: pos,
    normals: nor,
    indices,
    triangleCount,
    brep: "",
    width: outer,
    depth: outer,
    height: totalHeight,
  };
}
