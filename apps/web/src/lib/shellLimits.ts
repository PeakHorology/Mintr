export type ShellSide = "top" | "bottom" | "front" | "back" | "left" | "right";

export const MIN_SHELL_WALL = 0.2;

export const SHELL_SIDES: readonly ShellSide[] = ["top", "bottom", "front", "back", "left", "right"];

/** Thickest wall that still leaves a cavity. Open ends do not need a wall on that axis. */
export function shellMaxThickness(size: { width: number; depth: number; height: number }, openings: readonly ShellSide[]) {
  const along = (length: number, a: ShellSide, b: ShellSide) => {
    const open = Number(openings.includes(a)) + Number(openings.includes(b));
    if (open === 2) return Number.POSITIVE_INFINITY;
    if (open === 1) return Math.max(MIN_SHELL_WALL, length - MIN_SHELL_WALL);
    return length / 2;
  };
  const limit = Math.min(
    along(size.height, "top", "bottom"),
    along(size.width, "left", "right"),
    along(size.depth, "front", "back"),
  );
  return Math.max(MIN_SHELL_WALL, Number.isFinite(limit) ? limit : Math.min(size.width, size.depth, size.height) / 2);
}
