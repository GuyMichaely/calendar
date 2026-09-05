# Azure App Service deployment

The persistent calendar backend can run as one Linux custom container in Azure App Service. `backend/Dockerfile` listens on port 8080 and stores backend state under `/home/calendar-data`.

## Recommended shape

Use these resources:

- one resource group, for example `calendar-sync`;
- one Azure Container Registry;
- one Linux App Service plan;
- one Web App using the container from the registry.

The app is deliberately single-process. Do not scale the Web App to multiple instances while it uses `backend/file-stores.js`.

The Azure-provided `https://<app-name>.azurewebsites.net/` hostname can be used directly for authenticated sync. Secure production session cookies use `SameSite=None; Secure; HttpOnly`, so the frontend on `guymichaely.com` can send the session cookie on credentialed cross-site requests. The backend still rejects browser requests whose `Origin` is not the configured calendar origin.

A custom hostname such as `sync.guymichaely.com` is optional. Use one later if desired, but it is no longer required by the application's authentication design. Browser-level policies that disable third-party cookies entirely can still block a cross-site cookie even when `SameSite=None` is set.

## 1. Create the Azure resources

In the Azure portal:

1. Create a resource group, for example `calendar-sync`.
2. Create an Azure Container Registry in that resource group. Basic is sufficient. A registry name must be globally unique.
3. Create a Web App with Publish set to Container and Operating System set to Linux.
4. F1 Free is sufficient for the current single-user backend if its resource limits are adequate in practice.
5. Give the Web App a globally unique name. Azure assigns `https://<app-name>.azurewebsites.net/`.

The Web App can initially point at any placeholder image if the portal requires one before creation. Replace it with `calendar-backend:latest` after the first build.

## 2. Build the backend image in Azure

Azure Container Registry can build directly from the public GitHub repository, so local Docker is not required. In Azure Cloud Shell:

```bash
az acr build \
  --registry <registry-name> \
  --image calendar-backend:latest \
  --file backend/Dockerfile \
  https://github.com/GuyMichaely/calendar.git#main
```

Configure the Web App container to use:

```text
<registry-name>.azurecr.io/calendar-backend:latest
```

If using the portal's simple ACR integration, enabling the registry Admin User is the shortest setup path. A managed identity is preferable if the deployment is kept long term.

## 3. Configure persistent storage and the listener

Set these App Service application settings:

```text
WEBSITES_PORT=8080
WEBSITES_ENABLE_APP_SERVICE_STORAGE=true
CALENDAR_DATA_DIR=/home/calendar-data
HOST=0.0.0.0
PORT=8080
```

Linux custom-container persistence must include `/home`; the backend data directory is therefore under `/home/calendar-data`.

## 4. Configure the public URLs

Using the Azure hostname directly:

```text
CALENDAR_APP_URL=https://guymichaely.com/calendar/
CALENDAR_PUBLIC_BASE_URL=https://<app-name>.azurewebsites.net/
```

The backend derives the allowed browser origin from `CALENDAR_APP_URL`.

If a custom backend hostname is added later, change `CALENDAR_PUBLIC_BASE_URL` to that URL and update the Google OAuth callback URI to match.

## 5. Create the Google OAuth client

Create a Google OAuth 2.0 Web application client. Its authorized redirect URI must exactly match the backend hostname:

```text
https://<app-name>.azurewebsites.net/auth/callback/google
```

Set these App Service application settings:

```text
GOOGLE_CLIENT_ID=<client-id>
GOOGLE_CLIENT_SECRET=<client-secret>
ALLOWED_GOOGLE_SUBJECT=<your-google-openid-sub>
```

`ALLOWED_GOOGLE_SUBJECT` is Google's stable OpenID Connect `sub` identifier, not an email address.

## 6. Configure the browser

The Solid frontend has a Remote sync server field in the hamburger menu. Enter:

```text
https://<app-name>.azurewebsites.net/
```

and choose Save sync server. The page reloads using that backend. The build-time `VITE_CALENDAR_BACKEND_URL` remains only a fallback when the browser has no saved setting.

Then use Sign in with Google. After authentication, Sync now exchanges the local Automerge document with the backend.

If the browser is configured to block all third-party cookies, direct cross-site cookie authentication can still be blocked by the browser. In that case, either allow cookies for the Azure backend or map a same-site custom hostname such as `sync.guymichaely.com`.

## Optional custom hostname

If desired later, scale the App Service plan to a tier that supports custom domains. In the Web App's Custom domains page, add `sync.guymichaely.com` and follow Azure's DNS validation instructions. Then set:

```text
CALENDAR_PUBLIC_BASE_URL=https://sync.guymichaely.com/
```

and register this Google callback URI instead:

```text
https://sync.guymichaely.com/auth/callback/google
```

## Operational notes

The filesystem stores are designed for one backend process. Keep the Web App at one instance. Back up the persistent `/home/calendar-data` contents. If the backend later needs multiple instances, replace the filesystem document/blob stores with a shared durable store rather than pointing multiple processes at the same directory.
