"use client";

import { useState } from "react";
import { useForm, ValidationError } from "@formspree/react";
import { savedProblemReport } from "@/lib/problemReport";

const FORM_ID = "xdeaylbd";

export function HelpFeedbackForm({ version }: { version: string }) {
  const [session, setSession] = useState(0);
  return <HelpFeedbackFields key={session} version={version} onRestart={() => setSession((value) => value + 1)} />;
}

function HelpFeedbackFields({ version, onRestart }: { version: string; onRestart: () => void }) {
  const [kind, setKind] = useState<"feedback" | "problem">("feedback");
  const [crash, setCrash] = useState("");
  const [crashNote, setCrashNote] = useState("");
  const [state, handleSubmit] = useForm(FORM_ID);

  if (state.succeeded) {
    return (
      <div className="help-feedback-form" role="status">
        <p>Thanks. PeakCAD received your note. Your design was not included.</p>
        <button type="button" className="workspace-hotkey-reset" onClick={onRestart}>Send another</button>
      </div>
    );
  }

  return (
    <form className="help-feedback-form" onSubmit={handleSubmit}>
      <fieldset className="help-feedback-kind">
        <legend>What is this?</legend>
        <label>
          <input type="radio" name="kind" value="feedback" checked={kind === "feedback"} onChange={() => setKind("feedback")} />
          Feedback
        </label>
        <label>
          <input type="radio" name="kind" value="problem" checked={kind === "problem"} onChange={() => setKind("problem")} />
          A problem
        </label>
      </fieldset>

      <label className="help-feedback-field">
        <span>Email</span>
        <input type="email" name="email" required autoComplete="email" placeholder="you@example.com" />
        <ValidationError field="email" errors={state.errors} className="help-feedback-error" />
      </label>

      <label className="help-feedback-field">
        <span>{kind === "problem" ? "What happened?" : "Your note"}</span>
        <textarea name="message" required rows={5} placeholder={kind === "problem" ? "What were you doing when this happened?" : "What should Mintr do better?"} />
        <ValidationError field="message" errors={state.errors} className="help-feedback-error" />
      </label>

      {kind === "problem" ? (
        <label className="help-feedback-field">
          <span>Crash details</span>
          <textarea name="crash" rows={4} value={crash} onChange={(event) => setCrash(event.currentTarget.value)} placeholder="Optional. Your design is not included." />
          <button
            type="button"
            className="workspace-hotkey-reset"
            onClick={() => {
              void savedProblemReport().then((report) => {
                if (!report.trim()) {
                  setCrashNote("No crash report is saved on this computer.");
                  return;
                }
                setCrash(report);
                setCrashNote("Filled in from this computer. Your design is not in it.");
              });
            }}
          >
            Add the saved crash report
          </button>
          {crashNote ? <span className="help-feedback-note">{crashNote}</span> : null}
        </label>
      ) : null}

      <input type="hidden" name="version" value={version || "browser"} />
      <input type="hidden" name="_subject" value={kind === "problem" ? "Mintr problem" : "Mintr feedback"} />

      <ValidationError errors={state.errors} className="help-feedback-error" />

      <button type="submit" className="workspace-hotkey-reset help-feedback-send" disabled={state.submitting}>
        {state.submitting ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
