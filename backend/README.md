# Calendar Worker

A Cloudflare Worker at `https://guymichaely.com/calendar/` that serves the calendar app and its sync server. The app's built files (`../dist/calendar`) are static assets, and `/calendar/sync` is the sync server. `calendar.guymichaely.com` redirects to the same path under `guymichaely.com/calendar` (the Worker does this before anything else, so nothing on the subdomain is served). The app works without sync: signed out, or with the server unreachable, the calendar stays in the browser and syncs later.

The app and its sync share one origin, so there's no CORS. The rest of guymichaely.com is GitHub Pages; its DNS records are proxied through Cloudflare so the Worker route `guymichaely.com/calendar*` can take this path (SSL mode Full: GitHub serves its own certificate behind the proxy). The app shares the origin, and so browser storage, with the other pages on guymichaely.com.

## How syncing works

One Durable Object (`CalendarStore`) holds the calendar as an Automerge document in its SQLite storage and handles one request at a time, so a read, merge, and write can't interleave. Attachment bytes are in the private R2 bucket `calendar-sync-attachments`. (The Worker is still named `calendar-sync`, so the stored calendar carried over when it moved here.)

- `POST /calendar/sync` is one round of Automerge's sync protocol ([docs/incremental-sync.md](../docs/incremental-sync.md)); devices merge, so there are no conflicts to settle.
- `GET /calendar/sync/live` is a WebSocket. It's sent `{ heads }` on connecting and whenever the calendar changes; a device whose heads differ syncs. Hibernation keeps idle connections open without running anything, and pings are answered without waking the object.
- `HEAD`, `GET`, `PUT /calendar/sync/attachments/:id` store an attachment's bytes once, before its entry is saved in the calendar.

Each device chooses when it syncs (Settings → Data): **Automatically**, **When I edit**, or **Manually** ([@guymichaely/app-sync](https://github.com/GuyMichaely/app-sync) decides when, in `solid/src/cloud-sync.ts`).

## Signing in

Cloudflare Access guards `guymichaely.com/calendar/sync` (and `calendar.guymichaely.com/sync`, though the Worker only redirects there): the Access application "Calendar sync", with the same login method and allow policy as Italian's (your account only). A request without that sign-in never reaches the Worker, so the Worker doesn't check who's asking. `workers.dev` and preview addresses are off, so there's no way around Access; keep it that way, and keep the policy to your account.

- Settings → Data → **Sign in with Cloudflare** opens `/calendar/sync/signin`. Access signs you in and sets its cookie; the Worker sends the browser back to the app with `#sync-signed-in`.
- When a sign-in expires, requests are turned away and the app shows **Sign in again**. To sign every device out at once, revoke the sessions in Zero Trust.

## Deploying

Cloudflare Workers Builds deploys on every push to `prototype2`, through Cloudflare's GitHub app (GitHub holds no Cloudflare token):

- Build command: `./scripts/bun install --frozen-lockfile && ./scripts/bun run check`
- Deploy command: `npx wrangler deploy --config backend/wrangler.jsonc`

By hand, `./scripts/worker deploy` does the same after `./scripts/bun run build:solid` (the wrapper keeps Wrangler's login under the checkout's `.local`).

## Developing

`./scripts/bun run dev:worker` runs the Worker locally on port 8787, serving `../dist` (build it first) at `http://localhost:8787/calendar/` and `/calendar/sync` with no Access in front, so Sign in goes straight through. The Vite dev server forwards `/calendar/sync` there. `scripts/smoke-worker.js` runs the built Worker and checks the app's files, sign-in's return, two devices merging, the live connection, and attachments.
