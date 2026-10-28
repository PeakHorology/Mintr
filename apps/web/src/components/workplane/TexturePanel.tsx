"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bookmark, Check, ImagePlus, LoaderCircle, Type, X } from "lucide-react";
import { EdgeModifierSlider } from "@/components/workplane/EdgeModifierPanel";
import {
  defaultSurfaceTexture,
  normalizeSurfaceTexture,
  SURFACE_TEXTURE_LABELS,
  SURFACE_TEXTURE_LIMITS,
  SURFACE_TEXTURE_PATTERNS,
  MAX_TEXTURE_TEXT_LENGTH,
  type SurfaceTexture,
  type SurfaceTextureFaces,
  type SurfaceTextureImage,
  type SurfaceTexturePattern,
  type SurfaceTextureText,
  type SurfaceTextureWrap,
} from "@/lib/texture/surfaceTexture";
import {
  applySavedTexture,
  removeSavedTexture,
  saveTexture,
  suggestedTextureName,
  useSavedTextures,
} from "@/lib/texture/savedTextures";
import { onSurfaceTextureProgress, onSurfaceTextureReady, surfaceTextureProgress, surfaceTextureState } from "@/lib/texture/texturedShape";
import { fileSizeLabel, textureFileSize, texturePrintAdvice } from "@/lib/texture/texturePrint";
import { textureImageFromFile, textureImageFromText, textureThumbnail } from "@/lib/texture/textureImage";
import { CUSTOM_FONTS_EVENT, DEFAULT_TEXT_FONT, textFontOptions } from "@/lib/textFonts";
import type { WorkplaneShape, WorkplaneWorkspaceSettings } from "@/types/sketchforge";

const GALLERY = SURFACE_TEXTURE_PATTERNS.filter((pattern) => pattern !== "image");

/** Every pattern as a small picture, then tiles for typed text and for your own picture. */
function TextureGallery({
  texture,
  picture,
  onPick,
  onText,
  onPicture,
  onPictureFile,
}: {
  texture: SurfaceTexture;
  /** The last picture chosen, kept while trying other patterns. */
  picture: SurfaceTextureImage | null;
  onPick: (pattern: SurfaceTexturePattern) => void;
  onText: () => void;
  onPicture: (image: SurfaceTextureImage) => void;
  onPictureFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // Pictures are drawn after the panel opens, so it opens at once.
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  useEffect(() => {
    const id = window.setTimeout(() => {
      const next: Record<string, string | null> = {};
      GALLERY.forEach((pattern) => {
        next[pattern] = textureThumbnail(pattern);
      });
      const sample = textureImageFromText("Aa", "Sans");
      next.text = sample ? textureThumbnail("image", sample) : null;
      next.image = picture ? textureThumbnail("image", picture) : null;
      setThumbs(next);
    }, 0);
    return () => window.clearTimeout(id);
  }, [picture]);
  const isText = texture.pattern === "image" && Boolean(texture.image?.text);
  const isPicture = texture.pattern === "image" && !isText;
  const tile = (key: string, active: boolean, label: string, onClick: () => void, picture?: string | null, blankIcon?: ReactNode) => (
    <button
      key={key}
      type="button"
      className={`texture-gallery-tile${active ? " active" : ""}`}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      onPointerMove={(event) => {
        // The light follows the mouse across the tile.
        const box = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--light-x", `${((event.clientX - box.left) / box.width) * 100}%`);
        event.currentTarget.style.setProperty("--light-y", `${((event.clientY - box.top) / box.height) * 100}%`);
      }}
    >
      <span className="texture-gallery-picture">
        {picture ? <img src={picture} alt="" /> : <span className="texture-gallery-blank">{blankIcon ?? <ImagePlus size={18} aria-hidden="true" />}</span>}
      </span>
      <span>{label}</span>
    </button>
  );
  return (
    <div className="shell-openings">
      <span>Pattern</span>
      <div className="texture-gallery">
        {GALLERY.map((pattern) => tile(pattern, texture.pattern === pattern, SURFACE_TEXTURE_LABELS[pattern], () => onPick(pattern), thumbs[pattern]))}
        {tile("text", isText, "Text", onText, thumbs.text, <Type size={18} aria-hidden="true" />)}
        {tile("image", isPicture, picture ? picture.name : "Your picture", () => {
          // A second click on the picture already in use picks a different one.
          if (picture && !isPicture) onPicture(picture);
          else input.current?.click();
        }, thumbs.image)}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPictureFile(file);
        }}
      />
    </div>
  );
}

