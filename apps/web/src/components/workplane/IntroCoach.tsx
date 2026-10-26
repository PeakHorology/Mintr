"use client";

import type { LessonPrompt } from "@/lib/introProject";

const STEP_LABELS = ["Box", "Sketch", "Cut"];

type IntroCoachProps = {
  prompt: LessonPrompt;
  note: string | null;
  onDismiss: () => void;
};

export function IntroCoach({ prompt, note, onDismiss }: IntroCoachProps) {
  return (
    <aside className="intro-coach" aria-live="polite" aria-label="Lesson">
      <header>
        <strong>{prompt.complete ? "Done" : `Step ${prompt.step} of ${prompt.total}`}</strong>
        <button type="button" aria-label="Close lesson" onClick={onDismiss}>
          Close
        </button>
      </header>
      <ol className="intro-coach-steps">
        {STEP_LABELS.map((label, index) => {
          const number = index + 1;
          const state = prompt.complete || number < prompt.step ? "is-done" : number === prompt.step ? "is-now" : "";
          return (
            <li key={label} className={state}>
              <span>{prompt.complete || number < prompt.step ? "✓" : number}</span>
              {label}
            </li>
          );
        })}
      </ol>
      <p className="intro-coach-title">{prompt.title}</p>
      <p>{prompt.body}</p>
      {note ? <p className="intro-coach-note">{note}</p> : null}
    </aside>
  );
}
