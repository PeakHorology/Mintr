import { describe, expect, it } from "vitest";
import {
  booleanWorkingQuality,
  displayTriangleTotal,
  shouldSkipLiveOcctBoolean,
} from "@/lib/displayTriangleCount";
import { meshForShape } from "@/lib/editorShapeMesh";
import { restoreGroupedChildren } from "@/lib/editorBoolean";
import { setActiveDisplayQuality, withDisplayQuality } from "@/lib/displayTessellation";
import type { WorkplaneShape } from "@/types/sketchforge";

type BenchRow = {
  workload: string;
  step: string;
  count?: number;
  triangles?: number;
  runs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
};

function cylinder(id: string, x: number): WorkplaneShape {
  return {
    id,
    name: id,
    kind: "cylinder",
    color: "#e07a1f",
    x,
    z: 0,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
  };
}

function manyCylinders(count: number) {
  return Array.from({ length: count }, (_, i) => cylinder(`c${i}`, i * 25));
}

function formatMs(value: number) {
  return Number(value.toFixed(2));
}

function measure(
  rows: BenchRow[],
  workload: string,
  step: string,
  runs: number,
  metadata: Pick<BenchRow, "count" | "triangles">,
  fn: () => void,
) {
  const durations: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    fn();
    durations.push(performance.now() - start);
  }
  rows.push({
    workload,
    step,
    ...metadata,
    runs,
    avgMs: durations.reduce((total, duration) => total + duration, 0) / durations.length,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
  });
}

function printReport(rows: BenchRow[]) {
  console.log("cad-scene perf");
  for (const row of rows) {
    console.log(
      [
        row.workload,
        row.step,
        row.count != null ? `n=${row.count}` : "",
        row.triangles != null ? `tris=${row.triangles}` : "",
        `avg=${formatMs(row.avgMs)}ms`,
        `min=${formatMs(row.minMs)}ms`,
        `max=${formatMs(row.maxMs)}ms`,
      ].filter(Boolean).join("  "),
    );
  }
}

describe("CAD multi-body grouping path", () => {
  it("tessellates a 20-cylinder Group cheaper at working quality than Smooth", () => {
    const shapes = manyCylinders(20);
    const rows: BenchRow[] = [];
    setActiveDisplayQuality("smooth");

    measure(rows, "20-cylinders", "displayTriangleTotal smooth", 5, { count: 20 }, () => {
      displayTriangleTotal(shapes, "smooth");
    });
    measure(rows, "20-cylinders", "meshForShape smooth", 3, { count: 20 }, () => {
      shapes.forEach((shape) => meshForShape(shape));
    });
    const working = booleanWorkingQuality(shapes, "smooth");
    expect(working).toBe("draft");
    expect(shouldSkipLiveOcctBoolean(shapes)).toBe(true);
    measure(rows, "20-cylinders", "meshForShape working", 3, { count: 20 }, () => {
      withDisplayQuality(working, () => {
        shapes.forEach((shape) => meshForShape(shape));
      });
    });

    const group: WorkplaneShape = {
      ...shapes[0],
      id: "group",
      kind: "mesh",
      groupedShapes: shapes,
      groupedBaseWidth: 20 * 25,
      groupedBaseDepth: 20,
      groupedBaseHeight: 20,
      width: 20 * 25,
      size: 20 * 25,
    };
    measure(rows, "20-cylinders", "ungroup restoreGroupedChildren", 8, { count: 20 }, () => {
      restoreGroupedChildren(group);
    });
    expect(restoreGroupedChildren(group)).toHaveLength(20);

    const smoothRow = rows.find((row) => row.step === "meshForShape smooth");
    const workingRow = rows.find((row) => row.step === "meshForShape working");
    expect(workingRow?.avgMs).toBeLessThan((smoothRow?.avgMs ?? 0) * 0.85 + 8);
    printReport(rows);
  });
});
