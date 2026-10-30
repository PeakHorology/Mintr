import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { inferCsgOp } from "@/lib/csgTree";
import {
  localGroupBounds,
  rebuildSmoothBody,
  restoreGroupedChildren,
  smoothNetForShapes,
  smoothPreviewBody,
  smoothSpecToWorld,
} from "@/lib/editorBoolean";
import {
  applyTugs,
  clampSmoothLevel,
  edgeKey,
  edgesAmong,
  findMirrorPartners,
  flatFaceAt,
  hasFlatBottom,
  limitPositions,
  meshExtent,
  nearestFlatFace,
  netEdges,
  netStencil,
  planSmooth,
  pointNormals,
  runSmoothPlan,
  softWeights,
  type CreaseTags,
  type NetStencil,
  type PolyMesh,
  type SmoothPlan,
  type Vec3,
} from "@/lib/smoothSubdivision";
import type { SmoothInspectorControls } from "@/components/workplane/ShapeInspector";
import type { SmoothEditOverlay, SmoothPull } from "@/components/WorkplaneViewport";
import type { SmoothCrease, SmoothSpec, SmoothTug, WorkplaneShape } from "@/types/sketchforge";

/** Triangles while a point is being dragged, so the drag stays smooth. */
const DRAG_TRIANGLE_CAP = 60_000;

/** Edit points works in world space on the body's net; the body itself is rebuilt when a drag ends. */
type SmoothSession = {
  bodyId: string;
  /** What the body looked like when the points were made, to notice undo, redo and moves. */
  signature: string;
  children: WorkplaneShape[];
  spec: SmoothSpec;
  net: PolyMesh;
  tags: CreaseTags;
  /** Net points with nothing pulled: what new pulls and sharp edges are stored under. */
  keys: Float64Array;
  /** The surface at this detail before its own pulls: finer pulls are kept as steps from here. */
  before: Float64Array;
  detail: number;
  /** Points already there one detail down; they come first and are drawn larger. */
  coarseCount: number;
  /** Pulled points at this detail, by net point. */
  targets: Map<number, Vec3>;
  /** Pulls made at other details, carried along unchanged. */
  otherTugs: SmoothTug[];
  /** Sharp edges, each with the two net points it runs between. */
  creases: { crease: SmoothCrease; ends: [number, number] | null }[];
  /** Where each dot sits on the smooth surface, and which way the surface faces there. */
  limit: Float64Array;
  normals: Float32Array;
  edges: Uint32Array;
  /** The parts' flat faces, for picking a face to keep flat. */
  base: PolyMesh;
  /** Points on a kept face (1): pulls leave them alone. */
  locked: Uint8Array;
  flatBottom: boolean;
  /** The net's limit masks; a drag moves points but never rejoins them. */
  stencil: NetStencil;
  /** The drag preview's subdivision, worked out on the first drag. */
  dragPlan: SmoothPlan | null;
};

type Drag = {
  body: WorkplaneShape;
  weights: Map<number, number>;
  delta: SmoothPull;
  frame: number | null;
  net: PolyMesh | null;
  targets: Map<number, Vec3> | null;
};

function smoothSignature(body: WorkplaneShape) {
  const { x, z, elevation, rotation, width, depth, height, smooth } = body;
  return JSON.stringify([x, z, elevation, rotation, width, depth, height, smooth]);
}

async function sessionFor(body: WorkplaneShape): Promise<SmoothSession | null> {
  const children = restoreGroupedChildren(body, { preserveIds: true });
  const spec = smoothSpecToWorld(body);
  const built = await smoothNetForShapes(children, spec);
  if (!built) return null;
  const { net, tags, keys, before, coarseCount, targets, creasesApplied, creaseEnds, locked } = built.smooth;
  const detail = Math.max(0, Math.min(2, Math.round(spec.detail ?? 0)));
  const applied = new Set(creasesApplied);
  const stencil = netStencil(net, tags);
  const limit = limitPositions(net, tags, stencil);
  return {
    bodyId: body.id,
    signature: smoothSignature(body),
    children,
    spec,
    net,
    tags,
    keys,
    before,
    detail,
    coarseCount,
    targets,
    otherTugs: (spec.tugs ?? []).filter((tug) => tug.detail !== detail),
    creases: (spec.creases ?? []).map((crease) => ({
      crease,
      ends: applied.has(crease) ? creaseEnds[creasesApplied.indexOf(crease)] : null,
    })),
    limit,
    normals: pointNormals(net, limit),
    edges: netEdges(net),
    base: built.base,
    locked,
    flatBottom: hasFlatBottom(built.base),
    stencil,
    dragPlan: null,
  };
}

