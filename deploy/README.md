# Backend deployment

The production backend is designed to run on an ordinary Linux host. Azure is currently only the VM provider. The application deployment does not use Azure App Service, Azure Container Registry, or an Azure-specific runtime.

## Host layout

The intended production layout is:

```text
Internet
  -> Caddy on ports 80/443
  -> 127.0.0.1:8787 on the host
  -> calendar backend container
  -> /var/lib/calendar on the host
```

The container image contains Bun and the application dependencies. Calendar state is not stored in the container. `/var/lib/calendar` is bind-mounted at `/data`, which is the value of `CALENDAR_DATA_DIR` inside the container.

Only one backend container may use a calendar data directory. The filesystem stores serialize writes within one process and are not a shared multi-process data store.

## Repository files

- `backend/Dockerfile` builds the runtime image.
- `.github/workflows/publish-backend-image.yml` publishes the image to GitHub Container Registry.
- `compose.yaml` runs the backend on host loopback only.
- `Caddyfile` exposes the backend over HTTPS.
- `calendar.service` starts and updates the Compose application through systemd.
- `scripts/provision-ubuntu-host.sh` installs and configures an Ubuntu 24.04 host.
- `scripts/create-azure-ubuntu-vm.sh` is a thin Azure CLI wrapper around the generic Ubuntu provisioner.

## Container image

Pushes to `main` that change backend runtime files publish:

```text
ghcr.io/guymichaely/calendar-backend:main
ghcr.io/guymichaely/calendar-backend:sha-<full-commit-sha>
```

GitHub Container Registry creates a new personal package as private by default. This backend source is public, so the intended deployment is to change the `calendar-backend` package visibility to Public after its first successful publish. Public GHCR container images can be pulled by the VM without storing a GitHub token on the server.

For a production rollback or a deliberately pinned deployment, set `CALENDAR_IMAGE` in `/etc/calendar/image.env` to a `sha-...` tag rather than `main`.

## Generic Ubuntu host

`provision-ubuntu-host.sh` expects a public DNS name that resolves to the host:

```bash
sudo CALENDAR_HOST=sync.example.com \
  DEPLOY_REVISION=main \
  bash scripts/provision-ubuntu-host.sh
```

It installs Ubuntu packages for Docker, Docker Compose, Caddy, and UFW. It then creates:

```text
/etc/calendar/calendar.env
/etc/calendar/caddy.env
/etc/calendar/image.env
/opt/calendar/compose.yaml
/var/lib/calendar/
/etc/caddy/Caddyfile
/etc/systemd/system/calendar.service
```

The firewall allows SSH, HTTP, and HTTPS. Docker publishes the application only to `127.0.0.1:8787`. Caddy obtains and renews the public TLS certificate automatically when the hostname resolves to the server and ports 80 and 443 are reachable.

The provisioner enables the calendar systemd unit but does not start it. OAuth values must be configured first.

## Azure VM

From Azure Cloud Shell:

```bash
curl -fsSLo ~/create-calendar-vm.sh \
  https://raw.githubusercontent.com/GuyMichaely/calendar/main/scripts/create-azure-ubuntu-vm.sh
bash ~/create-calendar-vm.sh
```

Defaults:

```text
resource group: calendar-sync
region: eastus
VM: guymichaely-calendar-vm
size: Standard_B1s
OS: Ubuntu 24.04 LTS
admin user: guy
```

Each value can be overridden with an environment variable such as `SIZE=Standard_B1ms` or `LOCATION=eastus2` before running the script.

The Azure wrapper creates a Standard public IP and DNS label, opens ports 80 and 443 in the VM network security group, and invokes the generic Ubuntu provisioner through Azure Run Command. The generated SSH key is kept by Azure Cloud Shell. The script prints the exact SSH command when it finishes.

## Google OAuth and runtime configuration

The public backend URL determines the Google callback URI. If the host is `calendar.example.com`, register this exact redirect URI on a Google OAuth Web application client:

```text
https://calendar.example.com/auth/callback/google
```

Then SSH to the host and edit `/etc/calendar/calendar.env`:

```text
CALENDAR_APP_URL=https://guymichaely.com/calendar/
CALENDAR_PUBLIC_BASE_URL=https://calendar.example.com/
CALENDAR_DATA_DIR=/data
HOST=0.0.0.0
PORT=8787
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
ALLOWED_GOOGLE_SUBJECT=<Google OpenID Connect sub>
```

`ALLOWED_GOOGLE_SUBJECT` is the stable Google OpenID Connect subject, not an email address.

Start the backend:

```bash
sudo systemctl start calendar
sudo systemctl status calendar
curl https://calendar.example.com/healthz
```

The health response should be `ok`.

Configure the Solid frontend's Remote sync server field with the same public backend URL. Then sign in with Google and run the first sync.

## Updating and rolling back

To pull the image named in `/etc/calendar/image.env` and recreate the container:

```bash
sudo systemctl reload calendar
```

To pin a specific published revision:

```bash
sudoedit /etc/calendar/image.env
# CALENDAR_IMAGE=ghcr.io/guymichaely/calendar-backend:sha-<full-commit-sha>
sudo systemctl reload calendar
```

## Data and backup

Back up `/var/lib/calendar` as one unit. It contains session records, the Automerge document, and attachment blobs. Stop the backend for a simple mutually consistent filesystem copy:

```bash
sudo systemctl stop calendar
sudo tar -C /var/lib -czf calendar-backup.tgz calendar
sudo systemctl start calendar
```

A provider migration only requires a compatible Linux host, the same container image, the host configuration, and a restored `/var/lib/calendar` directory.
