"use client";

import type { CSSProperties } from "react";
import { PeakTipButton } from "@/components/workplane/ToolNameTooltip";
import { alignmentLabel } from "@/lib/editorBoolean";
import type { MirrorSide } from "@/lib/mirrorCopy";
import type { AlignAxis, AlignHandleStatus, AlignTarget } from "@/types/sketchforge";

export type AlignOverlayState = {
  guides: Array<{ key: string; x1: number; y1: number; x2: number; y2: number }>;
  handles: Array<AlignHandleStatus & { key: string; x: number; y: number }>;
};

export type MirrorOverlayState = {
  guides: Array<{ key: string; x1: number; y1: number; x2: number; y2: number }>;
  handles: Array<{ side: MirrorSide; key: string; x: number; y: number; angle: number; title: string }>;
};

export function AlignOverlay({
  overlay,
  onAlign,
  onPreview,
  onPreviewClear,
}: {
  overlay: AlignOverlayState;
  onAlign: (axis: AlignAxis, target: AlignTarget) => void;
  onPreview: (axis: AlignAxis, target: AlignTarget) => void;
  onPreviewClear: () => void;
}) {
  return (
    <div className="align-overlay" aria-label="Alignment handles">
      <svg className="align-guides" width="100%" height="100%" aria-hidden="true">
        {overlay.guides.map((guide) => (
          <line key={guide.key} x1={guide.x1} y1={guide.y1} x2={guide.x2} y2={guide.y2} />
        ))}
      </svg>
      {overlay.handles.map((handle) => (
        <PeakTipButton
          key={handle.key}
          label={handle.title}
          data-lesson-target={`align-${alignmentLabel(handle.axis, handle.target)}`}
          className={`align-dot axis-${handle.axis} target-${handle.target} ${handle.disabled ? "disabled" : ""} ${handle.aligned ? "aligned" : ""}`}
          style={{ left: handle.x, top: handle.y }}
          disabled={handle.disabled}
          onPointerEnter={() => {
            if (!handle.disabled) {
              onPreview(handle.axis, handle.target);
            }
          }}
          onPointerLeave={onPreviewClear}
          onFocus={() => {
            if (!handle.disabled) {
              onPreview(handle.axis, handle.target);
            }
          }}
          onBlur={onPreviewClear}
          onClick={(event) => {
            event.stopPropagation();
            onPreviewClear();
            onAlign(handle.axis, handle.target);
          }}
        />
      ))}
    </div>
  );
}

export function MirrorOverlay({
  overlay,
  onMirror,
  onPreview,
  onPreviewClear,
}: {
  overlay: MirrorOverlayState;
  onMirror: (side: MirrorSide) => void;
  onPreview: (side: MirrorSide) => void;
  onPreviewClear: () => void;
}) {
  return (
    <div className="mirror-overlay" aria-label="Mirror handles">
      <svg className="mirror-guides" width="100%" height="100%" aria-hidden="true">
        {overlay.guides.map((guide) => (
          <line key={guide.key} x1={guide.x1} y1={guide.y1} x2={guide.x2} y2={guide.y2} />
        ))}
      </svg>
      {overlay.handles.map((handle) => (
        <PeakTipButton
          key={handle.key}
          label={handle.title}
          data-lesson-target={`mirror-${handle.side}`}
          className={`mirror-handle side-${handle.side}`}
          style={{ left: handle.x, top: handle.y, "--mirror-angle": `${handle.angle}deg` } as CSSProperties}
          onPointerEnter={() => onPreview(handle.side)}
          onPointerLeave={onPreviewClear}
          onFocus={() => onPreview(handle.side)}
          onBlur={onPreviewClear}
          onClick={(event) => {
            event.stopPropagation();
            onPreviewClear();
            onMirror(handle.side);
          }}
        >
          <svg className="mirror-handle-icon" viewBox="0 0 48 24" aria-hidden="true">
            <path d="M8 12h30" />
            <path d="m30 4 8 8-8 8" />
          </svg>
        </PeakTipButton>
      ))}
    </div>
  );
}

export type CircularPatternOverlayState = {
  cx: number;
  cy: number;
  radiusPx: number;
};

export function CircularPatternOverlay({ overlay }: { overlay: CircularPatternOverlayState }) {
  const size = Math.max(8, overlay.radiusPx * 2);
  return (
    <div className="circular-pattern-overlay" aria-hidden="true">
      <div
        className="circular-pattern-ring"
        style={{
          left: overlay.cx,
          top: overlay.cy,
          width: size,
          height: size,
        }}
      />
      <div className="circular-pattern-center" style={{ left: overlay.cx, top: overlay.cy }} />
    </div>
  );
}
