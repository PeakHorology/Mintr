import type { CSSProperties, ReactNode } from "react";
import type { SagePicture } from "@/lib/sageGuides";

/** Mintr's selection brown. Click points only. */
const POINT = "#655447";

type Tip = [number, number];

/** Animation start (`at`) and length (`dur`) in seconds, plus any extra CSS variables. */
function timing(at: number, dur?: number, extra?: Record<string, string>): CSSProperties {
  return { "--at": `${at}s`, ...(dur === undefined ? {} : { "--dur": `${dur}s` }), ...extra } as CSSProperties;
}

const n = (value: number) => Math.round(value * 100) / 100;

function Point({ x, y, at }: { x: number; y: number; at: number }) {
  return <circle className="sage-point sage-pop" cx={x} cy={y} r="3.2" fill={POINT} stroke={POINT} style={timing(at)} />;
}

function Label({ x, y, at, children }: { x: number; y: number; at: number; children: ReactNode }) {
  return <text className="sage-fade" x={x} y={y} style={timing(at)}>{children}</text>;
}

function Appear({ at, children }: { at: number; children: ReactNode }) {
  return <g className="sage-fade" style={timing(at)}>{children}</g>;
}

function Vanish({ at, children }: { at: number; children: ReactNode }) {
  return <g className="sage-vanish" style={timing(at)}>{children}</g>;
}

/** Shown from `at` until `out`, like a hover highlight or a click point that is used up. */
function Flash({ at, out, children }: { at: number; out: number; children: ReactNode }) {
  return <Appear at={at}><Vanish at={out}>{children}</Vanish></Appear>;
}

/** Children sit where they end up; they start at `from` (a CSS transform) and settle at `at`. */
function Slide({ from, at, dur, origin, children }: { from: string; at: number; dur: number; origin?: string; children: ReactNode }) {
  return (
    <g className="sage-move" style={{ ...timing(at, dur, { "--from": from }), transformBox: "view-box", transformOrigin: origin }}>
      {children}
    </g>
  );
}

/** Like Slide, but the line weight stays 2 while it scales. */
function Grow({ from, at, dur, origin, children }: { from: string; at: number; dur: number; origin: string; children: ReactNode }) {
  return (
    <g className="sage-grow" style={{ ...timing(at, dur, { "--grow-from": from }), transformBox: "view-box", transformOrigin: origin }}>
      {children}
    </g>
  );
}

/** A path that reshapes from `from` into `d`. Both must use the same commands in the same order. */
function Morph({ from, d, at, dur, className = "" }: { from: string; d: string; at: number; dur: number; className?: string }) {
  return <path className={`sage-morph ${className}`} d={d} style={timing(at, dur, { "--d-from": `path("${from}")` })} />;
}

/**
 * Mouse pointer that walks `path` (tip positions) one leg per `moves` entry, clicking at each `presses` time.
 * Each leg is a wrapper that slides in from the previous tip, so legs compose without per-picture keyframes.
 */
function Pointer({ path, moves = [], presses = [] }: { path: Tip[]; moves?: Array<{ at: number; dur: number }>; presses?: number[] }) {
  const [x, y] = path[path.length - 1];
  let body: ReactNode = <path className="sage-pointer" d={`M${x} ${y}v11.5l3-2.9 2.4 5 2.2-1-2.4-5h4.2z`} />;
  for (const press of presses) body = <g className="sage-press" style={timing(press)}>{body}</g>;
  for (let leg = moves.length - 1; leg >= 0; leg -= 1) {
    const [fromX, fromY] = path[leg];
    const [toX, toY] = path[leg + 1];
    const from = `translate(${fromX - toX}px, ${fromY - toY}px)`;
    body = <g className="sage-move" style={timing(moves[leg].at, moves[leg].dur, { "--from": from })}>{body}</g>;
  }
  return body;
}

type BoxSize = { x: number; y: number; w: number; h: number; dx?: number; dy?: number };

/** Front, top, and right faces of a box seen from the front right; (x, y) is the front top-left corner. */
function boxFaces({ x, y, w, h, dx = 10, dy = -7 }: BoxSize) {
  const p = (px: number, py: number) => `${n(px)} ${n(py)}`;
  return [
    `M${p(x, y)}L${p(x + w, y)}L${p(x + w, y + h)}L${p(x, y + h)}Z`,
    `M${p(x, y)}L${p(x + dx, y + dy)}L${p(x + w + dx, y + dy)}L${p(x + w, y)}Z`,
    `M${p(x + w, y)}L${p(x + w + dx, y + dy)}L${p(x + w + dx, y + dy + h)}L${p(x + w, y + h)}Z`,
  ];
}

function Box({ className = "", ...size }: BoxSize & { className?: string }) {
  return <>{boxFaces(size).map((d) => <path key={d} className={`sage-solid ${className}`} d={d} />)}</>;
}

/** A box that reshapes from one size to another. */
function MorphBox({ from, to, at, dur }: { from: BoxSize; to: BoxSize; at: number; dur: number }) {
  const start = boxFaces(from);
  return <>{boxFaces(to).map((d, face) => <Morph key={face} className="sage-solid" from={start[face]} d={d} at={at} dur={dur} />)}</>;
}

