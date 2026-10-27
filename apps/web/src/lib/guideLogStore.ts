import type { GuideLog } from "@/lib/guideLog";

/**
 * Each design's guide log, kept on this computer so a long design still has its early steps the
 * next time it is opened. Optional: if the store is unavailable, guides use the undo history.
 */
const DB_NAME = "mintr-guide-log";
const STORE = "logs";
const SAVE_DELAY_MS = 1500;

let opening: Promise<IDBDatabase> | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function database(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("No local store"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the guide log"));
  });
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

export async function loadGuideLog(projectId: string): Promise<GuideLog | null> {
  try {
    const db = await database();
    return await new Promise((resolve) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(projectId);
      request.onsuccess = () => {
        const value = request.result as GuideLog | undefined;
        resolve(value && Array.isArray(value.entries) && typeof value.offset === "number" ? value : null);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Saves a moment after the last change, so dragging and typing do not write on every frame. */
export function saveGuideLogSoon(projectId: string, log: GuideLog) {
  const pending = timers.get(projectId);
  if (pending) clearTimeout(pending);
  timers.set(projectId, setTimeout(() => {
    timers.delete(projectId);
    void database().then((db) => {
      db.transaction(STORE, "readwrite").objectStore(STORE).put(log, projectId);
    }).catch(() => {
      // Not kept this time; the undo history still has the recent steps.
    });
  }, SAVE_DELAY_MS));
}
