export type CadFailureKind = "group" | "fillet" | "chamfer" | "sweep" | "hole" | "engine" | "pushPull";

const GROUP_MESH = "Group used a mesh instead of exact CAD. Fillet may not work on this body. Overlap the parts more, or try a simpler shape.";
const GROUP_FAIL = "Could not join these parts. Make sure they overlap, then try Group again.";
const HOLE_FAIL = "That hole did not cut through. Check that it overlaps the solid, then Group again.";
const FILLET_FAIL = "That radius is too big for this edge. Try a smaller fillet, or select fewer edges.";
const CHAMFER_FAIL = "That size is too big for this edge. Try a smaller chamfer, or select fewer edges.";
const SWEEP_FAIL = "Sweep could not follow that path. Keep the outline closed and the path from crossing itself.";
const ENGINE_FAIL = "The CAD engine could not start. Close Mintr and open it again. If this keeps happening, reinstall Mintr.";
const PUSH_PULL_FAIL = "That push went through the part. Try a smaller distance.";
const PUSH_PULL_FLAT = "Push Pull needs a flat face.";
const PUSH_PULL_MOVE = "Push Pull could not move this face. Try a smaller distance, or Group the parts again.";

function looksBeginnerReady(text: string) {
  if (!text || text.length > 180) return false;
  if (/\b(occt|wasm|brep|manifold|kernel|native|worker|opencascade|peakcad)\b/i.test(text)) return false;
  return /[.?!]$/.test(text);
}

/** One-line, beginner copy for Group / fillet / chamfer / sweep / hole / engine failures. */
export function cadFailureCopy(raw: string | null | undefined, kind: CadFailureKind = "group"): string {
  const text = (raw ?? "").trim();

  if (kind === "engine" || /cad worker could not start|engine files|reinstall peakcad/i.test(text)) {
    return ENGINE_FAIL;
  }
  if (kind === "hole") {
    return looksBeginnerReady(text) ? text : HOLE_FAIL;
  }
  if (kind === "sweep") {
    return looksBeginnerReady(text) ? text : SWEEP_FAIL;
  }
  if (kind === "pushPull") {
    if (looksBeginnerReady(text)) return text;
    if (/flat face|not planar|plane/i.test(text)) return PUSH_PULL_FLAT;
    if (/cut|through|empty/i.test(text)) return PUSH_PULL_FAIL;
    return PUSH_PULL_MOVE;
  }
  if (kind === "fillet" || kind === "chamfer") {
    if (
      looksBeginnerReady(text)
      && /too big|smaller|fewer edges|cuts through the hole|select at least one|timed out|draft quality|walls cannot|inside corners/i.test(text)
    ) {
      return text;
    }
    if (/empty body/i.test(text)) {
      return kind === "chamfer"
        ? "That chamfer left nothing. Try a smaller size."
        : "That fillet left nothing. Try a smaller radius.";
    }
    if (/rebuild|fuse group|prepare is missing|no solid body/i.test(text)) {
      return "This body is not ready for a fillet. Group it first, or try a simpler shape.";
    }
    return kind === "chamfer" ? CHAMFER_FAIL : FILLET_FAIL;
  }
  if (/mesh group|faceted|exact cad boolean unavailable/i.test(text)) {
    return GROUP_MESH;
  }
  if (/cut with this hole|could not cut this selection|did not cut through/i.test(text)) {
    return HOLE_FAIL;
  }
  if (looksBeginnerReady(text)) return text;
  return GROUP_FAIL;
}

export const CAD_GROUP_MESH_NOTICE = GROUP_MESH;
export const CAD_GROUP_FAIL_NOTICE = GROUP_FAIL;
export const CAD_HOLE_FAIL_NOTICE = HOLE_FAIL;
export const CAD_ENGINE_FAIL_NOTICE = ENGINE_FAIL;
