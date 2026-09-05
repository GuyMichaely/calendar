# Automerge sync core

This directory contains the shared CRDT document model plus the hosting-agnostic request/response sync layer.

The Solid app stores its canonical local state as the same versioned Automerge document used here. `site/storage.js` exposes serialized snapshots through `readSyncSnapshot()` and merges incoming snapshots through `mergeSyncSnapshot()`.

The canonical synchronized document has schema version `1` and an `items` map keyed by item ID. Item deletion uses an application-level `deletedAt` tombstone rather than immediate CRDT object deletion. Concurrent offline edits therefore cannot silently resurrect a deleted item. Explicit restore removes the tombstone.

`title` and `notes` use Automerge collaborative-text operations. Other fields are updated independently where practical. Tags, attachment metadata, and task history have fine-grained operations. Attachment bytes are excluded from the document and stored separately from the CRDT.

## Remote document endpoint

`mergeSnapshotBytes(storedBytes, incomingBytes)` is the core merge primitive. `createSyncHandler()` exposes it as authenticated `POST /sync`: the client sends serialized Automerge bytes and receives the server's merged serialized document.

The endpoint is deliberately simple. It does not require Automerge Repo, WebSockets, peer processes, or an Automerge-specific server. Authentication is injected as `authenticate(request)`, so the sync layer does not know about Google, OIDC, or cookies.

`sync/client.js` works at the same serialized boundary as the Solid storage layer. `syncCalendarStorage()` reads one local snapshot, sends it through ordinary Fetch with credentials, then calls the supplied `mergeSnapshot(bytes)` only after the response arrives. Because the merge occurs against the storage layer's current document, edits made while the network request is in flight are preserved.

`createSyncHandler()` accepts an optional backend path prefix. The same prefix can therefore be used consistently for OIDC callbacks, `/sync`, attachment routes, and the Solid remote client.

## Attachment endpoint

`sync/attachments-http.js` exposes attachment bytes separately from the Automerge document. Attachment metadata already contains a stable attachment ID, so the blob route uses that existing ID without changing schema version `1`:

```text
HEAD /attachments/:id
GET  /attachments/:id
PUT  /attachments/:id
```

All three operations require the same injected authentication used by document sync. `HEAD` lets a client avoid re-uploading a blob that is already present. `PUT` is immutable through the blob-store `putIfAbsent()` contract. `GET` returns the stored bytes and media type. The default upload limit is 25 MiB.

The Solid remote client performs document merge first. It then examines the merged attachment metadata. Referenced blobs already present in local IndexedDB are uploaded if absent remotely; referenced blobs missing locally are downloaded and inserted into the local attachment object store. A later normal item refresh hydrates those blobs onto attachment metadata.

A production blob-store adapter must provide:

```js
blobStore.get(id)
blobStore.putIfAbsent(id, { bytes, contentType })
```

No provider-specific object storage API is assumed.

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

`backend/http.js` composes auth, document sync, and optional attachment sync. It allows credentialed CORS only for configured exact origins. Requests carrying an untrusted `Origin` are rejected before reaching state-changing handlers so CORS is not relied on as a server-side authorization mechanism.

The sync endpoint requires `application/vnd.automerge`, a non-simple media type. Attachment uploads use their actual content type. Browser cross-origin requests therefore use the configured preflight path where required.

`backend/app.js` creates the complete provider-neutral handler from injected auth, document, and optional blob stores. `backend/node-dev.js` provides a memory-only local HTTP runtime for browser testing. Production runtime and durable storage remain separate deployment choices.

The separate `calendar-history` IndexedDB database remains local-only. It is never included in the Automerge document or remote sync.

## Tests

`tests/automerge.test.js` covers replica convergence, collaborative text, tags, conflicts, tombstones, explicit restore, serialization, replay, and in-flight merges.

`tests/automerge-storage.test.js` covers the current Solid IndexedDB adapter, including stale editor intent rebasing, collaborative text captured at historical heads, kind conversion cleanup, local attachment bytes, and local-only undo history.

`tests/sync-http.test.js` covers authentication gating, initial sync, atomic simultaneous requests, merged responses, replay, malformed input, size limits, and routing.

`tests/sync-client.test.js` covers the serialized storage boundary, credentialed Fetch, auth failures, response media validation, and edits made while a request is in flight.

`tests/attachments-http.test.js` covers attachment authentication, path prefixes, immutable upload, probing, downloading, and size limits.

`tests/backend-http.test.js`, `tests/backend-prefix.test.js`, and `tests/backend-attachment-integration.test.js` cover backend composition, exact-origin CORS, prefixed routing, auth sessions, Automerge sync, and attachment access.

`solid/test/remote-sync.test.ts` covers browser session handling, queued sync, path-prefixed URLs, and attachment upload/download behavior.
