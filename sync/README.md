# Automerge sync core

This directory contains the transport- and hosting-agnostic CRDT layer for future calendar sync.

The live browser application does not use it yet. That is deliberate: frontend refactors are happening in parallel, so this phase proves the data/merge semantics without changing the current `site/storage.js` contract or deployment.

The canonical synchronized document is one Automerge document with schema version `1` and an `items` map keyed by item ID. Item deletions are application-level tombstones (`deletedAt`) rather than immediate CRDT object deletion. Concurrent edits therefore cannot accidentally resurrect a deleted item, while an explicit restore can remove the tombstone later.

`title` and `notes` are updated through Automerge collaborative-text operations. Other fields are updated independently so edits to different properties can merge without replacing the whole item. Tags and attachment metadata have dedicated fine-grained operations. Attachment bytes are intentionally excluded from the document; blobs will be synchronized through a separate content-addressed attachment service and cached locally.

`mergeSnapshotBytes(storedBytes, incomingBytes)` models the future `/sync` endpoint. It is a pure request/response merge primitive: load the stored document, merge the incoming document, save the result, and return the same merged bytes to the client. The eventual persistence layer must make the read/merge/write operation atomic or serialized, but it does not need Automerge Repo, WebSockets, or an Automerge-specific server process.

The separate `calendar-history` IndexedDB database remains local-only and is not represented in this document.

## Tests

`tests/automerge.test.js` simulates disconnected laptop/phone/tablet replicas in one Node process. It covers independent edits, collaborative text, tag additions, same-field conflicts, tombstone/edit races, explicit restore, serialization, in-flight edits, idempotent replay, and multi-replica convergence. No remote service is needed to exercise these semantics.

There is no migration in this phase because the live persistence format has not changed. When the selected frontend is wired to this document format, that PR must include a one-off migration under `migrations/`; runtime legacy compatibility should not be added to the application.
