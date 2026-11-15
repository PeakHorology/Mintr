import {
  cadModifierPrimitiveForAnalyticBox,
  cadModifierPrimitiveForAnalyticCone,
  cadModifierPrimitiveForAnalyticCylinder,
  cadModifierPrimitiveForAnalyticPolygon,
  cadModifierPrimitiveForBakedShape,
  cadModifierPrimitiveForExactKind,
} from "@/lib/cadBakeMetadata";
import type { CadModifierEdge, CadPlanarFace } from "@/lib/cadModifierTypes";
import { edgeTreatmentSourceParts } from "@/lib/edgeTreatmentSources";
import { meshPositionsToGroupShape, remeshCsgGroupFromWorldChildren } from "@/lib/editorBoolean";
import { bakedEdgeTreatmentPreview, shapeFromCadMesh } from "@/lib/editorEdgeTreatments";
import type { ReplayEngine } from "@/lib/featureReplay";
import { toNativeKernelSolids } from "@/lib/nativeKernelProtocol";
import type { RebuildEngine } from "@/lib/parametricRebuild";
import { rebuildSketchedShape } from "@/lib/sketchRebuild";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * The engine calls a rebuild makes, answered by the Mintr engine itself (the desktop exe, or
 * the same C++ built to WebAssembly) through the editor's own conversion code. A test that
 * passes on both clients shows a rebuild comes out the same on the desktop and in the browser.
 */

export type KernelClient = { request: (job: Record<string, unknown>, timeoutMs?: number) => Promise<Record<string, unknown>> };

/** Volume of a part's mesh: a triangle soup, three corners at a time. */
export function meshVolume(shape: WorkplaneShape) {
  const p = shape.importedMesh?.positions ?? [];
  let volume = 0;
  for (let i = 0; i + 8 < p.length; i += 9) {
    volume += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7])
      - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6])
      + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
  }
  return Math.abs(volume);
}

function primitiveFor(shape: WorkplaneShape) {
  // The same order the editor tries them in (`cadModifierPrimitiveForShape`).
  return cadModifierPrimitiveForBakedShape(shape)
    ?? cadModifierPrimitiveForAnalyticCylinder(shape)
    ?? cadModifierPrimitiveForAnalyticCone(shape)
    ?? cadModifierPrimitiveForAnalyticPolygon(shape)
    ?? cadModifierPrimitiveForExactKind(shape)
    ?? cadModifierPrimitiveForAnalyticBox(shape);
}

function modifierPart(shape: WorkplaneShape) {
  const hole = Boolean(shape.hole);
  if (shape.cadBrep) return { hole, brep: shape.cadBrep };
  const primitive = primitiveFor(shape);
  if (!primitive) throw new Error(`The test engine has no exact solid for ${shape.name} (${shape.kind})`);
  return { hole, primitive };
}

export function kernelEngines(client: KernelClient): { replay: () => ReplayEngine; rebuild: RebuildEngine; calls: string[] } {
  let id = 9000;
  const calls: string[] = [];
  const request = (job: Record<string, unknown>) => {
    id += 1;
    calls.push(String(job.type));
    return client.request({ id, requestId: id, ...job }, 60000);
  };

  const finish = async (source: WorkplaneShape, reply: Record<string, unknown>): Promise<WorkplaneShape> => {
    if (reply.ok === false || reply.type === "error") throw new Error(String(reply.message ?? "The engine could not make that step"));
    const exact = await request({ type: "finalize" });
    if (exact.ok === false || !exact.brep) throw new Error(String(exact.message ?? "The engine kept no exact solid"));
    const shaped = shapeFromCadMesh(
      source,
      Float32Array.from(reply.positions as number[]),
      Float32Array.from((reply.normals as number[] | undefined) ?? []),
      Uint32Array.from(reply.indices as number[]),
      String(exact.brep),
    );
    if (!shaped) throw new Error("The engine returned an empty part");
    return source.groupedShapes?.length ? bakedEdgeTreatmentPreview(shaped, source) : shaped;
  };

  const replay = (): ReplayEngine => ({
    async prepare(shape, sharpAngle) {
      const parts = edgeTreatmentSourceParts(shape, { keepResultMesh: Boolean(shape.importedMesh && shape.cadBrep), ignoreThreads: true }).map(modifierPart);
      const reply = await request({ type: "prepare", sharpAngle, parts });
      if (reply.ok === false || reply.type === "error") throw new Error(String(reply.message));
      return { edges: reply.edges as CadModifierEdge[], planarFaces: (reply.planarFaces ?? []) as CadPlanarFace[] };
    },
    async edgeTreatment(shape, step) {
      return finish(shape, await request({ type: "preview", ...step }));
    },
    async hollow(shape, step) {
      return finish(shape, await request({ type: "hollow", quality: "standard", ...step }));
    },
    async pushPull(shape, step) {
      return finish(shape, await request({ type: "pushPull", quality: "standard", ...step }));
    },
  });

  const rebuild: RebuildEngine = {
    rebuildSketch: (shape, doc) => rebuildSketchedShape(shape, doc),
    remeshGroup: (group, worldChildren) => remeshCsgGroupFromWorldChildren(group, worldChildren, {
      // The engine joins the parts; everything around the join is the editor's own code.
      evaluate: async (operands, op) => {
        const solids = toNativeKernelSolids(operands);
        if (!solids) throw new Error("The test engine cannot build one of these parts");
        const hasHole = operands.some((shape) => shape.hole);
        const kind = op === "intersect" ? "intersect" : hasHole ? "subtract" : "union";
        const reply = await request({ type: "boolean", op: kind, solids });
        if (reply.ok === false) throw new Error(String(reply.message));
        const positions = reply.positions as number[];
        const indices = reply.indices as number[];
        const soup: number[] = [];
        for (const index of indices) soup.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
        return meshPositionsToGroupShape(operands, operands.filter((shape) => !shape.hole), soup, `kernel-${kind}`, { skipWeld: true }, undefined, reply.bounds as number[] | undefined);
      },
    }),
    replay,
  };
  return { replay, rebuild, calls };
}