/** `count - 1` copies of `children` spun around (cx, cy), one after another. */
function RingCopies({ cx, cy, count, at, children }: { cx: number; cy: number; count: number; at: number; children: ReactNode }) {
  const step = 360 / count;
  return (
    <>
      {Array.from({ length: count - 1 }, (_, index) => (
        <g key={index} transform={`rotate(${step * (index + 1)} ${cx} ${cy})`}>
          <Appear at={at + index * 0.2}>
            <Slide from={`rotate(${-step}deg)`} at={at + index * 0.2} dur={0.3} origin={`${cx}px ${cy}px`}>{children}</Slide>
          </Appear>
        </g>
      ))}
    </>
  );
}

/* ---------- Sketch: drawing ---------- */

/** Click 1, glide, click 2. */
function LinePicture() {
  return (
    <>
      <line className="sage-draw" x1="14" y1="38" x2="52" y2="16" pathLength={1} style={timing(0.4, 0.8)} />
      <Point x={14} y={38} at={0} />
      <Point x={52} y={16} at={1.25} />
      <Pointer path={[[16, 40], [54, 18]]} moves={[{ at: 0.4, dur: 0.8 }]} presses={[1.2]} />
      <Label x={8} y={51} at={0}>1</Label>
      <Label x={57} y={13} at={1.25}>2</Label>
    </>
  );
}

/** Start, end, then the arc bulges up to follow the third click. */
function ArcPicture() {
  return (
    <>
      <Appear at={1}>
        <Grow from="scaleY(0)" at={1.3} dur={0.7} origin="36px 38px">
          <path d="M14 38A22 22 0 0 1 58 38" />
        </Grow>
      </Appear>
      <Point x={14} y={38} at={0} />
      <Point x={58} y={38} at={1} />
      <Point x={36} y={16} at={2.05} />
      <Pointer path={[[16, 40], [60, 40], [38, 18]]} moves={[{ at: 0.35, dur: 0.6 }, { at: 1.3, dur: 0.7 }]} presses={[2]} />
      <Label x={11} y={51} at={0}>1</Label>
      <Label x={53} y={51} at={1}>2</Label>
      <Label x={28} y={12} at={2.05}>3</Label>
    </>
  );
}

/** Drag out a mint handle, then click the next point and the curve follows the handle. */
function CurvePicture() {
  return (
    <>
      <line className="sage-handle sage-draw" x1="14" y1="38" x2="30" y2="14" pathLength={1} style={timing(0.35, 0.65)} />
      <path className="sage-draw" d="M14 38C30 14 44 50 58 34" pathLength={1} style={timing(1.3, 0.8)} />
      <circle className="sage-knob sage-pop" cx="30" cy="14" r="2.2" style={timing(1)} />
      <Point x={14} y={38} at={0} />
      <Point x={58} y={34} at={2.15} />
      <Pointer path={[[16, 40], [32, 16], [60, 36]]} moves={[{ at: 0.35, dur: 0.65 }, { at: 1.3, dur: 0.8 }]} presses={[2.1]} />
      <Label x={8} y={51} at={0}>1</Label>
      <Label x={62} y={30} at={2.15}>2</Label>
    </>
  );
}

/** Press one corner and drag; the rectangle opens behind the pointer. */
function RectanglePicture() {
  return (
    <>
      <Grow from="scale(0)" at={0.4} dur={0.8} origin="14px 10px">
        <rect x="14" y="10" width="36" height="26" />
      </Grow>
      <Point x={14} y={10} at={0} />
      <Point x={50} y={36} at={1.25} />
      <Pointer path={[[16, 12], [52, 38]]} moves={[{ at: 0.4, dur: 0.8 }]} presses={[1.2]} />
      <Label x={5} y={8} at={0}>1</Label>
      <Label x={55} y={33} at={1.25}>2</Label>
    </>
  );
}

/** Press the center and drag out the radius. */
function CirclePicture() {
  return (
    <>
      <Grow from="scale(0)" at={0.4} dur={0.8} origin="28px 28px">
        <circle cx="28" cy="28" r="18" />
      </Grow>
      <line className="sage-guide sage-draw" x1="28" y1="28" x2="46" y2="28" pathLength={1} style={timing(0.4, 0.8)} />
      <Point x={28} y={28} at={0} />
      <Point x={46} y={28} at={1.25} />
      <Pointer path={[[30, 30], [48, 30]]} moves={[{ at: 0.4, dur: 0.8 }]} presses={[1.2]} />
      <Label x={20} y={24} at={0}>1</Label>
      <Label x={49} y={23} at={1.25}>2</Label>
    </>
  );
}

/* ---------- Sketch: editing ---------- */

/** Click inside a shape to select it, then drag it. */
function SelectPicture() {
  return (
    <>
      <Slide from="translate(-24px, 0)" at={1} dur={0.8}>
        <rect x="34" y="14" width="20" height="20" />
        <Appear at={0.65}><rect className="sage-sel" x="34" y="14" width="20" height="20" /></Appear>
      </Slide>
      <Pointer path={[[8, 40], [20, 24], [44, 24]]} moves={[{ at: 0.2, dur: 0.45 }, { at: 1, dur: 0.8 }]} presses={[0.65]} />
    </>
  );
}

/** Drag an edge of a selected shape and a copy opens around it. */
function OffsetPicture() {
  return (
    <>
      <rect className="sage-sel" x="22" y="20" width="28" height="16" />
      <Appear at={0.5}>
        <Grow from="scale(0.64, 0.5)" at={0.5} dur={0.8} origin="36px 28px">
          <rect x="14" y="12" width="44" height="32" />
        </Grow>
      </Appear>
      <Pointer path={[[51, 30], [59, 30]]} moves={[{ at: 0.5, dur: 0.8 }]} presses={[0.3]} />
    </>
  );
}

