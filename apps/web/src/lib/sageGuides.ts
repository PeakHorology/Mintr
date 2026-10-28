import { formatHotkeyBinding, loadHotkeyBindings, type HotkeyActionId } from "@/lib/hotkeys";
import { SETTING_GUIDES, SETTING_TIPS, SETTINGS_SECTION_LABEL, type SettingsSectionId } from "@/lib/settingGuides";

export type SagePicture =
  | "line"
  | "arc"
  | "curve"
  | "rectangle"
  | "circle"
  | "select"
  | "offset"
  | "sketch-fillet"
  | "sketch-chamfer"
  | "trim"
  | "sketch-mirror"
  | "erase"
  | "bend"
  | "smooth"
  | "sketch-linear"
  | "sketch-circular"
  | "lineweight"
  | "dimension"
  | "extrude"
  | "revolve"
  | "sweep"
  | "coincident"
  | "horizontal"
  | "vertical"
  | "equal"
  | "parallel"
  | "right-angle"
  | "tangent"
  | "midpoint"
  | "concentric"
  | "fix"
  | "symmetry"
  | "duplicate"
  | "duplicate-repeat"
  | "group"
  | "ungroup"
  | "tie"
  | "intersect"
  | "chamfer"
  | "fillet"
  | "push-pull"
  | "pad-pocket"
  | "split"
  | "align"
  | "snap"
  | "lay-flat"
  | "mirror"
  | "circular-pattern"
  | "linear-pattern"
  | "ruler"
  | "box-maker"
  | "flat-parts"
  | "nest";

export type SageGuide = {
  title: string;
  what: string;
  steps: string[];
  hotkey?: HotkeyActionId;
  /** Animated gesture diagram, drawn in SagePictures. */
  picture?: SagePicture;
};

