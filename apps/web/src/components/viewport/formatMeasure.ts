import { millimetersToDisplay } from "@/lib/measurementUnits";
import { cleanNearZero } from "@/lib/workplaneShapes";
import type { WorkplaneWorkspaceSettings } from "@/types/sketchforge";
import { DEFAULT_WORKSPACE } from "@/components/viewport/viewportConstants";

export type MeasureFormat = Pick<WorkplaneWorkspaceSettings, "accuracy" | "units" | "scale">;

/** Formats a stored millimetre length in the workplane's display unit. */
export function formatMeasure(value: number, measure: MeasureFormat = DEFAULT_WORKSPACE) {
  const { accuracy } = measure;
  const zeroThreshold = 0.5 * 10 ** -accuracy;
  return cleanNearZero(millimetersToDisplay(value, measure), zeroThreshold).toFixed(accuracy);
}
