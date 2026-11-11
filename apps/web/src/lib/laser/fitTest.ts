import type { LaserSettings } from "@/lib/laserMachine";

/**
 * Fit test: a comb of slots and a key strip, cut together. Each slot is drawn for
 * a different kerf; the one the key pushes into snugly shows the laser's real kerf.
 *
 * Mintr moves each cut line out by half the kerf setting. With a setting of K and a
 * real kerf R, a key drawn a wide comes out a + K - R and a slot drawn w comes out
 * w - K + R. They match when R = K + (a - w) / 2, so a slot drawn
 * w = a + 2 (K - k) fits exactly when the real kerf is k. That is the same fit as
 * a finger joint's, so the kerf it finds is the one joints need.
 */

export const FIT_TEST_KEY_WIDTH = 5;
const SLOT_PITCH = 9;
const SLOT_DEPTH = 6;
const COMB_DEPTH = 18;
const END_MARGIN = 5;
const KEY_LENGTH = 30;
const LABEL_HEIGHT = 3.5;

/** The kerfs a fit test tries, by kind of laser: eleven steps round what that kind usually burns. */
export function fitTestKerfs(laserType: LaserSettings["laserType"]): number[] {
  const [start, step] = laserType === "co2" ? [0.06, 0.03] : laserType === "infrared" || laserType === "uv" ? [0, 0.01] : [0, 0.02];
  return Array.from({ length: 11 }, (_, index) => Number((start + step * index).toFixed(3)));
}

/** What is engraved by a slot: its kerf in hundredths of a millimetre, so 12 means 0.12 mm. */
export function fitTestLabel(kerf: number) {
  return String(Math.round(kerf * 100));
}

export type FitTestLayout = {
  /** Outlines in workplane millimetres, x to the right and z toward the front, centred on 0. */
  comb: [number, number][];
  key: [number, number][];
  labels: { text: string; x: number; z: number; width: number; depth: number }[];
};

/** The comb, slots opening toward the back, numbers in front of them, and the key below. */
export function fitTestLayout(kerfs: readonly number[], currentKerf: number): FitTestLayout {
  const length = END_MARGIN * 2 + kerfs.length * SLOT_PITCH;
  const left = -length / 2;
  const back = -(COMB_DEPTH + 6 + FIT_TEST_KEY_WIDTH) / 2;
  const comb: [number, number][] = [[left, back]];
  const labels: FitTestLayout["labels"] = [];
  kerfs.forEach((kerf, index) => {
    const middle = left + END_MARGIN + SLOT_PITCH * (index + 0.5);
    const width = Math.max(0.5, FIT_TEST_KEY_WIDTH + 2 * (currentKerf - kerf));
    comb.push([middle - width / 2, back], [middle - width / 2, back + SLOT_DEPTH], [middle + width / 2, back + SLOT_DEPTH], [middle + width / 2, back]);
    const text = fitTestLabel(kerf);
    labels.push({ text, x: middle, z: back + SLOT_DEPTH + 1.5 + LABEL_HEIGHT / 2, width: Math.min(SLOT_PITCH - 1.5, 2.6 * text.length), depth: LABEL_HEIGHT });
  });
  comb.push([left + length, back], [left + length, back + COMB_DEPTH], [left, back + COMB_DEPTH]);
  const keyTop = back + COMB_DEPTH + 6;
  const key: [number, number][] = [
    [left, keyTop],
    [left + KEY_LENGTH, keyTop],
    [left + KEY_LENGTH, keyTop + FIT_TEST_KEY_WIDTH],
    [left, keyTop + FIT_TEST_KEY_WIDTH],
  ];
  return { comb, key, labels };
}
