"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { displayToMillimeters, lengthDisplayUnit, millimetersToDisplay } from "@/lib/measurementUnits";
import {
  XRAY_AXES,
  XRAY_STEP,
  xrayKeptSide,
  type XrayAxis,
  type XraySpan,
} from "@/lib/xraySection";
import type { WorkplaneWorkspaceSettings } from "@/types/sketchforge";

export function XrayViewPanel({
  enabled,
  axis,
  position,
  keepLow,
  showPlane,
  bounds,
  workspace,
  onEnabledChange,
  onAxisChange,
  onPositionChange,
  onKeepLowChange,
  onShowPlaneChange,
  onClose,
}: {
  enabled: boolean;
  axis: XrayAxis;
  position: number;
  keepLow: boolean;
  showPlane: boolean;
  bounds: XraySpan;
  workspace: WorkplaneWorkspaceSettings;
  onEnabledChange: (enabled: boolean) => void;
  onAxisChange: (axis: XrayAxis) => void;
  onPositionChange: (position: number) => void;
  onKeepLowChange: (keepLow: boolean) => void;
  onShowPlaneChange: (showPlane: boolean) => void;
  onClose: () => void;
}) {
  const unit = lengthDisplayUnit(workspace);
  const shown = millimetersToDisplay(position, workspace);
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? shown.toFixed(workspace.accuracy);

  const commitPosition = () => {
    const typed = Number(display);
    setDraft(null);
    if (!Number.isFinite(typed)) return;
    onPositionChange(displayToMillimeters(typed, workspace));
  };

  return (
    <div id="xray-tool-popover" className="xray-tool-popover" aria-label="X-ray view">
      <header className="xray-view-header">
        <strong>X-ray view</strong>
        <button type="button" className="xray-view-close" aria-label="Close X-ray view" onClick={onClose}>
          <X size={14} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </header>
      <p className="xray-view-note">The part stays whole. Only this view is cut.</p>
      <button
        type="button"
        className={`xray-view-toggle${enabled ? " active" : ""}`}
        aria-pressed={enabled}
        onClick={() => onEnabledChange(!enabled)}
      >
        {enabled ? "X-ray on" : "X-ray off"}
      </button>
      <div className="xray-view-axes" role="group" aria-label="Cut direction">
        {XRAY_AXES.map((option) => (
          <button
            key={option.axis}
            type="button"
            className={axis === option.axis ? "active" : ""}
            aria-pressed={axis === option.axis}
            disabled={!enabled}
            onClick={() => onAxisChange(option.axis)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="xray-height-control">
        <span className="xray-height-label">{axis.toUpperCase()}</span>
        <input
          type="range"
          min={bounds.min}
          max={bounds.max}
          step={XRAY_STEP}
          value={Math.min(bounds.max, Math.max(bounds.min, position))}
          disabled={!enabled}
          aria-label={`${axis.toUpperCase()} cut position`}
          onChange={(event) => onPositionChange(Number(event.target.value))}
        />
      </label>
      <label className="xray-view-position">
        <span>Position</span>
        <input
          type="number"
          inputMode="decimal"
          step={10 ** -workspace.accuracy}
          value={display}
          disabled={!enabled}
          aria-label="Cut position"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitPosition}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitPosition();
            }
          }}
        />
        <span className="xray-view-unit">{unit.label}</span>
      </label>
      <div className="xray-view-actions">
        <button type="button" disabled={!enabled} onClick={() => onKeepLowChange(!keepLow)}>
          Other side
        </button>
        <button
          type="button"
          className={showPlane ? "active" : ""}
          aria-pressed={showPlane}
          disabled={!enabled}
          onClick={() => onShowPlaneChange(!showPlane)}
        >
          {showPlane ? "Hide plane" : "Show plane"}
        </button>
      </div>
      <p className="xray-view-side">{enabled ? xrayKeptSide(axis, keepLow) : "X-ray is off"}</p>
    </div>
  );
}
