import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowSyncBooleanKernelOnUiThread,
  occtBooleanMeshShape,
  remeshCsgGroupFromWorldChildren,
  restoreGroupedChildren,
} from "@/lib/editorBoolean";
import {
  booleanWorkingQuality,
  isHeavyBooleanSelection,
  LIVE_OCCT_BOOLEAN_OPERANDS,
  shouldSkipLiveOcctBoolean,
} from "@/lib/displayTriangleCount";
import { setActiveDisplayQuality } from "@/lib/displayTessellation";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(id: string, x = 0): WorkplaneShape {
  return {
    id,
    name: id,
    kind: "box",
    color: "#d41721",
    x,
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

function cylinder(id: string, x = 0): WorkplaneShape {
  return { ...box(id, x), kind: "cylinder" };
}

describe("Group scale for multi-body parts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips live OCCT once the selection is larger than a handful of solids", () => {
    const few = [box("a"), box("b"), box("c")];
    const many = Array.from({ length: LIVE_OCCT_BOOLEAN_OPERANDS + 1 }, (_, i) => box(`b${i}`, i * 22));
    expect(shouldSkipLiveOcctBoolean(few)).toBe(false);
    expect(shouldSkipLiveOcctBoolean(many)).toBe(true);
    expect(isHeavyBooleanSelection(many)).toBe(true);
  });

  it("tessellates large Groups at draft even when the viewport is Smooth", () => {
    const many = Array.from({ length: 20 }, (_, i) => cylinder(`c${i}`, i * 25));
    setActiveDisplayQuality("smooth");
    expect(booleanWorkingQuality(many, "smooth")).toBe("draft");
    expect(booleanWorkingQuality([cylinder("a"), cylinder("b")], "smooth")).toBe("standard");
    expect(booleanWorkingQuality([box("a"), box("b")], "draft")).toBe("draft");
  });

  it("does not load OCCT for a 9-solid Group", async () => {
    const many = Array.from({ length: 9 }, (_, i) => box(`b${i}`, i * 22));
    const start = performance.now();
    expect(await occtBooleanMeshShape(many, "union")).toBeNull();
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("does not load occt-wasm to fuse a cylinder into a box", async () => {
    const start = performance.now();
    expect(await occtBooleanMeshShape([box("block"), cylinder("round", 8)], "union")).toBeNull();
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("asks MintrKernel to overshoot a flush hole so Group cuts through", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      positions: [0, 0, 0, 20, 0, 0, 0, 20, 0],
      brepStep: "ISO-10303-21;",
      quality: "exact",
    }));
    vi.stubGlobal("window", { peakcadKernel: { request } });
    const solid = box("block");
    const hole: WorkplaneShape = { ...box("bore"), kind: "cylinder", hole: true, width: 8, depth: 8, size: 8 };
    await occtBooleanMeshShape([solid, hole], "subtract");
    expect(request).toHaveBeenCalled();
    const job = request.mock.calls[0]?.[0] as { type?: string; op?: string; solids?: Array<{ hole?: boolean; height?: number; elevation?: number }> };
    expect(job?.type).toBe("boolean");
    expect(job?.op).toBe("subtract");
    const cutter = job?.solids?.find((solid) => solid.hole);
    expect(cutter?.height ?? 0).toBeGreaterThan(20);
    expect(cutter?.elevation ?? 0).toBeLessThan(0);
  });

  it("asks MintrKernel to fuse a 9-solid Group when the desktop sidecar is present", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      positions: [0, 0, 0, 4, 0, 0, 0, 4, 0],
      brepStep: "ISO-10303-21;",
      quality: "exact",
    }));
    vi.stubGlobal("window", { peakcadKernel: { request } });
    const many = Array.from({ length: 9 }, (_, i) => box(`b${i}`, i * 22));
    await occtBooleanMeshShape(many, "union");
    expect(request).toHaveBeenCalled();
    const job = request.mock.calls[0]?.[0] as { type?: string; solids?: unknown[] };
    expect(job?.type).toBe("boolean");
    expect(job?.solids).toHaveLength(9);
  });

  it("keeps Ungroup as a child restore, not a remesh", () => {
    const children = Array.from({ length: 12 }, (_, i) => box(`b${i}`, i * 22));
    const group: WorkplaneShape = {
      ...box("group"),
      kind: "mesh",
      width: 12 * 22,
      size: 12 * 22,
      groupedBaseWidth: 12 * 22,
      groupedBaseDepth: 20,
      groupedBaseHeight: 20,
      groupedShapes: children,
    };
    const restored = restoreGroupedChildren(group);
    expect(restored).toHaveLength(12);
    expect(restored.every((shape) => shape.kind === "box")).toBe(true);
  });

  it("allows sync kernels only outside the browser window", () => {
    expect(allowSyncBooleanKernelOnUiThread()).toBe(true);
  });

  it("draft remesh of a Group does not load OCCT", async () => {
    const children = [box("a", 0), box("b", 10)];
    const group: WorkplaneShape = {
      ...box("group"),
      kind: "mesh",
      width: 30,
      size: 30,
      groupedBaseWidth: 30,
      groupedBaseDepth: 20,
      groupedBaseHeight: 20,
      groupedShapes: children,
      csg: { op: "union", version: 1 },
    };
    const start = performance.now();
    const remeshed = await remeshCsgGroupFromWorldChildren(group, children, { skipOcct: true, draft: true });
    expect(performance.now() - start).toBeLessThan(250);
    expect(remeshed?.importedMesh?.positions.length).toBeGreaterThan(8);
  });
});
