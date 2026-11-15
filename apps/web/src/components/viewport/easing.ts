/** Apple-style settle: fast start, long soft landing. */
export function easeOutQuint(t: number) {
  return 1 - (1 - t) ** 5;
}

export function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}
