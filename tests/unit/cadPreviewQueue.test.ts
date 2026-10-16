import { describe, expect, it } from "vitest";
import { createCadPreviewQueue } from "@/lib/cadPreviewQueue";

describe("cad preview queue", () => {
  it("sends the first preview and keeps only the newest one behind it", () => {
    const sent: number[] = [];
    let nextId = 1;
    const queue = createCadPreviewQueue((payload: { amount: number }) => {
      sent.push(payload.amount);
      return nextId++;
    });

    expect(queue.request({ amount: 1 })).toEqual({ status: "sent", requestId: 1 });
    expect(queue.request({ amount: 2 })).toEqual({ status: "queued", requestId: null });
    expect(queue.request({ amount: 3 })).toEqual({ status: "queued", requestId: null });
    expect(sent).toEqual([1]);

    expect(queue.settle(1)).toEqual({ status: "sent", requestId: 2 });
    expect(sent).toEqual([1, 3]);
    expect(queue.settle(2)).toEqual({ status: "idle", requestId: null });
  });

  it("ignores a result that is not the one in flight", () => {
    const queue = createCadPreviewQueue(() => 7);
    queue.request({ amount: 1 });
    expect(queue.settle(4)).toEqual({ status: "idle", requestId: null });
    expect(queue.inFlightId).toBe(7);
  });
});
