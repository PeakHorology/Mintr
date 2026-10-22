import type {
  CadCylindricalFace,
  CadModifierEdge,
  CadModifierMeshPart,
  CadModifierWorkerRequest,
  CadModifierWorkerResponse,
} from "@/lib/cadModifierTypes";
import { hasNativeOcctKernel, nativeKernelWindow, type NativeKernelJob, type NativeKernelReply } from "@/lib/nativeKernelProtocol";

type CadModifierWorkerPayload = CadModifierWorkerRequest extends infer Request
  ? Request extends unknown ? Omit<Request, "requestId"> : never
  : never;

function jsonNumbers(value: ArrayLike<number> | undefined) {
  return value ? Array.from(value) : undefined;
}

export function nativeCadModifierPartsAreExact(parts: CadModifierMeshPart[]) {
  return parts.length > 0 && parts.every((part) => Boolean(part.primitive || part.brep));
}

export function nativeCadModifierCanHandle(request: CadModifierWorkerPayload, nativeSessionLive: boolean) {
  if (!hasNativeOcctKernel()) return false;
  if (request.type === "prepare") return nativeCadModifierPartsAreExact(request.parts);
  if (request.type === "warmup") return false;
  if (request.type === "hollow" || request.type === "previewThread") return nativeSessionLive;
  return nativeSessionLive;
}

export function serializeNativeCadModifierJob(request: CadModifierWorkerPayload, requestId: number): NativeKernelJob {
  if (request.type === "prepare") {
    return {
      id: requestId,
      requestId,
      type: "prepare",
      sharpAngle: request.sharpAngle,
      suppressTreatmentDetailEdges: request.suppressTreatmentDetailEdges,
      parts: request.parts.map((part) => ({
        hole: part.hole,
        primitive: part.primitive,
        brep: part.brep,
        brepTransform: part.brepTransform,
        positions: jsonNumbers(part.positions),
        indices: jsonNumbers(part.indices),
      })),
    };
  }
  return { id: requestId, requestId, ...request };
}

function asEdges(value: NativeKernelReply["edges"]): CadModifierEdge[] {
  return (value ?? []).map((edge) => ({
    id: edge.id,
    points: edge.points,
    display: edge.display,
    selectable: edge.selectable,
    angle: edge.angle,
    boundary: edge.boundary,
    manifold: edge.manifold,
  }));
}

function asCylindricalFaces(value: NativeKernelReply["cylindricalFaces"]): CadCylindricalFace[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const face = entry as Partial<CadCylindricalFace>;
    if (typeof face.id !== "number" || typeof face.radius !== "number" || !face.origin || !face.axis) return [];
    return [{
      id: face.id,
      owner: face.owner ?? 0,
      radius: face.radius,
      height: face.height ?? 0,
      side: face.side === "internal" ? "internal" : "external",
      origin: face.origin,
      axis: face.axis,
      points: Array.isArray(face.points) ? face.points : [],
    }];
  });
}

export function mapNativeCadModifierReply(reply: NativeKernelReply, requestId: number): CadModifierWorkerResponse {
  if (reply.ok === false || reply.type === "error") {
    return {
      type: "error",
      requestId,
      message: reply.message ?? "The CAD kernel failed",
      resetSession: Boolean(reply.resetSession),
    };
  }
  if (reply.type === "ready") {
    return {
      type: "ready",
      requestId,
      edges: asEdges(reply.edges),
      selectableEdgeIds: reply.selectableEdgeIds ?? [],
      cylindricalFaces: asCylindricalFaces(reply.cylindricalFaces),
      sourceType: reply.sourceType ?? "solid",
    };
  }
  if (reply.type === "preview") {
    return {
      type: "preview",
      requestId,
      positions: Float32Array.from(reply.positions ?? []),
      normals: Float32Array.from(reply.normals ?? []),
      indices: Uint32Array.from(reply.indices ?? []),
      triangleCount: reply.triangleCount ?? Math.floor((reply.indices?.length ?? 0) / 3),
      brep: reply.brep ?? "",
      displayEdges: reply.displayEdges ?? [],
      smooth: reply.smooth,
    };
  }
  if (reply.type === "previewBrep") {
    return { type: "previewBrep", requestId, brep: reply.brep ?? "" };
  }
  if (reply.type === "disposed") return { type: "disposed", requestId };
  if (reply.type === "warmup") return { type: "warmup", requestId };
  return {
    type: "error",
    requestId,
    message: reply.message ?? "The CAD kernel returned an unknown reply",
    resetSession: false,
  };
}

export async function requestNativeCadModifier(
  request: CadModifierWorkerPayload,
  requestId: number,
  timeoutMs: number,
): Promise<NativeKernelReply | null> {
  const api = nativeKernelWindow()?.peakcadKernel;
  if (!api?.request) return null;
  return api.request(serializeNativeCadModifierJob(request, requestId), timeoutMs);
}
