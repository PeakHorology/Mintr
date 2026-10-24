import { afterAll, describe, expect, it } from "vitest";
import {
  GRIDFINITY_FOOT_HEIGHT,
  GRIDFINITY_LIP_HEIGHT,
  GRIDFINITY_PLATE_HEIGHT,
  GRIDFINITY_DOVETAIL_PROTRUSION,
  GRIDFINITY_TAB_LENGTH,
  defaultGridfinityBaseplateSpec,
  defaultGridfinityBinSpec,
  gridfinityBaseplateFootprint,
  gridfinityBaseplateKey,
  gridfinityBaseplateRecipe,
  gridfinityBinFootprint,
  gridfinityBinKey,
  gridfinityBinRecipe,
  gridfinityDrawerFit,
  gridfinitySplitForBed,
  normalizeGridfinityBaseplateSpec,
  normalizeGridfinityBinSpec,
  type RecipeSection,
} from "@/lib/gridfinity";
import { applyGridfinityKernelMesh, createGridfinityShape, withGridfinityBinSpec } from "@/lib/gridfinityShape";
import { toNativeKernelSolid } from "@/lib/nativeKernelProtocol";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import { extentsFromPositions } from "@/lib/stepExport";
import { hasNativeKernelExe, spawnNativeKernelClient } from "../helpers/nativeKernelChild";

function sectionsOf(recipe: ReturnType<typeof gridfinityBinRecipe>, op: "add" | "cut") {
  return recipe.ops
    .filter((entry) => entry.op === op && entry.solid.kind === "stack")
    .map((entry) => (entry.solid as { sections: RecipeSection[] }).sections);
}

