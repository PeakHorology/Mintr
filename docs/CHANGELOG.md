# Changelog

Add a matching plain-language entry at the top of `apps/web/src/lib/releaseNotes.ts` when a version ships. Settings → Updates reads that file.

## Unreleased

## 1.1.2

- Push Pull is in: drag a flat face on a CAD-ready shape, type a distance if you want, then click Apply.
- Push Pull face outlines follow the real edges of the shape, the drag preview is a clean prism instead of stray triangles, L-shaped faces pick correctly, and a face that points at the camera no longer runs away from the mouse.
- Push Pull, Fillet, Chamfer, and Hollow work on CAD bodies and Groups that have been moved or turned since they were made.
- The Start modeling tip stays readable in dark mode.
- A .mintr file keeps the model history, so someone else can undo, redo, and keep working from where you left off.
- The projects home uses cover-style cards that fill the window. Folders use a folder icon. Opening a folder slides in; opening a design fades into the editor.
- The projects home uses the same cream, gold glow, cyan grid, and mint ticks as the rest of Mintr, with quieter chrome and a slower lift on each design.
- Drop sits a part on the workplane or a flat face. The part does not have to start above that surface.
- When Group, fillet, chamfer, sweep, or a hole cut fails, the notice says what to try.
- Print marks on CAD-ready parts come from the desktop engine, so turning them on stays quick.
- Imported STEP stays exact after autosave. The inspector shows volume in milliliters.
- Entering a sketch eases the camera onto the face. Switching Flat sketch and 3D sketch keeps the last view on each side. Orbit, pan, and zoom stay the same while you sketch and after Extrude. Shapes grow as you drag, a closed profile fills once, and Extrude rises from the sketch.
- While you sketch, Flat sketch and 3D sketch sit under the tip at the bottom.
- Group cuts several holes one at a time, so the outer shape stays true.
- Split and print marks cut those holes the same way, whether there is one hole or several.
- Group joins several solids one after another, so a pile of bosses stays true. Two parts still fuse in one step.
- A Group of three or more parts cleans leftover faces so the workplane matches the file.
- A hole sketched on a face stays CAD while you edit, so fillet still works.
- If one body in a Group is mesh, Mintr groups the CAD parts and leaves that body out.
- Imported STEP finishes baking before you close or leave, so later export stays exact.
- If Group falls to mesh, the notice names the mesh body so you can Group the CAD parts first.
- Several circles or rectangles in one sketch hole cut as separate exact holes.
- If a fillet cannot round every selected edge together, Mintr retries each edge on its own.

## 1.1.0

- Desktop Mintr uses its own CAD engine for Group, fillet, chamfer, hollow, and thread.
- Sketch extrude, sweep, and STEP import/export use that same engine.
- Group keeps imported and shared .mintr parts in place.

## 1.0.9

- Selected and hovered shapes keep a bronze outline, including spheres, fillets, and chamfers.
- Those outlines are two pixels thick so they stay easy to see.
- A fillet or chamfer wipes across the part when you apply it.
- A new solid comes in at drop height and lands on the workplane.
- Overhang marks fade in as soon as you turn them on.

## 1.0.8

- Double-click a sketch point to switch it between a corner and a curve.
- Smooth stays on, so you can click each point you want to curve.
- A Bézier curve shows while you drag the handles.
- A curve stays on its line instead of looping back on itself.
- An empty workplane opens a sketch as soon as you click Sketch.
- A sketched extrusion is an exact solid, so fillet and chamfer work on curved sides.
- Sketch tools use everyday names. A tip at the bottom follows the tool under the pointer.
- Extrude, Revolve, Sweep, and Cancel sit in the top bar next to Settings.
- Guide lines are in Settings while you sketch. View in 3D is its own button.
- A sketch selection can repeat in a line or around a circle.
- The angle number sits inside the corner it measures.
- Lineweight turns an outline into a wall.
- Workplane settings start with the printer brand, then the printer. The bed size follows.
- The bed warns when a part hangs past the plate, and marks faces that need support.
- Split can leave a dovetail, plug, snap, or thread so the pieces fit back together.
- A 3MF export keeps the color of each body.
- New designs save as .mintr. Older .peakcad files still open, and Settings can move projects into Documents\Mintr.

## 1.0.7.5

- PeakCAD has evolved, Mintr is here to serve
- Follow us on instagram @Mintr3D
- New website coming soon Mintr3d.com
- This rebrand changes nothing about PeakCAD, its aim is to make it more desirable for the community to use
- Still free, always will be. 1.0.7 was a big change please read patchnotes

## 1.0.7

- Gears have been added as a shape. Several tooth profiles to choose from. Tooth count and module set the size so two gears with the same module mesh.
- Sketch has had a massive revamp, more intuitive, more information, sketch in 3d finally works
- A face drawn on the side of a profile cuts with it. Sharing a side no longer leaves that face out.
- Type a length or an angle while you draw a line. Click a length or a corner angle to change it.
- Construction lines snap and stay out of the solid.
- Stroke turns an outline into a wall. Sweep carries a closed outline along a construction path.
- Every sketch corner shows its angle.
- A project or folder menu opens fully instead of being cut off by the card.

## 1.0.6

- The start screen checks for an update. When one is ready, the changelog sits under Start Modeling with a button to download it. Start Modeling still opens your projects.
- A cone can take a fillet or a chamfer.
- A new cone is a standard cone: bottom radius, top radius, and height. Free range opens length and width for an oval cone.
- An oval cone stays oval through a fillet or chamfer, and that fillet is much faster.
- Changing the width of a free-range cone keeps the length you already set.
- A dimension slider moves only when you drag its button. A click on the track leaves the number alone.

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
