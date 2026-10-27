import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveSketchSweep, sweepSectionPlane, sweepSpec, planSketchSweep } from "@/lib/sketch/sweepPlan";
import { closeOpenPathGaps } from "@/lib/sketch/profiles";
import { sketchDocToProfile } from "@/lib/sketch/migrate";
import { sweepSolid } from "@/lib/sketchSweep";
import { createEmptySketchDoc, type SketchEntity } from "@/lib/sketch/types";
import { defaultSketchPlane } from "@/lib/sketchPlane";
import type { Brep } from "@/lib/brepKernel";
import { buildPeakcadDocument, parsePeakcadDocument, serializePeakcadDocument } from "@/lib/peakcadDocument";
import type { WorkplaneShape } from "@/types/sketchforge";

let brep: Brep;

beforeAll(async () => {
  const brepjs = await import("brepjs");
  const { OcctKernel } = await import("occt-wasm");
  const wasm = join(dirname(fileURLToPath(import.meta.resolve("occt-wasm"))), "occt-wasm.wasm");
  const kernel = await OcctKernel.init({ wasm });
  brepjs.registerKernel("occt-wasm", brepjs.OcctWasmAdapter.fromKernel(kernel));
  brep = brepjs;
});

const point = (id: string, x: number, z: number, extra: Partial<SketchEntity> = {}) => ({ id, kind: "point", x, z, ...extra }) as SketchEntity;
const line = (id: string, startId: string, endId: string) => ({ id, kind: "line", startId, endId }) as SketchEntity;

/** A closed square outline, drawn away from the path. */
function square(size: number, x = -40, z = -40, prefix = "s"): SketchEntity[] {
  const [a, b, c, d] = ["a", "b", "c", "d"].map((name) => `${prefix}${name}`);
  return [
    point(a, x, z), point(b, x + size, z), point(c, x + size, z + size), point(d, x, z + size),
    line(`${a}${b}`, a, b), line(`${b}${c}`, b, c), line(`${c}${d}`, c, d), line(`${d}${a}`, d, a),
  ];
}

function circle(id: string, radius: number, cx = -40, cz = -40, construction = false): SketchEntity[] {
  return [
    point(`${id}-center`, cx, cz),
    { id, kind: "circle", centerId: `${id}-center`, radius, ...(construction ? { construction: true } : {}) } as SketchEntity,
  ];
}

const straightPath = [point("p0", 0, 0), point("p1", 30, 0), line("path", "p0", "p1")];
const lPath = [point("p0", 0, 0), point("p1", 30, 0), point("p2", 30, 30), line("l1", "p0", "p1"), line("l2", "p1", "p2")];

function sweep(entities: SketchEntity[]) {
  const doc = createEmptySketchDoc(defaultSketchPlane(), "sweep-geometry");
  doc.entities = entities;
  const profile = sketchDocToProfile(doc);
  const plan = planSketchSweep(profile, doc);
  expect(plan.outlines).toHaveLength(1);
  expect(plan.paths).toHaveLength(1);
  const built = sweepSolid(brep, profile, doc, sweepSpec(plan.outlines[0]!, plan.paths[0]!));
  expect(built.ok, built.ok ? "" : built.message).toBe(true);
  if (!built.ok) throw new Error(built.message);
  expect(brep.isValid(built.solid as never)).toBe(true);
  const volume = brep.measureVolume(built.solid as never);
  if (!volume.ok) throw new Error("no volume");
  const bounds = brep.getBounds(built.solid as never);
  // The part sits on top of the sheet (the bed here), like an extrude, not half sunk into it.
  expect(bounds.yMin).toBeCloseTo(0, 3);
  return { volume: volume.value, height: bounds.yMax - bounds.yMin };
}

