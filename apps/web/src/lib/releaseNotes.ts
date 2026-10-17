/**
 * Plain-language release notes shown in Settings → Updates.
 * Add a new version at the top when it ships. Put work that is in the app
 * but not in a release yet under `unreleased`.
 */
export type ReleaseNotes = {
  version: string;
  items: string[];
};

export const UNRELEASED_NOTES: string[] = [];

export const RELEASE_NOTES: ReleaseNotes[] = [
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
