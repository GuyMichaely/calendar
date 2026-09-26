# Calendar

A personal calendar and task planner built around the distinction between an open task and a task that is actionable right now.

## Current implementation

`main` is the canonical application development branch. The selected frontend is SolidJS + TypeScript + Vite.

The app supports task and event editing, recurring action windows, sleep, availability and due constraints, search, tags, attachments, compact task views, calendar projection, JSON backup/import, local undo/redo, and optional authenticated remote synchronization.

Waiting is derived from real availability constraints. Sleep is a separate user-imposed suppression layer. It controls whether a task is surfaced and whether sleep delays its projected calendar opportunity.

## Local data and Automerge

The application stores one Automerge document in the `calendar-automerge` IndexedDB database. That document is the canonical local calendar/task state and the unit exchanged by remote sync.

Calendar item updates are represented as fine-grained Automerge changes where practical. Title and notes use collaborative text operations. Tags, attachment metadata, task fields, and tombstones have separate operations. Deletion uses an application-level `deletedAt` tombstone so an offline edit cannot accidentally resurrect a deleted item.

Attachment bytes are not stored in the Automerge document. Attachment metadata participates in the CRDT. New attachment bytes are uploaded to the configured backend before their metadata is persisted locally, and remote attachment bytes are fetched on demand when opened.

JSON backup/export is metadata-only for attachments. A backup containing embedded legacy attachment bytes is rejected rather than silently discarding those bytes.

Undo/redo history is stored separately in `calendar-history` IndexedDB and is session-scoped. It is never synchronized. Undo and redo are applied as new CRDT changes rather than replacing the synchronized document wholesale.

## Remote authentication and sync

The remote-sync implementation is split into runtime-neutral application pieces:

- `backend/auth/oidc.js`: provider-agnostic OpenID Connect using authorization code, PKCE, state, and nonce validation through `openid-client`;
- `backend/auth/http.js`: login, callback, session inspection, logout, exact `(issuer, subject)` authorization, and opaque server-side sessions;
- `backend/sync/http.js`: authenticated `POST /sync` with an atomic document-store contract;
- `backend/sync/attachments-http.js`: authenticated attachment routes;
- `sync/client.js`: serialized Automerge snapshot exchange and merge;
- `solid/src/remote-sync.ts`: browser session handling, queued sync, and attachment transfer;
- `backend/app.js`: composition of auth, sync, attachment storage, and the browser-origin allowlist;
- `backend/file-stores.js`: persistent single-process filesystem stores;
- `backend/bun-http.js`: Bun HTTP listener with the configured public origin for tunneled OAuth callbacks;
- `backend/bun-server.js`: persistent Bun production entrypoint.

Google is the first configured OIDC provider, but the auth core is provider-agnostic. Authorization is based on exact issuer and subject, not email address.

The filesystem document store serializes writes only within one backend process. The production backend must remain at one instance until the filesystem stores are replaced with a multi-process storage implementation.

The Solid frontend has a **Remote sync server** field in the hamburger menu. A browser-saved URL takes precedence over the optional `VITE_CALENDAR_BACKEND_URL` build-time default. Saving an empty value explicitly disables remote sync in that browser.

## Backend deployment

The backend runs as one Bun container with durable storage and a Cloudflare Tunnel at `https://calendar-sync.guymichaely.com/`. The frontend remains on GitHub Pages at <https://guymichaely.com/calendar/>; each browser chooses its **Remote sync server** URL. No backend secrets or temporary tunnel URL are baked into frontend builds.

Follow [backend/README.md](backend/README.md) for container startup, Cloudflare routing, Google registration, and backups. Google credentials are the only application configuration needed before real sign-in and sync can be enabled. Docker Engine with Compose 2.30+ is required on the backend host.


## Local development

Use the repository wrapper on Linux or macOS. It downloads the exact Bun version from `.bun-version`, verifies its checked-in SHA-256 checksum, and installs it under `.local/bin`. Dependencies, caches, and temporary files stay in this checkout. It does not install Node, npm, Vite, TypeScript, or Bun globally or edit shell profiles.

```bash
./scripts/bun install --frozen-lockfile
./scripts/bun run dev:solid
```

Open <http://localhost:5173/calendar/>. The selected frontend is Solid + TypeScript + Vite. Vite emits `dist/` with the `/calendar/` asset base. Runtime dependencies are bundled into the frontend; it does not fetch libraries from a CDN.

Run all checks:

```bash
./scripts/bun run check
```