/** Click a corner and it turns into `rounded`. */
function CornerPicture({ rounded }: { rounded: string }) {
  return (
    <>
      <Morph from="M14 46L14 12Q14 12 14 12L60 12" d={rounded} at={1} dur={0.6} />
      <Vanish at={1}><Point x={14} y={12} at={0.75} /></Vanish>
      <Pointer path={[[40, 38], [16, 14], [40, 34]]} moves={[{ at: 0.2, dur: 0.5 }, { at: 1, dur: 0.5 }]} presses={[0.75]} />
    </>
  );
}

function SketchFilletPicture() {
  return <CornerPicture rounded="M14 46L14 30Q14 12 32 12L60 12" />;
}

function SketchChamferPicture() {
  return <CornerPicture rounded="M14 46L14 30Q23 21 32 12L60 12" />;
}

/** Hover the piece past the crossing, click, and it is gone. */
function TrimPicture() {
  return (
    <>
      <path d="M36 8V48M8 28H36" />
      <Vanish at={1.05}>
        <path d="M36 28H64" />
        <Appear at={0.75}><path className="sage-sel" d="M36 28H64" /></Appear>
      </Vanish>
      <Pointer path={[[24, 42], [52, 29]]} moves={[{ at: 0.2, dur: 0.5 }]} presses={[0.75]} />
    </>
  );
}

/** Click the mirror line; the sketch swings across it. */
function SketchMirrorPicture() {
  return (
    <>
      <path d="M36 6V50" />
      <Appear at={0.7}><path className="sage-sel" d="M36 6V50" /></Appear>
      <path d="M12 40L30 40L24 14Z" />
      <Grow from="scaleX(-1)" at={1} dur={0.7} origin="36px 28px">
        <path d="M60 40L42 40L48 14Z" />
      </Grow>
      <Pointer path={[[56, 40], [37, 10], [6, 8]]} moves={[{ at: 0.2, dur: 0.5 }, { at: 0.95, dur: 0.5 }]} presses={[0.7]} />
    </>
  );
}

/** The brush sweeps along a line and wipes it away. */
function ErasePicture() {
  return (
    <>
      <path d="M10 18H62" />
      <path className="sage-erase" d="M10 38H62" pathLength={1} style={timing(0.4, 1)} />
      <Vanish at={1.5}>
        <Slide from="translate(-52px, 0)" at={0.4} dur={1}>
          <circle className="sage-brush" cx="62" cy="38" r="6" />
        </Slide>
      </Vanish>
    </>
  );
}

/** Click a segment to add a point on it. */
function BendPicture() {
  return (
    <>
      <path d="M10 36H62" />
      <Point x={36} y={36} at={0.75} />
      <Pointer path={[[54, 12], [37, 38]]} moves={[{ at: 0.2, dur: 0.5 }]} presses={[0.7]} />
    </>
  );
}

/** Click a sharp point and it becomes a smooth bend with mint handles. */
function SmoothPicture() {
  return (
    <>
      <Morph from="M10 42C10 42 36 14 36 14C36 14 62 42 62 42" d="M10 42C10 42 22 14 36 14C50 14 62 42 62 42" at={1} dur={0.6} />
      <Appear at={1.1}>
        <path className="sage-handle" d="M22 14H50" />
        <circle className="sage-knob" cx="22" cy="14" r="2.2" />
        <circle className="sage-knob" cx="50" cy="14" r="2.2" />
      </Appear>
      <Point x={36} y={14} at={0.75} />
      <Pointer path={[[56, 40], [37, 16]]} moves={[{ at: 0.2, dur: 0.5 }]} presses={[0.7]} />
    </>
  );
}

/** Click inside a shape; copies step out in a row. */
function SketchLinearPicture() {
  return (
    <>
      <rect x="8" y="22" width="10" height="10" />
      <Appear at={0.65}><rect className="sage-sel" x="8" y="22" width="10" height="10" /></Appear>
      {[24, 40, 56].map((x, index) => (
        <Appear key={x} at={1 + index * 0.3}>
          <Slide from="translate(-16px, 0)" at={1 + index * 0.3} dur={0.35}>
            <rect x={x} y="22" width="10" height="10" />
          </Slide>
        </Appear>
      ))}
      <Pointer path={[[34, 40], [12, 27], [10, 40]]} moves={[{ at: 0.2, dur: 0.45 }, { at: 0.85, dur: 0.3 }]} presses={[0.65]} />
    </>
  );
}

/** Click inside a shape; copies spin around the middle. */
function SketchCircularPicture() {
  return (
    <>
      <path className="sage-guide" d="M33 28h6M36 25v6" />
      <rect x="32" y="8" width="8" height="8" />
      <Appear at={0.65}><rect className="sage-sel" x="32" y="8" width="8" height="8" /></Appear>
      <RingCopies cx={36} cy={28} count={6} at={1.1}><rect x="32" y="8" width="8" height="8" /></RingCopies>
      <Pointer path={[[8, 40], [37, 13], [8, 40]]} moves={[{ at: 0.2, dur: 0.5 }, { at: 0.85, dur: 0.4 }]} presses={[0.65]} />
    </>
  );
}

