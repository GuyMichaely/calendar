# Calendar

A personal calendar and task planner built around the distinction between an open task and a task that is actionable right now.

## Current implementation

`main` is the canonical application development branch. The selected frontend is SolidJS + TypeScript + Vite.

The app supports:

- task and event creation/editing;
- task states: open, completed, canceled;
- available-from, due, and latest-start times;
- recurring action windows for persistent tasks;
- sleep as a separate user-imposed suppression layer, either until a chosen time or indefinitely;
- conversion between a finite sleep date and an available-from wait date;
- task sections for Can do now, Upcoming/Waiting, All open, and Completed;
- rolling 1/7/30-day or calendar-boundary upcoming horizons;
- keyboard task navigation and configurable task shortcuts;
- month calendar projection with sleep-aware task starts;
- search, tags, and file attachments on tasks and events;
- compact task cards, queued toasts, JSON backup/import, and local undo/redo;
- optional authenticated remote Automerge and attachment synchronization;
- a dark responsive interface.

Waiting is derived from real availability constraints. Sleep does not change a task's underlying actionability. It controls whether the task is surfaced and, in the calendar, whether sleep is treated as an additional delay when projecting a work opportunity.

## Local data and Automerge

The application stores one Automerge document in the `calendar-automerge` IndexedDB database. That document is the canonical local calendar/task state and the unit exchanged by remote sync.

Calendar item updates are represented as fine-grained Automerge changes where practical. Title and notes use collaborative text operations; tags, attachment metadata, task fields, and tombstones have separate operations. Deletion uses an application-level `deletedAt` tombstone so an offline edit cannot accidentally resurrect a deleted item.

Attachment bytes are not stored in the Automerge document and normal application writes do not persist attachment blobs in IndexedDB. Attachment metadata participates in the CRDT. New attachment bytes are uploaded to the configured backend before their metadata is persisted locally, and remote attachment bytes are fetched on demand when opened.

JSON backup/export is metadata-only for attachments. A backup containing embedded legacy attachment bytes is rejected rather than silently discarding those bytes.

`readSyncSnapshot()` and `mergeSyncSnapshot()` in `site/storage.js` expose the serialized Automerge boundary used by `sync/client.js`. The Solid frontend enables remote controls only when `VITE_CALENDAR_BACKEND_URL` is configured. Local-only operation remains available.

Undo/redo history is stored separately in the `calendar-history` IndexedDB database and is session-scoped. It is never synchronized. Undo/redo is applied as new CRDT changes rather than replacing the synchronized document wholesale, so unrelated concurrent changes are preserved.

## Remote authentication and sync

The repository contains a host-neutral backend and browser client for remote synchronization:

- `auth/oidc.js` implements provider-agnostic OpenID Connect using authorization code, PKCE, state, and nonce validation through `openid-client`;
- `auth/http.js` implements login, callback, session inspection, logout, exact `(issuer, subject)` authorization, and opaque server-side sessions;
- `sync/http.js` implements authenticated `POST /sync` with an atomic document-store contract;
- `sync/attachments-http.js` implements authenticated `HEAD`, `GET`, and `PUT` attachment routes with an injected blob-store contract;
- `sync/client.js` exchanges serialized Automerge snapshots and merges responses into current local state;
- `solid/src/remote-sync.ts` adds browser session handling, queued sync requests, and attachment upload/download;
- `backend/http.js` composes the routes and enforces the configured browser-origin allowlist;
- `backend/app.js` composes OIDC, sessions, Automerge sync, and optional attachment storage without coupling the core to one storage provider;
- `backend/file-stores.js` provides persistent single-process filesystem stores for auth state, Automerge documents, and attachment blobs;
- `backend/bun-server.js` is the persistent Bun entrypoint using those filesystem stores.

The backend URL may include a path prefix. Auth callback URLs, `/sync`, attachment routes, and the Solid client all preserve that prefix.

`POST /sync` and attachment upload routes have no application-defined byte ceiling. A concrete runtime, reverse proxy, or storage provider may still impose technical limits.

