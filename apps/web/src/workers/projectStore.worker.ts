import { ProjectStoreHost, type ProjectStoreRequest, type ProjectStoreResponse } from "@/lib/projectStoreOps";

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;

const host = new ProjectStoreHost(workerScope.indexedDB, (deleted) => {
  workerScope.postMessage({ requestId: 0, type: "collected", deleted } satisfies ProjectStoreResponse);
});

workerScope.onmessage = (event: MessageEvent<ProjectStoreRequest>) => {
  const { requestId } = event.data;
  void host
    .handle(event.data)
    .catch((error: unknown): ProjectStoreResponse => ({
      requestId,
      type: "error",
      message: error instanceof Error ? error.message : "Project storage failed",
    }))
    .then((response) => workerScope.postMessage(response));
};

// Tells the page this worker started. A worker that fails while starting up never says so,
// and the page falls back to storing projects itself instead of waiting on it.
workerScope.postMessage({ requestId: 0, type: "ready" } satisfies ProjectStoreResponse);
