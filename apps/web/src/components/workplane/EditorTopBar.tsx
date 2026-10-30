"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ToolbarSageIcon, ToolbarSettingsIcon } from "@/components/icons";
import { FullscreenButton } from "@/components/workplane/FullscreenButton";
import { useSageActive, useSageToggle } from "@/components/workplane/Sage";
import { useSageEnabled } from "@/lib/sagePreference";
import { PeakTipButton, PeakTooltip, usePeakContextHelp, usePeakTooltip } from "@/components/workplane/ToolNameTooltip";
import { TOOL_DESCRIPTIONS } from "@/lib/toolDescriptions";

type ToolbarMode = "geometry" | "sketch";
type SketchFocusMode = "2d" | "3d";

const MAX_PROJECT_NAME_LENGTH = 80;
const DEFAULT_PROJECT_NAME = "Untitled design";

function SageSection() {
  const active = useSageActive();
  const toggle = useSageToggle();
  if (!useSageEnabled()) return null;
  return (
    <div className="editor-file-group" aria-label="Sage">
      <div className="toolbar-section-label">Sage</div>
      <div className="toolbar-section-tools">
        <PeakTipButton
          className={`toolbar-icon sage-tool${active ? " active" : ""}`}
          label="Sage"
          description="Hover a button to read what it does. A click still runs the tool. Right-click still shows the short note."
          aria-pressed={active}
          onClick={toggle}
        >
          <ToolbarSageIcon />
        </PeakTipButton>
      </div>
    </div>
  );
}

export function EditorModeTabs({
  toolbarMode,
  onToolbarModeChange,
}: {
  toolbarMode: ToolbarMode;
  onToolbarModeChange: (mode: ToolbarMode) => void;
}) {
  const geometryHelp = usePeakContextHelp("Geometry", TOOL_DESCRIPTIONS.geometryMode);
  const sketchHelp = usePeakContextHelp("Sketch", TOOL_DESCRIPTIONS.sketchMode);

  return (
    <div className="editor-mode-tabs" data-mode={toolbarMode} role="tablist" aria-label="Editor mode">
      <div className="editor-mode-tabs-pill" aria-hidden="true" />
      <button
        className={toolbarMode === "geometry" ? "active" : ""}
        type="button"
        role="tab"
        aria-selected={toolbarMode === "geometry"}
        data-lesson-target="geometry"
        data-sage-label="Geometry"
        onClick={() => onToolbarModeChange("geometry")}
        onContextMenu={geometryHelp.onContextMenu}
      >
        Geometry
        {geometryHelp.helpPortal}
      </button>
      <button
        className={toolbarMode === "sketch" ? "active" : ""}
        type="button"
        role="tab"
        aria-selected={toolbarMode === "sketch"}
        data-lesson-target="sketch"
        data-sage-label="Sketch"
        onClick={() => onToolbarModeChange("sketch")}
        onContextMenu={sketchHelp.onContextMenu}
      >
        Sketch
        {sketchHelp.helpPortal}
      </button>
    </div>
  );
}

export function SketchFocusTabs({
  focusMode,
  onFocusModeChange,
  onReframe3d,
}: {
  focusMode: SketchFocusMode;
  onFocusModeChange: (mode: SketchFocusMode) => void;
  onReframe3d?: () => void;
}) {
  const flatHelp = usePeakContextHelp("Flat sketch", TOOL_DESCRIPTIONS.flatSketch);
  const sketch3dHelp = usePeakContextHelp("View in 3D", TOOL_DESCRIPTIONS.sketch3dView);

  return (
    <div className="editor-mode-tabs editor-mode-tabs--focus" data-mode={focusMode} role="tablist" aria-label="Sketch view">
      <div className="editor-mode-tabs-pill" aria-hidden="true" />
      <button
        className={focusMode === "2d" ? "active" : ""}
        type="button"
        role="tab"
        aria-selected={focusMode === "2d"}
        data-sage-label="Flat sketch"
        onClick={() => onFocusModeChange("2d")}
        onContextMenu={flatHelp.onContextMenu}
      >
        Flat sketch
        {flatHelp.helpPortal}
      </button>
      <button
        className={focusMode === "3d" ? "active" : ""}
        type="button"
        role="tab"
        aria-selected={focusMode === "3d"}
        onClick={() => {
          if (focusMode === "3d") {
            onReframe3d?.();
            return;
          }
          onFocusModeChange("3d");
        }}
        data-sage-label="View in 3D"
        onContextMenu={sketch3dHelp.onContextMenu}
      >
        View in 3D
        {sketch3dHelp.helpPortal}
      </button>
    </div>
  );
}

