"use client";

import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { layerCount, suggestedSlices, type FlatPartsStyle } from "@/lib/laser/flatParts";

export type FlatPartsChoice = { style: FlatPartsStyle; across: number; along: number };

const MAX_SLICES = 40;

/** Make flat parts: stacked layers, or slices that slot together, from one 3D part. */
export function FlatPartsDialog({
  partName,
  size,
  thickness,
  sheetLabel,
  onCancel,
  onMake,
}: {
  partName: string;
  /** The part's size: left to right, front to back, and up. */
  size: { width: number; depth: number; height: number };
  thickness: number;
  /** "3 mm plywood", for the note. */
  sheetLabel: string;
  onCancel: () => void;
  onMake: (choice: FlatPartsChoice) => void;
}) {
  const longest = Math.max(size.width, size.depth);
  const [style, setStyle] = useState<FlatPartsStyle>("stack");
  const [drafts, setDrafts] = useState(() => ({
    across: String(suggestedSlices(size.width, longest, thickness)),
    along: String(suggestedSlices(size.depth, longest, thickness)),
  }));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  const across = Number.parseInt(drafts.across, 10);
  const along = Number.parseInt(drafts.along, 10);
  const layers = layerCount(size.height, thickness);
  const countsOk = [across, along].every((count) => Number.isInteger(count) && count >= 1 && count <= MAX_SLICES);
  const problem = style === "interlock" && !countsOk ? `Use 1 to ${MAX_SLICES} slices each way.` : null;
  const madeHeight = Number((layers * thickness).toFixed(2));
  const note = problem
    ?? (style === "stack"
      ? `${layers} layer${layers === 1 ? "" : "s"} of ${sheetLabel}, to glue one on another in order. ${madeHeight === Number(size.height.toFixed(2)) ? "" : `It comes out ${madeHeight} mm tall, a whole number of sheets. `}Each is named, bottom first.`
      : `${across + along} slices of ${sheetLabel} with slots halfway, so each across slice pushes down onto the along ones.`);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!problem) onMake({ style, across, along });
  };
  return (
    <div className="inline-value-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="inline-value-dialog box-maker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flat-parts-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header className="inline-value-dialog-header">
          <strong id="flat-parts-title">Make flat parts</strong>
          <button type="button" className="inline-value-dialog-close" aria-label="Close" onClick={onCancel}>
            <X size={16} strokeWidth={2.5} />
          </button>
        </header>
        <div className="inline-value-dialog-body">
          <p className="inline-value-dialog-note">
            Turns {partName}, {Number(size.width.toFixed(1))} × {Number(size.depth.toFixed(1))} × {Number(size.height.toFixed(1))} mm, into flat parts you can cut.
          </p>
          <div className="box-maker-toggles">
            <div role="radiogroup" aria-label="Kind of parts">
              {(["stack", "interlock"] as const).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={style === value} className={style === value ? "active" : ""} onClick={() => setStyle(value)}>
                  {value === "stack" ? "Stacked layers" : "Slotted slices"}
                </button>
              ))}
            </div>
          </div>
          {style === "interlock" ? (
            <div className="box-maker-fields">
              {([["across", "Slices across"], ["along", "Slices front to back"]] as const).map(([key, label], index) => (
                <label key={key} className="inline-value-dialog-field">
                  <span>{label}</span>
                  <span className="inline-value-dialog-input-wrap">
                    <input
                      autoFocus={index === 0}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_SLICES}
                      step={1}
                      value={drafts[key]}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setDrafts((current) => ({ ...current, [key]: value }));
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                    />
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          <p className="inline-value-dialog-note">{note}</p>
          <p className="inline-value-dialog-note">The 3D part is hidden, not deleted, so you can make it again another way.</p>
        </div>
        <footer className="inline-value-dialog-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={Boolean(problem)}>
            Make parts
          </button>
        </footer>
      </form>
    </div>
  );
}
