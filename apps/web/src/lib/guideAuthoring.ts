import { isGuideAuthorColor, type GuideAuthorColor, type GuideStep } from "@/lib/mintrGuide";

/** Who makes guides on this computer: remembered so the name, colour and picture are set once. */
export type GuideAuthorIdentity = { name: string; color: GuideAuthorColor; avatar?: string };

/** The author's choices for one design's guide, so "Make a guide" reopens where they left off. */
export type GuideDraftMemory = {
  guideId: string;
  title: string;
  summary: string;
  steps: Array<Pick<GuideStep, "historyIndex" | "cue" | "included" | "name" | "tip" | "fold">>;
};

const AUTHOR_KEY = "mintr:guideAuthor";
const DRAFT_PREFIX = "mintr:guideDraft:";

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readGuideAuthor(): GuideAuthorIdentity {
  try {
    const parsed = JSON.parse(store()?.getItem(AUTHOR_KEY) ?? "null") as Partial<GuideAuthorIdentity> | null;
    return {
      name: typeof parsed?.name === "string" ? parsed.name : "",
      color: isGuideAuthorColor(parsed?.color) ? parsed.color : "blue",
      ...(typeof parsed?.avatar === "string" && parsed.avatar.startsWith("data:image/") ? { avatar: parsed.avatar } : {}),
    };
  } catch {
    return { name: "", color: "blue" };
  }
}

export function writeGuideAuthor(identity: GuideAuthorIdentity) {
  try {
    store()?.setItem(AUTHOR_KEY, JSON.stringify(identity));
  } catch {
    // Asked for again next time.
  }
}

export function readGuideDraft(projectId: string): GuideDraftMemory | null {
  try {
    const parsed = JSON.parse(store()?.getItem(`${DRAFT_PREFIX}${projectId}`) ?? "null") as GuideDraftMemory | null;
    return parsed && typeof parsed.guideId === "string" && Array.isArray(parsed.steps) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeGuideDraft(projectId: string, draft: GuideDraftMemory) {
  try {
    store()?.setItem(`${DRAFT_PREFIX}${projectId}`, JSON.stringify(draft));
  } catch {
    // The guide is still saved; only the builder's memory of it is lost.
  }
}

/**
 * Reapply remembered choices to freshly proposed steps. A step matches when it is still the same
 * kind of change at the same point in the history; anything new keeps its proposed defaults.
 */
export function applyGuideDraft(steps: GuideStep[], draft: GuideDraftMemory | null): GuideStep[] {
  if (!draft) return steps;
  const byIndex = new Map(draft.steps.map((step) => [step.historyIndex, step]));
  return steps.map((step) => {
    const saved = byIndex.get(step.historyIndex);
    if (!saved || saved.cue !== step.cue) return step;
    const next: GuideStep = { ...step, included: saved.included };
    if (saved.name) next.name = saved.name;
    if (saved.tip) next.tip = saved.tip;
    if (typeof saved.fold === "boolean") next.fold = saved.fold;
    else delete next.fold;
    return next;
  });
}

/** Shrink a picture to fit a box, as a JPEG data URL. `cover` crops to fill, like a profile picture. */
export function shrinkPicture(source: string, width: number, height: number, mode: "cover" | "contain" = "cover", quality = 0.84): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Could not read that picture."));
        return;
      }
      const scale = mode === "cover"
        ? Math.max(width / image.width, height / image.height)
        : Math.min(width / image.width, height / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    image.onerror = () => reject(new Error("Could not read that picture."));
    image.src = source;
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read that picture.")));
    reader.onerror = () => reject(new Error("Could not read that picture."));
    reader.readAsDataURL(file);
  });
}
