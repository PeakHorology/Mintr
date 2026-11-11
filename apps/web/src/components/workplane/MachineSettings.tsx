"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LaserIcon, Printer3dIcon } from "@/components/icons";
import { PeakTipLabel } from "@/components/workplane/ToolNameTooltip";
import { WorkspaceSelect, WorkspaceToggle } from "@/components/workplane/SettingsControls";
import {
  CUT_FILE_STYLES,
  LASER_TYPE_LABEL,
  laserBrands,
  laserPresetById,
  laserPresetPatch,
  lasersForBrand,
  loadMachineChoice,
  MACHINES_EVENT,
  machineHasLaser,
  LASER_MATERIALS,
  materialById,
  MAX_KERF_MM,
  MAX_NEST_GAP_MM,
  MAX_SHEET_MM,
  MIN_KERF_MM,
  MIN_NEST_GAP_MM,
  MIN_SHEET_MM,
  saveMachineChoice,
  type LaserType,
  type MachineChoice,
} from "@/lib/laserMachine";
import {
  COMMON_CRYSTAL_SIZES,
  CRYSTAL_MATERIAL_ID,
  CRYSTAL_SIZES_EVENT,
  crystalSizeLabel,
  DEFAULT_CRYSTAL,
  forgetCrystalSize,
  loadSavedCrystalSizes,
  MAX_CRYSTAL_MARGIN,
  MAX_CRYSTAL_MM,
  MIN_CRYSTAL_MM,
  sameCrystalSize,
  saveCrystalSize,
  type CrystalSize,
} from "@/lib/laser/crystal";
import { fitTestKerfs, fitTestLabel } from "@/lib/laser/fitTest";
import { SETTING_TIPS } from "@/lib/settingGuides";
import type { WorkplaneWorkspaceSettings } from "@/types/sketchforge";

