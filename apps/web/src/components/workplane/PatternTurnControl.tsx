"use client";

import { useEffect, useState, type CSSProperties, type PointerEvent } from "react";
import { ThumbRangeInput } from "@/components/workplane/ThumbRangeInput";

/** Whole degrees from 0 to 359. */
function clampTurn(degrees: number) {
  if (!Number.isFinite(degrees)) return 0;
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** A 0–359° slider that turns a whole pattern, shared by the circular and linear panels. */
export function PatternTurnControl({
  label = "Turn pattern",
  value,
  disabled,
  onChange,
}: {
  label?: string;
  value: number;
  disabled?: boolean;
  onChange: (degrees: number) => void;
}) {
  const actualValue = clampTurn(value);
  const position = (actualValue / 359) * 100;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(actualValue));

  useEffect(() => {
    if (!editing) setDraft(String(actualValue));
  }, [actualValue, editing]);

  const commitDraft = () => {
    const next = Number(draft);
    onChange(clampTurn(Number.isFinite(next) ? next : actualValue));
    setEditing(false);
  };

  return (
    <label className="edge-modifier-field edge-modifier-slider range-property" style={{ "--slider-pos": `${position}%` } as CSSProperties}>
      <span className="range-property-header">
        <span className="range-property-name">{label}</span>
        <span className="range-value-control">
          <input
            type="number"
            min={0}
            max={359}
            step={1}
            value={editing ? draft : String(actualValue)}
            inputMode="numeric"
            disabled={disabled}
            onFocus={() => {
              setDraft(String(actualValue));
              setEditing(true);
            }}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setDraft(String(actualValue));
                setEditing(false);
                event.currentTarget.blur();
              }
            }}
          />
          <span className="range-value-unit">°</span>
        </span>
      </span>
      <div className="range-control">
        <ThumbRangeInput
          min={0}
          max={359}
          step={1}
          value={actualValue}
          disabled={disabled}
          onValueChange={(raw) => {
            const next = clampTurn(raw);
            onChange(next);
            setDraft(String(next));
          }}
        />
      </div>
    </label>
  );
}

/**
 * Pointer handler for a pattern panel: reports when one of its sliders is being dragged, so the
 * viewport can hide the original's move handles and size labels instead of swinging them about.
 */
export function slidersDragHandler(onSliderDragChange: ((active: boolean) => void) | undefined) {
  return (event: PointerEvent<HTMLElement>) => {
    if (!onSliderDragChange) return;
    const target = event.target as HTMLElement | null;
    if (!(target instanceof HTMLInputElement) || target.type !== "range") return;
    onSliderDragChange(true);
    const end = () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      onSliderDragChange(false);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
}
