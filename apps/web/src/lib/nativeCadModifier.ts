import type {
  CadCylindricalFace,
  CadModifierEdge,
  CadModifierMeshPart,
  CadPlanarFace,
  CadModifierWorkerRequest,
  CadModifierWorkerResponse,
} from "@/lib/cadModifierTypes";
import { cadFailureCopy, type CadFailureKind } from "@/lib/cadFailureCopy";
import { hasNativeOcctKernel, nativeKernelWindow, type NativeKernelJob, type NativeKernelReply } from "@/lib/nativeKernelProtocol";

type CadModifierWorkerPayload = CadModifierWorkerRequest extends infer Request
  ? Request extends unknown ? Omit<Request, "requestId"> : never
  : never;

function jsonNumbers(value: ArrayLike<number> | undefined) {
  return value ? Array.from(value) : undefined;
}

export function nativeCadModifierPartsAreExact(parts: CadModifierMeshPart[]) {
  return parts.length > 0 && parts.every((part) => Boolean(part.primitive || part.brep || part.brepStep));
}

export function nativeCadModifierCanHandle(request: CadModifierWorkerPayload, nativeSessionLive: boolean) {
  if (!hasNativeOcctKernel()) return false;
  if (request.type === "prepare") return nativeCadModifierPartsAreExact(request.parts);
  if (request.type === "warmup") return false;
  if (request.type === "hollow" || request.type === "previewThread" || request.type === "pushPull") return nativeSessionLive;
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
        brepStep: part.brepStep,
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

function asVec3(value: unknown): { x: number; y: number; z: number } | null {
  if (!value || typeof value !== "object") return null;
  const vec = value as { x?: unknown; y?: unknown; z?: unknown };
  if (typeof vec.x !== "number" || typeof vec.y !== "number" || typeof vec.z !== "number") return null;
  return { x: vec.x, y: vec.y, z: vec.z };
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

function asPlanarFaces(value: NativeKernelReply["planarFaces"]): CadPlanarFace[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const face = entry as Partial<CadPlanarFace> & { origin?: unknown; normal?: unknown };
    const origin = asVec3(face.origin);
    const normal = asVec3(face.normal);
    if (typeof face.id !== "number" || !origin || !normal) return [];
    return [{
      id: face.id,
      origin,
      normal,
      points: Array.isArray(face.points) ? face.points.filter((n): n is number => typeof n === "number") : [],
      area: typeof face.area === "number" ? face.area : 0,
    }];
  });
}

function failureKindForReply(reply: NativeKernelReply, requested: CadFailureKind): CadFailureKind {
  const text = reply.message ?? "";
  if (/Push Pull|flat face|push went through|could not grow|could not move this face|broke this grouped/i.test(text)) return "pushPull";
  return requested;
}

export function mapNativeCadModifierReply(
  reply: NativeKernelReply,
  requestId: number,
  failureKind: CadFailureKind = "fillet",
): CadModifierWorkerResponse {
  const kind = failureKindForReply(reply, failureKind);
  if (reply.ok === false || reply.type === "error") {
    return {
      type: "error",
      requestId,
      message: cadFailureCopy(reply.message ?? "The CAD kernel failed", kind),
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
      planarFaces: asPlanarFaces(reply.planarFaces),
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
      ...(reply.skippedEdgeIds?.length ? { skippedEdgeCount: reply.skippedEdgeIds.length } : {}),
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
    message: cadFailureCopy(reply.message ?? "The CAD kernel returned an unknown reply", kind),
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
  // Mesh numbers may arrive as typed arrays; mapNativeCadModifierReply copies them
  // straight into the preview buffers.
  return api.request(serializeNativeCadModifierJob(request, requestId), timeoutMs);
}
