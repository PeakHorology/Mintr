export const MODELS_ENABLED_KEY = "peakcad.models.enabled";
export const MODEL_GRANT_PREFIX = "peakcad.models.grant.";

const READ_ACTIONS = new Set([
  "get_scene",
  "list_objects",
  "list_edges",
  "inspect_errors",
  "capture_image",
  "select_objects",
]);

const ACTION_LABELS: Record<string, string> = {
  get_scene: "Read the project",
  list_objects: "List objects",
  select_objects: "Select objects",
  delete_objects: "Delete objects",
  create_shape: "Add a shape",
  import_mesh: "Import a mesh",
  update_object: "Change an object",
  align_objects: "Align objects",
  group_objects: "Group objects into one solid",
  ungroup_objects: "Ungroup objects",
  tie_objects: "Tie objects together",
  intersect_objects: "Intersect objects",
  mirror_objects: "Mirror objects",
  circular_pattern: "Make a circular pattern",
  linear_pattern: "Make a linear pattern",
  duplicate_objects: "Duplicate objects",
  hide_objects: "Hide or show objects",
  drop_objects: "Drop objects onto the workplane or a flat face",
  undo: "Undo",
  redo: "Redo",
  reduce_mesh: "Reduce an imported mesh",
  export_model: "Export a model file",
  sketch: "Draw a sketch and finish it",
  boolean_cut: "Cut a hole",
  separate_parts: "Separate parts",
  list_edges: "List edges",
  apply_edge_treatment: "Fillet or chamfer edges",
  inspect_errors: "Check for errors",
  capture_image: "Look at the view",
  edit_sketch: "Edit a sketch",
  set_sketch_dimension: "Set a sketch dimension",
  hollow: "Hollow an object",
  split: "Split an object",
  snap_faces: "Snap two faces together",
  lay_flat: "Lay a face on the workplane",
  create_thread: "Add a thread",
  export_step: "Export STEP",
};

export function readModelsEnabled() {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(MODELS_ENABLED_KEY) !== "0";
}

export function writeModelsEnabled(enabled: boolean) {
  localStorage.setItem(MODELS_ENABLED_KEY, enabled ? "1" : "0");
  window.dispatchEvent(new CustomEvent("peakcad:models-enabled", { detail: enabled }));
}

export function modelActionNeedsConsent(action: string) {
  return !READ_ACTIONS.has(action);
}

export function modelActionLabel(action: string) {
  return ACTION_LABELS[action] ?? action.replaceAll("_", " ");
}

export function modelGrantKey(projectId: string | null) {
  return `${MODEL_GRANT_PREFIX}${projectId || "local"}`;
}
