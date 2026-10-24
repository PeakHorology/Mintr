import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const { __test } = require("../../electron/kernelHost.cjs") as {
  __test: {
    attachChild: (proc: unknown) => void;
    pending: Map<number, { resolve: (value: { id?: number }) => void; timer: ReturnType<typeof setTimeout> }>;
  };
};

function frame(payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

describe("kernelHost stdout framing", () => {
  it("reassembles frames split across chunks and splits chunks holding several frames", () => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stdin: new EventEmitter(),
      killed: false,
      kill() {},
    });
    __test.attachChild(proc);
    const settled: number[] = [];
    for (let id = 1; id <= 4; id += 1) {
      __test.pending.set(id, { resolve: (value) => settled.push(value.id ?? -1), timer: setTimeout(() => {}, 0) });
    }
    const big = frame({ id: 1, data: "x".repeat(200_000) });
    const pair = Buffer.concat([frame({ id: 2 }), frame({ id: 3 })]);
    const last = frame({ id: 4 });

    proc.stdout.emit("data", big.subarray(0, 2)); // header split
    proc.stdout.emit("data", big.subarray(2, 70_000));
    proc.stdout.emit("data", big.subarray(70_000));
    proc.stdout.emit("data", Buffer.concat([pair, last.subarray(0, 1)])); // two frames + a stray byte
    proc.stdout.emit("data", last.subarray(1));

    expect(settled).toEqual([1, 2, 3, 4]);
  });
});
