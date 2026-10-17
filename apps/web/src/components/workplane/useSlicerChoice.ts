"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SLICER_CHANGED_EVENT,
  canChooseSlicerProgram,
  chooseSlicerProgram,
  detectInstalledSlicers,
  loadSlicerPreference,
  preferenceFromPath,
  resolveSlicerChoice,
  saveSlicerPreference,
  type DetectedSlicer,
  type SlicerChoice,
  type SlicerPreference,
} from "@/lib/slicerHandoff";

export type SlicerOption = {
  key: string;
  label: string;
  selected: boolean;
};

function optionKey(preference: SlicerPreference, detected: DetectedSlicer[]) {
  if (preference.mode === "off") return "off";
  if (preference.mode === "app") return preference.path;
  return detected[0]?.path ?? "auto";
}

export function useSlicerChoice() {
  const [detected, setDetected] = useState<DetectedSlicer[]>([]);
  const [preference, setPreference] = useState<SlicerPreference>({ mode: "auto" });
  const [listOpen, setListOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreference(loadSlicerPreference());
    let cancelled = false;
    void detectInstalledSlicers().then((slicers) => {
      if (!cancelled) setDetected(slicers);
    });
    const refresh = () => setPreference(loadSlicerPreference());
    window.addEventListener(SLICER_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(SLICER_CHANGED_EVENT, refresh);
    };
  }, []);

  const choice: SlicerChoice = resolveSlicerChoice(preference, detected);
  const selectedKey = optionKey(preference, detected);
  const options: SlicerOption[] = [
    ...detected.map((slicer) => ({
      key: slicer.path,
      label: slicer.name,
      selected: selectedKey === slicer.path,
    })),
    { key: "off", label: "Download only", selected: preference.mode === "off" },
  ];

  const selectKey = useCallback((key: string) => {
    if (key === "off") {
      saveSlicerPreference({ mode: "off" });
      return;
    }
    if (key === "auto") {
      saveSlicerPreference({ mode: "auto" });
      return;
    }
    const slicer = detected.find((item) => item.path === key);
    if (!slicer) return;
    saveSlicerPreference({ mode: "app", id: slicer.id, name: slicer.name, path: slicer.path, format: slicer.format });
  }, [detected]);

  const selectPath = useCallback((filePath: string) => {
    const next = preferenceFromPath(filePath);
    if (!next) return false;
    saveSlicerPreference(next);
    return true;
  }, []);

  const chooseProgram = useCallback(async () => {
    const picked = await chooseSlicerProgram();
    if (!picked) return;
    saveSlicerPreference({ mode: "app", id: picked.id, name: picked.name, path: picked.path, format: picked.format });
  }, []);

  return {
    detected,
    preference,
    choice,
    options,
    listOpen,
    setListOpen,
    busy,
    setBusy,
    selectKey,
    selectPath,
    chooseProgram,
    canChooseProgram: canChooseSlicerProgram(),
  };
}
