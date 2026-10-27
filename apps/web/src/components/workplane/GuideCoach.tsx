"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { GuideAuthorBadge } from "@/components/GuideAuthorBadge";
import type { GuideAuthorColor, GuidePrompt } from "@/lib/mintrGuide";

export function GuideCoach({
  prompt,
  author,
  color,
  avatar,
  official = false,
  onDismiss,
}: {
  prompt: GuidePrompt;
  author: string;
  color?: GuideAuthorColor;
  avatar?: string;
  official?: boolean;
  onDismiss: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const checklist = prompt.checklist ?? [];
  return (
    <aside className="intro-coach" aria-live="polite" aria-label="Tutorial">
      <header>
        <strong>{prompt.complete ? "Done" : `Step ${prompt.step} of ${prompt.total}`}</strong>
        <button type="button" aria-label="Close tutorial" onClick={onDismiss}>
          Close
        </button>
      </header>
      {author ? (
        <p className="intro-coach-note">
          <GuideAuthorBadge author={author} color={color} avatar={avatar} official={official} size="sm" />
        </p>
      ) : null}
      {prompt.heading && !prompt.complete ? <p className="intro-coach-heading">{prompt.heading}</p> : null}
      <p className="intro-coach-title">{prompt.title}</p>
      <p>{prompt.body}</p>
      {prompt.tip && !prompt.complete ? <p className="guide-tip">Tip: {prompt.tip}</p> : null}
      {checklist.length > 1 ? (
        <>
          <button type="button" className="intro-coach-toggle" aria-expanded={showAll} onClick={() => setShowAll((open) => !open)}>
            {showAll ? "Hide steps" : "All steps"}
          </button>
          {showAll ? (
            <ol className="intro-coach-checklist">
              {checklist.map((name, index) => {
                const done = prompt.complete || index < prompt.step - 1;
                const current = !prompt.complete && index === prompt.step - 1;
                return (
                  <li key={`${index}-${name}`} className={done ? "is-done" : current ? "is-current" : undefined}>
                    <span aria-hidden="true">{done ? <Check size={12} strokeWidth={3} /> : index + 1}</span>
                    {name}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}
