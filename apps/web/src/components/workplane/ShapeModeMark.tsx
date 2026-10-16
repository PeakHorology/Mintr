"use client";

import { useId } from "react";
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

export function shapeModePath(kind: ShapeKind, sides?: number) {
  switch (kind) {
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
}: {
  kind: ShapeKind;
  hole?: boolean;
  color?: string;
  sides?: number;
}) {
  const hatchId = `hole-hatch-${useId().replace(/:/g, "")}`;
  const path = shapeModePath(kind, sides);
  const holed = kind === "torus" || kind === "tube" || kind === "ring" || kind === "text";
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
