"use client";

import { useEffect, useState } from "react";
import { useSlicerChoice } from "@/components/workplane/useSlicerChoice";

export function SlicerSettingsFields() {
  const slicer = useSlicerChoice();
  const savedPath = slicer.preference.mode === "app" ? slicer.preference.path : "";
  const savedName = slicer.preference.mode === "app" ? slicer.preference.name : "";
  const [pathDraft, setPathDraft] = useState(savedPath);
  const [pathError, setPathError] = useState("");
  const selected = slicer.preference.mode === "off"
    ? "off"
    : slicer.preference.mode === "app"
      ? slicer.preference.path
      : "auto";
  const savedIsListed = slicer.preference.mode === "app" && slicer.detected.some((item) => item.path === savedPath);

  useEffect(() => {
    setPathDraft(savedPath);
  }, [savedPath]);

  return (
    <>
      <div className="workspace-section-heading">
        <strong>Slicer</strong>
        <span>Export can open the part in the slicer installed on this computer.</span>
      </div>
      <label className="workspace-select">
        <span>Open exports in</span>
        <select
          aria-label="Slicer"
          value={selected}
          onChange={(event) => slicer.selectKey(event.currentTarget.value)}
        >
          <option value="auto">First slicer found</option>
          {slicer.detected.map((item) => (
            <option key={item.path} value={item.path}>{item.name}</option>
          ))}
          {slicer.preference.mode === "app" && !savedIsListed ? (
            <option value={savedPath}>{savedName}</option>
          ) : null}
          <option value="off">Download only</option>
        </select>
      </label>
      <label className="workspace-select workspace-download-folder">
        <span>Slicer program</span>
        <input
          type="text"
          value={pathDraft}
          placeholder="C:\Program Files\OrcaSlicer\orca-slicer.exe"
          aria-label="Slicer program path"
          onChange={(event) => {
            setPathDraft(event.currentTarget.value);
            setPathError("");
          }}
          onBlur={() => {
            const trimmed = pathDraft.trim();
            if (!trimmed) return;
            if (!slicer.selectPath(trimmed)) {
              setPathError("Choose OrcaSlicer, Bambu Studio, PrusaSlicer, SuperSlicer, UltiMaker Cura, or Formlabs PreForm.");
            }
          }}
        />
      </label>
      {pathError ? <p className="export-step-note">{pathError}</p> : null}
      {slicer.canChooseProgram ? (
        <button type="button" onClick={() => void slicer.chooseProgram()}>
          Browse for slicer
        </button>
      ) : null}
    </>
  );
}
