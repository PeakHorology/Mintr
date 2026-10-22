import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");
const kernelCandidates = [
  path.join(repoRoot, "native/mintr-kernel/build/Release/MintrKernel.exe"),
  path.join(repoRoot, "native/mintr-kernel/dist/MintrKernel.exe"),
] as const;

export const nativeKernelExe =
  kernelCandidates.find((file) => existsSync(file)) ?? kernelCandidates[1];
export const hasNativeKernelExe = existsSync(nativeKernelExe);

export type NativeKernelClient = {
  request: (job: Record<string, unknown>, timeoutMs?: number) => Promise<Record<string, unknown>>;
  close: () => void;
};

/** Collection-time safe: skipIf still runs the describe body, so never spawn a missing exe. */
export function spawnNativeKernelClient(): NativeKernelClient {
  if (!hasNativeKernelExe) {
    return {
      request() {
        return Promise.reject(new Error("MintrKernel.exe is not built"));
      },
      close() {},
    };
  }

  const child = spawn(nativeKernelExe, [], {
    cwd: path.dirname(nativeKernelExe),
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  });
  let buf = Buffer.alloc(0);
  const pending = new Map<number, {
    resolve: (reply: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  function failAll(error: Error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }

  child.on("error", (error) => {
    failAll(error instanceof Error ? error : new Error(String(error)));
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const size = buf.readUInt32LE(0);
      if (size === 0 || size > 256 * 1024 * 1024) return;
      if (buf.length < 4 + size) return;
      const reply = JSON.parse(buf.subarray(4, 4 + size).toString("utf8")) as Record<string, unknown>;
      buf = Buffer.from(buf.subarray(4 + size));
      const id = Number(reply.id ?? reply.requestId ?? 0);
      const entry = pending.get(id);
      if (!entry) continue;
      pending.delete(id);
      clearTimeout(entry.timer);
      entry.resolve(reply);
    }
  });

  function request(job: Record<string, unknown>, timeoutMs = 45000) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = Number(job.id ?? job.requestId ?? 0);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout ${String(job.type)}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
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
