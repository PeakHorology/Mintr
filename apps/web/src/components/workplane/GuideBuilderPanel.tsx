"use client";

import { Eye, ImagePlus, LoaderCircle, Pencil, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { GuideAuthorBadge } from "@/components/GuideAuthorBadge";
import type { EditorHistoryEntry } from "@/lib/editorHistory";
import { readFileAsDataUrl, shrinkPicture, type GuideAuthorIdentity } from "@/lib/guideAuthoring";
import {
  GUIDE_AUTHOR_COLORS,
  describeGuideStep,
  guideLessonGroups,
  guideMinutes,
  guideStepDefaultReason,
  type GuideAuthorColor,
  type GuideStep,
} from "@/lib/mintrGuide";

export type GuideBuilderDraft = {
  title: string;
  summary: string;
  steps: GuideStep[];
  identity: GuideAuthorIdentity;
  /** Why Save did not go ahead, shown in the panel. */
  issue: string | null;
  saving: boolean;
  saved: { path: string | null } | null;
};

const COLOR_LABEL: Record<GuideAuthorColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
};

type StepStatus = { label: string; number: number | null; leader: boolean; folded: boolean };

/**
 * "Make a guide": the author's storyboard. Every history step is a card that says what it is and
 * what the learner will be told; clicking a card shows that moment in the 3D view.
 */
