# Cloudflare deployment and cutover

The Worker keeps the existing Google login and snapshot protocol. One SQLite-backed Durable Object serializes calendar writes and stores the Automerge snapshot and expiring auth records. Private R2 storage holds attachment files. No tunnel or always-running computer is required after cutover.

Start with Workers Free. The entry Worker only forwards requests; Automerge merges run inside a SQLite-backed Durable Object, whose documented default CPU allowance is 30 seconds per invocation. The ordinary Worker's 10 ms Free-plan limit does not by itself establish that this backend needs Workers Paid. Validate actual behavior and daily quotas before deciding to upgrade. R2 has separate free allowances and may require billing activation. References: [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

An isolated trial uses the separate calendar-sync-trial Worker and synthetic calendar data. It does not bind the production hostname, access Google credentials, copy personal data, or require R2. It measures the real Worker/Durable Object sync path; attachment storage and Google login still need end-to-end verification before cutover.

## Free-plan trial results (2026-09-07)

Deployed `calendar-sync-trial.guymichaely.workers.dev` on the existing Free plan. The live test passed: 200 synthetic tasks, a fresh-device download, concurrent edits on separate replicas, and 20 successful sync requests. The final snapshot was 60,373 bytes. Median round-trip latency was 1,628 ms; maximum was 2,908 ms. These are network/client-inclusive timings, not CPU measurements or a guarantee for larger calendars. Production's hostname and data were untouched. Google authentication and R2 remain separate cutover checks.

To repeat the isolated test, generate a fresh random `TRIAL_TOKEN` in an ignored `.local/trial-secrets.json` file (mode 0600), then run:

    CALENDAR_WORKER_CONFIG=backend/cloudflare/wrangler.trial.jsonc ./scripts/worker deploy
    CALENDAR_WORKER_CONFIG=backend/cloudflare/wrangler.trial.jsonc ./scripts/worker secret bulk .local/trial-secrets.json
    ./scripts/bun scripts/test-cloud-trial.js https://calendar-sync-trial.guymichaely.workers.dev

The synthetic session lasts one hour after object startup. Redeploy/update the secret for a fresh test session. The trial contains no real calendar data and exposes only health and authenticated sync. Failure of this separate trial does not affect production.

## Prepare the account

Keep Workers Free and enable R2 in your Cloudflare dashboard when ready for the full backend, then run from the repository root:

    ./scripts/bun install --frozen-lockfile
    ./scripts/worker login
    ./scripts/worker r2 bucket create calendar-sync-attachments
    ./scripts/worker deploy
    ./scripts/bun scripts/cloud-secrets.js
    ./scripts/worker secret bulk .local/worker-secrets.json

Login opens Cloudflare's authorization page; complete it yourself. The wrapper downloads a pinned, checksum-verified Node runtime for Wrangler only. Runtime, caches, login credentials, and logs stay under the checkout's ignored .local directory. Bun remains the application/container runtime. Do not commit or share the generated secret file.

Check the deployment's displayed workers.dev URL at /healthz; expect "ok". Do not sign in or sync through the temporary hostname: Google still redirects to the existing calendar hostname.

## Production

Production runs at `https://calendar-sync.guymichaely.com` on Workers Free, with its calendar in Durable Object SQLite and attachment files in private R2. Google login uses the existing encrypted Worker secrets. The configured route `calendar-sync.guymichaely.com/*` handles every request without forwarding to the tunnel origin, so Docker and the connector can stay stopped. The existing proxied DNS record and tunnel configuration remain in place.

Keep the existing Google redirect URI:

    https://calendar-sync.guymichaely.com/auth/callback/google

Deploy only the current entry point with `./scripts/worker deploy`. New empty server storage is initialized by the first authenticated sync; there is no old-server seed fallback. The one-time root migration is not part of the production runtime or deployment scripts. Generation-2 documents use a single shared root and reject incompatible clients with HTTP 409. Refresh the frontend on each device and sync after the migration. The production conversion on 2026-09-08 verified 19 items and one deletion tombstone unchanged while replacing five root maps with one. Task activity history is preserved; previous Automerge edit history and browser undo history are reset.

## Free-plan trial (optional)

The trial is isolated from production and uses only synthetic data:

    CALENDAR_WORKER_CONFIG=backend/cloudflare/wrangler.trial.jsonc ./scripts/worker deploy
    CALENDAR_WORKER_CONFIG=backend/cloudflare/wrangler.trial.jsonc ./scripts/worker secret bulk .local/trial-secrets.json
    ./scripts/bun scripts/test-cloud-trial.js https://calendar-sync-trial.guymichaely.workers.dev

Use a fresh random `TRIAL_TOKEN` in the ignored secret file (mode 0600). The synthetic session lasts one hour after object startup.

## Local verification

    ./scripts/worker deploy --dry-run --outdir "$PWD/.local/worker-build"
    ./scripts/bun scripts/smoke-worker.js

The smoke test uses a separate local Worker configuration and synthetic sessions; production never imports the test fixture. It verifies auth rejection, merging independently initialized devices, origin checks, and immutable attachment upload/download. The account, DNS, secrets, and production data are untouched.

Production backend deployments remain explicit via ./scripts/worker deploy; frontend main-branch deployments continue through GitHub Pages. Keep one backend deployment at a time.
