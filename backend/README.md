# Calendar backend

The backend is composed in `app.js` from provider-agnostic OIDC auth, authenticated Automerge sync, attachment routes, and injected storage implementations.

## Runtime

Production runs on Azure App Service for Linux with the managed Node.js 24 LTS runtime. `npm start` launches `backend/node-server.js`.

The Node listener adapts Node HTTP requests to the Fetch `Request`/`Response` interface used by the backend core. The application still keeps auth, sync, and storage logic independent of the HTTP runtime.

Required deployment values:

- `CALENDAR_APP_URL`: public frontend URL, currently `https://guymichaely.com/calendar/`;
- `CALENDAR_PUBLIC_BASE_URL`: public backend URL, currently `https://guymichaely-calendar-sync.azurewebsites.net/`;
- `CALENDAR_DATA_DIR`: persistent directory for backend state, currently `/home/calendar-data`;
- OIDC provider and allowed-identity configuration described below.

App Service supplies `PORT`. The production listener binds to `0.0.0.0` and uses that port. For local use, `PORT` defaults to `8080` and `HOST` may override the listener address.

## Persistent storage

The backend uses filesystem stores for sessions, the Automerge document, and attachment blobs. On Azure App Service, state lives under `/home/calendar-data`. App Service persists `/home` across app restarts and deployments.

The data directory contains:

- `auth/`: OIDC flow and opaque session records;
- `documents/`: serialized Automerge documents;
- `blobs/`: immutable attachment records containing the bytes and content type.

The filesystem document store serializes updates only within one backend process. Keep the Web App on one App Service instance. Do not scale it out unless the filesystem stores are replaced with a storage implementation that supports concurrent processes.

Back up the whole data directory as one unit when a mutually consistent copy is required.

## OIDC configuration

Google convenience variables are:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
ALLOWED_GOOGLE_SUBJECT
```

The Google issuer is fixed to `https://accounts.google.com`. Authorization is by exact issuer and subject, not by email address.

Provider-agnostic configuration is also available:

```text
CALENDAR_OIDC_PROVIDERS_JSON
CALENDAR_ALLOWED_IDENTITIES_JSON
```

`CALENDAR_OIDC_PROVIDERS_JSON` is an array of provider objects with `id`, `issuer`, and `clientId`, plus optional `clientSecret` and `scopes`. `CALENDAR_ALLOWED_IDENTITIES_JSON` is an array of objects containing exact `issuer` and `subject` values.

For the current Azure Web App, the Google callback URI is:

```text
https://guymichaely-calendar-sync.azurewebsites.net/auth/callback/google
```

## Azure App Service setup

The existing Web App is `guymichaely-calendar-sync` in resource group `calendar-sync`. It shares the existing Linux B1 App Service plan `parola-plan`.

From Azure Cloud Shell, configure the Web App for the managed Node runtime:

```bash
curl -fsSLo ~/configure-calendar-app-service.sh \
  https://raw.githubusercontent.com/GuyMichaely/calendar/main/scripts/configure-azure-app-service.sh
bash ~/configure-calendar-app-service.sh
```

The script switches the Web App from the nginx placeholder container to Node 24 LTS, keeps Always On enabled, configures `/healthz`, and sets the non-secret application settings.

Then configure GitHub deployment in the Azure portal:

1. Open `guymichaely-calendar-sync`.
2. Open **Deployment Center**.
3. Select **GitHub** as the source and GitHub Actions as the build provider.
4. Authorize Azure to access GitHub if prompted.
5. Select repository `GuyMichaely/calendar` and branch `main`.
6. Prefer the user-assigned identity authentication option when Azure offers it.
7. Save. Azure creates the GitHub Actions deployment workflow and starts the first deployment.

Finally, under the Web App's environment variables, add:

```text
GOOGLE_CLIENT_ID=<Google OAuth web client ID>
GOOGLE_CLIENT_SECRET=<Google OAuth web client secret>
ALLOWED_GOOGLE_SUBJECT=<your exact Google OpenID Connect sub>
```

Restart the Web App after changing auth settings.

Verify:

```bash
curl https://guymichaely-calendar-sync.azurewebsites.net/healthz
```

The response should be `ok`.

Then put this URL in the frontend's **Remote sync server** field:

```text
https://guymichaely-calendar-sync.azurewebsites.net/
```

## Development backend

`npm run dev:backend` runs `node-dev.js`. It uses in-memory auth, document, and blob stores and loses all server-side state when the process exits.

Example:

```bash
CALENDAR_APP_URL=http://localhost:5173/calendar/ \
CALENDAR_PUBLIC_BASE_URL=http://localhost:8787/ \
GOOGLE_CLIENT_ID=your-client-id \
GOOGLE_CLIENT_SECRET=your-client-secret \
ALLOWED_GOOGLE_SUBJECT=your-google-subject \
PORT=8787 \
npm run dev:backend
```

`npm run start:backend` runs the same persistent Node backend used by App Service and requires `CALENDAR_DATA_DIR`.