This runs the backend/domain/storage tests, Solid tests, typechecking, and the production build. To deliberately update dependencies, edit `package.json`, run `./scripts/bun install`, and commit `bun.lock`. A Bun upgrade must update `.bun-version`, `package.json`, and the official release hashes in `scripts/bun-checksums.txt` together. The container and CI read the same `.bun-version`.

The wrapper disables automatic dotenv loading. Backend configuration lives in ignored `.local/backend.env` and is passed only to the container. Avoid exporting backend credentials into frontend build shells. Bun runs package binaries with its own runtime, so an unrelated system Node installation is not used.

`./scripts/bun run dev:backend` is an optional in-memory backend for development with explicitly supplied environment variables. It loses its data when stopped. Use the container for durable storage.

## Frontend deployment

`main` is the default branch and the only production deployment stream. `.github/workflows/deploy-pages.yml` verifies each push to `main`, builds and smoke-tests the backend image, then publishes `dist/` to GitHub Pages. Pull requests against `main` run the same checks without publishing. A manual run can republish `main`.

Branches named `prototype*` (lowercase letters, digits, hyphens) are published beside production at `https://guymichaely.com/calendar/<branch>/`, with the branch name shown in the header. A push to one runs the same checks in its own concurrency group, then starts a manual run of `main`; that run publishes production together with every existing prototype branch. The Pages environment therefore still deploys only from `main`. Deleting a prototype branch removes it at the next production publish. Prototypes share the origin, so they use the same browser data and sync session as production. Only put interface changes on them; a prototype that changes the document model must use a separate backend. Signing in from a prototype returns to the production app, because the backend accepts only listed return URLs; sync itself works from any path on the origin.

The production concurrency group includes the entire workflow; an active deployment is never interrupted. At most one newer run waits, so superseded pending revisions are skipped. The existing domain setup is inherited from the account's Pages site; no `CNAME` or DNS changes are required in this repository.

The old manifest, per-unit candidates, promotion workflows, and action-trigger requests are retired. The former control branches are preserved as archive tags when the migration is applied. Historical app snapshots remain in Git, rather than separate published `/old/` and `/vanilla/` sites. Revert a commit on `main` to roll back through the same tested deployment stream.

Backend updates are explicit on the backend host:

```bash
./scripts/container --profile cloudflare up -d --build --wait
```

The data volume survives container recreation. Keep exactly one backend process; the filesystem store does not coordinate multiple writers. Azure deployment scripts and the Node-specific adapter were removed after restoring Bun; existing Azure resources are not modified by this repository.

## Saving, syncing, and backups

Valid item edits autosave locally after 800 ms of inactivity. Closing the editor flushes pending edits; incomplete fields or storage/upload errors remain visible instead of silently dropping changes. The open editor retains its Automerge editing branch so subsequent autosaves preserve concurrent remote changes. Remote changes appear in the task/calendar views after sync; reopen an editor to see changes made elsewhere.

Authenticated devices sync after local changes, on reconnect/resume, and every 15 seconds while visible. The status distinguishes local saves, sync activity, and errors. This is periodic cross-device convergence, not character-by-character multiplayer presence.

The menu's Data submenu contains backups and remote sync configuration. Import previews new/matching item counts, updates matching IDs, retains items absent from the file, and supports undo. A JSON backup contains item values and attachment references; it excludes attachment files and CRDT history. Full server backups must include the data volume (or the cloud stores).

Server-only code lives under backend/. The sync/ directory holds the shared Automerge model and browser protocol client. Obsolete one-time migrations have been removed; previous versions remain in Git.

# User added to do list; ignore if you are an agent
- have a view for the calendar and on the to do list to filter out what doesn't have a due date today/this week/this month
- have some concept (i need to specify a way to input this as a user) to show task duration. e.g. if i want to show that an event is taking place over a period of a few days i'll want it to span those days on the calendar probably. not sure if i want ongoing tasks with no due date to participate in this
- copy microsoft's "plan" feature where tasks can belond to a plan and the plan can have buckets composed of tasks. want to also make sure that the user can just add tasks without an associated plan.  basically a glorified lists functionality, maybe just stick to simple lists
- make it so using the arrow keys to navigate through item focus loops around when pressing up on top item or down on bottom item
- what's the "saved on this device" status for? 
- decide what to do about displaying sleeping/waiting tasks as descendents of open tasks
- decouple model and view
1. sleeping and waiting dates don't display year. don't display year if it's the current year, otherwise display year
2. 