# Native Automerge sync assessment

Implemented for the calendar using ordered HTTP exchanges; see [current protocol](incremental-sync.md). The measurements below describe the earlier evaluation.

The app uses Automerge's public APIs; it does not fork or patch Automerge. Full-document save/load/merge is a valid but bandwidth-heavy transport. Switching transport does not change CRDT conflict rules or remove the need for task semantics, attachment operations, undo intent, schema validation, and stale editor handling.

## Measured protocol payloads

With the installed Automerge 3.4.1 and 200 synthetic tasks, an in-memory two-peer exchange measured:

| Scenario | Native protocol bytes | Current snapshot exchange bytes |
| --- | ---: | ---: |
| Initial download | 9,724 | Not compared |
| No changes, existing peer state | 0 | 19,044 |
| One task title edit | 377 | 19,360 |
| Reconnect with matching documents and reset peer state | 123 | Not compared |

These are synthetic protocol payloads, excluding HTTP/WebSocket overhead, authentication, persistence, and CPU. Zero generated messages does not discover remote changes by itself: the client still needs polling or a server-push connection. A fresh device must still receive missing history. Native sync does not compact stored history, and saving the complete document after every received message would retain the existing disk-write cost.

## Recommended next step

Prototype native `initSyncState`, `generateSyncMessage`, and `receiveSyncMessage` with the existing single calendar and authenticated Durable Object. Use ordered exchanges and connection-scoped peer state. Verify disconnect/reconnect, lost responses, duplicate requests, simultaneous local edits, expired sessions, and Worker restart behavior. Reuse the existing canonical-root validation before persisting incoming changes. Authentication must gate access before processing a peer's message.

For immediate cross-device updates, evaluate WebSockets rather than assuming incremental messages alone replace polling. Measure actual Worker storage/CPU/request usage before changing the deployment model. Keep this a transport experiment: a protocol change does not require a document migration.

Adopting Automerge Repo is a separate, larger choice. It can replace more custom document lifecycle, network synchronization, and storage scheduling. Evaluate it against the custom Solid stale-editor/undo boundary and the Durable Object storage/network environment; a browser adapter alone is not an end-to-end backend solution. The low-level native protocol may initially add more session handling than the current stateless POST, while Repo offers more potential plumbing reduction.

References: [Automerge sync protocol](https://automerge.org/automerge/automerge/sync/index.html), [Automerge Repo](https://automerge.org/docs/reference/repositories/).