const FACES: { faces: SurfaceTextureFaces; label: string }[] = [
  { faces: "all", label: "All" },
  { faces: "sides", label: "Walls" },
  { faces: "picked", label: "Choose" },
];

const WRAPS: { wrap: SurfaceTextureWrap; label: string }[] = [
  { wrap: "auto", label: "Auto" },
  { wrap: "around", label: "Around" },
  { wrap: "allRound", label: "All round" },
];

function Choice<T extends string | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="shell-openings">
      <span>{label}</span>
      <div className="shell-opening-row">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className={value === option.value ? "active" : ""}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The same fonts as Text shapes, including any added in Settings; follows changes there. */
function useTextFonts(current: string) {
  const [fonts, setFonts] = useState<string[]>(() => textFontOptions());
  useEffect(() => {
    const sync = () => setFonts(textFontOptions());
    window.addEventListener(CUSTOM_FONTS_EVENT, sync);
    return () => window.removeEventListener(CUSTOM_FONTS_EVENT, sync);
  }, []);
  return fonts.includes(current) ? fonts : [...fonts, current];
}

/** What the background build is doing for the part as it looks now. */
function useTextureStatus(previewShape: WorkplaneShape) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const redraw = () => setVersion((version) => version + 1);
    const stopReady = onSurfaceTextureReady(redraw);
    const stopProgress = onSurfaceTextureProgress(redraw);
    return () => {
      stopReady();
      stopProgress();
    };
  }, []);
  const state = surfaceTextureState(previewShape);
  if (state.status === "pending") {
    const progress = surfaceTextureProgress(state.key);
    return { building: true, progress: progress ?? 0, text: progress === null ? "Getting ready…" : "Building the texture…" };
  }
  if (state.status === "failed") return { building: false, text: "The texture could not be built. Try a larger pattern size.", failed: true };
  if (state.status !== "ready") return null;
  const { stats } = state.result;
  const size = textureFileSize(stats.triangles, normalizeSurfaceTexture(previewShape.surfaceTexture));
  const parts = [`${stats.triangles.toLocaleString()} triangles, ${size.text}`];
  if (stats.repeatsAround) parts.push(`${stats.repeatsAround} around, ${stats.spacingAround?.toFixed(2)} mm each, so it meets without a seam`);
  if (stats.coarser) parts.push("made a little coarser to keep the file small");
  return { building: false, text: parts.join(" · "), spacingAround: stats.spacingAround, sizeFix: size.fix };
}