/** Click a line and it is drawn heavier. */
function LineweightPicture() {
  return (
    <>
      <path className="sage-weight" d="M10 28H62" style={{ ...timing(0.9, 0.4, { "--w-from": "1" }), strokeWidth: 5 }} />
      <Pointer path={[[52, 44], [40, 30]]} moves={[{ at: 0.2, dur: 0.45 }]} presses={[0.7]} />
    </>
  );
}

/** Click a line, a dimension appears, and the line stretches to the typed length. */
function DimensionPicture() {
  return (
    <>
      <Grow from="scaleX(0.7)" at={1.2} dur={0.6} origin="12px 40px">
        <path d="M12 40H60" />
        <Appear at={0.85}>
          <path className="sage-guide" d="M12 35V24M60 35V24M12 28H60M10 30l4-4M58 30l4-4" />
        </Appear>
      </Grow>
      <Pointer path={[[30, 12], [37, 41]]} moves={[{ at: 0.2, dur: 0.45 }]} presses={[0.7]} />
    </>
  );
}

/** Extrude: the closed outline rises into a solid. */
function ExtrudePicture() {
  return (
    <>
      <MorphBox from={{ x: 14, y: 44, w: 30, h: 0, dx: 12, dy: -9 }} to={{ x: 14, y: 22, w: 30, h: 22, dx: 12, dy: -9 }} at={0.6} dur={1} />
      <Pointer path={[[36, 41], [36, 19]]} moves={[{ at: 0.6, dur: 1 }]} presses={[0.35]} />
    </>
  );
}

/** Click the axis; the profile spins round it into a solid. */
function RevolvePicture() {
  return (
    <>
      <path className="sage-guide sage-dash" d="M36 4V52" />
      <Appear at={0.7}><path className="sage-sel" d="M36 4V52" /></Appear>
      <path d="M36 12H46C46 22 54 28 54 36S48 46 46 46H36" />
      <Grow from="scaleX(-1)" at={1.05} dur={0.7} origin="36px 28px">
        <path d="M36 12H26C26 22 18 28 18 36S24 46 26 46H36" />
      </Grow>
      <Appear at={1.7}>
        <ellipse cx="36" cy="12" rx="10" ry="2.5" />
        <ellipse cx="36" cy="46" rx="10" ry="2.5" />
      </Appear>
      <Pointer path={[[60, 40], [37, 28], [4, 38]]} moves={[{ at: 0.2, dur: 0.5 }, { at: 0.95, dur: 0.4 }]} presses={[0.7]} />
    </>
  );
}

/** The outline travels along the path, leaving a tube. */
function SweepPicture() {
  return (
    <>
      <path className="sage-guide sage-dash" d="M12 40C28 40 32 16 60 16" />
      <ellipse className="sage-sel" cx="12" cy="40" rx="2.5" ry="6" />
      <path className="sage-draw" d="M12 34C26 34 30 10 60 10" pathLength={1} style={timing(0.6, 1.1)} />
      <path className="sage-draw" d="M12 46C30 46 34 22 60 22" pathLength={1} style={timing(0.6, 1.1)} />
      <Appear at={1.65}><ellipse cx="60" cy="16" rx="2.5" ry="6" /></Appear>
    </>
  );
}

/* ---------- Sketch: constraints. Mint marks the rule once it holds. ---------- */

/** Click point 1, then point 2; the second line moves so they meet. */
function CoincidentPicture() {
  return (
    <>
      <path d="M10 42L34 24" />
      <Point x={34} y={24} at={0.6} />
      <Slide from="translate(10px, 6px)" at={1.4} dur={0.5}>
        <path d="M34 24L56 40" />
        <Point x={34} y={24} at={1.15} />
      </Slide>
      <Appear at={1.95}><circle className="sage-ok" cx="34" cy="24" r="5.5" /></Appear>
      <Pointer path={[[52, 8], [35, 26], [45, 32]]} moves={[{ at: 0.2, dur: 0.4 }, { at: 0.8, dur: 0.35 }]} presses={[0.6, 1.15]} />
    </>
  );
}

/** Click a line; it turns to sit level (or upright). */
function TurnPicture({ line, from, origin, mark, tip }: { line: string; from: string; origin: string; mark: string; tip: Tip }) {
  return (
    <>
      <Slide from={from} at={1} dur={0.6} origin={origin}>
        <path d={line} />
        <Appear at={0.75}><path className="sage-sel" d={line} /></Appear>
      </Slide>
      <Appear at={1.7}><path className="sage-ok" d={mark} /></Appear>
      <Pointer path={[[58, 40], tip]} moves={[{ at: 0.2, dur: 0.5 }]} presses={[0.75]} />
    </>
  );
}

function HorizontalPicture() {
  return <TurnPicture line="M14 31H58" from="rotate(-22deg)" origin="36px 31px" mark="M31 25H41" tip={[38, 33]} />;
}

function VerticalPicture() {
  return <TurnPicture line="M36 10V46" from="rotate(30deg)" origin="36px 28px" mark="M28 22V34" tip={[37, 30]} />;
}

