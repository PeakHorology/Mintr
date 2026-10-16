import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { shellSolid } from "@/lib/cadShell";

const occtDir = join(process.cwd(), "node_modules", "occt-wasm", "dist");
const { OcctKernel } = await import(pathToFileURL(join(occtDir, "index.js")).href);
const kernel: OcctKernel = await OcctKernel.init({ wasm: join(occtDir, "occt-wasm.wasm") });

function contains(shape: ShapeHandle, x: number, y: number, z: number) {
  return kernel.containsPoint(shape, { x, y, z }, 1e-4);
}

describe("shellSolid", () => {
  it("opens the top of a box and leaves a floor and side walls", () => {
    const box = kernel.makeBoxFromCorners({ x: -10, y: 0, z: -10 }, { x: 10, y: 10, z: 10 });
    const hollow = shellSolid(kernel, box, 2, ["top"]);
    expect(Math.abs(kernel.getVolume(hollow))).toBeLessThan(Math.abs(kernel.getVolume(box)));
    expect(contains(hollow, 0, 1, 0)).toBe(true);
    expect(contains(hollow, 0, 6, 0)).toBe(false);
    expect(contains(hollow, 9.2, 6, 0)).toBe(true);
    expect(contains(hollow, 7.6, 6, 7.6)).toBe(false);
  });

  it("rounds the inside corners without filling the cavity or moving the outside wall", () => {
    const box = kernel.makeBoxFromCorners({ x: -10, y: 0, z: -10 }, { x: 10, y: 20, z: 10 });
    const sharp = shellSolid(kernel, box, 2, ["top"], "sharp");
    const round = shellSolid(kernel, box, 2, ["top"], "round", 2);
    const corners = [
      [7.6, 10, 7.6],
      [7.6, 10, -7.6],
      [-7.6, 10, 7.6],
      [-7.6, 10, -7.6],
    ] as const;
    expect(corners.map((point) => contains(sharp, ...point))).toEqual([false, false, false, false]);
    expect(corners.map((point) => contains(round, ...point))).toEqual([true, true, true, true]);
    expect(contains(round, 0, 10, 0)).toBe(false);
    expect(contains(round, 9.2, 10, 0)).toBe(true);
    expect(contains(round, 9.7, 10, 9.7)).toBe(true);
    expect(Math.abs(kernel.getVolume(round))).toBeGreaterThan(Math.abs(kernel.getVolume(sharp)));
  });
});
