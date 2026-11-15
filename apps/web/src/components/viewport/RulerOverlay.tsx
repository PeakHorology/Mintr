"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { RulerOverlayState } from "@/components/viewport/viewportTypes";

export function RulerOverlay({
  overlay,
  startPointId,
  active,
  deleteMode,
  moveMode,
  onPointPointerDown,
  onPointPointerMove,
  onPointPointerUp,
  onSegmentPointerDown,
}: {
  overlay: RulerOverlayState;
  startPointId: string | null;
  active: boolean;
  deleteMode: boolean;
  moveMode: boolean;
  onPointPointerDown: (event: ReactPointerEvent<SVGCircleElement>, pointId: string) => void;
  onPointPointerMove: (event: ReactPointerEvent<SVGCircleElement>, pointId: string) => void;
  onPointPointerUp: (event: ReactPointerEvent<SVGCircleElement>, pointId: string) => void;
  onSegmentPointerDown: (event: ReactPointerEvent<SVGElement>, segmentId: string) => void;
}) {
  return (
    <div className={`ruler-overlay ${active ? "active" : ""} ${deleteMode ? "delete-mode" : ""} ${moveMode ? "move-mode" : ""}`} aria-label="Ruler measurements">
      <svg className="ruler-guides" width="100%" height="100%" aria-hidden="true">
        {overlay.segments.map((segment) => (
          <g key={segment.id} className={`ruler-segment-group${segment.alignKind ? ` aligned ${segment.alignKind}` : ""}`}>
            {segment.screenPoints ? (
              <>
                <polyline className="ruler-segment" points={segment.screenPoints} fill="none" />
                <polyline className="ruler-segment-hit" points={segment.screenPoints} fill="none" onPointerDown={(event) => onSegmentPointerDown(event, segment.id)} />
              </>
            ) : (
              <>
                <line className="ruler-segment" x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2} />
                <line
                  className="ruler-segment-hit"
                  x1={segment.x1}
                  y1={segment.y1}
                  x2={segment.x2}
                  y2={segment.y2}
                  onPointerDown={(event) => onSegmentPointerDown(event, segment.id)}
                />
              </>
            )}
            {segment.ticks?.map((tick, index) => (
              <line
                key={`${segment.id}-tick-${index}`}
                className={`ruler-align-tick ${segment.alignKind ?? ""}`}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
              />
            ))}
          </g>
        ))}
        {overlay.points.map((point) => (
          <g key={point.id} className={point.alignKind ? `ruler-point-wrap ${point.alignKind}` : "ruler-point-wrap"}>
            {point.alignKind === "diameter" ? (
              <circle className="ruler-point-diameter" cx={point.screenX} cy={point.screenY} r="11" />
            ) : null}
            {point.alignKind === "axis" || point.alignKind === "face" ? (
              <rect
                className="ruler-point-aligned"
                x={point.screenX - 8}
                y={point.screenY - 8}
                width="16"
                height="16"
                rx="2"
              />
            ) : null}
            <circle
              className={`ruler-point ${point.id === startPointId ? "pending" : ""}`}
              cx={point.screenX}
              cy={point.screenY}
              r="5"
              onPointerDown={(event) => onPointPointerDown(event, point.id)}
              onPointerMove={(event) => onPointPointerMove(event, point.id)}
              onPointerUp={(event) => onPointPointerUp(event, point.id)}
              onPointerCancel={(event) => onPointPointerUp(event, point.id)}
            />
          </g>
        ))}
        {active && overlay.hover?.preview ? (
          <g className={`ruler-hover-preview-group${overlay.hover.alignKind ? ` aligned ${overlay.hover.alignKind}` : ""}`}>
            <line
              className={`ruler-hover-preview${overlay.hover.alignKind ? ` aligned ${overlay.hover.alignKind}` : ""}`}
              x1={overlay.hover.preview.x1}
              y1={overlay.hover.preview.y1}
              x2={overlay.hover.preview.x2}
              y2={overlay.hover.preview.y2}
            />
            {overlay.hover.preview.ticks?.map((tick, index) => (
              <line
                key={`hover-tick-${index}`}
                className={`ruler-align-tick ${overlay.hover?.alignKind ?? ""}`}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
              />
            ))}
          </g>
        ) : null}
        {active && overlay.hover?.edgeScreenPoints && overlay.hover.alignKind !== "diameter" && overlay.hover.alignKind !== "face" ? <polyline className="ruler-hover-edge" points={overlay.hover.edgeScreenPoints} fill="none" /> : null}
        {active && overlay.hover?.alignKind === "diameter" ? <circle className="ruler-point-diameter hover" cx={overlay.hover.screenX} cy={overlay.hover.screenY} r="11" /> : null}
        {active && (overlay.hover?.alignKind === "axis" || overlay.hover?.alignKind === "face") ? (
          <rect
            className="ruler-point-aligned hover"
            x={overlay.hover.screenX - 8}
            y={overlay.hover.screenY - 8}
            width="16"
            height="16"
            rx="2"
          />
        ) : null}
        {active && overlay.hover ? <circle className={`ruler-hover-point${overlay.hover.edgeScreenPoints ? " on-edge" : ""}`} cx={overlay.hover.screenX} cy={overlay.hover.screenY} r="5" /> : null}
      </svg>
      {overlay.segments.map((segment) => (
        <span
          key={`${segment.id}-label`}
          className={`ruler-label${segment.alignKind ? " aligned" : ""}`}
          style={{ left: segment.labelX, top: segment.labelY }}
        >
          {segment.label}
        </span>
      ))}
      {active && overlay.hover?.preview ? (
        <span
          className={`ruler-label hover-preview${overlay.hover.alignKind ? " aligned" : ""}`}
          style={{ left: overlay.hover.preview.labelX, top: overlay.hover.preview.labelY }}
        >
          {overlay.hover.preview.label}
        </span>
      ) : null}
    </div>
  );
}
