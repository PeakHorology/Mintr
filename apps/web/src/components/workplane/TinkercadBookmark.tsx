"use client";

import { useEffect, useRef, useState } from "react";
import { isDesktopShell } from "@/lib/desktopHardware";
import { tinkercadBookmarkletHref } from "@/lib/tinkercadBookmarklet";

/**
 * "From Tinkercad" in the Import panel: the Send to Mintr bookmark to drag to the bookmarks bar.
 * On the web it opens the design here in a new tab; the desktop app takes it with Ctrl+V.
 */
export function TinkercadBookmark() {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [clicked, setClicked] = useState(false);
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    setDesktop(isDesktopShell());
  }, []);

  // React refuses javascript: addresses in href, so the bookmark's address is set on the element.
  useEffect(() => {
    if (!open || !linkRef.current) return;
    linkRef.current.setAttribute("href", tinkercadBookmarkletHref(desktop ? null : `${window.location.origin}/`));
  }, [desktop, open]);

  if (!open) {
    return (
      <button type="button" className="import-tinkercad-toggle" onClick={() => setOpen(true)}>
        Bring a design over from Tinkercad…
      </button>
    );
  }
  return (
    <div className="import-tinkercad">
      <a
        ref={linkRef}
        className="import-tinkercad-bookmark"
        draggable
        onClick={(event) => {
          event.preventDefault();
          setClicked(true);
        }}
      >
        Send to Mintr
      </a>
      <p>
        {clicked
          ? "Drag the button to your browser's bookmarks bar rather than clicking it here."
          : "Drag this button to your browser's bookmarks bar."}
      </p>
      <p className="export-step-note">
        If it will not drag there,{" "}
        <button
          type="button"
          className="import-tinkercad-copy"
          onClick={() => {
            const href = linkRef.current?.getAttribute("href");
            if (!href) return;
            void navigator.clipboard?.writeText(href).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          {copied ? "copied" : "copy its address"}
        </button>
        , add a new bookmark named Send to Mintr in your browser and paste it in as the address (URL).
      </p>
      <p className="export-step-note">
        {desktop
          ? "Open a design in Tinkercad and click the bookmark. Then press Ctrl+V here, or on Mintr's home screen to make it a new design."
          : "Open a design in Tinkercad and click the bookmark. The design opens here in a new tab, with its shapes, groups, holes and colours."}
      </p>
    </div>
  );
}
