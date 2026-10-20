"use client";

import { BookOpen, Bot, FolderDown, Grid3X3, Info, Keyboard, LifeBuoy, Palette, Pencil, Ruler, ScrollText, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PeakTipButton, PeakTipLabel } from "@/components/workplane/ToolNameTooltip";
import {
  cloneHotkeyBindings,
  eventToChord,
  findHotkeyConflict,
  formatHotkeyBinding,
  HOTKEY_ACTIONS,
  HOTKEY_CATEGORIES,
  loadHotkeyBindings,
  resetHotkeyBindings,
  saveHotkeyBindings,
  setHotkeyBinding,
  setHotkeyRecordingActive,
  type HotkeyActionId,
  type HotkeyBindings,
} from "@/lib/hotkeys";
import { normalizeScaleForUnits, scaleOptionsForUnits, WORKSPACE_UNIT_OPTIONS } from "@/lib/measurementUnits";
import { TOOL_DESCRIPTIONS, TOOL_INDEX, TOOL_INDEX_CATEGORIES } from "@/lib/toolDescriptions";
import { DISPLAY_QUALITY_OPTIONS } from "@/lib/displayTessellation";
import { HelpFeedbackForm } from "@/components/workplane/HelpFeedbackForm";
import { ModelBridgeSettings } from "@/components/workplane/ModelBridgeSettings";
import { RELEASE_NOTES, UNRELEASED_NOTES } from "@/lib/releaseNotes";
import { DOWNLOAD_FOLDER_STORAGE_KEY } from "@/lib/downloadFile";
import { hasDesktopProjectFiles, transitionDesktopPeakcadFiles, type ProjectFileTransition } from "@/lib/peakcadFile";
import { SlicerSettingsFields } from "@/components/workplane/SlicerSettingsFields";
import { loadUiTheme, setUiTheme, type UiTheme } from "@/lib/uiTheme";
import { DEFAULT_WORKPLANE_WORKSPACE, savePeakcadPro } from "@/lib/workplaneSettings";
import { brandForPreset, printersForBrand, PRINTER_BRANDS } from "@/lib/printerBed";
import type { DisplayQuality, GridSize, WorkplaneWorkspaceSettings } from "@/types/sketchforge";

type WorkspaceSettings = WorkplaneWorkspaceSettings;
type WorkspaceSettingsSection = "appearance" | "measurement" | "workplane" | "sketch" | "files" | "tools" | "hotkeys" | "models" | "updates" | "help" | "about";
type WorkspaceSettingsContext = "project" | "app";
type LegalDocumentId = "license" | "notices" | "offer";

const PEAKCAD_VERSION = process.env.NEXT_PUBLIC_PEAKCAD_VERSION ?? "";

// Staged into public/legal by scripts/stage-legal-notices.mjs; relative so it resolves under the desktop shell's static server too.
const LEGAL_DOCUMENTS: { id: LegalDocumentId; label: string; path: string }[] = [
  { id: "license", label: "View GPL-3.0 license", path: "legal/LICENSE.txt" },
  { id: "notices", label: "Third-party notices", path: "legal/THIRD-PARTY-NOTICES.txt" },
  { id: "offer", label: "Source code offer", path: "legal/SOURCE-OFFER.txt" },
];

function loadDownloadFolder() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(DOWNLOAD_FOLDER_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveDownloadFolder(value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DOWNLOAD_FOLDER_STORAGE_KEY, value);
  } catch {
    // Path still applies for this session via caller state when provided.
  }
}

const GRID_SIZES: GridSize[] = ["Off", "0.1 mm", "0.25 mm", "0.5 mm", "1.0 mm", "2.0 mm", "5.0 mm"];
const MIN_WORKSPACE_SIZE = 60;
const MAX_WORKSPACE_SIZE = 2000;
const MIN_GRID_BLOCK_SIZE = 1;
const MAX_GRID_BLOCK_SIZE = 200;
const WORKSPACE_SIZE_PRESETS = [
  { label: "200 x 200 mm", width: 200, depth: 200 },
  { label: "300 x 300 mm", width: 300, depth: 300 },
  { label: "500 x 500 mm", width: 500, depth: 500 },
  { label: "1000 x 1000 mm", width: 1000, depth: 1000 },
  { label: "2000 x 2000 mm", width: 2000, depth: 2000 },
  { label: "Custom", width: 200, depth: 200 },
];
const GRID_BLOCK_PRESETS = ["1 mm", "2.5 mm", "5 mm", "10 mm", "20 mm", "50 mm", "100 mm", "Custom"] as const;

