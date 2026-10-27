"use client";

import { useEffect, useState } from "react";
import { ToolbarFullscreenIcon } from "@/components/icons";
import { PeakTipButton } from "@/components/workplane/ToolNameTooltip";
import { subscribeAppFullscreen, toggleAppFullscreen } from "@/lib/desktopWindow";

export function FullscreenButton({ variant = "toolbar" }: { variant?: "toolbar" | "dashboard" }) {
  const [full, setFull] = useState(false);

  useEffect(() => subscribeAppFullscreen(setFull), []);

  const label = full ? "Exit full screen" : "Full screen";
  const toggle = () => {
    void toggleAppFullscreen().then(setFull).catch(() => setFull(false));
  };

  if (variant === "dashboard") {
    return (
      <button className="dashboard-topbar-settings" type="button" aria-label={label} aria-pressed={full} title={label} onClick={toggle}>
        <ToolbarFullscreenIcon exit={full} width={20} height={20} />
      </button>
    );
  }

  return (
    <PeakTipButton
      className="toolbar-icon"
      label={label}
      description="Fills the screen. Press F11 to leave it."
      shortcut="F11"
      aria-pressed={full}
      onClick={toggle}
    >
      <ToolbarFullscreenIcon exit={full} />
    </PeakTipButton>
  );
}
