import { describe, expect, it } from "vitest";
import { themeRevealRadius, themeTransitionKind, themeWipeDirection } from "@/lib/uiTheme";

describe("theme transition", () => {
  it("grows dark out of the control and shrinks it back for light", () => {
    expect(themeWipeDirection("dark")).toBe("expand");
    expect(themeWipeDirection("light")).toBe("contract");
  });

  it("skips when the theme is already applied", () => {
    expect(themeTransitionKind("dark", "dark", { reducedMotion: false, canViewTransition: true })).toBe("skip");
  });

  it("applies instantly when motion is reduced or the browser cannot wipe", () => {
    expect(themeTransitionKind("light", "dark", { reducedMotion: true, canViewTransition: true })).toBe("instant");
    expect(themeTransitionKind("light", "dark", { reducedMotion: false, canViewTransition: false })).toBe("instant");
  });

  it("uses a view transition when the browser can wipe and motion is allowed", () => {
    expect(themeTransitionKind("light", "dark", { reducedMotion: false, canViewTransition: true })).toBe("view-transition");
  });

  it("sizes the reveal circle so it covers the window from the control", () => {
    expect(themeRevealRadius({ x: 100, y: 80 }, 400, 300)).toBeCloseTo(Math.hypot(300, 220));
    expect(themeRevealRadius({ x: 200, y: 150 }, 400, 300)).toBeCloseTo(Math.hypot(200, 150));
  });
});
