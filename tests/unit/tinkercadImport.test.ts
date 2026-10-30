import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { remeshCsgGroup, restoreGroupedChildren } from "@/lib/editorBoolean";
import {
  readTinkercadClipboard,
  readTinkercadHash,
  TINKERCAD_CLIPBOARD_PREFIX,
  tinkercadToShapes,
  type TinkercadPayload,
} from "@/lib/tinkercadImport";
import { tinkercadBookmarkletHref } from "@/lib/tinkercadBookmarklet";
import { meshForShape } from "@/lib/editorShapeMesh";

// A real design from Tinkercad's editor (rootNode.toJSON()): a 20 mm box with a cylinder hole
// 10 mm wide and 21 mm tall through it, grouped. The group sits at (-28, 9), the parts at (37, -2)
// inside it, so in Tinkercad's world both are centred on (9, 7) on the workplane.
const BOX_WITH_HOLE: TinkercadPayload = {
  v: 1,
  name: "Box with a hole",
  root: {
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    dataType: null,
    children: [{
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -28, 9.000000000000004, -1.9984014443252826e-15, 1],
      tags: { renderingMaterial: { color: 15277357 }, isAllHole: 0, isMulticolor: false, volumePolarity: 1, preview: false, isMixedOpacity: false },
      dataType: "csg",
      params: { groupType: 1 },
      children: [
        {
          matrix: [1, 0, 0, 0, 0, 2.83276944882399e-16, 1, 0, 0, -1, 2.83276944882399e-16, 0, 37, -2, 4.440892098500626e-16, 1],
          tags: { label: "Box", renderingMaterial: { color: 15277357 }, volumePolarity: 1, preview: false },
          dataType: "preset",
          params: { id: "box", radius: 0, step: 10, depth: 20, width: 20, height: 20 },
        },
        {
          matrix: [0.5, 0, 0, 0, 0, 2.637630051499667e-16, 1.05, 0, 0, -0.5, 1.7531625941775172e-16, 0, 37, -2, 4.1347304249967217e-16, 1],
          tags: { label: "Cylinder", renderingMaterial: { color: 16089887 }, volumePolarity: -1, preview: false },
          dataType: "preset",
          params: { id: "cylinder", radialSegments: 48, bevel: 0, bevelSegments: 1, radiusBottom: 10, height: 20 },
        },
      ],
    }],
  },
};

describe("Tinkercad import", () => {
  it("brings a grouped box and hole over as an editable Mintr group", () => {
    const { shapes, skipped } = tinkercadToShapes(BOX_WITH_HOLE);
    expect(skipped).toEqual([]);
    expect(shapes).toHaveLength(1);
    const group = shapes[0];
    expect(group.csg).toMatchObject({ op: "subtract", dirty: true });
    expect(group.color).toBe("#e91d2d");

    const [box, hole] = restoreGroupedChildren(group, { preserveIds: true });
    expect(box).toMatchObject({ kind: "box", name: "Box", width: 20, depth: 20, height: 20, x: 9, z: -7, elevation: 0, rotation: 0, rotationX: 0, rotationZ: 0 });
    expect(box.hole).toBeFalsy();
    expect(hole).toMatchObject({ kind: "cylinder", name: "Cylinder", hole: true, width: 10, depth: 10, height: 21, x: 9, z: -7, elevation: 0, rotationX: 0, rotationZ: 0 });
  });

  it("leaves out shapes it cannot make yet and says which", () => {
    const { shapes, skipped } = tinkercadToShapes({
      v: 1,
      root: { children: [{ dataType: "preset", params: { id: "heart" }, tags: { label: "Heart" } }] },
    });
    expect(shapes).toEqual([]);
    expect(skipped).toEqual(["Heart"]);
  });

  it("reads the design from the address and from pasted text", () => {
    const json = JSON.stringify(BOX_WITH_HOLE);
    expect(readTinkercadHash(`#tinkercad=${encodeURIComponent(json)}`)?.name).toBe("Box with a hole");
    expect(readTinkercadClipboard(TINKERCAD_CLIPBOARD_PREFIX + json)?.name).toBe("Box with a hole");
    expect(readTinkercadHash("#other")).toBeNull();
    expect(readTinkercadClipboard(json)).toBeNull();
  });
});

