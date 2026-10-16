"use client";

import { Check, X } from "lucide-react";
import { EdgeModifierSlider } from "@/components/workplane/EdgeModifierPanel";
import type { SplitAxis } from "@/lib/splitShape";
import type { WorkplaneWorkspaceSettings } from "@/types/sketchforge";

const CUTS: { axis: SplitAxis; label: string }[] = [
  { axis: "x", label: "Left / right" },
  { axis: "z", label: "Front / back" },
  { axis: "y", label: "Top / bottom" },
];

export function SplitPanel({
  targetName,
  axis,
  offset,
  limit,
  workspace,
  busy,
  onAxisChange,
  onOffsetChange,
  onApply,
  onCancel,
}: {
  targetName: string;
  axis: SplitAxis;
  offset: number;
  limit: number;
  workspace: WorkplaneWorkspaceSettings;
  busy: boolean;
  onAxisChange: (axis: SplitAxis) => void;
  onOffsetChange: (offset: number) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const span = Math.max(0.5, limit);
  return (
    <aside className="edge-modifier-panel" aria-label="Split">
      <div className="edge-modifier-header">
        <div>
          <strong>Split</strong>
          <span>Two objects, cut on the line</span>
        </div>
        <button type="button" aria-label="Cancel split" onClick={onCancel}><X size={20} /></button>
      </div>
      <div className="edge-modifier-target">
        <strong>{targetName}</strong>
        <span>The gold plane is the cut. Nothing changes until you split.</span>
      </div>
      <div className="shell-openings">
        <span>Cut</span>
        <div className="shell-opening-row">
          {CUTS.map((cut) => (
            <button
              key={cut.axis}
              type="button"
              className={axis === cut.axis ? "active" : ""}
              aria-pressed={axis === cut.axis}
              onClick={() => onAxisChange(cut.axis)}
            >
              {cut.label}
            </button>
          ))}
        </div>
      </div>
      <EdgeModifierSlider
        label="Line"
        value={offset}
        min={-span}
        max={span}
        step={0.5}
        workspace={workspace}
        length
        disabled={busy}
        onChange={onOffsetChange}
      />
      <div className="edge-modifier-footer">
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={busy} onClick={onApply}>
          <Check size={17} />
          Split
        </button>
      </div>
    </aside>
  );
}
