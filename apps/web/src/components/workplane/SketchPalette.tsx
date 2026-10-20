"use client";

import { CONSTRAINT_LABELS, type SketchDefinitionStatus, type SketchDoc } from "@/lib/sketch";

const STATUS_LABEL: Record<SketchDefinitionStatus, string> = {
  empty: "Empty sketch",
  "under-defined": "Still movable",
  "fully-defined": "Fully locked",
  "over-constrained": "Too many rules",
  unsolved: "Needs a fix",
};

export function SketchPalette({
  doc,
  status,
  dof,
  conflicts,
  selectedProfileCount,
  onPatchSettings,
  onRemoveConstraint,
  proEnabled,
}: {
  doc: SketchDoc;
  status: SketchDefinitionStatus;
  dof: number;
  conflicts: string[];
  selectedProfileCount: number;
  proEnabled: boolean;
  onPatchSettings: (patch: Partial<SketchDoc["settings"]>) => void;
  onRemoveConstraint: (constraintId: string) => void;
}) {
  if (!proEnabled) return null;
  return (
    <aside className="sketch-palette" aria-label="Sketch palette">
      <header className="sketch-palette-header">
        <strong>Sketch</strong>
        {proEnabled ? <span className={`sketch-palette-status status-${status}`}>{STATUS_LABEL[status]}</span> : null}
      </header>
      <div className="sketch-palette-meta">
        {proEnabled ? <span>{dof} still free to move</span> : null}
        <span>{selectedProfileCount > 0 ? "Closed shape — Extrude makes the solid" : "Draw a closed shape, then Extrude"}</span>
      </div>
      {proEnabled && conflicts.length ? (
        <ul className="sketch-palette-conflicts">
          {conflicts.map((conflict) => {
            const constraint = doc.constraints.find((entry) => entry.id === conflict);
            const label = constraint
              ? `${CONSTRAINT_LABELS[constraint.kind]} conflict`
              : conflict;
            return <li key={conflict}>{label}</li>;
          })}
        </ul>
      ) : null}
      <div className="sketch-palette-toggles">
        {proEnabled ? (
          <label>
            <input
              type="checkbox"
              checked={doc.settings.showConstraints}
              onChange={(event) => onPatchSettings({ showConstraints: event.target.checked })}
            />
            Constraints
          </label>
        ) : null}
        {proEnabled ? (
          <label>
            <input
              type="checkbox"
              checked={doc.settings.showDimensions}
              onChange={(event) => onPatchSettings({ showDimensions: event.target.checked })}
            />
            Dimensions
          </label>
        ) : null}
      </div>
      {proEnabled && doc.settings.showConstraints && doc.constraints.length > 0 ? (
        <section className="sketch-palette-list" aria-label="Constraints">
          <div className="sketch-palette-list-title">Constraints</div>
          <ul>
            {doc.constraints.map((constraint) => (
              <li key={constraint.id} className={constraint.suppressed ? "suppressed" : ""}>
                <span>{CONSTRAINT_LABELS[constraint.kind]}</span>
                <button type="button" onClick={() => onRemoveConstraint(constraint.id)} aria-label="Remove constraint">
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {proEnabled && doc.settings.showDimensions && doc.dimensions.length > 0 ? (
        <section className="sketch-palette-list" aria-label="Dimensions">
          <div className="sketch-palette-list-title">Dimensions</div>
          <ul>
            {doc.dimensions.map((dimension) => (
              <li key={dimension.id}>
                <span>
                  {dimension.kind} {dimension.value.toFixed(2)}
                  {dimension.driving ? "" : " (driven)"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}
