"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { EdgeModifierSlider } from "@/components/workplane/EdgeModifierPanel";
import type { FaceDirection } from "@/lib/faceBody";
import type { WorkplaneWorkspaceSettings } from "@/types/sketchforge";

export function FacePanel({
  targetName,
  direction,
  inset,
  maxInset,
  cornerRadius,
  maxCornerRadius,
  depth,
  maxDepth,
  separate,
  joinThrough,
  depthHeld,
  faceChosen,
  keptCount,
  prepared,
  busy,
  error,
  notice,
  workspace,
  onDirectionChange,
  onInsetChange,
  onCornerRadiusChange,
  onDepthChange,
  onSeparateChange,
  onJoinThroughChange,
  onAnotherFace,
  onCreate,
  onCancel,
}: {
  targetName: string;
  direction: FaceDirection;
  inset: number;
  maxInset: number;
  cornerRadius: number;
  maxCornerRadius: number;
  depth: number;
  maxDepth: number;
  separate: boolean;
  joinThrough: boolean;
  /** Join through is driving these pockets, so Depth is not the stop. */
  depthHeld: boolean;
  faceChosen: boolean;
  keptCount: number;
  prepared: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  workspace: WorkplaneWorkspaceSettings;
  onDirectionChange: (direction: FaceDirection) => void;
  onInsetChange: (value: number) => void;
  onCornerRadiusChange: (value: number) => void;
  onDepthChange: (value: number) => void;
  onSeparateChange: (value: boolean) => void;
  onJoinThroughChange: (value: boolean) => void;
  onAnotherFace: () => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const locked = !prepared || busy;
  const hint = !prepared
    ? "Reading the solid"
    : faceChosen
      ? (keptCount > 0
        ? "These settings apply to every face you added."
        : direction === "out"
          ? "Out adds material. Inset 0 uses the whole face."
          : "In cuts a pocket no deeper than the body behind the face.")
      : keptCount > 0
        ? "Click the next flat face. It uses these same settings."
        : "Click a flat face. Out grows a pad. In cuts a pocket. A curved face does not work.";
  return (
    <aside className="edge-modifier-panel" aria-label="Pad/Pocket">
      <div className="edge-modifier-header">
        <div>
          <strong>Pad/Pocket</strong>
          <span>{hint}</span>
        </div>
        <button type="button" aria-label="Cancel Pad/Pocket" onClick={onCancel}><X size={20} /></button>
      </div>
      <div className="edge-modifier-target">
        <strong>{targetName}</strong>
        <span>
          {separate
            ? "Create adds this as its own body, selected, and leaves the original alone."
            : "Create groups the new sketch body with this one. Esc closes without applying."}
        </span>
      </div>
      <div className="shell-openings">
        <span>Direction</span>
        <div className="shell-opening-row">
          {(["out", "in"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={direction === value ? "active" : ""}
              aria-pressed={direction === value}
              data-lesson-target={value === "in" ? "pocket-in" : undefined}
              disabled={locked}
              onClick={() => onDirectionChange(value)}
            >
              {value === "out" ? "Out: add material" : "In: cut a pocket"}
            </button>
          ))}
        </div>
      </div>
      <EdgeModifierSlider
        label="Inset from the face's edge"
        value={inset}
        min={0}
        max={Math.max(0.2, maxInset)}
        step={0.1}
        workspace={workspace}
        length
        disabled={locked || !faceChosen}
        onChange={onInsetChange}
      />
      <EdgeModifierSlider
        label="Corner radius"
        value={cornerRadius}
        min={0}
        max={Math.max(0, maxCornerRadius)}
        step={0.1}
        workspace={workspace}
        length
        disabled={locked || !faceChosen}
        onChange={onCornerRadiusChange}
      />
      <EdgeModifierSlider
        label="Depth"
        value={depth}
        min={0.2}
        max={Math.max(0.2, maxDepth)}
        step={0.1}
        workspace={workspace}
        length
        disabled={locked || !faceChosen || depthHeld}
        onChange={onDepthChange}
      />
      <div className="shell-openings">
        <span>Between faces</span>
        <div className="shell-opening-row">
          <button
            type="button"
            className={joinThrough ? "" : "active"}
            aria-pressed={!joinThrough}
            disabled={locked}
            onClick={() => onJoinThroughChange(false)}
          >
            Leave column
          </button>
          <button
            type="button"
            className={joinThrough ? "active" : ""}
            aria-pressed={joinThrough}
            disabled={locked}
            onClick={() => onJoinThroughChange(true)}
          >
            Join through
          </button>
        </div>
      </div>
      <div className="edge-modifier-target">
        <span>
          {joinThrough
            ? "The pockets join. Pockets that share an edge open into each other, and opposite faces run through. The inset stays as the wall."
            : "Each pocket goes to its depth and stops one inset short of the far side, so the inset is the wall. The bar between two pockets stays."}
        </span>
      </div>
      <label className="edge-modifier-check">
        <input
          type="checkbox"
          checked={separate}
          disabled={locked}
          onChange={(event) => onSeparateChange(event.currentTarget.checked)}
        />
        <span>As a body of its own (not grouped)</span>
      </label>
      <div className="edge-modifier-footer">
        <button type="button" className="secondary" disabled={!faceChosen || locked} onClick={onAnotherFace}>Another face</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
      {notice ? <div className="edge-modifier-target"><span>{notice}</span></div> : null}
      {error ? <div className="edge-modifier-error" role="alert">{error}</div> : null}
      <div className="edge-modifier-footer">
        <button type="button" className="primary" data-lesson-target="create" disabled={locked || (!faceChosen && keptCount === 0) || Boolean(error)} onClick={onCreate}>
          {busy ? <LoaderCircle className="edge-modifier-spinner" size={17} /> : <Check size={17} />}
          Create
        </button>
      </div>
    </aside>
  );
}
