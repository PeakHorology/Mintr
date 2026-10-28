"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { LaserJob } from "@/lib/laser/cutFile";
import {
  flattenLoop,
  greyForTracing,
  groupIntoPieces,
  lookAtPicture,
  traceLogo,
  type GreyPicture,
  type PictureLook,
  type TracePoint,
} from "@/lib/laser/logoTrace";

/** A traced logo in millimetres, from its top-left corner, y running down. */
export type TracedLogo = {
  name: string;
  job: LaserJob;
  width: number;
  height: number;
  pieces: Array<{ outer: TracePoint[]; holes: TracePoint[][] }>;
};

/** Which pixels are the logo. */
type InkMode = "dark" | "light" | "opaque";

/** Pictures are read at most this big, which is plenty for a logo. */
const MAX_READ_SIZE = 2400;
/** Curves become points this close to the true curve, in mm. */
const POINT_TOLERANCE_MM = 0.04;
/** More pieces than this, and the picture is probably not a clean logo. */
const BUSY_PIECES = 600;

const JOB_HINT: Record<LaserJob, string> = {
  engrave: "Burns the whole logo into the surface.",
  cut: "Cuts the logo out of the sheet.",
  score: "Draws the logo's outline on the surface.",
};

async function readPicture(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_READ_SIZE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot read pictures");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height);
  return { grey: greyForTracing(pixels), url: canvas.toDataURL("image/png") };
}

/**
 * Trace a logo: picks a picture, turns its dark (or light) parts into outlines, and shows
 * them before they become a part. Says plainly that it is for logos, not photos.
 */
