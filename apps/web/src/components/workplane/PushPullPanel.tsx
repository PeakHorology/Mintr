"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { EdgeModifierSlider } from "@/components/workplane/EdgeModifierPanel";
import type { WorkplaneWorkspaceSettings } from "@/types/sketchforge";

export function PushPullPanel({
  distance,
  maxDistance,
  workspace,
  targetName,
  busy,
  prepared,
  error,
  onDistanceChange,
  onApply,
  onCancel,
}: {
  distance: number;
  maxDistance: number;
  workspace: WorkplaneWorkspaceSettings;
  targetName: string;
  busy: boolean;
  prepared: boolean;
  error: string | null;
  onDistanceChange: (value: number) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const limit = Math.max(1, maxDistance);
  return (
    <aside className="edge-modifier-panel" aria-label="Push Pull">
      <div className="edge-modifier-header">
        <div>
          <strong>Push Pull</strong>
          <span>{prepared ? "Drag a face, then Apply" : "Preparing faces…"}</span>
        </div>
        <button type="button" aria-label="Cancel Push Pull" onClick={onCancel}><X size={20} /></button>
      </div>

      <div className="edge-modifier-target">
        <strong>{targetName}</strong>
        <span>Exact CAD body</span>
      </div>

      <div className="edge-modifier-selection-help">
        {prepared
          ? "Drag a highlighted face, or type a distance. Click Apply to keep the change."
          : "Loading flat faces from the CAD engine."}
      </div>

      <EdgeModifierSlider
        label="Distance"
        value={distance}
        min={-limit}
        max={limit}
        step={0.1}
        workspace={workspace}
        length
        disabled={!prepared || busy}
        onChange={onDistanceChange}
      />

      {error ? <div className="edge-modifier-error" role="alert">{error}</div> : null}
      <div className="edge-modifier-footer">
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" data-lesson-target="push-pull-apply" disabled={!prepared || busy || Math.abs(distance) < 0.05 || Boolean(error)} onClick={onApply}>
          {busy ? <LoaderCircle className="edge-modifier-spinner" size={17} /> : <Check size={17} />}
          Apply
        </button>
      </div>
    </aside>
  );
}