export function TexturePanel({
  targetName,
  texture,
  previewShape,
  hadTexture,
  workspace,
  onChange,
  onCentreStamp,
  onApply,
  onRemove,
  onCancel,
}: {
  targetName: string;
  texture: SurfaceTexture;
  /** The part with the texture being shown, so the status matches the view. */
  previewShape: WorkplaneShape;
  hadTexture: boolean;
  workspace: WorkplaneWorkspaceSettings;
  onChange: (texture: SurfaceTexture) => void;
  /** Moves a placed picture to the middle of its face. */
  onCentreStamp: () => void;
  onApply: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const status = useTextureStatus(previewShape);
  const [pictureError, setPictureError] = useState<string | null>(null);
  // The last picture and the last words, so trying another pattern does not lose them.
  const [picture, setPicture] = useState<SurfaceTextureImage | null>(texture.image && !texture.image.text ? texture.image : null);
  const [words, setWords] = useState<SurfaceTextureText>(texture.image?.text ?? { value: "Text", font: DEFAULT_TEXT_FONT });
  const fonts = useTextFonts(words.font);
  const set = (patch: Partial<SurfaceTexture>) => onChange(normalizeSurfaceTexture({ ...texture, ...patch }));
  const isText = texture.pattern === "image" && Boolean(texture.image?.text);
  const thing = isText ? "text" : "picture";
  /** Puts a picture or text on, at its own good size the first time. */
  const putImage = (image: SurfaceTextureImage, placement?: SurfaceTexture["placement"]) => {
    const fresh = defaultSurfaceTexture("image");
    const sizes = texture.pattern === "image" ? {} : { spacing: fresh.spacing, depth: fresh.depth, angle: fresh.angle };
    onChange(normalizeSurfaceTexture({ ...texture, ...sizes, ...(placement ? { placement } : {}), pattern: "image", image }));
  };
  const typeWords = (next: SurfaceTextureText, placement?: SurfaceTexture["placement"]) => {
    setWords(next);
    const image = textureImageFromText(next.value, next.font);
    if (image) putImage(image, placement);
  };
  const advice = texturePrintAdvice(
    texture,
    { kind: workspace.printerKind, nozzleMm: workspace.nozzleMm },
    status && "spacingAround" in status && status.spacingAround ? Math.min(texture.spacing, status.spacingAround) : texture.spacing,
  );
  const picked = texture.faces === "picked";
  const once = texture.pattern === "image" && texture.placement === "once";
  const turnable = texture.pattern !== "fuzzy" && (texture.wrap !== "around" || once);
  return (
    <aside className="edge-modifier-panel" aria-label="Texture">
      <div className="edge-modifier-header">
        <div>
          <strong>Texture</strong>
          <span>A printable surface. The part stays exact underneath.</span>
        </div>
        <button type="button" aria-label="Cancel texture" onClick={onCancel}><X size={20} /></button>
      </div>
      <div className="edge-modifier-target">
        <strong>{targetName}</strong>
        <span>Nothing changes until you apply.</span>
      </div>
      <SavedTextures texture={texture} onUse={(saved) => onChange(applySavedTexture(saved, texture))} />
      <TextureGallery
        texture={texture}
        picture={picture}
        onPick={(pattern) => {
          if (pattern === texture.pattern) return;
          // A new pattern starts at its own good size and depth; the other choices carry over.
          const fresh = defaultSurfaceTexture(pattern);
          set({ pattern, spacing: fresh.spacing, depth: fresh.depth, angle: fresh.angle });
        }}
        onText={() => {
          if (isText) return;
          // Words usually go on once, like a label.
          typeWords(words, texture.pattern === "image" ? undefined : "once");
        }}
        onPicture={(image) => putImage(image)}
        onPictureFile={(file) => {
          setPictureError(null);
          textureImageFromFile(file)
            .then((image) => {
              setPicture(image);
              putImage(image);
            })
            .catch(() => setPictureError("Could not read that picture. Try a PNG or JPEG."));
        }}
      />
      {pictureError ? <div className="edge-modifier-error" role="alert">{pictureError}</div> : null}
      {isText ? (
        <div className="shell-openings">
          <span>Words</span>
          <input
            className="texture-text-input"
            type="text"
            value={words.value}
            maxLength={MAX_TEXTURE_TEXT_LENGTH}
            placeholder="Type the words"
            aria-label="Texture text"
            // Typing here should not move or delete the part.
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => typeWords({ ...words, value: event.target.value })}
          />
          {words.value.trim() ? null : <p className="edge-modifier-hint">Type some words to see them on the part.</p>}
        </div>
      ) : null}
      {isText ? (
        <label className="shell-openings">
          <span>Font</span>
          <select
            className="texture-text-input"
            value={words.font}
            onChange={(event) => typeWords({ ...words, font: event.target.value })}
          >
            {fonts.map((font) => <option key={font} value={font}>{font}</option>)}
          </select>
        </label>
      ) : null}
      {texture.pattern === "image" && texture.image ? (
        <Choice
          label={isText ? "Text" : "Picture"}
          value={texture.placement}
          options={[{ value: "tile", label: "Repeat" }, { value: "once", label: "Once" }, { value: "each", label: "Each face" }]}
          onChange={(placement) => set({ placement })}
        />
      ) : null}
      {once ? (
        <p className="edge-modifier-hint">
          {texture.stamp
            ? `Placed. Drag it to move it, or scroll over it to change its size. Pattern angle turns it.`
            : `Move over the part to see where the ${thing} goes, then click.`}
        </p>
      ) : null}
      {texture.pattern === "image" && texture.placement === "each" ? (
        <p className="edge-modifier-hint">
          {`One ${thing} centred on each face that Faces allows below. Faces smaller than half of it are skipped.`}
        </p>
      ) : null}
      {once && texture.stamp ? (
        <button type="button" className="texture-print-fix" onClick={onCentreStamp}>
          Centre on its face
        </button>
      ) : null}
      {texture.pattern === "image" && texture.image && !isText ? (
        <Choice
          label="Higher where the picture is"
          value={texture.image.invert}
          options={[{ value: false, label: "Light" }, { value: true, label: "Dark" }]}
          onChange={(invert) => set({ image: { ...texture.image!, invert } })}
        />
      ) : null}
      <EdgeModifierSlider
        label={texture.pattern === "fuzzy" ? "Grain size" : isText ? "Text width" : texture.pattern === "image" ? "Picture width" : "Pattern size"}
        value={texture.spacing}
        min={SURFACE_TEXTURE_LIMITS.spacing.min}
        max={20}
        step={0.1}
        workspace={workspace}
        length
        onChange={(spacing) => set({ spacing })}
      />
      <EdgeModifierSlider
        label="Depth"
        value={texture.depth}
        min={SURFACE_TEXTURE_LIMITS.depth.min}
        max={3}
        step={0.05}
        workspace={workspace}
        length
        onChange={(depth) => set({ depth })}
      />
      <Choice
        label="Texture goes"
        value={texture.direction}
        options={[{ value: "out", label: "Raised" }, { value: "in", label: "Cut in" }]}
        onChange={(direction) => set({ direction })}
      />
      <Choice
        label="Detail"
        value={texture.detail}
        options={[{ value: "normal", label: "Normal" }, { value: "fine", label: "Fine" }, { value: "finest", label: "Finest" }]}
        onChange={(detail) => set({ detail })}
      />
      {texture.detail !== "normal" ? (
        <p className="edge-modifier-hint">
          {texture.detail === "fine" ? "Sharper, up to 2 million triangles. Builds slower." : "Sharpest, up to 3 million triangles. Builds slowest and makes a big file."}
        </p>
      ) : null}
      {texture.pattern === "fuzzy" || once ? null : (
        <Choice
          label="Wrap"
          value={texture.wrap}
          options={WRAPS.map((entry) => ({ value: entry.wrap, label: entry.label }))}
          onChange={(wrap) => set({ wrap })}
        />
      )}
      {turnable ? (
        <EdgeModifierSlider
          label="Pattern angle"
          value={texture.angle}
          min={SURFACE_TEXTURE_LIMITS.angle.min}
          max={SURFACE_TEXTURE_LIMITS.angle.max}
          step={1}
          unit="°"
          workspace={workspace}
          onChange={(angle) => set({ angle })}
        />
      ) : null}
      {once ? null : (
        <Choice
          label="Faces"
          value={texture.faces}
          options={FACES.map((entry) => ({ value: entry.faces, label: entry.label }))}
          // Sides are chosen by clicking now; clear any whole sides an older file turned on.
          onChange={(faces) => set({ faces, sides: [] })}
        />
      )}
      {picked && !once ? (
        <p className="edge-modifier-hint">
          {texture.picks.length === 0
            ? "Click any side of the part you'd like textured. Click it again to take it off."
            : `${texture.picks.length} ${texture.picks.length === 1 ? "side" : "sides"} chosen. Click another to add it, or click one again to take it off.`}
        </p>
      ) : null}
      <Choice
        label="Smooth bottom"
        value={texture.smoothBottomDeg > 0}
        options={[{ value: true, label: "On" }, { value: false, label: "Off" }]}
        onChange={(on) => set({ smoothBottomDeg: on ? 30 : 0 })}
      />
      <Choice
        label="Smooth holes"
        value={texture.smoothHoles}
        options={[{ value: true, label: "On" }, { value: false, label: "Off" }]}
        onChange={(smoothHoles) => set({ smoothHoles })}
      />
      <Choice
        label="Where it touches a part"
        value={texture.smoothContacts}
        options={[{ value: true, label: "Smooth" }, { value: false, label: "Textured" }]}
        onChange={(smoothContacts) => set({ smoothContacts })}
      />
      {advice.notes.length > 0 ? (
        <div className="texture-print-advice" role="status">
          {advice.notes.map((note) => <div key={note}>{note}</div>)}
          {advice.fix ? (
            <button type="button" className="texture-print-fix" onClick={() => set(advice.fix!)}>
              Fit to my printer
            </button>
          ) : null}
        </div>
      ) : null}
      {status ? (
        status.failed
          ? <div className="edge-modifier-error" role="alert">{status.text}</div>
          : (
            <div role="status">
              <p className="edge-modifier-hint">
                {status.building ? <LoaderCircle className="edge-modifier-spinner" size={14} aria-hidden="true" /> : null}
                {status.text}
              </p>
              {status.building ? (
                <div className="texture-progress" aria-label={`${Math.round((status.progress ?? 0) * 100)}% built`}>
                  <span style={{ transform: `scaleX(${status.progress ?? 0})` }} />
                </div>
              ) : null}
              {"sizeFix" in status && status.sizeFix ? <p className="edge-modifier-hint texture-size-tip">That is a big file. {status.sizeFix}</p> : null}
            </div>
          )
      ) : null}
      <div className="edge-modifier-footer">
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        {hadTexture ? <button type="button" className="secondary" onClick={onRemove}>Remove</button> : null}
        <button type="button" className="primary" onClick={onApply}>
          <Check size={17} />
          Apply
        </button>
      </div>
    </aside>
  );
}

