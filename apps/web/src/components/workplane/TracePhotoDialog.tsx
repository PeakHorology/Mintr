"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { X } from "lucide-react";
import { flattenLoop, groupIntoPieces, joinCurves, traceMask, type TraceResult } from "@/lib/laser/logoTrace";
import { aiTracerDownloaded, aiTracerFor, loadAiTracer, type AiProgress } from "@/lib/photoTrace/aiTrace";
import { PAPER_SIZES, paperOrientation, scaleFromDpi, scaleFromReferences, type PaperSize, type Point } from "@/lib/photoTrace/geometry";
import { findPaper, type Backdrop } from "@/lib/photoTrace/paper";
import { pictureDpi, pictureToCanvas, readPicture, resizePicture, straightenPaper, type Rgba } from "@/lib/photoTrace/picture";
import { applyStrokes, growMask, maskBounds, segmentByColour, sheetIn, type PaperArea, type TraceClick, type TraceStroke } from "@/lib/photoTrace/segment";
import { type TracedLoop } from "@/lib/photoTrace/toSketch";

/** A traced outline in millimetres, from its top-left corner, y running down. */
export type TracedPhoto = {
  name: string;
  width: number;
  height: number;
  pieces: Array<{ outer: TracedLoop; holes: TracedLoop[] }>;
};

type Sizing = "paper" | "points" | "scan";
type Step = "photo" | "size" | "trace";
type Engine = "simple" | "ai";

/** Photos are read at most this big; plenty to find the paper or click reference points. */
const READ_SIZE = 4096;
/** The picture that gets traced is at most this big, so each click answers quickly. */
const WORK_SIZE = 2400;
/** Outlines are flattened this finely, in pixels, only to sort holes from outer edges. */
const GROUPING_TOLERANCE_PX = 0.5;
/** Runs of short curves join into one where it stays this close, in pixels: well inside the photo's own blur. */
const JOIN_TOLERANCE_PX = 1.25;
const STORE_KEY = "mintr:trace-photo";

type Remembered = { backdrop: Backdrop; sizing: Sizing; paper: PaperSize; engine: Engine };

function remembered(): Remembered {
  const fallback: Remembered = { backdrop: "white", sizing: "paper", paper: "letter", engine: "simple" };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Partial<Remembered> | null;
    return {
      backdrop: raw?.backdrop === "black" ? "black" : "white",
      sizing: raw?.sizing === "points" || raw?.sizing === "scan" ? raw.sizing : "paper",
      paper: raw?.paper && raw.paper in PAPER_SIZES ? raw.paper : "letter",
      engine: raw?.engine === "ai" ? "ai" : "simple",
    };
  } catch {
    return fallback;
  }
}

function remember(value: Remembered) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // Only a convenience.
  }
}

/** Fit gaps that make sense for the object's size: watch parts want hundredths, tools want millimetres. */
/** A round cursor the size of the brush, so it shows exactly what a stroke will cover. */
function brushCursor(size: number, erase: boolean) {
  const d = Math.max(4, Math.min(120, Math.round(size)));
  const r = d / 2;
  const box = d + 4;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}"><circle cx="${box / 2}" cy="${box / 2}" r="${r}" fill="none" stroke="white" stroke-width="3"/><circle cx="${box / 2}" cy="${box / 2}" r="${r}" fill="none" stroke="${erase ? "#d83b3b" : "#1e6bff"}" stroke-width="1.5"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${box / 2} ${box / 2}, crosshair`;
}

function fitGaps(objectMm: number) {
  return objectMm < 60 ? [0, 0.05, 0.1, 0.2] : [0, 0.5, 1, 2];
}

type ReferenceDraft = { a: Point | null; b: Point | null; mm: string };
/** Pick clicks the object; Draw, Line and Erase clean the trace up by hand. */
type TraceTool = "pick" | "draw" | "line" | "erase";

/**
 * Trace from photo: a real object, photographed lying flat, becomes a sketch outline at
 * its true size. The size comes from a sheet of paper in the photo, from distances the
 * person types between clicked points (good for small parts like watch parts), or from
 * a scan's own resolution.
 */
