"use client";

import { PeakTipLabel } from "@/components/workplane/ToolNameTooltip";
import { settingSageKey } from "@/lib/settingGuides";

/** A switch row in Settings, with its tip on right-click and its Sage key. */
export function WorkspaceToggle({
  label,
  tip,
  checked,
  onChange,
}: {
  label: string;
  tip: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <PeakTipLabel data-sage-key={settingSageKey(tip)} label={tip} helpTitle={label} description={tip} className="workspace-toggle">
      <span>{label}</span>
      <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
    </PeakTipLabel>
  );
}

/** A drop-down row in Settings. */
export function WorkspaceSelect({
  label,
  tip,
  value,
  options,
  onChange,
}: {
  label: string;
  tip: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <PeakTipLabel data-sage-key={settingSageKey(tip)} label={tip} helpTitle={label} description={tip} className="workspace-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </PeakTipLabel>
  );
}
