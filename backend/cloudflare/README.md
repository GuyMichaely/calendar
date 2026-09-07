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

The synthetic session lasts one hour after object startup. Redeploy/update the secret for a fresh test session. The trial contains no real calendar data and exposes only health and authenticated sync. Failure requires no production rollback, because production is still the original server.

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

## Transfer existing data before changing the hostname

Sync all devices, then pause editing and close the app on all devices. Stop the old backend to freeze its final snapshot:

    sudo ./scripts/container stop backend
    mkdir -p .local/cloud-backup
    chmod 700 .local/cloud-backup
    sudo ./scripts/container cp backend:/data/. .local/cloud-backup/
    sudo chown -R "$(id -u):$(id -g)" .local/cloud-backup
    ./scripts/bun scripts/upload-cloud-data.js .local/cloud-backup

Keep this backup and the original Docker volume. The script transfers attachment files and the actual Automerge snapshot, preserving history and tombstones. JSON exports alone do not preserve those or contain attachment bytes. The Worker uses the uploaded seed only on its first successful sync when its database is empty; it never overwrites an existing cloud calendar.

In Cloudflare, remove the published application route for calendar-sync.guymichaely.com from the calendar-sync tunnel, and remove its tunnel CNAME if it remains. Then open **Workers & Pages → calendar-sync → Settings → Domains & Routes → Add → Custom Domain** and enter **calendar-sync.guymichaely.com**.

Keep the existing Google redirect URI:

    https://calendar-sync.guymichaely.com/auth/callback/google

No Google client or allowed subject change is needed. Verify the public /healthz endpoint. Open the app, sign in again (old sessions stay on the old server), sync, compare tasks, and download an existing attachment. Repeat sync on another device.

Only after verification, stop the connector:

    sudo ./scripts/container stop cloudflared

If a problem occurs before cloud edits, restore the tunnel hostname route and start the old backend/connector. After cloud edits, first sync/export those changes and copy new cloud attachments before rollback; simply starting the old volume would omit newer cloud data.

## Local verification

    ./scripts/worker deploy --dry-run --outdir "$PWD/.local/worker-build"
    ./scripts/bun scripts/smoke-worker.js

The smoke test uses a separate local Worker configuration and synthetic sessions; production never imports the test fixture. It verifies auth rejection, merging independently initialized devices, origin checks, and immutable attachment upload/download. The account, DNS, secrets, and production data are untouched.

Production backend deployments remain explicit via ./scripts/worker deploy; frontend main-branch deployments continue through GitHub Pages. Keep one backend deployment at a time.
