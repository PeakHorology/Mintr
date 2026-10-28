"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  addCustomFont,
  CUSTOM_FONTS_EVENT,
  readCustomFonts,
  removeCustomFont,
  TEXT_FONT_OPTIONS,
  type CustomTextFont,
} from "@/lib/textFonts";
import { fontPreviewUrl } from "@/lib/texture/textureImage";

/** One font with a sample of its letters. */
function FontRow({ name, detail, onRemove }: { name: string; detail?: string; onRemove?: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    // Drawn after the list shows, so Settings opens at once.
    const id = window.setTimeout(() => setPreview(fontPreviewUrl(name)), 0);
    return () => window.clearTimeout(id);
  }, [name]);
  return (
    <li className="font-settings-row">
      <div className="font-settings-name">
        <strong>{name}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      {preview ? <img className="font-settings-preview" src={preview} alt="" /> : <span className="font-settings-preview" />}
      {onRemove ? (
        <button type="button" className="font-settings-remove" aria-label={`Remove ${name}`} title="Remove" onClick={onRemove}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

/**
 * Settings → Fonts: the fonts Text shapes and text textures can use, and adding
 * your own from a font file.
 */
export function FontSettings() {
  const input = useRef<HTMLInputElement>(null);
  const [fonts, setFonts] = useState<CustomTextFont[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setFonts(readCustomFonts());
    sync();
    window.addEventListener(CUSTOM_FONTS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CUSTOM_FONTS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return (
    <>
      <div className="workspace-section-heading">
        <strong>Fonts</strong>
        <span>The fonts for Text shapes and for text textures. Add your own from a font file.</span>
      </div>
      <div className="font-settings-add">
        <button type="button" className="make-default-button" disabled={busy} onClick={() => input.current?.click()}>
          <Plus size={15} aria-hidden="true" />
          {busy ? "Reading the font…" : "Add a font"}
        </button>
        <span>TTF, OTF or WOFF files. A design that uses one of your fonts carries it, so it looks the same on any computer.</span>
        <input
          ref={input}
          type="file"
          accept=".ttf,.otf,.woff,font/ttf,font/otf,font/woff"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setBusy(true);
            setNotice(null);
            void addCustomFont(file)
              .then((result) => setNotice("error" in result ? result.error : `Added ${result.name}. Choose it as the font of a Text shape or a text texture.`))
              .finally(() => setBusy(false));
          }}
        />
      </div>
      {notice ? <p className="workspace-hotkey-notice">{notice}</p> : null}
      <div className="font-settings-group">
        <strong>Your fonts</strong>
        {fonts.length === 0 ? (
          <p>None yet. Fonts that come inside a design you open are added here too.</p>
        ) : (
          <ul className="font-settings-list">
            {fonts.map((font) => (
              confirmRemove === font.id ? (
                <li key={font.id} className="font-settings-row font-settings-confirm">
                  <span>Remove {font.name}? Text that uses it changes to the standard font.</span>
                  <button type="button" className="workspace-file-transition-cancel" onClick={() => setConfirmRemove(null)}>Keep</button>
                  <button
                    type="button"
                    className="make-default-button"
                    onClick={() => {
                      removeCustomFont(font.id);
                      setConfirmRemove(null);
                    }}
                  >
                    Remove
                  </button>
                </li>
              ) : (
                <FontRow key={font.id} name={font.name} detail={font.fileName} onRemove={() => setConfirmRemove(font.id)} />
              )
            ))}
          </ul>
        )}
      </div>
      <div className="font-settings-group">
        <strong>Built into Mintr</strong>
        <ul className="font-settings-list">
          {TEXT_FONT_OPTIONS.map((name) => <FontRow key={name} name={name} />)}
        </ul>
      </div>
    </>
  );
}
