import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ShapeAsset } from "@/types/sketchforge";
import { LASER_SHAPE_SECTIONS, SHAPE_SECTIONS, listedShapeAssets, makeShapeFromAsset, sceneShape, searchShapeAssets, shapeSectionsFor, toolbarShapeAssets } from "@/lib/shapeCatalog";

describe("shape catalog", () => {
  it("exposes the current primitive kinds in the toolbar catalog", () => {
    const kinds = toolbarShapeAssets.map((asset) => asset.kind);

    expect(kinds).toContain("thread");
    expect(kinds).toContain("roof");
    expect(kinds).toContain("roundRoof");
    expect(kinds).toContain("tube");
    expect(kinds).toContain("polygon");
    expect(kinds).not.toContain("ring");
    expect(kinds).not.toContain("icosahedron");
  });

  it("keeps generated parts off the solids tab", () => {
    const parts = toolbarShapeAssets.filter((asset) => asset.group === "part" && !asset.generated).map((asset) => asset.kind);
    const solids = toolbarShapeAssets.filter((asset) => asset.group === "solid").map((asset) => asset.kind);

    expect(parts).toEqual(["text", "thread", "gear", "gridfinityBin", "gridfinityBaseplate"]);
    expect(toolbarShapeAssets.filter((asset) => asset.group === "part" && asset.generated).map((asset) => asset.id)).toEqual(["qr-code", "screw-hole", "nut-pocket"]);
    expect(solids).not.toEqual(expect.arrayContaining(parts));
    expect(solids).toContain("box");
    expect(solids).not.toContain("text");
  });

  it("gives every shape an icon and a heading the list shows", () => {
    for (const asset of toolbarShapeAssets) {
      expect(SHAPE_SECTIONS).toContain(asset.section);
      expect(existsSync(join(fileURLToPath(new URL("../../apps/web/public/", import.meta.url)), asset.menuIcon))).toBe(true);
    }
    expect([...LASER_SHAPE_SECTIONS].sort()).toEqual([...SHAPE_SECTIONS].sort());
  });

  it("lists the everyday shapes first and keeps each heading small enough to scan", () => {
    const bySection = (section: string) => toolbarShapeAssets.filter((asset) => asset.section === section).map((asset) => asset.name);

    expect(SHAPE_SECTIONS[0]).toBe("Basic");
    expect(bySection("Basic")).toEqual(["Box", "Cylinder", "Sphere", "Cone", "Pyramid", "Wedge", "Triangle", "Polygon"]);
    expect(bySection("Rounded")).toEqual(["Ring", "Torus", "Half Sphere", "Round Roof", "Paraboloid", "Loft"]);
    expect(bySection("Flat")).toEqual(["Rounded Plate", "Slot", "Star", "Heart"]);
    expect(bySection("Screws and nuts")).toEqual(["Threads", "Threaded Hole", "Nut Pocket"]);
    for (const section of SHAPE_SECTIONS) {
      expect(bySection(section).length).toBeLessThanOrEqual(8);
    }
  });

  it("puts flat shapes first and leaves print-only parts out of a laser design", () => {
    expect(shapeSectionsFor(false)).toBe(SHAPE_SECTIONS);
    expect(shapeSectionsFor(true)[0]).toBe("Flat");

    const laser = listedShapeAssets(true).map((asset) => asset.id);
    expect(laser).not.toContain("thread");
    expect(laser).not.toContain("screw-hole");
    expect(laser).not.toContain("gridfinity-bin");
    expect(laser).not.toContain("loft");
    expect(laser).toContain("gear");
    expect(laser).toContain("qr-code");
    expect(listedShapeAssets(false)).toHaveLength(toolbarShapeAssets.length);
  });

  it("finds shapes by name, heading or everyday word", () => {
    const names = (query: string) => searchShapeAssets(toolbarShapeAssets, query).map((asset) => asset.name);

    expect(names("")).toHaveLength(toolbarShapeAssets.length);
    expect(names("star")).toEqual(["Star"]);
    expect(names("hex")).toEqual(["Polygon", "Nut Pocket"]);
    expect(names("DONUT")).toEqual(["Torus"]);
    expect(names("gridfinity")).toEqual(["Gridfinity Bin", "Gridfinity Baseplate"]);
    expect(names("threaded hole")).toEqual(["Threaded Hole"]);
    expect(names("tapped")).toContain("Threaded Hole");
    expect(names("zzz")).toEqual([]);
  });

  it("creates placed shapes from toolbar assets", () => {
    const asset: ShapeAsset = { id: "box", name: "Box", src: "box.png", kind: "box", color: "#d41721" };
    const placed = makeShapeFromAsset(asset, { x: 12, z: -8, elevation: 4 }, "standard");

    expect(placed.id).toMatch(/^box-/);
    expect(placed).toMatchObject({
      name: "Box",
      kind: "box",
      color: "#d41721",
      x: 12,
      z: -8,
      elevation: 4,
      size: 20,
      width: 20,
      depth: 20,
      height: 20,
      radius: 0,
      steps: 12,
      locked: false,
      hidden: false,
    });
  });

  it("uses shape-specific defaults for text and round profiles", () => {
    const text = makeShapeFromAsset({ id: "text", name: "Text", src: "text.png", kind: "text", color: "#cf101b" });
    const torus = makeShapeFromAsset({ id: "torus", name: "Torus", src: "torus.png", kind: "torus", color: "#0098c7" });
    const polygon = makeShapeFromAsset({ id: "polygon", name: "Polygon", src: "polygon.png", kind: "polygon", color: "#3b82f6" });
    const ring = makeShapeFromAsset({ id: "ring", name: "Ring", src: "ring.png", kind: "ring", color: "#b98254" });

    expect(text).toMatchObject({ width: 86, depth: 28, height: 10, text: "TEXT", font: "Multilanguage" });
    expect(torus).toMatchObject({ size: 22, width: 22, depth: 22, height: 5 });
    expect(polygon).toMatchObject({ sides: 6, width: 20, depth: 20, height: 20 });
    expect(ring).toMatchObject({ size: 22, width: 22, depth: 22, height: 5, bevel: 4 });
  });

  it("creates canonical scene shapes with stable defaults", () => {
    const created = sceneShape({
      name: "Part",
      kind: "box",
      color: "#d41721",
      width: 12,
      depth: 18,
      rotation: 359.9,
      mirrorX: false,
    });

    expect(created.id).toMatch(/^shape-/);
    expect(created).toMatchObject({
      name: "Part",
      kind: "box",
      color: "#d41721",
      x: 0,
      z: 0,
      elevation: 0,
      width: 12,
      depth: 18,
      height: 20,
      size: 18,
      rotation: 0,
      locked: false,
      hidden: false,
    });
    expect(created.mirrorX).toBeUndefined();
  });
});