describe("gridfinity spec", () => {
  it("normalizes and clamps a bin spec", () => {
    const spec = normalizeGridfinityBinSpec({ unitsX: 0, unitsZ: 99, heightUnits: 2.4, wallThickness: 0.1, openSides: ["front", "front", "nowhere" as never], scoop: "front" });
    expect(spec.unitsX).toBe(1);
    expect(spec.unitsZ).toBe(16);
    expect(spec.heightUnits).toBe(2);
    expect(spec.wallThickness).toBe(0.8);
    expect(spec.openSides).toEqual(["front"]);
    // A scoop cannot sit on an open side.
    expect(spec.scoop).toBe("none");
  });

  it("sizes a bin 0.5 mm under pitch with 7 mm units plus the lip", () => {
    const foot = gridfinityBinFootprint(normalizeGridfinityBinSpec({ unitsX: 2, unitsZ: 3, heightUnits: 4 }));
    expect(foot.width).toBeCloseTo(83.5);
    expect(foot.depth).toBeCloseTo(125.5);
    expect(foot.height).toBeCloseTo(28 + GRIDFINITY_LIP_HEIGHT);
    const noLip = gridfinityBinFootprint(normalizeGridfinityBinSpec({ heightUnits: 4, stackingLip: false }));
    expect(noLip.height).toBeCloseTo(28);
  });

  it("extends an open side to the grid edge so bins join into a tray", () => {
    const foot = gridfinityBinFootprint(normalizeGridfinityBinSpec({ unitsX: 1, unitsZ: 1, openSides: ["right"] }));
    expect(foot.width).toBeCloseTo(41.75);
    expect(foot.offsetX).toBeCloseTo(0.125);
    const recipe = gridfinityBinRecipe(normalizeGridfinityBinSpec({ unitsX: 1, unitsZ: 1, openSides: ["right"] }));
    const body = sectionsOf(recipe, "add")[0];
    // Right edge reaches the pitch boundary, left keeps the 0.25 gap (shifted to the AABB centre).
    expect(body[0].x1 - body[0].x0).toBeCloseTo(41.75);
    // Open corners are square so the next bin's wall continues the outline.
    expect(body[0].r[1]).toBe(0);
    expect(body[0].r[2]).toBe(0);
    expect(body[0].r[0]).toBeCloseTo(3.75);
  });

  it("builds the stacking lip socket from the spec profile", () => {
    const spec = normalizeGridfinityBinSpec({ unitsX: 1, unitsZ: 1, heightUnits: 3, wallThickness: 1.2 });
    const recipe = gridfinityBinRecipe(spec);
    const cavity = sectionsOf(recipe, "cut")[0];
    const ys = cavity.map((s) => s.y);
    expect(ys[0]).toBeCloseTo(GRIDFINITY_FOOT_HEIGHT + 2.25);
    expect(ys).toContainEqual(expect.closeTo(21, 5));
    expect(ys).toContainEqual(expect.closeTo(21.7, 5));
    expect(ys).toContainEqual(expect.closeTo(23.5, 5));
    expect(ys).toContainEqual(expect.closeTo(25.4, 5));
    const atWallTop = cavity.find((s) => Math.abs(s.y - 21) < 1e-6)!;
    expect(atWallTop.x1 - atWallTop.x0).toBeCloseTo(41.5 - 2 * 2.6);
    const knife = cavity.find((s) => Math.abs(s.y - 25.4) < 1e-6)!;
    expect(knife.x1 - knife.x0).toBeCloseTo(41.5);
    // Four feet with the 0.8 / 1.8 / 2.15 profile.
    const feet = sectionsOf(recipe, "add").slice(1);
    expect(feet).toHaveLength(1);
    expect(feet[0][0].x1 - feet[0][0].x0).toBeCloseTo(35.6);
    expect(feet[0][1].y).toBeCloseTo(0.8);
    expect(feet[0][2].y).toBeCloseTo(2.6);
    expect(feet[0][3].y).toBeCloseTo(GRIDFINITY_FOOT_HEIGHT);
  });

  it("drops the cavity but keeps the lip socket on a solid bin", () => {
    const recipe = gridfinityBinRecipe(normalizeGridfinityBinSpec({ unitsX: 1, unitsZ: 1, heightUnits: 2, solid: true }));
    const cuts = sectionsOf(recipe, "cut");
    expect(cuts).toHaveLength(1);
    expect(cuts[0][0].y).toBeCloseTo(14);
    expect(cuts[0][0].x1 - cuts[0][0].x0).toBeCloseTo(41.5 - 5.2);
  });

  it("adds magnet pockets, screw holes, dividers and a scoop", () => {
    const recipe = gridfinityBinRecipe(normalizeGridfinityBinSpec({
      unitsX: 2, unitsZ: 1, heightUnits: 3, magnets: true, screws: true, compartmentsX: 2, compartmentsZ: 2, scoop: "front",
    }));
    const cylinders = recipe.ops.filter((op) => op.solid.kind === "cylinder");
    expect(cylinders).toHaveLength(2 * 4 * 2);
    const boxes = recipe.ops.filter((op) => op.op === "add" && op.solid.kind === "box");
    expect(boxes).toHaveLength(2);
    const prism = recipe.ops.find((op) => op.solid.kind === "prism");
    expect(prism?.op).toBe("add");
    expect((prism?.solid as { axis: string }).axis).toBe("x");
  });

  it("keys change only with geometry", () => {
    const a = normalizeGridfinityBinSpec({});
    expect(gridfinityBinKey(a)).toBe(gridfinityBinKey({ ...a }));
    expect(gridfinityBinKey({ ...a, magnets: true })).not.toBe(gridfinityBinKey(a));
    const plate = normalizeGridfinityBaseplateSpec({});
    expect(gridfinityBaseplateKey({ ...plate, drawerWidth: 300 })).toBe(gridfinityBaseplateKey(plate));
    expect(gridfinityBaseplateKey({ ...plate, padLeft: 3 })).not.toBe(gridfinityBaseplateKey(plate));
  });

  it("sizes a baseplate from units, padding, floor and tabs", () => {
    const plain = gridfinityBaseplateFootprint(normalizeGridfinityBaseplateSpec({ unitsX: 3, unitsZ: 2 }));
    expect(plain.width).toBeCloseTo(126);
    expect(plain.depth).toBeCloseTo(84);
    expect(plain.height).toBeCloseTo(GRIDFINITY_PLATE_HEIGHT);
    const padded = normalizeGridfinityBaseplateSpec({ unitsX: 3, unitsZ: 2, padLeft: 5, padRight: 2.5, magnets: true, connectors: { right: "tab" } });
    // Magnets force a floor; the tab adds to the width and shifts the centre.
    expect(padded.floorThickness).toBe(3);
    const foot = gridfinityBaseplateFootprint(padded);
    expect(foot.width).toBeCloseTo(126 + 7.5 + GRIDFINITY_TAB_LENGTH);
    expect(foot.offsetX).toBeCloseTo((-63 - 5 + 63 + 2.5 + GRIDFINITY_TAB_LENGTH) / 2);
    expect(foot.height).toBeCloseTo(3 + GRIDFINITY_PLATE_HEIGHT);
  });

  it("cuts one pocket per cell with the 2.15 / 1.8 / 0.7 profile", () => {
    const recipe = gridfinityBaseplateRecipe(normalizeGridfinityBaseplateSpec({ unitsX: 2, unitsZ: 1 }));
    const pockets = sectionsOf(recipe, "cut");
    expect(pockets).toHaveLength(2);
    const pocket = pockets[0];
    const top = pocket.find((s) => Math.abs(s.y - GRIDFINITY_PLATE_HEIGHT) < 1e-6)!;
    expect(top.x1 - top.x0).toBeCloseTo(42);
    const vertical = pocket.find((s) => Math.abs(s.y - (GRIDFINITY_PLATE_HEIGHT - 2.15)) < 1e-6)!;
    expect(vertical.x1 - vertical.x0).toBeCloseTo(37.7);
    const bottom = pocket.find((s) => Math.abs(s.y) < 1e-6)!;
    expect(bottom.x1 - bottom.x0).toBeCloseTo(36.3);
    // Open frame: the pocket runs through the bottom.
    expect(Math.min(...pocket.map((s) => s.y))).toBeLessThan(0);
  });

  it("fits a drawer with even padding", () => {
    const spec = gridfinityDrawerFit(300, 200, defaultGridfinityBaseplateSpec());
    expect(spec.unitsX).toBe(7);
    expect(spec.unitsZ).toBe(4);
    expect(spec.padLeft).toBeCloseTo(2.7);
    expect(spec.padRight).toBeCloseTo(2.7);
    expect(spec.padFront).toBeCloseTo(15.7);
    const foot = gridfinityBaseplateFootprint(spec);
    expect(foot.width).toBeLessThanOrEqual(300);
    expect(foot.depth).toBeLessThanOrEqual(200);
  });

  it("splits a plate for the bed and pairs tabs with slots", () => {
    const spec = normalizeGridfinityBaseplateSpec({ unitsX: 7, unitsZ: 4, padLeft: 3, padRight: 3 });
    expect(gridfinitySplitForBed(spec, { width: 400, depth: 400 }, { connectors: true })).toBeNull();
    const pieces = gridfinitySplitForBed(spec, { width: 220, depth: 220 }, { connectors: true })!;
    expect(pieces).toHaveLength(2);
    const [left, right] = pieces;
    expect(left.spec.unitsX + right.spec.unitsX).toBe(7);
    expect(left.spec.padLeft).toBe(3);
    expect(left.spec.padRight).toBe(0);
    expect(right.spec.padRight).toBe(3);
    expect(left.spec.floorThickness).toBe(0);
    expect(left.spec.connectors).toEqual({ right: "dovetail" });
    expect(right.spec.connectors).toEqual({ left: "groove" });
    for (const piece of pieces) {
      const foot = gridfinityBaseplateFootprint(piece.spec);
      expect(foot.width).toBeLessThanOrEqual(210);
      expect(foot.depth).toBeLessThanOrEqual(210);
    }
    expect(right.gridX).toBeGreaterThan(left.gridX);
  });

  it("splits an open plate on a 200 mm bed into dovetailed frames with no floor", () => {
    const spec = normalizeGridfinityBaseplateSpec({ unitsX: 8, unitsZ: 8, floorThickness: 0 });
    const pieces = gridfinitySplitForBed(spec, { width: 200, depth: 200 }, { connectors: true })!;
    expect(pieces).toHaveLength(4);
    for (const piece of pieces) {
      expect(piece.spec.floorThickness).toBe(0);
      expect(piece.spec.unitsX).toBe(4);
      expect(piece.spec.unitsZ).toBe(4);
      expect(piece.spec.connectors?.right === "tab" || piece.spec.connectors?.left === "slot").toBe(false);
    }
    const corner = pieces.find((piece) => piece.col === 1 && piece.row === 1)!;
    expect(corner.spec.connectors).toEqual({ left: "groove", back: "groove" });
    expect(gridfinityBaseplateFootprint(corner.spec).height).toBeCloseTo(GRIDFINITY_PLATE_HEIGHT);
  });

  it("keeps tabs and slots when a solid baseplate is split", () => {
    const spec = normalizeGridfinityBaseplateSpec({ unitsX: 7, unitsZ: 2, floorThickness: 4 });
    const pieces = gridfinitySplitForBed(spec, { width: 220, depth: 400 }, { connectors: true })!;
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces[0].spec.floorThickness).toBe(4);
    expect(pieces[0].spec.connectors?.right).toBe("tab");
    expect(pieces.at(-1)?.spec.connectors?.left).toBe("slot");
  });

  it("cuts dovetails into an open frame and leaves the bottom open", () => {
    const spec = normalizeGridfinityBaseplateSpec({
      unitsX: 2,
      unitsZ: 2,
      connectors: { right: "dovetail", left: "groove" },
    });
    expect(spec.floorThickness).toBe(0);
    const recipe = gridfinityBaseplateRecipe(spec);
    const added = recipe.ops.filter((op) => op.op === "add" && op.solid.kind === "prism");
    const grooves = recipe.ops.filter((op) => op.op === "cut" && op.solid.kind === "prism");
    expect(added).toHaveLength(1);
    expect(grooves).toHaveLength(1);
    expect(added[0].solid).toMatchObject({ axis: "y" });
    const pockets = recipe.ops.filter((op) => op.op === "cut" && op.solid.kind === "stack");
    expect(pockets).toHaveLength(6);
    const foot = gridfinityBaseplateFootprint(spec);
    expect(foot.width).toBeCloseTo(84 + GRIDFINITY_DOVETAIL_PROTRUSION);
    expect(foot.height).toBeCloseTo(GRIDFINITY_PLATE_HEIGHT);
  });

  it("snaps a dragged size back to whole units", () => {
    const shape = createGridfinityShape("gridfinityBin", { x: 0, z: 0 });
    const dragged = canonicalizeShape({ ...shape, width: 120, height: 40 });
    expect(dragged.gridfinityBin?.unitsX).toBe(3);
    expect(dragged.gridfinityBin?.heightUnits).toBe(5);
    expect(dragged.width).toBeCloseTo(125.5);
    expect(dragged.height).toBeCloseTo(35 + GRIDFINITY_LIP_HEIGHT);
    expect(dragged.name).toBe("Gridfinity Bin 3×2×5");
    const renamed = withGridfinityBinSpec({ ...shape, name: "Screws" }, { unitsZ: 4 });
    expect(renamed.name).toBe("Screws");
  });

  it("encodes a pending shape as a recipe operand for the native kernel", () => {
    const shape = createGridfinityShape("gridfinityBaseplate");
    const solid = toNativeKernelSolid(shape);
    expect(solid?.kind).toBe("recipe");
    expect(solid?.recipe?.ops[0].op).toBe("add");
    expect(solid?.height).toBeCloseTo(GRIDFINITY_PLATE_HEIGHT);
  });

  it("rejects a kernel mesh whose size disagrees with the spec", () => {
    const shape = createGridfinityShape("gridfinityBin");
    const bad = applyGridfinityKernelMesh(shape, [0, 0, 0, 10, 0, 0, 0, 10, 0], undefined, [0, 1, 2], "DBRep_DrawableShape", "k");
    expect(bad).toBeNull();
  });
});

