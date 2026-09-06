#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this command as root, for example with sudo." >&2
  exit 1
fi

ENV_FILE="${ENV_FILE:-/etc/calendar/calendar.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Provision the host first." >&2
  exit 2
fi

read -r -p "Google OAuth client ID: " GOOGLE_CLIENT_ID
read -r -s -p "Google OAuth client secret: " GOOGLE_CLIENT_SECRET
printf '\n'
read -r -p "Allowed Google OpenID Connect subject (sub): " ALLOWED_GOOGLE_SUBJECT

if [ -z "$GOOGLE_CLIENT_ID" ] || [ -z "$GOOGLE_CLIENT_SECRET" ] || [ -z "$ALLOWED_GOOGLE_SUBJECT" ]; then
  echo "Client ID, client secret, and allowed subject are all required." >&2
  exit 2
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

grep -Ev '^(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|ALLOWED_GOOGLE_SUBJECT)=' "$ENV_FILE" > "$TMP" || true
printf 'GOOGLE_CLIENT_ID=%s\n' "$GOOGLE_CLIENT_ID" >> "$TMP"
printf 'GOOGLE_CLIENT_SECRET=%s\n' "$GOOGLE_CLIENT_SECRET" >> "$TMP"
printf 'ALLOWED_GOOGLE_SUBJECT=%s\n' "$ALLOWED_GOOGLE_SUBJECT" >> "$TMP"

install -m 0600 "$TMP" "$ENV_FILE"

systemctl start calendar

for attempt in $(seq 1 24); do
  if [ "$(curl -fsS --connect-timeout 2 --max-time 5 http://127.0.0.1:8787/healthz 2>/dev/null || true)" = "ok" ]; then
    echo "Calendar backend is healthy on 127.0.0.1:8787."
    exit 0
  fi
  sleep 2
done

echo "Calendar backend did not become healthy." >&2
systemctl status calendar --no-pager >&2 || true
docker compose -f /opt/calendar/compose.yaml ps >&2 || true
echo "Inspect container logs with: docker compose -f /opt/calendar/compose.yaml logs --tail=200 calendar" >&2
exit 1