function worldTugs(session: SmoothSession, targets: Map<number, Vec3>): SmoothTug[] {
  const k = session.keys;
  const b = session.before;
  return [
    ...session.otherTugs,
    ...[...targets].map(([v, to]): SmoothTug => ({
      detail: session.detail,
      at: [k[v * 3], k[v * 3 + 1], k[v * 3 + 2]],
      to,
      // Finer pulls ride on the rough shape, so they are kept as a step from the surface below.
      ...(session.detail > 0 ? { from: [b[v * 3], b[v * 3 + 1], b[v * 3 + 2]] as Vec3 } : {}),
    })),
  ];
}

function mirrorAxis(spec: SmoothSpec): 0 | 2 | null {
  return spec.mirror === "x" ? 0 : spec.mirror === "z" ? 2 : null;
}

export function useSmoothEdit({
  selectedShape,
  shapesRef,
  setShapes,
  commitShapes,
  setNotice,
}: {
  selectedShape: WorkplaneShape | null;
  shapesRef: MutableRefObject<WorkplaneShape[]>;
  setShapes: (next: WorkplaneShape[]) => void;
  commitShapes: (next: WorkplaneShape[], selection: string | string[] | null, message?: string) => void;
  setNotice: (message: string) => void;
}) {
  const body = selectedShape && inferCsgOp(selectedShape) === "smooth" && !selectedShape.locked ? selectedShape : null;
  const [session, setSession] = useState<SmoothSession | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const selectedRef = useRef(selected);
  const [preparing, setPreparing] = useState(false);
  const [livePoints, setLivePoints] = useState<Float32Array | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const busyRef = useRef(false);
  const [pickingFace, setPickingFace] = useState(false);
  // How a drag moves points is a habit, so it is remembered on this computer rather than in the design.
  const [dragInOut, setDragInOut] = useState(() => {
    try {
      return window.localStorage.getItem("mintr.smoothDragInOut") === "1";
    } catch {
      return false;
    }
  });
  const changeDragInOut = useCallback((inOut: boolean) => {
    setDragInOut(inOut);
    try {
      window.localStorage.setItem("mintr.smoothDragInOut", inOut ? "1" : "0");
    } catch {
      // Private windows may refuse; the choice still holds until the page closes.
    }
  }, []);
  /** A soft radius slide shows at once and becomes one undo step when it settles. */
  const radiusCommitRef = useRef<{ timer: number; commit: () => void } | null>(null);
  const flushRadius = useCallback(() => {
    const pending = radiusCommitRef.current;
    if (!pending) return;
    radiusCommitRef.current = null;
    window.clearTimeout(pending.timer);
    pending.commit();
  }, []);

  // Each point's twin across the middle when Mirror is on.
  const partners = useMemo(() => {
    const axis = session ? mirrorAxis(session.spec) : null;
    if (!session || axis === null) return null;
    // Points without an exact twin take the nearest one, up to about half a net edge away.
    const k = session.keys;
    let total = 0;
    for (let i = 0; i < session.edges.length; i += 2) {
      const a = session.edges[i] * 3;
      const b = session.edges[i + 1] * 3;
      total += Math.hypot(k[a] - k[b], k[a + 1] - k[b + 1], k[a + 2] - k[b + 2]);
    }
    const nearTol = (0.6 * total) / Math.max(1, session.edges.length / 2);
    const turns = session.children.map((child) => child.rotation ?? 0);
    return findMirrorPartners(k, axis, turns, Math.max(1e-3, meshExtent(session.net) * 1e-4), nearTol);
  }, [session]);
  const partnersRef = useRef(partners);
  partnersRef.current = partners;

  const choose = useCallback((next: ReadonlySet<number>) => {
    selectedRef.current = next;
    setSelected(next);
  }, []);

  const exit = useCallback(() => {
    if (dragRef.current?.frame != null) window.cancelAnimationFrame(dragRef.current.frame);
    dragRef.current = null;
    flushRadius();
    setPickingFace(false);
    setSession(null);
    setLivePoints(null);
    choose(new Set());
  }, [choose, flushRadius]);

  // Leave Edit points when the body is no longer the one selected.
  useEffect(() => {
    if (session && (!body || body.id !== session.bodyId)) exit();
  }, [body, exit, session]);

  useEffect(() => {
    if (!session) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Enter") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      // Leaving Edit points keeps the body selected.
      event.stopImmediatePropagation();
      if (pickingFace) setPickingFace(false);
      else exit();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [exit, pickingFace, session]);

  const replaceBody = useCallback((next: WorkplaneShape) => {
    const mapped = shapesRef.current.map((shape) => (shape.id === next.id ? next : shape));
    shapesRef.current = mapped;
    setShapes(mapped);
  }, [setShapes, shapesRef]);

  /** Rebuild the body with new settings and record one undo step. */
  const rebuild = useCallback(async (source: WorkplaneShape, spec: SmoothSpec, message: string) => {
    if (busyRef.current) return null;
    flushRadius();
    busyRef.current = true;
    try {
      let notice: string | null = null;
      const next = await rebuildSmoothBody(source, spec, { onNotice: (text) => { notice = text; } });
      if (!next) {
        replaceBody(source);
        setNotice("Could not smooth these shapes");
        return null;
      }
      commitShapes(shapesRef.current.map((shape) => (shape.id === next.id ? next : shape)), next.id, notice ?? message);
      return next;
    } finally {
      busyRef.current = false;
    }
  }, [commitShapes, flushRadius, replaceBody, setNotice, shapesRef]);

  const enter = useCallback(async (target: WorkplaneShape, keepSelection = false) => {
    setPreparing(true);
    try {
      const next = await sessionFor(target);
      if (!next) {
        setNotice("Could not prepare the points of this shape");
        return;
      }
      setSession(next);
      setLivePoints(null);
      if (!keepSelection) choose(new Set());
    } finally {
      setPreparing(false);
    }
  }, [choose, setNotice]);

  // Undo, redo or a move changed the body under the points: fetch them again.
  useEffect(() => {
    if (!session || !body || body.id !== session.bodyId || preparing) return;
    if (dragRef.current || busyRef.current || radiusCommitRef.current) return;
    if (smoothSignature(body) === session.signature) return;
    void enter(body, true);
  }, [body, enter, preparing, session]);

  const changeSpec = useCallback(async (patch: Partial<SmoothSpec>, message: string) => {
    if (!body) return;
    // The soft radius and Mirror only change how later pulls move; the shape stays as it is.
    if (Object.keys(patch).every((key) => key === "softRadius" || key === "mirror")) {
      const next = { ...body, smooth: { ...(body.smooth ?? { level: 2 }), ...patch } };
      const current = sessionRef.current;
      if (current) setSession({ ...current, signature: smoothSignature(next), spec: { ...current.spec, ...patch } });
      const commit = () => commitShapes(shapesRef.current.map((shape) => (shape.id === next.id ? next : shape)), next.id, message);
      if (!("softRadius" in patch)) {
        flushRadius();
        commit();
        return;
      }
      // Sliding the radius shows at once; it becomes one undo step when the slider settles.
      replaceBody(next);
      if (radiusCommitRef.current) window.clearTimeout(radiusCommitRef.current.timer);
      const pending = { timer: 0, commit };
      pending.timer = window.setTimeout(() => {
        if (radiusCommitRef.current === pending) radiusCommitRef.current = null;
        commit();
      }, 450);
      radiusCommitRef.current = pending;
      return;
    }
    const world = smoothSpecToWorld(body);
    let spec: SmoothSpec = { ...world, ...patch };
    let switched = message;
    if (patch.keepEdges !== undefined && Boolean(patch.keepEdges) !== Boolean(world.keepEdges)) {
      // Pulls made on the rounded shape mean nothing on the exact one, and the other way
      // round. They are put aside, and come back when the shape is switched back.
      const mine = { keepEdges: Boolean(world.keepEdges), tugs: world.tugs ?? [], creases: world.creases ?? [] };
      const back = world.parked && world.parked.keepEdges === Boolean(patch.keepEdges) ? world.parked : null;
      spec = {
        ...spec,
        tugs: back?.tugs ?? [],
        creases: back?.creases ?? [],
        parked: mine.tugs.length > 0 || mine.creases.length > 0 ? mine : undefined,
      };
      if (back && (back.tugs.length > 0 || back.creases.length > 0)) switched = `${message}; its earlier pulls are back`;
      else if (mine.tugs.length > 0 || mine.creases.length > 0) switched = `${message}. Your pulls are kept for switching back`;
    }
    const next = await rebuild(body, spec, switched);
    // The net changes with the detail or the bottom, so the points are fetched again.
    if (next && sessionRef.current) await enter(next, patch.detail === undefined && patch.keepBottomFlat === undefined && patch.keepEdges === undefined);
  }, [body, commitShapes, enter, flushRadius, rebuild, replaceBody, shapesRef]);

  const pullTargets = useCallback((current: SmoothSession, weights: Map<number, number>, delta: SmoothPull) => {
    // A number is a pull straight out of the surface (in, when negative): each point along its own facing.
    const n = current.normals;
    const along = (v: number, w: number, d: number): Vec3 => [w * d * n[v * 3], w * d * n[v * 3 + 1], w * d * n[v * 3 + 2]];
    const direct = new Map<number, Vec3>();
    for (const [v, w] of weights) {
      if (current.locked[v]) continue;
      direct.set(v, typeof delta === "number" ? along(v, w, delta) : [w * delta[0], w * delta[1], w * delta[2]]);
    }
    const moves = new Map(direct);
    const mirror = mirrorAxis(current.spec) !== null ? partnersRef.current : null;
    if (mirror) {
      const { twins, normal } = mirror;
      // Each pull is copied to the twin, flipped across the middle. A point pulled both
      // ways (on or near the middle) takes the average, which keeps it on its side.
      const copied = new Map<number, Vec3>();
      for (const [v, d] of direct) {
        const twin = twins[v];
        if (twin < 0 || current.locked[twin]) continue;
        const across = 2 * (d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2]);
        const flipped: Vec3 = typeof delta === "number"
          ? along(twin, weights.get(v) ?? 1, delta)
          : [d[0] - across * normal[0], d[1] - across * normal[1], d[2] - across * normal[2]];
        // Two points can share a nearest twin; the bigger pull wins.
        const had = copied.get(twin);
        if (!had || Math.hypot(...had) < Math.hypot(...flipped)) copied.set(twin, flipped);
      }
      for (const [v, flipped] of copied) {
        const own = direct.get(v);
        moves.set(v, own ? [(own[0] + flipped[0]) / 2, (own[1] + flipped[1]) / 2, (own[2] + flipped[2]) / 2] : flipped);
      }
    }
    const targets = new Map(current.targets);
    for (const [v, d] of moves) {
      targets.set(v, [current.limit[v * 3] + d[0], current.limit[v * 3 + 1] + d[1], current.limit[v * 3 + 2] + d[2]]);
    }
    return targets;
  }, []);

  const startPull = useCallback((): Drag | null => {
    const current = sessionRef.current;
    const source = shapesRef.current.find((shape) => shape.id === current?.bodyId);
    if (!current || !source || selectedRef.current.size === 0) return null;
    const seeds = [...selectedRef.current];
    return {
      body: source,
      weights: softWeights(current.net, seeds, current.spec.softRadius ?? 0, current.limit),
      delta: 0,
      frame: null,
      net: null,
      targets: null,
    };
  }, [shapesRef]);

  const showPull = useCallback((drag: Drag) => {
    const current = sessionRef.current;
    if (!current) return;
    const targets = pullTargets(current, drag.weights, drag.delta);
    const net = applyTugs(current.net, current.tags, targets, current.stencil);
    drag.net = net;
    drag.targets = targets;
    setLivePoints(Float32Array.from(limitPositions(net, current.tags, current.stencil)));
    // How the net subdivides never changes during a drag, so that is worked out once.
    current.dragPlan ??= planSmooth(current.net, current.tags, clampSmoothLevel(current.net, current.spec.level, DRAG_TRIANGLE_CAP));
    const { positions, normals } = runSmoothPlan(current.dragPlan, net.positions);
    const preview = smoothPreviewBody(drag.body, current.children, positions, normals, { ...current.spec, tugs: worldTugs(current, targets) });
    if (preview) replaceBody(preview);
  }, [pullTargets, replaceBody]);

  const finishPull = useCallback(async (drag: Drag) => {
    const current = sessionRef.current;
    if (!current) return;
    if (typeof drag.delta === "number" ? Math.abs(drag.delta) < 1e-6 : Math.hypot(...drag.delta) < 1e-6) {
      replaceBody(drag.body);
      setLivePoints(null);
      return;
    }
    const targets = drag.targets ?? pullTargets(current, drag.weights, drag.delta);
    const net = drag.net ?? applyTugs(current.net, current.tags, targets, current.stencil);
    const moved = selectedRef.current.size;
    const next = await rebuild(drag.body, { ...current.spec, tugs: worldTugs(current, targets) }, `Moved ${moved === 1 ? "1 point" : `${moved} points`}`);
    setLivePoints(null);
    if (!next) return;
    // Same net, same points: only the pulls changed.
    const limit = limitPositions(net, current.tags, current.stencil);
    setSession({ ...current, signature: smoothSignature(next), net, targets, limit, normals: pointNormals(net, limit), spec: smoothSpecToWorld(next) });
  }, [pullTargets, rebuild, replaceBody]);

  /** Sharp or smooth edges between the selected points, as one undo step. */
  const setSharp = useCallback(async (sharp: boolean) => {
    const current = sessionRef.current;
    const source = shapesRef.current.find((shape) => shape.id === current?.bodyId);
    if (!current || !source) return;
    const picked = selectedRef.current;
    const k = current.keys;
    const key = (v: number): Vec3 => [k[v * 3], k[v * 3 + 1], k[v * 3 + 2]];
    const nv = k.length / 3;
    // A sharp edge made by hand is simply dropped to smooth it; an edge the shape started
    // sharp gets a note to smooth it, and dropping that note makes it sharp again.
    const sharpNow = current.tags.crease;
    const toChange = edgesAmong(current.net, picked).filter(([a, b]) => sharpNow.has(edgeKey(a, b, nv)) !== sharp);
    if (toChange.length === 0) return;
    const touched = new Set(toChange.map(([a, b]) => edgeKey(a, b, nv)));
    const kept = current.creases.filter((entry) => !(entry.ends && touched.has(edgeKey(entry.ends[0], entry.ends[1], nv))));
    const undone = new Set(current.creases.filter((entry) => !kept.includes(entry)).map((entry) => edgeKey(entry.ends![0], entry.ends![1], nv)));
    const added = toChange
      .filter(([a, b]) => !undone.has(edgeKey(a, b, nv)))
      .map(([a, b]): SmoothCrease => ({ detail: current.detail, a: key(a), b: key(b), ...(sharp ? {} : { smooth: true }) }));
    const creases = [...kept.map((entry) => entry.crease), ...added];
    const next = await rebuild(source, { ...current.spec, creases }, sharp ? "Made the edge sharp" : "Made the edge smooth");
    if (next) await enter(next, true);
  }, [enter, rebuild, shapesRef]);

  /** Keep the clicked flat face exactly as it is, or free it again if it was kept. */
  const onSmoothFacePick = useCallback(async (spot: Vec3, toward: Vec3) => {
    setPickingFace(false);
    const current = sessionRef.current;
    const source = shapesRef.current.find((shape) => shape.id === current?.bodyId);
    if (!current || !source) return;
    const face = nearestFlatFace(current.base, spot, toward);
    if (!face || face.faces.length === 0) {
      setNotice("Click a flat face of the part to keep it flat");
      return;
    }
    const kept = current.spec.keepFaces ?? [];
    const tol = 1e-4 + meshExtent(current.base) * 1e-6;
    const picked = new Set(face.faces);
    const already = kept.filter((at) => flatFaceAt(current.base, at, tol).some((f) => picked.has(f)));
    const keepFaces = already.length > 0 ? kept.filter((at) => !already.includes(at)) : [...kept, face.at];
    const next = await rebuild(source, { ...current.spec, keepFaces }, already.length > 0 ? "Freed the face" : "Kept the face flat");
    if (next) await enter(next, true);
  }, [enter, rebuild, setNotice, shapesRef]);

  const onSmoothPointPick = useCallback((index: number | null, additive: boolean) => {
    if (index === null) {
      choose(new Set());
      return;
    }
    const next = new Set(additive ? selectedRef.current : []);
    if (additive && next.has(index)) next.delete(index);
    else next.add(index);
    choose(next);
  }, [choose]);

  const onSmoothBoxSelect = useCallback((indices: number[], additive: boolean) => {
    const next = new Set(additive ? selectedRef.current : []);
    for (const v of indices) next.add(v);
    choose(next);
  }, [choose]);

  const onSmoothDragStart = useCallback(() => {
    dragRef.current = startPull();
  }, [startPull]);

  const onSmoothDrag = useCallback((delta: SmoothPull) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.delta = delta;
    if (drag.frame !== null) return;
    drag.frame = window.requestAnimationFrame(() => {
      drag.frame = null;
      if (dragRef.current === drag) showPull(drag);
    });
  }, [showPull]);

  const onSmoothDragEnd = useCallback((delta: SmoothPull) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.frame !== null) window.cancelAnimationFrame(drag.frame);
    drag.delta = delta;
    void finishPull(drag);
  }, [finishPull]);

  const selectionCenter = useMemo((): [number, number, number] | null => {
    if (!session || selected.size === 0) return null;
    const points = livePoints ?? session.limit;
    const sum: [number, number, number] = [0, 0, 0];
    for (const v of selected) {
      sum[0] += points[v * 3];
      sum[1] += points[v * 3 + 1];
      sum[2] += points[v * 3 + 2];
    }
    return [sum[0] / selected.size, sum[1] / selected.size, sum[2] / selected.size];
  }, [livePoints, selected, session]);

  const sharpEdges = useMemo(() => {
    if (!session) return new Uint32Array();
    const nv = session.keys.length / 3;
    const out: number[] = [];
    for (let i = 0; i < session.edges.length; i += 2) {
      if (session.tags.crease.has(edgeKey(session.edges[i], session.edges[i + 1], nv))) out.push(session.edges[i], session.edges[i + 1]);
    }
    return Uint32Array.from(out);
  }, [session]);

  const smoothEdit = useMemo((): SmoothEditOverlay | null => {
    if (!session) return null;
    const twins = new Set<number>();
    if (partners) {
      for (const v of selected) {
        const twin = partners.twins[v];
        if (twin >= 0 && !selected.has(twin)) twins.add(twin);
      }
    }
    return {
      points: livePoints ?? Float32Array.from(session.limit),
      edges: session.edges,
      sharpEdges,
      normals: session.normals,
      selected,
      twins,
      locked: session.locked,
      coarseCount: session.coarseCount,
      pickingFace,
      dragInOut,
    };
  }, [dragInOut, livePoints, partners, pickingFace, selected, session, sharpEdges]);

  const smoothControls = useMemo((): SmoothInspectorControls | null => {
    if (!body) return null;
    const bounds = localGroupBounds(body.groupedShapes ?? []);
    const pickedEdges = session && selected.size >= 2 ? edgesAmong(session.net, selected) : [];
    const nv = session ? session.keys.length / 3 : 0;
    const sharpNow = session?.tags.crease ?? new Set<number>();
    return {
      editing: Boolean(session),
      preparing,
      selectedCount: selected.size,
      selectionCenter,
      blocks: { width: bounds.maxX - bounds.minX, depth: bounds.maxZ - bounds.minZ, height: bounds.maxY - bounds.minY },
      hasFlatBottom: session?.flatBottom ?? true,
      pickingFace,
      dragInOut,
      onDragInOutChange: changeDragInOut,
      keptFaces: body.smooth?.keepFaces?.length ?? 0,
      canMakeSharp: pickedEdges.some(([a, b]) => !sharpNow.has(edgeKey(a, b, nv))),
      canMakeSmooth: pickedEdges.some(([a, b]) => sharpNow.has(edgeKey(a, b, nv))),
      onChange: (patch) => {
        const label = patch.detail !== undefined ? "Changed smoothness"
          : patch.keepBottomFlat !== undefined ? (patch.keepBottomFlat ? "Kept the bottom flat" : "Rounded the bottom")
            : patch.keepEdges !== undefined ? (patch.keepEdges ? "Started from the exact shape" : "Rounded the whole shape")
            : "mirror" in patch ? (patch.mirror ? "Mirrored the pulls" : "Stopped mirroring")
              : "Changed soft radius";
        void changeSpec(patch, label);
      },
      onToggleEdit: () => {
        if (session) exit();
        else void enter(body);
      },
      onMoveSelection: (axis, valueMm) => {
        if (!selectionCenter) return;
        const drag = startPull();
        if (!drag) return;
        const delta: Vec3 = [0, 0, 0];
        delta[axis] = valueMm - selectionCenter[axis];
        drag.delta = delta;
        void finishPull(drag);
      },
      onPickFace: () => setPickingFace((on) => !on),
      onMakeSharp: () => void setSharp(true),
      onMakeSmooth: () => void setSharp(false),
      onResetPoints: () => {
        void changeSpec({ tugs: [], creases: [] }, "Reset the points");
      },
    };
  }, [body, changeDragInOut, changeSpec, dragInOut, enter, exit, finishPull, pickingFace, preparing, selected, selectionCenter, session, setSharp, startPull]);

  return { smoothControls, smoothEdit, onSmoothPointPick, onSmoothBoxSelect, onSmoothFacePick, onSmoothDragStart, onSmoothDrag, onSmoothDragEnd };
}
