"use client";

import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { LASER_SEND_MODE_HINT, LASER_SEND_MODE_LABEL } from "@/lib/laser/sendToLaser";
import type { LaserSendMode } from "@/types/sketchforge";

export type SendToLaserChoice = {
  /** "new" for a new laser design, or the id of an existing one. */
  target: string;
  mode: LaserSendMode;
  across: number;
  along: number;
};

const MAX_SLICES = 40;
const MODES: LaserSendMode[] = ["outline", "stack", "interlock", "asis"];

/** Send to laser: which laser design the selected 3D parts go to, and how they become sheet parts. */
export function SendToLaserDialog({
  summary,
  laserDesigns,
  onCancel,
  onSend,
}: {
  /** "Lamp base" or "3 parts", for the note. */
  summary: string;
  /** crystal marks a K9 crystal design: a model goes inside the glass as it is, never cut flat. */
  laserDesigns: readonly { id: string; name: string; crystal?: boolean }[];
  onCancel: () => void;
  onSend: (choice: SendToLaserChoice) => void;
}) {
  const [target, setTarget] = useState("new");
  const [mode, setMode] = useState<LaserSendMode>("outline");
  const [drafts, setDrafts] = useState({ across: "4", along: "3" });
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
  const countsOk = [across, along].every((count) => Number.isInteger(count) && count >= 1 && count <= MAX_SLICES);
  const crystal = Boolean(laserDesigns.find((design) => design.id === target)?.crystal);
  const modes: LaserSendMode[] = crystal ? ["asis"] : MODES;
  const sendMode: LaserSendMode = crystal ? "asis" : mode;
  const problem = sendMode === "interlock" && !countsOk ? `Use 1 to ${MAX_SLICES} slices each way.` : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!problem) onSend({ target, mode: sendMode, across, along });
  };
  return (
    <div className="inline-value-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="inline-value-dialog box-maker-dialog send-to-laser-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-to-laser-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header className="inline-value-dialog-header">
          <strong id="send-to-laser-title">Send to laser</strong>
          <button type="button" className="inline-value-dialog-close" aria-label="Close" onClick={onCancel}>
            <X size={16} strokeWidth={2.5} />
          </button>
        </header>
        <div className="inline-value-dialog-body">
          <p className="inline-value-dialog-note">
            Brings {summary} into a laser design, made from the material set there. This design stays as it is.
          </p>
          <label className="inline-value-dialog-field">
            <span>Send to</span>
            <span className="inline-value-dialog-input-wrap">
              <select value={target} onChange={(event) => setTarget(event.currentTarget.value)} onKeyDown={(event) => event.stopPropagation()}>
                <option value="new">A new laser design</option>
                {laserDesigns.map((design) => (
                  <option key={design.id} value={design.id}>{design.name}</option>
                ))}
              </select>
            </span>
          </label>
          <div className="box-maker-toggles">
            <div role="radiogroup" aria-label="Make it as">
              {modes.map((value) => (
                <button key={value} type="button" role="radio" aria-checked={sendMode === value} className={sendMode === value ? "active" : ""} onClick={() => setMode(value)}>
                  {LASER_SEND_MODE_LABEL[value]}
                </button>
              ))}
            </div>
          </div>
          {sendMode === "interlock" ? (
            <div className="box-maker-fields">
              {([["across", "Slices across"], ["along", "Slices front to back"]] as const).map(([key, label]) => (
                <label key={key} className="inline-value-dialog-field">
                  <span>{label}</span>
                  <span className="inline-value-dialog-input-wrap">
                    <input
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
          <p className="inline-value-dialog-note">{problem ?? (crystal ? "A crystal is engraved inside the glass, so the model goes in as it is." : LASER_SEND_MODE_HINT[sendMode])}</p>
          <p className="inline-value-dialog-note">After you change the model, open the laser design and choose Update from model to bring the changes over.</p>
        </div>
        <footer className="inline-value-dialog-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={Boolean(problem)}>
            Send
          </button>
        </footer>
      </form>
    </div>
  );
}