const GUIDE_LIST: Array<SageGuide & { keys: string[] }> = [
  { keys: ["sage"], title: "Sage", what: "Explains the tool under your pointer.", steps: ["Click the Sage button at the top, or press its shortcut.", "Hover a button to read what it is for.", "Click the Sage button again to hide Sage."], hotkey: "sage" },
  { keys: ["undo"], title: "Undo", what: "Steps back through the last change.", steps: ["Click Undo, or press the shortcut.", "A sketch line and a change to a solid share one list."], hotkey: "undo" },
  { keys: ["redo"], title: "Redo", what: "Brings back the last change you undid.", steps: ["Undo something first.", "Click Redo to put that change back."], hotkey: "redo" },
  { keys: ["history"], title: "History", what: "Shows earlier steps without changing the model until you restore one.", steps: ["Click History.", "Pick a step to return the design to that point."] },
  { keys: ["copy"], title: "Copy", what: "Copies the selected shapes, including a group’s history.", steps: ["Select what you want.", "Click Copy, then Paste."], hotkey: "copy" },
  { keys: ["paste"], title: "Paste", what: "Places copied shapes on the workplane.", steps: ["Copy or cut something first.", "Click Paste. Groups stay groups."], hotkey: "paste" },
  { keys: ["duplicate"], title: "Duplicate", what: "Makes a copy sitting on the original.", steps: ["Select a shape.", "Click Duplicate, then move the copy."], hotkey: "duplicate", picture: "duplicate" },
  { keys: ["duplicate and repeat"], title: "Duplicate and repeat", what: "Copies the selection and keeps repeating the same move.", steps: ["Select a shape and duplicate it once so Mintr knows the offset.", "Click Duplicate and repeat to add another copy at that same spacing."], hotkey: "duplicateRepeat", picture: "duplicate-repeat" },
  { keys: ["delete"], title: "Delete", what: "Removes the selected shapes.", steps: ["Select what should go.", "Click Delete."], hotkey: "delete" },
  { keys: ["group"], title: "Group", what: "Fuses the selected shapes into one solid. A hole cuts the solids.", steps: ["Select two or more shapes.", "Click Group. If they do not fuse exactly, Mintr keeps a mesh."] , hotkey: "group", picture: "group" },
  { keys: ["tie"], title: "Tie", what: "Keeps shapes separate and moves them together.", steps: ["Select the shapes that should stay a set.", "Click Tie. They move as one and do not fuse."], picture: "tie" },
  { keys: ["ungroup"], title: "Ungroup", what: "Unwraps one level of the last Group.", steps: ["Select a grouped shape.", "Click Ungroup. Nested groups unwrap one level at a time."], hotkey: "ungroup", picture: "ungroup" },
  { keys: ["intersect"], title: "Intersect", what: "Keeps only the volume where the selected shapes overlap.", steps: ["Select the shapes that overlap.", "Click Intersect. Everything outside the overlap is removed."], picture: "intersect" },
  { keys: ["chamfer"], title: "Chamfer", what: "Cuts a flat bevel along the edges you pick.", steps: ["Select one solid.", "Click Chamfer, then the edges, and set the distance."], picture: "chamfer" },
  { keys: ["fillet"], title: "Fillet", what: "Rounds the edges you pick.", steps: ["Select one solid.", "Click Fillet, then the edges, and set the radius."], picture: "fillet" },
  { keys: ["push pull"], title: "Push Pull", what: "Grows or shrinks a solid by dragging a flat face.", steps: ["Select one solid.", "Click Push Pull, drag a face, then Apply."], picture: "push-pull" },
  { keys: ["pad/pocket"], title: "Pad/Pocket", what: "Grows a pad off a face or cuts a pocket into it.", steps: ["Select one solid.", "Click Pad/Pocket, then a flat face.", "Choose Out or In, and set the depth."], picture: "pad-pocket" },
  { keys: ["texture"], title: "Texture", what: "Gives a part a surface you can feel, from knurl and leather to your own picture or words. Holes and faces that touch another part stay smooth, so things still fit.", steps: ["Click Texture, then click the part.", "Pick a pattern from the gallery, Text to type words, or Your picture to use an image. Set its size and depth.", "To put a picture or words in one place, choose Once, then click the part. Drag to move it, and scroll over it to change its size.", "To texture only some sides, choose Faces: Choose, then click each side you want. Chosen sides are tinted.", "Click Apply. If the pattern is too fine for your printer, Fit to my printer fixes it. Save this texture keeps it for other parts."] },
  { keys: ["split"], title: "Split", what: "Cuts the selected object into two pieces.", steps: ["Select one solid.", "Click Split and choose the cut.", "A dovetail, plug, snap, or thread can join the pieces afterward."], picture: "split" },
  { keys: ["align"], title: "Align", what: "Lines selected shapes up with each other.", steps: ["Select two or more shapes.", "Click Align and choose the side or center."], hotkey: "align", picture: "align" },
  { keys: ["snap"], title: "Snap", what: "Moves a face onto another face.", steps: ["Click Snap.", "Click the face that should move, then the face it should meet."], picture: "snap" },
  { keys: ["lay flat"], title: "Lay flat", what: "Turns a shape so a face sits on the workplane.", steps: ["Click Lay flat.", "Click the face that should lie on the bed."], picture: "lay-flat" },
  { keys: ["mirror"], title: "Mirror", what: "Copies selected shapes across a plane.", steps: ["Select the shapes.", "Click Mirror and choose the plane."] , hotkey: "mirror", picture: "mirror" },
  { keys: ["circular pattern"], title: "Circular pattern", what: "Copies the selection around a center.", steps: ["Select a shape.", "Click Circular pattern, click the center, and set how many copies."], picture: "circular-pattern" },
  { keys: ["linear pattern"], title: "Linear pattern", what: "Copies the selection in rows.", steps: ["Select a shape.", "Click Linear pattern.", "Set the count and spacing along width, length, or height."], picture: "linear-pattern" },
  { keys: ["box maker", "finger joint"], title: "Box maker", what: "Makes a box that slots together, cut from your sheet. Every panel gets fingers sized to the sheet's thickness.", steps: ["Click Box maker.", "Type the width, depth and height, and choose outside or inside size, with a lid or an open top.", "Click Make box. The panels land on the bed, ready to cut."], picture: "box-maker" },
  { keys: ["flat parts"], title: "Flat parts", what: "Turns a 3D part into flat parts you can cut: stacked layers to glue together, or slotted slices that push together crosswise.", steps: ["Paste a model in from a 3D print design, or make one here, and select it.", "Click Flat parts and choose Stacked layers or Slotted slices.", "Click Make parts. The 3D part is hidden, not deleted."], picture: "flat-parts" },
  { keys: ["trace logo", "logo", "png", "picture to outline"], title: "Trace logo", what: "Turns a logo picture into outlines the laser can follow, with no other program needed. Made for logos, text and simple drawings with solid shapes, not photos.", steps: ["Click Trace logo and choose a PNG or JPG.", "Check the preview. Move How dark counts until the logo looks right, and raise Ignore specks to drop dust.", "Type the width, choose Engrave, Cut or Score, and click Make part."] },
  { keys: ["nest", "pack"], title: "Nest", what: "Packs parts close together on the laser bed, turning them where that fits better, so a sheet goes further.", steps: ["Select the parts to pack, or select nothing to pack them all.", "Click Nest. Parts that need another sheet are laid out beside the bed."], picture: "nest" },
  { keys: ["laser-job"], title: "Cut, score or engrave", what: "Sets what the laser does with this part. Cut goes right through, score draws a line on the surface, and engrave burns the whole area.", steps: ["Select a part.", "Choose Cut, Score or Engrave in the inspector.", "On the bed, cut parts are outlined red, scored ones blue, and engraved ones look burnt."] },
  { keys: ["open in xtool studio", "open in lightburn"], title: "Open in your laser program", what: "Saves the cut file to Downloads and opens it in your laser program. xTool Studio gets cut, score and engrave already set.", steps: ["For xTool Studio, open it first. It won't start on its own for this.", "Click Export, then Open in.", "In the laser program, pick your material, then start the job."] },
  { keys: ["save cut file"], title: "Save cut file", what: "Saves an SVG of every part at true size: red cuts, blue scores, black engraves. LightBurn, xTool Studio and Glowforge all open it.", steps: ["Click Export.", "Click Save cut file. The kerf is allowed for, so parts come out the size drawn."] },
  { keys: ["save as dxf"], title: "Save as DXF", what: "Saves the cut file as a DXF, with a layer each for cut, score and engrave.", steps: ["Click Export.", "Click Save as DXF, for laser programs that prefer DXF."] },
  { keys: ["select"], title: "Select", what: "Picks sketch points, lines, and whole shapes.", steps: ["Click a line to select that line.", "Click inside a closed shape to select the whole shape, then drag to move it."], picture: "select" },
  { keys: ["line"], title: "Line", what: "Draws straight segments.", steps: ["Click the start.", "Click the next point. Type 50<30 for a length and an angle, or hold Shift for 15° steps.", "Click the first point again to close a shape."], hotkey: "sketchLine", picture: "line" },
  { keys: ["arc"], title: "Arc", what: "Draws an arc through three clicks.", steps: ["Click the start.", "Click the end.", "Click a point the arc should pass through."], picture: "arc" },
  { keys: ["curve"], title: "Curve", what: "Draws a smooth bend you can pull with handles.", steps: ["Click a point and drag to pull the handle.", "Click the next point.", "Close on the first point when the shape should be a loop."], picture: "curve" },
  { keys: ["rectangle"], title: "Rectangle", what: "Draws a rectangle from corner to corner.", steps: ["Click one corner.", "Drag to the opposite corner and release."], hotkey: "sketchRectangle", picture: "rectangle" },
  { keys: ["circle"], title: "Circle", what: "Draws a circle from its center.", steps: ["Click the center.", "Drag out to the radius and release."], hotkey: "sketchCircle", picture: "circle" },
  { keys: ["shapes"], title: "Shapes", what: "Opens the ready-made outlines.", steps: ["Click Shapes.", "Pick square, rounded, slot, triangle, polygon, star, or ellipse.", "Click and drag on the sheet to size it."] },
  { keys: ["sketch-shape"], title: "Shape", what: "Places a ready-made outline.", steps: ["Choose the shape.", "Click one corner, or the center for a polygon or star.", "Drag to size it."] },
  { keys: ["offset"], title: "Offset", what: "Copies an outline inside or outside itself.", steps: ["Select a closed shape, or one line.", "Click Offset and type the distance, or drag an edge.", "The copy is its own shape."], picture: "offset" },
  { keys: ["sketch-fillet"], title: "Fillet", what: "Rounds a sketch corner.", steps: ["Click Fillet.", "Click a corner, or click inside a shape to round its corners.", "Type the radius."], picture: "sketch-fillet" },
  { keys: ["sketch-chamfer"], title: "Chamfer", what: "Cuts a sketch corner straight across.", steps: ["Click Chamfer.", "Click a corner, or click inside a shape.", "Type the distance."], picture: "sketch-chamfer" },
  { keys: ["trim"], title: "Trim", what: "Removes the piece of a line you click, up to the nearest crossing.", steps: ["Click Trim.", "Click the piece that should disappear."], picture: "trim" },
  { keys: ["sketch-mirror"], title: "Mirror", what: "Copies the sketch across a straight line.", steps: ["Click Mirror.", "Click the straight line to use as the mirror.", "Everything else is copied across it."], picture: "sketch-mirror" },
  { keys: ["erase"], title: "Erase", what: "Removes sketch points and lines.", steps: ["Click Erase and drag across what should go.", "Click Erase again for one-click removal of a whole shape or line.", "Click Erase once more to return to the brush."], picture: "erase" },
  { keys: ["bend"], title: "Bend", what: "Adds a point on a line.", steps: ["Click Bend.", "Click a segment.", "On a curve the new point stays smooth. On a straight line it is a corner."], picture: "bend" },
  { keys: ["smooth"], title: "Smooth", what: "Curves the points you click.", steps: ["Click Smooth.", "Click each point that should become a bend.", "It stays on so you can curve several points."], picture: "smooth" },
  { keys: ["sketch-linear"], title: "Linear", what: "Copies sketch geometry in rows.", steps: ["Click Linear.", "Click a line to copy that line, or click inside a shape to copy the whole shape.", "Set the count and spacing."], picture: "sketch-linear" },
  { keys: ["sketch-circular"], title: "Circular", what: "Spins sketch copies around the middle.", steps: ["Click Circular.", "Click a line to spin that line, or click inside a shape to spin the whole shape.", "Set how many copies."], picture: "sketch-circular" },
  { keys: ["lineweight"], title: "Lineweight", what: "Sets how thick a line is drawn. The shape does not move.", steps: ["Click Lineweight.", "Click a line, or click inside a shape.", "Type a thickness. 1 is a hairline, 2.5 is standard, 8 is heavy.", "Lineweight stays on so you can set the next line too."], picture: "lineweight" },
  { keys: ["image"], title: "Image", what: "Lays a picture on the sheet to trace.", steps: ["Choose Select.", "Click Image and pick a picture."] },
  { keys: ["extrude"], title: "Extrude", what: "Turns a closed sketch into a solid.", steps: ["Close the outline.", "Click Extrude and set the height.", "Click Preview in 3D to check it, then finish, or go back to the sketch."], hotkey: "sketchExtrude", picture: "extrude" },
  { keys: ["revolve"], title: "Revolve", what: "Spins a sketch around a straight line.", steps: ["Click Revolve.", "Click the straight line to spin around.", "The profile becomes a solid. Revolve is only on the default workplane."], picture: "revolve" },
  { keys: ["sweep"], title: "Sweep", what: "Slides a profile along a path, like a circle along a bend to make a pipe.", steps: ["Click Sweep and draw the profile: the shape of a slice through the part, like a circle for a rod. Click Next.", "Draw the path the profile should follow, then click Sweep.", "The part is placed on the sheet. A profile you already drew counts as step 1."], picture: "sweep" },
  { keys: ["cancel"], title: "Cancel", what: "Leaves the sketch and drops unfinished geometry.", steps: ["Click Cancel.", "The sketch closes without making a solid."] },
  { keys: ["dimension"], title: "Dimension", what: "Adds a length that drives the sketch.", steps: ["Click Dimension.", "Click a line, or two points.", "Type the length. The sketch moves to match."], hotkey: "sketchDimension", picture: "dimension" },
  { keys: ["coincident"], title: "Coincident", what: "Joins two points so they stay together.", steps: ["Click Coincident.", "Click the first point, then the second."], picture: "coincident" },
  { keys: ["horizontal"], title: "Horizontal", what: "Keeps a line, or two points, level.", steps: ["Click Horizontal.", "Click the line, or the two points."], picture: "horizontal" },
  { keys: ["vertical"], title: "Vertical", what: "Keeps a line upright.", steps: ["Click Vertical.", "Click the line."], picture: "vertical" },
  { keys: ["equal"], title: "Equal", what: "Keeps two lines the same length.", steps: ["Click Equal.", "Click the first line, then the second."], picture: "equal" },
  { keys: ["parallel"], title: "Parallel", what: "Keeps two lines parallel.", steps: ["Click Parallel.", "Click the first line, then the second."], picture: "parallel" },
  { keys: ["right angle"], title: "Right angle", what: "Keeps two lines at 90 degrees.", steps: ["Click Right angle.", "Click the first line, then the second."], picture: "right-angle" },
  { keys: ["tangent"], title: "Tangent", what: "Keeps a line touching a circle at one point.", steps: ["Click Tangent.", "Click the line, then the circle."], picture: "tangent" },
  { keys: ["midpoint"], title: "Midpoint", what: "Locks a point to the middle of a line.", steps: ["Click Midpoint.", "Click the point, then the line."], picture: "midpoint" },
  { keys: ["concentric"], title: "Concentric", what: "Makes two circles share a center.", steps: ["Click Concentric.", "Click the first circle, then the second."], picture: "concentric" },
  { keys: ["fix"], title: "Fix", what: "Locks a point or a line so it cannot move.", steps: ["Click Fix.", "Click the point or the line."], picture: "fix" },
  { keys: ["symmetry"], title: "Symmetry", what: "Mirrors two points or lines across an axis.", steps: ["Click Symmetry.", "Click the pair, then the axis line."], picture: "symmetry" },
  { keys: ["exit full screen"], title: "Full screen", what: "Leaves full screen.", steps: ["Click the button, or press F11."] },
  { keys: ["import"], title: "Import", what: "Brings in a STEP, STL, 3MF, or SVG file.", steps: ["Click Import.", "Choose the file. You can bring a mesh in as a hole."] },
  { keys: ["save"], title: "Save", what: "Writes this design to its file.", steps: ["Click Save.", "A new file is .mintr. An open .peakcad file keeps that name."] },
  { keys: ["save as"], title: "Save as", what: "Writes this design to a new .mintr file.", steps: ["Click Save as.", "Choose the folder and the name."] },
  { keys: ["make a guide", "save as guide"], title: "Make a guide", what: "Turns this design into a guide someone can follow to build the same part, step by step.", steps: ["Build the model, then click Make a guide.", "Keep the steps worth learning, fold small ones together, and add tips. Click a step to see it in 3D.", "Click Preview as learner to check it, then Save guide."] },
  { keys: ["export"], title: "Export", what: "Writes the model out for printing or another program.", steps: ["Click Export.", "Choose STL, 3MF, STEP, or a blueprint."] },
  { keys: ["settings"], title: "Settings", what: "Opens units, grid, appearance, and the tool index.", steps: ["Click Settings.", "Change what you need and close the window."] },
  { keys: ["home"], title: "Home", what: "Returns to the project list.", steps: ["Click the Mintr mark.", "If the design has unsaved file changes, Mintr asks before leaving."] },
  { keys: ["full screen"], title: "Full screen", what: "Fills the screen with Mintr.", steps: ["Click Full screen, or press F11.", "Press F11 or the button again to leave."] },
  { keys: ["camera-home"], title: "Home", what: "Returns the camera to the starting view.", steps: ["Click Home.", "The model frames itself again."] },
  { keys: ["zoom in"], title: "Zoom in", what: "Moves the view closer.", steps: ["Click Zoom in.", "The model, or the sketch sheet, grows in the window."] },
  { keys: ["zoom out"], title: "Zoom out", what: "Moves the view farther away.", steps: ["Click Zoom out."] },
  { keys: ["bottom view", "top view", "front view", "back view", "right view", "left view"], title: "View", what: "Snaps the camera to that side of the model.", steps: ["Click a face of the cube.", "Drag the cube if you want to orbit instead."] },
  { keys: ["hide controls"], title: "Hide controls", what: "Tucks the camera buttons away.", steps: ["Click Hide controls.", "Click the arrow again to bring them back."] },
  { keys: ["show controls"], title: "Show controls", what: "Brings the camera buttons back.", steps: ["Click the arrow."] },
  { keys: ["ruler tools"], title: "Ruler tools", what: "Measures distances on the model.", steps: ["Click Ruler tools.", "Add a measurement, move its points, or delete one."], picture: "ruler" },
  { keys: ["x-ray view"], title: "X-ray view", what: "Looks through the model. The part and the export stay whole.", steps: ["Click X-ray view.", "Turn the cut on, and drag it if you want a different slice."] },
  { keys: ["geometry"], title: "Geometry", what: "Switches the bar to solid tools.", steps: ["Click Geometry.", "The sketch sheet closes its tools and the solid tools come back."] },
  { keys: ["sketch"], title: "Sketch", what: "Opens sketch tools. A new sketch starts on the flat sheet.", steps: ["Click Sketch.", "Draw, then use Finish to make a solid."] },
  { keys: ["flat sketch"], title: "Flat sketch", what: "Draws on the flat sheet.", steps: ["Click Flat sketch.", "The sheet fills the view."] },
  { keys: ["view in 3d", "3d sketch"], title: "View in 3D", what: "Draws on the part in the 3D view.", steps: ["Click View in 3D.", "Click it again to look straight at the face."] },
  { keys: ["box", "cylinder", "sphere", "cone", "pyramid", "triangle", "text", "torus", "tube", "tube / ring", "gear", "thread"], title: "Shape", what: "Adds that solid to the workplane.", steps: ["Click the shape.", "It lands on the bed.", "Use the inspector or the handles to change its size."] },
];

