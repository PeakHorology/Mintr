/// <reference lib="webworker" />

import { collectPrintOverlayMarks, type PrintOverlayCollectRequest } from "@/lib/printOverlayCollect";

type WorkerRequest = PrintOverlayCollectRequest & { requestId: number };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const value = collectPrintOverlayMarks(request);
    self.postMessage({ requestId: request.requestId, type: "result", value });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Print overlay failed";
    self.postMessage({ requestId: request.requestId, type: "error", message });
  }
};