/** Click two lines; the second changes length to match. */
function EqualPicture() {
  return (
    <>
      <path d="M10 16H40" />
      <Appear at={0.6}><path className="sage-sel" d="M10 16H40" /></Appear>
      <Grow from="scaleX(1.6)" at={1.35} dur={0.5} origin="10px 38px">
        <path d="M10 38H40" />
        <Appear at={1.1}><path className="sage-sel" d="M10 38H40" /></Appear>
      </Grow>
      <Appear at={1.95}><path className="sage-ok" d="M25 12V20M25 34V42" /></Appear>
      <Pointer path={[[60, 28], [31, 18], [51, 40]]} moves={[{ at: 0.2, dur: 0.4 }, { at: 0.75, dur: 0.35 }]} presses={[0.6, 1.1]} />
    </>
  );
}

/** Click two lines; the second turns to run alongside the first. */
function ParallelPicture() {
  return (
    <>
      <path d="M10 14L50 24" />
      <Appear at={0.6}><path className="sage-sel" d="M10 14L50 24" /></Appear>
      <Slide from="rotate(-24deg)" at={1.35} dur={0.6} origin="40px 37px">
        <path d="M20 32L60 42" />
        <Appear at={1.1}><path className="sage-sel" d="M20 32L60 42" /></Appear>
      </Slide>
      <Appear at={2.05}><path className="sage-ok" d="M21 12.5L19 20.5M31 30.5L29 38.5" /></Appear>
      <Pointer path={[[64, 8], [31, 21], [41, 39]]} moves={[{ at: 0.2, dur: 0.4 }, { at: 0.75, dur: 0.35 }]} presses={[0.6, 1.1]} />
    </>
  );
}

/** Click two lines; the second swings to a square corner. */
function RightAnglePicture() {
  return (
    <>
      <path d="M14 42H60" />
      <Appear at={0.6}><path className="sage-sel" d="M14 42H60" /></Appear>
      <Slide from="rotate(35deg)" at={1.35} dur={0.6} origin="14px 42px">
        <path d="M14 42V10" />
        <Appear at={1.1}><path className="sage-sel" d="M14 42V10" /></Appear>
      </Slide>
      <Appear at={2.05}><path className="sage-ok" d="M14 34H22V42" /></Appear>
      <Pointer path={[[58, 8], [48, 40], [24, 31]]} moves={[{ at: 0.2, dur: 0.4 }, { at: 0.75, dur: 0.35 }]} presses={[0.6, 1.1]} />
    </>
  );
}

/** Click the line, then the circle; the line drops to touch it. */
function TangentPicture() {
  return (
    <>
      <circle cx="24" cy="32" r="12" />
      <Appear at={1.1}><circle className="sage-sel" cx="24" cy="32" r="12" /></Appear>
      <Slide from="translate(0, -10px)" at={1.35} dur={0.5}>
        <path d="M6 20H66" />
        <Appear at={0.6}><path className="sage-sel" d="M6 20H66" /></Appear>
      </Slide>
      <Appear at={1.95}><circle className="sage-knob" cx="24" cy="20" r="2.2" /></Appear>
      <Pointer path={[[60, 34], [52, 12], [37, 34]]} moves={[{ at: 0.2, dur: 0.4 }, { at: 0.75, dur: 0.35 }]} presses={[0.6, 1.1]} />
    </>
  );
}

/** Click a point, then a line; the point slides to the line's middle. */
function MidpointPicture() {
  return (
    <>
      <path d="M10 42H62" />
      <Appear at={1.15}><path className="sage-sel" d="M10 42H62" /></Appear>
      <Slide from="translate(16px, -26px)" at={1.35} dur={0.5}>
        <Point x={36} y={42} at={0} />
      </Slide>
      <Appear at={1.95}><path className="sage-ok" d="M20 38V46M52 38V46" /></Appear>
      <Pointer path={[[8, 8], [54, 18], [24, 39]]} moves={[{ at: 0.2, dur: 0.45 }, { at: 0.8, dur: 0.35 }]} presses={[0.65, 1.15]} />
    </>
  );
}

/** Click two circles; the second moves onto the first one's center. */
function ConcentricPicture() {
  return (
    <>
      <circle cx="26" cy="28" r="15" />
      <Appear at={0.6}><circle className="sage-sel" cx="26" cy="28" r="15" /></Appear>
      <Slide from="translate(24px, -8px)" at={1.35} dur={0.5}>
        <circle cx="26" cy="28" r="7" />
        <Appear at={1.1}><circle className="sage-sel" cx="26" cy="28" r="7" /></Appear>
      </Slide>
      <Appear at={1.95}><circle className="sage-knob" cx="26" cy="28" r="2" /></Appear>
      <Pointer path={[[8, 8], [27, 41], [58, 22]]} moves={[{ at: 0.2, dur: 0.4 }, { at: 0.75, dur: 0.35 }]} presses={[0.6, 1.1]} />
    </>
  );
}

/** Click a line and a lock appears on it. */
function FixPicture() {
  return (
    <>
      <path d="M10 38L48 20" />
      <Appear at={0.7}><path className="sage-sel" d="M10 38L48 20" /></Appear>
      <g className="sage-pop" style={timing(0.95)}>
        <path d="M53.5 21V17.5a3.5 3.5 0 0 1 7 0V21" />
        <rect className="sage-solid" x="51" y="21" width="12" height="10" rx="2" />
      </g>
      <Pointer path={[[12, 8], [30, 30]]} moves={[{ at: 0.2, dur: 0.45 }]} presses={[0.7]} />
    </>
  );
}

