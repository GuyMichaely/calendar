# Calendar backend setup

The backend is a single Bun process serving provider-neutral OIDC auth, Automerge snapshot sync, and attachment blobs. It runs as an unprivileged container with a read-only root filesystem. A Docker volume holds persistent data. Only `127.0.0.1:8787` is published on the host; localhost.run exposes it over HTTPS through SSH.

## 1. Choose the backend host

Use a computer that will stay on while you need sync. Run these commands in this repository on that computer. Docker Engine and Docker Compose **2.30 or newer** are the host prerequisites. Everything else for the backend is in the image. The repository-local Bun wrapper is available for development and Google identity setup.

No Azure account or DNS change is needed. Old Azure resources, if any, are left untouched. If migrating a populated backend, stop it and copy its complete data directory into the new volume before enabling sync; this setup does not automatically transfer Azure data.

## 2. Start the HTTPS tunnel

For a temporary anonymous URL:

```bash
./scripts/tunnel --anonymous
```

Keep this terminal open and note the HTTPS hostname in the JSON tunnel event. The server need not be running yet. localhost.run supplies the certificate and sends HTTP to local port 8787.

For a longer-lived free hostname, create a dedicated key:

```bash
./scripts/tunnel-key
```

Sign in at <https://admin.localhost.run/> and register the public key printed by the command (the contents of `.local/ssh/localhost-run.pub`). The private key is `.local/ssh/localhost-run`; never upload or share it. Both are ignored by Git and excluded from images. The script never overwrites an existing key. This unattended tunnel key has no passphrase and is protected by owner-only filesystem permissions; it is not used for GitHub or server administration.

Stop the anonymous tunnel, then run:

```bash
./scripts/tunnel
```

With a key present, the script uses it and the `calendar` username instead of `nokey`. It ignores personal SSH configuration and agents and saves the localhost.run host key in `.local/ssh/known_hosts`. If access is denied, register the public key first or use `--anonymous`.

A free key-associated hostname can survive reconnects, but **is not guaranteed permanent**. Registering the key extends its life. A stable hostname requires localhost.run's custom-domain plan; their `lhr.rocks` names do not require your own DNS changes. See the [free-tier limits](https://localhost.run/docs/forever-free/), [SSH FAQ](https://localhost.run/docs/faq/), and [custom-domain documentation](https://localhost.run/docs/custom-domains/).

Whenever the hostname changes, update all three: the Google callback URI, `CALENDAR_PUBLIC_BASE_URL`, and the frontend's saved Remote sync server URL. Recreate the backend container after editing its configuration. Sign in again because cookies are scoped to the previous host.

## 3. Register Google login

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project for Calendar.
2. Open **Google Auth Platform → Branding** (or OAuth consent-screen setup). Use an app name such as `Personal Calendar`, your support email, and your contact email. If asked for a homepage, use `https://guymichaely.com/calendar/`.
3. Choose **External** audience for a personal Gmail account. While in Testing, add your Google account as a test user. Only basic `openid`, `email`, and `profile` scopes are needed; this app does not request Google Calendar or Drive access.
4. Under **Clients**, create an OAuth client with application type **Web application**. Register these two **Authorized redirect URIs** exactly:
   - `https://YOUR-TUNNEL-HOST/auth/callback/google` (replace the hostname with the current tunnel)
   - `http://localhost:8877/auth/callback/google` (one-time local identity discovery)
5. Save the client ID and client secret locally as described below. Authorized JavaScript origins are not needed for this server-side redirect flow. This is an OAuth client, not a service-account key.

