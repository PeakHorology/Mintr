"use client";

import { useId } from "react";
import { extrudeSilhouettePath, type ExtrudeSilhouette } from "@/lib/sketchExtrudeSwatch";
import type { ShapeKind } from "@/types/sketchforge";

function circlePath(cx: number, cy: number, r: number) {
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}

function polygonPath(sides: number, radius = 32) {
  const count = Math.max(3, Math.min(12, Math.round(sides) || 6));
  const points = Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    return `${32 + Math.cos(angle) * radius} ${32 + Math.sin(angle) * radius}`;
  });
  return `M ${points.join(" L ")} Z`;
}

function gearPath() {
  const teeth = 8;
  const cx = 32;
  const cy = 32;
  const commands: string[] = [];
  for (let index = 0; index < teeth; index += 1) {
    const center = -Math.PI / 2 + (index * Math.PI * 2) / teeth;
    const half = Math.PI / teeth * 0.34;
    const rootA = center - Math.PI / teeth + half;
    const tipA = center - half * 0.55;
    const tipB = center + half * 0.55;
    const rootB = center + Math.PI / teeth - half;
    const point = (angle: number, radius: number) => `${(cx + Math.cos(angle) * radius).toFixed(1)} ${(cy + Math.sin(angle) * radius).toFixed(1)}`;
    commands.push(`${index === 0 ? "M" : "L"} ${point(rootA, 18)}`);
    commands.push(`L ${point(tipA, 30)}`);
    commands.push(`L ${point(tipB, 30)}`);
    commands.push(`L ${point(rootB, 18)}`);
  }
  commands.push("Z");
  return `${commands.join(" ")} ${circlePath(cx, cy, 8)}`;
}

function rodPath() {
  const mid = 32;
  const top = 3;
  const bottom = 61;
  const taper = 6;
  const tip = 9;
  const root = 10;
  const crest = 22;
  const threadTop = top + taper;
  const threadBottom = bottom - taper;
  const pitches = 6;
  const n = (value: number) => Math.round(value * 10) / 10;
  const yAt = (index: number) => threadTop + ((threadBottom - threadTop) * index) / pitches;
  const commands = [`M ${n(mid - tip)} ${top}`, `L ${n(mid + tip)} ${top}`, `L ${n(mid + crest)} ${n(threadTop)}`];
  for (let index = 0; index <= pitches; index += 1) {
    commands.push(`L ${n(mid + crest)} ${n(yAt(index))}`);
    if (index < pitches) commands.push(`L ${n(mid + root)} ${n(yAt(index + 0.5))}`);
  }
  commands.push(`L ${n(mid + tip)} ${bottom}`, `L ${n(mid - tip)} ${bottom}`, `L ${n(mid - crest)} ${n(threadBottom)}`);
  for (let index = pitches; index >= 0; index -= 1) {
    commands.push(`L ${n(mid - crest)} ${n(yAt(index))}`);
    if (index > 0) commands.push(`L ${n(mid - root)} ${n(yAt(index - 0.5))}`);
  }
  commands.push("Z");
  return commands.join(" ");
}

/** Rounded Gridfinity outline; the bin keeps a cavity, the baseplate shows a 2×2 grid of sockets. */
function gridfinityPath(kind: "gridfinityBin" | "gridfinityBaseplate") {
  const outer = "M8 2 H56 Q62 2 62 8 V56 Q62 62 56 62 H8 Q2 62 2 56 V8 Q2 2 8 2 Z";
  if (kind === "gridfinityBin") {
    return `${outer} M14 10 H50 Q54 10 54 14 V50 Q54 54 50 54 H14 Q10 54 10 50 V14 Q10 10 14 10 Z`;
  }
  const socket = (x: number, y: number) =>
    `M${x + 3} ${y} H${x + 19} Q${x + 22} ${y} ${x + 22} ${y + 3} V${y + 19} Q${x + 22} ${y + 22} ${x + 19} ${y + 22} H${x + 3} Q${x} ${y + 22} ${x} ${y + 19} V${y + 3} Q${x} ${y} ${x + 3} ${y} Z`;
  return `${outer} ${socket(8, 8)} ${socket(34, 8)} ${socket(8, 34)} ${socket(34, 34)}`;
}

export function shapeModePath(kind: ShapeKind, sides?: number) {
  switch (kind) {
    case "gridfinityBin":
    case "gridfinityBaseplate":
      return gridfinityPath(kind);
    case "box":
    case "sketch":
    case "scribble":
    case "mesh":
      return "M6 2 H58 Q62 2 62 6 V58 Q62 62 58 62 H6 Q2 62 2 58 V6 Q2 2 6 2 Z";
    case "cylinder":
    case "sphere":
      return circlePath(32, 32, 32);
    case "thread":
      return rodPath();
    case "gear":
      return gearPath();
    case "cone":
    case "pyramid":
    case "roof":
      return "M32 2 L62 62 H2 Z";
    case "polygon":
    case "icosahedron":
      return polygonPath(kind === "icosahedron" ? 6 : sides ?? 6);
    case "halfSphere":
      return "M2 46 A30 30 0 0 1 62 46 Z";
    case "roundRoof":
      return "M4 34 V62 H60 V34 A28 22 0 0 0 4 34 Z";
    case "torus":
    case "tube":
    case "ring":
      return `${circlePath(32, 32, 32)} ${circlePath(32, 32, 15)}`;
    case "wedge":
      return "M2 62 V4 L62 62 Z";
    case "text":
      return "M8 62 L32 2 L56 62 H44 L39 48 H25 L20 62 Z M27 40 H37 L32 26 Z";
    default:
      return circlePath(32, 32, 32);
  }
}

export function ShapeModeMark({
  kind,
  hole = false,
  color = "#d97813",
  sides,
  silhouette,
}: {
  kind: ShapeKind;
  hole?: boolean;
  color?: string;
  sides?: number;
  /** Draw-tool shape for the extrude Join / Cut buttons. */
  silhouette?: ExtrudeSilhouette;
}) {
  const hatchId = `hole-hatch-${useId().replace(/:/g, "")}`;
  const path = silhouette ? extrudeSilhouettePath(silhouette) : shapeModePath(kind, sides);
  const holed = kind === "torus" || kind === "tube" || kind === "ring" || kind === "text" || kind === "gear"
    || kind === "gridfinityBin" || kind === "gridfinityBaseplate";
  return (
    <svg className={hole ? "large-hole-swatch" : "large-solid-swatch"} viewBox="0 0 64 64" aria-hidden="true">
      {hole ? (
        <defs>
          <pattern id={hatchId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="#e6eef3" />
            <rect width="4" height="8" fill="#b7c3cc" />
          </pattern>
        </defs>
      ) : null}
      <path d={path} fill={hole ? `url(#${hatchId})` : color} fillRule={holed ? "evenodd" : "nonzero"} />
    </svg>
  );
}