const SETTING_TIPS = {
  showShadows: "Cast soft shadows from shapes onto the workplane to make depth easier to read.",
  showGrid: "Show or hide the grid lines drawn on the workplane.",
  displayQuality: "How densely curved surfaces are tessellated in the viewport and for booleans. Smooth looks rounder; Draft is faster on large scenes.",
  cruiseShapes: "Keep camera orbit and pan available while placing a new shape so you can reframe mid-add.",
  zoomSpeed: "How quickly the camera zooms when you scroll the mouse wheel.",
  units: "Choose metric, imperial, or brick studs for displayed measurements.",
  scale: "Map model units to real-world size, such as 1:1 millimeters or meters.",
  accuracy: "How many decimal places to show for typed and displayed dimensions.",
  snapGrid: "Snap moves and resizes to this spacing. Choose Off to place freely.",
  workplaneSize: "Preset overall size of the modeling plate.",
  width: "Workplane size along X, in the current units.",
  length: "Workplane size along Z (length/depth), in the current units.",
  gridBlockSize: "Spacing between major grid lines on the workplane.",
  blockSize: "Custom spacing between grid lines when Grid block size is set to Custom.",
  printerBrand: "The maker of the printer. The next menu lists that maker's machines.",
  printer: "The machine you print on. The bed is drawn on the workplane, and parts that stick past it are marked.",
  overhang: "Faces that lean out more than this, measured from vertical, get warning stripes. 45 is a usual limit.",
  showPrinterBed: "Show the printer bed on the workplane.",
  showOverhangStripes: "Paint warning stripes on faces that lean out past the overhang angle.",
  makeDefault: "Save these settings as the default for this project.",
  makeDefaultApp: "Save these settings as the default for new projects.",
  peakcadPro: "Show sketch constraints, driving dimensions, and other advanced modeling tools on every project. Leave this off while learning the basics.",
  uiTheme: "Switch PeakCAD’s chrome between light and dark. Applies to the dashboard and editor.",
  downloadFolder: "Local folder used for exported files and downloads on this computer.",
} as const;