/** This computer's machine choice, kept up to date when Settings changes it. */
export function useMachineChoice(): MachineChoice {
  const [choice, setChoice] = useState<MachineChoice>("printer");
  useEffect(() => {
    const sync = () => setChoice(loadMachineChoice());
    sync();
    window.addEventListener(MACHINES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(MACHINES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return choice;
}

const MACHINE_OPTIONS: readonly { id: MachineChoice; label: string }[] = [
  { id: "printer", label: "3D printer" },
  { id: "laser", label: "Laser" },
  { id: "both", label: "Both" },
];

const LASER_TYPES: readonly LaserType[] = ["diode", "co2", "infrared", "uv"];

function materialOptionLabel(id: string) {
  const material = materialById(id);
  if (material.id === CRYSTAL_MATERIAL_ID) return material.label;
  return material.id === "custom" ? "Other" : `${material.label} ${material.thickness} mm`;
}

/** The sizes this person saved, kept up to date when they save or forget one. */
function useSavedCrystalSizes() {
  const [sizes, setSizes] = useState<CrystalSize[]>([]);
  useEffect(() => {
    const sync = () => setSizes(loadSavedCrystalSizes());
    sync();
    window.addEventListener(CRYSTAL_SIZES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CRYSTAL_SIZES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return sizes;
}

const CUSTOM_SIZE = "Type a size";

/** The crystal blank: a block or ball, picked from saved and common sizes or typed in. */
function CrystalSettings({
  workspace,
  patchWorkspace,
}: {
  workspace: WorkplaneWorkspaceSettings;
  patchWorkspace: (patch: Partial<WorkplaneWorkspaceSettings>) => void;
}) {
  const saved = useSavedCrystalSizes();
  const crystal = workspace.crystal ?? DEFAULT_CRYSTAL;
  const patchCrystal = (patch: Partial<WorkplaneWorkspaceSettings["crystal"]>) => patchWorkspace({ crystal: { ...crystal, ...patch } });
  const choices = [
    ...saved.map((size) => ({ size, label: `${crystalSizeLabel(size)} (saved)` })),
    ...COMMON_CRYSTAL_SIZES.map((size) => ({ size, label: crystalSizeLabel(size) })),
  ];
  const current = choices.find((choice) => sameCrystalSize(choice.size, crystal));
  const isSaved = saved.some((size) => sameCrystalSize(size, crystal));
  const isCommon = COMMON_CRYSTAL_SIZES.some((size) => sameCrystalSize(size, crystal));
  const { margin: _margin, ...size } = crystal;
  return (
    <>
      <div className="workspace-section-heading">
        <strong>Crystal</strong>
        <span>The blank the model is engraved inside. It shows on the workplane as frosted glass.</span>
      </div>
      <WorkspaceSelect
        label="Size"
        tip={SETTING_TIPS.crystalSize}
        value={current?.label ?? CUSTOM_SIZE}
        options={[...choices.map((choice) => choice.label), CUSTOM_SIZE]}
        onChange={(label) => {
          const choice = choices.find((entry) => entry.label === label);
          if (choice) patchCrystal(choice.size);
        }}
      />
      <WorkspaceSelect
        label="Shape"
        tip={SETTING_TIPS.crystalSize}
        value={crystal.shape === "ball" ? "Ball" : "Block"}
        options={["Block", "Ball"]}
        onChange={(label) => patchCrystal({ shape: label === "Ball" ? "ball" : "block" })}
      />
      <div className="workspace-dimensions">
        {crystal.shape === "ball" ? (
          <NumberSetting label="Diameter" tip="Across the ball, in millimetres." value={crystal.diameter} min={MIN_CRYSTAL_MM} max={MAX_CRYSTAL_MM} step={0.5} onCommit={(diameter) => patchCrystal({ diameter })} />
        ) : (
          <>
            <NumberSetting label="Width" tip="The block left to right, in millimetres." value={crystal.width} min={MIN_CRYSTAL_MM} max={MAX_CRYSTAL_MM} step={0.5} onCommit={(width) => patchCrystal({ width })} />
            <NumberSetting label="Depth" tip="The block front to back, in millimetres." value={crystal.depth} min={MIN_CRYSTAL_MM} max={MAX_CRYSTAL_MM} step={0.5} onCommit={(depth) => patchCrystal({ depth })} />
            <NumberSetting label="Height" tip="The block bottom to top, in millimetres." value={crystal.height} min={MIN_CRYSTAL_MM} max={MAX_CRYSTAL_MM} step={0.5} onCommit={(height) => patchCrystal({ height })} />
          </>
        )}
        <NumberSetting label="Margin" tip={SETTING_TIPS.crystalMargin} value={crystal.margin} min={0} max={MAX_CRYSTAL_MARGIN} step={0.5} onCommit={(margin) => patchCrystal({ margin })} />
      </div>
      {isCommon ? null : (
        <button type="button" className="crystal-size-save" onClick={() => (isSaved ? forgetCrystalSize(size) : saveCrystalSize(size))}>
          {isSaved ? "Remove from my sizes" : "Save to my sizes"}
        </button>
      )}
    </>
  );
}

/**
 * Fit test: cut a comb and key, push the key into each slot, and click the number
 * by the slot it fits snugly. That number is the kerf in hundredths of a millimetre.
 */
function FitTest({
  workspace,
  patchWorkspace,
  onAdd,
}: {
  workspace: WorkplaneWorkspaceSettings;
  patchWorkspace: (patch: Partial<WorkplaneWorkspaceSettings>) => void;
  onAdd?: () => void;
}) {
  const kerfs = fitTestKerfs(workspace.laserType);
  return (
    <div className="fit-test">
      <p className="machine-laser-type">
        {onAdd
          ? "Not sure of the kerf? Cut a fit test, push the key into each slot, and pick the number by the one it fits snugly."
          : "Cut a fit test from a laser design, then pick the number by the slot the key fits snugly."}
      </p>
      {onAdd ? (
        <button type="button" className="fit-test-add" onClick={onAdd}>
          Add a fit test to this design
        </button>
      ) : null}
      <div className="fit-test-slots" role="group" aria-label="Slot the key fit">
        {kerfs.map((kerf) => {
          const label = fitTestLabel(kerf);
          const active = Math.abs(workspace.kerfMm - kerf) < 1e-6;
          return (
            <button
              key={label}
              type="button"
              className={active ? "active" : undefined}
              aria-pressed={active}
              title={`Slot ${label} fit: kerf ${kerf.toFixed(2)} mm`}
              onClick={() => patchWorkspace({ kerfMm: kerf })}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A number box that only changes the setting when you leave it or press Enter. */
function NumberSetting({
  label,
  tip,
  value,
  min,
  max,
  step,
  unit = "mm",
  onCommit,
}: {
  label: string;
  tip: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number.parseFloat(draft);
    const next = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <PeakTipLabel data-sage-key={undefined} label={tip} helpTitle={label} description={tip}>
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        aria-label={`${label} in ${unit === "mm" ? "millimetres" : unit}`}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </PeakTipLabel>
  );
}

/** One machine's settings, set apart in a panel with its own header. */
function MachineGroup({ icon, title, note, children }: { icon: ReactNode; title: string; note: string; children: ReactNode }) {
  return (
    <section className="machine-group" aria-label={`${title} settings`}>
      <header className="machine-group-header">
        <span className="machine-group-icon" aria-hidden="true">{icon}</span>
        <span className="machine-group-title">
          <strong>{title}</strong>
          <span>{note}</span>
        </span>
      </header>
      {children}
    </section>
  );
}

/**
 * Settings → Machines: what this person makes with, then the settings for each machine:
 * the 3D printer (passed in as `printerSettings`), and the laser and the sheet it cuts.
 */
export function MachineSettings({
  workspace,
  patchWorkspace,
  context,
  onAddFitTest,
  printerSettings,
}: {
  workspace: WorkplaneWorkspaceSettings;
  patchWorkspace: (patch: Partial<WorkplaneWorkspaceSettings>) => void;
  context: "project" | "app";
  /** Set in a laser design, where a fit test can be added. */
  onAddFitTest?: () => void;
  /** The 3D printer settings, shown after the machine choice when there is a printer. */
  printerSettings?: ReactNode;
}) {
  const machines = useMachineChoice();
  const preset = laserPresetById(workspace.laserPreset);
  const custom = preset.id === "custom";
  const models = lasersForBrand(preset.brand);
  const material = materialById(workspace.materialPreset);
  const laserDesign = workspace.designKind === "laser";
  return (
    <>
      <div className="workspace-section-heading">
        <strong>Machines</strong>
        <span>What you make with. Mintr shows the tools for your machines and hides the rest.</span>
      </div>
      <div className="machine-choice" role="radiogroup" aria-label="What you make with" data-sage-key="setting:machines">
        {MACHINE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={machines === option.id}
            className={machines === option.id ? "active" : ""}
            onClick={() => saveMachineChoice(option.id)}
          >
            <span className="machine-choice-icons" aria-hidden="true">
              {option.id !== "laser" ? <Printer3dIcon size={20} /> : null}
              {option.id !== "printer" ? <LaserIcon size={20} /> : null}
            </span>
            <span>{option.label}</span>
          </button>
        ))}
      </div>
      <p className="machine-choice-note">
        {machines === "printer"
          ? "Every design is made for your 3D printer."
          : machines === "laser"
            ? "New designs are laser cut. You can still start a 3D print design from New design."
            : "Each new design asks whether it is printed or laser cut."}
      </p>
      {printerSettings ? (
        <MachineGroup
          icon={<Printer3dIcon size={22} />}
          title="3D printer"
          note="Your printer, its build size, print checks and slicer."
        >
          {printerSettings}
        </MachineGroup>
      ) : null}
      {machineHasLaser(machines) || laserDesign ? (
        <MachineGroup
          icon={<LaserIcon size={22} />}
          title="Laser"
          note="Your laser, kerf and fit test, cut files, and the material you are working with."
        >
          <WorkspaceSelect
            label="Brand"
            tip={SETTING_TIPS.laserBrand}
            value={preset.brand}
            options={laserBrands()}
            onChange={(brand) => patchWorkspace(laserPresetPatch(lasersForBrand(brand)[0].id, workspace))}
          />
          <WorkspaceSelect
            label="Laser"
            tip={SETTING_TIPS.laser}
            value={preset.label}
            options={models.map((entry) => entry.label)}
            onChange={(label) => {
              const next = models.find((entry) => entry.label === label);
              if (next) patchWorkspace(laserPresetPatch(next.id, workspace));
            }}
          />
          {custom ? (
            <WorkspaceSelect
              label="Laser type"
              tip={SETTING_TIPS.laserType}
              value={LASER_TYPE_LABEL[workspace.laserType]}
              options={LASER_TYPES.map((type) => LASER_TYPE_LABEL[type])}
              onChange={(label) => {
                const type = LASER_TYPES.find((entry) => LASER_TYPE_LABEL[entry] === label);
                if (type) patchWorkspace({ laserType: type });
              }}
            />
          ) : (
            <p className="machine-laser-type">{LASER_TYPE_LABEL[preset.type]} laser · {preset.width} × {preset.depth} mm work area</p>
          )}
          {custom ? (
            <div className="workspace-dimensions">
              <NumberSetting label="Width" tip="Work area left to right, in millimetres." value={workspace.laserWidth} min={40} max={3000} step={1} onCommit={(laserWidth) => patchWorkspace({ laserWidth })} />
              <NumberSetting label="Depth" tip="Work area front to back, in millimetres." value={workspace.laserDepth} min={40} max={3000} step={1} onCommit={(laserDepth) => patchWorkspace({ laserDepth })} />
            </div>
          ) : null}
          <div className="workspace-dimensions">
            <NumberSetting label="Kerf" tip={SETTING_TIPS.kerf} value={workspace.kerfMm} min={MIN_KERF_MM} max={MAX_KERF_MM} step={0.01} onCommit={(kerfMm) => patchWorkspace({ kerfMm })} />
            <NumberSetting label="Gap" tip={SETTING_TIPS.nestGap} value={workspace.nestGapMm} min={MIN_NEST_GAP_MM} max={MAX_NEST_GAP_MM} step={0.5} onCommit={(nestGapMm) => patchWorkspace({ nestGapMm })} />
          </div>
          <FitTest workspace={workspace} patchWorkspace={patchWorkspace} onAdd={onAddFitTest} />
          <WorkspaceSelect
            label="Cut files for"
            tip={SETTING_TIPS.cutFileStyle}
            value={CUT_FILE_STYLES.find((style) => style.id === workspace.cutFileStyle)?.label ?? "LightBurn"}
            options={CUT_FILE_STYLES.map((style) => style.label)}
            onChange={(label) => {
              const style = CUT_FILE_STYLES.find((entry) => entry.label === label);
              if (style) patchWorkspace({ cutFileStyle: style.id });
            }}
          />
          <p className="machine-laser-type">{CUT_FILE_STYLES.find((style) => style.id === workspace.cutFileStyle)?.description}</p>
          <WorkspaceToggle
            label="Show laser bed"
            tip={SETTING_TIPS.showLaserBed}
            checked={workspace.showLaserBed}
            onChange={(showLaserBed) => patchWorkspace({ showLaserBed })}
          />
          <div className="workspace-section-heading">
            <strong>Material</strong>
            <span>What you cut or engrave. For a sheet, new parts start at its thickness.</span>
          </div>
          <WorkspaceSelect
            label="Material"
            tip={SETTING_TIPS.laserMaterial}
            value={materialOptionLabel(material.id)}
            options={LASER_MATERIALS.map((entry) => materialOptionLabel(entry.id))}
            onChange={(label) => {
              const next = LASER_MATERIALS.find((entry) => materialOptionLabel(entry.id) === label);
              if (!next) return;
              // Crystal and Other keep the sheet thickness that was set, for when the design goes back to a sheet.
              patchWorkspace(next.id === "custom" || next.id === CRYSTAL_MATERIAL_ID
                ? { materialPreset: next.id, materialThickness: workspace.materialThickness }
                : { materialPreset: next.id, materialThickness: next.thickness });
            }}
          />
          {material.id === CRYSTAL_MATERIAL_ID ? <CrystalSettings workspace={workspace} patchWorkspace={patchWorkspace} /> : (
          <div className="workspace-dimensions">
            <NumberSetting
              label="Thickness"
              tip={SETTING_TIPS.sheetThickness}
              value={workspace.materialThickness}
              min={MIN_SHEET_MM}
              max={MAX_SHEET_MM}
              step={0.1}
              // A measured sheet keeps its material: plywood that is really 3.2 mm is still plywood.
              onCommit={(materialThickness) => patchWorkspace({ materialThickness })}
            />
          </div>
          )}
        </MachineGroup>
      ) : null}
    </>
  );
}
