# Calendar

A personal calendar and task planner built around the distinction between an open task and a task that is actionable right now.

## Current implementation

The selected frontend is SolidJS + TypeScript + Vite. `agent/solid-refactor` is the primary application development stream and its tested `root` candidates are published at `/calendar/`.

The app supports:

- task and event creation/editing;
- task states: open, completed, canceled;
- available-from, due, and latest-start times;
- recurring action windows for persistent tasks, such as office hours;
- sleep as a separate user-imposed suppression layer, either until a chosen time or indefinitely;
- one-click sleep until the next calendar day plus a dedicated custom sleep dialog;
- conversion between a finite sleep date and an available-from wait date;
- task sections for Can do now, a combined Upcoming/Waiting view, All open, and Completed;
- sleeping tasks folded into the bottom of the combined Upcoming/Waiting section;
- optional upcoming horizons: rolling 1/7/30 days or calendar-boundary Today/This week/This month;
- keyboard task navigation and configurable task shortcuts;
- month calendar projection with sleep-aware task starts;
- calendar search that dims nonmatching items;
- tags and file attachments on tasks and events, with file-picker and drag/drop attachment input;
- compact task cards with a notes preview;
- queued, click-to-dismiss toast notifications;
- JSON backup/export and import, including attachment contents;
- local session undo/redo;
- optional authenticated remote Automerge and attachment synchronization;
- a dark responsive interface.

Waiting is derived from real availability constraints. Sleep does not change a task's underlying actionability. It controls whether the task is surfaced and, in the calendar, whether sleep is treated as an additional delay when projecting a work opportunity.

## Local data and Automerge

The Solid development stream uses one Automerge document as the canonical local calendar/task state. The document is stored in the `calendar-automerge` IndexedDB database and is also the unit exchanged by the remote sync core.

Calendar item updates are represented as fine-grained Automerge changes where practical. Title and notes use Automerge collaborative text operations; tags, attachment metadata, task fields, and tombstones have separate operations. Deletion is represented by an application-level `deletedAt` tombstone so an offline edit cannot accidentally resurrect a deleted item.

Attachment bytes are deliberately not placed in the Automerge document. Attachment metadata participates in the CRDT. Browser-local `Blob` contents are stored separately in the local IndexedDB `attachments` object store so attachments remain available offline. When remote sync is configured, referenced local blobs are uploaded separately and blobs referenced by merged remote metadata are downloaded into that local store. A production backend should satisfy the blob-store contract with object/blob storage rather than putting large attachment bytes into the Automerge document or ordinary relational/document records.

`readSyncSnapshot()` and `mergeSyncSnapshot()` in `site/storage.js` expose the serialized Automerge boundary used by `sync/client.js`. The Solid frontend only enables its remote controls when `VITE_CALENDAR_BACKEND_URL` is configured. Local-only operation remains the default.

Undo/redo history remains in the separate `calendar-history` IndexedDB database and is session-scoped. It is never part of the Automerge document and must never be synchronized between devices. Undo/redo is applied as new local CRDT changes rather than restoring the entire remote-sync document wholesale, so unrelated merged list/history changes are retained.

## Remote authentication and sync

The repository contains a host-neutral backend and browser client for remote synchronization:

- `auth/oidc.js` implements provider-agnostic OpenID Connect using authorization code, PKCE, state, and nonce validation through `openid-client`;
- `auth/http.js` implements login, callback, session inspection, logout, exact `(issuer, subject)` authorization, and opaque server-side sessions;
- `sync/http.js` implements authenticated `POST /sync` with an atomic document-store contract;
- `sync/attachments-http.js` implements authenticated `HEAD`, `GET`, and `PUT` for attachment blobs with an injected blob-store contract;
- `sync/client.js` exchanges serialized Solid storage snapshots and merges the response into current local state after the request completes;
- `solid/src/remote-sync.ts` adds browser session handling, queued sync requests, and attachment upload/download;
- `backend/http.js` composes the HTTP routes and enforces the configured browser-origin allowlist;
- `backend/app.js` composes OIDC, sessions, Automerge sync, and optional attachment storage without choosing a hosting provider.

The backend URL may include a path prefix. Auth callback URLs, `/sync`, attachment routes, and the Solid client all preserve that prefix.

`POST /sync` has no application-defined byte limit. It exchanges the current serialized Automerge document as one request/response body. A concrete hosting/runtime layer may still impose its own technical request-size or memory limits and should document them if it does.

