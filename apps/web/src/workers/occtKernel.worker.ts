/// <reference lib="webworker" />

import { evaluateOcctBooleanOnWorldShapesLocal, exportShapesToStepLocal } from "@/lib/stepExport";
import { withExactSketchExtrusionSolidLocal } from "@/lib/sketchExtrusionSolid";
import { shapeFromSketchSweepLocal } from "@/lib/sketchSweep";
import { buildGridfinityShapeLocal } from "@/lib/gridfinityShape";
import type { OcctKernelRequest } from "@/lib/occtKernelClient";

type WorkerRequest = OcctKernelRequest & { requestId: number };

function post(message: Record<string, unknown>) {
  self.postMessage(message);
}

async function handle(request: WorkerRequest) {
  const { requestId } = request;
  if (request.type === "boolean") {
    const value = await evaluateOcctBooleanOnWorldShapesLocal(request.shapes, request.op);
    post({ requestId, type: "result", value });
    return;
  }
  if (request.type === "exportStep") {
    const value = await exportShapesToStepLocal(request.shapes);
    post({ requestId, type: "result", value });
    return;
  }
  if (request.type === "sketchExtrude") {
    const value = await withExactSketchExtrusionSolidLocal(request.shape, request.distance, {
      cutIntoFace: request.cutIntoFace,
    });
    post({ requestId, type: "result", value });
    return;
  }
  if (request.type === "sketchSweep") {
    const value = await shapeFromSketchSweepLocal(request.profile, request.doc, request.spec, request.existing);
    post({ requestId, type: "result", value });
    return;
  }
  if (request.type === "gridfinity") {
    const value = await buildGridfinityShapeLocal(request.shape);
    post({ requestId, type: "result", value });
    return;
  }
  post({ requestId, type: "error", message: "Unknown CAD kernel request" });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  handle(request).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "CAD kernel failed";
    post({ requestId: request.requestId, type: "error", message });
  });
};
