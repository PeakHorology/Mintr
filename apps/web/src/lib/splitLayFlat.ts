import { meshAabb } from "@/lib/editorShapeMesh";
import { layFaceOnWorkplane, type FaceMatePose } from "@/lib/objectSnap";
import { splitPlaneFrame, type SplitCut } from "@/lib/splitShape";
import { cleanNearZero } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

/** Room between the pieces once they are laid down, as Cut to fit leaves between its pieces. */
const LAY_FLAT_GAP_MM = 8;

/**
 * Where each piece of a plain Split goes so its cut face sits on the workplane, ready to print:
 * turned cut face down, resting on the workplane, side by side with a gap where the part was.
 * The pieces come out of Split unturned, so the cut face of the piece below the plane points
 * along the cut, and the one above points back.
 */
export function splitPiecesCutSideDown(
  source: WorkplaneShape,
  cut: SplitCut,
  pieces: readonly WorkplaneShape[],
): Array<{ id: string; pose: FaceMatePose }> {
  const frame = splitPlaneFrame(source, cut);
  const axis = cut.axis === "x" ? 0 : cut.axis === "y" ? 1 : 2;
  const [ox, oy, oz] = frame.origin;
  const laid = pieces.flatMap((piece) => {
    const bounds = meshAabb(piece);
    const center = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2];
    const below = center[axis] < frame.origin[axis];
    const normal: [number, number, number] = [0, 0, 0];
    normal[axis] = below ? 1 : -1;
    // The middle of the piece, moved onto the cut plane: a point on its cut face.
    const point: [number, number, number] = [center[0], center[1], center[2]];
    point[axis] = [ox, oy, oz][axis];
    const pose = layFaceOnWorkplane(piece, { point, normal });
    if (!pose) return [];
    // Rest on the lowest point once turned: the cut face sits a hair off the exact plane, and a
    // piece can reach below its cut face.
    const turned = meshAabb({ ...piece, ...pose });
    const resting = { ...pose, elevation: pose.elevation - turned.minY };
    return [{ piece, pose: resting, below, bounds: meshAabb({ ...piece, ...resting }) }];
  });
  if (laid.length !== pieces.length) return [];

  // Side by side along the cut (left to right for a top / bottom cut), centred where the part was.
  const along: "x" | "z" = cut.axis === "z" ? "z" : "x";
  const ordered = [...laid].sort((a, b) => Number(a.below === false) - Number(b.below === false));
  const sizes = ordered.map((entry) => (along === "x" ? entry.bounds.maxX - entry.bounds.minX : entry.bounds.maxZ - entry.bounds.minZ));
  const total = sizes.reduce((sum, size) => sum + size, 0) + LAY_FLAT_GAP_MM * (ordered.length - 1);
  const middle = along === "x" ? ox : oz;
  const across = along === "x" ? oz : ox;
  let start = middle - total / 2;
  return ordered.map((entry, index) => {
    const { bounds, pose } = entry;
    const boxCenterAlong = along === "x" ? (bounds.minX + bounds.maxX) / 2 : (bounds.minZ + bounds.maxZ) / 2;
    const boxCenterAcross = along === "x" ? (bounds.minZ + bounds.maxZ) / 2 : (bounds.minX + bounds.maxX) / 2;
    const targetAlong = start + sizes[index] / 2;
    start += sizes[index] + LAY_FLAT_GAP_MM;
    const shiftAlong = targetAlong - boxCenterAlong;
    const shiftAcross = across - boxCenterAcross;
    const next = {
      ...pose,
      x: cleanNearZero(pose.x + (along === "x" ? shiftAlong : shiftAcross), 0.0005),
      z: cleanNearZero(pose.z + (along === "x" ? shiftAcross : shiftAlong), 0.0005),
      elevation: cleanNearZero(pose.elevation, 0.0005),
    };
    return { id: entry.piece.id, pose: next };
  });
}
