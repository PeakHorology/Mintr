/** What each setting does. The Settings window shows these on right-click; Sage explains and finds them. */
export const SETTING_TIPS = {
  showShadows: "Cast soft shadows from shapes onto the workplane to make depth easier to read.",
  showGrid: "Show or hide the grid lines drawn on the workplane.",
  displayQuality: "How densely curved surfaces are tessellated in the viewport and for booleans. Standard is the everyday setting. Smooth looks rounder and is heavier; Draft is faster on large scenes.",
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
  printerProcess: "Filament printers melt plastic through a nozzle. Resin printers cure liquid in a vat. Each process has its own machines.",
  printerBrand: "The maker of the printer. The next menu lists that maker's machines for the selected process.",
  printer: "The machine you print on. Filament and resin both use this build volume. Parts that stick past it are marked.",
  overhang: "Faces that lean past this many degrees from vertical are marked. 45° is typical for filament. Resin usually needs less, or none. The viewport updates as you change it.",
  showPrinterBed: "Draw the printer's bed and height cage on the workplane.",
  showOverhangStripes: "Show a gold wash and mint outline on faces that lean past the overhang angle. Meant for filament supports.",
  nozzle: "Walls and holes smaller than this are marked. For filament this is the nozzle diameter. For resin it is the smallest wall or hole you want to print.",
  showThinWalls: "Show a mint wash and gold outline on walls thinner than the nozzle or minimum wall.",
  showSmallHoles: "Show a mint wash and mint outline on holes and slots narrower than the nozzle or minimum wall.",
  showTrappedResin: "Show a gold wash on sealed cavities that would hold uncured resin. Open a drain to the outside to clear them. Hollow is unchanged.",
  makeDefault: "Save these settings as the default for this project.",
  makeDefaultApp: "Save these settings as the default for new projects.",
  peakcadPro: "Show sketch constraints, driving dimensions, and other advanced modeling tools on every project. Leave this off while learning the basics.",
  failureNoticesOnly: "Hide coaching and “select something first” messages. A command that fails still appears. Prompts you answer, such as Click a face, stay.",
  uiTheme: "Switch Mintr between light and dark. Applies to the home page and your designs.",
  hideTutorials: "Take the tutorial cards off the home page. Finished tutorials leave on their own. This list stays here.",
  downloadFolder: "Local folder used for exported files and downloads on this computer.",
  sageEnabled: "Show the Sage button, its shortcut, and Sage search. Switch it off to hide Sage everywhere.",
} as const;

export type SettingTipKey = keyof typeof SETTING_TIPS;

export type SettingsSectionId =
  | "general" | "appearance" | "measurement" | "workplane" | "sketch" | "printing" | "files" | "fonts"
  | "hotkeys" | "tools" | "tutorials" | "models" | "updates" | "help" | "about";

/** Tab names in the Settings window, in their order. */
export const SETTINGS_SECTION_LABEL: Record<SettingsSectionId, string> = {
  general: "General",
  appearance: "Appearance",
  measurement: "Measurement",
  workplane: "Workplane",
  sketch: "Sketch",
  printing: "Printing",
  files: "Files",
  fonts: "Fonts",
  hotkeys: "Keyboard shortcuts",
  tools: "Sage",
  tutorials: "Tutorials",
  models: "AI models",
  updates: "Updates",
  help: "Help/Feedback",
  about: "About",
};

export type SettingGuide = { key: SettingTipKey; title: string; section: SettingsSectionId };

/** The settings Sage can explain and find, with the name each shows in Settings. */
export const SETTING_GUIDES: readonly SettingGuide[] = [
  { key: "peakcadPro", title: "Mintr Pro", section: "general" },
  { key: "failureNoticesOnly", title: "Hide tips and reminders", section: "general" },
  { key: "cruiseShapes", title: "Move the camera while placing a shape", section: "general" },
  { key: "zoomSpeed", title: "Zoom speed", section: "general" },
  { key: "uiTheme", title: "Theme", section: "appearance" },
  { key: "showShadows", title: "Show shadows", section: "appearance" },
  { key: "showGrid", title: "Show grid", section: "appearance" },
  { key: "displayQuality", title: "Display quality", section: "appearance" },
  { key: "units", title: "Units", section: "measurement" },
  { key: "scale", title: "Scale", section: "measurement" },
  { key: "accuracy", title: "Accuracy", section: "measurement" },
  { key: "snapGrid", title: "Snap grid", section: "measurement" },
  { key: "workplaneSize", title: "Workplane size", section: "workplane" },
  { key: "gridBlockSize", title: "Grid block size", section: "workplane" },
  { key: "printerProcess", title: "Printing process", section: "printing" },
  { key: "printerBrand", title: "Printer brand", section: "printing" },
  { key: "printer", title: "Printer", section: "printing" },
  { key: "showPrinterBed", title: "Show printer bed", section: "printing" },
  { key: "overhang", title: "Overhang angle", section: "printing" },
  { key: "showOverhangStripes", title: "Show overhangs", section: "printing" },
  { key: "nozzle", title: "Nozzle or minimum wall", section: "printing" },
  { key: "showThinWalls", title: "Show thin walls", section: "printing" },
  { key: "showSmallHoles", title: "Show small holes", section: "printing" },
  { key: "showTrappedResin", title: "Show trapped resin", section: "printing" },
  { key: "downloadFolder", title: "Download folder", section: "files" },
  { key: "hideTutorials", title: "Hide tutorials", section: "tutorials" },
  { key: "sageEnabled", title: "Show Sage", section: "tools" },
];

const KEY_BY_TIP = new Map<string, SettingTipKey>(
  (Object.entries(SETTING_TIPS) as Array<[SettingTipKey, string]>).map(([key, tip]) => [tip, key]),
);

/** The Sage key for a setting row, from the help text it already carries. */
export function settingSageKey(tip: string): string | undefined {
  const key = KEY_BY_TIP.get(tip);
  return key ? `setting:${key.toLowerCase()}` : undefined;
}