export function GuideBuilderPanel({
  draft,
  history,
  startsPartWay,
  previewIndex,
  onChange,
  onStepChange,
  onPreview,
  onCancel,
  onSave,
  onShowInFolder,
  editingExisting = false,
  onStartFresh,
}: {
  draft: GuideBuilderDraft;
  history: readonly EditorHistoryEntry[];
  /** The undo history does not go back to an empty scene, so the guide starts part-way through. */
  startsPartWay: boolean;
  previewIndex: number | null;
  onChange: (patch: Partial<GuideBuilderDraft>) => void;
  onStepChange: (index: number, patch: Partial<GuideStep>) => void;
  onPreview: (historyIndex: number | null) => void;
  onCancel: () => void;
  onSave: () => void;
  onShowInFolder?: (path: string) => void;
  /** The panel reopened this design's earlier guide; saving updates that guide's card. */
  editingExisting?: boolean;
  /** Make a separate guide from this design instead, starting from fresh choices. */
  onStartFresh?: () => void;
}) {
  const [editing, setEditing] = useState<Set<number>>(() => new Set());
  const [rehearse, setRehearse] = useState<number | null>(null);
  const [pictureIssue, setPictureIssue] = useState<string | null>(null);
  const pictureInput = useRef<HTMLInputElement | null>(null);
  const { steps, identity } = draft;

  const guide = useMemo(() => ({ title: draft.title, author: identity.name, summary: draft.summary, steps }), [draft.title, draft.summary, identity.name, steps]);
  const groups = useMemo(() => guideLessonGroups(guide, history), [guide, history]);
  const minutes = useMemo(() => guideMinutes(guide, history), [guide, history]);
  const described = useMemo(() => steps.map((step) => describeGuideStep(step, history, steps)), [history, steps]);

  // Each row's place in the lesson: its own step, part of one, skipped, or not a learner step at all.
  const statuses = useMemo(() => {
    const groupOf = new Map<number, { number: number; leader: boolean }>();
    groups.forEach((group, index) => group.forEach((step, member) => groupOf.set(step.historyIndex, { number: index + 1, leader: member === 0 })));
    let last = 0;
    return steps.map((step): StepStatus => {
      if (!step.included) return { label: "Skipped", number: null, leader: false, folded: false };
      const place = groupOf.get(step.historyIndex);
      if (place) {
        last = place.number;
        return place.leader
          ? { label: `Step ${place.number}`, number: place.number, leader: true, folded: false }
          : { label: `Part of step ${place.number}`, number: place.number, leader: false, folded: true };
      }
      if (step.fold && last > 0) return { label: `Part of step ${last}`, number: last, leader: false, folded: true };
      return { label: "Not a step", number: null, leader: false, folded: false };
    });
  }, [groups, steps]);

  const choosePicture = async (file: File | undefined) => {
    if (!file) return;
    setPictureIssue(null);
    try {
      const avatar = await shrinkPicture(await readFileAsDataUrl(file), 96, 96, "cover");
      onChange({ identity: { ...identity, avatar } });
    } catch (error) {
      setPictureIssue(error instanceof Error ? error.message : "Could not read that picture.");
    }
  };

  const showRehearsal = (index: number) => {
    const clamped = Math.max(0, Math.min(groups.length - 1, index));
    setRehearse(clamped);
    const group = groups[clamped];
    onPreview(group ? group[group.length - 1].historyIndex : null);
  };

  if (draft.saved) {
    return (
      <aside className="guide-builder" aria-label="Make a guide">
        <header className="guide-builder-header">
          <strong>Guide saved</strong>
          <button type="button" aria-label="Close" onClick={onCancel}><X size={18} /></button>
        </header>
        <div className="guide-builder-body guide-builder-saved">
          <h3>{draft.title}</h3>
          <GuideAuthorBadge author={identity.name} color={identity.color} avatar={identity.avatar} />
          <p>
            {groups.length} {groups.length === 1 ? "step" : "steps"} · about {minutes} min.{" "}
            {draft.saved.path ? "It is on the home page under Tutorials." : "The file was downloaded. Open it to start the tutorial."}
          </p>
          <div className="guide-builder-actions">
            {draft.saved.path && onShowInFolder ? (
              <button type="button" onClick={() => onShowInFolder(draft.saved!.path!)}>Show in folder</button>
            ) : null}
            <button type="button" className="primary" onClick={onCancel}>Done</button>
          </div>
        </div>
      </aside>
    );
  }

  if (rehearse !== null && groups[rehearse]) {
    const group = groups[rehearse];
    const lead = described[steps.indexOf(group[0])];
    const tips = group.map((step) => step.tip?.trim()).filter(Boolean);
    return (
      <aside className="guide-builder" aria-label="Preview as learner">
        <header className="guide-builder-header">
          <strong>Preview as learner</strong>
          <button type="button" aria-label="Back to editing" onClick={() => { setRehearse(null); onPreview(null); }}><X size={18} /></button>
        </header>
        <div className="guide-builder-body">
          <p className="guide-builder-note">This is what the learner reads. The 3D view shows the part when the step is done.</p>
          <div className="guide-rehearsal">
            <div className="guide-rehearsal-top">
              <strong>Step {rehearse + 1} of {groups.length}</strong>
              <GuideAuthorBadge author={identity.name} color={identity.color} avatar={identity.avatar} size="sm" />
            </div>
            <p className="guide-rehearsal-title">{group[0].name?.trim() || lead.title}</p>
            {group.map((step) => (
              <p key={step.historyIndex}>{described[steps.indexOf(step)].body}</p>
            ))}
            {tips.length ? <p className="guide-tip">Tip: {tips.join(" ")}</p> : null}
          </div>
          <div className="guide-builder-actions">
            <button type="button" disabled={rehearse === 0} onClick={() => showRehearsal(rehearse - 1)}>Back</button>
            {rehearse < groups.length - 1 ? (
              <button type="button" className="primary" onClick={() => showRehearsal(rehearse + 1)}>Next step</button>
            ) : (
              <button type="button" className="primary" onClick={() => { setRehearse(null); onPreview(null); }}>Back to editing</button>
            )}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="guide-builder" aria-label="Make a guide">
      <header className="guide-builder-header">
        <strong>Make a guide</strong>
        <button type="button" aria-label="Close guide maker" onClick={onCancel}><X size={18} /></button>
      </header>

      <div className="guide-builder-body">
        <p className="guide-builder-note">
          A guide walks someone through building this part, one step at a time. Keep the steps worth learning, fold small
          ones together, and skip the rest. Click a step to see it in 3D.
        </p>
        {editingExisting && onStartFresh ? (
          <p className="guide-builder-note">
            You are editing the guide you made from this design. Saving updates it.{" "}
            <button type="button" className="guide-link-button" onClick={onStartFresh}>Start a new guide instead</button>
          </p>
        ) : null}

        <label className="guide-field">
          <span>Title</span>
          <input maxLength={80} value={draft.title} onChange={(event) => onChange({ title: event.currentTarget.value, issue: null })} />
        </label>
        <label className="guide-field">
          <span>What it teaches</span>
          <textarea
            maxLength={280}
            rows={2}
            value={draft.summary}
            placeholder="A coaster with rounded edges and a pocket for a cup."
            onChange={(event) => onChange({ summary: event.currentTarget.value })}
          />
        </label>

        <fieldset className="guide-author-fields">
          <legend>You</legend>
          <div className="guide-author-row">
            <button
              type="button"
              className="guide-author-picture-button"
              aria-label={identity.avatar ? "Change your picture" : "Add a picture"}
              onClick={() => pictureInput.current?.click()}
            >
              {identity.avatar ? <img src={identity.avatar} alt="" /> : <ImagePlus size={20} aria-hidden="true" />}
            </button>
            <input
              ref={pictureInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                void choosePicture(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <input
              className="guide-author-name-input"
              aria-label="Your name"
              maxLength={60}
              value={identity.name}
              placeholder="Your name (shown on the guide)"
              onChange={(event) => onChange({ identity: { ...identity, name: event.currentTarget.value }, issue: null })}
            />
          </div>
          <div className="guide-colors" role="radiogroup" aria-label="Name colour">
            {GUIDE_AUTHOR_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={identity.color === color}
                aria-label={COLOR_LABEL[color]}
                className={`guide-color guide-color-${color}${identity.color === color ? " is-picked" : ""}`}
                onClick={() => onChange({ identity: { ...identity, color } })}
              />
            ))}
            {identity.avatar ? (
              <button type="button" className="guide-link-button" onClick={() => onChange({ identity: { ...identity, avatar: undefined } })}>
                Remove picture
              </button>
            ) : null}
          </div>
          {pictureIssue ? <p className="guide-issue">{pictureIssue}</p> : null}
          <div className="guide-author-preview">
            <span>On the home page:</span>
            <GuideAuthorBadge author={identity.name} color={identity.color} avatar={identity.avatar} />
          </div>
        </fieldset>

        {startsPartWay ? (
          <p className="guide-warning">
            The undo history starts part-way through this design, so the guide begins from the model as it was then. To
            teach it from scratch, build it again in a new design.
          </p>
        ) : null}

        <div className="guide-steps-heading">
          <strong>Steps</strong>
          <span>{groups.length} for the learner · about {minutes} min</span>
        </div>
        <ol className="guide-cards">
          {steps.map((step, index) => {
            const status = statuses[index];
            const about = described[index];
            const reason = guideStepDefaultReason(step, history);
            const open = editing.has(step.historyIndex);
            const canFold = step.included && steps.slice(0, index).some((earlier, earlierIndex) => earlier.included && statuses[earlierIndex].number !== null);
            return (
              <li
                key={step.historyIndex}
                className={`guide-card${step.included ? "" : " is-skipped"}${status.folded ? " is-folded" : ""}${previewIndex === step.historyIndex ? " is-previewing" : ""}`}
              >
                <button type="button" className="guide-card-head" onClick={() => onPreview(previewIndex === step.historyIndex ? null : step.historyIndex)}>
                  <span className={`guide-card-status${status.leader ? " is-step" : ""}`}>{status.label}</span>
                  <strong>{step.name?.trim() || about.title}</strong>
                  <Eye size={15} aria-hidden="true" />
                </button>
                {step.included ? (
                  <p className="guide-card-learner"><span>The learner will see:</span> {about.body}</p>
                ) : null}
                {step.tip?.trim() && step.included ? <p className="guide-tip">Tip: {step.tip.trim()}</p> : null}
                {reason && (!step.included || step.fold) ? <p className="guide-card-reason">{reason}</p> : null}
                <div className="guide-card-actions">
                  <label>
                    <input type="checkbox" checked={step.included} onChange={(event) => onStepChange(index, { included: event.currentTarget.checked })} />
                    Keep
                  </label>
                  {canFold ? (
                    <label>
                      <input type="checkbox" checked={Boolean(step.fold)} onChange={(event) => onStepChange(index, { fold: event.currentTarget.checked })} />
                      Fold into the step above
                    </label>
                  ) : null}
                  {step.included ? (
                    <button
                      type="button"
                      className="guide-link-button"
                      onClick={() => setEditing((current) => {
                        const next = new Set(current);
                        if (next.has(step.historyIndex)) next.delete(step.historyIndex);
                        else next.add(step.historyIndex);
                        return next;
                      })}
                    >
                      <Pencil size={13} aria-hidden="true" /> {open ? "Done" : "Rename or add a tip"}
                    </button>
                  ) : null}
                </div>
                {open && step.included ? (
                  <div className="guide-card-edit">
                    <input
                      aria-label="Step name"
                      maxLength={80}
                      value={step.name ?? ""}
                      placeholder={about.title}
                      onChange={(event) => onStepChange(index, { name: event.currentTarget.value })}
                    />
                    <input
                      aria-label="Tip for the learner"
                      maxLength={240}
                      value={step.tip ?? ""}
                      placeholder="A tip for the learner (optional)"
                      onChange={(event) => onStepChange(index, { tip: event.currentTarget.value })}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      <footer className="guide-builder-footer">
        {draft.issue ? <p className="guide-issue" role="alert">{draft.issue}</p> : null}
        <div className="guide-builder-actions">
          <button type="button" disabled={!groups.length} onClick={() => showRehearsal(0)}>Preview as learner</button>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" disabled={draft.saving} onClick={onSave}>
            {draft.saving ? <LoaderCircle className="edge-modifier-spinner" size={15} aria-hidden="true" /> : null}
            Save guide
          </button>
        </div>
      </footer>
    </aside>
  );
}
