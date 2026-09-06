#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root, for example with sudo." >&2
  exit 1
fi

: "${CALENDAR_HOST:?Set CALENDAR_HOST to the public DNS hostname for this server.}"

DEPLOY_REVISION="${DEPLOY_REVISION:-main}"
CALENDAR_IMAGE="${CALENDAR_IMAGE:-ghcr.io/guymichaely/calendar-backend:main}"
CALENDAR_APP_URL="${CALENDAR_APP_URL:-https://guymichaely.com/calendar/}"
RAW_BASE="https://raw.githubusercontent.com/GuyMichaely/calendar/${DEPLOY_REVISION}"
PUBLIC_BASE_URL="https://${CALENDAR_HOST}/"

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl software-properties-common
add-apt-repository -y universe
apt-get update
apt-get install -y caddy docker.io docker-compose-v2 ufw

systemctl enable --now docker

install -d -m 0755 /opt/calendar
install -d -m 0700 /etc/calendar
install -d -m 0750 /var/lib/calendar
install -d -m 0755 /etc/systemd/system/caddy.service.d

curl -fsSL "${RAW_BASE}/deploy/compose.yaml" -o /opt/calendar/compose.yaml
curl -fsSL "${RAW_BASE}/deploy/Caddyfile" -o /etc/caddy/Caddyfile
curl -fsSL "${RAW_BASE}/deploy/calendar.service" -o /etc/systemd/system/calendar.service
curl -fsSL "${RAW_BASE}/deploy/caddy-calendar.conf" -o /etc/systemd/system/caddy.service.d/calendar.conf

chmod 0644 /opt/calendar/compose.yaml /etc/caddy/Caddyfile /etc/systemd/system/calendar.service /etc/systemd/system/caddy.service.d/calendar.conf

printf 'CALENDAR_HOST=%s\n' "$CALENDAR_HOST" > /etc/calendar/caddy.env
printf 'CALENDAR_IMAGE=%s\n' "$CALENDAR_IMAGE" > /etc/calendar/image.env
chmod 0600 /etc/calendar/caddy.env /etc/calendar/image.env

if [ ! -e /etc/calendar/calendar.env ]; then
  cat > /etc/calendar/calendar.env <<EOF
CALENDAR_APP_URL=${CALENDAR_APP_URL}
CALENDAR_PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
CALENDAR_DATA_DIR=/data
HOST=0.0.0.0
PORT=8787
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ALLOWED_GOOGLE_SUBJECT=
EOF
  chmod 0600 /etc/calendar/calendar.env
fi

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl daemon-reload
CALENDAR_HOST="$CALENDAR_HOST" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl restart caddy
systemctl enable calendar.service

CALENDAR_IMAGE="$CALENDAR_IMAGE" docker compose -f /opt/calendar/compose.yaml config >/dev/null

cat <<EOF

Host provisioning complete.

Public backend URL: ${PUBLIC_BASE_URL}
Persistent data:   /var/lib/calendar
Runtime config:    /etc/calendar/calendar.env
Image selector:    /etc/calendar/image.env
Compose file:      /opt/calendar/compose.yaml
Caddy config:      /etc/caddy/Caddyfile

The calendar container was not started because OAuth values still need to be configured.
After filling GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and ALLOWED_GOOGLE_SUBJECT in /etc/calendar/calendar.env, run:

  systemctl start calendar

For later image updates:

  systemctl reload calendar

EOF
