import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { toNativeKernelSolid } from "@/lib/nativeKernelProtocol";
import type { WorkplaneShape } from "@/types/sketchforge";

const repoRoot = path.resolve(__dirname, "../..");
const releaseExe = path.join(repoRoot, "native/mintr-kernel/build/Release/MintrKernel.exe");
const distExe = path.join(repoRoot, "native/mintr-kernel/dist/MintrKernel.exe");
const exe = existsSync(releaseExe) ? releaseExe : distExe;
const hasExe = existsSync(exe);

function box(id: string, extra: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id,
    name: id,
    kind: "box",
    color: "#d41721",
    x: 0,
    z: 0,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
    ...extra,
  };
}

function kernelClient() {
  const child = spawn(exe, [], {
    cwd: path.dirname(exe),
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  });
  let buf = Buffer.alloc(0);
  const pending = new Map<number, (reply: Record<string, unknown>) => void>();
  child.stdout?.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const size = buf.readUInt32LE(0);
      if (size === 0 || size > 256 * 1024 * 1024) return;
      if (buf.length < 4 + size) return;
      const reply = JSON.parse(buf.subarray(4, 4 + size).toString("utf8")) as Record<string, unknown>;
      buf = Buffer.from(buf.subarray(4 + size));
      const id = Number(reply.id ?? reply.requestId ?? 0);
      pending.get(id)?.(reply);
      pending.delete(id);
    }
  });
  function request(job: Record<string, unknown>, timeoutMs = 45000) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = Number(job.id ?? job.requestId ?? 0);
      const timer = setTimeout(() => reject(new Error(`timeout ${String(job.type)}`)), timeoutMs);
      pending.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      const body = Buffer.from(JSON.stringify(job), "utf8");
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length, 0);
      child.stdin?.write(header);
      child.stdin?.write(body);
    });
  }
  return {
    request,
    close() {
      child.kill();
    },
  };
}

describe.skipIf(!hasExe)("Group kernel timing", () => {
  const client = kernelClient();
  afterAll(() => client.close());

  it("reports ping, hole-cut, and nine-box union cost", async () => {
    // Keep the original bounds, then time rounded-into-square unions below.
    await client.request({ id: 1, type: "ping" });

    const solid = toNativeKernelSolid(box("solid"));
    const hole = toNativeKernelSolid(box("hole", { kind: "cylinder", hole: true, width: 8, depth: 8, height: 24, elevation: -2 }));
    const cutStart = performance.now();
    const cut = await client.request({ id: 2, type: "boolean", op: "subtract", solids: [solid, hole] });
    const cutMs = performance.now() - cutStart;

    const solids = Array.from({ length: 9 }, (_, i) => toNativeKernelSolid(box(`u${i}`, { x: i * 22 })));
    const unionStart = performance.now();
    const fused = await client.request({ id: 3, type: "boolean", op: "union", solids });
    const unionMs = performance.now() - unionStart;

    expect(cut.ok).toBe(true);
    expect(fused.ok).toBe(true);
    expect(cutMs).toBeLessThan(8000);
    expect(unionMs).toBeLessThan(15000);
  }, 30000);

  it("times overlapping rounded-into-box unions", async () => {
    const cases: Array<[string, Partial<WorkplaneShape>]> = [
      ["cylinder", { kind: "cylinder", width: 16, depth: 16, x: 8 }],
      ["sphere", { kind: "sphere", width: 20, depth: 20, height: 20, x: 8 }],
      ["roundRoof", { kind: "roundRoof", width: 20, depth: 20, height: 16, x: 8 }],
    ];
    const times: Record<string, number> = {};
    for (let index = 0; index < cases.length; index += 1) {
      const [name, extra] = cases[index];
      const square = toNativeKernelSolid(box("square"));
      const rounded = toNativeKernelSolid(box(name, extra));
      const start = performance.now();
      const reply = await client.request({
        id: 20 + index,
        type: "boolean",
        op: "union",
        solids: [square, rounded],
      });
      times[name] = Math.round(performance.now() - start);
      expect(reply.ok, `${name} ${times[name]}ms ${String(reply.message)}`).toBe(true);
    }
    expect(times, JSON.stringify(times)).toEqual(times);
  }, 60000);
});
