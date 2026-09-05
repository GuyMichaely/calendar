# Automerge sync core

This directory contains the shared CRDT document model plus the hosting-agnostic request/response sync layer.

The Solid app already stores its canonical local state as the same versioned Automerge document used here. `site/storage.js` exposes serialized snapshots through `readSyncSnapshot()` and merges incoming snapshots through `mergeSyncSnapshot()`.

The canonical synchronized document has schema version `1` and an `items` map keyed by item ID. Item deletion uses an application-level `deletedAt` tombstone rather than immediate CRDT object deletion. Concurrent offline edits therefore cannot silently resurrect a deleted item. Explicit restore removes the tombstone.

`title` and `notes` use Automerge collaborative-text operations. Other fields are updated independently where practical. Tags, attachment metadata, and task history have fine-grained operations. Attachment bytes are excluded from the document. They remain local today and require a separate content-addressed remote blob service before attachments can synchronize across devices.

## Remote endpoint

`mergeSnapshotBytes(storedBytes, incomingBytes)` is the core merge primitive. `createSyncHandler()` exposes it as authenticated `POST /sync`: the client sends serialized Automerge bytes and receives the server's merged serialized document.

The endpoint is deliberately simple. It does not require Automerge Repo, WebSockets, peer processes, or an Automerge-specific server. Authentication is injected as `authenticate(request)`, so the sync layer does not know about Google, OIDC, or cookies.

`sync/client.js` works at the same serialized boundary as the Solid storage layer. `syncCalendarStorage()` reads one local snapshot, sends it through ordinary Fetch with credentials, then calls the supplied `mergeSnapshot(bytes)` only after the response arrives. The current Solid adapter can therefore use `readSyncSnapshot()` and `mergeSyncSnapshot()` directly. Because the merge occurs against the storage layer's current document, edits made while the network request is in flight are preserved.

No remote endpoint is configured in the browser application yet. The backend runtime, durable stores, secrets, and production URL still need to be chosen and provisioned before login and sync are enabled in the Solid UI.

## Document storage contract

The remote document store exposes an atomic update rather than separate `get()` and `put()` calls:

```js
documentStore.update(key, async (currentBytes) => {
  return {
    value: newStoredBytes,
    result: bytesReturnedToTheRequest
  };
})
```

A production adapter must serialize or transact concurrent updates for the same key. This prevents two requests from reading the same old state, independently creating different merged states, and overwriting each other on write. A database transaction, compare-and-swap loop, or single-owner state object can satisfy the contract.

`createMemoryDocumentStore()` implements the same serialized contract for tests and local development. It is not durable production storage.

## Backend composition and CORS

`backend/http.js` composes auth and sync. It allows credentialed CORS only for configured exact origins. Requests carrying an untrusted `Origin` are rejected before reaching auth or sync handlers so CORS is not relied on as a server-side authorization mechanism.

The sync endpoint requires `application/vnd.automerge`, a non-simple media type. Browser sync requests therefore require a preflight.

The separate `calendar-history` IndexedDB database remains local-only. It is never included in the Automerge document or remote sync.

## Tests

`tests/automerge.test.js` covers replica convergence, collaborative text, tags, conflicts, tombstones, explicit restore, serialization, replay, and in-flight merges.

`tests/automerge-storage.test.js` covers the current Solid IndexedDB adapter, including stale editor intent rebasing, collaborative text captured at historical heads, kind conversion cleanup, local attachment bytes, and local-only undo history.

`tests/sync-http.test.js` covers authentication gating, initial sync, atomic simultaneous requests, merged responses, replay, malformed input, size limits, and routing.

`tests/sync-client.test.js` covers the serialized storage boundary, credentialed Fetch, auth failures, response media validation, and edits made while a request is in flight.

`tests/backend-http.test.js` covers exact-origin CORS, rejection of untrusted origins, and a fake OIDC login through a real server session into a successful Automerge sync request.
