"use client";

const clayTop = "#f6f1ea";
const claySide = "#d9cbbd";
const clayShade = "#c4b3a2";
const clayInk = "#6a5848";
const clayMark = "#655447";

function NewSketchIcon() {
  return (
    <svg className="sketch-create-menu-icon" viewBox="0 0 48 48" aria-hidden="true">
      <path fill={clayShade} stroke={clayInk} strokeWidth="1.6" strokeLinejoin="round" d="M8 29.2 24 37.2 24 41.4 8 33.4Z" />
      <path fill={claySide} stroke={clayInk} strokeWidth="1.6" strokeLinejoin="round" d="M40 29.2 24 37.2 24 41.4 40 33.4Z" />
      <path fill={clayTop} stroke={clayInk} strokeWidth="1.6" strokeLinejoin="round" d="M8 29.2 24 21.2 40 29.2 24 37.2Z" />
      <path fill="none" stroke={clayMark} strokeWidth="2.2" strokeLinecap="round" d="M24 17.4V8.2" />
      <path fill="none" stroke={clayMark} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="m19.2 12.6 4.8-4.8 4.8 4.8" />
    </svg>
  );
}

function EditSketchIcon() {
  return (
    <svg className="sketch-create-menu-icon" viewBox="0 0 48 48" aria-hidden="true">
      <path fill={clayShade} stroke={clayInk} strokeWidth="1.6" strokeLinejoin="round" d="M6 32.4 19.5 39.2 19.5 42.8 6 36Z" />
      <path fill={claySide} stroke={clayInk} strokeWidth="1.6" strokeLinejoin="round" d="M33 32.4 19.5 39.2 19.5 42.8 33 36Z" />
      <path fill={clayTop} stroke={clayInk} strokeWidth="1.6" strokeLinejoin="round" d="M6 32.4 19.5 25.6 33 32.4 19.5 39.2Z" />
      <path fill="none" stroke={clayMark} strokeWidth="1.5" strokeLinejoin="round" d="m12.4 33.2 4.4-2.2 4.4 2.2-4.4 2.2Z" />
      <path fill={clayTop} stroke={clayInk} strokeWidth="1.6" strokeLinejoin="round" d="M29.2 7.2 36.6 14.6 25.2 26 17.8 18.6Z" />
      <path fill={claySide} stroke={clayInk} strokeWidth="1.6" strokeLinejoin="round" d="M17.8 18.6 25.2 26 22.2 29 14.8 21.6Z" />
      <path fill="none" stroke={clayMark} strokeWidth="1.4" strokeLinecap="round" d="m26.6 9.8 7.2 7.2" />
    </svg>
  );
}

/** Floating menu under the Sketch mode tab when not actively sketching. */
export function SketchCreateMenu({
  canEditSketch,
  onNewSketch,
  onEditSketch,
}: {
  canEditSketch: boolean;
  onNewSketch: () => void;
  onEditSketch: () => void;
}) {
  return (
    <div className="sketch-create-menu" role="menu" aria-label="Sketch options">
      <button className="sketch-create-menu-item primary" type="button" role="menuitem" onClick={onNewSketch}>
        <NewSketchIcon />
        <span>New sketch</span>
      </button>
      <button
        className="sketch-create-menu-item"
        type="button"
        role="menuitem"
        onClick={onEditSketch}
        disabled={!canEditSketch}
      >
        <EditSketchIcon />
        <span>Edit sketch</span>
      </button>
    </div>
  );
}
