import { hardwareProfile } from "@/lib/desktopHardware";
import type { DashboardProject } from "@/components/home/dashboardTypes";

export const PROJECTS_STORAGE_KEY = "sketchForge.projects";
export const FOLDERS_STORAGE_KEY = "sketchForge.folders";
export const PROJECT_FOLDER_MAP_KEY = "sketchForge.projectFolderMap";
export const DASHBOARD_ORDER_KEY = "sketchForge.dashboardOrder";
export const PROJECT_DRAG_MIME = "application/x-peakcad-project-id";
export const ARRANGE_DRAG_MIME = "application/x-peakcad-arrange";
export const PROJECT_THUMBNAIL_MAX_SIZE = hardwareProfile().thumbnailSize;
export const PROJECT_ACCENTS: DashboardProject["accent"][] = ["cyan", "green", "gold", "red"];
export const STATIC_EXPORT_BUILD = process.env.NEXT_PUBLIC_STATIC_EXPORT === "true";
export const WEB_STORAGE_NOTE_KEY = "mintr.webStorageNoteShown";
export const RECENT_PROJECT_COUNT = 4;
export const FOLDER_PUSH_MS = 260;
export const EDITOR_FADE_MS = 160;

/** How long the .mintr file waits after the last edit before it is rewritten. */
export const PROJECT_FILE_WRITE_DELAY_MS = 4000;
