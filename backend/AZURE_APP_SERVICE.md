# Azure App Service deployment

The persistent calendar backend can run as one Linux custom container in Azure App Service. `backend/Dockerfile` listens on port 8080 and stores backend state under `/home/calendar-data`.

## Recommended shape

Use these resources:

- one resource group, for example `calendar-sync`;
- one Azure Container Registry;
- one Linux App Service plan;
- one Web App using the container from the registry;
- a same-site backend hostname such as `sync.guymichaely.com` for normal authenticated use.

The app is deliberately single-process. Do not scale the Web App to multiple instances while it uses `backend/file-stores.js`.

The Free F1 App Service tier is useful for reserving and testing the Web App. Azure requires a paid App Service tier such as Basic B1 before a custom domain can be mapped. The current authentication uses a host-only `SameSite=Lax` session cookie, so the Azure-provided `*.azurewebsites.net` hostname is not the recommended final endpoint for a frontend hosted on `guymichaely.com`. A `sync.guymichaely.com` endpoint is same-site with the frontend and avoids depending on third-party-cookie behavior.

## 1. Create the Azure resources

In the Azure portal:

1. Create a resource group, for example `calendar-sync`.
2. Create an Azure Container Registry in that resource group. Basic is sufficient. A registry name must be globally unique.
3. Create a Web App with Publish set to Container and Operating System set to Linux.
4. F1 Free is sufficient to allocate and test the Web App. Use Basic B1 or higher before adding `sync.guymichaely.com`.
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

For initial Azure-hostname testing:

```text
CALENDAR_APP_URL=https://guymichaely.com/calendar/
CALENDAR_PUBLIC_BASE_URL=https://<app-name>.azurewebsites.net/
```

For normal authenticated use after mapping the custom domain:

```text
CALENDAR_APP_URL=https://guymichaely.com/calendar/
CALENDAR_PUBLIC_BASE_URL=https://sync.guymichaely.com/
```

The backend derives the allowed browser origin from `CALENDAR_APP_URL`.

## 5. Map `sync.guymichaely.com`

Scale the App Service plan to Basic B1 or higher. In the Web App's Custom domains page, add `sync.guymichaely.com` and follow Azure's DNS validation instructions. For a subdomain, this normally includes a CNAME pointing to `<app-name>.azurewebsites.net` plus Azure's requested ownership-validation record. Use an App Service managed certificate for HTTPS.

After the hostname is active, change `CALENDAR_PUBLIC_BASE_URL` to `https://sync.guymichaely.com/` and restart the Web App.

## 6. Create the Google OAuth client

Create a Google OAuth 2.0 Web application client. Its authorized redirect URI must exactly match:

```text
https://sync.guymichaely.com/auth/callback/google
```

For temporary Azure-hostname testing instead, use:

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

## 7. Configure the browser

The Solid frontend has a Remote sync server field in the hamburger menu. Enter:

```text
https://sync.guymichaely.com/
```

and choose Save sync server. The page reloads using that backend. The build-time `VITE_CALENDAR_BACKEND_URL` remains only a fallback when the browser has no saved setting.

Then use Sign in with Google. After authentication, Sync now exchanges the local Automerge document with the backend.

## Operational notes

The filesystem stores are designed for one backend process. Keep the Web App at one instance. Back up the persistent `/home/calendar-data` contents. If the backend later needs multiple instances, replace the filesystem document/blob stores with a shared durable store rather than pointing multiple processes at the same directory.