Google requires an exact redirect match, including scheme, hostname, port, and path. See [Google's OIDC setup guide](https://developers.google.com/identity/openid-connect/openid-connect).

Create the backend-only configuration file:

```bash
mkdir -p .local
cp -n backend/.env.example .local/backend.env
chmod 600 .local/backend.env
```

Edit `.local/backend.env` with your editor. Keep one literal `KEY=value` per line, with no surrounding quotes or inline comments. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the tunnel's `CALENDAR_PUBLIC_BASE_URL`. Keep `CALENDAR_APP_URL=https://guymichaely.com/calendar/`. Do not paste the secret into chat, commit it, or put it in a `VITE_` variable.

## 4. Discover your allowed Google account ID

The backend authorizes an exact Google **subject (`sub`)**, not an email address. Use the included helper on the computer where your browser runs:

```bash
./scripts/bun install --frozen-lockfile
./scripts/bun scripts/google-subject.js
```

Open the printed Google sign-in URL and choose your intended account. The helper validates the login through the real OIDC library and prints the account plus `ALLOWED_GOOGLE_SUBJECT=...`. Copy that line into `.local/backend.env`. It exposes only a temporary loopback callback, never exposes calendar data, and never prints provider tokens. It exits after the callback or a ten-minute timeout. You can remove the localhost callback from the Google client after setup.

If the backend host is remote, run this one-time helper and browser together on your personal computer, then copy the completed backend configuration securely to the host. Register the tunnel callback for the remote host as well.

## 5. Start the persistent server

```bash
./scripts/container up -d --build --wait
./scripts/container ps
```

The image reads `.bun-version`, installs production packages from `bun.lock` with a frozen lockfile, and runs `backend/bun-server.js`. Configuration comes from `.local/backend.env`. Google secrets stay outside the image. The public base URL determines secure cookies and OAuth callbacks even though the local listener receives HTTP.

Check `https://YOUR-TUNNEL-HOST/healthz`; it should show `ok`. Open <https://guymichaely.com/calendar/>, expand the hamburger menu, save `https://YOUR-TUNNEL-HOST/` in **Remote sync server**, and sign in with Google. Repeat the server setting on each browser/device. Local data continues working while the backend is offline.

The frontend and tunnel are different sites. Auth uses credentialed CORS restricted to `https://guymichaely.com` and a `Secure; HttpOnly; SameSite=None` session cookie. If login succeeds but the app still appears signed out, check whether the browser blocks third-party cookies for these sites. The tunnel cannot override browser cookie policy. Local frontend testing requires changing `CALENDAR_APP_URL` to `http://localhost:5173/calendar/` and recreating the server.

## Operations and storage

```bash
./scripts/container logs --tail 100 backend
./scripts/container up -d --build --wait   # update code/config, preserve data
./scripts/container stop                  # stop backend, preserve data
./scripts/container down                  # remove containers/network, preserve data
```

Keep the SSH tunnel running separately. Re-run it if the connection exits; inspect the newly printed hostname before restarting auth. A stopped/sleeping host cannot serve sync. Do **not** use `down -v` unless deliberately deleting all server data.

The `calendar_backend-data` volume contains:

| Directory | Contents |
| --- | --- |
| `auth/` | OIDC login transactions and opaque sessions |
| `documents/` | Canonical merged Automerge snapshots |
| `blobs/` | Attachment bytes and content types |

Run only one backend process against this volume. Its serialization is process-local. Stop the backend for a consistent backup, archive all of `/data` (including blobs), then restart. For example, while the stopped container still exists:

```bash
./scripts/container stop
mkdir -p .local/backups
./scripts/container cp backend:/data ".local/backups/data-$(date +%Y%m%d-%H%M%S)"
./scripts/container start
```

Store a copy off the host. Frontend JSON exports contain attachment metadata only and are not a substitute for a backend backup. Restore with the backend stopped; preserve ownership for the image's `bun` user.

`CALENDAR_OIDC_PROVIDERS_JSON` and `CALENDAR_ALLOWED_IDENTITIES_JSON` support other providers and exact `(issuer, subject)` identities. See [auth/README.md](../auth/README.md) and [sync/README.md](../sync/README.md) for the protocols.

## Verification

`./scripts/bun run check` covers domain behavior, storage, auth, sync, attachments, the Bun listener, Solid tests, TypeScript, and frontend bundling. CI additionally builds the actual image and runs `scripts/smoke-container` to check health, unauthenticated rejection, CORS, writable volume permissions, and storage across a container restart. Real Google login still needs registered credentials and a user completing consent.
