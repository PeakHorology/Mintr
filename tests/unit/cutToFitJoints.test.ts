import { afterAll, describe, expect, it } from "vitest";
import { cutShapeToFit, type CutJoint } from "@/lib/cutToFit";
import { toNativeKernelSolids } from "@/lib/nativeKernelProtocol";
import { splitPlaneFrame } from "@/lib/splitShape";
import type { WorkplaneShape } from "@/types/sketchforge";
import { hasNativeKernelExe, spawnNativeKernelClient } from "../helpers/nativeKernelChild";
import { hasWasmKernel, startWasmKernel } from "../helpers/wasmKernel";

const box: WorkplaneShape = { id: "b", name: "Box", kind: "box", color: "#d41721", x: 0, z: 0, elevation: 0, size: 20, width: 20, depth: 20, height: 20, rotation: 0, locked: false, hidden: false };
const JOINTS: CutJoint[] = ["dovetail", "plug", "snap", "thread"];
/** A 20 mm cube cut through the middle: each half without a joint. */
const HALF = 4000;

function volume(p: ArrayLike<number>) {
  let sum = 0;
  for (let i = 0; i < p.length; i += 9) {
    sum += p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7])
      - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6])
      + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
  }
  return sum / 6;
}

/** Area of the faces lying on the bed. */
function bedArea(p: ArrayLike<number>) {
  let area = 0;
  for (let i = 0; i < p.length; i += 9) {
    if (Math.max(p[i + 1], p[i + 4], p[i + 7]) > 0.01) continue;
    const ax = p[i + 3] - p[i];
    const az = p[i + 5] - p[i + 2];
    const bx = p[i + 6] - p[i];
    const bz = p[i + 8] - p[i + 2];
    area += Math.abs(ax * bz - az * bx) / 2;
  }
  return area;
}

function expectWorkingJoint(male: ArrayLike<number>, female: ArrayLike<number>) {
  // The plug side gains the joint and the socket side loses it.
  expect(volume(male)).toBeGreaterThan(HALF);
  expect(volume(female)).toBeLessThan(HALF);
  // The plug side lies flat on its back with the joint pointing up.
  expect(bedArea(male)).toBeCloseTo(400, 0);
  // The socket side lies cut face down, and the socket opens through that face.
  expect(bedArea(female)).toBeGreaterThan(250);
  expect(bedArea(female)).toBeLessThan(395);
}

describe("cut to fit joints", () => {
  it.each(JOINTS)("%s grows on one piece and opens a socket in the other", (joint) => {
    const [male, female] = cutShapeToFit(box, { axis: "x", offset: 0, joint, clearance: 0.2 });
    expectWorkingJoint(male.importedMesh!.positions, female.importedMesh!.positions);
  });

  it("runs a dovetail right across so it slides together", () => {
    const [, female] = cutShapeToFit(box, { axis: "x", offset: 0, joint: "dovetail", clearance: 0.2 });
    const p = female.importedMesh!.positions;
    // Socket side lies with the slot running front to back: the back face has a notch cut in it.
    let back = 0;
    for (let i = 0; i < p.length; i += 9) {
      if (Math.min(p[i + 2], p[i + 5], p[i + 8]) < female.depth / 2 - 0.01) continue;
      const ax = p[i + 3] - p[i];
      const ay = p[i + 4] - p[i + 1];
      const bx = p[i + 6] - p[i];
      const by = p[i + 7] - p[i + 1];
      back += Math.abs(ax * by - ay * bx) / 2;
    }
    expect(back).toBeLessThan(195);
  });
});

describe.skipIf(!hasNativeKernelExe || !hasWasmKernel)("cut to fit joints in the Mintr engine", () => {
  const native = spawnNativeKernelClient();
  afterAll(() => native.close());

  it("builds the same working joints on the desktop and in the browser", async () => {
    const wasm = await startWasmKernel();
    for (const joint of JOINTS) {
      const frame = splitPlaneFrame(box, { axis: "x", offset: 0 });
      const job = { id: 1, type: "split", solids: toNativeKernelSolids([box]), origin: frame.origin, normal: frame.normal, joint, clearance: 0.2, axis: "x" };
      const [desktop, browser] = await Promise.all([native.request(job), wasm.request(job)]);
      expect(desktop.ok, String(desktop.message)).toBe(true);
      expect(browser.ok, String(browser.message)).toBe(true);
      const [male, female] = desktop.parts as { positions: number[] }[];
      expectWorkingJoint(male.positions, female.positions);
      const [browserMale] = browser.parts as { positions: number[] }[];
      expect(volume(browserMale.positions)).toBeCloseTo(volume(male.positions), 0);
      const [tsMale] = cutShapeToFit(box, { axis: "x", offset: 0, joint, clearance: 0.2 });
      // The browser's mesh fallback builds the same joint, give or take its coarser curves.
      expect(Math.abs(volume(tsMale.importedMesh!.positions) - volume(male.positions))).toBeLessThan(25);
    }
  });
});
