"use client";

import { useRef, type InputHTMLAttributes, type KeyboardEvent, type PointerEvent } from "react";
import { pointerHitsRangeThumb } from "@/lib/rangeThumb";

const KEYBOARD_NUDGE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

type ThumbRangeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "value"> & {
  value: number;
  onValueChange: (value: number) => void;
  onDragActiveChange?: (active: boolean) => void;
};

export function ThumbRangeInput({
  value,
  onValueChange,
  onDragActiveChange,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
  ...rest
}: ThumbRangeInputProps) {
  const thumbDrag = useRef(false);
  const keyboardNudge = useRef(false);

  const endDrag = () => {
    if (!thumbDrag.current) return;
    queueMicrotask(() => {
      thumbDrag.current = false;
    });
    onDragActiveChange?.(false);
  };

  return (
    <input
      {...rest}
      type="range"
      value={value}
      onPointerDown={(event: PointerEvent<HTMLInputElement>) => {
        const hit = pointerHitsRangeThumb(event.currentTarget, event.clientX, event.clientY);
        thumbDrag.current = hit;
        if (!hit) {
          event.preventDefault();
          return;
        }
        onPointerDown?.(event);
        onDragActiveChange?.(true);
      }}
      onPointerUp={(event: PointerEvent<HTMLInputElement>) => {
        onPointerUp?.(event);
        endDrag();
      }}
      onPointerCancel={(event: PointerEvent<HTMLInputElement>) => {
        onPointerCancel?.(event);
        endDrag();
      }}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (KEYBOARD_NUDGE_KEYS.has(event.key)) keyboardNudge.current = true;
        onKeyDown?.(event);
      }}
      onChange={(event) => {
        if (!thumbDrag.current && !keyboardNudge.current) return;
        keyboardNudge.current = false;
        onValueChange(Number(event.currentTarget.value));
      }}
    />
  );
}
