/**
 * Plain-language release notes shown in Settings → Updates.
 * Add a new version at the top when it ships. Put work that is in the app
 * but not in a release yet under `unreleased`.
 */
export type ReleaseNotes = {
  version: string;
  items: string[];
};

/** Feature lines drawn stronger in Settings → Updates and the update card. */
export const FEATURED_RELEASE_NOTES: readonly string[] = [
  "A round part keeps its side count after a Group, a fillet, or a split. Smooth, Standard, Draft, and a number you type all carry through.",
  "Curves, holes, and grooves light from the real face. A sharp corner stays a sharp corner.",
  "Face takes Hollow's place on the toolbar. Click a flat face to add material or cut a pocket.",
  "Leave column keeps the wall and the bar between two pockets. Join through opens those pockets into each other. Opposite faces cut straight through.",
  "The part you create matches what you saw on screen.",
  "Gridfinity bins and baseplates are in the Shapes palette. Size a bin in grid units, with height, walls, compartments, magnets, a finger scoop, and open sides that join into a tray, or size a baseplate to a drawer.",
  "A baseplate wider than the printer bed splits into pieces that lock together.",
  "Concave fillet scoops a groove along the edges you pick, and the groove runs through the corner.",
  "Push Pull, Fillet, and Chamfer lines on a polygon sit on the corners you see.",
  "X-ray glides a cut through the part so you can look inside.",
  "The start page has a Light / Dark switch, and the room eases from one look to the other.",
];

export function noteIsFeatured(note: string): boolean {
  return FEATURED_RELEASE_NOTES.includes(note);
}

export const UNRELEASED_NOTES: string[] = [];

