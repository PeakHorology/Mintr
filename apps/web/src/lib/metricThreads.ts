export type MetricThreadDesignation =
  | "M1"
  | "M1.2"
  | "M1.6"
  | "M2"
  | "M2.5"
  | "M3"
  | "M4"
  | "M5"
  | "M6"
  | "M8"
  | "M10"
  | "M12"
  | "M14"
  | "M16"
  | "M18"
  | "M20"
  | "M24"
  | "M30"
  | "M36";

export type MetricThreadSpec = {
  designation: MetricThreadDesignation;
  /** Major diameter in mm. */
  majorDiameter: number;
  /** Coarse pitch in mm. */
  pitch: number;
};

/** ISO 261 metric coarse series, first-choice sizes, used by the Threads shape presets. */
export const METRIC_COARSE_THREADS: readonly MetricThreadSpec[] = [
  { designation: "M1", majorDiameter: 1, pitch: 0.25 },
  { designation: "M1.2", majorDiameter: 1.2, pitch: 0.25 },
  { designation: "M1.6", majorDiameter: 1.6, pitch: 0.35 },
  { designation: "M2", majorDiameter: 2, pitch: 0.4 },
  { designation: "M2.5", majorDiameter: 2.5, pitch: 0.45 },
  { designation: "M3", majorDiameter: 3, pitch: 0.5 },
  { designation: "M4", majorDiameter: 4, pitch: 0.7 },
  { designation: "M5", majorDiameter: 5, pitch: 0.8 },
  { designation: "M6", majorDiameter: 6, pitch: 1 },
  { designation: "M8", majorDiameter: 8, pitch: 1.25 },
  { designation: "M10", majorDiameter: 10, pitch: 1.5 },
  { designation: "M12", majorDiameter: 12, pitch: 1.75 },
  { designation: "M14", majorDiameter: 14, pitch: 2 },
  { designation: "M16", majorDiameter: 16, pitch: 2 },
  { designation: "M18", majorDiameter: 18, pitch: 2.5 },
  { designation: "M20", majorDiameter: 20, pitch: 2.5 },
  { designation: "M24", majorDiameter: 24, pitch: 3 },
  { designation: "M30", majorDiameter: 30, pitch: 3.5 },
  { designation: "M36", majorDiameter: 36, pitch: 4 },
] as const;

export type ThreadSide = "external" | "internal";
export type ThreadHandedness = "right" | "left";

export type ResolvedThreadParams = {
  designation?: MetricThreadDesignation;
  majorDiameter: number;
  pitch: number;
  length: number;
  /** Radial tooth depth (crest to root). */
  depth: number;
  side: ThreadSide;
  handedness: ThreadHandedness;
};

/** ISO 60° basic triangle height H = (√3/2)·P; engagement depth ≈ (5/8)·H. */
export function metricThreadDepth(pitch: number) {
  return 0.541266 * pitch;
}

export function metricThreadMinorDiameter(majorDiameter: number, pitch: number) {
  return Math.max(0.1, majorDiameter - 1.082532 * pitch);
}

export type ThreadSeries = "metric" | "unc" | "unf" | "g" | "custom";

export type ThreadSizeOption = {
  id: string;
  label: string;
  series: Exclude<ThreadSeries, "custom">;
  majorDiameter: number;
  /** Axial pitch in millimetres. Inch and pipe sizes store 25.4 / TPI. */
  pitch: number;
};

function inchSize(label: string, series: "unc" | "unf", majorDiameter: number, threadsPerInch: number): ThreadSizeOption {
  return {
    id: label,
    label,
    series,
    majorDiameter,
    pitch: 25.4 / threadsPerInch,
  };
}

function pipeSize(label: string, majorDiameter: number, threadsPerInch: number): ThreadSizeOption {
  return {
    id: label,
    label,
    series: "g",
    majorDiameter,
    pitch: 25.4 / threadsPerInch,
  };
}

/** ASME B1.1 coarse inch threads, #4 through 1 inch. */
export const UNC_THREADS: readonly ThreadSizeOption[] = [
  inchSize("#4-40 UNC", "unc", 2.845, 40),
  inchSize("#6-32 UNC", "unc", 3.505, 32),
  inchSize("#8-32 UNC", "unc", 4.166, 32),
  inchSize("#10-24 UNC", "unc", 4.826, 24),
  inchSize("1/4-20 UNC", "unc", 6.35, 20),
  inchSize("5/16-18 UNC", "unc", 7.938, 18),
  inchSize("3/8-16 UNC", "unc", 9.525, 16),
  inchSize("1/2-13 UNC", "unc", 12.7, 13),
  inchSize("5/8-11 UNC", "unc", 15.875, 11),
  inchSize("3/4-10 UNC", "unc", 19.05, 10),
  inchSize("1-8 UNC", "unc", 25.4, 8),
];

