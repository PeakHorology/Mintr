"use client";

import type { GuideAuthorColor } from "@/lib/mintrGuide";

/**
 * Who made a guide. Mintr's own guides carry the Mintr logo and mint; everyone else shows their
 * picture (or their initial) and their name on the colour they picked.
 */
export function GuideAuthorBadge({
  author,
  color,
  avatar,
  official = false,
  size = "md",
}: {
  author: string;
  color?: GuideAuthorColor;
  avatar?: string;
  official?: boolean;
  size?: "sm" | "md";
}) {
  const tone = official ? "mint" : color ?? "blue";
  const name = official ? "Mintr" : author.trim() || "Someone";
  return (
    <span className={`guide-author guide-author-${size} guide-author-${tone}`}>
      <span className="guide-author-picture" aria-hidden="true">
        {official ? (
          <img src="assets/mintr/mintr-square.png" alt="" />
        ) : avatar ? (
          <img src={avatar} alt="" />
        ) : (
          <span>{name.charAt(0).toUpperCase()}</span>
        )}
      </span>
      <span className="guide-author-name">{official ? "Mintr guide" : `By ${name}`}</span>
    </span>
  );
}
