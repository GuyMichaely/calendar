# Calendar backend setup

Production runs on the Cloudflare Worker at `https://calendar-sync.guymichaely.com`, with calendar data in Durable Object SQLite and attachment files in private R2. The frontend runs on GitHub Pages at <https://guymichaely.com/calendar/>. See [Cloudflare deployment](cloudflare/README.md) for account setup, Worker secrets, deployments, and local Worker verification. Docker and a tunnel connector are not required.

The backend shares provider-neutral OIDC authentication, Automerge sync, and attachment handlers across the production Worker and optional local Bun servers.

## Register Google login

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project for Calendar.
2. Open **Google Auth Platform → Branding** (or OAuth consent-screen setup). Use an app name such as `Personal Calendar`, your support email, and your contact email. If asked for a homepage, use `https://guymichaely.com/calendar/`.
3. Choose **External** audience for a personal Gmail account. While in Testing, add your Google account as a test user. Only basic `openid`, `email`, and `profile` scopes are needed; this app does not request Google Calendar or Drive access.
4. Under **Clients**, create an OAuth client with application type **Web application**. Register these two **Authorized redirect URIs** exactly:
   - `https://calendar-sync.guymichaely.com/auth/callback/google`
   - `http://localhost:8877/auth/callback/google` (one-time local identity discovery)
5. Save the client ID and client secret locally as described below. Authorized JavaScript origins are not needed for this server-side redirect flow. This is an OAuth client, not a service-account key.

Google requires an exact redirect match, including scheme, hostname, port, and path. See [Google's OIDC setup guide](https://developers.google.com/identity/openid-connect/openid-connect).

Create the backend-only configuration file:

```bash
mkdir -p .local
cp -n backend/.env.example .local/backend.env
chmod 600 .local/backend.env
```

Edit `.local/backend.env` with your editor. Keep one literal `KEY=value` per line, with no surrounding quotes or inline comments. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `CALENDAR_PUBLIC_BASE_URL=https://calendar-sync.guymichaely.com/`. Keep `CALENDAR_APP_URL=https://guymichaely.com/calendar/`. Do not paste the secret into chat, commit it, or put it in a `VITE_` variable.

## Discover your allowed Google account ID

The backend authorizes an exact Google **subject (`sub`)**, not an email address. Use the included helper on the computer where your browser runs:

```bash
./scripts/bun install --frozen-lockfile
./scripts/bun scripts/google-subject.js
```

Open the printed Google sign-in URL and choose your intended account. The helper validates the login through the real OIDC library and prints the account plus `ALLOWED_GOOGLE_SUBJECT=...`. Copy that line into `.local/backend.env`. It exposes only a temporary loopback callback, never exposes calendar data, and never prints provider tokens. It exits after the callback or a ten-minute timeout. You can remove the localhost callback from the Google client after setup.

## Deploy and connect

After completing Google configuration, follow [the Cloudflare setup guide](cloudflare/README.md#prepare-the-account) to generate and upload Worker secrets. Production code updates use:

```bash
./scripts/worker deploy
```

Check `https://calendar-sync.guymichaely.com/healthz`; it should show `ok`. Open <https://guymichaely.com/calendar/>, expand the hamburger menu, save `https://calendar-sync.guymichaely.com/` in **Remote sync server**, and sign in with Google. Repeat the server setting on each browser/device. Local data continues working while the backend is offline.

The frontend and backend use HTTPS under the same registrable domain, so they are same-site but different origins. Credentialed CORS allows the configured app URLs; cookies remain host-only, Secure, and HttpOnly. `CALENDAR_ADDITIONAL_APP_URLS_JSON` is an optional JSON array of exact frontend URLs. Production also allows the local preview at `http://127.0.0.1:5177/calendar/` and `http://localhost:5177/calendar/`. Google keeps the same backend callback. Only configured return URLs are accepted after login. A browser that blocks third-party cookies must allow them for the sync server when using a local preview.

## Optional local Bun backend

`./scripts/bun run dev:backend` runs an in-memory server with explicitly supplied backend environment variables. Sessions, calendar documents, and attachment blobs reset when it exits.

For persistent local storage, use the same configuration with `backend/bun-server.js`. For example, after supplying `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ALLOWED_GOOGLE_SUBJECT` in this backend shell:

```bash
CALENDAR_APP_URL=http://localhost:5173/calendar/ \
CALENDAR_PUBLIC_BASE_URL=http://localhost:8787/ \
CALENDAR_DATA_DIR="$PWD/.local/backend-data" \
./scripts/bun backend/bun-server.js
```

The listener defaults to `127.0.0.1:8787`; `HOST` and `PORT` can override it. Register `http://localhost:8787/auth/callback/google` with Google if testing local sign-in. The wrapper disables automatic dotenv loading, so `.local/backend.env` is not loaded implicitly. Keep backend credentials out of frontend build shells.

The data directory contains `auth/` (login transactions and sessions), `documents/` (Automerge snapshots), and `blobs/` (attachments and content types). Run only one backend process against a directory. Stop it before copying the complete directory for a consistent backup or restoring a backup.

## Storage and backups

Production stores the calendar and sessions in its Durable Object and attachment bytes in private R2. Code deployments keep those existing storage bindings. Full backups need both document storage and attachment bytes; frontend JSON exports contain attachment metadata only and are not a complete backend backup.

`CALENDAR_OIDC_PROVIDERS_JSON` and `CALENDAR_ALLOWED_IDENTITIES_JSON` support other providers and exact `(issuer, subject)` identities. See [authentication](auth/README.md) and [sync](../sync/README.md) for the protocols.

## Verification

`./scripts/bun run check` covers domain behavior, storage, auth, sync, attachments, the Bun listener, Solid tests, TypeScript, and frontend bundling. CI also runs `./scripts/bun scripts/smoke-worker.js` against a local Worker with synthetic data to check health, auth rejection, persisted snapshot loading, independent-device merges, immutable R2 attachments, and origin rejection. Real Google login needs registered credentials and a user completing consent.