/** Click the pair, then the axis; the second point mirrors the first. */
function SymmetryPicture() {
  return (
    <>
      <path d="M36 6V50" />
      <Appear at={1.45}><path className="sage-sel" d="M36 6V50" /></Appear>
      <Point x={20} y={22} at={0.55} />
      <Slide from="translate(4px, 14px)" at={1.65} dur={0.5}>
        <Point x={52} y={22} at={1} />
      </Slide>
      <Appear at={2.2}><path className="sage-ok sage-dash" d="M24 22H48" /></Appear>
      <Pointer
        path={[[8, 40], [21, 24], [57, 38], [37, 40]]}
        moves={[{ at: 0.15, dur: 0.35 }, { at: 0.65, dur: 0.3 }, { at: 1.1, dur: 0.3 }]}
        presses={[0.55, 1, 1.45]}
      />
    </>
  );
}

/* ---------- Workplane ---------- */

/** A copy lands on the original and is dragged off it. */
function DuplicatePicture() {
  return (
    <>
      <Box x={10} y={24} w={22} h={20} />
      <Appear at={0.6}>
        <Slide from="translate(-24px, 0)" at={1} dur={0.7}>
          <Box className="sage-sel" x={34} y={24} w={22} h={20} />
        </Slide>
      </Appear>
      <Pointer path={[[22, 36], [46, 36]]} moves={[{ at: 1, dur: 0.7 }]} presses={[0.4]} />
    </>
  );
}

/** One copy sets the step; each repeat adds another at the same spacing. */
function DuplicateRepeatPicture() {
  const steps = [0, 1, 2, 3];
  return (
    <>
      {[...steps].reverse().map((step) => {
        const box = <Box x={6 + step * 14} y={34 - step * 8} w={12} h={12} dx={6} dy={-4} />;
        if (step < 2) return <g key={step}>{box}</g>;
        const at = 0.5 + (step - 2) * 0.6;
        return (
          <Appear key={step} at={at}>
            <Slide from="translate(-14px, 8px)" at={at} dur={0.4}>{box}</Slide>
          </Appear>
        );
      })}
    </>
  );
}

const GROUP_SQUARE = { x: 10, y: 14, width: 26, height: 26 };
const GROUP_CIRCLE = { cx: 42, cy: 27, r: 13 };

/** Two shapes drawn separately. */
function LooseShapes({ selected }: { selected: number }) {
  return (
    <>
      <rect {...GROUP_SQUARE} />
      <circle {...GROUP_CIRCLE} />
      <Appear at={selected}>
        <rect className="sage-sel" {...GROUP_SQUARE} />
        <circle className="sage-sel" {...GROUP_CIRCLE} />
      </Appear>
    </>
  );
}

/** The same two shapes as one outline: covers hide the lines inside. */
function FusedShapes() {
  return (
    <>
      <rect className="sage-thick" {...GROUP_SQUARE} />
      <circle className="sage-thick" {...GROUP_CIRCLE} />
      <rect className="sage-cover" {...GROUP_SQUARE} />
      <circle className="sage-cover" {...GROUP_CIRCLE} />
    </>
  );
}

function GroupPicture() {
  return (
    <>
      <Vanish at={1.1}><LooseShapes selected={0.5} /></Vanish>
      <Appear at={1.1}><FusedShapes /></Appear>
    </>
  );
}

/** Unwrap: the outline splits back into its shapes, which can move apart. */
function UngroupPicture() {
  return (
    <>
      <Vanish at={1}><FusedShapes /></Vanish>
      <Appear at={1}>
        <rect {...GROUP_SQUARE} />
        <Slide from="translate(-6px, 0)" at={1.4} dur={0.5}>
          <circle cx={GROUP_CIRCLE.cx + 6} cy={GROUP_CIRCLE.cy} r={GROUP_CIRCLE.r} />
        </Slide>
      </Appear>
    </>
  );
}

/** Two shapes tied together move as a set, but keep their own outlines. */
function TiePicture() {
  return (
    <Slide from="translate(-6px, -8px)" at={1.3} dur={0.6}>
      <rect x="16" y="24" width="20" height="20" />
      <circle cx="54" cy="34" r="10" />
      <Appear at={0.4}>
        <rect className="sage-sel" x="16" y="24" width="20" height="20" />
        <circle className="sage-sel" cx="54" cy="34" r="10" />
      </Appear>
      <Appear at={0.9}><path className="sage-guide sage-dash" d="M38 34H42" /></Appear>
    </Slide>
  );
}

/** Only the overlap is kept. */
function IntersectPicture() {
  return (
    <>
      <Vanish at={1.1}><LooseShapes selected={0.5} /></Vanish>
      <Appear at={1.1}><path d="M36 15.47A13 13 0 0 0 36 38.53Z" /></Appear>
    </>
  );
}

const EDGE_BOX = { x: 12, y: 22, w: 34, h: 22, dx: 12, dy: -9 };

