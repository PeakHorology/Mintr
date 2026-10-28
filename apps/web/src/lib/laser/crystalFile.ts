/**
 * Crystal (inner) engraving: xTool Studio asks for 3D models under 100 MB, and gives no
 * triangle limit. A binary STL is 50 bytes a triangle, so 100 MB is about two million.
 * Mintr only speaks up near that ceiling.
 */
const STL_BYTES_PER_TRIANGLE = 50;
const XTOOL_MODEL_MB = 100;
/** Speak up from about 80 MB, a little before xTool's 100 MB. */
export const CRYSTAL_TRIANGLE_WARNING = Math.round((XTOOL_MODEL_MB * 0.8 * 1_000_000) / STL_BYTES_PER_TRIANGLE);

/** The size of a binary STL with this many triangles, in megabytes. */
export function stlMegabytes(triangles: number) {
  return (84 + triangles * STL_BYTES_PER_TRIANGLE) / 1_000_000;
}

/** A note to add after a 3D export when the model is near xTool Studio's limit, or null. */
export function crystalSizeNote(triangles: number): string | null {
  if (triangles < CRYSTAL_TRIANGLE_WARNING) return null;
  const megabytes = Math.round(stlMegabytes(triangles));
  return `${triangles.toLocaleString("en-US")} triangles, about ${megabytes} MB. To preserve the quality of your model, we recommend using our Reduce File Size instead of xTool's.`;
}
