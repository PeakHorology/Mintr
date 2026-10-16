/**
 * Screen-space placement for measurement labels.
 * A fixed nudge only clears one camera angle, so labels are moved until their
 * boxes miss the rotate handles and each other.
 */

export type ScreenRect = {
  cx: number;
  cy: number;
  w: number;
  h: number;
};

export type PlacementLabel = {
  label: string;
  labelX: number;
  labelY: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/** Matches `.dimension-label`: 14px type, 6px vertical padding, 1px border. */
const LABEL_HEIGHT = 28;
const LABEL_MIN_WIDTH = 52;
const LABEL_CHAR_PX = 8.4;
const LABEL_PAD_X = 18;

/** Matches `.rotate-handle` hit target. The icon sits inside this square. */
export const ROTATE_HANDLE_PX = 48;

/** Clear pixels kept between a measurement box and anything it must not cover. */
const SEPARATION_GAP = 8;

export function dimensionLabelRect(label: string, cx: number, cy: number): ScreenRect {
  const width = Math.max(LABEL_MIN_WIDTH, Math.ceil(label.length * LABEL_CHAR_PX) + LABEL_PAD_X);
  return { cx, cy, w: width, h: LABEL_HEIGHT };
}

export function rotateHandleRect(handle: { x: number; y: number }): ScreenRect {
  return { cx: handle.x, cy: handle.y, w: ROTATE_HANDLE_PX, h: ROTATE_HANDLE_PX };
}

export function screenRectsOverlap(a: ScreenRect, b: ScreenRect, gap = 0) {
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 + gap
    && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 + gap;
}

function unit(x: number, y: number) {
  const length = Math.hypot(x, y);
  if (length < 1) return null;
  return { x: x / length, y: y / length };
}

function insideViewport(rect: ScreenRect, viewport?: { width: number; height: number }) {
  if (!viewport) return true;
  const margin = 4;
  return rect.cx - rect.w / 2 >= margin
    && rect.cy - rect.h / 2 >= margin
    && rect.cx + rect.w / 2 <= viewport.width - margin
    && rect.cy + rect.h / 2 <= viewport.height - margin;
}

function hits(rect: ScreenRect, blockers: ScreenRect[]) {
  return blockers.some((blocker) => screenRectsOverlap(rect, blocker, SEPARATION_GAP));
}

function labelCandidates(mark: PlacementLabel) {
  const midX = (mark.x1 + mark.x2) / 2;
  const midY = (mark.y1 + mark.y2) / 2;
  const outward = unit(mark.labelX - midX, mark.labelY - midY) ?? { x: 0, y: 1 };
  const along = unit(mark.x2 - mark.x1, mark.y2 - mark.y1) ?? { x: 1, y: 0 };
  const spots: Array<{ x: number; y: number }> = [];
  const push = (outDistance: number, alongDistance: number) => {
    spots.push({
      x: mark.labelX + outward.x * outDistance + along.x * alongDistance,
      y: mark.labelY + outward.y * outDistance + along.y * alongDistance,
    });
  };
  const alongSteps = [0, 30, -30, 60, -60, 92, -92, 124, -124];
  for (const outDistance of [0, 14, 28, 44, 62, 84, 110, 140]) {
    for (const alongDistance of alongSteps) {
      push(outDistance, alongDistance);
    }
  }
  for (const outDistance of [18, 40, 68, 100]) {
    for (const alongDistance of [0, 36, -36, 72, -72]) {
      spots.push({
        x: mark.labelX - outward.x * outDistance + along.x * alongDistance,
        y: mark.labelY - outward.y * outDistance + along.y * alongDistance,
      });
    }
  }
  for (let distance = 156; distance <= 420; distance += 18) {
    for (const side of [0, 1, -1, 2, -2, 3, -3]) {
      push(distance, side * 34);
    }
  }
  return spots;
}

/**
 * Move measurement labels off rotate handles and off each other.
 * Handles stay put. Each label prefers to stay on its own dimension line.
 */
export function separateDimensionLabels<T extends PlacementLabel>(
  marks: T[],
  obstacles: ScreenRect[],
  viewport?: { width: number; height: number },
) {
  const placed: ScreenRect[] = [];
  for (const mark of marks) {
    const blockers = [...obstacles, ...placed];
    let chosen: ScreenRect | null = null;
    for (const spot of labelCandidates(mark)) {
      const rect = dimensionLabelRect(mark.label, spot.x, spot.y);
      if (!insideViewport(rect, viewport)) continue;
      if (hits(rect, blockers)) continue;
      chosen = rect;
      break;
    }
    if (!chosen) {
      const outward = unit(mark.labelX - (mark.x1 + mark.x2) / 2, mark.labelY - (mark.y1 + mark.y2) / 2) ?? { x: 0, y: 1 };
      let cx = mark.labelX;
      let cy = mark.labelY;
      for (let step = 0; step < 48; step += 1) {
        const rect = dimensionLabelRect(mark.label, cx, cy);
        if (!hits(rect, blockers)) {
          chosen = rect;
          break;
        }
        cx += outward.x * 16;
        cy += outward.y * 16;
      }
      chosen ??= dimensionLabelRect(mark.label, cx, cy);
    }
    mark.labelX = chosen.cx;
    mark.labelY = chosen.cy;
    placed.push(chosen);
  }
}
