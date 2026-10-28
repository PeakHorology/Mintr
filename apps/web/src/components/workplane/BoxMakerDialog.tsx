"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { boxPanels, boxSpecProblem, layOutPanels, placedOutline, type BoxSpec } from "@/lib/laser/boxMaker";

type Drafts = { width: string; depth: string; height: string; finger: string };

const SIZE_FIELDS: readonly { key: keyof Drafts; label: string }[] = [
  { key: "width", label: "Width" },
  { key: "depth", label: "Depth" },
  { key: "height", label: "Height" },
];

/** Box maker: type a size, see the panels, and make them as parts. */
export function BoxMakerDialog({
  thickness,
  sheetLabel,
  onCancel,
  onMake,
}: {
  thickness: number;
  /** "3 mm plywood", for the note. */
  sheetLabel: string;
  onCancel: () => void;
  onMake: (spec: BoxSpec) => void;
}) {
  const [drafts, setDrafts] = useState<Drafts>(() => ({ width: "100", depth: "70", height: "50", finger: String(Number((thickness * 3).toFixed(1))) }));
  const [inside, setInside] = useState(false);
  const [lid, setLid] = useState(true);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  // Inside sizes grow by the walls: two sheets across, and one or two up.
  const spec = useMemo<BoxSpec>(() => {
    const read = (key: keyof Drafts) => Number.parseFloat(drafts[key]);
    const walls = inside ? 2 * thickness : 0;
    return {
      width: read("width") + walls,
      depth: read("depth") + walls,
      height: read("height") + (inside ? (lid ? 2 : 1) * thickness : 0),
      thickness,
      finger: read("finger"),
      lid,
    };
  }, [drafts, inside, lid, thickness]);
  const problem = boxSpecProblem(spec);
  const preview = useMemo(() => {
    if (problem) return null;
    const placed = layOutPanels(boxPanels(spec), { gap: 5 });
    const outlines = placed.map((panel) => ({ name: panel.name, points: placedOutline(panel), x: panel.x, z: panel.z }));
    const all = outlines.flatMap((outline) => outline.points);
    const minX = Math.min(...all.map(([x]) => x));
    const maxX = Math.max(...all.map(([x]) => x));
    const minZ = Math.min(...all.map(([, z]) => z));
    const maxZ = Math.max(...all.map(([, z]) => z));
    return { outlines, viewBox: `${minX - 2} ${minZ - 2} ${maxX - minX + 4} ${maxZ - minZ + 4}`, stroke: Math.max(maxX - minX, maxZ - minZ) / 260 };
  }, [problem, spec]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!problem) onMake(spec);
  };
  return (
    <div className="inline-value-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="inline-value-dialog box-maker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="box-maker-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header className="inline-value-dialog-header">
          <strong id="box-maker-title">Box maker</strong>
          <button type="button" className="inline-value-dialog-close" aria-label="Close box maker" onClick={onCancel}>
            <X size={16} strokeWidth={2.5} />
          </button>
        </header>
        <div className="inline-value-dialog-body">
        <div className="box-maker-toggles">
          <div role="radiogroup" aria-label="The size is">
            {[false, true].map((value) => (
              <button key={String(value)} type="button" role="radio" aria-checked={inside === value} className={inside === value ? "active" : ""} onClick={() => setInside(value)}>
                {value ? "Inside size" : "Outside size"}
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Lid">
            {[true, false].map((value) => (
              <button key={String(value)} type="button" role="radio" aria-checked={lid === value} className={lid === value ? "active" : ""} onClick={() => setLid(value)}>
                {value ? "With a lid" : "Open top"}
              </button>
            ))}
          </div>
        </div>
        <div className="box-maker-fields">
          {[...SIZE_FIELDS, { key: "finger" as const, label: "Finger width" }].map((field, index) => (
            <label key={field.key} className="inline-value-dialog-field">
              <span>{field.label}</span>
              <span className="inline-value-dialog-input-wrap">
              <input
                autoFocus={index === 0}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.5"
                value={drafts[field.key]}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDrafts((current) => ({ ...current, [field.key]: value }));
                }}
                onKeyDown={(event) => event.stopPropagation()}
              />
              <small>mm</small>
              </span>
            </label>
          ))}
        </div>
        <div className="box-maker-preview" aria-hidden="true">
          {preview ? (
            <svg viewBox={preview.viewBox} preserveAspectRatio="xMidYMid meet">
              {preview.outlines.map((outline) => (
                <g key={outline.name}>
                  <polygon points={outline.points.map(([x, z]) => `${x},${z}`).join(" ")} strokeWidth={preview.stroke} />
                  <text x={outline.x} y={outline.z} fontSize={preview.stroke * 11} textAnchor="middle" dominantBaseline="middle">{outline.name}</text>
                </g>
              ))}
            </svg>
          ) : (
            <p>{problem}</p>
          )}
        </div>
        <p className="inline-value-dialog-note">
          {problem
            ? `Cut from ${sheetLabel}.`
            : `${lid ? 6 : 5} panels from ${sheetLabel}, ${Number(spec.width.toFixed(1))} × ${Number(spec.depth.toFixed(1))} × ${Number(spec.height.toFixed(1))} mm outside. The kerf is allowed for when you save the cut file.`}
        </p>
        </div>
        <footer className="inline-value-dialog-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={Boolean(problem)}>
            Make box
          </button>
        </footer>
      </form>
    </div>
  );
}