describe("Send to Mintr bookmark", () => {
  /** Runs the bookmark the way a browser would, against a stand-in for Tinkercad's editor page. */
  function runBookmark(appUrl: string | null, rootNode: unknown, canCopy = true) {
    const href = tinkercadBookmarkletHref(appUrl);
    expect(href.startsWith("javascript:")).toBe(true);
    const code = decodeURIComponent(href.slice("javascript:".length));
    const opened: string[] = [];
    const alerts: string[] = [];
    let clipboard = "";
    const adsk = {
      TinkercadApplication: {
        _editor3DContent: {
          _editor3D: {
            designTitle: "Box with a hole",
            root: { objectMap: { _content: { a: { val: { camera: {} } }, b: { val: { nodes: {}, rootNode: { value: rootNode } } } } } },
          },
        },
      },
    };
    const fakeWindow = { adsk, open: (url: string) => { opened.push(url); return {}; } };
    // After a bookmark click the page is not focused, so the Clipboard API refuses: the copy has
    // to go through a selected text box and execCommand.
    let selected = "";
    const textBox = { value: "", style: {}, setAttribute: () => undefined, focus: () => undefined, select: () => { selected = textBox.value; } };
    const fakeDocument = {
      title: "3D design Box with a hole | Tinkercad",
      body: { appendChild: () => undefined, removeChild: () => undefined },
      createElement: () => textBox,
      hasFocus: () => false,
      execCommand: (command: string) => {
        if (command !== "copy" || !canCopy) return false;
        clipboard = selected;
        return true;
      },
    };
    new Function("window", "adsk", "navigator", "alert", "document", code)(
      fakeWindow,
      adsk,
      { clipboard: { writeText: () => Promise.reject(new Error("Document is not focused.")) } },
      (message: string) => alerts.push(message),
      fakeDocument,
    );
    return { opened, alerts, clipboard };
  }

  const rootNode = { toJSON: () => BOX_WITH_HOLE.root };

  it("opens Mintr on the web with the design and copies it too", () => {
    const { opened, alerts, clipboard } = runBookmark("https://app.mintr3d.com/", rootNode);
    expect(alerts).toEqual([]);
    expect(opened).toHaveLength(1);
    const hash = opened[0].slice(opened[0].indexOf("#"));
    expect(readTinkercadHash(hash)).toEqual(BOX_WITH_HOLE);
    expect(readTinkercadClipboard(clipboard)).toEqual(BOX_WITH_HOLE);
  });

  it("only copies for the desktop app", () => {
    const { opened, alerts, clipboard } = runBookmark(null, rootNode);
    expect(opened).toEqual([]);
    expect(alerts[0]).toMatch(/Press Ctrl\+V in Mintr/);
    expect(tinkercadToShapes(readTinkercadClipboard(clipboard)!).shapes).toHaveLength(1);
  });

  it("never says it copied when the copy failed", () => {
    const { alerts, clipboard } = runBookmark(null, rootNode, false);
    expect(clipboard).toBe("");
    expect(alerts[0]).toMatch(/could not copy/);
  });

  it("explains itself on a page without a design", () => {
    const { opened, alerts } = runBookmark("https://app.mintr3d.com/", null);
    expect(opened).toEqual([]);
    expect(alerts[0]).toMatch(/could not read this design/);
  });
});

describe("Tinkercad shapes", () => {
  // The user's test design: one of each basic shape, a stretched polygon, a tipped cone, a hole,
  // a group inside a group and a bundle group.
  const design = JSON.parse(readFileSync(path.join(__dirname, "../fixtures/tinkercad-all-shapes.json"), "utf8")) as TinkercadPayload;
  const { shapes, skipped } = tinkercadToShapes(design);
  const byName = (name: string) => shapes.find((shape) => shape.name === name)!;

  it("brings every shape Mintr has over and lists the rest", () => {
    expect(skipped.sort()).toEqual(["Paraboloid", "Star", "Text"]);
    expect(shapes.map((shape) => shape.kind)).toEqual(["sphere", "cone", "roundRoof", "wedge", "polygon", "torus", "tube", "mesh", "mesh"]);
  });

  it("keeps sizes, settings and holes", () => {
    expect(byName("Sphere")).toMatchObject({ width: 20, depth: 20, height: 20, elevation: 0, x: 45, z: 47 });
    expect(byName("Wedge")).toMatchObject({ hole: true, width: 20, height: 20 });
    expect(byName("Polygon")).toMatchObject({ sides: 6, width: 37.712812, depth: 27, height: 20 });
    expect(byName("Torus")).toMatchObject({ width: 20, height: 5, radius: 2.5 });
    expect(byName("Tube")).toMatchObject({ width: 20, height: 10, bevel: 2.5 });
    expect(byName("Round Roof")).toMatchObject({ width: 20, depth: 20, height: 10 });
  });

  it("keeps a tipped shape tipped", () => {
    const cone = byName("Cone");
    expect(cone).toMatchObject({ topRadius: 0, baseRadius: 10, width: 20, height: 20 });
    const turned = [cone.rotationX ?? 0, cone.rotation, cone.rotationZ ?? 0].map((angle) => Math.abs(Math.round(((angle + 180) % 360) - 180)));
    expect(turned).toContain(45);
  });

  it("keeps groups inside groups, and a bundle as a Tie", () => {
    const [outer, bundle] = shapes.filter((shape) => shape.kind === "mesh");
    expect(outer.csg?.op).toBe("union");
    const inner = outer.groupedShapes!.find((child) => child.groupedShapes?.length);
    expect(inner?.csg?.op).toBe("subtract");
    expect(outer.groupedShapes!.some((child) => child.name === "Paraboloid")).toBe(false);
    expect(bundle).toMatchObject({ name: "Tie" });
    expect(bundle.csg?.op).toBe("assemble");
    expect(restoreGroupedChildren(bundle).map((child) => child.kind)).toEqual(["roof", "pyramid"]);
  });
});

