# Automerge sync core

This top-level directory is shared by the frontend and backend: it contains the CRDT document model, protocol constants, and client. Server-only authentication and HTTP handlers live in `backend/auth/` and `backend/sync/`.

The Solid app stores its canonical local state as the same versioned Automerge document used here. `site/storage.js` exposes serialized snapshots through `readSyncSnapshot()` and merges incoming snapshots through `mergeSyncSnapshot()`.

The canonical synchronized document has schema version `2` and one `items` map keyed by item ID. Every device clones the same genesis change. Loading and merging require that exact root identity and reject conflicting roots or other schema versions; there is no legacy decoder or recovery path.

Generation 2 starts with a new Automerge edit history. Current items, task activity history, and deletion tombstones were preserved during the one-time production conversion. Browser document and undo databases are scoped to this generation. Refresh each device and sync to download its calendar; unsynchronized data from the previous generation is not imported automatically.

Item deletion uses an application-level `deletedAt` tombstone rather than immediate CRDT object deletion. Concurrent offline edits therefore cannot silently resurrect a deleted item. Explicit restore removes the tombstone.

`title` and `notes` use Automerge collaborative-text operations. Other fields are updated independently where practical. Tags, attachment metadata, and task history have fine-grained operations. Attachment bytes are excluded from the document and stored separately from the CRDT.

## Remote document endpoint

See [incremental sync](../docs/incremental-sync.md) for the native message protocol, ordered session handling, reconnection behavior, and persistence boundary. The calendar uses `application/vnd.automerge.sync` on `POST /sync`. Saved documents stay as complete Automerge snapshots in IndexedDB and Durable Object storage; only missing changes and protocol metadata travel over the network.

The server authenticates requests before reading messages, decodes malformed client messages before touching storage, and validates the resulting calendar before writing it. Incompatible calendar changes return HTTP 409; lost peer state returns HTTP 200 with `X-Automerge-Reset: 1` and triggers a native handshake restart. Internal storage failures remain HTTP 500, independent of Automerge's error wording.

## Attachment endpoint

`backend/sync/attachments-http.js` exposes attachment bytes separately from the Automerge document. Attachment metadata already contains a stable attachment ID, so the blob route uses that existing ID without changing schema version `2`:

```text
HEAD /attachments/:id
GET  /attachments/:id
PUT  /attachments/:id
```

Attachment entries are immutable CRDT list objects. Adding an identical existing entry is a no-op; changing its metadata requires removing the old entry and inserting a whole replacement. Undo re-adds a whole entry. The file ID can continue to reference the same immutable blob. A replacement concurrent with removal survives as a new insertion; no metadata fields are edited on the removed object.

All three operations require the same injected authentication used by document sync. `HEAD` lets a client avoid re-uploading a blob that is already present. `PUT` is immutable through the blob-store `putIfAbsent()` contract. `GET` returns the stored bytes and media type. The attachment endpoint does not impose an application-level byte limit; concrete runtimes, reverse proxies, and storage providers may still impose technical limits.

For current application writes, attachment bytes are uploaded before their metadata is persisted in the Automerge document. The browser does not use IndexedDB as the normal attachment byte store. When a user opens an attachment, the client fetches the blob from the remote attachment endpoint on demand.

Production server-side blob bytes sit behind a separate blob-store contract so a deployment can use filesystem, object/blob storage, or another durable implementation without changing the sync protocol:

```js
blobStore.get(id)
blobStore.putIfAbsent(id, { bytes, contentType })
```

No provider-specific object storage API is assumed. `backend/file-stores.js` supplies the current persistent filesystem implementation; the memory store remains useful for tests and local development.

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

`createMemoryDocumentStore()` implements the same serialized contract for tests and local development. `backend/file-stores.js` provides a durable single-process filesystem implementation. Do not run multiple backend processes against the same filesystem data directory; use a store with cross-process serialization if the deployment needs multiple writers.

## Backend composition and CORS

`backend/http.js` composes auth, document sync, and optional attachment sync. It allows credentialed CORS only for configured exact origins. Requests carrying an untrusted `Origin` are rejected before reaching state-changing handlers so CORS is not relied on as a server-side authorization mechanism.

The sync endpoint requires `application/vnd.automerge.sync`, a non-simple media type. Attachment uploads use their actual content type. Browser cross-origin requests therefore use the configured preflight path where required.

`backend/app.js` creates the complete provider-neutral handler from injected auth, document, and optional blob stores. `backend/bun-dev.js` provides a memory-only Bun HTTP runtime for local browser testing. `backend/bun-server.js` composes the persistent filesystem stores for a durable single-process deployment; see `backend/README.md` for runtime configuration and backup requirements.

The separate `calendar-history` IndexedDB database remains local-only. It is never included in the Automerge document or remote sync.

## Tests

`tests/automerge.test.js` covers replica convergence, collaborative text, tags, conflicts, tombstones, explicit restore, serialization, replay, and in-flight merges.

`tests/automerge-storage.test.js` covers the Solid IndexedDB adapter, including stale editor intent rebasing, collaborative text captured at historical heads, kind conversion cleanup, and local-only undo history.

`tests/sync-http.test.js` covers authentication gating, initial sync, atomic simultaneous requests, merged responses, replay, malformed input, empty input, and routing.

`tests/sync-client.test.js` covers the serialized storage boundary, credentialed Fetch, auth failures, response media validation, and edits made while a request is in flight.

`tests/attachments-http.test.js` covers attachment authentication, path prefixes, immutable upload, probing, downloading, and unrestricted application-level upload size.

`tests/backend-http.test.js`, `tests/backend-prefix.test.js`, and `tests/backend-attachment-integration.test.js` cover backend composition, exact-origin CORS, prefixed routing, auth sessions, Automerge sync, and attachment access.

`solid/test/remote-sync.test.ts` covers browser session handling, queued sync, path-prefixed URLs, and attachment upload/download behavior.
