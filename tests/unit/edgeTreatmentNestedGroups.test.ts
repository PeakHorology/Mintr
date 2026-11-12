import { describe, expect, it } from "vitest";
import { groupedShape } from "@/lib/editorGroup";
import { edgeTreatmentSourceParts } from "@/lib/edgeTreatmentSources";
import type { WorkplaneShape } from "@/types/sketchforge";

const box = (name: string, o: Partial<WorkplaneShape> = {}): WorkplaneShape => ({
  id: name, name, kind: "box", color: "#d41721", x: 0, z: 0, elevation: 0, size: 10, width: 10, depth: 10, height: 10, rotation: 0, locked: false, hidden: false, ...o,
});

/** The finished boolean result a Group stores (its contents do not matter to the picker). */
const finished = (group: WorkplaneShape, name: string): WorkplaneShape => ({
  ...group,
  name,
  importedMesh: {
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
    baseWidth: group.width,
    baseDepth: group.depth,
    baseHeight: group.height,
    triangleCount: 1,
    sourceFormat: "json",
  },
});

const byName = (parts: WorkplaneShape[], name: string) => parts.find((part) => part.name === name);

describe("edge pick parts for a group of groups", () => {
  // A tray (box minus its pocket) with an insert standing in the pocket (box minus a Tie of
  // holes), grouped, then grouped again with an engraved text hole on the end wall.
  const trayBody = box("tray body", { x: -4, z: 39.5, width: 80, depth: 120, height: 30 });
  const pocket = box("pocket", { x: -4, z: 39.5, width: 74, depth: 114, height: 30, elevation: 3, hole: true });
  const tray = finished(groupedShape([trayBody, pocket])!, "tray");
  const insertBody = box("insert body", { x: -4, z: 78.5, width: 60, depth: 30, height: 10, elevation: 3 });
  const bores = [0, 1, 2, 3].map((i) => box(`bore ${i}`, {
    kind: "cylinder", x: -25 + i * 14, z: 78.5, width: 6, depth: 6, size: 6, height: 12, elevation: 2, hole: true,
  }));
  const tie = { ...groupedShape(bores)!, name: "bores" };
  const insert = finished(groupedShape([insertBody, tie])!, "insert");
  const inner = finished(groupedShape([tray, insert])!, "inner");
  const text = box("label", { x: -4, z: 98.5, width: 30, depth: 2, height: 8, elevation: 10, hole: true, rotationX: 90 });
  const top = finished(groupedShape([inner, text])!, "top");

  it("keeps each part where it sits in the world", () => {
    const parts = edgeTreatmentSourceParts(top, { ignoreThreads: true });
    const sealedTray = byName(parts, "tray");
    const sealedInsert = byName(parts, "insert");
    const label = byName(parts, "label");
    expect(sealedTray).toBeDefined();
    expect(sealedInsert).toBeDefined();
    expect(label?.hole).toBe(true);
    expect(sealedTray!.x).toBeCloseTo(-4, 6);
    expect(sealedTray!.z).toBeCloseTo(39.5, 6);
    expect(sealedTray!.elevation ?? 0).toBeCloseTo(0, 6);
    expect(sealedInsert!.x).toBeCloseTo(-4, 6);
    expect(sealedInsert!.z).toBeCloseTo(78.5, 6);
    expect(sealedInsert!.elevation ?? 0).toBeCloseTo(2, 6);
    expect(label!.x).toBeCloseTo(-4, 6);
    expect(label!.z).toBeCloseTo(98.5, 6);
    expect(label!.elevation ?? 0).toBeCloseTo(10, 6);
  });

  it("does not let the tray's pocket or the insert's bores cut the other part", () => {
    const names = edgeTreatmentSourceParts(top, { ignoreThreads: true }).map((part) => part.name).sort();
    // The pocket would swallow the insert standing in it, and the bores would reach the tray
    // floor, if those groups were opened into one flat list of solids and holes.
    expect(names).toEqual(["insert", "label", "tray"]);
  });

  it("still opens a group whose holes stay inside it", () => {
    const plate = box("plate", { width: 40, depth: 20, height: 6 });
    const slot = box("slot", { width: 6, depth: 24, height: 8, elevation: -1, hole: true });
    const slotted = finished(groupedShape([plate, slot])!, "slotted");
    const block = box("block", { x: 40, width: 20, depth: 20, height: 20 });
    const parts = edgeTreatmentSourceParts(finished(groupedShape([slotted, block])!, "pair"));
    expect(parts.map((part) => part.name).sort()).toEqual(["block", "plate", "slot"]);
    expect(byName(parts, "block")!.x).toBeCloseTo(40, 6);
    expect(byName(parts, "plate")!.x).toBeCloseTo(0, 6);
  });
});
