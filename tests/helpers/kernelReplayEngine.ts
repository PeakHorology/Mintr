import type { CadModifierEdge, CadPlanarFace } from "@/lib/cadModifierTypes";
import type { ReplayEngine, ReplayPrepared } from "@/lib/featureReplay";
import type { WorkplaneShape } from "@/types/sketchforge";

export type KernelClient = { request: (job: Record<string, unknown>) => Promise<Record<string, unknown>> };

/** A plain red box at the origin, the starting part most step tests use. */
export function testBox(width = 20, depth = 20, height = 20): WorkplaneShape {
  return { id: "part", name: "Part", kind: "box", color: "#d41721", x: 0, z: 0, elevation: 0, size: Math.max(width, depth), width, depth, height, rotation: 0 };
}

/** The engine calls a replay makes, answered by the Mintr engine directly, in world space. */
export function kernelEngine(client: KernelClient): ReplayEngine {
  let id = 5000;
  const request = (job: Record<string, unknown>) => {
    id += 1;
    return client.request({ id, requestId: id, ...job });
  };
  const part = (shape: WorkplaneShape) => {
    if (shape.cadBrep) return { hole: false, brep: shape.cadBrep };
    if (shape.kind === "cylinder") return { hole: false, primitive: { kind: "cylinder", radius: shape.width / 2, height: shape.height } };
    return { hole: false, primitive: { kind: "box", width: shape.width, depth: shape.depth, height: shape.height } };
  };
  const finish = async (source: WorkplaneShape, reply: Record<string, unknown>): Promise<WorkplaneShape> => {
    if (reply.ok === false) throw new Error(String(reply.message));
    const exact = await request({ type: "finalize" });
    if (exact.ok === false || !exact.brep) throw new Error(String(exact.message ?? "no solid"));
    const positions = reply.positions as number[];
    const indices = reply.indices as number[];
    const soup: number[] = [];
    for (const index of indices) soup.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
    let minX = Infinity; let minY = Infinity; let minZ = Infinity; let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
      minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
      minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
    }
    return {
      ...source,
      kind: "mesh",
      x: (minX + maxX) / 2,
      z: (minZ + maxZ) / 2,
      elevation: minY,
      width: maxX - minX,
      height: maxY - minY,
      depth: maxZ - minZ,
      cadBrep: String(exact.brep),
      importedMesh: { positions: soup, baseWidth: maxX - minX, baseDepth: maxZ - minZ, baseHeight: maxY - minY, triangleCount: indices.length / 3, sourceFormat: "json" },
    };
  };
  return {
    async prepare(shape, sharpAngle) {
      const reply = await request({ type: "prepare", sharpAngle, parts: [part(shape)] });
      if (reply.ok === false) throw new Error(String(reply.message));
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
  };
}

/** The four upright corner edges, picked the way a person would click them. */
export function cornerEdgeIds(prepared: ReplayPrepared) {
  return prepared.edges
    .filter((edge) => edge.display && edge.selectable && edge.manifold && !edge.boundary)
    .filter((edge) => {
      const [x, , z] = edge.points;
      for (let i = 0; i + 2 < edge.points.length; i += 3) {
        if (Math.abs(edge.points[i] - x) > 1e-3 || Math.abs(edge.points[i + 2] - z) > 1e-3) return false;
      }
      return true;
    })
    .map((edge) => edge.id);
}
