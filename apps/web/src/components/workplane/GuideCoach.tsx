"use client";

import type { GuidePrompt } from "@/lib/mintrGuide";

export function GuideCoach({
  prompt,
  author,
  onDismiss,
}: {
  prompt: GuidePrompt;
  author: string;
  onDismiss: () => void;
}) {
  return (
    <aside className="intro-coach" aria-live="polite" aria-label="Tutorial">
      <header>
        <strong>{prompt.complete ? "Done" : `Step ${prompt.step} of ${prompt.total}`}</strong>
        <button type="button" aria-label="Close tutorial" onClick={onDismiss}>
          Close
        </button>
      </header>
      {author ? <p className="intro-coach-note">By {author}</p> : null}
      <p className="intro-coach-title">{prompt.title}</p>
      <p>{prompt.body}</p>
    </aside>
  );
}
