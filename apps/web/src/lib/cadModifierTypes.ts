export type CadModifierKind = "chamfer" | "fillet";

/**
 * How a fillet meets the edge. `round` is the usual convex quarter-round that
 * blends the two faces; `cove` scoops a concave quarter-round groove centred on
 * the edge line, the way a cove router bit or ball-end cutter would.
 */
export type FilletProfile = "round" | "cove";

export function normalizeFilletProfile(value: unknown): FilletProfile {
  return value === "cove" ? "cove" : "round";
}

export type CadModifierEdge = {
  id: number;
  owner?: number;
  points: number[];
  display: boolean;
  selectable: boolean;
  angle: number;
  boundary: boolean;
  manifold: boolean;
};

export type CadModifierQuality = "draft" | "standard" | "fine" | "ultra";

export type CadModifierDisplayEdge = {
  points: number[];
};

export type CadCylindricalFace = {
  id: number;
  owner: number;
  radius: number;
  height: number;
  side: "external" | "internal";
  origin: { x: number; y: number; z: number };
  axis: { x: number; y: number; z: number };
  /** Boundary polyline(s) flattened as xyz for viewport highlight. */
  points: number[];
};

export type CadPlanarFace = {
  id: number;
  origin: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  /** Boundary polyline flattened as xyz for hover/ghost. */
  points: number[];
  area: number;
};

export type CadModifierPrimitivePart =
  | {
      kind: "box";
      width: number;
      depth: number;
      height: number;
      transform?: number[];
    }
  | {
      kind: "cylinder";
      height: number;
      transform?: number[];
      /** Circular cylinders. Omit and send width/depth for an ellipse. */
      radius?: number;
      width?: number;
      depth?: number;
    }
  | {
      kind: "cone";
      /** Bottom radius. Zero is a point sitting on the workplane. */
      baseRadius: number;
      /** Top radius. Zero is a pointed tip. */
      topRadius: number;
      height: number;
      transform?: number[];
      /**
       * Local depth divided by width. The fillet is built on the circle, then
       * this stretch is applied, matching the cone drawn on screen.
       */
      sectionScale?: number;
    }
  | {
      kind: "polygon";
      sides: number;
      width: number;
      depth: number;
      height: number;
      transform?: number[];
    }
  | {
      kind: "sphere" | "pyramid" | "wedge" | "roof" | "roundRoof" | "halfSphere" | "torus" | "tube" | "ring" | "gear";
      width: number;
      depth: number;
      height: number;
      transform?: number[];
      sides?: number;
      radius?: number;
      bevel?: number;
      ridgeX?: number;
      profileLoops?: {
        outer: Array<[number, number]>;
        holes: Array<Array<[number, number]>>;
      };
    };

export type CadModifierMeshPart = {
  positions?: Float32Array;
  indices?: Uint32Array;
  brep?: string;
  /** Exact solid from a previous Group or fillet, in the shape's local frame. */
  brepStep?: string;
  brepTransform?: number[];
  primitive?: CadModifierPrimitivePart;
  hole: boolean;
};

export type CadModifierComponentMesh = {
  owner: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
  brep: string;
  displayEdges: CadModifierDisplayEdge[];
};

export type CadThreadPreviewRequest = {
  type: "previewThread";
  requestId: number;
  faceId: number;
  majorDiameter: number;
  pitch: number;
  length: number;
  depth: number;
  side: "external" | "internal";
  handedness: "right" | "left";
  quality: CadModifierQuality;
};

export type CadPushPullRequest = {
  type: "pushPull";
  requestId: number;
  faceId: number;
  distance: number;
  quality: CadModifierQuality;
};

export type CadModifierWorkerRequest =
  | { type: "prepare"; requestId: number; parts: CadModifierMeshPart[]; sharpAngle: number; suppressTreatmentDetailEdges?: boolean }
  | {
      type: "preview";
      requestId: number;
      kind: CadModifierKind;
      edgeIds: number[];
      amount: number;
      quality: CadModifierQuality;
      chamferAngle: number;
      /** Fillet only; omitted means `round`. */
      filletProfile?: FilletProfile;
    }
  | {
      type: "hollow";
      requestId: number;
      thickness: number;
      openings: Array<"top" | "bottom" | "front" | "back" | "left" | "right">;
      corners: "sharp" | "round";
      cornerRadius: number;
      quality: CadModifierQuality;
    }
  | CadThreadPreviewRequest
  | CadPushPullRequest
  | { type: "refine"; requestId: number; linearDeflection: number; angularDeflection: number }
  | { type: "finalize"; requestId: number }
  | { type: "warmup"; requestId: number }
  | { type: "dispose"; requestId: number };

export type CadModifierWorkerResponse =
  | {
      type: "ready";
      requestId: number;
      edges: CadModifierEdge[];
      selectableEdgeIds: number[];
      cylindricalFaces: CadCylindricalFace[];
      planarFaces: CadPlanarFace[];
      sourceType: string;
    }
  | {
      type: "preview";
      requestId: number;
      positions: Float32Array;
      normals: Float32Array;
      indices: Uint32Array;
      triangleCount: number;
      brep: string;
      /** STEP text of the result for round-trip export (optional). */
      step?: string;
      displayEdges: CadModifierDisplayEdge[];
      components?: CadModifierComponentMesh[];
      /** True when this mesh matches the viewport curve, not the fast slider picture. */
      smooth?: boolean;
      /**
       * Edges that were selected but could not be treated at this size (the
       * kernel fell back to one-edge-at-a-time and skipped them). The preview
       * is still valid for the rest; the UI must say so instead of implying all
       * selected edges were rounded.
       */
      skippedEdgeCount?: number;
    }
  | { type: "previewBrep"; requestId: number; brep: string; componentBreps?: string[] }
  | { type: "disposed"; requestId: number }
  | { type: "warmup"; requestId: number }
  | { type: "error"; requestId: number; message: string; resetSession?: boolean };