Google is the first intended OIDC provider, but provider-specific configuration and secrets are not committed to the app. `backend/config.js` also accepts arbitrary OIDC provider and exact-identity arrays. Memory-backed auth, document, and blob stores exist only for tests and local development.

Production enablement still requires durable session storage, atomic durable Automerge document storage, durable attachment blob/object storage, OIDC credentials and callback configuration, a Bun-capable or otherwise Fetch-compatible backend runtime, and `VITE_CALENDAR_BACKEND_URL` in the Solid build. The host-neutral core does not choose a production storage provider.

## Data migrations

Application code assumes the current storage/schema format. It does not contain runtime compatibility or automatic migration paths for older data.

The switch from the old `calendar-app/items` store to the Automerge-backed store therefore has a one-off migration:

```text
migrations/2026-09-automerge-storage.js
```

Run it explicitly in DevTools on the calendar origin before using an Automerge-backed deployed candidate with existing data. Back up first. The migration:

- reads the existing `calendar-app/items` records;
- writes one versioned Automerge document to `calendar-automerge`;
- moves attachment blobs into the separate local attachment store while keeping only metadata in the CRDT;
- leaves the old `calendar-app` database untouched for `/calendar/old/` rollback/reference use;
- starts a new local undo-history session rather than migrating undo state;
- refuses to overwrite a non-empty Automerge database unless the script is deliberately edited to force replacement.

After migration, changes made in `/calendar/old/` and the new Solid app are independent because they use different local data stores.

## Local development

Install dependencies and run the Solid dev server:

```bash
npm install
npm run dev:solid
```

For local browser testing of auth and remote sync, run the provider-neutral Bun development backend in a second process. Its auth sessions, Automerge document, and attachment blobs are memory-only and disappear when the process exits.

Google convenience configuration:

```bash
CALENDAR_APP_URL=http://localhost:5173/calendar/ \
CALENDAR_PUBLIC_BASE_URL=http://localhost:8787/ \
GOOGLE_CLIENT_ID=your-client-id \
GOOGLE_CLIENT_SECRET=your-client-secret \
ALLOWED_GOOGLE_SUBJECT=your-google-subject \
npm run dev:backend
```

`npm run dev:backend` invokes Bun, so Bun must be installed on the machine running the backend.

Then start the Solid frontend with the matching backend URL:

```bash
VITE_CALENDAR_BACKEND_URL=http://localhost:8787/ npm run dev:solid
```

For that example, the OIDC redirect URI is `http://localhost:8787/auth/callback/google`. Authorization uses the exact OIDC issuer and subject. Email addresses are display claims only and are not authorization identifiers.

A prefixed backend also works. For example, if `CALENDAR_PUBLIC_BASE_URL` and `VITE_CALENDAR_BACKEND_URL` are both `http://localhost:8787/calendar-api/`, the callback becomes `http://localhost:8787/calendar-api/auth/callback/google` and the sync endpoint becomes `http://localhost:8787/calendar-api/sync`.

Instead of the Google convenience variables, arbitrary providers and identities can be supplied as JSON arrays through `CALENDAR_OIDC_PROVIDERS_JSON` and `CALENDAR_ALLOWED_IDENTITIES_JSON`. Provider objects require `id`, `issuer`, and `clientId`; identity objects require `issuer` and `subject`.

Validation commands used for a Solid root candidate are:

```bash
npm test
npm run test:solid
npm run typecheck:solid
npm run build:solid
```

The production Vite base is `/calendar/` and the build output is `site/solid/`.

## Deployment

Deployment infrastructure lives on the separate default branch `deployment-control`; that branch is control-plane only and is not application source.

Current public deploy units are:

- `root`: Solid, published at `/calendar/`;
- `old`: the pre-refactor application, published at `/calendar/old/`;
- `vanilla`: the vanilla refactor retained for reference at `/calendar/vanilla/`.

The old `/calendar/solid/` deployment is retired.

Pushing development commits does not test, build, or deploy them. **Test and Build Candidate** can be run at any point for an exact development SHA to execute the canonical checks and produce a deployable artifact without publishing it. To publish that tested SHA, run **Promote Deployment** for the same unit and SHA. Promotion records the tested artifact in `deployment.json`, which triggers deployment.

See the `deployment-control` branch README for the authoritative deployment protocol.
