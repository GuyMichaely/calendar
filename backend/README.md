# Calendar backend

The backend is composed in `app.js` from provider-agnostic OIDC auth, authenticated Automerge sync, attachment routes, and injected storage implementations.

## Development backend

`npm run dev:backend` runs `bun-dev.js`. It uses in-memory auth, document, and blob stores and loses all server-side state when the process exits.

## Persistent single-process backend

`npm run start:backend` runs `bun-server.js`. It requires a persistent filesystem directory and uses `file-stores.js` for sessions, the Automerge document, and attachment blobs.

Required deployment values:

- `CALENDAR_APP_URL`: public frontend URL, for example `https://example.com/calendar/`;
- `CALENDAR_PUBLIC_BASE_URL`: public backend URL as seen by the browser and OIDC provider;
- `CALENDAR_DATA_DIR`: persistent directory for backend state;
- OIDC provider and allowed-identity configuration, described below.

Optional listener values:

- `HOST`, default `127.0.0.1`;
- `PORT`, default `8787`.

`CALENDAR_PUBLIC_BASE_URL` is deliberately independent of `HOST` and `PORT`. A reverse proxy such as nginx can expose an HTTPS public URL while Bun listens only on a local HTTP socket.

The filesystem document store serializes atomic document updates within one backend process and commits new document bytes by atomic rename. Attachment records are assembled in temporary directories and published by rename, so readers do not observe partially written blob records. Do not run multiple backend processes against the same `CALENDAR_DATA_DIR`. A future database/object-store adapter can implement the same injected store contracts when multi-process or multi-host operation is needed.

The data directory contains three subdirectories:

- `auth/`: OIDC flow and opaque session records;
- `documents/`: serialized Automerge documents;
- `blobs/`: immutable attachment records containing the bytes and content type.

Back up the entire data directory. For a mutually consistent filesystem copy, stop the backend during the copy or use a filesystem/storage snapshot with equivalent point-in-time semantics. The application does not require any particular backup tool.

## OIDC configuration

Google convenience variables are:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
ALLOWED_GOOGLE_SUBJECT
```

The Google issuer is fixed to `https://accounts.google.com`. Authorization is by exact issuer and subject, never by email address.

Provider-agnostic configuration is also available:

```text
CALENDAR_OIDC_PROVIDERS_JSON
CALENDAR_ALLOWED_IDENTITIES_JSON
```

`CALENDAR_OIDC_PROVIDERS_JSON` is an array of provider objects with `id`, `issuer`, and `clientId`, plus optional `clientSecret` and `scopes`. `CALENDAR_ALLOWED_IDENTITIES_JSON` is an array of objects containing exact `issuer` and `subject` values.

The callback URL for provider `<id>` is `<CALENDAR_PUBLIC_BASE_URL>/auth/callback/<id>`, preserving any path prefix in the configured public base URL.

## Frontend connection

The Solid frontend has a **Remote sync server** field in the hamburger menu. Saving a URL there stores it in browser local storage and reloads the app with that backend. Clearing the field disables remote sync for that browser.

`VITE_CALENDAR_BACKEND_URL` remains available as a build-time default. A browser-saved value takes precedence, including an explicitly saved empty value.

Browser requests use credentialed CORS and server-side opaque sessions. Secure production session cookies use `SameSite=None; Secure; HttpOnly`, so the frontend may use an HTTPS backend on a different site, including an Azure-provided hostname. The backend still rejects browser requests whose `Origin` is not the configured calendar origin. Browser policies that block third-party cookies entirely can still block a cross-site session cookie.

## Azure App Service

`Dockerfile` packages the persistent backend for a Linux custom-container App Service deployment. See [`AZURE_APP_SERVICE.md`](./AZURE_APP_SERVICE.md) for the App Service resource layout, persistent `/home` configuration, container build command, public URL choices, and Google callback settings.

## Existing-host diagnostics

If the backend is being installed on an existing Linux host or Azure VM, run `scripts/diagnose-backend-host.sh` from a checkout of this repository. It reports nginx, listeners, firewall state, candidate systemd services, container/runtime state, calendar configuration files, repository revisions, local health probes, and Azure VM metadata when available. OAuth secrets and private-key paths are redacted.
