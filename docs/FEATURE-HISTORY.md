# Feature history: parts that rebuild from their steps

Status: stages 1–4 built (unreleased). Builds on the single engine (C++
compiled for both the desktop and the browser), so regeneration is written once. See
**As built** at the end for where the build differs from this plan.

## What changes for people

Today a fillet, chamfer, hollow, push/pull or thread is baked into the part. Change the box
underneath and Mintr tries to put the fillet back by matching edges, and if it can't, the fillet
is lost with a notice. After this:

- Every part has a list of its steps: *Box 20 × 20 × 20 → Fillet 1 mm, top edges → Hollow 2 mm, open top*.
- Change any step (the box height, the fillet size) and everything after it rebuilds.
- A step that no longer fits (a fillet too big for the new box) is marked in the list and skipped;
  the rest of the part still rebuilds. Nothing is silently lost.
- Files get smaller: no full copy of the part is kept for every step.

## Model

```ts
type Body = {
  base: BodyBase;             // what the part starts as: a primitive, a sketch extrude, a group/CSG tree, an imported STEP
  features: Feature[];        // ordered steps applied to it
  cache?: { brep: string; mesh: MeshData; regeneratedFrom: string }; // last good result, keyed by a hash of base + features
};

// `id` survives across undo entries, so a guide step and a model-tree edit can name the same step.
// `failed` holds the reason a step no longer fits; guide checks skip failed and suppressed steps.
type Feature =
  | { id; kind: "fillet" | "chamfer"; amount; profile?: "round" | "cove"; chamferAngle?; edges: EdgeRef; suppressed?; failed? }
  | { id; kind: "hollow"; thickness; openings: FaceRef[]; suppressed? }
  | { id; kind: "pushPull"; face: FaceRef; distance; suppressed? }
  | { id; kind: "thread"; face: FaceRef; spec: ThreadFeature; suppressed? }
  | { id; kind: "hole" | "split" | "pattern"; ... };
```

**Edges and faces are referenced by what they are, not by a number.** Topology numbers change
whenever the part changes. An `EdgeRef` is one of:

- `{ rule: "allSharp", sharpAngle }`: every sharp edge, whatever the part becomes;
- `{ rule: "tangentChain", seed: Fingerprint }`;
- `{ rule: "picked", fingerprints: Fingerprint[] }`: the edges the person clicked, each with its
  midpoint, direction, length and the two faces it joins. These are matched after a change by
  nearest fit, scaled with the part. Today's `edgeFingerprints` are the seed of this.

`FaceRef` works the same way, with a plane or axis, normal and area.

A `Fingerprint` is today's `EdgeTreatmentFingerprint` (one type, with `centroid` and
`direction`), stored in the body's own frame rather than world space, so it survives moving and
turning the part. The engine must produce the same fingerprints as `fingerprintCadEdge` for the
same edge, on the desktop and in the browser, because guides compare them.

## Engine

One new engine job, written once in C++ and run by both apps:

```
regenerate { base, features, upTo? } →
  { ok, brep, mesh, steps: [{ id, ok, message?, matchedEdges? }] }
```

It builds the base, then applies each feature in order with the same code the live tools use
(`coveEdges`, the fillet ladder, `hollowSolid`, push/pull, threads). A failed step is reported
and skipped. The recipe interpreter in `recipe.cpp` (Gridfinity) already works this way and is
the starting point.

The editor regenerates only from the first changed step: the engine keeps the shape after each
step in its parsed-shape cache, keyed by a hash of base + features up to that step.

## Files and undo

- `.mintr` stores `base` + `features`, plus the cached result so files open instantly without
  rebuilding.
- `edgeTreatmentHistory[].before` / `threadHistory[].before` snapshots stop being written once
  replay is in. Old files are migrated on open: the first `before` becomes `base`, each entry's
  `feature` becomes a step, and the stored result stays as the cache. If replay of a migrated
  part does not reproduce its stored result, the part keeps its baked form and says so.
- Undo stays as it is: it records whole-design states, which now hold small step lists
  instead of big meshes. `shapeFingerprintPayload` must include `features`, or a step edit
  whose mesh happens to hash the same is deduplicated away.
- **No file-version bump; additive fields only.** The cache stays in today's `importedMesh` /
  `cadBrep` / `cadBrepFrame` (plus a `regeneratedFrom` hash), and `edgeTreatments` keeps being
  written as a mirror of the features. Older Mintr then still opens new projects and guides,
  and the existing save/guide stripping keeps working.
- Migration runs in `hydrateClipboardShape`, the one function every load path already uses
  (projects, every undo entry, guides, guide sessions, the guide log, the clipboard). Checking
  that a migrated part replays to its stored result needs the engine, so it happens lazily on
  first regenerate, not while loading.

## Guides (.mintrguide)

A guide is a project file plus slim undo entries and a chapter of steps. Steps are checked with
numbers only (kind, size, pose, sketch, fillet/chamfer size and edge count, edge fingerprints),
never geometry, so feature history does not break guides as long as `edgeTreatments` stays
written. What it changes and enables:

- Today's slim guide entries still carry `edgeTreatmentHistory[].before` meshes by accident
  (`slimGuideShape` does not reach into them). Strip them in stage 1; guides never read them.
- Guides only understand add, size, move, turn, sketch, group, fillet and chamfer. With
  features, `classifyChange` diffs feature lists, so hollow, push/pull, thread, hole, split and
  pattern get cues and checks for free, and `featureSignature` replaces `treatmentSignature`.
- Fingerprints in the part's own frame remove the centre-shift workaround in
  `fingerprintsAgree`, so edge checks work on moved and turned parts.
- `regenerate { upTo }` can show the author's part at any step without stored meshes, and the
  engine's `matchedEdges` can highlight which edges the learner should pick.