describe.skipIf(!hasNativeKernelExe)("gridfinity bodies from MintrKernel.exe", () => {
  const client = spawnNativeKernelClient();
  afterAll(() => client.close());

  async function build(id: number, shape: ReturnType<typeof createGridfinityShape>) {
    const job = (await import("@/lib/gridfinityShape")).serializeGridfinityBuildJob(shape)!;
    const reply = await client.request({ id, ...job }, 120000);
    expect(reply.ok, `${shape.name}: ${String(reply.message)}`).toBe(true);
    expect(reply.fallback).not.toBe(true);
    const positions = reply.positions as number[];
    expect(positions.length).toBeGreaterThan(9 * 50);
    const extents = extentsFromPositions(positions)!;
    expect(extents.width).toBeCloseTo(shape.width ?? 0, 0);
    expect(extents.depth).toBeCloseTo(shape.depth ?? 0, 0);
    expect(extents.height).toBeCloseTo(shape.height, 0);
    expect(String(reply.cadBrep ?? "").length).toBeGreaterThan(200);
    const applied = applyGridfinityKernelMesh(shape, positions, reply.normals as number[], reply.indices as number[], String(reply.cadBrep), job.key);
    expect(applied?.gridfinityBuilt).toBe(job.key);
    expect(applied?.cadBrep).toBeTruthy();
    return reply;
  }

  async function volume(id: number, shape: ReturnType<typeof createGridfinityShape>) {
    const reply = await client.request({ id, type: "measure", solids: [toNativeKernelSolid(shape)] }, 120000);
    expect(reply.ok, String(reply.message)).toBe(true);
    return Number(reply.volume);
  }

  it("builds a default 2×2×3 bin with lip", async () => {
    const shape = createGridfinityShape("gridfinityBin");
    await build(900, shape);
    const v = await volume(901, shape);
    // Hollow bin: far less than its bounding box, more than its walls alone.
    const box = shape.width! * shape.depth! * shape.height;
    expect(v).toBeGreaterThan(box * 0.08);
    expect(v).toBeLessThan(box * 0.5);
  }, 180000);

  it("builds a bin with every feature on", async () => {
    const shape = withGridfinityBinSpec(createGridfinityShape("gridfinityBin"), {
      unitsX: 2,
      unitsZ: 1,
      heightUnits: 4,
      magnets: true,
      screws: true,
      compartmentsX: 2,
      compartmentsZ: 2,
      scoop: "front",
    });
    const plain = withGridfinityBinSpec(shape, { magnets: false, screws: false, compartmentsX: 1, compartmentsZ: 1, scoop: "none" });
    const reply = await build(910, shape);
    // Scoop on the front wall: its curved tessellation sits mid-cavity on +z only
    // (same orientation check as the brepjs fallback e2e test).
    const positions = reply.positions as number[];
    const floorTop = 4.75 + 2.25;
    let front = 0;
    let back = 0;
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const y = positions[i + 1];
      if (y < floorTop + 0.5 || y > floorTop + 8) continue;
      if (positions[i + 2] > 0) front += 1;
      else back += 1;
    }
    expect(front).toBeGreaterThan(8);
    expect(back).toBe(0);
    const featured = await volume(911, shape);
    const bare = await volume(912, plain);
    // Dividers and the scoop add material; pockets take a little away.
    expect(featured).toBeGreaterThan(bare);
  }, 180000);

  it("builds open-sided, solid, and lipless bins", async () => {
    await build(920, withGridfinityBinSpec(createGridfinityShape("gridfinityBin"), { unitsX: 1, unitsZ: 2, openSides: ["right", "front"] }));
    const solid = withGridfinityBinSpec(createGridfinityShape("gridfinityBin"), { unitsX: 1, unitsZ: 1, heightUnits: 2, solid: true });
    await build(921, solid);
    const v = await volume(922, solid);
    expect(v).toBeGreaterThan(41.5 * 41.5 * 14 * 0.7);
    await build(923, withGridfinityBinSpec(createGridfinityShape("gridfinityBin"), { unitsX: 1, unitsZ: 1, heightUnits: 1, stackingLip: false }));
  }, 180000);

  it("builds an open-frame baseplate and a floored one with magnets, screws and tabs", async () => {
    const frame = createGridfinityShape("gridfinityBaseplate");
    await build(930, frame);
    const floored = createGridfinityShape("gridfinityBaseplate", undefined, {
      gridfinityBaseplate: { ...defaultGridfinityBaseplateSpec(), unitsX: 2, unitsZ: 2, padLeft: 4, magnets: true, screws: true, connectors: { right: "tab", back: "slot" } },
    });
    await build(931, floored);
    const v = await volume(932, floored);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(floored.width! * floored.depth! * floored.height);
    const dovetailed = createGridfinityShape("gridfinityBaseplate", undefined, {
      gridfinityBaseplate: {
        ...defaultGridfinityBaseplateSpec(),
        unitsX: 2,
        unitsZ: 2,
        connectors: { right: "dovetail", left: "groove" },
      },
    });
    await build(933, dovetailed);
    const open = await volume(934, dovetailed);
    expect(open).toBeGreaterThan(0);
    expect(dovetailed.height).toBeCloseTo(GRIDFINITY_PLATE_HEIGHT);
  }, 180000);

  it("participates in a native boolean as a recipe operand", async () => {
    const bin = createGridfinityShape("gridfinityBin", { x: 0, z: 0 });
    const cutter = {
      ...createGridfinityShape("gridfinityBin", { x: 0, z: 0 }),
      kind: "box" as const,
      hole: true,
      width: 10,
      depth: 10,
      height: 60,
      size: 10,
      gridfinityBin: undefined,
      elevation: -5,
    };
    const reply = await client.request({
      id: 940,
      type: "boolean",
      op: "subtract",
      solids: [toNativeKernelSolid(bin), toNativeKernelSolid(cutter)],
    }, 120000);
    expect(reply.ok, String(reply.message)).toBe(true);
    expect(String(reply.brepStep ?? "")).toContain("ISO-10303");
    void defaultGridfinityBinSpec;
  }, 180000);
});