describe("Tinkercad hole groups", () => {
  // The user's basket cage: four crossing cylinders grouped and made a hole, cutting a tube.
  const design = JSON.parse(readFileSync(path.join(__dirname, "../fixtures/tinkercad-basket-cage.json"), "utf8")) as TinkercadPayload;
  const [cage] = tinkercadToShapes(design).shapes;

  it("brings a group made into a hole over as a hole", () => {
    const holeGroups = cage.groupedShapes!.filter((child) => child.groupedShapes?.length && child.hole);
    expect(holeGroups).toHaveLength(3);
    const tube = cage.groupedShapes!.find((child) => child.csg?.op === "subtract")!
      .groupedShapes!.find((child) => child.groupedShapes?.length)!;
    const windows = tube.groupedShapes!.find((child) => child.groupedShapes?.length)!;
    expect(windows).toMatchObject({ hole: true });
    expect(windows.csg?.op).toBe("union");
  });

  it("keeps a hole group a hole when Mintr builds it", async () => {
    const holeGroup = cage.groupedShapes!.find((child) => child.groupedShapes?.length && child.hole)!;
    const built = await remeshCsgGroup(restoreGroupedChildren({ ...cage, groupedShapes: [holeGroup] }, { preserveIds: true })[0]);
    expect(built?.importedMesh).toBeTruthy();
    expect(built).toMatchObject({ hole: true });
  });
});

describe("Tinkercad cones wider at the top", () => {
  // The user's 8 quadrant basket bevels the inside of its rim with an upside-down cone hole:
  // 31.25 mm at the bottom, 32.15 mm at the top. Cut too wide, it shaves the wall paper-thin.
  const design = JSON.parse(readFileSync(path.join(__dirname, "../fixtures/tinkercad-basket-8-quadrant.json"), "utf8")) as TinkercadPayload;
  const find = (shape: ReturnType<typeof tinkercadToShapes>["shapes"][number]): typeof shape | null => {
    if (shape.kind === "cone" && shape.hole) return shape;
    for (const child of shape.groupedShapes?.length ? restoreGroupedChildren(shape, { preserveIds: true }) : []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  const bevel = tinkercadToShapes(design).shapes.map(find).find(Boolean)!;

  it("cuts with the cone at its real size", () => {
    expect(bevel).toMatchObject({ baseRadius: 31.25, topRadius: 32.15 });
    const { vertices } = meshForShape(bevel);
    const ys = vertices.map((vertex) => vertex[1]);
    const bottom = Math.min(...ys);
    const top = Math.max(...ys);
    const ring = (y: number) => Math.max(...vertices.filter((vertex) => Math.abs(vertex[1] - y) < 1e-6)
      .map((vertex) => Math.hypot(vertex[0] - bevel.x, vertex[2] - bevel.z)));
    expect(ring(bottom)).toBeCloseTo(31.25, 2);
    expect(ring(top)).toBeCloseTo(32.15, 2);
  });
});

describe("Tinkercad imported meshes", () => {
  // The user's working plate: three copies of a mesh imported into Tinkercad, which stays on
  // Tinkercad's servers, and a torus hole that rounds the edge of each pocket.
  const design = JSON.parse(readFileSync(path.join(__dirname, "../fixtures/tinkercad-working-plate.json"), "utf8")) as TinkercadPayload;
  const { shapes, skipped } = tinkercadToShapes(design);

  it("names them plainly when leaving them out", () => {
    expect(skipped).toEqual(["Imported shape", "Imported shape", "Imported shape"]);
  });

  it("keeps the torus that rounds each pocket", () => {
    const tori: string[] = [];
    const walk = (shape: (typeof shapes)[number]) => {
      if (shape.kind === "torus") tori.push(shape.id);
      if (shape.groupedShapes?.length) restoreGroupedChildren(shape, { preserveIds: true }).forEach(walk);
    };
    shapes.forEach(walk);
    expect(tori).toHaveLength(3);
  });
});

describe("Tinkercad roofs", () => {
  // The user's baskets trim the ends of their dividers with small roof holes. Tinkercad's roof
  // runs 20 mm from its origin along its own depth, so this one covers X 92 to 95 and trims the
  // whole 2 mm divider (X 93 to 95), flush with its outer face.
  const design: TinkercadPayload = {
    v: 1,
    name: "Trimmed divider",
    root: {
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      dataType: null,
      children: [{
        matrix: [0, 0.1, 0, 0, 0, 0, 0.2, 0, 0.15, 0, 0, 0, 92, -20.75, 0, 1],
        tags: { volumePolarity: -1 },
        dataType: "preset",
        params: { id: "roof" },
      }],
    },
  };

  it("sits where Tinkercad puts it", () => {
    const [roof] = tinkercadToShapes(design).shapes;
    const xs = meshForShape(roof).vertices.map((vertex) => vertex[0]);
    expect(Math.min(...xs)).toBeCloseTo(92, 4);
    expect(Math.max(...xs)).toBeCloseTo(95, 4);
  });
});