/**
 * For the export panel: how much the textures add to the file, once they are built.
 * Redraws as each one finishes.
 */
export function TextureExportNote({ shapes }: { shapes: readonly WorkplaneShape[] }) {
  const [, setVersion] = useState(0);
  useEffect(() => onSurfaceTextureReady(() => setVersion((version) => version + 1)), []);
  const textured = shapes.filter((shape) => shape.surfaceTexture && !shape.hole);
  if (textured.length === 0) return null;
  let triangles = 0;
  let building = false;
  let fine = false;
  for (const shape of textured) {
    const state = surfaceTextureState(shape);
    if (state.status === "pending") building = true;
    if (state.status === "ready") triangles += state.result.stats.triangles;
    if (normalizeSurfaceTexture(shape.surfaceTexture).detail !== "normal") fine = true;
  }
  if (building) return <p className="export-step-note">Textures are still building. The file size shows when they finish.</p>;
  if (triangles === 0) return null;
  const size = textureFileSize(triangles, { detail: fine ? "fine" : "normal" });
  return (
    <p className={`export-step-note${size.large ? " texture-export-large" : ""}`}>
      Textures add {fileSizeLabel(size.stl)} to an STL, {fileSizeLabel(size.threeMf)} to a 3MF.
      {size.fix ? ` That is a big file. ${size.fix} Change it in Texture.` : ""}
    </p>
  );
}