export function TraceLogoDialog({
  sheetLabel,
  bedWidth,
  onCancel,
  onMake,
}: {
  /** "3 mm plywood", for the note. */
  sheetLabel: string;
  bedWidth: number;
  onCancel: () => void;
  onMake: (logo: TracedLogo) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [picture, setPicture] = useState<{ name: string; grey: GreyPicture; url: string; look: PictureLook } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [mode, setMode] = useState<InkMode>("dark");
  const [threshold, setThreshold] = useState(0.5);
  const [smoothness, setSmoothness] = useState(1);
  const [speckle, setSpeckle] = useState(20);
  const [widthDraft, setWidthDraft] = useState(String(Math.min(80, Math.round(bedWidth * 0.6))));
  const [job, setJob] = useState<LaserJob>("engrave");
  // The settings the trace below was made with, a moment after the last change.
  const [settled, setSettled] = useState({ mode, threshold, smoothness, speckle });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled({ mode, threshold, smoothness, speckle }), 120);
    return () => window.clearTimeout(timer);
  }, [mode, threshold, smoothness, speckle]);

  const traced = useMemo(() => {
    if (!picture) return null;
    const result = traceLogo(picture.grey, {
      threshold: settled.threshold,
      invert: settled.mode === "light",
      useTransparency: settled.mode === "opaque",
      speckle: settled.speckle,
      smoothness: settled.smoothness,
    });
    return result;
  }, [picture, settled]);

  const width = Number.parseFloat(widthDraft);
  const widthOk = Number.isFinite(width) && width >= 1 && width <= 5000;
  // The width is the logo's own, not the picture's with its margins.
  const bounds = useMemo(() => {
    if (!traced) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const loop of traced.loops) {
      if (loop.area <= 0) continue;
      for (const point of [loop.start, ...loop.pieces.map((piece) => piece.to)]) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    }
    return maxX > minX && maxY > minY ? { minX, minY, width: maxX - minX, height: maxY - minY } : null;
  }, [traced]);
  const mmPerPixel = bounds && widthOk ? width / bounds.width : 0;
  const height = bounds ? bounds.height * mmPerPixel : 0;

  const pieces = useMemo(() => {
    if (!traced || !mmPerPixel) return [];
    const tolerance = POINT_TOLERANCE_MM / mmPerPixel;
    return groupIntoPieces(traced.loops.map((loop) => ({ points: flattenLoop(loop, tolerance), area: loop.area })));
  }, [traced, mmPerPixel]);

  // The preview: the picture faint underneath, the traced logo drawn over it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !picture) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const box = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(box.width * ratio));
    canvas.height = Math.max(1, Math.round(box.height * ratio));
    const fit = Math.min(canvas.width / picture.grey.width, canvas.height / picture.grey.height) * 0.94;
    const left = (canvas.width - picture.grey.width * fit) / 2;
    const top = (canvas.height - picture.grey.height * fit) / 2;
    context.fillStyle = "#fbf7f0";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const image = new Image();
    let cancelled = false;
    const draw = () => {
      if (cancelled) return;
      context.globalAlpha = 0.22;
      context.drawImage(image, left, top, picture.grey.width * fit, picture.grey.height * fit);
      context.globalAlpha = 1;
      if (!traced) return;
      const path = new Path2D();
      for (const loop of traced.loops) {
        path.moveTo(left + loop.start.x * fit, top + loop.start.y * fit);
        for (const piece of loop.pieces) {
          if (piece.kind === "curve") {
            path.bezierCurveTo(left + piece.c1.x * fit, top + piece.c1.y * fit, left + piece.c2.x * fit, top + piece.c2.y * fit, left + piece.to.x * fit, top + piece.to.y * fit);
          } else {
            path.lineTo(left + piece.to.x * fit, top + piece.to.y * fit);
          }
        }
        path.closePath();
      }
      if (job === "engrave") {
        context.fillStyle = "#2b211b";
        context.fill(path, "evenodd");
      } else {
        context.fillStyle = "rgba(199, 154, 98, 0.35)";
        context.fill(path, "evenodd");
        context.strokeStyle = job === "cut" ? "#ff3b30" : "#1e6bff";
        context.lineWidth = 1.25 * ratio;
        context.stroke(path);
      }
    };
    image.onload = draw;
    image.src = picture.url;
    return () => {
      cancelled = true;
    };
  }, [picture, traced, job]);

  const choose = async (file: File) => {
    setReadError(null);
    try {
      const { grey, url } = await readPicture(file);
      const look = lookAtPicture(grey);
      setPicture({ name: file.name.replace(/\.[^.]+$/, "") || "Logo", grey, url, look });
      const nextMode: InkMode = look.transparentBackground ? "opaque" : look.darkBackground ? "light" : "dark";
      setMode(nextMode);
      setThreshold(look.threshold);
      setSettled({ mode: nextMode, threshold: look.threshold, smoothness, speckle });
    } catch {
      setReadError("Mintr could not read that picture. Try a PNG or JPG.");
    }
  };

  const problem = !picture
    ? "Choose a picture first."
    : !widthOk
      ? "Type a width from 1 to 5000 mm."
      : pieces.length === 0
        ? "Nothing to trace with these settings. Try moving How dark counts."
        : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (problem || !picture || !bounds) return;
    const toMm = (point: TracePoint) => ({ x: (point.x - bounds.minX) * mmPerPixel, y: (point.y - bounds.minY) * mmPerPixel });
    const scaled = pieces.map((piece) => ({ outer: piece.outer.map(toMm), holes: piece.holes.map((hole) => hole.map(toMm)) }));
    onMake({ name: picture.name, job, width, height, pieces: scaled });
  };

  const busy = pieces.length > BUSY_PIECES;
  return (
    <div className="inline-value-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="inline-value-dialog box-maker-dialog trace-logo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trace-logo-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header className="inline-value-dialog-header">
          <strong id="trace-logo-title">Trace a logo</strong>
          <button type="button" className="inline-value-dialog-close" aria-label="Close" onClick={onCancel}>
            <X size={16} strokeWidth={2.5} />
          </button>
        </header>
        <div className="inline-value-dialog-body">
          <p className="trace-logo-fit">
            <strong>For logos, text and simple drawings</strong> with solid shapes, like a logo on a white background.
            It isn&apos;t made for photos: tracing keeps only dark and light, so shading turns into blotches.
            To engrave a photo, open it in your laser program instead.
          </p>
          <input
            ref={fileInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void choose(file);
              event.currentTarget.value = "";
            }}
          />
          {picture ? (
            <div className="box-maker-preview trace-logo-preview">
              <canvas ref={canvasRef} aria-label={`The traced ${picture.name}`} />
            </div>
          ) : (
            <button type="button" className="trace-logo-pick" onClick={() => fileInputRef.current?.click()}>
              <strong>Choose a logo picture</strong>
              <span>PNG, JPG, WebP or BMP. An SVG logo doesn&apos;t need tracing: use Import.</span>
            </button>
          )}
          {readError ? <p className="trace-logo-warning">{readError}</p> : null}
          {picture?.look.looksLikePhoto ? (
            <p className="trace-logo-warning">
              This looks like a photo or a shaded picture. The trace keeps only dark and light, so check the preview closely.
            </p>
          ) : null}
          {busy ? (
            <p className="trace-logo-warning">
              That&apos;s {pieces.length} separate pieces, which usually means a busy picture. Try more Ignore specks, or a cleaner logo.
            </p>
          ) : null}
          {picture ? (
            <>
              <div className="box-maker-toggles">
                <div role="radiogroup" aria-label="Which parts are the logo" className={picture.look.transparentBackground ? "three" : ""}>
                  {(["dark", "light", ...(picture.look.transparentBackground ? ["opaque" as const] : [])] as InkMode[]).map((value) => (
                    <button key={value} type="button" role="radio" aria-checked={mode === value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>
                      {value === "dark" ? "Dark parts" : value === "light" ? "Light parts" : "Not see-through"}
                    </button>
                  ))}
                </div>
              </div>
              {mode !== "opaque" ? (
                <label className="trace-logo-slider">
                  <span>
                    How {mode === "dark" ? "dark" : "light"} counts
                    <button type="button" onClick={() => setThreshold(picture.look.threshold)} disabled={Math.abs(threshold - picture.look.threshold) < 0.005}>
                      Auto
                    </button>
                  </span>
                  <input type="range" min={0.02} max={0.98} step={0.01} value={threshold} onChange={(event) => setThreshold(Number(event.currentTarget.value))} />
                </label>
              ) : null}
              <label className="trace-logo-slider">
                <span>Corners <em>{smoothness < 0.35 ? "sharp" : smoothness > 1.15 ? "all rounded" : "rounded where gentle"}</em></span>
                <input type="range" min={0} max={1.33} step={0.01} value={smoothness} onChange={(event) => setSmoothness(Number(event.currentTarget.value))} />
              </label>
              <label className="trace-logo-slider">
                <span>Ignore specks <em>{speckle === 0 ? "keep everything" : `smaller than ${speckle} pixels`}</em></span>
                <input type="range" min={0} max={400} step={5} value={speckle} onChange={(event) => setSpeckle(Number(event.currentTarget.value))} />
              </label>
              <div className="box-maker-fields">
                <label className="inline-value-dialog-field">
                  <span>Logo width</span>
                  <span className="inline-value-dialog-input-wrap">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={1}
                      step={1}
                      value={widthDraft}
                      onChange={(event) => setWidthDraft(event.currentTarget.value)}
                      onKeyDown={(event) => event.stopPropagation()}
                    />
                    <small>mm</small>
                  </span>
                </label>
                <p className="inline-value-dialog-note trace-logo-height">{widthOk ? `${Number(height.toFixed(1))} mm tall` : ""}</p>
              </div>
              <div className="box-maker-toggles">
                <div role="radiogroup" aria-label="What the laser does" className="three">
                  {(["engrave", "cut", "score"] as const).map((value) => (
                    <button key={value} type="button" role="radio" aria-checked={job === value} className={job === value ? "active" : ""} onClick={() => setJob(value)}>
                      {value === "engrave" ? "Engrave" : value === "cut" ? "Cut" : "Score"}
                    </button>
                  ))}
                </div>
              </div>
              <p className="inline-value-dialog-note">
                {JOB_HINT[job]} It becomes one part of {sheetLabel}.{" "}
                <button type="button" className="trace-logo-again" onClick={() => fileInputRef.current?.click()}>Use another picture</button>
              </p>
            </>
          ) : null}
        </div>
        <footer className="inline-value-dialog-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={Boolean(problem)} title={problem ?? undefined}>
            Make part
          </button>
        </footer>
      </form>
    </div>
  );
}
