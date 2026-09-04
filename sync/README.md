# Automerge sync core

This directory contains the transport- and hosting-agnostic CRDT and request/response sync layers for calendar data.

The live browser application does not use them yet. That is deliberate: frontend refactors are happening in parallel, so these phases prove the data/merge/network semantics without changing the current `site/storage.js` contract or deployment.

The canonical synchronized document is one Automerge document with schema version `1` and an `items` map keyed by item ID. Item deletions are application-level tombstones (`deletedAt`) rather than immediate CRDT object deletion. Concurrent edits therefore cannot accidentally resurrect a deleted item, while an explicit restore can remove the tombstone later.

`title` and `notes` are updated through Automerge collaborative-text operations. Other fields are updated independently so edits to different properties can merge without replacing the whole item. Tags and attachment metadata have dedicated fine-grained operations. Attachment bytes are intentionally excluded from the document; blobs will be synchronized through a separate content-addressed attachment service and cached locally.

`mergeSnapshotBytes(storedBytes, incomingBytes)` is the core merge primitive. `createSyncHandler()` exposes it as authenticated `POST /sync`: the client sends serialized Automerge bytes and receives the server's merged serialized document. It does not require Automerge Repo, WebSockets, peer processes, or an Automerge-specific server.

`exchangeCalendarSnapshot()` is the corresponding ordinary Fetch API client. `syncLatestCalendarDocument()` sends one immutable snapshot and, when the response arrives, merges it into whatever document is current at that moment so local edits made while the request was in flight are preserved. The selected frontend can wrap this with its own persistence/state update mechanism later.

## Storage contract

The remote document store deliberately exposes an atomic operation rather than separate `get()` and `put()` calls:

```js
documentStore.update(key, async (currentBytes) => {
  return {
    value: newStoredBytes,
    result: bytesReturnedToTheRequest
  };
})
```

A production adapter **must** serialize or transact concurrent updates for the same key. This prevents the classic race where two requests both read state A, independently produce AB and AC, and then one write overwrites the other. The exact implementation is host-specific: a row transaction/compare-and-swap loop, a lock, a single-owner state object, etc. The sync HTTP API does not depend on which mechanism is used.

`createMemoryDocumentStore()` provides the same serialized contract for tests and local development. It is not intended as durable production storage.

The sync handler receives an injected `authenticate(request)` function. The OIDC auth layer can supply that from its server session, while the CRDT layer remains unaware of Google, Microsoft, cookies, or OIDC.

`backend/http.js` composes auth and sync and applies credentialed CORS only to explicitly configured frontend origins. The sync endpoint requires `application/vnd.automerge`, a non-simple media type, so browser sync requests are preflighted rather than being form-postable cross-site requests.

The separate `calendar-history` IndexedDB database remains local-only and is not represented in this document or sync endpoint.

## Tests

`tests/automerge.test.js` simulates disconnected laptop/phone/tablet replicas in one Node process. It covers independent edits, collaborative text, tag additions, same-field conflicts, tombstone/edit races, explicit restore, serialization, in-flight edits, idempotent replay, and multi-replica convergence.

`tests/sync-http.test.js` drives the request/response handler without a remote service. It covers authentication gating, initial synchronization, simultaneous requests, merged responses, replay, invalid input, size limits, and routing. The simultaneous-request test verifies that the in-memory store's atomic update contract preserves both divergent replicas.

`tests/sync-client.test.js` covers the plain Fetch client, HTTP failures, and edits made while a request is in flight. `tests/backend-http.test.js` covers credentialed CORS and exercises a fake OIDC login through a real server session into a successful Automerge sync request.

There is no migration in these phases because the live persistence format has not changed. When the selected frontend is wired to this document format, that PR must include a one-off migration under `migrations/`; runtime legacy compatibility should not be added to the application.
