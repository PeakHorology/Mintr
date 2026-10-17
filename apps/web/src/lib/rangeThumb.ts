export type RangeThumbHit = {
  clientX: number;
  clientY: number;
  left: number;
  top: number;
  width: number;
  height: number;
  min: number;
  max: number;
  value: number;
  thumbWidth: number;
  thumbHeight: number;
};

const THUMB_SLOP_PX = 2;

/** True when the pointer is on the slider button. The track itself is a miss. */
export function rangeThumbHit(hit: RangeThumbHit) {
  const span = hit.max - hit.min;
  const ratio = span === 0 ? 0 : Math.min(1, Math.max(0, (hit.value - hit.min) / span));
  const travel = Math.max(0, hit.width - hit.thumbWidth);
  const centerX = hit.left + hit.thumbWidth / 2 + ratio * travel;
  const centerY = hit.top + hit.height / 2;
  return Math.abs(hit.clientX - centerX) <= hit.thumbWidth / 2 + THUMB_SLOP_PX
    && Math.abs(hit.clientY - centerY) <= hit.thumbHeight / 2 + THUMB_SLOP_PX;
}

const FALLBACK_THUMB_PX = 17;

export function rangeThumbSize(input: HTMLInputElement) {
  const fallback = { width: FALLBACK_THUMB_PX, height: FALLBACK_THUMB_PX };
  if (typeof getComputedStyle !== "function") return fallback;
  const rect = input.getBoundingClientRect();
  for (const pseudo of ["::-webkit-slider-thumb", "::-moz-range-thumb"]) {
    const style = getComputedStyle(input, pseudo);
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);
    if (!(width > 0 && height > 0)) continue;
    // Some engines report the input box for the thumb pseudo-element.
    if (rect.width > 0 && width >= rect.width - 1) continue;
    return { width, height };
  }
  return fallback;
}

export function pointerHitsRangeThumb(input: HTMLInputElement, clientX: number, clientY: number) {
  const rect = input.getBoundingClientRect();
  const thumb = rangeThumbSize(input);
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  return rangeThumbHit({
    clientX,
    clientY,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    value: Number.isFinite(value) ? value : 0,
    thumbWidth: thumb.width,
    thumbHeight: thumb.height,
  });
}