function transitionResultNotice(result: ProjectFileTransition) {
  const changed = result.renamed.length;
  const already = result.already.length;
  const failed = result.failed[0]?.message;
  if (changed === 0 && already === 0 && !failed) return "No project files to move. New designs will be saved in Documents\\Mintr.";
  const parts: string[] = [];
  if (changed > 0) parts.push(`Moved ${changed} ${changed === 1 ? "file" : "files"} into Documents\\Mintr.`);
  if (already > 0) {
    parts.push(`${already} ${already === 1 ? "was" : "were"} left in place because a .mintr file was already there.`);
  }
  if (failed) parts.push(failed);
  return parts.join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function gridBlockSizeForPreset(preset: string, fallback: number) {
  if (preset === "Custom") {
    return clamp(fallback, MIN_GRID_BLOCK_SIZE, MAX_GRID_BLOCK_SIZE);
  }
  return clamp(Number.parseFloat(preset) || DEFAULT_WORKPLANE_WORKSPACE.gridBlockSize, MIN_GRID_BLOCK_SIZE, MAX_GRID_BLOCK_SIZE);
}

export function WorkspaceSettingsModal({
  workspace,
  snap,
  onWorkspaceChange,
  onSnapChange,
  onMakeDefault,
  onClose,
  context = "project",
  downloadFolder,
  onDownloadFolderChange,
  sketchGuides,
}: {
  workspace: WorkspaceSettings;
  snap: GridSize;
  onWorkspaceChange: (next: WorkspaceSettings) => void;
  onSnapChange: (next: GridSize) => void;
  onMakeDefault: () => void;
  onClose: () => void;
  context?: WorkspaceSettingsContext;
  downloadFolder?: string;
  onDownloadFolderChange?: (value: string) => void;
  sketchGuides?: {
    showGuides: boolean;
    drawAsGuides: boolean;
    onChange: (patch: { showConstruction?: boolean; constructionMode?: boolean }) => void;
  };
}) {
  const [defaultSaved, setDefaultSaved] = useState(false);
  const [activeSection, setActiveSection] = useState<WorkspaceSettingsSection>(sketchGuides ? "sketch" : "appearance");
  const [uiTheme, setUiThemeState] = useState<UiTheme>(() => loadUiTheme());
  const [localDownloadFolder, setLocalDownloadFolder] = useState(() => downloadFolder ?? loadDownloadFolder());
  const [toolQuery, setToolQuery] = useState("");
  const [hotkeyQuery, setHotkeyQuery] = useState("");
  const [hotkeys, setHotkeys] = useState<HotkeyBindings>(() => loadHotkeyBindings());
  const [recordingAction, setRecordingAction] = useState<HotkeyActionId | null>(null);
  const [hotkeyNotice, setHotkeyNotice] = useState<string | null>(null);
  const [legalDocument, setLegalDocument] = useState<LegalDocumentId | null>(null);
  const [legalText, setLegalText] = useState<string | null>(null);
  const [canTransitionFiles, setCanTransitionFiles] = useState(false);
  const [transitionConfirm, setTransitionConfirm] = useState(false);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [transitionNotice, setTransitionNotice] = useState<string | null>(null);
  const [dimensionDrafts, setDimensionDrafts] = useState(() => ({
    width: workspace.width.toFixed(workspace.accuracy),
    depth: workspace.depth.toFixed(workspace.accuracy),
  }));
  const [printerDrafts, setPrinterDrafts] = useState(() => ({
    printerWidth: String(workspace.printerWidth),
    printerDepth: String(workspace.printerDepth),
    printerHeight: String(workspace.printerHeight),
    overhangAngle: String(workspace.overhangAngle),
  }));
  const downloadFolderValue = downloadFolder ?? localDownloadFolder;
  const scaleOptions = scaleOptionsForUnits(workspace.units);
  const scaleValue = normalizeScaleForUnits(workspace.units, workspace.scale);

  useEffect(() => {
    if (typeof downloadFolder === "string") {
      setLocalDownloadFolder(downloadFolder);
    }
  }, [downloadFolder]);
  useEffect(() => {
    setCanTransitionFiles(hasDesktopProjectFiles());
  }, []);
  const toolQueryNormalized = toolQuery.trim().toLowerCase();
  const filteredToolIndex = !toolQueryNormalized
    ? TOOL_INDEX
    : TOOL_INDEX.filter((entry) => {
      const description = TOOL_DESCRIPTIONS[entry.key].toLowerCase();
      return (
        entry.label.toLowerCase().includes(toolQueryNormalized)
        || entry.category.toLowerCase().includes(toolQueryNormalized)
        || description.includes(toolQueryNormalized)
      );
    });
  const hotkeyQueryNormalized = hotkeyQuery.trim().toLowerCase();
  const filteredHotkeyActions = !hotkeyQueryNormalized
    ? HOTKEY_ACTIONS
    : HOTKEY_ACTIONS.filter((entry) => (
      entry.label.toLowerCase().includes(hotkeyQueryNormalized)
      || entry.category.toLowerCase().includes(hotkeyQueryNormalized)
      || entry.description.toLowerCase().includes(hotkeyQueryNormalized)
      || formatHotkeyBinding(hotkeys[entry.id]).toLowerCase().includes(hotkeyQueryNormalized)
    ));
  useEffect(() => {
    setDimensionDrafts({
      width: workspace.width.toFixed(workspace.accuracy),
      depth: workspace.depth.toFixed(workspace.accuracy),
    });
    setPrinterDrafts({
      printerWidth: String(workspace.printerWidth),
      printerDepth: String(workspace.printerDepth),
      printerHeight: String(workspace.printerHeight),
      overhangAngle: String(workspace.overhangAngle),
    });
  }, [workspace.accuracy, workspace.depth, workspace.overhangAngle, workspace.printerDepth, workspace.printerHeight, workspace.printerWidth, workspace.width]);
  useEffect(() => {
    setHotkeyRecordingActive(Boolean(recordingAction));
    return () => setHotkeyRecordingActive(false);
  }, [recordingAction]);
  useEffect(() => {
    if (!recordingAction) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const key = event.key;
      if (key === "Escape") {
        setRecordingAction(null);
        setHotkeyNotice("Recording cancelled");
        return;
      }
      if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") {
        return;
      }
      const nextChord = eventToChord(event);
      const conflict = findHotkeyConflict(hotkeys, recordingAction, nextChord);
      const conflictLabel = conflict
        ? HOTKEY_ACTIONS.find((entry) => entry.id === conflict)?.label ?? conflict
        : null;
      const next = setHotkeyBinding(hotkeys, recordingAction, [nextChord], { clearConflicts: true });
      const saved = saveHotkeyBindings(next);
      setHotkeys(saved);
      setRecordingAction(null);
      setHotkeyNotice(
        conflictLabel
          ? `Mapped · removed from ${conflictLabel}`
          : "Hotkey saved",
      );
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [hotkeys, recordingAction]);
  useEffect(() => {
    if (!hotkeyNotice) return;
    const timer = window.setTimeout(() => setHotkeyNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [hotkeyNotice]);
  useEffect(() => {
    const source = LEGAL_DOCUMENTS.find((entry) => entry.id === legalDocument);
    setLegalText(null);
    if (!source) return;
    let cancelled = false;
    fetch(source.path)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(
        (text) => {
          if (!cancelled) setLegalText(text);
        },
        () => {
          if (!cancelled) {
            setLegalText("This file could not be loaded. The same license files ship in the Mintr install folder (LICENSE.txt, THIRD-PARTY-NOTICES.txt, SOURCE-OFFER.txt) and at https://www.gnu.org/licenses/gpl-3.0.txt.");
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [legalDocument]);
  const patchWorkspace = (patch: Partial<WorkspaceSettings>) => {
    setDefaultSaved(false);
    const next = { ...workspace, ...patch };
    onWorkspaceChange({ ...next, scale: normalizeScaleForUnits(next.units, next.scale) });
  };
  const setDimension = (key: "width" | "depth", value: string) => {
    const parsed = Number.parseFloat(value);
    const next = clamp(Number.isFinite(parsed) ? parsed : workspace[key], MIN_WORKSPACE_SIZE, MAX_WORKSPACE_SIZE);
    setDimensionDrafts((current) => ({ ...current, [key]: next.toFixed(workspace.accuracy) }));
    patchWorkspace({ [key]: next, sizePreset: "Custom" } as Partial<WorkspaceSettings>);
  };
  const setWorkspaceSizePreset = (sizePreset: string) => {
    const preset = WORKSPACE_SIZE_PRESETS.find((entry) => entry.label === sizePreset);
    if (!preset || sizePreset === "Custom") {
      patchWorkspace({ sizePreset: "Custom" });
      return;
    }
    patchWorkspace({ sizePreset, width: preset.width, depth: preset.depth });
  };
  const setPrinterBrand = (brand: string) => {
    const current = printersForBrand(brandForPreset(workspace.printerPreset)).find((entry) => entry.id === workspace.printerPreset);
    if (current?.brand === brand) return;
    const preset = printersForBrand(brand)[0];
    if (!preset || preset.id === "custom") {
      patchWorkspace({ printerPreset: "custom" });
      return;
    }
    patchWorkspace({
      printerPreset: preset.id,
      printerWidth: preset.width,
      printerDepth: preset.depth,
      printerHeight: preset.height,
    });
  };
  const setPrinterPreset = (label: string) => {
    const preset = printersForBrand(brandForPreset(workspace.printerPreset)).find((entry) => entry.label === label);
    if (!preset || preset.id === "custom") {
      patchWorkspace({ printerPreset: "custom" });
      return;
    }
    patchWorkspace({
      printerPreset: preset.id,
      printerWidth: preset.width,
      printerDepth: preset.depth,
      printerHeight: preset.height,
    });
  };
  const setPrinterSize = (key: "printerWidth" | "printerDepth" | "printerHeight", value: string) => {
    const parsed = Number.parseFloat(value);
    const fallback = workspace[key];
    const next = clamp(Number.isFinite(parsed) ? parsed : fallback, key === "printerHeight" ? 20 : 40, 2000);
    patchWorkspace({ printerPreset: "custom", [key]: next });
  };
  const setGridBlockPreset = (gridBlockPreset: string) => {
    patchWorkspace({ gridBlockPreset, gridBlockSize: gridBlockSizeForPreset(gridBlockPreset, workspace.gridBlockSize) });
  };
  const setGridBlockSize = (value: string) => {
    const next = clamp(Number.parseFloat(value) || DEFAULT_WORKPLANE_WORKSPACE.gridBlockSize, MIN_GRID_BLOCK_SIZE, MAX_GRID_BLOCK_SIZE);
    patchWorkspace({ gridBlockPreset: "Custom", gridBlockSize: next });
  };

  return (
    <div className={`workspace-modal${context === "app" ? " workspace-modal-app" : ""}`} role="dialog" aria-modal="true" aria-label="Settings">
      <div className="workspace-modal-card" onPointerDown={(event) => event.stopPropagation()}>
        <header className="workspace-modal-header">
          <strong>Settings</strong>
          <button aria-label="Close settings" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="workspace-modal-layout">
          <nav className="workspace-settings-nav" aria-label="Settings sections">
            <button className={activeSection === "appearance" ? "active" : ""} aria-current={activeSection === "appearance" ? "page" : undefined} onClick={() => setActiveSection("appearance")}>
              <Palette size={18} />
              <span>Appearance</span>
            </button>
            <button className={activeSection === "measurement" ? "active" : ""} aria-current={activeSection === "measurement" ? "page" : undefined} onClick={() => setActiveSection("measurement")}>
              <Ruler size={18} />
              <span>Measurement</span>
            </button>
            <button className={activeSection === "workplane" ? "active" : ""} aria-current={activeSection === "workplane" ? "page" : undefined} onClick={() => setActiveSection("workplane")}>
              <Grid3X3 size={18} />
              <span>Workplane</span>
            </button>
            {sketchGuides ? (
              <button className={activeSection === "sketch" ? "active" : ""} aria-current={activeSection === "sketch" ? "page" : undefined} onClick={() => setActiveSection("sketch")}>
                <Pencil size={18} />
                <span>Sketch</span>
              </button>
            ) : null}
            <button className={activeSection === "files" ? "active" : ""} aria-current={activeSection === "files" ? "page" : undefined} onClick={() => setActiveSection("files")}>
              <FolderDown size={18} />
              <span>Files</span>
            </button>
            <button className={activeSection === "tools" ? "active" : ""} aria-current={activeSection === "tools" ? "page" : undefined} onClick={() => setActiveSection("tools")}>
              <BookOpen size={18} />
              <span>Tools</span>
            </button>
            <button className={activeSection === "hotkeys" ? "active" : ""} aria-current={activeSection === "hotkeys" ? "page" : undefined} onClick={() => setActiveSection("hotkeys")}>
              <Keyboard size={18} />
              <span>Hotkeys</span>
            </button>
            <button className={activeSection === "models" ? "active" : ""} aria-current={activeSection === "models" ? "page" : undefined} onClick={() => setActiveSection("models")}>
              <Bot size={18} />
              <span>Models</span>
            </button>
            <button className={activeSection === "updates" ? "active" : ""} aria-current={activeSection === "updates" ? "page" : undefined} onClick={() => setActiveSection("updates")}>
              <ScrollText size={18} />
              <span>Updates</span>
            </button>
            <button className={activeSection === "help" ? "active" : ""} aria-current={activeSection === "help" ? "page" : undefined} onClick={() => setActiveSection("help")}>
              <LifeBuoy size={18} />
              <span>Help/Feedback</span>
            </button>
            <button className={activeSection === "about" ? "active" : ""} aria-current={activeSection === "about" ? "page" : undefined} onClick={() => setActiveSection("about")}>
              <Info size={18} />
              <span>About</span>
            </button>
          </nav>

          <div className="workspace-modal-content">
            <div className="workspace-modal-body">
              {activeSection === "appearance" ? (
                <>
                  <div className="workspace-section-heading">
                    <strong>Appearance</strong>
                    <span>Adjust the canvas and navigation behavior.</span>
                  </div>
                  <WorkspaceToggle
                    label="Mintr Pro"
                    tip={SETTING_TIPS.peakcadPro}
                    checked={workspace.peakcadPro}
                    onChange={(peakcadPro) => {
                      savePeakcadPro(peakcadPro);
                      patchWorkspace({ peakcadPro });
                    }}
                  />
                  <WorkspaceSelect
                    label="Theme"
                    tip={SETTING_TIPS.uiTheme}
                    value={uiTheme === "dark" ? "Dark" : "Light"}
                    options={["Light", "Dark"]}
                    onChange={(label) => {
                      const next = label === "Dark" ? "dark" : "light";
                      setUiThemeState(next);
                      setUiTheme(next);
                    }}
                  />
                  <WorkspaceToggle
                    label="Show shadows"
                    tip={SETTING_TIPS.showShadows}
                    checked={workspace.showShadows}
                    onChange={(showShadows) => patchWorkspace({ showShadows })}
                  />
                  <WorkspaceToggle
                    label="Show grid"
                    tip={SETTING_TIPS.showGrid}
                    checked={workspace.showGrid}
                    onChange={(showGrid) => patchWorkspace({ showGrid })}
                  />
                  <WorkspaceSelect
                    label="Display quality"
                    tip={SETTING_TIPS.displayQuality}
                    value={workspace.displayQuality === "draft" ? "Draft" : workspace.displayQuality === "standard" ? "Standard" : "Smooth"}
                    options={["Draft", "Standard", "Smooth"]}
                    onChange={(label) => {
                      const displayQuality = (
                        label === "Draft" ? "draft" : label === "Standard" ? "standard" : "smooth"
                      ) as DisplayQuality;
                      if (!DISPLAY_QUALITY_OPTIONS.includes(displayQuality)) return;
                      patchWorkspace({ displayQuality });
                    }}
                  />
                  <WorkspaceToggle
                    label="Cruise when adding new shapes"
                    tip={SETTING_TIPS.cruiseShapes}
                    checked={workspace.cruiseShapes}
                    onChange={(cruiseShapes) => patchWorkspace({ cruiseShapes })}
                  />
                  <PeakTipLabel label={SETTING_TIPS.zoomSpeed} helpTitle="Zoom speed" description={SETTING_TIPS.zoomSpeed} className="workspace-range">
                    <span>Zoom speed</span>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={workspace.zoomSpeed}
                      onChange={(event) => patchWorkspace({ zoomSpeed: Number(event.currentTarget.value) })}
                    />
                    <small>
                      <span>Slow</span>
                      <span>Fast</span>
                    </small>
                  </PeakTipLabel>
                  <p className="workspace-about-credit">Mintr is made by Peak Horology.</p>
                </>
              ) : null}

              {activeSection === "measurement" ? (
                <>
                  <div className="workspace-section-heading">
                    <strong>Measurement</strong>
                    <span>Choose units, precision, scale, and snapping.</span>
                  </div>
                  <WorkspaceSelect
                    label="Units"
                    tip={SETTING_TIPS.units}
                    value={workspace.units}
                    options={WORKSPACE_UNIT_OPTIONS}
                    onChange={(units) => patchWorkspace({ units })}
                  />
                  <WorkspaceSelect
                    label="Scale"
                    tip={SETTING_TIPS.scale}
                    value={scaleValue}
                    options={scaleOptions}
                    onChange={(scale) => patchWorkspace({ scale })}
                  />
                  <WorkspaceSelect
                    label="Accuracy"
                    tip={SETTING_TIPS.accuracy}
                    value={`0.${"0".repeat(workspace.accuracy)}`}
                    options={["0.0", "0.00", "0.000"]}
                    onChange={(accuracy) => patchWorkspace({ accuracy: accuracy.slice(2).length as WorkspaceSettings["accuracy"] })}
                  />
                  <WorkspaceSelect
                    label="Snap Grid"
                    tip={SETTING_TIPS.snapGrid}
                    value={snap}
                    options={GRID_SIZES}
                    onChange={(next) => {
                      setDefaultSaved(false);
                      onSnapChange(next as GridSize);
                    }}
                  />
                </>
              ) : null}

              {activeSection === "workplane" ? (
                <>
                  <div className="workspace-section-heading">
                    <strong>Workplane</strong>
                    <span>Set the plate dimensions and visible grid spacing.</span>
                  </div>
                  <WorkspaceSelect
                    label="Workplane size"
                    tip={SETTING_TIPS.workplaneSize}
                    value={workspace.sizePreset}
                    options={WORKSPACE_SIZE_PRESETS.map((preset) => preset.label)}
                    onChange={setWorkspaceSizePreset}
                  />
                  <div className="workspace-dimensions">
                    <PeakTipLabel label={SETTING_TIPS.width} helpTitle="Width" description={SETTING_TIPS.width}>
                      <span>Width</span>
                      <input
                        type="number"
                        value={dimensionDrafts.width}
                        min={MIN_WORKSPACE_SIZE}
                        max={MAX_WORKSPACE_SIZE}
                        step={1}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setDimensionDrafts((current) => ({ ...current, width: value }));
                        }}
                        onBlur={(event) => setDimension("width", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </PeakTipLabel>
                    <PeakTipLabel label={SETTING_TIPS.length} helpTitle="Length" description={SETTING_TIPS.length}>
                      <span>Length</span>
                      <input
                        type="number"
                        value={dimensionDrafts.depth}
                        min={MIN_WORKSPACE_SIZE}
                        max={MAX_WORKSPACE_SIZE}
                        step={1}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setDimensionDrafts((current) => ({ ...current, depth: value }));
                        }}
                        onBlur={(event) => setDimension("depth", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </PeakTipLabel>
                  </div>
                  <WorkspaceSelect
                    label="Grid block size"
                    tip={SETTING_TIPS.gridBlockSize}
                    value={workspace.gridBlockPreset}
                    options={GRID_BLOCK_PRESETS}
                    onChange={setGridBlockPreset}
                  />
                  {workspace.gridBlockPreset === "Custom" ? (
                    <div className="workspace-dimensions workspace-grid-dimensions">
                      <PeakTipLabel label={SETTING_TIPS.blockSize} helpTitle="Block size" description={SETTING_TIPS.blockSize}>
                        <span>Block size</span>
                        <input
                          type="number"
                          value={workspace.gridBlockSize.toFixed(workspace.accuracy)}
                          min={MIN_GRID_BLOCK_SIZE}
                          max={MAX_GRID_BLOCK_SIZE}
                          step={0.5}
                          onChange={(event) => setGridBlockSize(event.currentTarget.value)}
                        />
                      </PeakTipLabel>
                    </div>
                  ) : null}
                  <div className="workspace-section-heading">
                    <strong>Printer</strong>
                    <span>The bed on the workplane. Stripes mark faces that need support.</span>
                  </div>
                  <WorkspaceSelect
                    label="Brand"
                    tip={SETTING_TIPS.printerBrand}
                    value={brandForPreset(workspace.printerPreset)}
                    options={PRINTER_BRANDS}
                    onChange={setPrinterBrand}
                  />
                  <WorkspaceSelect
                    label="Printer"
                    tip={SETTING_TIPS.printer}
                    value={printersForBrand(brandForPreset(workspace.printerPreset)).find((preset) => preset.id === workspace.printerPreset)?.label ?? "Custom size"}
                    options={printersForBrand(brandForPreset(workspace.printerPreset)).map((preset) => preset.label)}
                    onChange={setPrinterPreset}
                  />
                  <div className="workspace-dimensions">
                    <PeakTipLabel label="Bed width in millimetres." helpTitle="Bed width" description="Bed width in millimetres.">
                      <span>Width</span>
                      <input
                        type="number"
                        value={printerDrafts.printerWidth}
                        min={40}
                        max={2000}
                        step={1}
                        aria-label="Printer bed width"
                        onChange={(event) => setPrinterDrafts((current) => ({ ...current, printerWidth: event.currentTarget.value }))}
                        onBlur={(event) => setPrinterSize("printerWidth", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </PeakTipLabel>
                    <PeakTipLabel label="Bed depth in millimetres." helpTitle="Bed depth" description="Bed depth in millimetres.">
                      <span>Depth</span>
                      <input
                        type="number"
                        value={printerDrafts.printerDepth}
                        min={40}
                        max={2000}
                        step={1}
                        aria-label="Printer bed depth"
                        onChange={(event) => setPrinterDrafts((current) => ({ ...current, printerDepth: event.currentTarget.value }))}
                        onBlur={(event) => setPrinterSize("printerDepth", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </PeakTipLabel>
                  </div>
                  <div className="workspace-dimensions">
                    <PeakTipLabel label="Usable height above the bed, in millimetres." helpTitle="Bed height" description="Usable height above the bed, in millimetres.">
                      <span>Height</span>
                      <input
                        type="number"
                        value={printerDrafts.printerHeight}
                        min={20}
                        max={2000}
                        step={1}
                        aria-label="Printer height"
                        onChange={(event) => setPrinterDrafts((current) => ({ ...current, printerHeight: event.currentTarget.value }))}
                        onBlur={(event) => setPrinterSize("printerHeight", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </PeakTipLabel>
                    <PeakTipLabel label={SETTING_TIPS.overhang} helpTitle="Overhang" description={SETTING_TIPS.overhang}>
                      <span>Overhang</span>
                      <input
                        type="number"
                        value={printerDrafts.overhangAngle}
                        min={0}
                        max={85}
                        step={1}
                        aria-label="Overhang angle"
                        onChange={(event) => setPrinterDrafts((current) => ({ ...current, overhangAngle: event.currentTarget.value }))}
                        onBlur={(event) => {
                          const parsed = Number.parseFloat(event.currentTarget.value);
                          if (!Number.isFinite(parsed)) return;
                          patchWorkspace({ overhangAngle: Math.max(0, Math.min(85, parsed)) });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </PeakTipLabel>
                  </div>
                  <WorkspaceToggle
                    label="Show printer bed"
                    tip={SETTING_TIPS.showPrinterBed}
                    checked={workspace.showPrinterBed}
                    onChange={(showPrinterBed) => patchWorkspace({ showPrinterBed })}
                  />
                  <WorkspaceToggle
                    label="Show overhang stripes"
                    tip={SETTING_TIPS.showOverhangStripes}
                    checked={workspace.showOverhangStripes}
                    onChange={(showOverhangStripes) => patchWorkspace({ showOverhangStripes })}
                  />
                </>
              ) : null}

              {activeSection === "sketch" && sketchGuides ? (
                <>
                  <div className="workspace-section-heading">
                    <strong>Sketch</strong>
                    <span>Guide lines stay out of the solid. Use them for layout, then turn them off to draw the part.</span>
                  </div>
                  <WorkspaceToggle
                    label="Show guides"
                    tip="Show or hide guide lines already in this sketch."
                    checked={sketchGuides.showGuides}
                    onChange={(showGuides) => sketchGuides.onChange({ showConstruction: showGuides })}
                  />
                  <WorkspaceToggle
                    label="Draw as guides"
                    tip="New lines are guides. They will not become a solid until you turn this off."
                    checked={sketchGuides.drawAsGuides}
                    onChange={(drawAsGuides) => sketchGuides.onChange({ constructionMode: drawAsGuides })}
                  />
                </>
              ) : null}

              {activeSection === "files" ? (
                <>
                  <div className="workspace-section-heading">
                    <strong>Files</strong>
                    <span>Choose where PeakCAD writes exported files on this computer.</span>
                  </div>
                  <PeakTipLabel
                    label={SETTING_TIPS.downloadFolder}
                    helpTitle="Download folder"
                    description={SETTING_TIPS.downloadFolder}
                    className="workspace-select workspace-download-folder"
                  >
                    <span>Download folder</span>
                    <input
                      type="text"
                      value={downloadFolderValue}
                      onChange={(event) => {
                        const next = event.currentTarget.value;
                        setLocalDownloadFolder(next);
                        saveDownloadFolder(next);
                        onDownloadFolderChange?.(next);
                      }}
                      placeholder="C:\\Users\\You\\Downloads"
                      aria-label="Download folder path"
                    />
                  </PeakTipLabel>
                  <SlicerSettingsFields />
                  {canTransitionFiles ? (
                    <div className="workspace-file-transition">
                      <strong>Move projects to Documents\Mintr</strong>
                      <p>
                        Changes each .peakcad project to .mintr and moves your project files into Documents\Mintr.
                        The design inside each file stays the same. Nothing is replaced if a .mintr file is already there.
                        After this, new designs are saved in Documents\Mintr.
                      </p>
                      {transitionConfirm ? (
                        <div className="workspace-file-transition-actions">
                          <button
                            type="button"
                            className="workspace-file-transition-cancel"
                            disabled={transitionBusy}
                            onClick={() => setTransitionConfirm(false)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="make-default-button"
                            disabled={transitionBusy}
                            onClick={() => {
                              setTransitionBusy(true);
                              setTransitionNotice(null);
                              void transitionDesktopPeakcadFiles()
                                .then((result) => {
                                  setTransitionNotice(transitionResultNotice(result));
                                  setTransitionConfirm(false);
                                })
                                .catch((error: unknown) => {
                                  setTransitionNotice(error instanceof Error ? error.message : "Could not change those files.");
                                })
                                .finally(() => setTransitionBusy(false));
                            }}
                          >
                            {transitionBusy ? "Moving…" : "Move files"}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="make-default-button"
                          onClick={() => {
                            setTransitionNotice(null);
                            setTransitionConfirm(true);
                          }}
                        >
                          Move projects to Documents\Mintr
                        </button>
                      )}
                      {transitionNotice ? <p className="workspace-hotkey-notice">{transitionNotice}</p> : null}
                    </div>
                  ) : null}
                </>
              ) : null}

              {activeSection === "tools" ? (
                <>
                  <div className="workspace-section-heading">
                    <strong>Tool index</strong>
                    <span>Descriptions for every editor tool. Tip: right-click a toolbar button for the same help.</span>
                  </div>
                  <label className="workspace-tool-search">
                    <input
                      type="search"
                      value={toolQuery}
                      placeholder="Search tools…"
                      aria-label="Search tools"
                      onChange={(event) => setToolQuery(event.currentTarget.value)}
                    />
                  </label>
                  <div className="workspace-tool-index" role="list">
                    {TOOL_INDEX_CATEGORIES.map((category) => {
                      const entries = filteredToolIndex.filter((entry) => entry.category === category);
                      if (!entries.length) return null;
                      return (
                        <section key={category} className="workspace-tool-category" aria-label={category}>
                          <h3>{category}</h3>
                          <ul>
                            {entries.map((entry) => (
                              <li key={entry.key} role="listitem">
                                <strong>{entry.label}</strong>
                                <p>{TOOL_DESCRIPTIONS[entry.key]}</p>
                              </li>
                            ))}
                          </ul>
                        </section>
                      );
                    })}
                    {!filteredToolIndex.length ? (
                      <p className="workspace-tool-empty">No tools match “{toolQuery.trim()}”.</p>
                    ) : null}
                  </div>
                </>
              ) : null}

              {activeSection === "hotkeys" ? (
                <>
                  <div className="workspace-section-heading">
                    <strong>Hotkeys</strong>
                    <span>Click a shortcut to remap it. Esc cancels recording. Sketch and geometry can share a letter; conflicts in the same mode still clear the other action.</span>
                  </div>
                  <div className="workspace-hotkey-toolbar">
                    <label className="workspace-tool-search">
                      <input
                        type="search"
                        value={hotkeyQuery}
                        placeholder="Search hotkeys…"
                        aria-label="Search hotkeys"
                        onChange={(event) => setHotkeyQuery(event.currentTarget.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="workspace-hotkey-reset"
                      onClick={() => {
                        const next = resetHotkeyBindings();
                        setHotkeys(cloneHotkeyBindings(next));
                        setRecordingAction(null);
                        setHotkeyNotice("Restored default hotkeys");
                      }}
                    >
                      Reset defaults
                    </button>
                  </div>
                  {hotkeyNotice ? <p className="workspace-hotkey-notice">{hotkeyNotice}</p> : null}
                  <div className="workspace-hotkey-index">
                    {HOTKEY_CATEGORIES.map((category) => {
                      const entries = filteredHotkeyActions.filter((entry) => entry.category === category);
                      if (!entries.length) return null;
                      return (
                        <section key={category} className="workspace-hotkey-category" aria-label={category}>
                          <h3>{category}</h3>
                          <ul>
                            {entries.map((entry) => {
                              const recording = recordingAction === entry.id;
                              return (
                                <li key={entry.id}>
                                  <div className="workspace-hotkey-copy">
                                    <strong>{entry.label}</strong>
                                    <p>{entry.description}</p>
                                  </div>
                                  <div className="workspace-hotkey-actions">
                                    <button
                                      type="button"
                                      className={recording ? "workspace-hotkey-bind recording" : "workspace-hotkey-bind"}
                                      onClick={() => {
                                        setRecordingAction(entry.id);
                                        setHotkeyNotice(`Press a key for ${entry.label}…`);
                                      }}
                                    >
                                      {recording ? "Press a key…" : formatHotkeyBinding(hotkeys[entry.id])}
                                    </button>
                                    {(hotkeys[entry.id]?.length ?? 0) > 0 ? (
                                      <button
                                        type="button"
                                        className="workspace-hotkey-clear"
                                        aria-label={`Clear ${entry.label} hotkey`}
                                        onClick={() => {
                                          const next = setHotkeyBinding(hotkeys, entry.id, []);
                                          setHotkeys(saveHotkeyBindings(next));
                                          setHotkeyNotice(`Cleared ${entry.label}`);
                                        }}
                                      >
                                        Clear
                                      </button>
                                    ) : null}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      );
                    })}
                    {!filteredHotkeyActions.length ? (
                      <p className="workspace-tool-empty">No hotkeys match “{hotkeyQuery.trim()}”.</p>
                    ) : null}
                  </div>
                </>
              ) : null}

              {activeSection === "models" ? <ModelBridgeSettings /> : null}

              {activeSection === "updates" ? (
                <>
                  <div className="workspace-section-heading">
                    <strong>Updates</strong>
                    <span>What changed in each version.</span>
                  </div>
                  <div className="workspace-updates">
                    {UNRELEASED_NOTES.length > 0 ? (
                      <section className="workspace-update">
                        <h3>Since {RELEASE_NOTES[0]?.version ?? "the last release"}</h3>
                        <ul>
                          {UNRELEASED_NOTES.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                    {RELEASE_NOTES.map((release) => (
                      <section className="workspace-update" key={release.version}>
                        <h3>
                          {release.version}
                          {PEAKCAD_VERSION === release.version ? <span>Current</span> : null}
                        </h3>
                        <ul>
                          {release.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </>
              ) : null}

              {activeSection === "help" ? (
                <>
                  <div className="workspace-section-heading">
                    <strong>Help/Feedback</strong>
                    <span>Tell us what you think, or describe a problem. Your design is not sent.</span>
                  </div>
                  <HelpFeedbackForm version={PEAKCAD_VERSION} />
                </>
              ) : null}

              {activeSection === "about" ? (
                <>
                  <div className="workspace-section-heading">
                    <strong>About Mintr</strong>
                    <span>{PEAKCAD_VERSION ? `Version ${PEAKCAD_VERSION}` : "Mintr"} · GPL-3.0-or-later</span>
                  </div>
                  <div className="workspace-about-notice">
                    <p className="workspace-about-copyright">Copyright © PeakHorologyLLC</p>
                    <p>
                      Mintr is free software: you can redistribute it and/or modify it under the terms of the GNU General
                      Public License as published by the Free Software Foundation, either version 3 of the License, or (at
                      your option) any later version.
                    </p>
                    <p>
                      Mintr is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the
                      implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
                      License for more details.
                    </p>
                    <p>
                      Mintr includes OpenCascade Technology (LGPL-2.1 with the Open CASCADE exception), brepjs and
                      manifold-3d (Apache-2.0), three.js, React, Next.js, Electron, and other components under their own
                      licenses. See the third-party notices for the full list and license texts.
                    </p>
                  </div>
                  <div className="workspace-about-actions">
                    {LEGAL_DOCUMENTS.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`workspace-hotkey-reset${legalDocument === entry.id ? " active" : ""}`}
                        aria-pressed={legalDocument === entry.id}
                        onClick={() => setLegalDocument((current) => (current === entry.id ? null : entry.id))}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                  {legalDocument ? (
                    <pre className="workspace-about-document" tabIndex={0} aria-label={LEGAL_DOCUMENTS.find((entry) => entry.id === legalDocument)?.label}>
                      {legalText ?? "Loading…"}
                    </pre>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="workspace-modal-footer">
              {activeSection === "hotkeys" ? (
                <span>Hotkeys save as you change them. L is Align in geometry and Line in a sketch; D is Drop vs Dimension.</span>
              ) : activeSection === "tools" || activeSection === "files" || activeSection === "about" || activeSection === "help" ? (
                <span>
                  {activeSection === "tools"
                    ? "Tool help is a reference only — it does not change project defaults."
                    : activeSection === "help"
                      ? "Your design is not included. A problem report can add a saved crash note."
                    : activeSection === "about"
                      ? "The desktop app also ships LICENSE.txt, THIRD-PARTY-NOTICES.txt, and SOURCE-OFFER.txt in its install folder, and under Help in the menu bar."
                      : "Download folder is remembered on this computer."}
                </span>
              ) : (
                <>
                  <span>
                    {context === "app"
                      ? "Save these settings as the default for new projects."
                      : "Save the current settings for this project."}
                  </span>
                  <PeakTipButton
                    className="make-default-button"
                    label="Make default"
                    description={context === "app" ? SETTING_TIPS.makeDefaultApp : SETTING_TIPS.makeDefault}
                    onClick={() => {
                      onMakeDefault();
                      setDefaultSaved(true);
                    }}
                  >
                    {defaultSaved ? "Default saved" : "Make default"}
                  </PeakTipButton>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <button className="workspace-modal-backdrop" aria-label="Close settings" onClick={onClose} />
    </div>
  );
}

function WorkspaceToggle({
  label,
  tip,
  checked,
  onChange,
}: {
  label: string;
  tip: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <PeakTipLabel label={tip} helpTitle={label} description={tip} className="workspace-toggle">
      <span>{label}</span>
      <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
    </PeakTipLabel>
  );
}

function WorkspaceSelect({
  label,
  tip,
  value,
  options,
  onChange,
}: {
  label: string;
  tip: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <PeakTipLabel label={tip} helpTitle={label} description={tip} className="workspace-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </PeakTipLabel>
  );
}
