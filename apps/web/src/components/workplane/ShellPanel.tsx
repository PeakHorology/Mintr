"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { EdgeModifierSlider } from "@/components/workplane/EdgeModifierPanel";
import type { ShellCornerStyle } from "@/lib/cadShell";
import { SHELL_SIDES, type ShellSide } from "@/lib/shellLimits";
import type { WorkplaneWorkspaceSettings } from "@/types/sketchforge";

const SIDE_LABEL: Record<ShellSide, string> = {
  top: "Top",
  bottom: "Bottom",
  front: "Front",
  back: "Back",
  left: "Left",
  right: "Right",
};

export function ShellPanel({
  targetName,
  thickness,
  maxThickness,
  corners,
  cornerRadius,
  openings,
  workspace,
  busy,
  prepared,
  error,
  onThicknessChange,
  onCornersChange,
  onCornerRadiusChange,
  onOpeningsChange,
  onApply,
  onCancel,
}: {
  targetName: string;
  thickness: number;
  maxThickness: number;
  corners: ShellCornerStyle;
  cornerRadius: number;
  openings: ShellSide[];
  workspace: WorkplaneWorkspaceSettings;
  busy: boolean;
  prepared: boolean;
  error: string | null;
  onThicknessChange: (value: number) => void;
  onCornersChange: (value: ShellCornerStyle) => void;
  onCornerRadiusChange: (value: number) => void;
  onOpeningsChange: (value: ShellSide[]) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const toggle = (side: ShellSide) => {
    const next = openings.includes(side) ? openings.filter((item) => item !== side) : [...openings, side];
    onOpeningsChange(SHELL_SIDES.filter((item) => next.includes(item)));
  };
  return (
    <aside className="edge-modifier-panel" aria-label="Hollow">
      <div className="edge-modifier-header">
        <div>
          <strong>Hollow</strong>
          <span>{prepared ? "Walls grow inward" : "Preparing the solid"}</span>
        </div>
        <button type="button" aria-label="Cancel hollow" onClick={onCancel}><X size={20} /></button>
      </div>
      <div className="edge-modifier-target">
        <strong>{targetName}</strong>
        <span>The outside stays put. Leave a side open for a box, cup, or case, or close every side for a sealed cavity.</span>
      </div>
      <EdgeModifierSlider
        label="Wall thickness"
        value={thickness}
        min={0.2}
        max={Math.max(0.2, maxThickness)}
        step={0.1}
        workspace={workspace}
        length
        disabled={!prepared || busy}
        onChange={onThicknessChange}
      />
      <div className="shell-openings">
        <span>Inside corners</span>
        <div className="shell-opening-row">
          {(["sharp", "round"] as const).map((style) => (
            <button
              key={style}
              type="button"
              className={corners === style ? "active" : ""}
              aria-pressed={corners === style}
              disabled={!prepared || busy}
              onClick={() => onCornersChange(style)}
            >
              {style === "sharp" ? "Sharp" : "Rounded"}
            </button>
          ))}
        </div>
      </div>
      {corners === "round" ? (
        <EdgeModifierSlider
          label="Corner radius"
          value={cornerRadius}
          min={0.2}
          max={Math.max(0.2, thickness)}
          step={0.1}
          workspace={workspace}
          length
          disabled={!prepared || busy}
          onChange={onCornerRadiusChange}
        />
      ) : null}
      <div className="shell-openings">
        <span>Leave open</span>
        <div className="shell-opening-row">
          {SHELL_SIDES.map((side) => (
            <button
              key={side}
              type="button"
              className={openings.includes(side) ? "active" : ""}
              aria-pressed={openings.includes(side)}
              disabled={!prepared || busy}
              onClick={() => toggle(side)}
            >
              {SIDE_LABEL[side]}
            </button>
          ))}
        </div>
      </div>
      {error ? <div className="edge-modifier-error" role="alert">{error}</div> : null}
      <div className="edge-modifier-footer">
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={!prepared || busy || Boolean(error)} onClick={onApply}>
          {busy ? <LoaderCircle className="edge-modifier-spinner" size={17} /> : <Check size={17} />}
          Apply
        </button>
      </div>
    </aside>
  );
}
