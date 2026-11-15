import type { UiTheme } from "@/lib/uiTheme";
import { PROJECT_THUMBNAILS_STORE_NAME } from "@/lib/projectStoreOps";
import { PROJECT_THUMBNAIL_MAX_SIZE } from "@/components/home/dashboardConstants";
import type { ProjectThumbnailRecord } from "@/components/home/dashboardTypes";
import { openProjectShapesDb } from "@/components/home/projectShapeStore";

export function projectThumbnailApiUrl(projectId: string, version: number, theme: UiTheme = "light") {
  const themeQuery = theme === "dark" ? "&theme=dark" : "";
  return `/api/project-thumbnail?projectId=${encodeURIComponent(projectId)}&v=${version}${themeQuery}`;
}

export async function saveProjectThumbnail(
  projectId: string,
  dataUrl: string,
  version: number,
  dataUrlDark?: string | null,
) {
  const database = await openProjectShapesDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PROJECT_THUMBNAILS_STORE_NAME, "readwrite");
    transaction.objectStore(PROJECT_THUMBNAILS_STORE_NAME).put({
      id: projectId,
      dataUrl,
      dataUrlDark: typeof dataUrlDark === "string" && dataUrlDark.length > 100 ? dataUrlDark : undefined,
      version,
      updatedAt: Date.now(),
    } satisfies ProjectThumbnailRecord);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not save project thumbnail"));
    };
  });
}

// Every dashboard card reads its thumbnail on mount and again on each theme
// toggle. Opening a fresh IndexedDB connection per card made a 60-project
// library open visibly slower, so reads share one long-lived connection. The
// connection yields to upgrades/deletes via `versionchange` and is reopened on
// the next read.
export let thumbnailReadDb: Promise<IDBDatabase> | null = null;

export function thumbnailReadConnection() {
  if (!thumbnailReadDb) {
    const forget = () => {
      if (thumbnailReadDb === opened) thumbnailReadDb = null;
    };
    const opened: Promise<IDBDatabase> = openProjectShapesDb().then((database) => {
      database.onversionchange = () => {
        database.close();
        forget();
      };
      database.onclose = forget;
      return database;
    });
    opened.catch(forget);
    thumbnailReadDb = opened;
  }
  return thumbnailReadDb;
}

export async function loadProjectThumbnail(projectId: string, theme: UiTheme = "light") {
  const database = await thumbnailReadConnection();
  return new Promise<string | null>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(PROJECT_THUMBNAILS_STORE_NAME, "readonly");
    } catch (error) {
      // Connection was closed underneath us; drop it so the next read reopens.
      thumbnailReadDb = null;
      reject(error instanceof Error ? error : new Error("Could not load project thumbnail"));
      return;
    }
    const request = transaction.objectStore(PROJECT_THUMBNAILS_STORE_NAME).get(projectId);
    request.onerror = () => reject(request.error ?? new Error("Could not load project thumbnail"));
    request.onsuccess = () => {
      const record = request.result as ProjectThumbnailRecord | undefined;
      if (theme === "dark" && typeof record?.dataUrlDark === "string") {
        resolve(record.dataUrlDark);
        return;
      }
      resolve(typeof record?.dataUrl === "string" ? record.dataUrl : null);
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Could not load project thumbnail"));
    };
  });
}

export async function deleteProjectThumbnail(projectId: string) {
  const database = await openProjectShapesDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PROJECT_THUMBNAILS_STORE_NAME, "readwrite");
    transaction.objectStore(PROJECT_THUMBNAILS_STORE_NAME).delete(projectId);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not delete project thumbnail"));
    };
  });
}

export async function downscaleThumbnailDataUrl(dataUrl: string, maxSize = PROJECT_THUMBNAIL_MAX_SIZE) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Could not read project thumbnail"));
    element.src = dataUrl;
  });
  // Match dashboard tiles (16:9): cover-crop the capture so the model keeps more pixels,
  // then scale with high-quality smoothing (letterboxing was wasting resolution on bars).
  const width = Math.max(1, Math.round(maxSize));
  const height = Math.max(1, Math.round((maxSize * 9) / 16));
  const targetAspect = width / height;
  const sourceWidth = Math.max(1, image.width);
  const sourceHeight = Math.max(1, image.height);
  const sourceAspect = sourceWidth / sourceHeight;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;
  if (sourceAspect > targetAspect) {
    sw = Math.max(1, Math.round(sourceHeight * targetAspect));
    sx = Math.max(0, Math.round((sourceWidth - sw) / 2));
  } else if (sourceAspect < targetAspect) {
    sh = Math.max(1, Math.round(sourceWidth / targetAspect));
    sy = Math.max(0, Math.round((sourceHeight - sh) / 2));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return dataUrl;
  }
  context.fillStyle = "#eaf8fd";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  // Step down in halves when shrinking a lot — sharper than a single big drawImage.
  let drawSource: CanvasImageSource = image;
  let drawSx = sx;
  let drawSy = sy;
  let drawSw = sw;
  let drawSh = sh;
  while (drawSw > width * 2 && drawSh > height * 2) {
    const nextW = Math.max(width, Math.round(drawSw / 2));
    const nextH = Math.max(height, Math.round(drawSh / 2));
    const next = document.createElement("canvas");
    next.width = nextW;
    next.height = nextH;
    const nextContext = next.getContext("2d");
    if (!nextContext) {
      break;
    }
    nextContext.imageSmoothingEnabled = true;
    nextContext.imageSmoothingQuality = "high";
    nextContext.drawImage(drawSource, drawSx, drawSy, drawSw, drawSh, 0, 0, nextW, nextH);
    drawSource = next;
    drawSx = 0;
    drawSy = 0;
    drawSw = nextW;
    drawSh = nextH;
  }
  context.drawImage(drawSource, drawSx, drawSy, drawSw, drawSh, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

export function isInlineThumbnailUrl(thumbnailUrl: string | null | undefined) {
  return typeof thumbnailUrl === "string" && thumbnailUrl.startsWith("data:");
}
