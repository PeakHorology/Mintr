import { describe, expect, it } from "vitest";
import { buildFaceBody, faceDraftsToBuild, joinedFaceDrafts, rememberFaceDraft } from "@/lib/faceBody";
import { faceOutlineFromLoop, insetPolygon, roundPolygonCorners } from "@/lib/faceOutline";
import { circleFromClosedPath } from "@/lib/sketchProfileShape";
import { orderedSketchPaths } from "@/lib/sketch/profiles";
import type { CadPlanarFace } from "@/lib/cadModifierTypes";
import type { WorkplaneShape } from "@/types/sketchforge";

const square = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
];

function box(): WorkplaneShape {
  return {
    id: "box-1",
    name: "Box",
    kind: "box",
    color: "#c4a574",
    x: 0,
    z: 0,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
  };
}

function topFace(): CadPlanarFace {
  return {
    id: 0,
    origin: { x: 0, y: 20, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    points: [-10, 20, -10, 10, 20, -10, 10, 20, 10, -10, 20, 10],
    area: 400,
  };
}

describe("face outline", () => {
  it("insets a square and drops a sampled midpoint", () => {
    const inset = insetPolygon(faceOutlineFromLoop([
      { x: 0, z: 0 },
      { x: 5, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
    ], 0, 0), 1);
    expect(inset).toEqual([
      { x: 1, z: 1 },
      { x: 9, z: 1 },
      { x: 9, z: 9 },
      { x: 1, z: 9 },
    ]);
  });

  it("rounds a sampled rectangle by the typed radius, not the sample spacing", () => {
    const loop = [];
    const edge = (from: { x: number; z: number }, to: { x: number; z: number }, count: number) => {
      for (let step = 0; step < count; step += 1) {
        const t = step / count;
        loop.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
      }
    };
    edge({ x: -10, z: -10 }, { x: 10, z: -10 }, 8);
    edge({ x: 10, z: -10 }, { x: 10, z: 10 }, 8);
    edge({ x: 10, z: 10 }, { x: -10, z: 10 }, 8);
    edge({ x: -10, z: 10 }, { x: -10, z: -10 }, 8);
    const radius = 4;
    const rounded = faceOutlineFromLoop(loop, 0, radius);
    const center = { x: 6, z: 6 };
    const onArc = rounded.filter((point) => Math.hypot(point.x - 10, point.z - 10) < radius * 1.2);
    expect(onArc.length).toBeGreaterThan(2);
    for (const point of onArc) {
      expect(Math.hypot(point.x - center.x, point.z - center.z)).toBeCloseTo(radius, 1);
    }
  });

  it("drops an outline that the inset eats", () => {
    expect(faceOutlineFromLoop(square, 6, 0)).toEqual([]);
  });

  it("uses the typed radius as the arc radius on a square corner", () => {
    const radius = 4;
    const rounded = roundPolygonCorners([
      { x: -10, z: -10 },
      { x: 10, z: -10 },
      { x: 10, z: 10 },
      { x: -10, z: 10 },
    ], radius, 8);
    const center = { x: 6, z: 6 };
    const onArc = rounded.filter((point) => Math.hypot(point.x - center.x, point.z - center.z) < radius + 0.05
      && Math.hypot(point.x - 10, point.z - 10) < radius * 1.5);
    expect(onArc.length).toBeGreaterThan(2);
    for (const point of onArc) {
      expect(Math.hypot(point.x - center.x, point.z - center.z)).toBeCloseTo(radius, 2);
    }
    expect(rounded.some((point) => Math.hypot(point.x - 10, point.z - 6) < 0.05)).toBe(true);
  });

  it("keeps the typed radius on a sharp corner, not only a square", () => {
    const radius = 2;
    const loop = [
      { x: 0, z: 0 },
      { x: 20, z: 0 },
      { x: 10, z: 4 },
    ];
    const rounded = roundPolygonCorners(loop, radius, 8);
    const corner = loop[2];
    const arc = rounded.filter((point) => Math.hypot(point.x - corner.x, point.z - corner.z) < 3);
    expect(arc.length).toBeGreaterThan(3);
    // Tangent point on the incoming edge is the first of this corner's arc.
    const start = arc[0];
    const inbound = { x: corner.x - loop[1].x, z: corner.z - loop[1].z };
    const inboundLen = Math.hypot(inbound.x, inbound.z);
    const edge = { x: inbound.x / inboundLen, z: inbound.z / inboundLen };
    const left = { x: -edge.z, z: edge.x };
    const center = { x: start.x + left.x * radius, z: start.z + left.z * radius };
    for (const point of arc) {
      expect(Math.hypot(point.x - center.x, point.z - center.z)).toBeCloseTo(radius, 2);
    }
    const edgeDistance = Math.abs((center.x - loop[1].x) * edge.z - (center.z - loop[1].z) * edge.x);
    expect(edgeDistance).toBeCloseTo(radius, 2);
  });

  it("rounds a square corner inward and closes a notch that is too narrow", () => {
    const rounded = roundPolygonCorners(square, 1, 4);
    expect(rounded.length).toBeGreaterThan(4);
    expect(rounded.every((point) => point.x >= -0.01 && point.x <= 10.01 && point.z >= -0.01 && point.z <= 10.01)).toBe(true);
    expect(rounded.some((point) => Math.hypot(point.x - 9.707, point.z - 0.293) < 0.2)).toBe(true);
    expect(Math.min(...rounded.map((point) => Math.hypot(point.x - 10, point.z)))).toBeGreaterThan(0.3);
    const fullRound = faceOutlineFromLoop(square, 0, 6);
    expect(fullRound.length).toBeGreaterThan(8);
    for (const point of fullRound) {
      expect(Math.hypot(point.x - 5, point.z - 5)).toBeCloseTo(5, 1);
    }
  });
});

describe("face body", () => {
  it("keeps a typed corner radius on the built sketch", () => {
    const radius = 4;
    const result = buildFaceBody({
      host: box(),
      face: topFace(),
      direction: "out",
      inset: 0,
      cornerRadius: radius,
      depth: 2,
    });
    const points = result.shape?.sketchProfile?.points ?? [];
    const center = { x: 6, z: 6 };
    const onArc = points.filter((point) => {
      const fromCorner = Math.hypot(point.x - 10, point.z - 10);
      const fromCenter = Math.hypot(point.x - center.x, point.z - center.z);
      return fromCorner < radius * 1.5 && fromCenter < radius + 0.2;
    });
    expect(onArc.length).toBeGreaterThan(2);
    for (const point of onArc) {
      expect(Math.hypot(point.x - center.x, point.z - center.z)).toBeCloseTo(radius, 1);
    }
    const shape = result.shape!;
    const mesh = shape.importedMesh!;
    const scaleX = shape.width / mesh.baseWidth;
    const scaleY = shape.height / mesh.baseHeight;
    const scaleZ = shape.depth / mesh.baseDepth;
    const worldCenter = { x: 6, y: 20, z: 6 };
    const radii: number[] = [];
    for (let index = 0; index < mesh.positions.length; index += 3) {
      const x = shape.x + mesh.positions[index] * scaleX;
      const y = (shape.elevation ?? 0) + mesh.positions[index + 1] * scaleY;
      const z = shape.z + mesh.positions[index + 2] * scaleZ;
      if (Math.abs(y - 20) > 0.2) continue;
      const fromCorner = Math.hypot(x - 10, z - 10);
      if (fromCorner > radius * 1.2 || fromCorner < 0.3) continue;
      radii.push(Math.hypot(x - worldCenter.x, z - worldCenter.z));
    }
    expect(radii.length).toBeGreaterThan(2);
    for (const value of radii) expect(value).toBeCloseTo(radius, 1);
  });

  it("keeps a 1 mm corner radius as a rounded rectangle, not a circle", () => {
    for (const cornerRadius of [1, 0.5]) {
      const result = buildFaceBody({
        host: box(),
        face: topFace(),
        direction: "out",
        inset: 0,
        cornerRadius,
        depth: 2,
      });
      const shape = result.shape!;
      const profile = shape.sketchProfile!;
      const loop = orderedSketchPaths(profile).find((path) => path.closed);
      expect(circleFromClosedPath(loop!)).toBeNull();
      const mesh = shape.importedMesh!;
      const scaleX = shape.width / mesh.baseWidth;
      const scaleY = shape.height / mesh.baseHeight;
      const scaleZ = shape.depth / mesh.baseDepth;
      const top: { x: number; z: number }[] = [];
      for (let index = 0; index < mesh.positions.length; index += 3) {
        const x = shape.x + mesh.positions[index] * scaleX;
        const y = (shape.elevation ?? 0) + mesh.positions[index + 1] * scaleY;
        const z = shape.z + mesh.positions[index + 2] * scaleZ;
        if (Math.abs(y - 22) > 0.2) continue;
        top.push({ x, z });
      }
      expect(Math.max(...top.map((point) => Math.abs(point.x)))).toBeCloseTo(10, 1);
      expect(Math.max(...top.map((point) => Math.abs(point.z)))).toBeCloseTo(10, 1);
      const center = { x: 10 - cornerRadius, z: 10 - cornerRadius };
      const arc = top.filter((point) => Math.hypot(point.x - 10, point.z - 10) < cornerRadius * 1.4);
      expect(arc.length).toBeGreaterThan(2);
      for (const point of arc) {
        expect(Math.hypot(point.x - center.x, point.z - center.z)).toBeCloseTo(cornerRadius, 1);
      }
    }
  });

  it("still treats a 12-sided circle as a circle", () => {
    const points = Array.from({ length: 12 }, (_, index) => {
      const angle = (index / 12) * Math.PI * 2;
      return { id: `p${index}`, x: Math.cos(angle) * 8, z: Math.sin(angle) * 8 };
    });
    const path = {
      closed: true,
      points,
      steps: points.map((point, index) => ({
        from: point,
        to: points[(index + 1) % points.length],
        segment: {
          id: `s${index}`,
          startId: point.id,
          endId: points[(index + 1) % points.length].id,
          kind: "line" as const,
        },
      })),
    };
    const circle = circleFromClosedPath(path);
    expect(circle).not.toBeNull();
    expect(circle!.radius).toBeCloseTo(8, 2);
  });

  it("builds an outward pad on the top face as a sketch", () => {
    const result = buildFaceBody({
      host: box(),
      face: topFace(),
      direction: "out",
      inset: 0,
      cornerRadius: 0,
      depth: 3,
    });
    expect(result.error).toBeNull();
    expect(result.shape?.name).toBe("Face");
    expect(result.shape?.hole).toBe(false);
    expect(result.shape?.sketchProfile?.segments.length).toBeGreaterThan(2);
    expect(result.shape?.height).toBeCloseTo(3, 1);
    expect(result.shape?.elevation).toBeCloseTo(20, 1);
  });

  it("clamps a pocket to the body behind the face", () => {
    const result = buildFaceBody({
      host: box(),
      face: topFace(),
      direction: "in",
      inset: 2,
      cornerRadius: 0,
      depth: 100,
    });
    expect(result.notice).toMatch(/no deeper/);
    expect(result.shape?.hole).toBe(true);
    expect(result.shape?.name).toBe("Pocket");
    expect(result.depth).toBeLessThanOrEqual(20);
    expect((result.shape?.elevation ?? 0) + (result.shape?.height ?? 0)).toBeCloseTo(20, 0);
  });

  it("keeps the inset as the far wall when asked", () => {
    const result = buildFaceBody({
      host: box(),
      face: topFace(),
      direction: "in",
      inset: 2,
      cornerRadius: 0,
      depth: 100,
      keepFarWall: true,
    });
    expect(result.notice).toMatch(/one inset short/);
    expect(result.depth).toBeCloseTo(18, 5);
    expect(result.shape?.elevation ?? 0).toBeCloseTo(2, 1);
    const thin = buildFaceBody({
      host: box(),
      face: topFace(),
      direction: "in",
      inset: 20,
      cornerRadius: 0,
      depth: 5,
      keepFarWall: true,
    });
    expect(thin.shape).toBeNull();
  });

  it("cuts into the body when the face normal points inward", () => {
    const result = buildFaceBody({
      host: box(),
      face: { ...topFace(), normal: { x: 0, y: -1, z: 0 } },
      direction: "in",
      inset: 0,
      cornerRadius: 0,
      depth: 4,
    });
    expect(result.notice).toBeNull();
    expect(result.depth).toBeCloseTo(4, 1);
    expect(result.shape?.hole).toBe(true);
    expect((result.shape?.elevation ?? 0) + (result.shape?.height ?? 0)).toBeCloseTo(20, 0);
    expect(result.shape?.elevation ?? 0).toBeCloseTo(16, 0);
  });
});

describe("another face", () => {
  it("keeps every added face and applies later edits to all of them", () => {
    const first = {
      faceId: 3,
      direction: "out" as const,
      inset: 1,
      cornerRadius: 1,
      depth: 2,
    };
    const kept = rememberFaceDraft([], first);
    expect(faceDraftsToBuild(kept, null)).toEqual([first]);
    const next = faceDraftsToBuild(kept, {
      faceId: 1,
      direction: "in",
      inset: 4,
      cornerRadius: 0.5,
      depth: 6,
    });
    expect(next).toEqual([
      { faceId: 3, direction: "in", inset: 4, cornerRadius: 0.5, depth: 6 },
      { faceId: 1, direction: "in", inset: 4, cornerRadius: 0.5, depth: 6 },
    ]);
  });

  it("leaves a column at the typed depth, and joins opposite faces when asked", () => {
    const host = box();
    const top = topFace();
    const bottom: CadPlanarFace = {
      id: 5,
      origin: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: -1, z: 0 },
      points: [-10, 0, -10, -10, 0, 10, 10, 0, 10, 10, 0, -10],
      area: 400,
    };
    const drafts = [
      { faceId: top.id, direction: "in" as const, inset: 2, cornerRadius: 0, depth: 2 },
      { faceId: bottom.id, direction: "in" as const, inset: 2, cornerRadius: 0, depth: 2 },
    ];
    const separate = joinedFaceDrafts(host, [top, bottom], drafts, false);
    expect(separate.map((draft) => draft.depth)).toEqual([2, 2]);
    expect(separate.every((draft) => !draft.passThrough && draft.keepFarWall)).toBe(true);

    const joined = joinedFaceDrafts(host, [top, bottom], drafts, true);
    expect(joined.every((draft) => draft.passThrough && !draft.keepFarWall)).toBe(true);
    for (const draft of joined) expect(draft.depth).toBeGreaterThan(20);

    const pocket = buildFaceBody({
      host,
      face: top,
      direction: "in",
      inset: 2,
      cornerRadius: 0,
      depth: joined[0].depth,
      passThrough: true,
    });
    expect(pocket.notice).toBeNull();
    expect(pocket.depth).toBeGreaterThan(20);
    expect(pocket.shape?.elevation ?? 0).toBeLessThan(0);
    expect((pocket.shape?.elevation ?? 0) + (pocket.shape?.height ?? 0)).toBeCloseTo(20, 0);
  });

  it("opens the shared edge between neighbouring pockets only with Join through", () => {
    const host = box();
    const top = topFace();
    const front: CadPlanarFace = {
      id: 1,
      origin: { x: 0, y: 10, z: 10 },
      normal: { x: 0, y: 0, z: 1 },
      points: [-10, 0, 10, 10, 0, 10, 10, 20, 10, -10, 20, 10],
      area: 400,
    };
    const drafts = [
      { faceId: top.id, direction: "in" as const, inset: 1.5, cornerRadius: 0, depth: 9.2 },
      { faceId: front.id, direction: "in" as const, inset: 1.5, cornerRadius: 0, depth: 9.2 },
    ];

    // Leave column: both pockets keep their inset all round, so the bar along the shared edge stays.
    const column = joinedFaceDrafts(host, [top, front], drafts, false);
    expect(column.every((draft) => draft.keepFarWall && draft.openPlanes.length === 0 && draft.depth === 9.2)).toBe(true);
    const walled = buildFaceBody({ host, face: top, ...column[0] });
    expect(walled.shape?.width).toBeCloseTo(17, 1);
    expect(walled.shape?.depth).toBeCloseTo(17, 1);
    expect(walled.depth).toBeCloseTo(9.2, 5);

    // Join through: the top pocket is not inset along the front edge and runs a little past it,
    // and the front pocket does the same along the top edge, so the two openings become one.
    const joined = joinedFaceDrafts(host, [top, front], drafts, true);
    expect(joined.every((draft) => !draft.passThrough && draft.keepFarWall && draft.openPlanes.length === 1)).toBe(true);
    expect(joined.map((draft) => draft.depth)).toEqual([9.2, 9.2]);
    const opened = buildFaceBody({ host, face: top, ...joined[0] });
    expect(opened.notice).toBeNull();
    expect(opened.shape?.width).toBeCloseTo(17, 1);
    expect(opened.shape?.depth).toBeCloseTo(18.7, 1);
    expect((opened.shape?.z ?? 0) + (opened.shape?.depth ?? 0) / 2).toBeCloseTo(10.2, 1);
    const frontOpened = buildFaceBody({ host, face: front, ...joined[1] });
    expect(frontOpened.notice).toBeNull();
    expect((frontOpened.shape?.elevation ?? 0) + (frontOpened.shape?.height ?? 0)).toBeCloseTo(20.2, 1);
    expect(frontOpened.shape?.elevation ?? 0).toBeCloseTo(1.5, 1);

    // In both modes a pocket stops one inset short of the far side, so the far wall is the inset too.
    const out = buildFaceBody({ host, face: top, ...joinedFaceDrafts(host, [top], [{ ...drafts[0], depth: 100 }], true)[0] });
    expect(out.depth).toBeCloseTo(18.5, 5);
    const stop = buildFaceBody({ host, face: top, ...joinedFaceDrafts(host, [top], [{ ...drafts[0], depth: 100 }], false)[0] });
    expect(stop.depth).toBeCloseTo(18.5, 5);
  });

  it("joins opposite faces when one reported normal points into the body", () => {
    const host = box();
    const top = topFace();
    const bottom: CadPlanarFace = {
      id: 5,
      origin: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      points: [-10, 0, -10, -10, 0, 10, 10, 0, 10, 10, 0, -10],
      area: 400,
    };
    const drafts = [
      { faceId: top.id, direction: "in" as const, inset: 2, cornerRadius: 0, depth: 2 },
      { faceId: bottom.id, direction: "in" as const, inset: 2, cornerRadius: 0, depth: 2 },
    ];
    const joined = joinedFaceDrafts(host, [top, bottom], drafts, true);
    expect(joined.every((draft) => draft.passThrough)).toBe(true);
    for (const draft of joined) expect(draft.depth).toBeGreaterThan(20);
  });
});
