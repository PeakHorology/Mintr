"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { LaserIcon, Printer3dIcon } from "@/components/icons";
import type { DesignKind, MachineChoice } from "@/lib/laserMachine";

const CHOICES: readonly { kind: DesignKind; title: string; detail: string }[] = [
  { kind: "print", title: "3D print", detail: "A part to print, built up layer by layer." },
  { kind: "laser", title: "Laser cut", detail: "Flat parts cut and engraved from a sheet." },
];

/** Asked when a new design starts, for people who have a laser. */
export function NewDesignChooser({
  machines,
  onChoose,
  onCancel,
}: {
  machines: MachineChoice;
  onChoose: (kind: DesignKind) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  // Someone with only a laser sees Laser cut first.
  const choices = machines === "laser" ? [...CHOICES].reverse() : CHOICES;
  return (
    <section className="dashboard-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="new-design-title" onPointerDown={onCancel}>
      <div className="dashboard-confirm-dialog new-design-dialog" onPointerDown={(event) => event.stopPropagation()}>
        <header>
          <strong id="new-design-title">What are you making?</strong>
          <button type="button" aria-label="Cancel new design" onClick={onCancel}>
            <X size={18} />
          </button>
        </header>
        <div className="new-design-choices">
          {choices.map((choice, index) => (
            <button key={choice.kind} type="button" className="new-design-choice" autoFocus={index === 0} onClick={() => onChoose(choice.kind)}>
              <span className="new-design-choice-icon">
                {choice.kind === "laser" ? <LaserIcon size={30} /> : <Printer3dIcon size={30} />}
              </span>
              <strong>{choice.title}</strong>
              <span>{choice.detail}</span>
            </button>
          ))}
        </div>
        <p className="new-design-note">A design stays the kind you choose. Settings → Machines sets what you make with.</p>
      </div>
    </section>
  );
}