/** Click the front top edge; it is cut back (`round` false) or rounded over. */
function EdgePicture({ round }: { round: boolean }) {
  const { x, y, w, h, dx, dy } = EDGE_BOX;
  const c = 9;
  const kx = dx * 0.6;
  const ky = dy * 0.6;
  const p = (px: number, py: number) => `${n(px)} ${n(py)}`;
  // Each face is written for both the sharp box (amount 0) and the finished edge, with the same commands.
  const faces = (amount: number) => {
    const drop = y + c * amount;
    const backX = kx * amount;
    const backY = y + ky * amount;
    const bend = (fromX: number) =>
      round ? `Q${p(fromX, y)} ${p(fromX + backX, backY)}` : `L${p(fromX + backX, backY)}`;
    const bendBack = (fromX: number) => (round ? `Q${p(fromX, y)} ${p(fromX, drop)}` : `L${p(fromX, drop)}`);
    return [
      `M${p(x, drop)}L${p(x + w, drop)}L${p(x + w, y + h)}L${p(x, y + h)}Z`,
      `M${p(x, drop)}${bend(x)}L${p(x + w + backX, backY)}${bendBack(x + w)}Z`,
      `M${p(x + backX, backY)}L${p(x + dx, y + dy)}L${p(x + w + dx, y + dy)}L${p(x + w + backX, backY)}Z`,
      `M${p(x + w, y + h)}L${p(x + w, drop)}${bend(x + w)}L${p(x + w + dx, y + dy)}L${p(x + w + dx, y + dy + h)}Z`,
    ];
  };
  const sharp = faces(0);
  const done = faces(1);
  return (
    <>
      {done.map((d, face) => <Morph key={face} className="sage-solid" from={sharp[face]} d={d} at={1.1} dur={0.6} />)}
      <Flash at={0.6} out={1.1}><path className="sage-pick" d={`M${x} ${y}H${x + w}`} /></Flash>
      <Pointer path={[[6, 40], [30, 23], [6, 40]]} moves={[{ at: 0.2, dur: 0.4 }, { at: 0.9, dur: 0.35 }]} presses={[0.6]} />
    </>
  );
}

function ChamferPicture() {
  return <EdgePicture round={false} />;
}

function FilletPicture() {
  return <EdgePicture round />;
}

/** Drag the selected side face and the solid grows with it. */
function PushPullPicture() {
  const start = { x: 10, y: 24, w: 22, h: 20, dx: 12, dy: -9 };
  const end = { ...start, w: 38 };
  return (
    <>
      <MorphBox from={start} to={end} at={1} dur={0.8} />
      <Appear at={0.6}>
        <Morph className="sage-face-pick" from={boxFaces(start)[2]} d={boxFaces(end)[2]} at={1} dur={0.8} />
      </Appear>
      <Pointer path={[[38, 30], [54, 30]]} moves={[{ at: 1, dur: 0.8 }]} presses={[0.6]} />
    </>
  );
}

/** Click a top face; a pad rises out of it. */
function PadPocketPicture() {
  const pad = { x: 24.2, w: 16, dx: 5.6, dy: -4 };
  return (
    <>
      <Box x={8} y={28} w={40} h={16} dx={14} dy={-10} />
      <Appear at={0.55}><path className="sage-face-pick" d={boxFaces({ x: 8, y: 28, w: 40, h: 16, dx: 14, dy: -10 })[1]} /></Appear>
      <MorphBox from={{ ...pad, y: 25, h: 0 }} to={{ ...pad, y: 15, h: 10 }} at={0.95} dur={0.8} />
      <Pointer path={[[62, 8], [54, 21]]} moves={[{ at: 0.15, dur: 0.4 }]} presses={[0.55]} />
    </>
  );
}

/** A cut plane goes through; the solid comes apart in two. */
function SplitPicture() {
  return (
    <>
      <Vanish at={1.2}><Box x={10} y={24} w={40} h={20} dx={12} dy={-9} /></Vanish>
      <Appear at={1.2}>
        <Box x={10} y={24} w={20} h={20} dx={12} dy={-9} />
        <Slide from="translate(-8px, 0)" at={1.3} dur={0.5}>
          <Box x={38} y={24} w={20} h={20} dx={12} dy={-9} />
        </Slide>
      </Appear>
      <Flash at={0.5} out={1.2}><path className="sage-sel sage-dash" d="M30 48V20L42 11V39Z" /></Flash>
    </>
  );
}

/** Selected shapes drop so their bottoms line up on a mint guide. */
function AlignPicture() {
  const shapes = [
    { x: 8, y: 30, h: 14, from: "translate(0, -14px)" },
    { x: 29, y: 28, h: 16, from: "none" },
    { x: 50, y: 34, h: 10, from: "translate(0, -20px)" },
  ];
  return (
    <>
      {shapes.map((shape) => (
        <Slide key={shape.x} from={shape.from} at={0.9} dur={0.6}>
          <rect x={shape.x} y={shape.y} width="14" height={shape.h} />
          <Appear at={0.3}><rect className="sage-sel" x={shape.x} y={shape.y} width="14" height={shape.h} /></Appear>
        </Slide>
      ))}
      <Appear at={1.6}><path className="sage-ok" d="M4 48H68" /></Appear>
    </>
  );
}

/** Click the face that moves, then the face it meets; the block drops onto the other. */
function SnapPicture() {
  return (
    <>
      <rect x="32" y="34" width="30" height="12" />
      <Appear at={1.15}><path className="sage-pick" d="M32 34H62" /></Appear>
      <Slide from="translate(-24px, -12px)" at={1.35} dur={0.55}>
        <rect className="sage-solid" x="36" y="20" width="18" height="14" />
        <Appear at={0.6}><path className="sage-pick" d="M36 34H54" /></Appear>
      </Slide>
      <Pointer path={[[6, 40], [22, 24], [49, 35]]} moves={[{ at: 0.2, dur: 0.4 }, { at: 0.8, dur: 0.35 }]} presses={[0.6, 1.15]} />
    </>
  );
}

