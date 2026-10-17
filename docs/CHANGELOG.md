# Changelog

Add a matching plain-language entry at the top of `apps/web/src/lib/releaseNotes.ts` when a version ships. Settings → Updates reads that file.

## Unreleased

## 1.0.5

- Export can open the part in the slicer on this computer. OrcaSlicer, Bambu Studio, PrusaSlicer, and SuperSlicer receive a 3MF. Cura receives an STL.
- Download 3MF stays available, and Settings can point Export at a different slicer.
- X-ray view cuts the picture along X, Y, or Z so you can look inside. The part stays whole, and exports are unchanged.
- The project name sits in the center of the toolbar. Geometry and Sketch hang underneath it, and Import and Export open under their own buttons.
- Tools stay on the toolbar until the window is tight. Extra tools move into More, which stays on the screen.
- PeakCAD Pro is a switch for this computer. Sketch constraints stay off until you turn it on.
- Text can bow up and down, or in and out, and the letters stay face-up.
- A cone keeps the length you type, and the base follows that length.
- Brick is no longer a snap-grid size.
- A model can connect to the open project from the desktop app.

## 1.0.4

- PeakCAD can tell you when a new version is ready.
- Report a problem sends a note. A crash report can be included, without your design.
- Threads can be a rod, a screw with a head, a nut, or a tapped hole. Inch and pipe sizes are included.
- Split cuts one object into two along a line you place.
- Hollow can leave inside corners sharp or round them.
- Snap turns the first face onto the second and centers it there.
- Lay flat turns a chosen face down onto the workplane.
- A fillet or chamfer on a round part stays as smooth as that part. The size slider stays quick while you drag.
- Union outlines drop coplanar seams so fused solids read like one part.

## 1.0.3

- History opens under the History button. Slide through earlier steps and restore the one you want.
- Tie keeps shapes separate and moves them together. Group still fuses them into one solid.
- Hollow turns a solid into walls of one thickness.
- Tools are grouped into History, Clipboard, Combine, Modify, and Arrange. Import, Save, and Export sit together, and Settings has its own place.
- Large STEP files open part by part, and you can drag those parts with the mouse again.
- A hole that lines up flush with a part cuts all the way through. A hole still cuts a group of imported parts.
- Measurement labels stay clear of the rotate handles, and grouped holes show their real height.
- The fillet and chamfer slider skips sizes you already moved past.

## 1.0.2

- Fillets and chamfers keep merged flat faces, skip a full edge walk when adding another edge, and draw every highlight from one line.
- A click selects the surface under the cursor. Empty space in the view clears the selection. The shape under the cursor shows a light outline before you click.
- Dense imported meshes build a pick index on the first click. A part's shadow hides while you drag it and returns when you let go.
- Selecting a shape no longer rebuilds its mesh. Pattern copies share one geometry.
- Startup shows the PeakCAD mark while the CAD engine loads, then Start Modeling opens your projects.

## 1.0.1

- Reduce File Size lowers the triangle count of an imported mesh for STL export, keeping sharp edges and small parts.
- Optional folder passwords. Projects in a locked folder stay out of Recents and the main project list.
- Snap mates one side of a shape to a side of another, with a highlight on the face under the cursor.
- A click on empty workplane space clears the selection. Shapes can sit past the workplane.
- Measurement labels fade while the camera moves and return when you let go.
- The shape list scrolls when the window is short. Panels, menus, and dialogs ease in and out.

## 1.0.0

- First 1.0 desktop release, licensed GPL-3.0-or-later.
- STEP files import as separate bodies. Display meshes stay indexed, and exact STEP text is written when you save or export.
- Leaving a project asks you to save. Closing the desktop window offers Save, Don't save, and Cancel.
- STL import follows the workplane unit.
- Settings → About and Help → About PeakCAD show the copyright, the no-warranty notice, and the license texts.
- The installer ships `LICENSE.txt`, `THIRD-PARTY-NOTICES.txt` (including the OpenCascade LGPL-2.1 text), and a written source offer.

## 0.9.6

- Circular pattern tool with radius, count, and 90° rotation controls.
- Remappable hotkeys in Settings (defaults match existing shortcuts).
- Settings Tools index with searchable tool descriptions.
- Shape Properties stay editable while circular pattern is active.
- Undo cancels an active circular pattern session.
- Right-click help tips across editor tools.
- Import / Export text actions, snap-to-grid near the workplane bar, and related editor UI polish.

## 0.1.0

- Initial open-source alpha.
- Browser-based 3D workspace with primitive shape editing.
- STL import and STL/OBJ export.
- Grouping and hole subtraction workflows.
- Local project dashboard with generated thumbnails.
