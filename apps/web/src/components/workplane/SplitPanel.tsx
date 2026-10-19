"use client";

import { Check, X } from "lucide-react";
import { EdgeModifierSlider } from "@/components/workplane/EdgeModifierPanel";
import type { CutJoint } from "@/lib/cutToFit";
import type { SplitAxis } from "@/lib/splitShape";
import type { WorkplaneWorkspaceSettings } from "@/types/sketchforge";

const CUTS: { axis: SplitAxis; label: string }[] = [
  { axis: "x", label: "Left / right" },
  { axis: "z", label: "Front / back" },
  { axis: "y", label: "Top / bottom" },
];

const JOINTS: { joint: CutJoint; label: string }[] = [
  { joint: "none", label: "None" },
  { joint: "dovetail", label: "Dovetail" },
  { joint: "plug", label: "Plug" },
  { joint: "snap", label: "Snap" },
  { joint: "thread", label: "Thread" },
];

export function SplitPanel({
  targetName,
  axis,
  offset,
  limit,
  joint,
  clearance,
  workspace,
  busy,
  onAxisChange,
  onOffsetChange,
  onJointChange,
  onClearanceChange,
  onApply,
  onCancel,
}: {
  targetName: string;
  axis: SplitAxis;
  offset: number;
  limit: number;
  joint: CutJoint;
  clearance: number;
  workspace: WorkplaneWorkspaceSettings;
  busy: boolean;
  onAxisChange: (axis: SplitAxis) => void;
  onOffsetChange: (offset: number) => void;
  onJointChange: (joint: CutJoint) => void;
  onClearanceChange: (clearance: number) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const span = Math.max(0.5, limit);
  const fitting = joint !== "none";
  return (
    <aside className="edge-modifier-panel" aria-label="Split">
      <div className="edge-modifier-header">
        <div>
          <strong>{fitting ? "Cut to fit" : "Split"}</strong>
          <span>{fitting ? "A joint on the cut, then both pieces on the bed" : "Two objects, cut on the line"}</span>
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
      <div className="shell-openings">
        <span>Joint</span>
        <div className="shell-opening-row">
          {JOINTS.map((entry) => (
            <button
              key={entry.joint}
              type="button"
              className={joint === entry.joint ? "active" : ""}
              aria-pressed={joint === entry.joint}
              disabled={busy}
              onClick={() => onJointChange(entry.joint)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      {fitting ? (
        <EdgeModifierSlider
          label="Clearance"
          value={clearance}
          min={0}
          max={1}
          step={0.05}
          workspace={workspace}
          length
          disabled={busy}
          onChange={onClearanceChange}
        />
      ) : null}
      <div className="edge-modifier-footer">
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={busy} onClick={onApply}>
          <Check size={17} />
          {fitting ? "Cut to fit" : "Split"}
        </button>
      </div>
    </aside>
  );
}