/** Click a face of a tipped block; it rolls down to rest on that face. */
function LayFlatPicture() {
  return (
    <>
      <path className="sage-guide" d="M4 46H68" />
      <Slide from="rotate(-28deg)" at={1} dur={0.7} origin="22px 46px">
        <rect className="sage-solid" x="22" y="28" width="30" height="18" />
        <Appear at={0.6}><path className="sage-pick" d="M22 46H52" /></Appear>
      </Slide>
      <Pointer path={[[60, 46 - 14], [36, 41], [58, 30]]} moves={[{ at: 0.2, dur: 0.4 }, { at: 1, dur: 0.4 }]} presses={[0.6]} />
    </>
  );
}

/** The selection is copied across the mirror plane. */
function MirrorPicture() {
  return (
    <>
      <path className="sage-guide sage-dash" d="M36 4V52" />
      <path d="M10 42V14H20V32H30V42Z" />
      <Appear at={0.4}><path className="sage-sel" d="M10 42V14H20V32H30V42Z" /></Appear>
      <Grow from="scaleX(-1)" at={0.9} dur={0.7} origin="36px 28px">
        <path d="M62 42V14H52V32H42V42Z" />
      </Grow>
    </>
  );
}

/** Click the center; copies spin around it. */
function CircularPatternPicture() {
  return (
    <>
      <rect x="32" y="8" width="8" height="8" />
      <Appear at={0.3}><rect className="sage-sel" x="32" y="8" width="8" height="8" /></Appear>
      <Point x={36} y={28} at={0.85} />
      <RingCopies cx={36} cy={28} count={6} at={1.2}><rect x="32" y="8" width="8" height="8" /></RingCopies>
      <Pointer path={[[60, 40], [37, 30], [8, 40]]} moves={[{ at: 0.3, dur: 0.5 }, { at: 1.05, dur: 0.4 }]} presses={[0.85]} />
    </>
  );
}

/** Copies of the selected block step out in a row. */
function LinearPatternPicture() {
  return (
    <>
      <Box className="sage-sel" x={6} y={26} w={10} h={10} dx={5} dy={-4} />
      {[22, 38, 54].map((x, index) => (
        <Appear key={x} at={0.8 + index * 0.3}>
          <Slide from="translate(-16px, 0)" at={0.8 + index * 0.3} dur={0.35}>
            <Box x={x} y={26} w={10} h={10} dx={5} dy={-4} />
          </Slide>
        </Appear>
      ))}
    </>
  );
}

/** Click two corners; a measurement appears between them. */
function RulerPicture() {
  return (
    <>
      <Box x={12} y={26} w={36} h={18} dx={12} dy={-9} />
      <Point x={12} y={26} at={0.55} />
      <Point x={48} y={26} at={1.05} />
      <Appear at={1.25}><path className="sage-guide" d="M12 47V53M48 47V53" /></Appear>
      <path className="sage-guide sage-draw" d="M12 50H48" pathLength={1} style={timing(1.3, 0.5)} />
      <Pointer path={[[60, 40], [13, 28], [49, 28]]} moves={[{ at: 0.15, dur: 0.4 }, { at: 0.7, dur: 0.35 }]} presses={[0.55, 1.05]} />
    </>
  );
}

const PICTURES: Record<SagePicture, () => ReactNode> = {
  line: LinePicture,
  arc: ArcPicture,
  curve: CurvePicture,
  rectangle: RectanglePicture,
  circle: CirclePicture,
  select: SelectPicture,
  offset: OffsetPicture,
  "sketch-fillet": SketchFilletPicture,
  "sketch-chamfer": SketchChamferPicture,
  trim: TrimPicture,
  "sketch-mirror": SketchMirrorPicture,
  erase: ErasePicture,
  bend: BendPicture,
  smooth: SmoothPicture,
  "sketch-linear": SketchLinearPicture,
  "sketch-circular": SketchCircularPicture,
  lineweight: LineweightPicture,
  dimension: DimensionPicture,
  extrude: ExtrudePicture,
  revolve: RevolvePicture,
  sweep: SweepPicture,
  coincident: CoincidentPicture,
  horizontal: HorizontalPicture,
  vertical: VerticalPicture,
  equal: EqualPicture,
  parallel: ParallelPicture,
  "right-angle": RightAnglePicture,
  tangent: TangentPicture,
  midpoint: MidpointPicture,
  concentric: ConcentricPicture,
  fix: FixPicture,
  symmetry: SymmetryPicture,
  duplicate: DuplicatePicture,
  "duplicate-repeat": DuplicateRepeatPicture,
  group: GroupPicture,
  ungroup: UngroupPicture,
  tie: TiePicture,
  intersect: IntersectPicture,
  chamfer: ChamferPicture,
  fillet: FilletPicture,
  "push-pull": PushPullPicture,
  "pad-pocket": PadPocketPicture,
  split: SplitPicture,
  align: AlignPicture,
  snap: SnapPicture,
  "lay-flat": LayFlatPicture,
  mirror: MirrorPicture,
  "circular-pattern": CircularPatternPicture,
  "linear-pattern": LinearPatternPicture,
  ruler: RulerPicture,
};

/** The gesture diagram in a Sage card. Plays once each time the card opens. */
export function SagePictureArt({ picture }: { picture: SagePicture }) {
  const Picture = PICTURES[picture];
  return (
    <svg className="sage-card-art" viewBox="0 0 72 56" aria-hidden="true">
      <Picture />
    </svg>
  );
}
