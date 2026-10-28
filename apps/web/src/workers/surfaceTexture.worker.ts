/// <reference lib="webworker" />

import { applySurfaceTexture } from "@/lib/texture/textureApply";
import type { SurfaceTextureWorkerRequest } from "@/lib/texture/surfaceTextureClient";

self.onmessage = async (event: MessageEvent<SurfaceTextureWorkerRequest>) => {
  const request = event.data;
  // A few updates a second is plenty for a progress bar.
  let lastSent = 0;
  const onProgress = (share: number) => {
    const now = performance.now();
    if (now - lastSent < 80 && share < 1) return;
    lastSent = now;
    self.postMessage({ requestId: request.requestId, type: "progress", value: share });
  };
  try {
    const value = await applySurfaceTexture(
      { positions: request.positions, indices: request.indices },
      request.texture,
      { ...request.options, onProgress },
    );
    // The result arrays are fresh; hand their buffers back instead of copying.
    self.postMessage({ requestId: request.requestId, type: "result", value }, [value.positions.buffer, value.indices.buffer, value.basePositions.buffer]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Surface texture failed";
    self.postMessage({ requestId: request.requestId, type: "error", message });
  }
};