describe("sweep geometry", () => {
  it("makes a capped solid from a square on a straight line", () => {
    // Area × length. An open skin without end caps measures 0.
    expect(sweep([...square(10), ...straightPath]).volume).toBeCloseTo(3000, 0);
  });

  it("makes a capped solid from a non-square outline", () => {
    const wide = [
      point("a", -40, -40), point("b", -30, -40), point("c", -30, -38), point("d", -40, -38),
      line("ab", "a", "b"), line("bc", "b", "c"), line("cd", "c", "d"), line("da", "d", "a"),
    ];
    const result = sweep([...wide, ...straightPath]);
    expect(result.volume).toBeCloseTo(600, 0);
    expect(result.height).toBeCloseTo(2, 3);
  });

  it("bends a round pipe along an arc", () => {
    const arc = [point("o", 0, 0), point("s", 20, 0), point("e", 0, 20), { id: "arc", kind: "arc", centerId: "o", startId: "s", endId: "e", ccw: true } as SketchEntity];
    // Pappus: section area × centreline length.
    expect(sweep([...circle("ring", 2), ...arc]).volume).toBeCloseTo(Math.PI * 4 * (Math.PI / 2) * 20, 0);
  });

  it("closes a ring around a construction circle", () => {
    expect(sweep([...circle("ring", 2), ...circle("loop", 20, 0, 0, true)]).volume).toBeCloseTo(2 * Math.PI ** 2 * 20 * 4, 0);
  });

  it("keeps the section upright along an S curve", () => {
    const curve = [
      point("p0", 0, 0, { handleOut: { x: 20, z: 0 } }),
      point("p1", 40, 20, { handleIn: { x: 20, z: 20 } }),
      { id: "path", kind: "bezier", startId: "p0", endId: "p1" } as SketchEntity,
    ];
    const result = sweep([...square(4), ...curve]);
    expect(result.height).toBeCloseTo(4, 2);
    expect(result.volume).toBeGreaterThan(16 * 44);
  });

  it("rounds a sharp bend instead of building a broken corner", () => {
    const result = sweep([...square(4), ...lPath]);
    expect(result.volume).toBeGreaterThan(900);
    expect(result.volume).toBeLessThan(970);
    expect(result.height).toBeCloseTo(4, 2);
  });

  it("carries a round section through both legs of a sharp bend", () => {
    // The mitred joint silently dropped the second leg and measured about 377.
    const result = sweep([...circle("ring", 2), ...lPath]);
    expect(result.volume).toBeGreaterThan(Math.PI * 4 * 60 * 0.95);
  });

  it("sweeps an outline whose ends stop just short of each other, like Extrude does", () => {
    // The last corner lands 0.4 mm from the first, so the outline only closes once the gap is bridged.
    const nearlyClosed = [
      point("a", -40, -40), point("b", -30, -40), point("c", -30, -30), point("d", -40, -30), point("e", -40, -39.6),
      line("ab", "a", "b"), line("bc", "b", "c"), line("cd", "c", "d"), line("de", "d", "e"),
    ];
    const doc = createEmptySketchDoc(defaultSketchPlane(), "gap");
    doc.entities = [...nearlyClosed, ...straightPath];
    const raw = sketchDocToProfile(doc);
    expect(planSketchSweep(raw, doc).outlines).toHaveLength(0);
    const closed = closeOpenPathGaps(raw);
    const plan = planSketchSweep(closed, doc);
    expect(plan.outlines).toHaveLength(1);
    const spec = sweepSpec(plan.outlines[0]!, plan.paths[0]!);
    // Closing again (as reopening the sweep does) must give the same outline back.
    expect(resolveSketchSweep(closeOpenPathGaps(raw), doc, spec)).not.toBeNull();
    const built = sweepSolid(brep, closed, doc, spec);
    expect(built.ok).toBe(true);
  });

  it("cuts the hole all the way along", () => {
    const hole = square(8, -34, -34, "h");
    expect(sweep([...square(20), ...hole, ...straightPath]).volume).toBeCloseTo((400 - 64) * 30, 0);
  });
});

