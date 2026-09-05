import { AUTOMERGE_MEDIA_TYPE } from "./http.js";

export class CalendarSyncError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = "CalendarSyncError";
    this.status = status;
  }
}

function copySnapshotBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  throw new Error("Calendar sync requires serialized Automerge bytes.");
}

export async function exchangeCalendarSnapshotBytes(snapshotBytes, {
  endpoint,
  fetch: fetchImpl = globalThis.fetch,
  credentials = "include",
  signal,
} = {}) {
  if (!endpoint) throw new Error("Calendar sync requires an endpoint.");
  if (typeof fetchImpl !== "function") throw new Error("Calendar sync requires Fetch API support.");
  const outgoing = copySnapshotBytes(snapshotBytes);
  if (!outgoing.byteLength) throw new Error("Calendar sync snapshot must not be empty.");

  const response = await fetchImpl(endpoint, {
    method: "POST",
    credentials,
    signal,
    headers: { "content-type": AUTOMERGE_MEDIA_TYPE },
    body: outgoing,
  });

  if (!response.ok) {
    let message = `Calendar sync failed (${response.status})`;
    try {
      const detail = (await response.text()).trim();
      if (detail) message = detail;
    } catch {
      // Keep the status-based message if the response body cannot be read.
    }
    throw new CalendarSyncError(message, { status: response.status });
  }

  const responseType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (responseType !== AUTOMERGE_MEDIA_TYPE) {
    throw new CalendarSyncError(`Sync response Content-Type must be ${AUTOMERGE_MEDIA_TYPE}`, { status: response.status });
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function syncCalendarStorage({ readSnapshot, mergeSnapshot }, options) {
  if (typeof readSnapshot !== "function") throw new Error("Calendar sync requires readSnapshot().");
  if (typeof mergeSnapshot !== "function") throw new Error("Calendar sync requires mergeSnapshot(bytes).");

  const sent = await readSnapshot();
  const remote = await exchangeCalendarSnapshotBytes(sent, options);

  // mergeSnapshot must merge into the storage layer's current document. It is
  // intentionally called after the network response so edits made while the
  // request was in flight are retained by Automerge rather than replaced by
  // the snapshot that was sent.
  return mergeSnapshot(remote);
}
