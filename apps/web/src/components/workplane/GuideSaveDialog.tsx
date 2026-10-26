"use client";

import type { GuideStep } from "@/lib/mintrGuide";

export function GuideSaveDialog({
  title,
  author,
  steps,
  onTitle,
  onAuthor,
  onToggle,
  onCancel,
  onSave,
}: {
  title: string;
  author: string;
  steps: GuideStep[];
  onTitle: (title: string) => void;
  onAuthor: (author: string) => void;
  onToggle: (index: number) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <section className="dashboard-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="guide-save-title">
      <form
        className="dashboard-confirm-dialog guide-save-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <header>
          <strong id="guide-save-title">Save as guide</strong>
          <button type="button" aria-label="Cancel guide" onClick={onCancel}>
            Close
          </button>
        </header>
        <p>Checked steps are the tutorial. Color and name changes start unchecked. The file is a .mintrguide.</p>
        <label>
          <span>Title</span>
          <input aria-label="Guide title" maxLength={80} value={title} onChange={(event) => onTitle(event.currentTarget.value)} />
        </label>
        <label>
          <span>Your name</span>
          <input aria-label="Guide author" maxLength={80} value={author} onChange={(event) => onAuthor(event.currentTarget.value)} placeholder="Shown on the tutorial" />
        </label>
        <ul className="guide-save-steps">
          {steps.map((step, index) => (
            <li key={`${step.historyIndex}-${step.label}`}>
              <label>
                <input
                  type="checkbox"
                  checked={step.included}
                  onChange={() => onToggle(index)}
                />
                <span>{step.label}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="dashboard-confirm-actions">
          <button className="dashboard-confirm-cancel" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="dashboard-confirm-save" type="submit">
            Save guide
          </button>
        </div>
      </form>
    </section>
  );
}