/** Every setting, as a guide: what it does and where it lives in Settings. */
const SETTING_ENTRIES = SETTING_GUIDES.map((setting) => ({
  // Lower case, because lookups go through normalizeSageLabel.
  keys: [`setting:${setting.key.toLowerCase()}`],
  title: setting.title,
  what: SETTING_TIPS[setting.key],
  steps: [
    "Open Settings with the gear button.",
    `Choose ${SETTINGS_SECTION_LABEL[setting.section]}.`,
    `Find “${setting.title}”.`,
  ],
  section: setting.section,
}));

const BY_KEY = new Map<string, SageGuide>();
for (const entry of GUIDE_LIST) {
  const { keys, ...guide } = entry;
  for (const key of keys) BY_KEY.set(key, guide);
}
for (const { keys, section: _section, ...guide } of SETTING_ENTRIES) {
  for (const key of keys) BY_KEY.set(key, guide);
}

export function normalizeSageLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/…/g, "")
    .replace(/\.\.\./g, "")
    .replace(/^add /, "")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_SOLID = {
  title: "Shape",
  what: "Adds that solid to the workplane.",
  steps: ["Click the shape.", "It lands on the bed.", "Use the inspector or the handles to change its size."],
} satisfies SageGuide;

export function lookupSageGuide(keyOrLabel: string): SageGuide | null {
  const known = BY_KEY.get(normalizeSageLabel(keyOrLabel));
  if (known) return known;
  if (keyOrLabel.trim().toLowerCase().startsWith("add ")) return GENERIC_SOLID;
  return null;
}