/** Path on the bed sheet, cross-section drawn on the sheet Sweep stands across the path start. */
function sweepWithSection(pathEntities: SketchEntity[], sectionEntities: SketchEntity[]) {
  const pathDoc = createEmptySketchDoc(defaultSketchPlane(), "path");
  pathDoc.entities = pathEntities;
  const pathProfile = sketchDocToProfile(pathDoc);
  const path = planSketchSweep(pathProfile, pathDoc).paths[0]!;
  const sheet = sweepSectionPlane(path, pathProfile.sketchPlane ?? pathDoc.plane)!;
  const sectionDoc = createEmptySketchDoc(sheet, "section");
  sectionDoc.entities = sectionEntities;
  const sectionProfile = sketchDocToProfile(sectionDoc);
  const outline = planSketchSweep(sectionProfile, sectionDoc).outlines[0]!;
  const spec = sweepSpec(outline, path, { profile: sectionProfile, doc: sectionDoc, standing: true });
  expect(resolveSketchSweep(pathProfile, pathDoc, spec)?.standingSection).toBe(true);
  const built = sweepSolid(brep, pathProfile, pathDoc, spec);
  if (!built.ok) throw new Error(built.message);
  expect(brep.isValid(built.solid as never)).toBe(true);
  const volume = brep.measureVolume(built.solid as never);
  if (!volume.ok) throw new Error("no volume");
  return { volume: volume.value, bounds: brep.getBounds(built.solid as never) };
}

describe("sweep with a cross-section sheet", () => {
  it("sits a circle drawn on the axis line on top of the bed", () => {
    // Circle centred 2 above the axis on screen (sheet V is down), radius 2: its bottom touches the bed.
    const { volume, bounds } = sweepWithSection(straightPath, circle("ring", 2, 0, -2));
    expect(volume).toBeCloseTo(Math.PI * 4 * 30, 0);
    expect(bounds.yMin).toBeCloseTo(0, 3);
    expect(bounds.yMax).toBeCloseTo(4, 3);
    expect(bounds.xMin).toBeCloseTo(0, 3);
    expect(bounds.xMax).toBeCloseTo(30, 3);
  });

  it("keeps a shape drawn off to one side off to that side", () => {
    const { volume, bounds } = sweepWithSection(straightPath, square(4, 5, -4));
    expect(volume).toBeCloseTo(16 * 30, 0);
    expect(bounds.yMin).toBeCloseTo(0, 3);
    // 5 to 9 across the path, so the part does not straddle it.
    const near = Math.min(Math.abs(bounds.zMin), Math.abs(bounds.zMax));
    const far = Math.max(Math.abs(bounds.zMin), Math.abs(bounds.zMax));
    expect(near).toBeCloseTo(5, 3);
    expect(far).toBeCloseTo(9, 3);
  });

  it("keeps the cross-section through saving and opening the project", () => {
    const pathDoc = createEmptySketchDoc(defaultSketchPlane(), "path");
    pathDoc.entities = straightPath;
    const pathProfile = sketchDocToProfile(pathDoc);
    const path = planSketchSweep(pathProfile, pathDoc).paths[0]!;
    const sectionDoc = createEmptySketchDoc(sweepSectionPlane(path, pathDoc.plane)!, "section");
    sectionDoc.entities = circle("ring", 2, 0, -2);
    const sectionProfile = sketchDocToProfile(sectionDoc);
    const spec = sweepSpec(planSketchSweep(sectionProfile, sectionDoc).outlines[0]!, path, { profile: sectionProfile, doc: sectionDoc, standing: true });
    const shape = {
      id: "swept", name: "Sketch sweep", kind: "mesh", color: "#d41721", x: 0, z: 0, elevation: 0,
      size: 30, width: 30, depth: 4, height: 4, rotation: 0, locked: false, hidden: false,
      sketchProfile: pathProfile, sketchDoc: pathDoc, sketchFinish: "sweep", sketchSweep: spec,
    } as WorkplaneShape;
    const text = serializePeakcadDocument(buildPeakcadDocument({
      project: { id: "p", name: "Pipe", createdAt: 1, updatedAt: 1, accent: "cyan", shapes: 1 } as never,
      shapes: [shape],
    }));
    const opened = parsePeakcadDocument(text).shapes[0]!;
    expect(opened.sketchSweep?.section?.profile.points.length).toBeGreaterThan(0);
    const rebuilt = sweepSolid(brep, opened.sketchProfile!, opened.sketchDoc, opened.sketchSweep!);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    const volume = brep.measureVolume(rebuilt.solid as never);
    expect(volume.ok && volume.value).toBeCloseTo(Math.PI * 4 * 30, 0);
  });

  it("follows a curved path from the cross-section sheet", () => {
    const arc = [point("o", 0, 0), point("s", 20, 0), point("e", 0, 20), { id: "arc", kind: "arc", centerId: "o", startId: "s", endId: "e", ccw: true } as SketchEntity];
    const { volume, bounds } = sweepWithSection(arc, circle("ring", 2, 0, -2));
    expect(volume).toBeCloseTo(Math.PI * 4 * (Math.PI / 2) * 20, 0);
    expect(bounds.yMin).toBeCloseTo(0, 3);
  });
});

