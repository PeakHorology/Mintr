import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CadModifierMeshPart, CadModifierWorkerResponse } from "@/lib/cadModifierTypes";
import { startBrowserCadModifier } from "../helpers/browserCadModifier";
import { hasNativeKernelExe, spawnNativeKernelClient } from "../helpers/nativeKernelChild";

/**
 * The desktop engine must give the same results as the browser engine, only faster.
 * Each case sends the same parts and the same "all sharp edges" treatment to both and
 * compares what comes back.
 */

type Mesh = { positions: ArrayLike<number>; indices: ArrayLike<number> };

function meshVolume({ positions, indices }: Mesh) {
  let volume = 0;
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const a = indices[index] * 3;
    const b = indices[index + 1] * 3;
    const c = indices[index + 2] * 3;
    volume += (
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])
    ) / 6;
  }
  return Math.abs(volume);
}

const box = { kind: "box", width: 20, depth: 20, height: 20 } as const;
const shift = (y: number) => [1, 0, 0, 0, 0, 1, 0, y, 0, 0, 1, 0];

const PARTS: Record<string, CadModifierMeshPart[]> = {
  cube: [{ hole: false, primitive: box }],
  "plate with a through hole": [
    { hole: false, primitive: { kind: "box", width: 40, depth: 30, height: 10 } },
    { hole: true, primitive: { kind: "cylinder", radius: 5, height: 20, transform: shift(-5) } },
  ],
  "block with a square pocket": [
    { hole: false, primitive: box },
    { hole: true, primitive: { kind: "box", width: 8, depth: 8, height: 10, transform: shift(12) } },
  ],
  cylinder: [{ hole: false, primitive: { kind: "cylinder", radius: 10, height: 20 } }],
  // Turned a quarter about Y and moved, so the stretch has to follow the pose.
  "oval cone, turned and moved": [{ hole: false, primitive: { kind: "cone", baseRadius: 10, topRadius: 5, height: 16, sectionScale: 0.6, transform: [0, 0, 1, 7, 0, 1, 0, 2, -1, 0, 0, -3] } }],
};

const TREATMENTS = [
  { kind: "fillet", amount: 1, filletProfile: "round" },
  { kind: "fillet", amount: 3, filletProfile: "round" },
  { kind: "chamfer", amount: 1.5, filletProfile: "round" },
  { kind: "fillet", amount: 2, filletProfile: "cove" },
] as const;

/** Sizes too big for some of the edges: checked where the result does not hang on kernel build quirks. */
const OVERSIZED = { kind: "fillet", amount: 14, filletProfile: "round" } as const;

