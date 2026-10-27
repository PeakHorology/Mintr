"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SagePictureArt } from "@/components/workplane/SagePictures";
import { lookupSageGuide, sageShortcut, type SageGuide } from "@/lib/sageGuides";

type SageContextValue = {
  active: boolean;
  toggle: () => void;
};

const SageContext = createContext<SageContextValue>({
  active: false,
  toggle: () => {},
});

export function useSageActive() {
  return useContext(SageContext).active;
}

export function useSageToggle() {
  return useContext(SageContext).toggle;
}

export function SageProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  return (
    <SageContext.Provider value={{ active, toggle: () => setActive((on) => !on) }}>
      {children}
      {active ? <SageHoverCard /> : null}
    </SageContext.Provider>
  );
}

type HoverTarget = {
  guide: SageGuide;
  title: string;
  shortcut?: string;
  rect: { left: number; top: number; width: number; height: number };
};

function SageHoverCard() {
  const [target, setTarget] = useState<HoverTarget | null>(null);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;

    const show = (button: HTMLElement) => {
      const key = button.getAttribute("data-sage-key") || buttonName(button);
      const guide = lookupSageGuide(key);
      if (!guide) {
        current = null;
        setTarget(null);
        return;
      }
      const rect = button.getBoundingClientRect();
      setTarget({
        guide,
        title: buttonName(button) || guide.title,
        shortcut: sageShortcut(guide, button.getAttribute("data-tool-shortcut")),
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      });
    };

    const onOver = (event: Event) => {
      const button = eventTargetButton(event);
      if (!button || button === current) return;
      window.clearTimeout(timer);
      current = button;
      timer = window.setTimeout(() => {
        if (current === button) show(button);
      }, 180);
    };

    const onOut = (event: PointerEvent) => {
      const button = eventTargetButton(event);
      if (!button || button !== current) return;
      const next = event.relatedTarget;
      if (next instanceof Node && button.contains(next)) return;
      window.clearTimeout(timer);
      current = null;
      setTarget(null);
    };

    const clear = () => {
      window.clearTimeout(timer);
      current = null;
      setTarget(null);
    };

    const onMenu = () => clear();

    const onMove = () => {
      if (current && !current.isConnected) clear();
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("contextmenu", onMenu);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("contextmenu", onMenu);
    };
  }, []);

  if (!target || typeof document === "undefined") return null;
  const width = 320;
  const left = Math.max(12, Math.min(target.rect.left, window.innerWidth - width - 12));
  const below = target.rect.top + target.rect.height + 8;
  const top = below + 180 > window.innerHeight ? Math.max(12, target.rect.top - 8) : below;
  const placeAbove = top < target.rect.top;

  return createPortal(
    <div
      className={`sage-card${target.guide.picture ? " has-art" : ""}`}
      role="tooltip"
      style={{
        left,
        top: placeAbove ? undefined : top,
        bottom: placeAbove ? window.innerHeight - target.rect.top + 8 : undefined,
        width,
      }}
    >
      {target.guide.picture ? <SagePictureArt key={target.guide.picture} picture={target.guide.picture} /> : null}
      <div className="sage-card-copy">
        <strong>{target.title}</strong>
        {target.shortcut ? <span className="sage-card-shortcut">{target.shortcut}</span> : null}
        <p>{target.guide.what}</p>
        <ol>
          {target.guide.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </div>
    </div>,
    document.body,
  );
}

function buttonName(button: HTMLElement) {
  const named = button.getAttribute("data-sage-label") || button.getAttribute("aria-label");
  if (named?.trim()) return named.trim();
  const text = (button.innerText || "").replace(/\s+/g, " ").trim();
  return text.length > 0 && text.length < 40 ? text : "";
}

function eventTargetButton(event: Event) {
  const node = event.target;
  if (!(node instanceof Element)) return null;
  const button = node.closest("button");
  if (!(button instanceof HTMLElement)) return null;
  if (!button.closest(".peakcad-editor")) return null;
  if (button.closest(".sage-card, .top-action-panel, .modal, .value-dialog, .inline-value-dialog")) return null;
  return button;
}