/** Tools that live in a sketch. Everything else is on the workplane, or (for files, views and help) anywhere. */
const SKETCH_GUIDE_KEYS = new Set([
  "select", "line", "arc", "curve", "rectangle", "circle", "shapes", "sketch-shape", "offset", "sketch-fillet",
  "sketch-chamfer", "trim", "sketch-mirror", "erase", "bend", "smooth", "sketch-linear", "sketch-circular",
  "lineweight", "image", "extrude", "revolve", "sweep", "cancel", "dimension", "coincident", "horizontal",
  "vertical", "equal", "parallel", "right angle", "tangent", "midpoint", "concentric", "fix", "symmetry",
  "flat sketch", "view in 3d", "3d sketch",
]);
const ANYWHERE_GUIDE_KEYS = new Set([
  "sage", "undo", "redo", "history", "exit full screen", "import", "save", "save as", "make a guide", "save as guide", "export",
  "settings", "home", "full screen", "camera-home", "zoom in", "zoom out", "bottom view", "hide controls",
  "show controls", "geometry", "sketch",
]);

export type SageArea = "sketch" | "workplane" | "anywhere" | "settings";

export type SageSearchHit = {
  id: string;
  area: SageArea;
  guide: SageGuide;
  /** For a setting: its Settings tab, and a label such as "Settings · Printing". */
  section?: SettingsSectionId;
  where?: string;
};

