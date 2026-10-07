# Calendar Worker

A Cloudflare Worker at `https://calendar.guymichaely.com` that serves the calendar app and its sync server. The app's built files (`../dist`) are static assets; the Worker's code runs only for `/sync`. The app works without sync: signed out, or with the server unreachable, the calendar stays in the browser and syncs later.

The app and `/sync` share one origin, so there's no CORS. The app has its own subdomain, so its storage is separate from the other sites on guymichaely.com. Cloudflare issues and renews the certificate.

## How syncing works

One Durable Object (`CalendarStore`) holds the calendar as an Automerge document in its SQLite storage and handles one request at a time, so a read, merge, and write can't interleave. Attachment bytes are in the private R2 bucket `calendar-sync-attachments`. (The Worker is still named `calendar-sync`, so the stored calendar carried over when it moved here.)

- `POST /sync` is one round of Automerge's sync protocol ([docs/incremental-sync.md](../docs/incremental-sync.md)); devices merge, so there are no conflicts to settle.
- `GET /sync/live` is a WebSocket. It's sent `{ heads }` on connecting and whenever the calendar changes; a device whose heads differ syncs. Hibernation keeps idle connections open without running anything, and pings are answered without waking the object.
- `HEAD`, `GET`, `PUT /sync/attachments/:id` store an attachment's bytes once, before its entry is saved in the calendar.
- `PUT`, `DELETE /sync/devices` with `{ token }` add or remove a phone's FCM token, and `GET /sync/reminders?taskStarts=1&eventMinutes=30` gives that phone's coming reminders, worked out here with the app's own code (`solid/src/reminders.ts`, read in the calendar's time zone). Thirty seconds after the calendar changes (so a burst of edits sends one), the Durable Object's alarm sends each registered phone a data message through FCM (`fcm.js`, signed in with the Firebase service account in the `FCM_SERVICE_ACCOUNT` secret); the phone then fetches its reminders and reschedules them ([android/README.md](../android/README.md)). Tokens FCM no longer knows are dropped.

Each device chooses when it syncs (Settings → Data): **Automatically**, **When I edit**, or **Manually** ([@guymichaely/app-sync](https://github.com/GuyMichaely/app-sync) decides when, in `solid/src/cloud-sync.ts`).

## Signing in

Cloudflare Access guards `calendar.guymichaely.com/sync`: the Access application "Calendar sync", with the same login method and allow policy as Italian's (your account only). A request without that sign-in never reaches the Worker, so the Worker doesn't check who's asking. `workers.dev` and preview addresses are off, so there's no way around Access; keep it that way, and keep the policy to your account.

- Settings → Data → **Sign in with Cloudflare** opens `/sync/signin`. The app turns sync on first; Access signs you in and sets its cookie, and the Worker's page there sends the browser back to the app, which syncs as on any opening (by script, not a redirect: the Android app follows redirects natively, which would leave it at `/sync/signin`). If you back out of signing in, the sync is turned away and Settings offers Sign in again.
- From `guymichaely.com/calendar/` (the app full-page in a frame, from the homepage repo, with the address bar its own), signing in sends the whole tab, since sign-in pages refuse frames: the frame's page goes to `/sync/signin?return=` its address, and the Worker's page goes back there. It only goes back to addresses in `frames` in `backend/worker.js`.
- When a sign-in expires, requests are turned away and the app shows **Sign in again**. To sign every device out at once, revoke the sessions in Zero Trust.

## Deploying

Cloudflare Workers Builds deploys on every push to `prototype2`, through Cloudflare's GitHub app (GitHub holds no Cloudflare token):

- Build command: `./scripts/bun install --frozen-lockfile && ./scripts/bun run check`
- Deploy command: `npx wrangler deploy --config backend/wrangler.jsonc`

By hand, `./scripts/worker deploy` does the same after `./scripts/bun run build:solid` (the wrapper keeps Wrangler's login under the checkout's `.local`).

## Developing

`./scripts/bun run dev:worker` runs the Worker locally on port 8787, serving `../dist` (build it first) and `/sync` with no Access in front, so Sign in goes straight through. The Vite dev server forwards `/sync` there. `scripts/smoke-worker.js` runs the built Worker and checks the app's files, sign-in's return, two devices merging, the live connection, and attachments.
