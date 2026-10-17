---
name: sketchforge-mcp-skill
description: Control a live local SketchForge editor through its MCP server. Use when Codex needs to list currently open SketchForge editor tabs, target a tab by editorNumber/projectName, read the current scene, list or select objects, create boxes/cubes/cylinders/sketch extrusions, update dimensions/position/rotation, align objects, group/ungroup/cut/separate parts, list exact CAD edge ids, apply chamfer/fillet to specific edges, inspect editor errors, or capture viewport images from view-cube angles.
---

# SketchForge MCP

## Quick Start

Use this skill with PeakCAD open on this computer. The desktop app listens on localhost. A checkout can also use `npm run dev`.

1. Open a project in PeakCAD. Settings → Models must be on.

2. Start the MCP server. Installed PeakCAD:

```bash
PeakCAD.exe --mcp
```

From a checkout:

```bash
node scripts/sketchforge-mcp-server.mjs
```

The server talks to the open project. Changing the design asks the user to allow it. Tool names start with `peakcad_`. The older `sketchforge_` names still work.

## Client Compatibility

Codex can use this folder as a skill and the MCP server as tools. Install the folder under `~/.codex/skills/sketchforge-mcp-skill` and configure the MCP server in Codex.

Claude Desktop does not read Codex skills, but it can use the same `scripts/sketchforge-mcp-server.mjs` MCP server through Claude's `mcpServers` JSON config. Use the repository README for client setup examples.

## Targeting Editors

Always call `sketchforge_list_editors` first when the user mentions multiple projects, tabs, or a number like `49536`.

Use `editorNumber` for follow-up commands. It is a 5-digit per-tab number stored in browser `sessionStorage`, so two open SketchForge tabs have different numbers. The list also includes `projectName`, `projectId`, URL, shape count, selected count, notice, and last error.

If only one editor is open, commands may omit `editorNumber`; the server will target the sole live editor.

## Core Workflow

Read scene/object state before modifying geometry:

```text
sketchforge_list_editors
sketchforge_read_scene({ editorNumber })
sketchforge_list_objects({ editorNumber })
```

For object edits, use exact object `id` values from the scene. Do not invent object names; names are helpful labels only.

Useful tools:

- `sketchforge_select_objects`: select ids in the live editor.
- `sketchforge_delete_objects`: delete ids in the live editor, or delete the current selection when ids are omitted.
- `sketchforge_create_shape`: create `box`, `cube`, `cylinder`, or `sketch`.
- `sketchforge_import_mesh`: import STL-style mesh data into the editor.
- `sketchforge_update_object`: set exact dimensions, position, color, name, hole state, and `rotation`/`rotationX`/`rotationZ`.
- `sketchforge_align_objects`: align two or more ids using the same logic as the editor Alignment button.
- `peakcad_group_objects`: fuse ids into one solid. `peakcad_tie_objects` keeps them separate and moves them together. `peakcad_ungroup_objects` unwraps one level.
- `peakcad_intersect_objects`, `peakcad_mirror_objects`, `peakcad_circular_pattern`, and `peakcad_linear_pattern` use the same editor actions.
- `peakcad_duplicate_objects`, `peakcad_hide_objects`, `peakcad_drop_objects`, `peakcad_undo`, and `peakcad_redo`.
- `peakcad_sketch` draws rectangle, circle, polygon, slot, arc, line, and the other sketch tools, then extrudes or revolves. Pass `hostShapeId` to sketch on a face. `peakcad_set_sketch_dimension` changes a dimension on a sketch that already exists.
- `sketchforge_boolean_cut`: pass `solidIds` and `holeIds`; the result replaces the operands.
- `sketchforge_ungroup_objects`: restore grouped children while preserving edited child geometry.
- `sketchforge_separate_parts`: split disconnected parts in one object.
- `sketchforge_inspect_errors`: read the editor notice, edge modifier error, and last MCP error.

## Edge Features

Chamfer and fillet are separate edge-treatment operations in SketchForge. Do not fake a chamfer/fillet with cylinders or extra decorative geometry. Cylinders are only appropriate when the requested shape itself has a circular/rounded 2D footprint, such as rounded tray corners or a cylindrical peg.

For chamfer/fillet, never guess edge ids.

1. Call `sketchforge_list_edges({ editorNumber, id, sharpAngle })`.
2. Use returned `selectableEdgeIds` or inspect returned edge geometry.
3. Call `sketchforge_apply_edge_treatment({ editorNumber, id, kind, edgeIds, amount, chamferAngle })`.

`edgeIds` can be an array of numeric ids or `"all"`. `kind` is `chamfer` or `fillet`. The app commits the result through normal history, so undo/redo works.

## Images

Use `sketchforge_capture_image` for viewport PNGs. `face` can be `current`, `home`, `top`, `bottom`, `front`, `back`, `right`, or `left`. These use the same camera/view-cube orientation logic as the editor UI.

## Visual Verification

After creating or heavily modifying an object, use vision when available. Capture at least one useful viewport image with `sketchforge_capture_image`; for 3D geometry, prefer `home` plus any needed orthographic-style faces such as `top`, `front`, or `right`. Inspect the rendered result against the user's requirements before saying the task is done.

Do not rely only on numeric scene data when the user asked for a physical object. Use numeric checks for dimensions and visual checks for whether the model reads correctly.

## Safety

The bridge stays on this computer. If a command fails, call `peakcad_inspect_errors` before retrying. For geometry operations that can be expensive, set a larger `timeoutMs` on the tool call.