/** Words that carry no meaning in a question like "how do I make a pipe". */
const SEARCH_FILLER = new Set([
  "a", "an", "and", "are", "can", "do", "does", "for", "how", "i", "in", "into", "is", "it", "make", "me", "my",
  "of", "on", "the", "to", "tool", "use", "what", "with", "you",
]);

/**
 * Find tools for a name or a plain question. Names count most, then the start of a name,
 * then words in what the tool does, so "pipe" finds Sweep and "round edges" finds Fillet.
 */
/** Tools first, then settings, so a tool wins a tie with a setting of the same name. */
const SEARCH_ENTRIES: Array<{ keys: string[]; title: string; what: string; steps: string[]; section?: SettingsSectionId }> = [
  ...GUIDE_LIST,
  ...SETTING_ENTRIES,
];

export function searchSageGuides(query: string, limit = 6): SageSearchHit[] {
  const words = normalizeSageLabel(query)
    .split(/[^a-z0-9/]+/)
    .filter((word) => word.length > 0 && !SEARCH_FILLER.has(word));
  if (words.length === 0) return [];
  const scored = SEARCH_ENTRIES.map((entry, order) => {
    const title = entry.title.toLowerCase();
    const body = `${entry.what} ${entry.steps.join(" ")}`.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (title === word || entry.keys.includes(word)) score += 10;
      else if (title.startsWith(word) || entry.keys.some((key) => key.startsWith(word))) score += 6;
      else if (title.includes(word) || entry.keys.some((key) => key.includes(word))) score += 4;
      // Words are letters, digits and "/" only, so they are safe in a pattern as they are.
      else if (new RegExp(`\\b${word}`).test(body)) score += 2;
    }
    return { entry, order, score };
  });
  return scored
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ entry }) => toHit(entry));
}

function toHit(entry: (typeof SEARCH_ENTRIES)[number]): SageSearchHit {
  const id = entry.keys[0];
  if (entry.section) {
    return { id, area: "settings", guide: BY_KEY.get(id)!, section: entry.section, where: `Settings · ${SETTINGS_SECTION_LABEL[entry.section]}` };
  }
  const area: SageArea = SKETCH_GUIDE_KEYS.has(id) ? "sketch" : ANYWHERE_GUIDE_KEYS.has(id) ? "anywhere" : "workplane";
  return { id, area, guide: BY_KEY.get(id)! };
}

/** One tool or setting by its id, as a search hit (for opening its answer directly). */
export function sageHitById(id: string): SageSearchHit | null {
  const entry = SEARCH_ENTRIES.find((candidate) => candidate.keys[0] === id);
  return entry ? toHit(entry) : null;
}

export function sageShortcut(guide: SageGuide, fromButton?: string | null) {
  const typed = fromButton?.trim();
  if (typed && typed !== "None") return typed;
  if (!guide.hotkey) return undefined;
  const label = formatHotkeyBinding(loadHotkeyBindings()[guide.hotkey] ?? []);
  return label === "None" ? undefined : label;
}
