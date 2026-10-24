/// <reference lib="webworker" />

import { collectPrintOverlayMarks, printOverlayMarkBuffers, type PrintOverlayCollectRequest } from "@/lib/printOverlayCollect";

type WorkerRequest = PrintOverlayCollectRequest & { requestId: number };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const value = collectPrintOverlayMarks(request);
    // Marks are fresh Float32Arrays; hand their buffers back instead of copying.
    self.postMessage({ requestId: request.requestId, type: "result", value }, printOverlayMarkBuffers(value));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Print overlay failed";
    self.postMessage({ requestId: request.requestId, type: "error", message });
  }
};
