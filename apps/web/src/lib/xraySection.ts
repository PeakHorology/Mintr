import type { WorkplaneShape } from "@/types/sketchforge";

const SECTION_PADDING = 4;

/** One slider step, between the old coarse half-millimetre and the fine tenth. */
export const XRAY_STEP = 0.25;

export type XrayAxis = "x" | "y" | "z";

export type XraySpan = { min: number; max: number };

const AXES: XrayAxis[] = ["x", "y", "z"];

export const XRAY_AXES: { axis: XrayAxis; label: string }[] = [
  { axis: "x", label: "X" },
  { axis: "y", label: "Y" },
  { axis: "z", label: "Z" },
];

function degrees(value: number) {
  return (value * Math.PI) / 180;
}

/** World half-size of a shape after its rotations. Euler order matches the viewport (XYZ). */
function worldHalfExtents(shape: WorkplaneShape) {
  const hx = Math.abs(shape.width) / 2;
  const hy = Math.abs(shape.height) / 2;
  const hz = Math.abs(shape.depth) / 2;
  const rx = degrees(shape.rotationX ?? 0);
  const ry = degrees(shape.rotation ?? 0);
  const rz = degrees(shape.rotationZ ?? 0);
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const m00 = cy * cz;
  const m01 = sx * sy * cz - cx * sz;
  const m02 = cx * sy * cz + sx * sz;
  const m10 = cy * sz;
  const m11 = sx * sy * sz + cx * cz;
  const m12 = cx * sy * sz - sx * cz;
  const m20 = -sy;
  const m21 = sx * cy;
  const m22 = cx * cy;
  return {
    x: Math.abs(m00) * hx + Math.abs(m01) * hy + Math.abs(m02) * hz,
    y: Math.abs(m10) * hx + Math.abs(m11) * hy + Math.abs(m12) * hz,
    z: Math.abs(m20) * hx + Math.abs(m21) * hy + Math.abs(m22) * hz,
  };
}

function shapeCenter(shape: WorkplaneShape) {
  return {
    x: shape.x,
    y: (shape.elevation ?? 0) + shape.height / 2,
    z: shape.z,
  };
}

function emptySpan(axis: XrayAxis): XraySpan {
  return axis === "y" ? { min: -4, max: 24 } : { min: -40, max: 40 };
}

/** Visible shapes the cut should cover. A selection wins; otherwise every visible shape. */
export function xraySubjects(shapes: WorkplaneShape[], selectedIds?: readonly string[]) {
  const visible = shapes.filter((shape) => !shape.hidden);
  if (!selectedIds?.length) return visible;
  const selected = visible.filter((shape) => selectedIds.includes(shape.id));
  return selected.length > 0 ? selected : visible;
}

/** Range along one axis, covering the chosen shapes plus a little room past the ends. */
export function xrayAxisBounds(shapes: WorkplaneShape[], axis: XrayAxis, selectedIds?: readonly string[]): XraySpan {
  let min = Infinity;
  let max = -Infinity;
  for (const shape of xraySubjects(shapes, selectedIds)) {
    const center = shapeCenter(shape);
    const extent = worldHalfExtents(shape);
    min = Math.min(min, center[axis] - extent[axis]);
    max = Math.max(max, center[axis] + extent[axis]);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return emptySpan(axis);
  return {
    min: Math.floor(min - SECTION_PADDING),
    max: Math.ceil(max + SECTION_PADDING),
  };
}

export function xraySpanCenter(span: XraySpan) {
  return (span.min + span.max) / 2;
}

/** Which half of the model stays visible. The other half is hidden in the view only. */
export function xrayKeptSide(axis: XrayAxis, keepLow: boolean) {
  const sign = keepLow ? "−" : "+";
  return `${sign}${axis.toUpperCase()} stays`;
}

/**
 * Three.js clips a point when normal · point + constant is negative.
 * keepLow hides everything past the plane (greater than position).
 */
export function xrayClipping(axis: XrayAxis, position: number, keepLow: boolean) {
  const sign = keepLow ? -1 : 1;
  const normal: [number, number, number] = [0, 0, 0];
  normal[AXES.indexOf(axis)] = sign;
  return {
    normal,
    constant: keepLow ? position : -position,
  };
}
