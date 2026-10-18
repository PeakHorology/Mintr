import type { WorkplaneShape } from "@/types/sketchforge";

export type GearForm = "spur" | "helical" | "herringbone" | "ring" | "rack";

export type GearSpec = {
  form: GearForm;
  teeth: number;
  /** Millimetres. Pitch diameter is module × teeth. */
  module: number;
  /** Degrees. Involute flanks. 20 is the usual mesh. */
  pressureAngle: number;
  /** Millimetres for the pair. Each gear takes half. */
  backlash: number;
  /** Centre bore diameter in millimetres. 0 is solid. */
  bore: number;
  /** Degrees, signed. Helical and herringbone only. */
  helixAngle: number;
  /** Millimetres of material outside a ring gear's tooth roots. */
  rim: number;
};

export const GEAR_FORMS = ["spur", "helical", "herringbone", "ring", "rack"] as const;

const CLEARANCE = 0.25;

export function defaultGearSpec(): GearSpec {
  return {
    form: "spur",
    teeth: 20,
    module: 2,
    pressureAngle: 20,
    backlash: 0.2,
    bore: 6,
    helixAngle: 20,
    rim: 4,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function gearFormLabel(form: GearForm) {
  if (form === "helical") return "Helical";
  if (form === "herringbone") return "Herringbone";
  if (form === "ring") return "Ring";
  if (form === "rack") return "Rack";
  return "Spur";
}

export function gearFormFromLabel(label: string): GearForm {
  if (label === "Helical") return "helical";
  if (label === "Herringbone") return "herringbone";
  if (label === "Ring") return "ring";
  if (label === "Rack") return "rack";
  return "spur";
}

export function normalizeGearSpec(input?: Partial<GearSpec> | null): GearSpec {
  const fallback = defaultGearSpec();
  const form: GearForm = GEAR_FORMS.includes(input?.form as GearForm) ? (input?.form as GearForm) : "spur";
  const minTeeth = form === "rack" ? 3 : form === "ring" ? 10 : 6;
  const maxTeeth = form === "rack" ? 48 : 120;
  const teeth = clamp(Math.round(input?.teeth ?? fallback.teeth), minTeeth, maxTeeth);
  const module = clamp(Number.isFinite(input?.module) ? Number(input?.module) : fallback.module, 0.5, 12);
  const pressureAngle = clamp(Number.isFinite(input?.pressureAngle) ? Number(input?.pressureAngle) : fallback.pressureAngle, 14.5, 30);
  const backlash = clamp(Number.isFinite(input?.backlash) ? Number(input?.backlash) : fallback.backlash, 0, 1.5);
  const helixAngle = clamp(Number.isFinite(input?.helixAngle) ? Number(input?.helixAngle) : fallback.helixAngle, -45, 45);
  const rim = clamp(Number.isFinite(input?.rim) ? Number(input?.rim) : fallback.rim, 0.8, 30);
  const pitchRadius = (teeth * module) / 2;
  const rootRadius = form === "ring" ? pitchRadius - module : pitchRadius - module * (1 + CLEARANCE);
  const maxBore = Math.max(0, rootRadius * 2 - 1.2);
  const requestedBore = Number.isFinite(input?.bore) ? Number(input?.bore) : fallback.bore;
  const bore = form === "ring" || form === "rack" ? 0 : clamp(requestedBore, 0, maxBore);
  return { form, teeth, module, pressureAngle, backlash, bore, helixAngle, rim };
}

export type GearMetrics = {
  pitchDiameter: number;
  outsideDiameter: number;
  rootDiameter: number;
  pitchRadius: number;
  addendum: number;
  dedendum: number;
  toothHeight: number;
};

export function gearMetrics(spec: GearSpec): GearMetrics {
  const pitchRadius = (spec.teeth * spec.module) / 2;
  const addendum = spec.module;
  const dedendum = spec.module * (1 + CLEARANCE);
  const outsideDiameter = spec.form === "ring"
    ? spec.module * (spec.teeth + 2.5) + 2 * spec.rim
    : spec.form === "rack"
      ? spec.teeth * Math.PI * spec.module
      : spec.module * (spec.teeth + 2);
  const rootDiameter = spec.form === "ring"
    ? 2 * (pitchRadius - addendum)
    : 2 * Math.max(0.2, pitchRadius - dedendum);
  return {
    pitchDiameter: spec.teeth * spec.module,
    outsideDiameter,
    rootDiameter,
    pitchRadius,
    addendum,
    dedendum,
    toothHeight: addendum + dedendum,
  };
}

/** Centre distance for two external gears, or a ring and the gear inside it. */
export function gearCenterDistance(a: GearSpec, b: GearSpec) {
  if (Math.abs(a.module - b.module) > 0.001) return null;
  if (Math.abs(a.pressureAngle - b.pressureAngle) > 0.05) return null;
  const aRing = a.form === "ring";
  const bRing = b.form === "ring";
  if (aRing && bRing) return null;
  if (a.form === "rack" || b.form === "rack") return null;
  if (aRing) return ((a.teeth - b.teeth) * a.module) / 2;
  if (bRing) return ((b.teeth - a.teeth) * a.module) / 2;
  return ((a.teeth + b.teeth) * a.module) / 2;
}

export function gearFootprint(spec: GearSpec, barDepth = 0) {
  const metrics = gearMetrics(spec);
  if (spec.form === "rack") {
    const depth = Math.max(metrics.toothHeight + 0.5, barDepth);
    return { width: metrics.outsideDiameter, depth };
  }
  return { width: metrics.outsideDiameter, depth: metrics.outsideDiameter };
}

export function moduleForSpan(spec: GearSpec, span: number) {
  const safe = Math.max(1, span);
  if (spec.form === "rack") return clamp(safe / (spec.teeth * Math.PI), 0.5, 12);
  if (spec.form === "ring") return clamp((safe - 2 * spec.rim) / (spec.teeth + 2.5), 0.5, 12);
  return clamp(safe / (spec.teeth + 2), 0.5, 12);
}

/** Keep the gear round (or the rack pitch-true) when a handle changes the footprint. */
export function gearPatchForFootprint(shape: WorkplaneShape, width: number, depth: number): Partial<WorkplaneShape> {
  const current = normalizeGearSpec(shape.gearSpec);
  const span = current.form === "rack"
    ? width
    : Math.abs(width - gearFootprint(current, depth).width) >= Math.abs(depth - gearFootprint(current, depth).width)
      ? width
      : depth;
  const module = current.form === "rack" ? moduleForSpan(current, width) : moduleForSpan(current, span);
  const next = normalizeGearSpec({ ...current, module });
  const foot = gearFootprint(next, current.form === "rack" ? depth : 0);
  return {
    gearSpec: next,
    width: foot.width,
    depth: foot.depth,
    size: Math.max(foot.width, foot.depth),
  };
}

export function gearSpecKey(spec?: Partial<GearSpec> | null) {
  const next = normalizeGearSpec(spec);
  return [
    next.form,
    next.teeth,
    next.module.toFixed(4),
    next.pressureAngle.toFixed(2),
    next.backlash.toFixed(4),
    next.bore.toFixed(4),
    next.helixAngle.toFixed(2),
    next.rim.toFixed(3),
  ].join("|");
}

/** Total twist of a helical tooth across the face, in radians, on the pitch circle. */
export function gearHelixTwistRadians(spec: GearSpec, height: number) {
  if (spec.form !== "helical" && spec.form !== "herringbone") return 0;
  const pitchRadius = (spec.teeth * spec.module) / 2;
  if (pitchRadius < 0.001 || height < 0.001) return 0;
  return (height * Math.tan((spec.helixAngle * Math.PI) / 180)) / pitchRadius;
}

type ToothModel = {
  rPitch: number;
  rb: number;
  rTip: number;
  rRoot: number;
  alphaPitch: number;
  halfToothAngle: number;
  alphaTip: number;
  toothPitch: number;
  isInternal: boolean;
};

function involute(alpha: number) {
  return Math.tan(alpha) - alpha;
}

function toothModel(spec: GearSpec, internal: boolean): ToothModel {
  const alpha = (spec.pressureAngle * Math.PI) / 180;
  const rPitch = (spec.teeth * spec.module) / 2;
  const rb = rPitch * Math.cos(alpha);
  const shift = 0;
  const addendum = spec.module * (1 + shift);
  const dedendum = spec.module * (1 + CLEARANCE - shift);
  const rTip = internal ? rPitch - spec.module * (1 - shift) : rPitch + addendum;
  const rRoot = internal ? rPitch + spec.module * (1 + CLEARANCE + shift) : Math.max(rb * 0.2, rPitch - dedendum);
  const backlashHalf = spec.backlash / 2;
  const halfToothAngle = (Math.PI / 2 + 2 * shift * Math.tan(alpha)) / spec.teeth + (internal ? backlashHalf / rPitch : -backlashHalf / rPitch);
  const rOuter = internal ? rRoot : rTip;
  return {
    rPitch,
    rb,
    rTip: Math.max(0.2, rTip),
    rRoot: Math.max(0.2, rRoot),
    alphaPitch: alpha,
    halfToothAngle,
    alphaTip: rOuter <= rb ? 0 : Math.acos(Math.min(1, rb / rOuter)),
    toothPitch: (2 * Math.PI) / spec.teeth,
    isInternal: internal,
  };
}

function involutePoint(rb: number, alpha: number, theta0: number, sign: 1 | -1): [number, number] {
  const r = rb / Math.cos(Math.max(1e-6, alpha));
  const theta = theta0 + sign * involute(alpha);
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

function flankSamples(rb: number, alpha0: number, alpha1: number, theta0: number, count: number, sign: 1 | -1) {
  const pts: Array<[number, number]> = [];
  const steps = Math.max(1, count);
  for (let i = 0; i <= steps; i += 1) {
    const t = 0.5 - 0.5 * Math.cos((i / steps) * Math.PI);
    pts.push(involutePoint(rb, alpha0 + (alpha1 - alpha0) * t, theta0, sign));
  }
  return pts;
}

function pushPoint(pts: Array<[number, number]>, point: [number, number]) {
  const last = pts[pts.length - 1];
  if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 1e-5) return;
  pts.push(point);
}

function arcThrough(start: [number, number], mid: [number, number], end: [number, number], segments: number) {
  const d = 2 * (start[0] * (mid[1] - end[1]) + mid[0] * (end[1] - start[1]) + end[0] * (start[1] - mid[1]));
  if (Math.abs(d) < 1e-8) return [mid];
  const startSq = start[0] * start[0] + start[1] * start[1];
  const midSq = mid[0] * mid[0] + mid[1] * mid[1];
  const endSq = end[0] * end[0] + end[1] * end[1];
  const cx = (startSq * (mid[1] - end[1]) + midSq * (end[1] - start[1]) + endSq * (start[1] - mid[1])) / d;
  const cy = (startSq * (end[0] - mid[0]) + midSq * (start[0] - end[0]) + endSq * (mid[0] - start[0])) / d;
  const ang = (point: [number, number]) => Math.atan2(point[1] - cy, point[0] - cx);
  const startAng = ang(start);
  let toMid = ang(mid) - startAng;
  let toEnd = ang(end) - ang(mid);
  if (toMid <= -Math.PI) toMid += Math.PI * 2;
  if (toMid > Math.PI) toMid -= Math.PI * 2;
  if (toEnd <= -Math.PI) toEnd += Math.PI * 2;
  if (toEnd > Math.PI) toEnd -= Math.PI * 2;
  const sweep = toMid + toEnd;
  const radius = Math.hypot(start[0] - cx, start[1] - cy);
  const pts: Array<[number, number]> = [];
  for (let i = 1; i < segments; i += 1) {
    const theta = startAng + sweep * (i / segments);
    pts.push([cx + radius * Math.cos(theta), cy + radius * Math.sin(theta)]);
  }
  return pts;
}

function toothOutline(tm: ToothModel, toothIndex: number, teeth: number, samples: number) {
  const center = toothIndex * tm.toothPitch;
  const nextCenter = ((toothIndex + 1) % teeth) * tm.toothPitch;
  const invPitch = involute(tm.alphaPitch);
  const thetaLeft = center - tm.halfToothAngle - invPitch;
  const thetaRight = center + tm.halfToothAngle + invPitch;
  const needsBridge = tm.isInternal ? tm.rb < tm.rRoot - 1e-4 : tm.rb > tm.rRoot + 1e-4;
  const alphaRoot = !needsBridge && tm.rRoot > tm.rb ? Math.acos(Math.min(1, tm.rb / tm.rRoot)) : 0;
  const leftFlank = flankSamples(tm.rb, alphaRoot, Math.max(alphaRoot + 1e-4, tm.alphaTip), thetaLeft, samples, 1);
  const rightFlank = flankSamples(tm.rb, alphaRoot, Math.max(alphaRoot + 1e-4, tm.alphaTip), thetaRight, samples, -1).reverse();
  const pts: Array<[number, number]> = [];
  if (needsBridge) pushPoint(pts, [tm.rRoot * Math.cos(thetaLeft), tm.rRoot * Math.sin(thetaLeft)]);
  leftFlank.forEach((point) => pushPoint(pts, point));
  const leftTip = pts[pts.length - 1] ?? leftFlank[leftFlank.length - 1];
  const rightTip = rightFlank[0];
  if (tm.isInternal) {
    arcThrough(
      leftTip,
      [tm.rTip * Math.cos(center), tm.rTip * Math.sin(center)],
      rightTip,
      6,
    ).forEach((point) => pushPoint(pts, point));
  } else {
    const leftAng = Math.atan2(leftTip[1], leftTip[0]);
    let sweep = Math.atan2(rightTip[1], rightTip[0]) - leftAng;
    if (sweep > Math.PI) sweep -= Math.PI * 2;
    if (sweep < -Math.PI) sweep += Math.PI * 2;
    for (let i = 1; i < 3; i += 1) {
      const angle = leftAng + sweep * (i / 3);
      pushPoint(pts, [tm.rTip * Math.cos(angle), tm.rTip * Math.sin(angle)]);
    }
  }
  rightFlank.forEach((point) => pushPoint(pts, point));
  if (needsBridge) pushPoint(pts, [tm.rRoot * Math.cos(thetaRight), tm.rRoot * Math.sin(thetaRight)]);
  const rootEnd = nextCenter - tm.halfToothAngle - invPitch;
  let rootSweep = rootEnd - thetaRight;
  if (rootSweep <= 0) rootSweep += Math.PI * 2;
  for (let i = 1; i <= 4; i += 1) {
    const angle = thetaRight + rootSweep * (i / 4);
    pushPoint(pts, [tm.rRoot * Math.cos(angle), tm.rRoot * Math.sin(angle)]);
  }
  return pts;
}

function circlePoints(radius: number, count: number, clockwise = false) {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (clockwise ? -1 : 1) * ((i / count) * Math.PI * 2);
    pts.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return pts;
}

export type GearLoop2 = { x: number; z: number };

function toPeakLoop(points: Array<[number, number]>): GearLoop2[] {
  return points.map(([x, y]) => ({ x, z: -y }));
}

function signedArea(loop: GearLoop2[]) {
  let area = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const next = loop[(i + 1) % loop.length];
    area += loop[i].x * next.z - next.x * loop[i].z;
  }
  return area / 2;
}

function wind(loop: GearLoop2[], ccw: boolean) {
  const next = loop.slice();
  if ((signedArea(next) > 0) !== ccw) next.reverse();
  return next;
}

/** Involute outline in the workplane, X to the right and Z toward the front. Outer is counter-clockwise. */
export function gearPlanLoops(spec: GearSpec): { outer: GearLoop2[]; holes: GearLoop2[][] } {
  const samples = 8;
  if (spec.form === "ring") {
    const metrics = gearMetrics(spec);
    const outer = wind(toPeakLoop(circlePoints(metrics.outsideDiameter / 2, 72)), true);
    const tm = toothModel(spec, true);
    const inner: Array<[number, number]> = [];
    for (let tooth = 0; tooth < spec.teeth; tooth += 1) {
      toothOutline(tm, tooth, spec.teeth, samples).forEach((point) => pushPoint(inner, point));
    }
    return { outer, holes: [wind(toPeakLoop(inner), false)] };
  }
  const tm = toothModel(spec, false);
  const outer: Array<[number, number]> = [];
  for (let tooth = 0; tooth < spec.teeth; tooth += 1) {
    toothOutline(tm, tooth, spec.teeth, samples).forEach((point) => pushPoint(outer, point));
  }
  const holes: GearLoop2[][] = [];
  if (spec.bore > 0.2) holes.push(wind(toPeakLoop(circlePoints(spec.bore / 2, 28, true)), false));
  return { outer: wind(toPeakLoop(outer), true), holes };
}

export function rackPlanLoop(spec: GearSpec, depth: number): GearLoop2[] {
  const metrics = gearMetrics(spec);
  const foot = gearFootprint(spec, depth);
  const pitch = Math.PI * spec.module;
  const halfThick = Math.max(0.08, pitch / 4 - spec.backlash / 4);
  const alpha = (spec.pressureAngle * Math.PI) / 180;
  const tipHalf = Math.max(0.05, halfThick - metrics.addendum * Math.tan(alpha));
  const rootHalf = Math.min(pitch / 2 - 0.08, halfThick + metrics.dedendum * Math.tan(alpha));
  const tipZ = foot.depth / 2;
  const rootZ = tipZ - metrics.toothHeight;
  const backZ = -foot.depth / 2;
  const width = foot.width;
  const pts: GearLoop2[] = [
    { x: -width / 2, z: backZ },
    { x: width / 2, z: backZ },
    { x: width / 2, z: rootZ },
  ];
  for (let tooth = spec.teeth - 1; tooth >= 0; tooth -= 1) {
    const center = -width / 2 + (tooth + 0.5) * pitch;
    pts.push(
      { x: center + rootHalf, z: rootZ },
      { x: center + tipHalf, z: tipZ },
      { x: center - tipHalf, z: tipZ },
      { x: center - rootHalf, z: rootZ },
    );
  }
  pts.push({ x: -width / 2, z: rootZ });
  return wind(pts, true);
}

export function gearUndercutRisk(spec: GearSpec) {
  if (spec.form === "ring" || spec.form === "rack") return false;
  const alpha = (spec.pressureAngle * Math.PI) / 180;
  return 1 - (spec.teeth * Math.sin(alpha) * Math.sin(alpha)) / 2 > 0.02;
}

function formatMm(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function gearInspectorHint(shape: WorkplaneShape, others: readonly WorkplaneShape[] = []) {
  const spec = normalizeGearSpec(shape.gearSpec);
  const metrics = gearMetrics(spec);
  const parts = [
    spec.form === "rack"
      ? `Pitch line is ${formatMm(metrics.addendum)} mm behind the tips. Width is teeth × π × module.`
      : `Pitch ${formatMm(metrics.pitchDiameter)} mm, outside ${formatMm(metrics.outsideDiameter)} mm.`,
  ];
  if (gearUndercutRisk(spec)) parts.push("A pinion this small can rub at the root.");
  const mate = others
    .filter((entry) => entry.id !== shape.id && entry.kind === "gear" && !entry.hidden)
    .map((entry) => {
      const other = normalizeGearSpec(entry.gearSpec);
      const distance = Math.hypot(entry.x - shape.x, entry.z - shape.z);
      return { entry, other, distance, mesh: gearCenterDistance(spec, other) };
    })
    .sort((a, b) => a.distance - b.distance)[0];
  if (mate?.mesh != null) {
    const helixNote = (spec.form === "helical" || spec.form === "herringbone")
      && (mate.other.form === "helical" || mate.other.form === "herringbone")
      && Math.sign(spec.helixAngle) === Math.sign(mate.other.helixAngle)
      && Math.abs(spec.helixAngle) > 0.5
      ? " Helix angles mesh when they are opposite."
      : "";
    parts.push(`${mate.entry.name} meshes at ${formatMm(mate.mesh)} mm. The centres are ${formatMm(mate.distance)} mm apart.${helixNote}`);
  } else if (mate && mate.mesh == null && mate.other.form !== "rack" && spec.form !== "rack") {
    parts.push(`${mate.entry.name} needs the same module and pressure angle to mesh.`);
  }
  return parts.join(" ");
}
