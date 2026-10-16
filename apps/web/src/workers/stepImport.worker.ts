/// <reference lib="webworker" />

import { loadBrepWithOcct } from "@/lib/brepKernel";
import { stepBodySpan, stepDisplayTolerance } from "@/lib/stepMeshTolerance";

type ImportRequest = { type: "import"; requestId: number; fileName: string; buffer: ArrayBuffer };

function post(message: Record<string, unknown>, transfer?: Transferable[]) {
  if (transfer) self.postMessage(message, { transfer });
  else self.postMessage(message);
}

function yieldToWindow() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function importFile(request: ImportRequest) {
  const brep = await loadBrepWithOcct();
  const imported = await brep.importSTEP(new Blob([request.buffer]));
  if (!imported.ok) {
    throw new Error(`Could not read STEP: ${String(imported.error.message ?? imported.error)}`);
  }
  // STEP/CAD space is Z-up; the editor is Y-up. −90° about X maps CAD +Z to +Y.
  const flipped = brep.rotate(imported.value, -90, { axis: [1, 0, 0] });
  const solids = brep.getSolids(flipped as never);
  const stem = request.fileName.replace(/\.[^.]+$/, "") || "Imported STEP";
  const parts = solids.length > 1
    ? solids.map((part, index) => ({ name: `${stem} ${index + 1}`, part }))
    : [{ name: stem, part: flipped }];
  const total = parts.length;
  const captured: Array<{ name: string; part: (typeof parts)[number]["part"]; stepText: string }> = [];
  for (let index = 0; index < parts.length; index += 1) {
    const { name, part } = parts[index];
    post({ type: "progress", requestId: request.requestId, index: index + 1, total, name });
    // Exact text before any coarse mesh. Meshing first can crash a later export of that solid.
    const exported = brep.exportSTEP(part as never);
    captured.push({
      name,
      part,
      stepText: exported.ok ? (await exported.value.text()).trim() : "",
    });
  }
  for (let index = 0; index < captured.length; index += 1) {
    const { name, part, stepText } = captured[index];
    post({ type: "progress", requestId: request.requestId, index: index + 1, total, name });
    const bounds = brep.getBounds(part as never);
    const tess = brep.mesh(part as never, stepDisplayTolerance(stepBodySpan(bounds)));
    if (tess.vertices.length < 9 || tess.triangles.length < 3) continue;
    const vertices = tess.vertices;
    const triangles = tess.triangles;
    const normals = tess.normals.length === vertices.length ? tess.normals : new Float32Array();
    post(
      {
        type: "body",
        requestId: request.requestId,
        index,
        total,
        name,
        stepText,
        vertices,
        normals,
        triangles,
      },
      [vertices.buffer, normals.buffer, triangles.buffer],
    );
    await yieldToWindow();
  }
  post({ type: "done", requestId: request.requestId, total });
}

self.onmessage = (event: MessageEvent<ImportRequest>) => {
  const request = event.data;
  importFile(request).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Could not read STEP";
    post({ type: "error", requestId: request.requestId, message });
  });
};
