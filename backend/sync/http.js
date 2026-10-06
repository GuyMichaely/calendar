import * as Automerge from "@automerge/automerge";
import { CalendarDocumentError, createCalendarDocument, loadCalendarDocument, saveCalendarDocument } from "../../sync/automerge-document.js";
import { AUTOMERGE_MEDIA_TYPE, SYNC_SESSION_HEADER, SYNC_SEQUENCE_HEADER, SYNC_RESET_HEADER, AUTOMERGE_RESET_MEDIA_TYPE } from "../../sync/protocol.js";
export { AUTOMERGE_MEDIA_TYPE };

class SyncSessionReset extends Error {}

class SyncRequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function copyBytes(value) {
  return value == null ? null : new Uint8Array(value);
}

export function createMemoryDocumentStore(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, copyBytes(value)]));
  const tails = new Map();

  return {
    async get(key) {
      return copyBytes(values.get(key) || null);
    },

    async update(key, updater) {
      if (typeof updater !== "function") throw new Error("Document store update requires a function.");
      const previous = tails.get(key) || Promise.resolve();
      let finish;
      const tail = new Promise((resolve) => { finish = resolve; });
      tails.set(key, previous.catch(() => {}).then(() => tail));

      await previous.catch(() => {});
      try {
        const current = copyBytes(values.get(key) || null);
        const outcome = await updater(current);
        if (!outcome || !(outcome.value instanceof Uint8Array)) {
          throw new Error("Document store updater must return { value: Uint8Array, result }.");
        }
        values.set(key, copyBytes(outcome.value));
        return outcome.result;
      } finally {
        finish();
      }
    },
  };
}

function mediaType(request) {
  return (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
}

/**
 * POST /sync: one round of Automerge's sync protocol with a device. Cloudflare Access decides who
 * reaches it, so it doesn't check. `onChanged(heads)` hears each stored change, for the live connection.
 */
export function createSyncHandler({
  documentStore, documentKey = "calendar:primary", onChanged = () => {},
  now = () => Date.now(), sessionTtlMs = 300_000, maxSessions = 100,
}) {
  if (!documentStore?.update) throw new Error("Sync requires atomic document storage.");
  const peers = new Map();
  let tail = Promise.resolve();

  async function exchange(key, sequence, incoming) {
    for (const [stale, peer] of peers) if (now() - peer.touched > sessionTtlMs) peers.delete(stale);
    const existing = peers.get(key);
    if (!existing && sequence !== 0) throw new SyncSessionReset();
    const peer = existing || { state: Automerge.initSyncState(), sequence: 0 };
    if (sequence !== peer.sequence) throw new SyncSessionReset();
    const outcome = await documentStore.update(documentKey, async storedBytes => {
      let doc = storedBytes ? loadCalendarDocument(storedBytes) : createCalendarDocument();
      const before = Automerge.getHeads(doc).join();
      let state = peer.state;
      if (incoming.byteLength) {
        try { [doc, state] = Automerge.receiveSyncMessage(doc, state, incoming); }
        catch (cause) { throw new SyncRequestError("Invalid sync message"); }
      }
      let bytes;
      try { bytes = saveCalendarDocument(doc); }
      catch (error) {
        if (error instanceof CalendarDocumentError) throw new SyncRequestError(error.message, 409);
        throw error;
      }
      const [nextState, reply] = Automerge.generateSyncMessage(doc, state);
      const heads = Automerge.getHeads(doc);
      return { value: bytes, result: { state: nextState, reply: reply || new Uint8Array(), changed: heads.join() !== before ? heads : null } };
    });
    if (outcome.changed) onChanged(outcome.changed);
    // Advance protocol state only after durable document storage succeeds.
    peers.delete(key);
    peers.set(key, { state: outcome.state, sequence: sequence + 1, touched: now() });
    while (peers.size > maxSessions) peers.delete(peers.keys().next().value);
    return outcome.reply;
  }

  return async function handleSync(request) {
    if (new URL(request.url).pathname !== "/sync") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
    if (mediaType(request) !== AUTOMERGE_MEDIA_TYPE) return new Response(`Refresh the app. Content-Type must be ${AUTOMERGE_MEDIA_TYPE}`, { status: 415 });
    const sessionId = request.headers.get(SYNC_SESSION_HEADER) || "";
    const sequenceText = request.headers.get(SYNC_SEQUENCE_HEADER) || "";
    const sequence = Number(sequenceText);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(sessionId) || !/^(0|[1-9][0-9]*)$/.test(sequenceText) || !Number.isSafeInteger(sequence)) {
      return new Response("Invalid sync session or sequence", { status: 400 });
    }
    const incoming = new Uint8Array(await request.arrayBuffer());
    if (incoming.byteLength) {
      try { Automerge.decodeSyncMessage(incoming); }
      catch (cause) { return new Response("Invalid sync message", { status: 400 }); }
    }
    const run = () => exchange(sessionId, sequence, incoming);
    const result = tail.then(run);
    tail = result.catch(() => {});
    try {
      const reply = await result;
      return new Response(reply, { headers: { "content-type": AUTOMERGE_MEDIA_TYPE, "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof SyncSessionReset) return new Response(null, { headers: { "content-type": AUTOMERGE_RESET_MEDIA_TYPE, [SYNC_RESET_HEADER]: "1", "cache-control": "no-store" } });
      if (error instanceof SyncRequestError) return new Response(error.message, { status: error.status });
      console.error("Calendar sync failed", error);
      return new Response("Sync failed", { status: 500 });
    }
  };
}