export function TracePhotoDialog({ onCancel, onMake }: { onCancel: () => void; onMake: (traced: TracedPhoto) => void }) {
  const initial = useMemo(() => remembered(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState<Step>("photo");
  const [backdrop, setBackdrop] = useState<Backdrop>(initial.backdrop);
  const [sizing, setSizing] = useState<Sizing>(initial.sizing);
  const [paper, setPaper] = useState<PaperSize>(initial.paper);
  const [engine, setEngine] = useState<Engine>(initial.engine);
  const [source, setSource] = useState<{ name: string; picture: Rgba; scale: number; dpi: number | null; image: HTMLCanvasElement } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [corners, setCorners] = useState<Point[] | null>(null);
  const [paperFound, setPaperFound] = useState(true);
  const [references, setReferences] = useState<ReferenceDraft[]>([{ a: null, b: null, mm: "" }]);
  const [activeReference, setActiveReference] = useState(0);
  const [dpiDraft, setDpiDraft] = useState("");
  const [working, setWorking] = useState<{ picture: Rgba; mmPerPixel: number; image: HTMLCanvasElement; paperArea: PaperArea } | null>(null);
  const [clicks, setClicks] = useState<TraceClick[]>([]);
  const [sensitivity, setSensitivity] = useState(0.5);
  const [ignoreShadows, setIgnoreShadows] = useState(0.6);
  const [smoothness, setSmoothness] = useState(1);
  const [gapDraft, setGapDraft] = useState("0");
  const [mask, setMask] = useState<Uint8Array | null>(null);
  const [tracing, setTracing] = useState(false);
  const [ai, setAi] = useState<{ state: "off" | "downloading" | "thinking" | "ready" | "failed"; progress?: AiProgress; downloaded?: boolean }>({ state: "off" });
  const aiSegmentRef = useRef<((clicks: readonly TraceClick[]) => Promise<Uint8Array | null>) | null>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; viewX: number; viewY: number; corner: number | null; moved: boolean; pan: boolean } | null>(null);
  // Clean-up drawn over the trace, kept through every re-trace; edits says which came last, for Undo.
  const [tool, setTool] = useState<TraceTool>("pick");
  const [brush, setBrush] = useState(16);
  const [strokes, setStrokes] = useState<TraceStroke[]>([]);
  const [draft, setDraft] = useState<TraceStroke | null>(null);
  const [edits, setEdits] = useState<("click" | "stroke")[]>([]);
  const straightRef = useRef(false);
  const spaceRef = useRef(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space" && (event.target as HTMLElement | null)?.tagName !== "INPUT") spaceRef.current = event.type === "keydown";
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  const undo = useCallback(() => {
    setEdits((current) => {
      const last = current[current.length - 1];
      if (last === "stroke") setStrokes((list) => list.slice(0, -1));
      else if (last === "click") setClicks((list) => list.slice(0, -1));
      return current.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    remember({ backdrop, sizing, paper, engine });
  }, [backdrop, sizing, paper, engine]);

  useEffect(() => {
    void aiTracerDownloaded().then((downloaded) => setAi((current) => ({ ...current, downloaded })));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      // Ctrl+Z steps back through clicks and strokes here, not through the design.
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z" && step === "trace") {
        const target = event.target as HTMLElement | null;
        if (target?.tagName === "INPUT" && (target as HTMLInputElement).type !== "range") return;
        event.preventDefault();
        event.stopPropagation();
        undo();
        return;
      }
      if (step !== "trace" || event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.tagName === "INPUT") return;
      const key = event.key.toLowerCase();
      const next = key === "p" ? "pick" : key === "b" ? "draw" : key === "l" ? "line" : key === "e" ? "erase" : null;
      if (next) setTool(next);
      else if (key === "[" || key === "]") setBrush((size) => Math.max(2, Math.min(120, Math.round(size * (key === "]" ? 1.25 : 0.8)))));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel, undo, step]);

  // The picture on screen: the photo while sizing, the straightened one while tracing.
  const shown = step === "trace" ? working : source ? { picture: source.picture, image: source.image, mmPerPixel: 0 } : null;

  const fitView = useCallback((width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const zoom = Math.min(box.width / width, box.height / height) * 0.94;
    setView({ zoom, x: (box.width - width * zoom) / 2, y: (box.height - height * zoom) / 2 });
  }, []);

  useEffect(() => {
    if (shown) fitView(shown.picture.width, shown.picture.height);
    // Only when the picture itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown?.picture, fitView]);

  const choose = async (file: File) => {
    setReadError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const dpi = pictureDpi(bytes);
      const picture = await readPicture(file, READ_SIZE);
      const name = file.name.replace(/\.[^.]+$/, "") || "Traced outline";
      setSource({ name, picture, scale: picture.scale, dpi, image: pictureToCanvas(picture) });
      setClicks([]);
      setMask(null);
      setWorking(null);
      aiSegmentRef.current = null;
      setReferences([{ a: null, b: null, mm: "" }]);
      setActiveReference(0);
      if (dpi) {
        setDpiDraft(String(Math.round(dpi)));
        setSizing("scan");
      } else if (sizing === "scan") {
        setSizing("paper");
      }
      setStep("size");
    } catch {
      setReadError("Mintr could not read that picture. Try a JPG or PNG.");
    }
  };

  // Find the paper whenever the photo or the backdrop changes.
  useEffect(() => {
    if (!source || sizing !== "paper") return;
    const small = Math.min(1, 700 / Math.max(source.picture.width, source.picture.height));
    const preview = resizePicture(source.picture, Math.max(1, Math.round(source.picture.width * small)), Math.max(1, Math.round(source.picture.height * small)));
    const found = findPaper(preview, backdrop);
    setPaperFound(Boolean(found));
    const { width, height } = source.picture;
    setCorners(found
      ? found.map((corner) => ({ x: corner.x / small, y: corner.y / small }))
      : [{ x: width * 0.15, y: height * 0.15 }, { x: width * 0.85, y: height * 0.15 }, { x: width * 0.85, y: height * 0.85 }, { x: width * 0.15, y: height * 0.85 }]);
  }, [source, backdrop, sizing]);

  const referenceScale = useMemo(() => {
    const pairs = references.flatMap((pair) => {
      const mm = Number.parseFloat(pair.mm);
      return pair.a && pair.b && mm > 0 ? [{ a: pair.a, b: pair.b, mm }] : [];
    });
    return scaleFromReferences(pairs);
  }, [references]);

  const sizeProblem = !source
    ? "Choose a photo first."
    : sizing === "paper"
      ? !corners ? "Drag the four corners onto the paper's corners." : null
      : sizing === "points"
        ? !referenceScale ? "Click two points on something you know the size of, then type the distance between them." : null
        : !(Number.parseFloat(dpiDraft) >= 50) ? "Type the scan's resolution in dots per inch, such as 1200." : null;

  /** Makes the picture to trace, with square pixels of a known size. */
  const startTracing = () => {
    if (!source || sizeProblem) return;
    let picture: Rgba | null = null;
    let mmPerPixel = 0;
    if (sizing === "paper" && corners) {
      const sheet = paperOrientation(corners, paper);
      mmPerPixel = Math.max(sheet.width, sheet.height) / WORK_SIZE;
      picture = straightenPaper(source.picture, corners, sheet, mmPerPixel);
    } else if (sizing === "points" && referenceScale) {
      // Square up the pixels to the finer of the two scales, then shrink to the working size.
      const fine = Math.min(referenceScale.across, referenceScale.down);
      let width = source.picture.width * (referenceScale.across / fine);
      let height = source.picture.height * (referenceScale.down / fine);
      const shrink = Math.min(1, WORK_SIZE / Math.max(width, height));
      width *= shrink;
      height *= shrink;
      mmPerPixel = fine / shrink;
      picture = resizePicture(source.picture, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
    } else if (sizing === "scan") {
      const shrink = Math.min(1, WORK_SIZE / Math.max(source.picture.width, source.picture.height));
      mmPerPixel = scaleFromDpi(Number.parseFloat(dpiDraft)) / source.scale / shrink;
      picture = shrink < 1
        ? resizePicture(source.picture, Math.max(1, Math.round(source.picture.width * shrink)), Math.max(1, Math.round(source.picture.height * shrink)))
        : source.picture;
    }
    if (!picture || !(mmPerPixel > 0)) return;
    setWorking({ picture, mmPerPixel, image: pictureToCanvas(picture), paperArea: sizing === "paper" ? "whole" : sheetIn(picture, backdrop) });
    setClicks([]);
    setStrokes([]);
    setEdits([]);
    setDraft(null);
    setMask(null);
    aiSegmentRef.current = null;
    setStep("trace");
  };

  // Get the model ready for this picture when Better tracing is on.
  useEffect(() => {
    if (engine !== "ai" || !working) return;
    let cancelled = false;
    aiSegmentRef.current = null;
    setAi((current) => ({ ...current, state: current.downloaded ? "thinking" : "downloading" }));
    void loadAiTracer((progress) => {
      if (!cancelled) setAi((current) => ({ ...current, state: "downloading", progress }));
    })
      .then(() => {
        if (!cancelled) setAi((current) => ({ ...current, state: "thinking", downloaded: true }));
        return aiTracerFor(working.picture);
      })
      .then((segment) => {
        if (cancelled) return;
        aiSegmentRef.current = segment;
        setAi((current) => ({ ...current, state: "ready" }));
      })
      .catch(() => {
        if (!cancelled) setAi((current) => ({ ...current, state: "failed" }));
      });
    return () => {
      cancelled = true;
    };
  }, [engine, working]);

  // Trace again a moment after each click or slider change.
  useEffect(() => {
    if (!working || clicks.length === 0) {
      setMask(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setTracing(true);
      const run = async () => {
        if (engine === "ai") {
          const segment = aiSegmentRef.current;
          return segment ? segment(clicks) : null;
        }
        return segmentByColour(working.picture, clicks, { backdrop, sensitivity, ignoreShadows }, working.paperArea);
      };
      void run()
        .then((next) => {
          if (!cancelled && next) setMask(next);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setTracing(false);
        });
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [working, clicks, engine, backdrop, sensitivity, ignoreShadows, sizing, ai.state]);

  const gap = Number.parseFloat(gapDraft);
  const gapOk = Number.isFinite(gap) && gap >= -5 && gap <= 50;
  // The trace with the hand clean-up painted over it, in the order it was drawn.
  const edited = useMemo(() => {
    if (!working || (!mask && strokes.length === 0)) return null;
    return strokes.length ? applyStrokes(mask, working.picture.width, working.picture.height, strokes) : mask;
  }, [mask, strokes, working]);
  const objectBounds = useMemo(() => (edited && working ? maskBounds(edited, working.picture.width) : null), [edited, working]);
  const objectSize = objectBounds && working ? { width: objectBounds.width * working.mmPerPixel, height: objectBounds.height * working.mmPerPixel } : null;

  const traced: TraceResult | null = useMemo(() => {
    if (!edited || !working || !gapOk) return null;
    const grown = growMask(edited, working.picture.width, working.picture.height, gap / working.mmPerPixel);
    // Specks under about a fifth of a square millimetre, or a few pixels, are dust.
    const speckle = Math.max(4, Math.round(0.2 / working.mmPerPixel ** 2));
    return traceMask(grown, working.picture.width, working.picture.height, { speckle: Math.min(speckle, 400), smoothness });
  }, [edited, working, gap, gapOk, smoothness]);

  // Draw: the picture, then whatever this step adds on top.
  const overlay = useMemo(() => {
    if (!edited || !working) return null;
    const { width, height } = working.picture;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const pixels = context.createImageData(width, height);
    for (let index = 0; index < edited.length; index += 1) {
      if (!edited[index]) continue;
      pixels.data.set([30, 107, 255, 90], index * 4);
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  }, [edited, working]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !shown) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const box = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(box.width * ratio));
    canvas.height = Math.max(1, Math.round(box.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = backdrop === "black" ? "#1b1d1f" : "#e9e6e1";
    context.fillRect(0, 0, box.width, box.height);
    context.save();
    context.translate(view.x, view.y);
    context.scale(view.zoom, view.zoom);
    context.imageSmoothingEnabled = view.zoom < 2;
    context.drawImage(shown.image, 0, 0);
    const line = 1.5 / view.zoom;
    if (step === "size" && sizing === "paper" && corners) {
      context.strokeStyle = "#c8553d";
      context.lineWidth = line * 1.5;
      context.beginPath();
      corners.forEach((corner, index) => (index === 0 ? context.moveTo(corner.x, corner.y) : context.lineTo(corner.x, corner.y)));
      context.closePath();
      context.stroke();
      for (const corner of corners) {
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(corner.x, corner.y, 7 / view.zoom, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
    }
    if (step === "size" && sizing === "points") {
      references.forEach((pair, index) => {
        const colour = index === activeReference ? "#c8553d" : "#1e6bff";
        context.strokeStyle = colour;
        context.fillStyle = colour;
        context.lineWidth = line;
        if (pair.a && pair.b) {
          context.beginPath();
          context.moveTo(pair.a.x, pair.a.y);
          context.lineTo(pair.b.x, pair.b.y);
          context.stroke();
        }
        for (const point of [pair.a, pair.b]) {
          if (!point) continue;
          // A cross hair, so the exact pixel clicked shows when zoomed in.
          const arm = 9 / view.zoom;
          context.beginPath();
          context.moveTo(point.x - arm, point.y);
          context.lineTo(point.x + arm, point.y);
          context.moveTo(point.x, point.y - arm);
          context.lineTo(point.x, point.y + arm);
          context.stroke();
        }
        const label = pair.a ? (pair.b ? { x: (pair.a.x + pair.b.x) / 2, y: (pair.a.y + pair.b.y) / 2 } : pair.a) : null;
        if (label) {
          context.font = `${13 / view.zoom}px system-ui, sans-serif`;
          context.fillText(String(index + 1), label.x + 6 / view.zoom, label.y - 6 / view.zoom);
        }
      });
    }
    if (step === "trace") {
      if (overlay) context.drawImage(overlay, 0, 0);
      // The stroke being drawn shows as it goes; it joins the trace when the mouse lets go.
      if (draft && draft.points.length > 0) {
        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        context.lineWidth = draft.radius * 2;
        context.strokeStyle = draft.erase ? "rgba(216, 59, 59, 0.45)" : "rgba(30, 107, 255, 0.45)";
        context.beginPath();
        draft.points.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
        if (draft.points.length === 1) context.lineTo(draft.points[0].x + 0.01, draft.points[0].y);
        context.stroke();
        context.restore();
      }
      if (traced) {
        context.strokeStyle = "#ff3b30";
        context.lineWidth = line * 1.3;
        context.beginPath();
        for (const loop of traced.loops) {
          context.moveTo(loop.start.x, loop.start.y);
          for (const piece of loop.pieces) {
            if (piece.kind === "curve") context.bezierCurveTo(piece.c1.x, piece.c1.y, piece.c2.x, piece.c2.y, piece.to.x, piece.to.y);
            else context.lineTo(piece.to.x, piece.to.y);
          }
          context.closePath();
        }
        context.stroke();
      }
      for (const click of clicks) {
        context.fillStyle = click.keep ? "#2aa77e" : "#d83b3b";
        context.strokeStyle = "#ffffff";
        context.lineWidth = 2 / view.zoom;
        context.beginPath();
        context.arc(click.x, click.y, 5 / view.zoom, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
    }
    context.restore();
  }, [shown, view, step, sizing, corners, references, activeReference, overlay, traced, clicks, backdrop, draft]);

  const toPicture = (event: { clientX: number; clientY: number }) => {
    const box = canvasRef.current!.getBoundingClientRect();
    return { x: (event.clientX - box.left - view.x) / view.zoom, y: (event.clientY - box.top - view.y) / view.zoom };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!shown) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    let corner: number | null = null;
    if (step === "size" && sizing === "paper" && corners) {
      const at = toPicture(event);
      const reach = 14 / view.zoom;
      corners.forEach((point, index) => {
        if (corner === null && Math.hypot(point.x - at.x, point.y - at.y) < reach) corner = index;
      });
    }
    // With a brush tool, the left button paints; the right or middle button, or Space held, moves the photo.
    const pan = event.button !== 0 || spaceRef.current;
    if (step === "trace" && tool !== "pick" && !pan) {
      const at = toPicture(event);
      const straight = tool === "line" || event.shiftKey;
      setDraft({
        erase: tool === "erase" || (tool === "line" && (event.altKey || event.ctrlKey)),
        radius: brush / 2 / view.zoom,
        points: straight ? [at, at] : [at],
      });
      straightRef.current = straight;
      dragRef.current = null;
      return;
    }
    dragRef.current = { startX: event.clientX, startY: event.clientY, viewX: view.x, viewY: view.y, corner, moved: false, pan };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (draft) {
      const at = toPicture(event);
      setDraft((current) => {
        if (!current) return current;
        if (straightRef.current) return { ...current, points: [current.points[0], at] };
        const last = current.points[current.points.length - 1];
        // Skip points closer than a quarter of the brush, so long strokes stay light.
        return Math.hypot(at.x - last.x, at.y - last.y) < current.radius / 4 ? current : { ...current, points: [...current.points, at] };
      });
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.corner !== null && corners) {
      const at = toPicture(event);
      const index = drag.corner;
      setCorners(corners.map((point, other) => (other === index ? at : point)));
      return;
    }
    setView((current) => ({ ...current, x: drag.viewX + dx, y: drag.viewY + dy }));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (draft) {
      const finished = draft;
      setDraft(null);
      setStrokes((current) => [...current, finished]);
      setEdits((current) => [...current, "stroke"]);
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved || drag.pan || !shown) return;
    const at = toPicture(event);
    if (at.x < 0 || at.y < 0 || at.x > shown.picture.width || at.y > shown.picture.height) return;
    if (step === "size" && sizing === "points") {
      setReferences((current) => current.map((pair, index) => {
        if (index !== activeReference) return pair;
        if (!pair.a || (pair.a && pair.b)) return { ...pair, a: at, b: null };
        return { ...pair, b: at };
      }));
    } else if (step === "trace") {
      setClicks((current) => [...current, { x: at.x, y: at.y, keep: !(event.shiftKey || event.altKey) }]);
      setEdits((current) => [...current, "click"]);
    }
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    const factor = Math.exp(-event.deltaY * 0.0015);
    setView((current) => {
      const zoom = Math.max(0.02, Math.min(64, current.zoom * factor));
      const scale = zoom / current.zoom;
      return { zoom, x: px - (px - current.x) * scale, y: py - (py - current.y) * scale };
    });
  };

  /** Each solid piece with its holes, kept as curves; the flattened outer edge gives its extent. */
  const pieces = useMemo(() => {
    if (!traced) return [];
    const flat = traced.loops.map((loop) => ({ points: flattenLoop(loop, GROUPING_TOLERANCE_PX), area: loop.area }));
    const loopOf = new Map(flat.map((loop, index) => [loop.points, traced.loops[index]]));
    return groupIntoPieces(flat).map((piece) => ({
      outer: loopOf.get(piece.outer)!,
      outline: piece.outer,
      holes: piece.holes.map((hole) => loopOf.get(hole)!),
    }));
  }, [traced]);

  const finish = (event: FormEvent) => {
    event.preventDefault();
    if (!working || pieces.length === 0 || !source) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const piece of pieces) {
      for (const point of piece.outline) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    }
    const scale = working.mmPerPixel;
    const toMm = (point: Point) => ({ x: (point.x - minX) * scale, y: (point.y - minY) * scale });
    const loopToMm = (whole: TracedLoop): TracedLoop => {
      const loop = joinCurves(whole, JOIN_TOLERANCE_PX);
      return {
        start: toMm(loop.start),
        pieces: loop.pieces.map((piece) => (piece.kind === "curve" ? { kind: "curve", c1: toMm(piece.c1), c2: toMm(piece.c2), to: toMm(piece.to) } : { kind: "line", to: toMm(piece.to) })),
      };
    };
    onMake({
      name: source.name,
      width: (maxX - minX) * scale,
      height: (maxY - minY) * scale,
      pieces: pieces.map((piece) => ({ outer: loopToMm(piece.outer), holes: piece.holes.map(loopToMm) })),
    });
  };

  const gaps = fitGaps(objectSize ? Math.max(objectSize.width, objectSize.height) : 100);
  const percent = ai.progress && ai.progress.total > 0 ? Math.round((ai.progress.loaded / ai.progress.total) * 100) : null;
  const checks = referenceScale?.checks ?? [];

  return (
    <div className="inline-value-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="inline-value-dialog trace-photo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trace-photo-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={step === "trace" ? finish : (event) => {
          event.preventDefault();
          if (step === "size") startTracing();
        }}
      >
        <header className="inline-value-dialog-header">
          <strong id="trace-photo-title">Trace from photo</strong>
          <ol className="trace-photo-steps" aria-label="Steps">
            {(["photo", "size", "trace"] as const).map((value, index) => (
              <li key={value} className={value === step ? "active" : ""}>{index + 1}. {value === "photo" ? "Photo" : value === "size" ? "Size" : "Trace"}</li>
            ))}
          </ol>
          <button type="button" className="inline-value-dialog-close" aria-label="Close" onClick={onCancel}>
            <X size={16} strokeWidth={2.5} />
          </button>
        </header>
        <div className="trace-photo-body">
          <div className="trace-photo-stage">
            {shown ? (
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onWheel={onWheel}
                onContextMenu={(event) => event.preventDefault()}
                style={step === "trace" && tool !== "pick" ? { cursor: tool === "line" ? "crosshair" : brushCursor(brush, tool === "erase") } : undefined}
                aria-label="The photo. Scroll to zoom, drag to move it."
              />
            ) : (
              <button type="button" className="trace-logo-pick trace-photo-pick" onClick={() => fileInputRef.current?.click()}>
                <strong>Choose a photo or scan</strong>
                <span>JPG or PNG, taken from straight above</span>
              </button>
            )}
            {shown ? (
              <span className="trace-photo-hint">
                {step === "trace" && tool !== "pick" ? "Scroll to zoom · right-drag or hold Space to move" : "Scroll to zoom · drag to move"}
              </span>
            ) : null}
          </div>
          <div className="trace-photo-side">
            <input
              ref={fileInputRef}
              className="hidden-file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void choose(file);
                event.currentTarget.value = "";
              }}
            />
            {step === "photo" ? (
              <>
                <p className="inline-value-dialog-note">Lay the object flat and photograph it from straight above, in even light. Mintr traces its outline at true size.</p>
                <span className="trace-photo-label">What it lies on</span>
                <div className="box-maker-toggles">
                  <div role="radiogroup" aria-label="What it lies on">
                    {(["white", "black"] as const).map((value) => (
                      <button key={value} type="button" role="radio" aria-checked={backdrop === value} className={backdrop === value ? "active" : ""} onClick={() => setBackdrop(value)}>
                        {value === "white" ? "White paper" : "Black paper"}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="inline-value-dialog-note">
                  {backdrop === "white"
                    ? "White paper suits most things. Light it from above so shadows stay small."
                    : "Black paper suits shiny metal, like watch parts: the metal shows bright against it instead of mirroring a white sheet."}
                </p>
                {readError ? <p className="trace-logo-warning">{readError}</p> : null}
                <button type="button" className="trace-photo-primary" onClick={() => fileInputRef.current?.click()}>Choose photo</button>
              </>
            ) : null}
            {step === "size" && source ? (
              <>
                <span className="trace-photo-label">How to measure it</span>
                <div className="box-maker-toggles">
                  <div role="radiogroup" aria-label="How to measure it" className="three">
                    {(["paper", "points", "scan"] as const).map((value) => (
                      <button key={value} type="button" role="radio" aria-checked={sizing === value} className={sizing === value ? "active" : ""} onClick={() => setSizing(value)}>
                        {value === "paper" ? "Paper" : value === "points" ? "Sizes" : "Scan"}
                      </button>
                    ))}
                  </div>
                </div>
                {sizing === "paper" ? (
                  <>
                    <p className="inline-value-dialog-note">
                      {paperFound
                        ? "Mintr found the sheet. Drag a corner if it's off; zoom in for a close look."
                        : "Mintr couldn't find the sheet. Drag the four corners onto its corners."}{" "}
                      Keep the object on the paper.
                    </p>
                    <label className="inline-value-dialog-field">
                      <span>Paper size</span>
                      <select value={paper} onChange={(event) => setPaper(event.currentTarget.value as PaperSize)}>
                        {(Object.keys(PAPER_SIZES) as PaperSize[]).map((key) => (
                          <option key={key} value={key}>{PAPER_SIZES[key].label}</option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
                {sizing === "points" ? (
                  <>
                    <p className="inline-value-dialog-note">
                      For small parts. Put a ruler beside the part, or measure it, then click two points and type the distance between them.
                      A second distance at a right angle corrects a slightly tilted photo. A third checks the other two.
                    </p>
                    {references.map((pair, index) => {
                      const check = checks[index];
                      return (
                        <div key={index} className={`trace-photo-reference${index === activeReference ? " active" : ""}`} onClick={() => setActiveReference(index)}>
                          <span className="trace-photo-reference-name">Distance {index + 1}</span>
                          <span className="trace-photo-reference-state">{pair.a && pair.b ? "2 points" : pair.a ? "1 point" : "click 2 points"}</span>
                          <span className="inline-value-dialog-input-wrap">
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="any"
                              placeholder="mm"
                              value={pair.mm}
                              onFocus={() => setActiveReference(index)}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                setReferences((current) => current.map((other, at) => (at === index ? { ...other, mm: value } : other)));
                              }}
                              onKeyDown={(event) => event.stopPropagation()}
                            />
                            <small>mm</small>
                          </span>
                          {check && checks.length >= 3 ? (
                            <span className={`trace-photo-check${Math.abs(check.percentOff) > 1 ? " off" : ""}`}>
                              measures {check.measured.toFixed(check.measured < 20 ? 3 : 2)} mm, {Math.abs(check.percentOff).toFixed(1)}% off
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                    {references.length < 3 ? (
                      <button
                        type="button"
                        className="trace-logo-again"
                        onClick={() => {
                          setReferences((current) => [...current, { a: null, b: null, mm: "" }]);
                          setActiveReference(references.length);
                        }}
                      >
                        Add distance {references.length + 1}
                      </button>
                    ) : null}
                    {referenceScale && referenceScale.across !== referenceScale.down ? (
                      <p className="inline-value-dialog-note">The photo is stretched {Math.abs((referenceScale.across / referenceScale.down - 1) * 100).toFixed(1)}% more one way; Mintr straightens that out.</p>
                    ) : null}
                  </>
                ) : null}
                {sizing === "scan" ? (
                  <>
                    <p className="inline-value-dialog-note">
                      {source.dpi
                        ? `The scan says it is ${Math.round(source.dpi)} dots per inch, so Mintr knows its size already.`
                        : "Type the resolution you scanned at. A flatbed scan has no tilt, so it is the most exact way."}{" "}
                      For the finest detail, crop the scan to the part before tracing.
                    </p>
                    <label className="inline-value-dialog-field">
                      <span>Resolution</span>
                      <span className="inline-value-dialog-input-wrap">
                        <input type="number" inputMode="numeric" min={50} step={1} value={dpiDraft} onChange={(event) => setDpiDraft(event.currentTarget.value)} onKeyDown={(event) => event.stopPropagation()} />
                        <small>dpi</small>
                      </span>
                    </label>
                    {Number.parseFloat(dpiDraft) >= 50 ? (
                      <p className="inline-value-dialog-note">Each pixel is {(scaleFromDpi(Number.parseFloat(dpiDraft)) / source.scale).toFixed(4)} mm.</p>
                    ) : null}
                  </>
                ) : null}
                {sizeProblem ? <p className="trace-photo-problem">{sizeProblem}</p> : null}
                <div className="trace-photo-actions">
                  <button type="button" className="secondary" onClick={() => setStep("photo")}>Back</button>
                  <button type="submit" className="primary" disabled={Boolean(sizeProblem)}>Next</button>
                </div>
              </>
            ) : null}
            {step === "trace" && working ? (
              <>
                <span className="trace-photo-label">Tool</span>
                <div className="trace-photo-tools" role="radiogroup" aria-label="Tool">
                  {([
                    ["pick", "Pick", "P"],
                    ["draw", "Draw", "B"],
                    ["line", "Line", "L"],
                    ["erase", "Erase", "E"],
                  ] as const).map(([value, label, key]) => (
                    <button key={value} type="button" role="radio" aria-checked={tool === value} className={tool === value ? "active" : ""} onClick={() => setTool(value)} title={`${label} (${key})`}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="inline-value-dialog-note">
                  {tool === "pick" ? (
                    <><strong>Click the object.</strong> Click again on a part it missed. Shift-click a shadow or anything else that isn&apos;t the object.</>
                  ) : tool === "draw" ? (
                    <><strong>Paint in</strong> anything the trace missed. Hold Shift for a straight stroke.</>
                  ) : tool === "line" ? (
                    <><strong>Drag a straight line</strong> to fill in or square up an edge. Hold Ctrl as you start to erase along the line instead.</>
                  ) : (
                    <><strong>Paint out</strong> anything that isn&apos;t the object, like a ragged shadow. Hold Shift for a straight stroke.</>
                  )}
                </p>
                {tool !== "pick" ? (
                  <label className="trace-logo-slider">
                    <span>Brush size <em>{brush} px · [ and ] change it</em></span>
                    <input type="range" min={2} max={120} step={1} value={brush} onChange={(event) => setBrush(Number(event.currentTarget.value))} />
                  </label>
                ) : null}
                <span className="trace-photo-label">Tracer</span>
                <div className="box-maker-toggles">
                  <div role="radiogroup" aria-label="Tracer">
                    {(["simple", "ai"] as const).map((value) => (
                      <button key={value} type="button" role="radio" aria-checked={engine === value} className={engine === value ? "active" : ""} onClick={() => setEngine(value)}>
                        {value === "simple" ? "Simple" : "Better (AI)"}
                      </button>
                    ))}
                  </div>
                </div>
                {engine === "ai" ? (
                  <p className={`inline-value-dialog-note${ai.state === "failed" ? " trace-photo-problem" : ""}`}>
                    {ai.state === "downloading"
                      ? `Downloading the tracer, about 30 MB, once${percent !== null ? `: ${percent}%` : "…"}`
                      : ai.state === "thinking"
                        ? "Looking at the photo…"
                        : ai.state === "failed"
                          ? "The AI tracer couldn't start. It needs the internet the first time. Simple still works."
                          : "Better for shiny, multi-coloured or low-contrast objects. It runs on this computer; the photo never leaves it."}
                  </p>
                ) : (
                  <>
                    <label className="trace-logo-slider">
                      <span>Sensitivity <em>{sensitivity < 0.35 ? "only clear edges" : sensitivity > 0.65 ? "picks up faint parts" : "balanced"}</em></span>
                      <input type="range" min={0} max={1} step={0.01} value={sensitivity} onChange={(event) => setSensitivity(Number(event.currentTarget.value))} />
                    </label>
                    {backdrop === "white" ? (
                      <label className="trace-logo-slider">
                        <span>Ignore shadows <em>{ignoreShadows < 0.3 ? "a little" : ignoreShadows > 0.7 ? "strongly" : "some"}</em></span>
                        <input type="range" min={0} max={1} step={0.01} value={ignoreShadows} onChange={(event) => setIgnoreShadows(Number(event.currentTarget.value))} />
                      </label>
                    ) : null}
                  </>
                )}
                <label className="trace-logo-slider">
                  <span>Corners <em>{smoothness < 0.35 ? "sharp" : smoothness > 1.15 ? "all rounded" : "rounded where gentle"}</em></span>
                  <input type="range" min={0} max={1.33} step={0.01} value={smoothness} onChange={(event) => setSmoothness(Number(event.currentTarget.value))} />
                </label>
                <span className="trace-photo-label">Fit gap <em>added all round, so a pocket fits the object</em></span>
                <div className="trace-photo-gaps">
                  {gaps.map((value) => (
                    <button key={value} type="button" className={Math.abs(gap - value) < 1e-9 ? "active" : ""} onClick={() => setGapDraft(String(value))}>
                      {value === 0 ? "None" : `${value} mm`}
                    </button>
                  ))}
                  <span className="inline-value-dialog-input-wrap">
                    <input type="number" inputMode="decimal" step="any" value={gapDraft} onChange={(event) => setGapDraft(event.currentTarget.value)} onKeyDown={(event) => event.stopPropagation()} aria-label="Fit gap in millimetres" />
                    <small>mm</small>
                  </span>
                </div>
                <p className="trace-photo-size">
                  {tracing ? "Tracing…" : objectSize ? `The object measures ${objectSize.width.toFixed(objectSize.width < 20 ? 2 : 1)} × ${objectSize.height.toFixed(objectSize.height < 20 ? 2 : 1)} mm.` : "Click the object to trace it."}
                  {" "}<span>Each pixel is {working.mmPerPixel < 0.1 ? working.mmPerPixel.toFixed(3) : working.mmPerPixel.toFixed(2)} mm.</span>
                </p>
                <div className="trace-photo-actions">
                  <button type="button" className="secondary" onClick={undo} disabled={edits.length === 0} title="Undo (Ctrl+Z)">Undo</button>
                  <button type="button" className="secondary" onClick={() => setStep("size")}>Back</button>
                  <button type="submit" className="primary" disabled={pieces.length === 0}>Add to sketch</button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}