- A `GuideStep` gets an optional `featureId` to check a step precisely.

## UI

The model tree already lists a grouped part's features with suppress, reorder and edit
(`onSuppressFeature`, `onReorderFeature`, `onUpdateFeature`). Extend it to every part's steps:
click a step to edit it with the same panel that made it; a failed step shows a quiet mark and
the reason. Nothing new on the dashboard or toolbar.

## Stages

1. **Record** (1–2 weeks). New fillets, chamfers, hollows, push/pulls and threads write a
   `Feature` with durable `EdgeRef`/`FaceRef` next to today's fields. No behaviour change.
   Also: `features` in the undo fingerprint; one fingerprint type in the part's frame;
   `ThreadFeature.faceId` becomes a `FaceRef`; strip `before` snapshots from guide entries.
2. **Regenerate job** (2–3 weeks). `regenerate` in the engine, used first in place of today's
   remesh-and-rematch path when a treated part is resized. It rewrites the `edgeTreatments`
   mirror with fresh engine fingerprints. Tests: every feature kind, replayed on resized, moved,
   turned and mirrored parts, must match applying it by hand; engine fingerprints equal
   `fingerprintCadEdge`; a learner who resizes a filleted part still completes the guide step.
3. **Edit any step** (1–2 weeks). Model-tree editing of earlier steps; failed-step marks.
   Edits, suppress and reorder commit labelled undo entries, so the guide log records them;
   guide checks skip suppressed and failed steps; guide cues for every feature kind.
4. **Drop the snapshots** (1 week). Stop writing `before` copies; migrate old files on open.
   Tests: 1.1.9 `.mintr` and `.mintrguide` fixtures migrate and replay (desktop and browser);
   built-in guides still pass `mintrGuide.test.ts` and `toolGuide.test.ts`.

Before stage 4, confirm where thread history is written: no writer of `threadHistory` was found
in apps/web/src, so there may be nothing to migrate for threads.

Stage 2 needed the browser to run the C++ engine, so the replay is written once. It does now:
booleans, STEP export, sketch extrude and sweep, Gridfinity and the fillet/push-pull session go
to the WebAssembly build first (`browserMintrKernel.ts`), with the occt-wasm code as fallback.

## As built

- **Where the steps live.** `WorkplaneShape.features` (`PartFeature[]`, in `types/sketchforge.ts`)
  and `featureBase`, a copy of the part before its first step (not kept for groups, which
  rebuild their pieces instead). Each step stores a `frame` (bottom centre and size of the solid
  it was applied to) and `appliedAt` (where the part sat right after it). Edge fingerprints and
  face origins are measured from `frame.origin` and scaled per axis to the live part on replay,
  so moved and resized parts still find their edges. Builders: `lib/partFeatures.ts`.
- **No `regenerate` job in C++.** Replay (`lib/featureReplay.ts`) runs in TypeScript over the
  engine's existing modifier session (prepare → preview / hollow / pushPull → refine →
  finalize), so it uses exactly the calls the live tools use and runs on the desktop exe, the
  browser WASM build and occt-wasm alike. Edges are matched with `matchRecipeEdgeIds`, faces by
  normal and distance from the plane. Steps are replayed from the start each time; there is no
  per-step cache yet.
- **What triggers a replay.** Editing, turning off/on or removing a step in the inspector's
  Features list (one labelled undo entry each); re-applying steps to a group whose pieces were
  rebuilt (any step kind, not only fillets); and resizing a part that keeps its step sizes
  (`rebuildsOnResize`: the default for parts with steps; "Keep edge size when resizing" off
  stretches instead). A resize grows the base by as much as the part grew
  (`resizedFeatureBase`), replays, and replaces the resize's own undo entry. Only sizes
  changed while editing count, so opening a file never rebuilds anything.
- **Reopening the last step.** Opening Fillet or Chamfer on a part whose newest step is that
  tool's rebuilds the part up to just before it and reopens it for editing; Update replaces
  the step.
- **Mirror.** `edgeTreatments` is rewritten from the steps after every replay
  (`edgeTreatmentsForSteps`), so guides and older Mintr keep working unchanged.
- **Persisted** through project mesh blobs, shape JSON, the clipboard, undo-history vaulting and
  equality; `features` is in the undo fingerprint; guide entries drop `featureBase`,
  `edgeTreatmentHistory` and `threadHistory`.
- **Stage 4 (snapshots).** A part whose steps can all replay (`stepsReplaceSnapshots`) writes
  no `edgeTreatmentHistory` copies; pieces inside a group still do. Old files are converted on
  load in `hydrateClipboardShape` (`stepsFromSnapshots`): the first copy becomes the base, each
  copy's box places its step. Only parts whose copies were not turned or mirrored and line up
  one to one with their fillets are converted; others load exactly as before. Conversion is
  data only, with no engine call, so files open as fast as before and look identical.
- **Guides.** Push/pull steps get their own cue ("Pull the top face out 6 mm"), live coaching
  (open Push Pull, pick the face, distance, Apply) and a check of face direction and distance.
  Hollow is taught through the Combine tool, so it needs no cue of its own.
- **Threads** are a part of their own (the Threads shape, combined into a group), so they are
  already editable and rebuild with the group; there is no thread step to record.
- **Not done yet:** hole / split / pattern steps, reordering steps.
- **Tests:** `tests/unit/partFeatures.test.ts`, `tests/unit/featureReplay.test.ts` (runs on the
  native exe and the WASM build: fillet + hollow cup, resized base, pull height, resize to an
  exact size, an older file's copies converted and replayed, a fillet that no longer fits
  being skipped while later steps still apply), `tests/unit/mintrGuide.test.ts` (push/pull).
