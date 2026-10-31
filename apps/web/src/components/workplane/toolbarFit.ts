"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Fired by a toolbar row when the room it needs changes (see data-need on the row). */
export const TOOLBAR_NEED_EVENT = "mintr:toolbar-need";

/** The project title may shrink to this, with an ellipsis, before tools are squeezed. */
const TITLE_RESERVE_PX = 160;

function titleNeed(header: HTMLElement): number {
  const text = header.querySelector<HTMLElement>(".editor-top-bar-title .editor-project-title-text");
  // Text plus the title button's padding and border.
  return text ? Math.min(TITLE_RESERVE_PX, Math.ceil(text.scrollWidth) + 16) : TITLE_RESERVE_PX;
}

/**
 * Width a top-bar column wants: every tool shown, plus the logo, File, Settings and the rest.
 * `tools` is the part that can give way, by moving tools into "More tools".
 */
function columnNeed(column: Element | null): { need: number; tools: number; key: string } {
  if (!(column instanceof HTMLElement)) return { need: 0, tools: 0, key: "" };
  const style = getComputedStyle(column);
  const gap = Number.parseFloat(style.columnGap || style.gap) || 0;
  let need = 0;
  let tools = 0;
  let count = 0;
  let key = "";
  for (const child of Array.from(column.children)) {
    if (!(child instanceof HTMLElement)) continue;
    count += 1;
    const row = child.querySelector<HTMLElement>(".toolbar-overflow-cluster[data-need]");
    if (row) {
      need += Number(row.dataset.need) || 0;
      tools += Number(row.dataset.need) || 0;
      key += row.dataset.key ?? "";
    } else if (child.classList.contains("editor-top-bar-tools")) {
      // Tool holders stretch to fill; what counts is what is inside.
      for (const inner of Array.from(child.children)) need += inner.getBoundingClientRect().width;
    } else {
      need += child.getBoundingClientRect().width;
    }
  }
  return { need: need + gap * Math.max(0, count - 1), tools, key };
}

/**
 * Fits the editor top bar to the room it really has, whatever the screen, window, zoom or display scaling.
 * When every tool fits it changes nothing. Otherwise it first tightens the bar (smaller icons and gaps,
 * File as icons), and lets a crowded side borrow room the other side is not using. Only then do the
 * rows move their lowest-priority tools into "More tools".
 */
export function useToolbarFit(headerRef: RefObject<HTMLElement | null>, resetKey: string): boolean {
  const [compact, setCompact] = useState(false);
  const fullNeedRef = useRef(0);
  const keyRef = useRef("");

  // A different set of tools (Geometry vs Sketch) needs a fresh look at full size.
  useLayoutEffect(() => {
    setCompact(false);
  }, [resetKey]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const left = header.querySelector(".editor-top-bar-left");
    const right = header.querySelector(".editor-top-bar-right");
    const title = header.querySelector(".editor-top-bar-title");

    const measure = () => {
      // The Geometry / Sketch tab hangs under the title, wherever the title sits.
      if (title) {
        const box = title.getBoundingClientRect();
        const center = box.left + box.width / 2 - header.getBoundingClientRect().left;
        header.style.setProperty("--top-title-center", `${Math.round(center)}px`);
      }
      const style = getComputedStyle(header);
      const inner = header.clientWidth
        - (Number.parseFloat(style.paddingLeft) || 0)
        - (Number.parseFloat(style.paddingRight) || 0);
      const gap = Number.parseFloat(style.columnGap || style.gap) || 0;
      const available = Math.max(0, inner - gap * 2 - titleNeed(header));
      const leftNeed = columnNeed(left);
      const rightNeed = columnNeed(right);
      const total = leftNeed.need + rightNeed.need;
      const key = `${leftNeed.key}/${rightNeed.key}`;

      if (!compact) {
        keyRef.current = key;
        if (total > available) {
          fullNeedRef.current = total;
          setCompact(true);
        }
      } else if (key !== keyRef.current || available >= fullNeedRef.current) {
        // Room again, or different tools: try full size.
        keyRef.current = key;
        setCompact(false);
      }

      // Each side gets what it needs and the title stays centred when there is room for that.
      // Otherwise the shortfall is split between the two tool rows by size, since only they can give way.
      let leftMin = leftNeed.need;
      let rightMin = rightNeed.need;
      if (total > available) {
        const shortfall = total - available;
        const flexible = leftNeed.tools + rightNeed.tools;
        const leftShare = flexible > 0 ? (shortfall * leftNeed.tools) / flexible : shortfall / 2;
        leftMin = Math.min(available, Math.max(0, Math.round(leftNeed.need - leftShare)));
        rightMin = available - leftMin;
      }
      header.style.setProperty("--top-left-min", `${Math.max(0, Math.floor(leftMin))}px`);
      header.style.setProperty("--top-right-min", `${Math.max(0, Math.floor(rightMin))}px`);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    if (title) observer.observe(title);
    if (left) observer.observe(left);
    for (const column of [left, right]) {
      if (!(column instanceof HTMLElement)) continue;
      for (const child of Array.from(column.children)) observer.observe(child);
    }
    header.addEventListener(TOOLBAR_NEED_EVENT, measure);
    return () => {
      observer.disconnect();
      header.removeEventListener(TOOLBAR_NEED_EVENT, measure);
    };
  }, [headerRef, compact]);

  return compact;
}
