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

- `auth/oidc.js`: provider-agnostic OpenID Connect using authorization code, PKCE, state, and nonce validation through `openid-client`;
- `auth/http.js`: login, callback, session inspection, logout, exact `(issuer, subject)` authorization, and opaque server-side sessions;
- `sync/http.js`: authenticated `POST /sync` with an atomic document-store contract;
- `sync/attachments-http.js`: authenticated attachment routes;
- `sync/client.js`: serialized Automerge snapshot exchange and merge;
- `solid/src/remote-sync.ts`: browser session handling, queued sync, and attachment transfer;
- `backend/app.js`: composition of auth, sync, attachment storage, and the browser-origin allowlist;
- `backend/file-stores.js`: persistent single-process filesystem stores;
- `backend/node-http.js`: Node HTTP to Fetch `Request`/`Response` adapter;
- `backend/node-server.js`: persistent Node production entrypoint.

Google is the first configured OIDC provider, but the auth core is provider-agnostic. Authorization is based on exact issuer and subject, not email address.

The filesystem document store serializes writes only within one backend process. The production App Service app must remain at one instance until the filesystem stores are replaced with a multi-process storage implementation.

The Solid frontend has a **Remote sync server** field in the hamburger menu. A browser-saved URL takes precedence over the optional `VITE_CALENDAR_BACKEND_URL` build-time default. Saving an empty value explicitly disables remote sync in that browser.

## Backend deployment

Production backend hosting uses Azure App Service for Linux with the managed Node.js 24 LTS runtime.

Current resources:

```text
App Service plan:  parola-plan       (existing B1 Linux plan)
Resource group:    calendar-sync
Web App:           guymichaely-calendar-sync
Backend URL:       https://guymichaely-calendar-sync.azurewebsites.net/
Persistent data:   /home/calendar-data
```

The backend uses App Service's persistent `/home` filesystem for auth sessions, the Automerge document, and attachment blobs. `npm start` launches `backend/node-server.js`, and the application listens on the `PORT` supplied by App Service.

Configure the existing Web App from Azure Cloud Shell:

```bash
curl -fsSLo ~/configure-calendar-app-service.sh \
  https://raw.githubusercontent.com/GuyMichaely/calendar/main/scripts/configure-azure-app-service.sh
bash ~/configure-calendar-app-service.sh
```

Then connect the Web App to `GuyMichaely/calendar`, branch `main`, in Azure Deployment Center. Azure's GitHub Actions integration handles subsequent backend deployments.

Required secret App Service environment variables are:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
ALLOWED_GOOGLE_SUBJECT
```

The Google OAuth callback URI is:

```text
https://guymichaely-calendar-sync.azurewebsites.net/auth/callback/google
```

Verify the deployed backend with:

```bash
curl https://guymichaely-calendar-sync.azurewebsites.net/healthz
```

See `backend/README.md` for the complete backend configuration.

## Data migrations

Application runtime code assumes the current data model rather than maintaining general compatibility with old schemas.

The original `calendar-app/items` task and event data has a one-off migration implemented by `migrations/2026-09-automerge-storage.js` and exposed through the deployed migration page:

```text
https://guymichaely.com/calendar/migrate-automerge.html
```

Run that page in the browser profile containing the old calendar data before relying on remote sync. The migration converts the old waiting/ignored task fields to the current sleep/availability model, writes the current Automerge document, and leaves the old database intact as a rollback copy. It refuses to overwrite a non-empty current Automerge document. It also stops if it encounters embedded legacy attachment bytes rather than silently discarding them.

The separate `2026-09-sleep-schema.js` migration is only for old non-Automerge builds that must remain on the old IndexedDB format.

## Local development

Install dependencies and run the Solid frontend:

```bash
npm install
npm run dev:solid
```

For local auth and remote-sync testing, run the Node development backend in another process. Its auth sessions, Automerge document, and attachment blobs are memory-only and reset when the process exits.

```bash
CALENDAR_APP_URL=http://localhost:5173/calendar/ \
CALENDAR_PUBLIC_BASE_URL=http://localhost:8787/ \
GOOGLE_CLIENT_ID=your-client-id \
GOOGLE_CLIENT_SECRET=your-client-secret \
ALLOWED_GOOGLE_SUBJECT=your-google-subject \
PORT=8787 \
npm run dev:backend
```

Then save `http://localhost:8787/` in the frontend's Remote sync server setting or provide the same URL through `VITE_CALENDAR_BACKEND_URL`.

The canonical application checks are:

```bash
npm test
npm run test:solid
npm run typecheck:solid
npm run build:solid
```

## Frontend deployment

Frontend deployment infrastructure lives on the separate `deployment-control` branch. That branch is control-plane only and is not application source. Agents that cannot invoke Actions directly submit requests through the `action-trigger` branch.

Current public deployment units are defined by `deployment-control/deployment.json`. Normal deployment changes use the promotion workflow documented on that branch rather than branch-owned deployment behavior in `main`.