/** Textures kept for later: one click puts one on, and the current one can be added. */
function SavedTextures({ texture, onUse }: { texture: SurfaceTexture; onUse: (saved: SurfaceTexture) => void }) {
  const saved = useSavedTextures();
  const [naming, setNaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finish = () => {
    if (naming === null) return;
    if (saveTexture(naming, texture)) {
      setNaming(null);
      setError(null);
    } else {
      setError("Could not save it: there is no room left. Remove a saved texture with a picture, then try again.");
    }
  };
  return (
    <div className="shell-openings">
      <span>Saved</span>
      {saved.length > 0 ? (
        <div className="texture-saved-list">
          {saved.map((entry) => (
            <span key={entry.id} className="texture-saved-chip">
              <button type="button" title={`Use ${entry.name}`} onClick={() => onUse(entry.texture)}>{entry.name}</button>
              <button type="button" aria-label={`Remove ${entry.name}`} title="Remove" onClick={() => removeSavedTexture(entry.id)}>
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {naming === null ? (
        <button type="button" className="texture-print-fix" onClick={() => setNaming(suggestedTextureName(texture))}>
          <Bookmark size={13} aria-hidden="true" /> Save this texture
        </button>
      ) : (
        <div className="texture-save-row">
          <input
            className="texture-text-input"
            type="text"
            value={naming}
            maxLength={60}
            aria-label="Name for the saved texture"
            autoFocus
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") finish();
              if (event.key === "Escape") setNaming(null);
            }}
            onChange={(event) => setNaming(event.target.value)}
          />
          <button type="button" className="texture-print-fix" onClick={finish}>Save</button>
        </div>
      )}
      {error ? <div className="edge-modifier-error" role="alert">{error}</div> : null}
    </div>
  );
}