Google is the first intended OIDC provider, but the auth core remains provider-agnostic. Authorization is based on exact issuer and subject, not email address.

`npm run dev:backend` uses memory-backed stores for local testing. `npm run start:backend` provides a persistent single-process server when `CALENDAR_DATA_DIR` is configured. The filesystem document store serializes updates within that process, so it must not be shared by multiple backend processes. A multi-process deployment would need another implementation of the same store contracts.

Actual remote enablement still requires the public backend URL/ingress, OIDC credentials and callback configuration, an exact allowed identity, persistent disk or another durable store provider, and `VITE_CALENDAR_BACKEND_URL` in the frontend build. See `backend/README.md` for runtime configuration.

## Data migrations

Application runtime code assumes the current data model rather than maintaining general compatibility with old schemas.

The original `calendar-app/items` task and event data has a one-off migration:

```text
migrations/2026-09-automerge-storage.js
```

Run it explicitly in DevTools on the calendar origin before using an Automerge-backed build with existing pre-Automerge data. Back up first. It converts the old waiting/ignored task fields to the current sleep/availability model, strips no attachment bytes silently, writes the current Automerge document, and leaves the old database intact as a rollback copy. The separate `2026-09-sleep-schema.js` migration is only needed for old non-Automerge builds that must remain on the old IndexedDB format; it does not need to run before the Automerge migration.

The Automerge migration intentionally stops if it encounters embedded legacy attachment bytes rather than losing them. The current owner data is known not to contain attachments, so no attachment-data migration is required for the intended production transition.

## Local development

Install dependencies and run the Solid frontend:

```bash
npm install
npm run dev:solid
```

For local auth and remote-sync testing, run the Bun development backend in another process. Its auth sessions, Automerge document, and attachment blobs are memory-only and reset when the process exits.

Google convenience configuration:

```bash
CALENDAR_APP_URL=http://localhost:5173/calendar/ \
CALENDAR_PUBLIC_BASE_URL=http://localhost:8787/ \
GOOGLE_CLIENT_ID=your-client-id \
GOOGLE_CLIENT_SECRET=your-client-secret \
ALLOWED_GOOGLE_SUBJECT=your-google-subject \
npm run dev:backend
```

Then start the Solid frontend with the matching backend URL:

```bash
VITE_CALENDAR_BACKEND_URL=http://localhost:8787/ npm run dev:solid
```

For that example, the OIDC redirect URI is `http://localhost:8787/auth/callback/google`. A prefixed backend also works, such as `http://localhost:8787/calendar-api/`.

Instead of the Google convenience variables, arbitrary providers and identities can be supplied through `CALENDAR_OIDC_PROVIDERS_JSON` and `CALENDAR_ALLOWED_IDENTITIES_JSON`.

The canonical application checks are:

```bash
npm test
npm run test:solid
npm run typecheck:solid
npm run build:solid
```

## Deployment

Deployment infrastructure lives on the separate `deployment-control` branch. That branch is control-plane only and is not application source. Agents that cannot invoke Actions directly submit requests through the `action-trigger` branch.

Current public deployment units are defined by `deployment-control/deployment.json`. At present they are:

- `prod`: Solid, published at `/calendar/`;
- `old`: the pre-refactor application, published at `/calendar/old/`;
- `vanilla`: the vanilla refactor retained at `/calendar/vanilla/`.

A test request accepts any valid unit label and any Git revision that resolves to a commit. The workflow resolves that revision to an exact SHA, runs the canonical checks, and stores deployable output as `deploy-<unit>-<sha>`.

A deploy request promotes a tested unit/SHA artifact. Existing units may omit `path` to retain their current path. Supplying `path` can update an existing unit's path or create a new unit in `deployment.json`. Additional fields in `action-request.json` are ignored, so an agent can change an arbitrary nonce-like field to submit the same semantic request again.

See the `deployment-control` and `action-trigger` branch READMEs for the authoritative deployment protocol.