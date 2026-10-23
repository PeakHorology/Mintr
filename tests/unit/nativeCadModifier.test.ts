import { afterEach, describe, expect, it, vi } from "vitest";
import { mapNativeCadModifierReply, nativeCadModifierCanHandle } from "@/lib/nativeCadModifier";

describe("native CAD modifier adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a native ready reply onto the worker message shape", () => {
    const message = mapNativeCadModifierReply({
      ok: true,
      type: "ready",
      edges: [{ id: 0, points: [0, 0, 0, 1, 0, 0], display: true, selectable: true, angle: 90, boundary: false, manifold: true }],
      selectableEdgeIds: [0],
      sourceType: "solid",
    }, 7);
    expect(message).toMatchObject({ type: "ready", requestId: 7, selectableEdgeIds: [0], sourceType: "solid" });
    if (message.type !== "ready") throw new Error("expected ready");
    expect(message.edges[0]?.angle).toBe(90);
  });

  it("routes exact fillet prepare, hollow, and thread natively once a session is live", () => {
    vi.stubGlobal("window", { peakcadKernel: { request: vi.fn() } });
    expect(nativeCadModifierCanHandle({
      type: "prepare",
      parts: [{ primitive: { kind: "box", width: 20, depth: 20, height: 20 }, hole: false }],
      sharpAngle: 12,
    }, false)).toBe(true);
    expect(nativeCadModifierCanHandle({
      type: "hollow",
      thickness: 2,
      openings: ["top"],
      corners: "sharp",
      cornerRadius: 1,
      quality: "standard",
    }, true)).toBe(true);
    expect(nativeCadModifierCanHandle({
      type: "previewThread",
      faceId: 0,
      majorDiameter: 8,
      pitch: 1.25,
      length: 12,
      depth: 0.7,
      side: "external",
      handedness: "right",
      quality: "standard",
    }, true)).toBe(true);
    expect(nativeCadModifierCanHandle({
      type: "preview",
      kind: "fillet",
      edgeIds: [0],
      amount: 1,
      quality: "standard",
      chamferAngle: 45,
    }, false)).toBe(false);
    expect(nativeCadModifierCanHandle({
      type: "pushPull",
      faceId: 0,
      distance: 4,
      quality: "standard",
    }, true)).toBe(true);
  });

  it("rewrites a native fillet failure into what to try", () => {
    const message = mapNativeCadModifierReply({
      ok: false,
      type: "error",
      message: "native fillet could not rebuild this solid",
    }, 3);
    expect(message).toMatchObject({ type: "error", requestId: 3 });
    if (message.type !== "error") throw new Error("expected error");
    expect(message.message).toMatch(/Group it first|smaller fillet/i);
  });
});
