import * as Automerge from "@automerge/automerge";
import { loadCalendarDocument, saveCalendarDocument } from "./automerge-document.js";
import { AUTOMERGE_MEDIA_TYPE, SYNC_SESSION_HEADER, SYNC_SEQUENCE_HEADER, SYNC_RESET_HEADER, AUTOMERGE_RESET_MEDIA_TYPE } from "./protocol.js";

class SyncSessionReset extends Error {}

export class CalendarSyncError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = "CalendarSyncError";
    this.status = status;
  }
}

// Peer state is connection-local, not calendar data. A failed exchange discards
// it; the native protocol rediscovers shared history on the next connection.
export function createCalendarSyncClient({ readSnapshot, mergeSnapshot }, {
  endpoint = "", fetch: fetchImpl = globalThis.fetch, credentials = "include",
} = {}) {
  if (!endpoint || typeof fetchImpl !== "function") throw new Error("Sync requires an endpoint and Fetch.");
  if (typeof readSnapshot !== "function" || typeof mergeSnapshot !== "function") throw new Error("Sync requires local snapshot storage.");
  let state, sessionId, sequence;
  let tail = Promise.resolve();
  const reset = () => { state = Automerge.initSyncState(); sessionId = crypto.randomUUID(); sequence = 0; };
  reset();

  async function exchange(signal) {
    let result;
    for (let round = 0; round < 100; round++) {
      signal?.throwIfAborted();
      const current = loadCalendarDocument(await readSnapshot());
      const [nextState, message] = Automerge.generateSyncMessage(current, state);
      state = nextState;
      // Even when locally unchanged, one empty poll asks the server to generate
      // any pending messages for changes made by another device.
      if (!message && round > 0) return result;
      const response = await fetchImpl(endpoint, {
        method: "POST", credentials, signal,
        headers: { "content-type": AUTOMERGE_MEDIA_TYPE, [SYNC_SESSION_HEADER]: sessionId, [SYNC_SEQUENCE_HEADER]: String(sequence) },
        body: message || new Uint8Array(),
      });
      if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new CalendarSyncError(detail || `Sync failed (${response.status})`, { status: response.status });
      }
      const mediaType = (response.headers.get("content-type") || "").split(";", 1)[0];
      if (mediaType === AUTOMERGE_RESET_MEDIA_TYPE && response.headers.get(SYNC_RESET_HEADER) === "1") throw new SyncSessionReset();
      if (mediaType !== AUTOMERGE_MEDIA_TYPE) {
        throw new CalendarSyncError("Invalid sync response type", { status: response.status });
      }
      const reply = new Uint8Array(await response.arrayBuffer());
      if (reply.byteLength) {
        // Read again after the request; edits made in flight must participate.
        const latest = loadCalendarDocument(await readSnapshot());
        const [updated, receivedState] = Automerge.receiveSyncMessage(latest, state, reply);
        result = await mergeSnapshot(saveCalendarDocument(updated));
        state = receivedState;
      }
      sequence++;
    }
    throw new CalendarSyncError("Sync did not finish; try again.");
  }

  return {
    sync(signal) {
      const run = async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try { return await exchange(signal); }
          catch (error) {
            reset();
            if (error instanceof SyncSessionReset) {
              if (attempt === 0) continue;
              throw new CalendarSyncError("Sync server repeatedly restarted the connection; try again.");
            }
            throw error;
          }
        }
      };
      const result = tail.then(run);
      tail = result.catch(() => {});
      return result;
    },
  };
}

export function syncCalendarStorage(storage, options) {
  return createCalendarSyncClient(storage, options).sync(options?.signal);
}
