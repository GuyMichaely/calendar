# Incremental calendar sync

The calendar now uses Automerge's native `generateSyncMessage` / `receiveSyncMessage` protocol over ordered HTTP exchanges. `POST /sync` accepts `application/vnd.automerge.sync`, with a random `X-Automerge-Session` and increasing `X-Automerge-Sequence`. Full snapshots remain a local persistence format; they are no longer the wire protocol. No document migration is required.

The browser keeps one native peer state per remote client. The backend keeps authenticated identity-scoped peer states in memory, expiring after five idle minutes and bounded to 100 sessions. A Worker restart, expired state, or out-of-order request returns 410; the client restarts the native handshake. Network failures discard peer state for the next attempt. Calendar changes already committed to storage survive those resets.

One sync operation exchanges messages until the client has nothing further to send. When locally unchanged, its first request is an empty poll so the server can generate messages for other-device edits. Existing autosave triggers and configurable polling continue to work. This is incremental HTTP synchronization, not WebSocket push. A quiet poll has no Automerge payload, though HTTP overhead remains.

Incoming messages are decoded before storage access; document changes are validated before persistence. Protocol state advances only after the document transaction succeeds. Current browser storage is read again when a response arrives, preserving local edits made in flight. No old snapshot endpoint is retained; refresh existing tabs after deployment.

## Potential reuse

The transport/session machinery is reusable in principle: it needs an authenticated peer identity, atomic document storage, and an application-provided document initializer/validator. The calendar's schema, task mutations, editor rebasing, undo policy, and attachment lifecycle remain application-specific.

For a flashcard application, Automerge alone supplies the CRDT and native sync algorithm, not hosting, authentication, persistence, or reconnection behavior. Another agent can use this implementation as a reference. Extract a library only after comparing both apps' actual needs; no shared package or changes to another project are part of this work.
