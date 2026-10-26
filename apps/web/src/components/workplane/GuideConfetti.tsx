"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#2aa77e", "#c6a15b", "#efebe8", "#655447", "#7dceae"];
const PIECE_COUNT = 120;
const CONFETTI_MS = 10500;

const PIECES = Array.from({ length: PIECE_COUNT }, (_, index) => {
  const wave = index % 4;
  const column = index % 20;
  return {
    left: `${1.5 + column * 4.8 + wave * 0.6}%`,
    delay: `${(wave * 0.55 + (index % 6) * 0.08).toFixed(2)}s`,
    duration: `${(5.6 + (index % 8) * 0.2).toFixed(2)}s`,
    color: COLORS[index % COLORS.length],
    width: 8 + (index % 4) * 3,
    height: index % 3 === 0 ? 8 + (index % 3) * 3 : 12 + (index % 4) * 4,
    round: index % 3 === 0,
  };
});

export function GuideConfetti({ onDone }: { onDone: () => void }) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const timer = window.setTimeout(() => onDoneRef.current(), CONFETTI_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <>
      <div className="guide-confetti" aria-hidden="true">
        {PIECES.map((piece, index) => (
          <span
            key={index}
            className={piece.round ? "is-round" : undefined}
            style={{
              left: piece.left,
              width: piece.width,
              height: piece.height,
              background: piece.color,
              animationDelay: piece.delay,
              animationDuration: piece.duration,
            }}
          />
        ))}
      </div>
      <div className="guide-complete" role="status" aria-label="Guide completed">
        <div className="guide-complete-card">
          <span className="guide-complete-check" aria-hidden="true">
            <svg viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="23" />
              <path d="M15 27.5 L22.5 35 L37.5 18" />
            </svg>
          </span>
          <strong>Guide completed</strong>
        </div>
      </div>
    </>
  );
}
