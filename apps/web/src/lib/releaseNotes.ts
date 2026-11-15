/**
 * Plain-language release notes shown in Settings → Updates.
 * Add a new version at the top when it ships. Put work that is in the app
 * but not in a release yet under `unreleased`.
 */
export type ReleaseNotes = {
  version: string;
  items: string[];
};

/** Lines drawn stronger in Settings → Updates and the update card: wrap a note in featured(). */
const featuredNotes = new Set<string>();
const featured = (note: string) => {
  featuredNotes.add(note);
  return note;
};

export function noteIsFeatured(note: string): boolean {
  return featuredNotes.has(note);
}

/**
 * Each item is one or two short sentences in plain English, saying what you can now do.
 * Fixes start with "Fixed:" and take one line each.
 */
export const UNRELEASED_NOTES: string[] = [];

export const RELEASE_NOTES: ReleaseNotes[] = [
  {
    version: "1.4.2",
    items: [
      featured("New in Shapes: Picture Keychain. Pick a drawing or logo and Mintr turns it into a keychain, a plaque or just the drawing."),
      featured("New in Shapes: Dice. Pick 4, 6, 8, 10, 12 or 20 sides. It sits flat on a face, so it prints without supports."),
      featured("Tinkercad designs now bring over Text, Stars, Hearts, Paraboloids and Icosahedrons too, instead of leaving them out."),
      "Toolbox Label is now Name Plate. Turn Magnets off for a plain sign, or pick Follow the letters for a plate shaped round the words.",
      "Name Plates and keychains build much faster.",
      "The Parts tab shows more of what you did, such as textures, patterns and Split. Right-click a split piece to join it back.",
      "Click empty space in the Parts tab, or press Esc, to clear the selection.",
      featured("Mirror now makes a mirrored copy. Click the arrow on the side where you want it, and the copy appears there, touching the original."),
      "Fixed: Mirror's arrows could sit on top of each other, so one couldn't be clicked.",
      "Fixed: Some fonts you added lost holes in letters, like the top of a B.",
    ],
  },
  {
    version: "1.4.1",
    items: [
      featured("The Parts tab is now a full tree of your design. Every part, its steps and the parts inside each group are listed, and you can click any of them to edit it."),
      "Double-click a step, such as a fillet or a pull, to reopen it with the values you used. The steps after it are rebuilt on top.",
      "Right-click any row in the Parts tab to see what you can do with it. With Pro on, drag steps and parts to change their order.",
      featured("Fillet and Chamfer now fill inside corners smoothly, like where a cylinder stands on a plate, instead of cutting a groove."),
      "All sharp edges now works on many more parts, inside corners included.",
      featured("Send to laser: in a 3D print design, open Export and click Send to laser to turn your model into laser parts. Change the model later and click Update from model."),
      "Sage is now a friendly brontosaurus.",
      featured("Toolbox Label (now called Name Plate) makes magnetic drawer labels with raised letters. Type one name per line to make a whole set at once."),
      "Heavy, a free bold font, is now included, and text can slant.",
      "Split can lay the pieces cut side down, ready to print.",
      "Circular pattern now goes around any shape you click, and Turn pattern spins the whole pattern.",
      "Groups of up to 40 parts stay CAD ready in the browser, just like in the desktop app.",
      "Groups with tori are much faster: about a second instead of up to 50.",
      "Push Pull shows the face under the pointer more clearly.",
      "Sizes show clean numbers, like 16.00 instead of 15.999.",
      "Shapes dropped onto a part land on top of it. Shift+arrow moves exactly 5 grid steps.",
      "Size boxes understand units and sums, like 2in or (10+2)mm.",
      "About 20 buttons that used to do nothing now tell you why.",
      "Pro values use your workplane's unit, so on an inch workplane wall = 2 means 2 inches.",
      "Fixed: Circular pattern could delete other shapes in your design.",
      "Fixed: Ctrl+D or paste on a patterned part could delete the original.",
      "Fixed: Laser settings, threads and Gridfinity changes weren't always saved or undoable.",
      "Fixed: Saving a design that hadn't finished loading could save an empty file.",
      "Fixed: Editing a sketch could lose the part's colour, hole setting or fillets.",
      "Fixed: Revolve didn't work on sketches with holes or more than one outline.",
      "Fixed: Ungrouping a stretched group came out the wrong size.",
    ],
  },
  {
    version: "1.4.0",
    items: [
      "The Shapes bar has bigger pictures, full names and clear sections. Type in Find to jump straight to a shape.",
      featured("New shapes: Rounded Plate, Slot, Star, Heart, Wedge, Paraboloid, Nut Pocket, Threaded Hole and QR Code. Most keep their settings, so you can change them later."),
      featured("Threaded Hole makes a hole for any screw. Pick Threaded to cut a real thread, or Slides through for a plain hole with room for the head."),
      "Nut Pocket makes a six-sided pocket that holds a nut, in metric or inch sizes.",
      "Threads now makes rods, screws and nuts, and holes moved to Threaded Hole. Make matching hole adds the right hole for a screw.",
      "Threads can be Print-ready, light and made for printing, or Exact, a true spiral for STEP files.",
      "Fixed: Right-hand threads printed as left-hand threads.",
      featured("X-ray now looks like a technical drawing: solid material is shaded with lines and holes stay open."),
      "X-ray marks problems like thin walls and overlapping parts. Point at the cut to read how thick a wall is.",
      "Sketching is quicker to start: click Sketch, then click a face or the workplane.",
      featured("Mintr Pro: name a value, like wall = 2, and use it in any size box. Change the value and everything that uses it updates."),
      "Mintr Pro sketching: sizes and rules settle together, and Mintr tells you when two rules disagree. A new Angle rule holds the angle between two lines.",
      featured("Laser cutting sends true curves, for smoother and faster cuts. Nest packs parts by their real shape, so small parts can sit inside the holes of big ones."),
      "Laser Fit test cuts a small comb and key, so your joints fit your laser exactly.",
      "Settings has one Machines tab for your 3D printer and your laser.",
      "Fixed: Clicking beside overlapping parts could switch between them instead of clearing the selection.",
    ],
  },
  {
    version: "1.3.2",
    items: [
      "The toolbar fits smaller screens, keeping Arrange, Modify and Combine in reach.",
      "Pad/Pocket follows curves smoothly instead of in flat steps, and sharp corners stay sharp.",
    ],
  },
  {
    version: "1.3.1",
    items: [
      "Tinkercad designs that cut with grouped holes now come over with their cuts.",
      "Holes made of many crossing parts now cut in the browser.",
      "Tinkercad roofs come over in exactly the right place.",
      "Mintr tells you when a Tinkercad design uses a file imported into Tinkercad, since those can't come over.",
      "The Send to Mintr button is easier to see and drag.",
      "Fixed: A hole the same size as a part's side could leave thin slivers behind.",
      "Fixed: Round holes like a torus could come out rough.",
      "Fixed: The file drop box in Import was hard to read in dark mode.",
    ],
  },
  {
    version: "1.3.0",
    items: [
      featured("New Loft shape: pick a bottom and top outline, add a twist, or make it hollow for a vase."),
      "Loft can also join flat outlines stacked at different heights into one smooth solid.",
      featured("Shrink Wrap wraps your shapes in one tight skin, like shrink-wrap plastic."),
      featured("Smooth lets you sculpt soft, flowing curves into a part by dragging points on its surface."),
      featured("Mintr runs in your web browser at app.mintr3d.com, with nothing to install."),
      "Mintr no longer asks to save when you leave a design, because autosave already keeps it.",
      featured("Bring Tinkercad designs over with the Send to Mintr bookmark. Shapes arrive at their sizes and places, ready to edit."),
      "Sage now sits on the left of the top bar, next to Home.",
      "Sketch asks whether to draw on a part's face or on the workplane.",
      "The first tutorial now shows how to turn a cylinder into a hole.",
      "Extrude can finish right away, without previewing in 3D first.",
      "Split joints now fit together, and the pieces print without supports.",
      "Split pieces stay where the object was.",
      "Holes look like frosted glass, so you can see their shape.",
    ],
  },
  {
    version: "1.2.0",
    items: [
      featured("Parts remember their steps. Change a fillet, pull or hollow and Mintr rebuilds the part with every later step kept."),
      "Resizing a part keeps its fillets and pulls at the size you set, instead of stretching them.",
      "Reopening Fillet or Chamfer picks up the last one you made, so you can change it.",
      "The browser version uses the same engine as the desktop app, so designs come out the same.",
      "Guides can teach Push Pull.",
      featured("Threads are rebuilt with the standard tooth shape, so screws, nuts and tapped holes fit and print properly."),
      "Make matching tapped hole adds the right hole for a screw, rod or nut.",
      "Thread clearance follows your printer: filament or resin.",
      "Threads now come in sizes from M1 to M36.",
      "Grouping parts with threads is much faster.",
    ],
  },
  {
    version: "1.1.9.4",
    items: [
      "Fixed: Concave fillets in the desktop app could cut faces off a moved or turned part.",
    ],
  },
  {
    version: "1.1.9.3",
    items: [
      "Big designs stay smooth while you work, because saving now happens quietly in the background.",
      "Hidden shapes and guides are left out of exports.",
      "Exports always use the smoothest curves.",
      "If Mintr ever crashes, it reopens with your work from the last autosave.",
      "STEP export keeps every hole it can cut and tells you which one it couldn't.",
      "Editing imported and combined parts is faster in the desktop app.",
    ],
  },
  {
    version: "1.1.9.2",
    items: [
      "When a fillet or chamfer is too big, Mintr tells you the largest size that fits.",
      "Ring gears have proper gear teeth.",
      "Threads, gears and spheres are true curves in the desktop app, so files are smaller and faster.",
      "Desktop previews show the same detail as the browser, and arrive faster.",
      "Fixed: Concave fillet on a corner didn't work in the desktop app.",
      "Fixed: Stray lines showed along fillets and chamfers in the desktop app.",
      "Fixed: Pyramids and polygons with an odd number of sides exported to STEP facing the wrong way.",
      "Fixed: Tilted, turned or mirrored groups came out wrong in the desktop app.",
      "Fixed: An imported part could lose its fillet when combined in the desktop app.",
    ],
  },
  {
    version: "1.1.9.1",
    items: [
      "Trace photo has Draw, Line and Erase tools to clean up the outline by hand.",
      "Trace photo finds the sheet of paper in the photo more reliably.",
      "Fixed: The first design after starting Mintr could take two minutes to open.",
    ],
  },
  {
    version: "1.1.9",
    items: [
      "Trace photo turns a photo of a real object into an outline at its true size.",
      "K9 crystal is a new laser material for engraving a 3D model inside a glass block.",
      "Big models show their file size, with a tip to make them smaller before engraving.",
      "Concave fillet scoops corners cleanly.",
      "Sage has a new owl look.",
      "Fixed: Cut, Score and Engrave couldn't be changed on some laser parts.",
    ],
  },
  {
    version: "1.1.8",
    items: [
      "Mintr now works with laser cutters. Add your laser in Settings → Machines.",
      "Set each laser part to Cut, Score or Engrave, and see which is which on the bed.",
      "Save cut file makes an SVG or DXF at true size.",
      "Open in xTool Studio or LightBurn sends your design straight over.",
      "Trace logo turns a logo picture into a part to engrave or cut.",
      "Box maker makes a box with finger joints that fit your sheet.",
      "Flat parts turns a 3D part into stacked layers or slotted slices.",
      "Nest packs parts tightly on the laser bed to save material.",
      "xTool lasers are on the machine list.",
      "Laser designs hide tools that only make sense for 3D printing.",
      "Sage explains the laser tools too.",
      "Texture gives a part a surface pattern, a picture or text.",
      "Add your own fonts in Settings → Fonts.",
      "Updates now come from Mintr's own GitHub page.",
    ],
  },
  {
    version: "1.1.7.2",
    items: [
      "3D sketch is now called View in 3D.",
      "Extrude lets you preview the solid before you finish it.",
      "Finishing a sketch moves smoothly back to the part.",
      "Fixed: The view cube and size bar moved around in View in 3D.",
    ],
  },
  {
    version: "1.1.7.1",
    items: [
      "Fixed: Sketch sizes were hard to read in dark mode.",
    ],
  },
  {
    version: "1.1.7",
    items: [
      "Sage shows a short animation of how each tool works. Press F1 to turn Sage on or off.",
      "Sage is on the home page and in Settings too.",
      "Sweep walks you through each step, and closes small gaps in an outline for you.",
      "Intersect keeps only the part where solids overlap.",
      "Smooth works on curved sketch points.",
      "Sketch lines are easy to see in dark mode.",
      "Smoother animations throughout.",
      "Settings look the same everywhere, with clearer names.",
      "Make a guide shows each step of your model as a card you can edit.",
      "Pick a colour and picture for the guides you make.",
      "Guide files are much smaller. Guides made now need Mintr 1.1.7 or newer.",
      "Undo goes back 500 steps, or 1000 on a stronger computer.",
    ],
  },
  {
    version: "1.1.6",
    items: [
      "Three new tutorials on the home page.",
      "Save as guide turns your steps into a guide that walks someone else through your model.",
      "Sketch sizes show right on the shape as you draw.",
      "Sketches snap to the center of boxes, cylinders and triangles.",
    ],
  },
  {
    version: "1.1.5",
    items: [
      "Face is now Pad/Pocket, and does everything Hollow and Face did.",
      featured("Round parts keep their smoothness after Group, fillet or split."),
      featured("Curves and holes are shaded correctly, and sharp corners look sharp."),
      "Fixed: Fillets looked rough in 1.1.4.",
    ],
  },
  {
    version: "1.1.4",
    items: [
      featured("Face replaces Hollow on the toolbar. Click a flat face to add material or cut a pocket."),
      "Face settings apply to every face you pick.",
      featured("Pockets next to each other can keep the wall between them or join into one."),
      featured("The part you make matches what you saw on screen."),
      "Shapes are split into Solids and Parts.",
      "Split Gridfinity baseplates join with dovetails.",
      "Fillets and chamfers in the model tree can be changed or removed.",
      "Fixed: A rectangle with a small corner radius could change shape.",
    ],
  },
  {
    version: "1.1.3",
    items: [
      featured("Gridfinity bins and baseplates are in Shapes, sized in grid units, with walls, magnets and finger scoops."),
      featured("A baseplate too big for your printer splits into pieces that lock together."),
      featured("Concave fillet scoops a groove along the edges you pick."),
      featured("X-ray lets you look inside a part."),
      featured("The start page has a Light and Dark switch."),
      "STL files open standing up in your slicer.",
      "Saving is safer, and long undo history takes less space.",
      "Fixed: Push Pull, Fillet and Chamfer lines on polygons were in the wrong place.",
      "Fixed: Exporting STEP could save an empty file for a split or group.",
    ],
  },
  {
    version: "1.1.2",
    items: [
      "Push Pull: drag a flat face to make a part longer or shorter.",
      "Push Pull, Fillet, Chamfer and Hollow work on parts you've moved or turned.",
      "A .mintr file keeps its undo history, so someone else can pick up where you left off.",
      "The projects home page has a fresh new look.",
      "Drop sets a part down on the workplane or on a face.",
      "When something fails, Mintr tells you what to try.",
      "Imported STEP parts stay exact after saving.",
      "Sketching moves the camera smoothly onto the face.",
      "Group handles many holes and parts more accurately.",
      "If a fillet can't round every edge at once, Mintr tries each edge on its own.",
    ],
  },
  {
    version: "1.1.0",
    items: [
      "The desktop app has its own CAD engine for Group, fillet, chamfer, hollow and threads.",
      "Sketches, sweeps and STEP files use that engine too.",
    ],
  },
  {
    version: "1.0.9",
    items: [
      "Selected parts have a clear bronze outline.",
      "Fillets and chamfers sweep across the part as they're added.",
      "New shapes drop in and land on the workplane.",
    ],
  },
  {
    version: "1.0.8",
    items: [
      "Double-click a sketch point to switch it between a corner and a curve.",
      "Sketched parts are exact solids, so fillets work on curved sides.",
      "Sketch tools have everyday names, with a tip for the tool under the pointer.",
      "A sketch can repeat in a line or around a circle.",
      "Lineweight turns an outline into a wall.",
      "Pick your printer by brand and the bed size follows.",
      "Mintr warns when a part hangs off the bed and marks faces that need support.",
      "Split can add a dovetail, plug, snap or thread so the pieces fit back together.",
      "3MF export keeps each part's colour.",
      "Designs now save as .mintr files. Older .peakcad files still open.",
    ],
  },
  {
    version: "1.0.7.5",
    items: [
      "PeakCAD is now Mintr. Same app, new name.",
      "Follow us on Instagram @Mintr3D, and visit mintr3d.com.",
      "Still free, and it always will be.",
    ],
  },
  {
    version: "1.0.7",
    items: [
      "Gears: pick the tooth shape and count, and gears of the same size mesh together.",
      "Sketch has been rebuilt to be easier, with more information and working 3D sketching.",
      "Type a length or angle while you draw a line.",
      "Construction lines snap and stay out of the solid.",
      "Sweep carries an outline along a path.",
      "Every sketch corner shows its angle.",
      "Fixed: Project menus could get cut off.",
    ],
  },
  {
    version: "1.0.6",
    items: [
      "The start screen tells you when an update is ready.",
      "Cones can take fillets and chamfers, and can be oval.",
      "Fixed: Clicking a slider's track could change its number by mistake.",
    ],
  },
  {
    version: "1.0.5",
    items: [
      "Export can open your part straight in your slicer.",
      "X-ray cuts the view so you can look inside.",
      "The toolbar is reorganized, with the project name in the middle.",
      "A Pro switch turns on advanced sketch tools.",
      "Text can bend up and down, or in and out.",
      "AI assistants can connect to the desktop app.",
    ],
  },
  {
    version: "1.0.4",
    items: [
      "PeakCAD tells you when a new version is ready.",
      "Report a problem sends us a note.",
      "Threads: rods, screws, nuts and tapped holes, including inch sizes.",
      "Split cuts one part into two.",
      "Hollow can keep inside corners sharp or round them.",
      "Snap puts one face onto another.",
      "Lay flat turns a face down onto the workplane.",
      "Joined parts look like one part, without seams.",
    ],
  },
  {
    version: "1.0.3",
    items: [
      "History lets you go back to any earlier step.",
      "Tie moves shapes together while keeping them separate.",
      "Hollow turns a solid into walls.",
      "Tools are grouped on the toolbar.",
      "Large STEP files open part by part.",
      "Fixed: A hole lined up with a part's side didn't always cut through.",
    ],
  },
  {
    version: "1.0.2",
    items: [
      "Fillets and chamfers are faster.",
      "Parts light up when you point at them.",
      "A startup screen shows while PeakCAD gets ready.",
      "Clicks land on the surface you see.",
    ],
  },
  {
    version: "1.0.1",
    items: [
      "Reduce file size makes imported parts lighter.",
      "Folders can have a password.",
      "Snap one shape's side to another's.",
    ],
  },
  {
    version: "1.0.0",
    items: [
      "First full desktop release.",
      "STEP files open as separate parts.",
    ],
  },
  {
    version: "0.9.6",
    items: [
      "Circular pattern makes copies around a circle.",
      "Change keyboard shortcuts in Settings.",
      "Search for any tool in Settings.",
    ],
  },
];
