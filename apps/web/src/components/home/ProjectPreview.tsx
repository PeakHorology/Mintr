"use client";

import { useEffect, useState } from "react";
import { loadUiTheme, readAppliedUiTheme, UI_THEME_CHANGED_EVENT, type UiTheme } from "@/lib/uiTheme";
import { STATIC_EXPORT_BUILD } from "@/components/home/dashboardConstants";
import type { DashboardProject } from "@/components/home/dashboardTypes";
import { loadProjectThumbnail, projectThumbnailApiUrl } from "@/components/home/projectThumbnails";

export function ProjectPreview({
  accent,
  projectId,
  thumbnailUrl,
  thumbnailUrlDark,
  thumbnailVersion,
}: {
  accent: DashboardProject["accent"];
  projectId: string;
  thumbnailUrl?: string | null;
  thumbnailUrlDark?: string | null;
  thumbnailVersion?: number;
}) {
  const [uiTheme, setUiTheme] = useState<UiTheme>(() => loadUiTheme());
  const [storedThumbnailUrl, setStoredThumbnailUrl] = useState<string | null>(null);
  const [failedThumbnailUrl, setFailedThumbnailUrl] = useState<string | null>(null);
  const themeThumbnailUrl = uiTheme === "dark"
    ? (thumbnailUrlDark
      ?? (typeof thumbnailUrl === "string" && thumbnailUrl.startsWith("/api/project-thumbnail")
        ? projectThumbnailApiUrl(projectId, thumbnailVersion ?? 0, "dark")
        : thumbnailUrl))
    : thumbnailUrl;
  const resolvedThumbnailUrl = themeThumbnailUrl ?? storedThumbnailUrl;
  const showThumbnail = Boolean(resolvedThumbnailUrl && resolvedThumbnailUrl !== failedThumbnailUrl);
  // Until a true dark capture exists, gently darken the light snapshot on the dashboard.
  const isLightFallback = uiTheme === "dark" && !thumbnailUrlDark;

  useEffect(() => {
    const onThemeChange = () => setUiTheme(readAppliedUiTheme());
    window.addEventListener(UI_THEME_CHANGED_EVENT, onThemeChange);
    return () => window.removeEventListener(UI_THEME_CHANGED_EVENT, onThemeChange);
  }, []);

  useEffect(() => {
    setFailedThumbnailUrl(null);
  }, [resolvedThumbnailUrl]);

  useEffect(() => {
    if (!STATIC_EXPORT_BUILD || themeThumbnailUrl) {
      setStoredThumbnailUrl(null);
      return;
    }
    let canceled = false;
    void loadProjectThumbnail(projectId, uiTheme)
      .then((stored) => {
        if (!canceled) {
          setStoredThumbnailUrl(stored);
        }
      })
      .catch(() => {
        if (!canceled) {
          setStoredThumbnailUrl(null);
        }
      });
    return () => {
      canceled = true;
    };
  }, [projectId, themeThumbnailUrl, thumbnailVersion, uiTheme]);

  return (
    <span className={`project-preview accent-${accent}`} aria-hidden="true">
      {showThumbnail ? (
        <img
          className={`project-thumbnail-image${isLightFallback ? " is-light-fallback" : ""}`}
          src={resolvedThumbnailUrl ?? ""}
          alt=""
          draggable={false}
          onError={() => setFailedThumbnailUrl(resolvedThumbnailUrl ?? null)}
        />
      ) : (
        <span className="preview-grid" />
      )}
    </span>
  );
}