/** The Sweep steps: profile drawn flat on a sheet of its own, then the path on another. */
function sweepFlatProfile(profileEntities: SketchEntity[], pathEntities: SketchEntity[]) {
  const pathDoc = createEmptySketchDoc(defaultSketchPlane(), "path");
  pathDoc.entities = pathEntities;
  const pathProfile = sketchDocToProfile(pathDoc);
  const profileDoc = createEmptySketchDoc(defaultSketchPlane(), "profile");
  profileDoc.entities = profileEntities;
  const profileSheet = sketchDocToProfile(profileDoc);
  const outline = planSketchSweep(profileSheet, profileDoc).outlines[0]!;
  const path = planSketchSweep(pathProfile, pathDoc).paths[0]!;
  const spec = sweepSpec(outline, path, { profile: profileSheet, doc: profileDoc });
  const resolved = resolveSketchSweep(pathProfile, pathDoc, spec);
  expect(resolved?.separateSection).toBe(true);
  expect(resolved?.standingSection).toBe(false);
  const built = sweepSolid(brep, pathProfile, pathDoc, spec);
  if (!built.ok) throw new Error(built.message);
  expect(brep.isValid(built.solid as never)).toBe(true);
  const props = brep.measureVolumeProps(built.solid as never);
  if (!props.ok) throw new Error("no volume");
  return { volume: props.value.volume, centre: props.value.centerOfMass, bounds: brep.getBounds(built.solid as never) };
}

describe("sweep with the profile on its own sheet", () => {
  it("centres a profile drawn anywhere on the path and rests it on the bed", () => {
    // Drawn far from where the path is; on its own sheet the position does not matter.
    const { volume, bounds } = sweepFlatProfile(circle("ring", 2, 55, -60), straightPath);
    expect(volume).toBeCloseTo(Math.PI * 4 * 30, 0);
    expect(bounds.yMin).toBeCloseTo(0, 3);
    expect(bounds.yMax).toBeCloseTo(4, 3);
    expect(bounds.zMin).toBeCloseTo(-2, 3);
    expect(bounds.zMax).toBeCloseTo(2, 3);
  });

  it("keeps the profile the way up it was drawn", () => {
    // An L: a wide foot along the bottom of the drawing (larger Z is lower on screen), a stem up the left.
    const ell = [
      point("a", 0, 10), point("b", 10, 10), point("c", 10, 8), point("d", 2, 8), point("e", 2, 0), point("f", 0, 0),
      line("ab", "a", "b"), line("bc", "b", "c"), line("cd", "c", "d"), line("de", "d", "e"), line("ef", "e", "f"), line("fa", "f", "a"),
    ];
    const { volume, centre, bounds } = sweepFlatProfile(ell, straightPath);
    expect(volume).toBeCloseTo(36 * 30, 0);
    expect(bounds.yMin).toBeCloseTo(0, 3);
    expect(bounds.yMax).toBeCloseTo(10, 3);
    // Foot on the bed puts the weight low (about 3.2 up); upside down it would be about 6.8.
    expect(centre[1]).toBeLessThan(4);
  });
});