function EditorProjectTitle({
  projectName,
  onProjectNameChange,
}: {
  projectName: string;
  onProjectNameChange?: (name: string) => void;
}) {
  const displayName = projectName.trim() || DEFAULT_PROJECT_NAME;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const { open: tipOpen, tooltipProps, hide: hideTip } = usePeakTooltip();
  const canRename = Boolean(onProjectNameChange);

  useEffect(() => {
    if (!editing) {
      setDraft(displayName);
    }
  }, [displayName, editing]);

  useEffect(() => {
    if (!editing) {
      return;
    }
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, [editing]);

  const commit = () => {
    const next = draft.replace(/\s+/g, " ").trim().slice(0, MAX_PROJECT_NAME_LENGTH);
    setEditing(false);
    if (!next) {
      setDraft(displayName);
      return;
    }
    setDraft(next);
    if (next !== displayName) {
      onProjectNameChange?.(next);
    }
  };

  const cancel = () => {
    setDraft(displayName);
    setEditing(false);
  };

  if (!canRename) {
    return (
      <span className="editor-project-title is-static" title={displayName}>
        <span className="editor-project-title-text">{displayName}</span>
      </span>
    );
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        id={inputId}
        className="editor-project-title-input"
        type="text"
        value={draft}
        maxLength={MAX_PROJECT_NAME_LENGTH}
        spellCheck={false}
        aria-label="Project name"
        onChange={(event) => setDraft(event.currentTarget.value.slice(0, MAX_PROJECT_NAME_LENGTH))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      className="editor-project-title"
      aria-label={`Rename project (${displayName})`}
      {...tooltipProps}
      onClick={() => {
        hideTip();
        setDraft(displayName);
        setEditing(true);
      }}
    >
      <span className="editor-project-title-text">{displayName}</span>
      <PeakTooltip label="Rename project" open={tipOpen} anchorRef={buttonRef} />
    </button>
  );
}

export function EditorTopBar({
  projectName,
  onProjectNameChange,
  onHome,
  onImport,
  onSaveProject,
  onSaveProjectAs,
  onSaveAsGuide,
  hasMatchingSavedFile = false,
  onExport,
  toolbarMode,
  onToolbarModeChange,
  leftTools,
  rightTools,
  chromeBusy = null,
}: {
  projectName?: string;
  onProjectNameChange?: (name: string) => void;
  onHome?: () => void;
  onImport: () => void;
  onSaveProject?: () => void;
  onSaveProjectAs?: () => void;
  onSaveAsGuide?: () => void;
  hasMatchingSavedFile?: boolean;
  onExport: () => void;
  toolbarMode: ToolbarMode;
  onToolbarModeChange: (mode: ToolbarMode) => void;
  leftTools?: ReactNode;
  rightTools?: ReactNode;
  chromeBusy?: { progress?: number | null } | null;
}) {
  const logo = <img className="peakcad-logo" src="assets/mintr/mintr-square.png" alt="Mintr" draggable={false} />;
  const homeRef = useRef<HTMLButtonElement>(null);
  const { open: homeTipOpen, tooltipProps: homeTipProps, hide: hideHomeTip } = usePeakTooltip();
  const homeHelp = usePeakContextHelp("Home", TOOL_DESCRIPTIONS.home);

  return (
    <header className="editor-top-bar">
      <div className="editor-top-bar-left">
        {onHome ? (
          <button
            ref={homeRef}
            className="editor-top-bar-logo"
            type="button"
            aria-label="Home dashboard"
            data-sage-key="home"
            data-sage-label="Home"
            onClick={onHome}
            {...homeTipProps}
            onContextMenu={(event) => {
              hideHomeTip();
              homeHelp.onContextMenu(event);
            }}
          >
            {logo}
            <PeakTooltip label="Home" open={homeTipOpen} anchorRef={homeRef} />
            {homeHelp.helpPortal}
          </button>
        ) : (
          <div className="editor-top-bar-logo static" aria-hidden="true">
            {logo}
          </div>
        )}
        <SageSection />
        <div className="editor-file-group" aria-label="File">
          <div className="toolbar-section-label">File</div>
          <div className="toolbar-section-tools">
            <PeakTipButton className="editor-file-action" label="Import…" description={TOOL_DESCRIPTIONS.import} data-toolbar-tool="Import" onClick={onImport}>
              Import…
            </PeakTipButton>
            {hasMatchingSavedFile && onSaveProject ? (
              <PeakTipButton className="editor-file-action" label="Save" description={TOOL_DESCRIPTIONS.saveProject} shortcut="Ctrl + S" onClick={onSaveProject}>
                Save
              </PeakTipButton>
            ) : null}
            {!hasMatchingSavedFile && onSaveProjectAs ? (
              <PeakTipButton className="editor-file-action" label="Save as…" description={TOOL_DESCRIPTIONS.saveProjectAs} shortcut="Ctrl + Shift + S" onClick={onSaveProjectAs}>
                Save as…
              </PeakTipButton>
            ) : null}
            {onSaveAsGuide ? (
              <PeakTipButton className="editor-file-action" label="Make a guide…" description={TOOL_DESCRIPTIONS.saveAsGuide} onClick={onSaveAsGuide}>
                Make a guide…
              </PeakTipButton>
            ) : null}
            <PeakTipButton className="editor-file-action" label="Export…" description={TOOL_DESCRIPTIONS.export} shortcut="Ctrl + E" data-toolbar-tool="Export" data-lesson-target="export" onClick={onExport}>
              Export…
            </PeakTipButton>
          </div>
        </div>
        {leftTools ? <div className="editor-top-bar-tools editor-top-bar-tools--edit">{leftTools}</div> : null}
      </div>

      <div className="editor-top-bar-title">
        <EditorProjectTitle
          projectName={projectName ?? DEFAULT_PROJECT_NAME}
          onProjectNameChange={onProjectNameChange}
        />
      </div>

      <div className="editor-mode-notch">
        <EditorModeTabs toolbarMode={toolbarMode} onToolbarModeChange={onToolbarModeChange} />
      </div>

      <div className="editor-top-bar-right">
        {rightTools ? <div className="editor-top-bar-tools editor-top-bar-tools--modify">{rightTools}</div> : null}
        <div className="editor-file-group" aria-label="Settings">
          <div className="toolbar-section-label">Settings</div>
          <div className="toolbar-section-tools">
            <FullscreenButton />
            <PeakTipButton
              className="toolbar-icon"
              label="Settings"
              description={TOOL_DESCRIPTIONS.settings}
              shortcut="Ctrl + ,"
              onClick={() => window.dispatchEvent(new Event("sketchforge:open-workspace-settings"))}
            >
              <ToolbarSettingsIcon />
            </PeakTipButton>
          </div>
        </div>
      </div>
      {chromeBusy ? (
        <div
          className="editor-chrome-progress"
          role="progressbar"
          aria-label="Working"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={typeof chromeBusy.progress === "number" ? Math.round(chromeBusy.progress * 100) : undefined}
        >
          <div
            className={`editor-chrome-progress-bar${typeof chromeBusy.progress === "number" ? "" : " is-indeterminate"}`}
            style={typeof chromeBusy.progress === "number" ? { width: `${Math.round(Math.min(1, Math.max(0, chromeBusy.progress)) * 100)}%` } : undefined}
          />
        </div>
      ) : null}
    </header>
  );
}
