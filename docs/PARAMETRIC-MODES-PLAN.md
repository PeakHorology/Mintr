# One Mintr, two modes: basic and parametric (Pro)

Status: plan, 2026-10-31. Nothing here is built except where it says "already built". The
uncommitted work from 2026-10-30 (Values, expressions, the simultaneous sketch solver, sketch
rebuild) is the starting point and is described in **Where we are**.

## The short version

- **Do not do "every part is a recipe" as a storage rewrite.** Mintr's scene already *is* a
  recipe: a box is its numbers, a sketched part is its sketch plus a height, a group is its list
  of pieces and the operation that joins them (`groupedShapes` + `csg`), a hole is a piece marked
  as a hole, a pattern is its count and spacing, and fillet / chamfer / hollow / push-pull are
  recorded steps with a replay (1.2.0). The mesh on every part is a cache. What is missing is
  not a new file format; it is **one rebuild function** that walks that existing tree top to
  bottom when a value changes, and a handful of places where a size is not yet reachable by a
  value. That is 1.5–2.5 weeks, touches no file layout, and changes nothing a basic user sees.
- **Basic users see nothing.** Pro off hides the Values card, sums in size boxes, sketch rules
  and dimensions, exactly as today. Files carry optional extra fields only, so they open the
  same with Pro on or off, in 1.3.1 or later.