/** ASME B1.1 fine inch threads, #4 through 1 inch. */
export const UNF_THREADS: readonly ThreadSizeOption[] = [
  inchSize("#4-48 UNF", "unf", 2.845, 48),
  inchSize("#6-40 UNF", "unf", 3.505, 40),
  inchSize("#8-36 UNF", "unf", 4.166, 36),
  inchSize("#10-32 UNF", "unf", 4.826, 32),
  inchSize("1/4-28 UNF", "unf", 6.35, 28),
  inchSize("5/16-24 UNF", "unf", 7.938, 24),
  inchSize("3/8-24 UNF", "unf", 9.525, 24),
  inchSize("1/2-20 UNF", "unf", 12.7, 20),
  inchSize("5/8-18 UNF", "unf", 15.875, 18),
  inchSize("3/4-16 UNF", "unf", 19.05, 16),
  inchSize("1-12 UNF", "unf", 25.4, 12),
];

/** ISO 228-1 parallel pipe threads. The name is the pipe, not the thread diameter. */
export const G_PIPE_THREADS: readonly ThreadSizeOption[] = [
  pipeSize("G1/16", 7.723, 28),
  pipeSize("G1/8", 9.728, 28),
  pipeSize("G1/4", 13.157, 19),
  pipeSize("G3/8", 16.662, 19),
  pipeSize("G1/2", 20.955, 14),
  pipeSize("G3/4", 26.441, 14),
  pipeSize("G1", 33.249, 11),
  pipeSize("G1-1/8", 37.897, 11),
  pipeSize("G1-1/4", 41.91, 11),
  pipeSize("G1-1/2", 47.803, 11),
  pipeSize("G2", 59.614, 11),
  pipeSize("G2-1/2", 75.184, 11),
  pipeSize("G3", 87.884, 11),
  pipeSize("G4", 113.03, 11),
];

export const THREAD_SIZE_OPTIONS: readonly ThreadSizeOption[] = [
  ...METRIC_COARSE_THREADS.map((entry) => ({
    id: entry.designation,
    label: entry.designation,
    series: "metric" as const,
    majorDiameter: entry.majorDiameter,
    pitch: entry.pitch,
  })),
  ...UNC_THREADS,
  ...UNF_THREADS,
  ...G_PIPE_THREADS,
];

export function findThreadSize(id: string): ThreadSizeOption | undefined {
  return THREAD_SIZE_OPTIONS.find((entry) => entry.id === id);
}

export function findMetricThread(designation: string): MetricThreadSpec | undefined {
  return METRIC_COARSE_THREADS.find((entry) => entry.designation === designation);
}

export function nearestMetricThreadForDiameter(diameter: number): MetricThreadSpec {
  let best = METRIC_COARSE_THREADS[0];
  let bestError = Math.abs(best.majorDiameter - diameter);
  for (const entry of METRIC_COARSE_THREADS) {
    const error = Math.abs(entry.majorDiameter - diameter);
    if (error < bestError) {
      best = entry;
      bestError = error;
    }
  }
  return best;
}

export function resolveThreadParams(input: {
  designation?: string | null;
  majorDiameter?: number;
  pitch?: number;
  length: number;
  depth?: number;
  side: ThreadSide;
  handedness?: ThreadHandedness;
}): ResolvedThreadParams {
  const preset = input.designation ? findMetricThread(input.designation) : undefined;
  const majorDiameter = Math.max(0.5, input.majorDiameter ?? preset?.majorDiameter ?? 3);
  const pitch = Math.max(0.1, input.pitch ?? preset?.pitch ?? 0.5);
  const length = Math.max(pitch, input.length);
  const depth = Math.max(0.05, input.depth ?? metricThreadDepth(pitch));
  return {
    designation: preset?.designation,
    majorDiameter,
    pitch,
    length,
    depth,
    side: input.side,
    handedness: input.handedness === "left" ? "left" : "right",
  };
}

/**
 * Infer external vs internal from a cylindrical face normal vs solid interior.
 * If the face normal points toward the solid center of mass, the face is a hole wall.
 */
export function inferThreadSideFromFace(options: {
  faceCenter: { x: number; y: number; z: number };
  outwardNormal: { x: number; y: number; z: number };
  solidCenter: { x: number; y: number; z: number };
}): ThreadSide {
  const toSolid = {
    x: options.solidCenter.x - options.faceCenter.x,
    y: options.solidCenter.y - options.faceCenter.y,
    z: options.solidCenter.z - options.faceCenter.z,
  };
  const dot =
    options.outwardNormal.x * toSolid.x +
    options.outwardNormal.y * toSolid.y +
    options.outwardNormal.z * toSolid.z;
  return dot > 0 ? "internal" : "external";
}
