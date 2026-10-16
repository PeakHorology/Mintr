/**
 * A fillet preview is expensive, and a size slider can ask for a new one on
 * every step. The worker still finishes each request it has already been
 * given, so a drag used to leave it working through sizes nobody would see.
 *
 * At most one preview is in flight. Anything that arrives while it runs
 * replaces the waiting request. Only the newest size is sent next.
 */

export type CadPreviewSend<TPayload> = (payload: TPayload) => number | null;

export type CadPreviewDispatch =
  | { status: "sent"; requestId: number }
  | { status: "queued"; requestId: null }
  | { status: "failed"; requestId: null };

export type CadPreviewSettle =
  | { status: "sent"; requestId: number }
  | { status: "idle"; requestId: null }
  | { status: "failed"; requestId: null };

export type CadPreviewQueue<TPayload> = {
  readonly inFlightId: number | null;
  readonly queuedPayload: TPayload | null;
  request: (payload: TPayload) => CadPreviewDispatch;
  settle: (requestId: number) => CadPreviewSettle;
  reset: () => void;
};

export function createCadPreviewQueue<TPayload>(send: CadPreviewSend<TPayload>): CadPreviewQueue<TPayload> {
  let inFlightId: number | null = null;
  let queuedPayload: TPayload | null = null;
  let queued = false;

  const dispatch = (payload: TPayload): CadPreviewDispatch => {
    const requestId = send(payload);
    if (requestId === null) {
      inFlightId = null;
      return { status: "failed", requestId: null };
    }
    inFlightId = requestId;
    return { status: "sent", requestId };
  };

  return {
    get inFlightId() {
      return inFlightId;
    },
    get queuedPayload() {
      return queued ? queuedPayload : null;
    },
    request(payload) {
      if (inFlightId !== null) {
        queuedPayload = payload;
        queued = true;
        return { status: "queued", requestId: null };
      }
      return dispatch(payload);
    },
    settle(requestId) {
      if (inFlightId !== null && requestId !== inFlightId) return { status: "idle", requestId: null };
      inFlightId = null;
      if (!queued) return { status: "idle", requestId: null };
      const payload = queuedPayload as TPayload;
      queuedPayload = null;
      queued = false;
      const result = dispatch(payload);
      return result.status === "sent" ? result : { status: "failed", requestId: null };
    },
    reset() {
      inFlightId = null;
      queuedPayload = null;
      queued = false;
    },
  };
}
