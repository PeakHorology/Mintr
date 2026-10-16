import { describe, expect, it } from "vitest";
import {
  dimensionLabelRect,
  rotateHandleRect,
  screenRectsOverlap,
  separateDimensionLabels,
  type PlacementLabel,
} from "@/lib/overlayLabelSeparation";

function mark(partial: Partial<PlacementLabel> & Pick<PlacementLabel, "label" | "labelX" | "labelY">): PlacementLabel {
  return {
    x1: partial.labelX - 40,
    y1: partial.labelY,
    x2: partial.labelX + 40,
    y2: partial.labelY,
    ...partial,
  };
}

function overlapsAny(label: PlacementLabel, others: PlacementLabel[], handles: Array<{ x: number; y: number }>) {
  const rect = dimensionLabelRect(label.label, label.labelX, label.labelY);
  if (others.some((other) => other !== label && screenRectsOverlap(rect, dimensionLabelRect(other.label, other.labelX, other.labelY), 8))) {
    return true;
  }
  return handles.some((handle) => screenRectsOverlap(rect, rotateHandleRect(handle), 8));
}

describe("separateDimensionLabels", () => {
  it("leaves a label that is already clear", () => {
    const labels = [mark({ label: "16.00", labelX: 200, labelY: 80 })];
    separateDimensionLabels(labels, [rotateHandleRect({ x: 40, y: 200 })]);
    expect(labels[0].labelX).toBe(200);
    expect(labels[0].labelY).toBe(80);
  });

  it("pulls stacked measurements off each other and off a rotate handle", () => {
    const handle = { x: 180, y: 140 };
    const labels = [
      mark({ label: "16.00", labelX: 180, labelY: 140 }),
      mark({ label: "6.00", labelX: 188, labelY: 148, x1: 188, y1: 100, x2: 188, y2: 180 }),
    ];
    separateDimensionLabels(labels, [rotateHandleRect(handle)], { width: 800, height: 600 });
    expect(overlapsAny(labels[0], labels, [handle])).toBe(false);
    expect(overlapsAny(labels[1], labels, [handle])).toBe(false);
  });

  it("clears a label that sits on the rotate handle from every side", () => {
    const handle = { x: 240, y: 180 };
    for (let step = 0; step < 8; step += 1) {
      const angle = (step / 8) * Math.PI * 2;
      const labels = [mark({
        label: "12.50",
        labelX: handle.x + Math.cos(angle) * 8,
        labelY: handle.y + Math.sin(angle) * 8,
        x1: handle.x - 50,
        y1: handle.y,
        x2: handle.x + 50,
        y2: handle.y,
      })];
      separateDimensionLabels(labels, [rotateHandleRect(handle)], { width: 900, height: 700 });
      expect(overlapsAny(labels[0], labels, [handle])).toBe(false);
    }
  });
});