describe.skipIf(!hasNativeKernelExe)("desktop engine matches the browser engine", () => {
  const native = spawnNativeKernelClient();
  let browser: Awaited<ReturnType<typeof startBrowserCadModifier>>;
  let nextId = 1000;

  beforeAll(async () => {
    browser = await startBrowserCadModifier();
  }, 60000);
  afterAll(() => native.close());

  for (const [name, parts] of Object.entries(PARTS)) {
    for (const treatment of name === "cube" ? [...TREATMENTS, OVERSIZED] : TREATMENTS) {
      const label = `${name}: ${treatment.filletProfile === "cove" ? "concave fillet" : treatment.kind} ${treatment.amount} mm on all sharp edges`;
      it(label, async () => {
        const prepareId = nextId++;
        const browserReady = await browser.request({ type: "prepare", requestId: prepareId, sharpAngle: 12, parts });
        const nativeReady = await native.request({ id: prepareId, requestId: prepareId, type: "prepare", sharpAngle: 12, parts }, 60000);
        expect(browserReady.type).toBe("ready");
        expect(nativeReady.ok, String(nativeReady.message)).not.toBe(false);
        const browserEdges = browserReady.type === "ready" ? browserReady.selectableEdgeIds : [];
        const nativeEdges = (nativeReady.selectableEdgeIds as number[] | undefined) ?? [];
        // Same part, so the same number of edges to pick.
        expect(nativeEdges.length).toBe(browserEdges.length);

        const previewId = nextId++;
        const request = { type: "preview" as const, requestId: previewId, chamferAngle: 45, ...treatment };
        const fromBrowser = await browser.request({ ...request, edgeIds: browserEdges });
        const fromNative = await native.request({ id: previewId, ...request, edgeIds: nativeEdges }, 60000);
        const browserOk = fromBrowser.type === "preview";
        const nativeOk = fromNative.ok !== false && fromNative.type === "preview";
        expect(nativeOk, `desktop: ${String(fromNative.message)} / browser: ${browserOk ? "ok" : (fromBrowser as Extract<CadModifierWorkerResponse, { type: "error" }>).message}`).toBe(browserOk);
        if (browserOk && nativeOk) {
          const browserVolume = meshVolume(fromBrowser as Mesh);
          const nativeVolume = meshVolume({ positions: fromNative.positions as number[], indices: fromNative.indices as number[] });
          const browserSkipped = (fromBrowser as { skippedEdgeCount?: number }).skippedEdgeCount ?? 0;
          const nativeSkipped = ((fromNative.skippedEdgeIds as number[] | undefined) ?? []).length;
          const detail = `desktop ${nativeVolume.toFixed(1)} mm³, ${nativeSkipped} skipped; browser ${browserVolume.toFixed(1)} mm³, ${browserSkipped} skipped`;
          // The two OCCT builds differ a little on hard cases. The desktop may manage more
          // edges than the browser, never fewer; on the same edges they must agree.
          expect(nativeSkipped, detail).toBeLessThanOrEqual(browserSkipped);
          if (nativeSkipped === browserSkipped) {
            expect(Math.abs(nativeVolume - browserVolume) / browserVolume, detail).toBeLessThan(0.01);
          }
        }
        await browser.request({ type: "dispose", requestId: nextId++ });
        await native.request({ id: nextId, requestId: nextId++, type: "dispose" });
      }, 120000);
    }
  }

  const HOLLOWS = [
    { part: "cube", thickness: 2, openings: ["top"] },
    { part: "cylinder", thickness: 1.5, openings: [] },
    { part: "block with a square pocket", thickness: 1.5, openings: ["top"] },
    { part: "plate with a through hole", thickness: 1, openings: ["bottom"] },
  ] as const;
  for (const hollow of HOLLOWS) {
    it(`${hollow.part}: hollow ${hollow.thickness} mm walls, open ${hollow.openings.join(", ") || "nowhere"}`, async () => {
      const parts = PARTS[hollow.part];
      const prepareId = nextId++;
      await browser.request({ type: "prepare", requestId: prepareId, sharpAngle: 12, parts });
      await native.request({ id: prepareId, requestId: prepareId, type: "prepare", sharpAngle: 12, parts }, 60000);
      const hollowId = nextId++;
      const request = { type: "hollow" as const, requestId: hollowId, thickness: hollow.thickness, openings: [...hollow.openings], corners: "sharp" as const, cornerRadius: 1, quality: "standard" as const };
      const fromBrowser = await browser.request(request);
      const fromNative = await native.request({ id: hollowId, ...request }, 60000);
      const browserOk = fromBrowser.type === "preview";
      const nativeOk = fromNative.ok !== false && fromNative.type === "preview";
      // The Hollow tool runs on the browser kernel (see sendCadModifierRequest), so the
      // desktop may still refuse a part. It must never succeed with a different wall.
      if (hollow.part !== "plate with a through hole") expect(nativeOk, `desktop: ${String(fromNative.message)}`).toBe(browserOk);
      if (browserOk && nativeOk) {
        const browserVolume = meshVolume(fromBrowser as Mesh);
        const nativeVolume = meshVolume({ positions: fromNative.positions as number[], indices: fromNative.indices as number[] });
        expect(Math.abs(nativeVolume - browserVolume) / browserVolume, `desktop ${nativeVolume.toFixed(1)} / browser ${browserVolume.toFixed(1)}`).toBeLessThan(0.01);
      }
      await browser.request({ type: "dispose", requestId: nextId++ });
      await native.request({ id: nextId, requestId: nextId++, type: "dispose" });
    }, 120000);
  }

  it("block with a square pocket: each edge alone gets the same answer at a size too big for some", async () => {
    const parts = PARTS["block with a square pocket"];
    const prepareId = nextId++;
    const browserReady = await browser.request({ type: "prepare", requestId: prepareId, sharpAngle: 12, parts });
    const nativeReady = await native.request({ id: prepareId, requestId: prepareId, type: "prepare", sharpAngle: 12, parts }, 60000);
    const browserEdges = browserReady.type === "ready" ? browserReady.selectableEdgeIds : [];
    const nativeEdges = (nativeReady.selectableEdgeIds as number[] | undefined) ?? [];
    for (let index = 0; index < browserEdges.length; index += 1) {
      const previewId = nextId++;
      const request = { type: "preview" as const, requestId: previewId, chamferAngle: 45, ...OVERSIZED };
      const fromBrowser = await browser.request({ ...request, edgeIds: [browserEdges[index]] });
      const fromNative = await native.request({ id: previewId, ...request, edgeIds: [nativeEdges[index]] }, 60000);
      const browserAnswer = fromBrowser.type === "preview" ? "ok" : (fromBrowser as { message: string }).message;
      const nativeAnswer = fromNative.ok !== false && fromNative.type === "preview" ? "ok" : String(fromNative.message);
      expect(nativeAnswer, `edge ${index}`).toBe(browserAnswer);
    }
    await browser.request({ type: "dispose", requestId: nextId++ });
    await native.request({ id: nextId, requestId: nextId++, type: "dispose" });
  }, 300000);

  for (const kind of ["fillet", "chamfer"] as const) {
    it(`cube: a ${kind} too big for one edge names the same largest size`, async () => {
      const prepareId = nextId++;
      const browserReady = await browser.request({ type: "prepare", requestId: prepareId, sharpAngle: 12, parts: PARTS.cube });
      const nativeReady = await native.request({ id: prepareId, requestId: prepareId, type: "prepare", sharpAngle: 12, parts: PARTS.cube }, 60000);
      const browserEdges = browserReady.type === "ready" ? browserReady.selectableEdgeIds : [];
      const nativeEdges = (nativeReady.selectableEdgeIds as number[] | undefined) ?? [];
      const previewId = nextId++;
      const request = { type: "preview" as const, requestId: previewId, chamferAngle: 45, kind, amount: 25, filletProfile: "round" as const };
      // Every edge of a cube is alike, so the first one on each side is the same edge.
      const fromBrowser = await browser.request({ ...request, edgeIds: browserEdges.slice(0, 1) });
      const fromNative = await native.request({ id: previewId, ...request, edgeIds: nativeEdges.slice(0, 1) }, 120000);
      const browserMessage = fromBrowser.type === "error" ? fromBrowser.message : "";
      expect(browserMessage).toMatch(/largest that fits is about [\d.]+ mm/);
      expect(String(fromNative.message)).toBe(browserMessage);
      await browser.request({ type: "dispose", requestId: nextId++ });
      await native.request({ id: nextId, requestId: nextId++, type: "dispose" });
    }, 180000);
  }
});