export const RELEASE_NOTES: ReleaseNotes[] = [
  {
    version: "1.1.9.2",
    items: [
      "Concave fillet on every edge of a corner now scoops the corner cleanly in the desktop app too, not just in the browser.",
      "Fillets and chamfers in the desktop app no longer show outline lines along their smooth edges after they are applied.",
      "When a fillet or chamfer is too big for the edges you picked, Mintr tells you the largest size that fits.",
      "Rounding every edge of a part with inside corners now works in the desktop app just as it does in the browser, and a size that is too big keeps the tool open with a message instead of closing it.",
      "Ring gears have proper involute teeth on screen, in prints and in exported files. Before, their teeth were drawn as round bumps.",
      "Pyramids and polygon prisms with an odd number of sides now export to STEP facing the way they look on screen.",
      "Groups that are tilted, turned or mirrored, and holes inside a group, now come out right in the desktop app when you combine, split, check for printing or export.",
      "In the desktop app, a part you filleted after importing it keeps its fillet when combined or exported, and locked parts stay out of Combine.",
      "Threads, gears and spheres made in the desktop app are true smooth curves, so STEP files are smaller and combining them is faster. Split screw joints use standard metric sizes, as in the browser.",
      "Desktop previews of fillets, threads and Push/Pull, and imported STEP parts and sweeps, now show the same detail as in the browser, and arrive faster.",
      "Fillets on an oval cone work the same in the desktop app as in the browser, including on a cone that has been moved or turned.",
    ],
  },
  {
    version: "1.1.9.1",
    items: [
      "The first design you open after starting Mintr opens in a moment again, instead of after a two-minute wait.",
      "Trace photo has Draw, Line and Erase tools to clean up the outline by hand: paint in what it missed, square up an edge with a straight line, or rub out a ragged shadow. Change the brush size with the slider or the [ and ] keys, and Undo steps back through clicks and strokes.",
      "Trace photo in Sizes mode finds the sheet of paper in the photo, so the table around it is no longer mistaken for the background, and the distance boxes have room for numbers like 24.63.",
    ],
  },
  {
    version: "1.1.9",
    items: [
      "Trace photo in Sketch turns a photo of a real object into an outline at its true size. Size it from the sheet of paper it lies on, from distances you type (made for small parts like watch parts), or from a scan. Black paper works best for shiny metal, an optional AI tracer handles tricky objects, and Draw, Line and Erase tools clean up the outline by hand.",
      "K9 crystal is a new laser material for engraving a 3D model inside a glass block or ball. The crystal shows as frosted glass around your model, Fit in crystal scales the model inside with a safe gap from the surface, and sizes you save are there in every design.",
      "Big 3D models show their triangle count and file size, with a tip to use Reduce File Size before exporting for crystal engraving.",
      "Cut, Score and Engrave can be changed on any part in a laser design again.",
      "Concave fillet on every edge of a corner scoops the corner out cleanly, with no point of material left where the grooves meet.",
      "Sage has a new owl look.",
    ],
  },
  {
    version: "1.1.8",
    items: [
      "Mintr works with laser cutters and engravers. Add your laser in Settings → Machines, and New design asks whether a design is for 3D printing or laser cutting.",
      "Each part in a laser design is set to Cut, Score or Engrave, and shows it on the bed: a red outline for cut, blue for score, and a burnt look for engrave.",
      "Save cut file makes an SVG or DXF at true size, with the laser's kerf allowed for.",
      "Open in xTool Studio or LightBurn sends the cut file straight over. xTool Studio gets cut, score and engrave already set. Open xTool Studio before you export to it.",
      "Trace logo turns a PNG or JPG logo into a part to engrave, cut or score, with no other program needed. It is made for logos, text and simple drawings, not photos.",
      "Box maker makes a box with finger joints sized to your sheet.",
      "Flat parts turns a 3D part into stacked layers to glue together, or slotted slices that push together.",
      "Nest packs parts close together on the laser bed, so a sheet goes further.",
      "xTool lasers are on the machine list, including the F2, F2 Ultra and the conveyor versions, each under its own name.",
      "Laser designs hide tools that only make sense for 3D printing, like Texture, Threads and Gridfinity.",
      "Sage explains the laser tools too.",
      "Texture gives a part a printed surface finish: 11 patterns, your own picture, or text. Choose which faces get it, and see a preview before it builds. The part itself stays exact.",
      "Add your own fonts in Settings → Fonts. A design carries the fonts it uses, so it opens the same on another computer.",
      "Updates now come from Mintr's own page on GitHub.",
    ],
  },
  {
    version: "1.1.7.2",
    items: [
      "3D sketch is now called View in 3D.",
      "Extrude lets you check the solid first. Set the height, click Preview in 3D, look around it, then finish it or go back to the sketch. The Extrude button finishes it too.",
      "Finishing a sketch eases back to the part, with no flicker.",
      "The view cube and the workplane size bar stay in the same place in View in 3D as on the workplane.",
      "View in 3D no longer shows the hint bar, or the message to drag a shape onto an empty workplane.",
    ],
  },
  {
    version: "1.1.7.1",
    items: [
      "Sketch sizes are easy to read again in dark mode. The labels behind the numbers now match the dark sheet.",
    ],
  },
  {
    version: "1.1.7",
    items: [
      "Sage shows a short moving picture of how each sketch and workplane tool works. Turn Sage on or off with the Sage button or F1.",
      "Sage sits below Recents on the home page, and at the top of Settings to take you to any setting.",
      "Sweep walks you through it: draw the profile, click Next, draw the path, then click Sweep. The part comes out closed at both ends and sits on the bed. A spinner shows while it builds.",
      "Sweep closes small gaps in an outline for you.",
      "Intersect works on plain solids and keeps only the overlap.",
      "Smooth works on points drawn with Curve, even ones that ended up straight.",
      "Sketch lines stay blue and easy to see in dark mode.",
      "Stepping into a flat sketch, panels, new parts, the toolbar, and the Home view all move with smooth animations.",
      "Settings look the same on the home page as in a design, with General first and clearer names.",
      "Make a guide shows each step of your model as a card. Keep it, fold it into the step above, rename it, or add a tip, and preview it the way a learner will see it.",
      "Pick a name colour and a picture for the guides you make. Mintr's own guides carry the Mintr logo.",
      "Guide files are far smaller, so a guide can hold many more steps. A guide made in 1.1.7 needs Mintr 1.1.7 or newer to open.",
      "Undo goes back 500 steps, or 1000 on a stronger computer.",
    ],
  },
  {
    version: "1.1.6",
    items: [
      "The home page has three tutorials: Make a block with a hole, A plate from a sketch, and A pocket in a block.",
      "Save as guide writes a .mintrguide from the steps you kept. Opening it walks someone through the model, highlights the next control, and finishes when their part matches. A guide tells you the number. It does not type it in for you.",
      "A chamfer or fillet within a guide has you set the distance first before applying the cuts.",
      "While you sketch, the size sits on the shape. A circle says how many millimeters across. A rectangle shows width and height.",
      "A sketch snaps to the center of a box, a cylinder, or a triangle.",
      "Clicking Geometry closes the sketch. New sketch is ready when you enter Sketch.",
      "The shape pictures follow the height of the shapes bar.",
    ],
  },
  {
    version: "1.1.5",
    items: [
      "I accidentally broke quality looking fillets in 1.1.4, they're fixed now lol. Sorry about that.",
      "Face is now Pad/Pocket. It has all the functionality of Hollow and Face combined.",
      "A round part keeps its side count after a Group, a fillet, or a split. Smooth, Standard, Draft, and a number you type all carry through.",
      "Curves, holes, and grooves light from the real face. A sharp corner stays a sharp corner.",
      "The line on a cut follows the solid.",
    ],
  },
  {
    version: "1.1.4",
    items: [
      "Face takes Hollow's place on the toolbar. Click a flat face to add material or cut a pocket.",
      "Set the inset, the corner radius, and the depth. Add another face and those settings apply to every face.",
      "Leave column keeps the wall and the bar between two pockets. Join through opens those pockets into each other. Opposite faces cut straight through.",
      "The part you create matches what you saw on screen.",
      "Shapes are split into Solids and Parts.",
      "Splitting an open Gridfinity baseplate joins the pieces with dovetails. A plate with a solid bottom still uses tabs and slots.",
      "A fillet or chamfer in the model tree can be edited or removed, and undo keeps it.",
      "A rectangle with a small corner radius stays a rectangle.",
    ],
  },
  {
    version: "1.1.3",
    items: [
      "Gridfinity bins and baseplates are in the Shapes palette. Size a bin in grid units, with height, walls, compartments, magnets, a finger scoop, and open sides that join into a tray, or size a baseplate to a drawer.",
      "A baseplate wider than the printer bed splits into pieces that lock together.",
      "Concave fillet scoops a groove along the edges you pick, and the groove runs through the corner.",
      "Push Pull, Fillet, and Chamfer lines on a polygon sit on the corners you see.",
      "X-ray glides a cut through the part so you can look inside.",
      "The start page has a Light / Dark switch, and the room eases from one look to the other.",
      "STL files open standing up in Cura, PreForm, Bambu Studio, and other slicers.",
      "A fillet or chamfer settles into the new edges when you apply it.",
      "Exporting STEP no longer saves an empty file for a split or a group.",
      "Saving a project cannot leave a half-written file, and a long undo history takes much less space.",
    ],
  },
  {
    version: "1.1.2",
    items: [
      "Push Pull is in: drag a flat face on a CAD-ready shape, type a distance if you want, then click Apply.",
      "Push Pull face outlines follow the real edges of the shape, the drag preview is a clean prism instead of stray triangles, L-shaped faces pick correctly, and a face that points at the camera no longer runs away from the mouse.",
      "Push Pull, Fillet, Chamfer, and Hollow work on CAD bodies and Groups that have been moved or turned since they were made.",
      "The Start modeling tip stays readable in dark mode.",
      "A .mintr file keeps the model history, so someone else can undo, redo, and keep working from where you left off.",
      "The projects home uses cover-style cards that fill the window. Folders use a folder icon. Opening a folder slides in; opening a design fades into the editor.",
      "The projects home uses the same cream, gold glow, cyan grid, and mint ticks as the rest of Mintr, with quieter chrome and a slower lift on each design.",
      "Drop sits a part on the workplane or a flat face. The part does not have to start above that surface.",
      "When Group, fillet, chamfer, sweep, or a hole cut fails, the notice says what to try.",
      "Print marks on CAD-ready parts come from the desktop engine, so turning them on stays quick.",
      "Imported STEP stays exact after autosave. The inspector shows volume in milliliters.",
      "Entering a sketch eases the camera onto the face. Switching Flat sketch and 3D sketch keeps the last view on each side. Orbit, pan, and zoom stay the same while you sketch and after Extrude. Shapes grow as you drag, a closed profile fills once, and Extrude rises from the sketch.",
      "While you sketch, Flat sketch and 3D sketch sit under the tip at the bottom.",
      "Group cuts several holes one at a time, so the outer shape stays true.",
      "Split and print marks cut those holes the same way, whether there is one hole or several.",
      "Group joins several solids one after another, so a pile of bosses stays true. Two parts still fuse in one step.",
      "A Group of three or more parts cleans leftover faces so the workplane matches the file.",
      "A hole sketched on a face stays CAD while you edit, so fillet still works.",
      "If one body in a Group is mesh, Mintr groups the CAD parts and leaves that body out.",
      "Imported STEP finishes baking before you close or leave, so later export stays exact.",
      "If Group falls to mesh, the notice names the mesh body so you can Group the CAD parts first.",
      "Several circles or rectangles in one sketch hole cut as separate exact holes.",
      "If a fillet cannot round every selected edge together, Mintr retries each edge on its own.",
    ],
  },
  {
    version: "1.1.0",
    items: [
      "Desktop Mintr uses its own CAD engine for Group, fillet, chamfer, hollow, and thread.",
      "Sketch extrude, sweep, and STEP import/export use that same engine.",
      "Group keeps imported and shared .mintr parts in place.",
    ],
  },
  {
    version: "1.0.9",
    items: [
      "Selected and hovered shapes keep a bronze outline, including spheres, fillets, and chamfers.",
      "Those outlines are two pixels thick so they stay easy to see.",
      "A fillet or chamfer wipes across the part when you apply it.",
      "A new solid comes in at drop height and lands on the workplane.",
      "Overhang marks fade in as soon as you turn them on.",
    ],
  },
  {
    version: "1.0.8",
    items: [
      "Double-click a sketch point to switch it between a corner and a curve.",
      "Smooth stays on, so you can click each point you want to curve.",
      "A Bézier curve shows while you drag the handles.",
      "A curve stays on its line instead of looping back on itself.",
      "An empty workplane opens a sketch as soon as you click Sketch.",
      "A sketched extrusion is an exact solid, so fillet and chamfer work on curved sides.",
      "Sketch tools use everyday names. A tip at the bottom follows the tool under the pointer.",
      "Extrude, Revolve, Sweep, and Cancel sit in the top bar next to Settings.",
      "Guide lines are in Settings while you sketch. View in 3D is its own button.",
      "A sketch selection can repeat in a line or around a circle.",
      "The angle number sits inside the corner it measures.",
      "Lineweight turns an outline into a wall.",
      "Workplane settings start with the printer brand, then the printer. The bed size follows.",
      "The bed warns when a part hangs past the plate, and marks faces that need support.",
      "Split can leave a dovetail, plug, snap, or thread so the pieces fit back together.",
      "A 3MF export keeps the color of each body.",
      "New designs save as .mintr. Older .peakcad files still open, and Settings can move projects into Documents\\Mintr.",
    ],
  },
  {
    version: "1.0.7.5",
    items: [
      "PeakCAD has evolved, Mintr is here to serve",
      "Follow us on instagram @Mintr3D",
      "New website coming soon Mintr3d.com",
      "This rebrand changes nothing about PeakCAD, its aim is to make it more desirable for the community to use",
      "Still free, always will be. 1.0.7 was a big change please read patchnotes",
    ],
  },
  {
    version: "1.0.7",
    items: [
      "Gears have been added as a shape. Several tooth profiles to choose from. Tooth count and module set the size so two gears with the same module mesh.",
      "Sketch has had a massive revamp, more intuitive, more information, sketch in 3d finally works",
      "A face drawn on the side of a profile cuts with it. Sharing a side no longer leaves that face out.",
      "Type a length or an angle while you draw a line. Click a length or a corner angle to change it.",
      "Construction lines snap and stay out of the solid.",
      "Stroke turns an outline into a wall. Sweep carries a closed outline along a construction path.",
      "Every sketch corner shows its angle.",
      "A project or folder menu opens fully instead of being cut off by the card.",
    ],
  },
  {
    version: "1.0.6",
    items: [
      "The start screen checks for an update. When one is ready, the changelog sits under Start Modeling with a button to download it. Start Modeling still opens your projects.",
      "A cone can take a fillet or a chamfer.",
      "A new cone is a standard cone: bottom radius, top radius, and height. Free range opens length and width for an oval cone.",
      "An oval cone stays oval through a fillet or chamfer, and that fillet is much faster.",
      "Changing the width of a free-range cone keeps the length you already set.",
      "A dimension slider moves only when you drag its button. A click on the track leaves the number alone.",
    ],
  },
  {
    version: "1.0.5",
    items: [
      "Export can open the part in the slicer on this computer. OrcaSlicer, Bambu Studio, PrusaSlicer, and SuperSlicer receive a 3MF. Cura receives an STL.",
      "Download 3MF stays available, and Settings can point Export at a different slicer.",
      "X-ray view cuts the picture along X, Y, or Z so you can look inside. The part stays whole, and exports are unchanged.",
      "The project name sits in the center of the toolbar. Geometry and Sketch hang underneath it, and Import and Export open under their own buttons.",
      "Tools stay on the toolbar until the window is tight. Extra tools move into More, which stays on the screen.",
      "PeakCAD Pro is a switch for this computer. Sketch constraints stay off until you turn it on.",
      "Text can bow up and down, or in and out, and the letters stay face-up.",
      "A cone keeps the length you type, and the base follows that length.",
      "Brick is no longer a snap-grid size.",
      "A model can connect to the open project from the desktop app.",
    ],
  },
  {
    version: "1.0.4",
    items: [
      "PeakCAD can tell you when a new version is ready.",
      "Report a problem sends a note. A crash report can be included, without your design.",
      "Threads can be a rod, a screw with a head, a nut, or a tapped hole. Inch and pipe sizes are included.",
      "Split cuts one object into two along a line you place.",
      "Hollow can leave inside corners sharp or round them.",
      "Snap turns the first face onto the second and centers it there.",
      "Lay flat turns a chosen face down onto the workplane.",
      "A fillet or chamfer on a round part stays as smooth as that part. The size slider stays quick while you drag.",
      "Union outlines drop coplanar seams so fused solids read like one part.",
    ],
  },
  {
    version: "1.0.3",
    items: [
      "History opens under the History button. Slide through earlier steps and restore the one you want.",
      "Tie keeps shapes separate and moves them together. Group still fuses them into one solid.",
      "Hollow turns a solid into walls of one thickness.",
      "Tools are grouped into History, Clipboard, Combine, Modify, and Arrange. Import, Save, and Export sit together, and Settings has its own place.",
      "Large STEP files open part by part, and you can drag those parts with the mouse again.",
      "A hole that lines up flush with a part cuts all the way through. A hole still cuts a group of imported parts.",
      "Measurement labels stay clear of the rotate handles, and grouped holes show their real height.",
      "The fillet and chamfer slider skips sizes you already moved past.",
    ],
  },
  {
    version: "1.0.2",
    items: [
      "Fillets and chamfers are faster.",
      "A part shows a light outline before you click it.",
      "A part’s shadow hides while you move it, then comes back when you let go.",
      "PeakCAD shows a startup screen while it gets ready, then Start Modeling opens your projects.",
      "Clicks land on the surface you see.",
    ],
  },
  {
    version: "1.0.1",
    items: [
      "Reduce file size lowers the triangle count of an imported part.",
      "Folders can have a password.",
      "You can snap one side of a shape to the side of another.",
      "Measurements fade while you move the camera and come back when you stop.",
    ],
  },
  {
    version: "1.0.0",
    items: [
      "First full desktop release.",
      "STEP files open as separate parts.",
      "PeakCAD asks you to save when you leave a project.",
    ],
  },
  {
    version: "0.9.6",
    items: [
      "Circular pattern, with radius, count, and rotation.",
      "Keyboard shortcuts can be changed in Settings.",
      "Settings includes a searchable list of tools.",
    ],
  },
];
