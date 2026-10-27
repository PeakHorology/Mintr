"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ToolbarSageIcon } from "@/components/icons";
import { SagePictureArt } from "@/components/workplane/SagePictures";
import { formatHotkeyBinding, loadHotkeyBindings } from "@/lib/hotkeys";
import type { SettingsSectionId } from "@/lib/settingGuides";
import { sageHitById, sageShortcut, searchSageGuides, type SageArea, type SageSearchHit } from "@/lib/sageGuides";
import { useSageEnabled } from "@/lib/sagePreference";

const AREA_LABEL: Record<SageArea, string> = {
  sketch: "In a sketch",
  workplane: "On the workplane",
  anywhere: "Anywhere",
  settings: "In Settings",
};

const SETTINGS_SUGGESTIONS = ["Fillet", "Sweep", "Theme", "Snap grid", "Printer"];

const whereOf = (hit: SageSearchHit) => hit.where ?? AREA_LABEL[hit.area];

/**
 * Sage's search: look up any tool or setting. On the dashboard it is a slim bar; in Settings it is
 * the Sage tab, where a setting's answer can jump straight to its tab.
 */
export function SageHomePanel({
  variant = "home",
  onShowSetting,
  focusId,
}: {
  variant?: "home" | "settings";
  onShowSetting?: (section: SettingsSectionId, settingId: string) => void;
  /** Open with this tool's or setting's answer, e.g. when picked from the search at the top of Settings. */
  focusId?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<SageSearchHit | null>(null);
  const [replay, setReplay] = useState(0);
  const enabled = useSageEnabled();

  useEffect(() => {
    const hit = focusId ? sageHitById(focusId) : null;
    if (!hit) return;
    setQuery(hit.guide.title);
    setPicked(hit);
    setReplay((count) => count + 1);
  }, [focusId]);
  const hits = useMemo(() => searchSageGuides(query), [query]);
  const sageKey = formatHotkeyBinding(loadHotkeyBindings().sage ?? []);
  // A single match answers straight away; with several, a click picks one.
  const answer = picked ?? (hits.length === 1 ? hits[0] : null);
  const shortcut = answer ? sageShortcut(answer.guide) : undefined;
  const inSettings = variant === "settings";

  const pick = (hit: SageSearchHit) => {
    setPicked(hit);
    setReplay((count) => count + 1);
  };

  const search = (
    <label className="sage-home-search">
      <Search size={15} aria-hidden="true" />
      <input
        type="search"
        value={query}
        placeholder={inSettings ? "Search a tool or setting" : "Search a tool, like Fillet"}
        aria-label="Ask Sage about a tool or setting"
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setPicked(null);
        }}
      />
    </label>
  );

  const card = (
    <div className={`sage-home-card${inSettings ? " is-settings" : ""}`}>
      {inSettings ? (
        search
      ) : (
        <div className="sage-home-bar">
          <span className="sage-home-owl" aria-hidden="true">
            <ToolbarSageIcon width={26} height={26} />
          </span>
          <div className="sage-home-intro-copy">
            <strong>Got a question about a tool? Sage is here to help.</strong>
            <span>
              Search here, or in a design click the Sage button
              {sageKey !== "None" ? <> (or press <kbd>{sageKey}</kbd>)</> : null} and hover a tool. Click it again to hide Sage.
            </span>
          </div>
          {search}
        </div>
      )}

      {query.trim() === "" ? (
        inSettings ? (
          <div className="sage-home-results" aria-label="Try asking about">
            {SETTINGS_SUGGESTIONS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setQuery(name);
                  const [first] = searchSageGuides(name);
                  if (first) pick(first);
                }}
              >
                <strong>{name}</strong>
              </button>
            ))}
          </div>
        ) : null
      ) : hits.length === 0 ? (
        <p className="sage-home-empty">Nothing matches that yet. Try a tool or setting name, like Fillet or Theme.</p>
      ) : hits.length > 1 ? (
        <ul className="sage-home-results" aria-label="What Sage found">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button type="button" className={answer?.id === hit.id ? "active" : undefined} onClick={() => pick(hit)}>
                <strong>{hit.guide.title}</strong>
                <span>{whereOf(hit)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {answer ? (
        <article className="sage-home-answer" aria-live="polite">
          {answer.guide.picture ? (
            <div className="sage-home-art">
              <SagePictureArt key={`${answer.id}-${replay}`} picture={answer.guide.picture} />
              <button type="button" onClick={() => setReplay((count) => count + 1)}>Play again</button>
            </div>
          ) : null}
          <div className="sage-home-answer-copy">
            <header>
              <strong>{answer.guide.title}</strong>
              <span className="sage-home-area">{whereOf(answer)}</span>
              {shortcut ? <kbd>{shortcut}</kbd> : null}
            </header>
            <p>{answer.guide.what}</p>
            <ol>
              {answer.guide.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            {inSettings && answer.section && onShowSetting ? (
              <button type="button" className="sage-home-show" onClick={() => onShowSetting(answer.section!, answer.id)}>
                Show me
              </button>
            ) : null}
          </div>
        </article>
      ) : null}
    </div>
  );

  if (inSettings) return card;
  if (!enabled) return null;
  return <section className="dashboard-home-section sage-home" aria-label="Sage">{card}</section>;
}

/**
 * The search across the top of Settings, on every tab. A setting jumps to its tab and lights up;
 * a tool opens its answer in the Sage tab.
 */
export function SageSettingsSearch({
  onPickSetting,
  onPickTool,
}: {
  onPickSetting: (section: SettingsSectionId, settingId: string) => void;
  onPickTool: (toolId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Already in Settings, so the guide for the Settings button itself would only send you in a circle.
  const hits = useMemo(() => searchSageGuides(query, 8).filter((hit) => hit.id !== "settings").slice(0, 7), [query]);

  const choose = (hit: SageSearchHit) => {
    setOpen(false);
    setQuery("");
    if (hit.section) onPickSetting(hit.section, hit.id);
    else onPickTool(hit.id);
  };

  return (
    <div
      ref={rootRef}
      className="workspace-sage-search"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label className="sage-home-search">
        <span className="workspace-sage-owl" aria-hidden="true">
          <ToolbarSageIcon width={18} height={18} />
        </span>
        <input
          type="search"
          value={query}
          placeholder="Ask Sage: find a setting or a tool"
          aria-label="Ask Sage to find a setting or a tool"
          aria-expanded={open && query.trim() !== ""}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && hits[0]) {
              event.preventDefault();
              choose(hits[0]);
            } else if (event.key === "Escape" && query) {
              // Clear the search first; a second Escape closes Settings as usual.
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
      </label>
      {open && query.trim() !== "" ? (
        <ul className="workspace-sage-results" role="listbox" aria-label="What Sage found">
          {hits.length === 0 ? (
            <li className="workspace-sage-empty">Nothing matches that yet.</li>
          ) : hits.map((hit) => (
            <li key={hit.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => choose(hit)}>
                <strong>{hit.guide.title}</strong>
                <span>{whereOf(hit)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