- **Graduation needs no conversion.** Because the scene is already the recipe, a basic user who
  turns Pro on can add a value to a design they made last month and type its name into a size
  box, and it works. The teaching is done by Sage (opt-in, on hover), by one button ("Make this
  a value") on every size box, and by a single quiet line that appears only when a design
  already carries Pro content. No banners, no nagging.
- **The solver stays on for everyone, with one guard.** A basic sketch has no rules, so the new
  solver has no equations to solve and must leave the geometry exactly as drawn. Make that a
  guaranteed early return, test it on fixture sketches, and keep the old step-by-step solver as
  the fallback it already is. Gating the solver by Pro would make the same file behave
  differently depending on a setting, which breaks requirement 4.
- **Kernel parity is a non-issue for the core.** The rebuild reuses the engine jobs that exist
  on both the desktop exe and the WASM build (primitives, recipe, sketch extrude/revolve,
  booleans, the modifier session). New kernel work appears only for two of the thirteen Pro
  ideas (draft/taper and a true clearance check) and is scheduled last.

## Where we are (read from the tree, 2026-10-31)

Built and uncommitted:

| Piece | File | Notes |
| --- | --- | --- |
| Named values and expressions | `apps/web/src/lib/parametricValues.ts` | `wall = 2`, `width = length / 2 + wall`, mm/cm/in units, min/max/round/trig, loop detection, rename, slider ranges. 346 lines, tested. |
| Values card | `apps/web/src/components/workplane/ValuesCard.tsx` | Per-part list, sliders when a range is set, notes. Only rendered when `onApplyValues` is passed, which the editor passes only when `peakcadPro` is on. |
| Driving settings from values | `apps/web/src/components/workplane/valueDrivenPatches.ts` | `drivenBy: { Width: "length / 2" }` keyed by inspector label, so every kind of part (box, gear, bin, thread, loft) is driven through the same code the typed number uses. Children of a group see the group's values. Sketch dimensions can carry an `expression`. |
| Inspector as data | `apps/web/src/components/workplane/shapeProperties.ts` | 913 lines extracted from `ShapeInspector.tsx` (which lost ~1000 lines). **This is the biggest shared-code change in the tree and the main regression risk for basic users.** |
| Apply values | `SketchForgeEditor.tsx` `applyValues` | Rebuilds a top-level part: own settings, own sketch, one level of grouped children (including sketched children through `updateCsgLeafAndRemesh`), then replays steps. One labelled undo entry. Guards against the scene changing during the async rebuild. |
| Sketch rebuild | `apps/web/src/lib/sketchRebuild.ts` | Extrude or revolve rebuilt the same way it was finished; sweep declines with a message. |
| Simultaneous solver | `apps/web/src/lib/sketch/simultaneousSolver.ts` | Damped Gauss–Newton over all rules at once, rank analysis for DOF / redundant / fighting rules, hold points while dragging. `solveSketchDoc` in `solver.ts` now calls it first for **every** sketch and falls back to the old stepwise pass only when something is unsatisfied. |
| Angle dimension, live lengths while dragging | editor + solver | Pro-gated in the UI. |
| Types | `types/sketchforge.ts` | `ShapeValue`, `WorkplaneShape.values`, `WorkplaneShape.drivenBy`. Both in the undo fingerprint and in `workplaneShapesEqual`. |

Already in 1.2.0 (feature history, `docs/FEATURE-HISTORY.md`): `features: PartFeature[]` for
fillet / chamfer / hollow / push-pull with `featureBase`, durable edge/face references, replay in
TypeScript over the engine's modifier session (`lib/featureReplay.ts`), old files converted on
load in `hydrateClipboardShape`, resize replays steps, mirror written to `edgeTreatments` for
older Mintr and guides.

Already parametric without being called that: primitives (all sizes are fields), gears
(`gearSpec`), Gridfinity (`recipe` built in C++ and in `recipeBrep.ts`), threads (a part of their
own inside the group), lofts, text, sketched parts (`sketchDoc` + `height` + `sketchFinish`),
groups (`groupedShapes` + `csg.op`, with `importedMesh` documented as "an evaluation cache"),
holes (`hole: true` children, `holeSpec` for the hole tool), patterns (`patternFeature`
source/instances regenerated when count or spacing changes), Smooth and Shrink Wrap (groups with
an op), textures (settings re-applied to the body).

Genuinely baked today: imported STL/OBJ/3MF/STEP bodies (inherently), the two pieces of a
**Split** and the dovetail/plug/snap **joins**, a group that fell back to mesh because the exact
boolean failed, Tinkercad shapes Mintr does not have, and parts resized with "Keep edge size when
resizing" off.

Tests pass for the parametric pieces (`sketchSolver`, `simultaneousSolver`, `parametricValues`,
`sketchDoc`, `partFeatures`, `sketchDirect`: 69 tests). The full suite was not run for this plan.

## Lessons from other programs (ideas only, no code)

- **Tinkercad → Fusion** is the transition we are designing against. People leave Tinkercad
  because it has no dimensions and no history, and bounce off Fusion because everything is
  history from the first click and the timeline punishes you for changing an early step.
  Mintr's answer: history exists for everyone but is quiet (the Features list), and values are
  a layer you add to an ordinary design rather than a mode you start in.
- **OpenSCAD's customizer** proves that a design with a few named numbers and ranges is useful
  to people who never write a line of it. Our sliders are that. Shared designs are the best
  reason a basic user ever turns Pro on.
- **Onshape / Fusion variables** are flat, document-wide lists; **FreeCAD's spreadsheet** is the
  same idea with worse ergonomics. Per-part values scoped through groups (what we have) is
  closer to how Mintr already thinks (Group is the unit of a design), but one shared list per
  design is what people expect once a lid must match a box. Both, scoped, is the right end state.
- **SolveSpace** shows that a fully simultaneous solver with a clear DOF count and "these two
  rules fight" is friendlier than any amount of UI. Keep investing there, not in constraint
  glyph clutter.
- **Plasticity and Shapr3D** show that direct modelling (push, pull, fillet without a timeline)
  is what most makers want most of the time, and that a history can sit *underneath* it. That is
  Mintr's shape already: direct tools that happen to record steps.
- **CadQuery / OpenSCAD** show the cost of "everything is a program": great for the 5% and a wall
  for everyone else. Do not go there; values and sums are as far as the language goes.

## Recommended architecture

### 1. The scene is the recipe. Do not add a second model.

Keep `WorkplaneShape` as the single source of truth for both modes. A part's "recipe" is the
fields it already has; a group's recipe is its children; a part's modifiers are its `features`.
Every mesh (`importedMesh`, `cadBrep`) is a cache that any rebuild may rewrite. Nothing new is
stored for basic users, and no file version bump is needed (same policy as feature history:
additive optional fields only).

Why not the 3–5 week "record every step" rewrite:

- It would duplicate what the tree already encodes (a hole is already "subtract this piece").
- It changes how every part is stored, so every basic user is exposed to migration bugs for a
  feature they have not turned on.
- The only operations it would newly capture are Split and the joins, which are a small, late,
  optional phase on their own (see Phase F).
- File size and autosave would get worse (more entries to write), not better.

### 2. One rebuild function, used by everything

Extract from `applyValues` a pure-ish `rebuildBody(body, outerScope, engine)` in a new
`lib/parametricRebuild.ts` that does, in order and recursively:

1. Resolve the part's values against `outerScope` (`resolveValues`).
2. Apply driven settings (`drivenSettingsPatch`), including **step sizes in `features`**
   (fillet radius, chamfer distance, hollow thickness, push-pull distance) and pattern count /
   spacing and hole / thread / gear sizes, all through inspector labels as today.
3. If sketched, rebuild from the sketch with driven dimensions (`rebuildSketchedShape`).
4. For each grouped child, recurse (so nested groups work; today only one level does).
5. Re-evaluate the group's boolean (`updateCsgLeafAndRemesh` / `flushPendingFeatureRemesh`).
6. Replay recorded steps (`replayPartFeatures`), marking any that no longer fit.
7. Return the new body plus a list of plain-language problems ("Fillet 3 mm no longer fits",
   "Teeth could not follow `count / 2`: 7.5 is not whole").

Resize, "edit a step", pattern changes and value changes all end up calling the same function,
so there is one place to be right and one place to test on both kernels. The editor's current
`applyValues` becomes a thin caller that commits the result as one undo entry.

### 3. What a value can and cannot reach

- Can: every inspector number (already), sketch dimensions (already), step sizes (Phase B),
  pattern count/spacing, hole and thread and gear sizes (free once labels are drivable), a
  child's position inside a group (new labels: Offset X/Y/Z from the group centre, Phase B).
- Cannot, and says so quietly: sizes of a mesh import, a Split piece, a join, a mesh-fallback
  group. Those labels simply have no ƒ button; Sage explains why on hover.

### 4. Pro off: how Pro content behaves

Files must open identically, so Pro content is honoured, never shown:

- Values and `drivenBy` are kept through load, save, copy, undo and guide slimming (they already
  pass through: every path spreads the shape, nothing allowlists fields).
- Driven size boxes show their worked-out number like any other number. **Typing a number into a
  driven box releases the sum for that label** whatever the Pro setting (today, with Pro off, the
  typed number lands but the stale sum stays; fix in Phase A).
- Sketch rules keep holding when a point is dragged (the solver runs for everyone). If a drag is
  resisted by rules, the sketch status line says once: "This sketch has rules from Mintr Pro.
  Turn Pro on in Settings to see or change them." That line never appears for a sketch without
  rules, so basic users never meet it on their own work.
- The Features list is already visible to everyone (1.2.0) and stays as it is.

### 5. Solver policy

Keep `solveSketchDoc` calling the simultaneous solver for every sketch, because a sketch with
rules must behave the same with Pro on or off. Add, in Phase A:

- An early return in `solveSketchDoc`: no active constraints and no driving dimensions → return
  the input doc untouched (same object identity for entities), `status: "under-defined"`, DOF =
  2 × free points + free radii. This makes "basic sketches are not changed by the solver" a
  guarantee rather than a property of the maths.
- A test that runs every sketch fixture the repo has (traced-photo size included) through the
  new and old solver and asserts identical point coordinates when there are no rules.
- A perf check on a sketch with several hundred points (Trace from photo) so the per-frame
  solve during a drag does not regress; the early return should make this trivially fast.

Keep the stepwise solver as fallback for at least one release, then delete it when the
simultaneous solver has handled real Pro sketches without needing it.

### 6. Design-level values (Phase D, needs a decision)

Most real parametric designs are several separate parts that share numbers (a box and its lid).
Today values live on parts and are shared only through grouping. Add one **Design values** list
stored on the project, used as the outermost scope. Storage is a new optional project field; a
1.3.1 build opening and re-saving such a file would drop that list (parts' own values survive).
Alternative that avoids even that: store design values on a hidden construction part. The
owner should pick; the recommendation is the project field, with the caveat noted in release
notes.

## What basic users see

Nothing new, by construction:

- Pro off: no Values card, no ƒ marks, size boxes are numeric (`inputMode: "decimal"`), sketch
  constraints and dimensions hidden, solve status hidden, Angle tool hidden, no snap-inferred
  constraints recorded. All already gated on `workspaceSettings.peakcadPro`.
- The Features list, resize-replays-steps, and "Keep edge size when resizing" are unchanged
  from 1.2.0.
- The inspector refactor (`shapeProperties.ts`) must produce exactly the same labels, ranges,
  steps, hints and patches as before for every shape kind with Pro off. See Testing.

The only basic-user-visible additions, both conditional on the design already carrying Pro
content and both one line long: the sketch status line in §4, and, in place of the Values card,
"This design uses Mintr Pro values. Turn Pro on in Settings to change them." Someone who never
opens a Pro file never sees either. (Decision for the owner: keep both, or drop the inspector
line and rely on Sage alone.)

## Graduation path, from the user's point of view

1. **Day one, Pro off.** Builds like Tinkercad. Groups, holes, sketches, fillets. Behind the
   scenes every part is already a recipe, every fillet already a replayable step. They may
   notice the Features list, and that resizing a filleted box keeps the fillet. That is the
   whole of what "history" means to them so far.
2. **A hint, only if asked.** With Sage on, hovering any size box ends with one sentence: "With
   Mintr Pro on, a size can be a sum like wall * 2." Hovering a dimension-less sketch line:
   "Mintr Pro adds rules and sizes to sketches." Sage is opt-in, so this teaches only people who
   asked to be taught. Sage never gets a gender in copy.
3. **Receiving a Pro design.** A friend sends a `.mintr` with a `wall` slider. It opens and prints
   fine with Pro off; the inspector says once where the slider lives. Curiosity, not pressure.
   (Optional, owner decision: show just the sliders of a shared design even with Pro off, as
   OpenSCAD's customizer does. Recommended *against* for now because it is new basic-user UI;
   revisit after Pro has settled.)
4. **Turning Pro on.** Settings → Mintr Pro. Same room, same tools. The inspector grows a Values
   card for the selected part. Their old designs are all eligible: nothing to convert, nothing
   to redo.
5. **First value, zero theory.** Every size box gains a small ƒ. Clicking it offers "Make this a
   value": `width = 40` appears in the card and `width` appears in the box. Their first
   parametric part is the one they already made. Changing `width` in the card resizes it.
6. **First sum.** Type `width / 2` into Height. Sage, on hover of the ƒ, explains sums, names,
   units and the few functions in a sentence each.
7. **Groups inherit.** Add `wall = 2` to a bin they grouped last week; its inner cutter can use
   `wall`. The Values card on the group says which children use its values.
8. **Sketches grow rules.** Entering an old sketch with Pro on shows no rules yet. "Add the
   obvious rules" (one button in the sketch rail, Phase C) adds horizontal / vertical /
   coincident where the drawing already satisfies them, so the sketch stops shearing when
   dragged. Dimensions can be sums of the part's values. The status line counts how many ways
   the sketch can still move, and names fighting rules in words.
9. **Steps join in.** The Features list they already know gets ƒ on each step size:
   `fillet = wall / 2`. Turning a step off is the same checkbox as today.
10. **Sharing back.** Give `wall` a lowest and highest and a note; it becomes a slider for the
    next person. Save variants ("Small", "Large") as named sets of numbers (Phase D).
11. **Turning Pro off again.** Everything they made stays. Sums become numbers on screen, rules
    keep holding, the file is unchanged.

## Phased build order

Sizes are working days for one developer with Claude; "shared" marks code every user runs.

### Phase A: make what is built safe to ship (3–5 days). Shared: yes.

- Solver early return for rule-free sketches + fixture equivalence test + perf check (§5).
- Release `drivenBy[label]` whenever a plain number is typed, Pro on or off.
- Inspector equivalence test: for a sample part of every `ShapeKind` (and a group, a hole, a
  gear, a bin, a thread, a loft, a sketched part, a split piece, an import), snapshot the output
  of `getShapeProperties` with Pro off (labels, min, max, step, value, hint, disabled). Review
  the snapshot once by hand against 1.3.1, then it guards every later change.
- Round-trip test: `values`, `drivenBy`, `dimension.expression` survive project save/load,
  mesh-blob vaulting, clipboard, undo vault, `.mintrguide` slimming, and `hydrateClipboardShape`.
- The two one-line notices for designs that carry Pro content (§4), or the decision to drop one.
- Sage guides: Values card, ƒ / "Make this a value", Angle rule, "sum", slider. No gender.
- "Make this a value" button on the ƒ menu.
- Commit. Release notes already drafted in `releaseNotes.ts` `UNRELEASED_NOTES`.

### Phase B: one rebuild function (1.5–2.5 weeks). Shared: partly.

- `lib/parametricRebuild.ts` as in §2; `applyValues`, resize-with-steps and step edits call it.
- Nested groups (recursion), sketched children at any depth, patterns and hole cutters inside
  groups, child offsets as drivable labels.
- Step sizes drivable through the Features list labels.
- Problems reported in the Values card in plain words; a step that stops fitting is marked as
  1.2.0 already marks it.
- Slider behaviour: numbers update live, geometry rebuilds on release, one undo entry per
  release (decision: live geometry for primitives only, since those rebuild in a frame).
- Tests on both engines (extend `featureReplay.test.ts`, which already runs on the exe and WASM):
  value change on a filleted, hollowed, grouped, nested, sketched body gives the same result as
  making the change by hand. No new kernel jobs.
- Shared code touched: `editorBoolean.ts` remesh helpers and `featureReplay.ts` are called by
  basic resize too, so run the basic golden-file regression (Testing) after.

### Phase C: growing into sketches (1–2 weeks). Shared: solver only.

- "Add the obvious rules" for an existing sketch (horizontal, vertical, coincident, equal where
  already true within tolerance).
- Pro-off behaviour of constrained sketches finalised (§4).
- Dimension expressions may use design values (after D) and show the sum on the label.
- Fully-defined / under-defined colouring of sketch geometry if not already present; conflict
  naming already exists.
- Arcs and smooth curves as solver entities if any remain outside it (verify; the plan memory
  lists "arcs in solver" under Phase 0).

### Phase D: design values and variants (1–2 weeks). Shared: project store.

- Design-level values list (§6), outermost scope for every part's sums.
- Variants: named sets of numbers for the design's values; switching one rebuilds.
- Fit presets: a built-in list of clearance values (press, slide, loose, printer tolerance) you
  can add to a design's values with one click; they are just values with notes.
- Additive project field; test that 1.3.1-shaped files still open and that re-saving in the new
  build preserves everything.

### Phase E: the Pro ideas that fall out of the architecture (2–5 days each, pick as wanted)

| Idea | Cost | Kernel work |
| --- | --- | --- |
| Values in hole / thread / gear sizes | free once labels are drivable (B) | none |
| Value-driven patterns | free (B) | none |
| Switch a step off | exists for steps; extend to group children via `csg.suppressed` | none |
| Weight / material cost | volume already shown × a density table | none |
| Overlap check | boolean intersect of selected pairs, report volume | existing jobs |
| Linked mirror | a pattern-like feature with two instances | none |
| Section view | display clipping plane; X-ray already glides a cut | none |
| Design variants | Phase D | none |
| Pattern along a curve | TS placement along a sketch path, existing jobs | none |
| Better exports | independent of this plan | none |
| Macros | defer; values + variants cover most of the ask | none |
| Draft / taper | a real engine job, written for both C++ builds + `nativeKernelCoverage.test` | **yes** |
| Print-in-place gap check | mesh distance in TS (one path for both) or a kernel job | maybe |

### Phase F (optional, only if asked): Split and joins as steps (2–3 weeks). Shared: Split tool.

Record a split as a step on a tie of two pieces (`splitOf: { source, plane, join }`), so a value
can move the cut or resize a dovetail. This is the only part of the old "every part is a recipe"
idea that still has value, and it can wait until Pro users ask for it.

## Risks and how to test that basic Mintr is unchanged

1. **Inspector refactor** (`shapeProperties.ts`, −1000 lines in `ShapeInspector.tsx`). Highest
   risk; it runs for every user on every selection. Mitigation: the Phase A snapshot test, a
   manual pass through every shape kind with Pro off, and `npm run test:e2e`.
2. **Solver for everyone.** Mitigation: §5 early return, fixture equivalence, perf check on a
   traced sketch, keep the stepwise fallback one release.
3. **Golden-file regression for basic designs.** Build a small fixture set from 1.3.1: a box with
   a hole group, a filleted and hollowed cup, a sketch extrude on a face, a revolve, a pattern,
   the Tinkercad fixtures already in `tests/fixtures`. For each: open → export STL → compare with
   `meshSignatureMap` against a stored signature, Pro off. Run on WASM in CI and on the exe
   locally (`nativeKernelCoverage.test.ts` pattern). Any phase that touches shared code must
   leave these green.
4. **Autosave churn.** `values` and `drivenBy` are in the undo fingerprint; confirm the
   fingerprint is stable when nothing changes (an `undefined` vs `{}` difference would create
   phantom history entries). Add to `editorHistory.test.ts`.
5. **Async rebuild races.** `applyValues` already checks the scene fingerprint before committing;
   keep that in `rebuildBody` and add a cancel when a newer value change arrives (sliders).
6. **Desktop parity.** No new kernel jobs through Phase D, so the risk is the replay path, which
   `featureReplay.test.ts` already runs on both engines; keep it that way for every new rebuild
   test. Draft and gap check (Phase E) are the only items that need `npm run build:kernel`,
   `build:kernel:wasm` and a `nativeKernelCoverage` entry.
7. **Two values with one name across scopes**, renames, loops, divide by zero: already handled
   in `parametricValues.ts` and tested; keep extending `parametricValues.test.ts`.
8. **Guides.** `.mintrguide` checks numbers, not geometry, and slims `sketchDoc`; values ride
   along harmlessly. Confirm with `mintrGuide.test.ts` after Phase A.

## Decisions for the owner

1. Approve replacing the 3–5 week storage rewrite with Phase B's rebuild function (recommended).
2. The two one-line notices for designs that already carry Pro content, with Pro off: keep both,
   keep only the sketch one, or none (Sage only).
3. Sliders with Pro off for a shared design (customizer-style): not now (recommended) or yes.
4. Design-level values stored as a project field (1.3.1 re-save drops them) or on a hidden part.
5. Slider feel: geometry live while dragging for primitives, on release for everything else.
6. Whether to schedule Phase F (Split and joins as steps) at all.

## Not verified while planning

- The full test suite and `test:e2e` were not run; only six parametric/solver files (69 tests)
  were, and they pass with `tests/vitest.config.ts`.
- The desktop exe was not built or run; kernel-parity claims rest on the fact that no new jobs
  are proposed before Phase E.
- The inspector refactor's equivalence to 1.3.1 for every shape kind was not checked by hand.
- Pro-off behaviour when dragging a point in a sketch that has rules was reasoned from the code,
  not tried in the app.
- File size impact was not measured; none is expected because values are short strings and no
  new mesh snapshots are written.
